// V3.2-88: isolated read-only report combining unified gate and re-review tasks.
// All task states are administrative. Never grant real handoff or hold release.
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const GAP_CODES=Object.freeze(['finance_independent_signature','academic_independent_signature',
 'order_payment_reconciliation','lesson_entitlement_reconciliation',
 'three_party_acceptance','atomic_handoff_receipt']);
const STATES=new Set(['pending','in_review','closed_administratively',
 'reviewer_revoked_recheck_required']);
const exact=(x,fields)=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null)&&
 Object.keys(x).length===fields.length&&fields.every(k=>Object.hasOwn(x,k));
const deny=(reason_code,details={})=>Object.freeze({
 reason_code,fixture_unified_report_consistent:false,
 external_authority_verified:false,finance_authorized:false,academic_authorized:false,
 handoff_allowed:false,compensation_write_allowed:false,release_eligible:false,
 hold_active:true,production_integration_allowed:false,...details});
function validateTasks(tasks,diff){
 if(!tasks||tasks.reason_code!=='BLOCKED_EXTERNAL_HANDOFF_EVEN_IF_TASKS_COMPLETE'||
  tasks.hold_active!==true||tasks.handoff_allowed!==false||
  tasks.compensation_write_allowed!==false||tasks.release_eligible!==false||
  tasks.finance_authorized!==false||tasks.academic_authorized!==false||
  !Array.isArray(tasks.tasks)||!Array.isArray(diff.differences)||
  tasks.tasks.length!==diff.differences.length||tasks.tasks.length===0||
  tasks.total_tasks!==tasks.tasks.length||
  !Number.isSafeInteger(tasks.remaining_count)||tasks.remaining_count<0||
  tasks.remaining_count>tasks.tasks.length)return null;
 const comparison=new Map();
 for(const x of diff.differences){
  if(!x||typeof x.item!=='string'||!['sales','finance','academic'].includes(x.owner_department)||
   x.rereview_required!==true||comparison.has(x.item))return null;
  comparison.set(x.item,x.owner_department);
 }
 const seen=new Set(),missing=[];
 for(const x of tasks.tasks){
  if(!x||typeof x.item!=='string'||seen.has(x.item)||
   !comparison.has(x.item)||comparison.get(x.item)!==x.owner_department||
   !SHA.test(x.difference_digest)||!STATES.has(x.status))return null;
  seen.add(x.item);
  if(x.status!=='closed_administratively')
   missing.push(Object.freeze({item:x.item,owner_department:x.owner_department,
    status:x.status,difference_digest:x.difference_digest}));
 }
 if(missing.length!==tasks.remaining_count||
  tasks.fixture_all_tasks_reviewed!==(missing.length===0)||
  typeof tasks.comparison_digest!=='string'||!SHA.test(tasks.comparison_digest))
  return null;
 return {missing,task_count:tasks.tasks.length,
  comparison_digest:tasks.comparison_digest};
}
function validateDiff(diff){
 if(!diff||diff.reason_code!=='BLOCKED_REVIEW_CHANGED_EVIDENCE_AND_EXTERNAL_GAPS'||
  diff.fixture_comparison_complete!==true||diff.hold_active!==true||
  diff.handoff_allowed!==false||diff.release_eligible!==false||
  diff.finance_authorized!==false||diff.academic_authorized!==false||
  !Array.isArray(diff.external_requirements)||diff.external_requirements.length!==6)
  return false;
 const seen=new Set();
 for(const x of diff.external_requirements){
  if(!x||!GAP_CODES.includes(x.code)||seen.has(x.code)||
   x.status!=='requires_external_authority')return false;
  seen.add(x.code);
 }
 return true;
}
function validateGate(gate){
 return gate&&gate.reason_code==='BLOCKED_REAL_THREE_PARTY_ATOMIC_HANDOFF_MISSING'&&
 gate.fixture_unified_consistency===true&&gate.hold_active===true&&
 gate.handoff_allowed===false&&gate.compensation_write_allowed===false&&
 gate.release_eligible===false&&gate.finance_authorized===false&&
 gate.academic_authorized===false&&gate.external_authority_verified===false;
}
/**
 * Independent CI fixture adapters. Multiple reads are non-atomic;
 * a stable report is never a trusted production release authorization.
 */
