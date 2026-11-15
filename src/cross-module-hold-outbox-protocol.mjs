// V3.2-116: isolated signed HOLD outbox and negative-only receipt.
// NOT a production transport, independent identity, or an authorization channel.
import {createHash,createPublicKey,verify} from 'node:crypto';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{64}$/;
const ID=/^[a-z0-9][a-z0-9._:-]{5,127}$/;
const SCOPE=['organization_id','incident_id','student_id'];
const SOURCE=['schema_version',...SCOPE,'hold_sequence','hold_event_digest',
 'source_epoch','source_revision','revocation_sequence',
 'issued_at_ms','expires_at_ms','fixture_only'];
const RECEIPT=['schema_version',...SCOPE,'hold_sequence','message_digest',
 'recipient_id','delivery_status','issued_at_ms','expires_at_ms','fixture_only'];
const OUTBOX=['schema_version','scope','hold_sequence','hold_event_digest',
 'source_proof_digest','message_digest','message_kind','status','created_at_ms'];
const ACK=['schema_version','scope','hold_sequence','message_digest',
 'recipient_id','signed_receipt_digest','status','recorded_at_ms'];
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
const exact=(x,keys)=>plain(x)&&Object.keys(x).length===keys.length&&
 keys.every(k=>Object.hasOwn(x,k));
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const fields=(x,keys)=>Object.fromEntries(keys.map(k=>[k,x[k]]));
const fault=c=>{const e=new Error(c);e.code=c;throw e;};
const denied=(reason_code,more={})=>Object.freeze({
 reason_code,fixture_message_stored:false,fixture_negative_receipt_stored:false,
 external_source_verified:false,external_recipient_verified:false,
 finance_authorized:false,academic_authorized:false,
 external_authority_verified:false,handoff_allowed:false,
 compensation_write_allowed:false,release_eligible:false,
 hold_active:true,production_integration_allowed:false,
 merge_authorized:false,deploy_authorized:false,...more
});
const scopeOk=s=>exact(s,SCOPE)&&SCOPE.every(k=>
 typeof s[k]==='string'&&UUID.test(s[k]));
