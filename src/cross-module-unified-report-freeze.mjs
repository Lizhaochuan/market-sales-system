// V3.2-89: in-memory CI fixture report freeze and invalidation.
// A matching freeze is historical evidence only; NEVER business authorization.
import {createHash} from 'node:crypto';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const HASH=/^[a-f0-9]{64}$/;
const NONCE=/^[a-z0-9][a-z0-9._:-]{15,127}$/;
const GAPS=['finance_independent_signature','academic_independent_signature',
 'order_payment_reconciliation','lesson_entitlement_reconciliation',
 'three_party_acceptance','atomic_handoff_receipt'];
const own=(x,k)=>Object.hasOwn(x,k);
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
const exact=(x,keys)=>plain(x)&&Object.keys(x).length===keys.length&&keys.every(k=>own(x,k));
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const deny=(reason_code,other={})=>Object.freeze({reason_code,
 fixture_freeze_current:false,external_authority_verified:false,
 finance_authorized:false,academic_authorized:false,handoff_allowed:false,
 compensation_write_allowed:false,release_eligible:false,hold_active:true,...other});
function validScope(x){
 return exact(x,['organization_id','incident_id','final_reference','diff_reference'])&&
 UUID.test(x.organization_id)&&UUID.test(x.incident_id)&&
 exact(x.final_reference,['source_digest','revocation_reference'])&&
 HASH.test(x.final_reference.source_digest)&&
 exact(x.diff_reference,['organization_id','incident_id','previous_audit_sequence',
 'previous_audit_digest','new_audit_sequence','new_audit_digest'])&&
 UUID.test(x.diff_reference.organization_id)&&UUID.test(x.diff_reference.incident_id)&&
 x.diff_reference.organization_id.toLowerCase()===x.organization_id.toLowerCase()&&
 x.diff_reference.incident_id.toLowerCase()===x.incident_id.toLowerCase()&&
 Number.isSafeInteger(x.diff_reference.previous_audit_sequence)&&
 x.diff_reference.previous_audit_sequence>0&&
 Number.isSafeInteger(x.diff_reference.new_audit_sequence)&&
 x.diff_reference.new_audit_sequence>x.diff_reference.previous_audit_sequence&&
 HASH.test(x.diff_reference.previous_audit_digest)&&
 HASH.test(x.diff_reference.new_audit_digest);
}
function stableReport(x){
 if(!plain(x)||x.reason_code!=='BLOCKED_EXTERNAL_HANDOFF_AND_TASK_REVIEW_REQUIREMENTS'||
  x.fixture_unified_report_consistent!==true||x.hold_active!==true||
  x.handoff_allowed!==false||x.release_eligible!==false||
  x.compensation_write_allowed!==false||x.finance_authorized!==false||
  x.academic_authorized!==false||x.external_authority_verified!==false||
  !Number.isSafeInteger(x.total_tasks)||x.total_tasks<1||
  !Number.isSafeInteger(x.remaining_count)||x.remaining_count<0||
  x.remaining_count>x.total_tasks||!HASH.test(x.comparison_digest)||
  !Array.isArray(x.pending_tasks)||x.pending_tasks.length!==x.remaining_count||
  x.all_internal_tasks_reviewed!==(x.remaining_count===0)||
  !Array.isArray(x.external_requirements)||x.external_requirements.length!==6)
  return null;
 const seen=new Set(),gaps=new Set();
 const pending=[];
 for(const item of x.pending_tasks){
  if(!plain(item)||typeof item.item!=='string'||item.item.length===0||
   seen.has(item.item)||!['sales','finance','academic'].includes(item.owner_department)||
   !['pending','in_review','reviewer_revoked_recheck_required'].includes(item.status)||
   !HASH.test(item.difference_digest))return null;
  seen.add(item.item);
  pending.push({item:item.item,owner_department:item.owner_department,
   status:item.status,difference_digest:item.difference_digest});
 }
 for(const item of x.external_requirements){
  if(!plain(item)||!GAPS.includes(item.code)||gaps.has(item.code)||
   item.status!=='requires_external_authority')return null;
  gaps.add(item.code);
 }
 pending.sort((a,b)=>a.item.localeCompare(b.item,'en'));
 return {comparison_digest:x.comparison_digest,total_tasks:x.total_tasks,
  remaining_count:x.remaining_count,pending_tasks:pending,
  external_requirements:[...gaps].sort()};
}
function stableSource(x,org,incident){
 if(!exact(x,['organization_id','incident_id','source_epoch','source_revision',
   'revocation_sequence','revocation_digest','incident_generation'])||
  typeof x.organization_id!=='string'||typeof x.incident_id!=='string'||
  x.organization_id.toLowerCase()!==org||x.incident_id.toLowerCase()!==incident||
  !Number.isSafeInteger(x.source_epoch)||x.source_epoch<1||
  !Number.isSafeInteger(x.source_revision)||x.source_revision<1||
  !Number.isSafeInteger(x.revocation_sequence)||x.revocation_sequence<0||
  !HASH.test(x.revocation_digest)||
  !Number.isSafeInteger(x.incident_generation)||x.incident_generation<1)return null;
 return {source_epoch:x.source_epoch,source_revision:x.source_revision,
  revocation_sequence:x.revocation_sequence,revocation_digest:x.revocation_digest,
  incident_generation:x.incident_generation};
}
/**
 * A trusted CI harness supplies the original report and an independent source
 * watermark. Re-read on every validation; no old result grants permission.
 */
