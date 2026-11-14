import test from 'node:test';
import assert from 'node:assert/strict';
import {createIsolatedRevocationLedger} from '../../src/cross-module-evidence-revocation-ledger.mjs';
import {createIsolatedRevocationRacePreflight} from '../../src/cross-module-revocation-race-preflight.mjs';
const org='11111111-1111-4111-8111-111111111111';
const incident='33333333-3333-4333-8333-333333333333';
const packet={organization_id:org,incident_id:incident};
const frozen_reference={freeze_version:1};
function fixture(){
 let epoch=1,approved=true;
 const ledger=createIsolatedRevocationLedger({getFixtureSourceEpoch:()=>epoch});
 const provenance={preflight:()=>({fixture_provenance_consistent:approved,
  reason_code:approved?'BLOCKED_EXTERNAL_AUTHORITIES_NOT_CONNECTED':'SOURCE_CHANGED'})};
 const gate=createIsolatedRevocationRacePreflight({ledger,preflight:provenance});
 const makeRef=()=>{
  const w=ledger.viewFixtureWatermark(org,incident);
  return {organization_id:org,incident_id:incident,source_epoch:epoch,
   revocation_sequence:w.revocation_sequence,
   revocation_digest:w.revocation_digest,evidence_event_ids:['E-1']};
 };
 return {ledger,gate,makeRef,setEpoch:x=>{epoch=x;},setProvenance:x=>{approved=x;}};
}
const check=x=>{
 for(const field of ['external_authority_verified','finance_authorized','academic_authorized',
  'handoff_allowed','compensation_write_allowed','release_eligible'])
  assert.equal(x[field],false,field);
 assert.equal(x.hold_active,true);assert.equal(Object.isFrozen(x),true);
};
test('V3.2-73 a stable isolated read remains non-authoritative',async()=>{
 const f=fixture();
 const result=await f.gate.check({packet,frozen_reference,
  revocation_reference:f.makeRef(),beforeFinalCheck:async()=>{}});
 check(result);assert.equal(result.isolated_read_set_stable,true);
 assert.equal(result.reason_code,'BLOCKED_NO_ATOMIC_EXTERNAL_HANDOFF_AUTHORITY');
});
test('V3.2-73 revocation during asynchronous review invalidates the prior read',async()=>{
 const f=fixture();
 const result=await f.gate.check({packet,frozen_reference,
  revocation_reference:f.makeRef(),beforeFinalCheck:async()=>{
   f.ledger.recordRevocation({organization_id:org,incident_id:incident,
    event_id:'E-1',event_sha256:'a'.repeat(64),source_epoch:1,
    revocation_sequence:1,idempotency_key:'race-fixture-revoke-00001'});
  }});
 check(result);assert.equal(result.reason_code,'REVOCATION_CHANGED_DURING_REVIEW');
 assert.equal(result.isolated_read_set_stable,false);
});
test('V3.2-73 source epoch and provenance change fail closed',async()=>{
 const f=fixture();
 const p=await f.gate.check({packet,frozen_reference,revocation_reference:f.makeRef(),
  beforeFinalCheck:async()=>f.setProvenance(false)});
 check(p);assert.equal(p.reason_code,'PROVENANCE_CHANGED_DURING_REVIEW');
 const g=fixture(),r=await g.gate.check({packet,frozen_reference,
  revocation_reference:g.makeRef(),beforeFinalCheck:async()=>g.setEpoch(2)});
 check(r);assert.equal(r.reason_code,'REVOCATION_FINAL_RECHECK_BLOCKED');
});
test('V3.2-73 forged claims, exception and precheck failure cannot pass',async()=>{
 const f=fixture(),ref=f.makeRef();
 const forged=await f.gate.check({packet,frozen_reference,
  revocation_reference:{...ref,finance_authorized:true},beforeFinalCheck:async()=>{}});
 check(forged);assert.equal(forged.reason_code,'INVALID_RACE_PREFLIGHT_INPUT');
 const crashed=await f.gate.check({packet,frozen_reference,revocation_reference:ref,
  beforeFinalCheck:async()=>{throw Error('offline');}});
 check(crashed);assert.equal(crashed.reason_code,'RACE_PREFLIGHT_DEPENDENCY_UNAVAILABLE');
 f.setProvenance(false);
 const early=await f.gate.check({packet,frozen_reference,revocation_reference:ref,
  beforeFinalCheck:async()=>{}});
 check(early);assert.equal(early.reason_code,'PROVENANCE_PRECHECK_BLOCKED');
});
