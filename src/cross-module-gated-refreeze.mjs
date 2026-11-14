// V3.2-91 CI-only gated refreeze. Only internally consistent fictional snapshots.
// Recheck completion never grants real financial, academic or release authority.
import {createHash} from 'node:crypto';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const IDENT=/^[a-z0-9][a-z0-9._:-]{15,127}$/;
const ACTOR=/^[a-z0-9][a-z0-9._:-]{5,127}$/;
const STEPS=Object.freeze([
 ['verify_updated_source_and_revocation_watermarks','sales'],
 ['rebuild_evidence_diff_and_all_item_reviews','sales'],
 ['rerun_three_domain_and_independent_reconfirmation','sales'],
 ['revalidate_six_external_authority_gaps','finance']
]);
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
const exact=(x,keys)=>plain(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const error=code=>{const e=new Error(code);e.code=code;throw e;};
const deny=(reason_code,more={})=>Object.freeze({
 reason_code,fixture_recheck_ready:false,fixture_refreeze_recorded:false,
 external_authority_verified:false,finance_authorized:false,academic_authorized:false,
 handoff_allowed:false,compensation_write_allowed:false,release_eligible:false,
 hold_active:true,automatic_regeneration_allowed:false,production_integration_allowed:false,
 ...more
});
function validReference(x){
 return exact(x,['organization_id','incident_id','final_reference','diff_reference','freeze_digest'])&&
 UUID.test(x.organization_id)&&UUID.test(x.incident_id)&&SHA.test(x.freeze_digest)&&
 exact(x.final_reference,['source_digest','revocation_reference'])&&
 SHA.test(x.final_reference.source_digest)&&
 exact(x.diff_reference,['organization_id','incident_id','previous_audit_sequence',
  'previous_audit_digest','new_audit_sequence','new_audit_digest'])&&
 UUID.test(x.diff_reference.organization_id)&&UUID.test(x.diff_reference.incident_id)&&
 x.diff_reference.organization_id.toLowerCase()===x.organization_id.toLowerCase()&&
 x.diff_reference.incident_id.toLowerCase()===x.incident_id.toLowerCase()&&
 Number.isSafeInteger(x.diff_reference.previous_audit_sequence)&&
 x.diff_reference.previous_audit_sequence>0&&
 Number.isSafeInteger(x.diff_reference.new_audit_sequence)&&
 x.diff_reference.new_audit_sequence>x.diff_reference.previous_audit_sequence&&
 SHA.test(x.diff_reference.previous_audit_digest)&&SHA.test(x.diff_reference.new_audit_digest);
}
function validPlan(p,oldDigest){
 return plain(p)&&p.reason_code==='BLOCKED_FRESH_EVIDENCE_AND_REVIEW_REQUIRED'&&
 p.fixture_recheck_plan_available===true&&p.hold_active===true&&
 p.handoff_allowed===false&&p.compensation_write_allowed===false&&
 p.release_eligible===false&&p.finance_authorized===false&&
 p.academic_authorized===false&&p.automatic_regeneration_allowed===false&&
 p.six_external_authority_gaps_unresolved===true&&
 p.old_freeze_digest===oldDigest&&SHA.test(p.current_watermark_digest)&&
 SHA.test(p.current_comparison_digest)&&Array.isArray(p.required_steps)&&
 p.required_steps.length===5&&STEPS.every(([step],i)=>p.required_steps[i]===step)&&
 p.required_steps[4]==='request_new_isolated_freeze_with_new_idempotency_key'&&
 Array.isArray(p.invalidation_categories)&&p.invalidation_categories.length>0&&
 p.invalidation_categories.every(x=>plain(x)&&x.recheck_required===true&&
  ['sales','finance','academic'].includes(x.owner_department));
}
function planFingerprint(p){
 return hash({old_freeze_digest:p.old_freeze_digest,
  current_watermark_digest:p.current_watermark_digest,
  current_comparison_digest:p.current_comparison_digest,
  invalidation_categories:p.invalidation_categories});
}
export function createIsolatedGatedRefreeze({invalidationPlanner,freezeRegistry,getFixtureActor}={}){
 if(!invalidationPlanner||typeof invalidationPlanner.plan!=='function'||
 !freezeRegistry||typeof freezeRegistry.freeze!=='function'||
 typeof getFixtureActor!=='function')throw TypeError('Independent fictional adapters required');
 const tasks=new Map(),nonces=new Map(),refreezes=new Map(),queues=new Map();
 async function planFor(ref){
  let p;
  try{p=await invalidationPlanner.plan(ref);}catch{error('RECHECK_PLAN_UNAVAILABLE');}
  if(!validPlan(p,ref.freeze_digest))error('RECHECK_PLAN_INVALID_OR_STALE');
  return p;
 }
 function actor(org,id,role){
  let a;
  try{a=getFixtureActor(org,id);}catch{error('RECHECK_ACTOR_UNAVAILABLE');}
  if(!exact(a,['actor_id','organization_id','role','active','fixture_only'])||
   a.actor_id!==id||a.organization_id?.toLowerCase()!==org||
   a.role!==role||a.active!==true||a.fixture_only!==true)
   error('RECHECK_ACTOR_NOT_VERIFIED');
 }
 const scope=(ref)=>ref.organization_id.toLowerCase()+'\0'+ref.incident_id.toLowerCase()+'\0'+ref.freeze_digest;
 async function record(input={}){
  if(!exact(input,['reference','step','action','actor_id','idempotency_key'])||
   !validReference(input.reference)||!STEPS.some(x=>x[0]===input.step)||
   !['start','complete'].includes(input.action)||
   typeof input.actor_id!=='string'||!ACTOR.test(input.actor_id)||
   typeof input.idempotency_key!=='string'||!IDENT.test(input.idempotency_key))
   error('INVALID_RECHECK_TASK_REQUEST');
  const p=await planFor(input.reference),fingerprint=planFingerprint(p);
  const org=input.reference.organization_id.toLowerCase(),k=scope(input.reference);
  const runKey=k+'\0'+input.idempotency_key;
  const body=hash({fingerprint,step:input.step,action:input.action,
   actor_id:input.actor_id});
  const previous=nonces.get(runKey);
  if(previous){
   if(previous.body!==body)error('RECHECK_TASK_NONCE_CONFLICT');
   return previous.record;
  }
  const role=STEPS.find(x=>x[0]===input.step)[1];
  const events=tasks.get(k)||[];
  const scoped=events.filter(x=>x.fingerprint===fingerprint&&x.step===input.step);
  const last=scoped.at(-1);
  if(input.action==='start'&&last)error('RECHECK_STEP_ALREADY_STARTED');
  if(input.action==='complete'&&last?.status!=='in_review')
   error('RECHECK_STEP_NOT_STARTED');
  actor(org,input.actor_id,role);
  if(input.action==='complete'&&input.actor_id===last.actor_id)
   error('INDEPENDENT_RECHECK_COMPLETER_REQUIRED');
  const record=Object.freeze({step:input.step,action:input.action,
   status:input.action==='start'?'in_review':'closed_administratively',
   actor_id:input.actor_id,fingerprint,sequence:events.length+1,
   fixture_only:true,hold_active:true,handoff_allowed:false,release_eligible:false});
  tasks.set(k,[...events,record]);nonces.set(runKey,{body,record});
  return record;
 }
 async function inspect(ref){
  if(!validReference(ref))return deny('INVALID_RECHECK_REFERENCE');
  let p;
  try{p=await planFor(ref);}catch{return deny('RECHECK_PLAN_INVALID_OR_STALE');}
  const fingerprint=planFingerprint(p),org=ref.organization_id.toLowerCase();
  const events=tasks.get(scope(ref))||[];
  const remaining=[];
  for(const [step,role] of STEPS){
   const row=events.filter(x=>x.fingerprint===fingerprint&&x.step===step).at(-1);
   let status=row?.status||'pending';
   if(row){
    try{actor(org,row.actor_id,role);}catch{status='reviewer_revoked_recheck_required';}
   }
   if(status!=='closed_administratively')
    remaining.push(Object.freeze({step,owner_department:role,status}));
  }
  return Object.freeze({...deny('BLOCKED_RECHECK_STEPS_AND_EXTERNAL_AUTHORITY'),
   fixture_recheck_ready:remaining.length===0,
   plan_fingerprint:fingerprint,completed_steps:STEPS.length-remaining.length,
   remaining_steps:Object.freeze(remaining),
   six_external_authority_gaps_unresolved:true});
 }
 async function requestFixtureRefreeze(input={}){
  if(!exact(input,['reference','new_idempotency_key'])||
   !validReference(input.reference)||typeof input.new_idempotency_key!=='string'||
   !IDENT.test(input.new_idempotency_key))
   return deny('INVALID_REFREEZE_REQUEST');
  const ref=input.reference,k=scope(ref);
  const old=queues.get(k)||Promise.resolve();
  const run=old.catch(()=>{}).then(async()=>{
   const state=await inspect(ref);
   if(state.fixture_recheck_ready!==true)
    return deny('RECHECK_TASKS_INCOMPLETE_OR_STALE');
   const replay=refreezes.get(k+'\0'+input.new_idempotency_key);
   if(replay)return deny('BLOCKED_HISTORICAL_REFREEZE_REPLAY',{freeze_digest:replay});
   // Re-read just before explicit CI-only freeze; still not an atomic transaction.
   const verified=await inspect(ref);
   if(!verified.fixture_recheck_ready||verified.plan_fingerprint!==state.plan_fingerprint)
    return deny('RECHECK_CHANGED_BEFORE_FREEZE');
   const {freeze_digest,...base}=ref;
   let result;
   try{result=await freezeRegistry.freeze({...base,
    idempotency_key:input.new_idempotency_key});}
   catch{return deny('FIXTURE_FREEZE_DEPENDENCY_UNAVAILABLE');}
   if(!plain(result)||result.reason_code!=='BLOCKED_FROZEN_REPORT_NO_EXTERNAL_AUTHORITY'||
    !plain(result.freeze)||!SHA.test(result.freeze.freeze_digest)||
    result.hold_active!==true||result.handoff_allowed!==false||
    result.compensation_write_allowed!==false||result.release_eligible!==false)
    return deny('NEW_FIXTURE_FREEZE_UNVERIFIED');
   refreezes.set(k+'\0'+input.new_idempotency_key,result.freeze.freeze_digest);
   return deny('BLOCKED_NEW_FIXTURE_FREEZE_NOT_REAL_HANDOFF',{
    fixture_refreeze_recorded:true,new_freeze_digest:result.freeze.freeze_digest});
  });
  queues.set(k,run);
  try{return await run;}finally{if(queues.get(k)===run)queues.delete(k);}
 }
 return Object.freeze({record,inspect,requestFixtureRefreeze});
}
