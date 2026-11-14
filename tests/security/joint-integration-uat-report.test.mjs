import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import pg from 'pg';

const key=()=>randomBytes(20).toString('hex');
const pool=n=>new pg.Pool({connectionString:process.env[n],max:2});
const one=async(p,s,a)=>(await p.query(s,a)).rows[0].result;
const deny=(p,s,a,c)=>assert.rejects(p.query(s,a),
 e=>e.code===c,'Expected '+c+' for '+s);
const propose='SELECT ms.propose_fixture_source_readiness($1,$2,$3,$4,$5,$6) AS result';
const gap='SELECT ms.record_integration_missing_evidence($1,$2,$3,$4,$5,$6) AS result';
const report='SELECT ms.readonly_joint_integration_uat_report($1,$2) AS result';
const incident='SELECT ms.report_fixture_source_interruption($1,$2,$3,$4,$5,$6,$7) AS result';

test('V3.2-32 16-task cross-domain report: only security, always denied, audited counts',async t=>{
 const root=pool('DATABASE_URL'),finance=pool('DATABASE_URL_PLAN_FINANCE'),
 acad=pool('DATABASE_URL_PLAN_ACADEMIC'),sales=pool('DATABASE_URL_PLAN_SALES'),
 security=pool('DATABASE_URL_SOURCE_SECURITY'),
 other=pool('DATABASE_URL_PLAN_B'),low=pool('DATABASE_URL_WRITE_A');
 const all=[root,finance,acad,sales,security,other,low];
 try{
  const f=await one(finance,propose,['finance','fictional_uat_finance',
   'fictional_org_a','模拟财务权威联合验收任务','虚构财务来源证据引用',key()]);
  const a=await one(acad,propose,['academic','fictional_uat_academic',
   'fictional_org_a','模拟教务 CRM 联合验收任务','虚构教务来源证据引用',key()]);
  await t.test('only independently authorized security LOGIN can see both source requests',async()=>{
   for(const p of [finance,acad,sales,other,low]){
    await deny(p,report,[f,a],'42501');
   }
   await deny(security,report,[f,f],'23514');
   await deny(security,report,[a,f],'23514');
   await deny(security,report,[f,a+'bad'],'22P02');
   const b=await one(other,propose,['finance','fictional_uat_foreign',
     'fictional_org_b','模拟其他机构来源','虚构跨机构来源依据',key()]);
   await deny(security,report,[b,a],'42501');
   await deny(security,report,[f,b],'42501');
   for(const table of ['ms.integration_required_checks','ms.integration_missing_evidence_events',
    'ms.sales_orders','ms.payment_allocations','ms.crm_entitlement_links']){
    await deny(security,'SELECT * FROM '+table,[],'42501');
   }
   await deny(security,'UPDATE ms.sales_orders SET id=id WHERE FALSE',[],'42501');
   await deny(security,'UPDATE ms.payment_allocations SET id=id WHERE FALSE',[],'42501');
  });
  await t.test('report requires 3 sales, 4 finance, 4 academic and 5 security checks',async()=>{
   const result=await one(security,report,[f,a]);
   assert.equal(result.report_schema,'v3.2-32-joint-uat-v1');
   assert.equal(result.check_count,16);
   assert.equal(result.checks.length,16);
   assert.deepEqual(Object.fromEntries(['sales','finance','academic','security'].map(d=>[
     d,result.checks.filter(x=>x.department===d).length
   ])),{sales:3,finance:4,academic:4,security:5});
   assert.ok(result.checks.every(x=>x.production_verified===false));
   assert.ok(result.checks.every(x=>x.missing_events===0));
   assert.equal(result.finance_unresolved_incidents,0);
   assert.equal(result.academic_unresolved_incidents,0);
   assert.equal(result.status,'blocked_real_authority_missing');
   for(const field of ['real_source_owners_approved','real_source_credentials_granted',
    'production_ledger_replay_ready','real_cross_module_uat_passed',
    'production_integration_allowed','execution_allowed','release_allowed']){
    assert.equal(result[field],false,field);
   }
   const raw=await root.query('SELECT count(*)::int AS count FROM ms.integration_required_checks');
   assert.equal(raw.rows[0].count,16);
  });
  await t.test('shared sales/security gaps from both finance and CRM count in one row',async()=>{
   await one(finance,gap,[f,'finance_reconciliation','reconciliation_unverified',
     '虚构财务缺失事实','真实财务资金和退款尚未完成权威核对',key()]);
   await one(acad,gap,[a,'academic_attendance_balance','reconciliation_unverified',
     '虚构 CRM 缺失事实','学生课包和剩余课时未取得权威水位',key()]);
   await one(security,gap,[f,'security_source_trust','trust_not_verified',
     '虚构财务信任锚缺失','财务信任锚不是真实源证书',key()]);
   await one(security,gap,[a,'security_source_trust','trust_not_verified',
     '虚构教务信任锚缺失','教务信任锚缺失真实来源批准',key()]);
   await one(sales,gap,[f,'sales_contract_party','policy_not_approved',
     '虚构财务关联合同缺失','财务合同主体未得到正式责任人复核',key()]);
   await one(sales,gap,[a,'sales_contract_party','policy_not_approved',
     '虚构教务关联合同缺失','教务目标学生未得到签约主体复核',key()]);
   const r=await one(security,report,[f,a]);
   const find=code=>r.checks.find(x=>x.check_code===code);
   assert.equal(find('security_source_trust').missing_events,2);
   assert.equal(find('sales_contract_party').missing_events,2);
   assert.equal(find('finance_reconciliation').missing_events,1);
   assert.equal(find('academic_attendance_balance').missing_events,1);
   assert.ok(r.checks.every(x=>x.production_verified===false));
   assert.equal(r.production_integration_allowed,false);
  });
  await t.test('source interruptions are counted, never reported as recovered',async()=>{
   const financeIncident=await one(finance,incident,[f,'timeout_unknown',7,21,
    '虚构财务响应超时','真实来源不可用，不能推断未收款',key()]);
   const academicIncident=await one(acad,incident,[a,'missing_page',3,6,
    '虚构 CRM 分页缺失','课程来源不完整仍保持隔离',key()]);
   assert.ok(financeIncident&&academicIncident);
   const r=await one(security,report,[f,a]);
   assert.equal(r.finance_unresolved_incidents,1);
   assert.equal(r.academic_unresolved_incidents,1);
   assert.equal(r.execution_allowed,false);
   assert.equal(r.release_allowed,false);
   await deny(root,"UPDATE ms.integration_required_checks SET production_verified=true WHERE check_code='security_source_trust'",[],'23514');
   await deny(root,"DELETE FROM ms.integration_missing_evidence_events WHERE source_request_id=$1",[f],'23514');
  });
 }finally{await Promise.all(all.map(p=>p.end()));}
});
