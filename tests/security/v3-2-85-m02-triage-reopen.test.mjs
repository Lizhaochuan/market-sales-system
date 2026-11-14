import test from 'node:test';
import assert from 'node:assert/strict';
import {createIsolatedTriageReopen} from '../../src/cross-module-triage-reopen.mjs';
const org='11111111-1111-4111-8111-111111111111';
const alt='22222222-2222-4222-8222-222222222222';
const incident='33333333-3333-4333-8333-333333333333';
const A='a'.repeat(64),B='b'.repeat(64);
function setup(){
 let current=2,identityActive=true,integrity=true,oldStatus='stale_source_reopen_required';
 const original=Object.freeze({organization_id:org,incident_id:incident,
  sequence:1,record_digest:A,source_revision:1,
  source_snapshot_digest_after:A,revocation_digest:A,
  fixture_only:true,hold_active:true,handoff_allowed:false});
 let newer=Object.freeze({organization_id:org,incident_id:incident,
  sequence:2,record_digest:B,source_revision:2,
  source_snapshot_digest_after:B,revocation_digest:A,
  fixture_only:true,hold_active:true,handoff_allowed:false});
 const audit={
  verify:()=>({reason_code:integrity?'BLOCKED_FIXTURE_AUDIT_CHAIN_ONLY':'AUDIT_CHAIN_INTEGRITY_FAILED',
   hold_active:true,handoff_allowed:false}),
  audit:()=>[original,newer]};
 const triage={report:()=>({status:oldStatus,category:'finance_evidence',
  hold_active:true,handoff_allowed:false})};
 const staff={
  finance_owner:{role:'finance'},finance_reviewer:{role:'finance'},
  sales_closer:{role:'sales'}
 };
 const gate=createIsolatedTriageReopen({audit,triage,
  getFixtureCurrentSourceRevision:()=>current,
  getFixtureActor:(_,id)=>staff[id]?{actor_id:id,role:staff[id].role,
   organization_id:org,active:identityActive,fixture_only:true}:null});
 const ref=()=>({organization_id:org,incident_id:incident,
  previous_audit_sequence:1,previous_audit_digest:A,
  new_audit_sequence:2,new_audit_digest:B});
 const event=(action,actor_id,idempotency_key,overrides={})=>({
  ...ref(),action,actor_id,idempotency_key,...overrides});
 return {gate,ref,event,setRevision:x=>current=x,
  setIdentityActive:x=>identityActive=x,
  setIntegrity:x=>integrity=x,
  setOldStatus:x=>oldStatus=x,
  setNewer:x=>newer=x};
}
function safe(x){
 assert.equal(x.hold_active,true);assert.equal(Object.isFrozen(x),true);
 for(const k of ['external_authority_verified','finance_authorized','academic_authorized',
  'handoff_allowed','compensation_write_allowed','release_eligible'])assert.equal(x[k],false,k);
}
test('V3.2-85 reopen, rereview, close are immutable and never release business hold',()=>{
 const f=setup();
 const a=f.gate.apply(f.event('reopen','finance_owner','v85-reopen-nonce-0001'));
 const b=f.gate.apply(f.event('rereview','finance_reviewer','v85-review-nonce-0001'));
 const c=f.gate.apply(f.event('close_administratively','sales_closer','v85-close-nonce-0001'));
 for(const r of [a,b,c])safe(r);
 assert.equal(c.event.status,'closed_administratively');
 assert.equal(b.event.previous_event_digest,a.event.event_digest);
 assert.equal(c.event.previous_event_digest,b.event.event_digest);
 const report=f.gate.report(f.ref());safe(report);
 assert.equal(report.status,'closed_administratively');
 assert.equal(report.event_count,3);
 assert.equal(report.owner_department,'finance');
});
test('V3.2-85 old closure, wrong owner and stale source cannot bypass recheck',()=>{
 const f=setup();f.setOldStatus('in_review');
 assert.throws(()=>f.gate.apply(f.event('reopen','finance_owner','v85-reopen-nonce-0001')),
  {code:'PREVIOUS_TRIAGE_NOT_CLOSED_OR_STALE'});
 f.setOldStatus('stale_source_reopen_required');f.setRevision(3);
 assert.throws(()=>f.gate.apply(f.event('reopen','finance_owner','v85-reopen-nonce-0001')),
  {code:'FOLLOWUP_EVIDENCE_NOT_CURRENT'});
 f.setRevision(2);
 assert.throws(()=>f.gate.apply(f.event('reopen','sales_closer','v85-reopen-nonce-0001')),
  {code:'FOLLOWUP_ACTOR_NOT_VERIFIED'});
 assert.throws(()=>f.gate.apply(f.event('rereview','finance_reviewer','v85-review-nonce-0001')),
  {code:'ILLEGAL_FOLLOWUP_TRANSITION'});
});
test('V3.2-85 superseded evidence, wrong tenant and forged release are blocked',()=>{
 const f=setup();
 assert.throws(()=>f.gate.apply(f.event('reopen','finance_owner','v85-reopen-nonce-0001',
  {organization_id:alt})),{code:'AUDIT_REFERENCE_MISMATCH'});
 assert.throws(()=>f.gate.apply(f.event('reopen','finance_owner','v85-reopen-nonce-0001',
  {handoff_allowed:true})),{code:'INVALID_FOLLOWUP_EVENT_INPUT'});
 f.setNewer(Object.freeze({organization_id:org,incident_id:incident,sequence:2,
  record_digest:B,source_revision:1,source_snapshot_digest_after:A,revocation_digest:A,
  fixture_only:true,hold_active:true,handoff_allowed:false}));
 f.setRevision(1);
 assert.throws(()=>f.gate.apply(f.event('reopen','finance_owner','v85-reopen-nonce-0001')),
  {code:'NO_NEW_EVIDENCE_FOR_REOPEN'});
});
test('V3.2-85 same nonce returns historical event; tampering conflicts and revoked actors fail',()=>{
 const f=setup(),req=f.event('reopen','finance_owner','v85-reopen-nonce-0001');
 const first=f.gate.apply(req);
 const replay=f.gate.apply(req);safe(replay);
 assert.equal(replay.reason_code,'BLOCKED_HISTORICAL_FOLLOWUP_REPLAY');
 assert.strictEqual(replay.event,first.event);
 assert.throws(()=>f.gate.apply({...req,actor_id:'finance_reviewer'}),
  {code:'FOLLOWUP_IDEMPOTENCY_CONFLICT'});
 f.setIdentityActive(false);
 assert.throws(()=>f.gate.apply(f.event('rereview','finance_reviewer','v85-review-nonce-0001')),
  {code:'FOLLOWUP_ACTOR_NOT_VERIFIED'});
 f.setIntegrity(false);
 assert.equal(f.gate.report(f.ref()).reason_code,'FOLLOWUP_ANCHOR_INVALID_OR_STALE');
});
