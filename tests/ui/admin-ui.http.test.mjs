import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { createApp } from '../../src/app.mjs';

const secret='fictional-test-only-strong-token-secret-9c92789dc3b9';
const passphrase='fictional-strong-ui-demo-passphrase-0001';
const key=()=>randomBytes(20).toString('hex');

test('V3.2-02 served Chinese UI and isolated demo login with authorized business lists',async(t)=>{
  process.env.MS_STAGE='isolated-test';
  assert.ok(process.env.DATABASE_URL,'requires isolated PostgreSQL DATABASE_URL');
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:8});
  const app=createApp(pool,{secret,issuer:'market-sales-test-issuer',devLoginSecret:passphrase});
  await new Promise(ok=>app.listen(0,'127.0.0.1',ok));
  const base='http://127.0.0.1:'+app.address().port;
  const get=async(path,token)=>{
    const r=await fetch(base+path,{headers:token?{Authorization:'Bearer '+token}:{},cache:'no-store'});
    let value=await r.json();return {status:r.status,...value};
  };
  const post=async(path,body,token)=>{
    const r=await fetch(base+path,{method:'POST',headers:{
      'Content-Type':'application/json','Idempotency-Key':key(),...(token?{Authorization:'Bearer '+token}:{})
    },body:JSON.stringify(body)});
    return {status:r.status,...await r.json()};
  };
  try{
    await t.test('server delivers UI assets with restrictive content security policy',async()=>{
      const html=await fetch(base+'/');
      assert.equal(html.status,200);
      assert.ok((html.headers.get('content-security-policy')||'').includes("script-src 'self'"));
      const body=await html.text();
      for(const expected of ['学生客户','家长与联系人','咨询与线索','销售商机','业务变更记录','隔离演示'])
        assert.ok(body.includes(expected),expected);
      const script=await fetch(base+'/app.js');
      assert.equal(script.status,200);
      assert.match(await script.text(),/textContent/);
      assert.equal((await fetch(base+'/styles.css')).status,200);
    });
    const creds={account_code:'sales-a',passphrase};
    await t.test('demo login fails without correct passphrase or known fictional account',async()=>{
      assert.equal((await post('/api/v1/dev/login',{account_code:'sales-a',passphrase:'invalid'})).status,401);
      assert.equal((await post('/api/v1/dev/login',{account_code:'admin',passphrase})).status,401);
      assert.equal((await get('/api/v1/students')).status,401);
    });
    const A=(await post('/api/v1/dev/login',creds)).data;
    const B=(await post('/api/v1/dev/login',{account_code:'sales-b',passphrase})).data;
    const M=(await post('/api/v1/dev/login',{account_code:'supervisor',passphrase})).data;
    const ids={};
    await t.test('named fictional employees receive separate tokens and no cross-student list data',async()=>{
      assert.equal(A.display_name,'模拟销售顾问 A');
      assert.equal(B.display_name,'模拟销售顾问 B');
      assert.equal(M.role_label,'主管');
      assert.notEqual(A.token,B.token);
      const a=await post('/api/v1/students',{display_name:'虚构学生甲'},A.token);
      const b=await post('/api/v1/students',{display_name:'虚构学生乙'},B.token);
      assert.equal(a.status,200);assert.equal(b.status,200);
      ids.a=a.data.student_id;ids.b=b.data.student_id;
      const aList=(await get('/api/v1/students',A.token)).data.items;
      const bList=(await get('/api/v1/students',B.token)).data.items;
      const mList=(await get('/api/v1/students',M.token)).data.items;
      assert.ok(aList.some(x=>x.student_id===ids.a));
      assert.ok(!aList.some(x=>x.student_id===ids.b));
      assert.ok(bList.some(x=>x.student_id===ids.b));
      assert.ok(!bList.some(x=>x.student_id===ids.a));
      assert.ok(mList.some(x=>x.student_id===ids.a)&&mList.some(x=>x.student_id===ids.b));
    });
    await t.test('contact sharing requires authorized action; sales B cannot claim sales A contact',async()=>{
      const r=await post('/api/v1/contacts',{display_name:'虚构共同家长'},A.token);
      assert.equal(r.status,200);ids.contact=r.data.contact_id;
      assert.equal((await get('/api/v1/contacts',B.token)).data.items.some(x=>x.contact_id===ids.contact),false);
      const blocked=await post('/api/v1/students/'+ids.b+'/contacts',{
        contact_id:ids.contact,relation_type:'母亲'},B.token);
      assert.equal(blocked.status,403);
      const manager=await post('/api/v1/students/'+ids.b+'/contacts',{
        contact_id:ids.contact,relation_type:'母亲'},M.token);
      assert.equal(manager.status,200);
      assert.ok((await get('/api/v1/contacts',B.token)).data.items.some(x=>x.contact_id===ids.contact));
      assert.equal((await get('/api/v1/family-groups',B.token)).status,403);
    });
    await t.test('real consultation has one creator, optional notes are scoped and lead enrichment never leaks shared-parent siblings',async()=>{
      const tooLong='x'.repeat(1001);
      const bad=await post('/api/v1/contact-events',{
        contact_id:ids.contact,event_type:'电话咨询',occurred_at:'2026-11-13T13:00:00Z',
        original_source_text:tooLong
      },A.token);
      assert.equal(bad.status,422);
      const e=await post('/api/v1/contact-events',{
        contact_id:ids.contact,event_type:'电话咨询',occurred_at:'2026-11-13T13:00:00Z',
        original_source_text:'  关注周末英语班，希望周六试听  '
      },A.token);
      assert.equal(e.status,200);ids.event=e.data.event_id;
      assert.equal(e.data.original_source_text,'关注周末英语班，希望周六试听');
      const aEvents=(await get('/api/v1/contact-events',A.token)).data.items;
      const storedEvent=aEvents.find(x=>x.event_id===ids.event);
      assert.ok(storedEvent);
      assert.equal(storedEvent.original_source_text,'关注周末英语班，希望周六试听');
      assert.equal((await get('/api/v1/contact-events',B.token)).data.items.some(x=>x.event_id===ids.event),false);
      const linkA=await post('/api/v1/students/'+ids.a+'/contacts',{
        contact_id:ids.contact,relation_type:'母亲'},A.token);
      assert.equal(linkA.status,200);
      const theft=await post('/api/v1/leads',{source_event_ref:ids.event},B.token);
      assert.equal(theft.status,403);
      const lead=await post('/api/v1/leads',{source_event_ref:ids.event},A.token);
      assert.equal(lead.status,200);
      const duplicate=await post('/api/v1/leads',{source_event_ref:ids.event},A.token);
      assert.equal(duplicate.status,409,'A real consultation must not create duplicate leads');
      const aLeadBefore=(await get('/api/v1/leads',A.token)).data.items.find(x=>x.lead_id===lead.data.lead_id);
      assert.ok(aLeadBefore);
      assert.equal(aLeadBefore.source_notes,'关注周末英语班，希望周六试听');
      assert.equal(aLeadBefore.source_event_type,'电话咨询');
      assert.deepEqual(aLeadBefore.linked_students,[]);
      assert.deepEqual(aLeadBefore.contact_linked_students.map(s=>s.student_id),[ids.a]);
      assert.equal(aLeadBefore.contact_linked_students.some(s=>s.student_id===ids.b),false);
      const linked=await post('/api/v1/leads/'+lead.data.lead_id+'/students',{
        student_ids:[ids.a],evidence_ref:'家长口头确认',confirmation_state:'pending_review'
      },A.token);
      assert.equal(linked.status,200);
      const aLeadAfter=(await get('/api/v1/leads',A.token)).data.items.find(x=>x.lead_id===lead.data.lead_id);
      assert.equal(aLeadAfter.linked_students.length,1);
      assert.equal(aLeadAfter.linked_students[0].student_id,ids.a);
      assert.equal(aLeadAfter.linked_students[0].confirmation_state,'pending_review');
      assert.ok(!(await get('/api/v1/leads',B.token)).data.items.some(x=>x.lead_id===lead.data.lead_id));
    });
    await t.test('opportunities are scoped to each student, not the shared parent',async()=>{
      const op=await post('/api/v1/opportunities',{student_id:ids.a,predicted_amount_cents:600000},A.token);
      assert.equal(op.status,200);
      assert.ok((await get('/api/v1/opportunities',A.token)).data.items.some(x=>x.opportunity_id===op.data.opportunity_id));
      assert.ok(!(await get('/api/v1/opportunities',B.token)).data.items.some(x=>x.opportunity_id===op.data.opportunity_id));
    });
    await t.test('family review stays pending and audit uses human-readable staff name',async()=>{
      const family=await post('/api/v1/family-groups',{
        display_name:'虚构家庭甲乙',student_ids:[ids.a,ids.b],verification_evidence_ref:'仅供测试的待审核说明'
      },M.token);
      assert.equal(family.status,200);
      assert.equal(family.data.verification_state,'pending');
      const l=await get('/api/v1/family-groups',M.token);
      assert.ok(l.data.items.some(x=>x.family_group_id===family.data.family_group_id&&x.student_count===2));
      const aud=await get('/api/v1/audit?object_type=student&object_id='+ids.a,A.token);
      assert.equal(aud.status,200);
      const text=JSON.stringify(aud.data.items);
      assert.ok(text.includes('模拟销售顾问 A'));
      assert.ok(!text.includes('"before_business_json"'));
    });
    await t.test('payment and CRM business endpoints remain forbidden by absence',async()=>{
      assert.equal((await post('/api/v1/orders',{amount_due_cents:10000},M.token)).status,404);
      assert.equal((await post('/integration/v1/entitlements',{external_order_item_id:'fake'},M.token)).status,404);
    });
  } finally {
    await new Promise(ok=>app.close(ok));await pool.end();
  }
});
