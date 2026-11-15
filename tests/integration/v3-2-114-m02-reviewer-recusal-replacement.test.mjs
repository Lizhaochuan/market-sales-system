import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import pg from 'pg';
import {createIsolatedEvidenceIntakeQuarantine} from '../../src/cross-module-evidence-intake-quarantine.mjs';
import {createIsolatedReviewerLifecycle} from '../../src/cross-module-reviewer-recusal-replacement.mjs';
import {createIsolatedPostgresEvidenceIntakeLedger} from '../helpers/v3-2-112-m02-evidence-intake-ledger.mjs';
import {createIsolatedPostgresReviewerAssignmentLedger} from '../helpers/v3-2-113-m02-postgres-reviewer-assignments.mjs';
import {createIsolatedPostgresReviewerLifecycleLedger} from '../helpers/v3-2-114-m02-postgres-reviewer-lifecycle.mjs';

if(process.env.V106_ISOLATED_PG!=='YES_TEST_ONLY')
 throw Error('V114 reviewer lifecycle tests require disposable SQL');
const {Pool}=pg;
const org='11111111-1111-4111-8111-111111111111';
const student='99999999-9999-4999-8999-999999999999';
const old='reviewer-fixture-001',next='reviewer-fixture-002';
const roles={
 sales_owner:['crm_sales','student_order_attribution'],
 finance_owner:['finance_ledger','payment_ownership_reconciliation'],
 academic_owner:['academic_ledger','lesson_fulfilment_reconciliation'],
 security_identity_owner:['identity_provider','identity_key_revocation'],
 integration_owner:['integration_service','cross_domain_barrier_contract'],
 database_owner:['audit_store','audit_checkpoint_evidence']
};
const roleNames=Object.keys(roles);
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const pem=pair=>pair.publicKey.export({type:'spki',format:'pem'});
const signed=(payload,key)=>({...payload,signature:sign(null,
 Buffer.from(JSON.stringify(payload)),key).toString('base64url')});
const scope=n=>({organization_id:org,incident_id:'88888888-8888-4888-8888-'+
 String(n).padStart(12,'0'),student_id:student});
const uuid=n=>'cccccccc-cccc-4ccc-8ccc-'+String(n).padStart(12,'0');
const sid=(n,i)=>'bbbbbbbb-bbbb-4bbb-8bbb-'+String(n*10+i).padStart(12,'0');
const poolFor=(role='v106_writer_a')=>new Pool({host:'127.0.0.1',port:5432,
 database:'v106_isolated',user:role,password:role==='v106_writer_a'?
 'ephemeral-v106-A-only':'ephemeral-v106-B-only',
 max:5,connectionTimeoutMillis:3000});
