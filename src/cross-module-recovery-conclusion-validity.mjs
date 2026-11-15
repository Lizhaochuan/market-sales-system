// V3.2-95: CI-only recovery conclusion expiry, revocation, and new review.
// Fictional administrative conclusions NEVER authorize business restoration.
import {createHash} from 'node:crypto';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{64}$/;
const IDENT=/^[a-z0-9][a-z0-9._:-]{5,127}$/;
const NONCE=/^[a-z0-9][a-z0-9._:-]{15,127}$/;
const TTL_MS=24*60*60*1000;
const ACTIONS=Object.freeze(['apply','review_sales','review_finance','review_academic','conclude']);
const ROLE=Object.freeze({apply:'sales',review_sales:'sales',review_finance:'finance',
 review_academic:'academic',conclude:'sales',revoke:'sales'});
const exact=(x,keys)=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null)&&
 Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const reject=code=>{const e=new Error(code);e.code=code;throw e;};
const blocked=(reason_code,more={})=>Object.freeze({
 reason_code,fixture_conclusion_current:false,
 history_repair_allowed:false,automatic_recovery_allowed:false,
 external_authority_verified:false,finance_authorized:false,academic_authorized:false,
 handoff_allowed:false,compensation_write_allowed:false,release_eligible:false,
 hold_active:true,production_integration_allowed:false,...more});
