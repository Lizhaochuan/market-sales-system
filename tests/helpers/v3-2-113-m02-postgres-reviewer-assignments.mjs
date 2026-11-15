// V3.2-113 test-only PostgreSQL reviewer assignment store.
import {createHash} from 'node:crypto';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const ID=/^[a-z0-9][a-z0-9._:-]{5,127}$/;
const FIELDS=['schema_version','scope','reviewer_id','reviewer_role',
 'reviewer_attestation_digest','intake_head_sequence','intake_head_digest',
 'evidence_snapshot_digest','evidence_count','status','assigned_at_ms'];
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const exact=(x,keys)=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const scopeOK=s=>exact(s,['organization_id','incident_id','student_id'])&&
 Object.values(s).every(x=>typeof x==='string'&&UUID.test(x));
const error=code=>{const e=new Error(code);e.code=code;throw e;};
function validate(s,r){
 if(!exact(r,FIELDS)||r.schema_version!=='v3.2-113-ci-review-assignment-v1'||
  !scopeOK(r.scope)||Object.keys(s).some(k=>s[k].toLowerCase()!==r.scope[k])||
  !ID.test(r.reviewer_id)||
  r.reviewer_role!=='independent_evidence_reviewer'||
  !SHA.test(r.reviewer_attestation_digest)||
  !Number.isSafeInteger(r.intake_head_sequence)||r.intake_head_sequence<6||
  !SHA.test(r.intake_head_digest)||!SHA.test(r.evidence_snapshot_digest)||
  r.evidence_count!==6||r.status!=='PENDING_REAL_OWNER_CONFIRMATION'||
  !Number.isSafeInteger(r.assigned_at_ms)||r.assigned_at_ms<=0)
  error('V113_ASSIGNMENT_SQL_INPUT_INVALID');
}
export function createIsolatedPostgresReviewerAssignmentLedger({
 pool,beforeCommit=async()=>{}
}={}){
 if(process.env.V106_ISOLATED_PG!=='YES_TEST_ONLY'||!pool||
  typeof pool.connect!=='function'||typeof beforeCommit!=='function')
  throw TypeError('V113 requires disposable PostgreSQL and a restricted test role');
 async function connection(){
  const c=await pool.connect();
  try{
   const who=await c.query('SELECT current_database() AS db,current_user AS actor');
   if(who.rows[0]?.db!=='v106_isolated'||
    !['v106_writer_a','v106_writer_b'].includes(who.rows[0]?.actor))
    error('V113_DATABASE_OR_ROLE_UNTRUSTED');
   return c;
  }catch(e){c.release();throw e;}
 }
 const params=s=>[s.organization_id.toLowerCase(),s.incident_id.toLowerCase(),
  s.student_id.toLowerCase()];
 async function read(s){
  if(!scopeOK(s))error('V113_REVIEW_SCOPE_INVALID');
  const c=await connection();
  try{
   const r=await c.query(
    'SELECT assignment_payload,assignment_digest FROM v106_test.fixture_reviewer_assignments WHERE organization_id=$1 AND incident_id=$2 AND student_id=$3',
    params(s));
   if(!r.rowCount)return null;
   const payload=JSON.parse(r.rows[0].assignment_payload);
   if(sha(payload)!==r.rows[0].assignment_digest)
    error('V113_ASSIGNMENT_STORED_DIGEST_CONFLICT');
   return Object.freeze(payload);
  }finally{c.release();}
 }
 async function bind(s,record){
  if(!scopeOK(s))error('V113_REVIEW_SCOPE_INVALID');
  validate(s,record);
  const assignment_digest=sha(record);
  for(let attempt=0;attempt<4;attempt++){
   const c=await connection();let transaction=false;
   try{
    await c.query('BEGIN ISOLATION LEVEL SERIALIZABLE');transaction=true;
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text,0))',
     ['v113|'+params(s).join('|')]);
    const prev=await c.query(
     'SELECT 1 FROM v106_test.fixture_reviewer_assignments WHERE organization_id=$1 AND incident_id=$2 AND student_id=$3',
     params(s));
    if(prev.rowCount){
     await c.query('ROLLBACK');transaction=false;
     return {accepted:false,assignment_digest,
      reason_code:'REVIEW_ALREADY_ASSIGNED_OR_CONFLICT'};
    }
    await c.query(
     'INSERT INTO v106_test.fixture_reviewer_assignments (organization_id,incident_id,student_id,reviewer_id,assignment_payload,assignment_digest) VALUES ($1,$2,$3,$4,$5,$6)',
     [...params(s),record.reviewer_id,JSON.stringify(record),assignment_digest]);
    await beforeCommit({scope:s,record,attempt});
    await c.query('COMMIT');transaction=false;
    return {accepted:true,assignment_digest,reason_code:'FIXTURE_REVIEW_ASSIGNED'};
   }catch(e){
    if(transaction)await c.query('ROLLBACK').catch(()=>{});
    if(['40001','40P01'].includes(e.code)&&attempt<3)continue;
    if(e.code==='23505')
     return {accepted:false,assignment_digest,
      reason_code:'REVIEW_ALREADY_ASSIGNED_OR_CONFLICT'};
    throw e;
   }finally{c.release();}
  }
  error('V113_REVIEW_SERIALIZATION_EXHAUSTED');
 }
 return Object.freeze({bind,read});
}
