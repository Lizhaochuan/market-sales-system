import test from 'node:test';
import assert from 'node:assert/strict';
import {createIsolatedManualLineageRecovery} from '../../src/cross-module-manual-lineage-recovery.mjs';
const org='11111111-1111-4111-8111-111111111111';
const incident='33333333-3333-4333-8333-333333333333';
const steps=[
 'quarantine_affected_scope_and_preserve_original_evidence',
 'independent_sales_finance_academic_history_reconciliation',
 'obtain_trusted_source_versions_and_revocation_watermarks',
 'rebuild_all_current_reviews_and_six_external_authority_gaps',
 'create_new_isolated_lineage_only_after_independent_acceptance'
];
function fixture(){
 let generation=1,active=true,failed=true;
 const audit={audit:async()=>({
  reason_code:failed?'LINEAGE_PREDECESSOR_BROKEN':'BLOCKED_CI_LINEAGE_INTEGRITY_ONLY',
  hold_active:true,handoff_allowed:false,history_repair_allowed:false,
  automatic_recovery_allowed:false,recovery_steps:steps})};
 const getFixtureEvidenceWatermark=async()=>({organization_id:org,
  incident_id:incident,source_revision:generation,incident_generation:generation,
  evidence_digest:'a'.repeat(64)});
 const people={sales_applicant:'sales',sales_reviewer:'sales',
  sales_conclusion:'sales',finance_reviewer:'finance',academic_reviewer:'academic'};
 const getFixtureActor=(_,id)=>people[id]?({actor_id:id,organization_id:org,
  role:people[id],active,fixture_only:true}):null;
 const ledger=createIsolatedManualLineageRecovery({integrityAudit:audit,
  getFixtureEvidenceWatermark,getFixtureActor});
 const request=(action,actor_id,nonce,extra={})=>({
  organization_id:org,incident_id:incident,action,actor_id,
  evidence_sha256:'b'.repeat(64),idempotency_key:nonce,...extra});
 const scope={organization_id:org,incident_id:incident};
 const create=async()=>{
  await ledger.apply(request('apply','sales_applicant','v94-apply-idempotency-00001'));
  await ledger.apply(request('review_sales','sales_reviewer','v94-sales-idempotency-00001'));
  await ledger.apply(request('review_finance','finance_reviewer','v94-fin-idempotency-00001'));
  await ledger.apply(request('review_academic','academic_reviewer','v94-acad-idempotency-00001'));
 };
 return {ledger,request,scope,create,setGeneration:x=>generation=x,
  setActive:x=>active=x,setFailed:x=>failed=x};
}
function safe(x){
 assert.equal(x.hold_active,true);
 for(const key of ['history_repair_allowed','automatic_recovery_allowed',
  'external_authority_verified','finance_authorized','academic_authorized',
  'handoff_allowed','compensation_write_allowed','release_eligible',
  'production_integration_allowed'])assert.equal(x[key],false,key);
}
test('V3.2-94 complete independent reviews only close administration, never business hold',async()=>{
 const f=fixture();await f.create();
 const conclusion=await f.ledger.apply(f.request('conclude','sales_conclusion',
  'v94-conclude-idempotency-00001'));
 assert.equal(conclusion.status,'closed_administratively');
 const report=await f.ledger.report(f.scope);safe(report);
 assert.equal(report.fixture_recovery_review_complete,true);
 assert.equal(report.history_count,5);assert.equal(report.events.length,5);
 assert.equal(report.events[4].previous_digest,report.events[3].record_digest);
 assert.equal(report.required_external_authority_categories,6);
});
test('V3.2-94 missing review, self approval, wrong owner, evidence mismatch all reject',async()=>{
 const f=fixture();
 await assert.rejects(f.ledger.apply(f.request('conclude','sales_conclusion',
  'v94-conclude-idempotency-00001')),{code:'RECOVERY_ACTION_OUT_OF_SEQUENCE'});
 await f.ledger.apply(f.request('apply','sales_applicant','v94-apply-idempotency-00001'));
 await assert.rejects(f.ledger.apply(f.request('review_sales','sales_applicant',
  'v94-review-idempotency-00001')),{code:'INDEPENDENT_REVIEWER_REQUIRED'});
 await assert.rejects(f.ledger.apply(f.request('review_sales','finance_reviewer',
  'v94-review-idempotency-00001')),{code:'INDEPENDENT_FIXTURE_ACTOR_NOT_VERIFIED'});
 await assert.rejects(f.ledger.apply(f.request('review_sales','sales_reviewer',
  'v94-review-idempotency-00001',{evidence_sha256:'c'.repeat(64)})),
  {code:'RECOVERY_EVIDENCE_DIGEST_MISMATCH'});
});
test('V3.2-94 source changes invalidate previous conclusions while retaining history',async()=>{
 const f=fixture();await f.create();
 await f.ledger.apply(f.request('conclude','sales_conclusion',
  'v94-conclude-idempotency-00001'));
 f.setGeneration(2);
 const r=await f.ledger.report(f.scope);safe(r);
 assert.equal(r.fixture_recovery_review_complete,false);
 assert.equal(r.status,'awaiting_application');assert.equal(r.history_count,5);
 await assert.rejects(f.ledger.apply(f.request('review_finance','finance_reviewer',
  'v94-new-idempotency-00001')),{code:'RECOVERY_ACTION_OUT_OF_SEQUENCE'});
});
test('V3.2-94 audit becomes healthy, actor revocation and cross-tenant forgery fail',async()=>{
 const f=fixture();f.setFailed(false);
 await assert.rejects(f.ledger.apply(f.request('apply','sales_applicant',
  'v94-apply-idempotency-00001')),{code:'NO_VERIFIED_RECOVERABLE_AUDIT_FAILURE'});
 f.setFailed(true);f.setActive(false);
 await assert.rejects(f.ledger.apply(f.request('apply','sales_applicant',
  'v94-apply-idempotency-00001')),{code:'INDEPENDENT_FIXTURE_ACTOR_NOT_VERIFIED'});
 f.setActive(true);
 await assert.rejects(f.ledger.apply(f.request('apply','sales_applicant',
  'v94-apply-idempotency-00001',{organization_id:'22222222-2222-4222-8222-222222222222'})),
  {code:'INDEPENDENT_EVIDENCE_WATERMARK_INVALID'});
});
test('V3.2-94 idempotent historical replay and conflicting payload are separated',async()=>{
 const f=fixture(),request=f.request('apply','sales_applicant',
  'v94-apply-idempotency-00001');
 const row=await f.ledger.apply(request);
 assert.strictEqual(await f.ledger.apply(request),row);
 await assert.rejects(f.ledger.apply({...request,evidence_sha256:'c'.repeat(64)}),
  {code:'RECOVERY_NONCE_CONFLICT'});
 assert.equal((await f.ledger.report(f.scope)).history_count,1);
});
