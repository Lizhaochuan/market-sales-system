import test from 'node:test';
import assert from 'node:assert/strict';
import {createIsolatedUnifiedReportFreeze} from '../../src/cross-module-unified-report-freeze.mjs';
const org='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
const incident='33333333-3333-4333-8333-333333333333';
const gaps=['finance_independent_signature','academic_independent_signature',
 'order_payment_reconciliation','lesson_entitlement_reconciliation',
 'three_party_acceptance','atomic_handoff_receipt'];
function fixture(){
 let revision=1,generation=1,revocations=0,pending=true,good=true;
 const watermark=async()=>({organization_id:org,incident_id:incident,
  source_epoch:1,source_revision:revision,revocation_sequence:revocations,
  revocation_digest:'a'.repeat(64),incident_generation:generation});
 const report=async()=>({reason_code:good?
  'BLOCKED_EXTERNAL_HANDOFF_AND_TASK_REVIEW_REQUIREMENTS':'UNIFIED_GATE_UNVERIFIED',
  fixture_unified_report_consistent:good,hold_active:true,handoff_allowed:false,
  compensation_write_allowed:false,release_eligible:false,
  finance_authorized:false,academic_authorized:false,external_authority_verified:false,
  total_tasks:2,remaining_count:pending?1:0,comparison_digest:'b'.repeat(64),
  pending_tasks:pending?[{item:'finance_signature',owner_department:'finance',
   status:'pending',difference_digest:'c'.repeat(64)}]:[],
  all_internal_tasks_reviewed:!pending,
  external_requirements:gaps.map(code=>({code,status:'requires_external_authority'}))});
 const ledger=createIsolatedUnifiedReportFreeze({
  unifiedReport:{report},getFixtureWatermark:watermark});
 const input=(idempotency_key='v89-freeze-idempotency-0001')=>({
  organization_id:org,incident_id:incident,
  final_reference:{source_digest:'d'.repeat(64),revocation_reference:{}},
  diff_reference:{organization_id:org,incident_id:incident,
   previous_audit_sequence:1,previous_audit_digest:'e'.repeat(64),
   new_audit_sequence:2,new_audit_digest:'f'.repeat(64)},idempotency_key});
 const verification=(freeze)=>{const {idempotency_key,...p}=input();
  return {...p,freeze_digest:freeze.freeze_digest};};
 return {ledger,input,verification,setRevision:x=>revision=x,
  setGeneration:x=>generation=x,setRevocations:x=>revocations=x,
  setPending:x=>pending=x,setGood:x=>good=x};
}
function safe(x){
 assert.equal(x.hold_active,true);assert.equal(x.handoff_allowed,false);
 assert.equal(x.finance_authorized,false);assert.equal(x.academic_authorized,false);
 assert.equal(x.compensation_write_allowed,false);assert.equal(x.release_eligible,false);
 assert.ok(Object.isFrozen(x));
}
test('V3.2-89 stable fictional report freezes, stays blocked and verifies current',async()=>{
 const f=fixture(),r=await f.ledger.freeze(f.input());safe(r);
 assert.equal(r.reason_code,'BLOCKED_FROZEN_REPORT_NO_EXTERNAL_AUTHORITY');
 assert.ok(Object.isFrozen(r.freeze.observation.report));
 const v=await f.ledger.verify(f.verification(r.freeze));safe(v);
 assert.equal(v.fixture_freeze_current,true);
 assert.equal(v.reason_code,'BLOCKED_CURRENT_FIXTURE_FREEZE_NO_EXTERNAL_AUTHORITY');
});
test('V3.2-89 evidence, incident or task changes invalidate frozen report',async()=>{
 for(const change of [f=>f.setRevision(2),f=>f.setGeneration(2),
  f=>f.setRevocations(1),f=>f.setPending(false)]){
  const f=fixture(),r=await f.ledger.freeze(f.input());change(f);
  const v=await f.ledger.verify(f.verification(r.freeze));safe(v);
  assert.equal(v.reason_code,'FROZEN_REPORT_INVALIDATED_BY_NEW_EVIDENCE');
 }
});
test('V3.2-89 stale reports, forged fields and wrong tenant fail closed',async()=>{
 const f=fixture();f.setGood(false);
 safe(await f.ledger.freeze(f.input()));
 assert.equal((await f.ledger.freeze(f.input())).reason_code,'UNIFIED_REPORT_NOT_STABLE');
 f.setGood(true);
 const bad=await f.ledger.freeze({...f.input(),handoff_allowed:true});safe(bad);
 assert.equal(bad.reason_code,'INVALID_FREEZE_REQUEST');
 const cross=await f.ledger.freeze({...f.input(),organization_id:other});safe(cross);
 assert.equal(cross.reason_code,'INVALID_FREEZE_REQUEST');
});
test('V3.2-89 replay and superseded freeze cannot be current authorization',async()=>{
 const f=fixture();
 const first=await f.ledger.freeze(f.input());
 const replay=await f.ledger.freeze(f.input());safe(replay);
 assert.equal(replay.reason_code,'BLOCKED_HISTORICAL_FREEZE_REPLAY');
 f.setRevision(2);
 const second=await f.ledger.freeze(f.input('v89-freeze-idempotency-0002'));safe(second);
 assert.equal(second.freeze.sequence,2);
 const old=await f.ledger.verify(f.verification(first.freeze));safe(old);
 assert.equal(old.reason_code,'SUPERSEDED_FREEZE_NOT_CURRENT');
 const now=await f.ledger.verify(f.verification(second.freeze));safe(now);
 assert.equal(now.fixture_freeze_current,true);
});
test('V3.2-89 concurrent identical freezes write only one immutable record',async()=>{
 const f=fixture();
 const [a,b]=await Promise.all([f.ledger.freeze(f.input()),f.ledger.freeze(f.input())]);
 safe(a);safe(b);
 assert.equal(a.reason_code,'BLOCKED_FROZEN_REPORT_NO_EXTERNAL_AUTHORITY');
 assert.equal(b.reason_code,'BLOCKED_HISTORICAL_FREEZE_REPLAY');
 assert.equal(f.ledger.audit({organization_id:org,incident_id:incident}).length,1);
});
