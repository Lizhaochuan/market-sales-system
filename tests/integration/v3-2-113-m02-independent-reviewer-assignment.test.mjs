import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import pg from 'pg';
import {createIsolatedEvidenceIntakeQuarantine} from '../../src/cross-module-evidence-intake-quarantine.mjs';
import {createIsolatedReviewerAssignment} from '../../src/cross-module-independent-reviewer-assignment.mjs';
import {createIsolatedPostgresEvidenceIntakeLedger} from '../helpers/v3-2-112-m02-evidence-intake-ledger.mjs';
import {createIsolatedPostgresReviewerAssignmentLedger} from '../helpers/v3-2-113-m02-postgres-reviewer-assignments.mjs';
if(process.env.V106_ISOLATED_PG!=='YES_TEST_ONLY')throw Error('V113 disposable PostgreSQL only');
const {Pool}=pg,org='11111111-1111-4111-8111-111111111111';
const student='99999999-9999-4999-8999-999999999999';
const family='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const reviewer='independent-evidence-reviewer-001';
const roles={
 sales_owner:['crm_sales','student_order_attribution'],
 finance_owner:['finance_ledger','payment_ownership_reconciliation'],
 academic_owner:['academic_ledger','lesson_fulfilment_reconciliation'],
 security_identity_owner:['identity_provider','identity_key_revocation'],
 integration_owner:['integration_service','cross_domain_barrier_contract'],
 database_owner:['audit_store','audit_checkpoint_evidence']
};
const names=Object.keys(roles);
const scope=n=>({organization_id:org,incident_id:'88888888-8888-4888-8888-'+String(n).padStart(12,'0'),student_id:student});
const sid=(n,i)=>'bbbbbbbb-bbbb-4bbb-8bbb-'+String(n*10+i).padStart(12,'0');
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const pem=k=>k.publicKey.export({type:'spki',format:'pem'});
const poolFor=(who='v106_writer_a')=>new Pool({host:'127.0.0.1',port:5432,
 database:'v106_isolated',user:who,password:who==='v106_writer_a'?
 'ephemeral-v106-A-only':'ephemeral-v106-B-only',max:4,connectionTimeoutMillis:3000});
