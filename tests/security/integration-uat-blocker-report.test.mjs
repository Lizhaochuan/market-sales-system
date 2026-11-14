import test from 'node:test';
import assert from 'node:assert/strict';
import {buildBlockedUatTasks,renderBlockedUatMarkdown,UAT_CHECKS}
 from '../../src/integration-uat-blocker-report.mjs';
const id='20000000-0000-4000-8000-000000000123';
const codes=Object.keys(UAT_CHECKS);
const make=(department='finance')=>{
 const selected=codes.filter(c=>c.startsWith('sales_')||
  c.startsWith(department+'_')||c.startsWith('security_'));
 return {
 schema_version:'v3.2-32-readonly-uat-v1',
 source_request_id:id,department,required_gate_count:selected.length,
 recorded_missing_events:0,
 tasks:selected.map(code=>({
   check_code:code,responsible_department:code.split('_')[0],
   label_zh:code+' 核查事项',required_evidence_zh:'虚构权威材料尚未提供',
   missing_events:0,uat_status:'blocked_real_approval_missing',
   real_evidence_verified:false,real_owner_signed:false,ready_for_production:false
 })),
 technical_ci_is_business_approval:false,fixture_approvals_are_real:false,
 real_finance_source_connected:false,real_crm_source_connected:false,
 production_integration_allowed:false,execution_allowed:false,release_allowed:false
 };
};
test('V3.2-32 pure UAT blocker rendering never converts CI or evidence counts to real approval',async t=>{
 await t.test('each domain contains exact 12 items and all four responsibility areas',()=>{
  for(const d of ['finance','academic']){
   const x=buildBlockedUatTasks(make(d));
   assert.equal(x.total,12);
   assert.equal(new Set(x.tasks.map(y=>y.code)).size,12);
   assert.equal(x.production_integration_allowed,false);
   assert.equal(x.execution_allowed,false);
   assert.equal(x.release_allowed,false);
   assert.ok(x.tasks.some(z=>z.department==='sales'));
   assert.ok(x.tasks.some(z=>z.department===d));
   assert.ok(x.tasks.some(z=>z.department==='security'));
   assert.ok(x.tasks.every(z=>z.status==='待真实业务证据／禁止联调'));
   const md=renderBlockedUatMarkdown(make(d));
   assert.match(md,/禁止真实联调/);
   assert.match(md,/不可以|不得|禁止/);
   assert.match(md,/资金／订单／课时/);
   assert.match(md,/负责人/);
   assert.match(md,/拒绝条件/);
   assert.equal(md.split('\n').filter(line=>line.startsWith('| `')).length,12);
  }
 });
 await t.test('recording zero missing events is not evidence acceptance',()=>{
  const x=make();
  const result=renderBlockedUatMarkdown(x);
  assert.match(result,/已登记缺失事件：\*\* 0 条/);
  assert.match(result,/真实授权尚未取得/);
  assert.doesNotMatch(result,/已批准真实来源/);
 });
 await t.test('strict negative status booleans and forged acceptances rejected',()=>{
  for(const field of ['technical_ci_is_business_approval',
   'fixture_approvals_are_real','real_finance_source_connected',
   'real_crm_source_connected','production_integration_allowed',
   'execution_allowed','release_allowed']){
    const x=make();x[field]=true;
    assert.throws(()=>buildBlockedUatTasks(x),TypeError,field);
  }
  for(const field of ['real_evidence_verified','real_owner_signed',
    'ready_for_production']){
   const x=make();x.tasks[0][field]=true;
   assert.throws(()=>renderBlockedUatMarkdown(x),TypeError);
  }
  {const x=make();x.tasks[0].uat_status='approved';
   assert.throws(()=>buildBlockedUatTasks(x),TypeError);}
 });
 await t.test('wrong domain, incomplete gate list, duplicates and changed counts rejected',()=>{
  {const x=make();x.department='academic';assert.throws(()=>buildBlockedUatTasks(x));}
  {const x=make();x.required_gate_count=11;assert.throws(()=>buildBlockedUatTasks(x));}
  {const x=make();x.tasks.pop();assert.throws(()=>buildBlockedUatTasks(x));}
  {const x=make();x.tasks[1].check_code=x.tasks[0].check_code;
   assert.throws(()=>buildBlockedUatTasks(x));}
  {const x=make();x.tasks[0].missing_events=2;
   assert.throws(()=>buildBlockedUatTasks(x));}
  {const x=make();x.tasks[0].responsible_department='academic';
   assert.throws(()=>buildBlockedUatTasks(x));}
  {const x=make();x.source_request_id='../../other-tenant';
   assert.throws(()=>buildBlockedUatTasks(x));}
 });
 await t.test('report escapes untrusted labels, never inserts markup or alternate approval',()=>{
  const x=make();
  x.tasks[0].label_zh='malicious | <script>alert(1)</script>\nnew row';
  const rendered=renderBlockedUatMarkdown(x);
  assert.ok(rendered.includes('malicious \\| &lt;script&gt;'));
  assert.ok(!rendered.includes('<script>'));
  assert.equal(rendered.split('\n').filter(line=>line.startsWith('| `')).length,12);
 });
});
