// V3.2-118 disposable PostgreSQL scanner. Real local SERIALIZABLE snapshot,
// no source delivery, external authority, customer data or release API.
import {createHash} from 'node:crypto';
import {computeIsolatedHoldGapReport} from '../../src/cross-module-hold-gap-watermark-scan.mjs';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const SCOPE=['organization_id','incident_id','student_id'];
const ZERO='0'.repeat(64);
const EVENT=['schema_version','scope','sequence','previous_event_digest',
 'checked_through','hold_head_digest','outbox_prefix','negative_receipt_prefix',
 'gaps','gap_digest','snapshot_digest','status','scanned_at_ms'];
const exact=(x,keys)=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const scoped=s=>exact(s,SCOPE)&&SCOPE.every(k=>typeof s[k]==='string'&&UUID.test(s[k]));
const params=s=>SCOPE.map(k=>s[k].toLowerCase());
const fault=c=>{const e=new Error(c);e.code=c;throw e;};
function headRow(r){
 if(r.hold_active!==true)fault('GAP_SCAN_RELEASE_FLAG_FORBIDDEN');
 return {
  sequence:Number(r.sequence),event_digest:r.event_digest,
  checked_through:Number(r.checked_through),
  hold_head_digest:r.hold_head_digest,
  outbox_prefix:Number(r.outbox_prefix),
  negative_receipt_prefix:Number(r.negative_receipt_prefix)
 };
}
async function loadHead(c,s,forUpdate=false){
 const r=await c.query(
  'SELECT sequence,event_digest,checked_through,hold_head_digest,outbox_prefix,negative_receipt_prefix,hold_active FROM v106_test.fixture_hold_gap_scan_heads WHERE organization_id=$1 AND incident_id=$2 AND student_id=$3'+(forUpdate?' FOR UPDATE':''),
  params(s));
 return r.rowCount?headRow(r.rows[0]):null;
}
async function loadEvent(c,s,seq){
 const r=await c.query(
  'SELECT event_payload,event_digest FROM v106_test.fixture_hold_gap_scan_events WHERE organization_id=$1 AND incident_id=$2 AND student_id=$3 AND sequence=$4',
  [...params(s),seq]);
 if(!r.rowCount)return null;
 let obj;
 try{obj=JSON.parse(r.rows[0].event_payload);}catch{fault('GAP_SCAN_AUDIT_EVENT_CORRUPT');}
 if(!exact(obj,EVENT)||sha(obj)!==r.rows[0].event_digest)
  fault('GAP_SCAN_AUDIT_EVENT_CORRUPT');
 return obj;
}
async function currentSnapshot(c,s,t,overdueMs,previous=null){
 const raw=await c.query(
  'SELECT sequence,event_digest,hold_active FROM v106_test.fixture_review_hold_heads WHERE organization_id=$1 AND incident_id=$2 AND student_id=$3',params(s));
 if(raw.rowCount!==1)fault('GAP_SCAN_SOURCE_HOLD_MISSING');
 const h={sequence:Number(raw.rows[0].sequence),
  event_digest:raw.rows[0].event_digest.trim(),
  hold_active:raw.rows[0].hold_active};
 if(!Number.isSafeInteger(h.sequence)||h.sequence<1||h.sequence>64)
  fault('GAP_SCAN_SOURCE_HOLD_INVALID');
 const [evs,msgs,acks]=await Promise.all([
  c.query('SELECT sequence,event_payload,event_digest FROM v106_test.fixture_review_hold_events WHERE organization_id=$1 AND incident_id=$2 AND student_id=$3 ORDER BY sequence',params(s)),
  c.query('SELECT hold_sequence,payload,payload_digest,message_digest FROM v106_test.fixture_hold_outbox WHERE organization_id=$1 AND incident_id=$2 AND student_id=$3 ORDER BY hold_sequence',params(s)),
  c.query('SELECT hold_sequence,payload,receipt_digest,message_digest FROM v106_test.fixture_hold_outbox_negative_receipts WHERE organization_id=$1 AND incident_id=$2 AND student_id=$3 ORDER BY hold_sequence',params(s))
 ]);
 const holdEvents=Array(h.sequence).fill(null);
 const outboxMessages=Array(h.sequence).fill(null);
 const negativeReceipts=Array(h.sequence).fill(null);
 function decode(rows,where,seqKey,expectDigest,expectedMsg=false){
  for(const row of rows){
   const n=Number(row[seqKey]);
   if(!Number.isSafeInteger(n)||n<1||n>h.sequence||where[n-1]!==null)
    fault('GAP_SCAN_ROW_SEQUENCE_CORRUPT');
   let payload;
   try{payload=JSON.parse(row[expectDigest==='event_digest'?
    'event_payload':'payload']);}catch{fault('GAP_SCAN_ROW_PAYLOAD_CORRUPT');}
   if(sha(payload)!==row[expectDigest].trim()||
    (expectedMsg&&payload.message_digest!==row.message_digest))
    fault('GAP_SCAN_ROW_DIGEST_TAMPERED');
   where[n-1]=payload;
  }
 }
 decode(evs.rows,holdEvents,'sequence','event_digest');
 decode(msgs.rows,outboxMessages,'hold_sequence','payload_digest',true);
 decode(acks.rows,negativeReceipts,'hold_sequence','receipt_digest',true);
 return computeIsolatedHoldGapReport({
  scope:s,holdHead:h,holdEvents,outboxMessages,negativeReceipts,
  previousWatermark:previous,nowMs:t,receiptOverdueMs:overdueMs
 });
}
export function createIsolatedPostgresHoldGapScan({
 pool,beforeCommit=async()=>{}
}={}){
 if(process.env.V106_ISOLATED_PG!=='YES_TEST_ONLY'||!pool||
  typeof pool.connect!=='function'||typeof beforeCommit!=='function')
  throw TypeError('V118 scanner requires disposable PostgreSQL only');
 async function connect(){
  const c=await pool.connect();
  try{
   const r=await c.query('SELECT current_database() AS db,current_user AS actor');
   if(r.rows[0]?.db!=='v106_isolated'||
    !['v106_writer_a','v106_writer_b'].includes(r.rows[0]?.actor))
    fault('GAP_SCAN_WRONG_DATABASE_OR_ROLE');
   return c;
  }catch(e){c.release();throw e;}
 }
 async function head(s){
  if(!scoped(s))fault('GAP_SCAN_SQL_SCOPE_INVALID');
  const c=await connect();
  try{return await loadHead(c,s);}finally{c.release();}
 }
 async function event(s,seq){
  if(!scoped(s)||!Number.isSafeInteger(seq)||seq<1||seq>128)
   fault('GAP_SCAN_SQL_EVENT_INPUT_INVALID');
  const c=await connect();
  try{return await loadEvent(c,s,seq);}finally{c.release();}
 }
 async function snapshot(s,t,overdueMs){
  if(!scoped(s))fault('GAP_SCAN_SQL_SCOPE_INVALID');
  const c=await connect();let started=false;
  try{
   await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   started=true;
   const report=await currentSnapshot(c,s,t,overdueMs);
   await c.query('COMMIT');started=false;return report;
  }catch(e){
   if(started)await c.query('ROLLBACK').catch(()=>{});
   throw e;
  }finally{c.release();}
 }
 async function scan(s,t,overdueMs){
  if(!scoped(s))fault('GAP_SCAN_SQL_SCOPE_INVALID');
  for(let attempt=0;attempt<4;attempt++){
   const c=await connect();let started=false;
   try{
    await c.query('BEGIN ISOLATION LEVEL SERIALIZABLE');started=true;
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text,0))',
     ['v118|'+params(s).join('|')]);
    const prev=await loadHead(c,s,true);
    if(prev){
     const old=await loadEvent(c,s,prev.sequence);
     if(!old||sha(old)!==prev.event_digest||
      old.sequence!==prev.sequence||
      old.checked_through!==prev.checked_through||
      old.hold_head_digest!==prev.hold_head_digest||
      old.outbox_prefix!==prev.outbox_prefix||
      old.negative_receipt_prefix!==prev.negative_receipt_prefix)
      fault('GAP_SCAN_PREVIOUS_AUDIT_TAMPERED');
    }
    const previousWatermark=prev?{
     checked_through:prev.checked_through,
     hold_head_digest:prev.hold_head_digest,
     outbox_prefix:prev.outbox_prefix,
     negative_receipt_prefix:prev.negative_receipt_prefix
    }:null;
    const report=await currentSnapshot(c,s,t,overdueMs,previousWatermark);
    const record={
     schema_version:'v3.2-118-ci-gap-scan-v1',scope:s,
     sequence:(prev?.sequence||0)+1,
     previous_event_digest:prev?.event_digest??ZERO,
     checked_through:report.checked_through,
     hold_head_digest:report.hold_head_digest,
     outbox_prefix:report.outbox_prefix,
     negative_receipt_prefix:report.negative_receipt_prefix,
     gaps:report.gaps,gap_digest:report.gap_digest,
     snapshot_digest:report.snapshot_digest,
     status:'HOLD_ACTIVE_GAP_AUDIT_ONLY',scanned_at_ms:t
    };
    const event_digest=sha(record);
    const dupe=await c.query(
     'SELECT 1 FROM v106_test.fixture_hold_gap_scan_events WHERE organization_id=$1 AND incident_id=$2 AND student_id=$3 AND snapshot_digest=$4',
     [...params(s),report.snapshot_digest]);
    if(dupe.rowCount){
     await c.query('ROLLBACK');started=false;
     return {accepted:false,sequence:record.sequence,
      event_digest,report,reason_code:'GAP_SCAN_DUPLICATE_SNAPSHOT'};
    }
    await c.query(
     'INSERT INTO v106_test.fixture_hold_gap_scan_events (organization_id,incident_id,student_id,sequence,snapshot_digest,event_payload,event_digest) VALUES($1,$2,$3,$4,$5,$6,$7)',
     [...params(s),record.sequence,record.snapshot_digest,
      JSON.stringify(record),event_digest]);
    await c.query(
     `INSERT INTO v106_test.fixture_hold_gap_scan_heads
      (organization_id,incident_id,student_id,sequence,event_digest,
       checked_through,hold_head_digest,outbox_prefix,negative_receipt_prefix,hold_active)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,true)
      ON CONFLICT(organization_id,incident_id,student_id) DO UPDATE SET
       sequence=EXCLUDED.sequence,event_digest=EXCLUDED.event_digest,
       checked_through=EXCLUDED.checked_through,
       hold_head_digest=EXCLUDED.hold_head_digest,
       outbox_prefix=EXCLUDED.outbox_prefix,
       negative_receipt_prefix=EXCLUDED.negative_receipt_prefix`,
     [...params(s),record.sequence,event_digest,record.checked_through,
      record.hold_head_digest,record.outbox_prefix,record.negative_receipt_prefix]);
    await beforeCommit({scope:s,record,attempt});
    await c.query('COMMIT');started=false;
    return {accepted:true,sequence:record.sequence,event_digest,
     report,reason_code:'FIXTURE_GAP_SCAN_APPENDED'};
   }catch(e){
    if(started)await c.query('ROLLBACK').catch(()=>{});
    if(['40001','40P01'].includes(e.code)&&attempt<3)continue;
    if(e.code==='23505')return {accepted:false,sequence:0,event_digest:ZERO,
     report:null,reason_code:'GAP_SCAN_SQL_CONFLICT'};
    throw e;
   }finally{c.release();}
  }
  fault('GAP_SCAN_SERIALIZATION_EXHAUSTED');
 }
 return Object.freeze({head,event,snapshot,scan});
}
