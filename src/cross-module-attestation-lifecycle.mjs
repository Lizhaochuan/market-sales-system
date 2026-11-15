// V3.2-99: CI-only administrative acknowledgement revocation and re-sign lineage.
// An internal acknowledgement is never a real signature, handoff or release.
import {createHash} from 'node:crypto';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{64}$/;
const ID=/^[a-z0-9][a-z0-9._:-]{5,127}$/;
const NONCE=/^[a-z0-9][a-z0-9._:-]{15,127}$/;
const STEPS=[['apply','sales'],['review_sales','sales'],['review_finance','finance'],
 ['review_academic','academic'],['acknowledge','sales']];
const REASONS=new Set(['administrative_retraction','review_error','evidence_superseded',
 'reviewer_access_revoked']);
const exact=(x,keys)=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null)&&
 Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const error=code=>{const e=new Error(code);e.code=code;throw e;};
const denied=(reason_code,extra={})=>Object.freeze({reason_code,
 fixture_acknowledgement_current:false,fixture_resign_link_recorded:false,
 external_authority_verified:false,finance_authorized:false,academic_authorized:false,
 handoff_allowed:false,compensation_write_allowed:false,release_eligible:false,
 hold_active:true,production_integration_allowed:false,...extra});
function validRef(x){
 return exact(x,['organization_id','incident_id','final_reference','diff_reference'])&&
 UUID.test(x.organization_id)&&UUID.test(x.incident_id)&&
 exact(x.final_reference,['source_digest','revocation_reference'])&&
 SHA.test(x.final_reference.source_digest)&&
 exact(x.diff_reference,['organization_id','incident_id','previous_audit_sequence',
  'previous_audit_digest','new_audit_sequence','new_audit_digest'])&&
 UUID.test(x.diff_reference.organization_id)&&UUID.test(x.diff_reference.incident_id)&&
 x.organization_id.toLowerCase()===x.diff_reference.organization_id.toLowerCase()&&
 x.incident_id.toLowerCase()===x.diff_reference.incident_id.toLowerCase()&&
 Number.isSafeInteger(x.diff_reference.previous_audit_sequence)&&
 x.diff_reference.previous_audit_sequence>0&&
 Number.isSafeInteger(x.diff_reference.new_audit_sequence)&&
 x.diff_reference.new_audit_sequence>x.diff_reference.previous_audit_sequence&&
 SHA.test(x.diff_reference.previous_audit_digest)&&SHA.test(x.diff_reference.new_audit_digest);
}
const normalize=x=>({...x,organization_id:x.organization_id.toLowerCase(),
 incident_id:x.incident_id.toLowerCase(),diff_reference:{...x.diff_reference,
 organization_id:x.organization_id.toLowerCase(),incident_id:x.incident_id.toLowerCase()}});
