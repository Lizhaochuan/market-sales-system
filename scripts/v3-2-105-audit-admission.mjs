// V3.2-105: static, non-production admission review of existing CI-only contracts.
// This report never validates real approvals or grants operational permissions.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
const path=p=>resolve(root,p);
const read=p=>readFileSync(path(p),'utf8');
const json=p=>JSON.parse(read(p));
const isPlain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const statuses=new Set(['UNVERIFIED','UNIMPLEMENTED','NOT_RUN','UNREVIEWED_FOR_MERGE']);
const requiredGapIds=Array.from({length:12},(_,i)=>'ADM-'+String(i+1).padStart(3,'0'));
const deniedKeys=['finance_authorized','academic_authorized','handoff_allowed',
 'compensation_write_allowed','release_eligible','merge_authorized','deploy_authorized'];

export function reviewAdmissionManifest(m,dependencies={}){
 const errors=[];
 const check=(ok,message)=>{if(!ok)errors.push(message);};
 check(isPlain(m),'Expected an object manifest');
 if(!isPlain(m))return {valid:false,errors};
 check(m.schema_version==='v3.2-105-m02-comprehensive-admission-review-v1',
  'Unexpected review schema');
 check(m.baseline?.pr===111&&/^[a-f0-9]{40}$/.test(m.baseline?.head_sha),
  'Baseline must pin verified PR #111 and full HEAD');
 check(m.scope==='STATIC_REVIEW_AND_CI_ONLY_NO_PRODUCTION_CHANGE',
  'Out of scope');
 check(m.real_external_contract_status==='proposed-unimplemented',
  'Formal contract not yet implemented');
 check(m.production_runtime_touched===false&&m.production_database_touched===false&&
  m.edu_management_system_touched===false,'Production changes must be absent');
 check(m.student_primary===true&&m.family_optional===true&&
  m.original_orders_payments_saleevent_lessons_compensations_immutable===true,
  'Frozen student and historical data rules missing');
 for(const key of deniedKeys)check(m.readiness?.[key]===false,
  'Unauthorized readiness flag: '+key);
 check(m.readiness?.hold_active===true,'Business isolation must remain active');
 for(const [key,value] of Object.entries(m.readiness||{})){
  if(key.endsWith('_verified')||key.endsWith('_ready')||key.endsWith('_wired'))
   check(value===false||key==='fixture_node_test_passed_on_parent',
    'Real readiness cannot be asserted by CI fixture: '+key);
 }
 const totals=m.aggregate_checks;
 check(isPlain(totals),'Aggregate counts missing');
 if(isPlain(totals)){
  for(const [key,n] of Object.entries({
   original_stage_count:18,external_admission_checks_required:16,
   r01_to_r10_required:10,required_external_authority_categories:6,
   database_plan_checks:8,real_postgresql_checks_passed:0,
   real_external_checks_passed:0,production_schema_migrations_added:0
  }))check(totals[key]===n,'Unexpected count '+key);
  check(totals.new_migration_039_allowed===false,'Migration 039 cannot be allowed');
 }
 check(Array.isArray(m.gaps)&&m.gaps.length===12,'Expected 12 explicit blockers');
 if(Array.isArray(m.gaps)){
  check(m.gaps.map(x=>x.id).join(',')===requiredGapIds.join(','),
   'Required blocking IDs missing or reordered');
  const roles=new Set(['sales_owner','finance_owner','academic_owner',
   'identity_owner','security_identity_owner','database_owner',
   'integration_owner','qa_owner','project_owner','code_owner']);
  for(const entry of m.gaps){
   check(['P0','P1','P2'].includes(entry.severity),
    'Risk severity undefined: '+entry.id);
   check(statuses.has(entry.state),'Unverified gap marked as complete: '+entry.id);
   check(entry.owner_assignment==='UNASSIGNED'&&roles.has(entry.owner_role),
    'Unverified responsible owner: '+entry.id);
   check(Array.isArray(entry.required_evidence)&&entry.required_evidence.length>=2,
    'Acceptance evidence unspecified: '+entry.id);
   check(Array.isArray(entry.blocks)&&entry.blocks.length>0,
    'Non-blocking admission issue: '+entry.id);
  }
  check(m.gaps.some(x=>x.id==='ADM-004'&&x.severity==='P0'&&x.state==='NOT_RUN'),
   'Real durable database blocker must remain explicit');
 }
 check(Array.isArray(m.architecture_decisions)&&
  m.architecture_decisions.length>=7,'Source trust and write-boundary decisions missing');
 const sources=dependencies;
 if(isPlain(sources)){
  const i=sources.inventory,facade=sources.facade,
   source=sources.signedSource,fault=sources.faultDrill,fence=sources.fence;
  check(i?.stages?.length===18,'V3.2-100 chain not verified');
  check(facade?.production_server_wired===false&&
   facade?.lifecycle_revocation_overlay_is_mandatory===true,
   'Revocation-aware read-only facade contract missing');
  check(source?.integration?.production_read_api_connected===false&&
   source?.integration?.real_finance_signatures_verified===false&&
   source?.integration?.real_academic_signatures_verified===false,
   'Real source signatures cannot be inferred from fixture');
  check(fault?.restart_durable_watermark_implemented===false&&
   fault?.production_trust_anchor_implemented===false,
   'Restart trust-gap observation missing');
  check(fence?.adapters?.checkpointStore?.implemented_in_production===false&&
   fence?.adapters?.checkpointStore?.simulated_store_only===true&&
   fence?.production_database_test_plan?.length===8,
   'Durable transaction remains a proposed interface');
  if(typeof sources.facadeSource==='string')
   check(sources.facadeSource.includes('attestationLifecycle.inspect('),
    'V3.2-99 revocation overlay must be invoked');
  if(typeof sources.fenceSource==='string'){
   check(sources.fenceSource.includes('checkpointStore.advance('),
    'Checkpoint-only write side effect must be disclosed');
   check(sources.fenceSource.includes('return block('),
    'Fixture trust result must be blocked');
  }
 }
 return {valid:errors.length===0,errors};
}
export function generateAdmissionReport(m,dependencies){
 const validation=reviewAdmissionManifest(m,dependencies);
 if(!validation.valid)return {
  status:'MANIFEST_REJECTED',errors:validation.errors,
  production_readonly_ready:false,business_release_authorized:false};
 const missing=m.gaps.map(x=>({
  id:x.id,severity:x.severity,domain:x.domain,
  state:x.state,owner_role:x.owner_role,
  owner_assignment:x.owner_assignment,required_evidence:x.required_evidence
 }));
 return {
  status:'BLOCKED_INDEPENDENT_EVIDENCE_REQUIRED',
  stage:'V3.2-105',
  baseline_pr:m.baseline.pr,
  baseline_sha:m.baseline.head_sha,
  gap_count:missing.length,
  p0_count:missing.filter(x=>x.severity==='P0').length,
  production_readonly_ready:false,business_release_authorized:false,
  merge_authorized:false,deploy_authorized:false,hold_active:true,
  real_postgresql_checks_passed:0,
  real_external_checks_passed:0,
  missing_evidence:missing
 };
}
export function loadReviewDependencies(m){
 const e=m.evidence_sources;
 return {
  inventory:json(e.original_inventory),
  facade:json(e.facade_contract),
  signedSource:json(e.fixture_signature_contract),
  faultDrill:json(e.fault_drill_contract),
  fence:json(e.trust_fence_contract),
  facadeSource:read(e.facade_implementation),
  fenceSource:read(e.trust_implementation)
 };
}
export function auditRepository(){
 const m=json('spec/v3-2-105-m02-admission-contract-review.json');
 return generateAdmissionReport(m,loadReviewDependencies(m));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const result=auditRepository();
 process.stdout.write(JSON.stringify(result,null,2)+'\n');
 if(result.status!=='BLOCKED_INDEPENDENT_EVIDENCE_REQUIRED')process.exitCode=1;
}
