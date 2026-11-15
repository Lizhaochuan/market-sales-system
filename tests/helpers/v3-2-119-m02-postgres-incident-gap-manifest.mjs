// V3.2-119: incident-bound, student-first, disposable PostgreSQL audit.
import {createHash} from 'node:crypto';
import {computeIsolatedHoldGapReport} from '../../src/cross-module-hold-gap-watermark-scan.mjs';
import {buildIsolatedIncidentGapManifest} from '../../src/cross-module-incident-gap-manifest.mjs';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SCOPE=['organization_id','incident_id'],ZERO='0'.repeat(64);
const EVENT=['schema_version','scope','sequence','previous_event_digest',
 'student_count','hold_event_count','scanned_student_count',
 'missing_scan_count','stale_scan_count','unresolved_gap_count',
 'source_snapshot_digest','manifest_digest','manifest','status','recorded_at_ms'];
const V118=['schema_version','scope','sequence','previous_event_digest',
 'checked_through','hold_head_digest','outbox_prefix','negative_receipt_prefix',
 'gaps','gap_digest','snapshot_digest','status','scanned_at_ms'];
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const exact=(x,fields)=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 Object.keys(x).length===fields.length&&fields.every(k=>Object.hasOwn(x,k));
const scoped=s=>exact(s,SCOPE)&&SCOPE.every(k=>typeof s[k]==='string'&&UUID.test(s[k]));
const fail=c=>{const e=new Error(c);e.code=c;throw e;};
const args=s=>SCOPE.map(k=>s[k].toLowerCase());
async function capture(c,scope,at,overdueMs,maxStudents){
 const res=await c.query(
  'SELECT student_id FROM v106_test.fixture_review_hold_heads WHERE organization_id=$1 AND incident_id=$2 ORDER BY student_id',
  args(scope));
 if(res.rowCount===0)fail('INCIDENT_MANIFEST_NO_HOLD_STUDENTS');
 if(res.rowCount>maxStudents)fail('INCIDENT_MANIFEST_COVERAGE_LIMIT_EXCEEDED');
 const studentReports=[];
 for(const row of res.rows){
  const student=row.student_id.toLowerCase(),sc={...scope,student_id:student};
  const p=[...args(scope),student];
  const [h,events,messages,receipts,scanHead,scanEvents]=await Promise.all([
   c.query('SELECT sequence,event_digest,hold_active FROM v106_test.fixture_review_hold_heads WHERE organization_id=$1 AND incident_id=$2 AND student_id=$3',p),
   c.query('SELECT sequence,event_payload,event_digest FROM v106_test.fixture_review_hold_events WHERE organization_id=$1 AND incident_id=$2 AND student_id=$3 ORDER BY sequence',p),
   c.query('SELECT hold_sequence,payload,payload_digest,message_digest FROM v106_test.fixture_hold_outbox WHERE organization_id=$1 AND incident_id=$2 AND student_id=$3 ORDER BY hold_sequence',p),
   c.query('SELECT hold_sequence,payload,receipt_digest,message_digest FROM v106_test.fixture_hold_outbox_negative_receipts WHERE organization_id=$1 AND incident_id=$2 AND student_id=$3 ORDER BY hold_sequence',p),
   c.query('SELECT sequence,event_digest,checked_through,hold_head_digest,outbox_prefix,negative_receipt_prefix,hold_active FROM v106_test.fixture_hold_gap_scan_heads WHERE organization_id=$1 AND incident_id=$2 AND student_id=$3',p),
   c.query('SELECT sequence,event_payload,event_digest FROM v106_test.fixture_hold_gap_scan_events WHERE organization_id=$1 AND incident_id=$2 AND student_id=$3 ORDER BY sequence',p)
  ]);
  if(h.rowCount!==1)fail('INCIDENT_MANIFEST_HOLD_HEAD_MISSING');
  const holdHead={sequence:Number(h.rows[0].sequence),
   event_digest:h.rows[0].event_digest.trim(),
   hold_active:h.rows[0].hold_active};
  if(holdHead.sequence<1||holdHead.sequence>64||
   !Number.isSafeInteger(holdHead.sequence))
   fail('INCIDENT_MANIFEST_HOLD_SEQUENCE_INVALID');
  const holdEvents=Array(holdHead.sequence).fill(null);
  const outboxMessages=Array(holdHead.sequence).fill(null);
  const negativeReceipts=Array(holdHead.sequence).fill(null);
  function unpack(rows,target,seqKey,payloadKey,digestKey,checkMessage=false){
   for(const item of rows){
    const n=Number(item[seqKey]);
    if(!Number.isSafeInteger(n)||n<1||n>holdHead.sequence||
     target[n-1]!==null)fail('INCIDENT_MANIFEST_SEQUENCE_GAP_OR_DUPLICATE');
    let body;
    try{body=JSON.parse(item[payloadKey]);}catch{
     fail('INCIDENT_MANIFEST_SOURCE_JSON_INVALID');
    }
    if(sha(body)!==item[digestKey].trim()||
     (checkMessage&&body.message_digest!==item.message_digest))
     fail('INCIDENT_MANIFEST_SOURCE_ROW_TAMPERED');
    target[n-1]=body;
   }
  }
  unpack(events.rows,holdEvents,'sequence','event_payload','event_digest');
  unpack(messages.rows,outboxMessages,'hold_sequence','payload','payload_digest',true);
  unpack(receipts.rows,negativeReceipts,'hold_sequence','payload','receipt_digest',true);
  const report=computeIsolatedHoldGapReport({
   scope:sc,holdHead,holdEvents,outboxMessages,negativeReceipts,
   nowMs:at,receiptOverdueMs:overdueMs});
  let scan_status='UNSCANNED_HOLD_STUDENT';
  if(scanHead.rowCount===0&&scanEvents.rowCount!==0)
   fail('INCIDENT_MANIFEST_ORPHAN_STUDENT_SCAN');
  if(scanHead.rowCount){
   const head=scanHead.rows[0];
   if(head.hold_active!==true||scanEvents.rowCount===0||
    scanEvents.rowCount>128||
    Number(head.sequence)!==scanEvents.rowCount)
    fail('INCIDENT_MANIFEST_STUDENT_AUDIT_UNVERIFIED');
   let previous=ZERO,last=null;
   for(let i=0;i<scanEvents.rows.length;i++){
    const item=scanEvents.rows[i];let ev;
    try{ev=JSON.parse(item.event_payload);}catch{
     fail('INCIDENT_MANIFEST_STUDENT_AUDIT_UNVERIFIED');
    }
    if(Number(item.sequence)!==i+1||!exact(ev,V118)||
     ev.schema_version!=='v3.2-118-ci-gap-scan-v1'||
     JSON.stringify(ev.scope)!==JSON.stringify(sc)||
     ev.sequence!==i+1||ev.previous_event_digest!==previous||
     ev.status!=='HOLD_ACTIVE_GAP_AUDIT_ONLY'||
     sha(ev)!==item.event_digest||
     sha(ev.gaps)!==ev.gap_digest)
     fail('INCIDENT_MANIFEST_STUDENT_AUDIT_UNVERIFIED');
    previous=sha(ev);last=ev;
   }
   if(previous!==head.event_digest||
    Number(head.checked_through)!==last.checked_through||
    head.hold_head_digest!==last.hold_head_digest||
    Number(head.outbox_prefix)!==last.outbox_prefix||
    Number(head.negative_receipt_prefix)!==last.negative_receipt_prefix)
    fail('INCIDENT_MANIFEST_STUDENT_AUDIT_UNVERIFIED');
   scan_status=last.snapshot_digest===report.snapshot_digest&&
    last.checked_through===report.checked_through&&
    last.outbox_prefix===report.outbox_prefix&&
    last.negative_receipt_prefix===report.negative_receipt_prefix&&
    last.gap_digest===report.gap_digest?
     'CURRENT_TEST_SCAN':'STALE_TEST_SCAN';
  }
  studentReports.push({student_id:student,report,scan_status});
 }
 return buildIsolatedIncidentGapManifest({
  scope,studentReports,maxStudents});
}
export function createIsolatedPostgresIncidentGapManifest({
 pool,maxStudents=8,receiptOverdueMs=60000,beforeCommit=async()=>{}
}={}){
 if(process.env.V106_ISOLATED_PG!=='YES_TEST_ONLY'||!pool||
  typeof pool.connect!=='function'||typeof beforeCommit!=='function'||
  !Number.isSafeInteger(maxStudents)||maxStudents<1||maxStudents>8||
  !Number.isSafeInteger(receiptOverdueMs)||receiptOverdueMs<1000||
  receiptOverdueMs>86400000)
  throw TypeError('V119 requires bounded disposable SQL and no external authority');
 async function connect(){
  const c=await pool.connect();
  try{
   const r=await c.query('SELECT current_database() AS db,current_user AS actor');
   if(r.rows[0]?.db!=='v106_isolated'||
    !['v106_writer_a','v106_writer_b'].includes(r.rows[0]?.actor))
    fail('INCIDENT_MANIFEST_SQL_ROLE_OR_DATABASE_UNTRUSTED');
   return c;
  }catch(e){c.release();throw e;}
 }
 async function readHead(c,scope,lock=false){
  const r=await c.query(
   'SELECT sequence,event_digest,student_count,source_snapshot_digest,hold_active FROM v106_test.fixture_incident_gap_manifest_heads WHERE organization_id=$1 AND incident_id=$2'+(lock?' FOR UPDATE':''),
   args(scope));
  if(!r.rowCount)return null;
  if(r.rows[0].hold_active!==true)
   fail('INCIDENT_MANIFEST_HOLD_RELEASE_FORBIDDEN');
  return {sequence:Number(r.rows[0].sequence),
   event_digest:r.rows[0].event_digest,
   student_count:Number(r.rows[0].student_count),
   source_snapshot_digest:r.rows[0].source_snapshot_digest};
 }
 async function readEvent(c,scope,seq){
  const r=await c.query(
   'SELECT event_payload,event_digest FROM v106_test.fixture_incident_gap_manifest_events WHERE organization_id=$1 AND incident_id=$2 AND sequence=$3',
   [...args(scope),seq]);
  if(!r.rowCount)return null;
  let ev;
  try{ev=JSON.parse(r.rows[0].event_payload);}catch{
   fail('INCIDENT_MANIFEST_AUDIT_ROW_TAMPERED');
  }
  if(!exact(ev,EVENT)||sha(ev)!==r.rows[0].event_digest||
   ev.schema_version!=='v3.2-119-ci-incident-gap-audit-v1'||
   ev.status!=='HOLD_ACTIVE_MANIFEST_AUDIT_ONLY')
   fail('INCIDENT_MANIFEST_AUDIT_ROW_TAMPERED');
  return ev;
 }
 async function head(scope){
  if(!scoped(scope))fail('INCIDENT_MANIFEST_SQL_SCOPE_INVALID');
  const c=await connect();
  try{return await readHead(c,scope);}finally{c.release();}
 }
 async function event(scope,seq){
  if(!scoped(scope)||!Number.isSafeInteger(seq)||seq<1||seq>128)
   fail('INCIDENT_MANIFEST_SQL_EVENT_INVALID');
  const c=await connect();
  try{return await readEvent(c,scope,seq);}finally{c.release();}
 }
 async function captureOnly(scope,t){
  if(!scoped(scope))fail('INCIDENT_MANIFEST_SQL_SCOPE_INVALID');
  const c=await connect();let begun=false;
  try{
   await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');begun=true;
   const result=await capture(c,scope,t,receiptOverdueMs,maxStudents);
   await c.query('COMMIT');begun=false;return result;
  }catch(e){
   if(begun)await c.query('ROLLBACK').catch(()=>{});
   throw e;
  }finally{c.release();}
 }
 async function captureAndAppend(scope,t){
  if(!scoped(scope))fail('INCIDENT_MANIFEST_SQL_SCOPE_INVALID');
  for(let attempt=0;attempt<4;attempt++){
   const c=await connect();let begun=false;
   try{
    await c.query('BEGIN ISOLATION LEVEL SERIALIZABLE');begun=true;
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text,0))',
     ['v119|'+args(scope).join('|')]);
    const prior=await readHead(c,scope,true);
    if(prior){
     const ev=await readEvent(c,scope,prior.sequence);
     if(!ev||sha(ev)!==prior.event_digest||
      ev.sequence!==prior.sequence||
      ev.student_count!==prior.student_count||
      ev.source_snapshot_digest!==prior.source_snapshot_digest)
      fail('INCIDENT_MANIFEST_PREVIOUS_HEAD_TAMPERED');
    }
    const summary=await capture(c,scope,t,receiptOverdueMs,maxStudents);
    if(prior&&summary.student_count<prior.student_count)
     fail('INCIDENT_MANIFEST_STUDENT_COVERAGE_REGRESSION');
    const sequence=(prior?.sequence||0)+1;
    if(sequence>128)fail('INCIDENT_MANIFEST_AUDIT_LIMIT_EXCEEDED');
    const record={schema_version:'v3.2-119-ci-incident-gap-audit-v1',
     scope,sequence,previous_event_digest:prior?.event_digest??ZERO,
     student_count:summary.student_count,
     hold_event_count:summary.hold_event_count,
     scanned_student_count:summary.scanned_student_count,
     missing_scan_count:summary.missing_scan_count,
     stale_scan_count:summary.stale_scan_count,
     unresolved_gap_count:summary.unresolved_gap_count,
     source_snapshot_digest:summary.source_snapshot_digest,
     manifest_digest:summary.manifest_digest,
     manifest:summary.manifest,
     status:'HOLD_ACTIVE_MANIFEST_AUDIT_ONLY',recorded_at_ms:t};
    const event_digest=sha(record);
    const duplicate=await c.query(
     'SELECT 1 FROM v106_test.fixture_incident_gap_manifest_events WHERE organization_id=$1 AND incident_id=$2 AND source_snapshot_digest=$3',
     [...args(scope),summary.source_snapshot_digest]);
    if(duplicate.rowCount){
     await c.query('ROLLBACK');begun=false;
     return {accepted:false,sequence,event_digest,summary,
      reason_code:'INCIDENT_MANIFEST_SNAPSHOT_REPLAY'};
    }
    await c.query(
     'INSERT INTO v106_test.fixture_incident_gap_manifest_events(organization_id,incident_id,sequence,manifest_digest,source_snapshot_digest,event_payload,event_digest) VALUES($1,$2,$3,$4,$5,$6,$7)',
     [...args(scope),sequence,summary.manifest_digest,
      summary.source_snapshot_digest,JSON.stringify(record),event_digest]);
    await c.query(
     `INSERT INTO v106_test.fixture_incident_gap_manifest_heads
      (organization_id,incident_id,sequence,event_digest,student_count,source_snapshot_digest,hold_active)
      VALUES($1,$2,$3,$4,$5,$6,true)
      ON CONFLICT(organization_id,incident_id) DO UPDATE SET
       sequence=EXCLUDED.sequence,event_digest=EXCLUDED.event_digest,
       student_count=EXCLUDED.student_count,
       source_snapshot_digest=EXCLUDED.source_snapshot_digest`,
     [...args(scope),sequence,event_digest,summary.student_count,
      summary.source_snapshot_digest]);
    await beforeCommit({scope,record,attempt});
    await c.query('COMMIT');begun=false;
    return {accepted:true,sequence,event_digest,summary,
     reason_code:'FIXTURE_INCIDENT_MANIFEST_STORED'};
   }catch(e){
    if(begun)await c.query('ROLLBACK').catch(()=>{});
    if(['40001','40P01'].includes(e.code)&&attempt<3)continue;
    if(e.code==='23505')return {
     accepted:false,sequence:0,event_digest:ZERO,summary:null,
     reason_code:'INCIDENT_MANIFEST_SQL_CONFLICT'};
    throw e;
   }finally{c.release();}
  }
  fail('INCIDENT_MANIFEST_SERIALIZATION_EXHAUSTED');
 }
 return Object.freeze({captureAndAppend,capture:captureOnly,head,event});
}
