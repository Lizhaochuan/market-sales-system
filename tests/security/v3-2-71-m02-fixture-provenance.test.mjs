import test from 'node:test';
import assert from 'node:assert/strict';
import {createIsolatedEvidenceFreezeRegistry} from '../../src/cross-module-evidence-freeze.mjs';
import {createIsolatedProvenancePreflight} from '../../src/cross-module-fixture-provenance-preflight.mjs';
const org='11111111-1111-4111-8111-111111111111';
const alt='22222222-2222-4222-8222-222222222222';
const incident='33333333-3333-4333-8333-333333333333';
const entry=(id,revision=1,digest='a'.repeat(64))=>({
 source_system:'market_sales',source_event_id:id,source_revision:revision,sha256:digest});
const packet=()=>({organization_id:org,incident_id:incident,source_revision:1,
 evidence:[entry('record-1'),entry('record-2')]});
const source=()=>({organization_id:org,incident_id:incident,source_revision:1,
 events:[{...entry('record-1'),state:'active',required:true},
         {...entry('record-2'),state:'active',required:true}]});
function setup(){
 let snapshot=source(),revision=1;
 const registry=createIsolatedEvidenceFreezeRegistry({getTrustedSourceRevision:()=>revision});
 const p=packet();
 const frozen=registry.freeze({packet:p,idempotency_key:'v3-2-71-fixture-freeze-00001'});
 const verifier=createIsolatedProvenancePreflight({
  registry,getTrustedEvidenceSnapshot:()=>snapshot});
 return {p,frozen,verifier,setSnapshot:x=>{snapshot=x;},setRevision:x=>{revision=x;}};
}
const check=(result,reason)=>{
 assert.equal(result.reason_code,reason);
 assert.equal(result.hold_active,true);
 for(const name of ['finance_authorized','academic_authorized','handoff_allowed',
  'compensation_write_allowed','release_eligible','external_evidence_authenticity_verified'])
  assert.equal(result[name],false,name);
 assert.equal(Object.isFrozen(result),true);
};
test('V3.2-71 complete consistent fictional evidence still cannot authorize handoff',()=>{
 const s=setup();
 const r=s.verifier.preflight({packet:s.p,frozen_reference:{
  organization_id:s.frozen.organization_id,incident_id:s.frozen.incident_id,
  freeze_version:s.frozen.freeze_version,source_revision:s.frozen.source_revision,
  evidence_sha256:s.frozen.evidence_sha256}});
 check(r,'BLOCKED_EXTERNAL_AUTHORITIES_NOT_CONNECTED');
 assert.equal(r.fixture_provenance_consistent,true);
});
test('V3.2-71 missing, revoked, mutated and stale evidence fail closed',()=>{
 const s=setup(),ref=()=>({
  organization_id:s.frozen.organization_id,incident_id:s.frozen.incident_id,
  freeze_version:s.frozen.freeze_version,source_revision:s.frozen.source_revision,
  evidence_sha256:s.frozen.evidence_sha256});
 const verify=()=>s.verifier.preflight({packet:s.p,frozen_reference:ref()});
 let x=source();x.events.pop();s.setSnapshot(x);
 check(verify(),'UNKNOWN_FIXTURE_EVIDENCE_EVENT');
 x=source();x.events.push({...entry('record-3'),state:'active',required:true});
 s.setSnapshot(x);check(verify(),'REQUIRED_FIXTURE_EVENT_OMITTED');
 x=source();x.events[0].state='revoked';s.setSnapshot(x);
 check(verify(),'REVOKED_FIXTURE_EVIDENCE_EVENT');
 x=source();x.events[0].source_revision=2;s.setSnapshot(x);
 check(verify(),'FIXTURE_EVENT_REVISION_MISMATCH');
 x=source();x.events[0].sha256='b'.repeat(64);s.setSnapshot(x);
 check(verify(),'FIXTURE_EVENT_DIGEST_MISMATCH');
 x=source();x.organization_id=alt;s.setSnapshot(x);
 check(verify(),'FIXTURE_SOURCE_INVALID_OR_WRONG_SCOPE');
 x=source();x.source_revision=2;s.setSnapshot(x);
 check(verify(),'FIXTURE_SOURCE_REVISION_CHANGED');
 x=source();x.events.push({...x.events[0]});s.setSnapshot(x);
 check(verify(),'FIXTURE_SOURCE_INVALID_OR_WRONG_SCOPE');
 s.setSnapshot(source());s.setRevision(2);
 check(verify(),'FROZEN_REFERENCE_NOT_CURRENT');
});
test('V3.2-71 forged freeze ref and fake extra approval flags are rejected',()=>{
 const s=setup();
 const ref={
  organization_id:s.frozen.organization_id,incident_id:s.frozen.incident_id,
  freeze_version:s.frozen.freeze_version,source_revision:s.frozen.source_revision,
  evidence_sha256:s.frozen.evidence_sha256};
 check(s.verifier.preflight({packet:s.p,frozen_reference:{...ref,
  evidence_sha256:'f'.repeat(64)}}),'PACKET_FROZEN_REFERENCE_MISMATCH');
 check(s.verifier.preflight({packet:s.p,frozen_reference:{...ref,
  finance_authorized:true}}),'INVALID_PROVENANCE_INPUT');
 check(s.verifier.preflight({packet:{...s.p,organization_id:alt},
  frozen_reference:ref}),'PACKET_FROZEN_REFERENCE_MISMATCH');
 const bad={...s.p,evidence:[...s.p.evidence,{...s.p.evidence[0]}]};
 check(s.verifier.preflight({packet:bad,frozen_reference:ref}),'INVALID_PROVENANCE_INPUT');
 check(s.verifier.preflight({packet:{...s.p,execution_allowed:true},
  frozen_reference:ref}),'INVALID_PROVENANCE_INPUT');
 const missing=createIsolatedProvenancePreflight({
  registry:{verifyForProposedHandoff:()=>{throw Error('unavailable');}},
  getTrustedEvidenceSnapshot:()=>source()});
 check(missing.preflight({packet:s.p,frozen_reference:ref}),'FROZEN_REGISTRY_UNAVAILABLE');
 const crash=createIsolatedProvenancePreflight({
  registry:{verifyForProposedHandoff:()=>({
   snapshot_current:true,hash_matches:true,
   reason_code:'BLOCKED_EXTERNAL_SIGNATURE_AND_HANDOFF_AUTHORITY_UNAVAILABLE'})},
  getTrustedEvidenceSnapshot:()=>{throw Error('offline');}});
 check(crash.preflight({packet:s.p,frozen_reference:ref}),'FIXTURE_SOURCE_UNAVAILABLE');
});
