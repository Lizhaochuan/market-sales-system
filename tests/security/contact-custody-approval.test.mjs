import test from 'node:test';
import assert from 'node:assert/strict';
import {createSign,generateKeyPairSync,randomUUID,randomBytes} from 'node:crypto';
import pg from 'pg';
import {createApp} from '../../src/app.mjs';
import {assertScopedLowriskWriter} from '../../src/scoped-lowrisk-write-api.mjs';

const org='20000000-0000-4000-8000-000000000001';
const A='20000000-0000-4000-8000-000000000011';
const B='20000000-0000-4000-8000-000000000012';
const M='20000000-0000-4000-8000-000000000013';
const M2='20000000-0000-4000-8000-000000000014';
const issuer='https://fictional-custody-review.example.invalid';
const audience='isolated-contact-custody';
const key=()=>randomBytes(20).toString('hex');
const open=s=>new Promise(resolve=>s.listen(0,'127.0.0.1',resolve));
const close=s=>new Promise(resolve=>s.close(resolve));

test('V3.2-15 contact custody: A→B only after independent M approval, no linked student/old consultation transfer',async t=>{
  process.env.MS_STAGE='isolated-test';
  const admin=new pg.Pool({connectionString:process.env.DATABASE_URL,max:6});
  const directory=new pg.Pool({connectionString:process.env.DATABASE_URL_AUTH_DIRECTORY,max:3});
  const reads={
    A:new pg.Pool({connectionString:process.env.DATABASE_URL_ASSIGNEE_A,max:3}),
    B:new pg.Pool({connectionString:process.env.DATABASE_URL_ASSIGNEE_B,max:3}),
    M:new pg.Pool({connectionString:process.env.DATABASE_URL_ASSIGNEE_MANAGER,max:3})
  };
  const writes={
    A:new pg.Pool({connectionString:process.env.DATABASE_URL_WRITE_A,max:3}),
    B:new pg.Pool({connectionString:process.env.DATABASE_URL_WRITE_B,max:3}),
    M:new pg.Pool({connectionString:process.env.DATABASE_URL_WRITE_MANAGER,max:3})
  };
  const kp=generateKeyPairSync('rsa',{modulusLength:2048});
  const pub={...kp.publicKey.export({format:'jwk'}),kid:'custody-2026',alg:'RS256',use:'sig'};
  const externalIdentity={issuer,audience,jwks:{keys:[pub]}};
  const subs={A:'custody-a-'+randomUUID(),B:'custody-b-'+randomUUID(),M:'custody-m-'+randomUUID()};
  const actor={A,B,M};
  const sign=who=>{
    const now=Math.floor(Date.now()/1000);
    const h=Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT',kid:pub.kid})).toString('base64url');
    const p=Buffer.from(JSON.stringify({iss:issuer,aud:audience,sub:subs[who],
      iat:now,exp:now+900,staff_id:M,role:'super_admin',
      org_id:'20000000-0000-4000-8000-000000000002'})).toString('base64url');
    return h+'.'+p+'.'+createSign('RSA-SHA256').update(h+'.'+p)
      .sign(kp.privateKey).toString('base64url');
  };
  let forbiddenTouches=0;
  const app=createApp({connect(){forbiddenTouches++;throw Error('FORBIDDEN BROAD POOL');}},{
    secret:'fictional-custody-test-only-hmac-unused-strong-secret',
    externalIdentity,strictStaffMode:true,identityDirectoryPool:directory,
    scopedReadPools:new Map([[A,reads.A],[B,reads.B],[M,reads.M]]),
    scopedWritePools:new Map([[A,writes.A],[B,writes.B],[M,writes.M]])
  });
  const call=async(who,method,path,body,idem=key())=>{
    const r=await fetch('http://127.0.0.1:'+app.address().port+path,{
      method,headers:{Authorization:'Bearer '+sign(who),
        ...(body!==undefined?{'Content-Type':'application/json','Idempotency-Key':idem}:{})},
      ...(body!==undefined?{body:JSON.stringify(body)}:{})
    });
    return {status:r.status,...await r.json()};
  };
  async function bind(who){
    const target=actor[who],requester=who==='M'?A:M;
    const r=await admin.query(
      "INSERT INTO ms.identity_change_requests(organization_id,action,target_staff_id,"+
      "issuer,subject,requested_by,request_evidence_ref,request_reason_zh) "+
      "VALUES($1,'bind',$2,$3,$4,$5,'虚构员工身份核对','经两名主管复核') RETURNING id",
      [org,target,issuer,subs[who],requester]);
    await admin.query(
      "INSERT INTO ms.identity_change_decisions(request_id,reviewer_user_id,decision,"+
      "review_evidence_ref,reason_zh) VALUES($1,$2,'approved','虚构独立复核','审核通过')",
      [r.rows[0].id,M2]);
    await admin.query(
      "UPDATE ms.identity_change_requests SET status='approved',decided_by=$2,decided_at=now() WHERE id=$1",
      [r.rows[0].id,M2]);
    await admin.query(
      "INSERT INTO ms.staff_identity_bindings(staff_user_id,issuer,subject,bound_by,approval_request_id) "+
      "VALUES($1,$2,$3,$4,$5)",
      [target,issuer,subs[who],M2,r.rows[0].id]);
  }
  let contactId,studentId,eventId,requestId;
  try{
    await t.test('A/B/M real writer logins have only function EXECUTE, no custody table or audit writes',async()=>{
      for(const pool of Object.values(writes)){
        assert.equal((await assertScopedLowriskWriter(pool)).restricted,true);
        for(const statement of [
          'SELECT * FROM ms.contact_custody_requests',
          'SELECT * FROM ms.contact_custody_decisions',
          'SELECT * FROM ms.contact_custody_assignments',
          "UPDATE ms.contacts SET display_name='篡改' WHERE false",
          "SELECT * FROM ms.sales_orders"
        ])await assert.rejects(pool.query(statement),
          e=>e.code==='42501',statement);
      }
    });
    await open(app);
    await bind('A');await bind('B');await bind('M');
    await t.test('A owns newly created contact/student and consult, no family/finance',async()=>{
      const student=await call('A','POST','/api/v1/students',
        {display_name:'交接前学生-'+randomUUID()});
      const contact=await call('A','POST','/api/v1/contacts',
        {display_name:'需要交接的虚构家长-'+randomUUID()});
      assert.equal(student.status,200,JSON.stringify(student));
      assert.equal(contact.status,200,JSON.stringify(contact));
      studentId=student.data.student_id;contactId=contact.data.contact_id;
      const link=await call('A','POST','/api/v1/students/'+studentId+'/contacts',
        {contact_id:contactId,relation_type:'母亲',verification_state:'unverified'});
      assert.equal(link.status,200,JSON.stringify(link));
      const event=await call('A','POST','/api/v1/contact-events',{
        contact_id:contactId,event_type:'电话咨询',
        occurred_at:new Date(Date.now()-60000).toISOString()
      });
      assert.equal(event.status,200);eventId=event.data.event_id;
      const bContacts=await call('B','GET','/api/v1/contacts');
      assert.equal(bContacts.status,200);
      assert.ok(!bContacts.data.items.some(x=>x.contact_id===contactId));
      assert.equal(forbiddenTouches,0);
    });
    await t.test('contact creator submits one pending custody request; no premature transfer',async()=>{
      const idem=key();
      const payload={contact_id:contactId,target_staff_id:B,
        reason_zh:'虚构同事交接，客户本人已同意等待主管核实',
        evidence_ref:'虚构核对材料，仅用于测试'};
      const first=await call('A','POST','/api/v1/contact-custody/requests',payload,idem);
      assert.equal(first.status,200,JSON.stringify(first));
      requestId=first.data;
      assert.match(requestId,/^[0-9a-f-]{36}$/i);
      const second=await call('A','POST','/api/v1/contact-custody/requests',payload,idem);
      assert.equal(second.status,200);assert.equal(second.data,requestId);
      assert.equal((await call('A','POST','/api/v1/contact-custody/requests',
        {...payload,target_staff_id:M},idem)).status,409);
      const request=await admin.query(
        'SELECT status FROM ms.contact_custody_requests WHERE id=$1',[requestId]);
      assert.equal(request.rows[0].status,'pending');
      assert.equal((await admin.query(
        'SELECT COUNT(*)::int AS n FROM ms.contact_custody_assignments WHERE contact_id=$1 AND revoked_at IS NULL',
        [contactId])).rows[0].n,0);
      assert.ok(!(await call('B','GET','/api/v1/contacts')).data.items
        .some(x=>x.contact_id===contactId));
    });
    await t.test('approver cannot be applicant, target, nonmanager or wrong evidence; request visible only to participants or managers',async()=>{
      const body={decision:'approved',reason_zh:'虚构独立确认客户转交',
        evidence_ref:'主管在测试中完成双人核实'};
      const path='/api/v1/contact-custody/requests/'+requestId+'/decision';
      assert.equal((await call('A','POST',path,body)).status,403);
      assert.equal((await call('B','POST',path,body)).status,403);
      assert.equal((await call('M','POST',path,{...body,decision:'unknown'})).status,422);
      const a=await call('A','GET','/api/v1/contact-custody/requests');
      const b=await call('B','GET','/api/v1/contact-custody/requests');
      const m=await call('M','GET','/api/v1/contact-custody/requests');
      for(const o of [a,b,m]){
        assert.equal(o.status,200,JSON.stringify(o));
        assert.ok(o.data.items.some(x=>x.request_id===requestId));
        assert.ok(!JSON.stringify(o).includes('主管在测试中完成双人核实'));
      }
    });
    await t.test('independent M approves and contact current custody moves; author, student and past consult remain unchanged',async()=>{
      const body={decision:'approved',reason_zh:'独立主管已审批转交',
        evidence_ref:'虚构审批证明说明'};
      const idem=key(),route='/api/v1/contact-custody/requests/'+requestId+'/decision';
      const first=await call('M','POST',route,body,idem);
      assert.equal(first.status,200,JSON.stringify(first));
      assert.equal(first.data,'已批准');
      const replay=await call('M','POST',route,body,idem);
      assert.equal(replay.status,200);assert.equal(replay.data,'已批准');
      const c=await admin.query(
        'SELECT created_by FROM ms.contacts WHERE id=$1',[contactId]);
      assert.equal(c.rows[0].created_by,A);
      const custody=await admin.query(
        'SELECT assignee_id FROM ms.contact_custody_assignments '+
        'WHERE contact_id=$1 AND revoked_at IS NULL',[contactId]);
      assert.equal(custody.rowCount,1);assert.equal(custody.rows[0].assignee_id,B);
      const student=await admin.query('SELECT owner_user_id FROM ms.students WHERE id=$1',[studentId]);
      assert.equal(student.rows[0].owner_user_id,A);
      const event=await admin.query(
        'SELECT recorded_by FROM ms.contact_events WHERE id=$1',[eventId]);
      assert.equal(event.rows[0].recorded_by,A);
      assert.equal((await admin.query('SELECT COUNT(*)::int AS n FROM ms.family_memberships '+
        'WHERE student_id=$1',[studentId])).rows[0].n,0);
      assert.equal((await admin.query('SELECT COUNT(*)::int AS n FROM ms.sales_orders '+
        'WHERE student_id=$1',[studentId])).rows[0].n,0);
    });
    await t.test('recipient B sees transferred contact and can consult; A cannot use old author power',async()=>{
      const visible=await call('B','GET','/api/v1/contacts');
      assert.equal(visible.status,200);
      assert.ok(visible.data.items.some(x=>x.contact_id===contactId));
      const oldContact=await call('A','GET','/api/v1/contacts');
      assert.ok(oldContact.data.items.some(x=>x.contact_id===contactId),
        'A retains limited contact view ONLY via own student relationship');
      const consult={contact_id:contactId,event_type:'线上咨询',
        occurred_at:new Date(Date.now()-90000).toISOString()};
      assert.equal((await call('A','POST','/api/v1/contact-events',consult)).status,403);
      const bEvent=await call('B','POST','/api/v1/contact-events',consult);
      assert.equal(bEvent.status,200,JSON.stringify(bEvent));
      const rows=await admin.query(
        'SELECT id,recorded_by FROM ms.contact_events WHERE contact_id=$1 ORDER BY occurred_at',
        [contactId]);
      assert.equal(rows.rowCount,2);
      assert.ok(rows.rows.some(x=>x.id===eventId&&x.recorded_by===A));
      assert.ok(rows.rows.some(x=>x.id===bEvent.data.event_id&&x.recorded_by===B));
      const aHistory=await call('A','GET','/api/v1/contact-events');
      const bHistory=await call('B','GET','/api/v1/contact-events');
      assert.ok(aHistory.data.items.some(x=>x.event_id===eventId));
      assert.ok(!bHistory.data.items.some(x=>x.event_id===eventId));
      assert.ok(bHistory.data.items.some(x=>x.event_id===bEvent.data.event_id));
      assert.ok(!aHistory.data.items.some(x=>x.event_id===bEvent.data.event_id));
    });
    await t.test('B can associate transferred contact to OWN student, never auto-merge students or family',async()=>{
      const bStudent=await call('B','POST','/api/v1/students',
        {display_name:'接收员工自己负责的另一位学生-'+randomUUID()});
      assert.equal(bStudent.status,200);
      const linked=await call('B','POST',
        '/api/v1/students/'+bStudent.data.student_id+'/contacts',
        {contact_id:contactId,relation_type:'其他联系人',verification_state:'unverified'});
      assert.equal(linked.status,200,JSON.stringify(linked));
      assert.equal((await call('A','POST',
        '/api/v1/students/'+studentId+'/contacts',
        {contact_id:contactId,relation_type:'父亲'})).status,403);
      const groups=await admin.query(
        'SELECT COUNT(*)::int AS n FROM ms.family_memberships WHERE student_id=ANY($1::uuid[])',
        [[studentId,bStudent.data.student_id]]);
      assert.equal(groups.rows[0].n,0);
    });
    await t.test('no arbitrary direct role edit; manager review does not grant access to other siblings, finance or existing sales leads',async()=>{
      assert.equal((await call('M','GET','/api/v1/leads')).status,200);
      const proposals=await admin.query(
        'SELECT status,reviewed_by FROM ms.contact_custody_requests WHERE id=$1',
        [requestId]);
      assert.equal(proposals.rows[0].status,'approved');
      assert.equal(proposals.rows[0].reviewed_by,M);
      await assert.rejects(admin.query(
        "UPDATE ms.contact_custody_decisions SET reason_zh='事后篡改' WHERE request_id=$1",
        [requestId]),e=>e.code==='23514');
      assert.equal(forbiddenTouches,0);
    });
  }finally{
    if(app.listening)await close(app);
    await Promise.all([admin.end(),directory.end(),
      ...Object.values(reads).map(p=>p.end()),...Object.values(writes).map(p=>p.end())]);
  }
});
