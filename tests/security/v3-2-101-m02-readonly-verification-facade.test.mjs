import test from 'node:test';
import assert from 'node:assert/strict';
import {createIsolatedFinalReviewSnapshot} from '../../src/cross-module-final-review-snapshot.mjs';
import {createIsolatedFinalReviewAttestation} from '../../src/cross-module-final-review-attestation.mjs';
import {createIsolatedAttestationLifecycle} from '../../src/cross-module-attestation-lifecycle.mjs';
import {createIsolatedReadOnlyVerificationFacade} from '../../src/cross-module-readonly-verification-facade.mjs';
const org='11111111-1111-4111-8111-111111111111';
const incident='33333333-3333-4333-8333-333333333333';
const GAPS=['finance_independent_signature','academic_independent_signature',
 'order_payment_reconciliation','lesson_entitlement_reconciliation',
 'three_party_acceptance','atomic_handoff_receipt'];
const actions=['apply','review_sales','review_finance','review_academic','acknowledge'];
function setup(){
 let time=1000000000,revision=1,revocation=0,generation=1,task=true;
 let recovered=true,failUnified=false,watermarkBad=false;
 const inactive=new Set();
 const roles={
  sales_applicant:'sales',sales_reviewer:'sales',
  finance_reviewer:'finance',academic_reviewer:'academic',
  sales_receiver:'sales',sales_auditor:'sales',
  sales_applicant_new:'sales',sales_reviewer_new:'sales',
  finance_reviewer_new:'finance',academic_reviewer_new:'academic',
  sales_receiver_new:'sales'
 };
 const scope={organization_id:org,incident_id:incident};
 const reference={...scope,
  final_reference:{source_digest:'1'.repeat(64),revocation_reference:{}},
  diff_reference:{...scope,previous_audit_sequence:1,
   previous_audit_digest:'2'.repeat(64),new_audit_sequence:2,
   new_audit_digest:'3'.repeat(64)}};
 const getFixtureNow=()=>time;
 const getFixtureWatermark=async()=>({
  ...scope,source_epoch:1,source_revision:revision,
  revocation_sequence:revocation,revocation_digest:'e'.repeat(64),
  incident_generation:generation,evidence_digest:watermarkBad?'invalid':'f'.repeat(64)});
 const unifiedRecoveryGate={report:async()=>({
  reason_code:failUnified?'RECOVERY_CONCLUSION_REACCEPTANCE_REQUIRED':
   'BLOCKED_EXTERNAL_HANDOFF_WITH_CURRENT_FIXTURE_RECOVERY',
  fixture_combined_consistency:!failUnified,
  fixture_recovery_current:!failUnified,
  hold_active:true,handoff_allowed:false,compensation_write_allowed:false,
  release_eligible:false,finance_authorized:false,academic_authorized:false,
  external_authority_verified:false,
  comparison_digest:'a'.repeat(64),recovery_expires_at_ms:1086400000,
  remaining_count:task?1:0,
  pending_tasks:task?[{item:'finance_signature',owner_department:'finance',
   status:'pending',difference_digest:'b'.repeat(64)}]:[],
  external_requirements:GAPS.map(code=>({code,status:'requires_external_authority'}))})};
 const recoveryConclusion={report:async()=>({
  reason_code:'BLOCKED_CONCLUSION_NOT_BUSINESS_AUTHORIZATION',
  fixture_conclusion_current:recovered,
  status:recovered?'fixture_current_not_authorized':'explicitly_revoked',
  history_repair_allowed:false,automatic_recovery_allowed:false,
  external_authority_verified:false,finance_authorized:false,
  academic_authorized:false,handoff_allowed:false,
  compensation_write_allowed:false,release_eligible:false,hold_active:true,
  current_source_fingerprint:'c'.repeat(64),expires_at_ms:1086400000,
  history_count:5,events:[{action:'apply'},{action:'review_sales'},
   {action:'review_finance'},{action:'review_academic'},
   {action:'conclude',event_digest:'d'.repeat(64),
    source_fingerprint:'c'.repeat(64),expires_at_ms:1086400000,
    hold_active:true,handoff_allowed:false}]})};
 const getFixtureActor=async(_,actor_id)=>roles[actor_id]?{
  actor_id,organization_id:org,role:roles[actor_id],
  active:!inactive.has(actor_id),fixture_only:true}:null;
 const finalReview=createIsolatedFinalReviewSnapshot({
  unifiedRecoveryGate,recoveryConclusion,getFixtureWatermark,getFixtureNow});
 const attestation=createIsolatedFinalReviewAttestation({
  finalReview,getFixtureActor,getFixtureNow});
 const lifecycle=createIsolatedAttestationLifecycle({
  finalReview,attestation,getFixtureActor,getFixtureNow});
 const facade=createIsolatedReadOnlyVerificationFacade({
  unifiedRecoveryGate,finalReview,attestation,
  attestationLifecycle:lifecycle,getFixtureWatermark});
 async function sign(v='old'){
  const capture=await finalReview.capture({reference,
   idempotency_key:'v101-review-snapshot-'+v+'-nonce-00001',
   afterFirstRead:async()=>{}});
  assert.equal(capture.reason_code,'BLOCKED_FINAL_REVIEW_SNAPSHOT_RECORDED');
  const snapshot_digest=capture.snapshot.snapshot_digest;
  const names=v==='old'?['sales_applicant','sales_reviewer',
   'finance_reviewer','academic_reviewer','sales_receiver']:
   ['sales_applicant_new','sales_reviewer_new','finance_reviewer_new',
    'academic_reviewer_new','sales_receiver_new'];
  let acknowledgement_digest=null;
  for(let i=0;i<5;i++){
   const r=await attestation.step({reference,snapshot_digest,action:actions[i],
    actor_id:names[i],idempotency_key:'v101-'+v+'-step-'+i+'-nonce-00001'});
   assert.equal(r.reason_code,'BLOCKED_ATTESTATION_EVENT_RECORDED',actions[i]);
   acknowledgement_digest=r.record.event_digest;
  }
  return {snapshot_digest,acknowledgement_digest};
 }
 const verify=(receipt,afterFirstRead=async()=>{})=>facade.verify({
  reference,snapshot_digest:receipt.snapshot_digest,
  acknowledgement_digest:receipt.acknowledgement_digest,afterFirstRead});
 const revoke=(receipt)=>lifecycle.revoke({
  reference,...receipt,reason_code:'administrative_retraction',
  actor_id:'sales_auditor',idempotency_key:'v101-revocation-nonce-00001'});
 return {facade,finalReview,attestation,lifecycle,reference,sign,verify,revoke,
  setRevision:n=>revision=n,setRevocation:n=>revocation=n,
  setGeneration:n=>generation=n,setTask:n=>task=n,
  setUnifiedBad:n=>failUnified=n,setRecovered:n=>recovered=n,
  setTime:n=>time=n,setWatermarkBad:n=>watermarkBad=n,
  deactivate:id=>inactive.add(id)};
}
function safe(r){
 assert.ok(Object.isFrozen(r));
 assert.equal(r.hold_active,true);
 for(const name of ['external_authority_verified','finance_authorized',
  'academic_authorized','handoff_allowed','compensation_write_allowed',
  'release_eligible','production_integration_allowed'])
  assert.equal(r[name],false,name);
}
test('V3.2-101 complete five-person CI review is still blocked by six external gaps',async()=>{
 const x=setup(),receipt=await x.sign(),result=await x.verify(receipt);safe(result);
 assert.equal(result.reason_code,'BLOCKED_CURRENT_FIXTURE_REVIEW_WITH_EXTERNAL_GAPS');
 assert.equal(result.fixture_internal_review_current,true);
 assert.equal(result.external_gap_count,6);
 assert.equal(result.pending_task_count,1);
 assert.equal(result.snapshot_digest,receipt.snapshot_digest);
 assert.equal(result.acknowledgement_digest,receipt.acknowledgement_digest);
});
test('V3.2-101 V98 alone still reports current after V99 explicit revoke; facade blocks bypass',async()=>{
 const x=setup(),receipt=await x.sign();
 const revoked=await x.revoke(receipt);
 assert.equal(revoked.reason_code,'BLOCKED_ADMINISTRATIVE_REVOCATION_RECORDED');
 const older=await x.attestation.report({reference:x.reference,
  snapshot_digest:receipt.snapshot_digest});
 assert.equal(older.fixture_acknowledgement_current,true);
 const result=await x.verify(receipt);safe(result);
 assert.equal(result.fixture_internal_review_current,false);
 assert.equal(result.reason_code,'LIFECYCLE_REVOKED_OR_STALE');
 assert.equal(result.lifecycle_reason,'ACKNOWLEDGEMENT_EXPLICITLY_REVOKED');
});
test('V3.2-101 source, revocation, incident and pending task revisions fail closed',async()=>{
 for(const update of [x=>x.setRevision(2),x=>x.setRevocation(1),
  x=>x.setGeneration(2),x=>x.setTask(false)]){
  const x=setup(),receipt=await x.sign();update(x);
  const result=await x.verify(receipt);safe(result);
  assert.equal(result.fixture_internal_review_current,false);
  assert.equal(result.reason_code,'FINAL_REVIEW_SNAPSHOT_NOT_CURRENT');
 }
});
test('V3.2-101 revoked staff, expired conclusion and invalid source identity fail closed',async()=>{
 for(const update of [x=>x.deactivate('finance_reviewer'),
  x=>x.setTime(1086400000),x=>x.setRecovered(false),
  x=>x.setWatermarkBad(true)]){
  const x=setup(),receipt=await x.sign();update(x);
  const result=await x.verify(receipt);safe(result);
  assert.equal(result.fixture_internal_review_current,false);
 }
});
test('V3.2-101 after-first-read revocation or evidence mutation cannot reuse old proof',async()=>{
 const x=setup(),receipt=await x.sign();
 let result=await x.verify(receipt,async()=>{await x.revoke(receipt);});safe(result);
 assert.equal(result.reason_code,'LIFECYCLE_REVOKED_OR_STALE');
 const y=setup(),second=await y.sign();
 result=await y.verify(second,async()=>y.setRevision(2));safe(result);
 assert.equal(result.reason_code,'FINAL_REVIEW_SNAPSHOT_NOT_CURRENT');
});
test('V3.2-101 rejects cross-tenant, forged release, mismatched and missing receipts',async()=>{
 const x=setup(),receipt=await x.sign();
 const variants=[
  {...x.reference,organization_id:'22222222-2222-4222-8222-222222222222'},
  {...x.reference,diff_reference:{...x.reference.diff_reference,
   incident_id:'44444444-4444-4444-8444-444444444444'}}];
 for(const reference of variants){
  const result=await x.facade.verify({reference,...receipt,
   afterFirstRead:async()=>{}});safe(result);
  assert.equal(result.reason_code,'INVALID_READ_ONLY_VERIFICATION_INPUT');
 }
 let result=await x.facade.verify({reference:x.reference,...receipt,
  handoff_allowed:true,afterFirstRead:async()=>{}});safe(result);
 assert.equal(result.reason_code,'INVALID_READ_ONLY_VERIFICATION_INPUT');
 result=await x.facade.verify({reference:x.reference,
  snapshot_digest:receipt.snapshot_digest,
  acknowledgement_digest:'a'.repeat(64),afterFirstRead:async()=>{}});safe(result);
 assert.equal(result.fixture_internal_review_current,false);
 result=await x.facade.verify({reference:x.reference,
  snapshot_digest:receipt.snapshot_digest,afterFirstRead:async()=>{}});safe(result);
 assert.equal(result.reason_code,'INVALID_READ_ONLY_VERIFICATION_INPUT');
});
test('V3.2-101 new five-step review with new snapshot does not revive the old one',async()=>{
 const x=setup(),old=await x.sign();
 await x.revoke(old);
 x.setRevision(2);
 const fresh=await x.sign('new');
 const bad=await x.verify(old);safe(bad);
 assert.equal(bad.fixture_internal_review_current,false);
 const good=await x.verify(fresh);safe(good);
 assert.equal(good.fixture_internal_review_current,true);
 assert.equal(good.handoff_allowed,false);
});
test('V3.2-101 untrusted dependent report never becomes an allow signal',async()=>{
 const x=setup(),receipt=await x.sign();
 x.setUnifiedBad(true);
 const result=await x.verify(receipt);safe(result);
 assert.equal(result.reason_code,'UNIFIED_GATE_NOT_VERIFIED');
 assert.equal(result.fixture_internal_review_current,false);
 assert.throws(()=>createIsolatedReadOnlyVerificationFacade({}),
  {name:'TypeError'});
});
