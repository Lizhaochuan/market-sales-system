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
const caseRequest='SELECT ms.request_downstream_student_correction($1,$2,$3,$4) AS result';
const caseDecide='SELECT ms.decide_downstream_student_correction($1,$2,$3,$4,$5) AS result';
const reconcileRequest='SELECT ms.request_downstream_reconciliation($1,$2,$3,$4,$5,$6) AS result';
const reconcileDecide='SELECT ms.decide_downstream_reconciliation($1,$2,$3,$4,$5) AS result';
test('V3.2-23 distinct independent reviewer and fail-closed downstream reconciliation',async t=>{
 const root=pool('DATABASE_URL'),a=pool('DATABASE_URL_WRITE_A'),
 b=pool('DATABASE_URL_WRITE_B'),m=pool('DATABASE_URL_WRITE_MANAGER'),
 n=pool('DATABASE_URL_WRITE_REVIEWER_2'),
 ra=pool('DATABASE_URL_ASSIGNEE_A'),
 rn=pool('DATABASE_URL_READ_REVIEWER_2');
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

 async function held(label,includeOrder=false){
  const linked=await linkedLead(label);
  const opportunity=(await root.query(
   "INSERT INTO ms.opportunities(student_id,owner_user_id,originating_lead_id,stage) VALUES($1,$2,$3,'new') RETURNING id",
   [linked.student,A,linked.lead])).rows[0].id;
  let order=null;
  if(includeOrder)order=(await root.query(
   'INSERT INTO ms.sales_orders(student_id,opportunity_id,amount_due_cents) VALUES($1,$2,5000) RETURNING id',
   [linked.student,opportunity])).rows[0].id;
  const caseId=await call(a,caseRequest,
   [linked.association,'虚构下游商机纠错材料','已经存在商机，需要独立隔离',key()]);
  const firstReview=[caseId,'hold_active','虚构第一位主管核查','发现学生归属有争议，维持隔离',key()];
  assert.equal(await call(m,caseDecide,firstReview),
   '已确认跨模块保护，错误学生关联尚未撤回');
  return {...linked,opportunity,order,caseId};
 }
 try{
  await t.test('second independent reviewer remains function-only and cross-staff/tenant read isolation',async()=>{
   for(const conn of [a,b,m,n,ra,rn]){
    for(const table of ['ms.downstream_correction_reconciliation_requests',
     'ms.downstream_correction_reconciliation_decisions',
     'ms.downstream_correction_reconciliation_effects',
     'ms.sales_orders','ms.payment_allocations','ms.lead_students']){
      await deny(conn,'SELECT * FROM '+table,[],'42501');
    }
   }
  });
  let falseAlarm,approval;
  await t.test('false alarm with no dependent records: application and first manager cannot self-release',async()=>{
   falseAlarm=await held('无付款无报价的误报可复核');
   const args=[falseAlarm.caseId,'original_student_valid','虚构原学生咨询资料',
    '第二份独立核实原学生材料','最新核查确认原学生关联正确且没有下游交易',key()];
   approval=await call(a,reconcileRequest,args);
   assert.equal(await call(a,reconcileRequest,args),approval);
   await deny(b,reconcileRequest,args,'42501');
   await deny(a,reconcileDecide,[approval,'approved','本人签字','本人不能批准',key()],'42501');
   await deny(m,reconcileDecide,
    [approval,'approved','第一位主管材料','第一位主管不能二次放行',key()],'42501');
   assert.equal((await root.query(
    "SELECT status FROM ms.lead_student_downstream_correction_cases WHERE id=$1",
    [falseAlarm.caseId])).rows[0].status,'hold_active');
   assert.equal((await rn.query(
    'SELECT * FROM ms.scoped_downstream_reconciliation_requests WHERE reconciliation_id=$1',
    [approval])).rowCount,1);
   assert.equal((await ra.query(
    'SELECT * FROM ms.scoped_downstream_reconciliation_requests WHERE reconciliation_id=$1',
    [approval])).rowCount,1);
   assert.equal((await rn.query(
    'SELECT * FROM ms.scoped_downstream_reconciliation_eligible WHERE case_id=$1',
    [falseAlarm.caseId])).rowCount,0);
  });
  await t.test('second independent manager releases only true false alarm and preserves student, lead and opportunity',async()=>{
   const args=[approval,'approved','第二位主管独立复核单学生原咨询','确认没有报价订单合同试课履约付款或业绩',key()];
   assert.equal(await call(n,reconcileDecide,args),
    '误报已独立复核且无下游负担，销售隔离已解除');
   assert.equal(await call(n,reconcileDecide,args),
    '误报已独立复核且无下游负担，销售隔离已解除');
   assert.equal((await root.query(
    'SELECT status FROM ms.lead_student_downstream_correction_cases WHERE id=$1',
    [falseAlarm.caseId])).rows[0].status,'released');
   assert.equal((await root.query(
    'SELECT student_id FROM ms.opportunities WHERE id=$1',[falseAlarm.opportunity]
   )).rows[0].student_id,falseAlarm.student);
   assert.equal((await root.query(
    'SELECT confirmation_state FROM ms.lead_students WHERE lead_id=$1 AND student_id=$2',
    [falseAlarm.lead,falseAlarm.student])).rows[0].confirmation_state,'pending_review');
   assert.equal((await root.query(
    'SELECT count(*)::int n FROM ms.downstream_correction_reconciliation_effects WHERE case_id=$1',
    [falseAlarm.caseId])).rows[0].n,1);
   assert.equal((await root.query(
    'SELECT count(*)::int n FROM ms.sales_orders WHERE opportunity_id=$1',
    [falseAlarm.opportunity])).rows[0].n,0);
   await root.query("UPDATE ms.opportunities SET stage='qualified' WHERE id=$1",
    [falseAlarm.opportunity]);
   assert.equal((await root.query('SELECT stage FROM ms.opportunities WHERE id=$1',
    [falseAlarm.opportunity])).rows[0].stage,'qualified');
   await deny(root,
    "DELETE FROM ms.downstream_correction_reconciliation_effects WHERE case_id=$1",
    [falseAlarm.caseId],'23514');
   await deny(root,
    "UPDATE ms.downstream_correction_reconciliation_decisions SET reason_zh='篡改' WHERE request_id=$1",
    [approval],'23514');
  });
  await t.test('actual wrong student with order goes to external handoff; sales hold remains',async()=>{
   const impacted=await held('已有订单必须交跨部门人工核实',true);
   const requestId=await call(a,reconcileRequest,
    [impacted.caseId,'external_action_required',
    '虚构客户确认学生错误的原始材料','虚构订单及商机核对清单',
    '必须核对合同退款及业绩来源，不能销售侧直接改学生',key()]);
   const args=[requestId,'approved','第二位主管对照真实影响清单',
    '需要财务权威、销售主管和教务系统后续分别纠正',key()];
   assert.equal(await call(n,reconcileDecide,args),
    '已进入跨部门人工纠错，销售隔离继续保持');
   assert.equal(await call(n,reconcileDecide,args),
    '已进入跨部门人工纠错，销售隔离继续保持');
   assert.equal((await root.query(
    'SELECT status FROM ms.lead_student_downstream_correction_cases WHERE id=$1',
    [impacted.caseId])).rows[0].status,'hold_active');
   assert.equal((await root.query(
    'SELECT student_id FROM ms.sales_orders WHERE id=$1',
    [impacted.order])).rows[0].student_id,impacted.student);
   assert.equal((await root.query(
    'SELECT student_id FROM ms.opportunities WHERE id=$1',
    [impacted.opportunity])).rows[0].student_id,impacted.student);
   assert.equal((await root.query(
    'SELECT count(*)::int n FROM ms.downstream_correction_reconciliation_effects WHERE case_id=$1',
    [impacted.caseId])).rows[0].n,1);
   await deny(root,"UPDATE ms.opportunities SET stage='won' WHERE id=$1",
    [impacted.opportunity],'23514');
  });
  await t.test('existing order prevents second reviewer from releasing even after claimed false alarm',async()=>{
   const impacted=await held('已有订单错误宣称误报不能释放',true);
   const reviewId=await call(a,reconcileRequest,
    [impacted.caseId,'original_student_valid',
    '虚构单方主张没有下游风险','虚构引用未完成完整财务核对',
    '故意测试是否能绕过订单负担限制',key()]);
   await deny(n,reconcileDecide,
    [reviewId,'approved','试图批准误报','已有订单必须失败关闭',key()],
    '23514');
   assert.equal((await root.query(
    'SELECT status FROM ms.downstream_correction_reconciliation_requests WHERE id=$1',
    [reviewId])).rows[0].status,'pending');
   assert.equal((await root.query(
    'SELECT status FROM ms.lead_student_downstream_correction_cases WHERE id=$1',
    [impacted.caseId])).rows[0].status,'hold_active');
   assert.equal((await root.query(
    'SELECT count(*)::int n FROM ms.downstream_correction_reconciliation_decisions WHERE request_id=$1',
    [reviewId])).rows[0].n,0);
   assert.equal(await call(n,reconcileDecide,
    [reviewId,'rejected','第二主管拒绝无根据放行','存在订单无法解除保护',key()]),
    '本次复核已驳回，销售隔离继续保持');
  });
  await t.test('request cannot be submitted until first independent manager holds case',async()=>{
   const link=await linkedLead('没有主管首轮决定');
   await root.query('INSERT INTO ms.opportunities(student_id,owner_user_id,originating_lead_id) VALUES($1,$2,$3)',
    [link.student,A,link.lead]);
   const c=await call(a,caseRequest,
    [link.association,'虚构商机争议','先报告争议待主管审核',key()]);
   await deny(a,reconcileRequest,
    [c,'external_action_required','未经过首轮审核','第二份材料',
    '不允许跳过首轮主管审核',key()],'23514');
   assert.equal((await root.query('SELECT status FROM ms.lead_student_downstream_correction_cases WHERE id=$1',
    [c])).rows[0].status,'pending');
  });
 }finally{await Promise.all([root,a,b,m,n,ra,rn].map(x=>x.end()));}
});
