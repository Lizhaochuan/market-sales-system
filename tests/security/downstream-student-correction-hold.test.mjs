import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import pg from 'pg';

const ORG='20000000-0000-4000-8000-000000000001';
const A='20000000-0000-4000-8000-000000000011';
const key=()=>randomBytes(20).toString('hex');
const pool=name=>new pg.Pool({connectionString:process.env[name],max:4});
const call=async(p,sql,args)=>(await p.query(sql,args)).rows[0].result;
const deny=(p,sql,args,code)=>assert.rejects(p.query(sql,args),e=>e.code===code,sql);
const request='SELECT ms.request_downstream_student_correction($1,$2,$3,$4) AS result';
const decide='SELECT ms.decide_downstream_student_correction($1,$2,$3,$4,$5) AS result';

test('V3.2-22 downstream incorrect-student case: exact scope, audit and sales-progression hold',async t=>{
 const root=pool('DATABASE_URL'),a=pool('DATABASE_URL_WRITE_A'),
  b=pool('DATABASE_URL_WRITE_B'),m=pool('DATABASE_URL_WRITE_MANAGER'),
  ra=pool('DATABASE_URL_ASSIGNEE_A'),rb=pool('DATABASE_URL_ASSIGNEE_B');
 async function makeLead(label){
  const contact=(await call(a,'SELECT ms.create_scoped_contact($1,$2,$3) AS result',
   [label+'-'+randomUUID(),false,key()])).contact_id;
  const source=(await call(a,'SELECT ms.create_scoped_contact_consultation($1,$2,$3,$4) AS result',
   [contact,'微信咨询',new Date(Date.now()-90000),key()])).event_id;
  const candidate=await call(a,
   'SELECT ms.request_consultation_lead_candidate($1,$2,$3,$4) AS result',
   [source,'虚构真实咨询凭据','核实指定联系人咨询来源',key()]);
  await call(m,'SELECT ms.decide_consultation_lead_candidate($1,$2,$3,$4,$5) AS result',
   [candidate,'reviewed_eligible','虚构候选审核凭据','独立核实候选资格',key()]);
  const ready=await call(a,
   'SELECT ms.submit_lead_conversion_preflight($1,$2,$3,$4) AS result',
   [candidate,'虚构预审材料','检查重复线索及归因',key()]);
  await call(m,'SELECT ms.decide_lead_conversion_preflight($1,$2,$3,$4,$5) AS result',
   [ready,'cleared','独立预审证明','核验转换条件',key()]);
  const authorization=await call(a,
   'SELECT ms.request_final_lead_conversion($1,$2,$3,$4) AS result',
   [ready,'虚构最终转换凭据','请求最终独立批准',key()]);
  await call(m,'SELECT ms.decide_final_lead_conversion($1,$2,$3,$4,$5) AS result',
   [authorization,'approved','最终主管核查材料','独立同意执行一次线索转换',key()]);
  const out=await call(a,'SELECT ms.execute_final_lead_conversion($1,$2) AS result',
   [authorization,key()]);
  return {lead:out.lead_id,source,contact};
 }
 async function linkedLead(label){
  const lead=await makeLead(label);
  const student=(await call(a,'SELECT ms.create_scoped_student($1,$2,$3,$4) AS result',
   [label+'单名学生-'+randomUUID(),null,null,key()])).student_id;
  const association=await call(a,
   'SELECT ms.request_lead_student_association($1,$2,$3,$4,$5) AS result',
   [lead.lead,student,'虚构指定学生材料','提交独立单学生待核实关联',key()]);
  await call(m,
   'SELECT ms.decide_lead_student_association($1,$2,$3,$4,$5) AS result',
   [association,'approved_pending','虚构主管核对','同意登记单名学生待核实关联',key()]);
  return {...lead,student,association};
 }
 const current=async(x)=>(await root.query(
  'SELECT confirmation_state FROM ms.lead_students WHERE lead_id=$1 AND student_id=$2',
  [x.lead,x.student])).rows[0].confirmation_state;
 try{
  await t.test('employee DB LOGIN cannot SELECT raw case/approval/opportunity/order/finance tables',async()=>{
   for(const p of [a,b,m,ra,rb]){
    for(const table of ['ms.lead_student_downstream_correction_cases',
     'ms.lead_student_downstream_correction_decisions','ms.opportunities',
     'ms.sales_orders','ms.payment_allocations','ms.lead_students']){
      await deny(p,'SELECT * FROM '+table,[],'42501');
    }
   }
  });
  let link,opp,quote,order,receipt,trial,caseId;
  await t.test('snapshot exactly one student and existing opportunity/quote/order/trial/allocation',async()=>{
   link=await linkedLead('下游商机错关联');
   opp=(await root.query(
    "INSERT INTO ms.opportunities(student_id,owner_user_id,originating_lead_id,stage) VALUES($1,$2,$3,'new') RETURNING id",
    [link.student,A,link.lead])).rows[0].id;
   quote=(await root.query(
    'INSERT INTO ms.quotes(quote_series_id,version,student_id,opportunity_id) VALUES($1,1,$2,$3) RETURNING id',
    [randomUUID(),link.student,opp])).rows[0].id;
   order=(await root.query(
    'INSERT INTO ms.sales_orders(student_id,opportunity_id,amount_due_cents) VALUES($1,$2,12000) RETURNING id',
    [link.student,opp])).rows[0].id;
   trial=(await root.query(
    'INSERT INTO ms.trial_bookings(student_id,opportunity_id,request_key) VALUES($1,$2,$3) RETURNING id',
    [link.student,opp,'trial-'+randomUUID()])).rows[0].id;
   receipt=(await root.query(
    "INSERT INTO ms.payment_receipt_projections(authority_system,external_payment_id,amount_cents) VALUES('fictional-fixture',$1,5000) RETURNING id",
    ['fictional-'+randomUUID()])).rows[0].id;
   await root.query(
    'INSERT INTO ms.payment_allocations(receipt_id,order_id,allocated_cents) VALUES($1,$2,2500)',
    [receipt,order]);
   const eligible=await ra.query(
    'SELECT association_request_id,opportunity_count FROM ms.scoped_downstream_student_correction_eligible WHERE association_request_id=$1',
    [link.association]);
   assert.equal(eligible.rowCount,1);
   assert.equal(eligible.rows[0].opportunity_count,1);
   assert.equal((await rb.query(
    'SELECT * FROM ms.scoped_downstream_student_correction_eligible WHERE association_request_id=$1',
    [link.association])).rowCount,0);
   await deny(b,request,[link.association,'虚构越权材料','不能申请别人的关联',key()],'42501');
   const args=[link.association,'虚构顾问核查错误学生的证明',
    '发现这名学生的商机及销售记录可能归属错误，先隔离',key()];
   caseId=await call(a,request,args);
   assert.equal(await call(a,request,args),caseId);
   await deny(a,request,[link.association,'新材料','重复保护案件',key()],'23505');
   const c=(await root.query(
    'SELECT opportunity_count,quote_count,order_count,allocation_count,trial_count,status FROM ms.lead_student_downstream_correction_cases WHERE id=$1',
    [caseId])).rows[0];
   assert.deepEqual({
    opportunities:c.opportunity_count,quotes:c.quote_count,orders:c.order_count,
    allocations:c.allocation_count,trials:c.trial_count,status:c.status
   },{opportunities:1,quotes:1,orders:1,allocations:1,trials:1,status:'pending'});
   assert.equal((await ra.query(
    'SELECT * FROM ms.scoped_downstream_student_correction_cases WHERE case_id=$1',
    [caseId])).rowCount,1);
   assert.equal((await rb.query(
    'SELECT * FROM ms.scoped_downstream_student_correction_cases WHERE case_id=$1',
    [caseId])).rowCount,0);
   assert.equal(await current(link),'pending_review');
   assert.equal((await root.query('SELECT COUNT(*)::int AS n FROM ms.family_memberships WHERE student_id=$1',
    [link.student])).rows[0].n,0);
  });
  await t.test('pending case ALREADY blocks sales progression; financial facts are not silently discarded',async()=>{
   await deny(root,"UPDATE ms.opportunities SET stage='qualified' WHERE id=$1",[opp],'23514');
   await deny(root,
    'INSERT INTO ms.quotes(quote_series_id,version,student_id,opportunity_id) VALUES($1,1,$2,$3)',
    [randomUUID(),link.student,opp],'23514');
   await deny(root,
    'INSERT INTO ms.sales_orders(student_id,opportunity_id,amount_due_cents) VALUES($1,$2,100)',
    [link.student,opp],'23514');
   await deny(root,
    'INSERT INTO ms.trial_bookings(student_id,opportunity_id,request_key) VALUES($1,$2,$3)',
    [link.student,opp,'trial-'+randomUUID()],'23514');
   await deny(root,"UPDATE ms.sales_orders SET order_state='submitted' WHERE id=$1",
    [order],'23514');
   await deny(root,"UPDATE ms.quotes SET approval_state='approved' WHERE id=$1",
    [quote],'23514');
   // Receipt ingestion/accounting remains under the external finance authority;
   // never drop a real financial fact as a by-product of a sales dispute.
   await root.query(
    'INSERT INTO ms.payment_allocations(receipt_id,order_id,allocated_cents) VALUES($1,$2,400)',
    [receipt,order]);
   assert.equal((await root.query('SELECT count(*)::int AS n FROM ms.payment_allocations WHERE order_id=$1',
    [order])).rows[0].n,2);
   assert.equal((await root.query('SELECT count(*)::int AS n FROM ms.sales_orders WHERE id=$1',
    [order])).rows[0].n,1);
   assert.equal(await current(link),'pending_review');
   const other=(await call(a,'SELECT ms.create_scoped_student($1,$2,$3,$4) AS result',
    ['非争议指定学生-'+randomUUID(),null,null,key()])).student_id;
   const otherOpp=(await root.query(
    "INSERT INTO ms.opportunities(student_id,owner_user_id,originating_lead_id,stage) VALUES($1,$2,$3,'new') RETURNING id",
    [other,A,link.lead])).rows[0].id;
   assert.ok(otherOpp);
  });
  await t.test('independent manager decision does not auto-correct opportunity or withdraw student',async()=>{
   await deny(a,decide,[caseId,'hold_active','本人材料','禁止自批',key()],'42501');
   await deny(b,decide,[caseId,'hold_active','非主管材料','禁止非主管批准',key()],'42501');
   const args=[caseId,'hold_active','虚构主管交叉核查材料',
    '确认本名学生的下游商机归属需要跨模块单独核查',key()];
   assert.equal(await call(m,decide,args),
    '已确认跨模块保护，错误学生关联尚未撤回');
   assert.equal(await call(m,decide,args),
    '已确认跨模块保护，错误学生关联尚未撤回');
   assert.equal((await root.query('SELECT status FROM ms.lead_student_downstream_correction_cases WHERE id=$1',
    [caseId])).rows[0].status,'hold_active');
   assert.equal(await current(link),'pending_review');
   assert.equal((await root.query('SELECT student_id FROM ms.opportunities WHERE id=$1',
    [opp])).rows[0].student_id,link.student);
   assert.equal((await root.query('SELECT student_id FROM ms.sales_orders WHERE id=$1',
    [order])).rows[0].student_id,link.student);
   const withdraw=await call(a,
    'SELECT ms.request_lead_student_link_review($1,$2,$3,$4,$5,$6,$7) AS result',
    [link.association,'withdraw',null,'虚构独立纠错证据',null,'已有商机不可以直接撤回',key()]);
   await deny(m,'SELECT ms.decide_lead_student_link_review($1,$2,$3,$4,$5)',
    [withdraw,'approved','越权直接撤回','不能绕过商机纠错',key()],'23514');
   await deny(root,
    "DELETE FROM ms.lead_student_downstream_correction_decisions WHERE case_id=$1",
    [caseId],'23514');
   await deny(root,'UPDATE ms.lead_student_downstream_correction_decisions SET reason_zh=$2 WHERE case_id=$1',
    [caseId,'修改历史'],'23514');
   await deny(root,"UPDATE ms.opportunities SET stage='won' WHERE id=$1",[opp],'23514');
   assert.equal((await root.query('SELECT COUNT(*)::int AS n FROM ms.sale_events se WHERE se.order_id=$1',
    [order])).rows[0].n,0);
  });
  await t.test('rejecting separate case releases only its own hold without altering past decision',async()=>{
   const second=await linkedLead('错误上报后驳回');
   const op=(await root.query(
    "INSERT INTO ms.opportunities(student_id,owner_user_id,originating_lead_id) VALUES($1,$2,$3) RETURNING id",
    [second.student,A,second.lead])).rows[0].id;
   const args=[second.association,'虚构争议证据','申请独立判断是否应隔离该商机',key()];
   const id=await call(a,request,args);
   await deny(root,"UPDATE ms.opportunities SET stage='contacted' WHERE id=$1",[op],'23514');
   assert.equal(await call(m,decide,
    [id,'rejected','虚构独立对照证据','经独立核实此次并非错误关联',key()]),
    '已驳回此纠错保护申请，原业务记录未改变');
   assert.equal((await root.query('SELECT status FROM ms.lead_student_downstream_correction_cases WHERE id=$1',
    [id])).rows[0].status,'rejected');
   await root.query("UPDATE ms.opportunities SET stage='contacted' WHERE id=$1",[op]);
   assert.equal((await root.query('SELECT stage FROM ms.opportunities WHERE id=$1',[op])).rows[0].stage,
    'contacted');
   assert.equal((await root.query('SELECT stage FROM ms.opportunities WHERE id=$1',[opp])).rows[0].stage,
    'new');
  });
  await t.test('two concurrent submissions cannot create duplicate open holds for same student',async()=>{
   const third=await linkedLead('同一学生并发归因纠错');
   await root.query('INSERT INTO ms.opportunities(student_id,owner_user_id,originating_lead_id) VALUES($1,$2,$3)',
    [third.student,A,third.lead]);
   const result=await Promise.allSettled([
    call(a,request,[third.association,'虚构第一份材料','并发请求第一笔',key()]),
    call(a,request,[third.association,'虚构第二份材料','并发请求第二笔',key()])
   ]);
   assert.equal(result.filter(x=>x.status==='fulfilled').length,1);
   assert.equal(result.filter(x=>x.status==='rejected').length,1);
   assert.equal((await root.query(
    "SELECT COUNT(*)::int AS n FROM ms.lead_student_downstream_correction_cases WHERE association_request_id=$1 AND status='pending'",
    [third.association])).rows[0].n,1);
  });
 }finally{await Promise.all([root,a,b,m,ra,rb].map(x=>x.end()));}
});
