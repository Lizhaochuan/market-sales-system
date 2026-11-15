// V3.2-102: isolated, fixture-signed read-only source boundary.
// Ephemeral test keys prove only fixture origin, NEVER financial/academic authorization.
import {createHash,createPublicKey,verify as verifySignature} from 'node:crypto';

const DOMAINS=Object.freeze(['sales','finance','academic']);
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const PAYLOAD_FIELDS=Object.freeze([
 'schema_version','domain','organization_id','incident_id',
 'source_epoch','source_revision','revocation_sequence','revocation_digest',
 'incident_generation','evidence_digest','issued_at_ms','expires_at_ms','fixture_only'
]);
const exact=(x,fields)=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null)&&
 Object.keys(x).length===fields.length&&fields.every(k=>Object.hasOwn(x,k));
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const problem=code=>{const e=new Error(code);e.code=code;throw e;};
const denied=(reason_code,more={})=>Object.freeze({
 reason_code,fixture_signed_sources_consistent:false,
 external_authority_verified:false,finance_authorized:false,
 academic_authorized:false,handoff_allowed:false,
 compensation_write_allowed:false,release_eligible:false,hold_active:true,
 production_integration_allowed:false,...more
});
function payloadOf(x){
 const obj={};
 for(const k of PAYLOAD_FIELDS)obj[k]=x[k];
 return obj;
}
function scoped(org,incident){
 if(typeof org!=='string'||typeof incident!=='string'||
  !UUID.test(org)||!UUID.test(incident))problem('INVALID_SOURCE_SCOPE');
 return {organization_id:org.toLowerCase(),incident_id:incident.toLowerCase()};
}
function timeoutRead(reader,scope,timeoutMs){
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Object.assign(
   new Error('FIXTURE_SOURCE_TIMEOUT'),{code:'FIXTURE_SOURCE_TIMEOUT'})),timeoutMs);
  Promise.resolve().then(()=>reader(scope)).then(
   value=>{clearTimeout(timer);resolve(value);},
   ()=>{clearTimeout(timer);reject(Object.assign(
    new Error('FIXTURE_SOURCE_UNAVAILABLE'),{code:'FIXTURE_SOURCE_UNAVAILABLE'}));}
  );
 });
}
/**
 * Source keys are injected ephemeral, pinned CI fixtures, not a production
 * trust root. No real external signing credentials or permissions are used.
 */
