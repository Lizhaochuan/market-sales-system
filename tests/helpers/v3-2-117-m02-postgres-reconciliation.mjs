// V3.2-117 disposable PostgreSQL snapshot-fenced reconciliation audit.
// No external transport, retry worker, cancellation or real authorization.
import {createHash} from 'node:crypto';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const ZERO='0'.repeat(64);
const SCOPE=['organization_id','incident_id','student_id'];
const AUDIT=['schema_version','scope','sequence','previous_event_digest',
 'hold_sequence','hold_event_digest','hold_head_digest','message_digest',
 'receipt_digest','upstream_snapshot_digest','authority_proof_digest',
 'classification','manual_action','cause_digest','status','recorded_at_ms'];
const OPTIONS={
 OUTBOX_GAP:'RECONCILE_MISSING_OUTBOX_MANUALLY',
 AWAITING_NEGATIVE_RECEIPT:'WAIT_AND_RECHECK_MANUALLY',
 NEGATIVE_RECEIPT_OVERDUE:'INVESTIGATE_UNCERTAIN_DELIVERY',
 NEGATIVE_RECEIPT_RECORDED:'PRESERVE_NEGATIVE_RECEIPT_AND_HOLD',
 SIGNED_FIXTURE_CANCELLATION_ADVISORY:'QUARANTINE_AND_VERIFY_REISSUE_MANUALLY',
 SOURCE_PROOF_UNVERIFIED:'VERIFY_INDEPENDENT_SOURCE_MANUALLY'
};
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const exact=(x,fields)=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 Object.keys(x).length===fields.length&&fields.every(k=>Object.hasOwn(x,k));
const scoped=s=>exact(s,SCOPE)&&SCOPE.every(k=>typeof s[k]==='string'&&UUID.test(s[k]));
const args=s=>SCOPE.map(k=>s[k].toLowerCase());
const goodSeq=x=>Number.isSafeInteger(x)&&x>=1&&x<=128;
const fail=c=>{const e=new Error(c);e.code=c;throw e;};
function checkRecord(s,r){
 if(!exact(r,AUDIT)||r.schema_version!=='v3.2-117-ci-reconciliation-v1'||
  !scoped(r.scope)||SCOPE.some(k=>r.scope[k]!==s[k].toLowerCase())||
  !goodSeq(r.sequence)||!goodSeq(r.hold_sequence)||r.hold_sequence>64||
  !SHA.test(r.previous_event_digest)||!SHA.test(r.hold_event_digest)||
  !SHA.test(r.hold_head_digest)||!SHA.test(r.message_digest)||
  !SHA.test(r.receipt_digest)||!SHA.test(r.upstream_snapshot_digest)||
  !SHA.test(r.authority_proof_digest)||
  !Object.hasOwn(OPTIONS,r.classification)||
  r.manual_action!==OPTIONS[r.classification]||
  r.cause_digest!==sha({scope:r.scope,hold_sequence:r.hold_sequence,
   classification:r.classification,
   upstream_snapshot_digest:r.upstream_snapshot_digest,
   authority_proof_digest:r.authority_proof_digest})||
  r.status!=='HOLD_ACTIVE_NEGATIVE_AUDIT_ONLY'||
  !Number.isSafeInteger(r.recorded_at_ms)||r.recorded_at_ms<1)
  fail('V117_SQL_RECONCILIATION_RECORD_INVALID');
}
export function createIsolatedPostgresDeliveryReconciliation({
 pool,beforeCommit=async()=>{}
}={}){
 if(process.env.V106_ISOLATED_PG!=='YES_TEST_ONLY'||!pool||
  typeof pool.connect!=='function'||typeof beforeCommit!=='function')
  throw TypeError('V117 audit may use disposable PostgreSQL CI only');
 async function connect(){
  const c=await pool.connect();
  try{
   const r=await c.query('SELECT current_database() AS db,current_user AS actor');
   if(r.rows[0]?.db!=='v106_isolated'||
    !['v106_writer_a','v106_writer_b'].includes(r.rows[0]?.actor))
    fail('V117_SQL_DATABASE_OR_ROLE_UNTRUSTED');
   return c;
  }catch(e){c.release();throw e;}
 }
 async function head(s){
  if(!scoped(s))fail('V117_SQL_SCOPE_INVALID');
  const c=await connect();
  try{
   const r=await c.query(
    'SELECT sequence,event_digest,hold_active FROM v106_test.fixture_delivery_reconciliation_heads WHERE organization_id=$1 AND incident_id=$2 AND student_id=$3',args(s));
   if(!r.rowCount)return null;
   if(r.rows[0].hold_active!==true)fail('V117_SQL_HOLD_RELEASE_FORBIDDEN');
   return Object.freeze({sequence:Number(r.rows[0].sequence),
    event_digest:r.rows[0].event_digest});
  }finally{c.release();}
 }
 async function event(s,seq){
  if(!scoped(s)||!goodSeq(seq))fail('V117_SQL_EVENT_SCOPE_INVALID');
  const c=await connect();
  try{
   const r=await c.query(
    'SELECT event_payload,event_digest FROM v106_test.fixture_delivery_reconciliation_events WHERE organization_id=$1 AND incident_id=$2 AND student_id=$3 AND sequence=$4',
    [...args(s),seq]);
   if(!r.rowCount)return null;
   const payload=JSON.parse(r.rows[0].event_payload);
   if(sha(payload)!==r.rows[0].event_digest)
    fail('V117_SQL_EVENT_DIGEST_UNVERIFIED');
   return Object.freeze(payload);
  }finally{c.release();}
 }
 async function append(s,record){
  if(!scoped(s))fail('V117_SQL_SCOPE_INVALID');
  checkRecord(s,record);
  const event_digest=sha(record);
  for(let attempt=0;attempt<4;attempt++){
   const c=await connect();let begun=false;
   try{
    await c.query('BEGIN ISOLATION LEVEL SERIALIZABLE');begun=true;
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text,0))',
     ['v117|'+args(s).join('|')]);
    const holdHead=await c.query(
     'SELECT sequence,event_digest,hold_active FROM v106_test.fixture_review_hold_heads WHERE organization_id=$1 AND incident_id=$2 AND student_id=$3 FOR SHARE',args(s));
    const hold=await c.query(
     'SELECT event_payload,event_digest FROM v106_test.fixture_review_hold_events WHERE organization_id=$1 AND incident_id=$2 AND student_id=$3 AND sequence=$4',
     [...args(s),record.hold_sequence]);
    const outbox=await c.query(
     'SELECT payload,payload_digest,message_digest FROM v106_test.fixture_hold_outbox WHERE organization_id=$1 AND incident_id=$2 AND student_id=$3 AND hold_sequence=$4',
     [...args(s),record.hold_sequence]);
    const negative=await c.query(
     'SELECT payload,receipt_digest,message_digest FROM v106_test.fixture_hold_outbox_negative_receipts WHERE organization_id=$1 AND incident_id=$2 AND student_id=$3 AND hold_sequence=$4',
     [...args(s),record.hold_sequence]);
    const before=await c.query(
     'SELECT sequence,event_digest,hold_active FROM v106_test.fixture_delivery_reconciliation_heads WHERE organization_id=$1 AND incident_id=$2 AND student_id=$3 FOR UPDATE',args(s));
    const prior=before.rowCount?{
     sequence:Number(before.rows[0].sequence),
     event_digest:before.rows[0].event_digest,
     hold_active:before.rows[0].hold_active}:null;
    if(prior?.hold_active!==undefined&&prior.hold_active!==true)
     fail('V117_SQL_HOLD_RELEASE_FORBIDDEN');
    if(prior){
     const prev=await c.query(
      'SELECT event_payload,event_digest FROM v106_test.fixture_delivery_reconciliation_events WHERE organization_id=$1 AND incident_id=$2 AND student_id=$3 AND sequence=$4',
      [...args(s),prior.sequence]);
     if(!prev.rowCount||sha(JSON.parse(prev.rows[0].event_payload))!==
      prev.rows[0].event_digest||
      prev.rows[0].event_digest!==prior.event_digest)
      fail('V117_SQL_PREVIOUS_EVENT_UNVERIFIED');
    }
    const duplicate=await c.query(
     'SELECT 1 FROM v106_test.fixture_delivery_reconciliation_events WHERE organization_id=$1 AND incident_id=$2 AND student_id=$3 AND cause_digest=$4',
     [...args(s),record.cause_digest]);
    let verified=holdHead.rowCount===1&&hold.rowCount===1&&
     holdHead.rows[0].hold_active===true&&
     Number(holdHead.rows[0].sequence)>=record.hold_sequence&&
     holdHead.rows[0].event_digest===record.hold_head_digest;
    let holdDigest=null,outboxDigest=ZERO,receiptDigest=ZERO,messageDigest=ZERO;
    if(verified){
     const body=JSON.parse(hold.rows[0].event_payload);
     holdDigest=sha(body);
     verified=holdDigest===hold.rows[0].event_digest.trim()&&
      body.schema_version==='v3.2-115-ci-invalidation-hold-v1'&&
      body.status==='HOLD_PENDING_EXTERNAL_AUTHORITY'&&
      body.sequence===record.hold_sequence;
    }
    if(outbox.rowCount){
     const body=JSON.parse(outbox.rows[0].payload);
     outboxDigest=sha(body);messageDigest=body.message_digest;
     verified=verified&&outboxDigest===outbox.rows[0].payload_digest&&
      body.schema_version==='v3.2-116-ci-outbox-message-v1'&&
      body.message_kind==='hold_invalidation'&&
      body.status==='PENDING_NEGATIVE_FIXTURE_RECEIPT'&&
      body.hold_event_digest===holdDigest&&
      body.message_digest===outbox.rows[0].message_digest;
    }
    if(negative.rowCount){
     const body=JSON.parse(negative.rows[0].payload);
     receiptDigest=sha(body);
     verified=verified&&outbox.rowCount===1&&
      receiptDigest===negative.rows[0].receipt_digest&&
      body.schema_version==='v3.2-116-ci-delivery-receipt-v1'&&
      body.status==='NEGATIVE_FIXTURE_RECEIPT_ONLY'&&
      body.message_digest===messageDigest&&
      body.message_digest===negative.rows[0].message_digest;
    }
    const snapshotDigest=sha({
     hold_head_digest:record.hold_head_digest,
     hold_event_digest:holdDigest,
     outbox_digest:outboxDigest,receipt_digest:receiptDigest
    });
    if(!verified||record.hold_event_digest!==holdDigest||
     record.message_digest!==messageDigest||
     record.receipt_digest!==receiptDigest||
     record.upstream_snapshot_digest!==snapshotDigest||
     duplicate.rowCount||record.sequence!==(prior?.sequence||0)+1||
     record.previous_event_digest!==(prior?.event_digest||ZERO))
    {
     await c.query('ROLLBACK');begun=false;
     return {accepted:false,event_digest,
      reason_code:'RECONCILE_SNAPSHOT_OR_REPLAY_CONFLICT'};
    }
    await c.query(
     'INSERT INTO v106_test.fixture_delivery_reconciliation_events (organization_id,incident_id,student_id,sequence,hold_sequence,cause_digest,event_payload,event_digest) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
     [...args(s),record.sequence,record.hold_sequence,record.cause_digest,
      JSON.stringify(record),event_digest]);
    await c.query(
     `INSERT INTO v106_test.fixture_delivery_reconciliation_heads
      (organization_id,incident_id,student_id,sequence,event_digest,hold_active)
      VALUES($1,$2,$3,$4,$5,true)
      ON CONFLICT(organization_id,incident_id,student_id)
      DO UPDATE SET sequence=EXCLUDED.sequence,event_digest=EXCLUDED.event_digest`,
     [...args(s),record.sequence,event_digest]);
    await beforeCommit({scope:s,record,attempt});
    await c.query('COMMIT');begun=false;
    return {accepted:true,event_digest,
     reason_code:'RECONCILIATION_NEGATIVE_EVENT_STORED'};
   }catch(e){
    if(begun)await c.query('ROLLBACK').catch(()=>{});
    if(['40001','40P01'].includes(e.code)&&attempt<3)continue;
    if(e.code==='23505')
     return {accepted:false,event_digest,
      reason_code:'RECONCILE_SNAPSHOT_OR_REPLAY_CONFLICT'};
    throw e;
   }finally{c.release();}
  }
  fail('V117_SQL_SERIALIZATION_RETRIES_EXHAUSTED');
 }
 return Object.freeze({head,event,append});
}
