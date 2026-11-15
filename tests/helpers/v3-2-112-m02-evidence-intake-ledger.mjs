// V3.2-112 disposable PostgreSQL evidence intake ledger; tests only.
import {createHash} from 'node:crypto';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const ID=/^[a-z0-9][a-z0-9._:-]{5,127}$/;
const RECORD=['schema_version','scope','sequence','previous_event_digest',
 'claim_digest','submission_id','owner_role','evidence_digest',
 'claimed_owner_id','claimed_submitter_id','status','recorded_at_ms'];
const ROLES=['sales_owner','finance_owner','academic_owner',
 'security_identity_owner','integration_owner','database_owner'];
const exact=(x,fields)=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 Object.keys(x).length===fields.length&&fields.every(k=>Object.hasOwn(x,k));
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const fail=c=>{const e=new Error(c);e.code=c;throw e;};
const scoped=x=>exact(x,['organization_id','incident_id','student_id'])&&
 Object.values(x).every(y=>typeof y==='string'&&UUID.test(y));
function checkRecord(scope,r){
 if(!exact(r,RECORD)||r.schema_version!=='v3.2-112-ci-quarantined-intake-v1'||
  !scoped(r.scope)||Object.keys(scope).some(k=>r.scope[k]!==scope[k])||
  !Number.isSafeInteger(r.sequence)||r.sequence<1||
  !SHA.test(r.previous_event_digest)||!SHA.test(r.claim_digest)||
  !UUID.test(r.submission_id)||!ROLES.includes(r.owner_role)||
  !SHA.test(r.evidence_digest)||!ID.test(r.claimed_owner_id)||
  !ID.test(r.claimed_submitter_id)||
  r.claimed_owner_id===r.claimed_submitter_id||
  r.status!=='PENDING_INDEPENDENT_VERIFICATION'||
  !Number.isSafeInteger(r.recorded_at_ms)||r.recorded_at_ms<1)
  fail('V112_INTAKE_EVENT_INVALID');
}
export function createIsolatedPostgresEvidenceIntakeLedger({
 pool,beforeCommit=async()=>{}
}={}){
 if(process.env.V106_ISOLATED_PG!=='YES_TEST_ONLY'||!pool||
  typeof pool.connect!=='function'||typeof beforeCommit!=='function')
  throw TypeError('V112 requires only disposable PostgreSQL CI');
 async function connection(){
  const c=await pool.connect();
  try{
   const res=await c.query('SELECT current_database() AS db,current_user AS actor');
   if(res.rows[0]?.db!=='v106_isolated'||
    !['v106_writer_a','v106_writer_b'].includes(res.rows[0]?.actor))
    fail('V112_DATABASE_OR_ROLE_UNTRUSTED');
   return c;
  }catch(e){c.release();throw e;}
 }
 const params=s=>[s.organization_id.toLowerCase(),s.incident_id.toLowerCase(),
  s.student_id.toLowerCase()];
 async function head(s){
  if(!scoped(s))fail('V112_INTAKE_SCOPE_INVALID');
  const c=await connection();
  try{
   const r=await c.query(
    'SELECT sequence,event_digest FROM v106_test.evidence_intake_heads WHERE organization_id=$1 AND incident_id=$2 AND student_id=$3',
    params(s));
   return r.rowCount?Object.freeze({
    sequence:Number(r.rows[0].sequence),event_digest:r.rows[0].event_digest}):null;
  }finally{c.release();}
 }
 async function event(s,sequence){
  if(!scoped(s)||!Number.isSafeInteger(sequence)||sequence<1)
   fail('V112_INTAKE_EVENT_SCOPE_INVALID');
  const c=await connection();
  try{
   const r=await c.query(
    'SELECT event_payload,event_digest FROM v106_test.evidence_intake_events WHERE organization_id=$1 AND incident_id=$2 AND student_id=$3 AND sequence=$4',
    [...params(s),sequence]);
   if(!r.rowCount)return null;
   const body=JSON.parse(r.rows[0].event_payload);
   if(sha(body)!==r.rows[0].event_digest)
    fail('V112_INTAKE_EVENT_INTEGRITY_FAILED');
   return Object.freeze(body);
  }finally{c.release();}
 }
 async function append(s,record){
  if(!scoped(s))fail('V112_INTAKE_SCOPE_INVALID');
  const scope={organization_id:s.organization_id.toLowerCase(),
   incident_id:s.incident_id.toLowerCase(),student_id:s.student_id.toLowerCase()};
  checkRecord(scope,record);
  const event_digest=sha(record);
  for(let attempt=0;attempt<4;attempt++){
   const c=await connection();let transaction=false;
   try{
    await c.query('BEGIN ISOLATION LEVEL SERIALIZABLE');transaction=true;
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text,0))',
     ['v112|'+Object.values(scope).join('|')]);
    const before=await c.query(
     'SELECT sequence,event_digest FROM v106_test.evidence_intake_heads WHERE organization_id=$1 AND incident_id=$2 AND student_id=$3 FOR UPDATE',params(scope));
    const current=before.rowCount?{
     sequence:Number(before.rows[0].sequence),event_digest:before.rows[0].event_digest}:null;
    const replay=await c.query(
     'SELECT 1 FROM v106_test.evidence_intake_events WHERE organization_id=$1 AND incident_id=$2 AND student_id=$3 AND submission_id=$4',
     [...params(scope),record.submission_id]);
    if(replay.rowCount||record.sequence!==(current?.sequence||0)+1||
     record.previous_event_digest!==(current?.event_digest||'0'.repeat(64))){
     await c.query('ROLLBACK');transaction=false;
     return {accepted:false,event_digest,reason_code:'INTAKE_REPLAY_OR_SEQUENCE_CONFLICT'};
    }
    await c.query(
     'INSERT INTO v106_test.evidence_intake_events (organization_id,incident_id,student_id,sequence,submission_id,event_payload,event_digest) VALUES ($1,$2,$3,$4,$5,$6,$7)',
     [...params(scope),record.sequence,record.submission_id,JSON.stringify(record),event_digest]);
    await c.query(
     `INSERT INTO v106_test.evidence_intake_heads
      (organization_id,incident_id,student_id,sequence,event_digest)
      VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(organization_id,incident_id,student_id) DO UPDATE SET
      sequence=EXCLUDED.sequence,event_digest=EXCLUDED.event_digest`,
     [...params(scope),record.sequence,event_digest]);
    await beforeCommit({scope,record});
    await c.query('COMMIT');transaction=false;
    return {accepted:true,event_digest,reason_code:'INTAKE_QUARANTINED'};
   }catch(e){
    if(transaction)await c.query('ROLLBACK').catch(()=>{});
    if(['40001','40P01'].includes(e.code)&&attempt<3)continue;
    if(e.code==='23505')
     return {accepted:false,event_digest,reason_code:'INTAKE_REPLAY_OR_SEQUENCE_CONFLICT'};
    throw e;
   }finally{c.release();}
  }
  fail('V112_INTAKE_SQL_RETRY_EXHAUSTED');
 }
 return Object.freeze({head,event,append});
}
