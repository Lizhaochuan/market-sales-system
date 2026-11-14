import test from 'node:test';
import assert from 'node:assert/strict';
import {createIsolatedUnifiedPendingReviewReport} from '../../src/cross-module-unified-pending-review-report.mjs';
const org='11111111-1111-4111-8111-111111111111',incident='33333333-3333-4333-8333-333333333333';
const gaps=['finance_independent_signature','academic_independent_signature',
 'order_payment_reconciliation','lesson_entitlement_reconciliation',
 'three_party_acceptance','atomic_handoff_receipt'];
const diffReference={organization_id:org,incident_id:incident,previous_audit_sequence:1,
 previous_audit_digest:'a'.repeat(64),new_audit_sequence:2,new_audit_digest:'b'.repeat(64)};
function setup(){
 let status='pending',version='a'.repeat(64),gateGood=true;
 let missing=false,badCount=false,badAuthority=false;
 const differences=[{item:'finance_signature',owner_department:'finance',rereview_required:true},
  {item:'lesson_entitlement_reconciliation',owner_department:'academic',rereview_required:true}];
 const evidenceDiff={report:async()=>({
  reason_code:'BLOCKED_REVIEW_CHANGED_EVIDENCE_AND_EXTERNAL_GAPS',
  fixture_comparison_complete:true,hold_active:true,handoff_allowed:false,
  release_eligible:false,finance_authorized:false,academic_authorized:false,
  differences:missing?differences.slice(0,1):differences,
  external_requirements:gaps.map(code=>({code,status:'requires_external_authority'}))})};
 const tasks={report:async()=>({
  reason_code:'BLOCKED_EXTERNAL_HANDOFF_EVEN_IF_TASKS_COMPLETE',
  hold_active:true,handoff_allowed:false,compensation_write_allowed:false,
  release_eligible:false,finance_authorized:false,academic_authorized:false,
  comparison_digest:version,fixture_all_tasks_reviewed:status==='closed_administratively',
  total_tasks:2,remaining_count:badCount?0:status==='closed_administratively'?0:2,
  tasks:differences.map(x=>({...x,status,difference_digest:version}))})};
 const unifiedGate={check:async()=>({
  reason_code:'BLOCKED_REAL_THREE_PARTY_ATOMIC_HANDOFF_MISSING',
  fixture_unified_consistency:gateGood,hold_active:true,handoff_allowed:false,
  compensation_write_allowed:false,release_eligible:false,
  finance_authorized:badAuthority,academic_authorized:false,external_authority_verified:false})};
 const reporter=createIsolatedUnifiedPendingReviewReport({unifiedGate,tasks,evidenceDiff});
 const input=(afterFirstRead=async()=>{},changes={})=>({
  organization_id:org,incident_id:incident,final_reference:{
   source_digest:'c'.repeat(64),revocation_reference:{}},
  diff_reference:diffReference,afterFirstRead,...changes});
 return {reporter,input,setStatus:x=>status=x,setVersion:x=>version=x,
  setGate:x=>gateGood=x,setMissing:x=>missing=x,setCount:x=>badCount=x,
  setBadAuthority:x=>badAuthority=x};
}
function safe(r){
 assert.equal(r.hold_active,true);assert.equal(r.handoff_allowed,false);
 assert.equal(r.release_eligible,false);assert.equal(r.compensation_write_allowed,false);
 assert.equal(r.finance_authorized,false);assert.equal(r.academic_authorized,false);
 assert.equal(Object.isFrozen(r),true);
}
test('V3.2-88 all pending tasks included in unified blocker',async()=>{
 const f=setup(),r=await f.reporter.report(f.input());safe(r);
 assert.equal(r.fixture_unified_report_consistent,true);
 assert.equal(r.total_tasks,2);assert.equal(r.remaining_count,2);
 assert.equal(r.pending_tasks.length,2);assert.equal(r.external_requirements.length,6);
});
test('V3.2-88 all internal tasks completed never permits external handoff',async()=>{
 const f=setup();f.setStatus('closed_administratively');
 const r=await f.reporter.report(f.input());safe(r);
 assert.equal(r.all_internal_tasks_reviewed,true);assert.equal(r.remaining_count,0);
 assert.equal(r.external_requirements.length,6);
 assert.equal(r.reason_code,'BLOCKED_EXTERNAL_HANDOFF_AND_TASK_REVIEW_REQUIREMENTS');
});
test('V3.2-88 missing or inconsistent tasks fail closed',async()=>{
 const f=setup();f.setMissing(true);
 let r=await f.reporter.report(f.input());safe(r);
 assert.equal(r.reason_code,'TASK_TOTAL_OR_OWNERSHIP_MISMATCH');
 f.setMissing(false);f.setCount(true);
 r=await f.reporter.report(f.input());safe(r);
 assert.equal(r.reason_code,'TASK_TOTAL_OR_OWNERSHIP_MISMATCH');
});
test('V3.2-88 task changes during review are never overlooked',async()=>{
 const f=setup();
 const r=await f.reporter.report(f.input(async()=>f.setStatus('closed_administratively')));
 safe(r);assert.equal(r.reason_code,'TASK_OR_EVIDENCE_CHANGED_DURING_REPORT');
});
test('V3.2-88 forged authorization, scope and unavailable gate fail closed',async()=>{
 const f=setup();f.setBadAuthority(true);
 let r=await f.reporter.report(f.input());safe(r);
 assert.equal(r.reason_code,'UNIFIED_GATE_UNVERIFIED');
 f.setBadAuthority(false);
 r=await f.reporter.report(f.input(async()=>{}, {organization_id:'bad'}));
 safe(r);assert.equal(r.reason_code,'INVALID_UNIFIED_PENDING_REPORT_INPUT');
 r=await f.reporter.report(f.input(async()=>{}, {finance_authorized:true}));
 safe(r);assert.equal(r.reason_code,'INVALID_UNIFIED_PENDING_REPORT_INPUT');
 f.setGate(false);r=await f.reporter.report(f.input());safe(r);
 assert.equal(r.reason_code,'UNIFIED_GATE_UNVERIFIED');
});
