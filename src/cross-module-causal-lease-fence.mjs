// V3.2-109 CI-only signed causal lease observation.
// A fixture lease, SQL row, or signature never authorizes real handoff.
import {createHash,createPublicKey,verify as edVerify} from 'node:crypto';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{64}$/;
const ID=/^[a-z0-9][a-z0-9._:-]{5,127}$/;
const DOMAIN=['sales','finance','academic'];
const CLAIM=['schema_version','organization_id','incident_id','lease_id','holder_id',
 'barrier_epoch','source_watermark_digest','revocation_sequence','revocation_digest',
 'issued_at_ms','expires_at_ms','fixture_only'];
const STATUS=['schema_version','organization_id','incident_id','lease_id',
 'barrier_epoch','state','observed_at_ms','fixture_only'];
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
const exact=(x,keys)=>plain(x)&&Object.keys(x).length===keys.length&&
 keys.every(k=>Object.hasOwn(x,k));
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const message=(p,fields)=>Object.fromEntries(fields.map(k=>[k,p[k]]));
const denied=(reason_code,extra={})=>Object.freeze({
 reason_code,fixture_lease_observation_current:false,
 external_authority_verified:false,finance_authorized:false,
 academic_authorized:false,handoff_allowed:false,compensation_write_allowed:false,
 release_eligible:false,hold_active:true,production_integration_allowed:false,...extra
});
const problem=code=>{const e=new Error(code);e.code=code;throw e;};

