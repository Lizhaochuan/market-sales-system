import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import pg from 'pg';

const key=()=>randomBytes(20).toString('hex');
const pool=name=>new pg.Pool({connectionString:process.env[name],max:2});
const one=async(p,sql,args)=>(await p.query(sql,args)).rows[0].result;
const deny=(p,sql,args,code)=>assert.rejects(p.query(sql,args),
 error=>error.code===code,'Expected '+code+' for '+sql);
const request='SELECT ms.propose_fixture_source_readiness($1,$2,$3,$4,$5,$6) AS result';
const review='SELECT ms.review_fixture_source_readiness($1,$2,$3,$4,$5,$6) AS result';
const gap='SELECT ms.record_integration_missing_evidence($1,$2,$3,$4,$5,$6) AS result';
const gate='SELECT ms.readonly_integration_hard_gate($1) AS result';

test('V3.2-31 independent four-department integration readiness is ALWAYS blocked',async t=>{
 const owner=pool('DATABASE_URL'),sales=pool('DATABASE_URL_PLAN_SALES'),
  finance=pool('DATABASE_URL_PLAN_FINANCE'),
  academic=pool('DATABASE_URL_PLAN_ACADEMIC'),
  dual=pool('DATABASE_URL_PLAN_DUAL'),
  security=pool('DATABASE_URL_SOURCE_SECURITY'),
  other=pool('DATABASE_URL_PLAN_B'),low=pool('DATABASE_URL_WRITE_A'),
  applicant=pool('DATABASE_URL_PLAN_A');
 const all=[owner,sales,finance,academic,dual,security,other,low,applicant];
 try{
  await t.test('non-owner logins cannot read raw evidence tables or mutate financial/CRM business',async()=>{
   for(const p of [sales,finance,academic,dual,security,other]){
    for(const tb of ['ms.integration_required_checks',
     'ms.integration_missing_evidence_events','ms.sales_orders',
     'ms.payment_allocations','ms.crm_entitlement_links']){
     await deny(p,'SELECT * FROM '+tb,[],'42501');
     await deny(p,'UPDATE '+tb+' SET id=id WHERE FALSE',[],'42501');
    }
   }
   await deny(low,gap,[null,'finance_authority_owner','owner_not_confirmed',
    '虚构来源材料','目前仍无权威负责人',key()],'42501');
   await deny(applicant,gate,[null],'42501');
   await deny(applicant,gap,[null,'finance_authority_owner','owner_not_confirmed',
    '虚构来源材料','目前仍无权威负责人',key()],'42501');
  });
  const fsource=await one(finance,request,['finance','fictional_finance_approval',
   'fictional_org_a','核实真实财务权威仍缺少哪些凭据','虚构来源申请材料',key()]);
  const asource=await one(academic,request,['academic','fictional_academic_approval',
   'fictional_org_a','核实教务 CRM 权威仍缺少哪些凭据','虚构教务申请材料',key()]);
  await t.test('unreviewed fictional finance and CRM sources are blocked by all gates',async()=>{
   const f=await one(finance,gate,[fsource]),a=await one(academic,gate,[asource]);
   assert.equal(f.required_gate_count,12);
   assert.equal(a.required_gate_count,12);
   assert.equal(f.checks.length,12);
   assert.equal(a.checks.length,12);
   assert.equal(f.recorded_missing_events,0);
   assert.equal(a.recorded_missing_events,0);
   assert.ok(f.checks.every(x=>x.production_verified===false));
   assert.ok(a.checks.every(x=>x.production_verified===false));
   assert.ok(f.checks.some(x=>x.check_code==='finance_reconciliation'));
   assert.ok(a.checks.some(x=>x.check_code==='academic_attendance_balance'));
   assert.ok(!f.checks.some(x=>x.check_code==='academic_readonly_credentials'));
   assert.ok(!a.checks.some(x=>x.check_code==='finance_readonly_credentials'));
   for(const obj of [f,a]){
    for(const prop of ['real_owner_confirmed','real_contract_approved',
     'production_source_authenticated','production_tenant_mapping_verified',
     'finance_readonly_credentials_granted','academic_readonly_credentials_granted',
     'production_integration_allowed','execution_allowed','release_allowed'])
      assert.equal(obj[prop],false,prop);
    assert.equal(obj.status,'blocked_real_authority_missing');
   }
   await deny(other,gate,[fsource],'42501');
   assert.equal((await other.query(
    'SELECT * FROM ms.scoped_integration_readiness_summary WHERE source_request_id=$1',
    [fsource])).rowCount,0);
  });
  await t.test('only correct domain and independent security/sales roles can report missing evidence',async()=>{
   const args=[fsource,'finance_authority_owner','owner_not_confirmed',
    '虚构财务负责人查询记录','真实财务权威负责人尚未签署授权',key()];
   await deny(academic,gap,args,'42501');
   await deny(other,gap,args,'42501');
   await deny(sales,gap,args,'42501');
   await deny(security,gap,args,'42501');
   const id=await one(finance,gap,args);
   assert.equal(await one(finance,gap,args),id);
   await deny(finance,gap,[...args.slice(0,4),'试图覆盖旧缺失依据',args[5]],'23505');
   await deny(finance,gap,[fsource,'academic_attendance_balance',
    'reconciliation_unverified','虚构错学科材料','财务不能填写教务的检查项',key()],'23514');
   const securityGap=await one(security,gap,[fsource,'security_source_trust',
    'trust_not_verified','虚构安全信任锚检查','未取得真实财务签名信任锚或撤销机制',key()]);
   const salesGap=await one(sales,gap,[fsource,'sales_contract_party',
    'policy_not_approved','虚构合同核对记录','真实签约主体和学生权益纠正政策待批准',key()]);
   assert.ok(securityGap&&salesGap);
   await deny(finance,gap,[fsource,'security_source_trust',
    'trust_not_verified','越权安全材料','财务不能自行审批安全来源',key()],'42501');
   await deny(sales,gap,[fsource,'sales_contract_party',
    'fictional_pass','虚构合格材料','不能将缺失事项标记为已通过',key()],'23514');
   const academicGap=await one(academic,gap,[asource,'academic_attendance_balance',
    'reconciliation_unverified','虚构 CRM 课包核查','课程消课及剩余权益尚无权威版本',key()]);
   assert.ok(academicGap);
   const report=await one(finance,gate,[fsource]);
   assert.equal(report.recorded_missing_events,3);
   assert.equal(report.checks.find(x=>x.check_code==='finance_authority_owner').missing_events,1);
   assert.equal(report.production_integration_allowed,false);
   await deny(owner,'DELETE FROM ms.integration_missing_evidence_events WHERE id=$1',[id],'23514');
   await deny(owner,"UPDATE ms.integration_missing_evidence_events SET reason_zh='篡改' WHERE id=$1",[id],'23514');
   await deny(owner,"UPDATE ms.integration_required_checks SET production_verified=true WHERE check_code='finance_authority_owner'",[],'23514');
   await deny(owner,"INSERT INTO ms.integration_required_checks(check_code,department,label_zh,required_evidence_zh,production_verified) VALUES('manual_unsafe','finance','伪造通过','不应接受',true)",[],'23514');
  });
  await t.test('even TWO independent fake approvals cannot open live read access',async()=>{
   const business=await one(dual,review,[fsource,'business','fixture_ready',
    '虚构财务业务审核材料','仅准备隔离测试，不是生产审批',key()]);
   const sec=await one(security,review,[fsource,'security','fixture_ready',
    '虚构信息安全审核材料','未取得真实签名或只读服务授权',key()]);
   assert.ok(business&&sec);
   const source=(await finance.query(
    'SELECT * FROM ms.scoped_fixture_source_readiness WHERE request_id=$1',[fsource])).rows[0];
   assert.equal(source.fixture_review_count,2);
   assert.equal(source.fictional_fixture_reviewed,true);
   assert.equal(source.production_source_approved,false);
   const report=await one(security,gate,[fsource]);
   assert.equal(report.status,'blocked_real_authority_missing');
   assert.equal(report.production_integration_allowed,false);
   assert.equal(report.execution_allowed,false);
   assert.equal(report.release_allowed,false);
   const summary=(await finance.query(
    'SELECT * FROM ms.scoped_integration_readiness_summary WHERE source_request_id=$1',
    [fsource])).rows[0];
   assert.equal(summary.required_gate_count,12);
   assert.equal(summary.recorded_missing_events,3);
   assert.equal(summary.real_source_approved,false);
   assert.equal(summary.production_integration_allowed,false);
   assert.equal(summary.execution_allowed,false);
   assert.equal(summary.release_allowed,false);
  });
 }finally{await Promise.all(all.map(p=>p.end()));}
});
