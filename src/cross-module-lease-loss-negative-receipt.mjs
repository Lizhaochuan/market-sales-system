// V3.2-110: CI-only signed lease-loss notice and NEGATIVE receipt verifier.
// No real source authority, irreversible handoff or production authorization.
import {createHash,createPublicKey,verify as verifySignature} from 'node:crypto';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const ID=/^[a-z0-9][a-z0-9._:-]{5,127}$/;
const NOTICE=['schema_version','organization_id','incident_id','lease_id',
 'barrier_epoch','source_watermark_digest','notification_sequence',
 'previous_notification_digest','notification_kind','observed_at_ms','fixture_only'];
const RECEIPT=['schema_version','organization_id','incident_id','lease_id',
 'barrier_epoch','notification_sequence','notification_digest','disposition',
 'observed_at_ms','fixture_only'];
const exact=(x,fields)=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null)&&
 Object.keys(x).length===fields.length&&fields.every(k=>Object.hasOwn(x,k));
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const payload=(x,fields)=>Object.fromEntries(fields.map(k=>[k,x[k]]));
const fail=c=>{const e=new Error(c);e.code=c;throw e;};
const deny=(reason_code,extra={})=>Object.freeze({
 reason_code,fixture_negative_receipt_current:false,
 external_authority_verified:false,finance_authorized:false,
 academic_authorized:false,handoff_allowed:false,compensation_write_allowed:false,
 release_eligible:false,hold_active:true,production_integration_allowed:false,...extra});
