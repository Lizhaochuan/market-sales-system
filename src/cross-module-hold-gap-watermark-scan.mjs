// V3.2-118 CI-only bounded HOLD gap scanner. No delivery worker or release.
import {createHash} from 'node:crypto';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const ZERO='0'.repeat(64);
const SCOPE=['organization_id','incident_id','student_id'];
const HOLD=['schema_version','scope','sequence','previous_event_digest',
 'assignment_digest','intake_head_digest','lifecycle_head_digest','reviewer_id',
 'trigger_kind','source_signal_digest','cause_digest','status','recorded_at_ms'];
const MESSAGE=['schema_version','scope','hold_sequence','hold_event_digest',
 'source_proof_digest','message_digest','message_kind','status','created_at_ms'];
const ACK=['schema_version','scope','hold_sequence','message_digest',
 'recipient_id','signed_receipt_digest','status','recorded_at_ms'];
const AUDIT=['schema_version','scope','sequence','previous_event_digest',
 'checked_through','hold_head_digest','outbox_prefix','negative_receipt_prefix',
 'gaps','gap_digest','snapshot_digest','status','scanned_at_ms'];
const exact=(x,keys)=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null)&&
 Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const fail=c=>{const e=new Error(c);e.code=c;throw e;};
const scopeOk=s=>exact(s,SCOPE)&&SCOPE.every(k=>typeof s[k]==='string'&&UUID.test(s[k]));
const flags=Object.freeze({
 external_authority_verified:false,external_source_verified:false,
 external_recipient_verified:false,finance_authorized:false,
 academic_authorized:false,handoff_allowed:false,
 compensation_write_allowed:false,release_eligible:false,
 hold_active:true,production_integration_allowed:false,
 merge_authorized:false,deploy_authorized:false
});
const denied=(reason_code,extra={})=>Object.freeze({
 reason_code,fixture_gap_scan_recorded:false,...flags,...extra
});
const sameScope=(a,b)=>scopeOk(a)&&SCOPE.every(k=>a[k]===b[k]);

