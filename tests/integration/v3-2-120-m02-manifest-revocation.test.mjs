import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import pg from 'pg';
import {createIsolatedManifestRevocationAudit,
 classifyIsolatedExportRevision} from '../../src/cross-module-manifest-revocation-audit.mjs';
import {createIsolatedPostgresManifestRevocation} from '../helpers/v3-2-120-m02-postgres-manifest-revocation.mjs';
import {createIsolatedPostgresIncidentGapManifest} from '../helpers/v3-2-119-m02-postgres-incident-gap-manifest.mjs';
import {createIsolatedPostgresHoldGapScan} from '../helpers/v3-2-118-m02-postgres-hold-gap-scan.mjs';
import {createIsolatedPostgresReviewHoldLedger} from '../helpers/v3-2-115-m02-postgres-review-hold.mjs';
import {createIsolatedPostgresHoldOutbox} from '../helpers/v3-2-116-m02-postgres-hold-outbox.mjs';
if(process.env.V106_ISOLATED_PG!=='YES_TEST_ONLY')
 throw Error('V120 requires disposable isolated PostgreSQL');
const {Pool}=pg,ORG='11111111-1111-4111-8111-111111111111',
 OTHER_ORG='22222222-2222-4222-8222-222222222222';
const ZERO='0'.repeat(64);
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const scope=n=>({organization_id:ORG,
 incident_id:'88888888-8888-4888-8888-'+String(n).padStart(12,'0')});
