import test from 'node:test';
import assert from 'node:assert/strict';
import {createIsolatedFinalReviewSnapshot} from '../../src/cross-module-final-review-snapshot.mjs';
const org='11111111-1111-4111-8111-111111111111';
const incident='33333333-3333-4333-8333-333333333333';
const GAPS=['finance_independent_signature','academic_independent_signature',
 'order_payment_reconciliation','lesson_entitlement_reconciliation',
 'three_party_acceptance','atomic_handoff_receipt'];
function fixture(){
 let time=1000000000,revision=1,generation=1,revoked=0,task=true,
  conclusion='current',bad=false,clockBack=false,call=0;
 const expires=1086400000;
 const gate={report:async()=>({
  reason_code:bad?'RECOVERY_CONCLUSION_REACCEPTANCE_REQUIRED':
   'BLOCKED_EXTERNAL_HANDOFF_WITH_CURRENT_FIXTURE_RECOVERY',
  fixture_combined_consistency:!bad,fixture_recovery_current:!bad,
  hold_active:true,handoff_allowed:false,compensation_write_allowed:false,
  release_eligible:false,external_authority_verified:false,
  finance_authorized:false,academic_authorized:false,
  comparison_digest:'a'.repeat(64),recovery_expires_at_ms:expires,
  remaining_count:task?1:0,
  pending_tasks:task?[{item:'finance_signature',owner_department:'finance',
   status:'pending',difference_digest:'b'.repeat(64)}]:[],
  external_requirements:GAPS.map(code=>({code,status:'requires_external_authority'}))})};
 const recovery={report:async()=>({
  reason_code:'BLOCKED_CONCLUSION_NOT_BUSINESS_AUTHORIZATION',
  fixture_conclusion_current:conclusion==='current',
  status:conclusion==='current'?'fixture_current_not_authorized':conclusion,
  history_repair_allowed:false,automatic_recovery_allowed:false,
  hold_active:true,handoff_allowed:false,compensation_write_allowed:false,
  release_eligible:false,external_authority_verified:false,
  finance_authorized:false,academic_authorized:false,
  current_source_fingerprint:'c'.repeat(64),expires_at_ms:expires,
  history_count:5,events:[{action:'apply'},{action:'review_sales'},
   {action:'review_finance'},{action:'review_academic'},
   {action:'conclude',source_fingerprint:'c'.repeat(64),expires_at_ms:expires,
    event_digest:'d'.repeat(64),hold_active:true,handoff_allowed:false}]})};
 const watermark=async()=>({organization_id:org,incident_id:incident,
  source_epoch:1,source_revision:revision,revocation_sequence:revoked,
  revocation_digest:'e'.repeat(64),incident_generation:generation,
  evidence_digest:'f'.repeat(64)});
 const gateSnapshot=createIsolatedFinalReviewSnapshot({
  unifiedRecoveryGate:gate,recoveryConclusion:recovery,
  getFixtureWatermark:watermark,getFixtureNow:()=>clockBack?time-1:time});
 const ref={organization_id:org,incident_id:incident,
  final_reference:{source_digest:'1'.repeat(64),revocation_reference:{}},
  diff_reference:{organization_id:org,incident_id:incident,
   previous_audit_sequence:1,previous_audit_digest:'2'.repeat(64),
   new_audit_sequence:2,new_audit_digest:'3'.repeat(64)}};
 const capture=(idempotency_key='v97-final-review-nonce-00001',afterFirstRead=async()=>{})=>
  gateSnapshot.capture({reference:ref,idempotency_key,afterFirstRead});
 return {gateSnapshot,ref,capture,setTime:x=>time=x,
  setRevision:x=>revision=x,setGeneration:x=>generation=x,
  setRevoked:x=>revoked=x,setTask:x=>task=x,
  setConclusion:x=>conclusion=x,setBad:x=>bad=x,
  setClockBack:x=>clockBack=x};
}
function safe(x){
 assert.equal(x.hold_active,true);
 for(const k of ['external_authority_verified','finance_authorized',
  'academic_authorized','handoff_allowed','compensation_write_allowed',
  'release_eligible','production_integration_allowed'])assert.equal(x[k],false,k);
 assert.ok(Object.isFrozen(x));
}
test('V3.2-97 current fictional snapshot verifies but never grants external handoff',async()=>{
 const f=fixture(),r=await f.capture();safe(r);
 assert.equal(r.reason_code,'BLOCKED_FINAL_REVIEW_SNAPSHOT_RECORDED');
 const v=await f.gateSnapshot.verify({reference:f.ref,
  snapshot_digest:r.snapshot.snapshot_digest});safe(v);
 assert.equal(v.fixture_final_review_current,true);
 assert.equal(v.reason_code,'BLOCKED_CURRENT_FIXTURE_FINAL_REVIEW_NO_AUTHORITY');
});
test('V3.2-97 revisions, revocation, incident and tasks invalidate snapshot',async()=>{
 for(const change of [f=>f.setRevision(2),f=>f.setRevoked(1),
   f=>f.setGeneration(2),f=>f.setTask(false)]){
  const f=fixture(),x=await f.capture();change(f);
  const v=await f.gateSnapshot.verify({reference:f.ref,
   snapshot_digest:x.snapshot.snapshot_digest});safe(v);
  assert.equal(v.reason_code,'FINAL_REVIEW_SNAPSHOT_INVALIDATED');
 }
});
test('V3.2-97 conclusion revocation or expiry prevents using historical snapshot',async()=>{
 const f=fixture(),x=await f.capture();
 f.setConclusion('explicitly_revoked');
 let v=await f.gateSnapshot.verify({reference:f.ref,
  snapshot_digest:x.snapshot.snapshot_digest});safe(v);
 assert.equal(v.reason_code,'FINAL_REVIEW_CONCLUSION_NOT_CURRENT');
 const g=fixture(),y=await g.capture();g.setTime(1086400000);
 v=await g.gateSnapshot.verify({reference:g.ref,
  snapshot_digest:y.snapshot.snapshot_digest});safe(v);
 assert.equal(v.reason_code,'FINAL_REVIEW_EXPIRED_OR_MISMATCHED');
});
test('V3.2-97 concurrent mutation, invalid dependency and forged request fail closed',async()=>{
 const f=fixture();let r=await f.capture(undefined,async()=>f.setRevision(2));safe(r);
 assert.equal(r.reason_code,'FINAL_REVIEW_CHANGED_BETWEEN_READS');
 const g=fixture();g.setBad(true);r=await g.capture();safe(r);
 assert.equal(r.reason_code,'FINAL_REVIEW_GATE_NOT_CURRENT');
 r=await g.gateSnapshot.capture({reference:g.ref,idempotency_key:
  'v97-final-review-nonce-00001',afterFirstRead:async()=>{},handoff_allowed:true});safe(r);
 assert.equal(r.reason_code,'INVALID_FINAL_REVIEW_CAPTURE_INPUT');
});
test('V3.2-97 replay, conflict and superseded snapshot retain old audit history',async()=>{
 const f=fixture(),old=await f.capture();const replay=await f.capture();safe(replay);
 assert.equal(replay.reason_code,'BLOCKED_HISTORICAL_FINAL_REVIEW_REPLAY');
 const forged={...f.ref,final_reference:{source_digest:'4'.repeat(64),
  revocation_reference:{}}};
 const conflict=await f.gateSnapshot.capture({reference:forged,
  idempotency_key:'v97-final-review-nonce-00001',afterFirstRead:async()=>{}});safe(conflict);
 assert.equal(conflict.reason_code,'FINAL_REVIEW_NONCE_CONFLICT');
 f.setRevision(2);
 const newer=await f.capture('v97-final-review-nonce-00002');safe(newer);
 assert.equal(newer.snapshot.sequence,2);
 const v=await f.gateSnapshot.verify({reference:f.ref,
  snapshot_digest:old.snapshot.snapshot_digest});safe(v);
 assert.equal(v.reason_code,'SUPERSEDED_FINAL_REVIEW_SNAPSHOT');
 assert.equal(f.gateSnapshot.audit({organization_id:org,incident_id:incident}).length,2);
});
