// CI-only production evidence handover PLAN. No real signoffs, production access,
// evidence receipts, timers, deployments or release permissions are created.
import {validateFixtureV121Readiness} from './cross-module-v121-release-readiness.mjs';

const PHASES=Object.freeze([
 'SECURITY_FOUNDATION','CRYPTO_AND_AUDIT_ANCHORS','MONITORING_AND_PROVENANCE',
 'SALES_STUDENT_RECONCILIATION','FINANCE_AND_ACADEMIC_RECONCILIATION',
 'DISASTER_RECOVERY_AND_CROSS_MODULE_TEST','INDEPENDENT_UAT_CHANGE_CONTROL'
]);
const DEPS=Object.freeze({
 'EXT-001':[], 'EXT-002':['EXT-001'], 'EXT-003':['EXT-001'],
 'EXT-004':['EXT-001','EXT-002'], 'EXT-005':['EXT-001','EXT-009'],
 'EXT-006':['EXT-005','EXT-001'], 'EXT-007':['EXT-005','EXT-001'],
 'EXT-008':['EXT-002','EXT-003','EXT-004','EXT-006','EXT-007'],
 'EXT-009':['EXT-003'],
 'EXT-010':['EXT-001','EXT-002','EXT-003','EXT-004','EXT-005',
  'EXT-006','EXT-007','EXT-008','EXT-009']
});
const EXPECTED_PHASE=Object.freeze({
 'EXT-001':1,'EXT-002':2,'EXT-003':2,'EXT-004':3,'EXT-005':4,
 'EXT-006':5,'EXT-007':5,'EXT-008':6,'EXT-009':3,'EXT-010':7
});
const REVIEWERS=Object.freeze({
 'EXT-001':'AUDIT','EXT-002':'AUDIT','EXT-003':'SECURITY','EXT-004':'AUDIT',
 'EXT-005':'AUDIT','EXT-006':'AUDIT','EXT-007':'AUDIT','EXT-008':'SECURITY',
 'EXT-009':'SECURITY','EXT-010':'AUDIT'
});
const fail=()=>{throw Object.assign(new Error('V121_HANDOVER_CONTRACT_INVALID'),
 {code:'V121_HANDOVER_CONTRACT_INVALID'});};
const same=(actual,expected)=>Array.isArray(actual) &&
 actual.length===expected.length &&
 expected.every(value=>actual.filter(x=>x===value).length===1);
const text=s=>typeof s==='string' && s.trim().length>=8;

export function validateFixtureV121Handover(readiness,handover){
 validateFixtureV121Readiness(readiness);
 if(!handover || typeof handover!=='object' || Array.isArray(handover) ||
  handover.schema_version!=='v3.2-121-production-handover-v1' ||
  handover.scope!=='CI_ONLY_DRAFT' || handover.draft_pr!==129 ||
  handover.source_readiness!=='docs/market-sales/v3-2-121-release-readiness.json' ||
  handover.decision!=='HOLD_NOT_PRODUCTION_READY' ||
  handover.hold_active!==true || handover.release_eligible!==false ||
  handover.release_authorized!==false || handover.merge_allowed!==false ||
  handover.deploy_allowed!==false || handover.due_dates_assigned!==false ||
  handover.owner_assignment_mode!=='ROLE_ONLY_NOT_NAMED' ||
  handover.artifacts_are_production_evidence!==false ||
  !Array.isArray(handover.phase_order) ||
  handover.phase_order.length!==PHASES.length ||
  !handover.phase_order.every((v,i)=>v===PHASES[i]) ||
  !Array.isArray(handover.tasks) || !Array.isArray(handover.signoff_domains) ||
  !text(handover.explicit_handoff_rule)) fail();

 const ids=readiness.production_gaps.map(x=>x.id);
 const domains=readiness.manual_signoffs.map(x=>x.domain);
 if(!same(handover.tasks.map(t=>t?.id),ids) ||
    !same(handover.signoff_domains,domains)) fail();
 const byId=new Map(handover.tasks.map(t=>[t.id,t]));
 for(const gap of readiness.production_gaps){
  const t=byId.get(gap.id);
  if(t.owner_domain!==gap.owner_domain ||
    t.owner_role!==gap.owner_domain+'_EVIDENCE_OWNER' ||
    t.reviewer_domain!==REVIEWERS[gap.id] ||
    t.reviewer_domain===t.owner_domain ||
    !domains.includes(t.reviewer_domain) ||
    t.reviewer_role!==t.reviewer_domain+'_INDEPENDENT_REVIEWER' ||
    t.phase!==EXPECTED_PHASE[gap.id] || !text(t.title) ||
    !same(t.depends_on,DEPS[gap.id]) ||
    t.package_status!=='NOT_COLLECTED' ||
    t.independent_review_status!=='NOT_REVIEWED' ||
    t.manual_signoff_status!=='NOT_SIGNED' ||
    t.handoff_receipt_ref!==null ||
    !Array.isArray(t.evidence_artifact_refs) ||
    t.evidence_artifact_refs.length!==0 ||
    !Array.isArray(t.evidence_requirements) ||
    t.evidence_requirements.length<2 ||
    !Array.isArray(t.acceptance_checks) ||
    t.acceptance_checks.length<2 ||
    !t.acceptance_checks.every(text) ||
    new Set(t.acceptance_checks).size!==t.acceptance_checks.length) fail();

  const evidenceIds=t.evidence_requirements.map(x=>x?.id);
  if(new Set(evidenceIds).size!==evidenceIds.length) fail();
  for(let j=0;j<t.evidence_requirements.length;j++){
   const req=t.evidence_requirements[j];
   if(req.id!==gap.id+'-E'+(j+1) || req.required!==true ||
      !text(req.description)) fail();
  }
 }
 // Defensive DAG check as well as fixed dependency map: prevent circular or
 // missing prerequisites even after future contract revisions.
 const temporary=new Set(),permanent=new Set();
 function visit(id){
  if(temporary.has(id)) fail();
  if(permanent.has(id)) return;
  const task=byId.get(id);
  if(!task) fail();
  temporary.add(id);
  for(const dep of task.depends_on){
   if(!byId.has(dep) || dep===id || byId.get(dep).phase>=task.phase) fail();
   visit(dep);
  }
  temporary.delete(id);
  permanent.add(id);
 }
 for(const id of ids) visit(id);
 return true;
}

export function evaluateFixtureV121Handover(readiness,handover,{ciPassed=false}={}){
 validateFixtureV121Handover(readiness,handover);
 if(typeof ciPassed!=='boolean') fail();
 const ordered=[...handover.tasks].sort((a,b)=>a.phase-b.phase || a.id.localeCompare(b.id));
 return Object.freeze({
  decision:'HOLD_NOT_PRODUCTION_READY',
  ci_status:ciPassed?'CI_TESTS_PASSED_ONLY':'CI_NOT_VERIFIED',
  planning_order:ordered.map(x=>x.id),
  initial_discovery_task_ids:ordered.filter(x=>x.depends_on.length===0).map(x=>x.id),
  uncollected_packages:ordered.length,
  external_gates_unverified:readiness.production_gaps.length,
  independent_domain_signoffs_missing:readiness.manual_signoffs.length,
  evidence_receipts_recorded:0,
  release_authorized:false,
  merge_allowed:false,
  deploy_allowed:false,
  quarantine_active:true,
  hold_active:true,
  release_eligible:false
 });
}