export function createIsolatedUnifiedPendingReviewReport({unifiedGate,tasks,evidenceDiff}={}){
 if(!unifiedGate||typeof unifiedGate.check!=='function'||
  !tasks||typeof tasks.report!=='function'||
  !evidenceDiff||typeof evidenceDiff.report!=='function')
  throw TypeError('Independent fixture gates, tasks and diff required');
 async function report(input={}){
  if(!exact(input,['organization_id','incident_id','final_reference','diff_reference',
   'afterFirstRead'])||!UUID.test(input.organization_id)||
   !UUID.test(input.incident_id)||typeof input.afterFirstRead!=='function'||
   !exact(input.final_reference,['source_digest','revocation_reference'])||
   !SHA.test(input.final_reference.source_digest)||
   !exact(input.diff_reference,['organization_id','incident_id',
    'previous_audit_sequence','previous_audit_digest',
    'new_audit_sequence','new_audit_digest'])||
   !UUID.test(input.diff_reference.organization_id)||
   !UUID.test(input.diff_reference.incident_id)||
   input.diff_reference.organization_id.toLowerCase()!==input.organization_id.toLowerCase()||
   input.diff_reference.incident_id.toLowerCase()!==input.incident_id.toLowerCase()||
   !Number.isSafeInteger(input.diff_reference.previous_audit_sequence)||
   input.diff_reference.previous_audit_sequence<1||
   !Number.isSafeInteger(input.diff_reference.new_audit_sequence)||
   input.diff_reference.new_audit_sequence<=input.diff_reference.previous_audit_sequence||
   !SHA.test(input.diff_reference.previous_audit_digest)||
   !SHA.test(input.diff_reference.new_audit_digest))
   return deny('INVALID_UNIFIED_PENDING_REPORT_INPUT');
  const scope={organization_id:input.organization_id.toLowerCase(),
   incident_id:input.incident_id.toLowerCase()};
  const ref={...input.diff_reference,organization_id:scope.organization_id,
   incident_id:scope.incident_id};
  async function read(){
   const g=await unifiedGate.check({...scope,final_reference:input.final_reference,
    afterFirstRead:async()=>{}});
   if(!validateGate(g))return {error:'UNIFIED_GATE_UNVERIFIED'};
   const d=await evidenceDiff.report(ref);
   if(!validateDiff(d))return {error:'DIFF_OR_EXTERNAL_GAPS_UNVERIFIED'};
   const t=await tasks.report(ref);
   const result=validateTasks(t,d);
   if(!result)return {error:'TASK_TOTAL_OR_OWNERSHIP_MISMATCH'};
   // Snapshot uses only task identity, status, and versioned comparison digest.
   const signature=JSON.stringify({comparison_digest:result.comparison_digest,
    tasks:t.tasks.map(x=>[x.item,x.owner_department,x.difference_digest,x.status]).sort(),
    requirements:d.external_requirements.map(x=>x.code).sort()});
   return {signature,result};
  }
  try{
   const first=await read();if(first.error)return deny(first.error);
   await input.afterFirstRead();
   const second=await read();if(second.error)return deny(second.error);
   if(first.signature!==second.signature)return deny('TASK_OR_EVIDENCE_CHANGED_DURING_REPORT');
   const third=await read();if(third.error)return deny(third.error);
   if(second.signature!==third.signature)return deny('TASK_CHANGED_AT_FINAL_READ');
   const count=third.result.missing.length;
   return Object.freeze({...deny('BLOCKED_EXTERNAL_HANDOFF_AND_TASK_REVIEW_REQUIREMENTS'),
    fixture_unified_report_consistent:true,
    total_tasks:third.result.task_count,remaining_count:count,
    comparison_digest:third.result.comparison_digest,
    pending_tasks:Object.freeze(third.result.missing),
    external_requirements:Object.freeze(GAP_CODES.map(code=>
     Object.freeze({code,status:'requires_external_authority'}))),
    all_internal_tasks_reviewed:count===0});
  }catch{return deny('UNIFIED_PENDING_REPORT_DEPENDENCY_UNAVAILABLE');}
 }
 return Object.freeze({report});
}