export function createIsolatedUnifiedReportFreeze({unifiedReport,getFixtureWatermark}={}){
 if(!unifiedReport||typeof unifiedReport.report!=='function'||
  typeof getFixtureWatermark!=='function')
  throw TypeError('Independent CI-only reporter and watermark provider required');
 const entries=new Map(),nonces=new Map(),queues=new Map();
 const key=x=>x.organization_id.toLowerCase()+'\\0'+x.incident_id.toLowerCase();
 async function observe(input){
  const org=input.organization_id.toLowerCase(),incident=input.incident_id.toLowerCase();
  async function water(){
   return stableSource(await getFixtureWatermark(org,incident),org,incident);
  }
  const before=await water();
  if(!before)return {error:'SOURCE_WATERMARK_UNAVAILABLE'};
  const report=stableReport(await unifiedReport.report({...input,afterFirstRead:async()=>{}}));
  if(!report)return {error:'UNIFIED_REPORT_NOT_STABLE'};
  const after=await water();
  if(!after)return {error:'SOURCE_WATERMARK_UNAVAILABLE'};
  if(sha(before)!==sha(after))return {error:'SOURCE_CHANGED_DURING_OBSERVATION'};
  return {value:{watermark:after,report,reference_digest:sha({
   final_reference:input.final_reference,diff_reference:input.diff_reference})}};
 }
 async function freeze(input={}){
  if(!exact(input,['organization_id','incident_id','final_reference','diff_reference','idempotency_key'])||
   !NONCE.test(input.idempotency_key)||!validScope({
    organization_id:input.organization_id,incident_id:input.incident_id,
    final_reference:input.final_reference,diff_reference:input.diff_reference}))
   return deny('INVALID_FREEZE_REQUEST');
  const scope=key(input),nonceKey=scope+'\\0'+input.idempotency_key;
  const prior=queues.get(scope)||Promise.resolve();
  const running=prior.catch(()=>{}).then(async()=>{
   const old=nonces.get(nonceKey);
   if(old)return deny('BLOCKED_HISTORICAL_FREEZE_REPLAY',{freeze:old});
   let a,b;
   try{a=await observe(input);if(a.error)return deny(a.error);
    b=await observe(input);if(b.error)return deny(b.error);}
   catch{return deny('FREEZE_DEPENDENCY_UNAVAILABLE');}
   if(sha(a.value)!==sha(b.value))return deny('FREEZE_CHANGED_BETWEEN_READS');
   const rows=entries.get(scope)||[];
   const payload={schema_version:'v3.2-89-ci-freeze-v1',
    organization_id:input.organization_id.toLowerCase(),
    incident_id:input.incident_id.toLowerCase(),sequence:rows.length+1,
    previous_digest:rows.at(-1)?.freeze_digest||'0'.repeat(64),
    idempotency_key:input.idempotency_key,observation:a.value,
    fixture_only:true,hold_active:true,handoff_allowed:false};
   const freeze=Object.freeze({...payload,observation:Object.freeze({
    ...a.value,watermark:Object.freeze(a.value.watermark),
    report:Object.freeze({...a.value.report,
     pending_tasks:Object.freeze(a.value.report.pending_tasks.map(t=>Object.freeze(t))),
     external_requirements:Object.freeze(a.value.report.external_requirements)})}),
    freeze_digest:sha(payload)});
   entries.set(scope,[...rows,freeze]);nonces.set(nonceKey,freeze);
   return deny('BLOCKED_FROZEN_REPORT_NO_EXTERNAL_AUTHORITY',{freeze});
  });
  queues.set(scope,running);
  try{return await running;}finally{if(queues.get(scope)===running)queues.delete(scope);}
 }
 async function verify(input={}){
  if(!exact(input,['organization_id','incident_id','final_reference','diff_reference','freeze_digest'])||
   !HASH.test(input.freeze_digest)||!validScope({
    organization_id:input.organization_id,incident_id:input.incident_id,
    final_reference:input.final_reference,diff_reference:input.diff_reference}))
   return deny('INVALID_FREEZE_VERIFY_INPUT');
  const scope=key(input),rows=entries.get(scope)||[];
  let prev='0'.repeat(64);
  for(let i=0;i<rows.length;i++){
   const row=rows[i],{freeze_digest,...payload}=row;
   if(row.sequence!==i+1||row.previous_digest!==prev||
    freeze_digest!==sha(payload))return deny('FREEZE_HISTORY_INTEGRITY_FAILED');
   prev=freeze_digest;
  }
  const found=rows.find(x=>x.freeze_digest===input.freeze_digest);
  if(!found)return deny('FREEZE_REFERENCE_UNKNOWN');
  if(found!==rows.at(-1))return deny('SUPERSEDED_FREEZE_NOT_CURRENT');
  let current;
  try{current=await observe(input);}catch{return deny('FREEZE_DEPENDENCY_UNAVAILABLE');}
  if(current.error)return deny(current.error);
  if(sha(current.value)!==sha(found.observation))
   return deny('FROZEN_REPORT_INVALIDATED_BY_NEW_EVIDENCE');
  return deny('BLOCKED_CURRENT_FIXTURE_FREEZE_NO_EXTERNAL_AUTHORITY',{
   fixture_freeze_current:true,freeze_digest:found.freeze_digest});
 }
 function audit({organization_id,incident_id}={}){
  if(!UUID.test(organization_id)||!UUID.test(incident_id))return Object.freeze([]);
  return Object.freeze([...(entries.get(organization_id.toLowerCase()+'\\0'+
    incident_id.toLowerCase())||[])]);
 }
 return Object.freeze({freeze,verify,audit});
}
