import test from 'node:test';
import assert from 'node:assert/strict';
import {createIsolatedEvidenceFreezeRegistry,canSubmitToFinanceOrAcademic,
 canExecuteCompensationOrRelease} from '../../src/cross-module-evidence-freeze.mjs';
const org='11111111-1111-4111-8111-111111111111';
const alt='22222222-2222-4222-8222-222222222222';
const incident='33333333-3333-4333-8333-333333333333';
const item=(id,system='market_sales')=>({
 source_system:system,source_event_id:id,source_revision:1,sha256:'a'.repeat(64)});
const packet=(organization_id=org,source_revision=1)=>({
 organization_id,incident_id:incident,source_revision,
 evidence:[item('source-2','academic'),item('source-1')]});
const noRelease=x=>{
 assert.equal(x.hold_active,true);
 assert.equal(x.handoff_allowed,false);
 assert.equal(x.compensation_write_allowed,false);
 assert.equal(x.release_eligible,false);
};
test('V3.2-70 digest freezes deterministically and idempotency is exact',()=>{
 assert.equal(canSubmitToFinanceOrAcademic,false);
 assert.equal(canExecuteCompensationOrRelease,false);
 let trusted=1;
 const store=createIsolatedEvidenceFreezeRegistry({
  getTrustedSourceRevision:()=>trusted});
 const source=packet(),before=JSON.stringify(source);
 const first=store.freeze({packet:source,idempotency_key:'candidate-freeze-v1-00001'});
 noRelease(first);
 assert.equal(first.freeze_version,1);assert.equal(first.source_revision,1);
 assert.match(first.evidence_sha256,/^[a-f0-9]{64}$/);
 assert.equal(Object.isFrozen(first),true);
 source.evidence[0].sha256='b'.repeat(64);
 assert.equal(first.evidence_sha256,store.freeze({
   packet:JSON.parse(before),idempotency_key:'candidate-freeze-v1-00001'
 }).evidence_sha256,'mutating the original request cannot alter the frozen digest');
 const reordered=JSON.parse(before);
 reordered.evidence.reverse();
 assert.strictEqual(store.freeze({packet:reordered,
   idempotency_key:'candidate-freeze-v1-00001'}),first,
   'canonical evidence order must not change the digest');
 assert.throws(()=>store.freeze({packet:source,idempotency_key:'candidate-freeze-v1-00001'}),
   {code:'IDEMPOTENCY_CONFLICT'});
 assert.throws(()=>store.freeze({packet:JSON.parse(before),idempotency_key:'candidate-freeze-v1-00002'}),
   {code:'SOURCE_VERSION_ALREADY_FROZEN'});
 const check=store.verifyForProposedHandoff({...first});
 assert.equal(check.snapshot_current,true);
 assert.equal(check.hash_matches,true);
 assert.equal(check.reason_code,'BLOCKED_EXTERNAL_SIGNATURE_AND_HANDOFF_AUTHORITY_UNAVAILABLE');
 noRelease(check);
 assert.equal(check.external_acceptance_verified,false);
 assert.equal(check.external_signatures_verified,false);
 trusted=2;
 const stale=store.verifyForProposedHandoff(first);
 assert.equal(stale.reason_code,'FROZEN_SOURCE_VERSION_STALE');
 noRelease(stale);
 assert.throws(()=>store.freeze({packet:JSON.parse(before),
  idempotency_key:'candidate-freeze-v1-00001'}),{code:'SOURCE_VERSION_STALE'});
 const p2=packet(org,2);p2.evidence[0].source_revision=2;
 const second=store.freeze({packet:p2,idempotency_key:'candidate-freeze-v2-00001'});
 assert.equal(second.freeze_version,2);noRelease(second);
 assert.equal(store.verifyForProposedHandoff(first).reason_code,'FROZEN_PACKET_SUPERSEDED');
 const tampered={...second,evidence_sha256:'b'.repeat(64)};
 assert.equal(store.verifyForProposedHandoff(tampered).reason_code,
   'FROZEN_PACKET_DIGEST_OR_VERSION_MISMATCH');
 assert.equal(store.verifyForProposedHandoff(second).snapshot_current,true);
 assert.equal(Object.isFrozen(store.verifyForProposedHandoff(second)),true);
});
test('V3.2-70 stale and duplicate evidence cannot enter a CI freeze',()=>{
 const store=createIsolatedEvidenceFreezeRegistry({getTrustedSourceRevision:()=>1});
 const first=packet();
 first.evidence.push({...first.evidence[0]});
 assert.throws(()=>store.freeze({packet:first,idempotency_key:'candidate-freeze-key-00001'}),
   {code:'DUPLICATE_EVIDENCE_SOURCE_EVENT'});
 const extra=packet();extra.finance_authorized=true;
 assert.throws(()=>store.freeze({packet:extra,idempotency_key:'candidate-freeze-key-00001'}),
   {code:'INVALID_PACKET'});
 const missing=packet();missing.evidence[0].sha256='hash-not-verified';
 assert.throws(()=>store.freeze({packet:missing,idempotency_key:'candidate-freeze-key-00001'}),
   {code:'INVALID_EVIDENCE_ITEM'});
 assert.throws(()=>store.freeze({packet:packet(org,2),
   idempotency_key:'candidate-freeze-key-00001'}),{code:'SOURCE_VERSION_STALE'});
 assert.throws(()=>store.freeze({packet:packet(),idempotency_key:'short'}),
   {code:'INVALID_IDEMPOTENCY_KEY'});
 const a=store.freeze({packet:packet(),idempotency_key:'candidate-freeze-key-00001'});
 noRelease(a);
 const other=store.freeze({packet:packet(alt),
   idempotency_key:'candidate-freeze-key-00001'});
 noRelease(other);
});
test('V3.2-70 tenant-safe request keys and externally unsigned evidence stay blocked',()=>{
 const store=createIsolatedEvidenceFreezeRegistry({getTrustedSourceRevision:()=>1});
 const a=store.freeze({packet:packet(org),idempotency_key:'key-shared-between-tenants'});
 const b=store.freeze({packet:packet(alt),idempotency_key:'key-shared-between-tenants'});
 assert.notEqual(a.evidence_sha256,b.evidence_sha256);
 assert.equal(b.freeze_version,1);noRelease(a);noRelease(b);
 const anotherIncident={...packet(org),incident_id:alt};
 assert.throws(()=>store.freeze({packet:anotherIncident,
  idempotency_key:'key-shared-between-tenants'}),{code:'IDEMPOTENCY_CONFLICT'});
 assert.equal(store.verifyForProposedHandoff({...a,organization_id:alt}).reason_code,
  'FROZEN_PACKET_DIGEST_OR_VERSION_MISMATCH');
 assert.equal(store.verifyForProposedHandoff({}).reason_code,
   'INVALID_FROZEN_PACKET_REFERENCE');
});
