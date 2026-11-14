import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import pg from 'pg';
const ORG='20000000-0000-4000-8000-000000000001';
const A='20000000-0000-4000-8000-000000000011';
const B='20000000-0000-4000-8000-000000000012';
const k=()=>randomBytes(20).toString('hex');
const pool=(name,max=3)=>new pg.Pool({connectionString:process.env[name],max});
const fn=async(p,sql,args)=>(await p.query(sql,args)).rows[0].result;
const deny=(p,sql,args,code)=>assert.rejects(p.query(sql,args),e=>e.code===code,sql);

test('V3.2-19 approved, atomic and truly scoped LEAD creation',async t=>{
 const root=pool('DATABASE_URL',4),a=pool('DATABASE_URL_WRITE_A',4),
   b=pool('DATABASE_URL_WRITE_B'),m=pool('DATABASE_URL_WRITE_MANAGER'),
   ra=pool('DATABASE_URL_ASSIGNEE_A'),rb=pool('DATABASE_URL_ASSIGNEE_B');
 const counts=async(contact)=>({
   leads:Number((await root.query('SELECT COUNT(*) AS n FROM ms.leads WHERE contact_id=$1',[contact])).rows[0].n),
   executions:Number((await root.query('SELECT COUNT(*) AS n FROM ms.lead_conversion_executions WHERE contact_id=$1',[contact])).rows[0].n)
 });
 async function approvedPreflight(prefix='测试正式转换'){
   const contact=(await fn(a,'SELECT ms.create_scoped_contact($1,$2,$3) AS result',
      [prefix+'-'+randomUUID(),false,k()])).contact_id;
   const event=(await fn(a,'SELECT ms.create_scoped_contact_consultation($1,$2,$3,$4) AS result',
      [contact,'线上咨询',new Date(Date.now()-90000),k()])).event_id;
   const candidate=await fn(a,
     'SELECT ms.request_consultation_lead_candidate($1,$2,$3,$4) AS result',
     [event,'虚构实际咨询证明','候选来源需核查',k()]);
   assert.equal(await fn(m,
     'SELECT ms.decide_consultation_lead_candidate($1,$2,$3,$4,$5) AS result',
     [candidate,'reviewed_eligible','独立候选凭据','确认候选基本条件',k()]),
     '已审核符合候选条件，未创建正式线索');
   const readiness=await fn(a,
     'SELECT ms.submit_lead_conversion_preflight($1,$2,$3,$4) AS result',
     [candidate,'虚构预审核实材料','申请独立转换预审',k()]);
   assert.equal(await fn(m,
     'SELECT ms.decide_lead_conversion_preflight($1,$2,$3,$4,$5) AS result',
     [readiness,'cleared','独立主管预审记录','已核查同联系人归因',k()]),
     '已通过转换预审，但没有创建正式线索');
   return {contact,event,candidate,readiness};
 }
 async function finalApproved(row){
   const args=[row.readiness,'最终申请材料','原申请人申请正式转换',k()];
   const authorization=await fn(a,
     'SELECT ms.request_final_lead_conversion($1,$2,$3,$4) AS result',args);
   assert.equal(await fn(a,
     'SELECT ms.request_final_lead_conversion($1,$2,$3,$4) AS result',args),
     authorization);
   assert.equal(await fn(m,
     'SELECT ms.decide_final_lead_conversion($1,$2,$3,$4,$5) AS result',
     [authorization,'approved','最终独立核验','批准本人最后确认转换',k()]),
     '已批准最终转换，尚未生成正式线索');
   return authorization;
 }
 try{
  await t.test('actual employee LOGIN accounts have NO table DML and cannot bypass final approval',async()=>{
   for(const p of [a,b,m,ra,rb]){
    for(const table of ['ms.leads','ms.lead_conversion_authorizations',
      'ms.lead_conversion_authorization_decisions','ms.lead_conversion_executions',
      'ms.sales_orders','ms.audit_events']){
      await deny(p,'SELECT * FROM '+table,[],'42501');
    }
    await deny(p,"INSERT INTO ms.leads(organization_id,contact_id,owner_user_id) VALUES($1,$2,$3)",
      [ORG,randomUUID(),A],'42501');
   }
  });
  let base,auth;
  await t.test('final request requires approved prior review; B cannot act, applicant cannot self-approve',async()=>{
    base=await approvedPreflight();
    await deny(b,'SELECT ms.request_final_lead_conversion($1,$2,$3,$4)',
      [base.readiness,'他人材料','试图代他人提交',k()],'42501');
    auth=await fn(a,'SELECT ms.request_final_lead_conversion($1,$2,$3,$4) AS result',
      [base.readiness,'虚构最终申请凭据','请独立主管最终核验',k()]);
    assert.equal((await ra.query(
      'SELECT * FROM ms.scoped_final_lead_conversion_requests WHERE authorization_id=$1',
      [auth])).rowCount,1);
    assert.equal((await rb.query(
      'SELECT * FROM ms.scoped_final_lead_conversion_requests WHERE authorization_id=$1',
      [auth])).rowCount,0);
    await deny(a,'SELECT ms.decide_final_lead_conversion($1,$2,$3,$4,$5)',
      [auth,'approved','本人材料','自己批准自己转换',k()],'42501');
    await deny(b,'SELECT ms.decide_final_lead_conversion($1,$2,$3,$4,$5)',
      [auth,'approved','他人材料','非主管越权批准',k()],'42501');
    await deny(a,'SELECT ms.execute_final_lead_conversion($1,$2)',
      [auth,k()],'23514');
    const args=[auth,'approved','虚构主管独立材料','主管已核验最终转换',k()];
    assert.equal(await fn(m,'SELECT ms.decide_final_lead_conversion($1,$2,$3,$4,$5) AS result',args),
      '已批准最终转换，尚未生成正式线索');
    assert.equal(await fn(m,'SELECT ms.decide_final_lead_conversion($1,$2,$3,$4,$5) AS result',args),
      '已批准最终转换，尚未生成正式线索');
    assert.deepEqual(await counts(base.contact),{leads:0,executions:0});
    await deny(b,'SELECT ms.execute_final_lead_conversion($1,$2)',
      [auth,k()],'42501');
    await deny(m,'SELECT ms.execute_final_lead_conversion($1,$2)',
      [auth,k()],'42501');
  });
  await t.test('rollback of real lead INSERT also rolls back execution and audit',async()=>{
    const conn=await a.connect();
    let rolledBackLeadId=null;
    try{
      await conn.query('BEGIN');
      const r=await conn.query('SELECT ms.execute_final_lead_conversion($1,$2) AS result',
        [auth,k()]);
      rolledBackLeadId=r.rows[0].result.lead_id;
      assert.ok(rolledBackLeadId);
      await conn.query('ROLLBACK');
    }finally{conn.release();}
    assert.deepEqual(await counts(base.contact),{leads:0,executions:0});
    assert.equal((await root.query(
      'SELECT status FROM ms.lead_conversion_authorizations WHERE id=$1',[auth])).rows[0].status,
      'approved');
    assert.equal((await root.query(
      "SELECT COUNT(*)::int AS n FROM ms.audit_events WHERE event_name='LEAD_FINAL_CONVERSION_EXECUTED' AND target_id=$1",
      [rolledBackLeadId])).rows[0].n,0);
  });
  await t.test('applicant executes one actual lead, exact replay safe and immutable ledger',async()=>{
    const key=k();
    const one=await fn(a,'SELECT ms.execute_final_lead_conversion($1,$2) AS result',[auth,key]);
    assert.ok(one.lead_id);
    assert.equal(one.status,'已创建正式销售线索');
    assert.deepEqual(await fn(a,'SELECT ms.execute_final_lead_conversion($1,$2) AS result',
      [auth,key]),one);
    await deny(a,'SELECT ms.execute_final_lead_conversion($1,$2)',
      [auth,k()],'23514');
    assert.deepEqual(await counts(base.contact),{leads:1,executions:1});
    const row=(await root.query(
      'SELECT contact_id,source_event_id,owner_user_id,lead_state FROM ms.leads WHERE id=$1',
      [one.lead_id])).rows[0];
    assert.equal(row.contact_id,base.contact);
    assert.equal(row.source_event_id,base.event);
    assert.equal(row.owner_user_id,A);
    assert.equal(row.lead_state,'unidentified');
    assert.equal((await root.query('SELECT COUNT(*)::int AS n FROM ms.lead_students WHERE lead_id=$1',
      [one.lead_id])).rows[0].n,0);
    assert.equal((await root.query('SELECT COUNT(*)::int AS n FROM ms.opportunities WHERE originating_lead_id=$1',
      [one.lead_id])).rows[0].n,0);
    assert.equal((await root.query(
      "SELECT COUNT(*)::int AS n FROM ms.audit_events WHERE target_type='lead' AND target_id=$1 AND event_name='LEAD_FINAL_CONVERSION_EXECUTED'",
      [one.lead_id])).rows[0].n,1);
    await deny(root,'DELETE FROM ms.lead_conversion_executions WHERE lead_id=$1',
      [one.lead_id],'23514');
    await deny(root,
      "UPDATE ms.lead_conversion_authorization_decisions SET reason_zh='篡改' WHERE authorization_id=$1",
      [auth],'23514');
    await deny(m,'SELECT ms.revoke_lead_conversion_clearance($1,$2,$3,$4)',
      [base.readiness,'事后撤销凭据','不可把预审撤销当线索回滚',k()],'23514');
  });
  await t.test('two simultaneous executes with different keys serialize to exactly one lead',async()=>{
    const row=await approvedPreflight('并发执行联系人');
    const approval=await finalApproved(row);
    const results=await Promise.allSettled([
      fn(a,'SELECT ms.execute_final_lead_conversion($1,$2) AS result',[approval,k()]),
      fn(a,'SELECT ms.execute_final_lead_conversion($1,$2) AS result',[approval,k()])
    ]);
    assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
    assert.equal(results.filter(x=>x.status==='rejected').length,1);
    assert.deepEqual(await counts(row.contact),{leads:1,executions:1});
  });
  await t.test('stale final authorization: revoked preflight, opt-out and duplicate lead block execution',async()=>{
    const revoked=await approvedPreflight('预审撤销客户');
    const revokeAuth=await finalApproved(revoked);
    assert.equal(await fn(m,'SELECT ms.revoke_lead_conversion_clearance($1,$2,$3,$4) AS result',
      [revoked.readiness,'主管撤销凭证','尚未生成线索的预审已撤销',k()]),
      '转换预审许可已撤销');
    await deny(a,'SELECT ms.execute_final_lead_conversion($1,$2)',
      [revokeAuth,k()],'23514');
    assert.deepEqual(await counts(revoked.contact),{leads:0,executions:0});
    const optout=await approvedPreflight('拒绝联系客户');
    const optAuth=await finalApproved(optout);
    await root.query('UPDATE ms.contacts SET do_not_contact=true WHERE id=$1',[optout.contact]);
    await deny(a,'SELECT ms.execute_final_lead_conversion($1,$2)',
      [optAuth,k()],'23514');
    assert.deepEqual(await counts(optout.contact),{leads:0,executions:0});
    const duplicate=await approvedPreflight('后插入重复线索');
    const dupAuth=await finalApproved(duplicate);
    await root.query(
      "INSERT INTO ms.leads(organization_id,contact_id,source_event_id,owner_user_id,lead_state) VALUES($1,$2,$3,$4,'unidentified')",
      [ORG,duplicate.contact,duplicate.event,A]);
    await deny(a,'SELECT ms.execute_final_lead_conversion($1,$2)',
      [dupAuth,k()],'23505');
    assert.deepEqual(await counts(duplicate.contact),{leads:1,executions:0});
  });
  await t.test('new cross-staff event and custody transfer block previously approved final conversion',async()=>{
    const contested=await approvedPreflight('新异议联系人');
    const contestedAuth=await finalApproved(contested);
    await root.query(
      'INSERT INTO ms.contact_events(organization_id,contact_id,event_type,occurred_at,recorded_by) VALUES($1,$2,$3,now(),$4)',
      [ORG,contested.contact,'电话咨询',B]);
    await deny(a,'SELECT ms.execute_final_lead_conversion($1,$2)',
      [contestedAuth,k()],'23514');
    assert.deepEqual(await counts(contested.contact),{leads:0,executions:0});
    const transferred=await approvedPreflight('负责人转移客户');
    const transferredAuth=await finalApproved(transferred);
    const custody=await fn(a,'SELECT ms.request_scoped_contact_custody($1,$2,$3,$4,$5) AS result',
      [transferred.contact,B,'虚构交接记录','转交联系管理权',k()]);
    assert.equal(await fn(m,'SELECT ms.decide_scoped_contact_custody($1,$2,$3,$4,$5) AS result',
      [custody,'approved','独立批准凭据','允许管理权交接',k()]),'已批准');
    await deny(a,'SELECT ms.execute_final_lead_conversion($1,$2)',
      [transferredAuth,k()],'23514');
    assert.deepEqual(await counts(transferred.contact),{leads:0,executions:0});
  });
  await t.test('rejected authorization cannot be executed and original consultation is untouched',async()=>{
    const denied=await approvedPreflight('主管最终驳回客户');
    const authorization=await fn(a,
      'SELECT ms.request_final_lead_conversion($1,$2,$3,$4) AS result',
      [denied.readiness,'虚构最终申请凭证','最终转换请求',k()]);
    assert.equal(await fn(m,
      'SELECT ms.decide_final_lead_conversion($1,$2,$3,$4,$5) AS result',
      [authorization,'rejected','独立驳回材料','已核实不符合当前转换策略',k()]),
      '已拒绝最终转换');
    await deny(a,'SELECT ms.execute_final_lead_conversion($1,$2)',
      [authorization,k()],'23514');
    assert.equal((await root.query('SELECT recorded_by FROM ms.contact_events WHERE id=$1',
      [denied.event])).rows[0].recorded_by,A);
    assert.deepEqual(await counts(denied.contact),{leads:0,executions:0});
  });
 }finally{await Promise.all([root,a,b,m,ra,rb].map(p=>p.end()));}
});
