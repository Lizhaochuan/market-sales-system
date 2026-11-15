// V3.2-110 disposable PostgreSQL signed-notice ledger, NOT production.
import {createHash} from 'node:crypto';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const ID=/^[a-z0-9][a-z0-9._:-]{5,127}$/;
const NOTICE=['schema_version','organization_id','incident_id','lease_id',
 'barrier_epoch','source_watermark_digest','notification_sequence',
 'previous_notification_digest','notification_kind','observed_at_ms','fixture_only','signature'];
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const exact=(x,keys)=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const error=reason=>{const e=new Error(reason);e.code=reason;throw e;};
const scoped=s=>exact(s,['organization_id','incident_id'])&&
 UUID.test(s.organization_id)&&UUID.test(s.incident_id);
function noticeOK(scope,n){
 if(!exact(n,NOTICE)||n.schema_version!=='v3.2-110-ci-loss-notice-v1'||
  n.organization_id!==scope.organization_id||n.incident_id!==scope.incident_id||
  !ID.test(n.lease_id)||!Number.isSafeInteger(n.barrier_epoch)||
  n.barrier_epoch<1||!SHA.test(n.source_watermark_digest)||
  !Number.isSafeInteger(n.notification_sequence)||n.notification_sequence<1||
  !SHA.test(n.previous_notification_digest)||
  !['lease_revoked','holder_lost','source_barrier_invalidated'].includes(n.notification_kind)||
  !Number.isSafeInteger(n.observed_at_ms)||n.observed_at_ms<1||
  n.fixture_only!==true||typeof n.signature!=='string')
  error('V110_NOTICE_SQL_INPUT_INVALID');
}
export function createIsolatedPostgresLossNoticeLedger({pool,beforeCommit=async()=>{}}={}){
 if(process.env.V106_ISOLATED_PG!=='YES_TEST_ONLY'||!pool||
  typeof pool.connect!=='function'||typeof beforeCommit!=='function')
  throw TypeError('V110 requires disposable PostgreSQL and test hook');
 async function connection(){
  const c=await pool.connect();
  try{
   const r=await c.query('SELECT current_database() AS db,current_user AS actor');
   if(r.rows[0]?.db!=='v106_isolated'||
    !['v106_writer_a','v106_writer_b'].includes(r.rows[0]?.actor))
    error('V110_SQL_DATABASE_OR_ROLE_NOT_ISOLATED');
   return c;
  }catch(e){c.release();throw e;}
 }
 async function head(s){
  if(!scoped(s))error('V110_SQL_SCOPE_INVALID');
  const c=await connection();
  try{
   const r=await c.query(
    'SELECT notification_sequence,notification_digest FROM v106_test.lease_notice_heads WHERE organization_id=$1 AND incident_id=$2',
    [s.organization_id.toLowerCase(),s.incident_id.toLowerCase()]);
   return r.rowCount?Object.freeze({
    notification_sequence:Number(r.rows[0].notification_sequence),
    notification_digest:r.rows[0].notification_digest}):null;
  }finally{c.release();}
 }
 async function event(s,sequence){
  if(!scoped(s)||!Number.isSafeInteger(sequence)||sequence<1)
   error('V110_SQL_EVENT_INPUT_INVALID');
  const c=await connection();
  try{
   const r=await c.query(
    'SELECT notification_payload,notification_digest FROM v106_test.lease_notice_events WHERE organization_id=$1 AND incident_id=$2 AND notification_sequence=$3',
    [s.organization_id.toLowerCase(),s.incident_id.toLowerCase(),sequence]);
   if(!r.rowCount)return null;
   const body=JSON.parse(r.rows[0].notification_payload);
   if(sha(body)!==r.rows[0].notification_digest)
    error('V110_SQL_EVENT_HASH_MISMATCH');
   return Object.freeze(body);
  }finally{c.release();}
 }
 async function append(s,n){
  if(!scoped(s))error('V110_SQL_SCOPE_INVALID');
  const scope={organization_id:s.organization_id.toLowerCase(),
   incident_id:s.incident_id.toLowerCase()};
  noticeOK(scope,n);
  const notice_digest=sha(n);
  for(let attempt=0;attempt<4;attempt++){
   const c=await connection();let inTransaction=false;
   try{
    await c.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    inTransaction=true;
    // Same per-scope lock as the V109 lease ledger. Lease revocation and
    // notice event are updated atomically within this SQL transaction.
    await c.query(
     'SELECT pg_advisory_xact_lock(hashtextextended($1::text,0))',
     ['lease|'+scope.organization_id+'|'+scope.incident_id]);
    const [leaseResult,headResult]=await Promise.all([
     c.query('SELECT lease_payload,lease_digest FROM v106_test.causal_leases WHERE organization_id=$1 AND incident_id=$2 FOR UPDATE',
      [scope.organization_id,scope.incident_id]),
     c.query('SELECT notification_sequence,notification_digest FROM v106_test.lease_notice_heads WHERE organization_id=$1 AND incident_id=$2 FOR UPDATE',
      [scope.organization_id,scope.incident_id])
    ]);
    const current=headResult.rowCount?{
     notification_sequence:Number(headResult.rows[0].notification_sequence),
     notification_digest:headResult.rows[0].notification_digest}:null;
    const expectedSeq=(current?.notification_sequence||0)+1;
    const expectedPrev=current?.notification_digest||'0'.repeat(64);
    let lease=null;
    if(leaseResult.rowCount){
     lease=JSON.parse(leaseResult.rows[0].lease_payload);
     if(sha(lease)!==leaseResult.rows[0].lease_digest)
      error('V110_SQL_LEASE_INTEGRITY_FAILURE');
    }
    if(!lease||lease.state!=='active'||lease.lease_id!==n.lease_id||
     lease.barrier_epoch!==n.barrier_epoch||
     lease.source_watermark_digest!==n.source_watermark_digest||
     lease.expires_at_ms<=n.observed_at_ms||
     n.notification_sequence!==expectedSeq||
     n.previous_notification_digest!==expectedPrev){
     await c.query('ROLLBACK');inTransaction=false;
     return {accepted:false,notice_digest,reason_code:'LEASE_NOTICE_REPLAY_SCOPE_OR_FENCE_CONFLICT'};
    }
    const revoked={...lease,state:'revoked'};
    await c.query(
     'UPDATE v106_test.causal_leases SET lease_payload=$3,lease_digest=$4,updated_at=clock_timestamp() WHERE organization_id=$1 AND incident_id=$2',
     [scope.organization_id,scope.incident_id,JSON.stringify(revoked),sha(revoked)]);
    await c.query(
     'INSERT INTO v106_test.lease_notice_events (organization_id,incident_id,notification_sequence,notification_payload,notification_digest) VALUES ($1,$2,$3,$4,$5)',
     [scope.organization_id,scope.incident_id,n.notification_sequence,JSON.stringify(n),notice_digest]);
    await c.query(
     `INSERT INTO v106_test.lease_notice_heads
      (organization_id,incident_id,notification_sequence,notification_digest)
      VALUES($1,$2,$3,$4)
      ON CONFLICT (organization_id,incident_id) DO UPDATE SET
      notification_sequence=EXCLUDED.notification_sequence,
      notification_digest=EXCLUDED.notification_digest`,
     [scope.organization_id,scope.incident_id,n.notification_sequence,notice_digest]);
    await beforeCommit({scope,notice:n,attempt});
    await c.query('COMMIT');inTransaction=false;
    return {accepted:true,notice_digest,reason_code:'LEASE_LOSS_NOTICE_PERSISTED'};
   }catch(e){
    if(inTransaction)await c.query('ROLLBACK').catch(()=>{});
    if(['40001','40P01'].includes(e.code)&&attempt<3)continue;
    throw e;
   }finally{c.release();}
  }
  error('V110_SQL_SERIALIZATION_RETRIES_EXHAUSTED');
 }
 return Object.freeze({head,event,append});
}
