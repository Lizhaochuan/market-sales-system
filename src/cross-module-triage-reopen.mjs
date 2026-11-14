// V3.2-85: offline-only, immutable follow-up triage after new evidence.
// Reopening or administrative closure never releases a business hold.
import {createHash} from 'node:crypto';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const IDENT=/^[a-z0-9][a-z0-9._:-]{5,127}$/;
const exact=(x,keys)=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null)&&
 Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const fail=c=>{const e=new Error(c);e.code=c;throw e;};
const denied=(reason_code,event=null)=>Object.freeze({reason_code,
 fixture_followup_recorded:event!==null,event,external_authority_verified:false,
 finance_authorized:false,academic_authorized:false,handoff_allowed:false,
 compensation_write_allowed:false,release_eligible:false,hold_active:true});
const scope=(org,incident)=>org+'\0'+incident;
const classes={
 finance_evidence:'finance',academic_evidence:'academic',
 version_drift:'sales',external_handoff_authority:'sales',cross_module_blocker:'sales'
};
export function createIsolatedTriageReopen({audit,triage,getFixtureActor,getFixtureCurrentSourceRevision}={}){
 if(!audit||typeof audit.audit!=='function'||typeof audit.verify!=='function'||
  !triage||typeof triage.report!=='function'||
  typeof getFixtureActor!=='function'||typeof getFixtureCurrentSourceRevision!=='function')
  throw new TypeError('Independent fictional audit, triage and source adapters required');
 const ledger=new Map(),nonces=new Map();
 function readAudit(org,incident,seq,sha){
  const q={organization_id:org,incident_id:incident};
  const verification=audit.verify(q);
  if(!verification||verification.reason_code!=='BLOCKED_FIXTURE_AUDIT_CHAIN_ONLY'||
   verification.hold_active!==true||verification.handoff_allowed!==false)
   fail('AUDIT_CHAIN_NOT_VERIFIED');
  const items=audit.audit(q);
  if(!Array.isArray(items))fail('AUDIT_REFERENCE_UNAVAILABLE');
  const row=items.find(x=>x?.sequence===seq);
  if(!row||row.record_digest!==sha||row.organization_id!==org||
   row.incident_id!==incident||row.fixture_only!==true||
   row.hold_active!==true||row.handoff_allowed!==false||
   !Number.isSafeInteger(row.source_revision)||row.source_revision<1||
   !SHA.test(row.source_snapshot_digest_after)||!SHA.test(row.revocation_digest))
   fail('AUDIT_REFERENCE_MISMATCH');
  return row;
 }
 function person(org,id,role){
  let a;
  try{a=getFixtureActor(org,id);}catch{fail('FOLLOWUP_ACTOR_UNAVAILABLE');}
  if(!exact(a,['actor_id','role','organization_id','active','fixture_only'])||
   a.actor_id!==id||a.role!==role||a.organization_id?.toLowerCase()!==org||
   a.active!==true||a.fixture_only!==true)fail('FOLLOWUP_ACTOR_NOT_VERIFIED');
 }
 function sourceRevision(org,incident){
  let r;
  try{r=getFixtureCurrentSourceRevision(org,incident);}
  catch{fail('SOURCE_REVISION_UNAVAILABLE');}
  if(!Number.isSafeInteger(r)||r<1)fail('SOURCE_REVISION_UNAVAILABLE');
  return r;
 }
 function anchor(input){
  const org=input.organization_id.toLowerCase(),incident=input.incident_id.toLowerCase();
  const old=readAudit(org,incident,input.previous_audit_sequence,input.previous_audit_digest);
  const newer=readAudit(org,incident,input.new_audit_sequence,input.new_audit_digest);
  if(newer.sequence<=old.sequence)fail('NEW_AUDIT_NOT_AFTER_PREVIOUS');
  if(newer.source_revision<old.source_revision)fail('SOURCE_REVISION_REGRESSION');
  const meaningful=newer.source_revision>old.source_revision||
    newer.source_snapshot_digest_after!==old.source_snapshot_digest_after||
    newer.revocation_digest!==old.revocation_digest;
  if(!meaningful)fail('NO_NEW_EVIDENCE_FOR_REOPEN');
  if(sourceRevision(org,incident)!==newer.source_revision)
   fail('FOLLOWUP_EVIDENCE_NOT_CURRENT');
  let olderCase;
  try{olderCase=triage.report({organization_id:org,incident_id:incident,
   audit_sequence:old.sequence,audit_digest:old.record_digest});}
  catch{fail('PREVIOUS_TRIAGE_UNAVAILABLE');}
  if(!olderCase||olderCase.hold_active!==true||
   olderCase.handoff_allowed!==false||
   !['closed_administratively','stale_source_reopen_required'].includes(olderCase.status)||
   !Object.hasOwn(classes,olderCase.category))
   fail('PREVIOUS_TRIAGE_NOT_CLOSED_OR_STALE');
  return {org,incident,old,newer,owner:classes[olderCase.category],
   category:olderCase.category};
 }
 function apply(input={}){
  if(!exact(input,['organization_id','incident_id','previous_audit_sequence',
   'previous_audit_digest','new_audit_sequence','new_audit_digest',
   'action','actor_id','idempotency_key'])||
   !UUID.test(input.organization_id)||!UUID.test(input.incident_id)||
   !Number.isSafeInteger(input.previous_audit_sequence)||input.previous_audit_sequence<1||
   !Number.isSafeInteger(input.new_audit_sequence)||input.new_audit_sequence<1||
   !SHA.test(input.previous_audit_digest)||!SHA.test(input.new_audit_digest)||
   !['reopen','rereview','close_administratively'].includes(input.action)||
   typeof input.actor_id!=='string'||!IDENT.test(input.actor_id)||
   typeof input.idempotency_key!=='string'||!IDENT.test(input.idempotency_key))
   fail('INVALID_FOLLOWUP_EVENT_INPUT');
  const {org,incident,old,newer,owner,category}=anchor(input);
  const root=scope(org,incident)+'\0'+old.record_digest+'\0'+newer.record_digest;
  const events=ledger.get(root)||[];
  const prior=events.at(-1),nonce=scope(org,incident)+'\0'+input.idempotency_key;
  const p={organization_id:org,incident_id:incident,previous_audit_sequence:old.sequence,
   previous_audit_digest:old.record_digest,new_audit_sequence:newer.sequence,
   new_audit_digest:newer.record_digest,action:input.action,actor_id:input.actor_id};
  const fingerprint=hash(p),replay=nonces.get(nonce);
  if(replay){
   if(replay.fingerprint!==fingerprint)fail('FOLLOWUP_IDEMPOTENCY_CONFLICT');
   return denied('BLOCKED_HISTORICAL_FOLLOWUP_REPLAY',replay.event);
  }
  const expected=!prior?'reopen':
   prior.status==='reopened'?'rereview':
   prior.status==='under_rereview'?'close_administratively':null;
  if(expected!==input.action)fail('ILLEGAL_FOLLOWUP_TRANSITION');
  const role=input.action==='close_administratively'?'sales':owner;
  person(org,input.actor_id,role);
  if(input.action==='close_administratively'&&prior.actor_id===input.actor_id)
   fail('INDEPENDENT_FOLLOWUP_CLOSER_REQUIRED');
  const payload={schema_version:'v3.2-85-ci-followup-v1',...p,
   category,owner_department:owner,source_revision:newer.source_revision,
   event_sequence:events.length+1,
   previous_event_digest:prior?.event_digest||'0'.repeat(64),
   status:input.action==='reopen'?'reopened':
    input.action==='rereview'?'under_rereview':'closed_administratively',
   fixture_only:true,hold_active:true,handoff_allowed:false,release_eligible:false};
  const event=Object.freeze({...payload,event_digest:hash(payload)});
  ledger.set(root,[...events,event]);nonces.set(nonce,{fingerprint,event});
  return denied('BLOCKED_FOLLOWUP_RECORDED_NO_RELEASE',event);
 }
 function report(input={}){
  if(!exact(input,['organization_id','incident_id','previous_audit_sequence',
   'previous_audit_digest','new_audit_sequence','new_audit_digest'])||
   !UUID.test(input.organization_id)||!UUID.test(input.incident_id)||
   !Number.isSafeInteger(input.previous_audit_sequence)||input.previous_audit_sequence<1||
   !Number.isSafeInteger(input.new_audit_sequence)||input.new_audit_sequence<1||
   !SHA.test(input.previous_audit_digest)||!SHA.test(input.new_audit_digest))
   return denied('INVALID_FOLLOWUP_REPORT_INPUT');
  let link;
  try{link=anchor(input);}catch{return denied('FOLLOWUP_ANCHOR_INVALID_OR_STALE');}
  const root=scope(link.org,link.incident)+'\0'+link.old.record_digest+
   '\0'+link.newer.record_digest;
  const events=ledger.get(root)||[];
  let previous='0'.repeat(64);
  for(let i=0;i<events.length;i++){
   const row=events[i],{event_digest,...payload}=row;
   if(row.event_sequence!==i+1||row.previous_event_digest!==previous||
    event_digest!==hash(payload))
    return denied('FOLLOWUP_AUDIT_CHAIN_INVALID');
   previous=event_digest;
  }
  return Object.freeze({...denied('BLOCKED_FOLLOWUP_STATUS_IS_NOT_AUTHORIZATION'),
   category:link.category,owner_department:link.owner,
   status:events.at(-1)?.status||'awaiting_reopen',
   event_count:events.length,events:Object.freeze([...events])});
 }
 return Object.freeze({apply,report});
}
