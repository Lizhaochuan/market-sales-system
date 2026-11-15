// V3.2-104 — test-only trust roster and checkpoint-fence interface.
// Signed fixture metadata and a simulated store are NOT production authorization.
import {createHash,createPublicKey,verify as verifySignature} from 'node:crypto';

const DOMAINS=Object.freeze(['sales','finance','academic']);
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const KEY_ID=/^[a-z0-9][a-z0-9._:-]{5,127}$/;
const ROSTER_FIELDS=['schema_version','organization_id','revision','issued_at_ms',
 'expires_at_ms','keys','revocations','fixture_only'];
const SOURCE_FIELDS=['schema_version','domain','organization_id','incident_id',
 'key_id','trust_revision','source_epoch','source_revision',
 'incident_generation','revocation_sequence','revocation_digest',
 'evidence_digest','issued_at_ms','expires_at_ms','fixture_only'];
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
const exact=(x,keys)=>plain(x)&&Object.keys(x).length===keys.length&&
 keys.every(k=>Object.hasOwn(x,k));
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const payload=(x,fields)=>Object.fromEntries(fields.map(k=>[k,x[k]]));
const fault=code=>{const e=new Error(code);e.code=code;throw e;};
const block=(reason_code,extra={})=>Object.freeze({
 reason_code,fixture_trust_checkpoint_current:false,
 external_authority_verified:false,finance_authorized:false,
 academic_authorized:false,handoff_allowed:false,
 compensation_write_allowed:false,release_eligible:false,
 hold_active:true,production_integration_allowed:false,...extra});
const scopeOf=(organization_id,incident_id)=>{
 if(typeof organization_id!=='string'||typeof incident_id!=='string'||
 !UUID.test(organization_id)||!UUID.test(incident_id))fault('TRUST_SCOPE_INVALID');
 return Object.freeze({organization_id:organization_id.toLowerCase(),
  incident_id:incident_id.toLowerCase()});
};
async function timed(fn,arg,ms){
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Object.assign(new Error('TRUST_SOURCE_TIMEOUT'),
   {code:'TRUST_SOURCE_TIMEOUT'})),ms);
  Promise.resolve().then(()=>fn(arg)).then(x=>{clearTimeout(timer);resolve(x);},
   ()=>{clearTimeout(timer);reject(Object.assign(
    new Error('TRUST_SOURCE_UNAVAILABLE'),{code:'TRUST_SOURCE_UNAVAILABLE'}));});
 });
}
const validTime=(issued,expires,t)=>Number.isSafeInteger(issued)&&
 Number.isSafeInteger(expires)&&issued<=t&&expires>t&&expires>issued&&
 expires-issued<=300000;
