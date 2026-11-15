// V3.2-121 CI-only readiness accounting. This module intentionally contains
// NO release function, credential, mutation or pathway to lift a quarantine.
const REQUIRED_CI_IDS=Object.freeze(['CI-001','CI-002','CI-003','CI-004','CI-005','CI-006','CI-007']);
const REQUIRED_EXTERNAL_IDS=Object.freeze([
 'EXT-001','EXT-002','EXT-003','EXT-004','EXT-005',
 'EXT-006','EXT-007','EXT-008','EXT-009','EXT-010'
]);
const REQUIRED_SIGNOFFS=Object.freeze(['SECURITY','AUDIT','SALES','FINANCE','ACADEMIC','OPERATIONS']);
const REQUIRED_FORBIDDEN=Object.freeze([
 'MERGE','PRODUCTION_DEPLOY','REAL_DATA_MUTATION','SECURITY_QUARANTINE_RELEASE','KEY_ISSUANCE_RESUME'
]);

const fail=()=>{throw Object.assign(new Error('V121_READINESS_CONTRACT_INVALID'),{code:'V121_READINESS_CONTRACT_INVALID'});};
const same=(values,expected)=>Array.isArray(values) &&
 values.length===expected.length &&
 expected.every(key=>values.filter(value=>value===key).length===1);

export function validateFixtureV121Readiness(manifest){
 if(!manifest || typeof manifest!=='object' || Array.isArray(manifest) ||
  manifest.schema_version!=='v3.2-121-release-readiness-v1' ||
  manifest.scope!=='CI_ONLY_DRAFT' || manifest.draft_pr!==129 ||
  manifest.release_authorization_implemented!==false ||
  manifest.production_release_status!=='HOLD' ||
  manifest.hold_active!==true || manifest.release_eligible!==false ||
  !Array.isArray(manifest.allowed_actions) ||
  manifest.allowed_actions.length!==3 ||
  !same(manifest.allowed_actions,['ISOLATED_CI_TEST','DRAFT_PR_REVIEW','EVIDENCE_GAP_TRACKING']) ||
  !same(manifest.forbidden_actions,REQUIRED_FORBIDDEN) ||
  !Array.isArray(manifest.ci_controls) || !Array.isArray(manifest.production_gaps) ||
  !Array.isArray(manifest.manual_signoffs) ||
  !Array.isArray(manifest.explicit_non_evidence) || manifest.explicit_non_evidence.length<4)
  fail();
 if(!same(manifest.ci_controls.map(x=>x?.id),REQUIRED_CI_IDS) ||
    !same(manifest.production_gaps.map(x=>x?.id),REQUIRED_EXTERNAL_IDS) ||
    !same(manifest.manual_signoffs.map(x=>x?.domain),REQUIRED_SIGNOFFS))
  fail();
 for(const item of manifest.ci_controls){
  if(item.status!=='CI_SCOPE_ONLY' || typeof item.description!=='string' ||
    !item.description.trim() || !Array.isArray(item.evidence) || item.evidence.length===0 ||
    !item.evidence.every(x=>typeof x==='string' && /^(tests\/|\.github\/workflows\/)/.test(x) &&
     !x.includes('..') && (x.endsWith('.mjs')||x.endsWith('.sql')||x.endsWith('.yml'))))
   fail();
 }
 for(const item of manifest.production_gaps){
  if(item.status!=='UNVERIFIED' ||
    !REQUIRED_SIGNOFFS.includes(item.owner_domain) ||
    typeof item.requirement!=='string' || !item.requirement.trim())
   fail();
 }
 for(const item of manifest.manual_signoffs){
  if(item.status!=='NOT_SIGNED') fail();
 }
 if(!manifest.explicit_non_evidence.every(x=>typeof x==='string' && x.length>=20))
  fail();
 return true;
}

export function evaluateFixtureV121Readiness(manifest,{ciPassed=false}={}){
 validateFixtureV121Readiness(manifest);
 if(typeof ciPassed!=='boolean') fail();
 return Object.freeze({
  decision:'HOLD_NOT_PRODUCTION_READY',
  ci_status:ciPassed?'CI_TESTS_PASSED_ONLY':'CI_NOT_VERIFIED',
  ci_tested_controls:manifest.ci_controls.length,
  unverified_external_gates:manifest.production_gaps.map(x=>x.id),
  missing_independent_signoffs:manifest.manual_signoffs.map(x=>x.domain),
  release_authorized:false,
  merge_allowed:false,
  deploy_allowed:false,
  quarantine_active:true,
  hold_active:true,
  release_eligible:false,
  reason:'CI checks and simulated approvals cannot authorize production release'
 });
}
