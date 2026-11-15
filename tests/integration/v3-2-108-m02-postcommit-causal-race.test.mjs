import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import pg from 'pg';
import {createIsolatedSourceTrustFence} from '../../src/cross-module-source-trust-fence.mjs';
import {createIsolatedPostCommitCausalRecheck} from '../../src/cross-module-postcommit-causal-recheck.mjs';
import {createIsolatedPostgresCheckpointStore} from '../helpers/v3-2-106-m02-postgres-checkpoint.mjs';

if(process.env.V106_ISOLATED_PG!=='YES_TEST_ONLY')
 throw Error('V108 tests require the disposable V106 PostgreSQL environment');
const {Pool}=pg;
const org='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
const domains=['sales','finance','academic'];
const scope=n=>({organization_id:org,
 incident_id:'55555555-5555-4555-8555-'+String(n).padStart(12,'0')});
const pem=k=>k.publicKey.export({format:'pem',type:'spki'});
const signDoc=(p,privateKey)=>({...p,signature:sign(null,
 Buffer.from(JSON.stringify(p)),privateKey).toString('base64url')});
const createPool=(user='v106_writer_a')=>new Pool({
 host:'127.0.0.1',port:5432,database:'v106_isolated',
 user,password:user==='v106_writer_a'?'ephemeral-v106-A-only':'ephemeral-v106-B-only',
 max:4,connectionTimeoutMillis:2000
});
function scenario(n){
 const s=scope(n),clock=1000000;
 const governance=generateKeyPairSync('ed25519');
 const keys=Object.fromEntries(domains.map(d=>[d,{
  id:d+'-source-001',pair:generateKeyPairSync('ed25519'),
  status:'active',activated_at_ms:clock-900
 }]));
 const state=Object.fromEntries(domains.map(d=>[d,{
  source_epoch:1,source_revision:1,incident_generation:1,
  revocation_sequence:0,revocation_digest:'d'.repeat(64),
  evidence_digest:'a'.repeat(64),unavailable:false,signature_bad:false
 }]));
 let trust_revision=1,roster_wrong=false;
 const roster=()=>{
  const payload={schema_version:'v3.2-104-ci-trust-roster-v1',
   organization_id:s.organization_id,revision:trust_revision,
   issued_at_ms:clock-100,expires_at_ms:clock+60000,
   keys:domains.map(d=>({domain:d,key_id:keys[d].id,
    public_key_pem:pem(keys[d].pair),status:keys[d].status,
    activated_at_ms:keys[d].activated_at_ms})),
   revocations:[],fixture_only:true};
  return signDoc(payload,roster_wrong?
   generateKeyPairSync('ed25519').privateKey:governance.privateKey);
 };
 const source=domain=>{
  const x=state[domain],k=keys[domain];
  const payload={schema_version:'v3.2-104-ci-source-proof-v1',
   domain,organization_id:s.organization_id,incident_id:s.incident_id,
   key_id:k.id,trust_revision,source_epoch:x.source_epoch,
   source_revision:x.source_revision,incident_generation:x.incident_generation,
   revocation_sequence:x.revocation_sequence,revocation_digest:x.revocation_digest,
   evidence_digest:x.evidence_digest,issued_at_ms:clock-200,
   expires_at_ms:clock+60000,fixture_only:true};
  return signDoc(payload,x.signature_bad?
   generateKeyPairSync('ed25519').privateKey:k.pair.privateKey);
 };
 const readers=Object.fromEntries(domains.map(d=>[d,async()=>{
  if(state[d].unavailable)throw Error('fixture-source-unavailable');
  return source(d);
 }]));
 const gate=checkpointStore=>createIsolatedSourceTrustFence({
  readTrustRoster:async()=>roster(),sourceReaders:readers,
  governancePublicKey:pem(governance),checkpointStore,
  getFixtureNow:()=>clock,timeoutMs:100
 });
 const revise=()=>domains.forEach(d=>{state[d].source_revision++;
  state[d].evidence_digest='f'.repeat(64);});
 const revoke=()=>domains.forEach(d=>{state[d].revocation_sequence++;
  state[d].revocation_digest='e'.repeat(64);});
 return {s,gate,state,revise,revoke,rosterWrong:v=>roster_wrong=v,
  signatureBad:d=>{state[d].signature_bad=true;},sourceUnavailable:d=>{
   state[d].unavailable=true;}};
}
function blocked(x){
 assert.ok(Object.isFrozen(x));
 assert.equal(x.hold_active,true);
 for(const key of ['external_authority_verified','finance_authorized',
  'academic_authorized','handoff_allowed','compensation_write_allowed',
  'release_eligible','production_integration_allowed'])
  assert.equal(x[key],false,key);
}
async function withPool(fn,user='v106_writer_a'){
 const pool=createPool(user);
 try{return await fn(pool);}finally{await pool.end();}
}
const guard=(h,store,hooks={})=>createIsolatedPostCommitCausalRecheck({
 sourceTrustFence:h.gate(store),checkpointStore:store,...hooks
});

