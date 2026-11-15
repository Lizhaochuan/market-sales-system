// V3.2-109 disposable SQL lease fencing adapter; tests/helpers only.
import {createHash} from 'node:crypto';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{64}$/;
const ID=/^[a-z0-9][a-z0-9._:-]{5,127}$/;
const KEYS=['schema_version','organization_id','incident_id','lease_id',
 'holder_id','barrier_epoch','source_watermark_digest','lease_digest',
 'expires_at_ms','observed_at_ms','state'];
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const exact=(x,keys)=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const fail=c=>{const e=new Error(c);e.code=c;throw e;};
const validScope=s=>exact(s,['organization_id','incident_id'])&&
 UUID.test(s.organization_id)&&UUID.test(s.incident_id);
function validate(s,p){
 if(!exact(p,KEYS)||p.schema_version!=='v3.2-109-ci-lease-ledger-v1'||
  p.organization_id!==s.organization_id.toLowerCase()||
  p.incident_id!==s.incident_id.toLowerCase()||
  !ID.test(p.lease_id)||!ID.test(p.holder_id)||
  !Number.isSafeInteger(p.barrier_epoch)||p.barrier_epoch<1||
  !SHA.test(p.source_watermark_digest)||!SHA.test(p.lease_digest)||
  !Number.isSafeInteger(p.expires_at_ms)||!Number.isSafeInteger(p.observed_at_ms)||
  p.observed_at_ms>=p.expires_at_ms||
  !['active','revoked'].includes(p.state))
  fail('V109_SQL_LEASE_INVALID');
}
export function createIsolatedPostgresLeaseLedger({pool}={}){
 if(process.env.V106_ISOLATED_PG!=='YES_TEST_ONLY'||!pool||
  typeof pool.connect!=='function')
  throw TypeError('Disposable V109 PostgreSQL test connection required');
 async function client(){
  const c=await pool.connect();
  try{
   const r=await c.query('SELECT current_database() AS db,current_user AS role_name');
   if(r.rows[0]?.db!=='v106_isolated'||
    !['v106_writer_a','v106_writer_b'].includes(r.rows[0]?.role_name))
    fail('V109_SQL_DATABASE_OR_ROLE_UNTRUSTED');
   return c;
  }catch(e){c.release();throw e;}
 }
 function checked(row){
  if(!row)return null;
  const p=JSON.parse(row.lease_payload);
  if(sha(p)!==row.lease_digest)
   fail('V109_SQL_LEDGER_INTEGRITY_FAILURE');
  return p;
 }
 async function read(s){
  if(!validScope(s))fail('V109_SQL_SCOPE_INVALID');
  const c=await client();
  try{
   const r=await c.query(
    'SELECT lease_payload,lease_digest FROM v106_test.causal_leases WHERE organization_id=$1 AND incident_id=$2',
    [s.organization_id.toLowerCase(),s.incident_id.toLowerCase()]);
   return r.rowCount?Object.freeze(checked(r.rows[0])):null;
  }finally{c.release();}
 }
 async function transaction(s,fn){
  if(!validScope(s))fail('V109_SQL_SCOPE_INVALID');
  const scope={organization_id:s.organization_id.toLowerCase(),
   incident_id:s.incident_id.toLowerCase()};
  for(let attempt=0;attempt<4;attempt++){
   const c=await client();let active=false;
   try{
    await c.query('BEGIN ISOLATION LEVEL SERIALIZABLE');active=true;
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text,0))',
     ['lease|'+scope.organization_id+'|'+scope.incident_id]);
    const existing=await c.query(
     'SELECT lease_payload,lease_digest FROM v106_test.causal_leases WHERE organization_id=$1 AND incident_id=$2 FOR UPDATE',
     [scope.organization_id,scope.incident_id]);
    const old=existing.rowCount?checked(existing.rows[0]):null;
    const out=await fn({c,old,scope});
    await c.query('COMMIT');active=false;return out;
   }catch(e){
    if(active)await c.query('ROLLBACK').catch(()=>{});
    if(['40001','40P01'].includes(e.code)&&attempt<3)continue;
    throw e;
   }finally{c.release();}
  }
  fail('V109_SQL_SERIALIZATION_EXHAUSTED');
 }
 async function put(c,scope,body){
  await c.query(`INSERT INTO v106_test.causal_leases
   (organization_id,incident_id,lease_payload,lease_digest)
   VALUES ($1,$2,$3,$4)
   ON CONFLICT (organization_id,incident_id) DO UPDATE SET
   lease_payload=EXCLUDED.lease_payload,lease_digest=EXCLUDED.lease_digest,
   updated_at=clock_timestamp()`,
   [scope.organization_id,scope.incident_id,JSON.stringify(body),sha(body)]);
 }
 async function bind(s,p){
  if(!validScope(s))fail('V109_SQL_SCOPE_INVALID');
  validate(s,p);
  const lease_digest=sha(p);
  return transaction(s,async({c,old,scope})=>{
   if(old&&(
    p.barrier_epoch<=old.barrier_epoch||
    p.observed_at_ms<old.observed_at_ms||
    (old.state==='active'&&old.expires_at_ms>p.observed_at_ms)
   )){
    return {accepted:false,lease_digest,reason_code:'LEASE_LEDGER_CONFLICT'};
   }
   await put(c,scope,p);
   return {accepted:true,lease_digest,reason_code:'LEASE_FENCE_BOUND'};
  });
 }
 async function invalidate(s,lease_id){
  if(!validScope(s)||!ID.test(lease_id))fail('V109_SQL_REVOKE_INPUT_INVALID');
  return transaction(s,async({c,old,scope})=>{
   if(!old||old.lease_id!==lease_id||old.state!=='active')return false;
   await put(c,scope,{...old,state:'revoked'});
   return true;
  });
 }
 return Object.freeze({bind,read,invalidate});
}