const key=(org,incident)=>org+'\0'+incident;
function validRecoveryReport(r){
 if(!r||r.reason_code!=='BLOCKED_MANUAL_RECOVERY_NOT_BUSINESS_RELEASE'||
  r.fixture_recovery_review_complete!==true||r.hold_active!==true||
  r.handoff_allowed!==false||r.release_eligible!==false||
  r.required_external_authority_categories!==6||
  r.original_history_preserved!==true||
  !SHA.test(r.source_fingerprint)||!Array.isArray(r.events)||r.events.length<5)return false;
 const active=r.events.filter(x=>x&&x.source_fingerprint===r.source_fingerprint);
 const last=active.slice(-5);
 return last.length===5&&ACTIONS.every((a,i)=>last[i].action===a)&&
  last[4].status==='closed_administratively'&&
  last.every(x=>x.fixture_only===true&&x.hold_active===true&&
   x.handoff_allowed===false&&SHA.test(x.evidence_sha256)&&
   x.evidence_sha256===last[0].evidence_sha256);
}
export function createIsolatedRecoveryConclusionValidity({
 manualRecovery,getFixtureActor,getFixtureNow
}={}){
 if(!manualRecovery||typeof manualRecovery.report!=='function'||
 typeof getFixtureActor!=='function'||typeof getFixtureNow!=='function')
 throw TypeError('Independent fictional recovery, actor and time adapters required');
 const eventsByScope=new Map(),nonces=new Map(),clockHigh=new Map(),queues=new Map();
 async function source(org,incident){
  let r;
  try{r=await manualRecovery.report({organization_id:org,incident_id:incident});}
  catch{reject('RECOVERY_SOURCE_UNAVAILABLE');}
  if(!validRecoveryReport(r))reject('RECOVERY_SOURCE_NOT_CURRENT');
  return Object.freeze({fingerprint:r.source_fingerprint,
   evidence_sha256:r.events.filter(x=>x.source_fingerprint===r.source_fingerprint).at(-5).evidence_sha256});
 }
 function now(scope){
  let t;
  try{t=getFixtureNow();}
  catch{reject('FIXTURE_CLOCK_UNAVAILABLE');}
  if(!Number.isSafeInteger(t)||t<1)reject('FIXTURE_CLOCK_INVALID');
  const high=clockHigh.get(scope)||0;
  if(t<high)reject('FIXTURE_CLOCK_ROLLBACK');
  clockHigh.set(scope,t);
  return t;
 }
 function actor(org,id,role){
  let r;
  try{r=getFixtureActor(org,id);}catch{reject('ACTOR_PROVIDER_UNAVAILABLE');}
  if(!exact(r,['actor_id','organization_id','role','active','fixture_only'])||
   r.actor_id!==id||typeof r.organization_id!=='string'||
   r.organization_id.toLowerCase()!==org||
   r.role!==role||r.active!==true||r.fixture_only!==true)
   reject('REVIEW_ACTOR_REVOKED_OR_INVALID');
 }
 function validateHistory(records,org,incident){
  let prev='0'.repeat(64);
  for(let i=0;i<records.length;i++){
   const e=records[i],{event_digest,...payload}=e;
   if(e.sequence!==i+1||e.organization_id!==org||e.incident_id!==incident||
    e.previous_digest!==prev||sha(payload)!==event_digest||
    e.fixture_only!==true||e.hold_active!==true||
    e.handoff_allowed!==false)reject('CONCLUSION_HISTORY_INTEGRITY_FAILED');
   prev=event_digest;
  }
 }
 function rounds(records){
  const output=[];let current=null;
  for(const e of records){
   if(e.action==='apply'){
    if(current&&current.status==='in_progress')reject('INCOMPLETE_OLDER_REVIEW_ROUND');
    current={id:e.round_id,events:[e],status:'in_progress'};
    output.push(current);
   }else if(e.action==='revoke'){
    if(!current||current.id!==e.round_id||current.status!=='concluded')
     reject('INVALID_REVOKE_HISTORY');
    current.events.push(e);current.status='revoked';
   }else{
    if(!current||current.id!==e.round_id||current.status!=='in_progress')
     reject('INVALID_REVIEW_ROUND_HISTORY');
    const expected=ACTIONS[current.events.length];
    if(e.action!==expected)reject('REVIEW_ROUND_HISTORY_SEQUENCE_INVALID');
    current.events.push(e);
    if(e.action==='conclude')current.status='concluded';
   }
  }
  return output;
 }
 function currentStatus(r,src,t,org){
  if(!r)return 'not_recorded';
  if(r.status==='revoked')return 'explicitly_revoked';
  if(r.status==='in_progress')return 'awaiting_independent_reacceptance';
  const concluded=r.events.find(x=>x.action==='conclude');
  if(!concluded||concluded.expires_at_ms<=t)return 'expired';
  if(r.events[0].source_fingerprint!==src.fingerprint||
   r.events[0].evidence_sha256!==src.evidence_sha256)return 'source_changed';
  try{
   for(const e of r.events)actor(org,e.actor_id,ROLE[e.action]);
  }catch{return 'reviewer_revoked_or_inactive';}
  return 'fixture_current_not_authorized';
 }
 async function apply(input={}){
  if(!exact(input,['organization_id','incident_id','action','actor_id',
   'evidence_sha256','idempotency_key'])||
   !UUID.test(input.organization_id)||!UUID.test(input.incident_id)||
   ![...ACTIONS,'revoke'].includes(input.action)||
   typeof input.actor_id!=='string'||!IDENT.test(input.actor_id)||
   !SHA.test(input.evidence_sha256)||
   typeof input.idempotency_key!=='string'||!NONCE.test(input.idempotency_key))
   reject('INVALID_CONCLUSION_EVENT_INPUT');
  const org=input.organization_id.toLowerCase(),incident=input.incident_id.toLowerCase();
  const scope=key(org,incident),pending=queues.get(scope)||Promise.resolve();
  const task=pending.catch(()=>{}).then(async()=>{
   const sourceState=await source(org,incident),t=now(scope);
   const old=eventsByScope.get(scope)||[];validateHistory(old,org,incident);
   const allRounds=rounds(old),round=allRounds.at(-1);
   const nonceKey=scope+'\0'+input.idempotency_key;
   const payloadFingerprint=sha({action:input.action,actor_id:input.actor_id,
    evidence_sha256:input.evidence_sha256,source_fingerprint:sourceState.fingerprint});
   const replay=nonces.get(nonceKey);
   if(replay){
    if(replay.fingerprint!==payloadFingerprint)reject('CONCLUSION_IDEMPOTENCY_CONFLICT');
    return replay.event;
   }
   if(input.evidence_sha256!==sourceState.evidence_sha256)
    reject('RECOVERY_EVIDENCE_MISMATCH');
   const status=currentStatus(round,sourceState,t,org);
   const action=input.action;
   if(action==='apply'){
    if(round&&round.status==='in_progress'&&
     round.events[0].source_fingerprint===sourceState.fingerprint)
     reject('REACCEPTANCE_ROUND_ALREADY_OPEN');
    if(round&&status==='fixture_current_not_authorized')
     reject('CURRENT_CONCLUSION_ALREADY_EXISTS');
   }else if(action==='revoke'){
    if(!round||round.status!=='concluded'||
     status==='explicitly_revoked')reject('NO_CONCLUSION_TO_REVOKE');
   }else{
    if(!round||round.status!=='in_progress'||
     round.events[0].source_fingerprint!==sourceState.fingerprint||
     round.events[0].evidence_sha256!==sourceState.evidence_sha256)
     reject('FRESH_REACCEPTANCE_REQUIRED');
    if(action!==ACTIONS[round.events.length])reject('CONCLUSION_REVIEW_OUT_OF_ORDER');
    if(round.events.some(e=>e.actor_id===input.actor_id))
     reject('INDEPENDENT_REACCEPTANCE_ACTOR_REQUIRED');
   }
   actor(org,input.actor_id,ROLE[action]);
   if(action==='revoke'&&round.events.some(e=>e.actor_id===input.actor_id))
    reject('INDEPENDENT_REVOCATION_ACTOR_REQUIRED');
   const roundId=action==='apply'?
    sha({scope,sequence:allRounds.length+1,source_fingerprint:sourceState.fingerprint,t}):
    round.id;
   const payload={schema_version:'v3.2-95-ci-conclusion-v1',
    organization_id:org,incident_id:incident,
    sequence:old.length+1,previous_digest:old.at(-1)?.event_digest||'0'.repeat(64),
    round_id:roundId,source_fingerprint:sourceState.fingerprint,
    evidence_sha256:sourceState.evidence_sha256,action,actor_id:input.actor_id,
    recorded_at_ms:t,
    expires_at_ms:action==='conclude'?t+TTL_MS:null,
    fixture_only:true,hold_active:true,handoff_allowed:false,
    release_eligible:false};
   const event=Object.freeze({...payload,event_digest:sha(payload)});
   eventsByScope.set(scope,[...old,event]);
   nonces.set(nonceKey,{fingerprint:payloadFingerprint,event});
   return event;
  });
  queues.set(scope,task);
  try{return await task;}finally{if(queues.get(scope)===task)queues.delete(scope);}
 }
 async function report(input={}){
  if(!exact(input,['organization_id','incident_id'])||
   !UUID.test(input.organization_id)||!UUID.test(input.incident_id))
   return blocked('INVALID_CONCLUSION_REPORT_INPUT');
  const org=input.organization_id.toLowerCase(),incident=input.incident_id.toLowerCase();
  const scope=key(org,incident),records=eventsByScope.get(scope)||[];
  try{
   validateHistory(records,org,incident);
   const list=rounds(records),current=list.at(-1);
   const src=await source(org,incident),t=now(scope);
   const status=currentStatus(current,src,t,org);
   return Object.freeze({...blocked('BLOCKED_CONCLUSION_NOT_BUSINESS_AUTHORIZATION'),
    fixture_conclusion_current:status==='fixture_current_not_authorized',
    status,history_count:records.length,
    expires_at_ms:current?.events.find(x=>x.action==='conclude')?.expires_at_ms||null,
    current_source_fingerprint:src.fingerprint,
    events:Object.freeze([...records])});
  }catch{return blocked('CONCLUSION_SOURCE_CLOCK_OR_HISTORY_UNAVAILABLE');}
 }
 return Object.freeze({apply,report});
}
