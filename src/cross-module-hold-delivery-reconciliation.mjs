// V3.2-117: CI-only delivery reconciliation, always hard-blocking.
// Audit classifications do not send messages, cancel HOLD, or authorize release.
import {createHash,createPublicKey,verify} from 'node:crypto';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{64}$/;
const ID=/^[a-z0-9][a-z0-9._:-]{5,127}$/;
const ZERO='0'.repeat(64);
const SCOPE=['organization_id','incident_id','student_id'];
const SIGNED=['schema_version',...SCOPE,'hold_sequence','hold_event_digest',
 'message_digest','issuer_id','source_epoch','source_revision',
 'revocation_sequence','disposition','issued_at_ms','expires_at_ms','fixture_only'];
const HOLD=['schema_version','scope','sequence','previous_event_digest',
 'assignment_digest','intake_head_digest','lifecycle_head_digest',
 'reviewer_id','trigger_kind','source_signal_digest','cause_digest',
 'status','recorded_at_ms'];
const MESSAGE=['schema_version','scope','hold_sequence','hold_event_digest',
 'source_proof_digest','message_digest','message_kind','status','created_at_ms'];
const RECEIPT=['schema_version','scope','hold_sequence','message_digest',
 'recipient_id','signed_receipt_digest','status','recorded_at_ms'];
const AUDIT=['schema_version','scope','sequence','previous_event_digest',
 'hold_sequence','hold_event_digest','hold_head_digest','message_digest',
 'receipt_digest','upstream_snapshot_digest','authority_proof_digest',
 'classification','manual_action','cause_digest','status','recorded_at_ms'];
const CLASSIFICATIONS={
 OUTBOX_GAP:'RECONCILE_MISSING_OUTBOX_MANUALLY',
 AWAITING_NEGATIVE_RECEIPT:'WAIT_AND_RECHECK_MANUALLY',
 NEGATIVE_RECEIPT_OVERDUE:'INVESTIGATE_UNCERTAIN_DELIVERY',
 NEGATIVE_RECEIPT_RECORDED:'PRESERVE_NEGATIVE_RECEIPT_AND_HOLD',
 SIGNED_FIXTURE_CANCELLATION_ADVISORY:'QUARANTINE_AND_VERIFY_REISSUE_MANUALLY',
 SOURCE_PROOF_UNVERIFIED:'VERIFY_INDEPENDENT_SOURCE_MANUALLY'
};
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
const exact=(x,keys)=>plain(x)&&Object.keys(x).length===keys.length&&
 keys.every(k=>Object.hasOwn(x,k));
