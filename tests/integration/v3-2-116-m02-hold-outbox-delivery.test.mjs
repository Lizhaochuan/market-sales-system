import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import pg from 'pg';
import {createIsolatedHoldOutboxProtocol} from '../../src/cross-module-hold-outbox-protocol.mjs';
import {createIsolatedPostgresHoldOutbox} from '../helpers/v3-2-116-m02-postgres-hold-outbox.mjs';
import {createIsolatedPostgresReviewHoldLedger} from '../helpers/v3-2-115-m02-postgres-review-hold.mjs';

if(process.env.V106_ISOLATED_PG!=='YES_TEST_ONLY')
 throw Error('V116 requires a disposable PostgreSQL test database');
const {Pool}=pg,org='11111111-1111-4111-8111-111111111111';
const student='99999999-9999-4999-8999-999999999999';
const SCOPE=['organization_id','incident_id','student_id'];
const zero='0'.repeat(64);
const scope=n=>({organization_id:org,incident_id:'88888888-8888-4888-8888-'+String(n).padStart(12,'0'),student_id:student});
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const publicPem=key=>key.publicKey.export({format:'pem',type:'spki'});
const signFixture=(body,key)=>({...body,signature:sign(null,
 Buffer.from(JSON.stringify(body)),key).toString('base64url')});
const poolFor=(role='v106_writer_a')=>new Pool({
 host:'127.0.0.1',port:5432,database:'v106_isolated',user:role,
 password:role==='v106_writer_a'?'ephemeral-v106-A-only':'ephemeral-v106-B-only',
 max:5,connectionTimeoutMillis:2500});
