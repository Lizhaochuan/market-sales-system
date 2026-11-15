import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import pg from 'pg';
import {createIsolatedIncidentGapAudit,verifyIsolatedIncidentGapExport} from '../../src/cross-module-incident-gap-manifest.mjs';
import {createIsolatedPostgresIncidentGapManifest} from '../helpers/v3-2-119-m02-postgres-incident-gap-manifest.mjs';
import {createIsolatedPostgresHoldGapScan} from '../helpers/v3-2-118-m02-postgres-hold-gap-scan.mjs';
import {createIsolatedPostgresReviewHoldLedger} from '../helpers/v3-2-115-m02-postgres-review-hold.mjs';
import {createIsolatedPostgresHoldOutbox} from '../helpers/v3-2-116-m02-postgres-hold-outbox.mjs';

if(process.env.V106_ISOLATED_PG!=='YES_TEST_ONLY')
 throw Error('V119 incident export tests require disposable v106_isolated');
const {Pool}=pg,ORG='11111111-1111-4111-8111-111111111111',
 OTHER_ORG='22222222-2222-4222-8222-222222222222';
const ZERO='0'.repeat(64);
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const scope=n=>({organization_id:ORG,incident_id:
 '88888888-8888-4888-8888-'+String(n).padStart(12,'0')});