// Pure integrity and prefix computation, used both inside serializable SQL
// scan transactions and in read-only postcommit comparisons.
export function computeIsolatedHoldGapReport({
 scope,holdHead,holdEvents,outboxMessages,negativeReceipts,
 previousWatermark=null,nowMs,receiptOverdueMs=60000
}={}){
 if(!scopeOk(scope)||!exact(holdHead,['sequence','event_digest','hold_active'])||
  holdHead.hold_active!==true||
  !Number.isSafeInteger(holdHead.sequence)||holdHead.sequence<1||
  holdHead.sequence>64||!SHA.test(holdHead.event_digest)||
  !Array.isArray(holdEvents)||!Array.isArray(outboxMessages)||
  !Array.isArray(negativeReceipts)||
  holdEvents.length!==holdHead.sequence||
  outboxMessages.length!==holdHead.sequence||
  negativeReceipts.length!==holdHead.sequence||
  !Number.isSafeInteger(nowMs)||nowMs<1||
  !Number.isSafeInteger(receiptOverdueMs)||receiptOverdueMs<1000||
  receiptOverdueMs>86400000)
  fail('GAP_SCAN_SOURCE_SNAPSHOT_INVALID');
 const eventDigests=[],parts=[],gaps=[];
 let previous=ZERO,outboxPrefix=0,receiptPrefix=0;
 for(let index=0;index<holdEvents.length;index++){
  const seq=index+1,h=holdEvents[index],
   m=outboxMessages[index],a=negativeReceipts[index];
  if(!exact(h,HOLD)||h.schema_version!=='v3.2-115-ci-invalidation-hold-v1'||
   !sameScope(h.scope,scope)||h.sequence!==seq||
   h.previous_event_digest!==previous||
   h.status!=='HOLD_PENDING_EXTERNAL_AUTHORITY')
   fail('GAP_SCAN_HOLD_CHAIN_UNVERIFIED');
  previous=sha(h);eventDigests.push(previous);
  let messageDigest=ZERO,receiptDigest=ZERO,classification=null;
  if(m!==null){
   if(!exact(m,MESSAGE)||m.schema_version!=='v3.2-116-ci-outbox-message-v1'||
    !sameScope(m.scope,scope)||m.hold_sequence!==seq||
    m.hold_event_digest!==previous||!SHA.test(m.source_proof_digest)||
    !SHA.test(m.message_digest)||m.message_kind!=='hold_invalidation'||
    m.status!=='PENDING_NEGATIVE_FIXTURE_RECEIPT'||
    !Number.isSafeInteger(m.created_at_ms)||m.created_at_ms<1||
    m.created_at_ms>nowMs||
    m.message_digest!==sha({schema_version:'v3.2-116-ci-hold-message-v1',
     scope,hold_sequence:seq,hold_event_digest:previous,
     source_proof_digest:m.source_proof_digest,disposition:'blocked'}))
    fail('GAP_SCAN_OUTBOX_UNVERIFIED');
   messageDigest=sha(m);
   if(seq===outboxPrefix+1)outboxPrefix=seq;
  }
  if(a!==null){
   if(m===null||!exact(a,ACK)||
    a.schema_version!=='v3.2-116-ci-delivery-receipt-v1'||
    !sameScope(a.scope,scope)||a.hold_sequence!==seq||
    a.message_digest!==m.message_digest||
    !SHA.test(a.signed_receipt_digest)||
    a.status!=='NEGATIVE_FIXTURE_RECEIPT_ONLY'||
    !Number.isSafeInteger(a.recorded_at_ms)||a.recorded_at_ms<1||
    a.recorded_at_ms>nowMs)
    fail('GAP_SCAN_RECEIPT_UNVERIFIED');
   receiptDigest=sha(a);
   if(seq===receiptPrefix+1)receiptPrefix=seq;
  }
  if(m===null)classification='OUTBOX_MISSING';
  else if(a===null)classification=nowMs-m.created_at_ms>=receiptOverdueMs?
   'NEGATIVE_RECEIPT_OVERDUE':'NEGATIVE_RECEIPT_PENDING';
  if(classification!==null)gaps.push({
   hold_sequence:seq,reason_code:classification,
   hold_event_digest:previous,message_digest:m?.message_digest??ZERO});
  parts.push({hold_event_digest:previous,outbox_digest:messageDigest,
   receipt_digest:receiptDigest,gap_reason:classification});
 }
 if(previous!==holdHead.event_digest||receiptPrefix>outboxPrefix)
  fail('GAP_SCAN_HOLD_HEAD_UNVERIFIED');
 if(previousWatermark!==null){
  if(!exact(previousWatermark,['checked_through','hold_head_digest',
    'outbox_prefix','negative_receipt_prefix'])||
   !Number.isSafeInteger(previousWatermark.checked_through)||
   previousWatermark.checked_through<1||
   previousWatermark.checked_through>holdHead.sequence||
   !SHA.test(previousWatermark.hold_head_digest)||
   !Number.isSafeInteger(previousWatermark.outbox_prefix)||
   !Number.isSafeInteger(previousWatermark.negative_receipt_prefix)||
   previousWatermark.outbox_prefix<0||
   previousWatermark.negative_receipt_prefix<0||
   eventDigests[previousWatermark.checked_through-1]!==
    previousWatermark.hold_head_digest||
   outboxPrefix<previousWatermark.outbox_prefix||
   receiptPrefix<previousWatermark.negative_receipt_prefix)
   fail('GAP_SCAN_WATERMARK_REGRESSION_OR_HISTORY_CHANGED');
 }
 const snapshot_digest=sha({scope,checked_through:holdHead.sequence,
  hold_head_digest:holdHead.event_digest,parts});
 return Object.freeze({
  checked_through:holdHead.sequence,hold_head_digest:holdHead.event_digest,
  outbox_prefix:outboxPrefix,negative_receipt_prefix:receiptPrefix,
  gaps:Object.freeze(gaps.map(x=>Object.freeze(x))),
  gap_digest:sha(gaps),snapshot_digest
 });
}

