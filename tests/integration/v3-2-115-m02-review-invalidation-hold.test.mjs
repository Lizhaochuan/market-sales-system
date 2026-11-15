import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import pg from 'pg';
import {createIsolatedEvidenceIntakeQuarantine} from '../../src/cross-module-evidence-intake-quarantine.mjs';
import {createIsolatedReviewerInvalidationHold} from '../../src/cross-module-reviewer-invalidation-hold.mjs';
import {createIsolatedPostgresEvidenceIntakeLedger} from '../helpers/v3-2-112-m02-evidence-intake-ledger.mjs';
import {createIsolatedPostgresReviewerAssignmentLedger} from '../helpers/v3-2-113-m02-postgres-reviewer-assignments.mjs';
import {createIsolatedPostgresReviewerLifecycleLedger} from '../helpers/v3-2-114-m02-postgres-reviewer-lifecycle.mjs';
import {createIsolatedPostgresReviewHoldLedger} from '../helpers/v3-2-115-m02-postgres-review-hold.mjs';

if(process.env.V106_ISOLATED_PG!=='YES_TEST_ONLY')
 throw Error('V115 tests require disposable PostgreSQL');
const {Pool}=pg;
const org='11111111-1111-4111-8111-111111111111';
const student='99999999-9999-4999-8999-999999999999';
const old='reviewer-fixture-001';
const roleTypes={
 sales_owner:['crm_sales','student_order_attribution'],
 finance_owner:['finance_ledger','payment_ownership_reconciliation'],
 academic_owner:['academic_ledger','lesson_fulfilment_reconciliation'],
 security_identity_owner:['identity_provider','identity_key_revocation'],
 integration_owner:['integration_service','cross_domain_barrier_contract'],
 database_owner:['audit_store','audit_checkpoint_evidence']
};
const roles=Object.keys(roleTypes),zero='0'.repeat(64);
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const pem=pair=>pair.publicKey.export({type:'spki',format:'pem'});
const poolFor=(who='v106_writer_a')=>new Pool({
 host:'127.0.0.1',port:5432,database:'v106_isolated',user:who,
 password:who==='v106_writer_a'?'ephemeral-v106-A-only':'ephemeral-v106-B-only',
 max:4,connectionTimeoutMillis:3000
});
const scope=n=>({organization_id:org,
 incident_id:'88888888-8888-4888-8888-'+String(n).padStart(12,'0'),
 student_id:student});
