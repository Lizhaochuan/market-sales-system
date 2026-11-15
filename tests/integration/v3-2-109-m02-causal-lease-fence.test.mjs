import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import pg from 'pg';
import {createIsolatedSourceTrustFence} from '../../src/cross-module-source-trust-fence.mjs';
import {createIsolatedCausalLeaseFence} from '../../src/cross-module-causal-lease-fence.mjs';
import {createIsolatedPostgresCheckpointStore} from '../helpers/v3-2-106-m02-postgres-checkpoint.mjs';
import {createIsolatedPostgresLeaseLedger} from '../helpers/v3-2-109-m02-postgres-lease-ledger.mjs';

if(process.env.V106_ISOLATED_PG!=='YES_TEST_ONLY')
 throw Error('V109 lease tests require disposable PostgreSQL CI environment');
const {Pool}=pg,org='11111111-1111-4111-8111-111111111111';
const domains=['sales','finance','academic'];
const scope=n=>({organization_id:org,
 incident_id:'66666666-6666-4666-8666-'+String(n).padStart(12,'0')});
const keyString=k=>k.publicKey.export({type:'spki',format:'pem'});
const signed=(p,key)=>({...p,signature:sign(null,
 Buffer.from(JSON.stringify(p)),key).toString('base64url')});
function poolFor(role='v106_writer_a'){
 return new Pool({host:'127.0.0.1',port:5432,database:'v106_isolated',
  user:role,password:role==='v106_writer_a'?
  'ephemeral-v106-A-only':'ephemeral-v106-B-only',
  max:4,connectionTimeoutMillis:3000});
}
function fixture(n){
 const s=scope(n),gov=generateKeyPairSync('ed25519'),
  authorityKey=generateKeyPairSync('ed25519');
 let clock=1000000,epoch=1,serial=0,issueBad=false,
  statusBad=false,expireEarly=false,statusEpochDelta=0;
 const revoked=new Set();
 const keys=Object.fromEntries(domains.map(d=>[d,generateKeyPairSync('ed25519')]));
 const data=Object.fromEntries(domains.map(d=>[d,{
  source_revision:1,evidence_digest:'a'.repeat(64),source_epoch:1,
  incident_generation:1,revocation_sequence:0,revocation_digest:'d'.repeat(64),
  bad_signature:false
 }]));
 const roster=()=>{
  const p={schema_version:'v3.2-104-ci-trust-roster-v1',
   organization_id:org,revision:1,issued_at_ms:clock-100,
   expires_at_ms:clock+60000,
   keys:domains.map(d=>({domain:d,key_id:d+'-v109-key-001',
    public_key_pem:keyString(keys[d]),status:'active',activated_at_ms:clock-900})),
   revocations:[],fixture_only:true};
  return signed(p,gov.privateKey);
 };
 const readers=Object.fromEntries(domains.map(d=>[d,async()=>{
  const x=data[d];
  const p={schema_version:'v3.2-104-ci-source-proof-v1',domain:d,
   organization_id:org,incident_id:s.incident_id,
   key_id:d+'-v109-key-001',trust_revision:1,
   source_epoch:x.source_epoch,source_revision:x.source_revision,
   incident_generation:x.incident_generation,
   revocation_sequence:x.revocation_sequence,
   revocation_digest:x.revocation_digest,evidence_digest:x.evidence_digest,
   issued_at_ms:clock-200,expires_at_ms:clock+60000,fixture_only:true};
  const k=x.bad_signature?generateKeyPairSync('ed25519').privateKey:
   keys[d].privateKey;
  return signed(p,k);
 }]));
 const issuer={
  issue:async({scope:asked,source_watermark_digest})=>{
   if(asked.incident_id!==s.incident_id)throw Error('wrong source scope');
   serial++;
   const p={schema_version:'v3.2-109-ci-lease-claim-v1',
    organization_id:org,incident_id:s.incident_id,
    lease_id:'lease-claim-'+String(n)+'-'+serial,
    holder_id:'sales-independent-review-001',
    barrier_epoch:epoch,source_watermark_digest,
    revocation_sequence:data.sales.revocation_sequence,
    revocation_digest:data.sales.revocation_digest,
    issued_at_ms:clock-100,
    expires_at_ms:expireEarly?clock-1:clock+10000,fixture_only:true};
   return signed(p,issueBad?generateKeyPairSync('ed25519').privateKey:
    authorityKey.privateKey);
  },
  inspect:async({scope:asked,lease_id})=>{
   if(asked.incident_id!==s.incident_id)throw Error('wrong scope');
   const p={schema_version:'v3.2-109-ci-lease-status-v1',
    organization_id:org,incident_id:s.incident_id,lease_id,
    barrier_epoch:epoch+statusEpochDelta,
    state:revoked.has(lease_id)?'revoked':'active',
    observed_at_ms:clock,fixture_only:true};
   return signed(p,statusBad?generateKeyPairSync('ed25519').privateKey:
    authorityKey.privateKey);
  }
 };
 const sourceFence=checkpointStore=>createIsolatedSourceTrustFence({
  readTrustRoster:async()=>roster(),sourceReaders:readers,
  governancePublicKey:keyString(gov),checkpointStore,
  getFixtureNow:()=>clock,timeoutMs:100
 });
 function barrier(checkpointStore,leaseLedger,hooks={}){
  return createIsolatedCausalLeaseFence({
   sourceTrustFence:sourceFence(checkpointStore),checkpointStore,
   leaseAuthority:issuer,leaseLedger,
   fixtureLeasePublicKey:keyString(authorityKey),
   getFixtureNow:()=>clock,...hooks});
 }
 function advanceSource(){
  domains.forEach(d=>{data[d].source_revision++;
   data[d].evidence_digest='f'.repeat(64);});
 }
 function revokeSource(){
  domains.forEach(d=>{data[d].revocation_sequence++;
   data[d].revocation_digest='e'.repeat(64);});
 }
 return {s,issuer,sourceFence,barrier,data,advanceSource,revokeSource,
  revokeLease:lease_id=>revoked.add(lease_id),
  clock:n=>{clock=n;},tick:n=>{clock+=n;},
  raiseEpoch:()=>{epoch++;},issueBad:n=>{issueBad=n;},
  statusBad:n=>{statusBad=n;},expireEarly:n=>{expireEarly=n;},
  statusEpoch:n=>{statusEpochDelta=n;}};
}
const safe=x=>{
 assert.ok(Object.isFrozen(x));assert.equal(x.hold_active,true);
 for(const k of ['external_authority_verified','finance_authorized',
  'academic_authorized','handoff_allowed','compensation_write_allowed',
  'release_eligible','production_integration_allowed'])assert.equal(x[k],false,k);
};
async function withStores(run,role='v106_writer_a'){
 const pool=poolFor(role);
 try{
  const checkpointStore=createIsolatedPostgresCheckpointStore({pool});
  const leaseLedger=createIsolatedPostgresLeaseLedger({pool});
  return await run({pool,checkpointStore,leaseLedger});
 }finally{await pool.end();}
}
test('LEASE-01 signed independent fixture lease and persisted PostgreSQL fence remain business blocked',async()=>{
 const f=fixture(10901);
 await withStores(async({checkpointStore,leaseLedger})=>{
  const r=await f.barrier(checkpointStore,leaseLedger).inspect(f.s);safe(r);
  assert.equal(r.reason_code,'BLOCKED_CI_CAUSAL_LEASE_OBSERVATION_NO_EXTERNAL_AUTHORITY');
  assert.equal(r.fixture_lease_observation_current,true);
  assert.equal(r.barrier_epoch,1);
  const row=await leaseLedger.read(f.s);
  assert.equal(row.lease_id,r.lease_id);
  assert.equal(row.state,'active');
  assert.equal((await checkpointStore.read(f.s)).revocation_sequence,0);
 });
});
test('LEASE-02 expired and wrong-signed issuer tokens are rejected before SQL binding',async()=>{
 for(const [n,setup,code] of [
  [10902,f=>f.expireEarly(true),'LEASE_ISSUANCE_SCOPE_EPOCH_OR_EXPIRY_INVALID'],
  [10903,f=>f.issueBad(true),'LEASE_ISSUANCE_SIGNATURE_INVALID']
 ]){
  const f=fixture(n);setup(f);
  await withStores(async({checkpointStore,leaseLedger})=>{
   const r=await f.barrier(checkpointStore,leaseLedger).inspect(f.s);safe(r);
   assert.equal(r.reason_code,code);
   assert.equal(await leaseLedger.read(f.s),null);
  });
 }
});
test('LEASE-03 revocation immediately after bind overrides a still-active SQL lease',async()=>{
 const f=fixture(10904);
 await withStores(async({checkpointStore,leaseLedger})=>{
  const g=f.barrier(checkpointStore,leaseLedger,{
   afterBind:async()=>f.revokeLease((await leaseLedger.read(f.s)).lease_id)});
  const r=await g.inspect(f.s);safe(r);
  assert.equal(r.reason_code,'LEASE_REVOKED_EXPIRED_OR_FENCED');
  assert.equal(r.fixture_lease_observation_current,false);
 });
});
test('LEASE-04 stolen/lost SQL fence is detected even if fixture issuer still says active',async()=>{
 const f=fixture(10905);
 await withStores(async({checkpointStore,leaseLedger})=>{
  const g=f.barrier(checkpointStore,leaseLedger,{
   afterBind:async()=>{assert.equal(await leaseLedger.invalidate(f.s,
    (await leaseLedger.read(f.s)).lease_id),true);}});
  const r=await g.inspect(f.s);safe(r);
  assert.equal(r.reason_code,'LEASE_SQL_FENCE_LOST_OR_UNVERIFIED');
  assert.equal((await leaseLedger.read(f.s)).state,'revoked');
 });
});
test('LEASE-05 source revision or revocation mutation during lease is rejected',async()=>{
 for(const [n,mutate] of [[10906,f=>f.advanceSource()],[10907,f=>f.revokeSource()]]){
  const f=fixture(n);
  await withStores(async({checkpointStore,leaseLedger})=>{
   const r=await f.barrier(checkpointStore,leaseLedger,{afterBind:async()=>mutate(f)})
    .inspect(f.s);safe(r);
   assert.equal(r.reason_code,'LEASE_SOURCE_WATERMARK_CHANGED');
   assert.equal(r.fixture_lease_observation_current,false);
  });
 }
});
test('LEASE-06 lease expiry after first confirmation and forged status are fail closed',async()=>{
 for(const [n,hook,code] of [
  [10908,f=>f.tick(11000),'LEASE_REVOKED_EXPIRED_OR_FENCED'],
  [10909,f=>f.statusBad(true),'LEASE_STATUS_SIGNATURE_INVALID'],
  [10910,f=>f.statusEpoch(1),'LEASE_REVOKED_EXPIRED_OR_FENCED']
 ]){
  const f=fixture(n);
  await withStores(async({checkpointStore,leaseLedger})=>{
   const r=await f.barrier(checkpointStore,leaseLedger,{
    afterFirstConfirmation:async()=>hook(f)}).inspect(f.s);safe(r);
   assert.equal(r.reason_code,code);
  });
 }
});
test('LEASE-07 real PostgreSQL CAS refuses conflicting same-epoch leases',async()=>{
 const f=fixture(10911);
 await withStores(async({checkpointStore,leaseLedger})=>{
  const [a,b]=await Promise.all([
   f.barrier(checkpointStore,leaseLedger).inspect(f.s),
   f.barrier(checkpointStore,leaseLedger).inspect(f.s)
  ]);
  safe(a);safe(b);
  assert.equal([a,b].filter(x=>x.fixture_lease_observation_current).length,1);
  assert.equal([a,b].filter(x=>x.reason_code==='LEASE_SQL_BIND_REJECTED_OR_UNVERIFIED').length,1);
  assert.equal((await leaseLedger.read(f.s)).barrier_epoch,1);
 });
});
test('LEASE-08 source signing failure cannot establish lease ledger state',async()=>{
 const f=fixture(10912);
 f.data.finance.bad_signature=true;
 await withStores(async({checkpointStore,leaseLedger})=>{
  const r=await f.barrier(checkpointStore,leaseLedger).inspect(f.s);safe(r);
  assert.equal(r.fixture_lease_observation_current,false);
  assert.equal(r.reason_code,'TRUST_SOURCE_SIGNATURE_INVALID');
  assert.equal(await leaseLedger.read(f.s),null);
 });
});
test('LEASE-09 PostgreSQL tenant RLS prevents cross-organization lease binding',async()=>{
 const f=fixture(10913);
 await withStores(async({checkpointStore,leaseLedger})=>{
  const r=await f.barrier(checkpointStore,leaseLedger).inspect(f.s);safe(r);
  assert.equal(r.fixture_lease_observation_current,false);
  assert.equal(await leaseLedger.read(f.s),null);
 },'v106_writer_b');
});
test('LEASE-10 fake handoff receipt or caller-provided release flag is rejected',async()=>{
 const f=fixture(10914);
 await withStores(async({checkpointStore,leaseLedger})=>{
  const g=f.barrier(checkpointStore,leaseLedger);
  const r=await g.inspect({...f.s,handoff_allowed:true});safe(r);
  assert.equal(r.reason_code,'INVALID_CAUSAL_LEASE_SCOPE');
  assert.equal(await leaseLedger.read(f.s),null);
 });
});
test('LEASE-11 source changes AFTER final observation: fixture result is not an atomic grant',async()=>{
 const f=fixture(10915);
 await withStores(async({checkpointStore,leaseLedger})=>{
  const r=await f.barrier(checkpointStore,leaseLedger).inspect(f.s);safe(r);
  assert.equal(r.fixture_lease_observation_current,true);
  f.revokeSource();
  // A fixture result was already returned. The source authority did not
  // atomically participate in any external handoff transaction.
  assert.equal(r.handoff_allowed,false);
  const repeated=await f.barrier(checkpointStore,leaseLedger).inspect(f.s);safe(repeated);
  assert.equal(repeated.fixture_lease_observation_current,false);
 });
});
