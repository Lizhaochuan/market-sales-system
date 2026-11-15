// V3.2-120: CI-only irreversible export revocation evidence.
// A checksum and a local observation never establish production authority.
import {createHash} from 'node:crypto';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const SCOPE=['organization_id','incident_id'];
const INPUT=[...SCOPE,'manifest_sequence'];
const AUDIT=['schema_version','scope','sequence','previous_event_digest',
 'target_manifest_sequence','target_manifest_digest','target_source_digest',
 'latest_manifest_sequence','latest_manifest_digest','observed_source_digest',
 'classification','revocation_recorded','cause_digest','status','recorded_at_ms'];
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const exact=(x,fields)=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null)&&
 Object.keys(x).length===fields.length&&fields.every(k=>Object.hasOwn(x,k));
const scoped=s=>exact(s,SCOPE)&&SCOPE.every(k=>typeof s[k]==='string'&&UUID.test(s[k]));
const fail=c=>{const e=new Error(c);e.code=c;throw e;};
const deny=(reason_code,additional={})=>Object.freeze({
 reason_code,fixture_export_observation_recorded:false,
 export_valid_for_business:false,external_authority_verified:false,
 external_source_verified:false,external_recipient_verified:false,
 finance_authorized:false,academic_authorized:false,
 handoff_allowed:false,compensation_write_allowed:false,
 release_eligible:false,hold_active:true,
 production_integration_allowed:false,merge_authorized:false,
 deploy_authorized:false,...additional
});
export function classifyIsolatedExportRevision({
 target_manifest_sequence,target_manifest_digest,target_source_digest,
 latest_manifest_sequence,latest_manifest_digest,observed_source_digest,
 previously_revoked=false
}={}){
 if(!Number.isSafeInteger(target_manifest_sequence)||
  target_manifest_sequence<1||target_manifest_sequence>128||
  !Number.isSafeInteger(latest_manifest_sequence)||
  latest_manifest_sequence<target_manifest_sequence||
  latest_manifest_sequence>128||
  [target_manifest_digest,target_source_digest,latest_manifest_digest,
   observed_source_digest].some(x=>typeof x!=='string'||!SHA.test(x))||
  typeof previously_revoked!=='boolean')
  fail('EXPORT_REVOCATION_EVIDENCE_INVALID');
 if(previously_revoked)return 'REVOKED_PREVIOUSLY';
 if(latest_manifest_sequence>target_manifest_sequence)
  return 'REVOKED_SUPERSEDED_BY_LATER_EXPORT';
 if(target_source_digest!==observed_source_digest)
  return 'REVOKED_SOURCE_CHANGED_AFTER_EXPORT';
 return 'CURRENT_FIXTURE_SNAPSHOT_STILL_UNAUTHORIZED';
}
export function createIsolatedManifestRevocationAudit({
 ledger,getFixtureNow,afterCommit=async()=>{}
}={}){
 if(!ledger||['observe','head','event','capture'].some(k=>
  typeof ledger[k]!=='function')||
  typeof getFixtureNow!=='function'||typeof afterCommit!=='function')
  throw TypeError('V120 requires disposable SQL audit and fixture clock');
 const queues=new Map(),clocks=new Map();
 function now(scope){
  let t;try{t=getFixtureNow();}catch{fail('EXPORT_REVOCATION_CLOCK_UNAVAILABLE');}
  const key=scope.organization_id+'|'+scope.incident_id;
  if(!Number.isSafeInteger(t)||t<1||t<(clocks.get(key)||0))
   fail('EXPORT_REVOCATION_CLOCK_ROLLBACK');
  clocks.set(key,t);return t;
 }
 async function inspect(input={}){
  if(!exact(input,INPUT))return deny('EXPORT_REVOCATION_SCOPE_INVALID');
  const {manifest_sequence,...scope}=input;
  if(!scoped(scope)||!Number.isSafeInteger(manifest_sequence)||
   manifest_sequence<1||manifest_sequence>128)
   return deny('EXPORT_REVOCATION_SCOPE_INVALID');
  try{
   const head=await ledger.head(scope);
   if(head===null)return deny('BLOCKED_NO_REVOCATION_AUDIT');
   const event=await ledger.event(scope,head.sequence);
   if(!exact(event,AUDIT)||sha(event)!==head.event_digest||
    event.status!=='HOLD_ACTIVE_EXPORT_REVOCATION_AUDIT_ONLY'||
    !Number.isSafeInteger(head.revoked_export_count)||head.revoked_export_count<0)
    fail('EXPORT_REVOCATION_AUDIT_INTEGRITY_FAILED');
   return deny('BLOCKED_REVOCATION_AUDIT_HISTORY_RETAINED',{
    audit_sequence:head.sequence,revoked_export_count:head.revoked_export_count,
    last_classification:event.classification});
  }catch(e){return deny(typeof e?.code==='string'&&e.code.length<128?
   e.code:'EXPORT_REVOCATION_DEPENDENCY_UNAVAILABLE');}
 }
 async function observe(input={}){
  if(!exact(input,INPUT))return deny('EXPORT_REVOCATION_SCOPE_INVALID');
  const {manifest_sequence,...scope}=input;
  if(!scoped(scope)||!Number.isSafeInteger(manifest_sequence)||
   manifest_sequence<1||manifest_sequence>128)
   return deny('EXPORT_REVOCATION_SCOPE_INVALID');
  const key=scope.organization_id+'|'+scope.incident_id;
  const earlier=queues.get(key)||Promise.resolve();
  const work=earlier.catch(()=>{}).then(async()=>{
   try{
    const result=await ledger.observe(scope,manifest_sequence,now(scope));
    if(!exact(result,['accepted','sequence','event_digest','reason_code',
      'classification','revocation_recorded','source_snapshot_digest'])||
     result.accepted!==true||
     result.reason_code!=='FIXTURE_EXPORT_OBSERVATION_APPENDED'||
     !Number.isSafeInteger(result.sequence)||result.sequence<1||
     !SHA.test(result.event_digest)||!SHA.test(result.source_snapshot_digest)||
     !['REVOKED_PREVIOUSLY','REVOKED_SUPERSEDED_BY_LATER_EXPORT',
       'REVOKED_SOURCE_CHANGED_AFTER_EXPORT',
       'CURRENT_FIXTURE_SNAPSHOT_STILL_UNAUTHORIZED'].includes(
        result.classification)||
     typeof result.revocation_recorded!=='boolean')
     fail('EXPORT_REVOCATION_REPLAY_OR_UNKNOWN_COMMIT');
    await afterCommit({scope,manifest_sequence,classification:result.classification});
    const [head,event,latest]=await Promise.all([
     ledger.head(scope),ledger.event(scope,result.sequence),
     ledger.capture(scope,now(scope))
    ]);
    if(!head||head.sequence!==result.sequence||
     head.event_digest!==result.event_digest||
     !exact(event,AUDIT)||sha(event)!==result.event_digest||
     event.status!=='HOLD_ACTIVE_EXPORT_REVOCATION_AUDIT_ONLY')
     fail('EXPORT_REVOCATION_COMMIT_READBACK_UNVERIFIED');
    if(latest.source_snapshot_digest!==result.source_snapshot_digest)
     return deny('BLOCKED_EXPORT_OBSERVATION_SOURCE_CHANGED_AFTER_COMMIT',{
      fixture_export_observation_recorded:true,
      audit_sequence:result.sequence,classification:result.classification,
      revocation_recorded:result.revocation_recorded});
    return deny('BLOCKED_FIXTURE_EXPORT_REVOCATION_AUDITED',{
     fixture_export_observation_recorded:true,
     audit_sequence:result.sequence,classification:result.classification,
     revocation_recorded:result.revocation_recorded,
     observed_source_digest:result.source_snapshot_digest});
   }catch(e){return deny(typeof e?.code==='string'&&e.code.length<128?
    e.code:'EXPORT_REVOCATION_DEPENDENCY_UNAVAILABLE');}
  });
  queues.set(key,work);
  try{return await work;}finally{if(queues.get(key)===work)queues.delete(key);}
 }
 return Object.freeze({observe,inspect});
}
