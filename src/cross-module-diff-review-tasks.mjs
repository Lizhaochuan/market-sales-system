// V3.2-87: isolated re-review task queue derived from trusted CI-only diff.
// Completion is administrative only. Every business execution permission stays false.
import {createHash} from 'node:crypto';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const NONCE=/^[a-z0-9][a-z0-9._:-]{15,127}$/;
const ACTOR=/^[a-z0-9][a-z0-9._:-]{5,127}$/;
const ROLES=new Set(['sales','finance','academic']);
const exact=(x,keys)=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null)&&
 Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const invalid=code=>{const e=new Error(code);e.code=code;throw e;};
const fail=(reason_code)=>Object.freeze({reason_code,fixture_all_tasks_reviewed:false,
 external_authority_verified:false,finance_authorized:false,academic_authorized:false,
 handoff_allowed:false,compensation_write_allowed:false,release_eligible:false,hold_active:true});
function normalizeDiff(report){
 if(!report||report.reason_code!=='BLOCKED_REVIEW_CHANGED_EVIDENCE_AND_EXTERNAL_GAPS'||
  report.fixture_comparison_complete!==true||report.hold_active!==true||
  report.handoff_allowed!==false||report.release_eligible!==false||
  report.finance_authorized!==false||report.academic_authorized!==false||
  !Array.isArray(report.differences)||report.differences.length<1||
  !Array.isArray(report.external_requirements)||report.external_requirements.length!==6||
  !report.external_requirements.every(x=>x&&x.status==='requires_external_authority'))
  return null;
 const unique=new Set(),items=[];
 for(const d of report.differences){
  if(!d||typeof d.item!=='string'||!/^[a-z][a-z0-9_]{2,79}$/.test(d.item)||
   !ROLES.has(d.owner_department)||d.rereview_required!==true||
   unique.has(d.item))return null;
  unique.add(d.item);
  const detail={item:d.item,owner_department:d.owner_department,
   // Full immutable snapshot identity: a change to either version or digest
   // invalidates all existing task acknowledgements for this comparison.
   difference_digest:hash(d)};
  items.push(detail);
 }
 items.sort((a,b)=>a.item.localeCompare(b.item,'en'));
 return {items,comparison_digest:hash(items)};
}
export function createIsolatedDiffReviewTasks({evidenceDiff,getFixtureActor}={}){
 if(!evidenceDiff||typeof evidenceDiff.report!=='function'||
  typeof getFixtureActor!=='function')throw TypeError('Independent fixture adapters required');
 const history=new Map(),nonces=new Map();
 async function current(input){
  let report;
  try{report=await evidenceDiff.report(input);}
  catch{invalid('DIFF_PROVIDER_UNAVAILABLE');}
  const data=normalizeDiff(report);
  if(!data)invalid('DIFF_NOT_CURRENT_OR_INCOMPLETE');
  return data;
 }
 function scope(input){
  return input.organization_id.toLowerCase()+'\0'+input.incident_id.toLowerCase()+
   '\0'+input.previous_audit_digest+'\0'+input.new_audit_digest;
 }
 function validateReference(x){
  return exact(x,['organization_id','incident_id','previous_audit_sequence',
   'previous_audit_digest','new_audit_sequence','new_audit_digest'])&&
   UUID.test(x.organization_id)&&UUID.test(x.incident_id)&&
   Number.isSafeInteger(x.previous_audit_sequence)&&x.previous_audit_sequence>0&&
   Number.isSafeInteger(x.new_audit_sequence)&&
   x.new_audit_sequence>x.previous_audit_sequence&&
   SHA.test(x.previous_audit_digest)&&SHA.test(x.new_audit_digest);
 }
 function actor(org,id,role){
  let a;
  try{a=getFixtureActor(org,id);}catch{invalid('ACTOR_PROVIDER_UNAVAILABLE');}
  if(!exact(a,['actor_id','organization_id','role','active','fixture_only'])||
   a.actor_id!==id||typeof a.organization_id!=='string'||
   a.organization_id.toLowerCase()!==org||a.role!==role||
   a.active!==true||a.fixture_only!==true)invalid('REVIEW_ACTOR_NOT_VERIFIED');
 }
 async function record({reference,item,action,actor_id,idempotency_key}={}){
  if(!validateReference(reference)||typeof item!=='string'||
   !['start','complete'].includes(action)||typeof actor_id!=='string'||
   !ACTOR.test(actor_id)||typeof idempotency_key!=='string'||!NONCE.test(idempotency_key))
   invalid('INVALID_TASK_RECORD_INPUT');
  const data=await current(reference),target=data.items.find(x=>x.item===item);
  if(!target)invalid('TASK_NOT_IN_CURRENT_DIFF');
  const org=reference.organization_id.toLowerCase(),key=scope(reference);
  const nonceKey=org+'\0'+idempotency_key;
  const payload={item,action,actor_id,comparison_digest:data.comparison_digest};
  const fingerprint=hash({scope:key,...payload});
  const old=nonces.get(nonceKey);
  if(old){
   if(old.fingerprint!==fingerprint)invalid('TASK_NONCE_CONFLICT');
   return old.event;
  }
  const records=history.get(key)||[];
  const related=records.filter(x=>x.comparison_digest===data.comparison_digest&&x.item===item);
  const last=related.at(-1);
  if(action==='start'&&last)invalid('TASK_ALREADY_STARTED');
  if(action==='complete'&&last?.status!=='in_review')invalid('TASK_NOT_IN_REVIEW');
  actor(org,actor_id,target.owner_department);
  if(action==='complete'&&last.actor_id===actor_id)
   invalid('INDEPENDENT_TASK_COMPLETER_REQUIRED');
  const event=Object.freeze({schema_version:'v3.2-87-ci-task-v1',
   item,owner_department:target.owner_department,
   comparison_digest:data.comparison_digest,
   difference_digest:target.difference_digest,action,actor_id,
   status:action==='start'?'in_review':'closed_administratively',
   sequence:records.length+1,previous_digest:records.at(-1)?.event_digest||'0'.repeat(64),
   fixture_only:true,hold_active:true,handoff_allowed:false,release_eligible:false,
   event_digest:hash({scope:key,...payload,sequence:records.length+1})});
  history.set(key,[...records,event]);nonces.set(nonceKey,{fingerprint,event});
  return event;
 }
 async function report(reference){
  if(!validateReference(reference))return fail('INVALID_TASK_REPORT_REFERENCE');
  let data;
  try{data=await current(reference);}catch{return fail('DIFF_NOT_CURRENT_OR_INCOMPLETE');}
  const org=reference.organization_id.toLowerCase(),records=history.get(scope(reference))||[];
  const tasks=[];
  for(const d of data.items){
   const entries=records.filter(x=>x.comparison_digest===data.comparison_digest&&x.item===d.item);
   const last=entries.at(-1);
   let status=last?.status||'pending';
   if(last){
    try{actor(org,last.actor_id,d.owner_department);}
    catch{status='reviewer_revoked_recheck_required';}
   }
   tasks.push(Object.freeze({item:d.item,owner_department:d.owner_department,
    difference_digest:d.difference_digest,status}));
  }
  const remaining=tasks.filter(x=>x.status!=='closed_administratively');
  return Object.freeze({...fail('BLOCKED_EXTERNAL_HANDOFF_EVEN_IF_TASKS_COMPLETE'),
   fixture_all_tasks_reviewed:remaining.length===0,
   comparison_digest:data.comparison_digest,
   total_tasks:tasks.length,remaining_count:remaining.length,
   tasks:Object.freeze(tasks)});
 }
 return Object.freeze({record,report});
}