const scope=x=>x.organization_id+'|'+x.incident_id;
function auditChain(rows,digestField,org,incident,kind){
 if(!Array.isArray(rows))error(kind+'_AUDIT_UNAVAILABLE');
 let previous='0'.repeat(64);
 for(let i=0;i<rows.length;i++){
  const row=rows[i];
  if(!row||row.sequence!==i+1||row.organization_id!==org||
   row.incident_id!==incident||row.previous_digest!==previous||
   row.fixture_only!==true||row.hold_active!==true||
   row.handoff_allowed!==false||!SHA.test(row[digestField]))
   error(kind+'_AUDIT_INTEGRITY_INVALID');
  const {[digestField]:digest,...payload}=row;
  if(sha(payload)!==digest)error(kind+'_AUDIT_INTEGRITY_INVALID');
  previous=digest;
 }
}
function fiveRows(rows,snapshotDigest,receiptDigest){
 const selected=rows.filter(x=>x.snapshot_digest===snapshotDigest);
 if(selected.length!==5)return null;
 for(let i=0;i<5;i++){
  const row=selected[i];
  if(row.action!==STEPS[i][0]||row.role!==STEPS[i][1]||
   row.release_eligible!==false||!SHA.test(row.source_reference_digest)||
   (i&&row.source_reference_digest!==selected[0].source_reference_digest))
   return null;
 }
 if(new Set(selected.map(x=>x.actor_id)).size!==5||
  selected[4].event_digest!==receiptDigest||
  selected[4].status!=='acknowledged_administratively')return null;
 return selected;
}
function reviewValid(result,receipt){
 return result&&result.reason_code==='BLOCKED_CI_ATTESTATION_COMPLETE_NO_EXTERNAL_AUTHORITY'&&
 result.fixture_acknowledgement_current===true&&
 result.acknowledgement_digest===receipt&&
 result.completed_steps===5&&result.required_steps===5&&
 result.hold_active===true&&result.handoff_allowed===false&&
 result.release_eligible===false&&result.compensation_write_allowed===false&&
 result.finance_authorized===false&&result.academic_authorized===false&&
 result.external_authority_verified===false;
}
export function createIsolatedAttestationLifecycle({finalReview,attestation,
 getFixtureActor,getFixtureNow}={}){
 if(!finalReview||typeof finalReview.verify!=='function'||
  typeof finalReview.audit!=='function'||!attestation||
  typeof attestation.audit!=='function'||typeof attestation.report!=='function'||
  typeof getFixtureActor!=='function'||typeof getFixtureNow!=='function')
  throw TypeError('Independent CI-only review and identity adapters required');
 const ledgers=new Map(),nonces=new Map(),queues=new Map(),highClock=new Map();
 function time(s){
  const t=getFixtureNow();
  if(!Number.isSafeInteger(t)||t<1||t<(highClock.get(s)||0))
   error('LIFECYCLE_CLOCK_UNTRUSTED');
  highClock.set(s,t);return t;
 }
 async function actor(org,id){
  let x;
  try{x=await getFixtureActor(org,id);}catch{error('LIFECYCLE_ACTOR_UNAVAILABLE');}
  if(!exact(x,['actor_id','organization_id','role','active','fixture_only'])||
   x.actor_id!==id||x.organization_id?.toLowerCase()!==org||
   x.role!=='sales'||x.active!==true||x.fixture_only!==true)
   error('INDEPENDENT_LIFECYCLE_ACTOR_UNVERIFIED');
 }
 function localHistory(s,org,incident){
  const rows=ledgers.get(s)||[];auditChain(rows,'event_digest',org,incident,'LIFECYCLE');
  return rows;
 }
 async function provenance(ref,snapshotDigest,receiptDigest){
  const s={organization_id:ref.organization_id,incident_id:ref.incident_id};
  const [snapshots,receipts]=await Promise.all([finalReview.audit(s),attestation.audit(s)]);
  auditChain(snapshots,'snapshot_digest',s.organization_id,s.incident_id,'SNAPSHOT');
  auditChain(receipts,'event_digest',s.organization_id,s.incident_id,'ATTESTATION');
  const index=snapshots.findIndex(x=>x.snapshot_digest===snapshotDigest);
  if(index<0)error('ACKNOWLEDGEMENT_SNAPSHOT_NOT_FOUND');
  const frozen=snapshots[index];
  if(frozen.observation?.reference_digest!==sha({
   final_reference:ref.final_reference,diff_reference:ref.diff_reference}))
   error('ACKNOWLEDGEMENT_REFERENCE_MISMATCH');
  const signed=fiveRows(receipts,snapshotDigest,receiptDigest);
  if(!signed)error('ACKNOWLEDGEMENT_RECEIPT_NOT_VERIFIED');
  if(signed[0].source_reference_digest!==frozen.observation.reference_digest)
   error('ACKNOWLEDGEMENT_REFERENCE_MISMATCH');
  return {snapshots,receipts,signed,index};
 }
 async function current(ref,digest,receipt){
  const [verified,review]=await Promise.all([
   finalReview.verify({reference:ref,snapshot_digest:digest}),
   attestation.report({reference:ref,snapshot_digest:digest})]);
  if(!verified||verified.reason_code!=='BLOCKED_CURRENT_FIXTURE_FINAL_REVIEW_NO_AUTHORITY'||
   verified.fixture_final_review_current!==true||
   verified.hold_active!==true||verified.handoff_allowed!==false||
   verified.release_eligible!==false||!reviewValid(review,receipt))
   error('CURRENT_ACKNOWLEDGEMENT_STALE_OR_REVOKED');
  const evidence=await provenance(ref,digest,receipt);
  if(evidence.index!==evidence.snapshots.length-1)
   error('SUPERSEDED_ACKNOWLEDGEMENT');
  return evidence;
 }
 function enqueue(s,fn){
  const previous=queues.get(s)||Promise.resolve();
  const run=previous.catch(()=>{}).then(fn);
  queues.set(s,run);
  return run.finally(()=>{if(queues.get(s)===run)queues.delete(s);});
 }
 async function revoke(input={}){
  if(!exact(input,['reference','snapshot_digest','acknowledgement_digest',
   'reason_code','actor_id','idempotency_key'])||!validRef(input.reference)||
   !SHA.test(input.snapshot_digest)||!SHA.test(input.acknowledgement_digest)||
   !REASONS.has(input.reason_code)||typeof input.actor_id!=='string'||
   !ID.test(input.actor_id)||typeof input.idempotency_key!=='string'||
   !NONCE.test(input.idempotency_key))return denied('INVALID_REVOKE_REQUEST');
  const ref=normalize(input.reference),s=scope(ref);
  return enqueue(s,async()=>{
   try{
    const rows=localHistory(s,ref.organization_id,ref.incident_id);
    const nonce=s+'|'+input.idempotency_key;
    const fingerprint=sha({reference:ref,snapshot_digest:input.snapshot_digest,
     acknowledgement_digest:input.acknowledgement_digest,
     reason_code:input.reason_code,actor_id:input.actor_id});
    const replay=nonces.get(nonce);
    if(replay)return replay.fingerprint===fingerprint?
     denied('BLOCKED_HISTORICAL_REVOCATION_REPLAY',{record:replay.event}):
     denied('LIFECYCLE_IDEMPOTENCY_CONFLICT');
    const proof=await provenance(ref,input.snapshot_digest,input.acknowledgement_digest);
    if(rows.some(x=>x.action==='revoke'&&
     x.acknowledgement_digest===input.acknowledgement_digest))
     return denied('ACKNOWLEDGEMENT_ALREADY_REVOKED');
    if(proof.signed.some(x=>x.actor_id===input.actor_id))
     return denied('REVOCATION_ACTOR_NOT_INDEPENDENT');
    await actor(ref.organization_id,input.actor_id);
    const t=time(s);
    // A revocation can also annotate an old snapshot, but never restore it.
    const p={schema_version:'v3.2-99-ci-attestation-lifecycle-v1',
     organization_id:ref.organization_id,incident_id:ref.incident_id,
     sequence:rows.length+1,previous_digest:rows.at(-1)?.event_digest||'0'.repeat(64),
     action:'revoke',snapshot_digest:input.snapshot_digest,
     acknowledgement_digest:input.acknowledgement_digest,
     reason_code:input.reason_code,actor_id:input.actor_id,
     recorded_at_ms:t,fixture_only:true,hold_active:true,
     handoff_allowed:false,release_eligible:false};
    const event=Object.freeze({...p,event_digest:sha(p)});
    ledgers.set(s,[...rows,event]);nonces.set(nonce,{fingerprint,event});
    return denied('BLOCKED_ADMINISTRATIVE_REVOCATION_RECORDED',{record:event});
   }catch(e){return denied(e.code||'LIFECYCLE_DEPENDENCY_UNAVAILABLE');}
  });
 }
 async function recordResign(input={}){
  if(!exact(input,['reference','old_snapshot_digest','old_acknowledgement_digest',
   'new_snapshot_digest','new_acknowledgement_digest','actor_id','idempotency_key'])||
   !validRef(input.reference)||!SHA.test(input.old_snapshot_digest)||
   !SHA.test(input.old_acknowledgement_digest)||
   !SHA.test(input.new_snapshot_digest)||!SHA.test(input.new_acknowledgement_digest)||
   input.old_snapshot_digest===input.new_snapshot_digest||
   typeof input.actor_id!=='string'||!ID.test(input.actor_id)||
   typeof input.idempotency_key!=='string'||!NONCE.test(input.idempotency_key))
   return denied('INVALID_RESIGN_LINK_REQUEST');
  const ref=normalize(input.reference),s=scope(ref);
  return enqueue(s,async()=>{
   try{
    const rows=localHistory(s,ref.organization_id,ref.incident_id);
    const nonce=s+'|'+input.idempotency_key;
    const fingerprint=sha({reference:ref,old_snapshot_digest:input.old_snapshot_digest,
     old_acknowledgement_digest:input.old_acknowledgement_digest,
     new_snapshot_digest:input.new_snapshot_digest,
     new_acknowledgement_digest:input.new_acknowledgement_digest,
     actor_id:input.actor_id});
    const replay=nonces.get(nonce);
    if(replay)return replay.fingerprint===fingerprint?
     denied('BLOCKED_HISTORICAL_RESIGN_LINK_REPLAY',{record:replay.event}):
     denied('LIFECYCLE_IDEMPOTENCY_CONFLICT');
    const older=await provenance(ref,input.old_snapshot_digest,
     input.old_acknowledgement_digest);
    const newer=await current(ref,input.new_snapshot_digest,
     input.new_acknowledgement_digest);
    if(newer.index!==older.index+1||
     older.snapshots[older.index+1]?.snapshot_digest!==input.new_snapshot_digest)
     return denied('RESIGN_SNAPSHOT_NOT_NEXT_IN_HISTORY');
    const links=rows.filter(x=>x.action==='resign');
    if(links.some(x=>x.old_acknowledgement_digest===input.old_acknowledgement_digest||
     x.new_acknowledgement_digest===input.new_acknowledgement_digest))
     return denied('RESIGN_LINEAGE_FORK_OR_DUPLICATE');
    if(links.length&&links.at(-1).new_acknowledgement_digest!==
     input.old_acknowledgement_digest)
     return denied('RESIGN_LINEAGE_DISCONNECTED');
    const allActors=[...older.signed,...newer.signed].map(x=>x.actor_id);
    if(allActors.includes(input.actor_id))
     return denied('RESIGN_LINK_ACTOR_NOT_INDEPENDENT');
    await actor(ref.organization_id,input.actor_id);
    await current(ref,input.new_snapshot_digest,input.new_acknowledgement_digest);
    const t=time(s);
    const p={schema_version:'v3.2-99-ci-attestation-lifecycle-v1',
     organization_id:ref.organization_id,incident_id:ref.incident_id,
     sequence:rows.length+1,previous_digest:rows.at(-1)?.event_digest||'0'.repeat(64),
     action:'resign',old_snapshot_digest:input.old_snapshot_digest,
     old_acknowledgement_digest:input.old_acknowledgement_digest,
     new_snapshot_digest:input.new_snapshot_digest,
     new_acknowledgement_digest:input.new_acknowledgement_digest,
     actor_id:input.actor_id,recorded_at_ms:t,fixture_only:true,
     hold_active:true,handoff_allowed:false,release_eligible:false};
    const event=Object.freeze({...p,event_digest:sha(p)});
    ledgers.set(s,[...rows,event]);nonces.set(nonce,{fingerprint,event});
    return denied('BLOCKED_RESIGN_LINEAGE_RECORDED',{record:event,
     fixture_resign_link_recorded:true});
   }catch(e){return denied(e.code||'LIFECYCLE_DEPENDENCY_UNAVAILABLE');}
  });
 }
 async function inspect(input={}){
  if(!exact(input,['reference','snapshot_digest','acknowledgement_digest'])||
   !validRef(input.reference)||!SHA.test(input.snapshot_digest)||
   !SHA.test(input.acknowledgement_digest))
   return denied('INVALID_LIFECYCLE_INSPECTION');
  const ref=normalize(input.reference),s=scope(ref);
  try{
   const rows=localHistory(s,ref.organization_id,ref.incident_id);
   await provenance(ref,input.snapshot_digest,input.acknowledgement_digest);
   if(rows.some(x=>x.action==='revoke'&&
    x.acknowledgement_digest===input.acknowledgement_digest))
    return denied('ACKNOWLEDGEMENT_EXPLICITLY_REVOKED',{history_count:rows.length});
   await current(ref,input.snapshot_digest,input.acknowledgement_digest);
   return denied('BLOCKED_CURRENT_ADMINISTRATIVE_ACKNOWLEDGEMENT',{
    fixture_acknowledgement_current:true,history_count:rows.length,
    acknowledgement_digest:input.acknowledgement_digest});
  }catch(e){return denied(e.code||'LIFECYCLE_DEPENDENCY_UNAVAILABLE');}
 }
 function audit({organization_id,incident_id}={}){
  if(!UUID.test(organization_id)||!UUID.test(incident_id))return Object.freeze([]);
  return Object.freeze([...(ledgers.get(organization_id.toLowerCase()+'|'+
   incident_id.toLowerCase())||[])]);
 }
 return Object.freeze({revoke,recordResign,inspect,audit});
}
