import test from 'node:test';
import assert from 'node:assert/strict';
import {createIsolatedReopenedEvidenceDiff} from '../../src/cross-module-reopened-evidence-diff.mjs';
const org='11111111-1111-4111-8111-111111111111';
const incident='33333333-3333-4333-8333-333333333333';
const A='a'.repeat(64),B='b'.repeat(64),C='c'.repeat(64);
const codes=['finance_signature','academic_signature','order_payment_reconciliation',
 'lesson_entitlement_reconciliation','three_party_joint_acceptance','external_atomic_receipt'];
function fixture(){
 let revision=2,valid=true,followStatus='reopened';
 const old={organization_id:org,incident_id:incident,sequence:1,record_digest:A,
  source_revision:1,source_epoch:1,revocation_sequence:0,revocation_digest:A,
  source_snapshot_digest_after:A,fixture_only:true,hold_active:true,handoff_allowed:false,
  supplements:codes.map(requirement_code=>({requirement_code,supplement_version:1,chain_digest:A}))};
 const next={...old,sequence:2,record_digest:B,source_revision:2,
  source_snapshot_digest_after:B,supplements:codes.map(requirement_code=>({
   requirement_code,supplement_version:requirement_code==='finance_signature'?2:1,
   chain_digest:requirement_code==='finance_signature'?C:A
  }))};
 const audit={verify:async()=>({reason_code:valid?'BLOCKED_FIXTURE_AUDIT_CHAIN_ONLY':
  'AUDIT_CHAIN_INTEGRITY_FAILED',hold_active:true,handoff_allowed:false}),
  audit:async()=>[old,next]};
 const followup={report:async()=>({reason_code:'BLOCKED_FOLLOWUP_STATUS_IS_NOT_AUTHORIZATION',
  hold_active:true,handoff_allowed:false,status:followStatus})};
 const gate=createIsolatedReopenedEvidenceDiff({audit,followup,
  getFixtureCurrentSourceRevision:async()=>revision});
 const input=(x={})=>({organization_id:org,incident_id:incident,
  previous_audit_sequence:1,previous_audit_digest:A,
  new_audit_sequence:2,new_audit_digest:B,...x});
 return {gate,input,old,next,setRevision:x=>revision=x,
  setIntegrity:x=>valid=x,setFollowStatus:x=>followStatus=x};
}
function safe(r){
 assert.equal(r.hold_active,true);assert.equal(Object.isFrozen(r),true);
 assert.equal(r.external_requirements.length,6);
 for(const k of ['external_authority_verified','finance_authorized','academic_authorized',
 'handoff_allowed','compensation_write_allowed','release_eligible',
 'production_integration_allowed'])assert.equal(r[k],false,k);
}
test('V3.2-86 compares versions, assigns finance re-review, retains all external blockers',async()=>{
 const f=fixture(),r=await f.gate.report(f.input());safe(r);
 assert.equal(r.fixture_comparison_complete,true);
 assert.equal(r.reason_code,'BLOCKED_REVIEW_CHANGED_EVIDENCE_AND_EXTERNAL_GAPS');
 assert.ok(r.differences.some(x=>x.item==='finance_signature'&&
  x.owner_department==='finance'&&x.before_version===1&&x.after_version===2));
 assert.equal(r.followup_status,'reopened');
 assert.ok(r.rereview_departments.includes('finance'));
 assert.ok(r.external_requirements.every(x=>x.status==='requires_external_authority'));
});
test('V3.2-86 closed follow-up never clears financial, academic or handoff gates',async()=>{
 const f=fixture();f.setFollowStatus('closed_administratively');
 const r=await f.gate.report(f.input());safe(r);
 assert.equal(r.followup_status,'closed_administratively');
 assert.equal(r.all_external_gaps_open,true);
});
test('V3.2-86 old source revision, audit integrity and forged input fail closed',async()=>{
 const f=fixture();f.setRevision(3);
 const stale=await f.gate.report(f.input());safe(stale);
 assert.equal(stale.reason_code,'DIFF_SOURCE_REVISION_STALE');
 f.setRevision(2);f.setIntegrity(false);
 const bad=await f.gate.report(f.input());safe(bad);
 assert.equal(bad.reason_code,'AUDIT_CHAIN_NOT_VERIFIED');
 const forged=await f.gate.report(f.input({finance_authorized:true}));safe(forged);
 assert.equal(forged.reason_code,'INVALID_DIFF_REPORT_INPUT');
});
test('V3.2-86 rejects reversed references, missing followup and absent evidence changes',async()=>{
 const f=fixture();
 const reversed=await f.gate.report(f.input({
  previous_audit_sequence:2,previous_audit_digest:B,
  new_audit_sequence:1,new_audit_digest:A}));safe(reversed);
 assert.equal(reversed.reason_code,'AUDIT_REFERENCES_INVALID_OR_OUT_OF_ORDER');
 f.setFollowStatus('untrusted');
 const missing=await f.gate.report(f.input());safe(missing);
 assert.equal(missing.reason_code,'FOLLOWUP_REPORT_NOT_VERIFIED');
 f.setFollowStatus('under_rereview');
 f.next.source_revision=1;f.next.source_snapshot_digest_after=A;
 f.next.supplements=codes.map(requirement_code=>({
  requirement_code,supplement_version:1,chain_digest:A}));
 f.setRevision(1);
 const same=await f.gate.report(f.input());safe(same);
 assert.equal(same.reason_code,'NO_MATERIAL_CHANGE_TO_REVIEW');
});
