import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyProposedCrossModuleCompensation,compensationPreflightCanExecute}
 from '../../src/cross-module-compensation-preflight.mjs';
const scenarios=[
 [{kind:'campaign_snapshot_conflict'},'snapshot_integrity_conflict','blocked_immutable_campaign_snapshot_dispute'],
 [{kind:'sales_evidence_missing'},'sales_evidence_gap','blocked_sales_packet_incomplete'],
 [{kind:'external_authority_unknown'},'external_authority_or_reconciliation_unknown','blocked_external_trust_and_status_unknown'],
 [{kind:'wrong_student_link_with_order',student_id:'student-A',order_id:'order-A'},
  'student_order_mislink_candidate','blocked_student_order_identity_reconciliation'],
 [{kind:'payment_or_refund_misattribution',student_id:'student-A',
   payment_id:'payment-A',source_event_id:'event-A'},
  'payment_refund_misattribution_candidate','blocked_finance_original_transaction_reconciliation'],
 [{kind:'fulfilled_lesson_wrong_student',student_id:'student-A',
   lesson_id:'lesson-A',source_event_id:'event-A'},
  'lesson_fulfillment_mislink_candidate','blocked_academic_original_lesson_reconciliation']
];
const mustHold=x=>{
 assert.deepEqual(x.required_parties,['sales','finance','academic']);
 for(const k of ['original_records_integrity_verified','cross_module_case_accepted',
  'finance_acceptance_verified','academic_acceptance_verified','compensation_write_allowed',
  'original_records_mutable','release_eligible','finance_authorized','execution_allowed',
  'activity_publish_allowed'])assert.equal(x[k],false,k);
 for(const k of ['original_records_preservation_required','history_append_only_compensation_required',
  'hold_active'])assert.equal(x[k],true,k);
 assert.ok(Object.isFrozen(x));assert.ok(Object.isFrozen(x.required_parties));
};
test('V3.2-68 independently classified future compensation scenarios never execute',()=>{
 assert.equal(compensationPreflightCanExecute,false);
 for(const [scenario,classification,reason_code] of scenarios){
  const x=classifyProposedCrossModuleCompensation(scenario);
  assert.equal(x.classification,classification);
  assert.equal(x.reason_code,reason_code);mustHold(x);
 }
});
test('V3.2-68 untrusted proof and missing original provenance fail closed',()=>{
 const cases=[null,[],{kind:'finance_approved'},{kind:'wrong_student_link_with_order',student_id:'student-A'},
  {kind:'payment_or_refund_misattribution',student_id:'student-A',payment_id:'payment-A'},
  {kind:'fulfilled_lesson_wrong_student',student_id:'student-A',lesson_id:'lesson-A'},
  {kind:'wrong_student_link_with_order',student_id:'student-A',order_id:'order-A',finance_authorized:true},
  {kind:'external_authority_unknown',hold_active:false},
  {kind:'sales_evidence_missing',compensation_write_allowed:true},
  {kind:'unknown_cross_module_failure',order_id:null}];
 for(const c of cases)mustHold(classifyProposedCrossModuleCompensation(c));
 assert.equal(classifyProposedCrossModuleCompensation({kind:'wrong_student_link_with_order',student_id:'A'}).reason_code,
  'blocked_missing_student_order_provenance');
 assert.equal(classifyProposedCrossModuleCompensation({kind:'payment_or_refund_misattribution',student_id:'A',payment_id:'B'}).reason_code,
  'blocked_missing_payment_event_provenance');
 assert.equal(classifyProposedCrossModuleCompensation({kind:'fulfilled_lesson_wrong_student',student_id:'A',lesson_id:'B'}).reason_code,
  'blocked_missing_lesson_event_provenance');
});
