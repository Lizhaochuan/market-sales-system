// V3.2-115: disposable PostgreSQL hold events, no release operation.
import {createHash} from 'node:crypto';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const ID=/^[a-z0-9][a-z0-9._:-]{5,127}$/;
const EVENTS=['schema_version','scope','sequence','previous_event_digest',
 'assignment_digest','intake_head_digest','lifecycle_head_digest',
 'reviewer_id','trigger_kind','source_signal_digest','cause_digest',
 'status','recorded_at_ms'];
const SCOPE=['organization_id','incident_id','student_id'];
const TRIGGERS=['EVIDENCE_UPDATED','REVIEWER_CHANGED','REVIEWER_UNASSIGNED',
 'REVIEWER_REVOKED','SOURCE_PROOF_UNVERIFIED'];
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const exact=(x,keys)=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const scoped=s=>exact(s,SCOPE)&&SCOPE.every(k=>typeof s[k]==='string'&&UUID.test(s[k]));
const params=s=>SCOPE.map(k=>s[k].toLowerCase());
const fail=c=>{const e=new Error(c);e.code=c;throw e;};
function validate(s,r){
 if(!exact(r,EVENTS)||r.schema_version!=='v3.2-115-ci-invalidation-hold-v1'||
  !scoped(r.scope)||SCOPE.some(k=>r.scope[k]!==s[k].toLowerCase())||
  !Number.isSafeInteger(r.sequence)||r.sequence<1||r.sequence>64||
  !SHA.test(r.previous_event_digest)||!SHA.test(r.assignment_digest)||
  !SHA.test(r.intake_head_digest)||!SHA.test(r.lifecycle_head_digest)||
  !(r.reviewer_id===null||typeof r.reviewer_id==='string'&&ID.test(r.reviewer_id))||
  !TRIGGERS.includes(r.trigger_kind)||!SHA.test(r.source_signal_digest)||
  !SHA.test(r.cause_digest)||r.status!=='HOLD_PENDING_EXTERNAL_AUTHORITY'||
  !Number.isSafeInteger(r.recorded_at_ms)||r.recorded_at_ms<1)
  fail('V115_HOLD_EVENT_INVALID');
}
export function createIsolatedPostgresReviewHoldLedger({pool,beforeCommit=async()=>{}}={}){
 if(process.env.V106_ISOLATED_PG!=='YES_TEST_ONLY'||!pool||
  typeof pool.connect!=='function'||typeof beforeCommit!=='function')
  throw TypeError('V115 holds require disposable PostgreSQL CI role only');
 async function connection(){
  const c=await pool.connect();
  try{
   const r=await c.query('SELECT current_database() AS db,current_user AS actor');
   if(r.rows[0]?.db!=='v106_isolated'||
    !['v106_writer_a','v106_writer_b'].includes(r.rows[0]?.actor))
    fail('V115_DATABASE_OR_ROLE_UNTRUSTED');
   return c;
  }catch(e){c.release();throw e;}
 }
 async function head(s){
  if(!scoped(s))fail('V115_HOLD_SCOPE_INVALID');
  const c=await connection();
  try{
   const r=await c.query(
    'SELECT sequence,event_digest,hold_active FROM v106_test.fixture_review_hold_heads WHERE organization_id=$1 AND incident_id=$2 AND student_id=$3',
    params(s));
   if(!r.rowCount)return null;
   if(r.rows[0].hold_active!==true)fail('V115_HOLD_RELEASE_FORBIDDEN');
   return Object.freeze({
    sequence:Number(r.rows[0].sequence),event_digest:r.rows[0].event_digest.trim()});
  }finally{c.release();}
 }
 async function event(s,seq){
  if(!scoped(s)||!Number.isSafeInteger(seq)||seq<1)
   fail('V115_HOLD_EVENT_SCOPE_INVALID');
  const c=await connection();
  try{
   const r=await c.query(
    'SELECT event_payload,event_digest FROM v106_test.fixture_review_hold_events WHERE organization_id=$1 AND incident_id=$2 AND student_id=$3 AND sequence=$4',
    [...params(s),seq]);
   if(!r.rowCount)return null;
   const value=JSON.parse(r.rows[0].event_payload);
   if(sha(value)!==r.rows[0].event_digest.trim())
    fail('V115_HOLD_STORED_EVENT_TAMPERED');
   return Object.freeze(value);
  }finally{c.release();}
 }
 async function append(s,record){
  if(!scoped(s))fail('V115_HOLD_SCOPE_INVALID');
  validate(s,record);
  const event_digest=sha(record);
  for(let attempt=0;attempt<4;attempt++){
   const c=await connection();let begun=false;
   try{
    await c.query('BEGIN ISOLATION LEVEL SERIALIZABLE');begun=true;
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text,0))',
     ['v115|'+params(s).join('|')]);
    const original=await c.query(
     'SELECT assignment_payload,assignment_digest FROM v106_test.fixture_reviewer_assignments WHERE organization_id=$1 AND incident_id=$2 AND student_id=$3',
     params(s));
    const intake=await c.query(
     'SELECT sequence,event_digest FROM v106_test.evidence_intake_heads WHERE organization_id=$1 AND incident_id=$2 AND student_id=$3 FOR SHARE',
     params(s));
    const lifecycle=await c.query(
     'SELECT sequence,event_digest FROM v106_test.fixture_reviewer_lifecycle_heads WHERE organization_id=$1 AND incident_id=$2 AND student_id=$3 FOR SHARE',
     params(s));
    const previous=await c.query(
     'SELECT sequence,event_digest,hold_active FROM v106_test.fixture_review_hold_heads WHERE organization_id=$1 AND incident_id=$2 AND student_id=$3 FOR UPDATE',
     params(s));
    const before=previous.rowCount?{
     sequence:Number(previous.rows[0].sequence),
     event_digest:previous.rows[0].event_digest.trim(),
     hold_active:previous.rows[0].hold_active}:null;
    const assignmentValid=original.rowCount&&(()=>{
     const value=JSON.parse(original.rows[0].assignment_payload);
     return sha(value)===original.rows[0].assignment_digest&&
      sha(value)===record.assignment_digest&&
      value.schema_version==='v3.2-113-ci-review-assignment-v1'&&
      value.status==='PENDING_REAL_OWNER_CONFIRMATION';
    })();
    if(before?.hold_active===false)fail('V115_HOLD_RELEASE_FORBIDDEN');
    if(before){
     const old=await c.query(
      'SELECT event_payload,event_digest FROM v106_test.fixture_review_hold_events WHERE organization_id=$1 AND incident_id=$2 AND student_id=$3 AND sequence=$4',
      [...params(s),before.sequence]);
     if(!old.rowCount||sha(JSON.parse(old.rows[0].event_payload))!==
      old.rows[0].event_digest.trim()||old.rows[0].event_digest.trim()!==before.event_digest)
      fail('V115_HOLD_PREVIOUS_EVENT_TAMPERED');
    }
    const duplicate=await c.query(
     'SELECT 1 FROM v106_test.fixture_review_hold_events WHERE organization_id=$1 AND incident_id=$2 AND student_id=$3 AND cause_digest=$4',
     [...params(s),record.cause_digest]);
    if(!assignmentValid||duplicate.rowCount||
     record.intake_head_digest!==(intake.rowCount?
      intake.rows[0].event_digest.trim():'0'.repeat(64))||
     record.lifecycle_head_digest!==(lifecycle.rowCount?
      lifecycle.rows[0].event_digest.trim():'0'.repeat(64))||
     record.sequence!==(before?.sequence||0)+1||
     record.previous_event_digest!==(before?.event_digest||'0'.repeat(64))){
     await c.query('ROLLBACK');begun=false;
     return {accepted:false,event_digest,reason_code:'V115_HOLD_SQL_CONFLICT'};
    }
    await c.query(
     'INSERT INTO v106_test.fixture_review_hold_events (organization_id,incident_id,student_id,sequence,cause_digest,event_payload,event_digest) VALUES ($1,$2,$3,$4,$5,$6,$7)',
     [...params(s),record.sequence,record.cause_digest,JSON.stringify(record),event_digest]);
    await c.query(
     `INSERT INTO v106_test.fixture_review_hold_heads
      (organization_id,incident_id,student_id,sequence,event_digest,hold_active)
      VALUES($1,$2,$3,$4,$5,true)
      ON CONFLICT(organization_id,incident_id,student_id)
      DO UPDATE SET sequence=EXCLUDED.sequence,event_digest=EXCLUDED.event_digest`,
     [...params(s),record.sequence,event_digest]);
    await beforeCommit({scope:s,record,attempt});
    await c.query('COMMIT');begun=false;
    return {accepted:true,event_digest,reason_code:'REVIEW_HOLD_EVENT_APPENDED'};
   }catch(e){
    if(begun)await c.query('ROLLBACK').catch(()=>{});
    if(['40001','40P01'].includes(e.code)&&attempt<3)continue;
    if(e.code==='23505')
     return {accepted:false,event_digest,reason_code:'V115_HOLD_SQL_CONFLICT'};
    throw e;
   }finally{c.release();}
  }
  fail('V115_HOLD_SERIALIZATION_EXHAUSTED');
 }
 return Object.freeze({head,event,append});
}
