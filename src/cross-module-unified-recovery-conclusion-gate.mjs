// V3.2-96: CI-only read-only recovery conclusion + unified handoff report.
// This module never grants a financial, academic, compensation, release or handoff right.
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const CODES=Object.freeze(['finance_independent_signature','academic_independent_signature',
 'order_payment_reconciliation','lesson_entitlement_reconciliation',
 'three_party_acceptance','atomic_handoff_receipt']);
const STATES=new Set(['pending','in_review','reviewer_revoked_recheck_required']);
const RECOVERY_STATUSES=new Set(['fixture_current_not_authorized','expired',
 'source_changed','reviewer_revoked_or_inactive','explicitly_revoked',
 'awaiting_independent_reacceptance','not_recorded']);
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
const exact=(x,keys)=>plain(x)&&Object.keys(x).length===keys.length&&
 keys.every(k=>Object.hasOwn(x,k));
const denied=(reason_code,details={})=>Object.freeze({
 reason_code,fixture_combined_consistency:false,fixture_recovery_current:false,
 external_authority_verified:false,finance_authorized:false,
 academic_authorized:false,handoff_allowed:false,compensation_write_allowed:false,
 release_eligible:false,hold_active:true,production_integration_allowed:false,
 ...details
});
function validPending(r){
 if(!plain(r)||r.reason_code!=='BLOCKED_EXTERNAL_HANDOFF_AND_TASK_REVIEW_REQUIREMENTS'||
  r.fixture_unified_report_consistent!==true||r.hold_active!==true||
  r.handoff_allowed!==false||r.compensation_write_allowed!==false||
  r.release_eligible!==false||r.finance_authorized!==false||
  r.academic_authorized!==false||r.external_authority_verified!==false||
  !SHA.test(r.comparison_digest)||!Number.isSafeInteger(r.total_tasks)||
  r.total_tasks<1||!Number.isSafeInteger(r.remaining_count)||
  r.remaining_count<0||r.remaining_count>r.total_tasks||
  !Array.isArray(r.pending_tasks)||r.pending_tasks.length!==r.remaining_count||
  r.all_internal_tasks_reviewed!==(r.remaining_count===0)||
  !Array.isArray(r.external_requirements)||r.external_requirements.length!==6)
  return null;
 const gaps=new Set(),items=new Set();
 for(const e of r.external_requirements){
  if(!plain(e)||!CODES.includes(e.code)||gaps.has(e.code)||
   e.status!=='requires_external_authority')return null;
  gaps.add(e.code);
 }
 const pending=[];
 for(const e of r.pending_tasks){
  if(!plain(e)||typeof e.item!=='string'||items.has(e.item)||
   !['sales','finance','academic'].includes(e.owner_department)||
   !STATES.has(e.status)||!SHA.test(e.difference_digest))return null;
  items.add(e.item);
  pending.push({item:e.item,owner_department:e.owner_department,
   status:e.status,difference_digest:e.difference_digest});
 }
 pending.sort((a,b)=>a.item.localeCompare(b.item,'en'));
 return {comparison_digest:r.comparison_digest,total_tasks:r.total_tasks,
  remaining_count:r.remaining_count,pending,
  external_requirements:[...gaps].sort()};
}
function validConclusion(r){
 if(!plain(r)||r.reason_code!=='BLOCKED_CONCLUSION_NOT_BUSINESS_AUTHORIZATION'||
  r.hold_active!==true||r.handoff_allowed!==false||
  r.compensation_write_allowed!==false||r.release_eligible!==false||
  r.finance_authorized!==false||r.academic_authorized!==false||
  r.history_repair_allowed!==false||r.automatic_recovery_allowed!==false||
  r.external_authority_verified!==false||!RECOVERY_STATUSES.has(r.status)||
  r.fixture_conclusion_current!==(r.status==='fixture_current_not_authorized')||
  !Number.isSafeInteger(r.history_count)||r.history_count<0||
  !SHA.test(r.current_source_fingerprint)||!Array.isArray(r.events)||
  r.events.length!==r.history_count)return null;
 if(r.fixture_conclusion_current){
  if(!Number.isSafeInteger(r.expires_at_ms)||r.expires_at_ms<=0||
   r.events.length<5)return null;
  const latest=r.events.at(-1);
  if(!plain(latest)||latest.action!=='conclude'||
   latest.expires_at_ms!==r.expires_at_ms||
   latest.source_fingerprint!==r.current_source_fingerprint||
   latest.hold_active!==true||latest.handoff_allowed!==false)return null;
 }
 return {status:r.status,current:r.fixture_conclusion_current,
  fingerprint:r.current_source_fingerprint,
  expires_at_ms:r.expires_at_ms??null,
  history_count:r.history_count,
  latest_event_digest:r.events.at(-1)?.event_digest??null};
}
function validInput(input){
 if(!exact(input,['organization_id','incident_id','final_reference',
  'diff_reference','afterFirstRead'])||
  !UUID.test(input.organization_id)||!UUID.test(input.incident_id)||
  typeof input.afterFirstRead!=='function'||
  !exact(input.final_reference,['source_digest','revocation_reference'])||
  !SHA.test(input.final_reference.source_digest)||
  !exact(input.diff_reference,['organization_id','incident_id',
   'previous_audit_sequence','previous_audit_digest',
   'new_audit_sequence','new_audit_digest'])||
  !UUID.test(input.diff_reference.organization_id)||
  !UUID.test(input.diff_reference.incident_id)||
  input.organization_id.toLowerCase()!==input.diff_reference.organization_id.toLowerCase()||
  input.incident_id.toLowerCase()!==input.diff_reference.incident_id.toLowerCase()||
  !Number.isSafeInteger(input.diff_reference.previous_audit_sequence)||
  input.diff_reference.previous_audit_sequence<1||
  !Number.isSafeInteger(input.diff_reference.new_audit_sequence)||
  input.diff_reference.new_audit_sequence<=input.diff_reference.previous_audit_sequence||
  !SHA.test(input.diff_reference.previous_audit_digest)||
  !SHA.test(input.diff_reference.new_audit_digest))return false;
 return true;
}
export function createIsolatedUnifiedRecoveryConclusionGate({unifiedPendingReport,
 recoveryConclusion}={}){
 if(!unifiedPendingReport||typeof unifiedPendingReport.report!=='function'||
  !recoveryConclusion||typeof recoveryConclusion.report!=='function')
  throw new TypeError('Independent CI-only pending and recovery reporters required');
 async function report(input={}){
  if(!validInput(input))return denied('INVALID_UNIFIED_RECOVERY_INPUT');
  const scope={organization_id:input.organization_id.toLowerCase(),
   incident_id:input.incident_id.toLowerCase()};
  const diff_reference={...input.diff_reference,...scope};
  async function read(){
   // Both are independently computed and continue to deny actual business release.
   const pending=validPending(await unifiedPendingReport.report({...scope,
    final_reference:input.final_reference,diff_reference,afterFirstRead:async()=>{}}));
   if(!pending)return {error:'UNIFIED_PENDING_REPORT_UNVERIFIED'};
   const conclusion=validConclusion(await recoveryConclusion.report(scope));
   if(!conclusion)return {error:'RECOVERY_CONCLUSION_UNVERIFIED'};
   return {pending,conclusion,signature:JSON.stringify({pending,conclusion})};
  }
  try{
   const first=await read();if(first.error)return denied(first.error);
   await input.afterFirstRead();
   const second=await read();if(second.error)return denied(second.error);
   if(first.signature!==second.signature)
    return denied('RECOVERY_OR_TASK_STATE_CHANGED_DURING_CHECK');
   const third=await read();if(third.error)return denied(third.error);
   if(second.signature!==third.signature)
    return denied('RECOVERY_OR_TASK_STATE_CHANGED_AT_FINAL_READ');
   const c=third.conclusion,p=third.pending;
   if(!c.current){
    return denied('RECOVERY_CONCLUSION_REACCEPTANCE_REQUIRED',{
     recovery_status:c.status,remaining_count:p.remaining_count,
     pending_tasks:Object.freeze(p.pending.map(x=>Object.freeze(x))),
     external_requirements:Object.freeze(CODES.map(code=>
      Object.freeze({code,status:'requires_external_authority'})))});
   }
   return denied('BLOCKED_EXTERNAL_HANDOFF_WITH_CURRENT_FIXTURE_RECOVERY',{
    fixture_combined_consistency:true,fixture_recovery_current:true,
    recovery_status:c.status,recovery_expires_at_ms:c.expires_at_ms,
    comparison_digest:p.comparison_digest,remaining_count:p.remaining_count,
    pending_tasks:Object.freeze(p.pending.map(x=>Object.freeze(x))),
    external_requirements:Object.freeze(CODES.map(code=>
     Object.freeze({code,status:'requires_external_authority'})))});
  }catch{return denied('UNIFIED_RECOVERY_DEPENDENCY_UNAVAILABLE');}
 }
 return Object.freeze({report});
}
