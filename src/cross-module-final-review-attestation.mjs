// V3.2-98: CI-only independent reviews and administrative acknowledgement.
// This in-memory mock is NOT an external signature, release or business handoff.
import {createHash} from 'node:crypto';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{64}$/;
const ACTOR=/^[a-z0-9][a-z0-9._:-]{5,127}$/;
const NONCE=/^[a-z0-9][a-z0-9._:-]{15,127}$/;
const STEPS=Object.freeze([
 ['apply','sales'],['review_sales','sales'],['review_finance','finance'],
 ['review_academic','academic'],['acknowledge','sales']
]);
const GAPS=new Set(['finance_independent_signature','academic_independent_signature',
 'order_payment_reconciliation','lesson_entitlement_reconciliation',
 'three_party_acceptance','atomic_handoff_receipt']);
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
const exact=(x,keys)=>plain(x)&&Object.keys(x).length===keys.length&&
 keys.every(k=>Object.hasOwn(x,k));
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const failure=code=>{const e=new Error(code);e.code=code;throw e;};
const deny=(reason_code,extra={})=>Object.freeze({
 reason_code,fixture_acknowledgement_current:false,
 external_authority_verified:false,finance_authorized:false,academic_authorized:false,
 handoff_allowed:false,compensation_write_allowed:false,release_eligible:false,
 hold_active:true,production_integration_allowed:false,...extra
});
function referenceOK(x){
 return exact(x,['organization_id','incident_id','final_reference','diff_reference'])&&
 UUID.test(x.organization_id)&&UUID.test(x.incident_id)&&
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
function normalized(x){
 const s={organization_id:x.organization_id.toLowerCase(),
  incident_id:x.incident_id.toLowerCase()};
 return {...x,...s,diff_reference:{...x.diff_reference,...s}};
}
function validStoredSnapshot(record,ref,digest){
 const s={organization_id:ref.organization_id,incident_id:ref.incident_id};
 const observation=record?.observation,combined=observation?.combined,
  conclusion=observation?.conclusion;
 if(!plain(record)||record.snapshot_digest!==digest||
  record.organization_id!==s.organization_id||record.incident_id!==s.incident_id||
  record.fixture_only!==true||record.hold_active!==true||
  record.handoff_allowed!==false||!plain(observation)||
  observation.reference_digest!==sha({
   final_reference:ref.final_reference,diff_reference:ref.diff_reference})||
  !plain(combined)||!plain(conclusion)||
  !Array.isArray(combined.external_requirements)||
  combined.external_requirements.length!==6||
  !combined.external_requirements.every(x=>x&&GAPS.has(x))||
  new Set(combined.external_requirements).size!==6||
  !SHA.test(conclusion.conclusion_event_digest)||
  !Number.isSafeInteger(conclusion.expires_at_ms)||
  conclusion.expires_at_ms<1||
  combined.recovery_expires_at_ms!==conclusion.expires_at_ms)return false;
 return true;
}
export function createIsolatedFinalReviewAttestation({
 finalReview,getFixtureActor,getFixtureNow
}={}){
 if(!finalReview||typeof finalReview.verify!=='function'||
  typeof finalReview.audit!=='function'||
  typeof getFixtureActor!=='function'||typeof getFixtureNow!=='function')
  throw TypeError('Independent CI-only snapshot, actor and clock adapters required');
 const histories=new Map(),nonces=new Map(),queues=new Map(),clockHigh=new Map();
 const key=x=>x.organization_id+'|'+x.incident_id;
 async function now(scope){
  let t;
  try{t=await getFixtureNow();}
  catch{failure('ATTESTATION_CLOCK_UNAVAILABLE');}
  if(!Number.isSafeInteger(t)||t<1||t<(clockHigh.get(scope)||0))
   failure('ATTESTATION_CLOCK_INVALID_OR_ROLLED_BACK');
  clockHigh.set(scope,t);return t;
 }
 async function person(org,id,role){
  let p;
  try{p=await getFixtureActor(org,id);}
  catch{failure('ATTESTATION_ACTOR_DEPENDENCY_UNAVAILABLE');}
  if(!exact(p,['actor_id','organization_id','role','active','fixture_only'])||
   p.actor_id!==id||p.organization_id?.toLowerCase()!==org||
   p.role!==role||p.active!==true||p.fixture_only!==true)
   failure('ATTESTATION_ACTOR_REVOKED_OR_INVALID');
 }
 function history(rows,org,incident){
  let prev='0'.repeat(64);
  for(let i=0;i<rows.length;i++){
   const row=rows[i],{event_digest,...payload}=row||{};
   if(!plain(row)||row.organization_id!==org||row.incident_id!==incident||
    row.sequence!==i+1||row.previous_digest!==prev||
    row.fixture_only!==true||row.hold_active!==true||
    row.handoff_allowed!==false||!SHA.test(event_digest)||
    sha(payload)!==event_digest)failure('ATTESTATION_HISTORY_INTEGRITY_FAILED');
   prev=event_digest;
  }
 }
 async function current(ref,snapshot_digest){
  let v,rows;
  try{
   v=await finalReview.verify({reference:ref,snapshot_digest});
   rows=await finalReview.audit({organization_id:ref.organization_id,
    incident_id:ref.incident_id});
  }catch{failure('FINAL_REVIEW_SNAPSHOT_DEPENDENCY_UNAVAILABLE');}
  if(!plain(v)||v.reason_code!=='BLOCKED_CURRENT_FIXTURE_FINAL_REVIEW_NO_AUTHORITY'||
   v.fixture_final_review_current!==true||v.hold_active!==true||
   v.handoff_allowed!==false||v.release_eligible!==false||
   v.finance_authorized!==false||v.academic_authorized!==false||
   v.compensation_write_allowed!==false||!Array.isArray(rows)||rows.length===0)
   failure('FINAL_REVIEW_SNAPSHOT_STALE_OR_UNVERIFIED');
  const record=rows.at(-1);
  if(!validStoredSnapshot(record,ref,snapshot_digest))
   failure('FINAL_REVIEW_SNAPSHOT_REFERENCE_MISMATCH');
  const t=await now(key(ref));
  if(t>=record.observation.conclusion.expires_at_ms)
   failure('FINAL_REVIEW_ATTESTATION_EXPIRED');
  return {record,time:t};
 }
 async function step(input={}){
  if(!exact(input,['reference','snapshot_digest','action','actor_id','idempotency_key'])||
   !referenceOK(input.reference)||!SHA.test(input.snapshot_digest)||
   !STEPS.some(([action])=>action===input.action)||
   typeof input.actor_id!=='string'||!ACTOR.test(input.actor_id)||
   typeof input.idempotency_key!=='string'||!NONCE.test(input.idempotency_key))
   return deny('INVALID_ATTESTATION_STEP_INPUT');
  const ref=normalized(input.reference),scope=key(ref);
  const prior=queues.get(scope)||Promise.resolve();
  const run=prior.catch(()=>{}).then(async()=>{
   try{
    await current(ref,input.snapshot_digest);
    const nonceKey=scope+'|'+input.idempotency_key;
    const fingerprint=sha({reference:ref,snapshot_digest:input.snapshot_digest,
     action:input.action,actor_id:input.actor_id});
    const seen=nonces.get(nonceKey);
    if(seen){
     if(seen.fingerprint!==fingerprint)return deny('ATTESTATION_NONCE_CONFLICT');
     return deny('BLOCKED_HISTORICAL_ATTESTATION_REPLAY',{record:seen.record});
    }
    const all=histories.get(scope)||[];
    history(all,ref.organization_id,ref.incident_id);
    const rows=all.filter(x=>x.snapshot_digest===input.snapshot_digest);
    if(rows.length>=STEPS.length||
     input.action!==STEPS[rows.length][0])
     return deny('ATTESTATION_STEP_OUT_OF_ORDER');
    if(rows.some(r=>r.actor_id===input.actor_id))
     return deny('ATTESTATION_REQUIRES_DISTINCT_PARTICIPANTS');
    for(const r of rows)await person(ref.organization_id,r.actor_id,
     STEPS.find(x=>x[0]===r.action)[1]);
    const role=STEPS[rows.length][1];
    await person(ref.organization_id,input.actor_id,role);
    // A second full read narrows, but cannot eliminate, the non-atomic race window.
    const confirmed=await current(ref,input.snapshot_digest);
    const payload={schema_version:'v3.2-98-ci-review-attestation-v1',
     organization_id:ref.organization_id,incident_id:ref.incident_id,
     sequence:all.length+1,previous_digest:all.at(-1)?.event_digest||'0'.repeat(64),
     snapshot_digest:input.snapshot_digest,
     source_reference_digest:confirmed.record.observation.reference_digest,
     action:input.action,actor_id:input.actor_id,role,
     status:input.action==='acknowledge'?'acknowledged_administratively':
      input.action==='apply'?'applied':'under_independent_review',
     recorded_at_ms:confirmed.time,fixture_only:true,
     hold_active:true,handoff_allowed:false,release_eligible:false};
    const record=Object.freeze({...payload,event_digest:sha(payload)});
    histories.set(scope,[...all,record]);
    nonces.set(nonceKey,{fingerprint,record});
    return deny('BLOCKED_ATTESTATION_EVENT_RECORDED',{record});
   }catch(e){return deny(e?.code||'ATTESTATION_DEPENDENCY_UNAVAILABLE');}
  });
  queues.set(scope,run);
  try{return await run;}finally{if(queues.get(scope)===run)queues.delete(scope);}
 }
 async function report(input={}){
  if(!exact(input,['reference','snapshot_digest'])||
   !referenceOK(input.reference)||!SHA.test(input.snapshot_digest))
   return deny('INVALID_ATTESTATION_REPORT_INPUT');
  const ref=normalized(input.reference),scope=key(ref);
  const all=histories.get(scope)||[];
  try{
   history(all,ref.organization_id,ref.incident_id);
   await current(ref,input.snapshot_digest);
   const rows=all.filter(x=>x.snapshot_digest===input.snapshot_digest);
   for(let i=0;i<rows.length;i++){
    if(i>=STEPS.length||rows[i].action!==STEPS[i][0])
     return deny('ATTESTATION_SEQUENCE_INVALID');
   }
   for(const r of rows)await person(ref.organization_id,r.actor_id,r.role);
   if(new Set(rows.map(x=>x.actor_id)).size!==rows.length)
    return deny('ATTESTATION_PARTICIPANT_COLLISION');
   await current(ref,input.snapshot_digest);
   const complete=rows.length===STEPS.length&&
    rows.at(-1).status==='acknowledged_administratively';
   return Object.freeze({...deny(complete?
    'BLOCKED_CI_ATTESTATION_COMPLETE_NO_EXTERNAL_AUTHORITY':
    'BLOCKED_INDEPENDENT_ATTESTATION_INCOMPLETE'),
    fixture_acknowledgement_current:complete,
    completed_steps:rows.length,required_steps:STEPS.length,
    current_snapshot_digest:input.snapshot_digest,
    acknowledgement_digest:complete?rows.at(-1).event_digest:null,
    events:Object.freeze([...all])});
  }catch(e){return deny(e?.code||'ATTESTATION_DEPENDENCY_UNAVAILABLE',{
   history_count:all.length});}
 }
 function audit({organization_id,incident_id}={}){
  if(!UUID.test(organization_id)||!UUID.test(incident_id))return Object.freeze([]);
  return Object.freeze([...(histories.get(organization_id.toLowerCase()+'|'+
   incident_id.toLowerCase())||[])]);
 }
 return Object.freeze({step,report,audit});
}