function parseRoster(x,org,t,governanceKey){
 if(!exact(x,[...ROSTER_FIELDS,'signature'])||
  x.schema_version!=='v3.2-104-ci-trust-roster-v1'||
  x.organization_id!==org||x.fixture_only!==true||
  !Number.isSafeInteger(x.revision)||x.revision<1||
  !validTime(x.issued_at_ms,x.expires_at_ms,t)||
  !Array.isArray(x.keys)||x.keys.length<3||
  !Array.isArray(x.revocations)||typeof x.signature!=='string')
  fault('TRUST_ROSTER_INVALID');
 let signature;
 try{signature=Buffer.from(x.signature,'base64url');}
 catch{fault('TRUST_GOVERNANCE_SIGNATURE_INVALID');}
 if(signature.length!==64||signature.toString('base64url')!==x.signature||
  !verifySignature(null,Buffer.from(JSON.stringify(payload(x,ROSTER_FIELDS))),
   governanceKey,signature))fault('TRUST_GOVERNANCE_SIGNATURE_INVALID');
 const revoked=new Map();
 for(let i=0;i<x.revocations.length;i++){
  const ev=x.revocations[i];
  if(!exact(ev,['domain','key_id','sequence','revoked_at_ms'])||
   !DOMAINS.includes(ev.domain)||!KEY_ID.test(ev.key_id)||
   ev.sequence!==i+1||!Number.isSafeInteger(ev.revoked_at_ms)||
   ev.revoked_at_ms>x.issued_at_ms||
   revoked.has(ev.key_id))fault('TRUST_REVOCATION_PROOF_INVALID');
  revoked.set(ev.key_id,ev);
 }
 const active=new Map(),allIds=new Set(),fingerprints=new Set();
 for(const entry of x.keys){
  if(!exact(entry,['domain','key_id','public_key_pem','status','activated_at_ms'])||
   !DOMAINS.includes(entry.domain)||!KEY_ID.test(entry.key_id)||
   typeof entry.public_key_pem!=='string'||allIds.has(entry.key_id)||
   !['active','revoked'].includes(entry.status)||
   !Number.isSafeInteger(entry.activated_at_ms)||
   entry.activated_at_ms>x.issued_at_ms)fault('TRUST_KEY_REGISTRY_INVALID');
  let key;
  try{key=createPublicKey(entry.public_key_pem);}
  catch{fault('TRUST_KEY_REGISTRY_INVALID');}
  if(key.asymmetricKeyType!=='ed25519')fault('TRUST_KEY_REGISTRY_INVALID');
  const fingerprint=hash(key.export({type:'spki',format:'der'}).toString('base64'));
  if(fingerprints.has(fingerprint))fault('TRUST_CROSS_DOMAIN_KEY_REUSE');
  fingerprints.add(fingerprint);allIds.add(entry.key_id);
  const proof=revoked.get(entry.key_id);
  if(entry.status==='active'){
   if(proof||active.has(entry.domain))fault('TRUST_ACTIVE_KEY_CONFLICT');
   active.set(entry.domain,{entry,key});
  }else if(!proof||proof.domain!==entry.domain||
   proof.revoked_at_ms<entry.activated_at_ms)
   fault('TRUST_REVOCATION_PROOF_MISSING');
 }
 if(active.size!==3||x.revocations.length!==x.keys.length-3||
  [...revoked.keys()].some(k=>!allIds.has(k)))
  fault('TRUST_ROSTER_INCOMPLETE');
 return {active,roster_digest:hash(payload(x,ROSTER_FIELDS)),
  revision:x.revision,revoked_key_ids:[...revoked.keys()].sort()};
}
function sourceProof(x,domain,scope,t,trust){
 const expected=trust.active.get(domain);
 if(!expected||!exact(x,[...SOURCE_FIELDS,'signature'])||
  x.schema_version!=='v3.2-104-ci-source-proof-v1'||
  x.domain!==domain||x.organization_id!==scope.organization_id||
  x.incident_id!==scope.incident_id||x.key_id!==expected.entry.key_id||
  x.trust_revision!==trust.revision||x.fixture_only!==true||
  !Number.isSafeInteger(x.source_epoch)||x.source_epoch<1||
  !Number.isSafeInteger(x.source_revision)||x.source_revision<1||
  !Number.isSafeInteger(x.incident_generation)||x.incident_generation<1||
  !Number.isSafeInteger(x.revocation_sequence)||x.revocation_sequence<0||
  !SHA.test(x.revocation_digest)||!SHA.test(x.evidence_digest)||
  !validTime(x.issued_at_ms,x.expires_at_ms,t)||
  x.issued_at_ms<expected.entry.activated_at_ms||
  typeof x.signature!=='string')
  fault('TRUST_SOURCE_ENVELOPE_INVALID');
 let sig;
 try{sig=Buffer.from(x.signature,'base64url');}
 catch{fault('TRUST_SOURCE_SIGNATURE_INVALID');}
 if(sig.length!==64||sig.toString('base64url')!==x.signature||
  !verifySignature(null,Buffer.from(JSON.stringify(payload(x,SOURCE_FIELDS))),
   expected.key,sig))fault('TRUST_SOURCE_SIGNATURE_INVALID');
 return payload(x,SOURCE_FIELDS);
}
export function createIsolatedSourceTrustFence({
 readTrustRoster,sourceReaders,governancePublicKey,
 checkpointStore,getFixtureNow,timeoutMs=1000
}={}){
 if(typeof readTrustRoster!=='function'||!exact(sourceReaders,DOMAINS)||
  !DOMAINS.every(d=>typeof sourceReaders[d]==='function')||
  typeof governancePublicKey!=='string'||
  !checkpointStore||typeof checkpointStore.advance!=='function'||
  typeof getFixtureNow!=='function'||
  !Number.isSafeInteger(timeoutMs)||timeoutMs<10||timeoutMs>10000)
  throw TypeError('Trusted fixture governance and atomic checkpoint adapter required');
 const governance=createPublicKey(governancePublicKey);
 if(governance.asymmetricKeyType!=='ed25519')
  throw TypeError('Fixture governance root must use Ed25519');
 const queues=new Map(),clockHigh=new Map();
 function now(sk){
  let t;
  try{t=getFixtureNow();}
  catch{fault('TRUST_CLOCK_UNAVAILABLE');}
  if(!Number.isSafeInteger(t)||t<1||t<(clockHigh.get(sk)||0))
   fault('TRUST_CLOCK_ROLLBACK');
  clockHigh.set(sk,t);
  return t;
 }
 async function observe(scope){
  const sk=scope.organization_id+'|'+scope.incident_id,t=now(sk);
  const roster=await timed(readTrustRoster,scope,timeoutMs);
  const trust=parseRoster(roster,scope.organization_id,t,governance);
  const proofs=await Promise.all(DOMAINS.map(d=>timed(sourceReaders[d],scope,timeoutMs)));
  const t2=now(sk);
  const sources=DOMAINS.map((d,i)=>sourceProof(proofs[i],d,scope,t2,trust));
  const before=sources[0];
  if(sources.some(s=>s.source_epoch!==before.source_epoch||
   s.incident_generation!==before.incident_generation||
   s.revocation_sequence!==before.revocation_sequence||
   s.revocation_digest!==before.revocation_digest))
   fault('TRUST_CROSS_DOMAIN_CAUSAL_CONFLICT');
  const after=await timed(readTrustRoster,scope,timeoutMs);
  const last=parseRoster(after,scope.organization_id,now(sk),governance);
  if(last.roster_digest!==trust.roster_digest)
   fault('TRUST_ROSTER_CHANGED_DURING_READ');
  const watermark={...scope,source_epoch:before.source_epoch,
   source_revision:Math.max(...sources.map(s=>s.source_revision)),
   revocation_sequence:before.revocation_sequence,
   revocation_digest:before.revocation_digest,
   incident_generation:before.incident_generation,
   evidence_digest:hash(sources.map(s=>({domain:s.domain,key_id:s.key_id,
    source_revision:s.source_revision,evidence_digest:s.evidence_digest})))};
  const checkpoint={schema_version:'v3.2-104-ci-fence-v1',...scope,
   trust_revision:trust.revision,roster_digest:trust.roster_digest,
   active_key_ids:Object.fromEntries(DOMAINS.map(d=>[d,trust.active.get(d).entry.key_id])),
   revoked_key_ids:trust.revoked_key_ids,
   domains:Object.fromEntries(sources.map(s=>[s.domain,{
    source_epoch:s.source_epoch,source_revision:s.source_revision,
    evidence_digest:s.evidence_digest}])),
   revocation_sequence:before.revocation_sequence,
   revocation_digest:before.revocation_digest,
   incident_generation:before.incident_generation,
   observed_at_ms:now(sk)};
  return {watermark,checkpoint};
 }
 async function getFixtureWatermark(org,incident){
  const scope=scopeOf(org,incident),sk=scope.organization_id+'|'+scope.incident_id;
  const previous=queues.get(sk)||Promise.resolve();
  const task=previous.catch(()=>{}).then(async()=>{
   const first=await observe(scope);
   const second=await observe(scope);
   if(hash(first.watermark)!==hash(second.watermark)||
    first.checkpoint.roster_digest!==second.checkpoint.roster_digest)
    fault('TRUST_SOURCE_CHANGED_BETWEEN_READS');
   // This delegate MUST be a real atomic, durable compare-and-advance in production.
   // A shared in-memory mock exercises its contract only; it proves no persistence.
   let result;
   try{result=await checkpointStore.advance(scope,second.checkpoint);}
   catch{fault('TRUST_CHECKPOINT_STORE_UNAVAILABLE');}
   if(!exact(result,['accepted','checkpoint_digest','reason_code'])||
    result.checkpoint_digest!==hash(second.checkpoint))
    fault('TRUST_CHECKPOINT_STORE_UNVERIFIED');
   if(result.accepted!==true||result.reason_code!=='CHECKPOINT_ACCEPTED')
    fault('TRUST_CHECKPOINT_REJECTED_OR_ROLLED_BACK');
   return Object.freeze(second.watermark);
  });
  queues.set(sk,task);
  try{return await task;}
  finally{if(queues.get(sk)===task)queues.delete(sk);}
 }
 async function inspect({organization_id,incident_id}={}){
  try{
   const w=await getFixtureWatermark(organization_id,incident_id);
   return block('BLOCKED_FIXTURE_TRUST_FENCE_NO_EXTERNAL_AUTHORITY',{
    fixture_trust_checkpoint_current:true,watermark_digest:hash(w)});
  }catch(e){return block(e?.code||'TRUST_BOUNDARY_UNAVAILABLE');}
 }
 return Object.freeze({getFixtureWatermark,inspect});
}
