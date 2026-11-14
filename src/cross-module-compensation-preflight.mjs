// V3.2-68: offline scenario classification for future external reconciliation.
// Never reads CRM/finance/academic data and never authorizes compensation or release.
const allowed=new Set([
 'campaign_snapshot_conflict','sales_evidence_missing','external_authority_unknown',
 'wrong_student_link_with_order','payment_or_refund_misattribution',
 'fulfilled_lesson_wrong_student','unknown_cross_module_failure'
]);
const keys=['kind','student_id','order_id','payment_id','lesson_id','source_event_id'];
const own=(x,k)=>Object.prototype.hasOwnProperty.call(x,k);
function deny(code,category='unclassified_blocked',duties=['sales','finance','academic']){
 return Object.freeze({
  reason_code:code,classification:category,
  required_parties:Object.freeze([...duties]),
  original_records_preservation_required:true,
  original_records_integrity_verified:false,
  history_append_only_compensation_required:true,
  cross_module_case_accepted:false,
  finance_acceptance_verified:false,academic_acceptance_verified:false,
  compensation_write_allowed:false,original_records_mutable:false,
  hold_active:true,release_eligible:false,finance_authorized:false,
  execution_allowed:false,activity_publish_allowed:false
 });
}
export const compensationPreflightCanExecute=false;
export function classifyProposedCrossModuleCompensation(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||
    Object.getPrototypeOf(input)!==Object.prototype||
    Object.keys(input).some(k=>!keys.includes(k))||
    !own(input,'kind')||!allowed.has(input.kind))
   return deny('blocked_unknown_or_untrusted_scenario');
 const ids=['student_id','order_id','payment_id','lesson_id','source_event_id'];
 for(const k of ids){
   if(own(input,k)&&(typeof input[k]!=='string'||input[k].length<1||
      input[k].length>128))
    return deny('blocked_invalid_business_reference');
 }
 const k=input.kind;
 if(k==='campaign_snapshot_conflict')
   return deny('blocked_immutable_campaign_snapshot_dispute','snapshot_integrity_conflict',['sales','finance','academic']);
 if(k==='sales_evidence_missing')
   return deny('blocked_sales_packet_incomplete','sales_evidence_gap',['sales','finance','academic']);
 if(k==='external_authority_unknown')
   return deny('blocked_external_trust_and_status_unknown','external_authority_or_reconciliation_unknown',['sales','finance','academic']);
 if(k==='wrong_student_link_with_order'){
   if(!input.student_id||!input.order_id)
     return deny('blocked_missing_student_order_provenance');
   return deny('blocked_student_order_identity_reconciliation','student_order_mislink_candidate',['sales','finance','academic']);
 }
 if(k==='payment_or_refund_misattribution'){
   if(!input.student_id||!input.payment_id||!input.source_event_id)
     return deny('blocked_missing_payment_event_provenance');
   return deny('blocked_finance_original_transaction_reconciliation','payment_refund_misattribution_candidate',['sales','finance','academic']);
 }
 if(k==='fulfilled_lesson_wrong_student'){
   if(!input.student_id||!input.lesson_id||!input.source_event_id)
     return deny('blocked_missing_lesson_event_provenance');
   return deny('blocked_academic_original_lesson_reconciliation','lesson_fulfillment_mislink_candidate',['sales','finance','academic']);
 }
 return deny('blocked_unresolved_cross_module_failure');
}