function publicKey(p){
 const k=createPublicKey(p);
 if(k.asymmetricKeyType!=='ed25519')throw TypeError('Fixture Ed25519 public key required');
 return k;
}
function verified(x,fields,key,code){
 if(!exact(x,[...fields,'signature'])||typeof x.signature!=='string')fail(code);
 let sig;
 try{sig=Buffer.from(x.signature,'base64url');}catch{fail(code);}
 if(sig.length!==64||sig.toString('base64url')!==x.signature||
  !verifySignature(null,Buffer.from(JSON.stringify(payload(x,fields))),key,sig))fail(code);
 return payload(x,fields);
}
export function createIsolatedLeaseLossNegativeReceiptGate({
 causalLeaseFence,leaseLedger,noticeLedger,
 fetchSignedNotice,fetchSignedReceipt,
 fixtureNoticePublicKey,fixtureReceiptPublicKey,
 getFixtureNow,afterNoticeCommit=async()=>{}
}={}){
 if(!causalLeaseFence||typeof causalLeaseFence.inspect!=='function'||
  !leaseLedger||typeof leaseLedger.read!=='function'||
  !noticeLedger||typeof noticeLedger.head!=='function'||
  typeof noticeLedger.append!=='function'||
  typeof noticeLedger.event!=='function'||
  typeof fetchSignedNotice!=='function'||
  typeof fetchSignedReceipt!=='function'||
  typeof fixtureNoticePublicKey!=='string'||
  typeof fixtureReceiptPublicKey!=='string'||
  typeof getFixtureNow!=='function'||typeof afterNoticeCommit!=='function')
  throw TypeError('Independent signed fixture notices, receipts and isolated SQL ledgers required');
 const noticeKey=publicKey(fixtureNoticePublicKey);
 const receiptKey=publicKey(fixtureReceiptPublicKey);
 const noticeFinger=sha(noticeKey.export({type:'spki',format:'der'}).toString('base64'));
 const receiptFinger=sha(receiptKey.export({type:'spki',format:'der'}).toString('base64'));
 if(noticeFinger===receiptFinger)throw TypeError('Notification and receipt fixture keys must be distinct');
 const queues=new Map(),timeHigh=new Map();
 function now(scope){
  let t;
  try{t=getFixtureNow();}catch{fail('LEASE_NOTICE_CLOCK_UNAVAILABLE');}
  const k=scope.organization_id+'|'+scope.incident_id;
  if(!Number.isSafeInteger(t)||t<=0||t<(timeHigh.get(k)||0))
   fail('LEASE_NOTICE_CLOCK_ROLLBACK');
  timeHigh.set(k,t);return t;
 }
 function validateNotice(x,scope,lease,head){
  const p=verified(x,NOTICE,noticeKey,'LEASE_LOSS_NOTICE_SIGNATURE_INVALID');
  const t=now(scope);
  if(p.schema_version!=='v3.2-110-ci-loss-notice-v1'||
   p.fixture_only!==true||p.organization_id!==scope.organization_id||
   p.incident_id!==scope.incident_id||p.lease_id!==lease.lease_id||
   p.barrier_epoch!==lease.barrier_epoch||
   p.source_watermark_digest!==lease.observed_source_digest||
   !Number.isSafeInteger(p.notification_sequence)||
   p.notification_sequence!==(head?.notification_sequence||0)+1||
   p.previous_notification_digest!==(head?.notification_digest||'0'.repeat(64))||
   !['lease_revoked','holder_lost','source_barrier_invalidated'].includes(p.notification_kind)||
   !Number.isSafeInteger(p.observed_at_ms)||p.observed_at_ms>t||
   t-p.observed_at_ms>30000)return fail('LEASE_LOSS_NOTICE_SCOPE_SEQUENCE_OR_TTL_INVALID');
  return p;
 }
 function validateReceipt(x,scope,notice,noticeDigest){
  const p=verified(x,RECEIPT,receiptKey,'LEASE_NEGATIVE_RECEIPT_SIGNATURE_INVALID');
  const t=now(scope);
  if(p.schema_version!=='v3.2-110-ci-negative-receipt-v1'||
   p.fixture_only!==true||p.organization_id!==scope.organization_id||
   p.incident_id!==scope.incident_id||p.lease_id!==notice.lease_id||
   p.barrier_epoch!==notice.barrier_epoch||
   p.notification_sequence!==notice.notification_sequence||
   p.notification_digest!==noticeDigest||
   !Number.isSafeInteger(p.observed_at_ms)||p.observed_at_ms>t||
   t-p.observed_at_ms>30000||
   !['blocked','uncertain'].includes(p.disposition))
   fail('LEASE_NEGATIVE_RECEIPT_INVALID_OR_FALSE_ACCEPTANCE');
  return p;
 }
 async function inspect(input={}){
  if(!exact(input,['organization_id','incident_id'])||
   !UUID.test(input.organization_id)||!UUID.test(input.incident_id))
   return deny('INVALID_LEASE_LOSS_SCOPE');
  const scope={organization_id:input.organization_id.toLowerCase(),
   incident_id:input.incident_id.toLowerCase()};
  const k=scope.organization_id+'|'+scope.incident_id;
  const prev=queues.get(k)||Promise.resolve();
  const run=prev.catch(()=>{}).then(async()=>{
   try{
    now(scope);
    // V109 is a signed fixture observation, not a business permit.
    const lease=await causalLeaseFence.inspect(scope);
    if(lease?.fixture_lease_observation_current!==true||
     lease?.reason_code!=='BLOCKED_CI_CAUSAL_LEASE_OBSERVATION_NO_EXTERNAL_AUTHORITY'||
     lease?.handoff_allowed!==false||lease?.hold_active!==true||
     !ID.test(lease?.lease_id)||!Number.isSafeInteger(lease.barrier_epoch)||
     !SHA.test(lease.observed_source_digest))
     fail('LEASE_PRECONDITION_NOT_CURRENT');
    const bound=await leaseLedger.read(scope);
    if(bound?.lease_id!==lease.lease_id||
     bound?.barrier_epoch!==lease.barrier_epoch||
     bound?.source_watermark_digest!==lease.observed_source_digest||
     bound?.state!=='active'||bound?.expires_at_ms<=now(scope))
     fail('LEASE_SQL_BINDING_NOT_CURRENT');
    const head=await noticeLedger.head(scope);
    if(head!==null&&(!exact(head,['notification_sequence','notification_digest'])||
     !Number.isSafeInteger(head.notification_sequence)||head.notification_sequence<1||
     !SHA.test(head.notification_digest)))
     fail('LEASE_NOTICE_HEAD_UNVERIFIED');
    const raw=await fetchSignedNotice({scope,lease,head});
    const notice=validateNotice(raw,scope,lease,head);
    const digest=sha(raw);
    const write=await noticeLedger.append(scope,raw);
    if(!exact(write,['accepted','notice_digest','reason_code'])||
     write.accepted!==true||write.notice_digest!==digest||
     write.reason_code!=='LEASE_LOSS_NOTICE_PERSISTED')
     fail('LEASE_NOTICE_COMMIT_UNVERIFIED');
    await afterNoticeCommit({scope,notice,notice_digest:digest});
    // After commit, uncertainty is always non-authorizing; DB facts must
    // be re-read, never inferred from an accepted=true response.
    const storedHead=await noticeLedger.head(scope);
    const storedEvent=await noticeLedger.event(scope,notice.notification_sequence);
    const revoked=await leaseLedger.read(scope);
    if(storedHead?.notification_sequence!==notice.notification_sequence||
     storedHead?.notification_digest!==digest||
     sha(storedEvent)!==digest||
     revoked?.lease_id!==notice.lease_id||
     revoked?.barrier_epoch!==notice.barrier_epoch||
     revoked?.state!=='revoked')
     fail('LEASE_NOTICE_OR_SQL_REVOCATION_NOT_DURABLE');
    const rawReceipt=await fetchSignedReceipt({scope,notice,notice_digest:digest});
    const receipt=validateReceipt(rawReceipt,scope,notice,digest);
    if(receipt.disposition==='uncertain')
     return deny('LEASE_NEGATIVE_RECEIPT_COMMIT_UNCERTAIN');
    return deny('BLOCKED_CI_LEASE_LOSS_AND_NEGATIVE_RECEIPT',{
     fixture_negative_receipt_current:true,
     notification_sequence:notice.notification_sequence,
     notification_digest:digest,
     receipt_digest:sha(rawReceipt)});
   }catch(e){
    return deny(typeof e?.code==='string'&&e.code.length<=128?
     e.code:'LEASE_LOSS_DEPENDENCY_UNAVAILABLE');
   }
  });
  queues.set(k,run);
  try{return await run;}
  finally{if(queues.get(k)===run)queues.delete(k);}
 }
 return Object.freeze({inspect});
}
