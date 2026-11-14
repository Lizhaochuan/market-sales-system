import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import pg from 'pg';
const ORG='20000000-0000-4000-8000-000000000001';
const A='20000000-0000-4000-8000-000000000011';
const B='20000000-0000-4000-8000-000000000012';
const key=()=>randomBytes(20).toString('hex');
const pool=name=>new pg.Pool({connectionString:process.env[name],max:3});
const call=async(p,s,args)=>(await p.query(s,args)).rows[0].result;
const deny=(p,s,args,code)=>assert.rejects(p.query(s,args),e=>e.code===code,s);
const requestAssociation='SELECT ms.request_lead_student_association($1,$2,$3,$4,$5) AS result';
const decideAssociation='SELECT ms.decide_lead_student_association($1,$2,$3,$4,$5) AS result';
const requestAdjustment='SELECT ms.request_lead_adjustment($1,$2,$3,$4,$5,$6) AS result';
const decideAdjustment='SELECT ms.decide_lead_adjustment($1,$2,$3,$4,$5) AS result';

test('V3.2-20 single-student pending link and immutable lead correction/void',async t=>{
 const root=pool('DATABASE_URL'),a=pool('DATABASE_URL_WRITE_A'),
  b=pool('DATABASE_URL_WRITE_B'),m=pool('DATABASE_URL_WRITE_MANAGER'),
  ra=pool('DATABASE_URL_ASSIGNEE_A'),rb=pool('DATABASE_URL_ASSIGNEE_B');
 async function makeLead(label){
  const contact=(await call(a,'SELECT ms.create_scoped_contact($1,$2,$3) AS result',
   [label+'-'+randomUUID(),false,key()])).contact_id;
  const source=(await call(a,'SELECT ms.create_scoped_contact_consultation($1,$2,$3,$4) AS result',
   [contact,'线上咨询',new Date(Date.now()-100000),key()])).event_id;
  const candidate=await call(a,
   'SELECT ms.request_consultation_lead_candidate($1,$2,$3,$4) AS result',
   [source,'虚构咨询证据','真实咨询候选核查',key()]);
  await call(m,'SELECT ms.decide_consultation_lead_candidate($1,$2,$3,$4,$5) AS result',
   [candidate,'reviewed_eligible','虚构审核依据','候选核实通过',key()]);
  const ready=await call(a,
   'SELECT ms.submit_lead_conversion_preflight($1,$2,$3,$4) AS result',
   [candidate,'虚构预审证据','申请预审',key()]);
  await call(m,'SELECT ms.decide_lead_conversion_preflight($1,$2,$3,$4,$5) AS result',
   [ready,'cleared','虚构主管核查','通过独立预审',key()]);
  const authorization=await call(a,
   'SELECT ms.request_final_lead_conversion($1,$2,$3,$4) AS result',
   [ready,'虚构正式转换材料','申请最终转换',key()]);
  await call(m,'SELECT ms.decide_final_lead_conversion($1,$2,$3,$4,$5) AS result',
   [authorization,'approved','虚构批准证据','独立批准最终转换',key()]);
  const out=await call(a,'SELECT ms.execute_final_lead_conversion($1,$2) AS result',
   [authorization,key()]);
  return {lead:out.lead_id,contact,source};
 }
 const newStudent=async(p,label)=>(
   await call(p,'SELECT ms.create_scoped_student($1,$2,$3,$4) AS result',
     [label+'-'+randomUUID(),null,null,key()])
 ).student_id;
 try{
  await t.test('employee role has no raw lead, linkage, decision or financial table privileges',async()=>{
   for(const p of [a,b,m,ra,rb]){
    for(const table of ['ms.leads','ms.lead_students','ms.lead_student_association_requests',
      'ms.lead_student_association_decisions','ms.lead_adjustment_requests',
      'ms.lead_adjustment_decisions','ms.lead_adjustment_effects',
      'ms.sales_orders','ms.student_contacts']){
      await deny(p,'SELECT * FROM '+table,[],'42501');
    }
   }
  });
  let lead,one,two,other;
  await t.test('one explicitly named student only; no family, sibling or verified link inferred',async()=>{
   lead=await makeLead('单名学生核实');
   one=await newStudent(a,'单名指定学生');
   two=await newStudent(a,'同联系人另一名学生不自动关联');
   other=await newStudent(b,'另一员工负责的学生');
   const args=[lead.lead,one,'虚构指定学生关联依据','这名学生需要单独核实',key()];
   await deny(b,requestAssociation,args,'42501');
   await deny(a,requestAssociation,[lead.lead,other,'虚构本人材料','越权关联他人学生',key()],'42501');
   const id=await call(a,requestAssociation,args);
   assert.equal(await call(a,requestAssociation,args),id);
   assert.equal((await root.query('SELECT COUNT(*)::int n FROM ms.lead_students WHERE lead_id=$1',
     [lead.lead])).rows[0].n,0);
   assert.equal((await rb.query('SELECT * FROM ms.scoped_lead_student_associations WHERE request_id=$1',
     [id])).rowCount,0);
   assert.equal((await ra.query('SELECT * FROM ms.scoped_lead_student_associations WHERE request_id=$1',
     [id])).rowCount,1);
   await deny(a,decideAssociation,[id,'approved_pending','虚构材料','本人自批',key()],'42501');
   await deny(b,decideAssociation,[id,'approved_pending','虚构材料','非主管审核',key()],'42501');
   const decide=[id,'approved_pending','独立主管依据','只允许登记未确认关系',key()];
   assert.equal(await call(m,decideAssociation,decide),
     '已登记单名学生的待核实关联，不代表关系已确认');
   assert.equal(await call(m,decideAssociation,decide),
     '已登记单名学生的待核实关联，不代表关系已确认');
   const links=(await root.query('SELECT student_id,confirmation_state,confirmed_by FROM ms.lead_students WHERE lead_id=$1',
     [lead.lead])).rows;
   assert.equal(links.length,1);assert.equal(links[0].student_id,one);
   assert.equal(links[0].confirmation_state,'pending_review');
   assert.equal(links[0].confirmed_by,null);
   assert.equal((await root.query('SELECT count(*)::int n FROM ms.student_contacts WHERE student_id IN ($1,$2)',
     [one,two])).rows[0].n,0);
   assert.equal((await root.query('SELECT COUNT(*)::int n FROM ms.family_memberships WHERE student_id IN ($1,$2)',
     [one,two])).rows[0].n,0);
   assert.equal((await root.query('SELECT count(*)::int n FROM ms.lead_students WHERE lead_id=$1 AND student_id=$2',
     [lead.lead,two])).rows[0].n,0);
   await deny(a,requestAssociation,[lead.lead,one,'重复材料','重复关联',key()],'23505');
   await deny(root,"UPDATE ms.lead_student_association_decisions SET reason_zh='篡改' WHERE request_id=$1",
     [id],'23514');
  });
  await t.test('request for second student stays separate; denied student link preserves prior link',async()=>{
   const args=[lead.lead,two,'第二名学生虚构证据','单独待核实，非家庭自动关联',key()];
   const id=await call(a,requestAssociation,args);
   assert.equal((await root.query('SELECT COUNT(*)::int n FROM ms.lead_students WHERE lead_id=$1',
     [lead.lead])).rows[0].n,1);
   assert.equal(await call(m,decideAssociation,
     [id,'rejected','虚构独立审核','证据不足，拒绝第二名学生',key()]),
     '学生关联申请已驳回');
   assert.equal((await root.query('SELECT COUNT(*)::int n FROM ms.lead_students WHERE lead_id=$1',
     [lead.lead])).rows[0].n,1);
  });
  await t.test('note correction appends without changing source event, owner or financial state',async()=>{
   const args=[lead.lead,'correct_note','只更正单名学生的需求说明',
      '虚构文字核对证明','纠正之前的文本描述',key()];
   const id=await call(a,requestAdjustment,args);
   assert.equal(await call(a,requestAdjustment,args),id);
   await deny(a,decideAdjustment,[id,'approved','本人审核','不能自批',key()],'42501');
   const decision=[id,'approved','虚构独立复核依据','同意更正业务说明',key()];
   assert.equal(await call(m,decideAdjustment,decision),'线索调整已独立审批并留存审计');
   assert.equal(await call(m,decideAdjustment,decision),'线索调整已独立审批并留存审计');
   const corrected=(await ra.query('SELECT * FROM ms.scoped_lead_correction_notes WHERE lead_id=$1',
     [lead.lead])).rows;
   assert.equal(corrected.length,1);
   assert.equal(corrected[0].corrected_note,'只更正单名学生的需求说明');
   assert.equal((await rb.query('SELECT * FROM ms.scoped_lead_correction_notes WHERE lead_id=$1',
     [lead.lead])).rowCount,0);
   const raw=(await root.query('SELECT source_event_id,owner_user_id,lead_state FROM ms.leads WHERE id=$1',
     [lead.lead])).rows[0];
   assert.equal(raw.source_event_id,lead.source);assert.equal(raw.owner_user_id,A);
   assert.equal(raw.lead_state,'unidentified');
   assert.equal((await root.query('SELECT count(*)::int n FROM ms.opportunities WHERE originating_lead_id=$1',
     [lead.lead])).rows[0].n,0);
   await deny(root,"DELETE FROM ms.lead_adjustment_effects WHERE lead_id=$1",[lead.lead],'23514');
   await deny(root,"UPDATE ms.lead_adjustment_decisions SET reason_zh='篡改' WHERE request_id=$1",
     [id],'23514');
  });
  await t.test('approved invalidation changes only lead status; it is never deleted',async()=>{
   const target=await makeLead('可作废线索');
   const request=await call(a,requestAdjustment,
    [target.lead,'invalidate',null,'虚构线索作废凭据','客户确认不再需要此线索',key()]);
   const args=[request,'approved','虚构作废复核','未产生下游商机，批准作废',key()];
   assert.equal(await call(m,decideAdjustment,args),'线索调整已独立审批并留存审计');
   const raw=(await root.query('SELECT lead_state,source_event_id,owner_user_id FROM ms.leads WHERE id=$1',
     [target.lead])).rows[0];
   assert.equal(raw.lead_state,'invalid');assert.equal(raw.source_event_id,target.source);
   assert.equal(raw.owner_user_id,A);
   assert.equal((await root.query('SELECT COUNT(*)::int n FROM ms.lead_conversion_executions WHERE lead_id=$1',
     [target.lead])).rows[0].n,1);
   await deny(a,requestAssociation,
     [target.lead,one,'已作废不可以关联','反例',key()],'23514');
   await deny(a,requestAdjustment,
     [target.lead,'correct_note','修订作废线索','虚构证据','不应该允许',key()],'23514');
  });
  await t.test('existing downstream opportunity blocks void but permits rejecting request',async()=>{
   const target=await makeLead('已有商机不可作废');
   const student=await newStudent(a,'商机指定学生');
   await root.query(
    "INSERT INTO ms.opportunities(student_id,owner_user_id,originating_lead_id) VALUES($1,$2,$3)",
    [student,A,target.lead]);
   const id=await call(a,requestAdjustment,
    [target.lead,'invalidate',null,'有下游业务材料','尝试作废有关联商机的线索',key()]);
   await deny(m,decideAdjustment,
    [id,'approved','主管复核','存在下游业务不得作废',key()],'23514');
   assert.equal((await root.query('SELECT lead_state FROM ms.leads WHERE id=$1',
     [target.lead])).rows[0].lead_state,'unidentified');
   assert.equal(await call(m,decideAdjustment,
    [id,'rejected','主管核查','已有商机因此驳回作废',key()]),'调整申请已驳回');
  });
  await t.test('cross-employee reassignment between application and review fails closed',async()=>{
   const target=await makeLead('权限变化');
   const student=await newStudent(a,'原负责人');
   const link=await call(a,requestAssociation,
    [target.lead,student,'独立学生材料','申请时拥有学生',key()]);
   await root.query('UPDATE ms.students SET owner_user_id=$2 WHERE id=$1',[student,B]);
   await deny(m,decideAssociation,
    [link,'approved_pending','虚构主管凭据','不再有学生管理权',key()],'23514');
   assert.equal((await root.query('SELECT count(*)::int n FROM ms.lead_students WHERE lead_id=$1',
    [target.lead])).rows[0].n,0);
   assert.equal((await root.query('SELECT status FROM ms.lead_student_association_requests WHERE id=$1',
    [link])).rows[0].status,'pending');
  });
 }finally{await Promise.all([root,a,b,m,ra,rb].map(x=>x.end()));}
});
