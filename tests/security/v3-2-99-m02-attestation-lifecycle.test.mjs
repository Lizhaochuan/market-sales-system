import test from 'node:test';
import assert from 'node:assert/strict';
import {createIsolatedFinalReviewSnapshot} from '../../src/cross-module-final-review-snapshot.mjs';
import {createIsolatedFinalReviewAttestation} from '../../src/cross-module-final-review-attestation.mjs';
import {createIsolatedAttestationLifecycle} from '../../src/cross-module-attestation-lifecycle.mjs';
const org='11111111-1111-4111-8111-111111111111';
const incident='33333333-3333-4333-8333-333333333333';
const gaps=['finance_independent_signature','academic_independent_signature',
 'order_payment_reconciliation','lesson_entitlement_reconciliation',
 'three_party_acceptance','atomic_handoff_receipt'];
const actions=['apply','review_sales','review_finance','review_academic','acknowledge'];
function fixture(){
 let time=1000000000,revision=1,conclusionCurrent=true;
 const inactive=new Set();
 const roles={
  sales_applicant:'sales',sales_reviewer:'sales',finance_reviewer:'finance',
  academic_reviewer:'academic',sales_receiver:'sales',sales_auditor:'sales',
  sales_applicant_new:'sales',sales_reviewer_new:'sales',
  finance_reviewer_new:'finance',academic_reviewer_new:'academic',
  sales_receiver_new:'sales',sales_auditor_new:'sales'
 };
 const unifiedRecoveryGate={report:async()=>({
  reason_code:'BLOCKED_EXTERNAL_HANDOFF_WITH_CURRENT_FIXTURE_RECOVERY',
  fixture_combined_consistency:true,fixture_recovery_current:true,
  hold_active:true,handoff_allowed:false,compensation_write_allowed:false,
  release_eligible:false,external_authority_verified:false,
  finance_authorized:false,academic_authorized:false,
  comparison_digest:'a'.repeat(64),recovery_expires_at_ms:1086400000,
  remaining_count:1,pending_tasks:[{item:'finance_signature',
   owner_department:'finance',status:'pending',difference_digest:'b'.repeat(64)}],
  external_requirements:gaps.map(code=>({code,status:'requires_external_authority'}))})};
 const recoveryConclusion={report:async()=>({
  reason_code:'BLOCKED_CONCLUSION_NOT_BUSINESS_AUTHORIZATION',
  fixture_conclusion_current:conclusionCurrent,
  status:conclusionCurrent?'fixture_current_not_authorized':'explicitly_revoked',
  history_repair_allowed:false,automatic_recovery_allowed:false,
  external_authority_verified:false,finance_authorized:false,
  academic_authorized:false,handoff_allowed:false,compensation_write_allowed:false,
  release_eligible:false,hold_active:true,current_source_fingerprint:'c'.repeat(64),
  expires_at_ms:1086400000,history_count:5,
  events:[{action:'apply'},{action:'review_sales'},{action:'review_finance'},
   {action:'review_academic'},{action:'conclude',event_digest:'d'.repeat(64),
    source_fingerprint:'c'.repeat(64),expires_at_ms:1086400000,
    hold_active:true,handoff_allowed:false}]})};
 const watermark=async()=>({organization_id:org,incident_id:incident,
  source_epoch:1,source_revision:revision,revocation_sequence:0,
  revocation_digest:'e'.repeat(64),incident_generation:1,
  evidence_digest:'f'.repeat(64)});
 const actor=async(_,id)=>roles[id]?{
  actor_id:id,organization_id:org,role:roles[id],
  active:!inactive.has(id),fixture_only:true}:null;
 const ref={organization_id:org,incident_id:incident,
  final_reference:{source_digest:'1'.repeat(64),revocation_reference:{}},
  diff_reference:{organization_id:org,incident_id:incident,
   previous_audit_sequence:1,previous_audit_digest:'2'.repeat(64),
   new_audit_sequence:2,new_audit_digest:'3'.repeat(64)}};
 const getFixtureNow=()=>time;
 const finalReview=createIsolatedFinalReviewSnapshot({
  unifiedRecoveryGate,recoveryConclusion,
  getFixtureWatermark:watermark,getFixtureNow});
 const attestation=createIsolatedFinalReviewAttestation({
  finalReview,getFixtureActor:actor,getFixtureNow});
 const lifecycle=createIsolatedAttestationLifecycle({
  finalReview,attestation,getFixtureActor:actor,getFixtureNow});
 const scope={organization_id:org,incident_id:incident};
 async function sign(version='old'){
  const n='v99-final-snapshot-'+version+'-nonce-00001';
  const frozen=await finalReview.capture({
   reference:ref,idempotency_key:n,afterFirstRead:async()=>{}});
  assert.equal(frozen.reason_code,'BLOCKED_FINAL_REVIEW_SNAPSHOT_RECORDED');
  const digest=frozen.snapshot.snapshot_digest;
  const names=version==='old'?['sales_applicant','sales_reviewer',
   'finance_reviewer','academic_reviewer','sales_receiver']:
   ['sales_applicant_new','sales_reviewer_new','finance_reviewer_new',
    'academic_reviewer_new','sales_receiver_new'];
  let receipt=null;
  for(let i=0;i<5;i++){
   const x=await attestation.step({reference:ref,snapshot_digest:digest,
    action:actions[i],actor_id:names[i],
    idempotency_key:'v99-'+version+'-step-'+i+'-nonce-00001'});
   assert.equal(x.reason_code,'BLOCKED_ATTESTATION_EVENT_RECORDED');
   receipt=x.record.event_digest;
  }
  return {snapshot_digest:digest,acknowledgement_digest:receipt,names};
 }
 const revoke=(old,actor_id='sales_auditor',
  nonce='v99-revoke-admin-nonce-00001',reason_code='administrative_retraction')=>
  lifecycle.revoke({reference:ref,snapshot_digest:old.snapshot_digest,
   acknowledgement_digest:old.acknowledgement_digest,
   reason_code,actor_id,idempotency_key:nonce});
 const resign=(old,newer,actor_id='sales_auditor',
  nonce='v99-resign-link-nonce-00001')=>
  lifecycle.recordResign({reference:ref,old_snapshot_digest:old.snapshot_digest,
   old_acknowledgement_digest:old.acknowledgement_digest,
   new_snapshot_digest:newer.snapshot_digest,
   new_acknowledgement_digest:newer.acknowledgement_digest,
   actor_id,idempotency_key:nonce});
 const inspect=x=>lifecycle.inspect({reference:ref,
  snapshot_digest:x.snapshot_digest,
  acknowledgement_digest:x.acknowledgement_digest});
 return {lifecycle,attestation,finalReview,ref,scope,sign,revoke,resign,inspect,
  setRevision:x=>revision=x,setTime:x=>time=x,
  setConclusion:x=>conclusionCurrent=x,revokeActor:x=>inactive.add(x)};
}
function safe(r){
 assert.equal(r.hold_active,true);
 for(const field of ['external_authority_verified','finance_authorized',
  'academic_authorized','handoff_allowed','compensation_write_allowed',
  'release_eligible','production_integration_allowed'])assert.equal(r[field],false,field);
 assert.equal(Object.isFrozen(r),true);
}
test('V3.2-99 current acknowledgement is only internal, explicit independent revoke is permanent',async()=>{
 const f=fixture(),old=await f.sign();
 let r=await f.inspect(old);safe(r);
 assert.equal(r.fixture_acknowledgement_current,true);
 assert.equal(r.reason_code,'BLOCKED_CURRENT_ADMINISTRATIVE_ACKNOWLEDGEMENT');
 r=await f.revoke(old);safe(r);
 assert.equal(r.reason_code,'BLOCKED_ADMINISTRATIVE_REVOCATION_RECORDED');
 r=await f.inspect(old);safe(r);
 assert.equal(r.reason_code,'ACKNOWLEDGEMENT_EXPLICITLY_REVOKED');
 assert.equal(r.fixture_acknowledgement_current,false);
 assert.equal(f.lifecycle.audit(f.scope).length,1);
});
test('V3.2-99 self revocation, repeat conflict and same nonce replay fail closed',async()=>{
 const f=fixture(),old=await f.sign();
 let r=await f.revoke(old,'sales_applicant');safe(r);
 assert.equal(r.reason_code,'REVOCATION_ACTOR_NOT_INDEPENDENT');
 const first=await f.revoke(old),replay=await f.revoke(old);safe(first);safe(replay);
 assert.equal(replay.reason_code,'BLOCKED_HISTORICAL_REVOCATION_REPLAY');
 r=await f.revoke(old,'sales_auditor','v99-revoke-admin-nonce-00001',
  'review_error');safe(r);
 assert.equal(r.reason_code,'LIFECYCLE_IDEMPOTENCY_CONFLICT');
 r=await f.revoke(old,'sales_auditor','v99-revoke-admin-nonce-00002');
 safe(r);assert.equal(r.reason_code,'ACKNOWLEDGEMENT_ALREADY_REVOKED');
 assert.equal(f.lifecycle.audit(f.scope).length,1);
});
test('V3.2-99 revoked participant, source change, expiry or conclusion revoke invalidates receipt',async()=>{
 for(const change of [
  f=>f.revokeActor('finance_reviewer'),
  f=>f.setRevision(2),
  f=>f.setTime(1086400000),
  f=>f.setConclusion(false)
 ]){
  const f=fixture(),old=await f.sign();change(f);
  const r=await f.inspect(old);safe(r);
  assert.equal(r.fixture_acknowledgement_current,false);
  assert.equal(r.reason_code,'CURRENT_ACKNOWLEDGEMENT_STALE_OR_REVOKED');
 }
});
test('V3.2-99 re-sign requires a new current snapshot and all five independent new reviews',async()=>{
 const f=fixture(),old=await f.sign();
 await f.revoke(old);
 f.setRevision(2);
 const newer=await f.sign('new');
 let r=await f.resign(old,newer);safe(r);
 assert.equal(r.reason_code,'BLOCKED_RESIGN_LINEAGE_RECORDED');
 assert.equal(r.fixture_resign_link_recorded,true);
 assert.equal(r.record.old_acknowledgement_digest,old.acknowledgement_digest);
 assert.equal(r.record.new_acknowledgement_digest,newer.acknowledgement_digest);
 r=await f.inspect(old);safe(r);
 assert.equal(r.reason_code,'ACKNOWLEDGEMENT_EXPLICITLY_REVOKED');
 r=await f.inspect(newer);safe(r);
 assert.equal(r.fixture_acknowledgement_current,true);
 assert.equal(f.lifecycle.audit(f.scope).length,2);
 const replay=await f.resign(old,newer);safe(replay);
 assert.equal(replay.reason_code,'BLOCKED_HISTORICAL_RESIGN_LINK_REPLAY');
});
test('V3.2-99 new snapshot without full signing cannot be linked',async()=>{
 const f=fixture(),old=await f.sign();
 f.setRevision(2);
 const captured=await f.finalReview.capture({reference:f.ref,
  idempotency_key:'v99-incomplete-snapshot-nonce-00001',
  afterFirstRead:async()=>{}});
 assert.equal(captured.reason_code,'BLOCKED_FINAL_REVIEW_SNAPSHOT_RECORDED');
 const r=await f.lifecycle.recordResign({reference:f.ref,
  old_snapshot_digest:old.snapshot_digest,
  old_acknowledgement_digest:old.acknowledgement_digest,
  new_snapshot_digest:captured.snapshot.snapshot_digest,
  new_acknowledgement_digest:'a'.repeat(64),
  actor_id:'sales_auditor',idempotency_key:'v99-false-resign-nonce-00001'});safe(r);
 assert.equal(r.fixture_resign_link_recorded,false);
 assert.equal(f.lifecycle.audit(f.scope).length,0);
});
test('V3.2-99 signing lineage independent auditor, forged scope and stale new receipt fail',async()=>{
 const f=fixture(),old=await f.sign();f.setRevision(2);
 const newer=await f.sign('new');
 let r=await f.resign(old,newer,'sales_receiver_new');safe(r);
 assert.equal(r.reason_code,'RESIGN_LINK_ACTOR_NOT_INDEPENDENT');
 r=await f.resign(old,newer,'sales_auditor');safe(r);
 assert.equal(r.fixture_resign_link_recorded,true);
 r=await f.resign(old,newer,'sales_auditor','v99-resign-link-nonce-00002');safe(r);
 assert.equal(r.reason_code,'RESIGN_LINEAGE_FORK_OR_DUPLICATE');
 f.setRevision(3);
 r=await f.inspect(newer);safe(r);
 assert.equal(r.fixture_acknowledgement_current,false);
 const forged=await f.lifecycle.revoke({...f.ref,...old,reason_code:'review_error',
  actor_id:'sales_auditor',idempotency_key:'v99-forged-tenant-nonce-00001',
  handoff_allowed:true});safe(forged);
 assert.equal(forged.reason_code,'INVALID_REVOKE_REQUEST');
});
test('V3.2-99 concurrent revocation serializes and preserves one chained event',async()=>{
 const f=fixture(),old=await f.sign();
 const [a,b]=await Promise.all([f.revoke(old),f.revoke(old)]);
 safe(a);safe(b);
 assert.equal(a.reason_code,'BLOCKED_ADMINISTRATIVE_REVOCATION_RECORDED');
 assert.equal(b.reason_code,'BLOCKED_HISTORICAL_REVOCATION_REPLAY');
 assert.equal(f.lifecycle.audit(f.scope).length,1);
});
