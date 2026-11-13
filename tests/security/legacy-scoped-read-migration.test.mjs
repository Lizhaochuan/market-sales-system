import test from 'node:test';
import assert from 'node:assert/strict';
import {createSign,createHmac,generateKeyPairSync,randomUUID} from 'node:crypto';
import pg from 'pg';
import {createApp} from '../../src/app.mjs';

const org='20000000-0000-4000-8000-000000000001';
const orgB='20000000-0000-4000-8000-000000000002';
const staffA='20000000-0000-4000-8000-000000000011';
const staffB='20000000-0000-4000-8000-000000000012';
const manager='20000000-0000-4000-8000-000000000013';
const secondManager='20000000-0000-4000-8000-000000000014';
const managerReviewer='20000000-0000-4000-8000-000000000015';
const secret='fictional-test-only-strong-token-secret-9c92789dc3b9';
const issuer='https://fictional-legacy-protected.example.invalid';
const audience='legacy-protected-sales-test';
const listen=s=>new Promise(r=>s.listen(0,'127.0.0.1',r));
const close=s=>new Promise(r=>s.close(r));

test('V3.2-10: original eight GET sales routes use independent staff DB roles and fail closed',async t=>{
  process.env.MS_STAGE='isolated-test';
  const admin=new pg.Pool({connectionString:process.env.DATABASE_URL,max:6});
  const a=new pg.Pool({connectionString:process.env.DATABASE_URL_ASSIGNEE_A,max:4});
  const b=new pg.Pool({connectionString:process.env.DATABASE_URL_ASSIGNEE_B,max:4});
  const m=new pg.Pool({connectionString:process.env.DATABASE_URL_ASSIGNEE_MANAGER,max:4});
  const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  const jwk={...publicKey.export({format:'jwk'}),kid:'legacy-guard-2026',alg:'RS256',use:'sig'};
  const externalIdentity={issuer,audience,jwks:{keys:[jwk]}};
  const subjectA='legacy-a-'+randomUUID(),subjectB='legacy-b-'+randomUUID(),
    subjectM='legacy-manager-'+randomUUID();
  const sign=(sub,claims={})=>{
    const now=Math.floor(Date.now()/1000);
    const h=Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT',kid:jwk.kid})).toString('base64url');
    const p=Buffer.from(JSON.stringify({
      iss:issuer,sub,aud:audience,iat:now,exp:now+900,...claims
    })).toString('base64url');
    return h+'.'+p+'.'+createSign('RSA-SHA256').update(h+'.'+p)
      .sign(privateKey).toString('base64url');
  };
  const demoToken=(staff)=>{
    const h=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
    const now=Math.floor(Date.now()/1000);
    const p=Buffer.from(JSON.stringify({iss:'market-sales-test-issuer',
      aud:'market-sales-isolated',sub:staff,org_id:org,iat:now,exp:now+900})).toString('base64url');
    return h+'.'+p+'.'+createHmac('sha256',secret).update(h+'.'+p).digest('base64url');
  };
  const pools=new Map([[staffA,a],[staffB,b],[manager,m]]);
  const app=createApp(admin,{secret,externalIdentity,scopedReadPools:pools});
  const ids={};
  let sharedId,roleRevoked=false;
  const request=async(path,token)=>{
    const res=await fetch('http://127.0.0.1:'+app.address().port+path,{
      headers:token?{Authorization:'Bearer '+token}:{}
    });
    return {status:res.status,...await res.json()};
  };
  async function approved(subject,target,requester,reviewer){
    const q=await admin.query(
      "INSERT INTO ms.identity_change_requests(organization_id,action,target_staff_id,"+
      "issuer,subject,requested_by,request_evidence_ref,request_reason_zh) "+
      "VALUES($1,'bind',$2,$3,$4,$5,'虚构员工材料','隔离测试员工核实') RETURNING id",
      [org,target,issuer,subject,requester]);
    await admin.query(
      "INSERT INTO ms.identity_change_decisions(request_id,reviewer_user_id,decision,"+
      "review_evidence_ref,reason_zh) VALUES($1,$2,'approved','第二位主管核实','材料相符')",
      [q.rows[0].id,reviewer]);
    await admin.query(
      "UPDATE ms.identity_change_requests SET status='approved',decided_by=$2,decided_at=now() "+
      "WHERE id=$1",[q.rows[0].id,reviewer]);
    await admin.query(
      "INSERT INTO ms.staff_identity_bindings(staff_user_id,issuer,subject,bound_by,approval_request_id) "+
      "VALUES($1,$2,$3,$4,$5)",[target,issuer,subject,reviewer,q.rows[0].id]);
  }
  const getItems=async(path,token)=>{
    const r=await request(path,token);
    assert.equal(r.status,200,path+': '+r.code);
    return r.data.items;
  };
  try{
    await admin.query("INSERT INTO ms.staff_users(id,organization_id,display_name,status) "+
      "VALUES($1,$2,'虚构第三主管','active')",[managerReviewer,org]);
    const role=await admin.query(
      "SELECT id FROM ms.role_templates WHERE organization_id=$1 AND role_code='sales_manager'",[org]);
    await admin.query("INSERT INTO ms.user_role_grants(user_id,role_id) VALUES($1,$2)",
      [managerReviewer,role.rows[0].id]);

    const students=await admin.query(
      "INSERT INTO ms.students(organization_id,display_name,grade_label,owner_user_id) "+
      "VALUES($1,$2,'A敏感年级',$3),($1,$4,'B敏感年级',$5),"+
      "($1,$6,'主管敏感年级',$7),($8,$9,'跨机构年级',$10) RETURNING id",
      [org,'现有接口A学生-'+randomUUID(),staffA,
       '现有接口B学生-'+randomUUID(),staffB,
       '主管自己的学生-'+randomUUID(),manager,
       orgB,'外机构学生-'+randomUUID(),'20000000-0000-4000-8000-000000000021']);
    [ids.studentA,ids.studentB,ids.studentM,ids.studentOther]=students.rows.map(x=>x.id);
    const contacts=await admin.query(
      "INSERT INTO ms.contacts(organization_id,display_name,created_by,do_not_contact) "+
      "VALUES($1,'A学生家长',$2,false),($1,'B学生家长',$3,false) RETURNING id",
      [org,staffA,staffB]);
    [ids.contactA,ids.contactB]=contacts.rows.map(x=>x.id);
    await admin.query(
      "INSERT INTO ms.student_contacts(student_id,contact_id,relation_type) "+
      "VALUES($1,$2,'母亲'),($3,$4,'父亲')",
      [ids.studentA,ids.contactA,ids.studentB,ids.contactB]);
    const ev=await admin.query(
      "INSERT INTO ms.contact_events(organization_id,contact_id,event_type,recorded_by,occurred_at) "+
      "VALUES($1,$2,'A咨询',$3,now()),($1,$4,'B咨询',$5,now()) RETURNING id",
      [org,ids.contactA,staffA,ids.contactB,staffB]);
    [ids.eventA,ids.eventB]=ev.rows.map(x=>x.id);
    const leads=await admin.query(
      "INSERT INTO ms.leads(organization_id,contact_id,owner_user_id,lead_state) "+
      "VALUES($1,$2,$3,'working'),($1,$4,$5,'new') RETURNING id",
      [org,ids.contactA,staffA,ids.contactB,staffB]);
    [ids.leadA,ids.leadB]=leads.rows.map(x=>x.id);
    await admin.query(
      "INSERT INTO ms.lead_students(lead_id,student_id) VALUES($1,$2),($3,$4)",
      [ids.leadA,ids.studentA,ids.leadB,ids.studentB]);
    const opportunities=await admin.query(
      "INSERT INTO ms.opportunities(student_id,owner_user_id,stage,predicted_amount_cents) "+
      "VALUES($1,$2,'trial',123456),($3,$4,'new',654321) RETURNING id",
      [ids.studentA,staffA,ids.studentB,staffB]);
    [ids.oppA,ids.oppB]=opportunities.rows.map(x=>x.id);

    await listen(app);
    const tokenA=sign(subjectA,{org_id:orgB,role:'super_admin',staff_id:manager});
    const tokenB=sign(subjectB,{org_id:orgB,role:'super_admin',staff_id:staffA});
    const tokenM=sign(subjectM,{role:'super_admin'});

    await t.test('unapproved RSA and signed demo sessions cannot read migrated legacy sales lists',async()=>{
      assert.equal((await request('/api/v1/students',tokenA)).status,403);
      assert.equal((await request('/api/v1/students',demoToken(staffA))).status,403);
      assert.equal((await request('/api/v1/students',null)).status,401);
    });
    await approved(subjectA,staffA,manager,secondManager);
    await approved(subjectB,staffB,manager,secondManager);
    await approved(subjectM,manager,secondManager,managerReviewer);

    await t.test('five existing list routes now read only employee-scoped views, including supervisor',async()=>{
      const checks=[
        ['/api/v1/students','student_id',ids.studentA,ids.studentB],
        ['/api/v1/contacts','contact_id',ids.contactA,ids.contactB],
        ['/api/v1/contact-events','event_id',ids.eventA,ids.eventB],
        ['/api/v1/leads','lead_id',ids.leadA,ids.leadB],
        ['/api/v1/opportunities','opportunity_id',ids.oppA,ids.oppB]
      ];
      for(const [path,field,own,other] of checks){
        const listA=await getItems(path,tokenA);
        const listB=await getItems(path,tokenB);
        assert.ok(listA.some(x=>x[field]===own),path+' A own');
        assert.ok(!listA.some(x=>x[field]===other),path+' A cannot see B');
        assert.ok(listB.some(x=>x[field]===other),path+' B own');
        assert.ok(!listB.some(x=>x[field]===own),path+' B cannot see A');
        assert.ok(!JSON.stringify(listA).includes('123456'));
        assert.ok(!JSON.stringify(listA).includes('A敏感年级'));
      }
      const mList=await getItems('/api/v1/students',tokenM);
      assert.ok(mList.some(x=>x.student_id===ids.studentM));
      assert.ok(!mList.some(x=>x.student_id===ids.studentA||x.student_id===ids.studentB));
      const mLeads=await getItems('/api/v1/leads',tokenM);
      assert.ok(!mLeads.some(x=>x.lead_id===ids.leadA||x.lead_id===ids.leadB));
    });

    await t.test('three legacy detail routes cannot bypass employee-specific projections',async()=>{
      const student=await request('/api/v1/students/'+ids.studentA,tokenA);
      assert.equal(student.status,200);
      assert.equal(student.data.student_id,ids.studentA);
      assert.equal((await request('/api/v1/students/'+ids.studentB,tokenA)).status,404);
      assert.equal((await request('/api/v1/students/'+ids.studentA,tokenM)).status,404);
      const lead=await request('/api/v1/leads/'+ids.leadA,tokenA);
      assert.equal(lead.status,200);
      assert.equal(lead.data.lead_id,ids.leadA);
      assert.ok(lead.data.student_ids.includes(ids.studentA));
      assert.equal((await request('/api/v1/leads/'+ids.leadA,tokenB)).status,404);
      assert.equal((await request('/api/v1/leads/'+ids.leadA,tokenM)).status,404);
      const opp=await request('/api/v1/opportunities/'+ids.oppA,tokenA);
      assert.equal(opp.status,200);
      assert.equal(opp.data.owner_user_id,staffA);
      assert.equal((await request('/api/v1/opportunities/'+ids.oppA,tokenM)).status,404);
    });

    await t.test('manager explicit student grant permits student/parent only, not other sales or their records',async()=>{
      const grant=await admin.query(
        "INSERT INTO ms.data_scope_grants(user_id,resource_type,scope_type,scope_ref,granted_by) "+
        "VALUES($1,'student','specific',$2,$3) RETURNING id",
        [manager,ids.studentA,secondManager]);
      sharedId=grant.rows[0].id;
      const own=await getItems('/api/v1/students',tokenM);
      const contact=await getItems('/api/v1/contacts',tokenM);
      const events=await getItems('/api/v1/contact-events',tokenM);
      const leads=await getItems('/api/v1/leads',tokenM);
      const opps=await getItems('/api/v1/opportunities',tokenM);
      assert.ok(own.some(x=>x.student_id===ids.studentA));
      assert.ok(contact.some(x=>x.contact_id===ids.contactA));
      assert.ok(!events.some(x=>x.event_id===ids.eventA));
      assert.ok(!leads.some(x=>x.lead_id===ids.leadA));
      assert.ok(!opps.some(x=>x.opportunity_id===ids.oppA));
      assert.equal((await request('/api/v1/students/'+ids.studentA,tokenM)).status,200);
      assert.equal((await request('/api/v1/leads/'+ids.leadA,tokenM)).status,404);
    });

    await t.test('revoking manager role does not restore all-organization customer reads',async()=>{
      await admin.query("UPDATE ms.user_role_grants SET revoked_at=now() WHERE user_id=$1",[manager]);
      roleRevoked=true;
      const me=await request('/api/v1/me',tokenM);
      assert.equal(me.status,200);
      assert.equal(me.data.capabilities.manage_identity_requests,false);
      const rows=await getItems('/api/v1/students',tokenM);
      assert.ok(!rows.some(x=>x.student_id===ids.studentB));
      assert.ok(rows.some(x=>x.student_id===ids.studentA));
    });

    await t.test('revoking manager student share immediately hides student and related contact',async()=>{
      await admin.query('UPDATE ms.data_scope_grants SET revoked_at=now() WHERE id=$1',[sharedId]);
      const own=await getItems('/api/v1/students',tokenM);
      const contacts=await getItems('/api/v1/contacts',tokenM);
      assert.ok(!own.some(x=>x.student_id===ids.studentA));
      assert.ok(!contacts.some(x=>x.contact_id===ids.contactA));
      assert.equal((await request('/api/v1/students/'+ids.studentA,tokenM)).status,404);
    });

    await t.test('missing or mismapped staff DB login fails closed instead of fallback to broad SQL',async()=>{
      pools.delete(staffB);
      try{
        assert.equal((await request('/api/v1/students',tokenB)).status,403);
      }finally{pools.set(staffB,b);}
      pools.set(staffA,b);
      try{
        assert.equal((await request('/api/v1/students',tokenA)).status,403);
      }finally{pools.set(staffA,a);}
    });

    await t.test('revoking external identity blocks all eight existing migrated GET routes',async()=>{
      await admin.query(
        "UPDATE ms.staff_identity_bindings SET revoked_at=now() "+
        "WHERE issuer=$1 AND subject=$2 AND revoked_at IS NULL",[issuer,subjectA]);
      for(const path of [
        '/api/v1/students','/api/v1/contacts','/api/v1/contact-events','/api/v1/leads',
        '/api/v1/opportunities','/api/v1/students/'+ids.studentA,
        '/api/v1/leads/'+ids.leadA,'/api/v1/opportunities/'+ids.oppA
      ])assert.equal((await request(path,tokenA)).status,403,path);
    });

    await t.test('read-only PostgreSQL principals cannot read raw personal/contact/finance and cannot write',async()=>{
      for(const pool of [a,b,m]){
        await assert.rejects(pool.query('SELECT * FROM ms.students'),e=>e.code==='42501');
        await assert.rejects(pool.query('SELECT * FROM ms.contacts'),e=>e.code==='42501');
        await assert.rejects(pool.query('SELECT * FROM ms.sales_orders'),e=>e.code==='42501');
        await assert.rejects(pool.query("UPDATE ms.contacts SET display_name='tamper' WHERE false"),
          e=>e.code==='42501');
      }
    });
  }finally{
    if(sharedId)await admin.query("UPDATE ms.data_scope_grants SET revoked_at=now() WHERE id=$1",[sharedId]);
    if(roleRevoked)await admin.query("UPDATE ms.user_role_grants SET revoked_at=NULL WHERE user_id=$1",[manager]);
    await Promise.allSettled([app].filter(x=>x.listening).map(close));
    await Promise.all([admin.end(),a.end(),b.end(),m.end()]);
  }
});
