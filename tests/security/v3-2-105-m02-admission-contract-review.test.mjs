import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {
 reviewAdmissionManifest,generateAdmissionReport,
 loadReviewDependencies,auditRepository
} from '../../scripts/v3-2-105-audit-admission.mjs';

const base=fileURLToPath(new URL('../../',import.meta.url));
const manifest=JSON.parse(readFileSync(base+'spec/v3-2-105-m02-admission-contract-review.json','utf8'));
const dependencies=loadReviewDependencies(manifest);
const change=fn=>{const m=structuredClone(manifest);fn(m);return m;};
const invalid=m=>assert.equal(reviewAdmissionManifest(m,dependencies).valid,false);

test('V3.2-105 audited V101-V104 contracts prove no production admission',()=>{
 const validated=reviewAdmissionManifest(manifest,dependencies);
 assert.deepEqual(validated.errors,[]);
 assert.equal(validated.valid,true);
 assert.equal(dependencies.inventory.stages.length,18);
 assert.equal(manifest.baseline.pr,111);
 assert.equal(manifest.real_external_contract_status,'proposed-unimplemented');
 const report=auditRepository();
 assert.equal(report.status,'BLOCKED_INDEPENDENT_EVIDENCE_REQUIRED');
 assert.equal(report.production_readonly_ready,false);
 assert.equal(report.business_release_authorized,false);
 assert.equal(report.hold_active,true);
 assert.equal(report.gap_count,12);
 assert.ok(report.p0_count>=5);
 assert.equal(report.real_postgresql_checks_passed,0);
});
test('V3.2-105 changing ANY release right from false is a contract rejection',()=>{
 const keys=['finance_authorized','academic_authorized','handoff_allowed',
  'compensation_write_allowed','release_eligible','merge_authorized','deploy_authorized'];
 for(const key of keys)invalid(change(m=>{m.readiness[key]=true;}));
 invalid(change(m=>{m.readiness.hold_active=false;}));
 invalid(change(m=>{m.readiness.production_readonly_ready=true;}));
 invalid(change(m=>{m.readiness.real_finance_independent_signoff_verified=true;}));
 invalid(change(m=>{m.real_external_contract_status='implemented';}));
});
test('V3.2-105 no draft may claim done database test, 16 approvals or R01-R10',()=>{
 invalid(change(m=>{m.aggregate_checks.real_postgresql_checks_passed=8;}));
 invalid(change(m=>{m.aggregate_checks.real_external_checks_passed=16;}));
 invalid(change(m=>{m.aggregate_checks.new_migration_039_allowed=true;}));
 invalid(change(m=>{m.aggregate_checks.production_schema_migrations_added=1;}));
 invalid(change(m=>{m.readiness.sixteen_external_checks_verified=true;}));
 invalid(change(m=>{m.readiness.r01_to_r10_verified=true;}));
 invalid(change(m=>{m.readiness.postgresql_contract_uat_verified=true;}));
});
test('V3.2-105 missing P0 blockers, fake owners or fake approval proof must be rejected',()=>{
 invalid(change(m=>{m.gaps.shift();}));
 invalid(change(m=>{m.gaps[3].state='VERIFIED';}));
 invalid(change(m=>{m.gaps[3].owner_assignment='Alice';}));
 invalid(change(m=>{m.gaps[0].required_evidence=[];}));
 invalid(change(m=>{m.gaps[1].blocks=[];}));
 invalid(change(m=>{m.gaps[3].severity='P2';}));
});
test('V3.2-105 source contracts must explicitly keep real trust and persistence absent',()=>{
 const d=structuredClone(dependencies);
 d.fence.adapters.checkpointStore.implemented_in_production=true;
 assert.equal(reviewAdmissionManifest(manifest,d).valid,false);
 const d2=structuredClone(dependencies);
 d2.signedSource.integration.real_finance_signatures_verified=true;
 assert.equal(reviewAdmissionManifest(manifest,d2).valid,false);
 const d3=structuredClone(dependencies);
 d3.facade.lifecycle_revocation_overlay_is_mandatory=false;
 assert.equal(reviewAdmissionManifest(manifest,d3).valid,false);
 const d4=structuredClone(dependencies);
 d4.faultDrill.restart_durable_watermark_implemented=true;
 assert.equal(reviewAdmissionManifest(manifest,d4).valid,false);
});
test('V3.2-105 stale source references or removed V99 revocation overlay fail',()=>{
 const stale=structuredClone(dependencies);
 stale.facadeSource=stale.facadeSource.replace('attestationLifecycle.inspect(','attestationLifecycle.missing(');
 assert.equal(reviewAdmissionManifest(manifest,stale).valid,false);
 const noCheckpoint=structuredClone(dependencies);
 noCheckpoint.fenceSource=noCheckpoint.fenceSource.replace('checkpointStore.advance(','checkpointStore.skip(');
 assert.equal(reviewAdmissionManifest(manifest,noCheckpoint).valid,false);
 const shortChain=structuredClone(dependencies);
 shortChain.inventory.stages=[];
 assert.equal(reviewAdmissionManifest(manifest,shortChain).valid,false);
});
test('V3.2-105 business rules remain student-first with original history preserved',()=>{
 invalid(change(m=>{m.student_primary=false;}));
 invalid(change(m=>{m.family_optional=false;}));
 invalid(change(m=>{m.original_orders_payments_saleevent_lessons_compensations_immutable=false;}));
 invalid(change(m=>{m.production_database_touched=true;}));
 invalid(change(m=>{m.edu_management_system_touched=true;}));
});
test('V3.2-105 rejected manifest never returns a ready-for-deployment claim',()=>{
 const forged=change(m=>{m.readiness.finance_authorized=true;});
 const report=generateAdmissionReport(forged,dependencies);
 assert.equal(report.status,'MANIFEST_REJECTED');
 assert.equal(report.production_readonly_ready,false);
 assert.equal(report.business_release_authorized,false);
 assert.ok(report.errors.length>0);
});
