import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';

const A='20000000-0000-4000-8000-000000000011';
const B='20000000-0000-4000-8000-000000000012';
const org='20000000-0000-4000-8000-000000000001';
const key=()=>randomBytes(20).toString('hex');
const pool=k=>new pg.Pool({connectionString:process.env[k],max:2});
const call=async(p,sql,args)=>(await p.query(sql,args)).rows[0].result;
const expectDeny=async(p,sql,args,code)=>assert.rejects(p.query(sql,args),e=>e.code===code,sql);

test('V3.2-18 preflight never creates a lead; independent attribution disputes and clearance revocation',async t=>{
 const own=pool('DATABASE_URL'),a=pool('DATABASE_URL_WRITE_A'),
  b=pool('DATABASE_URL_WRITE_B'),m=pool('DATABASE_URL_WRITE_MANAGER'),
  ra=pool('DATABASE_URL_ASSIGNEE_A'),rb=pool('DATABASE_URL_ASSIGNEE_B');
 let c,event,candidate,review,bEvent,dispute;
 const zeroLeads=async(contact)=>{
  const x=await own.query('SELECT COUNT(*)::int AS n FROM ms.leads WHERE contact_id=$1',[contact]);
  assert.equal(x.rows[0].n,0);
 };
 async function custody(from,target,contact){
  const req=await call(from,'SELECT ms.request_scoped_contact_custody($1,$2,$3,$4,$5) AS result',
   [contact,target,'虚构独立交接证据','客户沟通负责人变化',key()]);
  assert.equal(await call(m,'SELECT ms.decide_scoped_contact_custody($1,$2,$3,$4,$5) AS result',
   [req,'approved','主管审核材料','独立批准联系人交接',key()]),'已批准');
 }
 try{
  await t.test('real employee DB LOGIN cannot read protected tables or modify leads/finance',async()=>{
   for(const p of [a,b,m,ra,rb]){
    for(const tb of ['ms.lead_conversion_readiness','ms.lead_attribution_disputes',
     'ms.lead_conversion_readiness_decisions','ms.lead_attribution_dispute_decisions',
     'ms.leads','ms.sales_orders']){
      await expectDeny(p,'SELECT * FROM '+tb,[], '42501');
    }
    await expectDeny(p,"INSERT INTO ms.leads(organization_id,contact_id,owner_user_id) VALUES($1,$2,$3)",
      [org,randomUUID(),A],'42501');
   }
  });
  await t.test('candidate approved then applicant can request readiness once, not create lead',async()=>{
   const made=await call(a,'SELECT ms.create_scoped_contact($1,$2,$3) AS result',
    ['转换预审虚构联系人-'+randomUUID(),false,key()]);
   c=made.contact_id;
   const ev=await call(a,'SELECT ms.create_scoped_contact_consultation($1,$2,$3,$4) AS result',
    [c,'微信咨询',new Date(Date.now()-100000),key()]);
   event=ev.event_id;
   candidate=await call(a,'SELECT ms.request_consultation_lead_candidate($1,$2,$3,$4) AS result',
    [event,'虚构真实咨询凭证','请求核查转换候选',key()]);
   assert.equal(await call(m,'SELECT ms.decide_consultation_lead_candidate($1,$2,$3,$4,$5) AS result',
    [candidate,'reviewed_eligible','候选独立核实记录','确认为可核查的候选',key()]),
    '已审核符合候选条件，未创建正式线索');
   const args=[candidate,'独立转换预审凭证','仍需审核正式转换前置条件',key()];
   await expectDeny(b,'SELECT ms.submit_lead_conversion_preflight($1,$2,$3,$4)',args,'42501');
   review=await call(a,'SELECT ms.submit_lead_conversion_preflight($1,$2,$3,$4) AS result',args);
   assert.equal(await call(a,'SELECT ms.submit_lead_conversion_preflight($1,$2,$3,$4) AS result',args),review);
   await expectDeny(a,'SELECT ms.submit_lead_conversion_preflight($1,$2,$3,$4)',
    [candidate,'另一份材料','重提同一候选',key()],'23505');
   assert.equal((await rb.query('SELECT * FROM ms.scoped_conversion_readiness WHERE review_id=$1',
    [review])).rowCount,0);
   await zeroLeads(c);
  });
  await t.test('cross-employee historical event requires explicit independent resolution',async()=>{
   await custody(a,B,c);
   const ev=await call(b,'SELECT ms.create_scoped_contact_consultation($1,$2,$3,$4) AS result',
    [c,'电话咨询',new Date(Date.now()-80000),key()]);
   bEvent=ev.event_id;
   await custody(b,A,c);
   await expectDeny(m,'SELECT ms.decide_lead_conversion_preflight($1,$2,$3,$4,$5)',
    [review,'cleared','二次核实证据','尝试跳过跨员工归因争议',key()],'23514');
   const eligible=await rb.query(
    'SELECT * FROM ms.scoped_attribution_disputable_candidates WHERE candidate_id=$1 AND own_event_id=$2',
    [candidate,bEvent]);
   assert.equal(eligible.rowCount,1);
   assert.equal((await ra.query('SELECT * FROM ms.scoped_attribution_disputable_candidates WHERE candidate_id=$1',
    [candidate])).rowCount,0);
   const args=[candidate,bEvent,'本人微信记录核验','同一联系人由另一员工咨询',key()];
   await expectDeny(a,'SELECT ms.submit_lead_attribution_dispute($1,$2,$3,$4,$5)',
    args,'42501');
   dispute=await call(b,'SELECT ms.submit_lead_attribution_dispute($1,$2,$3,$4,$5) AS result',args);
   assert.equal(await call(b,'SELECT ms.submit_lead_attribution_dispute($1,$2,$3,$4,$5) AS result',args),dispute);
   await expectDeny(b,'SELECT ms.decide_lead_attribution_dispute($1,$2,$3,$4,$5)',
    [dispute,'rejected','本人材料','自己审批争议',key()],'42501');
   await expectDeny(a,'SELECT ms.decide_lead_attribution_dispute($1,$2,$3,$4,$5)',
    [dispute,'rejected','本人材料','原咨询人不得自批',key()],'42501');
   assert.equal((await own.query('SELECT COUNT(*)::int AS n FROM ms.lead_conversion_readiness_decisions WHERE review_id=$1',
    [review])).rows[0].n,0);
   await zeroLeads(c);
  });
  await t.test('independent manager rejects challenge, only then clears readiness, no lead INSERT',async()=>{
   const args=[dispute,'rejected','虚构主管交叉核实','核实本次异议证据不足',key()];
   assert.equal(await call(m,'SELECT ms.decide_lead_attribution_dispute($1,$2,$3,$4,$5) AS result',args),
    '已驳回争议，原归因待独立预审');
   assert.equal(await call(m,'SELECT ms.decide_lead_attribution_dispute($1,$2,$3,$4,$5) AS result',args),
    '已驳回争议，原归因待独立预审');
   await expectDeny(own,
    "UPDATE ms.lead_attribution_dispute_decisions SET reason_zh='篡改' WHERE dispute_id=$1",
    [dispute],'23514');
   await expectDeny(a,'SELECT ms.decide_lead_conversion_preflight($1,$2,$3,$4,$5)',
    [review,'cleared','自批材料','本人不得自批预审',key()],'42501');
   const approve=[review,'cleared','独立审核材料','无重复线索，跨员工异议已裁决',key()];
   assert.equal(await call(m,'SELECT ms.decide_lead_conversion_preflight($1,$2,$3,$4,$5) AS result',
    approve),'已通过转换预审，但没有创建正式线索');
   assert.equal(await call(m,'SELECT ms.decide_lead_conversion_preflight($1,$2,$3,$4,$5) AS result',
    approve),'已通过转换预审，但没有创建正式线索');
   const row=(await ra.query('SELECT * FROM ms.scoped_conversion_readiness WHERE review_id=$1',
    [review])).rows[0];
   assert.equal(row.effective_status,'转换预审已通过（未创建线索）');
   await zeroLeads(c);
  });
  await t.test('new cross-staff consultation dynamically invalidates old clearance; revocation audit is immutable',async()=>{
   // Simulate a newly received verified event in controlled fictional test fixtures.
   const insert=await own.query(
    'INSERT INTO ms.contact_events(organization_id,contact_id,event_type,occurred_at,recorded_by) VALUES($1,$2,$3,now(),$4) RETURNING id',
    [org,c,'电话咨询',B]);
   assert.ok(insert.rows[0].id);
   const state=(await ra.query('SELECT effective_status FROM ms.scoped_conversion_readiness WHERE review_id=$1',
    [review])).rows[0].effective_status;
   assert.equal(state,'已失效，必须重新审核');
   await expectDeny(a,'SELECT ms.revoke_lead_conversion_clearance($1,$2,$3,$4)',
    [review,'个人意见','原申请人自撤销',key()],'42501');
   const revoke=[review,'事后咨询新增证明','独立主管撤销过时转换许可',key()];
   assert.equal(await call(m,'SELECT ms.revoke_lead_conversion_clearance($1,$2,$3,$4) AS result',revoke),
    '转换预审许可已撤销');
   assert.equal(await call(m,'SELECT ms.revoke_lead_conversion_clearance($1,$2,$3,$4) AS result',revoke),
    '转换预审许可已撤销');
   const decisions=await own.query(
    'SELECT decision FROM ms.lead_conversion_readiness_decisions WHERE review_id=$1 ORDER BY decided_at',
    [review]);
   assert.deepEqual(decisions.rows.map(x=>x.decision).sort(),['cleared','revoked']);
   await expectDeny(own,
    "DELETE FROM ms.lead_conversion_readiness_decisions WHERE review_id=$1",
    [review],'23514');
   await zeroLeads(c);
  });
  await t.test('supported attribution dispute permanently blocks original owner clearance',async()=>{
   const made=await call(a,'SELECT ms.create_scoped_contact($1,$2,$3) AS result',
    ['争议成立联系人-'+randomUUID(),false,key()]);
   const contact=made.contact_id;
   const first=await call(a,'SELECT ms.create_scoped_contact_consultation($1,$2,$3,$4) AS result',
    [contact,'线上咨询',new Date(Date.now()-140000),key()]);
   const cand=await call(a,'SELECT ms.request_consultation_lead_candidate($1,$2,$3,$4) AS result',
    [first.event_id,'事件真实凭据','为咨询提交候选',key()]);
   await call(m,'SELECT ms.decide_consultation_lead_candidate($1,$2,$3,$4,$5) AS result',
    [cand,'reviewed_eligible','审核材料','初步确认候选合格',key()]);
   const pre=await call(a,'SELECT ms.submit_lead_conversion_preflight($1,$2,$3,$4) AS result',
    [cand,'转换预审凭据','正式转线索仍需核实',key()]);
   await custody(a,B,contact);
   const other=await call(b,'SELECT ms.create_scoped_contact_consultation($1,$2,$3,$4) AS result',
    [contact,'微信咨询',new Date(Date.now()-120000),key()]);
   await custody(b,A,contact);
   const d=await call(b,'SELECT ms.submit_lead_attribution_dispute($1,$2,$3,$4,$5) AS result',
    [cand,other.event_id,'跨销售凭据','该咨询应另行核实归因',key()]);
   assert.equal(await call(m,'SELECT ms.decide_lead_attribution_dispute($1,$2,$3,$4,$5) AS result',
    [d,'upheld','独立核实材料','异议成立，停止原归因',key()]),
    '已支持争议，阻止原归因预审');
   await expectDeny(m,'SELECT ms.decide_lead_conversion_preflight($1,$2,$3,$4,$5)',
    [pre,'cleared','反例测试材料','不能绕过获支持的异议',key()],'23514');
   await zeroLeads(contact);
  });
 }finally{await Promise.all([own,a,b,m,ra,rb].map(x=>x.end()));}
});
