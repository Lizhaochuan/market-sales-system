import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,createSign,generateKeyPairSync,randomUUID,randomBytes} from 'node:crypto';
import pg from 'pg';
import {createApp} from '../../src/app.mjs';
import {initializeStrictStaffPools} from '../../src/strict-staff-pools.mjs';

const org='20000000-0000-4000-8000-000000000001';
const foreignOrg='20000000-0000-4000-8000-000000000002';
const staffA='20000000-0000-4000-8000-000000000011';
const staffB='20000000-0000-4000-8000-000000000012';
const manager='20000000-0000-4000-8000-000000000013';
const reviewer='20000000-0000-4000-8000-000000000014';
const secret='fictional-test-only-strong-token-secret-9c92789dc3b9';
const issuer='https://fictional-strict-legacy-writes.example.invalid';
const audience='strict-legacy-write-isolated-test';
const key=()=>randomBytes(20).toString('hex');
const listen=app=>new Promise(ok=>app.listen(0,'127.0.0.1',ok));
const close=app=>new Promise(ok=>app.close(ok));

test('V3.2-13 original student/contact POST uses employee-only DB identity and cannot fallback',async t=>{
  process.env.MS_STAGE='isolated-test';
  const owner=new pg.Pool({connectionString:process.env.DATABASE_URL,max:8});
  const reads={
    A:new pg.Pool({connectionString:process.env.DATABASE_URL_ASSIGNEE_A,max:4}),
    B:new pg.Pool({connectionString:process.env.DATABASE_URL_ASSIGNEE_B,max:4})
  };
  const writes={
    A:new pg.Pool({connectionString:process.env.DATABASE_URL_WRITE_A,max:4}),
    B:new pg.Pool({connectionString:process.env.DATABASE_URL_WRITE_B,max:4})
  };
  const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  const jwk={...publicKey.export({format:'jwk'}),alg:'RS256',kid:'strict-staff-test',use:'sig'};
  const externalIdentity={issuer,audience,jwks:{keys:[jwk]}};
  const subjectA='strict-a-'+randomUUID(),subjectB='strict-b-'+randomUUID();
  const sign=(sub,add={})=>{
    const now=Math.floor(Date.now()/1000);
    const h=Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT',kid:jwk.kid})).toString('base64url');
    const p=Buffer.from(JSON.stringify({
      iss:issuer,aud:audience,sub,iat:now,exp:now+900,
      org_id:foreignOrg,staff_id:staffB,role:'super_admin',...add
    })).toString('base64url');
    return h+'.'+p+'.'+createSign('RSA-SHA256').update(h+'.'+p)
      .sign(privateKey).toString('base64url');
  };
  const tokenA=sign(subjectA),tokenB=sign(subjectB);
  const demoToken=()=>{
    const h=Buffer.from(JSON.stringify({typ:'JWT',alg:'HS256'})).toString('base64url');
    const now=Math.floor(Date.now()/1000);
    const p=Buffer.from(JSON.stringify({iss:'market-sales-test-issuer',aud:'market-sales-isolated',
      sub:staffA,org_id:org,iat:now,exp:now+600})).toString('base64url');
    return h+'.'+p+'.'+createHmac('sha256',secret).update(h+'.'+p).digest('base64url');
  };
  const readPools=new Map([[staffA,reads.A],[staffB,reads.B]]);
  const writePools=new Map([[staffA,writes.A],[staffB,writes.B]]);
  const app=createApp(owner,{
    secret,issuer:'market-sales-test-issuer',externalIdentity,
    strictStaffMode:true,scopedReadPools:readPools,scopedWritePools:writePools
  });
  async function grantExternal(target,subject){
    const r=await owner.query(
      "INSERT INTO ms.identity_change_requests(organization_id,action,target_staff_id,"+
      "issuer,subject,requested_by,request_evidence_ref,request_reason_zh) "+
      "VALUES($1,'bind',$2,$3,$4,$5,'虚构员工申请材料','独立复核测试员工') RETURNING id",
      [org,target,issuer,subject,manager]);
    await owner.query(
      "INSERT INTO ms.identity_change_decisions(request_id,reviewer_user_id,decision,"+
      "review_evidence_ref,reason_zh) VALUES($1,$2,'approved','二人独立复核','核验通过')",
      [r.rows[0].id,reviewer]);
    await owner.query(
      "UPDATE ms.identity_change_requests SET status='approved',decided_by=$2,decided_at=now() "+
      "WHERE id=$1",[r.rows[0].id,reviewer]);
    await owner.query(
      "INSERT INTO ms.staff_identity_bindings(staff_user_id,issuer,subject,bound_by,approval_request_id) "+
      "VALUES($1,$2,$3,$4,$5)",[target,issuer,subject,reviewer,r.rows[0].id]);
  }
  async function request(method,path,token,body,idem=key()){
    const response=await fetch('http://127.0.0.1:'+app.address().port+path,{
      method,
      headers:{
        ...(token?{Authorization:'Bearer '+token}:{}),
        ...(body!==undefined?{
          'Content-Type':'application/json',
          'Idempotency-Key':idem
        }:{})
      },
      ...(body!==undefined?{body:JSON.stringify(body)}:{})
    });
    return {status:response.status,...await response.json()};
  }
  try{
    await t.test('startup rejects owner, elevated roles, missing paired employee, duplicate identity',async()=>{
      const urlA=process.env.DATABASE_URL_ASSIGNEE_A,
        urlB=process.env.DATABASE_URL_ASSIGNEE_B,
        writeA=process.env.DATABASE_URL_WRITE_A,
        writeB=process.env.DATABASE_URL_WRITE_B;
      await assert.rejects(initializeStrictStaffPools({
        readUrlsJson:JSON.stringify([process.env.DATABASE_URL]),
        writeUrlsJson:JSON.stringify([writeA])
      }),/elevated|unscoped|refuses/i);
      await assert.rejects(initializeStrictStaffPools({
        readUrlsJson:JSON.stringify([urlA,urlB]),
        writeUrlsJson:JSON.stringify([writeA])
      }),/memberships must match/);
      await assert.rejects(initializeStrictStaffPools({
        readUrlsJson:JSON.stringify([urlA,urlA]),
        writeUrlsJson:JSON.stringify([writeA,writeB])
      }),/Duplicate or invalid employee mapping/);
      const pools=await initializeStrictStaffPools({
        readUrlsJson:JSON.stringify([urlA,urlB]),
        writeUrlsJson:JSON.stringify([writeA,writeB])
      });
      assert.equal(pools.scopedReadPools.size,2);
      assert.equal(pools.scopedWritePools.size,2);
      await pools.close();
    });
    await listen(app);
    const studentName='原路径员工A学生-'+randomUUID();
    const contactName='原路径员工A联系人-'+randomUUID();
    const student={display_name:studentName,grade_label:'测试敏感年级',school_name:'虚构学校'};
    await t.test('prior to binding, valid RSA cannot create; demo HS256 cannot create or read',async()=>{
      assert.equal((await request('POST','/api/v1/students',tokenA,student)).status,403);
      assert.equal((await request('POST','/api/v1/students',demoToken(),student)).status,403);
      assert.equal((await request('GET','/api/v1/students',demoToken())).status,403);
      assert.equal((await request('GET','/api/v1/health',null)).data.strict_employee_mode,true);
      assert.equal((await request('POST','/api/v1/dev/login',null,{
        account_code:'sales-a',passphrase:'fictional-strong-ui-demo-passphrase-0001'
      })).status,404);
      assert.equal((await owner.query('SELECT COUNT(*)::int AS n FROM ms.students WHERE display_name=$1',
        [studentName])).rows[0].n,0);
    });
    await grantExternal(staffA,subjectA);
    await grantExternal(staffB,subjectB);

    let studentId,contactId;
    await t.test('original POST /students creates OWN student and replays only same request',async()=>{
      const idem=key();
      const first=await request('POST','/api/v1/students',tokenA,student,idem);
      assert.equal(first.status,200,JSON.stringify(first));
      studentId=first.data.student_id;
      const original=await owner.query(
        'SELECT owner_user_id,organization_id,grade_label,created_by FROM ms.students WHERE id=$1',
        [studentId]);
      assert.equal(original.rows[0].owner_user_id,staffA);
      assert.equal(original.rows[0].created_by,staffA);
      assert.equal(original.rows[0].organization_id,org);
      assert.equal(original.rows[0].grade_label,'测试敏感年级');
      assert.equal(first.data.owner_display_name,'模拟销售顾问 A');
      assert.ok(!JSON.stringify(first.data).includes('测试敏感年级'));
      const again=await request('POST','/api/v1/students',tokenA,student,idem);
      assert.equal(again.status,200);
      assert.equal(again.data.student_id,studentId);
      assert.equal((await request('POST','/api/v1/students',tokenA,
        {...student,display_name:'改名'},idem)).status,409);
      const receipt=await owner.query('SELECT COUNT(*)::int AS n FROM ms.api_write_receipts '+
        'WHERE actor_user_id=$1 AND request_key=$2',[staffA,idem]);
      assert.equal(receipt.rows[0].n,0,
        'strict path must never write owner-level legacy receipts');
    });
    await t.test('strict contact POST only allows label/opt-out, not phone or client-controlled employee',async()=>{
      const r=await request('POST','/api/v1/contacts',tokenA,{
        display_name:contactName,do_not_contact:true
      });
      assert.equal(r.status,200);
      contactId=r.data.contact_id;
      const d=await owner.query(
        'SELECT created_by,do_not_contact,phone_ciphertext,wechat_ciphertext '+
        'FROM ms.contacts WHERE id=$1',[contactId]);
      assert.equal(d.rows[0].created_by,staffA);
      assert.equal(d.rows[0].do_not_contact,true);
      assert.equal(d.rows[0].phone_ciphertext,null);
      assert.equal(d.rows[0].wechat_ciphertext,null);
      assert.equal((await request('POST','/api/v1/contacts',tokenA,{
        display_name:'欺骗电话号码',phone:'13800000000'
      })).status,422);
      assert.equal((await request('POST','/api/v1/contacts',tokenA,{
        display_name:'欺骗微信',wechat_id:'wx_test'
      })).status,422);
      assert.equal((await request('POST','/api/v1/students',tokenA,{
        ...student,owner_user_id:staffB
      })).status,422);
      assert.equal((await request('POST','/api/v1/students',tokenA,{
        ...student,organization_id:foreignOrg
      })).status,422);
    });
    await t.test('two concurrent original POST requests use independent idempotency lock',async()=>{
      const idem=key(),body={display_name:'同一个学生只创建一次-'+randomUUID()};
      const result=await Promise.all([
        request('POST','/api/v1/students',tokenA,body,idem),
        request('POST','/api/v1/students',tokenA,body,idem)
      ]);
      assert.equal(result[0].status,200,JSON.stringify(result[0]));
      assert.equal(result[1].status,200,JSON.stringify(result[1]));
      assert.equal(result[0].data.student_id,result[1].data.student_id);
    });
    await t.test('signed staff tokens cannot cross employees or expand read scopes',async()=>{
      const aVisible=await request('GET','/api/v1/students',tokenA);
      const bVisible=await request('GET','/api/v1/students',tokenB);
      const aContacts=await request('GET','/api/v1/contacts',tokenA);
      const bContacts=await request('GET','/api/v1/contacts',tokenB);
      assert.equal(aVisible.status,200);assert.equal(bVisible.status,200);
      assert.ok(aVisible.data.items.some(x=>x.student_id===studentId));
      assert.ok(!bVisible.data.items.some(x=>x.student_id===studentId));
      assert.ok(aContacts.data.items.some(x=>x.contact_id===contactId));
      assert.ok(!bContacts.data.items.some(x=>x.contact_id===contactId));
      assert.ok(!JSON.stringify(aVisible.data).includes('测试敏感年级'));
      const me=await request('GET','/api/v1/me',tokenA);
      assert.equal(me.status,200);
      assert.equal(me.data.capabilities.strict_employee_mode,true);
      assert.equal(me.data.capabilities.manage_identity_requests,false);
    });
    await t.test('missing or mismatched staff pool rejects, never falls back to admin SQL',async()=>{
      writePools.delete(staffA);
      const denied=await request('POST','/api/v1/students',tokenA,{
        display_name:'不存在的错配结果-'+randomUUID()
      });
      assert.equal(denied.status,403);
      writePools.set(staffA,writes.B);
      const mismatch=await request('POST','/api/v1/contacts',tokenA,{
        display_name:'不应写入的联系人-'+randomUUID()
      });
      assert.equal(mismatch.status,403);
      writePools.set(staffA,writes.A);
      const missing=await request('GET','/api/v1/students',tokenA);
      assert.equal(missing.status,200);
    });
    await t.test('original contact-link route makes only UNVERIFIED child-specific relationship with replay protection',async()=>{
      const url='/api/v1/students/'+studentId+'/contacts';
      const body={contact_id:contactId,relation_type:'母亲',verification_state:'unverified'};
      const idem=key();
      const first=await request('POST',url,tokenA,body,idem);
      assert.equal(first.status,200,JSON.stringify(first));
      assert.equal(first.data.student_id,studentId);
      assert.equal(first.data.contact_id,contactId);
      assert.equal(first.data.verification_state,'unverified');
      const replay=await request('POST',url,tokenA,body,idem);
      assert.equal(replay.status,200);
      assert.equal(replay.data.relationship_id,first.data.relationship_id);
      const changed=await request('POST',url,tokenA,{...body,relation_type:'父亲'},idem);
      assert.equal(changed.status,409);
      const existing=await request('POST',url,tokenA,body,key());
      assert.equal(existing.status,409);
      const rejected=await Promise.all([
        request('POST',url,tokenA,{...body,verification_state:'verified'}),
        request('POST',url,tokenA,{...body,is_primary:true}),
        request('POST',url,tokenA,{...body,permission_basis_ref:'伪造核实依据'})
      ]);
      assert.ok(rejected.every(x=>x.status===422),JSON.stringify(rejected));
      const rows=await owner.query(
        'SELECT verification_state,verified_at,is_primary,permission_basis_ref '+
        'FROM ms.student_contacts WHERE id=$1',[first.data.relationship_id]);
      assert.equal(rows.rows[0].verification_state,'unverified');
      assert.equal(rows.rows[0].verified_at,null);
      assert.equal(rows.rows[0].is_primary,false);
      assert.equal(rows.rows[0].permission_basis_ref,null);
      assert.equal((await owner.query(
        'SELECT COUNT(*)::int AS n FROM ms.family_memberships WHERE student_id=$1',
        [studentId])).rows[0].n,0);
    });
    await t.test('same parent may be separately linked to two owned children, without creating a family',async()=>{
      const another=await request('POST','/api/v1/students',tokenA,
        {display_name:'家长相同但独立的另一名孩子-'+randomUUID()});
      assert.equal(another.status,200);
      const secondStudent=another.data.student_id;
      const linked=await request('POST','/api/v1/students/'+secondStudent+'/contacts',
        tokenA,{contact_id:contactId,relation_type:'母亲',verification_state:'unverified'});
      assert.equal(linked.status,200);
      const rows=await owner.query(
        'SELECT student_id FROM ms.student_contacts '+
        'WHERE contact_id=$1 AND valid_to IS NULL AND student_id=ANY($2::uuid[])',
        [contactId,[studentId,secondStudent]]);
      assert.equal(rows.rowCount,2);
      const groups=await owner.query(
        'SELECT COUNT(*)::int AS n FROM ms.family_memberships '+
        'WHERE student_id=ANY($1::uuid[]) AND revoked_at IS NULL',
        [[studentId,secondStudent]]);
      assert.equal(groups.rows[0].n,0);
      // Each consultation will remain a single contact_event, never one per child.
    });
    await t.test('sharing a student permits limited contact VIEW but NOT link/consultation ownership',async()=>{
      const bStudent=await request('POST','/api/v1/students',tokenB,
        {display_name:'销售B自己的学生-'+randomUUID()});
      assert.equal(bStudent.status,200);
      const bContact=await request('POST','/api/v1/contacts',tokenB,
        {display_name:'销售B自有联系人-'+randomUUID()});
      assert.equal(bContact.status,200);
      const g=await owner.query(
        "INSERT INTO ms.data_scope_grants(user_id,resource_type,scope_type,scope_ref,granted_by) "+
        "VALUES($1,'student','specific',$2,$3) RETURNING id",
        [staffB,studentId,manager]);
      try{
        const visible=await request('GET','/api/v1/contacts',tokenB);
        assert.equal(visible.status,200);
        assert.ok(visible.data.items.some(x=>x.contact_id===contactId),
          'B can view this contact due only to explicitly shared student');
        const wrongLink=await request('POST','/api/v1/students/'+bStudent.data.student_id+'/contacts',
          tokenB,{contact_id:contactId,relation_type:'母亲',verification_state:'unverified'});
        assert.equal(wrongLink.status,403,JSON.stringify(wrongLink));
        const wrongStudent=await request('POST','/api/v1/students/'+studentId+'/contacts',
          tokenB,{contact_id:bContact.data.contact_id,relation_type:'父亲',verification_state:'unverified'});
        assert.equal(wrongStudent.status,403);
        const wrongConsult=await request('POST','/api/v1/contact-events',tokenB,{
          contact_id:contactId,event_type:'电话咨询',
          occurred_at:new Date(Date.now()-60000).toISOString()
        });
        assert.equal(wrongConsult.status,403,JSON.stringify(wrongConsult));
      }finally{
        await owner.query('UPDATE ms.data_scope_grants SET revoked_at=now() WHERE id=$1',
          [g.rows[0].id]);
      }
    });
    await t.test('one real parent consultation counts ONCE even when contact has two children',async()=>{
      const at=new Date(Date.now()-720000).toISOString();
      const payload={contact_id:contactId,event_type:'微信咨询',occurred_at:at};
      const idem=key();
      const first=await request('POST','/api/v1/contact-events',tokenA,payload,idem);
      assert.equal(first.status,200,JSON.stringify(first));
      const second=await request('POST','/api/v1/contact-events',tokenA,payload,idem);
      assert.equal(second.status,200);
      assert.equal(first.data.event_id,second.data.event_id);
      assert.equal((await request('POST','/api/v1/contact-events',tokenA,
        {...payload,event_type:'电话咨询'},idem)).status,409);
      const e=await owner.query(
        'SELECT organization_id,contact_id,recorded_by,event_type,channel_id,campaign_id '+
        'FROM ms.contact_events WHERE id=$1',[first.data.event_id]);
      assert.equal(e.rows[0].organization_id,org);
      assert.equal(e.rows[0].contact_id,contactId);
      assert.equal(e.rows[0].recorded_by,staffA);
      assert.equal(e.rows[0].event_type,'微信咨询');
      assert.equal(e.rows[0].channel_id,null);
      assert.equal(e.rows[0].campaign_id,null);
      const once=await owner.query(
        'SELECT COUNT(*)::int AS n FROM ms.contact_events WHERE id=$1',
        [first.data.event_id]);
      assert.equal(once.rows[0].n,1);
      const countA=await request('GET','/api/v1/contact-events',tokenA);
      const countB=await request('GET','/api/v1/contact-events',tokenB);
      assert.equal(countA.status,200);assert.equal(countB.status,200);
      assert.ok(countA.data.items.some(x=>x.event_id===first.data.event_id));
      assert.ok(!countB.data.items.some(x=>x.event_id===first.data.event_id));
      const leadCount=await owner.query(
        'SELECT COUNT(*)::int AS n FROM ms.leads WHERE source_event_id=$1',
        [first.data.event_id]);
      assert.equal(leadCount.rows[0].n,0,'recording consultation does not form a lead');
    });
    await t.test('strict event type/time and contact proof privacy are validated before INSERT',async()=>{
      const now=new Date(Date.now()-60000).toISOString();
      const body={contact_id:contactId,event_type:'到店咨询',occurred_at:now};
      for(const bad of [
        {...body,event_type:'已成交'},
        {...body,occurred_at:'2020-01-01T00:00:00.000Z'},
        {...body,occurred_at:new Date(Date.now()+3600000).toISOString()},
        {...body,source_evidence_ref:'真实监护人证明'},
        {...body,student_ids:[studentId]},
        {...body,recorded_by:staffB}
      ]){
        const res=await request('POST','/api/v1/contact-events',tokenA,bad);
        assert.equal(res.status,422,JSON.stringify(res));
      }
      const wrongOrg=await request('POST','/api/v1/students/'+
        '20000000-0000-4000-8000-000000000021'+'/contacts',tokenA,
        {contact_id:contactId,relation_type:'母亲',verification_state:'unverified'});
      assert.ok([403,422].includes(wrongOrg.status));
      assert.equal((await request('POST','/api/v1/students/'+studentId+'/contacts',
        tokenA,{contact_id,relation_type:'母亲'},key())).status,409);
    });
    await t.test('concurrent consultation retries create one actual consultation; shared receipt key spans old/new writes',async()=>{
      const idem=key();
      const body={contact_id:contactId,event_type:'线上咨询',
        occurred_at:new Date(Date.now()-125000).toISOString()};
      const [x,y]=await Promise.all([
        request('POST','/api/v1/contact-events',tokenA,body,idem),
        request('POST','/api/v1/contact-events',tokenA,body,idem)
      ]);
      assert.equal(x.status,200,JSON.stringify(x));
      assert.equal(y.status,200,JSON.stringify(y));
      assert.equal(x.data.event_id,y.data.event_id);
      const newContact=await request('POST','/api/v1/contacts',tokenA,
        {display_name:'不能复用咨询编号的家长-'+randomUUID()},idem);
      assert.equal(newContact.status,409);
    });
    await t.test('DB principals cannot bypass functions by writing original student-contact/consultation tables',async()=>{
      for(const pool of [writes.A,writes.B]){
        await assert.rejects(pool.query(
          "INSERT INTO ms.student_contacts(student_id,contact_id,relation_type) "+
          "VALUES($1,$2,'母亲')",[studentId,contactId]),
          e=>e.code==='42501');
        await assert.rejects(pool.query(
          "INSERT INTO ms.contact_events(organization_id,contact_id,event_type,occurred_at) "+
          "VALUES($1,$2,'微信咨询',now())",[org,contactId]),
          e=>e.code==='42501');
        await assert.rejects(pool.query(
          'SELECT * FROM ms.family_memberships'),e=>e.code==='42501');
      }
    });
    await t.test('unmigrated finance/lead/opportunity/family write and reads are explicitly denied',async()=>{
      for(const route of [
        '/api/v1/opportunities','/api/v1/leads',
        '/api/v1/family-groups'
      ]){
        const r=await request('POST',route,tokenA,{display_name:'不应执行'});
        assert.equal(r.status,403,route+' '+JSON.stringify(r));
      }
      assert.equal((await request('GET','/api/v1/family-groups',tokenA)).status,403);
      assert.equal((await request('GET','/api/v1/identity/staff',tokenA)).status,403);
    });
    await t.test('student remains independent; financial and client link cannot be auto-created',async()=>{
      const rel=await owner.query(
        'SELECT COUNT(*)::int AS n FROM ms.family_memberships WHERE student_id=$1',
        [studentId]);
      assert.equal(rel.rows[0].n,0);
      const orders=await owner.query('SELECT COUNT(*)::int AS n FROM ms.sales_orders '+
        'WHERE student_id=$1',[studentId]);
      assert.equal(orders.rows[0].n,0);
    });
    await t.test('revoking approved employee binding immediately stops old signed token',async()=>{
      await owner.query(
        "UPDATE ms.staff_identity_bindings SET revoked_at=now() "+
        "WHERE issuer=$1 AND subject=$2 AND revoked_at IS NULL",[issuer,subjectA]);
      assert.equal((await request('POST','/api/v1/students',tokenA,{
        display_name:'撤销后不得创建'
      })).status,403);
      assert.equal((await request('GET','/api/v1/students',tokenA)).status,403);
      assert.equal((await request('GET','/api/v1/students',tokenB)).status,200);
      assert.equal((await owner.query("SELECT COUNT(*)::int AS n FROM ms.students "+
        "WHERE display_name='撤销后不得创建'")).rows[0].n,0);
    });
  }finally{
    await Promise.allSettled([app].filter(x=>x.listening).map(close));
    await Promise.all([owner.end(),...Object.values(reads).map(x=>x.end()),
      ...Object.values(writes).map(x=>x.end())]);
  }
});
