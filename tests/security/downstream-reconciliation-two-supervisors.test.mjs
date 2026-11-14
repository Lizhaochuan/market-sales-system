import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import pg from 'pg';

const A='20000000-0000-4000-8000-000000000011';
const M='20000000-0000-4000-8000-000000000013';
const M2='20000000-0000-4000-8000-000000000014';
const k=()=>randomBytes(20).toString('hex');
const pool=name=>new pg.Pool({connectionString:process.env[name],max:4});
const fn=async(p,sql,args)=>(await p.query(sql,args)).rows[0].result;
const deny=(p,sql,args,code)=>assert.rejects(p.query(sql,args),e=>e.code===code,sql);
const attest='SELECT ms.attest_downstream_student_reconciliation($1,$2,$3,$4,$5,$6,$7) AS result';
const resolve='SELECT ms.resolve_downstream_student_reconciliation($1,$2,$3,$4,$5) AS result';

test('V3.2-23 two independent supervisor reconciliation; no silent financial or student reassignment',async t=>{
 const root=pool('DATABASE_URL'),a=pool('DATABASE_URL_WRITE_A'),
  b=pool('DATABASE_URL_WRITE_B'),m=pool('DATABASE_URL_WRITE_MANAGER'),
  m2=pool('DATABASE_URL_WRITE_MANAGER_2'),
  ra=pool('DATABASE_URL_ASSIGNEE_A'),rb=pool('DATABASE_URL_ASSIGNEE_B'),
  rm2=pool('DATABASE_URL_ASSIGNEE_MANAGER_2');
 async function startCase(name,{order=false}={}){
  const contact=(await fn(a,'SELECT ms.create_scoped_contact($1,$2,$3) AS result',
   [name+'联系人-'+randomUUID(),false,k()])).contact_id;
  const ev=(await fn(a,'SELECT ms.create_scoped_contact_consultation($1,$2,$3,$4) AS result',
   [contact,'微信咨询',new Date(Date.now()-100000),k()])).event_id;
  const cand=await fn(a,'SELECT ms.request_consultation_lead_candidate($1,$2,$3,$4) AS result',
   [ev,'虚构真实咨询资料','核查正式候选',k()]);
  await fn(m,'SELECT ms.decide_consultation_lead_candidate($1,$2,$3,$4,$5) AS result',
   [cand,'reviewed_eligible','虚构候选审核','候选符合标准',k()]);
  const ready=await fn(a,'SELECT ms.submit_lead_conversion_preflight($1,$2,$3,$4) AS result',
   [cand,'虚构转换预审凭据','请主管核查转换',k()]);
  await fn(m,'SELECT ms.decide_lead_conversion_preflight($1,$2,$3,$4,$5) AS result',
   [ready,'cleared','虚构主管预审','核查通过',k()]);
  const auth=await fn(a,'SELECT ms.request_final_lead_conversion($1,$2,$3,$4) AS result',
   [ready,'虚构最终材料','申请正式转换',k()]);
  await fn(m,'SELECT ms.decide_final_lead_conversion($1,$2,$3,$4,$5) AS result',
   [auth,'approved','虚构最后审核','独立批准正式转换',k()]);
  const lead=(await fn(a,'SELECT ms.execute_final_lead_conversion($1,$2) AS result',
   [auth,k()])).lead_id;
  const student=(await fn(a,'SELECT ms.create_scoped_student($1,$2,$3,$4) AS result',
   [name+'指定学生-'+randomUUID(),null,null,k()])).student_id;
  const association=await fn(a,
   'SELECT ms.request_lead_student_association($1,$2,$3,$4,$5) AS result',
   [lead,student,'虚构指定学生关联证据','单学生待核实',k()]);
  await fn(m,'SELECT ms.decide_lead_student_association($1,$2,$3,$4,$5) AS result',
   [association,'approved_pending','虚构主管学生核查','批准待核实关联',k()]);
  const opportunity=(await root.query(
   "INSERT INTO ms.opportunities(student_id,owner_user_id,originating_lead_id,stage) VALUES($1,$2,$3,'new') RETURNING id",
   [student,A,lead])).rows[0].id;
  let salesOrder=null;
  if(order){
   salesOrder=(await root.query(
    'INSERT INTO ms.sales_orders(student_id,opportunity_id,amount_due_cents) VALUES($1,$2,3000) RETURNING id',
    [student,opportunity])).rows[0].id;
  }
  const caseId=await fn(a,'SELECT ms.request_downstream_student_correction($1,$2,$3,$4) AS result',
   [association,'虚构同名学生核验材料','原学生关联应暂停销售推进核查',k()]);
  await fn(m,'SELECT ms.decide_downstream_student_correction($1,$2,$3,$4,$5) AS result',
   [caseId,'hold_active','虚构主管风险核查','已确认需要维持保护',k()]);
  return {lead,student,association,opportunity,salesOrder,caseId,source:ev};
 }
 async function verifyLink(row){
  const review=await fn(a,'SELECT ms.request_lead_student_link_review($1,$2,$3,$4,$5,$6,$7) AS result',
   [row.association,'verify','student_consultation','虚构指定学生确权材料',
    '虚构学生来源与真实咨询对照','证明原学生身份对应业务线索',k()]);
  await fn(m,'SELECT ms.decide_lead_student_link_review($1,$2,$3,$4,$5) AS result',
   [review,'approved','独立核实材料','只核实这一名学生的销售线索关联',k()]);
 }
 const evidence=(caseId,finding='original_student_confirmed')=>
  [caseId,finding,'虚构指定学生独立核对单','虚构商机来源核对单',
   '虚构收款与订单零影响清单','原始销售关联独立核实',k()];
 try{
  await t.test('separate supervisor account cannot SELECT raw finance/reconciliation; has function only',async()=>{
   for(const p of [a,b,m,m2,ra,rb,rm2]){
    for(const tb of ['ms.downstream_student_reconciliation_findings',
     'ms.downstream_student_reconciliation_resolutions','ms.sales_orders',
     'ms.payment_allocations','ms.lead_students']){
     await deny(p,'SELECT * FROM '+tb,[],'42501');
    }
   }
   assert.equal((await rm2.query('SELECT ms.current_scoped_staff_id() AS actor')).rows[0].actor,M2);
  });
  let good,finding;
  await t.test('original student can be independently verified; first supervisor cannot release',async()=>{
   good=await startCase('安全解除误报');
   await deny(root,"UPDATE ms.opportunities SET stage='qualified' WHERE id=$1",
    [good.opportunity],'23514');
   await verifyLink(good);
   const args=evidence(good.caseId);
   await deny(a,attest,args,'42501');
   finding=await fn(m,attest,args);
   assert.equal(await fn(m,attest,args),finding);
   assert.equal((await rm2.query(
    'SELECT * FROM ms.scoped_downstream_student_reconciliations WHERE case_id=$1',
    [good.caseId])).rowCount,1);
   assert.equal((await rb.query(
    'SELECT * FROM ms.scoped_downstream_student_reconciliations WHERE case_id=$1',
    [good.caseId])).rowCount,0);
   await deny(m,resolve,[finding,'release_verified','主管自复核凭据',
    '不能自己批准自己释放',k()],'42501');
   await deny(a,resolve,[finding,'release_verified','申请人凭据',
    '不能申请人自己释放',k()],'42501');
   await deny(b,resolve,[finding,'release_verified','非主管凭据',
    '非主管拒绝',k()],'42501');
   assert.equal((await root.query(
    'SELECT status FROM ms.lead_student_downstream_correction_cases WHERE id=$1',
    [good.caseId])).rows[0].status,'hold_active');
  });
  await t.test('second distinct manager releases only correct verified no-finance/no-order case; original IDs unchanged',async()=>{
   const args=[finding,'release_verified','虚构第二主管独立核查依据',
    '再次核实原指定学生正确、无订单收款和试课影响',k()];
   const out='两位独立主管已确认原学生关联正确且无资金订单影响，销售隔离解除';
   assert.equal(await fn(m2,resolve,args),out);
   assert.equal(await fn(m2,resolve,args),out);
   assert.equal((await root.query(
    'SELECT status FROM ms.lead_student_downstream_correction_cases WHERE id=$1',
    [good.caseId])).rows[0].status,'released_verified');
   assert.equal((await root.query(
    'SELECT confirmation_state FROM ms.lead_students WHERE lead_id=$1 AND student_id=$2',
    [good.lead,good.student])).rows[0].confirmation_state,'verified');
   const o=(await root.query('SELECT student_id,originating_lead_id,stage FROM ms.opportunities WHERE id=$1',
    [good.opportunity])).rows[0];
   assert.equal(o.student_id,good.student);assert.equal(o.originating_lead_id,good.lead);
   await root.query("UPDATE ms.opportunities SET stage='qualified' WHERE id=$1",[good.opportunity]);
   assert.equal((await root.query('SELECT stage FROM ms.opportunities WHERE id=$1',
    [good.opportunity])).rows[0].stage,'qualified');
   await deny(root,'DELETE FROM ms.downstream_student_reconciliation_resolutions WHERE case_id=$1',
    [good.caseId],'23514');
   await deny(root,"UPDATE ms.downstream_student_reconciliation_findings SET reason_zh='改写' WHERE case_id=$1",
    [good.caseId],'23514');
   assert.equal((await root.query('SELECT source_event_id FROM ms.leads WHERE id=$1',
    [good.lead])).rows[0].source_event_id,good.source);
  });
  await t.test('confirmed WRONG student never releases even with no financial impact; escalation remains frozen',async()=>{
   const bad=await startCase('确认错误仍隔离');
   const finding=await fn(m,attest,evidence(bad.caseId,'wrong_student_confirmed'));
   await deny(m2,resolve,[finding,'release_verified','错误释放凭据','错误学生不允许释放',k()],'23514');
   assert.equal(await fn(m2,resolve,[finding,'escalate_manual','虚构人工转交依据',
    '确认错误学生，保留隔离等待跨模块负责人处理',k()]),
    '确认错误或存在下游影响，保留销售隔离，转人工跨模块纠错');
   assert.equal((await root.query('SELECT status FROM ms.lead_student_downstream_correction_cases WHERE id=$1',
    [bad.caseId])).rows[0].status,'hold_active');
   await deny(root,"UPDATE ms.opportunities SET stage='qualified' WHERE id=$1",
    [bad.opportunity],'23514');
   assert.equal((await root.query(
    'SELECT count(*)::int AS n FROM ms.downstream_student_reconciliation_resolutions WHERE case_id=$1',
    [bad.caseId])).rows[0].n,1);
  });
  await t.test('existing order prevents release even after true link verification; protect order and finance',async()=>{
   const row=await startCase('有订单无法安全解锁',{order:true});
   await verifyLink(row);
   const f=await fn(m,attest,evidence(row.caseId));
   await deny(m2,resolve,[f,'release_verified','虚构错误解除凭据',
    '订单存在禁止直接释放',k()],'23514');
   assert.equal(await fn(m2,resolve,[f,'escalate_manual','虚构跨模块处置凭据',
    '存在订单必须转人工核对',k()]),
    '确认错误或存在下游影响，保留销售隔离，转人工跨模块纠错');
   assert.equal((await root.query('SELECT status FROM ms.lead_student_downstream_correction_cases WHERE id=$1',
    [row.caseId])).rows[0].status,'hold_active');
   assert.equal((await root.query('SELECT student_id FROM ms.sales_orders WHERE id=$1',
    [row.salesOrder])).rows[0].student_id,row.student);
   await deny(root,"UPDATE ms.opportunities SET stage='qualified' WHERE id=$1",
    [row.opportunity],'23514');
  });
  await t.test('snapshot cannot be stale: new order between reviewer stages blocks release',async()=>{
   const row=await startCase('快照状态变化阻断');
   await verifyLink(row);
   const f=await fn(m,attest,evidence(row.caseId));
   const o=(await root.query(
    'INSERT INTO ms.sales_orders(student_id,opportunity_id,amount_due_cents) VALUES($1,$2,1000) RETURNING id',
    [row.student,row.opportunity])).rows[0].id;
   assert.ok(o);
   await deny(m2,resolve,[f,'release_verified','变化后尝试释放',
    '复核后订单新增应被拒绝',k()],'23514');
   assert.equal((await root.query('SELECT status FROM ms.lead_student_downstream_correction_cases WHERE id=$1',
    [row.caseId])).rows[0].status,'hold_active');
  });
 }finally{await Promise.all([root,a,b,m,m2,ra,rb,rm2].map(x=>x.end()));}
});
