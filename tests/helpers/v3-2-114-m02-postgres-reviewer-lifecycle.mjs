// V3.2-114 disposable PostgreSQL audit ledger; not production.
import {createHash} from 'node:crypto';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const ID=/^[a-z0-9][a-z0-9._:-]{5,127}$/;
const AUDIT=['schema_version','scope','sequence','previous_event_digest',
 'assignment_digest','intake_head_digest','evidence_snapshot_digest','action_id',
 'action_kind','reason_code','previous_reviewer_id','next_reviewer_id',
 'action_digest','identity_status_digest','status','recorded_at_ms'];
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const exact=(x,fields)=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 Object.keys(x).length===fields.length&&fields.every(k=>Object.hasOwn(x,k));
const scopeOk=s=>exact(s,['organization_id','incident_id','student_id'])&&
 Object.values(s).every(x=>typeof x==='string'&&UUID.test(x));
const error=c=>{const e=new Error(c);e.code=c;throw e;};
const params=s=>[s.organization_id.toLowerCase(),s.incident_id.toLowerCase(),
 s.student_id.toLowerCase()];
function validRecord(s,r){
 if(!exact(r,AUDIT)||r.schema_version!=='v3.2-114-ci-review-lifecycle-v1'||
  !scopeOk(r.scope)||Object.keys(s).some(k=>s[k].toLowerCase()!==r.scope[k])||
  !Number.isSafeInteger(r.sequence)||r.sequence<1||r.sequence>32||
  !SHA.test(r.previous_event_digest)||!SHA.test(r.assignment_digest)||
  !SHA.test(r.intake_head_digest)||!SHA.test(r.evidence_snapshot_digest)||
  !UUID.test(r.action_id)||!['recuse','replace'].includes(r.action_kind)||
  !['conflict_of_interest','role_change','role_revoked','reassignment_after_recusal'].includes(r.reason_code)||
  !(r.previous_reviewer_id===null||typeof r.previous_reviewer_id==='string'&&ID.test(r.previous_reviewer_id))||
  !(r.next_reviewer_id===null||typeof r.next_reviewer_id==='string'&&ID.test(r.next_reviewer_id))||
  r.previous_reviewer_id===r.next_reviewer_id||
  !SHA.test(r.action_digest)||!SHA.test(r.identity_status_digest)||
  r.status!=='PENDING_REAL_AUTHORITY_CONFIRMATION'||
  !Number.isSafeInteger(r.recorded_at_ms)||r.recorded_at_ms<1)
  error('V114_LIFECYCLE_SQL_RECORD_INVALID');
}
export function createIsolatedPostgresReviewerLifecycleLedger({
 pool,beforeCommit=async()=>{}
}={}){
 if(process.env.V106_ISOLATED_PG!=='YES_TEST_ONLY'||!pool||
  typeof pool.connect!=='function'||typeof beforeCommit!=='function')
  throw TypeError('V114 reviewer lifecycle SQL restricted to disposable CI database');
 async function connection(){
  const c=await pool.connect();
  try{
   const r=await c.query('SELECT current_database() AS db,current_user AS role_name');
   if(r.rows[0]?.db!=='v106_isolated'||
    !['v106_writer_a','v106_writer_b'].includes(r.rows[0]?.role_name))
    error('V114_SQL_DATABASE_OR_ROLE_UNTRUSTED');
   return c;
  }catch(e){c.release();throw e;}
 }
 async function head(s){
  if(!scopeOk(s))error('V114_LIFECYCLE_SCOPE_INVALID');
  const c=await connection();
  try{
   const r=await c.query(
    'SELECT sequence,event_digest FROM v106_test.fixture_reviewer_lifecycle_heads WHERE organization_id=$1 AND incident_id=$2 AND student_id=$3',
    params(s));
   return r.rowCount?Object.freeze({
    sequence:Number(r.rows[0].sequence),event_digest:r.rows[0].event_digest}):null;
  }finally{c.release();}
 }
 async function event(s,sequence){
  if(!scopeOk(s)||!Number.isSafeInteger(sequence)||sequence<1)
   error('V114_LIFECYCLE_EVENT_INPUT_INVALID');
  const c=await connection();
  try{
   const r=await c.query(
    'SELECT event_payload,event_digest FROM v106_test.fixture_reviewer_lifecycle_events WHERE organization_id=$1 AND incident_id=$2 AND student_id=$3 AND sequence=$4',
    [...params(s),sequence]);
   if(!r.rowCount)return null;
   const body=JSON.parse(r.rows[0].event_payload);
   if(sha(body)!==r.rows[0].event_digest)error('V114_LIFECYCLE_STORED_EVENT_TAMPERED');
   return Object.freeze(body);
  }finally{c.release();}
 }
 async function append(s,record){
  if(!scopeOk(s))error('V114_LIFECYCLE_SCOPE_INVALID');
  validRecord(s,record);
  const event_digest=sha(record);
  for(let attempt=0;attempt<4;attempt++){
   const c=await connection();let transaction=false;
   try{
    await c.query('BEGIN ISOLATION LEVEL SERIALIZABLE');transaction=true;
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text,0))',
     ['v114|'+params(s).join('|')]);
    // Bind to the actual immutable V113 assignment and V112 latest head
    // INSIDE this transaction, not only to optimistic preflight reads.
    const assigned=await c.query(
     'SELECT assignment_payload,assignment_digest FROM v106_test.fixture_reviewer_assignments WHERE organization_id=$1 AND incident_id=$2 AND student_id=$3 FOR SHARE',
     params(s));
    const intake=await c.query(
     'SELECT sequence,event_digest FROM v106_test.evidence_intake_heads WHERE organization_id=$1 AND incident_id=$2 AND student_id=$3 FOR SHARE',
     params(s));
    const before=await c.query(
     'SELECT sequence,event_digest FROM v106_test.fixture_reviewer_lifecycle_heads WHERE organization_id=$1 AND incident_id=$2 AND student_id=$3 FOR UPDATE',
     params(s));
    const existing=before.rowCount?{
     sequence:Number(before.rows[0].sequence),event_digest:before.rows[0].event_digest}:null;
    let previousReviewer=null;
    let sqlAssignmentValid=false;
    if(assigned.rowCount&&intake.rowCount){
     const orig=JSON.parse(assigned.rows[0].assignment_payload);
     sqlAssignmentValid=sha(orig)===assigned.rows[0].assignment_digest&&
      sha(orig)===record.assignment_digest&&
      orig.schema_version==='v3.2-113-ci-review-assignment-v1'&&
      orig.status==='PENDING_REAL_OWNER_CONFIRMATION'&&
      orig.intake_head_digest===record.intake_head_digest&&
      orig.evidence_snapshot_digest===record.evidence_snapshot_digest&&
      Number(intake.rows[0].sequence)===orig.intake_head_sequence&&
      intake.rows[0].event_digest===record.intake_head_digest;
     previousReviewer=orig.reviewer_id;
    }
    if(existing){
     const p=await c.query(
      'SELECT event_payload,event_digest FROM v106_test.fixture_reviewer_lifecycle_events WHERE organization_id=$1 AND incident_id=$2 AND student_id=$3 AND sequence=$4 FOR SHARE',
      [...params(s),existing.sequence]);
     if(!p.rowCount)error('V114_SQL_LIFECYCLE_HEAD_WITHOUT_EVENT');
     const prev=JSON.parse(p.rows[0].event_payload);
     if(sha(prev)!==p.rows[0].event_digest||
      p.rows[0].event_digest!==existing.event_digest)
      error('V114_SQL_LIFECYCLE_DIGEST_CONFLICT');
     previousReviewer=prev.next_reviewer_id;
    }
    const duplicate=await c.query(
     'SELECT 1 FROM v106_test.fixture_reviewer_lifecycle_events WHERE organization_id=$1 AND incident_id=$2 AND student_id=$3 AND action_id=$4',
     [...params(s),record.action_id]);
    if(!sqlAssignmentValid||duplicate.rowCount||
     record.previous_reviewer_id!==previousReviewer||
     record.sequence!==(existing?.sequence||0)+1||
     record.previous_event_digest!==(existing?.event_digest||'0'.repeat(64))){
     await c.query('ROLLBACK');transaction=false;
     return {accepted:false,event_digest,reason_code:'REVIEW_LIFECYCLE_SQL_PRECONDITION_CONFLICT'};
    }
    await c.query(
     'INSERT INTO v106_test.fixture_reviewer_lifecycle_events (organization_id,incident_id,student_id,sequence,action_id,event_payload,event_digest) VALUES ($1,$2,$3,$4,$5,$6,$7)',
     [...params(s),record.sequence,record.action_id,JSON.stringify(record),event_digest]);
    await c.query(
     `INSERT INTO v106_test.fixture_reviewer_lifecycle_heads
      (organization_id,incident_id,student_id,sequence,event_digest)
      VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(organization_id,incident_id,student_id) DO UPDATE SET
      sequence=EXCLUDED.sequence,event_digest=EXCLUDED.event_digest`,
     [...params(s),record.sequence,event_digest]);
    await beforeCommit({scope:s,record,attempt});
    await c.query('COMMIT');transaction=false;
    return {accepted:true,event_digest,reason_code:'REVIEWER_LIFECYCLE_EVENT_STORED'};
   }catch(e){
    if(transaction)await c.query('ROLLBACK').catch(()=>{});
    if(['40001','40P01'].includes(e.code)&&attempt<3)continue;
    if(e.code==='23505')
     return {accepted:false,event_digest,
      reason_code:'REVIEW_LIFECYCLE_SQL_PRECONDITION_CONFLICT'};
    throw e;
   }finally{c.release();}
  }
  error('V114_SQL_SERIALIZATION_RETRY_EXHAUSTED');
 }
 return Object.freeze({head,event,append});
}
