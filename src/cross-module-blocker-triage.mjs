// V3.2-84: fictional offline incident triage linked to V3.2-83 audit evidence.
// Administrative closure is NEVER business hold release or external approval.
import {createHash} from 'node:crypto';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const NONCE=/^[a-z0-9][a-z0-9._:-]{15,127}$/;
const ID=/^[a-z0-9][a-z0-9._:-]{5,127}$/;
const exact=(x,keys)=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null)&&
 Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const fail=reason_code=>{const err=new Error(reason_code);err.code=reason_code;throw err;};
const scoped=(org,incident)=>org+'\0'+incident;
const classify=reason=>{
 if(reason==='FIXTURE_EVIDENCE_CHANGED_DURING_AUDIT')return {category:'version_drift',owner:'sales'};
 if(reason.startsWith('SUPPLEMENT_REVIEW_PRECHECK_FAILED_FINANCE')||
  reason.includes('ORDER_PAYMENT'))return {category:'finance_evidence',owner:'finance'};
 if(reason.includes('ACADEMIC')||reason.includes('LESSON_ENTITLEMENT'))return {category:'academic_evidence',owner:'academic'};
 if(reason==='BLOCKED_REAL_EXTERNAL_HANDOFF_NOT_AUTHORIZED')
  return {category:'external_handoff_authority',owner:'sales'};
 return {category:'cross_module_blocker',owner:'sales'};
};
const deny=(reason_code,event=null)=>Object.freeze({
 reason_code,fixture_triage_recorded:event!==null,event,
 external_authority_verified:false,finance_authorized:false,
 academic_authorized:false,handoff_allowed:false,
 compensation_write_allowed:false,release_eligible:false,
 hold_active:true,production_integration_allowed:false
});
export function createIsolatedBlockerTriage({audit,getFixtureActor,getFixtureCurrentSourceRevision}={}){
 if(!audit||typeof audit.audit!=='function'||typeof audit.verify!=='function'||
  typeof getFixtureActor!=='function'||typeof getFixtureCurrentSourceRevision!=='function')
  throw TypeError('Independent fixture audit, actor and source adapters required');
 const incidents=new Map(),nonces=new Map();
 function source(org,incident){
  let n;
  try{n=getFixtureCurrentSourceRevision(org,incident);}
  catch{fail('FIXTURE_SOURCE_UNAVAILABLE');}
  if(!Number.isSafeInteger(n)||n<1)fail('FIXTURE_SOURCE_INVALID');
  return n;
 }
 function actor(org,actorId,role){
  let r;
  try{r=getFixtureActor(org,actorId);}
  catch{fail('TRIAGE_ACTOR_UNAVAILABLE');}
  if(!exact(r,['actor_id','role','organization_id','active','fixture_only'])||
   r.actor_id!==actorId||r.role!==role||r.organization_id?.toLowerCase()!==org||
   r.active!==true||r.fixture_only!==true)fail('TRIAGE_ACTOR_NOT_VERIFIED');
 }
 function anchored(org,incident,sequence,recordDigest){
  const scope={organization_id:org,incident_id:incident};
  const check=audit.verify(scope);
  if(!check||check.reason_code!=='BLOCKED_FIXTURE_AUDIT_CHAIN_ONLY'||
   check.hold_active!==true||check.handoff_allowed!==false)
   fail('AUDIT_CHAIN_UNVERIFIED');
  const rows=audit.audit(scope);
  if(!Array.isArray(rows))fail('AUDIT_SNAPSHOT_UNAVAILABLE');
  const row=rows.find(r=>r.sequence===sequence);
  if(!row||row.record_digest!==recordDigest||row.fixture_only!==true||
   row.organization_id!==org||row.incident_id!==incident||
   row.hold_active!==true||row.handoff_allowed!==false||
   !Number.isSafeInteger(row.source_revision)||row.source_revision<1||
   typeof row.reason_code!=='string'||!/^[A-Z][A-Z0-9_]{3,127}$/.test(row.reason_code))
   fail('AUDIT_SNAPSHOT_REFERENCE_MISMATCH');
  return row;
 }
 function apply(input={}){
  if(!exact(input,['organization_id','incident_id','audit_sequence','audit_digest',
   'action','actor_id','idempotency_key'])||
   !UUID.test(input.organization_id)||!UUID.test(input.incident_id)||
   !Number.isSafeInteger(input.audit_sequence)||input.audit_sequence<1||
   !SHA.test(input.audit_digest)||!['open','begin_review','close'].includes(input.action)||
   typeof input.actor_id!=='string'||!ID.test(input.actor_id)||
   typeof input.idempotency_key!=='string'||!NONCE.test(input.idempotency_key))
   fail('INVALID_TRIAGE_EVENT_INPUT');
  const org=input.organization_id.toLowerCase(),incident=input.incident_id.toLowerCase();
  const base=anchored(org,incident,input.audit_sequence,input.audit_digest);
  const current=source(org,incident);
  const classification=classify(base.gate_reason_code||base.reason_code);
  const scope=scoped(org,incident);
  const root=scope+'\0'+input.audit_sequence+'\0'+input.audit_digest;
  const all=incidents.get(root)||[];
  const previous=all.at(-1);
  const nonceKey=scope+'\0'+input.idempotency_key;
  const noncePayload={organization_id:org,incident_id:incident,
   audit_sequence:input.audit_sequence,audit_digest:input.audit_digest,
   action:input.action,actor_id:input.actor_id};
  const fingerprint=digest(noncePayload);
  const existingNonce=nonces.get(nonceKey);
  if(existingNonce){
   if(existingNonce.fingerprint!==fingerprint)fail('TRIAGE_IDEMPOTENCY_CONFLICT');
   return deny('BLOCKED_HISTORICAL_TRIAGE_REPLAY',existingNonce.event);
  }
  const nextAction=previous?
   previous.status==='open'?'begin_review':
   previous.status==='in_review'?'close':null:'open';
  // A historical audit snapshot can be triaged but never administratively
  // closed after its source revision has changed.
  if(input.action==='close'&&current!==base.source_revision)
   fail('SOURCE_REVISION_CHANGED_REOPEN_REQUIRED');
  if(input.action!==nextAction)fail('ILLEGAL_TRIAGE_TRANSITION');
  const expectedRole=input.action==='open'?classification.owner:
   input.action==='begin_review'?classification.owner:'sales';
  actor(org,input.actor_id,expectedRole);
  if(input.action==='close'&&previous?.actor_id===input.actor_id)
   fail('INDEPENDENT_TRIAGE_CLOSER_REQUIRED');
  const payload={schema_version:'v3.2-84-ci-triage-v1',...noncePayload,
   source_revision:base.source_revision,category:classification.category,
   owner_department:classification.owner,gate_reason_code:base.gate_reason_code,
   status:input.action==='open'?'open':
    input.action==='begin_review'?'in_review':'closed_administratively',
   event_sequence:all.length+1,previous_event_digest:previous?.event_digest||'0'.repeat(64),
   fixture_only:true,hold_active:true,handoff_allowed:false,release_eligible:false};
  const event=Object.freeze({...payload,event_digest:digest(payload)});
  incidents.set(root,[...all,event]);nonces.set(nonceKey,{fingerprint,event});
  return deny('BLOCKED_TRIAGE_RECORDED_NO_RELEASE_AUTHORITY',event);
 }
 function report(input={}){
  if(!exact(input,['organization_id','incident_id','audit_sequence','audit_digest'])||
   !UUID.test(input.organization_id)||!UUID.test(input.incident_id)||
   !Number.isSafeInteger(input.audit_sequence)||input.audit_sequence<1||
   !SHA.test(input.audit_digest))return deny('INVALID_TRIAGE_REPORT_INPUT');
  const org=input.organization_id.toLowerCase(),incident=input.incident_id.toLowerCase();
  const root=scoped(org,incident)+'\0'+input.audit_sequence+'\0'+input.audit_digest;
  let base,current;
  try{
   base=anchored(org,incident,input.audit_sequence,input.audit_digest);
   current=source(org,incident);
  }catch{return deny('AUDIT_OR_SOURCE_UNAVAILABLE');}
  const rows=incidents.get(root)||[];
  let previous='0'.repeat(64);
  for(let i=0;i<rows.length;i++){
   const {event_digest,...payload}=rows[i];
   if(payload.event_sequence!==i+1||payload.previous_event_digest!==previous||
    event_digest!==digest(payload))return deny('TRIAGE_HISTORY_CHAIN_INVALID');
   previous=event_digest;
  }
  const currentStatus=rows.at(-1)?.status||'unassigned';
  return Object.freeze({...deny('BLOCKED_TRIAGE_STATUS_NOT_BUSINESS_RELEASE'),
   category:classify(base.gate_reason_code||base.reason_code).category,
   owner_department:classify(base.gate_reason_code||base.reason_code).owner,
   status:current===base.source_revision?currentStatus:'stale_source_reopen_required',
   source_revision_current:current===base.source_revision,
   event_count:rows.length,
   events:Object.freeze([...rows])});
 }
 return Object.freeze({apply,report});
}