const fields=(x,keys)=>Object.fromEntries(keys.map(k=>[k,x[k]]));
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const fail=c=>{const e=new Error(c);e.code=c;throw e;};
const scopeOk=s=>exact(s,SCOPE)&&SCOPE.every(k=>typeof s[k]==='string'&&UUID.test(s[k]));
const deny=(reason_code,extra={})=>Object.freeze({
 reason_code,fixture_reconciliation_recorded:false,
 external_source_verified:false,external_recipient_verified:false,
 external_authority_verified:false,finance_authorized:false,
 academic_authorized:false,handoff_allowed:false,
 compensation_write_allowed:false,release_eligible:false,
 hold_active:true,production_integration_allowed:false,
 merge_authorized:false,deploy_authorized:false,...extra
});
function inputScope(input){
 if(!exact(input,[...SCOPE,'hold_sequence']))return null;
 const scope=fields(input,SCOPE);
 if(!scopeOk(scope)||!Number.isSafeInteger(input.hold_sequence)||
  input.hold_sequence<1||input.hold_sequence>64)return null;
 return {scope,hold_sequence:input.hold_sequence};
}
function pin(pem){
 const key=createPublicKey(pem);
 if(key.asymmetricKeyType!=='ed25519')throw TypeError('Fixture provenance requires Ed25519');
 return key;
}
function checkSigned(raw,pub,scope,seq,holdDigest,messageDigest,t){
 if(!exact(raw,[...SIGNED,'signature'])||typeof raw.signature!=='string')
  fail('RECONCILE_SOURCE_PROOF_UNVERIFIED');
 let sig;
 try{sig=Buffer.from(raw.signature,'base64url');}catch{
  fail('RECONCILE_SOURCE_PROOF_UNVERIFIED');
 }
 if(sig.length!==64||sig.toString('base64url')!==raw.signature||
  !verify(null,Buffer.from(JSON.stringify(fields(raw,SIGNED))),pub,sig))
  fail('RECONCILE_SOURCE_PROOF_UNVERIFIED');
 const p=fields(raw,SIGNED);
 if(p.schema_version!=='v3.2-117-ci-source-disposition-v1'||
  SCOPE.some(k=>p[k]!==scope[k])||p.hold_sequence!==seq||
  p.hold_event_digest!==holdDigest||p.message_digest!==messageDigest||
  !ID.test(p.issuer_id)||!Number.isSafeInteger(p.source_epoch)||p.source_epoch<1||
  !Number.isSafeInteger(p.source_revision)||p.source_revision<1||
  !Number.isSafeInteger(p.revocation_sequence)||p.revocation_sequence<0||
  !['active','revoked','unknown'].includes(p.disposition)||
  (p.disposition==='revoked'&&p.revocation_sequence<1)||
  !Number.isSafeInteger(p.issued_at_ms)||p.issued_at_ms>t||
  !Number.isSafeInteger(p.expires_at_ms)||p.expires_at_ms<=t||
  p.expires_at_ms-p.issued_at_ms>300000||p.fixture_only!==true)
  fail('RECONCILE_SOURCE_PROOF_UNVERIFIED');
 return {disposition:p.disposition,digest:sha(raw)};
}
export function createIsolatedHoldDeliveryReconciliation({
 holdLedger,outboxLedger,auditLedger,
 readSignedFixtureDisposition,fixtureDispositionPublicKey,
 getFixtureNow,receiptOverdueMs=60000,afterCommit=async()=>{}
}={}){
 if(!holdLedger||typeof holdLedger.head!=='function'||
  typeof holdLedger.event!=='function'||
  !outboxLedger||typeof outboxLedger.message!=='function'||
  typeof outboxLedger.receipt!=='function'||
  !auditLedger||['head','event','append'].some(x=>typeof auditLedger[x]!=='function')||
  typeof readSignedFixtureDisposition!=='function'||
  typeof fixtureDispositionPublicKey!=='string'||
  typeof getFixtureNow!=='function'||typeof afterCommit!=='function'||
  !Number.isSafeInteger(receiptOverdueMs)||receiptOverdueMs<1000||
  receiptOverdueMs>86400000)
  throw TypeError('V117 needs isolated durable ledgers and a bounded fixture overdue window');
 const pub=pin(fixtureDispositionPublicKey),queues=new Map(),clocks=new Map();
 function now(scope){
  let t;
  try{t=getFixtureNow();}catch{fail('RECONCILE_CLOCK_UNAVAILABLE');}
  const k=SCOPE.map(x=>scope[x]).join('|');
  if(!Number.isSafeInteger(t)||t<1||t<(clocks.get(k)||0))
   fail('RECONCILE_CLOCK_ROLLBACK');
  clocks.set(k,t);return t;
 }
 async function snapshot(scope,seq){
  const head=await holdLedger.head(scope);
  if(!exact(head,['sequence','event_digest'])||
   !Number.isSafeInteger(head.sequence)||head.sequence<seq||
   head.sequence>64||!SHA.test(head.event_digest))
   fail('RECONCILE_HOLD_UNVERIFIED');
  let previous=ZERO,holdEventDigest=null;
  for(let i=1;i<=head.sequence;i++){
   const event=await holdLedger.event(scope,i);
   if(!exact(event,HOLD)||event.schema_version!=='v3.2-115-ci-invalidation-hold-v1'||
    !scopeOk(event.scope)||SCOPE.some(k=>event.scope[k]!==scope[k])||
    event.sequence!==i||event.previous_event_digest!==previous||
    event.status!=='HOLD_PENDING_EXTERNAL_AUTHORITY')
    fail('RECONCILE_HOLD_CHAIN_INVALID');
   previous=sha(event);
   if(i===seq)holdEventDigest=previous;
  }
  if(previous!==head.event_digest)fail('RECONCILE_HOLD_HEAD_INVALID');
  const [message,receipt]=await Promise.all([
   outboxLedger.message(scope,seq),outboxLedger.receipt(scope,seq)]);
  if(message!==null&&(!exact(message,MESSAGE)||
   message.schema_version!=='v3.2-116-ci-outbox-message-v1'||
   !scopeOk(message.scope)||SCOPE.some(k=>message.scope[k]!==scope[k])||
   message.hold_sequence!==seq||message.hold_event_digest!==holdEventDigest||
   !SHA.test(message.message_digest)||
   message.message_kind!=='hold_invalidation'||
   message.status!=='PENDING_NEGATIVE_FIXTURE_RECEIPT'||
   !Number.isSafeInteger(message.created_at_ms)||message.created_at_ms<1))
   fail('RECONCILE_OUTBOX_UNVERIFIED');
  if(receipt!==null&&(!exact(receipt,RECEIPT)||
   receipt.schema_version!=='v3.2-116-ci-delivery-receipt-v1'||
   !scopeOk(receipt.scope)||SCOPE.some(k=>receipt.scope[k]!==scope[k])||
   receipt.hold_sequence!==seq||
   receipt.message_digest!==message?.message_digest||
   receipt.status!=='NEGATIVE_FIXTURE_RECEIPT_ONLY'||
   !SHA.test(receipt.signed_receipt_digest)))
   fail('RECONCILE_RECEIPT_UNVERIFIED');
  const digestFields={
   hold_head_digest:head.event_digest,hold_event_digest:holdEventDigest,
   outbox_digest:message===null?ZERO:sha(message),
   receipt_digest:receipt===null?ZERO:sha(receipt)
  };
  return {head,eventDigest:holdEventDigest,message,receipt,
   snapshot_digest:sha(digestFields),
   message_digest:message?.message_digest??ZERO,
   receipt_digest:receipt===null?ZERO:sha(receipt)};
 }
 async function eventHead(scope){
  const head=await auditLedger.head(scope);
  if(head===null)return {sequence:0,event_digest:ZERO};
  if(!exact(head,['sequence','event_digest'])||
   !Number.isSafeInteger(head.sequence)||head.sequence<1||head.sequence>128||
   !SHA.test(head.event_digest))
   fail('RECONCILE_AUDIT_HEAD_UNVERIFIED');
  const prior=await auditLedger.event(scope,head.sequence);
  if(!exact(prior,AUDIT)||prior.schema_version!=='v3.2-117-ci-reconciliation-v1'||
   !scopeOk(prior.scope)||SCOPE.some(k=>prior.scope[k]!==scope[k])||
   prior.sequence!==head.sequence||sha(prior)!==head.event_digest||
   prior.status!=='HOLD_ACTIVE_NEGATIVE_AUDIT_ONLY')
   fail('RECONCILE_AUDIT_PREVIOUS_EVENT_INVALID');
  return head;
 }
 async function reconcile(input={}){
  const args=inputScope(input);
  if(!args)return deny('RECONCILE_SCOPE_INVALID');
  const {scope,hold_sequence}=args,k=SCOPE.map(x=>scope[x]).join('|');
  const prior=queues.get(k)||Promise.resolve();
  const job=prior.catch(()=>{}).then(async()=>{
   try{
    const t=now(scope),snap=await snapshot(scope,hold_sequence);
    let authority;
    try{
     const raw=await readSignedFixtureDisposition({
      scope,hold_sequence,hold_event_digest:snap.eventDigest,
      message_digest:snap.message_digest});
     authority=checkSigned(raw,pub,scope,hold_sequence,snap.eventDigest,
      snap.message_digest,t);
    }catch{
     authority={disposition:'unknown',digest:ZERO,unverified:true};
    }
    let classification;
    if(authority.unverified||authority.disposition==='unknown')
     classification='SOURCE_PROOF_UNVERIFIED';
    else if(authority.disposition==='revoked')
     classification='SIGNED_FIXTURE_CANCELLATION_ADVISORY';
    else if(snap.message===null)classification='OUTBOX_GAP';
    else if(snap.receipt!==null)classification='NEGATIVE_RECEIPT_RECORDED';
    else if(t-snap.message.created_at_ms>=receiptOverdueMs)
     classification='NEGATIVE_RECEIPT_OVERDUE';
    else classification='AWAITING_NEGATIVE_RECEIPT';
    const auditHead=await eventHead(scope);
    const cause_digest=sha({scope,hold_sequence,classification,
     upstream_snapshot_digest:snap.snapshot_digest,
     authority_proof_digest:authority.digest});
    const record={schema_version:'v3.2-117-ci-reconciliation-v1',scope,
     sequence:auditHead.sequence+1,previous_event_digest:auditHead.event_digest,
     hold_sequence,hold_event_digest:snap.eventDigest,
     hold_head_digest:snap.head.event_digest,
     message_digest:snap.message_digest,
     receipt_digest:snap.receipt_digest,
     upstream_snapshot_digest:snap.snapshot_digest,
     authority_proof_digest:authority.digest,
     classification,manual_action:CLASSIFICATIONS[classification],
     cause_digest,status:'HOLD_ACTIVE_NEGATIVE_AUDIT_ONLY',recorded_at_ms:t};
    const saved=await auditLedger.append(scope,record);
    const digest=sha(record);
    if(!exact(saved,['accepted','event_digest','reason_code'])||
     saved.accepted!==true||saved.event_digest!==digest||
     saved.reason_code!=='RECONCILIATION_NEGATIVE_EVENT_STORED')
     fail('RECONCILE_REPLAY_CONFLICT_OR_STALE_SNAPSHOT');
    await afterCommit({scope,record});
    const [durableHead,durableEvent,second]=await Promise.all([
     auditLedger.head(scope),auditLedger.event(scope,record.sequence),
     snapshot(scope,hold_sequence)]);
    if(durableHead?.sequence!==record.sequence||
     durableHead.event_digest!==digest||sha(durableEvent)!==digest)
     fail('RECONCILE_POSTCOMMIT_AUDIT_UNVERIFIED');
    if(second.snapshot_digest!==snap.snapshot_digest)
     return deny('BLOCKED_RECONCILIATION_SNAPSHOT_CHANGED',{
      fixture_reconciliation_recorded:true,classification,
      audit_sequence:record.sequence,event_digest:digest});
    return deny('BLOCKED_FIXTURE_DELIVERY_RECONCILIATION_RECORDED',{
     fixture_reconciliation_recorded:true,classification,
     manual_action:record.manual_action,
     audit_sequence:record.sequence,event_digest:digest});
   }catch(e){
    return deny(typeof e?.code==='string'&&e.code.length<128?
     e.code:'RECONCILE_DEPENDENCY_UNAVAILABLE');
   }
  });
  queues.set(k,job);
  try{return await job;}finally{if(queues.get(k)===job)queues.delete(k);}
 }
 async function inspect(input={}){
  const args=inputScope(input);
  if(!args)return deny('RECONCILE_SCOPE_INVALID');
  try{
   const head=await eventHead(args.scope);
   if(head.sequence===0)return deny('BLOCKED_NO_RECONCILIATION_HISTORY');
   const ev=await auditLedger.event(args.scope,head.sequence);
   if(!exact(ev,AUDIT)||sha(ev)!==head.event_digest)
    fail('RECONCILE_AUDIT_PREVIOUS_EVENT_INVALID');
   return deny('BLOCKED_RECONCILIATION_HISTORY_RETAINED',{
    latest_classification:ev.classification,audit_sequence:head.sequence});
  }catch(e){
   return deny(typeof e?.code==='string'&&e.code.length<128?
    e.code:'RECONCILE_DEPENDENCY_UNAVAILABLE');
  }
 }
 return Object.freeze({reconcile,inspect});
}