function checkSig(x,fields,key,code){
 if(!exact(x,[...fields,'signature'])||typeof x.signature!=='string')
  problem(code);
 let b;
 try{b=Buffer.from(x.signature,'base64url');}
 catch{problem(code);}
 if(b.length!==64||b.toString('base64url')!==x.signature||
  !edVerify(null,Buffer.from(JSON.stringify(message(x,fields))),key,b))
  problem(code);
 return message(x,fields);
}
function verifyCheckpoint(s,w,c){
 if(!plain(w)||!plain(c)||w.organization_id!==s.organization_id||
  w.incident_id!==s.incident_id||c.organization_id!==s.organization_id||
  c.incident_id!==s.incident_id||c.schema_version!=='v3.2-104-ci-fence-v1'||
  !exact(c.domains,DOMAIN)||!exact(c.active_key_ids,DOMAIN)||
  !SHA.test(w.evidence_digest)||!SHA.test(w.revocation_digest))
  problem('CAUSAL_CHECKPOINT_UNVERIFIED');
 const values=DOMAIN.map(d=>{
  const v=c.domains[d];
  if(!exact(v,['source_epoch','source_revision','evidence_digest'])||
   !SHA.test(v.evidence_digest)||!Number.isSafeInteger(v.source_epoch)||
   !Number.isSafeInteger(v.source_revision)||typeof c.active_key_ids[d]!=='string')
   problem('CAUSAL_CHECKPOINT_UNVERIFIED');
  return {domain:d,key_id:c.active_key_ids[d],
   source_revision:v.source_revision,evidence_digest:v.evidence_digest};
 });
 if(w.source_epoch!==c.domains.sales.source_epoch||
  DOMAIN.some(d=>c.domains[d].source_epoch!==w.source_epoch)||
  w.source_revision!==Math.max(...values.map(x=>x.source_revision))||
  w.revocation_sequence!==c.revocation_sequence||
  w.revocation_digest!==c.revocation_digest||
  w.incident_generation!==c.incident_generation||
  w.evidence_digest!==sha(values))
  problem('CAUSAL_CHECKPOINT_UNVERIFIED');
}
export function createIsolatedCausalLeaseFence({
 sourceTrustFence,checkpointStore,leaseAuthority,leaseLedger,
 fixtureLeasePublicKey,getFixtureNow,afterBind=async()=>{},
 afterFirstConfirmation=async()=>{}
}={}){
 if(!sourceTrustFence||typeof sourceTrustFence.getFixtureWatermark!=='function'||
  !checkpointStore||typeof checkpointStore.read!=='function'||
  !leaseAuthority||typeof leaseAuthority.issue!=='function'||
  typeof leaseAuthority.inspect!=='function'||
  !leaseLedger||typeof leaseLedger.bind!=='function'||
  typeof leaseLedger.read!=='function'||typeof fixtureLeasePublicKey!=='string'||
  typeof getFixtureNow!=='function'||typeof afterBind!=='function'||
  typeof afterFirstConfirmation!=='function')
  throw TypeError('Independent fixture sources, signed lease issuer and isolated SQL ledger required');
 const key=createPublicKey(fixtureLeasePublicKey);
 if(key.asymmetricKeyType!=='ed25519')
  throw TypeError('Fixture lease issuer must use pinned Ed25519 key');
 const queues=new Map(),clockHigh=new Map();
 function now(s){
  const t=getFixtureNow();
  if(!Number.isSafeInteger(t)||t<=0||t<(clockHigh.get(s)||0))
   problem('LEASE_CLOCK_UNVERIFIED');
  clockHigh.set(s,t);return t;
 }
 function claim(raw,s,w){
  const x=checkSig(raw,CLAIM,key,'LEASE_ISSUANCE_SIGNATURE_INVALID');
  const t=now(s.organization_id+'|'+s.incident_id);
  if(x.schema_version!=='v3.2-109-ci-lease-claim-v1'||
   x.organization_id!==s.organization_id||x.incident_id!==s.incident_id||
   !ID.test(x.lease_id)||!ID.test(x.holder_id)||
   !Number.isSafeInteger(x.barrier_epoch)||x.barrier_epoch<1||
   x.source_watermark_digest!==sha(w)||x.revocation_sequence!==w.revocation_sequence||
   x.revocation_digest!==w.revocation_digest||x.fixture_only!==true||
   !Number.isSafeInteger(x.issued_at_ms)||!Number.isSafeInteger(x.expires_at_ms)||
   x.issued_at_ms>t||x.expires_at_ms<=t||
   x.expires_at_ms-x.issued_at_ms>30000||
   x.expires_at_ms-x.issued_at_ms<1)
   problem('LEASE_ISSUANCE_SCOPE_EPOCH_OR_EXPIRY_INVALID');
  return x;
 }
 async function observation(s,x,expectedWatermarkDigest){
  const raw=await leaseAuthority.inspect({scope:s,lease_id:x.lease_id});
  const status=checkSig(raw,STATUS,key,'LEASE_STATUS_SIGNATURE_INVALID');
  const t=now(s.organization_id+'|'+s.incident_id);
  if(status.schema_version!=='v3.2-109-ci-lease-status-v1'||
   status.organization_id!==s.organization_id||status.incident_id!==s.incident_id||
   status.lease_id!==x.lease_id||status.barrier_epoch!==x.barrier_epoch||
   status.state!=='active'||status.fixture_only!==true||
   !Number.isSafeInteger(status.observed_at_ms)||
   status.observed_at_ms>t||status.observed_at_ms<x.issued_at_ms||
   t>=x.expires_at_ms)
   problem('LEASE_REVOKED_EXPIRED_OR_FENCED');
  const row=await leaseLedger.read(s);
  if(!exact(row,['schema_version','organization_id','incident_id','lease_id',
   'holder_id','barrier_epoch','source_watermark_digest','lease_digest',
   'expires_at_ms','observed_at_ms','state'])||
   row.schema_version!=='v3.2-109-ci-lease-ledger-v1'||
   row.organization_id!==s.organization_id||row.incident_id!==s.incident_id||
   row.lease_id!==x.lease_id||row.holder_id!==x.holder_id||
   row.barrier_epoch!==x.barrier_epoch||
   row.source_watermark_digest!==expectedWatermarkDigest||
   row.lease_digest!==sha(x)||row.expires_at_ms!==x.expires_at_ms||
   row.state!=='active'||row.observed_at_ms>t)
   problem('LEASE_SQL_FENCE_LOST_OR_UNVERIFIED');
  const w=await sourceTrustFence.getFixtureWatermark(s.organization_id,s.incident_id);
  const checkpoint=await checkpointStore.read(s);
  verifyCheckpoint(s,w,checkpoint);
  if(sha(w)!==expectedWatermarkDigest||
   w.revocation_sequence!==x.revocation_sequence||
   w.revocation_digest!==x.revocation_digest)
   problem('LEASE_SOURCE_WATERMARK_CHANGED');
  if(now(s.organization_id+'|'+s.incident_id)>=x.expires_at_ms)
   problem('LEASE_REVOKED_EXPIRED_OR_FENCED');
  return {status_digest:sha(status),watermark_digest:sha(w)};
 }
 async function inspect(input={}){
  if(!exact(input,['organization_id','incident_id'])||
   !UUID.test(input.organization_id)||!UUID.test(input.incident_id))
   return denied('INVALID_CAUSAL_LEASE_SCOPE');
  const s={organization_id:input.organization_id.toLowerCase(),
   incident_id:input.incident_id.toLowerCase()};
  const k=s.organization_id+'|'+s.incident_id;
  const prev=queues.get(k)||Promise.resolve();
  const run=prev.catch(()=>{}).then(async()=>{
   try{
    now(k);
    // The source fence advances ONLY an isolated audit checkpoint in SQL.
    const w=await sourceTrustFence.getFixtureWatermark(s.organization_id,s.incident_id);
    verifyCheckpoint(s,w,await checkpointStore.read(s));
    const issued=await leaseAuthority.issue({scope:s,
     source_watermark_digest:sha(w)});
    const x=claim(issued,s,w);
    const bound={schema_version:'v3.2-109-ci-lease-ledger-v1',...s,
     lease_id:x.lease_id,holder_id:x.holder_id,barrier_epoch:x.barrier_epoch,
     source_watermark_digest:x.source_watermark_digest,
     lease_digest:sha(x),expires_at_ms:x.expires_at_ms,observed_at_ms:now(k),
     state:'active'};
    const result=await leaseLedger.bind(s,bound);
    if(!exact(result,['accepted','lease_digest','reason_code'])||
     result.lease_digest!==sha(bound)||
     result.accepted!==true||result.reason_code!=='LEASE_FENCE_BOUND')
     problem('LEASE_SQL_BIND_REJECTED_OR_UNVERIFIED');
    await afterBind();
    const first=await observation(s,x,sha(w));
    await afterFirstConfirmation();
    const second=await observation(s,x,sha(w));
    if(first.status_digest!==second.status_digest||
     first.watermark_digest!==second.watermark_digest)
     problem('LEASE_CONFIRMATION_CHANGED');
    return denied('BLOCKED_CI_CAUSAL_LEASE_OBSERVATION_NO_EXTERNAL_AUTHORITY',{
     fixture_lease_observation_current:true,
     lease_id:x.lease_id,barrier_epoch:x.barrier_epoch,
     observed_source_digest:sha(w),observation_digest:sha(second)});
   }catch(e){
    return denied(typeof e?.code==='string'&&e.code.length<=128?
     e.code:'LEASE_DEPENDENCY_UNAVAILABLE');
   }
  });
  queues.set(k,run);
  try{return await run;}
  finally{if(queues.get(k)===run)queues.delete(k);}
 }
 return Object.freeze({inspect});
}
