import test from 'node:test';
import assert from 'node:assert/strict';
import {createIsolatedGatedRefreeze} from '../../src/cross-module-gated-refreeze.mjs';
const org='11111111-1111-4111-8111-111111111111';
const incident='33333333-3333-4333-8333-333333333333';
const STEPS=['verify_updated_source_and_revocation_watermarks',
 'rebuild_evidence_diff_and_all_item_reviews',
 'rerun_three_domain_and_independent_reconfirmation',
 'revalidate_six_external_authority_gaps',
 'request_new_isolated_freeze_with_new_idempotency_key'];
function fixture(){
 let version='b'.repeat(64),active=true,good=true,callCount=0;
 const reference={organization_id:org,incident_id:incident,freeze_digest:'a'.repeat(64),
  final_reference:{source_digest:'c'.repeat(64),revocation_reference:{}},
  diff_reference:{organization_id:org,incident_id:incident,
   previous_audit_sequence:1,previous_audit_digest:'d'.repeat(64),
   new_audit_sequence:2,new_audit_digest:'e'.repeat(64)}};
 const planner={plan:async()=>({reason_code:good?'BLOCKED_FRESH_EVIDENCE_AND_REVIEW_REQUIRED':'NOT_READY',
  fixture_recheck_plan_available:good,hold_active:true,handoff_allowed:false,
  compensation_write_allowed:false,release_eligible:false,finance_authorized:false,
  academic_authorized:false,automatic_regeneration_allowed:false,
  six_external_authority_gaps_unresolved:true,
  old_freeze_digest:reference.freeze_digest,current_watermark_digest:version,
  current_comparison_digest:'f'.repeat(64),
  invalidation_categories:[{category:'source_revision_changed',
   owner_department:'sales',recheck_required:true}],
  required_steps:STEPS})};
 const freezeRegistry={freeze:async()=>{callCount++;
  return {reason_code:'BLOCKED_FROZEN_REPORT_NO_EXTERNAL_AUTHORITY',
   hold_active:true,handoff_allowed:false,compensation_write_allowed:false,
   release_eligible:false,freeze:{freeze_digest:'1'.repeat(64)}};}};
 const getFixtureActor=(_,id)=>({actor_id:id,organization_id:org,
  role:id.startsWith('finance')?'finance':'sales',active,fixture_only:true});
 const gate=createIsolatedGatedRefreeze({invalidationPlanner:planner,freezeRegistry,getFixtureActor});
 const ev=(step,action,id,nonce)=>({reference,step,action,actor_id:id,idempotency_key:nonce});
 const complete=async()=>{
  for(let i=0;i<4;i++){
   const role=i===3?'finance':'sales';
   await gate.record(ev(STEPS[i],'start',role+'_starter_'+i,'v91-nonce-start-'+i+'-0001'));
   await gate.record(ev(STEPS[i],'complete',role+'_closer_'+i,'v91-nonce-close-'+i+'-0001'));
  }
 };
 return {gate,reference,ev,complete,setVersion:x=>version=x,
  setActive:x=>active=x,setGood:x=>good=x,get calls(){return callCount;}};
}
function safe(x){
 assert.equal(x.hold_active,true);assert.equal(x.handoff_allowed,false);
 assert.equal(x.finance_authorized,false);assert.equal(x.academic_authorized,false);
 assert.equal(x.compensation_write_allowed,false);assert.equal(x.release_eligible,false);
 assert.equal(x.automatic_regeneration_allowed,false);assert.ok(Object.isFrozen(x));
}
test('V3.2-91 incomplete rechecks cannot write a new freeze',async()=>{
 const f=fixture();const state=await f.gate.inspect(f.reference);safe(state);
 assert.equal(state.remaining_steps.length,4);
 const response=await f.gate.requestFixtureRefreeze({
  reference:f.reference,new_idempotency_key:'v91-new-freeze-key-00001'});safe(response);
 assert.equal(response.reason_code,'RECHECK_TASKS_INCOMPLETE_OR_STALE');
 assert.equal(f.calls,0);
});
test('V3.2-91 complete internal checks permit only isolated blocked freeze',async()=>{
 const f=fixture();await f.complete();
 const state=await f.gate.inspect(f.reference);safe(state);
 assert.equal(state.fixture_recheck_ready,true);
 const response=await f.gate.requestFixtureRefreeze({
  reference:f.reference,new_idempotency_key:'v91-new-freeze-key-00001'});safe(response);
 assert.equal(response.fixture_refreeze_recorded,true);assert.equal(f.calls,1);
 const replay=await f.gate.requestFixtureRefreeze({
  reference:f.reference,new_idempotency_key:'v91-new-freeze-key-00001'});safe(replay);
 assert.equal(replay.reason_code,'BLOCKED_HISTORICAL_REFREEZE_REPLAY');
});
test('V3.2-91 new evidence or actor revocation invalidates all completed checks',async()=>{
 const f=fixture();await f.complete();f.setVersion('2'.repeat(64));
 let state=await f.gate.inspect(f.reference);safe(state);
 assert.equal(state.fixture_recheck_ready,false);
 assert.equal(state.remaining_steps.length,4);
 f.setVersion('b'.repeat(64));f.setActive(false);
 state=await f.gate.inspect(f.reference);safe(state);
 assert.equal(state.fixture_recheck_ready,false);
});
test('V3.2-91 duplicate nonce conflict, self approval and forged authority fail closed',async()=>{
 const f=fixture();const req=f.ev(STEPS[0],'start','sales_starter_0','v91-nonce-start-0-0001');
 await f.gate.record(req);
 await assert.rejects(f.gate.record({...req,actor_id:'sales_closer_0'}),
  {code:'RECHECK_TASK_NONCE_CONFLICT'});
 await assert.rejects(f.gate.record(f.ev(STEPS[0],'complete','sales_starter_0',
  'v91-nonce-close-0-0001')),{code:'INDEPENDENT_RECHECK_COMPLETER_REQUIRED'});
 const illegal=await f.gate.requestFixtureRefreeze({
  reference:f.reference,new_idempotency_key:'v91-new-freeze-key-00001',
  handoff_allowed:true});safe(illegal);
 assert.equal(illegal.reason_code,'INVALID_REFREEZE_REQUEST');assert.equal(f.calls,0);
});
