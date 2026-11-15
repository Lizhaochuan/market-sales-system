import test from 'node:test';
import assert from 'node:assert/strict';
import {createIsolatedRecoveryConclusionValidity} from '../../src/cross-module-recovery-conclusion-validity.mjs';
const org='11111111-1111-4111-8111-111111111111';
const incident='33333333-3333-4333-8333-333333333333';
const actions=['apply','review_sales','review_finance','review_academic','conclude'];
const actors=['sales_applicant','sales_reviewer','finance_reviewer','academic_reviewer','sales_conclusion'];
function fixture(){
 let time=1000000000,active=true,fingerprint='a'.repeat(64),evidence='b'.repeat(64);
 const staff={sales_applicant:'sales',sales_reviewer:'sales',sales_conclusion:'sales',
  sales_revoke:'sales',new_sales_applicant:'sales',new_sales_reviewer:'sales',
  new_finance_reviewer:'finance',new_academic_reviewer:'academic',
  new_sales_conclusion:'sales',finance_reviewer:'finance',academic_reviewer:'academic'};
 const recovery={report:async()=>({
  reason_code:'BLOCKED_MANUAL_RECOVERY_NOT_BUSINESS_RELEASE',
  fixture_recovery_review_complete:true,source_fingerprint:fingerprint,
  required_external_authority_categories:6,original_history_preserved:true,
  hold_active:true,handoff_allowed:false,release_eligible:false,
  events:actions.map(action=>({action,source_fingerprint:fingerprint,
   evidence_sha256:evidence,fixture_only:true,hold_active:true,
   handoff_allowed:false,status:action==='conclude'?'closed_administratively':'in_internal_review'}))})};
 const gate=createIsolatedRecoveryConclusionValidity({manualRecovery:recovery,
  getFixtureNow:()=>time,
  getFixtureActor:(_,id)=>staff[id]?({actor_id:id,organization_id:org,
   role:staff[id],active,fixture_only:true}):null});
 const scope={organization_id:org,incident_id:incident};
 const ev=(action,actor_id,idempotency_key,extra={})=>({...scope,action,actor_id,
  evidence_sha256:evidence,idempotency_key,...extra});
 const round=async(prefix='v95-first',names=actors)=>{
  for(let i=0;i<actions.length;i++)
   await gate.apply(ev(actions[i],names[i],prefix+'-nonce-'+i+'-00001'));
 };
 return {gate,scope,ev,round,setTime:x=>time=x,advance:x=>time+=x,
  setActive:x=>active=x,setFingerprint:x=>fingerprint=x,
  setEvidence:x=>evidence=x};
}
function safe(r){
 assert.equal(r.hold_active,true);
 for(const k of ['history_repair_allowed','automatic_recovery_allowed',
 'external_authority_verified','finance_authorized','academic_authorized',
 'handoff_allowed','compensation_write_allowed','release_eligible',
 'production_integration_allowed'])assert.equal(r[k],false,k);
 assert.ok(Object.isFrozen(r));
}
test('V3.2-95 current internal conclusion remains blocked and expires at 24h',async()=>{
 const f=fixture();await f.round();
 let r=await f.gate.report(f.scope);safe(r);
 assert.equal(r.fixture_conclusion_current,true);
 assert.equal(r.status,'fixture_current_not_authorized');
 f.advance(86400000);
 r=await f.gate.report(f.scope);safe(r);
 assert.equal(r.status,'expired');assert.equal(r.fixture_conclusion_current,false);
});
test('V3.2-95 revoked reviewer or changed evidence invalidate the previous conclusion',async()=>{
 const f=fixture();await f.round();f.setActive(false);
 let r=await f.gate.report(f.scope);safe(r);
 assert.equal(r.status,'reviewer_revoked_or_inactive');
 f.setActive(true);f.setFingerprint('c'.repeat(64));
 r=await f.gate.report(f.scope);safe(r);
 assert.equal(r.status,'source_changed');
});
test('V3.2-95 explicit independent revocation preserves history and requires new round',async()=>{
 const f=fixture();await f.round();
 const revoke=await f.gate.apply(f.ev('revoke','sales_revoke','v95-revoke-nonce-00001'));
 assert.ok(Object.isFrozen(revoke));
 let r=await f.gate.report(f.scope);safe(r);
 assert.equal(r.status,'explicitly_revoked');
 assert.equal(r.history_count,6);
 const fresh=['new_sales_applicant','new_sales_reviewer','new_finance_reviewer',
  'new_academic_reviewer','new_sales_conclusion'];
 await f.round('v95-second',fresh);
 r=await f.gate.report(f.scope);safe(r);
 assert.equal(r.fixture_conclusion_current,true);
 assert.equal(r.history_count,11);
});
test('V3.2-95 cannot skip independent review or forge released state',async()=>{
 const f=fixture();
 await assert.rejects(f.gate.apply(f.ev('conclude','sales_conclusion',
  'v95-too-early-nonce-00001')),{code:'FRESH_REACCEPTANCE_REQUIRED'});
 await f.gate.apply(f.ev('apply','sales_applicant','v95-apply-nonce-00001'));
 await assert.rejects(f.gate.apply(f.ev('review_sales','sales_applicant',
  'v95-self-review-nonce-00001')),{code:'INDEPENDENT_REACCEPTANCE_ACTOR_REQUIRED'});
 await assert.rejects(f.gate.apply(f.ev('review_sales','finance_reviewer',
  'v95-wrong-role-nonce-00001')),{code:'REVIEW_ACTOR_REVOKED_OR_INVALID'});
 await assert.rejects(f.gate.apply(f.ev('review_sales','sales_reviewer',
  'v95-forged-nonce-00001',{handoff_allowed:true})),{code:'INVALID_CONCLUSION_EVENT_INPUT'});
});
test('V3.2-95 idempotency, source update and rollback clock all fail closed',async()=>{
 const f=fixture(),ev=f.ev('apply','sales_applicant','v95-idempotency-nonce-00001');
 const first=await f.gate.apply(ev);
 assert.strictEqual(await f.gate.apply(ev),first);
 await assert.rejects(f.gate.apply({...ev,actor_id:'sales_reviewer'}),
  {code:'CONCLUSION_IDEMPOTENCY_CONFLICT'});
 f.setFingerprint('d'.repeat(64));
 await assert.rejects(f.gate.apply(f.ev('review_sales','sales_reviewer',
  'v95-changed-source-nonce-00001')),{code:'FRESH_REACCEPTANCE_REQUIRED'});
 f.setFingerprint('a'.repeat(64));
 f.setTime(999999999);
 const r=await f.gate.report(f.scope);safe(r);
 assert.equal(r.reason_code,'CONCLUSION_SOURCE_CLOCK_OR_HISTORY_UNAVAILABLE');
});
