import test from 'node:test';
import assert from 'node:assert/strict';
import {createIsolatedUnifiedRecoveryConclusionGate} from '../../src/cross-module-unified-recovery-conclusion-gate.mjs';
const org='11111111-1111-4111-8111-111111111111';
const incident='33333333-3333-4333-8333-333333333333';
const GAP=['finance_independent_signature','academic_independent_signature',
 'order_payment_reconciliation','lesson_entitlement_reconciliation',
 'three_party_acceptance','atomic_handoff_receipt'];
function fixture(){
 let status='fixture_current_not_authorized',pendingCount=1,
  digest='a'.repeat(64),bad=false;
 const pending={report:async()=>({
  reason_code:bad?'UNIFIED_GATE_UNVERIFIED':
   'BLOCKED_EXTERNAL_HANDOFF_AND_TASK_REVIEW_REQUIREMENTS',
  fixture_unified_report_consistent:!bad,
  hold_active:true,handoff_allowed:false,compensation_write_allowed:false,
  release_eligible:false,finance_authorized:false,academic_authorized:false,
  external_authority_verified:false,comparison_digest:digest,
  total_tasks:1,remaining_count:pendingCount,
  all_internal_tasks_reviewed:pendingCount===0,
  pending_tasks:pendingCount?[{item:'finance_signature',owner_department:'finance',
   status:'pending',difference_digest:'b'.repeat(64)}]:[],
  external_requirements:GAP.map(code=>({code,status:'requires_external_authority'}))})};
 const conclusion={report:async()=>({
  reason_code:'BLOCKED_CONCLUSION_NOT_BUSINESS_AUTHORIZATION',
  fixture_conclusion_current:status==='fixture_current_not_authorized',
  history_repair_allowed:false,automatic_recovery_allowed:false,
  external_authority_verified:false,finance_authorized:false,
  academic_authorized:false,handoff_allowed:false,compensation_write_allowed:false,
  release_eligible:false,hold_active:true,status,
  history_count:5,expires_at_ms:1086400000,
  current_source_fingerprint:'c'.repeat(64),
  events:[{action:'apply'},{action:'review_sales'},{action:'review_finance'},
   {action:'review_academic'},{action:'conclude',expires_at_ms:1086400000,
    source_fingerprint:'c'.repeat(64),event_digest:'d'.repeat(64),
    hold_active:true,handoff_allowed:false}]})};
 const gate=createIsolatedUnifiedRecoveryConclusionGate({
  unifiedPendingReport:pending,recoveryConclusion:conclusion});
 const input=(afterFirstRead=async()=>{},changes={})=>({
  organization_id:org,incident_id:incident,
  final_reference:{source_digest:'e'.repeat(64),revocation_reference:{}},
  diff_reference:{organization_id:org,incident_id:incident,
   previous_audit_sequence:1,previous_audit_digest:'f'.repeat(64),
   new_audit_sequence:2,new_audit_digest:'1'.repeat(64)},
  afterFirstRead,...changes});
 return {gate,input,setStatus:s=>status=s,setPending:n=>pendingCount=n,
  setDigest:s=>digest=s,setBad:b=>bad=b};
}
function safe(r){
 assert.equal(r.hold_active,true);assert.equal(r.handoff_allowed,false);
 for(const k of ['finance_authorized','academic_authorized',
  'compensation_write_allowed','release_eligible','external_authority_verified'])
  assert.equal(r[k],false,k);
 assert.equal(Object.isFrozen(r),true);
}
test('V3.2-96 current fictional conclusion with pending tasks cannot release',async()=>{
 const f=fixture(),r=await f.gate.report(f.input());safe(r);
 assert.equal(r.fixture_combined_consistency,true);
 assert.equal(r.fixture_recovery_current,true);
 assert.equal(r.remaining_count,1);
 assert.equal(r.external_requirements.length,6);
});
test('V3.2-96 all internal tasks and conclusion current still block external handoff',async()=>{
 const f=fixture();f.setPending(0);
 const r=await f.gate.report(f.input());safe(r);
 assert.equal(r.remaining_count,0);
 assert.equal(r.reason_code,'BLOCKED_EXTERNAL_HANDOFF_WITH_CURRENT_FIXTURE_RECOVERY');
});
test('V3.2-96 expiry, revocation, changed source, incomplete reacceptance all deny',async()=>{
 for(const status of ['expired','explicitly_revoked','source_changed',
  'reviewer_revoked_or_inactive','awaiting_independent_reacceptance','not_recorded']){
  const f=fixture();f.setStatus(status);
  const r=await f.gate.report(f.input());safe(r);
  assert.equal(r.reason_code,'RECOVERY_CONCLUSION_REACCEPTANCE_REQUIRED',status);
  assert.equal(r.fixture_recovery_current,false);
 }
});
test('V3.2-96 concurrent status change rejects prior good snapshot',async()=>{
 const f=fixture();
 let r=await f.gate.report(f.input(async()=>f.setStatus('explicitly_revoked')));
 safe(r);assert.equal(r.reason_code,'RECOVERY_OR_TASK_STATE_CHANGED_DURING_CHECK');
 const g=fixture();
 r=await g.gate.report(g.input(async()=>g.setDigest('2'.repeat(64))));
 safe(r);assert.equal(r.reason_code,'RECOVERY_OR_TASK_STATE_CHANGED_DURING_CHECK');
});
test('V3.2-96 corrupt report, cross-tenant scope and forged release fail closed',async()=>{
 const f=fixture();f.setBad(true);
 let r=await f.gate.report(f.input());safe(r);
 assert.equal(r.reason_code,'UNIFIED_PENDING_REPORT_UNVERIFIED');
 f.setBad(false);
 r=await f.gate.report(f.input(async()=>{}, {organization_id:
  '22222222-2222-4222-8222-222222222222'}));safe(r);
 assert.equal(r.reason_code,'INVALID_UNIFIED_RECOVERY_INPUT');
 r=await f.gate.report(f.input(async()=>{}, {handoff_allowed:true}));safe(r);
 assert.equal(r.reason_code,'INVALID_UNIFIED_RECOVERY_INPUT');
});
