import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createSign,randomUUID} from 'node:crypto';
import pg from 'pg';
import {createScopedEmployeeReadApi,assertScopedReadPool} from '../../src/scoped-employee-read-api.mjs';

const org='20000000-0000-4000-8000-000000000001';
const foreignOrg='20000000-0000-4000-8000-000000000002';
const A='20000000-0000-4000-8000-000000000011';
const B='20000000-0000-4000-8000-000000000012';
const foreign='20000000-0000-4000-8000-000000000021';
const manager='20000000-0000-4000-8000-000000000013';
const reviewer='20000000-0000-4000-8000-000000000014';
const issuer='https://fictional-scoped-api.example.invalid';
const audience='scoped-employee-read-test';
const listen=s=>new Promise(ok=>s.listen(0,'127.0.0.1',ok));
const close=s=>new Promise(ok=>s.close(ok));

test('V3.2-09: five actual scoped HTTP read endpoints isolate staff, fields and organizations',async t=>{
  process.env.MS_STAGE='isolated-test';
  const owner=new pg.Pool({connectionString:process.env.DATABASE_URL,max:4});
  const aPool=new pg.Pool({connectionString:process.env.DATABASE_URL_ASSIGNEE_A,max:3});
  const bPool=new pg.Pool({connectionString:process.env.DATABASE_URL_ASSIGNEE_B,max:3});
  const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  const jwk={...publicKey.export({format:'jwk'}),kid:'scoped-test-key',alg:'RS256',use:'sig'};
  const externalIdentity={issuer,audience,jwks:{keys:[jwk]}};
  const subjectA='scoped-a-'+randomUUID(),subjectB='scoped-b-'+randomUUID();
  const sign=(sub,extra={})=>{
    const now=Math.floor(Date.now()/1000);
    const h=Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT',kid:jwk.kid})).toString('base64url');
    const p=Buffer.from(JSON.stringify({
      iss:issuer,sub,aud:audience,iat:now,exp:now+900,...extra
    })).toString('base64url');
    return h+'.'+p+'.'+createSign('RSA-SHA256').update(h+'.'+p)
      .sign(privateKey).toString('base64url');
  };
  const tokenA=sign(subjectA,{org_id:foreignOrg,staff_id:B,role:'super_admin'});
  const tokenB=sign(subjectB,{org_id:foreignOrg,staff_id:A,role:'super_admin'});
  const apps=[
    createScopedEmployeeReadApi(aPool,{externalIdentity}),
    createScopedEmployeeReadApi(bPool,{externalIdentity})
  ];
  let grantId,studentA,studentB,foreignStudent,contactA,contactB,eventA,eventB,leadA,leadB,oppA,oppB;
  const paths={
    students:'/api/v1/scoped/students',
    contacts:'/api/v1/scoped/contacts',
    events:'/api/v1/scoped/contact-events',
    leads:'/api/v1/scoped/leads',
    opportunities:'/api/v1/scoped/opportunities'
  };
  const request=async(app,path,token,method='GET')=>{
    const res=await fetch('http://127.0.0.1:'+app.address().port+path,
      {method,headers:token?{Authorization:'Bearer '+token}:{}});
    return {status:res.status,...await res.json()};
  };
  const get=async(app,path,token)=>{
    const result=await request(app,path,token);
    assert.equal(result.status,200,path+': '+result.code);
    return result.data.items;
  };
  async function approvedBinding(target,subject){
    const q=await owner.query(
      "INSERT INTO ms.identity_change_requests(organization_id,action,target_staff_id,"+
      "issuer,subject,requested_by,request_evidence_ref,request_reason_zh) "+
      "VALUES($1,'bind',$2,$3,$4,$5,'虚构员工身份材料','确认员工身份') RETURNING id",
      [org,target,issuer,subject,manager]);
    await owner.query(
      "INSERT INTO ms.identity_change_decisions(request_id,reviewer_user_id,decision,"+
      "review_evidence_ref,reason_zh) VALUES($1,$2,'approved','独立复核虚构材料','第二主管复核')",
      [q.rows[0].id,reviewer]);
    await owner.query(
      "UPDATE ms.identity_change_requests SET status='approved',decided_by=$2,decided_at=now() WHERE id=$1",
      [q.rows[0].id,reviewer]);
    await owner.query(
      "INSERT INTO ms.staff_identity_bindings(staff_user_id,issuer,subject,bound_by,approval_request_id) "+
      "VALUES($1,$2,$3,$4,$5)",[target,issuer,subject,reviewer,q.rows[0].id]);
  }
  try{
    await t.test('employee DB logins deny raw records, money, staff registry and writes',async()=>{
      for(const p of [aPool,bPool]){
        const x=await assertScopedReadPool(p);
        assert.equal(x.restricted,true);
        await assert.rejects(p.query('SELECT * FROM ms.students'),e=>e.code==='42501');
        await assert.rejects(p.query('SELECT * FROM ms.contacts'),e=>e.code==='42501');
        await assert.rejects(p.query('SELECT * FROM ms.sales_orders'),e=>e.code==='42501');
        await assert.rejects(p.query("UPDATE ms.leads SET lead_state='won' WHERE false"),
          e=>e.code==='42501');
      }
    });

    const students=await owner.query(
      "INSERT INTO ms.students(organization_id,display_name,grade_label,owner_user_id) "+
      "VALUES($1,$2,'隐私年级A',$3),($1,$4,'隐私年级B',$5),"+
      "($6,$7,'外机构私密年级',$8) RETURNING id,display_name",
      [org,'员工A学生-'+randomUUID(),A,'员工B学生-'+randomUUID(),B,
       foreignOrg,'外机构学生-'+randomUUID(),foreign]);
    studentA=students.rows[0].id;studentB=students.rows[1].id;
    foreignStudent=students.rows[2].id;

    const contacts=await owner.query(
      "INSERT INTO ms.contacts(organization_id,display_name,created_by,do_not_contact) "+
      "VALUES($1,$2,$3,false),($1,$4,$5,false) RETURNING id",
      [org,'员工A联系人-'+randomUUID(),A,'员工B联系人-'+randomUUID(),B]);
    contactA=contacts.rows[0].id;contactB=contacts.rows[1].id;
    await owner.query(
      "INSERT INTO ms.student_contacts(student_id,contact_id,relation_type) "+
      "VALUES($1,$2,'母亲'),($3,$4,'父亲')",
      [studentA,contactA,studentB,contactB]);
    const evA=await owner.query(
      "INSERT INTO ms.contact_events(organization_id,contact_id,event_type,occurred_at,recorded_by) "+
      "VALUES($1,$2,'到店咨询A',now(),$3) RETURNING id",[org,contactA,A]);
    const evB=await owner.query(
      "INSERT INTO ms.contact_events(organization_id,contact_id,event_type,occurred_at,recorded_by) "+
      "VALUES($1,$2,'线上咨询B',now(),$3) RETURNING id",[org,contactB,B]);
    eventA=evA.rows[0].id;eventB=evB.rows[0].id;

    const leadRows=await owner.query(
      "INSERT INTO ms.leads(organization_id,contact_id,owner_user_id,lead_state) "+
      "VALUES($1,$2,$3,'working'),($1,$4,$5,'new') RETURNING id",
      [org,contactA,A,contactB,B]);
    leadA=leadRows.rows[0].id;leadB=leadRows.rows[1].id;
    const oppRows=await owner.query(
      "INSERT INTO ms.opportunities(student_id,owner_user_id,stage,predicted_amount_cents) "+
      "VALUES($1,$2,'trial',999900),($3,$4,'new',888800) RETURNING id",
      [studentA,A,studentB,B]);
    oppA=oppRows.rows[0].id;oppB=oppRows.rows[1].id;

    await Promise.all(apps.map(listen));

    await t.test('unapproved JWT is denied even if JWT signature and subject format are valid',async()=>{
      assert.equal((await request(apps[0],paths.students,tokenA)).status,403);
      assert.equal((await request(apps[0],paths.students,tokenB)).status,403);
    });

    await approvedBinding(A,subjectA);
    await approvedBinding(B,subjectB);

    await t.test('A and B access their own five business lists, never colleague or foreign',async()=>{
      const expectedA=[studentA,contactA,eventA,leadA,oppA];
      const expectedB=[studentB,contactB,eventB,leadB,oppB];
      const fields=['student_id','contact_id','event_id','lead_id','opportunity_id'];
      let i=0;
      for(const path of Object.values(paths)){
        const field=fields[i];
        const rowsA=await get(apps[0],path,tokenA);
        const rowsB=await get(apps[1],path,tokenB);
        assert.ok(rowsA.some(x=>x[field]===expectedA[i]),path+' owner A');
        assert.ok(rowsB.some(x=>x[field]===expectedB[i]),path+' owner B');
        assert.ok(!rowsA.some(x=>x[field]===expectedB[i]),path+' A must not see B');
        assert.ok(!rowsB.some(x=>x[field]===expectedA[i]),path+' B must not see A');
        assert.ok(!rowsA.some(x=>x.student_id===foreignStudent));
        assert.ok(!JSON.stringify(rowsA).includes('隐私年级'));
        assert.ok(!JSON.stringify(rowsA).includes('999900'));
        i++;
      }
    });

    await t.test('claims cannot impersonate other employee, and swapped JWT is denied',async()=>{
      assert.equal((await request(apps[0],paths.students,tokenB)).status,403);
      assert.equal((await request(apps[1],paths.students,tokenA)).status,403);
      const tampered=tokenA.split('.');
      tampered[2]='x'+tampered[2].slice(1);
      assert.equal((await request(apps[0],paths.students,tampered.join('.'))).status,401);
      assert.equal((await request(apps[0],paths.students,null)).status,401);
    });

    await t.test('all write methods, arbitrary paths and query attempts are closed',async()=>{
      assert.equal((await request(apps[0],paths.students,tokenA,'POST')).status,404);
      assert.equal((await request(apps[0],'/api/v1/scoped/finance',tokenA)).status,404);
      assert.equal((await request(apps[0],paths.students+'?select=grade_label',tokenA)).status,404);
    });

    await t.test('sharing A student to B reveals student and related contact/consultation, not A lead or opportunity',async()=>{
      const g=await owner.query(
        "INSERT INTO ms.data_scope_grants(user_id,resource_type,scope_type,scope_ref,granted_by) "+
        "VALUES($1,'student','specific',$2,$3) RETURNING id",[B,studentA,manager]);
      grantId=g.rows[0].id;
      const bStudents=await get(apps[1],paths.students,tokenB);
      const bContacts=await get(apps[1],paths.contacts,tokenB);
      const bEvents=await get(apps[1],paths.events,tokenB);
      const bLeads=await get(apps[1],paths.leads,tokenB);
      const bOpp=await get(apps[1],paths.opportunities,tokenB);
      assert.ok(bStudents.some(x=>x.student_id===studentA));
      assert.ok(bContacts.some(x=>x.contact_id===contactA));
      assert.ok(bEvents.some(x=>x.event_id===eventA));
      assert.ok(!bLeads.some(x=>x.lead_id===leadA));
      assert.ok(!bOpp.some(x=>x.opportunity_id===oppA));
    });

    await t.test('revocation of specific share removes inherited contact and consultation promptly',async()=>{
      await owner.query('UPDATE ms.data_scope_grants SET revoked_at=now() WHERE id=$1',[grantId]);
      for(const [path,field,id] of [
        [paths.students,'student_id',studentA],
        [paths.contacts,'contact_id',contactA],
        [paths.events,'event_id',eventA]
      ])assert.ok(!(await get(apps[1],path,tokenB)).some(x=>x[field]===id));
      assert.ok((await get(apps[0],paths.students,tokenA)).some(x=>x.student_id===studentA));
    });

    await t.test('external identity revocation immediately blocks all five scoped endpoints',async()=>{
      await owner.query(
        "UPDATE ms.staff_identity_bindings SET revoked_at=now() "+
        "WHERE issuer=$1 AND subject=$2 AND revoked_at IS NULL",[issuer,subjectA]);
      for(const path of Object.values(paths))
        assert.equal((await request(apps[0],path,tokenA)).status,403);
      assert.equal((await request(apps[1],paths.students,tokenB)).status,200);
    });

    await t.test('staff deactivation also blocks the original signed token',async()=>{
      await owner.query("UPDATE ms.staff_users SET status='disabled' WHERE id=$1",[B]);
      try{
        assert.equal((await request(apps[1],paths.students,tokenB)).status,403);
      }finally{
        await owner.query("UPDATE ms.staff_users SET status='active' WHERE id=$1",[B]);
      }
    });
  }finally{
    if(grantId)await owner.query('UPDATE ms.data_scope_grants SET revoked_at=now() WHERE id=$1',[grantId]);
    await Promise.allSettled(apps.filter(x=>x.listening).map(close));
    await Promise.all([owner.end(),aPool.end(),bPool.end()]);
  }
});
