import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import pg from 'pg';
import {createIsolatedSourceTrustFence} from '../../src/cross-module-source-trust-fence.mjs';
import {createIsolatedCausalLeaseFence} from '../../src/cross-module-causal-lease-fence.mjs';
import {createIsolatedLeaseLossNegativeReceiptGate} from '../../src/cross-module-lease-loss-negative-receipt.mjs';
import {createIsolatedPostgresCheckpointStore} from '../helpers/v3-2-106-m02-postgres-checkpoint.mjs';
import {createIsolatedPostgresLeaseLedger} from '../helpers/v3-2-109-m02-postgres-lease-ledger.mjs';
import {createIsolatedPostgresLossNoticeLedger} from '../helpers/v3-2-110-m02-postgres-loss-notices.mjs';

if(process.env.V106_ISOLATED_PG!=='YES_TEST_ONLY')
 throw Error('V110 must run in disposable PostgreSQL CI');
const {Pool}=pg;
const org='11111111-1111-4111-8111-111111111111';
const domains=['sales','finance','academic'];
const scope=n=>({organization_id:org,
 incident_id:'77777777-7777-4777-8777-'+String(n).padStart(12,'0')});
const pem=pair=>pair.publicKey.export({format:'pem',type:'spki'});
const signed=(p,key)=>({...p,signature:sign(null,Buffer.from(JSON.stringify(p)),key)
 .toString('base64url')});