const safe=r=>{
 assert.ok(Object.isFrozen(r),JSON.stringify(r));
 assert.equal(r.hold_active,true);
 for(const k of ['external_reviewer_appointed','external_owner_verified',
  'real_evidence_verified','external_authority_verified','finance_authorized',
  'academic_authorized','handoff_allowed','compensation_write_allowed',
  'release_eligible','production_integration_allowed',
  'merge_authorized','deploy_authorized'])assert.equal(r[k],false,k);
};
function fixture(s,pool){
 const intakeLedger=createIsolatedPostgresEvidenceIntakeLedger({pool});
 const assignmentLedger=createIsolatedPostgresReviewerAssignmentLedger({pool});
 const lifecycleLedger=createIsolatedPostgresReviewerLifecycleLedger({pool});
 const govKey=generateKeyPairSync('ed25519');
 const idKey=generateKeyPairSync('ed25519');
 let clock=1000000,badGovernanceSig=false,badIdentitySig=false,
  wrongActionScope=false,wrongChain=false,expiredAction=false;
 const statuses=new Map([
  [old,{active:true,role_revision:1,revocation_sequence:0}],
  [next,{active:true,role_revision:1,revocation_sequence:0}],
  ['reviewer-fixture-003',{active:true,role_revision:1,revocation_sequence:0}]
 ]);
 const stateId=(id)=>statuses.get(id)||{active:false,role_revision:1,revocation_sequence:0};
 const intake=createIsolatedEvidenceIntakeQuarantine({
  ledger:intakeLedger,getFixtureNow:()=>1000000});
 async function seed(){
  for(let i=0;i<roleNames.length;i++){
   const role=roleNames[i],n=Number(s.incident_id.slice(-12));
   const c={schema_version:'v3.2-112-ci-untrusted-evidence-claim-v1',
    submission_id:sid(n,i+1),...s,family_id:null,owner_role:role,
    claimed_owner_id:role+'-owner-fixture-001',
    claimed_submitter_id:role+'-submitter-fixture-001',
    claimed_source_system:roles[role][0],evidence_type:roles[role][1],
    source_revision:1,source_revocation_sequence:0,
    original_history_digest:'a'.repeat(64),evidence_digest:'b'.repeat(64),
    linked_v110_notice_digest:'c'.repeat(64),
    submitted_at_ms:1000000,expires_at_ms:1100000,
    claimed_approval_state:'UNVERIFIED_SUBMISSION',fixture_only:true};
   assert.equal((await intake.receive(c)).intake_recorded,true);
  }
  const head=await intakeLedger.head(s);
  const events=await Promise.all(roleNames.map((_,i)=>intakeLedger.event(s,i+1)));
  const snapshot=sha(roleNames.map((role,i)=>({
   role,claim_digest:events[i].claim_digest,event_sequence:events[i].sequence})));
  const rec={schema_version:'v3.2-113-ci-review-assignment-v1',
   scope:s,reviewer_id:old,reviewer_role:'independent_evidence_reviewer',
   reviewer_attestation_digest:'d'.repeat(64),
   intake_head_sequence:head.sequence,intake_head_digest:head.event_digest,
   evidence_snapshot_digest:snapshot,evidence_count:6,
   status:'PENDING_REAL_OWNER_CONFIRMATION',assigned_at_ms:1000000};
  const result=await assignmentLedger.bind(s,rec);
  assert.equal(result.accepted,true,JSON.stringify(result));
 }
 const readSignedIdentityStatus=async({scope:sc,reviewer_id})=>{
  const st=stateId(reviewer_id);
  const body={schema_version:'v3.2-114-ci-identity-status-v1',
   ...sc,reviewer_id,reviewer_role:'independent_evidence_reviewer',
   active:st.active,role_revision:st.role_revision,
   revocation_sequence:st.revocation_sequence,
   observed_at_ms:clock,expires_at_ms:clock+20000,fixture_only:true};
  const signer=badIdentitySig?generateKeyPairSync('ed25519').privateKey:idKey.privateKey;
  return signed(body,signer);
 };
 const readSignedGovernanceAction=async({
  scope:sc,request,sequence,previous_event_digest,
  assignment_digest,intake_head_digest,evidence_snapshot_digest
 })=>{
  const body={schema_version:'v3.2-114-ci-governance-action-v1',
   ...request,organization_id:wrongActionScope?
    '22222222-2222-4222-8222-222222222222':sc.organization_id,
   sequence,previous_event_digest:wrongChain?'f'.repeat(64):previous_event_digest,
   assignment_digest,intake_head_digest,evidence_snapshot_digest,
   issued_at_ms:clock-100,expires_at_ms:expiredAction?clock-1:clock+10000,
   fixture_only:true};
  const signer=badGovernanceSig?generateKeyPairSync('ed25519').privateKey:
   govKey.privateKey;
  return signed(body,signer);
 };
 const makeGate=(opts={})=>createIsolatedReviewerLifecycle({
  assignmentLedger,intakeLedger,lifecycleLedger,
  readSignedGovernanceAction,readSignedIdentityStatus,
  fixtureGovernancePublicKey:pem(govKey),
  fixtureIdentityPublicKey:pem(idKey),getFixtureNow:()=>clock,...opts});
 const req=(action_kind='recuse',previous_reviewer_id=old,
  next_reviewer_id=null,reason_code='conflict_of_interest',i=1)=>({
  ...s,action_id:uuid(Number(s.incident_id.slice(-12))*100+i),
  action_kind,reason_code,previous_reviewer_id,next_reviewer_id});
 return {s,seed,intake,intakeLedger,assignmentLedger,lifecycleLedger,
  makeGate,req,statuses,idKey,govKey,readSignedGovernanceAction,
  readSignedIdentityStatus,clock:v=>{clock=v;},
  badGov:v=>{badGovernanceSig=v;},badIdentity:v=>{badIdentitySig=v;},
  wrongScope:v=>{wrongActionScope=v;},wrongChain:v=>{wrongChain=v;},
  expiredAction:v=>{expiredAction=v;}};
}
async function using(n,fn){
 const pool=poolFor();
 try{
  const f=fixture(scope(n),pool);
  await f.seed();return await fn({f,pool});
 }finally{await pool.end();}
}
test('LIFE-01 independent signed recusal persists only an unapproved audit event',async()=>{
 await using(11401,async({f})=>{
  const r=await f.makeGate().transition(f.req());safe(r);
  assert.equal(r.reason_code,'BLOCKED_FIXTURE_REVIEWER_LIFECYCLE_RECORDED');
  assert.equal(r.fixture_transition_recorded,true);
  assert.equal(r.lifecycle_sequence,1);
  assert.equal(r.pending_reviewer_id,null);
  const e=await f.lifecycleLedger.event(f.s,1);
  assert.equal(e.action_kind,'recuse');
  assert.equal(e.status,'PENDING_REAL_AUTHORITY_CONFIRMATION');
  assert.equal((await f.assignmentLedger.read(f.s)).reviewer_id,old);
 });
});
test('LIFE-02 signed direct replacement retains V113 original and its evidence lineage',async()=>{
 await using(11402,async({f})=>{
  const r=await f.makeGate().transition(
   f.req('replace',old,next,'role_change'));safe(r);
  assert.equal(r.fixture_transition_recorded,true);
  assert.equal(r.pending_reviewer_id,next);
  assert.equal((await f.assignmentLedger.read(f.s)).reviewer_id,old);
  assert.equal((await f.lifecycleLedger.head(f.s)).sequence,1);
 });
});
test('LIFE-03 recusal then new reviewer replacement extends immutable event hash chain',async()=>{
 await using(11403,async({f})=>{
  assert.equal((await f.makeGate().transition(f.req())).fixture_transition_recorded,true);
  const r=await f.makeGate().transition(f.req('replace',null,next,
   'reassignment_after_recusal',2));safe(r);
  assert.equal(r.fixture_transition_recorded,true);
  assert.equal(r.lifecycle_sequence,2);
  const a=await f.lifecycleLedger.event(f.s,1);
  const b=await f.lifecycleLedger.event(f.s,2);
  assert.equal(b.previous_event_digest,sha(a));
  assert.equal(b.previous_reviewer_id,null);
  assert.equal(b.next_reviewer_id,next);
  assert.equal((await f.assignmentLedger.read(f.s)).reviewer_id,old);
 });
});
test('LIFE-04 conflict reviewer from one of six submitted roles is never reassigned',async()=>{
 await using(11404,async({f})=>{
  for(const name of ['finance_owner-submit ter-fixture-001'.replace(' ',''),
   'academic_owner-owner-fixture-001',old]){
   const r=await f.makeGate().transition(
    f.req('replace',old,name,'conflict_of_interest'));safe(r);
   assert.equal(r.reason_code,name===old?
    'INVALID_REVIEW_LIFECYCLE_ACTION':'REVIEWER_RECUSAL_CONFLICT_OR_REPLAY');
  }
  assert.equal(await f.lifecycleLedger.head(f.s),null);
 });
});
test('LIFE-05 revoked reviewer needs signed revocation-compatible reason',async()=>{
 await using(11405,async({f})=>{
  f.statuses.set(old,{active:false,role_revision:2,revocation_sequence:1});
  let r=await f.makeGate().transition(f.req());safe(r);
  assert.equal(r.reason_code,'REVIEWER_REVOCATION_REASON_MISMATCH');
  r=await f.makeGate().transition(f.req('recuse',old,null,'role_revoked'));safe(r);
  assert.equal(r.fixture_transition_recorded,true);
 });
 await using(11406,async({f})=>{
  const r=await f.makeGate().transition(f.req('recuse',old,null,'role_revoked'));safe(r);
  assert.equal(r.reason_code,'REVIEWER_REVOCATION_REASON_MISMATCH');
 });
});
test('LIFE-06 forged governance signature never creates a lifecycle event',async()=>{
 await using(11407,async({f})=>{
  f.badGov(true);const r=await f.makeGate().transition(f.req());safe(r);
  assert.equal(r.reason_code,'REVIEW_GOVERNANCE_ACTION_SIGNATURE_INVALID');
  assert.equal(await f.lifecycleLedger.head(f.s),null);
 });
});
test('LIFE-07 forged identity signature and swapped fixture keys are refused',async()=>{
 await using(11408,async({f})=>{
  f.badIdentity(true);
  const r=await f.makeGate().transition(f.req());safe(r);
  assert.equal(r.reason_code,'REVIEW_IDENTITY_SIGNATURE_INVALID');
  assert.equal(await f.lifecycleLedger.head(f.s),null);
  assert.throws(()=>f.makeGate({fixtureIdentityPublicKey:pem(f.govKey)}),
   /must be distinct/);
 });
});
test('LIFE-08 fake scope or stale signed lifecycle event digest is rejected',async()=>{
 await using(11409,async({f})=>{
  f.wrongScope(true);
  let r=await f.makeGate().transition(f.req());safe(r);
  assert.equal(r.reason_code,'REVIEW_GOVERNANCE_SCOPE_OR_EPOCH_INVALID');
  f.wrongScope(false);f.wrongChain(true);
  r=await f.makeGate().transition(f.req());safe(r);
  assert.equal(r.reason_code,'REVIEW_GOVERNANCE_SCOPE_OR_EPOCH_INVALID');
 });
});
test('LIFE-09 expired action or revoked replacement identity cannot become a new reviewer',async()=>{
 await using(11410,async({f})=>{
  f.expiredAction(true);
  const r=await f.makeGate().transition(f.req());safe(r);
  assert.equal(r.reason_code,'REVIEW_GOVERNANCE_SCOPE_OR_EPOCH_INVALID');
 });
 await using(11411,async({f})=>{
  f.statuses.set(next,{active:false,role_revision:2,revocation_sequence:1});
  const r=await f.makeGate().transition(f.req('replace',old,next,'role_change'));safe(r);
  assert.equal(r.reason_code,'REPLACEMENT_REVIEWER_NOT_ACTIVE');
  assert.equal(await f.lifecycleLedger.head(f.s),null);
 });
});
test('LIFE-10 source identity revocation AFTER local SQL commit still invalidates current result',async()=>{
 await using(11412,async({f})=>{
  const r=await f.makeGate({afterCommit:async()=>{
   f.statuses.set(old,{active:false,role_revision:2,revocation_sequence:1});
  }}).transition(f.req());safe(r);
  assert.equal(r.reason_code,'REVIEW_IDENTITY_CHANGED_AFTER_COMMIT');
  assert.equal((await f.lifecycleLedger.head(f.s)).sequence,1);
  assert.equal((await f.lifecycleLedger.event(f.s,1)).status,
   'PENDING_REAL_AUTHORITY_CONFIRMATION');
 });
});
test('LIFE-11 new evidence intake after SQL commit invalidates old review',async()=>{
 await using(11413,async({f})=>{
  const r=await f.makeGate({afterCommit:async()=>{
   // One more V112 intake event; V113 original snapshot no longer current.
   const n=Number(f.s.incident_id.slice(-12));
   const c={schema_version:'v3.2-112-ci-untrusted-evidence-claim-v1',
    submission_id:sid(n,8),...f.s,family_id:null,
    owner_role:'sales_owner',
    claimed_owner_id:'sales_owner-owner-fixture-001',
    claimed_submitter_id:'sales_owner-submitter-fixture-001',
    claimed_source_system:'crm_sales',evidence_type:'student_order_attribution',
    source_revision:2,source_revocation_sequence:0,
    original_history_digest:'a'.repeat(64),evidence_digest:'e'.repeat(64),
    linked_v110_notice_digest:'c'.repeat(64),
    submitted_at_ms:1000000,expires_at_ms:1100000,
    claimed_approval_state:'UNVERIFIED_SUBMISSION',fixture_only:true};
   assert.equal((await f.intake.receive(c)).intake_recorded,true);
  }}).transition(f.req());safe(r);
  assert.equal(r.reason_code,'REVIEW_LIFECYCLE_CHANGED_AFTER_COMMIT');
  assert.equal((await f.lifecycleLedger.head(f.s)).sequence,1);
 });
});
test('LIFE-12 database precommit fault rolls back event and lifecycle head',async()=>{
 await using(11414,async({f,pool})=>{
  const broken=createIsolatedPostgresReviewerLifecycleLedger({
   pool,beforeCommit:async()=>{throw Error('synthetic-before-commit-failure');}});
  const r=await f.makeGate({lifecycleLedger:broken}).transition(f.req());safe(r);
  assert.equal(r.reason_code,'REVIEW_LIFECYCLE_DEPENDENCY_UNAVAILABLE');
  assert.equal(await f.lifecycleLedger.head(f.s),null);
  assert.equal(await f.lifecycleLedger.event(f.s,1),null);
 });
});
test('LIFE-13 separate instances racing for reviewer scope cannot both commit',async()=>{
 await using(11415,async({f})=>{
  const p=poolFor();
  try{
   const other=createIsolatedPostgresReviewerLifecycleLedger({pool:p});
   let arrive=0,release;
   const barrier=new Promise(resolve=>{release=resolve;});
   const sync=delegate=>{
    let first=true;
    return {
     head:async s=>{
      const v=await delegate.head(s);
      if(first){first=false;if(++arrive===2)release();await barrier;}
      return v;
     },
     event:delegate.event,append:delegate.append
    };
   };
   const [a,b]=await Promise.all([
    f.makeGate({lifecycleLedger:sync(f.lifecycleLedger)})
     .transition(f.req('replace',old,next,'role_change',1)),
    f.makeGate({lifecycleLedger:sync(other)})
     .transition(f.req('recuse',old,null,'conflict_of_interest',2))
   ]);safe(a);safe(b);
   assert.equal([a,b].filter(x=>x.fixture_transition_recorded).length,1);
   assert.equal([a,b].filter(x=>x.reason_code===
    'REVIEW_LIFECYCLE_SQL_CONFLICT_OR_UNCERTAIN').length,1);
   assert.equal((await f.lifecycleLedger.head(f.s)).sequence,1);
  }finally{await p.end();}
 });
});
test('LIFE-14 action replay and stale incumbent cannot overwrite the first lifecycle event',async()=>{
 await using(11416,async({f})=>{
  const req=f.req();
  assert.equal((await f.makeGate().transition(req)).fixture_transition_recorded,true);
  const r=await f.makeGate().transition(req);safe(r);
  assert.equal(r.reason_code,'REVIEWER_RECUSAL_CONFLICT_OR_REPLAY');
  assert.equal((await f.lifecycleLedger.head(f.s)).sequence,1);
 });
});
test('LIFE-15 wrong-tenant SQL writer cannot commit a signed fixture action',async()=>{
 await using(11417,async({f})=>{
  const p=poolFor('v106_writer_b');
  try{
   const bad=createIsolatedPostgresReviewerLifecycleLedger({pool:p});
   const r=await f.makeGate({lifecycleLedger:bad}).transition(f.req());safe(r);
   assert.equal(r.reason_code,'REVIEW_LIFECYCLE_SQL_CONFLICT_OR_UNCERTAIN');
   assert.equal(await f.lifecycleLedger.head(f.s),null);
  }finally{await p.end();}
 });
});
test('LIFE-16 event audit immutable and protected business funds cannot be edited',async()=>{
 await using(11418,async({f,pool})=>{
  assert.equal((await f.makeGate().transition(f.req())).fixture_transition_recorded,true);
  await assert.rejects(pool.query(
   'UPDATE v106_test.fixture_reviewer_lifecycle_events SET event_digest=$1 WHERE student_id=$2',
   ['f'.repeat(64),student]),/permission denied/i);
  await assert.rejects(pool.query(
   'DELETE FROM v106_test.fixture_reviewer_lifecycle_events WHERE student_id=$1',
   [student]),/permission denied/i);
  await assert.rejects(pool.query(
   'UPDATE v106_test.protected_business_fixture SET example_payment_amount=0'),
   /permission denied/i);
 });
});
test('LIFE-17 untrusted reviewer inputs with approval flags or invalid scope fail closed',async()=>{
 await using(11419,async({f})=>{
  for(const bad of [
   {...f.req(),finance_authorized:true},
   {...f.req(),next_reviewer_id:'bad'},
   {...f.req(),action_id:'invalid'},
   {...f.req(),student_id:'invalid'}
  ]){
   const r=await f.makeGate().transition(bad);safe(r);
   assert.equal(r.reason_code,'INVALID_REVIEW_LIFECYCLE_ACTION');
  }
  assert.equal(await f.lifecycleLedger.head(f.s),null);
  assert.throws(()=>createIsolatedReviewerLifecycle({}),TypeError);
 });
});
test('LIFE-18 original V113 assignment and student history remain untouched by transition',async()=>{
 await using(11420,async({f})=>{
  const initial=await f.assignmentLedger.read(f.s);
  const before=await f.intakeLedger.head(f.s);
  const r=await f.makeGate().transition(f.req('replace',old,next,'role_change'));
  safe(r);assert.equal(r.fixture_transition_recorded,true);
  assert.deepEqual(await f.assignmentLedger.read(f.s),initial);
  assert.deepEqual(await f.intakeLedger.head(f.s),before);
  assert.equal(r.handoff_allowed,false);
 });
});
