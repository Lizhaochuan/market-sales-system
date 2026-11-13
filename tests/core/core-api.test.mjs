import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac,randomUUID,randomBytes } from 'node:crypto';
import pg from 'pg';
import { createApp } from '../../src/app.mjs';

const secret='fictional-test-only-strong-token-secret-9c92789dc3b9';
const issuer='market-sales-test-issuer';
const makeToken=(sub,org,overrides={})=>{
  const header=Buffer.from(JSON.stringify({typ:'JWT',alg:'HS256'})).toString('base64url');
  const now=Math.floor(Date.now()/1000);
  const payload=Buffer.from(JSON.stringify({
    iss:issuer,aud:'market-sales-isolated',sub,org_id:org,iat:now,exp:now+1200,...overrides
  })).toString('base64url');
  const sig=createHmac('sha256',secret).update(header+'.'+payload).digest('base64url');
  return header+'.'+payload+'.'+sig;
};
const key=()=>randomBytes(18).toString('hex');

test('V3.2-01 real PostgreSQL HTTP student-first flows and permission guards',async(t)=>{
  process.env.MS_STAGE='isolated-test';
  assert.ok(process.env.DATABASE_URL,'isolated DATABASE_URL is required');
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:12});
  const org=randomUUID(),otherOrg=randomUUID(),a=randomUUID(),b=randomUUID(),manager=randomUUID();
  let server;
  try{
    await pool.query('INSERT INTO ms.organizations(id,name) VALUES($1,$2),($3,$4)',
      [org,'模拟教培机构',otherOrg,'其他模拟机构']);
    await pool.query('INSERT INTO ms.staff_users(id,organization_id,display_name) VALUES($1,$2,$3),($4,$2,$5),($6,$2,$7)',
      [a,org,'虚构销售A',b,'虚构销售B',manager,'虚构主管']);
    const role=await pool.query(
      'INSERT INTO ms.role_templates(organization_id,role_code,label_zh) VALUES($1,$2,$3) RETURNING id',
      [org,'sales_manager','模拟销售主管']);
    await pool.query('INSERT INTO ms.user_role_grants(user_id,role_id,granted_by) VALUES($1,$2,$1)',
      [manager,role.rows[0].id]);
    server=createApp(pool,{secret,issuer});
    await new Promise((ok,bad)=>server.listen(0,'127.0.0.1',e=>e?bad(e):ok()));
    const base='http://127.0.0.1:'+server.address().port;
    const tokenA=makeToken(a,org),tokenB=makeToken(b,org),tokenM=makeToken(manager,org);
    const send=async(method,path,token,payload,idem)=>{
      const res=await fetch(base+path,{method,headers:{
        ...(token?{Authorization:'Bearer '+token}:{}),
        ...(payload?{'Content-Type':'application/json','Idempotency-Key':idem||key()}: {})
      },...(payload?{body:JSON.stringify(payload)}:{})});
      let json;try{json=await res.json();}catch{json={};}
      return {status:res.status,...json};
    };
    const post=(path,token,body,k)=>send('POST',path,token,body,k);
    const get=(path,token)=>send('GET',path,token);

    await t.test('health available only on loopback; all business routes authenticated',async()=>{
      const h=await get('/api/v1/health',null);
      assert.equal(h.status,200);
      assert.equal(h.data.stage,'isolated-test');
      const u=await get('/api/v1/students/'+randomUUID(),null);
      assert.equal(u.status,401);
      const forged=await get('/api/v1/students/'+randomUUID(),makeToken(a,otherOrg));
      assert.equal(forged.status,403);
      const bad=await post('/api/v1/students',tokenA,{display_name:'不应成功',phone:'13300000000'});
      assert.equal(bad.status,422);
    });

    const saved={};
    await t.test('students are independent; duplicate write does not create duplicate student or audit',async()=>{
      const sameKey=key();
      const s=await post('/api/v1/students',tokenA,{display_name:'模拟哥哥'},sameKey);
      assert.equal(s.status,200);
      saved.studentA=s.data.student_id;
      const replay=await post('/api/v1/students',tokenA,{display_name:'模拟哥哥'},sameKey);
      assert.equal(replay.status,200);
      assert.equal(replay.data.student_id,s.data.student_id);
      const altered=await post('/api/v1/students',tokenA,{display_name:'不同学生'},sameKey);
      assert.equal(altered.status,409);
      assert.equal(altered.code,'IDEMPOTENCY_CONFLICT');
      const s2=await post('/api/v1/students',tokenB,{display_name:'模拟妹妹'});
      assert.equal(s2.status,200);
      saved.studentB=s2.data.student_id;
      assert.notEqual(saved.studentA,saved.studentB);
      const families=await pool.query('SELECT count(*)::int n FROM ms.family_groups WHERE organization_id=$1',[org]);
      assert.equal(families.rows[0].n,0);
      const people=await pool.query("SELECT count(*)::int n FROM ms.students WHERE organization_id=$1",[org]);
      assert.equal(people.rows[0].n,2);
    });

    await t.test('sales people cannot see each others students or assign other owners',async()=>{
      assert.equal((await get('/api/v1/students/'+saved.studentA,tokenA)).status,200);
      assert.equal((await get('/api/v1/students/'+saved.studentA,tokenB)).status,403);
      assert.equal((await get('/api/v1/students/'+saved.studentB,tokenA)).status,403);
      assert.equal((await get('/api/v1/students/'+saved.studentB,tokenM)).status,200);
      const reassign=await post('/api/v1/students',tokenA,{display_name:'无权指派',owner_user_id:b});
      assert.equal(reassign.status,403);
    });

    await t.test('one shared contact links two distinct students but no verified family',async()=>{
      const rejectedPhone=await post('/api/v1/contacts',tokenA,
        {display_name:'不能采集明文手机号',phone:'13300000000'});
      assert.equal(rejectedPhone.status,422);
      const c=await post('/api/v1/contacts',tokenA,{display_name:'模拟家长'});
      assert.equal(c.status,200);
      saved.contact=c.data.contact_id;
      const unauthorizedEvent=await post('/api/v1/contact-events',tokenB,{
        contact_id:saved.contact,event_type:'冒领他人咨询',occurred_at:'2026-11-13T11:00:00Z'
      });
      assert.equal(unauthorizedEvent.status,403);
      const first=await post('/api/v1/students/'+saved.studentA+'/contacts',tokenA,
        {contact_id:saved.contact,relation_type:'父亲'});
      const blocked=await post('/api/v1/students/'+saved.studentB+'/contacts',tokenB,
        {contact_id:saved.contact,relation_type:'父亲'});
      assert.equal(blocked.status,403,'Another salesperson cannot claim a contact without permission');
      const second=await post('/api/v1/students/'+saved.studentB+'/contacts',tokenM,
        {contact_id:saved.contact,relation_type:'父亲'});
      assert.equal(first.status,200);assert.equal(second.status,200);
      const duplicate=await post('/api/v1/students/'+saved.studentA+'/contacts',tokenA,
        {contact_id:saved.contact,relation_type:'父亲'});
      assert.equal(duplicate.status,409);
      const join=await pool.query('SELECT count(*)::int n FROM ms.student_contacts WHERE contact_id=$1',[saved.contact]);
      assert.equal(join.rows[0].n,2);
      const fam=await pool.query('SELECT count(*)::int n FROM ms.family_groups WHERE organization_id=$1',[org]);
      assert.equal(fam.rows[0].n,0);
    });

    await t.test('unknown-child inquiry stays lead without creating a fake student',async()=>{
      const event=await post('/api/v1/contact-events',tokenA,{
        contact_id:saved.contact,event_type:'电话咨询',occurred_at:'2026-11-13T12:00:00Z'
      });
      assert.equal(event.status,200);
      saved.event=event.data.event_id;
      const lead=await post('/api/v1/leads',tokenA,{source_event_ref:saved.event,contact_id:saved.contact});
      assert.equal(lead.status,200);
      assert.equal(lead.data.lead_state,'unidentified');
      assert.deepEqual(lead.data.student_ids,[]);
      saved.lead=lead.data.lead_id;
      assert.equal((await get('/api/v1/leads/'+saved.lead,tokenB)).status,403);
      assert.equal((await get('/api/v1/leads/'+saved.lead,tokenA)).data.student_ids.length,0);
      const people=await pool.query('SELECT count(*)::int n FROM ms.students WHERE organization_id=$1',[org]);
      assert.equal(people.rows[0].n,2);
      const unauthorizedLink=await post('/api/v1/leads/'+saved.lead+'/students',tokenA,
        {student_ids:[saved.studentA,saved.studentB],evidence_ref:'模拟电话记录'});
      assert.equal(unauthorizedLink.status,403);
    });

    await t.test('manager may link one inquiry to two students; one interaction remains one',async()=>{
      const e=await post('/api/v1/contact-events',tokenM,{
        contact_id:saved.contact,event_type:'报名咨询',occurred_at:'2026-11-13T13:00:00Z'
      });
      assert.equal(e.status,200);
      const l=await post('/api/v1/leads',tokenM,{source_event_ref:e.data.event_id,contact_id:saved.contact});
      assert.equal(l.status,200);
      const mapped=await post('/api/v1/leads/'+l.data.lead_id+'/students',tokenM,{
        student_ids:[saved.studentA,saved.studentB],evidence_ref:'模拟确认依据',confirmation_state:'pending_review'
      });
      assert.equal(mapped.status,200);
      assert.equal(mapped.data.student_ids.length,2);
      const interaction=await post('/api/v1/interactions',tokenM,{
        occurred_at:'2026-11-13T13:30:00Z',contact_method:'telephone',
        summary:'家长询问两名孩子的不同课程',
        subjects:[{student_id:saved.studentA},{student_id:saved.studentB}]
      });
      assert.equal(interaction.status,200);
      assert.equal(interaction.data.actual_interactions,1);
      assert.equal(interaction.data.linked_subjects,2);
      const rows=await pool.query('SELECT count(*)::int n FROM ms.interaction_subjects WHERE interaction_id=$1',
        [interaction.data.interaction_id]);
      assert.equal(rows.rows[0].n,2);
    });

    await t.test('opportunities belong to a specific student, owned separately',async()=>{
      const oA=await post('/api/v1/opportunities',tokenA,{student_id:saved.studentA,predicted_amount_cents:800000});
      const oB=await post('/api/v1/opportunities',tokenB,{student_id:saved.studentB,predicted_amount_cents:500000});
      assert.equal(oA.status,200);assert.equal(oB.status,200);
      saved.oppA=oA.data.opportunity_id;
      saved.oppB=oB.data.opportunity_id;
      assert.equal(oA.data.owner_user_id,a);
      assert.equal(oB.data.owner_user_id,b);
      assert.equal((await get('/api/v1/opportunities/'+saved.oppA,tokenB)).status,403);
      const forbidden=await post('/api/v1/opportunities',tokenA,
        {student_id:saved.studentB,owner_user_id:a});
      assert.equal(forbidden.status,403);
    });

    await t.test('family link is optional, review stays pending; other employee denied',async()=>{
      const payload={display_name:'模拟家庭',student_ids:[saved.studentA,saved.studentB],verification_evidence_ref:'待人工核验资料号'};
      const denied=await post('/api/v1/family-groups',tokenA,payload);
      assert.equal(denied.status,403);
      const pending=await post('/api/v1/family-groups',tokenM,payload);
      assert.equal(pending.status,200);
      assert.equal(pending.data.verification_state,'pending');
      const r=await pool.query('SELECT verification_state FROM ms.family_groups WHERE id=$1',[pending.data.family_group_id]);
      assert.equal(r.rows[0].verification_state,'pending');
    });

    await t.test('audit returns Chinese business before/after rather than raw JSON',async()=>{
      const r=await get('/api/v1/audit?object_type=student&object_id='+saved.studentA,tokenA);
      assert.equal(r.status,200);
      assert.ok(r.data.items.length>=2);
      assert.ok(r.data.items.some(x=>x.summary_zh.includes('新建学生客户')));
      const text=JSON.stringify(r.data.items);
      assert.ok(text.includes('联系人关系'));
      assert.ok(!text.includes('before_business_json'));
      assert.equal((await get('/api/v1/audit?object_type=student&object_id='+saved.studentB,tokenA)).status,403);
      assert.equal((await get('/api/v1/audit?object_type=contact&object_id='+saved.contact,tokenA)).status,403);
    });

    await t.test('financial and CRM mutation APIs remain completely unimplemented',async()=>{
      for(const p of ['/api/v1/orders','/api/v1/orders/some/payment-allocations',
        '/integration/v1/entitlements','/api/v1/sales/any/credit-approvals']){
        const res=await post(p,tokenM,{amount_cents:600000});
        assert.equal(res.status,404,p);
      }
    });

  } finally {
    if(server)await new Promise(ok=>server.close(ok));
    await pool.end();
  }
});