const pin=p=>{
 const k=createPublicKey(p);
 if(k.asymmetricKeyType!=='ed25519')throw TypeError('V116 requires Ed25519 fixture keys');
 return k;
};
function signed(raw,keys,key,errorCode){
 if(!exact(raw,[...keys,'signature'])||typeof raw.signature!=='string')
  fault(errorCode);
 let sig;
 try{sig=Buffer.from(raw.signature,'base64url');}catch{fault(errorCode);}
 if(sig.length!==64||sig.toString('base64url')!==raw.signature||
  !verify(null,Buffer.from(JSON.stringify(fields(raw,keys))),key,sig))
  fault(errorCode);
 return fields(raw,keys);
}
export function createIsolatedHoldOutboxProtocol({
 holdLedger,outboxLedger,readSignedFixtureHoldSource,readSignedFixtureRecipient,
 fixtureSourcePublicKey,fixtureRecipientPublicKey,getFixtureNow,
 afterOutboxCommit=async()=>{},afterReceiptCommit=async()=>{}
}={}){
 if(!holdLedger||typeof holdLedger.head!=='function'||
  typeof holdLedger.event!=='function'||!outboxLedger||
  ['enqueue','message','confirm','receipt'].some(k=>typeof outboxLedger[k]!=='function')||
  typeof readSignedFixtureHoldSource!=='function'||
  typeof readSignedFixtureRecipient!=='function'||
  typeof fixtureSourcePublicKey!=='string'||
  typeof fixtureRecipientPublicKey!=='string'||
  typeof getFixtureNow!=='function'||
  typeof afterOutboxCommit!=='function'||typeof afterReceiptCommit!=='function')
  throw TypeError('V116 requires isolated HOLD source, SQL outbox and two pinned fixture signing roots');
 const sourceKey=pin(fixtureSourcePublicKey),receiptKey=pin(fixtureRecipientPublicKey);
 const keyFingerprint=k=>sha(k.export({format:'der',type:'spki'}).toString('base64'));
 if(keyFingerprint(sourceKey)===keyFingerprint(receiptKey))
  throw TypeError('V116 fixture source and recipient roots must be distinct');
 const lanes=new Map(),highClock=new Map();
 function time(scope){
  let t;
  try{t=getFixtureNow();}catch{fault('V116_FIXTURE_CLOCK_UNAVAILABLE');}
  const key=SCOPE.map(k=>scope[k]).join('|');
  if(!Number.isSafeInteger(t)||t<1||t<(highClock.get(key)||0))
   fault('V116_FIXTURE_CLOCK_ROLLBACK');
  highClock.set(key,t);return t;
 }
 async function serial(scope,operation){
  const key=SCOPE.map(k=>scope[k]).join('|');
  const before=lanes.get(key)||Promise.resolve();
  const run=before.catch(()=>{}).then(operation);
  lanes.set(key,run);
  try{return await run;}finally{if(lanes.get(key)===run)lanes.delete(key);}
 }
 function parsed(input){
  const {hold_sequence,...raw}=input||{};
  if(!exact(input,[...SCOPE,'hold_sequence'])||
   !scopeOk(raw)||!Number.isSafeInteger(hold_sequence)||
   hold_sequence<1||hold_sequence>64)return null;
  return {scope:fields(raw,SCOPE),hold_sequence};
 }
 function checkSource(source,scope,seq,holdDigest,t){
  const p=signed(source,SOURCE,sourceKey,'V116_SOURCE_SIGNATURE_UNVERIFIED');
  if(p.schema_version!=='v3.2-116-ci-source-hold-v1'||
   SCOPE.some(k=>p[k]!==scope[k])||p.hold_sequence!==seq||
   p.hold_event_digest!==holdDigest||
   !Number.isSafeInteger(p.source_epoch)||p.source_epoch<1||
   !Number.isSafeInteger(p.source_revision)||p.source_revision<1||
   !Number.isSafeInteger(p.revocation_sequence)||p.revocation_sequence<0||
   !Number.isSafeInteger(p.issued_at_ms)||p.issued_at_ms>t||
   !Number.isSafeInteger(p.expires_at_ms)||p.expires_at_ms<=t||
   p.expires_at_ms-p.issued_at_ms>300000||p.fixture_only!==true)
   fault('V116_SOURCE_SCOPE_REVISION_OR_EXPIRY_INVALID');
 }
 async function checkHold(scope,seq){
  const head=await holdLedger.head(scope);
  if(!exact(head,['sequence','event_digest'])||
   !Number.isSafeInteger(head.sequence)||head.sequence<seq||head.sequence>64||
   !SHA.test(head.event_digest))
   fault('V116_HOLD_SOURCE_MISSING_OR_UNVERIFIED');
  const event=await holdLedger.event(scope,seq);
  if(!plain(event)||event.schema_version!=='v3.2-115-ci-invalidation-hold-v1'||
   !scopeOk(event.scope)||SCOPE.some(k=>event.scope[k]!==scope[k])||
   event.sequence!==seq||event.status!=='HOLD_PENDING_EXTERNAL_AUTHORITY')
   fault('V116_HOLD_EVENT_INVALID');
  const eventDigest=sha(event);
  if(seq===head.sequence&&eventDigest!==head.event_digest)
   fault('V116_HOLD_HEAD_DIGEST_MISMATCH');
  return {head_digest:head.event_digest,hold_event_digest:eventDigest};
 }
 async function publish(input={}){
  const args=parsed(input);
  if(!args)return denied('V116_OUTBOX_SCOPE_INVALID');
  const {scope,hold_sequence}=args;
  return serial(scope,async()=>{
   try{
    const t=time(scope),hold=await checkHold(scope,hold_sequence);
    const raw=await readSignedFixtureHoldSource({
     scope,hold_sequence,hold_event_digest:hold.hold_event_digest});
    checkSource(raw,scope,hold_sequence,hold.hold_event_digest,t);
    const messageDigest=sha({schema_version:'v3.2-116-ci-hold-message-v1',
     scope,hold_sequence,hold_event_digest:hold.hold_event_digest,
     source_proof_digest:sha(raw),disposition:'blocked'});
    const record={schema_version:'v3.2-116-ci-outbox-message-v1',scope,
     hold_sequence,hold_event_digest:hold.hold_event_digest,
     source_proof_digest:sha(raw),message_digest:messageDigest,
     message_kind:'hold_invalidation',
     status:'PENDING_NEGATIVE_FIXTURE_RECEIPT',created_at_ms:t};
    const res=await outboxLedger.enqueue(scope,record);
    if(!exact(res,['accepted','message_digest','reason_code'])||
     res.accepted!==true||res.message_digest!==messageDigest||
     res.reason_code!=='FIXTURE_OUTBOX_STORED')
     fault('V116_OUTBOX_REPLAY_GAP_OR_COMMIT_UNCERTAIN');
    await afterOutboxCommit({scope,record});
    const [stored,nowHold]=await Promise.all([
     outboxLedger.message(scope,hold_sequence),
     checkHold(scope,hold_sequence)]);
    if(!exact(stored,OUTBOX)||sha(stored)!==sha(record)||
     nowHold.hold_event_digest!==hold.hold_event_digest)
     fault('V116_OUTBOX_POSTCOMMIT_UNVERIFIED');
    return denied('BLOCKED_FIXTURE_OUTBOX_PERSISTED_AWAITING_RECEIPT',{
     fixture_message_stored:true,hold_sequence,message_digest:messageDigest,
     delivery_status:'AWAITING_FIXTURE_NEGATIVE_RECEIPT'});
   }catch(e){
    return denied(typeof e?.code==='string'&&e.code.length<128?
     e.code:'V116_OUTBOX_DEPENDENCY_UNAVAILABLE');
   }
  });
 }
 async function acknowledge(input={}){
  const args=parsed(input);
  if(!args)return denied('V116_OUTBOX_SCOPE_INVALID');
  const {scope,hold_sequence}=args;
  return serial(scope,async()=>{
   try{
    const t=time(scope),message=await outboxLedger.message(scope,hold_sequence);
    if(!exact(message,OUTBOX)||message.schema_version!=='v3.2-116-ci-outbox-message-v1'||
     !scopeOk(message.scope)||SCOPE.some(k=>message.scope[k]!==scope[k])||
     message.hold_sequence!==hold_sequence||
     message.message_kind!=='hold_invalidation'||
     message.status!=='PENDING_NEGATIVE_FIXTURE_RECEIPT'||
     !SHA.test(message.message_digest))
     fault('V116_OUTBOX_MESSAGE_UNVERIFIED');
    const raw=await readSignedFixtureRecipient({
     scope,hold_sequence,message_digest:message.message_digest});
    const r=signed(raw,RECEIPT,receiptKey,'V116_RECEIPT_SIGNATURE_UNVERIFIED');
    if(r.schema_version!=='v3.2-116-ci-negative-recipient-receipt-v1'||
     SCOPE.some(k=>r[k]!==scope[k])||
     r.hold_sequence!==hold_sequence||r.message_digest!==message.message_digest||
     !ID.test(r.recipient_id)||
     r.delivery_status!=='fixture_received_still_blocked'||
     !Number.isSafeInteger(r.issued_at_ms)||r.issued_at_ms>t||
     !Number.isSafeInteger(r.expires_at_ms)||r.expires_at_ms<=t||
     r.expires_at_ms-r.issued_at_ms>300000||r.fixture_only!==true)
     fault('V116_RECEIPT_SCOPE_STATUS_OR_EXPIRY_INVALID');
    const record={schema_version:'v3.2-116-ci-delivery-receipt-v1',
     scope,hold_sequence,message_digest:message.message_digest,
     recipient_id:r.recipient_id,signed_receipt_digest:sha(raw),
     status:'NEGATIVE_FIXTURE_RECEIPT_ONLY',recorded_at_ms:t};
    const res=await outboxLedger.confirm(scope,record);
    if(!exact(res,['accepted','receipt_digest','reason_code'])||
     res.accepted!==true||res.receipt_digest!==sha(record)||
     res.reason_code!=='FIXTURE_NEGATIVE_RECEIPT_STORED')
     fault('V116_NEGATIVE_RECEIPT_REPLAY_OR_OUT_OF_ORDER');
    await afterReceiptCommit({scope,record});
    const [saved,hold]=await Promise.all([
     outboxLedger.receipt(scope,hold_sequence),checkHold(scope,hold_sequence)]);
    if(!exact(saved,ACK)||sha(saved)!==sha(record)||
     hold.hold_event_digest!==message.hold_event_digest)
     fault('V116_RECEIPT_POSTCOMMIT_UNVERIFIED');
    return denied('BLOCKED_FIXTURE_NEGATIVE_RECEIPT_RECORDED',{
     fixture_negative_receipt_stored:true,hold_sequence,
     receipt_digest:sha(record),delivery_status:'FIXTURE_ACKED_STILL_BLOCKED'});
   }catch(e){
    return denied(typeof e?.code==='string'&&e.code.length<128?
     e.code:'V116_RECEIPT_DEPENDENCY_UNAVAILABLE');
   }
  });
 }
 async function inspect(input={}){
  const args=parsed(input);
  if(!args)return denied('V116_OUTBOX_SCOPE_INVALID');
  try{
   const {scope,hold_sequence}=args;
   const [message,receipt]=await Promise.all([
    outboxLedger.message(scope,hold_sequence),
    outboxLedger.receipt(scope,hold_sequence)]);
   if(!message)return denied('BLOCKED_FIXTURE_OUTBOX_NOT_ENQUEUED');
   if(!exact(message,OUTBOX)||message.hold_sequence!==hold_sequence||
    message.status!=='PENDING_NEGATIVE_FIXTURE_RECEIPT')
    fault('V116_OUTBOX_MESSAGE_UNVERIFIED');
   if(!receipt)return denied('BLOCKED_FIXTURE_OUTBOX_AWAITING_RECEIPT');
   if(!exact(receipt,ACK)||receipt.hold_sequence!==hold_sequence||
    receipt.message_digest!==message.message_digest||
    receipt.status!=='NEGATIVE_FIXTURE_RECEIPT_ONLY')
    fault('V116_RECEIPT_INTEGRITY_UNVERIFIED');
   return denied('BLOCKED_FIXTURE_OUTBOX_NEGATIVE_RECEIPT_RECORDED');
  }catch(e){
   return denied(typeof e?.code==='string'&&e.code.length<128?
    e.code:'V116_OUTBOX_DEPENDENCY_UNAVAILABLE');
  }
 }
 return Object.freeze({publish,acknowledge,inspect});
}