export function createIsolatedSignedSourceContract({
 readers,fixturePublicKeys,getFixtureNow,timeoutMs=1000
}={}){
 if(!exact(readers,DOMAINS)||!DOMAINS.every(d=>typeof readers[d]==='function')||
  !exact(fixturePublicKeys,DOMAINS)||!DOMAINS.every(d=>
   typeof fixturePublicKeys[d]==='string')||
  typeof getFixtureNow!=='function'||
  !Number.isSafeInteger(timeoutMs)||timeoutMs<10||timeoutMs>10000)
  throw TypeError('Three isolated readers, pinned fixture keys and test clock are required');
 const keys={};
 for(const domain of DOMAINS){
  const key=createPublicKey(fixturePublicKeys[domain]);
  if(key.asymmetricKeyType!=='ed25519')
   throw TypeError('Only fixture Ed25519 source keys are supported');
  keys[domain]=key;
 }
 const seen=new Map(),lastClock=new Map(),queues=new Map();
 function now(k){
  let t;
  try{t=getFixtureNow();}catch{problem('FIXTURE_SOURCE_CLOCK_UNAVAILABLE');}
  if(!Number.isSafeInteger(t)||t<=0||t<(lastClock.get(k)||0))
   problem('FIXTURE_SOURCE_CLOCK_ROLLBACK');
  lastClock.set(k,t);return t;
 }
 function checkOne(x,domain,scope,t){
  if(!exact(x,[...PAYLOAD_FIELDS,'signature'])||
   x.schema_version!=='v3.2-102-ci-source-proof-v1'||
   x.domain!==domain||x.fixture_only!==true||
   x.organization_id!==scope.organization_id||
   x.incident_id!==scope.incident_id||
   !Number.isSafeInteger(x.source_epoch)||x.source_epoch<1||
   !Number.isSafeInteger(x.source_revision)||x.source_revision<1||
   !Number.isSafeInteger(x.revocation_sequence)||x.revocation_sequence<0||
   !Number.isSafeInteger(x.incident_generation)||x.incident_generation<1||
   !SHA.test(x.revocation_digest)||!SHA.test(x.evidence_digest)||
   !Number.isSafeInteger(x.issued_at_ms)||!Number.isSafeInteger(x.expires_at_ms)||
   x.issued_at_ms>t||x.expires_at_ms<=t||
   x.expires_at_ms<=x.issued_at_ms||
   x.expires_at_ms-x.issued_at_ms>300000||
   typeof x.signature!=='string'||!x.signature.match(/^[A-Za-z0-9_-]+$/))
   problem('FIXTURE_SOURCE_ENVELOPE_INVALID_OR_EXPIRED');
  let signature;
  try{signature=Buffer.from(x.signature,'base64url');}
  catch{problem('FIXTURE_SOURCE_SIGNATURE_INVALID');}
  if(signature.length!==64||signature.toString('base64url')!==x.signature||
   !verifySignature(null,Buffer.from(JSON.stringify(payloadOf(x))),keys[domain],signature))
   problem('FIXTURE_SOURCE_SIGNATURE_INVALID');
  return Object.freeze(payloadOf(x));
 }
 function checkMonotone(current,scope){
  for(const x of current){
   const k=scope.organization_id+'|'+scope.incident_id+'|'+x.domain;
   const before=seen.get(k);
   if(!before)continue;
   if(x.source_epoch<before.source_epoch||
    (x.source_epoch===before.source_epoch&&x.source_revision<before.source_revision)||
    x.revocation_sequence<before.revocation_sequence||
    x.incident_generation<before.incident_generation)
    problem('FIXTURE_SOURCE_VERSION_ROLLBACK');
   if(x.revocation_sequence===before.revocation_sequence&&
    x.revocation_digest!==before.revocation_digest)
    problem('FIXTURE_REVOCATION_DIGEST_EQUIVOCATION');
   if(x.source_epoch===before.source_epoch&&
    x.source_revision===before.source_revision&&
    x.evidence_digest!==before.evidence_digest)
    problem('FIXTURE_SOURCE_SAME_VERSION_EQUIVOCATION');
  }
  for(const x of current)
   seen.set(scope.organization_id+'|'+scope.incident_id+'|'+x.domain,x);
 }
 async function collect(scope){
  const sk=scope.organization_id+'|'+scope.incident_id;
  now(sk);
  const envelopes=await Promise.all(DOMAINS.map(d=>
   timeoutRead(readers[d],scope,timeoutMs)));
  const t=now(sk);
  const docs=DOMAINS.map((d,i)=>checkOne(envelopes[i],d,scope,t));
  const [first]=docs;
  if(docs.some(x=>x.source_epoch!==first.source_epoch||
    x.revocation_sequence!==first.revocation_sequence||
    x.revocation_digest!==first.revocation_digest||
    x.incident_generation!==first.incident_generation))
   problem('FIXTURE_CROSS_DOMAIN_WATERMARK_CONFLICT');
  checkMonotone(docs,scope);
  return Object.freeze({
   organization_id:scope.organization_id,incident_id:scope.incident_id,
   source_epoch:first.source_epoch,
   source_revision:Math.max(...docs.map(x=>x.source_revision)),
   revocation_sequence:first.revocation_sequence,
   revocation_digest:first.revocation_digest,
   incident_generation:first.incident_generation,
   evidence_digest:sha(docs.map(x=>({domain:x.domain,
    source_epoch:x.source_epoch,source_revision:x.source_revision,
    evidence_digest:x.evidence_digest})))
  });
 }
 async function verifiedWatermark(org,incident){
  const scope=scoped(org,incident),sk=scope.organization_id+'|'+scope.incident_id;
  const prev=queues.get(sk)||Promise.resolve();
  const run=prev.catch(()=>{}).then(async()=>{
   const first=await collect(scope),second=await collect(scope);
   if(sha(first)!==sha(second))problem('FIXTURE_SOURCE_CHANGED_BETWEEN_READS');
   return second;
  });
  queues.set(sk,run);
  try{return await run;}
  finally{if(queues.get(sk)===run)queues.delete(sk);}
 }
 async function inspect({organization_id,incident_id}={}){
  try{
   const current=await verifiedWatermark(organization_id,incident_id);
   return denied('BLOCKED_FIXTURE_SIGNED_SOURCES_NO_EXTERNAL_AUTHORITY',{
    fixture_signed_sources_consistent:true,
    source_watermark_digest:sha(current),source_revision:current.source_revision});
  }catch(e){return denied(e?.code||'FIXTURE_SOURCE_DEPENDENCY_UNAVAILABLE');}
 }
 return Object.freeze({getFixtureWatermark:verifiedWatermark,inspect});
}
