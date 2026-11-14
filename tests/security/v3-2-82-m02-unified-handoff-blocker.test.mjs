import test from 'node:test';
import assert from 'node:assert/strict';
import {createIsolatedUnifiedHandoffBlocker} from '../../src/cross-module-unified-handoff-blocker.mjs';
const org='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
const incident='33333333-3333-4333-8333-333333333333';
const codes=['finance_signature','academic_signature','order_payment_reconciliation',
 'lesson_entitlement_reconciliation','three_party_joint_acceptance','external_atomic_receipt'];
function fixture(){
 let finalGood=true;
 const good=new Map(codes.map(x=>[x,true]));
 const finalPreflight={check:async()=>({
  reason_code:finalGood?'BLOCKED_EXTERNAL_THREE_PARTY_ACCEPTANCE_AND_ATOMIC_HANDOFF_MISSING':'REVOCATION_CHANGED_AT_FINAL_READ',
  fixture_preflight_consistent:finalGood,internal_review_consistent:finalGood,
  revocation_reference_current:finalGood,three_domain_recovery_consistent:finalGood,
  external_authority_verified:false,finance_authorized:false,academic_authorized:false,
  handoff_allowed:false,compensation_write_allowed:false,release_eligible:false,hold_active:true})};
 const supplementFinalCheck={check:async ({requirement_code})=>({
  reason_code:good.get(requirement_code)?'BLOCKED_NONATOMIC_EXTERNAL_AUTHORITY_NOT_CONNECTED':'INDEPENDENT_REVIEW_STALE_OR_UNAVAILABLE',
  fixture_supplement_review_consistent:good.get(requirement_code),
  external_authority_verified:false,finance_authorized:false,academic_authorized:false,
  handoff_allowed:false,compensation_write_allowed:false,release_eligible:false,hold_active:true})};
 const gate=createIsolatedUnifiedHandoffBlocker({finalPreflight,supplementFinalCheck});
 const request=(afterFirstRead=async()=>{},changes={})=>({
  organization_id:org,incident_id:incident,
  final_reference:{source_digest:'a'.repeat(64),revocation_reference:{}},
  afterFirstRead,...changes});
 return {gate,request,setFinal:x=>{finalGood=x;},setSupplement:(c,v)=>good.set(c,v)};
}
function assertDenied(r,reason){
 assert.equal(r.reason_code,reason);assert.equal(r.hold_active,true);
 for(const k of ['external_authority_verified','external_finance_signature_verified',
  'external_academic_signature_verified','real_three_party_acceptance_verified',
  'finance_authorized','academic_authorized','handoff_allowed',
  'compensation_write_allowed','release_eligible','production_integration_allowed'])
  assert.equal(r[k],false,k);
 assert.ok(Object.isFrozen(r));assert.ok(Object.isFrozen(r.checks));
}
test('V3.2-82 all 6 fictional supplement checks and final preflight still block real handoff',async()=>{
 const f=fixture();const r=await f.gate.check(f.request());
 assertDenied(r,'BLOCKED_REAL_THREE_PARTY_ATOMIC_HANDOFF_MISSING');
 assert.equal(r.fixture_unified_consistency,true);
 assert.equal(r.checked_requirement_count,18);
 assert.deepEqual([...new Set(r.checks.map(x=>x.requirement_code))],codes);
});
test('V3.2-82 one missing supplement review blocks the entire unified check',async()=>{
 const f=fixture();f.setSupplement('lesson_entitlement_reconciliation',false);
 const r=await f.gate.check(f.request());
 assertDenied(r,'SUPPLEMENT_REVIEW_PRECHECK_FAILED_LESSON_ENTITLEMENT_RECONCILIATION');
 assert.equal(r.fixture_unified_consistency,false);
});
test('V3.2-82 changes during simulated review invalidate previously good evidence',async()=>{
 const f=fixture();
 const changed=await f.gate.check(f.request(async()=>{
   f.setSupplement('finance_signature',false);
 }));
 assertDenied(changed,'SUPPLEMENT_REVIEW_PRECHECK_FAILED_FINANCE_SIGNATURE');
 const f2=fixture();
 const result=await f2.gate.check(f2.request(async()=>f2.setFinal(false)));
 assertDenied(result,'FINAL_HANDOFF_PRECHECK_FAILED');
});
test('V3.2-82 tampering, scope substitution and exceptions never release hold',async()=>{
 const f=fixture();
 assertDenied(await f.gate.check(f.request(async()=>{}, {handoff_allowed:true})),
  'INVALID_UNIFIED_HANDOFF_INPUT');
 assertDenied(await f.gate.check(f.request(async()=>{}, {organization_id:'bad'})),
  'INVALID_UNIFIED_HANDOFF_INPUT');
 const errorGate=createIsolatedUnifiedHandoffBlocker({
  finalPreflight:{check:async()=>{throw Error('offline');}},
  supplementFinalCheck:{check:async()=>({})}
 });
 assertDenied(await errorGate.check(f.request()),'UNIFIED_HANDOFF_DEPENDENCY_UNAVAILABLE');
 // A different valid tenant may never be trusted solely from its spelling.
 const cross=f.request(async()=>{}, {organization_id:other});
 const crossResult=await f.gate.check(cross);
 assertDenied(crossResult,'BLOCKED_REAL_THREE_PARTY_ATOMIC_HANDOFF_MISSING');
});
test('V3.2-82 fake elevated adapter permissions are protocol violations',async()=>{
 const f=fixture();
 const gate=createIsolatedUnifiedHandoffBlocker({
  finalPreflight:{check:async()=>({
   reason_code:'BLOCKED_EXTERNAL_THREE_PARTY_ACCEPTANCE_AND_ATOMIC_HANDOFF_MISSING',
   fixture_preflight_consistent:true,internal_review_consistent:true,
   revocation_reference_current:true,three_domain_recovery_consistent:true,
   external_authority_verified:false,finance_authorized:true,academic_authorized:false,
   handoff_allowed:false,compensation_write_allowed:false,release_eligible:false,hold_active:true
  })},
  supplementFinalCheck:{check:async()=>({})}
 });
 assertDenied(await gate.check(f.request()),'FINAL_HANDOFF_PRECHECK_FAILED');
});