const sid=(n,i)=>'bbbbbbbb-bbbb-4bbb-8bbb-'+String(n*10+i).padStart(12,'0');
function makeClaim(s,role,i,revision=1){
 return {schema_version:'v3.2-112-ci-untrusted-evidence-claim-v1',
  submission_id:sid(Number(s.incident_id.slice(-12)),i),
  ...s,family_id:null,owner_role:role,
  claimed_owner_id:role+'-owner-fixture-001',
  claimed_submitter_id:role+'-submitter-fixture-001',
  claimed_source_system:roleTypes[role][0],evidence_type:roleTypes[role][1],
  source_revision:revision,source_revocation_sequence:0,
  original_history_digest:'a'.repeat(64),
  evidence_digest:(revision===1?'b':'e').repeat(64),
  linked_v110_notice_digest:'c'.repeat(64),
  submitted_at_ms:1000000,expires_at_ms:1100000,
  claimed_approval_state:'UNVERIFIED_SUBMISSION',fixture_only:true};
}
function harness(s,pool){
 const intakeLedger=createIsolatedPostgresEvidenceIntakeLedger({pool});
 const assignmentLedger=createIsolatedPostgresReviewerAssignmentLedger({pool});
 const lifecycleLedger=createIsolatedPostgresReviewerLifecycleLedger({pool});
 const holdLedger=createIsolatedPostgresReviewHoldLedger({pool});
 const pair=generateKeyPairSync('ed25519');
 const status={revoked:false,source_revision:1,revocation_sequence:0};
 let clock=1000000,signatureBad=false,scopeBad=false,offline=false,
  expiryBad=false;
 const intake=createIsolatedEvidenceIntakeQuarantine({
  ledger:intakeLedger,getFixtureNow:()=>1000000});
 async function add(role,i,revision=1){
  const c=makeClaim(s,role,i,revision);
  const r=await intake.receive(c);
  assert.equal(r.intake_recorded,true,JSON.stringify(r));
 }
 async function seed(){
  for(let i=0;i<6;i++)await add(roles[i],i+1);
  const head=await intakeLedger.head(s);
  const events=await Promise.all(roles.map((_,i)=>intakeLedger.event(s,i+1)));
  const evidence_snapshot_digest=sha(roles.map((role,i)=>({
   role,claim_digest:events[i].claim_digest,event_sequence:events[i].sequence
  })));
  const record={
   schema_version:'v3.2-113-ci-review-assignment-v1',scope:s,
   reviewer_id:old,reviewer_role:'independent_evidence_reviewer',
   reviewer_attestation_digest:'d'.repeat(64),
   intake_head_sequence:6,intake_head_digest:head.event_digest,
   evidence_snapshot_digest,evidence_count:6,
   status:'PENDING_REAL_OWNER_CONFIRMATION',assigned_at_ms:1000000
  };
  const r=await assignmentLedger.bind(s,record);
  assert.equal(r.accepted,true,JSON.stringify(r));
 }
 async function addRecusal(){
  const original=await assignmentLedger.read(s);
  const e={schema_version:'v3.2-114-ci-review-lifecycle-v1',
   scope:s,sequence:1,previous_event_digest:zero,
   assignment_digest:sha(original),
   intake_head_digest:original.intake_head_digest,
   evidence_snapshot_digest:original.evidence_snapshot_digest,
   action_id:'cccccccc-cccc-4ccc-8ccc-'+String(Number(s.incident_id.slice(-12))).padStart(12,'0'),
   action_kind:'recuse',reason_code:'conflict_of_interest',
   previous_reviewer_id:old,next_reviewer_id:null,
   action_digest:'e'.repeat(64),identity_status_digest:'f'.repeat(64),
   status:'PENDING_REAL_AUTHORITY_CONFIRMATION',recorded_at_ms:1000000};
  const x=await lifecycleLedger.append(s,e);
  assert.equal(x.accepted,true,JSON.stringify(x));
 }
 const readSignedFixtureReviewerStatus=async({scope:sc,reviewer_id})=>{
  if(offline)throw Error('signed status unavailable');
  const body={schema_version:'v3.2-115-ci-reviewer-status-v1',...sc,
   organization_id:scopeBad?'22222222-2222-4222-8222-222222222222':sc.organization_id,
   reviewer_id,source_revision:status.source_revision,
   revocation_sequence:status.revocation_sequence,revoked:status.revoked,
   issued_at_ms:clock-100,expires_at_ms:expiryBad?clock-1:clock+10000,
   fixture_only:true};
  const key=signatureBad?generateKeyPairSync('ed25519').privateKey:pair.privateKey;
  return {...body,signature:sign(null,Buffer.from(JSON.stringify(body)),key)
   .toString('base64url')};
 };
 const gate=(overrides={})=>createIsolatedReviewerInvalidationHold({
  assignmentLedger,intakeLedger,lifecycleLedger,holdLedger,
  readSignedFixtureReviewerStatus,
  fixtureReviewerStatusPublicKey:pem(pair),
  getFixtureNow:()=>clock,...overrides
 });
 return {s,seed,add,addRecusal,gate,status,holdLedger,intakeLedger,
  assignmentLedger,lifecycleLedger,pair,
  revoke:()=>{status.revoked=true;status.revocation_sequence++;},
  revise:()=>{status.source_revision++;},
  offline:v=>{offline=v;},badSignature:v=>{signatureBad=v;},
  badScope:v=>{scopeBad=v;},badExpiry:v=>{expiryBad=v;},
  clock:v=>{clock=v;}
 };
}
const safe=r=>{
 assert.equal(Object.isFrozen(r),true);
 assert.equal(r.hold_active,true);
 for(const k of ['external_authority_verified','external_reviewer_appointed',
  'external_owner_verified','real_evidence_verified','finance_authorized',
  'academic_authorized','handoff_allowed','compensation_write_allowed',
  'release_eligible','production_integration_allowed','merge_authorized',
  'deploy_authorized'])assert.equal(r[k],false,k);
};
async function using(n,fn){
 const pool=poolFor();
 try{
  const f=harness(scope(n),pool);
  await f.seed();
  return await fn({f,pool});
 }finally{await pool.end();}
}

