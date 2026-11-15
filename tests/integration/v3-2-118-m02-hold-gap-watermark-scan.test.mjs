import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import pg from 'pg';
import {createIsolatedHoldGapScanner} from '../../src/cross-module-hold-gap-watermark-scan.mjs';
import {createIsolatedPostgresHoldGapScan} from '../helpers/v3-2-118-m02-postgres-hold-gap-scan.mjs';
import {createIsolatedPostgresReviewHoldLedger} from '../helpers/v3-2-115-m02-postgres-review-hold.mjs';
import {createIsolatedPostgresHoldOutbox} from '../helpers/v3-2-116-m02-postgres-hold-outbox.mjs';
if(process.env.V106_ISOLATED_PG!=='YES_TEST_ONLY')
 throw Error('V118 tests require disposable PostgreSQL and explicit CI guard');
const {Pool}=pg,org='11111111-1111-4111-8111-111111111111',
 student='99999999-9999-4999-8999-999999999999';
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
function holdRecord(s,i,previous){
 return {schema_version:'v3.2-115-ci-invalidation-hold-v1',
  scope:s,sequence:i,previous_event_digest:previous,
  assignment_digest:'a'.repeat(64),intake_head_digest:'b'.repeat(64),
  lifecycle_head_digest:ZERO,reviewer_id:'reviewer-fixture-001',
  trigger_kind:i===1?'REVIEWER_REVOKED':'EVIDENCE_UPDATED',
  source_signal_digest:'d'.repeat(64),
  cause_digest:sha({scope:s,hold_sequence:i,fixture:true}),
  status:'HOLD_PENDING_EXTERNAL_AUTHORITY',recorded_at_ms:1000000+i};
}
async function appendHold(pool,s,i){
 const prior=i===1?ZERO:(await pool.query(
  'SELECT event_digest FROM v106_test.fixture_review_hold_events WHERE organization_id=$1 AND incident_id=$2 AND student_id=$3 AND sequence=$4',
  [s.organization_id,s.incident_id,s.student_id,i-1])).rows[0].event_digest.trim();
 const obj=holdRecord(s,i,prior),digest=sha(obj);
 await pool.query(
  'INSERT INTO v106_test.fixture_review_hold_events (organization_id,incident_id,student_id,sequence,cause_digest,event_payload,event_digest) VALUES($1,$2,$3,$4,$5,$6,$7)',
  [s.organization_id,s.incident_id,s.student_id,i,obj.cause_digest,JSON.stringify(obj),digest]);
 if(i===1)await pool.query(
  'INSERT INTO v106_test.fixture_review_hold_heads (organization_id,incident_id,student_id,sequence,event_digest,hold_active) VALUES($1,$2,$3,$4,$5,true)',
  [s.organization_id,s.incident_id,s.student_id,i,digest]);
 else await pool.query(
  'UPDATE v106_test.fixture_review_hold_heads SET sequence=$1,event_digest=$2 WHERE organization_id=$3 AND incident_id=$4 AND student_id=$5',
  [i,digest,s.organization_id,s.incident_id,s.student_id]);
 return obj;
}
function harness(s,pool){
 const holds=createIsolatedPostgresReviewHoldLedger({pool});
 const outbox=createIsolatedPostgresHoldOutbox({pool});
 const ledger=createIsolatedPostgresHoldGapScan({pool});
 let nowMs=1000000;
 const gate=(opts={})=>createIsolatedHoldGapScanner({
  ledger,getFixtureNow:()=>nowMs,receiptOverdueMs:60000,...opts});
 async function addMessage(seq,raw=false,corruptDigest=false){
  const event=await holds.event(s,seq);
  assert.ok(event);
  const source_proof_digest='c'.repeat(64),hold_event_digest=sha(event);
  const message_digest=corruptDigest?'f'.repeat(64):sha({
   schema_version:'v3.2-116-ci-hold-message-v1',scope:s,
   hold_sequence:seq,hold_event_digest,source_proof_digest,
   disposition:'blocked'});
  const record={schema_version:'v3.2-116-ci-outbox-message-v1',
   scope:s,hold_sequence:seq,hold_event_digest,source_proof_digest,
   message_digest,message_kind:'hold_invalidation',
   status:'PENDING_NEGATIVE_FIXTURE_RECEIPT',created_at_ms:1000000};
  if(raw)await pool.query(
   'INSERT INTO v106_test.fixture_hold_outbox (organization_id,incident_id,student_id,hold_sequence,hold_event_digest,message_digest,payload,payload_digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
   [s.organization_id,s.incident_id,s.student_id,seq,hold_event_digest,
    message_digest,JSON.stringify(record),sha(record)]);
  else{
   const r=await outbox.enqueue(s,record);
   assert.equal(r.accepted,true,JSON.stringify(r));
  }
  return record;
 }
 async function addReceipt(seq,raw=false){
  const m=await outbox.message(s,seq);
  assert.ok(m);
  const record={schema_version:'v3.2-116-ci-delivery-receipt-v1',
   scope:s,hold_sequence:seq,message_digest:m.message_digest,
   recipient_id:'fixture-negative-receiver-001',
   signed_receipt_digest:'d'.repeat(64),
   status:'NEGATIVE_FIXTURE_RECEIPT_ONLY',recorded_at_ms:1000000};
  if(raw)await pool.query(
   'INSERT INTO v106_test.fixture_hold_outbox_negative_receipts (organization_id,incident_id,student_id,hold_sequence,message_digest,receipt_digest,payload) VALUES($1,$2,$3,$4,$5,$6,$7)',
   [s.organization_id,s.incident_id,s.student_id,seq,m.message_digest,
    sha(record),JSON.stringify(record)]);
  else{
   const r=await outbox.confirm(s,record);
   assert.equal(r.accepted,true,JSON.stringify(r));
  }
  return record;
 }
 return {s,pool,holds,outbox,ledger,gate,addMessage,addReceipt,
  appendHold:seq=>appendHold(pool,s,seq),
  setTime:t=>{nowMs=t;}};
}
async function using(n,count,fn){
 const p=poolFor();
 try{
  const s=scope(n),h=harness(s,p);
  for(let seq=1;seq<=count;seq++)await h.appendHold(seq);
  return await fn(h);
 }finally{await p.end();}
}
test('GAP-01 one missing outbox is visible, prefixes zero and HOLD never releases',async()=>{
 await using(11801,1,async h=>{
  const r=await h.gate().scan(h.s);safe(r);
  assert.equal(r.reason_code,'BLOCKED_FIXTURE_GAP_SCAN_RECORDED');
  assert.equal(r.fixture_gap_scan_recorded,true);
  assert.equal(r.checked_through,1);
  assert.equal(r.outbox_prefix,0);
  assert.equal(r.negative_receipt_prefix,0);
  assert.deepEqual(r.unresolved_gaps.map(x=>x.reason_code),['OUTBOX_MISSING']);
  assert.equal((await h.ledger.event(h.s,1)).status,'HOLD_ACTIVE_GAP_AUDIT_ONLY');
 });
});
test('GAP-02 later complete seq2 cannot conceal missing seq1 outbox',async()=>{
 await using(11802,2,async h=>{
  // Direct restricted test-role INSERT bypasses V116 sequential API:
  // scanner still must find the older hole and prefix must remain zero.
  await h.addMessage(2,true);await h.addReceipt(2,true);
  const r=await h.gate().scan(h.s);safe(r);
  assert.equal(r.checked_through,2);
  assert.equal(r.outbox_prefix,0);
  assert.equal(r.negative_receipt_prefix,0);
  assert.deepEqual(r.unresolved_gaps.map(x=>x.hold_sequence),[1]);
  assert.equal(r.unresolved_gaps[0].reason_code,'OUTBOX_MISSING');
 });
});
test('GAP-03 later seq2 negative ack cannot conceal missing seq1 negative ack',async()=>{
 await using(11803,2,async h=>{
  await h.addMessage(1);await h.addMessage(2);
  await h.addReceipt(2,true);
  const r=await h.gate().scan(h.s);safe(r);
  assert.equal(r.outbox_prefix,2);
  assert.equal(r.negative_receipt_prefix,0);
  assert.deepEqual(r.unresolved_gaps.map(x=>x.hold_sequence),[1]);
  assert.equal(r.unresolved_gaps[0].reason_code,'NEGATIVE_RECEIPT_PENDING');
 });
});
test('GAP-04 prefix watermarks advance monotonically as original gaps close',async()=>{
 await using(11804,1,async h=>{
  let r=await h.gate().scan(h.s);safe(r);
  assert.deepEqual([r.outbox_prefix,r.negative_receipt_prefix],[0,0]);
  await h.addMessage(1);
  r=await h.gate().scan(h.s);safe(r);
  assert.deepEqual([r.outbox_prefix,r.negative_receipt_prefix],[1,0]);
  await h.addReceipt(1);
  r=await h.gate().scan(h.s);safe(r);
  assert.deepEqual([r.outbox_prefix,r.negative_receipt_prefix],[1,1]);
  assert.equal(r.unresolved_gaps.length,0);
  assert.equal((await h.ledger.head(h.s)).sequence,3);
  const old=await h.ledger.event(h.s,1);
  assert.equal(old.gaps[0].reason_code,'OUTBOX_MISSING');
 });
});
test('GAP-05 no negative receipt before threshold is pending, not overdue',async()=>{
 await using(11805,1,async h=>{
  await h.addMessage(1);
  const r=await h.gate().scan(h.s);safe(r);
  assert.equal(r.unresolved_gaps[0].reason_code,'NEGATIVE_RECEIPT_PENDING');
 });
});
test('GAP-06 time crossing threshold produces a second append-only overdue classification',async()=>{
 await using(11806,1,async h=>{
  await h.addMessage(1);
  assert.equal((await h.gate().scan(h.s)).unresolved_gaps[0].reason_code,
   'NEGATIVE_RECEIPT_PENDING');
  h.setTime(1060000);
  const r=await h.gate().scan(h.s);safe(r);
  assert.equal(r.unresolved_gaps[0].reason_code,'NEGATIVE_RECEIPT_OVERDUE');
  assert.equal((await h.ledger.head(h.s)).sequence,2);
  assert.equal((await h.ledger.event(h.s,1)).gaps[0].reason_code,
   'NEGATIVE_RECEIPT_PENDING');
 });
});
test('GAP-07 growing HOLD history cannot lower checked-through or prefix watermark',async()=>{
 await using(11807,1,async h=>{
  await h.addMessage(1);await h.addReceipt(1);
  const first=await h.gate().scan(h.s);safe(first);
  assert.deepEqual([first.checked_through,first.negative_receipt_prefix],[1,1]);
  await h.appendHold(2);
  const second=await h.gate().scan(h.s);safe(second);
  assert.deepEqual([second.checked_through,second.outbox_prefix,
   second.negative_receipt_prefix],[2,1,1]);
  assert.deepEqual(second.unresolved_gaps.map(x=>x.hold_sequence),[2]);
 });
});
test('GAP-08 scanner refuses absent source HOLD and never creates audit',async()=>{
 const p=poolFor();
 try{
  const h=harness(scope(11808),p);
  const r=await h.gate().scan(h.s);safe(r);
  assert.equal(r.reason_code,'GAP_SCAN_SOURCE_HOLD_MISSING');
  assert.equal(await h.ledger.head(h.s),null);
 }finally{await p.end();}
});
test('GAP-09 repeated identical snapshot cannot append a duplicate event',async()=>{
 await using(11809,1,async h=>{
  assert.equal((await h.gate().scan(h.s)).fixture_gap_scan_recorded,true);
  const r=await h.gate().scan(h.s);safe(r);
  assert.equal(r.reason_code,'GAP_SCAN_SQL_REPLAY_CONFLICT_OR_UNCERTAIN');
  assert.equal((await h.ledger.head(h.s)).sequence,1);
 });
});
test('GAP-10 malformed outbox message digest is rejected, not silently treated as complete',async()=>{
 await using(11810,1,async h=>{
  await h.addMessage(1,true,true);
  const r=await h.gate().scan(h.s);safe(r);
  assert.equal(r.reason_code,'GAP_SCAN_OUTBOX_UNVERIFIED');
  assert.equal(await h.ledger.head(h.s),null);
 });
});
test('GAP-11 tampered upstream HOLD head is not accepted as a clean prefix',async()=>{
 await using(11811,2,async h=>{
  await h.pool.query(
   'UPDATE v106_test.fixture_review_hold_heads SET event_digest=$1 WHERE incident_id=$2',
   ['f'.repeat(64),h.s.incident_id]);
  const r=await h.gate().scan(h.s);safe(r);
  assert.equal(r.reason_code,'GAP_SCAN_HOLD_HEAD_UNVERIFIED');
  assert.equal(await h.ledger.head(h.s),null);
 });
});
test('GAP-12 precommit SQL failure rolls back new scan event and head together',async()=>{
 await using(11812,1,async h=>{
  const broken=createIsolatedPostgresHoldGapScan({pool:h.pool,
   beforeCommit:async()=>{throw Error('v118-precommit-failure');}});
  const r=await h.gate({ledger:broken}).scan(h.s);safe(r);
  assert.equal(r.reason_code,'GAP_SCAN_DEPENDENCY_UNAVAILABLE');
  assert.equal(await h.ledger.head(h.s),null);
  assert.equal(await h.ledger.event(h.s,1),null);
 });
});
test('GAP-13 SQL commit with lost response leaves intact historical audit and blocks',async()=>{
 await using(11813,1,async h=>{
  const r=await h.gate({afterCommit:async()=>{
   throw Error('lost-v118-ack');
  }}).scan(h.s);safe(r);
  assert.equal(r.reason_code,'GAP_SCAN_DEPENDENCY_UNAVAILABLE');
  assert.equal((await h.ledger.head(h.s)).sequence,1);
  assert.equal((await h.gate().inspect(h.s)).hold_active,true);
 });
});
test('GAP-14 new outbox arriving after scan commit invalidates current snapshot',async()=>{
 await using(11814,1,async h=>{
  const r=await h.gate({afterCommit:async()=>h.addMessage(1)})
   .scan(h.s);safe(r);
  assert.equal(r.reason_code,'BLOCKED_GAP_SCAN_SNAPSHOT_CHANGED');
  assert.equal(r.fixture_gap_scan_recorded,true);
  assert.equal((await h.ledger.event(h.s,1)).gaps[0].reason_code,'OUTBOX_MISSING');
 });
});
test('GAP-15 two independent SQL writers cannot both commit the same scan evidence',async()=>{
 await using(11815,1,async h=>{
  const p=poolFor();
  try{
   const remote=createIsolatedPostgresHoldGapScan({pool:p});
   const [a,b]=await Promise.all([
    h.gate().scan(h.s),h.gate({ledger:remote}).scan(h.s)]);
   safe(a);safe(b);
   assert.equal([a,b].filter(x=>x.fixture_gap_scan_recorded).length,1);
   assert.equal([a,b].filter(x=>x.reason_code===
    'GAP_SCAN_SQL_REPLAY_CONFLICT_OR_UNCERTAIN').length,1);
   assert.equal((await h.ledger.head(h.s)).sequence,1);
  }finally{await p.end();}
 });
});
test('GAP-16 wrong tenant SQL role cannot read A history or record a fake scan',async()=>{
 await using(11816,1,async h=>{
  const p=poolFor('v106_writer_b');
  try{
   const remote=createIsolatedPostgresHoldGapScan({pool:p});
   const r=await h.gate({ledger:remote}).scan(h.s);safe(r);
   assert.equal(r.fixture_gap_scan_recorded,false);
   assert.equal(await h.ledger.head(h.s),null);
  }finally{await p.end();}
 });
});
test('GAP-17 writer cannot delete historical scans or set HOLD inactive',async()=>{
 await using(11817,1,async h=>{
  assert.equal((await h.gate().scan(h.s)).fixture_gap_scan_recorded,true);
  await assert.rejects(h.pool.query(
   'DELETE FROM v106_test.fixture_hold_gap_scan_events WHERE incident_id=$1',
   [h.s.incident_id]),/permission denied/i);
  await assert.rejects(h.pool.query(
   'UPDATE v106_test.fixture_hold_gap_scan_events SET event_digest=$1 WHERE incident_id=$2',
   ['f'.repeat(64),h.s.incident_id]),/permission denied/i);
  await assert.rejects(h.pool.query(
   'UPDATE v106_test.fixture_hold_gap_scan_heads SET hold_active=false WHERE incident_id=$1',
   [h.s.incident_id]),/permission denied|check constraint/i);
  await assert.rejects(h.pool.query(
   'UPDATE v106_test.protected_business_fixture SET example_payment_amount=0'),
   /permission denied/i);
 });
});
test('GAP-18 PostgreSQL trigger refuses direct watermark rewind and duplicate sequence',async()=>{
 await using(11818,1,async h=>{
  await h.addMessage(1);await h.addReceipt(1);
  const r=await h.gate().scan(h.s);safe(r);
  assert.equal(r.negative_receipt_prefix,1);
  await assert.rejects(h.pool.query(
   'UPDATE v106_test.fixture_hold_gap_scan_heads SET negative_receipt_prefix=0 WHERE incident_id=$1',
   [h.s.incident_id]),/watermark regression forbidden/i);
  await assert.rejects(h.pool.query(
   'UPDATE v106_test.fixture_hold_gap_scan_heads SET sequence=0 WHERE incident_id=$1',
   [h.s.incident_id]),/watermark regression forbidden/i);
  assert.equal((await h.ledger.head(h.s)).negative_receipt_prefix,1);
 });
});
test('GAP-19 unsafe caller fields, missing record and illegal API cannot release',async()=>{
 await using(11819,1,async h=>{
  for(const s of [{...h.s,hold_active:false},
   {...h.s,handoff_allowed:true},{...h.s,student_id:'invalid'}]){
   const r=await h.gate().scan(s);safe(r);
   assert.equal(r.reason_code,'GAP_SCAN_SCOPE_INVALID');
  }
  assert.equal((await h.gate().inspect(h.s)).reason_code,
   'BLOCKED_NO_GAP_SCAN_RECORDED');
  assert.equal(h.gate().release,undefined);
  assert.throws(()=>createIsolatedHoldGapScanner({}),TypeError);
 });
});
test('GAP-20 a fully negative-acknowledged local chain never becomes real approval',async()=>{
 await using(11820,2,async h=>{
  await h.addMessage(1);await h.addMessage(2);
  await h.addReceipt(1);await h.addReceipt(2);
  const r=await h.gate().scan(h.s);safe(r);
  assert.deepEqual([r.checked_through,r.outbox_prefix,
   r.negative_receipt_prefix],[2,2,2]);
  assert.equal(r.unresolved_gaps.length,0);
  assert.equal(r.hold_active,true);
  assert.equal(r.handoff_allowed,false);
  assert.equal((await h.gate().inspect(h.s)).hold_active,true);
  assert.equal((await h.holds.head(h.s)).sequence,2);
 });
});
