// V3.2-108 — CI-only signed-source / SQL post-commit recheck.
// Repeated observations cannot create an atomic cross-service snapshot.
import {createHash} from 'node:crypto';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const DOMAINS=['sales','finance','academic'];
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
const exact=(x,keys)=>plain(x)&&Object.keys(x).length===keys.length&&
 keys.every(k=>Object.hasOwn(x,k));
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const deny=(reason_code,more={})=>Object.freeze({
 reason_code,fixture_postcommit_stable:false,
 external_authority_verified:false,finance_authorized:false,
 academic_authorized:false,handoff_allowed:false,
 compensation_write_allowed:false,release_eligible:false,
 hold_active:true,production_integration_allowed:false,...more
});
const fault=reason=>{const err=new Error(reason);err.code=reason;throw err;};
function validatePersisted(w,p,s){
 if(!plain(w)||!plain(p)||p.schema_version!=='v3.2-104-ci-fence-v1'||
  p.organization_id!==s.organization_id||p.incident_id!==s.incident_id||
  w.organization_id!==s.organization_id||w.incident_id!==s.incident_id||
  !exact(p.active_key_ids,DOMAINS)||!exact(p.domains,DOMAINS)||
  !SHA.test(p.roster_digest)||!SHA.test(p.revocation_digest)||
  !SHA.test(w.revocation_digest)||!SHA.test(w.evidence_digest))
  fault('POSTCOMMIT_PERSISTED_CHECKPOINT_INVALID');
 const values=DOMAINS.map(d=>{
  const v=p.domains[d];
  if(!exact(v,['source_epoch','source_revision','evidence_digest'])||
   !Number.isSafeInteger(v.source_epoch)||v.source_epoch<1||
   !Number.isSafeInteger(v.source_revision)||v.source_revision<1||
   !SHA.test(v.evidence_digest)||
   typeof p.active_key_ids[d]!=='string')
   fault('POSTCOMMIT_PERSISTED_CHECKPOINT_INVALID');
  return {domain:d,key_id:p.active_key_ids[d],
   source_revision:v.source_revision,evidence_digest:v.evidence_digest};
 });
 if(w.source_epoch!==p.domains.sales.source_epoch||
  !DOMAINS.every(d=>p.domains[d].source_epoch===w.source_epoch)||
  w.source_revision!==Math.max(...DOMAINS.map(d=>p.domains[d].source_revision))||
  w.revocation_sequence!==p.revocation_sequence||
  w.revocation_digest!==p.revocation_digest||
  w.incident_generation!==p.incident_generation||
  w.evidence_digest!==hash(values))
  fault('POSTCOMMIT_PERSISTED_SOURCE_MISMATCH');
 return hash(p);
}
export function createIsolatedPostCommitCausalRecheck({
 sourceTrustFence,checkpointStore,
 afterFirstCommit=async()=>{},afterSecondCommit=async()=>{}
}={}){
 if(!sourceTrustFence||typeof sourceTrustFence.getFixtureWatermark!=='function'||
  !checkpointStore||typeof checkpointStore.read!=='function'||
  typeof afterFirstCommit!=='function'||typeof afterSecondCommit!=='function')
  throw TypeError('CI-only signed source fence and isolated checkpoint reader required');
 const queues=new Map();
 async function inspect(input={}){
  if(!exact(input,['organization_id','incident_id'])||
   !UUID.test(input.organization_id)||!UUID.test(input.incident_id))
   return deny('INVALID_POSTCOMMIT_SCOPE');
  const s={organization_id:input.organization_id.toLowerCase(),
   incident_id:input.incident_id.toLowerCase()};
  const key=s.organization_id+'|'+s.incident_id;
  const previous=queues.get(key)||Promise.resolve();
  const task=previous.catch(()=>{}).then(async()=>{
   const observe=async()=>{
    // The source-trust fence itself performs signed double reads and a SQL
    // checkpoint advance; this is NOT a side-effect-free read.
    const watermark=await sourceTrustFence.getFixtureWatermark(
     s.organization_id,s.incident_id);
    const persisted=await checkpointStore.read(s);
    const persisted_digest=validatePersisted(watermark,persisted,s);
    return {watermark_digest:hash(watermark),persisted_digest};
   };
   try{
    const first=await observe();
    await afterFirstCommit();
    const second=await observe();
    if(first.watermark_digest!==second.watermark_digest||
     first.persisted_digest!==second.persisted_digest)
     return deny('POSTCOMMIT_SOURCE_OR_CHECKPOINT_CHANGED');
    await afterSecondCommit();
    const third=await observe();
    if(second.watermark_digest!==third.watermark_digest||
     second.persisted_digest!==third.persisted_digest)
     return deny('POSTCOMMIT_SOURCE_OR_CHECKPOINT_CHANGED');
    return deny('BLOCKED_CI_POSTCOMMIT_OBSERVATION_STABLE_NO_AUTHORITY',{
     fixture_postcommit_stable:true,observation_digest:hash(third)});
   }catch(e){
    return deny('POSTCOMMIT_SOURCE_OR_DATABASE_UNVERIFIED',{
     failure_code:typeof e?.code==='string'&&e.code.length<=128?
      e.code:'DEPENDENCY_FAILED'});
   }
  });
  queues.set(key,task);
  try{return await task;}
  finally{if(queues.get(key)===task)queues.delete(key);}
 }
 return Object.freeze({inspect});
}
