import test from 'node:test';
import assert from 'node:assert/strict';
import {createIsolatedUnifiedReportFreeze} from '../../src/cross-module-unified-report-freeze.mjs';
import {createIsolatedFreezeInvalidationPlan} from '../../src/cross-module-freeze-invalidation-plan.mjs';
const org='11111111-1111-4111-8111-111111111111';
const incident='33333333-3333-4333-8333-333333333333';
const gaps=['finance_independent_signature','academic_independent_signature',
 'order_payment_reconciliation','lesson_entitlement_reconciliation',
 'three_party_acceptance','atomic_handoff_receipt'];
function fixture(){
 let revision=1,revoked=0,generation=1,pending=true,good=true;
 const getFixtureWatermark=async()=>({organization_id:org,incident_id:incident,
  source_epoch:1,source_revision:revision,revocation_sequence:revoked,
  revocation_digest:'a'.repeat(64),incident_generation:generation});
 const unifiedReport={report:async()=>({
  reason_code:good?'BLOCKED_EXTERNAL_HANDOFF_AND_TASK_REVIEW_REQUIREMENTS':'BROKEN',
  fixture_unified_report_consistent:good,hold_active:true,handoff_allowed:false,
  compensation_write_allowed:false,release_eligible:false,
  finance_authorized:false,academic_authorized:false,external_authority_verified:false,
  total_tasks:2,remaining_count:pending?1:0,comparison_digest:'b'.repeat(64),
  pending_tasks:pending?[{item:'finance_signature',owner_department:'finance',
   status:'pending',difference_digest:'c'.repeat(64)}]:[],
  all_internal_tasks_reviewed:!pending,
  external_requirements:gaps.map(code=>({code,status:'requires_external_authority'}))})};
 const freezeRegistry=createIsolatedUnifiedReportFreeze({
  unifiedReport,getFixtureWatermark});
 const planner=createIsolatedFreezeInvalidationPlan({
  freezeRegistry,unifiedReport,getFixtureWatermark});
 const base=()=>({organization_id:org,incident_id:incident,
  final_reference:{source_digest:'d'.repeat(64),revocation_reference:{}},
  diff_reference:{organization_id:org,incident_id:incident,
   previous_audit_sequence:1,previous_audit_digest:'e'.repeat(64),
   new_audit_sequence:2,new_audit_digest:'f'.repeat(64)}});
 const freeze=()=>freezeRegistry.freeze({...base(),idempotency_key:
  'v90-fixture-freeze-nonce-0001'});
 return {planner,base,freeze,setRevision:v=>revision=v,
  setRevocation:v=>revoked=v,setGeneration:v=>generation=v,
  setPending:v=>pending=v,setGood:v=>good=v};
}
const ref=(f,freeze)=>({...f.base(),freeze_digest:freeze.freeze_digest});
function safe(r){
 assert.equal(r.hold_active,true);assert.equal(r.handoff_allowed,false);
 for(const k of ['finance_authorized','academic_authorized','compensation_write_allowed',
  'release_eligible','external_authority_verified'])assert.equal(r[k],false,k);
 assert.equal(Object.isFrozen(r),true);
}
test('V3.2-90 still-current freeze does not generate authorization or restart',async()=>{
 const f=fixture(),x=await f.freeze(),r=await f.planner.plan(ref(f,x.freeze));safe(r);
 assert.equal(r.reason_code,'BLOCKED_FREEZE_STILL_CURRENT_NO_EXTERNAL_AUTHORITY');
});
test('V3.2-90 source, revocation, incident and task changes need fresh recheck',async()=>{
 for(const [change,expected] of [
  [f=>f.setRevision(2),'source_revision_changed'],
  [f=>f.setRevocation(1),'revocation_changed'],
  [f=>f.setGeneration(2),'incident_changed'],
  [f=>f.setPending(false),'review_task_changed']]){
  const f=fixture(),x=await f.freeze();change(f);
  const r=await f.planner.plan(ref(f,x.freeze));safe(r);
  assert.equal(r.reason_code,'BLOCKED_FRESH_EVIDENCE_AND_REVIEW_REQUIRED');
  assert.equal(r.fixture_recheck_plan_available,true);
  assert.ok(r.invalidation_categories.some(c=>c.category===expected));
  assert.ok(r.required_steps.includes('request_new_isolated_freeze_with_new_idempotency_key'));
  assert.equal(r.six_external_authority_gaps_unresolved,true);
 }
});
test('V3.2-90 forged permission, changed reference and unavailable report reject',async()=>{
 const f=fixture(),x=await f.freeze();f.setRevision(2);
 const tampered=await f.planner.plan({...ref(f,x.freeze),handoff_allowed:true});safe(tampered);
 assert.equal(tampered.reason_code,'INVALID_INVALIDATION_PLAN_INPUT');
 const different=await f.planner.plan({...ref(f,x.freeze),
  final_reference:{source_digest:'0'.repeat(64),revocation_reference:{}}});safe(different);
 assert.equal(different.reason_code,'FROZEN_REFERENCE_CHANGED_RESTART_REQUIRED');
 f.setGood(false);
 const failed=await f.planner.plan(ref(f,x.freeze));safe(failed);
 assert.equal(failed.reason_code,'CURRENT_UNIFIED_REPORT_UNAVAILABLE');
});
