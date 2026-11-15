import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import pg from 'pg';
import {createIsolatedHoldDeliveryReconciliation} from '../../src/cross-module-hold-delivery-reconciliation.mjs';
import {createIsolatedPostgresDeliveryReconciliation} from '../helpers/v3-2-117-m02-postgres-reconciliation.mjs';
import {createIsolatedPostgresReviewHoldLedger} from '../helpers/v3-2-115-m02-postgres-review-hold.mjs';
import {createIsolatedPostgresHoldOutbox} from '../helpers/v3-2-116-m02-postgres-hold-outbox.mjs';

if(process.env.V106_ISOLATED_PG!=='YES_TEST_ONLY')
 throw Error('V117 integration tests only on disposable PostgreSQL');
const {Pool}=pg;
const org='11111111-1111-4111-8111-111111111111';
const student='99999999-9999-4999-8999-999999999999';
const ZERO='0'.repeat(64);
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const scope=n=>({organization_id:org,
 incident_id:'88888888-8888-4888-8888-'+String(n).padStart(12,'0'),
 student_id:student});
const poolFor=(role='v106_writer_a')=>new Pool({
 host:'127.0.0.1',port:5432,database:'v106_isolated',user:role,
 password:role==='v106_writer_a'?'ephemeral-v106-A-only':'ephemeral-v106-B-only',
 max:5,connectionTimeoutMillis:3000
});
const safe=r=>{
 assert.equal(Object.isFrozen(r),true);
 assert.equal(r.hold_active,true);
 for(const k of ['external_authority_verified','external_source_verified',
  'external_recipient_verified','finance_authorized','academic_authorized',
  'handoff_allowed','compensation_write_allowed','release_eligible',
  'production_integration_allowed','merge_authorized','deploy_authorized'])
  assert.equal(r[k],false,k);
};
async function holdFixture(pool,s,count=1){
 let previous=ZERO;
 for(let i=1;i<=count;i++){
  const record={schema_version:'v3.2-115-ci-invalidation-hold-v1',
   scope:s,sequence:i,previous_event_digest:previous,
   assignment_digest:'a'.repeat(64),intake_head_digest:'b'.repeat(64),
   lifecycle_head_digest:ZERO,reviewer_id:'reviewer-fixture-001',
   trigger_kind:i===1?'REVIEWER_REVOKED':'EVIDENCE_UPDATED',
   source_signal_digest:'d'.repeat(64),
   cause_digest:(i===1?'e':'f').repeat(64),
   status:'HOLD_PENDING_EXTERNAL_AUTHORITY',recorded_at_ms:1000000+i};
  previous=sha(record);
  await pool.query(
   'INSERT INTO v106_test.fixture_review_hold_events (organization_id,incident_id,student_id,sequence,cause_digest,event_payload,event_digest) VALUES($1,$2,$3,$4,$5,$6,$7)',
   [s.organization_id,s.incident_id,s.student_id,i,record.cause_digest,
    JSON.stringify(record),previous]);
 }
 await pool.query(
  'INSERT INTO v106_test.fixture_review_hold_heads (organization_id,incident_id,student_id,sequence,event_digest,hold_active) VALUES($1,$2,$3,$4,$5,true)',
  [s.organization_id,s.incident_id,s.student_id,count,previous]);
}
function harness(s,pool){
 const holdLedger=createIsolatedPostgresReviewHoldLedger({pool});
 const outboxLedger=createIsolatedPostgresHoldOutbox({pool});
 const auditLedger=createIsolatedPostgresDeliveryReconciliation({pool});
 const pair=generateKeyPairSync('ed25519');
 let clock=1000000,disposition='active',unavailable=false,
  forge=false,wrongOrg=false,wrongMessage=false,expired=false,roleRev=0;
 async function addMessage(seq=1){
  const hold=await holdLedger.event(s,seq);
  const body={schema_version:'v3.2-116-ci-outbox-message-v1',scope:s,
   hold_sequence:seq,hold_event_digest:sha(hold),
   source_proof_digest:'c'.repeat(64),
   message_digest:sha({scope:s,seq,hold:sha(hold),blocked:true}),
   message_kind:'hold_invalidation',
   status:'PENDING_NEGATIVE_FIXTURE_RECEIPT',created_at_ms:1000000};
  const result=await outboxLedger.enqueue(s,body);
  assert.equal(result.accepted,true,JSON.stringify(result));
  return body;
 }
 async function addReceipt(seq=1){
  const message=await outboxLedger.message(s,seq);
  assert.ok(message);
  const record={schema_version:'v3.2-116-ci-delivery-receipt-v1',scope:s,
   hold_sequence:seq,message_digest:message.message_digest,
   recipient_id:'fixture-negative-receiver-001',
   signed_receipt_digest:'d'.repeat(64),
   status:'NEGATIVE_FIXTURE_RECEIPT_ONLY',recorded_at_ms:clock};
  const result=await outboxLedger.confirm(s,record);
  assert.equal(result.accepted,true,JSON.stringify(result));
  return record;
 }
 const readSignedFixtureDisposition=async({
  scope:requested,hold_sequence,hold_event_digest,message_digest
 })=>{
  if(unavailable)throw Error('fixture-source-unavailable');
  const data={schema_version:'v3.2-117-ci-source-disposition-v1',
   ...requested,organization_id:wrongOrg?
    '22222222-2222-4222-8222-222222222222':requested.organization_id,
   hold_sequence,hold_event_digest,
   message_digest:wrongMessage?'f'.repeat(64):message_digest,
   issuer_id:'fixture-reconciliation-governance-001',source_epoch:1,
   source_revision:1+roleRev,revocation_sequence:disposition==='revoked'?1:0,
   disposition,issued_at_ms:clock-100,
   expires_at_ms:expired?clock-1:clock+10000,fixture_only:true};
  const key=forge?generateKeyPairSync('ed25519').privateKey:pair.privateKey;
  return {...data,signature:sign(null,Buffer.from(JSON.stringify(data)),key)
   .toString('base64url')};
 };
 const gate=(overrides={})=>createIsolatedHoldDeliveryReconciliation({
  holdLedger,outboxLedger,auditLedger,
  readSignedFixtureDisposition,
  fixtureDispositionPublicKey:pair.publicKey.export({type:'spki',format:'pem'}),
  getFixtureNow:()=>clock,receiptOverdueMs:60000,...overrides});
 const input=(seq=1)=>({...s,hold_sequence:seq});
 return {s,pool,holdLedger,outboxLedger,auditLedger,addMessage,addReceipt,
  input,gate,readSignedFixtureDisposition,pair,
  setTime:t=>{clock=t;},setDisposition:v=>{disposition=v;},
  offline:v=>{unavailable=v;},forge:v=>{forge=v;},
  wrongOrg:v=>{wrongOrg=v;},wrongMessage:v=>{wrongMessage=v;},
  expired:v=>{expired=v;},bumpRevision:()=>{roleRev++;}
 };
}
async function using(n,count,cb){
 const pool=poolFor();
 try{
  const s=scope(n);await holdFixture(pool,s,count);
  const h=harness(s,pool);
  return await cb(h);
 }finally{await pool.end();}
}
test('REC-01 missing outbox after committed HOLD classified as gap, not delivery',async()=>{
 await using(11701,1,async h=>{
  const r=await h.gate().reconcile(h.input());safe(r);
  assert.equal(r.classification,'OUTBOX_GAP');
  assert.equal(r.manual_action,'RECONCILE_MISSING_OUTBOX_MANUALLY');
  assert.equal(r.fixture_reconciliation_recorded,true);
  assert.equal((await h.auditLedger.event(h.s,1)).status,'HOLD_ACTIVE_NEGATIVE_AUDIT_ONLY');
  assert.equal((await h.gate().inspect(h.input())).reason_code,
   'BLOCKED_RECONCILIATION_HISTORY_RETAINED');
 });
});
test('REC-02 outbox stored without negative receipt is waiting, never delivered',async()=>{
 await using(11702,1,async h=>{
  await h.addMessage();
  const r=await h.gate().reconcile(h.input());safe(r);
  assert.equal(r.classification,'AWAITING_NEGATIVE_RECEIPT');
  assert.equal(r.manual_action,'WAIT_AND_RECHECK_MANUALLY');
  assert.equal(await h.outboxLedger.receipt(h.s,1),null);
 });
});
test('REC-03 overdue missing receipt is uncertainty, not proof of packet loss',async()=>{
 await using(11703,1,async h=>{
  await h.addMessage();h.setTime(1060000);
  const r=await h.gate().reconcile(h.input());safe(r);
  assert.equal(r.classification,'NEGATIVE_RECEIPT_OVERDUE');
  assert.equal(r.manual_action,'INVESTIGATE_UNCERTAIN_DELIVERY');
  assert.equal(r.handoff_allowed,false);
 });
});
test('REC-04 stored negative receipt is still only a negative audit fact',async()=>{
 await using(11704,1,async h=>{
  await h.addMessage();await h.addReceipt();
  const r=await h.gate().reconcile(h.input());safe(r);
  assert.equal(r.classification,'NEGATIVE_RECEIPT_RECORDED');
  assert.equal(r.manual_action,'PRESERVE_NEGATIVE_RECEIPT_AND_HOLD');
  assert.equal(r.external_recipient_verified,false);
 });
});
test('REC-05 signed fixture revocation yields cancellation advisory but never deletes HOLD or outbox',async()=>{
 await using(11705,1,async h=>{
  await h.addMessage();h.setDisposition('revoked');
  const r=await h.gate().reconcile(h.input());safe(r);
  assert.equal(r.classification,'SIGNED_FIXTURE_CANCELLATION_ADVISORY');
  assert.equal(r.manual_action,'QUARANTINE_AND_VERIFY_REISSUE_MANUALLY');
  assert.equal((await h.holdLedger.head(h.s)).sequence,1);
  assert.ok(await h.outboxLedger.message(h.s,1));
  assert.equal(h.gate().release,undefined);
 });
});
test('REC-06 signer unreachable or invalid cryptographic signature becomes UNVERIFIED',async()=>{
 let n=11706;
 for(const mutate of [h=>h.offline(true),h=>h.forge(true),
  h=>h.wrongOrg(true),h=>h.expired(true),h=>h.wrongMessage(true)]){
  await using(n++,1,async h=>{
   await h.addMessage();mutate(h);
   const r=await h.gate().reconcile(h.input());safe(r);
   assert.equal(r.classification,'SOURCE_PROOF_UNVERIFIED');
   assert.equal(r.manual_action,'VERIFY_INDEPENDENT_SOURCE_MANUALLY');
  });
 }
});
test('REC-07 signed fixture unknown disposition cannot count as known revocation',async()=>{
 await using(11711,1,async h=>{
  h.setDisposition('unknown');
  const r=await h.gate().reconcile(h.input());safe(r);
  assert.equal(r.classification,'SOURCE_PROOF_UNVERIFIED');
 });
});
test('REC-08 repeated same classification and source proof is de-duplicated at SQL',async()=>{
 await using(11712,1,async h=>{
  const first=await h.gate().reconcile(h.input());safe(first);
  const r=await h.gate().reconcile(h.input());safe(r);
  assert.equal(r.reason_code,'RECONCILE_REPLAY_CONFLICT_OR_STALE_SNAPSHOT');
  assert.equal((await h.auditLedger.head(h.s)).sequence,1);
  assert.equal((await h.auditLedger.event(h.s,1)).cause_digest.length,64);
 });
});
test('REC-09 late V116 negative receipt creates a second linked audit classification',async()=>{
 await using(11713,1,async h=>{
  await h.addMessage();
  const first=await h.gate().reconcile(h.input());
  assert.equal(first.classification,'AWAITING_NEGATIVE_RECEIPT');
  await h.addReceipt();
  const second=await h.gate().reconcile(h.input());safe(second);
  assert.equal(second.classification,'NEGATIVE_RECEIPT_RECORDED');
  assert.equal(second.audit_sequence,2);
  const before=await h.auditLedger.event(h.s,1);
  const after=await h.auditLedger.event(h.s,2);
  assert.equal(after.previous_event_digest,sha(before));
 });
});
test('REC-10 verified fixture source revoked after negative receipt remains advisory only',async()=>{
 await using(11714,1,async h=>{
  await h.addMessage();await h.addReceipt();
  h.setDisposition('revoked');
  const r=await h.gate().reconcile(h.input());safe(r);
  assert.equal(r.classification,'SIGNED_FIXTURE_CANCELLATION_ADVISORY');
  assert.ok(await h.outboxLedger.receipt(h.s,1));
 });
});
test('REC-11 unknown hold or incomplete source hash chain never creates reconciliation',async()=>{
 const pool=poolFor();
 try{
  const h=harness(scope(11715),pool);
  const r=await h.gate().reconcile(h.input());safe(r);
  assert.equal(r.reason_code,'RECONCILE_HOLD_UNVERIFIED');
  assert.equal(await h.auditLedger.head(h.s),null);
 }finally{await pool.end();}
 await using(11716,2,async h=>{
  await h.pool.query(
   'UPDATE v106_test.fixture_review_hold_heads SET event_digest=$1 WHERE incident_id=$2',
   ['f'.repeat(64),h.s.incident_id]);
  const r=await h.gate().reconcile(h.input());safe(r);
  assert.equal(r.reason_code,'RECONCILE_HOLD_HEAD_INVALID');
  assert.equal(await h.auditLedger.head(h.s),null);
 });
});
test('REC-12 SQL fault before commit rolls back both reconciliation event and head',async()=>{
 await using(11717,1,async h=>{
  const broken=createIsolatedPostgresDeliveryReconciliation({
   pool:h.pool,beforeCommit:async()=>{throw Error('synthetic-precommit-crash');}});
  const r=await h.gate({auditLedger:broken}).reconcile(h.input());safe(r);
  assert.equal(r.reason_code,'RECONCILE_DEPENDENCY_UNAVAILABLE');
  assert.equal(await h.auditLedger.head(h.s),null);
  assert.equal(await h.auditLedger.event(h.s,1),null);
 });
});
test('REC-13 SQL COMMIT with lost ack retains negative audit; no claimed delivery',async()=>{
 await using(11718,1,async h=>{
  const r=await h.gate({afterCommit:async()=>{
   throw Error('commit-acknowledgement-lost');
  }}).reconcile(h.input());safe(r);
  assert.equal(r.reason_code,'RECONCILE_DEPENDENCY_UNAVAILABLE');
  assert.equal((await h.auditLedger.head(h.s)).sequence,1);
  assert.equal((await h.gate().inspect(h.input())).hold_active,true);
 });
});
test('REC-14 negative receipt arriving after audit COMMIT invalidates old snapshot currentness',async()=>{
 await using(11719,1,async h=>{
  await h.addMessage();
  const r=await h.gate({afterCommit:async()=>h.addReceipt()})
   .reconcile(h.input());safe(r);
  assert.equal(r.reason_code,'BLOCKED_RECONCILIATION_SNAPSHOT_CHANGED');
  assert.equal(r.fixture_reconciliation_recorded,true);
  assert.equal((await h.auditLedger.head(h.s)).sequence,1);
 });
});
test('REC-15 simultaneous independent SQL writers cannot append same reconciliation cause twice',async()=>{
 await using(11720,1,async h=>{
  const pool=poolFor();
  try{
   const second=createIsolatedPostgresDeliveryReconciliation({pool});
   const [a,b]=await Promise.all([
    h.gate().reconcile(h.input()),
    h.gate({auditLedger:second}).reconcile(h.input())
   ]);
   safe(a);safe(b);
   assert.equal([a,b].filter(x=>x.fixture_reconciliation_recorded).length,1);
   assert.equal([a,b].filter(x=>x.reason_code===
    'RECONCILE_REPLAY_CONFLICT_OR_STALE_SNAPSHOT').length,1);
   assert.equal((await h.auditLedger.head(h.s)).sequence,1);
  }finally{await pool.end();}
 });
});
test('REC-16 tenant B writer cannot persist reconciliation under organization A scope',async()=>{
 await using(11721,1,async h=>{
  const pool=poolFor('v106_writer_b');
  try{
   const wrong=createIsolatedPostgresDeliveryReconciliation({pool});
   const r=await h.gate({auditLedger:wrong}).reconcile(h.input());safe(r);
   assert.equal(r.fixture_reconciliation_recorded,false);
   assert.equal(await h.auditLedger.head(h.s),null);
  }finally{await pool.end();}
 });
});
test('REC-17 restricted role cannot rewrite append-only audit, payment or hold_active status',async()=>{
 await using(11722,1,async h=>{
  assert.equal((await h.gate().reconcile(h.input())).fixture_reconciliation_recorded,true);
  await assert.rejects(h.pool.query(
   'UPDATE v106_test.fixture_delivery_reconciliation_events SET event_digest=$1 WHERE incident_id=$2',
   ['f'.repeat(64),h.s.incident_id]),/permission denied/i);
  await assert.rejects(h.pool.query(
   'DELETE FROM v106_test.fixture_delivery_reconciliation_events WHERE incident_id=$1',
   [h.s.incident_id]),/permission denied/i);
  await assert.rejects(h.pool.query(
   'UPDATE v106_test.fixture_delivery_reconciliation_heads SET hold_active=false WHERE incident_id=$1',
   [h.s.incident_id]),/permission denied|check constraint/i);
  await assert.rejects(h.pool.query(
   'UPDATE v106_test.protected_business_fixture SET example_payment_amount=0'),
   /permission denied/i);
 });
});
test('REC-18 head digest tampering blocks further append and any positive outcome',async()=>{
 await using(11723,1,async h=>{
  assert.equal((await h.gate().reconcile(h.input())).fixture_reconciliation_recorded,true);
  await h.pool.query(
   'UPDATE v106_test.fixture_delivery_reconciliation_heads SET event_digest=$1 WHERE incident_id=$2',
   ['f'.repeat(64),h.s.incident_id]);
  h.setDisposition('revoked');
  const r=await h.gate().reconcile(h.input());safe(r);
  assert.equal(r.reason_code,'RECONCILE_AUDIT_PREVIOUS_EVENT_INVALID');
  assert.equal((await h.gate().inspect(h.input())).hold_active,true);
 });
});
test('REC-19 caller-injected release, approval or malformed scope is rejected',async()=>{
 await using(11724,1,async h=>{
  for(const input of [
   {...h.input(),hold_active:false},
   {...h.input(),handoff_allowed:true},
   {...h.input(),student_id:'bad'},
   {...h.input(),hold_sequence:0}
  ]){
   const r=await h.gate().reconcile(input);safe(r);
   assert.equal(r.reason_code,'RECONCILE_SCOPE_INVALID');
  }
  assert.equal((await h.gate().inspect(h.input())).reason_code,
   'BLOCKED_NO_RECONCILIATION_HISTORY');
  assert.throws(()=>createIsolatedHoldDeliveryReconciliation({}),TypeError);
 });
});
test('REC-20 source revision changes can create a new advisory but not grant approval',async()=>{
 await using(11725,1,async h=>{
  const a=await h.gate().reconcile(h.input());safe(a);
  h.bumpRevision();
  const b=await h.gate().reconcile(h.input());safe(b);
  assert.equal(b.audit_sequence,2);
  assert.equal(b.classification,'OUTBOX_GAP');
  assert.equal(b.finance_authorized,false);
  assert.equal((await h.auditLedger.head(h.s)).sequence,2);
 });
});
