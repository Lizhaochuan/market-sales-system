import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createSign,randomUUID,randomBytes} from 'node:crypto';
import pg from 'pg';
import {createScopedLowriskWriteApi,assertScopedLowriskWriter}
  from '../../src/scoped-lowrisk-write-api.mjs';

const org='20000000-0000-4000-8000-000000000001';
const foreign='20000000-0000-4000-8000-000000000002';
const A='20000000-0000-4000-8000-000000000011';
const B='20000000-0000-4000-8000-000000000012';
const manager='20000000-0000-4000-8000-000000000013';
const reviewer='20000000-0000-4000-8000-000000000014';
const issuer='https://fictional-lowrisk-writer.example.invalid';
const audience='isolated-lowrisk-writer-test';
const key=()=>randomBytes(20).toString('hex');
const open=s=>new Promise(ok=>s.listen(0,'127.0.0.1',ok));
const close=s=>new Promise(ok=>s.close(ok));

test('V3.2-12 function-only low-risk writes: approved A/B create own student and contact without private/financial access',async t=>{
  process.env.MS_STAGE='isolated-test';
  const owner=new pg.Pool({connectionString:process.env.DATABASE_URL,max:5});
  const a=new pg.Pool({connectionString:process.env.DATABASE_URL_WRITE_A,max:3});
  const b=new pg.Pool({connectionString:process.env.DATABASE_URL_WRITE_B,max:3});
  const pair=generateKeyPairSync('rsa',{modulusLength:2048});
  const publicKey={...pair.publicKey.export({format:'jwk'}),kid:'scoped-write-test',alg:'RS256',use:'sig'};
  const externalIdentity={issuer,audience,jwks:{keys:[publicKey]}};
  const subA='write-a-'+randomUUID(),subB='write-b-'+randomUUID();
  const sign=(sub,extra={})=>{
    const now=Math.floor(Date.now()/1000);
    const h=Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT',kid:publicKey.kid})).toString('base64url');
    const p=Buffer.from(JSON.stringify({
      iss:issuer,aud:audience,sub,iat:now,exp:now+900,
      org_id:foreign,role:'super_admin',staff_id:B,...extra
    })).toString('base64url');
    return h+'.'+p+'.'+createSign('RSA-SHA256').update(h+'.'+p)
      .sign(pair.privateKey).toString('base64url');
  };
  const tokenA=sign(subA),tokenB=sign(subB);
  const appA=createScopedLowriskWriteApi(a,{externalIdentity});
  const appB=createScopedLowriskWriteApi(b,{externalIdentity});
  async function approved(target,subject){
    const x=await owner.query(
      "INSERT INTO ms.identity_change_requests(organization_id,action,target_staff_id,"+
      "issuer,subject,requested_by,request_evidence_ref,request_reason_zh) "+
      "VALUES($1,'bind',$2,$3,$4,$5,'虚构管理员材料','双主管确认身份') RETURNING id",
      [org,target,issuer,subject,manager]);
    await owner.query(
      "INSERT INTO ms.identity_change_decisions(request_id,reviewer_user_id,decision,"+
      "review_evidence_ref,reason_zh) VALUES($1,$2,'approved','第二主管复核','确认证据符合要求')",
      [x.rows[0].id,reviewer]);
    await owner.query(
      "UPDATE ms.identity_change_requests SET status='approved',decided_by=$2,decided_at=now() WHERE id=$1",
      [x.rows[0].id,reviewer]);
    await owner.query(
      "INSERT INTO ms.staff_identity_bindings(staff_user_id,issuer,subject,bound_by,approval_request_id) "+
      "VALUES($1,$2,$3,$4,$5)",[target,issuer,subject,reviewer,x.rows[0].id]);
  }
  const call=async(app,path,token,body,idem=key(),method='POST')=>{
    const r=await fetch('http://127.0.0.1:'+app.address().port+path,{
      method,headers:{
        ...(token?{Authorization:'Bearer '+token}:{}),
        'Content-Type':'application/json',
        'Idempotency-Key':idem
      },
      ...(body!==undefined?{body:JSON.stringify(body)}:{})
    });
    return {status:r.status,...await r.json()};
  };
  try{
    await t.test('restricted writer DB principal has EXECUTE only, no direct SELECT/INSERT/UPDATE',async()=>{
      for(const p of [a,b]){
        assert.equal((await assertScopedLowriskWriter(p)).restricted,true);
        await assert.rejects(p.query('SELECT * FROM ms.students'),x=>x.code==='42501');
        await assert.rejects(p.query("INSERT INTO ms.students(organization_id,display_name) VALUES($1,'bad')",[org]),
          x=>x.code==='42501');
        await assert.rejects(p.query('SELECT * FROM ms.contacts'),x=>x.code==='42501');
        await assert.rejects(p.query('SELECT * FROM ms.sales_orders'),x=>x.code==='42501');
        await assert.rejects(p.query('SELECT * FROM ms.student_access_requests'),x=>x.code==='42501');
      }
    });
    await Promise.all([open(appA),open(appB)]);
    const nameA='本人学生-'+randomUUID();
    const nameB='他人学生-'+randomUUID();
    const contactName='虚构家长-'+randomUUID();
    const payload={display_name:nameA,grade_label:'隐私年级',school_name:'虚构学校'};
    await t.test('signed but not approved identity cannot write',async()=>{
      assert.equal((await call(appA,'/api/v1/lowrisk/students',tokenA,payload)).status,403);
      const r=await owner.query('SELECT COUNT(*)::int AS n FROM ms.students WHERE display_name=$1',[nameA]);
      assert.equal(r.rows[0].n,0);
    });
    await approved(A,subA);await approved(B,subB);

    let studentId,contactId;
    await t.test('student owner is database LOGIN A, not forged role/organization claims',async()=>{
      const idem=key();
      const r=await call(appA,'/api/v1/lowrisk/students',tokenA,payload,idem);
      assert.equal(r.status,200);studentId=r.data.student_id;
      assert.equal(r.data.display_name,nameA);
      assert.ok(!JSON.stringify(r.data).includes('隐私年级'));
      const record=await owner.query(
        "SELECT organization_id,owner_user_id,created_by,grade_label "+
        "FROM ms.students WHERE id=$1",[studentId]);
      assert.equal(record.rows[0].organization_id,org);
      assert.equal(record.rows[0].owner_user_id,A);
      assert.equal(record.rows[0].created_by,A);
      assert.equal(record.rows[0].grade_label,'隐私年级');
      const again=await call(appA,'/api/v1/lowrisk/students',tokenA,payload,idem);
      assert.equal(again.status,200);assert.equal(again.data.student_id,studentId);
      const conflict=await call(appA,'/api/v1/lowrisk/students',tokenA,
        {...payload,display_name:nameB},idem);
      assert.equal(conflict.status,409);
      const otherOp=await call(appA,'/api/v1/lowrisk/contacts',tokenA,
        {display_name:contactName},idem);
      assert.equal(otherOp.status,409);
      const exact=await owner.query('SELECT COUNT(*)::int AS n FROM ms.students WHERE id=$1',[studentId]);
      assert.equal(exact.rows[0].n,1);
    });
    await t.test('two simultaneous identical creates with same key are serialized in DB',async()=>{
      const idem=key(),data={display_name:'并发虚构学生-'+randomUUID()};
      const results=await Promise.all([
        call(appA,'/api/v1/lowrisk/students',tokenA,data,idem),
        call(appA,'/api/v1/lowrisk/students',tokenA,data,idem)
      ]);
      assert.equal(results[0].status,200);
      assert.equal(results[1].status,200);
      assert.equal(results[0].data.student_id,results[1].data.student_id);
      const n=await owner.query(
        "SELECT COUNT(*)::int AS n FROM ms.students WHERE id=$1",
        [results[0].data.student_id]);
      assert.equal(n.rows[0].n,1);
    });
    await t.test('contact creation never accepts phone or WeChat, honors do-not-contact',async()=>{
      const d={display_name:contactName,do_not_contact:true};
      const r=await call(appA,'/api/v1/lowrisk/contacts',tokenA,d);
      assert.equal(r.status,200);contactId=r.data.contact_id;
      const record=await owner.query(
        "SELECT organization_id,created_by,do_not_contact,"+
        "phone_ciphertext,wechat_ciphertext FROM ms.contacts WHERE id=$1",
        [contactId]);
      assert.equal(record.rows[0].organization_id,org);
      assert.equal(record.rows[0].created_by,A);
      assert.equal(record.rows[0].do_not_contact,true);
      assert.equal(record.rows[0].phone_ciphertext,null);
      assert.equal(record.rows[0].wechat_ciphertext,null);
      assert.equal((await call(appA,'/api/v1/lowrisk/contacts',tokenA,
        {...d,phone:'13800000000'})).status,422);
      assert.equal((await call(appA,'/api/v1/lowrisk/contacts',tokenA,
        {...d,wechat_id:'test-id'})).status,422);
      assert.equal((await call(appA,'/api/v1/lowrisk/students',tokenA,
        {...payload,owner_user_id:B})).status,422);
    });
    await t.test('second employee token and database scope cannot impersonate A',async()=>{
      assert.equal((await call(appB,'/api/v1/lowrisk/students',tokenA,
        {display_name:'冒名新建'})).status,403);
      const bResult=await call(appB,'/api/v1/lowrisk/students',tokenB,
        {display_name:nameB});
      assert.equal(bResult.status,200);
      const who=await owner.query('SELECT owner_user_id FROM ms.students WHERE id=$1',
        [bResult.data.student_id]);
      assert.equal(who.rows[0].owner_user_id,B);
      assert.equal((await call(appA,'/api/v1/lowrisk/students',tokenB,
        {display_name:'交换令牌'})).status,403);
    });
    await t.test('no new family, audited summaries are Chinese and no financial rows written',async()=>{
      const family=await owner.query(
        'SELECT COUNT(*)::int AS n FROM ms.family_memberships WHERE student_id=$1',
        [studentId]);
      assert.equal(family.rows[0].n,0);
      const audit=await owner.query(
        'SELECT event_name,reason_zh,after_business_json FROM ms.audit_events '+
        "WHERE target_id=ANY($1::uuid[]) ORDER BY happened_at",
        [[studentId,contactId]]);
      assert.equal(audit.rowCount,2);
      assert.ok(audit.rows.every(x=>x.reason_zh.includes('已')));
      assert.ok(!JSON.stringify(audit.rows).includes('13800000000'));
    });
    await t.test('arbitrary write methods and finance/CRM paths remain closed',async()=>{
      assert.equal((await call(appA,'/api/v1/lowrisk/finance',tokenA,payload)).status,404);
      assert.equal((await call(appA,'/api/v1/lowrisk/students',tokenA,
        undefined,key(),'GET')).status,404);
      assert.equal((await call(appA,'/api/v1/lowrisk/students?org_id='+foreign,
        tokenA,payload)).status,404);
    });
    await t.test('revoked external binding immediately denies write using old RSA token',async()=>{
      await owner.query(
        "UPDATE ms.staff_identity_bindings SET revoked_at=now() "+
        "WHERE issuer=$1 AND subject=$2 AND revoked_at IS NULL",[issuer,subA]);
      assert.equal((await call(appA,'/api/v1/lowrisk/students',tokenA,
        {display_name:'不应创建的学生'})).status,403);
      const n=await owner.query(
        "SELECT COUNT(*)::int AS n FROM ms.students WHERE display_name='不应创建的学生'");
      assert.equal(n.rows[0].n,0);
    });
  }finally{
    await Promise.allSettled([appA,appB].filter(s=>s.listening).map(close));
    await Promise.all([owner.end(),a.end(),b.end()]);
  }
});