function makeClaim(s,role,i,patch={}){
 return {schema_version:'v3.2-112-ci-untrusted-evidence-claim-v1',
  submission_id:sid(Number(s.incident_id.slice(-12)),i),...s,
  family_id:null,owner_role:role,claimed_owner_id:role+'-owner-fixture-001',
  claimed_submitter_id:role+'-submitter-fixture-001',
  claimed_source_system:roles[role][0],evidence_type:roles[role][1],
  source_revision:1,source_revocation_sequence:0,
  original_history_digest:'a'.repeat(64),evidence_digest:'b'.repeat(64),
  linked_v110_notice_digest:'c'.repeat(64),
  submitted_at_ms:1000000,expires_at_ms:1100000,
  claimed_approval_state:'UNVERIFIED_SUBMISSION',fixture_only:true,...patch};
}
function harness(s,intakeLedger,assignmentLedger){
 const claims=new Map(),pair=generateKeyPairSync('ed25519');
 const status=Object.fromEntries(names.map(role=>[role,{
  source_revision:1,revocation_sequence:0,revoked:false}]));
 let clock=1000000,active=true,attestationExpiry=1050000,
  attestationOrg=org,badSignature=false;
 const intake=createIsolatedEvidenceIntakeQuarantine({
  ledger:intakeLedger,getFixtureNow:()=>1000000});
 async function add(role,i,patch={}){
  const claim=makeClaim(s,role,i,patch);
  const result=await intake.receive(claim);
  assert.equal(result.intake_recorded,true,JSON.stringify(result));
  claims.set(claim.submission_id,claim);
  return claim;
 }
 async function seed(num=6,patches={}){
  for(let i=0;i<num;i++)await add(names[i],i+1,patches[names[i]]||{});
 }
 const readFixtureClaim=async({submission_id})=>{
  const c=claims.get(submission_id);return c?structuredClone(c):null;
 };
 const readFixtureSourceStatus=async({scope:sc,owner_role})=>({
  schema_version:'v3.2-113-ci-source-status-v1',...sc,owner_role,
  source_revision:status[owner_role].source_revision,
  revocation_sequence:status[owner_role].revocation_sequence,
  revoked:status[owner_role].revoked,observed_at_ms:clock,fixture_only:true
 });
 const readSignedFixtureReviewer=async({scope:sc,reviewer_id})=>{
  const p={schema_version:'v3.2-113-ci-reviewer-attestation-v1',
   ...sc,organization_id:attestationOrg,reviewer_id,
   reviewer_role:'independent_evidence_reviewer',active,
   authorization_revision:1,revocation_sequence:0,
   issued_at_ms:999900,expires_at_ms:attestationExpiry,fixture_only:true};
  const signer=badSignature?generateKeyPairSync('ed25519').privateKey:pair.privateKey;
  return {...p,signature:sign(null,Buffer.from(JSON.stringify(p)),signer)
   .toString('base64url')};
 };
 const assigner=(extra={})=>createIsolatedReviewerAssignment({
  intakeLedger,assignmentLedger,readFixtureClaim,readFixtureSourceStatus,
  readSignedFixtureReviewer,fixtureReviewerPublicKey:pem(pair),
  getFixtureNow:()=>clock,...extra});
 return {s,claims,status,intake,add,seed,assigner,readFixtureClaim,
  readFixtureSourceStatus,readSignedFixtureReviewer,pair,
  time:t=>{clock=t;},active:v=>{active=v;},expiry:v=>{attestationExpiry=v;},
  org:v=>{attestationOrg=v;},bad:v=>{badSignature=v;}};
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
  const intakeLedger=createIsolatedPostgresEvidenceIntakeLedger({pool});
  const assignmentLedger=createIsolatedPostgresReviewerAssignmentLedger({pool});
  const h=harness(scope(n),intakeLedger,assignmentLedger);
  return await fn({pool,intakeLedger,assignmentLedger,h});
 }finally{await pool.end();}
}
const review=h=>({...h.s,reviewer_id:reviewer});
test('REVIEW-01 six untrusted role claims and distinct signed fixture reviewer persist only pending SQL audit',async()=>{
 await using(11301,async({h,assignmentLedger})=>{
  await h.seed();const r=await h.assigner().assign(review(h));safe(r);
  assert.equal(r.reason_code,'BLOCKED_FIXTURE_REVIEW_ASSIGNED_NO_REAL_AUTHORITY');
  assert.equal(r.fixture_review_assignment_recorded,true);
  assert.equal(r.review_status,'PENDING_REAL_OWNER_CONFIRMATION');
  const row=await assignmentLedger.read(h.s);
  assert.equal(row.evidence_count,6);assert.equal(row.reviewer_id,reviewer);
  assert.equal(row.intake_head_sequence,6);assert.equal(sha(row),r.assignment_digest);
 });
});
test('REVIEW-02 missing one required role is incomplete and cannot allocate an auditor',async()=>{
 await using(11302,async({h,assignmentLedger})=>{
  await h.seed(5);const r=await h.assigner().assign(review(h));safe(r);
  assert.equal(r.reason_code,'BLOCKED_REVIEW_EVIDENCE_SLOTS_INCOMPLETE');
  assert.deepEqual(r.missing_roles,['database_owner']);
  assert.equal(await assignmentLedger.read(h.s),null);
 });
});
test('REVIEW-03 submitter or claimant cannot review their own or another domain evidence',async()=>{
 await using(11303,async({h,assignmentLedger})=>{
  await h.seed();
  for(const reviewer_id of [
   'sales_owner-submit ter-fixture-001'.replace(' ',''),
   'finance_owner-owner-fixture-001']){
   const r=await h.assigner().assign({...h.s,reviewer_id});safe(r);
   assert.equal(r.reason_code,'REVIEWER_CONFLICT_WITH_SUBMITTER_OR_OWNER');
  }
  assert.equal(await assignmentLedger.read(h.s),null);
 });
});
test('REVIEW-04 forged, inactive, expired or cross-tenant fixture reviewer credential denied',async()=>{
 let n=11304;
 for(const mutate of [
  h=>h.bad(true),h=>h.active(false),h=>h.expiry(999999),
  h=>h.org('22222222-2222-4222-8222-222222222222')]){
  await using(n++,async({h,assignmentLedger})=>{
   await h.seed();mutate(h);const r=await h.assigner().assign(review(h));safe(r);
   assert.ok(['REVIEWER_FIXTURE_ATTESTATION_INVALID',
    'REVIEWER_FIXTURE_INACTIVE_EXPIRED_OR_WRONG_SCOPE'].includes(r.reason_code));
   assert.equal(await assignmentLedger.read(h.s),null);
  });
 }
});
test('REVIEW-05 finance or academic source revision/revocation mismatch fails closed',async()=>{
 let n=11310;
 for(const patch of [{revoked:true},{revocation_sequence:1},{source_revision:2}]){
  await using(n++,async({h,assignmentLedger})=>{
   await h.seed();Object.assign(h.status.finance_owner,patch);
   const r=await h.assigner().assign(review(h));safe(r);
   assert.equal(r.reason_code,'REVIEW_SOURCE_REVOKED_OR_STALE');
   assert.equal(await assignmentLedger.read(h.s),null);
  });
 }
});
test('REVIEW-06 expired, tampered or unsigned V110 notice digest metadata blocks review',async()=>{
 await using(11314,async({h})=>{
  await h.seed();h.time(1100001);
  const r=await h.assigner().assign(review(h));safe(r);
  assert.equal(r.reason_code,'REVIEW_EVIDENCE_MISSING_EXPIRED_OR_TAMPERED');
 });
 await using(11315,async({h})=>{
  await h.seed();h.claims.values().next().value.evidence_digest='f'.repeat(64);
  const r=await h.assigner().assign(review(h));safe(r);
  assert.equal(r.reason_code,'REVIEW_EVIDENCE_MISSING_EXPIRED_OR_TAMPERED');
 });
 await using(11316,async({h})=>{
  await h.seed(6,{academic_owner:{linked_v110_notice_digest:null}});
  const r=await h.assigner().assign(review(h));safe(r);
  assert.equal(r.reason_code,'REVIEW_EVIDENCE_MISSING_EXPIRED_OR_TAMPERED');
 });
});
test('REVIEW-07 conflicting family and original historical source digest is rejected',async()=>{
 await using(11317,async({h})=>{
  await h.seed(6,{academic_owner:{family_id:family}});
  const r=await h.assigner().assign(review(h));safe(r);
  assert.equal(r.reason_code,'REVIEW_CROSS_MODULE_HISTORY_FAMILY_OR_NOTICE_CONFLICT');
 });
 await using(11318,async({h})=>{
  await h.seed(6,{finance_owner:{original_history_digest:'f'.repeat(64)}});
  const r=await h.assigner().assign(review(h));safe(r);
  assert.equal(r.reason_code,'REVIEW_CROSS_MODULE_HISTORY_FAMILY_OR_NOTICE_CONFLICT');
 });
});
test('REVIEW-08 altered V112 SQL head cannot pass full event-chain validation',async()=>{
 await using(11319,async({h,pool,assignmentLedger})=>{
  await h.seed();
  await pool.query('UPDATE v106_test.evidence_intake_heads SET event_digest=$1 WHERE organization_id=$2 AND incident_id=$3 AND student_id=$4',
   ['f'.repeat(64),org,h.s.incident_id,student]);
  const r=await h.assigner().assign(review(h));safe(r);
  assert.equal(r.reason_code,'REVIEW_INTAKE_CHAIN_MISSING_OR_UNVERIFIED');
  assert.equal(await assignmentLedger.read(h.s),null);
 });
});
test('REVIEW-09 intake changed AFTER SQL assignment means no fixture-current confirmation',async()=>{
 await using(11320,async({h,assignmentLedger})=>{
  await h.seed();
  const r=await h.assigner({afterAssignmentWrite:async()=>h.add('sales_owner',7)})
   .assign(review(h));safe(r);
  assert.equal(r.reason_code,'REVIEW_ASSIGNMENT_OR_INTAKE_CHANGED_AFTER_COMMIT');
  assert.equal((await assignmentLedger.read(h.s)).status,'PENDING_REAL_OWNER_CONFIRMATION');
 });
});
test('REVIEW-10 delayed source revocation or reviewer loss after SQL assignment cannot approve',async()=>{
 await using(11321,async({h,assignmentLedger})=>{
  await h.seed();const r=await h.assigner({afterAssignmentWrite:async()=>{
   h.status.finance_owner.revoked=true;}}).assign(review(h));safe(r);
  assert.equal(r.reason_code,'REVIEW_SOURCE_REVOKED_OR_STALE');
  assert.ok(await assignmentLedger.read(h.s));
 });
 await using(11322,async({h})=>{
  await h.seed();const r=await h.assigner({afterAssignmentWrite:async()=>h.active(false)})
   .assign(review(h));safe(r);
  assert.equal(r.reason_code,'REVIEWER_FIXTURE_INACTIVE_EXPIRED_OR_WRONG_SCOPE');
 });
});
test('REVIEW-11 SQL error before COMMIT must roll back reviewer assignment',async()=>{
 await using(11323,async({h,pool,assignmentLedger})=>{
  await h.seed();
  const faulty=createIsolatedPostgresReviewerAssignmentLedger({
   pool,beforeCommit:async()=>{throw Error('fixture-precommit-rollback');}});
  const r=await h.assigner({assignmentLedger:faulty}).assign(review(h));safe(r);
  assert.equal(r.reason_code,'REVIEW_ASSIGNMENT_DEPENDENCY_UNAVAILABLE');
  assert.equal(await assignmentLedger.read(h.s),null);
 });
});
test('REVIEW-12 independent SQL writers cannot both assign a fixture reviewer',async()=>{
 await using(11324,async({h,assignmentLedger})=>{
  await h.seed();const p=poolFor();
  try{
   const other=createIsolatedPostgresReviewerAssignmentLedger({pool:p});
   const [a,b]=await Promise.all([
    h.assigner().assign(review(h)),
    h.assigner({assignmentLedger:other}).assign({...h.s,
     reviewer_id:'independent-reviewer-002'})
   ]);safe(a);safe(b);
   assert.equal([a,b].filter(x=>x.fixture_review_assignment_recorded).length,1);
   assert.equal([a,b].filter(x=>x.reason_code==='REVIEW_ASSIGNMENT_SQL_CONFLICT_OR_UNCERTAIN').length,1);
   assert.equal((await assignmentLedger.read(h.s)).evidence_count,6);
  }finally{await p.end();}
 });
});
test('REVIEW-13 wrong tenant reviewer SQL role cannot assign or read other scope',async()=>{
 await using(11325,async({h,assignmentLedger})=>{
  await h.seed();const p=poolFor('v106_writer_b');
  try{
   const other=createIsolatedPostgresReviewerAssignmentLedger({pool:p});
   const r=await h.assigner({assignmentLedger:other}).assign(review(h));safe(r);
   assert.equal(r.fixture_review_assignment_recorded,false);
   assert.equal(await assignmentLedger.read(h.s),null);
  }finally{await p.end();}
 });
});
test('REVIEW-14 assignment table immutable to writer, payments still inaccessible',async()=>{
 await using(11326,async({h,pool,assignmentLedger})=>{
  await h.seed();const r=await h.assigner().assign(review(h));safe(r);
  assert.equal(r.fixture_review_assignment_recorded,true);
  await assert.rejects(pool.query(
   'UPDATE v106_test.fixture_reviewer_assignments SET reviewer_id=$1 WHERE incident_id=$2',
   ['forged-reviewer',h.s.incident_id]),/permission denied/i);
  await assert.rejects(pool.query(
   'DELETE FROM v106_test.fixture_reviewer_assignments WHERE incident_id=$1',
   [h.s.incident_id]),/permission denied/i);
  await assert.rejects(pool.query(
   'UPDATE v106_test.protected_business_fixture SET example_payment_amount=0'),
   /permission denied/i);
  assert.equal((await assignmentLedger.read(h.s)).reviewer_id,reviewer);
 });
});
test('REVIEW-15 replayed reviewer assignment never upgrades real authority',async()=>{
 await using(11327,async({h,assignmentLedger})=>{
  await h.seed();const first=await h.assigner().assign(review(h));safe(first);
  assert.equal(first.fixture_review_assignment_recorded,true);
  const second=await h.assigner().assign(review(h));safe(second);
  assert.equal(second.reason_code,'REVIEW_ASSIGNMENT_SQL_CONFLICT_OR_UNCERTAIN');
  assert.equal(second.external_reviewer_appointed,false);
  assert.equal((await assignmentLedger.read(h.s)).status,'PENDING_REAL_OWNER_CONFIRMATION');
 });
});
test('REVIEW-16 optional sibling family remains student-first without approval',async()=>{
 await using(11328,async({h})=>{
  const families=Object.fromEntries(names.map(role=>[role,{family_id:family}]));
  await h.seed(6,families);
  const r=await h.assigner().assign(review(h));safe(r);
  assert.equal(r.fixture_review_assignment_recorded,true);
  assert.equal(r.handoff_allowed,false);
 });
});
test('REVIEW-17 malformed scope or caller-triggered finance release is refused',async()=>{
 await using(11329,async({h,assignmentLedger})=>{
  await h.seed();
  for(const bad of [
   {...review(h),finance_authorized:true},
   {...h.s,reviewer_id:'bad'},
   {...review(h),student_id:'not-a-uuid'}
  ]){
   const r=await h.assigner().assign(bad);safe(r);
   assert.equal(r.reason_code,'INVALID_REVIEW_ASSIGNMENT_SCOPE');
  }
  assert.equal(await assignmentLedger.read(h.s),null);
  assert.throws(()=>createIsolatedReviewerAssignment({}),TypeError);
 });
});
