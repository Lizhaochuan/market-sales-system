import test from 'node:test';
import assert from 'node:assert/strict';
import {
 renderJointUatReadinessMarkdown,UAT_TASKS
} from '../../src/joint-integration-uat-report.mjs';

const FIN='20000000-0000-4000-8000-000000000001';
const ACAD='20000000-0000-4000-8000-000000000002';
function sample(){
 const checks=Object.entries(UAT_TASKS).map(([check_code,task])=>({
  check_code,department:task.department,production_verified:false,missing_events:0
 }));
 return {
  report_schema:'v3.2-32-joint-uat-v1',
  finance_source_request_id:FIN,academic_source_request_id:ACAD,
  check_count:16,checks,finance_unresolved_incidents:0,
  academic_unresolved_incidents:0,
  real_source_owners_approved:false,
  real_source_credentials_granted:false,
  production_ledger_replay_ready:false,
  real_cross_module_uat_passed:false,
  production_integration_allowed:false,
  execution_allowed:false,release_allowed:false,
  status:'blocked_real_authority_missing'
 };
}
test('V3.2-32 Chinese UAT handoff renderer is strict, deterministic and never grants authority',async t=>{
 await t.test('all 16 roles, documents, criteria and failure handling present',()=>{
  const doc=renderJointUatReadinessMarkdown(sample());
  assert.match(doc,/联合联调 UAT 待办报告/);
  assert.match(doc,/真实联调未授权/);
  assert.match(doc,/不得解除/);
  assert.match(doc,/快照指纹（仅比对清单版本，不是电子签名）/);
  assert.equal((doc.match(/未取得真实授权，阻断/g)||[]).length,16);
  for(const [code,task] of Object.entries(UAT_TASKS)){
   assert.ok(doc.includes(code),code);
   assert.ok(doc.includes(task.owner),code);
   assert.ok(doc.includes(task.evidence),code);
   assert.ok(doc.includes(task.acceptance),code);
   assert.ok(doc.includes(task.failure),code);
  }
  assert.equal(doc,renderJointUatReadinessMarkdown(sample()));
 });
 await t.test('order independent digest and output, only counts affect snapshot fingerprint',()=>{
  const x=sample();
  const y=sample();y.checks.reverse();
  assert.equal(renderJointUatReadinessMarkdown(x),renderJointUatReadinessMarkdown(y));
  y.checks[0]={...y.checks[0],missing_events:1};
  const m=renderJointUatReadinessMarkdown(y);
  assert.notEqual(m,renderJointUatReadinessMarkdown(x));
  assert.match(m,/未取得真实授权，阻断/);
 });
 await t.test('reject missing, duplicate, foreign, wrong department and fabricated passes',()=>{
  const mutations=[
   r=>r.checks.pop(),
   r=>r.checks[0]=r.checks[1],
   r=>r.checks[0]={...r.checks[0],check_code:'unsafe_source_approved'},
   r=>r.checks[0]={...r.checks[0],department:'security'},
   r=>r.checks[0]={...r.checks[0],production_verified:true},
   r=>r.checks[0]={...r.checks[0],missing_events:-1},
   r=>r.checks[0]={...r.checks[0],missing_events:1.5},
   r=>r.check_count=15,
   r=>r.status='approved',
   r=>r.execution_allowed=true,
   r=>r.release_allowed=true,
   r=>r.real_source_credentials_granted=true,
   r=>r.production_integration_allowed=true,
   r=>r.real_cross_module_uat_passed=true,
   r=>r.finance_source_request_id='../../foreign',
   r=>r.academic_source_request_id=r.finance_source_request_id,
   r=>r.finance_unresolved_incidents=-3,
   r=>r.academic_unresolved_incidents='0'
  ];
  for(const mutate of mutations){
   const x=sample();mutate(x);
   assert.throws(()=>renderJointUatReadinessMarkdown(x),TypeError);
  }
  assert.throws(()=>renderJointUatReadinessMarkdown(null),TypeError);
 });
});