const student=i=>'99999999-9999-4999-8999-'+String(i).padStart(12,'0');
const poolFor=(role='v106_writer_a')=>new Pool({
 host:'127.0.0.1',port:5432,database:'v106_isolated',user:role,
 password:role==='v106_writer_a'?'ephemeral-v106-A-only':'ephemeral-v106-B-only',
 max:5,connectionTimeoutMillis:3000
});
const safe=r=>{
 assert.equal(Object.isFrozen(r),true);
 assert.equal(r.hold_active,true);
 for(const name of ['external_authority_verified','external_source_verified',
  'external_recipient_verified','finance_authorized','academic_authorized',
  'handoff_allowed','compensation_write_allowed','release_eligible',
  'production_integration_allowed','merge_authorized','deploy_authorized'])
  assert.equal(r[name],false,name);
};
function fixture(incident,pool){
 const auditLedger=createIsolatedPostgresIncidentGapManifest({pool});
 const studentScan=createIsolatedPostgresHoldGapScan({pool});
 const holdLedger=createIsolatedPostgresReviewHoldLedger({pool});
 const outbox=createIsolatedPostgresHoldOutbox({pool});
 let clock=1000000;
 const gate=(opts={})=>createIsolatedIncidentGapAudit({
  ledger:auditLedger,getFixtureNow:()=>clock,...opts});
 const full=i=>({...incident,student_id:student(i)});
 async function addStudent(i){
  const s=full(i),body={schema_version:'v3.2-115-ci-invalidation-hold-v1',
   scope:s,sequence:1,previous_event_digest:ZERO,
   assignment_digest:'a'.repeat(64),intake_head_digest:'b'.repeat(64),
   lifecycle_head_digest:ZERO,reviewer_id:'reviewer-fixture-001',
   trigger_kind:'REVIEWER_REVOKED',source_signal_digest:'d'.repeat(64),
   cause_digest:sha({scope:s,studentFixture:true}),
   status:'HOLD_PENDING_EXTERNAL_AUTHORITY',recorded_at_ms:1000000};
  const digest=sha(body);
  await pool.query(
   'INSERT INTO v106_test.fixture_review_hold_events (organization_id,incident_id,student_id,sequence,cause_digest,event_payload,event_digest) VALUES($1,$2,$3,1,$4,$5,$6)',
   [s.organization_id,s.incident_id,s.student_id,body.cause_digest,
    JSON.stringify(body),digest]);
  await pool.query(
   'INSERT INTO v106_test.fixture_review_hold_heads(organization_id,incident_id,student_id,sequence,event_digest,hold_active) VALUES($1,$2,$3,1,$4,true)',
   [s.organization_id,s.incident_id,s.student_id,digest]);
  return s;
 }
 async function message(i){
  const s=full(i),hold=await holdLedger.event(s,1);
  const proof='c'.repeat(64);
  const digest=sha({schema_version:'v3.2-116-ci-hold-message-v1',
   scope:s,hold_sequence:1,hold_event_digest:sha(hold),
   source_proof_digest:proof,disposition:'blocked'});
  const m={schema_version:'v3.2-116-ci-outbox-message-v1',
   scope:s,hold_sequence:1,hold_event_digest:sha(hold),
   source_proof_digest:proof,message_digest:digest,
   message_kind:'hold_invalidation',
   status:'PENDING_NEGATIVE_FIXTURE_RECEIPT',created_at_ms:1000000};
  const r=await outbox.enqueue(s,m);
  assert.equal(r.accepted,true,JSON.stringify(r));
 }
 async function receipt(i){
  const s=full(i),m=await outbox.message(s,1);
  assert.ok(m);
  const r={schema_version:'v3.2-116-ci-delivery-receipt-v1',
   scope:s,hold_sequence:1,message_digest:m.message_digest,
   recipient_id:'fixture-negative-receiver-001',
   signed_receipt_digest:'d'.repeat(64),
   status:'NEGATIVE_FIXTURE_RECEIPT_ONLY',recorded_at_ms:clock};
  const ans=await outbox.confirm(s,r);
  assert.equal(ans.accepted,true,JSON.stringify(ans));
 }
 async function scan(i){
  const s=full(i),r=await studentScan.scan(s,clock,60000);
  assert.equal(r.accepted,true,JSON.stringify(r));
 }
 const parse=async()=>{
  const r=await gate().exportLatest(incident);safe(r);
  assert.equal(r.reason_code,'BLOCKED_INCIDENT_MANIFEST_EXPORT_READY');
  const obj=JSON.parse(r.fixture_export_json);
  assert.equal(verifyIsolatedIncidentGapExport(obj),true);
  return obj;
 };
 return {scope:incident,pool,auditLedger,studentScan,holdLedger,
  outbox,gate,full,addStudent,message,receipt,scan,parse,
  clock:t=>{clock=t;}};
}
async function using(n,ids,fn){
 const pool=poolFor();
 try{
  const f=fixture(scope(n),pool);
  for(const i of ids)await f.addStudent(i);
  return await fn(f);
 }finally{await pool.end();}
}
test('MAN-01 aggregate finds every HOLD student from DB, no caller student list',async()=>{
 await using(11901,[11,12],async f=>{
  const r=await f.gate().aggregate(f.scope);safe(r);
  assert.equal(r.fixture_incident_manifest_recorded,true);
  assert.equal(r.student_count,2);
  assert.equal(r.hold_event_count,2);
  assert.equal(r.unresolved_gap_count,2);
  assert.equal(r.unscanned_student_count,2);
  assert.equal(r.coverage_status,'INCOMPLETE_FIXTURE_SCAN_COVERAGE');
  const m=(await f.parse()).manifest;
  assert.deepEqual(m.students.map(x=>x.student_id),[student(11),student(12)]);
  assert.deepEqual(m.students.map(x=>x.scan_status),
   ['UNSCANNED_HOLD_STUDENT','UNSCANNED_HOLD_STUDENT']);
 });
});
test('MAN-02 current scan for one student never hides another unscanned HOLD student',async()=>{
 await using(11902,[11,12],async f=>{
  await f.scan(12);
  const r=await f.gate().aggregate(f.scope);safe(r);
  assert.equal(r.unscanned_student_count,1);
  assert.equal(r.unresolved_gap_count,2);
  const st=(await f.parse()).manifest.students;
  assert.deepEqual(st.map(x=>x.scan_status),
   ['UNSCANNED_HOLD_STUDENT','CURRENT_TEST_SCAN']);
 });
});
test('MAN-03 source message after V118 scan marks student scan stale',async()=>{
 await using(11903,[11,12],async f=>{
  await f.scan(11);await f.scan(12);
  await f.message(11);
  const r=await f.gate().aggregate(f.scope);safe(r);
  assert.equal(r.stale_student_count,1);
  assert.equal(r.unscanned_student_count,0);
  assert.equal((await f.parse()).manifest.students[0].scan_status,'STALE_TEST_SCAN');
  assert.equal((await f.parse()).manifest.students[0].gaps[0].reason_code,
   'NEGATIVE_RECEIPT_PENDING');
 });
});
test('MAN-04 fully scanned fixture outbox and negative receipts still cannot authorize handoff',async()=>{
 await using(11904,[11,12],async f=>{
  for(const id of [11,12]){
   await f.message(id);await f.receipt(id);await f.scan(id);
  }
  const r=await f.gate().aggregate(f.scope);safe(r);
  assert.equal(r.unresolved_gap_count,0);
  assert.equal(r.stale_student_count,0);
  assert.equal(r.unscanned_student_count,0);
  assert.equal(r.handoff_allowed,false);
  const m=(await f.parse()).manifest;
  assert.equal(m.coverage_status,'CURRENT_FIXTURE_SCANS_STILL_NOT_REAL_APPROVAL');
 });
});
test('MAN-05 fully received student B cannot mask student A early outbox gap',async()=>{
 await using(11905,[11,12],async f=>{
  await f.message(12);await f.receipt(12);
  for(const id of [11,12])await f.scan(id);
  const m=(await f.gate().aggregate(f.scope));safe(m);
  assert.equal(m.unresolved_gap_count,1);
  const rows=(await f.parse()).manifest.students;
  assert.equal(rows[0].gaps[0].reason_code,'OUTBOX_MISSING');
  assert.equal(rows[1].gaps.length,0);
 });
});
test('MAN-06 export reproducible, SHA256 binds audit event and all student rows',async()=>{
 await using(11906,[11,12],async f=>{
  await f.scan(11);
  const r=await f.gate().aggregate(f.scope);safe(r);
  const a=await f.gate().exportLatest(f.scope);
  const b=await f.gate().exportLatest(f.scope);
  assert.equal(a.fixture_export_json,b.fixture_export_json);
  const obj=JSON.parse(a.fixture_export_json);
  assert.equal(verifyIsolatedIncidentGapExport(obj),true);
  assert.equal(obj.audit_event.manifest_digest,sha(obj.manifest));
  assert.equal(obj.audit_event_sha256,sha(obj.audit_event));
  assert.equal(obj.manifest.student_count,2);
 });
});
test('MAN-07 modified student, gap, summary or audit bytes invalidate exported checksum',async()=>{
 await using(11907,[11,12],async f=>{
  await f.gate().aggregate(f.scope);
  const e=await f.parse();
  const edits=[
   o=>{o.manifest.students[0].student_id=student(99);},
   o=>{o.manifest.students[0].gaps[0].reason_code='SAFE_RELEASE';},
   o=>{o.manifest.unresolved_gap_count=0;},
   o=>{o.audit_event.student_count=0;},
   o=>{o.audit_event_sha256='f'.repeat(64);}
  ];
  for(const mutate of edits){
   const obj=structuredClone(e);mutate(obj);
   assert.equal(verifyIsolatedIncidentGapExport(obj),false);
  }
 });
});
test('MAN-08 identical incident snapshot cannot append duplicate audit event',async()=>{
 await using(11908,[11,12],async f=>{
  assert.equal((await f.gate().aggregate(f.scope)).fixture_incident_manifest_recorded,true);
  const second=await f.gate().aggregate(f.scope);safe(second);
  assert.equal(second.reason_code,'INCIDENT_MANIFEST_SQL_REPLAY_OR_UNCERTAIN');
  assert.equal((await f.auditLedger.head(f.scope)).sequence,1);
 });
});
test('MAN-09 new HOLD student after an earlier export produces a new immutable manifest',async()=>{
 await using(11909,[11],async f=>{
  const old=await f.gate().aggregate(f.scope);safe(old);
  await f.addStudent(12);
  const next=await f.gate().aggregate(f.scope);safe(next);
  assert.equal(next.student_count,2);
  assert.equal(next.audit_sequence,2);
  const earlier=await f.auditLedger.event(f.scope,1);
  const later=await f.auditLedger.event(f.scope,2);
  assert.equal(later.previous_event_digest,sha(earlier));
  assert.equal(earlier.student_count,1);
 });
});
test('MAN-10 exceeding bounded eight-student coverage fails, never silently truncates',async()=>{
 await using(11910,[1,2,3,4,5,6,7,8,9],async f=>{
  const r=await f.gate().aggregate(f.scope);safe(r);
  assert.equal(r.reason_code,'INCIDENT_MANIFEST_COVERAGE_LIMIT_EXCEEDED');
  assert.equal(await f.auditLedger.head(f.scope),null);
 });
});
test('MAN-11 incident with no HOLD students cannot be treated as fully covered',async()=>{
 const pool=poolFor();
 try{
  const f=fixture(scope(11911),pool);
  const r=await f.gate().aggregate(f.scope);safe(r);
  assert.equal(r.reason_code,'INCIDENT_MANIFEST_NO_HOLD_STUDENTS');
  assert.equal((await f.gate().exportLatest(f.scope)).reason_code,
   'BLOCKED_NO_INCIDENT_MANIFEST');
 }finally{await pool.end();}
});
test('MAN-12 injected SQL fault before COMMIT rolls back event and head',async()=>{
 await using(11912,[11],async f=>{
  const bad=createIsolatedPostgresIncidentGapManifest({pool:f.pool,
   beforeCommit:async()=>{throw Error('fixture-v119-precommit-failure');}});
  const r=await f.gate({ledger:bad}).aggregate(f.scope);safe(r);
  assert.equal(r.reason_code,'INCIDENT_MANIFEST_DEPENDENCY_UNAVAILABLE');
  assert.equal(await f.auditLedger.head(f.scope),null);
 });
});
test('MAN-13 lost local acknowledgement after COMMIT retains immutable export',async()=>{
 await using(11913,[11],async f=>{
  const r=await f.gate({afterCommit:async()=>{
   throw Error('fixture-network-ack-lost');
  }}).aggregate(f.scope);safe(r);
  assert.equal(r.reason_code,'INCIDENT_MANIFEST_DEPENDENCY_UNAVAILABLE');
  assert.equal((await f.auditLedger.head(f.scope)).sequence,1);
  assert.equal(verifyIsolatedIncidentGapExport(await f.parse()),true);
 });
});
test('MAN-14 new HOLD student after audit COMMIT invalidates current coverage assertion',async()=>{
 await using(11914,[11],async f=>{
  const r=await f.gate({afterCommit:async()=>f.addStudent(12)})
   .aggregate(f.scope);safe(r);
  assert.equal(r.reason_code,'BLOCKED_INCIDENT_SOURCE_CHANGED_AFTER_COMMIT');
  assert.equal(r.fixture_incident_manifest_recorded,true);
  assert.equal((await f.auditLedger.event(f.scope,1)).student_count,1);
 });
});
test('MAN-15 competing SQL instances cannot both commit the same incident export',async()=>{
 await using(11915,[11,12],async f=>{
  const p=poolFor();
  try{
   const other=createIsolatedPostgresIncidentGapManifest({pool:p});
   const [a,b]=await Promise.all([
    f.gate().aggregate(f.scope),
    f.gate({ledger:other}).aggregate(f.scope)
   ]);safe(a);safe(b);
   assert.equal([a,b].filter(x=>x.fixture_incident_manifest_recorded).length,1);
   assert.equal([a,b].filter(x=>x.reason_code===
    'INCIDENT_MANIFEST_SQL_REPLAY_OR_UNCERTAIN').length,1);
   assert.equal((await f.auditLedger.head(f.scope)).sequence,1);
  }finally{await p.end();}
 });
});
test('MAN-16 tenant B restricted SQL role cannot enumerate or export tenant A students',async()=>{
 await using(11916,[11,12],async f=>{
  const p=poolFor('v106_writer_b');
  try{
   const bad=createIsolatedPostgresIncidentGapManifest({pool:p});
   const r=await f.gate({ledger:bad}).aggregate(f.scope);safe(r);
   assert.equal(r.fixture_incident_manifest_recorded,false);
   assert.equal(r.reason_code,'INCIDENT_MANIFEST_NO_HOLD_STUDENTS');
   assert.equal(await f.auditLedger.head(f.scope),null);
  }finally{await p.end();}
 });
});
test('MAN-17 tampered V118 student scan event blocks incident-level proof',async()=>{
 await using(11917,[11,12],async f=>{
  await f.scan(11);
  await f.pool.query(
   'UPDATE v106_test.fixture_hold_gap_scan_heads SET event_digest=$1 WHERE organization_id=$2 AND incident_id=$3 AND student_id=$4',
   ['f'.repeat(64),ORG,f.scope.incident_id,student(11)]);
  const r=await f.gate().aggregate(f.scope);safe(r);
  assert.equal(r.reason_code,'INCIDENT_MANIFEST_STUDENT_AUDIT_UNVERIFIED');
  assert.equal(await f.auditLedger.head(f.scope),null);
 });
});
test('MAN-18 restricted SQL writer cannot overwrite export history, rewind or release',async()=>{
 await using(11918,[11],async f=>{
  await f.gate().aggregate(f.scope);
  await assert.rejects(f.pool.query(
   'UPDATE v106_test.fixture_incident_gap_manifest_events SET event_digest=$1 WHERE incident_id=$2',
   ['f'.repeat(64),f.scope.incident_id]),/permission denied/i);
  await assert.rejects(f.pool.query(
   'DELETE FROM v106_test.fixture_incident_gap_manifest_events WHERE incident_id=$1',
   [f.scope.incident_id]),/permission denied/i);
  await assert.rejects(f.pool.query(
   'UPDATE v106_test.fixture_incident_gap_manifest_heads SET hold_active=false WHERE incident_id=$1',
   [f.scope.incident_id]),/permission denied|check constraint/i);
  await assert.rejects(f.pool.query(
   'UPDATE v106_test.fixture_incident_gap_manifest_heads SET student_count=0 WHERE incident_id=$1',
   [f.scope.incident_id]),/rewind or release forbidden/i);
  await assert.rejects(f.pool.query(
   'UPDATE v106_test.protected_business_fixture SET example_payment_amount=0'),
   /permission denied/i);
 });
});
test('MAN-19 malformed or caller-controlled release scope rejected before SQL write',async()=>{
 await using(11919,[11],async f=>{
  for(const bad of [
   {...f.scope,hold_active:false},
   {...f.scope,student_id:student(11)},
   {...f.scope,finance_authorized:true},
   {...f.scope,incident_id:'invalid'}
  ]){
   const r=await f.gate().aggregate(bad);safe(r);
   assert.equal(r.reason_code,'INCIDENT_MANIFEST_SCOPE_INVALID');
  }
  assert.equal(await f.auditLedger.head(f.scope),null);
  assert.equal(f.gate().release,undefined);
  assert.throws(()=>createIsolatedIncidentGapAudit({}),TypeError);
 });
});
test('MAN-20 aging pending receipt makes prior V118 scan stale, never marks student covered',async()=>{
 await using(11920,[11],async f=>{
  await f.message(11);await f.scan(11);
  f.clock(1060000);
  const r=await f.gate().aggregate(f.scope);safe(r);
  assert.equal(r.stale_student_count,1);
  assert.equal((await f.parse()).manifest.students[0].gaps[0].reason_code,
   'NEGATIVE_RECEIPT_OVERDUE');
  assert.equal(r.hold_active,true);
 });
});
