// V3.2-106 — DISPOSABLE CI PostgreSQL checkpoint adapter, never production.
import {createHash} from 'node:crypto';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const DOMAINS=['sales','finance','academic'];
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const reject=reason=>{const e=new Error(reason);e.code=reason;throw e;};
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
const exact=(x,keys)=>plain(x)&&Object.keys(x).length===keys.length&&
 keys.every(key=>Object.hasOwn(x,key));
const scopeValid=x=>exact(x,['organization_id','incident_id'])&&
 UUID.test(x.organization_id)&&UUID.test(x.incident_id);
function assertCheckpoint(s,c){
 const keys=['schema_version','organization_id','incident_id','trust_revision',
  'roster_digest','active_key_ids','revoked_key_ids','domains',
  'revocation_sequence','revocation_digest','incident_generation','observed_at_ms'];
 if(!exact(c,keys)||c.schema_version!=='v3.2-104-ci-fence-v1'||
  c.organization_id!==s.organization_id.toLowerCase()||
  c.incident_id!==s.incident_id.toLowerCase()||
  !Number.isSafeInteger(c.trust_revision)||c.trust_revision<1||
  !SHA.test(c.roster_digest)||!exact(c.active_key_ids,DOMAINS)||
  !exact(c.domains,DOMAINS)||!Array.isArray(c.revoked_key_ids)||
  !Number.isSafeInteger(c.revocation_sequence)||c.revocation_sequence<0||
  !SHA.test(c.revocation_digest)||
  !Number.isSafeInteger(c.incident_generation)||c.incident_generation<1||
  !Number.isSafeInteger(c.observed_at_ms)||c.observed_at_ms<1)
   reject('INVALID_V106_CHECKPOINT');
 const revoked=new Set(c.revoked_key_ids);
 if(revoked.size!==c.revoked_key_ids.length||
  !c.revoked_key_ids.every(x=>typeof x==='string'&&x.length>3)||
  new Set(Object.values(c.active_key_ids)).size!==DOMAINS.length)
  reject('INVALID_V106_KEY_LIFECYCLE');
 for(const domain of DOMAINS){
  if(typeof c.active_key_ids[domain]!=='string'||
   c.active_key_ids[domain].length<4||
   revoked.has(c.active_key_ids[domain]))
   reject('INVALID_V106_KEY_LIFECYCLE');
  const d=c.domains[domain];
  if(!exact(d,['source_epoch','source_revision','evidence_digest'])||
   !Number.isSafeInteger(d.source_epoch)||d.source_epoch<1||
   !Number.isSafeInteger(d.source_revision)||d.source_revision<1||
   !SHA.test(d.evidence_digest))reject('INVALID_V106_DOMAIN_VERSION');
 }
}
function monotone(old,next){
 if(next.trust_revision<old.trust_revision||
  next.incident_generation<old.incident_generation||
  next.revocation_sequence<old.revocation_sequence||
  next.observed_at_ms<old.observed_at_ms)return false;
 if(next.trust_revision===old.trust_revision&&next.roster_digest!==old.roster_digest)
  return false;
 if(next.revocation_sequence===old.revocation_sequence&&
  next.revocation_digest!==old.revocation_digest)return false;
 if(!old.revoked_key_ids.every(x=>next.revoked_key_ids.includes(x)))return false;
 for(const domain of DOMAINS){
  const a=old.domains[domain],b=next.domains[domain];
  if(b.source_epoch<a.source_epoch||
   (b.source_epoch===a.source_epoch&&b.source_revision<a.source_revision)||
   (b.source_epoch===a.source_epoch&&b.source_revision===a.source_revision&&
    b.evidence_digest!==a.evidence_digest))return false;
  if(next.active_key_ids[domain]!==old.active_key_ids[domain]&&
   (next.trust_revision<=old.trust_revision||
    !next.revoked_key_ids.includes(old.active_key_ids[domain])))return false;
 }
 return true;
}
export function createIsolatedPostgresCheckpointStore({
 pool,beforeCommit=async()=>{}
}={}){
 if(process.env.V106_ISOLATED_PG!=='YES_TEST_ONLY')
  throw TypeError('V106 requires disposable CI-only PostgreSQL guard');
 if(!pool||typeof pool.connect!=='function'||typeof beforeCommit!=='function')
  throw TypeError('Isolated PostgreSQL Pool and test hook required');
 async function validatedClient(){
  const client=await pool.connect();
  try{
   const res=await client.query(
    'SELECT current_database() AS db, current_user AS role_name');
   if(res.rows[0]?.db!=='v106_isolated'||
    !['v106_writer_a','v106_writer_b'].includes(res.rows[0]?.role_name))
    reject('V106_DATABASE_OR_ROLE_NOT_ISOLATED');
   return client;
  }catch(e){client.release();throw e;}
 }
 async function read(s){
  if(!scopeValid(s))reject('INVALID_V106_SCOPE');
  const client=await validatedClient();
  try{
   const r=await client.query(
    'SELECT checkpoint_payload, checkpoint_digest FROM v106_test.checkpoints WHERE organization_id=$1 AND incident_id=$2',
    [s.organization_id.toLowerCase(),s.incident_id.toLowerCase()]);
   if(!r.rowCount)return null;
   const cp=JSON.parse(r.rows[0].checkpoint_payload);
   if(sha(cp)!==r.rows[0].checkpoint_digest)
    reject('V106_STORED_CHECKPOINT_INTEGRITY_FAILED');
   return Object.freeze(cp);
  }finally{client.release();}
 }
 async function advance(scope,checkpoint){
  if(!scopeValid(scope))reject('INVALID_V106_SCOPE');
  const s={organization_id:scope.organization_id.toLowerCase(),
   incident_id:scope.incident_id.toLowerCase()};
  assertCheckpoint(s,checkpoint);
  const checkpoint_digest=sha(checkpoint);
  for(let attempt=0;attempt<4;attempt++){
   const client=await validatedClient();
   let inTransaction=false;
   try{
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    inTransaction=true;
    // Advisory lock serializes first INSERT and subsequent UPDATE per scope.
    // A hash collision may only cause extra contention, never row mixing.
    await client.query(
     'SELECT pg_advisory_xact_lock(hashtextextended($1::text,0))',
     [s.organization_id+'|'+s.incident_id]);
    const res=await client.query(
     'SELECT checkpoint_payload,checkpoint_digest FROM v106_test.checkpoints WHERE organization_id=$1 AND incident_id=$2 FOR UPDATE',
     [s.organization_id,s.incident_id]);
    if(res.rowCount){
     const old=JSON.parse(res.rows[0].checkpoint_payload);
     if(sha(old)!==res.rows[0].checkpoint_digest)
      reject('V106_STORED_CHECKPOINT_INTEGRITY_FAILED');
     if(!monotone(old,checkpoint)){
      await client.query('ROLLBACK');inTransaction=false;
      return {accepted:false,checkpoint_digest,
       reason_code:'PERSISTED_CHECKPOINT_CONFLICT'};
     }
    }
    await client.query(
     `INSERT INTO v106_test.checkpoints
      (organization_id,incident_id,checkpoint_payload,checkpoint_digest)
      VALUES ($1,$2,$3,$4)
      ON CONFLICT (organization_id,incident_id) DO UPDATE SET
      checkpoint_payload=EXCLUDED.checkpoint_payload,
      checkpoint_digest=EXCLUDED.checkpoint_digest,
      updated_at=clock_timestamp()`,
     [s.organization_id,s.incident_id,JSON.stringify(checkpoint),checkpoint_digest]);
    // Injected failure MUST roll back the pending UPSERT.
    await beforeCommit({scope:s,checkpoint,attempt});
    await client.query('COMMIT');inTransaction=false;
    return {accepted:true,checkpoint_digest,reason_code:'CHECKPOINT_ACCEPTED'};
   }catch(e){
    if(inTransaction)await client.query('ROLLBACK').catch(()=>{});
    if(e.code==='40001'||e.code==='40P01'){
     if(attempt<3)continue;
     reject('V106_SERIALIZATION_RETRY_EXHAUSTED');
    }
    throw e;
   }finally{client.release();}
  }
  reject('V106_SERIALIZATION_RETRY_EXHAUSTED');
 }
 return Object.freeze({advance,read});
}
