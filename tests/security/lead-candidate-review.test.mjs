import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import pg from 'pg';

const org='20000000-0000-4000-8000-000000000001';
const A='20000000-0000-4000-8000-000000000011';
const B='20000000-0000-4000-8000-000000000012';
const key=()=>randomBytes(20).toString('hex');
const open=name=>new pg.Pool({connectionString:process.env[name],max:2});
const get=async(pool,sql,args)=>(await pool.query(sql,args)).rows[0]?.result;

test('V3.2-17 low-permission consultation-to-lead candidate review never creates leads',async t=>{
 const admin=open('DATABASE_URL'),a=open('DATABASE_URL_WRITE_A'),
   b=open('DATABASE_URL_WRITE_B'),m=open('DATABASE_URL_WRITE_MANAGER'),
   ar=open('DATABASE_URL_ASSIGNEE_A'),br=open('DATABASE_URL_ASSIGNEE_B');
 try{
  for(const p of [a,b,m,ar,br]){
   await t.test('employee principal cannot read candidate evidence, leads or finance',async()=>{
    for(const table of ['ms.consultation_lead_candidates',
      'ms.consultation_lead_candidate_decisions','ms.leads','ms.sales_orders']){
     await assert.rejects(p.query('SELECT * FROM '+table),e=>e.code==='42501',table);
    }
   });
  }
  const contact=await get(a,'SELECT ms.create_scoped_contact($1,$2,$3) AS result',
    ['候选测试联系人-'+randomUUID(),false,key()]);
  const event=await get(a,'SELECT ms.create_scoped_contact_consultation($1,$2,$3,$4) AS result',
    [contact.contact_id,'电话咨询',new Date(Date.now()-90000),key()]);
  let id;
  await t.test('A alone can request actual own consultation, replay is safe',async()=>{
    const args=[event.event_id,'虚构核实材料','根据实际咨询申请候选',key()];
    assert.equal((await ar.query('SELECT * FROM ms.scoped_consultations_for_candidates WHERE event_id=$1',
      [event.event_id])).rowCount,1);
    assert.equal((await br.query('SELECT * FROM ms.scoped_consultations_for_candidates WHERE event_id=$1',
      [event.event_id])).rowCount,0);
    await assert.rejects(b.query(
      'SELECT ms.request_consultation_lead_candidate($1,$2,$3,$4)',args),
      e=>e.code==='42501');
    id=await get(a,'SELECT ms.request_consultation_lead_candidate($1,$2,$3,$4) AS result',args);
    assert.equal(await get(a,'SELECT ms.request_consultation_lead_candidate($1,$2,$3,$4) AS result',args),id);
    assert.equal((await ar.query('SELECT * FROM ms.scoped_consultations_for_candidates WHERE event_id=$1',
      [event.event_id])).rowCount,0);
    assert.equal((await br.query('SELECT * FROM ms.scoped_consultation_lead_candidates WHERE candidate_id=$1',
      [id])).rowCount,0);
    assert.equal((await admin.query('SELECT COUNT(*)::int AS n FROM ms.leads WHERE source_event_id=$1',
      [event.event_id])).rows[0].n,0);
    await assert.rejects(a.query(
      'SELECT ms.request_consultation_lead_candidate($1,$2,$3,$4)',
      [event.event_id,'另一证据','不同业务申请',key()]),e=>e.code==='23505');
  });
  await t.test('self, recipient and nonmanager are forbidden to approve',async()=>{
    const args=[id,'reviewed_eligible','主管独立证据','确认咨询来源和去重',key()];
    await assert.rejects(a.query(
      'SELECT ms.decide_consultation_lead_candidate($1,$2,$3,$4,$5)',args),
      e=>e.code==='42501');
    await assert.rejects(b.query(
      'SELECT ms.decide_consultation_lead_candidate($1,$2,$3,$4,$5)',args),
      e=>e.code==='42501');
    assert.equal(await get(m,'SELECT ms.decide_consultation_lead_candidate($1,$2,$3,$4,$5) AS result',args),
      '已审核符合候选条件，未创建正式线索');
    assert.equal(await get(m,'SELECT ms.decide_consultation_lead_candidate($1,$2,$3,$4,$5) AS result',args),
      '已审核符合候选条件，未创建正式线索');
    const result=(await admin.query('SELECT status,requested_by,reviewed_by FROM ms.consultation_lead_candidates WHERE id=$1',[id])).rows[0];
    assert.equal(result.status,'reviewed_eligible');assert.equal(result.requested_by,A);
    assert.equal((await admin.query('SELECT COUNT(*)::int AS n FROM ms.leads WHERE contact_id=$1',
      [contact.contact_id])).rows[0].n,0);
    await assert.rejects(admin.query(
      "UPDATE ms.consultation_lead_candidate_decisions SET reason_zh='篡改' WHERE candidate_id=$1",
      [id]),e=>e.code==='23514');
  });
  await t.test('refusal to contact blocks both submission and later approval',async()=>{
    const c=await get(a,'SELECT ms.create_scoped_contact($1,$2,$3) AS result',
      ['拒绝联系客户-'+randomUUID(),true,key()]);
    const ev=await get(a,'SELECT ms.create_scoped_contact_consultation($1,$2,$3,$4) AS result',
      [c.contact_id,'线上咨询',new Date(Date.now()-120000),key()]);
    await assert.rejects(a.query('SELECT ms.request_consultation_lead_candidate($1,$2,$3,$4)',
      [ev.event_id,'测试材料','申请候选复核',key()]),e=>e.code==='23514');
    const c2=await get(a,'SELECT ms.create_scoped_contact($1,$2,$3) AS result',
      ['申请后拒联客户-'+randomUUID(),false,key()]);
    const e2=await get(a,'SELECT ms.create_scoped_contact_consultation($1,$2,$3,$4) AS result',
      [c2.contact_id,'线上咨询',new Date(Date.now()-150000),key()]);
    const r2=await get(a,'SELECT ms.request_consultation_lead_candidate($1,$2,$3,$4) AS result',
      [e2.event_id,'提交咨询依据','独立核实线索候选',key()]);
    await admin.query('UPDATE ms.contacts SET do_not_contact=true WHERE id=$1',[c2.contact_id]);
    await assert.rejects(m.query('SELECT ms.decide_consultation_lead_candidate($1,$2,$3,$4,$5)',
      [r2,'reviewed_eligible','核实材料','不能允许拒联客户',key()]),e=>e.code==='23514');
    assert.equal((await admin.query('SELECT status FROM ms.consultation_lead_candidates WHERE id=$1',[r2])).rows[0].status,'pending');
    assert.equal(await get(m,'SELECT ms.decide_consultation_lead_candidate($1,$2,$3,$4,$5) AS result',
      [r2,'rejected','拒绝联系证明','不能再主动联系',key()]),'已驳回候选');
  });
  await t.test('existing lead blocks another consultation from same contact',async()=>{
    const c=await get(a,'SELECT ms.create_scoped_contact($1,$2,$3) AS result',
      ['已有正式线索客户-'+randomUUID(),false,key()]);
    const ev=await get(a,'SELECT ms.create_scoped_contact_consultation($1,$2,$3,$4) AS result',
      [c.contact_id,'电话咨询',new Date(Date.now()-200000),key()]);
    await admin.query("INSERT INTO ms.leads(organization_id,contact_id,source_event_id,owner_user_id,lead_state) VALUES($1,$2,$3,$4,'unidentified')",
      [org,c.contact_id,ev.event_id,A]);
    const another=await get(a,'SELECT ms.create_scoped_contact_consultation($1,$2,$3,$4) AS result',
      [c.contact_id,'微信咨询',new Date(Date.now()-160000),key()]);
    await assert.rejects(a.query('SELECT ms.request_consultation_lead_candidate($1,$2,$3,$4)',
      [another.event_id,'查重咨询证据','申请再次候选',key()]),e=>e.code==='23505');
  });
  await t.test('custody transfer after application invalidates approval, does not transfer history',async()=>{
    const c=await get(a,'SELECT ms.create_scoped_contact($1,$2,$3) AS result',
      ['管理权变更客户-'+randomUUID(),false,key()]);
    const ev=await get(a,'SELECT ms.create_scoped_contact_consultation($1,$2,$3,$4) AS result',
      [c.contact_id,'到店咨询',new Date(Date.now()-70000),key()]);
    const candidate=await get(a,'SELECT ms.request_consultation_lead_candidate($1,$2,$3,$4) AS result',
      [ev.event_id,'原咨询留痕','申请待核实候选',key()]);
    const transfer=await get(a,'SELECT ms.request_scoped_contact_custody($1,$2,$3,$4,$5) AS result',
      [c.contact_id,B,'虚构交接证据','独立确认交接',key()]);
    await get(m,'SELECT ms.decide_scoped_contact_custody($1,$2,$3,$4,$5) AS result',
      [transfer,'approved','虚构批准依据','允许交接联系权',key()]);
    await assert.rejects(m.query('SELECT ms.decide_consultation_lead_candidate($1,$2,$3,$4,$5)',
      [candidate,'reviewed_eligible','独立复核依据','尝试无权旧归因',key()]),
      e=>e.code==='23514');
    assert.equal((await admin.query('SELECT recorded_by FROM ms.contact_events WHERE id=$1',
      [ev.event_id])).rows[0].recorded_by,A);
    assert.equal((await admin.query('SELECT COUNT(*)::int AS n FROM ms.leads WHERE contact_id=$1',
      [c.contact_id])).rows[0].n,0);
  });
 }finally{await Promise.all([admin,a,b,m,ar,br].map(x=>x.end()));}
});
