import test from 'node:test';
import assert from 'node:assert/strict';
import {createIsolatedDiffReviewTasks} from '../../src/cross-module-diff-review-tasks.mjs';
const org='11111111-1111-4111-8111-111111111111',incident='33333333-3333-4333-8333-333333333333';
const ref={organization_id:org,incident_id:incident,previous_audit_sequence:1,
 previous_audit_digest:'a'.repeat(64),new_audit_sequence:2,new_audit_digest:'b'.repeat(64)};
function setup(){
 let version=1,active=true;
 const evidenceDiff={report:async()=>({
  reason_code:'BLOCKED_REVIEW_CHANGED_EVIDENCE_AND_EXTERNAL_GAPS',
  fixture_comparison_complete:true,hold_active:true,handoff_allowed:false,
  release_eligible:false,finance_authorized:false,academic_authorized:false,
  differences:[{item:'finance_signature',owner_department:'finance',
   rereview_required:true,before_version:1,after_version:version}],
  external_requirements:['a','b','c','d','e','f'].map(code=>({code,status:'requires_external_authority'}))})};
 const getFixtureActor=(_,id)=>({actor_id:id,organization_id:org,role:'finance',
  active,fixture_only:true});
 const gate=createIsolatedDiffReviewTasks({evidenceDiff,getFixtureActor});
 const req=(action,id,nonce)=>({reference:ref,item:'finance_signature',
  action,actor_id:id,idempotency_key:nonce});
 return {gate,req,setVersion:v=>version=v,setActive:x=>active=x};
}
function safe(x){
 assert.equal(x.hold_active,true);
 for(const k of ['external_authority_verified','finance_authorized','academic_authorized',
 'handoff_allowed','compensation_write_allowed','release_eligible'])assert.equal(x[k],false,k);
}
test('V3.2-87 review task lifecycle never clears real handoff hold',async()=>{
 const f=setup();let x=await f.gate.report(ref);safe(x);
 assert.equal(x.remaining_count,1);
 await f.gate.record(f.req('start','finance_reviewer','v87-start-nonce-00001'));
 x=await f.gate.report(ref);assert.equal(x.tasks[0].status,'in_review');
 await f.gate.record(f.req('complete','finance_checker','v87-close-nonce-00001'));
 x=await f.gate.report(ref);safe(x);
 assert.equal(x.fixture_all_tasks_reviewed,true);assert.equal(x.remaining_count,0);
 assert.equal(x.reason_code,'BLOCKED_EXTERNAL_HANDOFF_EVEN_IF_TASKS_COMPLETE');
});
test('V3.2-87 new evidence makes old completion pending',async()=>{
 const f=setup();
 await f.gate.record(f.req('start','finance_reviewer','v87-start-nonce-00001'));
 await f.gate.record(f.req('complete','finance_checker','v87-close-nonce-00001'));
 f.setVersion(2);
 const x=await f.gate.report(ref);safe(x);
 assert.equal(x.remaining_count,1);assert.equal(x.tasks[0].status,'pending');
});
test('V3.2-87 wrong transitions, duplicate conflicts, self completion fail closed',async()=>{
 const f=setup();
 await assert.rejects(f.gate.record(f.req('complete','finance_checker','v87-close-nonce-00001')),
  {code:'TASK_NOT_IN_REVIEW'});
 const p=f.req('start','finance_reviewer','v87-start-nonce-00001');
 const first=await f.gate.record(p);
 assert.strictEqual(await f.gate.record(p),first);
 await assert.rejects(f.gate.record({...p,actor_id:'finance_checker'}),
  {code:'TASK_NONCE_CONFLICT'});
 await assert.rejects(f.gate.record(f.req('complete','finance_reviewer','v87-close-nonce-00001')),
  {code:'INDEPENDENT_TASK_COMPLETER_REQUIRED'});
});
test('V3.2-87 withdrawn actor and forged scope cannot be treated as valid',async()=>{
 const f=setup();
 await f.gate.record(f.req('start','finance_reviewer','v87-start-nonce-00001'));
 await f.gate.record(f.req('complete','finance_checker','v87-close-nonce-00001'));
 f.setActive(false);
 const x=await f.gate.report(ref);safe(x);
 assert.equal(x.tasks[0].status,'reviewer_revoked_recheck_required');
 assert.equal(x.remaining_count,1);
 await assert.rejects(f.gate.record({...f.req('start','finance_reviewer','v87-start-nonce-00002'),
  reference:{...ref,finance_authorized:true}}),{code:'INVALID_TASK_RECORD_INPUT'});
});