const safe=x=>{
 assert.equal(Object.isFrozen(x),true);
 assert.equal(x.hold_active,true);
 for(const k of ['external_authority_verified','external_source_verified',
  'external_recipient_verified','finance_authorized','academic_authorized',
  'handoff_allowed','compensation_write_allowed','release_eligible',
  'production_integration_allowed','merge_authorized','deploy_authorized'])
  assert.equal(x[k],false,k);
};
async function seedHold(pool,s,count=1){
 let previous=zero;
 const out=[];
 for(let i=1;i<=count;i++){
  const body={schema_version:'v3.2-115-ci-invalidation-hold-v1',
   scope:s,sequence:i,previous_event_digest:previous,
   assignment_digest:'a'.repeat(64),intake_head_digest:'b'.repeat(64),
   lifecycle_head_digest:zero,reviewer_id:'reviewer-fixture-001',
   trigger_kind:i===1?'REVIEWER_REVOKED':'EVIDENCE_UPDATED',
   source_signal_digest:'d'.repeat(64),cause_digest:(i===1?'e':'f').repeat(64),
   status:'HOLD_PENDING_EXTERNAL_AUTHORITY',recorded_at_ms:1000000+i};
  const digest=sha(body);
  await pool.query(
   'INSERT INTO v106_test.fixture_review_hold_events (organization_id,incident_id,student_id,sequence,cause_digest,event_payload,event_digest) VALUES ($1,$2,$3,$4,$5,$6,$7)',
   [s.organization_id,s.incident_id,s.student_id,i,body.cause_digest,
    JSON.stringify(body),digest]);
  previous=digest;out.push({body,digest});
 }
 await pool.query(
  'INSERT INTO v106_test.fixture_review_hold_heads (organization_id,incident_id,student_id,sequence,event_digest,hold_active) VALUES ($1,$2,$3,$4,$5,true)',
  [s.organization_id,s.incident_id,s.student_id,count,previous]);
 return out;
}
function harness(s,pool){
 const holdLedger=createIsolatedPostgresReviewHoldLedger({pool});
 const outboxLedger=createIsolatedPostgresHoldOutbox({pool});
 const sourceKey=generateKeyPairSync('ed25519');
 const recipientKey=generateKeyPairSync('ed25519');
 let clock=1000000,sourceForge=false,sourceOrg=org,
  sourceExpiry=1010000,sourceDigestWrong=false,sourceOffline=false,
  recipientForge=false,recipientOrg=org,recipientWrongDigest=false,
  recipientDisposition='fixture_received_still_blocked',recipientExpiry=1010000;
 const source=async({scope:sc,hold_sequence,hold_event_digest})=>{
  if(sourceOffline)throw Error('fixture source unavailable');
  const body={schema_version:'v3.2-116-ci-source-hold-v1',...sc,
   organization_id:sourceOrg,hold_sequence,
   hold_event_digest:sourceDigestWrong?'f'.repeat(64):hold_event_digest,
   source_epoch:1,source_revision:1,revocation_sequence:1,
   issued_at_ms:clock-100,expires_at_ms:sourceExpiry,fixture_only:true};
  const key=sourceForge?generateKeyPairSync('ed25519').privateKey:sourceKey.privateKey;
  return signFixture(body,key);
 };
 const recipient=async({scope:sc,hold_sequence,message_digest})=>{
  const body={schema_version:'v3.2-116-ci-negative-recipient-receipt-v1',
   ...sc,organization_id:recipientOrg,hold_sequence,
   message_digest:recipientWrongDigest?'f'.repeat(64):message_digest,
   recipient_id:'fixture-hold-notice-receiver-001',
   delivery_status:recipientDisposition,
   issued_at_ms:clock-100,expires_at_ms:recipientExpiry,fixture_only:true};
  const key=recipientForge?generateKeyPairSync('ed25519').privateKey:
   recipientKey.privateKey;
  return signFixture(body,key);
 };
 const protocol=(opts={})=>createIsolatedHoldOutboxProtocol({
  holdLedger,outboxLedger,readSignedFixtureHoldSource:source,
  readSignedFixtureRecipient:recipient,
  fixtureSourcePublicKey:publicPem(sourceKey),
  fixtureRecipientPublicKey:publicPem(recipientKey),
  getFixtureNow:()=>clock,...opts
 });
 const input=(sequence=1)=>({...s,hold_sequence:sequence});
 return {s,pool,holdLedger,outboxLedger,sourceKey,recipientKey,
  source,recipient,protocol,input,
  sourceForge:x=>{sourceForge=x;},sourceOrg:x=>{sourceOrg=x;},
  sourceExpiry:x=>{sourceExpiry=x;},sourceWrongDigest:x=>{sourceDigestWrong=x;},
  offline:x=>{sourceOffline=x;},recipientForge:x=>{recipientForge=x;},
  recipientOrg:x=>{recipientOrg=x;},recipientWrongDigest:x=>{recipientWrongDigest=x;},
  recipientDisposition:x=>{recipientDisposition=x;},
  recipientExpiry:x=>{recipientExpiry=x;},
  clock:x=>{clock=x;}
 };
}
async function using(n,count,fn){
 const pool=poolFor();
 try{
  const s=scope(n);
  await seedHold(pool,s,count);
  const f=harness(s,pool);
  return await fn(f);
 }finally{await pool.end();}
}

