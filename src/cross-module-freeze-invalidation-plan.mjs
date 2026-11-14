// V3.2-90: CI-only classification and recheck plan for invalidated freezes.
// Read-only, non-atomic, never a release / handoff / compensation permission.
import {createHash} from 'node:crypto';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const HASH=/^[a-f0-9]{64}$/;
const GAPS=['finance_independent_signature','academic_independent_signature',
 'order_payment_reconciliation','lesson_entitlement_reconciliation',
 'three_party_acceptance','atomic_handoff_receipt'];
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
const exact=(x,keys)=>plain(x)&&Object.keys(x).length===keys.length&&
 keys.every(k=>Object.hasOwn(x,k));
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const deny=(reason_code,more={})=>Object.freeze({
 reason_code,fixture_recheck_plan_available:false,
 freeze_is_current:false,automatic_regeneration_allowed:false,
 external_authority_verified:false,finance_authorized:false,academic_authorized:false,
 handoff_allowed:false,compensation_write_allowed:false,release_eligible:false,
 hold_active:true,production_integration_allowed:false,...more
});
const steps=Object.freeze([
 'verify_updated_source_and_revocation_watermarks',
 'rebuild_evidence_diff_and_all_item_reviews',
 'rerun_three_domain_and_independent_reconfirmation',
 'revalidate_six_external_authority_gaps',
 'request_new_isolated_freeze_with_new_idempotency_key'
]);
function validWatermark(x,org,incident){
 return exact(x,['organization_id','incident_id','source_epoch','source_revision',
  'revocation_sequence','revocation_digest','incident_generation'])&&
 UUID.test(x.organization_id)&&UUID.test(x.incident_id)&&
 x.organization_id.toLowerCase()===org&&x.incident_id.toLowerCase()===incident&&
 ['source_epoch','source_revision','incident_generation'].every(k=>
  Number.isSafeInteger(x[k])&&x[k]>0)&&
 Number.isSafeInteger(x.revocation_sequence)&&x.revocation_sequence>=0&&
 HASH.test(x.revocation_digest);
}
function validReport(r){
 if(!plain(r)||r.reason_code!=='BLOCKED_EXTERNAL_HANDOFF_AND_TASK_REVIEW_REQUIREMENTS'||
  r.fixture_unified_report_consistent!==true||r.hold_active!==true||
  r.handoff_allowed!==false||r.compensation_write_allowed!==false||
  r.release_eligible!==false||r.finance_authorized!==false||
  r.academic_authorized!==false||r.external_authority_verified!==false||
  !HASH.test(r.comparison_digest)||!Number.isSafeInteger(r.total_tasks)||
  r.total_tasks<1||!Number.isSafeInteger(r.remaining_count)||
  r.remaining_count<0||r.remaining_count>r.total_tasks||
  !Array.isArray(r.pending_tasks)||r.pending_tasks.length!==r.remaining_count||
  !Array.isArray(r.external_requirements)||r.external_requirements.length!==6||
  r.all_internal_tasks_reviewed!==(r.remaining_count===0))return false;
 const seen=new Set(),codes=new Set();
 for(const p of r.pending_tasks){
  if(!plain(p)||typeof p.item!=='string'||!p.item||
   seen.has(p.item)||!['sales','finance','academic'].includes(p.owner_department)||
   !['pending','in_review','reviewer_revoked_recheck_required'].includes(p.status)||
   !HASH.test(p.difference_digest))return false;
  seen.add(p.item);
 }
 for(const x of r.external_requirements){
  if(!plain(x)||!GAPS.includes(x.code)||codes.has(x.code)||
   x.status!=='requires_external_authority')return false;
  codes.add(x.code);
 }
 return true;
}
function validFrozenReport(r){
 return plain(r)&&HASH.test(r.comparison_digest)&&
  Number.isSafeInteger(r.total_tasks)&&r.total_tasks>0&&
  Number.isSafeInteger(r.remaining_count)&&r.remaining_count>=0&&
  r.remaining_count<=r.total_tasks&&
  Array.isArray(r.pending_tasks)&&r.pending_tasks.length===r.remaining_count&&
  r.pending_tasks.every(x=>plain(x)&&typeof x.item==='string'&&
   ['sales','finance','academic'].includes(x.owner_department)&&
   ['pending','in_review','reviewer_revoked_recheck_required'].includes(x.status)&&
   HASH.test(x.difference_digest))&&
  Array.isArray(r.external_requirements)&&r.external_requirements.length===6&&
  new Set(r.external_requirements).size===6&&
  GAPS.every(code=>r.external_requirements.includes(code));
}
function canonical(r){
 return {comparison_digest:r.comparison_digest,total_tasks:r.total_tasks,
  remaining_count:r.remaining_count,
  pending_tasks:r.pending_tasks.map(x=>({item:x.item,status:x.status,
   owner_department:x.owner_department,difference_digest:x.difference_digest}))
   .sort((a,b)=>a.item.localeCompare(b.item,'en'))};
}
function classify(old,now,oldReport,nowReport){
 const changes=[];
 const add=(category,owner,field)=>changes.push(Object.freeze({category,
  owner_department:owner,field,recheck_required:true}));
 if(old.source_epoch!==now.source_epoch||old.source_revision!==now.source_revision)
  add('source_revision_changed','sales','source_epoch_or_revision');
 if(old.revocation_sequence!==now.revocation_sequence||
  old.revocation_digest!==now.revocation_digest)
  add('revocation_changed','sales','revocation_watermark');
 if(old.incident_generation!==now.incident_generation)
  add('incident_changed','sales','incident_generation');
 if(sha(canonical(oldReport))!==sha(canonical(nowReport))){
  const oldItems=new Map(oldReport.pending_tasks.map(x=>[x.item,x]));
  const newItems=new Map(nowReport.pending_tasks.map(x=>[x.item,x]));
  for(const item of [...new Set([...oldItems.keys(),...newItems.keys()])].sort()){
   const a=oldItems.get(item),b=newItems.get(item);
   if(sha(a||null)!==sha(b||null))
    add('review_task_changed',b?.owner_department||a?.owner_department||'sales',item);
  }
  if(oldReport.comparison_digest!==nowReport.comparison_digest||
   oldReport.total_tasks!==nowReport.total_tasks||
   (oldReport.remaining_count!==nowReport.remaining_count&&
    !changes.some(x=>x.category==='review_task_changed')))
    add('review_comparison_changed','sales','comparison_digest_or_count');
 }
 return changes;
}
export function createIsolatedFreezeInvalidationPlan({freezeRegistry,unifiedReport,getFixtureWatermark}={}){
 if(!freezeRegistry||typeof freezeRegistry.audit!=='function'||
  typeof freezeRegistry.verify!=='function'||!unifiedReport||
  typeof unifiedReport.report!=='function'||typeof getFixtureWatermark!=='function')
  throw TypeError('Independent CI-only freeze, report and watermark adapters required');
 async function plan(input={}){
  if(!exact(input,['organization_id','incident_id','final_reference',
   'diff_reference','freeze_digest'])||
   !UUID.test(input.organization_id)||!UUID.test(input.incident_id)||
   !HASH.test(input.freeze_digest)||
   !exact(input.final_reference,['source_digest','revocation_reference'])||
   !HASH.test(input.final_reference.source_digest)||
   !exact(input.diff_reference,['organization_id','incident_id',
    'previous_audit_sequence','previous_audit_digest',
    'new_audit_sequence','new_audit_digest'])||
   !UUID.test(input.diff_reference.organization_id)||
   !UUID.test(input.diff_reference.incident_id)||
   input.diff_reference.organization_id.toLowerCase()!==input.organization_id.toLowerCase()||
   input.diff_reference.incident_id.toLowerCase()!==input.incident_id.toLowerCase()||
   !HASH.test(input.diff_reference.previous_audit_digest)||
   !HASH.test(input.diff_reference.new_audit_digest)||
   !Number.isSafeInteger(input.diff_reference.previous_audit_sequence)||
   input.diff_reference.previous_audit_sequence<1||
   !Number.isSafeInteger(input.diff_reference.new_audit_sequence)||
   input.diff_reference.new_audit_sequence<=input.diff_reference.previous_audit_sequence)
   return deny('INVALID_INVALIDATION_PLAN_INPUT');
  const org=input.organization_id.toLowerCase(),incident=input.incident_id.toLowerCase();
  const scope={organization_id:org,incident_id:incident};
  let list,verification,current,report,watermark2;
  try{
   list=freezeRegistry.audit(scope);
   if(!Array.isArray(list))return deny('FREEZE_AUDIT_UNAVAILABLE');
   verification=await freezeRegistry.verify({...input,organization_id:org,incident_id:incident});
   if(!plain(verification)||verification.hold_active!==true||
    verification.handoff_allowed!==false)return deny('FREEZE_VERIFICATION_PROTOCOL_VIOLATION');
   const found=list.find(x=>x?.freeze_digest===input.freeze_digest);
   if(!found||!found.fixture_only||found.organization_id!==org||
    found.incident_id!==incident||!plain(found.observation)||
    !plain(found.observation.watermark)||!plain(found.observation.report)||
    !validWatermark({...found.observation.watermark,...scope},org,incident)||
    !validFrozenReport(found.observation.report))
    return deny('FROZEN_SNAPSHOT_INVALID');
   if(verification.reason_code==='BLOCKED_CURRENT_FIXTURE_FREEZE_NO_EXTERNAL_AUTHORITY'&&
    verification.fixture_freeze_current===true)
    return deny('BLOCKED_FREEZE_STILL_CURRENT_NO_EXTERNAL_AUTHORITY');
   if(!['FROZEN_REPORT_INVALIDATED_BY_NEW_EVIDENCE',
    'SUPERSEDED_FREEZE_NOT_CURRENT'].includes(verification.reason_code))
    return deny('FREEZE_NOT_TRUSTWORTHY_FOR_RECHECK');
   current=await getFixtureWatermark(org,incident);
   if(!validWatermark(current,org,incident))
    return deny('CURRENT_SOURCE_WATERMARK_INVALID');
   report=await unifiedReport.report({...scope,final_reference:input.final_reference,
    diff_reference:input.diff_reference,afterFirstRead:async()=>{}});
   if(!validReport(report))return deny('CURRENT_UNIFIED_REPORT_UNAVAILABLE');
   watermark2=await getFixtureWatermark(org,incident);
   if(!validWatermark(watermark2,org,incident)||
    sha(current)!==sha(watermark2))return deny('SOURCE_CHANGED_DURING_RECHECK_PLAN');
  }catch{return deny('INVALIDATION_PLAN_DEPENDENCY_UNAVAILABLE');}
  const old=found.observation.watermark;
  const changes=classify(old,current,found.observation.report,report);
  if(found.observation.reference_digest!==sha({
   final_reference:input.final_reference,diff_reference:input.diff_reference}))
   return deny('FROZEN_REFERENCE_CHANGED_RESTART_REQUIRED');
  if(changes.length===0)
   return deny('SUPERSEDED_OR_UNKNOWN_FREEZE_RESTART_REQUIRED');
  const owners=Object.freeze([...new Set(changes.map(c=>c.owner_department))].sort());
  return Object.freeze({...deny('BLOCKED_FRESH_EVIDENCE_AND_REVIEW_REQUIRED'),
   fixture_recheck_plan_available:true,
   invalidation_categories:Object.freeze(changes),
   responsible_departments:owners,required_steps:steps,
   old_freeze_digest:input.freeze_digest,
   current_watermark_digest:sha(current),
   current_comparison_digest:report.comparison_digest,
   six_external_authority_gaps_unresolved:true});
 }
 return Object.freeze({plan});
}
