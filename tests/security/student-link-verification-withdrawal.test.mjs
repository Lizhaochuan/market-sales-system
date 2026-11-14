import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import pg from 'pg';

const ORG='20000000-0000-4000-8000-000000000001';
const A='20000000-0000-4000-8000-000000000011';
const B='20000000-0000-4000-8000-000000000012';
const key=()=>randomBytes(20).toString('hex');
const pool=name=>new pg.Pool({connectionString:process.env[name],max:4});
const call=async(p,sql,args)=>(await p.query(sql,args)).rows[0].result;
const reject=async(p,sql,args,code)=>assert.rejects(p.query(sql,args),e=>e.code===code,sql);
const requestReview='SELECT ms.request_lead_student_link_review($1,$2,$3,$4,$5,$6,$7) AS result';
const decideReview='SELECT ms.decide_lead_student_link_review($1,$2,$3,$4,$5) AS result';

test('V3.2-21 one-student commercial linkage verification and immutable mistaken-link withdrawal',async t=>{
 const root=pool('DATABASE_URL'),a=pool('DATABASE_URL_WRITE_A'),
 b=pool('DATABASE_URL_WRITE_B'),m=pool('DATABASE_URL_WRITE_MANAGER'),
 ra=pool('DATABASE_URL_ASSIGNEE_A'),rb=pool('DATABASE_URL_ASSIGNEE_B');
 async function makeLead(label){
  const c=(await call(a,'SELECT ms.create_scoped_contact($1,$2,$3) AS result',
   [label+'-'+randomUUID(),false,key()])).contact_id;
  const ev=(await call(a,'SELECT ms.create_scoped_contact_consultation($1,$2,$3,$4) AS result',
   [c,'线上咨询',new Date(Date.now()-110000),key()])).event_id;
  const candidate=await call(a,'SELECT ms.request_consultation_lead_candidate($1,$2,$3,$4) AS result',
   [ev,'虚构咨询证明','独立核实咨询候选',key()]);
  await call(m,'SELECT ms.decide_consultation_lead_candidate($1,$2,$3,$4,$5) AS result',
   [candidate,'reviewed_eligible','虚构主管证据','确认候选符合要求',key()]);
  const ready=await call(a,'SELECT ms.submit_lead_conversion_preflight($1,$2,$3,$4) AS result',
   [candidate,'虚构预审批证明','请求正式线索预审',key()]);
  await call(m,'SELECT ms.decide_lead_conversion_preflight($1,$2,$3,$4,$5) AS result',
   [ready,'cleared','虚构主管预审材料','预审条件合格',key()]);
  const auth=await call(a,'SELECT ms.request_final_lead_conversion($1,$2,$3,$4) AS result',
   [ready,'虚构最终审批证据','请求正式转换',key()]);
  await call(m,'SELECT ms.decide_final_lead_conversion($1,$2,$3,$4,$5) AS result',
   [auth,'approved','虚构审批证明','最终批准',key()]);
  const out=await call(a,'SELECT ms.execute_final_lead_conversion($1,$2) AS result',
   [auth,key()]);
  return {lead:out.lead_id,contact:c,event:ev};
 }
 async function pendingLink(label){
  const lead=await makeLead(label);
  const student=(await call(a,'SELECT ms.create_scoped_student($1,$2,$3,$4) AS result',
   [label+'学生-'+randomUUID(),null,null,key()])).student_id;
  const q=await call(a,'SELECT ms.request_lead_student_association($1,$2,$3,$4,$5) AS result',
   [lead.lead,student,'虚构指定学生登记证明','独立待核实申请',key()]);
  await call(m,'SELECT ms.decide_lead_student_association($1,$2,$3,$4,$5) AS result',
   [q,'approved_pending','虚构主管复核资料','仅登记这一名学生的待核实关系',key()]);
  return {...lead,student,association:q};
 }
 const state=async(link)=>(
  await root.query('SELECT confirmation_state,confirmed_by FROM ms.lead_students WHERE lead_id=$1 AND student_id=$2',
   [link.lead,link.student])).rows[0];
 try{
  await t.test('actual staff DB LOGINs cannot read/write raw review tables, lead-student or financial data',async()=>{
   for(const p of [a,b,m,ra,rb]){
    for(const tb of ['ms.lead_student_link_review_requests','ms.lead_student_link_review_decisions',
     'ms.lead_student_link_review_effects','ms.lead_students','ms.students','ms.sales_orders']){
      await reject(p,'SELECT * FROM '+tb,[],'42501');
    }
   }
  });
  let link,verifyReview;
  await t.test('one existing pending link, scoped access, own student only; cannot self-approve',async()=>{
   link=await pendingLink('正式人工核实');
   const sibling=(await call(a,'SELECT ms.create_scoped_student($1,$2,$3,$4) AS result',
    ['不能自动关联的另一孩子-'+randomUUID(),null,null,key()])).student_id;
   const args=[link.association,'verify','student_consultation',
    '虚构本人相关咨询事件编号','虚构指定学生人工确认单','单独核实该名学生与线索的关联',key()];
   await reject(b,requestReview,args,'42501');
   verifyReview=await call(a,requestReview,args);
   assert.equal(await call(a,requestReview,args),verifyReview);
   assert.equal((await rb.query(
    'SELECT * FROM ms.scoped_lead_student_link_review_requests WHERE review_id=$1',
    [verifyReview])).rowCount,0);
   assert.equal((await ra.query(
    'SELECT * FROM ms.scoped_lead_student_link_review_requests WHERE review_id=$1',
    [verifyReview])).rowCount,1);
   await reject(a,decideReview,[verifyReview,'approved','本人证明','禁止自批',key()],'42501');
   await reject(b,decideReview,[verifyReview,'approved','虚构材料','非主管不得审核',key()],'42501');
   assert.equal((await state(link)).confirmation_state,'pending_review');
   assert.equal((await root.query(
    'SELECT COUNT(*)::int AS n FROM ms.lead_students WHERE lead_id=$1 AND student_id=$2',
    [link.lead,sibling])).rows[0].n,0);
  });
  await t.test('independent approval verifies commercial link ONLY, never guardian/family; append-only decision',async()=>{
   const decide=[verifyReview,'approved','虚构主管交叉复核','核实学生和实际咨询是同一业务对象',key()];
   assert.equal(await call(m,decideReview,decide),
    '已核实这一名学生的销售线索关联，未核实监护关系');
   assert.equal(await call(m,decideReview,decide),
    '已核实这一名学生的销售线索关联，未核实监护关系');
   const st=await state(link);
   assert.equal(st.confirmation_state,'verified');
   assert.equal(st.confirmed_by,'20000000-0000-4000-8000-000000000013');
   assert.equal((await root.query('SELECT COUNT(*)::int AS n FROM ms.student_contacts WHERE student_id=$1',
    [link.student])).rows[0].n,0);
   assert.equal((await root.query('SELECT COUNT(*)::int AS n FROM ms.family_memberships WHERE student_id=$1',
    [link.student])).rows[0].n,0);
   assert.equal((await root.query('SELECT COUNT(*)::int AS n FROM ms.contact_event_students WHERE event_id=$1',
    [link.event])).rows[0].n,0);
   assert.equal((await root.query('SELECT source_event_id FROM ms.leads WHERE id=$1',[link.lead])).rows[0].source_event_id,
    link.event);
   await reject(root,"UPDATE ms.lead_student_link_review_decisions SET reason_zh='篡改' WHERE request_id=$1",
    [verifyReview],'23514');
   await reject(a,requestReview,
    [link.association,'verify','student_consultation','重复凭据','重复证明','禁止重复核实',key()],'23514');
  });
  await t.test('approved mistaken-link withdrawal preserves original record, verification, and source',async()=>{
   const args=[link.association,'withdraw',null,'虚构客户明确指出学生关联有误',null,
    '这是错误关联，需要保留历史并撤回',key()];
   const id=await call(a,requestReview,args);
   assert.equal(await call(a,requestReview,args),id);
   assert.equal((await state(link)).confirmation_state,'verified');
   await reject(a,decideReview,[id,'approved','自批证据','本人撤销',key()],'42501');
   const decision=[id,'approved','主管独立确认误关联','已核实本次学生关联有误',key()];
   assert.equal(await call(m,decideReview,decision),
    '错误学生关联已撤回，原审批及线索历史保留');
   assert.equal(await call(m,decideReview,decision),
    '错误学生关联已撤回，原审批及线索历史保留');
   assert.equal((await state(link)).confirmation_state,'withdrawn');
   assert.equal((await root.query(
    'SELECT COUNT(*)::int AS n FROM ms.lead_students WHERE lead_id=$1 AND student_id=$2',
    [link.lead,link.student])).rows[0].n,1);
   assert.equal((await root.query(
    'SELECT COUNT(*)::int AS n FROM ms.lead_student_link_review_effects WHERE lead_id=$1',
    [link.lead])).rows[0].n,2);
   assert.equal((await root.query('SELECT lead_state,source_event_id FROM ms.leads WHERE id=$1',
    [link.lead])).rows[0].source_event_id,link.event);
   await reject(root,'DELETE FROM ms.lead_student_link_review_effects WHERE lead_id=$1',
    [link.lead],'23514');
   await reject(a,requestReview,[link.association,'withdraw',null,'再撤回',null,
    '已撤回后不能重试新编号',key()],'23514');
  });
  await t.test('verified link withdrawn on conflict cannot be silently recreated; other student stays independent',async()=>{
   const second=await pendingLink('直接撤回仍待核实关联');
   const withdrawal=await call(a,requestReview,
    [second.association,'withdraw',null,'虚构学生身份核对不一致',null,'尚未正式确认之前撤回',key()]);
   assert.equal(await call(m,decideReview,
    [withdrawal,'approved','主管独立同意','批准撤回待核实误关联',key()]),
    '错误学生关联已撤回，原审批及线索历史保留');
   assert.equal((await state(second)).confirmation_state,'withdrawn');
   await reject(a,requestReview,[second.association,'verify','student_consultation',
    '迟到的核实材料','虚构核实记录','不得核实已撤回关系',key()],'23514');
  });
  await t.test('reassigned student cannot be verified, review rejection does not mutate pending link',async()=>{
   const pending=await pendingLink('学生负责人变更');
   const review=await call(a,requestReview,
    [pending.association,'verify','independent_student_confirmation',
     '虚构核对材料','虚构独立指定学生确认依据','申请时由本人管理',key()]);
   await root.query('UPDATE ms.students SET owner_user_id=$2 WHERE id=$1',[pending.student,B]);
   await reject(m,decideReview,[review,'approved','虚构审核材料','批准不再有权的学生',key()],'23514');
   assert.equal((await state(pending)).confirmation_state,'pending_review');
   assert.equal(await call(m,decideReview,
    [review,'rejected','已发现管理权变更','学生负责人不同，驳回审核',key()]),
    '独立审核已驳回，关联未改变');
  });
  await t.test('opportunity for the exact student blocks mistaken-link withdrawal; no partial effect',async()=>{
   const downstream=await pendingLink('已有学生商机阻断');
   await root.query('INSERT INTO ms.opportunities(student_id,owner_user_id,originating_lead_id) VALUES($1,$2,$3)',
    [downstream.student,A,downstream.lead]);
   const review=await call(a,requestReview,[downstream.association,'withdraw',null,
    '虚构纠错理由',null,'错误关联涉及已建立商机的学生',key()]);
   await reject(m,decideReview,[review,'approved','虚构复核材料','已有商机不得单独撤回',key()],'23514');
   assert.equal((await state(downstream)).confirmation_state,'pending_review');
   assert.equal((await root.query('SELECT status FROM ms.lead_student_link_review_requests WHERE id=$1',
    [review])).rows[0].status,'pending');
   assert.equal((await root.query('SELECT COUNT(*)::int AS n FROM ms.lead_student_link_review_effects WHERE request_id=$1',
    [review])).rows[0].n,0);
  });
 }finally{await Promise.all([root,a,b,m,ra,rb].map(x=>x.end()));}
});
