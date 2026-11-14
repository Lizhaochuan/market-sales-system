import test from 'node:test';
import assert from 'node:assert/strict';
import {createIsolatedUnifiedBlockerAudit} from '../../src/cross-module-unified-blocker-audit.mjs';
const org='11111111-1111-4111-8111-111111111111';
const alt='22222222-2222-4222-8222-222222222222';
const incident='33333333-3333-4333-8333-333333333333';
const codes=['finance_signature','academic_signature',
 'order_payment_reconciliation','lesson_entitlement_reconciliation',
 'three_party_joint_acceptance','external_atomic_receipt'];
function setup(){
 let revision=1,reason='BLOCKED_REAL_THREE_PARTY_ATOMIC_HANDOFF_MISSING';
 let elevated=false,crash=false;
 const version=(organization_id,incident_id)=>({
  organization_id,incident_id,source_revision:revision,source_epoch:1,
  revocation_sequence:0,revocation_digest:'a'.repeat(64),
  supplements:codes.map(requirement_code=>({
   requirement_code,supplement_version:revision,chain_digest:'b'.repeat(64)}))
 });
 const gate={check:async ({afterFirstRead})=>{
  if(crash)throw Error('offline');
  await afterFirstRead();
  return {reason_code:reason,fixture_unified_consistency:reason==='BLOCKED_REAL_THREE_PARTY_ATOMIC_HANDOFF_MISSING',
   finance_authorized:elevated,academic_authorized:false,
   external_authority_verified:false,handoff_allowed:false,
   compensation_write_allowed:false,release_eligible:false,hold_active:true};
 }};
 const ledger=createIsolatedUnifiedBlockerAudit({unifiedBlocker:gate,
  getFixtureVersionSnapshot:async (...args)=>version(...args)});
 const request=(key='v83-capture-idempotency-0001',afterFirstRead=async()=>{},extra={})=>({
  organization_id:org,incident_id:incident,idempotency_key:key,
  final_reference:{source_digest:'c'.repeat(64),revocation_reference:{}},
  afterFirstRead,...extra
 });
 return {ledger,request,setRevision:n=>revision=n,setReason:r=>reason=r,
  setElevated:v=>elevated=v,setCrash:v=>crash=v};
}
function safe(x){
 assert.equal(x.hold_active,true);assert.equal(Object.isFrozen(x),true);
 for(const k of ['finance_authorized','academic_authorized','external_authority_verified',
 'handoff_allowed','compensation_write_allowed','release_eligible'])
  assert.equal(x[k],false,k);
}
test('V3.2-83 valid fictional blocker produces immutable chained audit without release',async()=>{
 const s=setup(),a=await s.ledger.collect(s.request());
 safe(a);assert.equal(a.reason_code,'BLOCKED_REAL_EXTERNAL_HANDOFF_NOT_AUTHORIZED');
 assert.equal(a.fixture_audit_recorded,true);
 assert.equal(a.record.sequence,1);assert.equal(a.record.supplements.length,6);
 assert.equal(Object.isFrozen(a.record.supplements),true);
 const second=await s.ledger.collect(s.request('v83-capture-idempotency-0002'));
 safe(second);assert.equal(second.record.sequence,2);
 assert.equal(second.record.previous_digest,a.record.record_digest);
 assert.equal(s.ledger.audit({organization_id:org,incident_id:incident}).length,2);
 safe(s.ledger.verify({organization_id:org,incident_id:incident}));
});
test('V3.2-83 source revision drift and gate rejects leave safe append-only reasons',async()=>{
 const s=setup();
 const changed=await s.ledger.collect(s.request('v83-capture-idempotency-0001',async()=>s.setRevision(2)));
 safe(changed);assert.equal(changed.reason_code,'FIXTURE_EVIDENCE_CHANGED_DURING_AUDIT');
 assert.notEqual(changed.record.source_snapshot_digest_before,changed.record.source_snapshot_digest_after);
 s.setReason('SUPPLEMENT_REVIEW_PRECHECK_FAILED_FINANCE_SIGNATURE');
 const denied=await s.ledger.collect(s.request('v83-capture-idempotency-0002'));
 safe(denied);assert.equal(denied.reason_code,'UNIFIED_GATE_REJECTED');
 assert.equal(denied.record.gate_reason_code,'SUPPLEMENT_REVIEW_PRECHECK_FAILED_FINANCE_SIGNATURE');
});
test('V3.2-83 replay remains historical; changed payload same key conflicts',async()=>{
 const s=setup();const old=await s.ledger.collect(s.request());
 const replay=await s.ledger.collect(s.request());safe(replay);
 assert.equal(replay.reason_code,'BLOCKED_HISTORICAL_AUDIT_REPLAY');
 assert.strictEqual(replay.record,old.record);
 s.setRevision(2);
 const conflict=await s.ledger.collect(s.request());safe(conflict);
 assert.equal(conflict.reason_code,'AUDIT_NONCE_CONFLICT');
 assert.equal(s.ledger.audit({organization_id:org,incident_id:incident}).length,1);
});
test('V3.2-83 forged approval, malformed input and failed dependency cannot write audit',async()=>{
 const s=setup();s.setElevated(true);
 const bad=await s.ledger.collect(s.request());safe(bad);
 assert.equal(bad.reason_code,'UNIFIED_BLOCKER_PROTOCOL_VIOLATION');
 s.setElevated(false);s.setCrash(true);
 const offline=await s.ledger.collect(s.request());safe(offline);
 assert.equal(offline.reason_code,'AUDIT_DEPENDENCY_UNAVAILABLE');
 const forged=await s.ledger.collect(s.request('v83-capture-idempotency-0002',async()=>{},
  {handoff_allowed:true}));safe(forged);
 assert.equal(forged.reason_code,'INVALID_AUDIT_CAPTURE_INPUT');
 assert.equal(s.ledger.audit({organization_id:org,incident_id:incident}).length,0);
});
test('V3.2-83 serialized duplicate concurrent requests create only one record',async()=>{
 const s=setup();
 const [a,b]=await Promise.all([
  s.ledger.collect(s.request()),s.ledger.collect(s.request())
 ]);
 safe(a);safe(b);assert.equal(a.fixture_audit_recorded,true);
 assert.equal(b.reason_code,'BLOCKED_HISTORICAL_AUDIT_REPLAY');
 assert.equal(s.ledger.audit({organization_id:org,incident_id:incident}).length,1);
 assert.equal(s.ledger.audit({organization_id:alt,incident_id:incident}).length,0);
});