const student=i=>'99999999-9999-4999-8999-'+String(i).padStart(12,'0');
const poolFor=(role='v106_writer_a')=>new Pool({
 host:'127.0.0.1',port:5432,database:'v106_isolated',user:role,
 password:role==='v106_writer_a'?'ephemeral-v106-A-only':'ephemeral-v106-B-only',
 max:5,connectionTimeoutMillis:3000
});
const blocked=x=>{
 assert.equal(Object.isFrozen(x),true);
 assert.equal(x.hold_active,true);
 assert.equal(x.export_valid_for_business,false);
 for(const key of ['external_authority_verified','external_source_verified',
  'external_recipient_verified','finance_authorized','academic_authorized',
  'handoff_allowed','compensation_write_allowed','release_eligible',
  'production_integration_allowed','merge_authorized','deploy_authorized'])
  assert.equal(x[key],false,key);
};
function harness(s,pool){
 const manifestLedger=createIsolatedPostgresIncidentGapManifest({pool});
 const revocationLedger=createIsolatedPostgresManifestRevocation({pool});
 const holdLedger=createIsolatedPostgresReviewHoldLedger({pool});
 const outbox=createIsolatedPostgresHoldOutbox({pool});
 const scanLedger=createIsolatedPostgresHoldGapScan({pool});
 let now=1000000;
 const full=i=>({...s,student_id:student(i)});
 async function addStudent(i){
  const q=full(i);
  const payload={schema_version:'v3.2-115-ci-invalidation-hold-v1',
   scope:q,sequence:1,previous_event_digest:ZERO,
   assignment_digest:'a'.repeat(64),intake_head_digest:'b'.repeat(64),
   lifecycle_head_digest:ZERO,reviewer_id:'reviewer-fixture-001',
   trigger_kind:'REVIEWER_REVOKED',
   source_signal_digest:'d'.repeat(64),
   cause_digest:sha({scope:q,stage:'V120-test'}),
   status:'HOLD_PENDING_EXTERNAL_AUTHORITY',recorded_at_ms:1000000};
  const digest=sha(payload);
  await pool.query(
   'INSERT INTO v106_test.fixture_review_hold_events(organization_id,incident_id,student_id,sequence,cause_digest,event_payload,event_digest) VALUES($1,$2,$3,1,$4,$5,$6)',
   [q.organization_id,q.incident_id,q.student_id,
    payload.cause_digest,JSON.stringify(payload),digest]);
  await pool.query(
   'INSERT INTO v106_test.fixture_review_hold_heads(organization_id,incident_id,student_id,sequence,event_digest,hold_active) VALUES($1,$2,$3,1,$4,true)',
   [q.organization_id,q.incident_id,q.student_id,digest]);
 }
 async function message(i){
  const q=full(i),hold=await holdLedger.event(q,1);
  assert.ok(hold);
  const proof='c'.repeat(64);
  const messageDigest=sha({schema_version:'v3.2-116-ci-hold-message-v1',
   scope:q,hold_sequence:1,hold_event_digest:sha(hold),
   source_proof_digest:proof,disposition:'blocked'});
  const payload={schema_version:'v3.2-116-ci-outbox-message-v1',
   scope:q,hold_sequence:1,hold_event_digest:sha(hold),
   source_proof_digest:proof,message_digest:messageDigest,
   message_kind:'hold_invalidation',
   status:'PENDING_NEGATIVE_FIXTURE_RECEIPT',created_at_ms:1000000};
  const r=await outbox.enqueue(q,payload);
  assert.equal(r.accepted,true,JSON.stringify(r));
 }
 async function receipt(i){
  const q=full(i),m=await outbox.message(q,1);
  assert.ok(m);
  const payload={schema_version:'v3.2-116-ci-delivery-receipt-v1',
   scope:q,hold_sequence:1,message_digest:m.message_digest,
   recipient_id:'fixture-negative-receiver-001',
   signed_receipt_digest:'d'.repeat(64),
   status:'NEGATIVE_FIXTURE_RECEIPT_ONLY',recorded_at_ms:now};
  const r=await outbox.confirm(q,payload);
  assert.equal(r.accepted,true,JSON.stringify(r));
 }
 async function scan(i){
  const r=await scanLedger.scan(full(i),now,60000);
  assert.equal(r.accepted,true,JSON.stringify(r));
 }
 async function exportManifest(){
  const r=await manifestLedger.captureAndAppend(s,now);
  assert.equal(r.accepted,true,JSON.stringify(r));
  return r;
 }
 const gate=(options={})=>createIsolatedManifestRevocationAudit({
  ledger:revocationLedger,getFixtureNow:()=>now,...options});
 const input=(manifest_sequence=1)=>({...s,manifest_sequence});
 return {s,pool,revocationLedger,manifestLedger,holdLedger,outbox,scanLedger,
  gate,input,addStudent,message,receipt,scan,exportManifest,full,
  clock:x=>{now=x;}};
}
async function using(n,students,cb,{baseline=true}={}){
 const pool=poolFor();
 try{
  const f=harness(scope(n),pool);
  for(const id of students)await f.addStudent(id);
  if(baseline)await f.exportManifest();
  return await cb(f);
 }finally{await pool.end();}
}
test('REV-01 identical local V119 source snapshot still DENIED and audit-only',async()=>{
 await using(12001,[11,12],async f=>{
  const r=await f.gate().observe(f.input());blocked(r);
  assert.equal(r.fixture_export_observation_recorded,true);
  assert.equal(r.classification,'CURRENT_FIXTURE_SNAPSHOT_STILL_UNAUTHORIZED');
  assert.equal(r.revocation_recorded,false);
  const h=await f.revocationLedger.head(f.s);
  assert.equal(h.sequence,1);assert.equal(h.revoked_export_count,0);
  assert.equal((await f.revocationLedger.event(f.s,1)).status,
   'HOLD_ACTIVE_EXPORT_REVOCATION_AUDIT_ONLY');
 });
});
test('REV-02 adding a HOLD student after export irreversibly revokes old snapshot',async()=>{
 await using(12002,[11],async f=>{
  await f.addStudent(12);
  const r=await f.gate().observe(f.input());blocked(r);
  assert.equal(r.classification,'REVOKED_SOURCE_CHANGED_AFTER_EXPORT');
  assert.equal(r.revocation_recorded,true);
  assert.equal((await f.revocationLedger.head(f.s)).revoked_export_count,1);
 });
});
test('REV-03 inserting the outbox after export revokes digest without changing student count',async()=>{
 await using(12003,[11],async f=>{
  await f.message(11);
  const r=await f.gate().observe(f.input());blocked(r);
  assert.equal(r.classification,'REVOKED_SOURCE_CHANGED_AFTER_EXPORT');
  assert.equal((await f.revocationLedger.event(f.s,1)).target_manifest_sequence,1);
 });
});
test('REV-04 a late negative receipt makes the older export stale, never positive',async()=>{
 await using(12004,[11],async f=>{
  await f.message(11);await f.receipt(11);
  const r=await f.gate().observe(f.input());blocked(r);
  assert.equal(r.classification,'REVOKED_SOURCE_CHANGED_AFTER_EXPORT');
  assert.equal(r.handoff_allowed,false);
 });
});
test('REV-05 a newer V119 export supersedes the earlier one even after source stabilizes',async()=>{
 await using(12005,[11],async f=>{
  await f.message(11);await f.exportManifest();
  const r=await f.gate().observe(f.input(1));blocked(r);
  assert.equal(r.classification,'REVOKED_SUPERSEDED_BY_LATER_EXPORT');
  assert.equal(r.revocation_recorded,true);
 });
});
test('REV-06 same source observation cannot be replayed as a second audit event',async()=>{
 await using(12006,[11],async f=>{
  const first=await f.gate().observe(f.input());blocked(first);
  const replay=await f.gate().observe(f.input());blocked(replay);
  assert.equal(replay.reason_code,'EXPORT_REVOCATION_REPLAY_OR_UNKNOWN_COMMIT');
  assert.equal((await f.revocationLedger.head(f.s)).sequence,1);
 });
});
test('REV-07 already revoked target remains revoked after another changed source snapshot',async()=>{
 await using(12007,[11],async f=>{
  await f.addStudent(12);
  assert.equal((await f.gate().observe(f.input())).classification,
   'REVOKED_SOURCE_CHANGED_AFTER_EXPORT');
  await f.addStudent(13);
  const r=await f.gate().observe(f.input());blocked(r);
  assert.equal(r.classification,'REVOKED_PREVIOUSLY');
  assert.equal((await f.revocationLedger.head(f.s)).revoked_export_count,1);
  assert.equal((await f.revocationLedger.head(f.s)).sequence,2);
 });
});
test('REV-08 even if source digest equals old digest, prior revocation is irreversible',()=>{
  const digest='a'.repeat(64);
  assert.equal(classifyIsolatedExportRevision({
   target_manifest_sequence:1,latest_manifest_sequence:1,
   target_manifest_digest:digest,target_source_digest:digest,
   latest_manifest_digest:digest,observed_source_digest:digest,
   previously_revoked:true
  }),'REVOKED_PREVIOUSLY');
});
test('REV-09 each distinct revoked V119 export is counted once, not every observation',async()=>{
 await using(12009,[11],async f=>{
  await f.message(11);await f.exportManifest();
  const one=await f.gate().observe(f.input(1));blocked(one);
  assert.equal(one.classification,'REVOKED_SUPERSEDED_BY_LATER_EXPORT');
  await f.addStudent(12);
  const two=await f.gate().observe(f.input(2));blocked(two);
  assert.equal(two.classification,'REVOKED_SOURCE_CHANGED_AFTER_EXPORT');
  assert.equal((await f.revocationLedger.head(f.s)).revoked_export_count,2);
 });
});
test('REV-10 requesting nonexistent future target does not create an audit row',async()=>{
 await using(12010,[11],async f=>{
  const r=await f.gate().observe(f.input(2));blocked(r);
  assert.equal(r.reason_code,'EXPORT_REVOCATION_TARGET_SEQUENCE_ABSENT');
  assert.equal(await f.revocationLedger.head(f.s),null);
 });
});
test('REV-11 missing V119 export is not misreported as valid',async()=>{
 await using(12011,[11],async f=>{
  const r=await f.gate().observe(f.input());blocked(r);
  assert.equal(r.reason_code,'EXPORT_REVOCATION_TARGET_HISTORY_MISSING');
  assert.equal(await f.revocationLedger.head(f.s),null);
 },{baseline:false});
});
test('REV-12 SQL failure before COMMIT rolls back revocation event and head',async()=>{
 await using(12012,[11],async f=>{
  const broken=createIsolatedPostgresManifestRevocation({pool:f.pool,
   beforeCommit:async()=>{throw Error('v120-fixture-precommit');}});
  const r=await f.gate({ledger:broken}).observe(f.input());blocked(r);
  assert.equal(r.reason_code,'EXPORT_REVOCATION_DEPENDENCY_UNAVAILABLE');
  assert.equal(await f.revocationLedger.head(f.s),null);
 });
});
test('REV-13 missing acknowledgement AFTER COMMIT leaves durable audit but no release',async()=>{
 await using(12013,[11],async f=>{
  const r=await f.gate({afterCommit:async()=>{
   throw Error('v120-lost-ack');
  }}).observe(f.input());blocked(r);
  assert.equal(r.reason_code,'EXPORT_REVOCATION_DEPENDENCY_UNAVAILABLE');
  assert.equal((await f.revocationLedger.head(f.s)).sequence,1);
  assert.equal((await f.gate().inspect(f.input())).hold_active,true);
 });
});
test('REV-14 source change immediately after COMMIT detects stale audit observation',async()=>{
 await using(12014,[11],async f=>{
  const r=await f.gate({afterCommit:async()=>{
   await f.addStudent(12);
  }}).observe(f.input());blocked(r);
  assert.equal(r.reason_code,'BLOCKED_EXPORT_OBSERVATION_SOURCE_CHANGED_AFTER_COMMIT');
  assert.equal(r.fixture_export_observation_recorded,true);
  assert.equal((await f.revocationLedger.event(f.s,1)).revocation_recorded,false);
 });
});
test('REV-15 two independent SQL writers cannot both record identical observation',async()=>{
 await using(12015,[11],async f=>{
  const p=poolFor();
  try{
   const other=createIsolatedPostgresManifestRevocation({pool:p});
   const [a,b]=await Promise.all([
    f.gate().observe(f.input()),
    f.gate({ledger:other}).observe(f.input())
   ]);blocked(a);blocked(b);
   assert.equal([a,b].filter(x=>x.fixture_export_observation_recorded).length,1);
   assert.equal([a,b].filter(x=>x.reason_code===
    'EXPORT_REVOCATION_REPLAY_OR_UNKNOWN_COMMIT').length,1);
   assert.equal((await f.revocationLedger.head(f.s)).sequence,1);
  }finally{await p.end();}
 });
});
test('REV-16 tenant B SQL writer sees no tenant A export and cannot append fake proof',async()=>{
 await using(12016,[11],async f=>{
  const p=poolFor('v106_writer_b');
  try{
   const bad=createIsolatedPostgresManifestRevocation({pool:p});
   const r=await f.gate({ledger:bad}).observe(f.input());blocked(r);
   assert.equal(r.reason_code,'EXPORT_REVOCATION_TARGET_HISTORY_MISSING');
   assert.equal(await f.revocationLedger.head(f.s),null);
  }finally{await p.end();}
 });
});
test('REV-17 restricted writer cannot rewrite revocation audit or release HOLD',async()=>{
 await using(12017,[11],async f=>{
  await f.gate().observe(f.input());
  await assert.rejects(f.pool.query(
   'UPDATE v106_test.fixture_manifest_revocation_events SET event_digest=$1 WHERE incident_id=$2',
   ['f'.repeat(64),f.s.incident_id]),/permission denied/i);
  await assert.rejects(f.pool.query(
   'DELETE FROM v106_test.fixture_manifest_revocation_events WHERE incident_id=$1',
   [f.s.incident_id]),/permission denied/i);
  await assert.rejects(f.pool.query(
   'UPDATE v106_test.fixture_manifest_revocation_heads SET hold_active=false WHERE incident_id=$1',
   [f.s.incident_id]),/permission denied|check constraint/i);
  await assert.rejects(f.pool.query(
   'UPDATE v106_test.protected_business_fixture SET example_payment_amount=0'),
   /permission denied/i);
 });
});
test('REV-18 impossible V120 head pointer is rejected by subsequent observation',async()=>{
 await using(12018,[11],async f=>{
  await f.gate().observe(f.input());
  await f.pool.query(
   'UPDATE v106_test.fixture_manifest_revocation_heads SET sequence=sequence+1,event_digest=$1 WHERE incident_id=$2',
   ['f'.repeat(64),f.s.incident_id]);
  await f.addStudent(12);
  const r=await f.gate().observe(f.input());blocked(r);
  assert.equal(r.reason_code,'EXPORT_REVOCATION_AUDIT_HISTORY_GAP');
 });
});
test('REV-19 impossible V119 head pointer is rejected, not counted as a legitimate successor',async()=>{
 await using(12019,[11],async f=>{
  await f.pool.query(
   'UPDATE v106_test.fixture_incident_gap_manifest_heads SET sequence=sequence+1,event_digest=$1 WHERE incident_id=$2',
   ['f'.repeat(64),f.s.incident_id]);
  const r=await f.gate().observe(f.input());blocked(r);
  assert.equal(r.reason_code,'EXPORT_REVOCATION_TARGET_HISTORY_GAP');
  assert.equal(await f.revocationLedger.head(f.s),null);
 });
});
test('REV-20 forged release fields, invalid scopes, absent history all stay blocked',async()=>{
 await using(12020,[11],async f=>{
  for(const bad of [
   {...f.input(),hold_active:false},
   {...f.input(),finance_authorized:true},
   {...f.input(),student_id:student(11)},
   {...f.input(),incident_id:'invalid'},
   {...f.input(),manifest_sequence:0},
   {...f.input(),manifest_sequence:129}
  ]){
   const r=await f.gate().observe(bad);blocked(r);
   assert.equal(r.reason_code,'EXPORT_REVOCATION_SCOPE_INVALID');
  }
  assert.equal((await f.gate().inspect(f.input())).reason_code,
   'BLOCKED_NO_REVOCATION_AUDIT');
  assert.equal(f.gate().release,undefined);
  assert.throws(()=>createIsolatedManifestRevocationAudit({}),TypeError);
 });
});
