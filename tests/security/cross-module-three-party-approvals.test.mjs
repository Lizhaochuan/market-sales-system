import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';

// Only disposable fictional PostgreSQL; NEVER connects real payments or CRM.
const A='20000000-0000-4000-8000-000000000011';
const M='20000000-0000-4000-8000-000000000013';
const F='30000000-0000-4000-8000-000000000015';
const AC='30000000-0000-4000-8000-000000000016';
const key=()=>randomBytes(20).toString('hex');
const pool=name=>new pg.Pool({connectionString:process.env[name],max:3});
const one=async(p,sql,args)=>(await p.query(sql,args)).rows[0].result;
const deny=(p,sql,args,code)=>assert.rejects(p.query(sql,args),
 e=>e.code===code,'Expected '+code+' for '+sql);
const propose='SELECT ms.propose_cross_module_student_correction($1,$2,$3,$4,$5,$6,$7,$8) AS result';
const sign='SELECT ms.sign_cross_module_student_correction($1,$2,$3,$4,$5,$6) AS result';

test('V3.2-25 sales/finance/academic review remains proposals-only and immutable',async t=>{
 const root=pool('DATABASE_URL'),a=pool('DATABASE_URL_WRITE_A'),
  m=pool('DATABASE_URL_WRITE_MANAGER'),m2=pool('DATABASE_URL_WRITE_MANAGER_2'),
  planA=pool('DATABASE_URL_PLAN_A'),sales=pool('DATABASE_URL_PLAN_SALES'),
  finance=pool('DATABASE_URL_PLAN_FINANCE'),
  academic=pool('DATABASE_URL_PLAN_ACADEMIC'),
  dual=pool('DATABASE_URL_PLAN_DUAL'),financeB=pool('DATABASE_URL_PLAN_B');
 const all=[root,a,m,m2,planA,sales,finance,academic,dual,financeB];
 async function newWrongStudentCase(){
  const contact=(await one(a,'SELECT ms.create_scoped_contact($1,$2,$3) AS result',
   ['虚构纠错联系人-'+randomUUID(),false,key()])).contact_id;
  const event=(await one(a,'SELECT ms.create_scoped_contact_consultation($1,$2,$3,$4) AS result',
   [contact,'微信咨询',new Date(Date.now()-100000),key()])).event_id;
  const candidate=await one(a,'SELECT ms.request_consultation_lead_candidate($1,$2,$3,$4) AS result',
   [event,'虚构业务来源材料','交由主管核实候选线索',key()]);
  await one(m,'SELECT ms.decide_consultation_lead_candidate($1,$2,$3,$4,$5) AS result',
   [candidate,'reviewed_eligible','虚构候选证据','符合业务候选标准',key()]);
  const preflight=await one(a,'SELECT ms.submit_lead_conversion_preflight($1,$2,$3,$4) AS result',
   [candidate,'虚构转换证据','申请转换核查',key()]);
  await one(m,'SELECT ms.decide_lead_conversion_preflight($1,$2,$3,$4,$5) AS result',
   [preflight,'cleared','虚构预审证据','允许进入最后复核',key()]);
  const authorization=await one(a,'SELECT ms.request_final_lead_conversion($1,$2,$3,$4) AS result',
   [preflight,'虚构独立转换申请','提交正式线索转换',key()]);
  await one(m,'SELECT ms.decide_final_lead_conversion($1,$2,$3,$4,$5) AS result',
   [authorization,'approved','虚构主管批准','正式线索审核通过',key()]);
  const lead=(await one(a,'SELECT ms.execute_final_lead_conversion($1,$2) AS result',
   [authorization,key()])).lead_id;
  const wrong=(await one(a,'SELECT ms.create_scoped_student($1,$2,$3,$4) AS result',
   ['虚构原错误学生-'+randomUUID(),null,null,key()])).student_id;
  const target=(await one(a,'SELECT ms.create_scoped_student($1,$2,$3,$4) AS result',
   ['虚构正确候选学生-'+randomUUID(),null,null,key()])).student_id;
  const association=await one(a,
   'SELECT ms.request_lead_student_association($1,$2,$3,$4,$5) AS result',
   [lead,wrong,'虚构原学生关联凭据','等待学生关联复核',key()]);
  await one(m,'SELECT ms.decide_lead_student_association($1,$2,$3,$4,$5) AS result',
   [association,'approved_pending','虚构学生关联批准','批准待核实状态',key()]);
  const opportunity=(await root.query(
   "INSERT INTO ms.opportunities(student_id,owner_user_id,originating_lead_id,stage) VALUES($1,$2,$3,'new') RETURNING id",
   [wrong,A,lead])).rows[0].id;
  const order=(await root.query(
   'INSERT INTO ms.sales_orders(student_id,opportunity_id,amount_due_cents) VALUES($1,$2,3000) RETURNING id',
   [wrong,opportunity])).rows[0].id;
  const caseId=await one(a,'SELECT ms.request_downstream_student_correction($1,$2,$3,$4) AS result',
   [association,'虚构错误学生来源材料','发现错绑且已经存在订单',key()]);
  await one(m,'SELECT ms.decide_downstream_student_correction($1,$2,$3,$4,$5) AS result',
   [caseId,'hold_active','虚构隔离核查凭据','确认保持销售推进隔离',key()]);
  const finding=await one(m,
   'SELECT ms.attest_downstream_student_reconciliation($1,$2,$3,$4,$5,$6,$7) AS result',
   [caseId,'wrong_student_confirmed','虚构学生错误核对证据',
    '虚构商机与订单核对证据','虚构资金影响清单','确认错绑学生，保持隔离',key()]);
  await one(m2,'SELECT ms.resolve_downstream_student_reconciliation($1,$2,$3,$4,$5) AS result',
   [finding,'escalate_manual','虚构二次独立复核','确认错误应转跨部门处理',key()]);
  return {lead,wrong,target,opportunity,order,caseId,finding};
 }
 const args=(c,why='第一版')=>[
  c.caseId,c.target,'目标学生独立核验编号-'+why,'旧订单及销售归因核查-'+why,
  '外部收退款影响待财务核实-'+why,'CRM 已上课时待教务核实-'+why,
  '仅申请三部门审查不改业务-'+why,key()];
 const review=(plan,department,decision='approved')=>[
  plan,department,decision,department+'独立审核材料',
  '确认部门意见，仍未执行任何订单或财务变更',key()];
 try{
  await t.test('real DB reviewers cannot read or mutate original order, funds, student link or approval tables',async()=>{
   for(const p of [planA,sales,finance,academic,dual,financeB]){
    for(const table of ['ms.cross_module_correction_plans','ms.cross_module_correction_signoffs',
     'ms.sales_orders','ms.payment_allocations','ms.lead_students']){
     await deny(p,'SELECT * FROM '+table,[],'42501');
    }
    await deny(p,'UPDATE ms.sales_orders SET payment_state=payment_state WHERE false',[],'42501');
   }
   assert.equal((await finance.query('SELECT session_user AS login')).rows[0].login,
    'ms_plan_finance_reviewer');
  });
  const c=await newWrongStudentCase();
  let p1,p2,p3,immutable;
  await t.test('original applicant proposes a single-student plan; no supervisor or other tenant can impersonate them',async()=>{
   const data=args(c);
   await deny(sales,propose,data,'42501');
   await deny(financeB,propose,data,'42501');
   await deny(a,propose,data,'42501'); // Old low-risk writer is not granted the new function.
   await deny(planA,propose,[...data.slice(0,1),c.wrong,...data.slice(2)],'23514');
   p1=await one(planA,propose,data);
   assert.equal(await one(planA,propose,data),p1);
   await deny(planA,propose,[...data.slice(0,2),'不同身份凭据',...data.slice(3)],'23505');
   assert.equal((await root.query(
    'SELECT original_student_id,target_student_id,version_no FROM ms.cross_module_correction_plans WHERE id=$1',
    [p1])).rows[0].target_student_id,c.target);
   const rows=(await finance.query('SELECT * FROM ms.scoped_cross_module_correction_plans WHERE plan_id=$1',[p1])).rows;
   assert.equal(rows.length,1);assert.equal(rows[0].approved_department_count,0);
   assert.equal((await financeB.query('SELECT * FROM ms.scoped_cross_module_correction_plans WHERE plan_id=$1',[p1])).rowCount,0);
  });
  await t.test('sales signoff is independent, finance cannot sign sales, applicant cannot sign',async()=>{
   await deny(planA,sign,review(p1,'sales'),'42501');
   await deny(finance,sign,review(p1,'sales'),'42501');
   await deny(sales,sign,review(p1,'finance'),'42501');
   const payload=review(p1,'sales');
   immutable=await one(sales,sign,payload);
   assert.equal(await one(sales,sign,payload),immutable);
   await deny(sales,sign,[...payload.slice(0,3),'不同复核凭据',...payload.slice(4)],'23505');
   await deny(academic,sign,review(p1,'sales'),'42501');
   assert.equal((await root.query(
    'SELECT status FROM ms.lead_student_downstream_correction_cases WHERE id=$1',
    [c.caseId])).rows[0].status,'hold_active');
  });
  await t.test('new plan version preserves older signoffs and invalidates earlier approvals',async()=>{
   p2=await one(planA,propose,args(c,'第二版'));
   const s1=(await root.query(
    'SELECT id,decision FROM ms.cross_module_correction_signoffs WHERE id=$1',[immutable])).rows[0];
   assert.equal(s1.decision,'approved');
   await deny(finance,sign,review(p1,'finance'),'23514');
   const x=(await planA.query(
    'SELECT version_no,is_latest,three_party_plan_approved FROM ms.scoped_cross_module_correction_plans WHERE case_id=$1 ORDER BY version_no',
    [c.caseId])).rows;
   assert.deepEqual(x.map(y=>y.version_no),[1,2]);
   assert.equal(x[0].is_latest,false);assert.equal(x[1].is_latest,true);
   await deny(root,"UPDATE ms.cross_module_correction_plans SET reason_zh='篡改' WHERE id=$1",
    [p1],'23514');
   await deny(root,'DELETE FROM ms.cross_module_correction_signoffs WHERE id=$1',
    [immutable],'23514');
  });
  await t.test('dual-role reviewer cannot act as two departments, and cross-tenant professional reviewer cannot approve',async()=>{
   await deny(financeB,sign,review(p2,'finance'),'42501');
   await one(dual,sign,review(p2,'sales'));
   await deny(dual,sign,review(p2,'finance'),'23505');
   await deny(sales,sign,review(p2,'sales'),'23505');
  });
  await t.test('three distinct employees approve SAME version but no execution, order reassignment or release occurs',async()=>{
   const fin=review(p2,'finance'),acad=review(p2,'academic');
   const x=await one(finance,sign,fin);
   assert.equal(await one(finance,sign,fin),x);
   await one(academic,sign,acad);
   const summary=(await planA.query(
    'SELECT * FROM ms.scoped_cross_module_correction_plans WHERE plan_id=$1',[p2])).rows[0];
   assert.equal(summary.approved_department_count,3);
   assert.equal(summary.three_party_plan_approved,true);
   const statuses=(await root.query(
    'SELECT department,decision,signed_by,plan_version FROM ms.cross_module_correction_signoffs WHERE plan_id=$1 ORDER BY department',
    [p2])).rows;
   assert.deepEqual(statuses.map(x=>x.department),['academic','finance','sales']);
   assert.equal(new Set(statuses.map(x=>x.signed_by)).size,3);
   assert.ok(statuses.every(x=>x.decision==='approved'&&x.plan_version===2));
   assert.equal(statuses.find(x=>x.department==='finance').signed_by,F);
   assert.equal(statuses.find(x=>x.department==='academic').signed_by,AC);
   assert.equal((await root.query(
    'SELECT student_id FROM ms.sales_orders WHERE id=$1',[c.order])).rows[0].student_id,c.wrong);
   assert.equal((await root.query(
    'SELECT student_id,originating_lead_id FROM ms.opportunities WHERE id=$1',[c.opportunity])).rows[0].student_id,c.wrong);
   assert.equal((await root.query(
    'SELECT status FROM ms.lead_student_downstream_correction_cases WHERE id=$1',[c.caseId])).rows[0].status,
    'hold_active');
   await deny(root,"UPDATE ms.opportunities SET stage='won' WHERE id=$1",
    [c.opportunity],'23514');
   await deny(root,'DELETE FROM ms.cross_module_correction_signoffs WHERE plan_id=$1',
    [p2],'23514');
  });
  await t.test('rejected latest plan blocks further signoffs; all previous versions stay immutable',async()=>{
   p3=await one(planA,propose,args(c,'第三版'));
   await one(finance,sign,review(p3,'finance','return_for_revision'));
   await deny(sales,sign,review(p3,'sales'),'23514');
   const rows=(await planA.query(
    'SELECT version_no,three_party_plan_approved,has_rejection_or_return FROM ms.scoped_cross_module_correction_plans WHERE case_id=$1 ORDER BY version_no',
    [c.caseId])).rows;
   assert.deepEqual(rows.map(x=>x.version_no),[1,2,3]);
   assert.equal(rows[1].three_party_plan_approved,false); // superseded
   assert.equal(rows[2].has_rejection_or_return,true);
   assert.equal(rows[2].three_party_plan_approved,false);
   const report=(await root.query(
    'SELECT COUNT(*)::int AS count FROM ms.cross_module_correction_signoffs s JOIN ms.cross_module_correction_plans p ON p.id=s.plan_id WHERE p.case_id=$1',
    [c.caseId])).rows[0].count;
   assert.equal(report,5); // 1 version-one + 3 version-two + 1 return.
  });
 }finally{await Promise.all(all.map(p=>p.end()));}
});
