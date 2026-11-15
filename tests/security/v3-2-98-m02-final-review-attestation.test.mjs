import test from 'node:test';
import assert from 'node:assert/strict';
import {createIsolatedFinalReviewSnapshot} from '../../src/cross-module-final-review-snapshot.mjs';
import {createIsolatedFinalReviewAttestation} from '../../src/cross-module-final-review-attestation.mjs';
const org='11111111-1111-4111-8111-111111111111';
const incident='33333333-3333-4333-8333-333333333333';
const gaps=['finance_independent_signature','academic_independent_signature',
 'order_payment_reconciliation','lesson_entitlement_reconciliation',
 'three_party_acceptance','atomic_handoff_receipt'];
const steps=[
 ['apply','sales_applicant'],
 ['review_sales','sales_reviewer'],
 ['review_finance','finance_reviewer'],
 ['review_academic','academic_reviewer'],
 ['acknowledge','sales_receiver']
];
function setup(){
 let time=1000000000,revision=1,taskPending=true,conclusion='current';
 const inactive=new Set(),roles={
  sales_applicant:'sales',sales_reviewer:'sales',sales_receiver:'sales',
  finance_reviewer:'finance',academic_reviewer:'academic',sales_alternative:'sales'
 };
 let duringActor=null;
 const unifiedRecoveryGate={report:async()=>({
  reason_code:'BLOCKED_EXTERNAL_HANDOFF_WITH_CURRENT_FIXTURE_RECOVERY',
  fixture_combined_consistency:true,fixture_recovery_current:true,
  hold_active:true,handoff_allowed:false,compensation_write_allowed:false,
  release_eligible:false,external_authority_verified:false,
  finance_authorized:false,academic_authorized:false,
  comparison_digest:'a'.repeat(64),recovery_expires_at_ms:1086400000,
  remaining_count:taskPending?1:0,
  pending_tasks:taskPending?[{item:'finance_signature',
   owner_department:'finance',status:'pending',difference_digest:'b'.repeat(64)}]:[],
  external_requirements:gaps.map(code=>({code,status:'requires_external_authority'}))})};
 const recoveryConclusion={report:async()=>({
  reason_code:'BLOCKED_CONCLUSION_NOT_BUSINESS_AUTHORIZATION',
  fixture_conclusion_current:conclusion==='current',
  status:conclusion==='current'?'fixture_current_not_authorized':conclusion,
  history_repair_allowed:false,automatic_recovery_allowed:false,
  external_authority_verified:false,finance_authorized:false,academic_authorized:false,
  handoff_allowed:false,compensation_write_allowed:false,release_eligible:false,
  hold_active:true,current_source_fingerprint:'c'.repeat(64),
  expires_at_ms:1086400000,history_count:5,
  events:[{action:'apply'},{action:'review_sales'},{action:'review_finance'},
   {action:'review_academic'},{action:'conclude',event_digest:'d'.repeat(64),
    source_fingerprint:'c'.repeat(64),expires_at_ms:1086400000,
    hold_active:true,handoff_allowed:false}]})};
 const getFixtureWatermark=async()=>({organization_id:org,incident_id:incident,
  source_epoch:1,source_revision:revision,revocation_sequence:0,
  revocation_digest:'e'.repeat(64),incident_generation:1,
  evidence_digest:'f'.repeat(64)});
 const getFixtureNow=()=>time;
 const finalReview=createIsolatedFinalReviewSnapshot({
  unifiedRecoveryGate,recoveryConclusion,getFixtureWatermark,getFixtureNow});
 const attest=createIsolatedFinalReviewAttestation({finalReview,getFixtureNow,
  getFixtureActor:async(_,id)=>{
   if(duringActor){const call=duringActor;duringActor=null;call();}
   return roles[id]?{actor_id:id,role:roles[id],organization_id:org,
    active:!inactive.has(id),fixture_only:true}:null;
  }});
 const reference={organization_id:org,incident_id:incident,
  final_reference:{source_digest:'1'.repeat(64),revocation_reference:{}},
  diff_reference:{organization_id:org,incident_id:incident,
   previous_audit_sequence:1,previous_audit_digest:'2'.repeat(64),
   new_audit_sequence:2,new_audit_digest:'3'.repeat(64)}};
 async function snapshot(nonce='v98-source-snapshot-nonce-00001'){
  const r=await finalReview.capture({
   reference,idempotency_key:nonce,afterFirstRead:async()=>{}});
  assert.equal(r.reason_code,'BLOCKED_FINAL_REVIEW_SNAPSHOT_RECORDED');
  return r.snapshot.snapshot_digest;
 }
 const event=(digest,action,actor_id,nonce)=>({
  reference,snapshot_digest:digest,action,actor_id,idempotency_key:nonce});
 const doStep=async(digest,i,keySuffix='')=>attest.step(event(digest,
  steps[i][0],steps[i][1],'v98-review-nonce-'+i+'-00001'+keySuffix));
 async function finish(digest){
  for(let i=0;i<steps.length;i++){
   const r=await doStep(digest,i);
   assert.equal(r.reason_code,'BLOCKED_ATTESTATION_EVENT_RECORDED',steps[i][0]);
  }
 }
 return {attest,reference,snapshot,event,doStep,finish,
  setRevision:n=>revision=n,setPending:x=>taskPending=x,
  setConclusion:x=>conclusion=x,setTime:x=>time=x,
  revokeActor:id=>inactive.add(id),
  onActor:fn=>duringActor=fn};
}
function safe(r){
 assert.equal(r.hold_active,true);
 for(const k of ['external_authority_verified','finance_authorized','academic_authorized',
  'handoff_allowed','compensation_write_allowed','release_eligible',
  'production_integration_allowed'])assert.equal(r[k],false,k);
 assert.ok(Object.isFrozen(r));
}
test('V3.2-98 five distinct roles acknowledge only current CI snapshot',async()=>{
 const f=setup(),digest=await f.snapshot();
 await f.finish(digest);
 const r=await f.attest.report({reference:f.reference,snapshot_digest:digest});safe(r);
 assert.equal(r.fixture_acknowledgement_current,true);
 assert.equal(r.completed_steps,5);
 assert.equal(r.reason_code,'BLOCKED_CI_ATTESTATION_COMPLETE_NO_EXTERNAL_AUTHORITY');
 assert.equal(r.acknowledgement_digest,r.events.at(-1).event_digest);
 assert.equal(r.events.at(-1).snapshot_digest,digest);
 assert.equal(new Set(r.events.map(x=>x.actor_id)).size,5);
});
test('V3.2-98 missing checks, applicant self review and unauthorized actor cannot sign',async()=>{
 const f=setup(),digest=await f.snapshot();
 let r=await f.attest.step(f.event(digest,'acknowledge','sales_receiver',
  'v98-skipped-review-nonce-00001'));safe(r);
 assert.equal(r.reason_code,'ATTESTATION_STEP_OUT_OF_ORDER');
 await f.doStep(digest,0);
 r=await f.attest.step(f.event(digest,'review_sales','sales_applicant',
  'v98-self-review-nonce-00001'));safe(r);
 assert.equal(r.reason_code,'ATTESTATION_REQUIRES_DISTINCT_PARTICIPANTS');
 r=await f.attest.step(f.event(digest,'review_sales','finance_reviewer',
  'v98-wrong-department-nonce-00001'));safe(r);
 assert.equal(r.reason_code,'ATTESTATION_ACTOR_REVOKED_OR_INVALID');
 r=await f.attest.step({...f.event(digest,'review_sales','sales_reviewer',
  'v98-forged-authority-nonce-00001'),handoff_allowed:true});safe(r);
 assert.equal(r.reason_code,'INVALID_ATTESTATION_STEP_INPUT');
});
test('V3.2-98 source or task change and conclusion revocation make signed record stale',async()=>{
 for(const change of [f=>f.setRevision(2),f=>f.setPending(false),
  f=>f.setConclusion('explicitly_revoked')]){
  const f=setup(),digest=await f.snapshot();
  await f.finish(digest);change(f);
  const r=await f.attest.report({reference:f.reference,snapshot_digest:digest});safe(r);
  assert.equal(r.fixture_acknowledgement_current,false);
  assert.equal(r.reason_code,'FINAL_REVIEW_SNAPSHOT_STALE_OR_UNVERIFIED');
  assert.equal(f.attest.audit({organization_id:org,incident_id:incident}).length,5);
 }
});
test('V3.2-98 reviewer revoked or conclusion expired blocks historical receipt',async()=>{
 const f=setup(),digest=await f.snapshot();
 await f.finish(digest);
 f.revokeActor('finance_reviewer');
 let r=await f.attest.report({reference:f.reference,snapshot_digest:digest});safe(r);
 assert.equal(r.reason_code,'ATTESTATION_ACTOR_REVOKED_OR_INVALID');
 const g=setup(),dg=await g.snapshot();
 await g.finish(dg);g.setTime(1086400000);
 r=await g.attest.report({reference:g.reference,snapshot_digest:dg});safe(r);
 assert.equal(r.fixture_acknowledgement_current,false);
});
test('V3.2-98 new snapshot supersedes old acknowledgement but keeps audit trail',async()=>{
 const f=setup(),old=await f.snapshot();await f.finish(old);
 f.setRevision(2);
 const next=await f.snapshot('v98-source-snapshot-nonce-00002');
 const oldResult=await f.attest.report({reference:f.reference,snapshot_digest:old});
 safe(oldResult);assert.equal(oldResult.fixture_acknowledgement_current,false);
 const fresh=await f.doStep(next,0,'-new');safe(fresh);
 assert.equal(fresh.reason_code,'BLOCKED_ATTESTATION_EVENT_RECORDED');
 const rows=f.attest.audit({organization_id:org,incident_id:incident});
 assert.equal(rows.length,6);
 assert.equal(rows[5].snapshot_digest,next);
 assert.equal(rows[5].previous_digest,rows[4].event_digest);
});
test('V3.2-98 repeated concurrent request, conflicting nonce and forged scope fail closed',async()=>{
 const f=setup(),digest=await f.snapshot();
 const [a,b]=await Promise.all([f.doStep(digest,0),f.doStep(digest,0)]);
 safe(a);safe(b);
 assert.equal(a.reason_code,'BLOCKED_ATTESTATION_EVENT_RECORDED');
 assert.equal(b.reason_code,'BLOCKED_HISTORICAL_ATTESTATION_REPLAY');
 const conflict=await f.attest.step(f.event(digest,'review_sales','sales_reviewer',
  'v98-review-nonce-0-00001'));safe(conflict);
 assert.equal(conflict.reason_code,'ATTESTATION_NONCE_CONFLICT');
 const bad=await f.attest.step({...f.event(digest,'review_sales','sales_reviewer',
  'v98-wrong-tenant-nonce-00001'),reference:{...f.reference,
   organization_id:'22222222-2222-4222-8222-222222222222'}});
 safe(bad);assert.equal(bad.reason_code,'INVALID_ATTESTATION_STEP_INPUT');
 assert.equal(f.attest.audit({organization_id:org,incident_id:incident}).length,1);
});
test('V3.2-98 mutation while actor is verified prevents recording acknowledgement',async()=>{
 const f=setup(),digest=await f.snapshot();await f.doStep(digest,0);
 f.onActor(()=>f.setRevision(2));
 const r=await f.doStep(digest,1);safe(r);
 assert.equal(r.reason_code,'FINAL_REVIEW_SNAPSHOT_STALE_OR_UNVERIFIED');
 assert.equal(f.attest.audit({organization_id:org,incident_id:incident}).length,1);
});
