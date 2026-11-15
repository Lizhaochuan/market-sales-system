import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateFixtureV121Handover,evaluateFixtureV121Handover}
 from '../../src/cross-module-v121-production-handover.mjs';

const read=(file)=>JSON.parse(readFileSync(new URL(file,import.meta.url),'utf8'));
const readiness=()=>read('../../docs/market-sales/v3-2-121-release-readiness.json');
const handover=()=>read('../../docs/market-sales/v3-2-121-production-handover.json');
const task=(h,id)=>h.tasks.find(x=>x.id===id);
const reject=change=>{
 const doc=handover();
 change(doc);
 assert.throws(()=>validateFixtureV121Handover(readiness(),doc),
  {code:'V121_HANDOVER_CONTRACT_INVALID'});
};

test('production gap handover covers every unverified requirement with independent reviewer and evidence checklist',()=>{
 const r=readiness(),h=handover();
 assert.equal(validateFixtureV121Handover(r,h),true);
 assert.equal(h.tasks.length,10);
 assert.equal(h.owner_assignment_mode,'ROLE_ONLY_NOT_NAMED');
 assert.equal(h.due_dates_assigned,false);
 assert.equal(h.artifacts_are_production_evidence,false);
 assert.deepEqual(h.tasks.map(x=>x.id).sort(),r.production_gaps.map(x=>x.id).sort());
 for(const t of h.tasks){
  const parent=r.production_gaps.find(x=>x.id===t.id);
  assert.equal(t.owner_domain,parent.owner_domain);
  assert.notEqual(t.reviewer_domain,t.owner_domain);
  assert.equal(t.package_status,'NOT_COLLECTED');
  assert.deepEqual(t.evidence_artifact_refs,[]);
  assert.equal(t.independent_review_status,'NOT_REVIEWED');
  assert.equal(t.manual_signoff_status,'NOT_SIGNED');
  assert.equal(t.handoff_receipt_ref,null);
  assert.ok(t.evidence_requirements.length>=2);
  assert.ok(t.acceptance_checks.length>=2);
 }
});

test('the ordered responsibility handoff is a dependency DAG, not a production authorization',()=>{
 const r=readiness(),h=handover();
 for(const ciPassed of [false,true]){
  const result=evaluateFixtureV121Handover(r,h,{ciPassed});
  assert.deepEqual(result.planning_order,[
   'EXT-001','EXT-002','EXT-003','EXT-004','EXT-009',
   'EXT-005','EXT-006','EXT-007','EXT-008','EXT-010'
  ]);
  assert.deepEqual(result.initial_discovery_task_ids,['EXT-001']);
  assert.equal(result.ci_status,ciPassed?'CI_TESTS_PASSED_ONLY':'CI_NOT_VERIFIED');
  assert.equal(result.uncollected_packages,10);
  assert.equal(result.external_gates_unverified,10);
  assert.equal(result.independent_domain_signoffs_missing,6);
  assert.equal(result.evidence_receipts_recorded,0);
  for(const prop of ['release_authorized','merge_allowed','deploy_allowed','release_eligible'])
   assert.equal(result[prop],false);
  assert.equal(result.hold_active,true);
  assert.equal(result.quarantine_active,true);
  assert.equal(result.decision,'HOLD_NOT_PRODUCTION_READY');
  assert.ok(Object.isFrozen(result));
 }
 assert.throws(()=>evaluateFixtureV121Handover(r,h,{ciPassed:'success'}),
  {code:'V121_HANDOVER_CONTRACT_INVALID'});
});

test('editing readiness ownership or approvals without fresh independent verification is refused',()=>{
 const changed=readiness();
 changed.production_gaps[4].owner_domain='FINANCE';
 assert.throws(()=>validateFixtureV121Handover(changed,handover()),
  {code:'V121_HANDOVER_CONTRACT_INVALID'});
 const claimed=readiness();
 claimed.production_gaps[0].status='VERIFIED';
 assert.throws(()=>validateFixtureV121Handover(claimed,handover()),
  {code:'V121_READINESS_CONTRACT_INVALID'});
});

test('unsafe handover edits and forged evidence claims are rejected',()=>{
 reject(h=>{h.release_authorized=true;});
 reject(h=>{h.hold_active=false;});
 reject(h=>{h.deploy_allowed=true;});
 reject(h=>{h.scope='PRODUCTION';});
 reject(h=>{h.owner_assignment_mode='ACTUAL_PERSON_CONFIRMED';});
 reject(h=>{h.due_dates_assigned=true;});
 reject(h=>{h.artifacts_are_production_evidence=true;});
 reject(h=>{h.tasks[0].package_status='COLLECTED';});
 reject(h=>{h.tasks[0].evidence_artifact_refs=['https://invented.example/proof'];});
 reject(h=>{h.tasks[0].handoff_receipt_ref='FAKE_RECEIPT';});
 reject(h=>{h.tasks[0].manual_signoff_status='SIGNED';});
 reject(h=>{h.tasks[0].independent_review_status='PASSED';});
 reject(h=>{h.tasks[0].reviewer_domain=h.tasks[0].owner_domain;});
 reject(h=>{h.tasks[0].owner_role='UNAPPROVED_PERSON';});
 reject(h=>{h.tasks[3].depends_on=[];});
 reject(h=>{task(h,'EXT-005').depends_on.push('EXT-006');});
 reject(h=>{task(h,'EXT-010').depends_on=task(h,'EXT-010').depends_on.filter(v=>v!=='EXT-006');});
 reject(h=>{task(h,'EXT-008').phase=4;});
 reject(h=>{h.tasks[0].evidence_requirements.splice(1,1);});
 reject(h=>{h.tasks[0].evidence_requirements[0].description='';});
 reject(h=>{h.tasks[0].evidence_requirements[0].required=false;});
 reject(h=>{h.tasks[0].acceptance_checks=[];});
 reject(h=>{h.tasks[0].id='EXT-099';});
 reject(h=>{h.tasks.push(structuredClone(h.tasks[0]));});
 reject(h=>{h.signoff_domains.pop();});
 reject(h=>{h.phase_order.reverse();});
});