test('V108-RACE-01 stable signed sources and SQL stay blocked from business operations',async()=>{
 const h=scenario(10801);
 await withPool(async pool=>{
  const store=createIsolatedPostgresCheckpointStore({pool});
  const result=await guard(h,store).inspect(h.s);blocked(result);
  assert.equal(result.reason_code,'BLOCKED_CI_POSTCOMMIT_OBSERVATION_STABLE_NO_AUTHORITY');
  assert.equal(result.fixture_postcommit_stable,true);
  assert.match(result.observation_digest,/^[a-f0-9]{64}$/);
  const row=await store.read(h.s);
  assert.equal(row.domains.sales.source_revision,1);
  assert.equal(row.revocation_sequence,0);
 });
});
test('V108-RACE-02 source updates while SQL is before COMMIT; no stale current result',async()=>{
 const h=scenario(10802);
 await withPool(async pool=>{
  let injected=false;
  const store=createIsolatedPostgresCheckpointStore({pool,
   beforeCommit:async()=>{if(!injected){injected=true;h.revise();}}});
  const result=await guard(h,store).inspect(h.s);blocked(result);
  assert.equal(injected,true);
  assert.equal(result.fixture_postcommit_stable,false);
  assert.equal(result.reason_code,'POSTCOMMIT_SOURCE_OR_CHECKPOINT_CHANGED');
  const persisted=await store.read(h.s);
  assert.equal(persisted.domains.finance.source_revision,2);
 });
});
test('V108-RACE-03 revocation immediately after first SQL COMMIT invalidates prior proof',async()=>{
 const h=scenario(10803);
 await withPool(async pool=>{
  const store=createIsolatedPostgresCheckpointStore({pool});
  const result=await guard(h,store,{afterFirstCommit:async()=>h.revoke()})
   .inspect(h.s);blocked(result);
  assert.equal(result.reason_code,'POSTCOMMIT_SOURCE_OR_CHECKPOINT_CHANGED');
  assert.equal((await store.read(h.s)).revocation_sequence,1);
 });
});
test('V108-RACE-04 revision after second committed observation blocks final conclusion',async()=>{
 const h=scenario(10804);
 await withPool(async pool=>{
  const store=createIsolatedPostgresCheckpointStore({pool});
  const result=await guard(h,store,{afterSecondCommit:async()=>h.revise()})
   .inspect(h.s);blocked(result);
  assert.equal(result.reason_code,'POSTCOMMIT_SOURCE_OR_CHECKPOINT_CHANGED');
  assert.equal((await store.read(h.s)).domains.finance.source_revision,2);
 });
});
test('V108-RACE-05 invalid signature or source outage after commit cannot be accepted',async()=>{
 for(const [n,mutate] of [
  [10805,h=>h.signatureBad('finance')],
  [10806,h=>h.sourceUnavailable('academic')],
  [10807,h=>h.rosterWrong(true)]
 ]){
  const h=scenario(n);
  await withPool(async pool=>{
   const store=createIsolatedPostgresCheckpointStore({pool});
   const result=await guard(h,store,{afterFirstCommit:async()=>mutate(h)})
    .inspect(h.s);blocked(result);
   assert.equal(result.reason_code,'POSTCOMMIT_SOURCE_OR_DATABASE_UNVERIFIED');
   assert.equal(result.fixture_postcommit_stable,false);
   assert.equal((await store.read(h.s)).domains.finance.source_revision,1);
  });
 }
});
test('V108-RACE-06 transactional pre-COMMIT crash rejects result and leaves no checkpoint',async()=>{
 const h=scenario(10808);
 await withPool(async pool=>{
  const store=createIsolatedPostgresCheckpointStore({pool,
   beforeCommit:async()=>{throw Error('fixture-sql-transaction-failure');}});
  const result=await guard(h,store).inspect(h.s);blocked(result);
  assert.equal(result.reason_code,'POSTCOMMIT_SOURCE_OR_DATABASE_UNVERIFIED');
  assert.equal(await store.read(h.s),null);
 });
});
test('V108-RACE-07 a mismatched tenant SQL writer cannot turn signed proof into acceptance',async()=>{
 const h=scenario(10809);
 await withPool(async pool=>{
  const store=createIsolatedPostgresCheckpointStore({pool});
  const result=await guard(h,store).inspect(h.s);blocked(result);
  assert.equal(result.reason_code,'POSTCOMMIT_SOURCE_OR_DATABASE_UNVERIFIED');
  assert.equal(await store.read(h.s),null);
 },'v106_writer_b');
});
test('V108-RACE-08 persisted-source tampering without matching signed source is rejected',async()=>{
 const h=scenario(10810);
 await withPool(async pool=>{
  const store=createIsolatedPostgresCheckpointStore({pool});
  const first=await guard(h,store).inspect(h.s);blocked(first);
  assert.equal(first.fixture_postcommit_stable,true);
  // Changing any signed source without a matching version should be rejected by SQL.
  h.state.finance.evidence_digest='f'.repeat(64);
  const result=await guard(h,store).inspect(h.s);blocked(result);
  assert.equal(result.reason_code,'POSTCOMMIT_SOURCE_OR_DATABASE_UNVERIFIED');
  assert.equal(result.fixture_postcommit_stable,false);
  assert.equal((await store.read(h.s)).domains.finance.evidence_digest,'a'.repeat(64));
 });
});
test('V108-RACE-09 no amount of postcommit reads closes after-final-read causal race',async()=>{
 const h=scenario(10811);
 await withPool(async pool=>{
  const store=createIsolatedPostgresCheckpointStore({pool});
  const result=await guard(h,store).inspect(h.s);blocked(result);
  assert.equal(result.fixture_postcommit_stable,true);
  // A source can change immediately after the LAST observation. This is a known
  // unclosed cross-service atomicity gap, NOT a successful business approval.
  h.revoke();
  assert.equal((await store.read(h.s)).revocation_sequence,0);
  assert.equal(result.external_authority_verified,false);
  const refreshed=await guard(h,store).inspect(h.s);blocked(refreshed);
  assert.equal(refreshed.reason_code,'BLOCKED_CI_POSTCOMMIT_OBSERVATION_STABLE_NO_AUTHORITY');
  assert.equal((await store.read(h.s)).revocation_sequence,1);
 });
});
test('V108-RACE-10 malformed scope and unauthorized caller-controlled fields rejected',async()=>{
 const h=scenario(10812);
 await withPool(async pool=>{
  const store=createIsolatedPostgresCheckpointStore({pool});
  const g=guard(h,store);
  let r=await g.inspect({...h.s,release_eligible:true});blocked(r);
  assert.equal(r.reason_code,'INVALID_POSTCOMMIT_SCOPE');
  r=await g.inspect({organization_id:other,incident_id:'invalid'});blocked(r);
  assert.equal(r.reason_code,'INVALID_POSTCOMMIT_SCOPE');
  assert.equal(await store.read(h.s),null);
  assert.throws(()=>createIsolatedPostCommitCausalRecheck({}),TypeError);
 });
});