const poolFor=(role='v106_writer_a')=>new Pool({
 host:'127.0.0.1',port:5432,database:'v106_isolated',
 user:role,password:role==='v106_writer_a'?
  'ephemeral-v106-A-only':'ephemeral-v106-B-only',
 max:4,connectionTimeoutMillis:3000
});
function fixture(n){
 const s=scope(n),gov=generateKeyPairSync('ed25519'),
  leaseKey=generateKeyPairSync('ed25519'),
  noticeKey=generateKeyPairSync('ed25519'),
  receiptKey=generateKeyPairSync('ed25519'),
  sourceKeys=Object.fromEntries(domains.map(d=>[d,generateKeyPairSync('ed25519')]));
 let clock=1000000,leaseCounter=0;
 const x={badNoticeSignature:false,noticeOrg:org,badReceiptSignature:false,
  receiptDisposition:'blocked',receiptOrg:org,badReceiptDigest:false,
  staleNotice:false,wrongSequence:false,changeSourceBeforeNotice:false};
 const state=Object.fromEntries(domains.map(d=>[d,{
  source_revision:1,evidence_digest:'a'.repeat(64),
  revocation_sequence:0,revocation_digest:'d'.repeat(64)
 }]));
 const roster=()=>{
  const p={schema_version:'v3.2-104-ci-trust-roster-v1',
   organization_id:org,revision:1,issued_at_ms:clock-100,
   expires_at_ms:clock+60000,
   keys:domains.map(d=>({domain:d,key_id:d+'-v110-key-001',
    public_key_pem:pem(sourceKeys[d]),status:'active',activated_at_ms:clock-900})),
   revocations:[],fixture_only:true};
  return signed(p,gov.privateKey);
 };
 const readers=Object.fromEntries(domains.map(d=>[d,async()=>{
  const v=state[d];
  const p={schema_version:'v3.2-104-ci-source-proof-v1',domain:d,
   organization_id:org,incident_id:s.incident_id,
   key_id:d+'-v110-key-001',trust_revision:1,
   source_epoch:1,source_revision:v.source_revision,
   incident_generation:1,revocation_sequence:v.revocation_sequence,
   revocation_digest:v.revocation_digest,evidence_digest:v.evidence_digest,
   issued_at_ms:clock-200,expires_at_ms:clock+60000,fixture_only:true};
  return signed(p,sourceKeys[d].privateKey);
 }]));
 const issuer={
  issue:async({scope:asked,source_watermark_digest})=>{
   assert.equal(asked.incident_id,s.incident_id);
   leaseCounter++;
   const p={schema_version:'v3.2-109-ci-lease-claim-v1',
    organization_id:org,incident_id:s.incident_id,
    lease_id:'v110-lease-'+String(n)+'-'+leaseCounter,
    holder_id:'fixture-segregated-sales-auditor-001',
    barrier_epoch:1,source_watermark_digest,
    revocation_sequence:state.sales.revocation_sequence,
    revocation_digest:state.sales.revocation_digest,
    issued_at_ms:clock-100,expires_at_ms:clock+10000,
    fixture_only:true};
   return signed(p,leaseKey.privateKey);
  },
  inspect:async({scope:asked,lease_id})=>{
   assert.equal(asked.incident_id,s.incident_id);
   const p={schema_version:'v3.2-109-ci-lease-status-v1',
    organization_id:org,incident_id:s.incident_id,lease_id,
    barrier_epoch:1,state:'active',
    observed_at_ms:clock,fixture_only:true};
   return signed(p,leaseKey.privateKey);
  }
 };
 function signer(checkpointStore,leaseLedger){
  return createIsolatedCausalLeaseFence({
   sourceTrustFence:createIsolatedSourceTrustFence({
    readTrustRoster:async()=>roster(),sourceReaders:readers,
    governancePublicKey:pem(gov),checkpointStore,getFixtureNow:()=>clock,
    timeoutMs:100
   }),
   checkpointStore,leaseAuthority:issuer,leaseLedger,
   fixtureLeasePublicKey:pem(leaseKey),getFixtureNow:()=>clock
  });
 }
 const bumpSource=()=>domains.forEach(d=>{state[d].source_revision++;
  state[d].evidence_digest='f'.repeat(64);});
 const notice=({scope:asked,lease,head})=>{
  assert.equal(asked.incident_id,s.incident_id);
  if(x.changeSourceBeforeNotice)bumpSource();
  const p={schema_version:'v3.2-110-ci-loss-notice-v1',
   organization_id:x.noticeOrg,incident_id:s.incident_id,
   lease_id:lease.lease_id,barrier_epoch:lease.barrier_epoch,
   source_watermark_digest:lease.observed_source_digest,
   notification_sequence:(head?.notification_sequence||0)+(x.wrongSequence?2:1),
   previous_notification_digest:head?.notification_digest||'0'.repeat(64),
   notification_kind:'lease_revoked',
   observed_at_ms:x.staleNotice?clock-35000:clock,
   fixture_only:true};
  return signed(p,x.badNoticeSignature?generateKeyPairSync('ed25519').privateKey:
   noticeKey.privateKey);
 };
 const receipt=({scope:asked,notice:n,notice_digest})=>{
  assert.equal(asked.incident_id,s.incident_id);
  const p={schema_version:'v3.2-110-ci-negative-receipt-v1',
   organization_id:x.receiptOrg,incident_id:s.incident_id,lease_id:n.lease_id,
   barrier_epoch:n.barrier_epoch,
   notification_sequence:n.notification_sequence,
   notification_digest:x.badReceiptDigest?'f'.repeat(64):notice_digest,
   disposition:x.receiptDisposition,
   observed_at_ms:clock,fixture_only:true};
  return signed(p,x.badReceiptSignature?generateKeyPairSync('ed25519').privateKey:
   receiptKey.privateKey);
 };
 function gate({checkpointStore,leaseLedger,noticeLedger,afterNoticeCommit}){
  return createIsolatedLeaseLossNegativeReceiptGate({
   causalLeaseFence:signer(checkpointStore,leaseLedger),leaseLedger,noticeLedger,
   fetchSignedNotice:async args=>notice(args),
   fetchSignedReceipt:async args=>receipt(args),
   fixtureNoticePublicKey:pem(noticeKey),
   fixtureReceiptPublicKey:pem(receiptKey),getFixtureNow:()=>clock,
   ...(afterNoticeCommit?{afterNoticeCommit}:{})
  });
 }
 return {s,x,gate,notice,receipt,signer,bumpSource,
  revokeSource:()=>domains.forEach(d=>{state[d].revocation_sequence++;
   state[d].revocation_digest='e'.repeat(64);}),
  now:()=>clock,tick:n=>{clock+=n;}};
}
function safe(result){
 assert.ok(Object.isFrozen(result));
 assert.equal(result.hold_active,true);
 for(const k of ['external_authority_verified','finance_authorized',
  'academic_authorized','handoff_allowed','compensation_write_allowed',
  'release_eligible','production_integration_allowed'])assert.equal(result[k],false,k);
}
async function withStores(fn){
 const pool=poolFor();
 try{
  return await fn({
   pool,checkpointStore:createIsolatedPostgresCheckpointStore({pool}),
   leaseLedger:createIsolatedPostgresLeaseLedger({pool}),
   noticeLedger:createIsolatedPostgresLossNoticeLedger({pool})});
 }finally{await pool.end();}
}
test('LOSS-01 signed notice and negative receipt durably revoke SQL lease without business release',async()=>{
 const f=fixture(11001);
 await withStores(async stores=>{
  const result=await f.gate(stores).inspect(f.s);safe(result);
  assert.equal(result.reason_code,'BLOCKED_CI_LEASE_LOSS_AND_NEGATIVE_RECEIPT');
  assert.equal(result.fixture_negative_receipt_current,true);
  assert.equal(result.notification_sequence,1);
  assert.equal((await stores.leaseLedger.read(f.s)).state,'revoked');
  assert.equal((await stores.noticeLedger.head(f.s)).notification_digest,
   result.notification_digest);
  assert.equal((await stores.noticeLedger.event(f.s,1)).notification_kind,'lease_revoked');
 });
});
test('LOSS-02 forged notification signature cannot touch SQL lease-loss ledger',async()=>{
 const f=fixture(11002);f.x.badNoticeSignature=true;
 await withStores(async stores=>{
  const r=await f.gate(stores).inspect(f.s);safe(r);
  assert.equal(r.reason_code,'LEASE_LOSS_NOTICE_SIGNATURE_INVALID');
  assert.equal((await stores.leaseLedger.read(f.s)).state,'active');
  assert.equal(await stores.noticeLedger.head(f.s),null);
 });
});
test('LOSS-03 signed cross-tenant notice is refused and does not revoke lease',async()=>{
 const f=fixture(11003);
 f.x.noticeOrg='22222222-2222-4222-8222-222222222222';
 await withStores(async stores=>{
  const r=await f.gate(stores).inspect(f.s);safe(r);
  assert.equal(r.reason_code,'LEASE_LOSS_NOTICE_SCOPE_SEQUENCE_OR_TTL_INVALID');
  assert.equal((await stores.leaseLedger.read(f.s)).state,'active');
 });
});
test('LOSS-04 stale notices or out-of-order sequences are denied before SQL persistence',async()=>{
 for(const [n,field] of [[11004,'staleNotice'],[11005,'wrongSequence']]){
  const f=fixture(n);f.x[field]=true;
  await withStores(async stores=>{
   const r=await f.gate(stores).inspect(f.s);safe(r);
   assert.equal(r.reason_code,'LEASE_LOSS_NOTICE_SCOPE_SEQUENCE_OR_TTL_INVALID');
   assert.equal((await stores.leaseLedger.read(f.s)).state,'active');
   assert.equal(await stores.noticeLedger.head(f.s),null);
  });
 }
});
test('LOSS-05 forged receipt is denied AFTER notice is durably recorded and SQL lease revoked',async()=>{
 const f=fixture(11006);f.x.badReceiptSignature=true;
 await withStores(async stores=>{
  const r=await f.gate(stores).inspect(f.s);safe(r);
  assert.equal(r.reason_code,'LEASE_NEGATIVE_RECEIPT_SIGNATURE_INVALID');
  assert.equal((await stores.leaseLedger.read(f.s)).state,'revoked');
  assert.equal((await stores.noticeLedger.head(f.s)).notification_sequence,1);
 });
});
test('LOSS-06 signed fake accepted receipt and forged digest cannot grant handoff',async()=>{
 for(const [n,change] of [[11007,f=>f.x.receiptDisposition='accepted'],
  [11008,f=>f.x.badReceiptDigest=true],[11009,f=>
   f.x.receiptOrg='22222222-2222-4222-8222-222222222222']]){
  const f=fixture(n);change(f);
  await withStores(async stores=>{
   const r=await f.gate(stores).inspect(f.s);safe(r);
   assert.equal(r.reason_code,'LEASE_NEGATIVE_RECEIPT_INVALID_OR_FALSE_ACCEPTANCE');
   assert.equal((await stores.leaseLedger.read(f.s)).state,'revoked');
  });
 }
});
test('LOSS-07 signed uncertain commit receipt can only return blocked uncertainty',async()=>{
 const f=fixture(11010);f.x.receiptDisposition='uncertain';
 await withStores(async stores=>{
  const r=await f.gate(stores).inspect(f.s);safe(r);
  assert.equal(r.reason_code,'LEASE_NEGATIVE_RECEIPT_COMMIT_UNCERTAIN');
  assert.equal(r.fixture_negative_receipt_current,false);
  assert.equal((await stores.leaseLedger.read(f.s)).state,'revoked');
 });
});
test('LOSS-08 post-COMMIT lost response cannot assert failure of durable revoke or success',async()=>{
 const f=fixture(11011);
 await withStores(async stores=>{
  const r=await f.gate({...stores,afterNoticeCommit:async()=>{
   throw Error('simulated ack lost after SQL COMMIT');
  }}).inspect(f.s);safe(r);
  assert.equal(r.reason_code,'LEASE_LOSS_DEPENDENCY_UNAVAILABLE');
  assert.equal((await stores.leaseLedger.read(f.s)).state,'revoked');
  assert.equal((await stores.noticeLedger.head(f.s)).notification_sequence,1);
 });
});
test('LOSS-09 pre-COMMIT SQL fault rolls back BOTH notice event and lease revocation',async()=>{
 const f=fixture(11012);
 await withStores(async stores=>{
  const faulty=createIsolatedPostgresLossNoticeLedger({
   pool:stores.pool,beforeCommit:async()=>{throw Error('synthetic SQL rollback');}});
  const r=await f.gate({...stores,noticeLedger:faulty}).inspect(f.s);safe(r);
  assert.equal(r.reason_code,'LEASE_LOSS_DEPENDENCY_UNAVAILABLE');
  assert.equal(await stores.noticeLedger.head(f.s),null);
  assert.equal(await stores.noticeLedger.event(f.s,1),null);
  assert.equal((await stores.leaseLedger.read(f.s)).state,'active');
 });
});
test('LOSS-10 replayed and concurrent signed notice cannot revoke twice or change event history',async()=>{
 const f=fixture(11013);
 await withStores(async stores=>{
  const lease=await f.signer(stores.checkpointStore,stores.leaseLedger).inspect(f.s);
  assert.equal(lease.fixture_lease_observation_current,true);
  const raw=f.notice({scope:f.s,lease,head:null});
  const [a,b]=await Promise.all([
   stores.noticeLedger.append(f.s,raw),stores.noticeLedger.append(f.s,raw)]);
  assert.equal([a,b].filter(x=>x.accepted).length,1);
  assert.equal([a,b].filter(x=>!x.accepted).length,1);
  assert.equal((await stores.noticeLedger.head(f.s)).notification_sequence,1);
  assert.equal((await stores.leaseLedger.read(f.s)).state,'revoked');
  const replay=await stores.noticeLedger.append(f.s,raw);
  assert.equal(replay.accepted,false);
  assert.equal((await stores.noticeLedger.event(f.s,1)).signature,raw.signature);
 });
});
test('LOSS-11 wrong tenant database role cannot append a signed lease-loss notice',async()=>{
 const f=fixture(11014);
 await withStores(async stores=>{
  const otherPool=poolFor('v106_writer_b');
  try{
   const otherNotices=createIsolatedPostgresLossNoticeLedger({pool:otherPool});
   const r=await f.gate({...stores,noticeLedger:otherNotices}).inspect(f.s);safe(r);
   assert.equal(r.reason_code,'LEASE_NOTICE_COMMIT_UNVERIFIED');
   assert.equal((await stores.leaseLedger.read(f.s)).state,'active');
   assert.equal(await stores.noticeLedger.head(f.s),null);
  }finally{await otherPool.end();}
 });
});
test('LOSS-12 revoked lease cannot be reused for a second negative receipt',async()=>{
 const f=fixture(11015);
 await withStores(async stores=>{
  const once=await f.gate(stores).inspect(f.s);safe(once);
  assert.equal(once.fixture_negative_receipt_current,true);
  const twice=await f.gate(stores).inspect(f.s);safe(twice);
  assert.equal(twice.fixture_negative_receipt_current,false);
  assert.equal(twice.reason_code,'LEASE_PRECONDITION_NOT_CURRENT');
  assert.equal((await stores.noticeLedger.head(f.s)).notification_sequence,1);
 });
});
test('LOSS-13 source can change after lease inspection: no true cross-system atomic barrier',async()=>{
 const f=fixture(11016);f.x.changeSourceBeforeNotice=true;
 await withStores(async stores=>{
  const r=await f.gate(stores).inspect(f.s);safe(r);
  // The revocation is still correct, but this is NOT proof of a cross-service
  // atomic source checkpoint. The source changed after lease validation.
  assert.equal(r.reason_code,'BLOCKED_CI_LEASE_LOSS_AND_NEGATIVE_RECEIPT');
  assert.equal(r.handoff_allowed,false);
  assert.equal((await stores.leaseLedger.read(f.s)).state,'revoked');
  const current=await stores.checkpointStore.read(f.s);
  assert.equal(current.domains.sales.source_revision,1);
 });
});
test('LOSS-14 extra caller authority flags and invalid scope are rejected without SQL writes',async()=>{
 const f=fixture(11017);
 await withStores(async stores=>{
  const gate=f.gate(stores);
  const r=await gate.inspect({...f.s,finance_authorized:true});safe(r);
  assert.equal(r.reason_code,'INVALID_LEASE_LOSS_SCOPE');
  assert.equal(await stores.noticeLedger.head(f.s),null);
  assert.equal(await stores.leaseLedger.read(f.s),null);
  assert.throws(()=>createIsolatedLeaseLossNegativeReceiptGate({}),TypeError);
 });
});
