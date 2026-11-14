import test from 'node:test';
import assert from 'node:assert/strict';
import {createIsolatedBlockerTriage} from '../../src/cross-module-blocker-triage.mjs';
const org='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
const incident='33333333-3333-4333-8333-333333333333';
const sha='a'.repeat(64);
function fixture(reason='BLOCKED_REAL_EXTERNAL_HANDOFF_NOT_AUTHORIZED'){
 let revision=1,active=true,integrity=true;
 const snapshot=Object.freeze({organization_id:org,incident_id:incident,
  sequence:1,record_digest:sha,source_revision:1,fixture_only:true,hold_active:true,
  handoff_allowed:false,reason_code:'UNIFIED_GATE_REJECTED',gate_reason_code:reason});
 const actors={
  sales_owner:{actor_id:'sales_owner',role:'sales',organization_id:org,active:true,fixture_only:true},
  sales_closer:{actor_id:'sales_closer',role:'sales',organization_id:org,active:true,fixture_only:true},
  finance_owner:{actor_id:'finance_owner',role:'finance',organization_id:org,active:true,fixture_only:true},
  academic_owner:{actor_id:'academic_owner',role:'academic',organization_id:org,active:true,fixture_only:true}
 };
 const audit={
  verify:()=>({reason_code:integrity?'BLOCKED_FIXTURE_AUDIT_CHAIN_ONLY':'AUDIT_CHAIN_INTEGRITY_FAILED',
   hold_active:true,handoff_allowed:false}),
  audit:()=>[snapshot]
 };
 const triage=createIsolatedBlockerTriage({audit,
  getFixtureActor:(_,id)=>id in actors?{...actors[id],active:actors[id].active&&active}:null,
  getFixtureCurrentSourceRevision:()=>revision});
 const reference=()=>({organization_id:org,incident_id:incident,
  audit_sequence:1,audit_digest:sha});
 const request=(action,actor_id,key,extra={})=>({...reference(),action,actor_id,
  idempotency_key:key,...extra});
 return {triage,request,reference,setRevision:n=>revision=n,setActive:x=>active=x,
  setIntegrity:x=>integrity=x};
}
function safe(x){
 assert.equal(x.hold_active,true);assert.equal(Object.isFrozen(x),true);
 for(const k of ['external_authority_verified','finance_authorized','academic_authorized',
 'handoff_allowed','compensation_write_allowed','release_eligible','production_integration_allowed'])
 assert.equal(x[k],false,k);
}
test('V3.2-84 triage lifecycle closes administrative issue, never business hold',()=>{
 const f=fixture();
 const first=f.triage.apply(f.request('open','sales_owner','v84-triage-open-nonce-0001'));
 safe(first);assert.equal(first.event.status,'open');
 const review=f.triage.apply(f.request('begin_review','sales_owner','v84-triage-review-nonce-0001'));
 safe(review);assert.equal(review.event.status,'in_review');
 const closed=f.triage.apply(f.request('close','sales_closer','v84-triage-close-nonce-0001'));
 safe(closed);assert.equal(closed.event.status,'closed_administratively');
 const report=f.triage.report(f.reference());safe(report);
 assert.equal(report.status,'closed_administratively');assert.equal(report.event_count,3);
 assert.equal(report.events[1].previous_event_digest,first.event.event_digest);
 assert.equal(report.events[2].previous_event_digest,review.event.event_digest);
});
test('V3.2-84 finance and academic blockers require corresponding owner',()=>{
 for(const [reason,actor,owner,category] of [
  ['SUPPLEMENT_REVIEW_PRECHECK_FAILED_FINANCE_SIGNATURE','finance_owner','finance','finance_evidence'],
  ['SUPPLEMENT_REVIEW_PRECHECK_FAILED_ACADEMIC_SIGNATURE','academic_owner','academic','academic_evidence']
 ]){
  const f=fixture(reason);
  assert.throws(()=>f.triage.apply(f.request('open','sales_owner','v84-open-wrong-owner-0001')),
   {code:'TRIAGE_ACTOR_NOT_VERIFIED'});
  safe(f.triage.apply(f.request('open',actor,'v84-open-correct-owner-0001')));
  const r=f.triage.report(f.reference());safe(r);
  assert.equal(r.owner_department,owner);assert.equal(r.category,category);
 }
});
test('V3.2-84 revoked actor, self closure, stale source and invalid transitions reject',()=>{
 const f=fixture();
 assert.throws(()=>f.triage.apply(f.request('close','sales_closer','v84-close-early-nonce-0001')),
  {code:'ILLEGAL_TRIAGE_TRANSITION'});
 f.triage.apply(f.request('open','sales_owner','v84-open-nonce-0001'));
 f.triage.apply(f.request('begin_review','sales_owner','v84-review-nonce-0001'));
 assert.throws(()=>f.triage.apply(f.request('close','sales_owner','v84-close-same-actor-0001')),
  {code:'INDEPENDENT_TRIAGE_CLOSER_REQUIRED'});
 f.setRevision(2);
 assert.throws(()=>f.triage.apply(f.request('close','sales_closer','v84-close-stale-source-0001')),
  {code:'SOURCE_REVISION_CHANGED_REOPEN_REQUIRED'});
 assert.equal(f.triage.report(f.reference()).status,'stale_source_reopen_required');
 f.setRevision(1);f.setActive(false);
 assert.throws(()=>f.triage.apply(f.request('close','sales_closer','v84-close-revoked-actor-0001')),
  {code:'TRIAGE_ACTOR_NOT_VERIFIED'});
});
test('V3.2-84 replay and forgery never duplicate audit or release hold',()=>{
 const f=fixture();
 const request=f.request('open','sales_owner','v84-open-idempotent-nonce-0001');
 const created=f.triage.apply(request);
 const replay=f.triage.apply(request);safe(replay);
 assert.strictEqual(replay.event,created.event);
 assert.equal(replay.reason_code,'BLOCKED_HISTORICAL_TRIAGE_REPLAY');
 assert.throws(()=>f.triage.apply({...request,actor_id:'sales_closer'}),
  {code:'ILLEGAL_TRIAGE_TRANSITION'});
 assert.throws(()=>f.triage.apply(f.request('begin_review','sales_owner',
  'v84-review-forged-nonce-0001',{handoff_allowed:true})),
  {code:'INVALID_TRIAGE_EVENT_INPUT'});
 assert.throws(()=>f.triage.apply(f.request('begin_review','sales_owner',
  'v84-review-cross-scope-0001',{organization_id:other})),
  {code:'AUDIT_SNAPSHOT_REFERENCE_MISMATCH'});
 f.setIntegrity(false);
 assert.equal(f.triage.report(f.reference()).reason_code,'AUDIT_OR_SOURCE_UNAVAILABLE');
});
