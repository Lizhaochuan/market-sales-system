// V3.2-116 disposable PostgreSQL outbox: CI-only, zero business permissions.
import {createHash} from 'node:crypto';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const ID=/^[a-z0-9][a-z0-9._:-]{5,127}$/;
const SCOPE=['organization_id','incident_id','student_id'];
const MESSAGE=['schema_version','scope','hold_sequence','hold_event_digest',
 'source_proof_digest','message_digest','message_kind','status','created_at_ms'];
const ACK=['schema_version','scope','hold_sequence','message_digest',
 'recipient_id','signed_receipt_digest','status','recorded_at_ms'];
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const exact=(x,keys)=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const validScope=s=>exact(s,SCOPE)&&SCOPE.every(k=>typeof s[k]==='string'&&UUID.test(s[k]));
const goodSeq=x=>Number.isSafeInteger(x)&&x>=1&&x<=64;
const params=s=>SCOPE.map(k=>s[k].toLowerCase());
const fail=code=>{const e=new Error(code);e.code=code;throw e;};
function validateMessage(s,m){
 if(!exact(m,MESSAGE)||m.schema_version!=='v3.2-116-ci-outbox-message-v1'||
  !validScope(m.scope)||SCOPE.some(k=>m.scope[k]!==s[k].toLowerCase())||
  !goodSeq(m.hold_sequence)||!SHA.test(m.hold_event_digest)||
  !SHA.test(m.source_proof_digest)||!SHA.test(m.message_digest)||
  m.message_kind!=='hold_invalidation'||
  m.status!=='PENDING_NEGATIVE_FIXTURE_RECEIPT'||
  !Number.isSafeInteger(m.created_at_ms)||m.created_at_ms<1)
  fail('V116_SQL_OUTBOX_RECORD_INVALID');
}
function validateReceipt(s,r){
 if(!exact(r,ACK)||r.schema_version!=='v3.2-116-ci-delivery-receipt-v1'||
  !validScope(r.scope)||SCOPE.some(k=>r.scope[k]!==s[k].toLowerCase())||
  !goodSeq(r.hold_sequence)||!SHA.test(r.message_digest)||
  !ID.test(r.recipient_id)||!SHA.test(r.signed_receipt_digest)||
  r.status!=='NEGATIVE_FIXTURE_RECEIPT_ONLY'||
  !Number.isSafeInteger(r.recorded_at_ms)||r.recorded_at_ms<1)
  fail('V116_SQL_NEGATIVE_RECEIPT_INVALID');
}
export function createIsolatedPostgresHoldOutbox({
 pool,beforeEnqueueCommit=async()=>{},beforeReceiptCommit=async()=>{}
}={}){
 if(process.env.V106_ISOLATED_PG!=='YES_TEST_ONLY'||!pool||
  typeof pool.connect!=='function'||
  typeof beforeEnqueueCommit!=='function'||
  typeof beforeReceiptCommit!=='function')
  throw TypeError('V116 requires only disposable PostgreSQL test writer');
 async function connect(){
  const c=await pool.connect();
  try{
   const id=await c.query('SELECT current_database() AS db,current_user AS actor');
   if(id.rows[0]?.db!=='v106_isolated'||
    !['v106_writer_a','v106_writer_b'].includes(id.rows[0]?.actor))
    fail('V116_DATABASE_OR_ROLE_UNTRUSTED');
   return c;
  }catch(e){c.release();throw e;}
 }
 async function message(s,seq){
  if(!validScope(s)||!goodSeq(seq))fail('V116_SQL_SCOPE_INVALID');
  const c=await connect();
  try{
   const r=await c.query(
    'SELECT payload,payload_digest FROM v106_test.fixture_hold_outbox WHERE organization_id=$1 AND incident_id=$2 AND student_id=$3 AND hold_sequence=$4',
    [...params(s),seq]);
   if(!r.rowCount)return null;
   const x=JSON.parse(r.rows[0].payload);
   if(sha(x)!==r.rows[0].payload_digest)
    fail('V116_SQL_OUTBOX_PAYLOAD_TAMPERED');
   return Object.freeze(x);
  }finally{c.release();}
 }
 async function receipt(s,seq){
  if(!validScope(s)||!goodSeq(seq))fail('V116_SQL_SCOPE_INVALID');
  const c=await connect();
  try{
   const r=await c.query(
    'SELECT payload,receipt_digest FROM v106_test.fixture_hold_outbox_negative_receipts WHERE organization_id=$1 AND incident_id=$2 AND student_id=$3 AND hold_sequence=$4',
    [...params(s),seq]);
   if(!r.rowCount)return null;
   const x=JSON.parse(r.rows[0].payload);
   if(sha(x)!==r.rows[0].receipt_digest)
    fail('V116_SQL_RECEIPT_PAYLOAD_TAMPERED');
   return Object.freeze(x);
  }finally{c.release();}
 }
 async function transact(operation,scope,action){
  for(let attempt=0;attempt<4;attempt++){
   const c=await connect();let begun=false;
   try{
    await c.query('BEGIN ISOLATION LEVEL SERIALIZABLE');begun=true;
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text,0))',
     ['v116|'+operation+'|'+params(scope).join('|')]);
    const result=await action(c,attempt);
    if(result.accepted!==true){
     await c.query('ROLLBACK');begun=false;return result;
    }
    await c.query('COMMIT');begun=false;return result;
   }catch(e){
    if(begun)await c.query('ROLLBACK').catch(()=>{});
    if(['40001','40P01'].includes(e.code)&&attempt<3)continue;
    if(e.code==='23505')return {
     accepted:false,reason_code:'V116_SQL_DUPLICATE_OR_CONCURRENT_CONFLICT'};
    throw e;
   }finally{c.release();}
  }
  fail('V116_SQL_SERIALIZATION_EXHAUSTED');
 }
 async function enqueue(s,record){
  if(!validScope(s))fail('V116_SQL_SCOPE_INVALID');
  validateMessage(s,record);
  const message_digest=record.message_digest;
  return transact('enqueue',s,async(c,attempt)=>{
   // The V115 hold was already committed, so this is a later SQL
   // snapshot check, NOT atomic source HOLD + outbox creation.
   const head=await c.query(
    'SELECT sequence,event_digest,hold_active FROM v106_test.fixture_review_hold_heads WHERE organization_id=$1 AND incident_id=$2 AND student_id=$3 FOR SHARE',
    params(s));
   const source=await c.query(
    'SELECT event_payload,event_digest FROM v106_test.fixture_review_hold_events WHERE organization_id=$1 AND incident_id=$2 AND student_id=$3 AND sequence=$4',
    [...params(s),record.hold_sequence]);
   const exists=await c.query(
    'SELECT 1 FROM v106_test.fixture_hold_outbox WHERE organization_id=$1 AND incident_id=$2 AND student_id=$3 AND hold_sequence=$4',
    [...params(s),record.hold_sequence]);
   let previous=true;
   if(record.hold_sequence>1){
    const p=await c.query(
     'SELECT 1 FROM v106_test.fixture_hold_outbox WHERE organization_id=$1 AND incident_id=$2 AND student_id=$3 AND hold_sequence=$4',
     [...params(s),record.hold_sequence-1]);
    previous=p.rowCount===1;
   }
   let sourceOk=false;
   if(source.rowCount){
    const body=JSON.parse(source.rows[0].event_payload);
    sourceOk=body.schema_version==='v3.2-115-ci-invalidation-hold-v1'&&
     body.status==='HOLD_PENDING_EXTERNAL_AUTHORITY'&&
     sha(body)===source.rows[0].event_digest.trim()&&
     record.hold_event_digest===source.rows[0].event_digest.trim();
   }
   if(!head.rowCount||head.rows[0].hold_active!==true||
    Number(head.rows[0].sequence)<record.hold_sequence||
    !sourceOk||exists.rowCount||!previous)
    return {accepted:false,message_digest,
     reason_code:'V116_OUTBOX_PRECONDITION_GAP_OR_REPLAY'};
   await c.query(
    'INSERT INTO v106_test.fixture_hold_outbox (organization_id,incident_id,student_id,hold_sequence,hold_event_digest,message_digest,payload,payload_digest) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [...params(s),record.hold_sequence,record.hold_event_digest,
     message_digest,JSON.stringify(record),sha(record)]);
   await beforeEnqueueCommit({scope:s,record,attempt});
   return {accepted:true,message_digest,reason_code:'FIXTURE_OUTBOX_STORED'};
  });
 }
 async function confirm(s,record){
  if(!validScope(s))fail('V116_SQL_SCOPE_INVALID');
  validateReceipt(s,record);
  const receipt_digest=sha(record);
  return transact('confirm',s,async(c,attempt)=>{
   const current=await c.query(
    'SELECT payload,payload_digest,message_digest FROM v106_test.fixture_hold_outbox WHERE organization_id=$1 AND incident_id=$2 AND student_id=$3 AND hold_sequence=$4',
    [...params(s),record.hold_sequence]);
   const prior=record.hold_sequence>1?
    await c.query(
     'SELECT 1 FROM v106_test.fixture_hold_outbox_negative_receipts WHERE organization_id=$1 AND incident_id=$2 AND student_id=$3 AND hold_sequence=$4',
     [...params(s),record.hold_sequence-1]):
    {rowCount:1};
   const replay=await c.query(
    'SELECT 1 FROM v106_test.fixture_hold_outbox_negative_receipts WHERE organization_id=$1 AND incident_id=$2 AND student_id=$3 AND hold_sequence=$4',
    [...params(s),record.hold_sequence]);
   let matching=false;
   if(current.rowCount){
    const payload=JSON.parse(current.rows[0].payload);
    matching=sha(payload)===current.rows[0].payload_digest&&
     payload.status==='PENDING_NEGATIVE_FIXTURE_RECEIPT'&&
     payload.message_digest===record.message_digest&&
     current.rows[0].message_digest===record.message_digest;
   }
   if(!matching||prior.rowCount!==1||replay.rowCount)
    return {accepted:false,receipt_digest,
     reason_code:'V116_NEGATIVE_RECEIPT_PRECONDITION_OR_REPLAY'};
   await c.query(
    'INSERT INTO v106_test.fixture_hold_outbox_negative_receipts (organization_id,incident_id,student_id,hold_sequence,message_digest,receipt_digest,payload) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [...params(s),record.hold_sequence,record.message_digest,
     receipt_digest,JSON.stringify(record)]);
   await beforeReceiptCommit({scope:s,record,attempt});
   return {accepted:true,receipt_digest,
    reason_code:'FIXTURE_NEGATIVE_RECEIPT_STORED'};
  });
 }
 return Object.freeze({enqueue,message,confirm,receipt});
}