test('OUT-01 signed fixture source publishes a durable blocked HOLD outbox, without delivery claim',async()=>{
 await using(11601,1,async f=>{
  const r=await f.protocol().publish(f.input());safe(r);
  assert.equal(r.reason_code,'BLOCKED_FIXTURE_OUTBOX_PERSISTED_AWAITING_RECEIPT');
  assert.equal(r.fixture_message_stored,true);
  assert.equal((await f.outboxLedger.message(f.s,1)).status,'PENDING_NEGATIVE_FIXTURE_RECEIPT');
  assert.equal((await f.protocol().inspect(f.input())).reason_code,
   'BLOCKED_FIXTURE_OUTBOX_AWAITING_RECEIPT');
 });
});
test('OUT-02 separately signed negative-only receipt can be recorded but never authorizes anything',async()=>{
 await using(11602,1,async f=>{
  assert.equal((await f.protocol().publish(f.input())).fixture_message_stored,true);
  const r=await f.protocol().acknowledge(f.input());safe(r);
  assert.equal(r.fixture_negative_receipt_stored,true);
  assert.equal(r.reason_code,'BLOCKED_FIXTURE_NEGATIVE_RECEIPT_RECORDED');
  assert.equal((await f.protocol().inspect(f.input())).reason_code,
   'BLOCKED_FIXTURE_OUTBOX_NEGATIVE_RECEIPT_RECORDED');
  assert.equal((await f.outboxLedger.receipt(f.s,1)).status,'NEGATIVE_FIXTURE_RECEIPT_ONLY');
 });
});
test('OUT-03 forged source signature or foreign organization cannot enqueue',async()=>{
 let n=11603;
 for(const change of [f=>f.sourceForge(true),
  f=>f.sourceOrg('22222222-2222-4222-8222-222222222222')]){
  await using(n++,1,async f=>{
   change(f);const r=await f.protocol().publish(f.input());safe(r);
   assert.ok(['V116_SOURCE_SIGNATURE_UNVERIFIED',
    'V116_SOURCE_SCOPE_REVISION_OR_EXPIRY_INVALID'].includes(r.reason_code));
   assert.equal(await f.outboxLedger.message(f.s,1),null);
  });
 }
});
test('OUT-04 forged source hold digest, expired proof and unavailable signer remain denied',async()=>{
 let n=11605;
 for(const change of [f=>f.sourceWrongDigest(true),
  f=>f.sourceExpiry(999999),f=>f.offline(true)]){
  await using(n++,1,async f=>{
   change(f);const r=await f.protocol().publish(f.input());safe(r);
   assert.equal(r.fixture_message_stored,false);
   assert.equal(await f.outboxLedger.message(f.s,1),null);
  });
 }
});
test('OUT-05 outbox cannot be published without a real V115 test HOLD event',async()=>{
 const pool=poolFor();
 try{
  const s=scope(11608),f=harness(s,pool);
  const r=await f.protocol().publish(f.input());safe(r);
  assert.equal(r.reason_code,'V116_HOLD_SOURCE_MISSING_OR_UNVERIFIED');
 }finally{await pool.end();}
});
test('OUT-06 out-of-order seq 2 enqueue denied until first HOLD outbox exists',async()=>{
 await using(11609,2,async f=>{
  let r=await f.protocol().publish(f.input(2));safe(r);
  assert.equal(r.reason_code,'V116_OUTBOX_REPLAY_GAP_OR_COMMIT_UNCERTAIN');
  assert.equal(await f.outboxLedger.message(f.s,2),null);
  assert.equal((await f.protocol().publish(f.input(1))).fixture_message_stored,true);
  r=await f.protocol().publish(f.input(2));safe(r);
  assert.equal(r.fixture_message_stored,true);
 });
});
test('OUT-07 durable restart and duplicate source delivery cannot create second immutable message',async()=>{
 await using(11610,1,async f=>{
  assert.equal((await f.protocol().publish(f.input())).fixture_message_stored,true);
  const again=await f.protocol().publish(f.input());safe(again);
  assert.equal(again.reason_code,'V116_OUTBOX_REPLAY_GAP_OR_COMMIT_UNCERTAIN');
  assert.equal((await f.outboxLedger.message(f.s,1)).message_kind,'hold_invalidation');
 });
});
test('OUT-08 recipient pretending to commit or approve business cannot produce negative receipt',async()=>{
 await using(11611,1,async f=>{
  await f.protocol().publish(f.input());
  f.recipientDisposition('business_handoff_complete');
  const r=await f.protocol().acknowledge(f.input());safe(r);
  assert.equal(r.reason_code,'V116_RECEIPT_SCOPE_STATUS_OR_EXPIRY_INVALID');
  assert.equal(await f.outboxLedger.receipt(f.s,1),null);
 });
});
test('OUT-09 forged receipt signature, cross-tenant receipt or wrong message hash is blocked',async()=>{
 let n=11612;
 for(const change of [f=>f.recipientForge(true),
  f=>f.recipientOrg('22222222-2222-4222-8222-222222222222'),
  f=>f.recipientWrongDigest(true)]){
  await using(n++,1,async f=>{
   await f.protocol().publish(f.input());change(f);
   const r=await f.protocol().acknowledge(f.input());safe(r);
   assert.equal(r.fixture_negative_receipt_stored,false);
   assert.equal(await f.outboxLedger.receipt(f.s,1),null);
  });
 }
});
test('OUT-10 out-of-order ack of second message is denied until seq 1 receipt arrives',async()=>{
 await using(11615,2,async f=>{
  assert.equal((await f.protocol().publish(f.input(1))).fixture_message_stored,true);
  assert.equal((await f.protocol().publish(f.input(2))).fixture_message_stored,true);
  let r=await f.protocol().acknowledge(f.input(2));safe(r);
  assert.equal(r.reason_code,'V116_NEGATIVE_RECEIPT_REPLAY_OR_OUT_OF_ORDER');
  assert.equal(await f.outboxLedger.receipt(f.s,2),null);
  assert.equal((await f.protocol().acknowledge(f.input(1))).fixture_negative_receipt_stored,true);
  r=await f.protocol().acknowledge(f.input(2));safe(r);
  assert.equal(r.fixture_negative_receipt_stored,true);
 });
});
test('OUT-11 replay of valid negative receipt preserves the original immutable entry',async()=>{
 await using(11616,1,async f=>{
  await f.protocol().publish(f.input());
  assert.equal((await f.protocol().acknowledge(f.input())).fixture_negative_receipt_stored,true);
  const first=await f.outboxLedger.receipt(f.s,1);
  const r=await f.protocol().acknowledge(f.input());safe(r);
  assert.equal(r.reason_code,'V116_NEGATIVE_RECEIPT_REPLAY_OR_OUT_OF_ORDER');
  assert.deepEqual(await f.outboxLedger.receipt(f.s,1),first);
 });
});
test('OUT-12 SQL exception before publishing COMMIT rolls back outbox insert',async()=>{
 await using(11617,1,async f=>{
  const broken=createIsolatedPostgresHoldOutbox({pool:f.pool,
   beforeEnqueueCommit:async()=>{throw Error('injected-precommit-failure');}});
  const r=await f.protocol({outboxLedger:broken}).publish(f.input());safe(r);
  assert.equal(r.reason_code,'V116_OUTBOX_DEPENDENCY_UNAVAILABLE');
  assert.equal(await f.outboxLedger.message(f.s,1),null);
 });
});
test('OUT-13 SQL exception before receipt COMMIT rolls back negative ack only',async()=>{
 await using(11618,1,async f=>{
  await f.protocol().publish(f.input());
  const broken=createIsolatedPostgresHoldOutbox({pool:f.pool,
   beforeReceiptCommit:async()=>{throw Error('injected-receipt-failure');}});
  const r=await f.protocol({outboxLedger:broken}).acknowledge(f.input());safe(r);
  assert.equal(r.reason_code,'V116_RECEIPT_DEPENDENCY_UNAVAILABLE');
  assert.equal(await f.outboxLedger.receipt(f.s,1),null);
  assert.ok(await f.outboxLedger.message(f.s,1));
 });
});
test('OUT-14 lost response after outbox COMMIT leaves durable message and blocked status',async()=>{
 await using(11619,1,async f=>{
  const r=await f.protocol({afterOutboxCommit:async()=>{
   throw Error('source-ack-network-lost');
  }}).publish(f.input());safe(r);
  assert.equal(r.reason_code,'V116_OUTBOX_DEPENDENCY_UNAVAILABLE');
  assert.ok(await f.outboxLedger.message(f.s,1));
  assert.equal((await f.protocol().inspect(f.input())).reason_code,
   'BLOCKED_FIXTURE_OUTBOX_AWAITING_RECEIPT');
 });
});
test('OUT-15 lost response after negative receipt COMMIT leaves auditable negative ack',async()=>{
 await using(11620,1,async f=>{
  await f.protocol().publish(f.input());
  const r=await f.protocol({afterReceiptCommit:async()=>{
   throw Error('negative-receipt-ack-lost');
  }}).acknowledge(f.input());safe(r);
  assert.equal(r.reason_code,'V116_RECEIPT_DEPENDENCY_UNAVAILABLE');
  assert.ok(await f.outboxLedger.receipt(f.s,1));
  assert.equal((await f.protocol().inspect(f.input())).hold_active,true);
 });
});
test('OUT-16 tenant B restricted PostgreSQL role cannot send or confirm A outbox',async()=>{
 await using(11621,1,async f=>{
  const p=poolFor('v106_writer_b');
  try{
   const b=createIsolatedPostgresHoldOutbox({pool:p});
   let r=await f.protocol({outboxLedger:b}).publish(f.input());safe(r);
   assert.equal(r.fixture_message_stored,false);
   assert.equal(await f.outboxLedger.message(f.s,1),null);
   await f.protocol().publish(f.input());
   r=await f.protocol({outboxLedger:b}).acknowledge(f.input());safe(r);
   assert.equal(r.fixture_negative_receipt_stored,false);
   assert.equal(await f.outboxLedger.receipt(f.s,1),null);
  }finally{await p.end();}
 });
});
test('OUT-17 concurrent independent writers cannot both publish the same HOLD message',async()=>{
 await using(11622,1,async f=>{
  const p=poolFor();
  try{
   const other=createIsolatedPostgresHoldOutbox({pool:p});
   const [a,b]=await Promise.all([
    f.protocol().publish(f.input()),
    f.protocol({outboxLedger:other}).publish(f.input())
   ]);
   safe(a);safe(b);
   assert.equal([a,b].filter(r=>r.fixture_message_stored).length,1);
   assert.equal([a,b].filter(r=>r.reason_code===
    'V116_OUTBOX_REPLAY_GAP_OR_COMMIT_UNCERTAIN').length,1);
   assert.ok(await f.outboxLedger.message(f.s,1));
  }finally{await p.end();}
 });
});
test('OUT-18 writer cannot mutate immutable outbox, receipts or business payment table',async()=>{
 await using(11623,1,async f=>{
  await f.protocol().publish(f.input());
  await f.protocol().acknowledge(f.input());
  await assert.rejects(f.pool.query(
   'UPDATE v106_test.fixture_hold_outbox SET message_digest=$1 WHERE incident_id=$2',
   ['f'.repeat(64),f.s.incident_id]),/permission denied/i);
  await assert.rejects(f.pool.query(
   'DELETE FROM v106_test.fixture_hold_outbox_negative_receipts WHERE incident_id=$1',
   [f.s.incident_id]),/permission denied/i);
  await assert.rejects(f.pool.query(
   'UPDATE v106_test.protected_business_fixture SET example_payment_amount=0'),
   /permission denied/i);
 });
});
test('OUT-19 malformed release flags and missing negative receipt never grant production authority',async()=>{
 await using(11624,1,async f=>{
  for(const x of [{...f.input(),hold_active:false},
   {...f.input(),finance_authorized:true},
   {...f.input(),student_id:'bad'},
   {...f.input(),hold_sequence:0}]){
   let r=await f.protocol().publish(x);safe(r);
   assert.equal(r.reason_code,'V116_OUTBOX_SCOPE_INVALID');
   r=await f.protocol().acknowledge(x);safe(r);
   assert.equal(r.reason_code,'V116_OUTBOX_SCOPE_INVALID');
  }
  assert.equal((await f.protocol().inspect(f.input())).reason_code,
   'BLOCKED_FIXTURE_OUTBOX_NOT_ENQUEUED');
  const deny=await f.protocol().acknowledge(f.input());safe(deny);
  assert.equal(deny.reason_code,'V116_OUTBOX_MESSAGE_UNVERIFIED');
 });
});
test('OUT-20 shared signer roots are rejected before creating any outbox authority',async()=>{
 await using(11625,1,async f=>{
  assert.throws(()=>f.protocol({
   fixtureRecipientPublicKey:publicPem(f.sourceKey)
  }),/must be distinct/);
  assert.throws(()=>createIsolatedHoldOutboxProtocol({}),TypeError);
 });
});
