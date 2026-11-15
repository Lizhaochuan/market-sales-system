import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import pg from 'pg';
import {createIsolatedPostgresCheckpointStore} from '../helpers/v3-2-106-m02-postgres-checkpoint.mjs';

if(process.env.V106_ISOLATED_PG!=='YES_TEST_ONLY')
 throw new Error('Refusing V106 database tests without isolated CI guard');
const {Pool}=pg;
const orgA='11111111-1111-4111-8111-111111111111';
const orgB='22222222-2222-4222-8222-222222222222';
const newIncident=i=>'33333333-3333-4333-8333-'+String(i).padStart(12,'0');
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const poolA=()=>new Pool({host:'127.0.0.1',port:5432,database:'v106_isolated',
 user:'v106_writer_a',password:'ephemeral-v106-A-only',max:4,
 connectionTimeoutMillis:2000});
const poolB=()=>new Pool({host:'127.0.0.1',port:5432,database:'v106_isolated',
 user:'v106_writer_b',password:'ephemeral-v106-B-only',max:4,
 connectionTimeoutMillis:2000});
const scope=(organization_id,i)=>({organization_id,incident_id:newIncident(i)});
const checkpoint=(s,{trust=1,rev=1,epoch=1,sequence=0,generation=1,
 evidence='a',roster='b',revocation='c',time=1000000,
 keyVersion='001',retired=[]}={})=>({
 schema_version:'v3.2-104-ci-fence-v1',...s,
 trust_revision:trust,roster_digest:roster.repeat(64),
 active_key_ids:{sales:'sales-key-'+keyVersion,
  finance:'finance-key-'+keyVersion,academic:'academic-key-'+keyVersion},
 revoked_key_ids:retired,
 domains:{
  sales:{source_epoch:epoch,source_revision:rev,evidence_digest:evidence.repeat(64)},
  finance:{source_epoch:epoch,source_revision:rev,evidence_digest:evidence.repeat(64)},
  academic:{source_epoch:epoch,source_revision:rev,evidence_digest:evidence.repeat(64)}
 },
 revocation_sequence:sequence,revocation_digest:revocation.repeat(64),
 incident_generation:generation,observed_at_ms:time
});
const accepted=r=>{
 assert.deepEqual(Object.keys(r).sort(),
  ['accepted','checkpoint_digest','reason_code'].sort());
 assert.equal(r.accepted,true);
 assert.equal(r.reason_code,'CHECKPOINT_ACCEPTED');
 assert.match(r.checkpoint_digest,/^[a-f0-9]{64}$/);
};
const blocked=r=>{
 assert.equal(r.accepted,false);
 assert.equal(r.reason_code,'PERSISTED_CHECKPOINT_CONFLICT');
};
async function using(make,fn){
 const pool=make();
 try{return await fn(pool,createIsolatedPostgresCheckpointStore({pool}));}
 finally{await pool.end();}
}
test('DB-01 fixture database identity and isolated writer role only',async()=>{
 await using(poolA,async(pool,store)=>{
  const c=await pool.query('SELECT current_database() AS db,current_user AS actor');
  assert.equal(c.rows[0].db,'v106_isolated');
  assert.equal(c.rows[0].actor,'v106_writer_a');
  const s=scope(orgA,1);
  const r=await store.advance(s,checkpoint(s));
  accepted(r);
  assert.equal(r.checkpoint_digest,sha(checkpoint(s)));
 });
 assert.throws(()=>createIsolatedPostgresCheckpointStore({pool:null}),TypeError);
});
test('DB-02 committed checkpoint survives new connections and adapter recreation',async()=>{
 const s=scope(orgA,2);
 await using(poolA,async(_pool,store)=>{
  accepted(await store.advance(s,checkpoint(s,{rev:3,time:1000010})));
 });
 // Recreate a distinct Pool/adapter to simulate an application restart.
 await using(poolA,async(_pool,restarted)=>{
  const persisted=await restarted.read(s);
  assert.equal(persisted.domains.finance.source_revision,3);
  const r=await restarted.advance(s,checkpoint(s,{rev:1,time:1000020}));
  blocked(r);
  assert.equal((await restarted.read(s)).domains.finance.source_revision,3);
 });
});
test('DB-03 same-version conflicting writers cannot both commit',async()=>{
 const s=scope(orgA,3),a=poolA(),b=poolA();
 try{
  const x=createIsolatedPostgresCheckpointStore({pool:a});
  const y=createIsolatedPostgresCheckpointStore({pool:b});
  const one=checkpoint(s,{evidence:'a'});
  const two=checkpoint(s,{evidence:'e'});
  const settled=await Promise.allSettled([x.advance(s,one),y.advance(s,two)]);
  const winners=settled.filter(x=>x.status==='fulfilled'&&x.value.accepted===true);
  assert.equal(winners.length,1);
  const loser=settled.find(x=>x.status!=='fulfilled'||!x.value.accepted);
  assert.ok(loser);
  const stored=await x.read(s);
  assert.ok([one.domains.sales.evidence_digest,two.domains.sales.evidence_digest]
   .includes(stored.domains.sales.evidence_digest));
 }finally{await Promise.all([a.end(),b.end()]);}
});
test('DB-04 same governance revision with changed roster digest is rejected',async()=>{
 const s=scope(orgA,4);
 await using(poolA,async(_pool,store)=>{
  accepted(await store.advance(s,checkpoint(s)));
  blocked(await store.advance(s,checkpoint(s,{roster:'d',time:1000001})));
  assert.equal((await store.read(s)).roster_digest,'b'.repeat(64));
 });
});
test('DB-05 key substitution requires higher trust revision and retired-key proof',async()=>{
 const s=scope(orgA,5);
 await using(poolA,async(_pool,store)=>{
  accepted(await store.advance(s,checkpoint(s)));
  const unchangedTrust=checkpoint(s,{keyVersion:'002',time:1000001});
  blocked(await store.advance(s,unchangedTrust));
  const noRevoke=checkpoint(s,{trust:2,keyVersion:'002',roster:'d',time:1000002});
  blocked(await store.advance(s,noRevoke));
  const revoked=['sales-key-001','finance-key-001','academic-key-001'];
  const rotated=checkpoint(s,{trust:2,keyVersion:'002',roster:'d',
   retired:revoked,time:1000003});
  accepted(await store.advance(s,rotated));
  blocked(await store.advance(s,checkpoint(s,{trust:1,time:1000004})));
  assert.deepEqual((await store.read(s)).revoked_key_ids,revoked);
 });
});
test('DB-06 RLS isolates tenant A and tenant B; no business table write grants',async()=>{
 const a=poolA(),b=poolB();
 try{
  const x=createIsolatedPostgresCheckpointStore({pool:a});
  const y=createIsolatedPostgresCheckpointStore({pool:b});
  const sa=scope(orgA,6),sb=scope(orgB,6);
  accepted(await x.advance(sa,checkpoint(sa)));
  accepted(await y.advance(sb,checkpoint(sb)));
  assert.equal(await x.read(sb),null);
  assert.equal(await y.read(sa),null);
  await assert.rejects(y.advance(sa,checkpoint(sa)),/row-level security/i);
  await assert.rejects(x.advance(sb,checkpoint(sb)),/row-level security/i);
  await assert.rejects(a.query(
   'UPDATE v106_test.protected_business_fixture SET example_payment_amount=0'),
   /permission denied/i);
  await assert.rejects(a.query(
   'SELECT * FROM v106_test.protected_business_fixture'),/permission denied/i);
 }finally{await Promise.all([a.end(),b.end()]);}
});
test('DB-07 injected pre-commit fault rolls back whole transaction; retry succeeds',async()=>{
 const s=scope(orgA,7),pool=poolA();
 try{
  const good=createIsolatedPostgresCheckpointStore({pool});
  accepted(await good.advance(s,checkpoint(s,{rev:1})));
  const fail=createIsolatedPostgresCheckpointStore({
   pool,beforeCommit:async()=>{throw new Error('simulated crash before COMMIT');}
  });
  const advanced=checkpoint(s,{rev:2,evidence:'d',time:1000001});
  await assert.rejects(fail.advance(s,advanced),/simulated crash/);
  assert.equal((await good.read(s)).domains.sales.source_revision,1);
  accepted(await good.advance(s,advanced));
  assert.equal((await good.read(s)).domains.sales.source_revision,2);
 }finally{await pool.end();}
});
test('DB-08 all checkpoints remain CI-only; external authority is not established',async()=>{
 const s=scope(orgA,8);
 await using(poolA,async(_pool,store)=>{
  accepted(await store.advance(s,checkpoint(s)));
  blocked(await store.advance(s,checkpoint(s,{sequence:0,
   revocation:'d',time:1000001})));
  assert.equal((await store.read(s)).revocation_sequence,0);
 });
 // No Chromium, finance/academic signing or external atomic handoff is asserted.
 assert.equal(process.env.V106_ISOLATED_PG,'YES_TEST_ONLY');
});