export function createIsolatedHoldGapScanner({
 ledger,getFixtureNow,receiptOverdueMs=60000,afterCommit=async()=>{}
}={}){
 if(!ledger||['scan','snapshot','head','event'].some(x=>typeof ledger[x]!=='function')||
  typeof getFixtureNow!=='function'||typeof afterCommit!=='function'||
  !Number.isSafeInteger(receiptOverdueMs)||receiptOverdueMs<1000||
  receiptOverdueMs>86400000)
  throw TypeError('V118 requires disposable SQL scanner, bounded clock and no release');
 const lanes=new Map(),lastClock=new Map();
 function now(scope){
  let t;try{t=getFixtureNow();}catch{fail('GAP_SCAN_CLOCK_UNAVAILABLE');}
  const k=SCOPE.map(x=>scope[x]).join('|');
  if(!Number.isSafeInteger(t)||t<1||t<(lastClock.get(k)||0))
   fail('GAP_SCAN_CLOCK_ROLLBACK');
  lastClock.set(k,t);return t;
 }
 async function scan(scope={}){
  if(!scopeOk(scope))return denied('GAP_SCAN_SCOPE_INVALID');
  const k=SCOPE.map(x=>scope[x]).join('|');
  const earlier=lanes.get(k)||Promise.resolve();
  const work=earlier.catch(()=>{}).then(async()=>{
   try{
    const t=now(scope);
    const saved=await ledger.scan(scope,t,receiptOverdueMs);
    if(!exact(saved,['accepted','event_digest','reason_code','report'])||
     saved.accepted!==true||
     saved.reason_code!=='FIXTURE_GAP_SCAN_APPENDED'||
     !SHA.test(saved.event_digest)||
     !exact(saved.report,['checked_through','hold_head_digest',
      'outbox_prefix','negative_receipt_prefix','gaps','gap_digest',
      'snapshot_digest']))
     fail('GAP_SCAN_SQL_REPLAY_CONFLICT_OR_UNCERTAIN');
    await afterCommit({scope,report:saved.report});
    const [head,event,current]=await Promise.all([
     ledger.head(scope),ledger.event(scope,saved.sequence??0),
     ledger.snapshot(scope,now(scope),receiptOverdueMs)
    ]);
    // The returned committed sequence is a real SQL row identifier.
    if(!head||!Number.isSafeInteger(head.sequence)||
     head.event_digest!==saved.event_digest||
     !exact(event,AUDIT)||sha(event)!==saved.event_digest)
     fail('GAP_SCAN_COMMIT_READBACK_UNVERIFIED');
    const changed=current.snapshot_digest!==saved.report.snapshot_digest;
    return denied(changed?'BLOCKED_GAP_SCAN_SNAPSHOT_CHANGED':
     'BLOCKED_FIXTURE_GAP_SCAN_RECORDED',{
     fixture_gap_scan_recorded:true,scan_sequence:head.sequence,
     checked_through:saved.report.checked_through,
     outbox_prefix:saved.report.outbox_prefix,
     negative_receipt_prefix:saved.report.negative_receipt_prefix,
     unresolved_gaps:saved.report.gaps,
     snapshot_digest:saved.report.snapshot_digest});
   }catch(e){
    return denied(typeof e?.code==='string'&&e.code.length<128?
     e.code:'GAP_SCAN_DEPENDENCY_UNAVAILABLE');
   }
  });
  lanes.set(k,work);
  try{return await work;}finally{if(lanes.get(k)===work)lanes.delete(k);}
 }
 async function inspect(scope={}){
  if(!scopeOk(scope))return denied('GAP_SCAN_SCOPE_INVALID');
  try{
   const head=await ledger.head(scope);
   if(head===null)return denied('BLOCKED_NO_GAP_SCAN_RECORDED');
   if(!exact(head,['sequence','event_digest','checked_through',
    'hold_head_digest','outbox_prefix','negative_receipt_prefix'])||
    !Number.isSafeInteger(head.sequence)||head.sequence<1||
    !SHA.test(head.event_digest))
    fail('GAP_SCAN_HEAD_UNVERIFIED');
   const event=await ledger.event(scope,head.sequence);
   if(!exact(event,AUDIT)||sha(event)!==head.event_digest||
    event.status!=='HOLD_ACTIVE_GAP_AUDIT_ONLY')
    fail('GAP_SCAN_EVENT_UNVERIFIED');
   return denied('BLOCKED_GAP_SCAN_HISTORY_RETAINED',{
    scan_sequence:head.sequence,checked_through:head.checked_through,
    outbox_prefix:head.outbox_prefix,
    negative_receipt_prefix:head.negative_receipt_prefix,
    unresolved_gaps:Object.freeze(event.gaps.map(x=>Object.freeze({...x})))});
  }catch(e){
   return denied(typeof e?.code==='string'&&e.code.length<128?
    e.code:'GAP_SCAN_DEPENDENCY_UNAVAILABLE');
  }
 }
 return Object.freeze({scan,inspect});
}
