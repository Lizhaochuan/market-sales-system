import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import pg from 'pg';
import {UAT_CHECKS} from '../../src/integration-uat-blocker-report.mjs';
import {buildBlockedJointUatReport,renderBlockedJointUatMarkdown,
 loadBlockedJointUatReport} from '../../src/joint-integration-uat-blocker-report.mjs';

const idF='20000000-0000-4000-8000-000000000111';
const idA='20000000-0000-4000-8000-000000000112';
const codes=Object.keys(UAT_CHECKS);
const key=()=>randomBytes(20).toString('hex');
function fixture(domain,id){
 const selected=codes.filter(code=>code.startsWith('sales_')||
  code.startsWith(domain+'_')||code.startsWith('security_'));
 const tasks=selected.map(code=>({
  check_code:code,responsible_department:code.split('_')[0],
  label_zh:code+' 需要核查',required_evidence_zh:'虚构材料必须经独立批准',
  missing_events:code==='sales_contract_party'?(domain==='finance'?1:2):0,
  uat_status:'blocked_real_approval_missing',
  real_evidence_verified:false,real_owner_signed:false,ready_for_production:false
 }));
 return {schema_version:'v3.2-32-readonly-uat-v1',
  source_request_id:id,department:domain,required_gate_count:12,
  recorded_missing_events:tasks.reduce((n,x)=>n+x.missing_events,0),tasks,
  technical_ci_is_business_approval:false,fixture_approvals_are_real:false,
  real_finance_source_connected:false,real_crm_source_connected:false,
  production_integration_allowed:false,execution_allowed:false,release_allowed:false};
}
test('V3.2-50 blocked joint report preserves sixteen unique checks and source-specific gaps',()=>{
 const joined=buildBlockedJointUatReport(fixture('finance',idF),fixture('academic',idA));
 assert.equal(joined.schema_version,'v3.2-50-joint-blocked-uat-v1');
 assert.equal(joined.finance_request_id,idF);assert.equal(joined.academic_request_id,idA);
 assert.equal(joined.check_count,16);assert.equal(joined.finance_check_count,12);
 assert.equal(joined.academic_check_count,12);
 assert.deepEqual(new Set(joined.tasks.map(x=>x.code)),new Set(codes));
 assert.equal(joined.recorded_missing_events,3);
 const common=joined.tasks.find(x=>x.code==='sales_contract_party');
 assert.deepEqual(common.sources,{finance:1,academic:2});
 assert.equal(common.missing_events,3);
 assert.ok(Object.isFrozen(joined)&&Object.isFrozen(joined.tasks));
 for(const field of ['production_integration_allowed','execution_allowed','release_allowed',
  'real_finance_source_connected','real_crm_source_connected',
  'real_owner_approval_complete','technical_ci_is_business_approval'])
  assert.equal(joined[field],false,field);
 const markdown=renderBlockedJointUatMarkdown(joined);
 assert.match(markdown,/16 项/);assert.match(markdown,/hold_active/);
 assert.equal(markdown.split('\n').filter(x=>x.startsWith('| `')).length,16);
});
test('V3.2-50 refuses forged signoff, missing checks, swapped roles and mismatched shared descriptions',()=>{
 const source=fixture('finance',idF),academic=fixture('academic',idA);
 assert.throws(()=>buildBlockedJointUatReport(academic,source),TypeError);
 assert.throws(()=>buildBlockedJointUatReport(source,fixture('academic',idF)),TypeError);
 {const bad=fixture('finance',idF);bad.execution_allowed=true;
  assert.throws(()=>buildBlockedJointUatReport(bad,academic),TypeError);}
 {const bad=fixture('academic',idA);bad.tasks[0].uat_status='approved';
  assert.throws(()=>buildBlockedJointUatReport(source,bad),TypeError);}
 {const bad=fixture('academic',idA);bad.tasks.pop();
  assert.throws(()=>buildBlockedJointUatReport(source,bad),TypeError);}
 {const bad=fixture('academic',idA);const shared=bad.tasks.find(x=>x.check_code==='sales_contract_party');
  shared.label_zh='伪造不一致的统一项目';
  assert.throws(()=>buildBlockedJointUatReport(source,bad),TypeError);}
 {const bad=fixture('finance',idF);bad.recorded_missing_events=0;
  assert.throws(()=>buildBlockedJointUatReport(bad,academic),TypeError);}
 const original=fixture('finance',idF);original.tasks[0].label_zh='不可信 | <script>危险</script>\n下一行';
 const changed=fixture('academic',idA);changed.tasks[0].label_zh=original.tasks[0].label_zh;
 const rendered=renderBlockedJointUatMarkdown(buildBlockedJointUatReport(original,changed));
 assert.ok(!rendered.includes('<script>'));
 assert.ok(rendered.includes('\\| &lt;script&gt;'));
});
const db=name=>new pg.Pool({connectionString:process.env[name],max:2});
const one=async(pool,sql,args)=>(await pool.query(sql,args)).rows[0]?.result;
const request='SELECT ms.propose_fixture_source_readiness($1,$2,$3,$4,$5,$6) AS result';
test('V3.2-50 real isolated DB security reviewer loads two same-tenant reports but denies cross-tenant and nonsecurity principal',async()=>{
 if(process.env.MS_STAGE!=='isolated-test')throw Error('V3.2-50 DB integration is isolated-test only');
 const fin=db('DATABASE_URL_PLAN_FINANCE'),acad=db('DATABASE_URL_PLAN_ACADEMIC'),
  security=db('DATABASE_URL_SOURCE_SECURITY'),other=db('DATABASE_URL_PLAN_B');
 try{
  const f=await one(fin,request,['finance','fictional_joint_fin_50','fictional_org_a',
   '虚构财务联合待办审查','fictional_finance_review_only',key()]);
  const a=await one(acad,request,['academic','fictional_joint_acad_50','fictional_org_a',
   '虚构教务联合待办审查','fictional_academic_review_only',key()]);
  const b=await one(other,request,['finance','fictional_joint_other_50','fictional_org_b',
   '虚构另一机构待办','fictional_other_review_only',key()]);
  assert.ok(f&&a&&b&&f!==a&&f!==b);
  const joint=await loadBlockedJointUatReport(security,f,a);
  assert.equal(joint.check_count,16);
  assert.equal(joint.status,'blocked_real_authority_missing');
  assert.equal(joint.production_integration_allowed,false);
  assert.equal(joint.execution_allowed,false);
  assert.equal(joint.release_allowed,false);
  const body=renderBlockedJointUatMarkdown(joint);
  assert.match(body,/真实权威缺失/);
  await assert.rejects(loadBlockedJointUatReport(security,f,b),
   e=>e.code==='42501','foreign tenant must be refused before joint report can render');
  await assert.rejects(loadBlockedJointUatReport(security,a,f),TypeError);
  await assert.rejects(loadBlockedJointUatReport(fin,f,a),TypeError);
  await assert.rejects(loadBlockedJointUatReport(security,f,f),TypeError);
  for(const p of [security,fin,acad]){
   await assert.rejects(p.query('UPDATE ms.payment_allocations SET id=id WHERE FALSE'),
    {code:'42501'});
   await assert.rejects(p.query('UPDATE ms.crm_entitlement_links SET id=id WHERE FALSE'),
    {code:'42501'});
  }
 }finally{await Promise.all([fin.end(),acad.end(),security.end(),other.end()]);}
});