test('HOLD-01 active unchanged fixture source is pending; no business authorization even without hold event',async()=>{
 await using(11501,async({f})=>{
  const r=await f.gate().observe(f.s);safe(r);
  assert.equal(r.reason_code,'BLOCKED_REVIEW_PENDING_REAL_AUTHORITY');
  assert.equal(await f.holdLedger.head(f.s),null);
  const q=await f.gate().statusOf(f.s);safe(q);
  assert.equal(q.reason_code,'BLOCKED_NO_RECORDED_HOLD_STILL_UNAUTHORIZED');
 });
});
test('HOLD-02 independent signed revocation appends immutable HOLD with active SQL hold constraint',async()=>{
 await using(11502,async({f})=>{
  f.revoke();const r=await f.gate().observe(f.s);safe(r);
  assert.equal(r.reason_code,'BLOCKED_HOLD_EVENT_RECORDED');
  assert.equal(r.trigger_kind,'REVIEWER_REVOKED');
  assert.equal(r.fixture_hold_event_recorded,true);
  assert.equal(r.hold_sequence,1);
  assert.equal((await f.holdLedger.head(f.s)).sequence,1);
  assert.equal((await f.holdLedger.event(f.s,1)).status,'HOLD_PENDING_EXTERNAL_AUTHORITY');
  const s=await f.gate().statusOf(f.s);safe(s);
  assert.equal(s.reason_code,'BLOCKED_HOLD_RECORDED_PENDING_EXTERNAL_AUTHORITY');
 });
});
test('HOLD-03 unavailable reviewer source forces an unverified-source hold, not a fake revocation claim',async()=>{
 await using(11503,async({f})=>{
  f.offline(true);
  const r=await f.gate().observe(f.s);safe(r);
  assert.equal(r.trigger_kind,'SOURCE_PROOF_UNVERIFIED');
  assert.equal(r.fixture_hold_event_recorded,true);
  assert.equal((await f.holdLedger.event(f.s,1)).source_signal_digest,zero);
 });
});
test('HOLD-04 forged or expired identity signature cannot claim a verified reviewer',async()=>{
 let i=11504;
 for(const prepare of [f=>f.badSignature(true),f=>f.badScope(true),f=>f.badExpiry(true)]){
  await using(i++,async({f})=>{
   prepare(f);
   const r=await f.gate().observe(f.s);safe(r);
   assert.equal(r.trigger_kind,'SOURCE_PROOF_UNVERIFIED');
   assert.equal(r.reason_code,'BLOCKED_HOLD_EVENT_RECORDED');
  });
 }
});
test('HOLD-05 new V112 evidence after V113 assignment forces hold and preserves original assignment',async()=>{
 await using(11507,async({f})=>{
  const before=await f.assignmentLedger.read(f.s);
  await f.add('finance_owner',7,2);
  const r=await f.gate().observe(f.s);safe(r);
  assert.equal(r.trigger_kind,'EVIDENCE_UPDATED');
  assert.deepEqual(await f.assignmentLedger.read(f.s),before);
  assert.equal((await f.holdLedger.head(f.s)).sequence,1);
 });
});
test('HOLD-06 V114 recusal with no reviewer forces hold while original V113 assignment is unchanged',async()=>{
 await using(11508,async({f})=>{
  await f.addRecusal();
  const r=await f.gate().observe(f.s);safe(r);
  assert.equal(r.trigger_kind,'REVIEWER_CHANGED');
  assert.equal((await f.holdLedger.event(f.s,1)).reviewer_id,null);
  assert.equal((await f.assignmentLedger.read(f.s)).reviewer_id,old);
 });
});
test('HOLD-07 replay of the same revoked evidence does not create a second hold event',async()=>{
 await using(11509,async({f})=>{
  f.revoke();
  assert.equal((await f.gate().observe(f.s)).fixture_hold_event_recorded,true);
  const r=await f.gate().observe(f.s);safe(r);
  assert.equal(r.reason_code,'HOLD_SQL_REPLAY_CONFLICT_OR_UNCERTAIN');
  assert.equal((await f.holdLedger.head(f.s)).sequence,1);
 });
});
test('HOLD-08 a new cause appends a second immutable event with digest linkage',async()=>{
 await using(11510,async({f})=>{
  f.revoke();
  assert.equal((await f.gate().observe(f.s)).fixture_hold_event_recorded,true);
  await f.add('finance_owner',7,2);
  const r=await f.gate().observe(f.s);safe(r);
  assert.equal(r.trigger_kind,'EVIDENCE_UPDATED');
  assert.equal(r.hold_sequence,2);
  const first=await f.holdLedger.event(f.s,1);
  const second=await f.holdLedger.event(f.s,2);
  assert.equal(second.previous_event_digest,sha(first));
  assert.equal((await f.holdLedger.head(f.s)).sequence,2);
 });
});
test('HOLD-09 SQL failure before COMMIT rolls back event and head together',async()=>{
 await using(11511,async({f,pool})=>{
  f.revoke();
  const broken=createIsolatedPostgresReviewHoldLedger({
   pool,beforeCommit:async()=>{throw Error('fixture-precommit-error');}});
  const r=await f.gate({holdLedger:broken}).observe(f.s);safe(r);
  assert.equal(r.reason_code,'HOLD_DEPENDENCY_UNAVAILABLE');
  assert.equal(await f.holdLedger.head(f.s),null);
  assert.equal(await f.holdLedger.event(f.s,1),null);
 });
});
test('HOLD-10 SQL COMMIT with lost acknowledgement persists hold but does not falsely claim verified confirmation',async()=>{
 await using(11512,async({f})=>{
  f.revoke();
  const r=await f.gate({afterCommit:async()=>{throw Error('ack-lost');}})
   .observe(f.s);safe(r);
  assert.equal(r.reason_code,'HOLD_DEPENDENCY_UNAVAILABLE');
  assert.equal((await f.holdLedger.head(f.s)).sequence,1);
  assert.equal((await f.gate().statusOf(f.s)).hold_active,true);
 });
});
test('HOLD-11 new status revision after COMMIT is detected and hold remains recorded',async()=>{
 await using(11513,async({f})=>{
  f.revoke();
  const r=await f.gate({afterCommit:async()=>f.revise()}).observe(f.s);
  safe(r);
  assert.equal(r.reason_code,'BLOCKED_HOLD_EVENT_RECORDED_SOURCE_CHANGED');
  assert.equal(r.fixture_hold_event_recorded,true);
  assert.equal((await f.holdLedger.head(f.s)).sequence,1);
 });
});
test('HOLD-12 independent SQL writers cannot append same hold cause twice',async()=>{
 await using(11514,async({f})=>{
  f.revoke();
  const pool=poolFor();
  try{
   const remote=createIsolatedPostgresReviewHoldLedger({pool});
   let seen=0,release;
   const barrier=new Promise(resolve=>{release=resolve;});
   const synchronized=delegate=>{
    let first=true;
    return {head:async s=>{
      const value=await delegate.head(s);
      if(first){first=false;if(++seen===2)release();await barrier;}
      return value;
     },event:delegate.event,append:delegate.append};
   };
   const [a,b]=await Promise.all([
    f.gate({holdLedger:synchronized(f.holdLedger)}).observe(f.s),
    f.gate({holdLedger:synchronized(remote)}).observe(f.s)
   ]);safe(a);safe(b);
   assert.equal([a,b].filter(x=>x.fixture_hold_event_recorded).length,1);
   assert.equal([a,b].filter(x=>x.reason_code===
    'HOLD_SQL_REPLAY_CONFLICT_OR_UNCERTAIN').length,1);
   assert.equal((await f.holdLedger.head(f.s)).sequence,1);
  }finally{await pool.end();}
 });
});
test('HOLD-13 database role for another tenant cannot write a scoped hold',async()=>{
 await using(11515,async({f})=>{
  f.revoke();
  const pool=poolFor('v106_writer_b');
  try{
   const remote=createIsolatedPostgresReviewHoldLedger({pool});
   const r=await f.gate({holdLedger:remote}).observe(f.s);safe(r);
   assert.equal(r.reason_code,'HOLD_SQL_REPLAY_CONFLICT_OR_UNCERTAIN');
   assert.equal(await f.holdLedger.head(f.s),null);
  }finally{await pool.end();}
 });
});
test('HOLD-14 SQL role cannot turn hold_active off or update historical event',async()=>{
 await using(11516,async({f,pool})=>{
  f.revoke();
  assert.equal((await f.gate().observe(f.s)).fixture_hold_event_recorded,true);
  await assert.rejects(pool.query(
   'UPDATE v106_test.fixture_review_hold_heads SET hold_active=false WHERE incident_id=$1',
   [f.s.incident_id]),/permission denied|check constraint/i);
  await assert.rejects(pool.query(
   'UPDATE v106_test.fixture_review_hold_events SET event_digest=$1 WHERE incident_id=$2',
   ['f'.repeat(64),f.s.incident_id]),/permission denied/i);
  await assert.rejects(pool.query(
   'DELETE FROM v106_test.fixture_review_hold_events WHERE incident_id=$1',
   [f.s.incident_id]),/permission denied/i);
  await assert.rejects(pool.query(
   'UPDATE v106_test.protected_business_fixture SET example_payment_amount=0'),
   /permission denied/i);
  assert.equal((await f.holdLedger.head(f.s)).sequence,1);
  assert.equal(f.gate().release,undefined);
 });
});
test('HOLD-15 malformed scope and caller supplied release flags never reach SQL',async()=>{
 await using(11517,async({f})=>{
  for(const input of [
   {...f.s,hold_active:false},
   {...f.s,handoff_allowed:true},
   {...f.s,incident_id:'not-a-uuid'},
   {...f.s,student_id:'not-a-uuid'}
  ]){
   const r=await f.gate().observe(input);safe(r);
   assert.equal(r.reason_code,'INVALID_HOLD_OBSERVATION_SCOPE');
  }
  assert.equal(await f.holdLedger.head(f.s),null);
  assert.throws(()=>createIsolatedReviewerInvalidationHold({}),TypeError);
 });
});
test('HOLD-16 tampered SQL head is rejected instead of being treated as an approval',async()=>{
 await using(11518,async({f,pool})=>{
  f.revoke();
  assert.equal((await f.gate().observe(f.s)).fixture_hold_event_recorded,true);
  await pool.query(
   'UPDATE v106_test.fixture_review_hold_heads SET event_digest=$1 WHERE organization_id=$2 AND incident_id=$3 AND student_id=$4',
   ['f'.repeat(64),org,f.s.incident_id,student]);
  const r=await f.gate().statusOf(f.s);safe(r);
  assert.equal(r.reason_code,'HOLD_EVENT_UNVERIFIED');
  const repeated=await f.gate().observe(f.s);safe(repeated);
  assert.equal(repeated.reason_code,'HOLD_PREVIOUS_EVENT_UNVERIFIED');
 });
});
test('HOLD-17 original reviewer and all V112 evidence remain immutable after invalidation',async()=>{
 await using(11519,async({f})=>{
  const first=await f.assignmentLedger.read(f.s);
  const intake=await f.intakeLedger.head(f.s);
  f.revoke();const r=await f.gate().observe(f.s);safe(r);
  assert.equal(r.fixture_hold_event_recorded,true);
  assert.deepEqual(await f.assignmentLedger.read(f.s),first);
  assert.deepEqual(await f.intakeLedger.head(f.s),intake);
  assert.equal(r.handoff_allowed,false);
 });
});
