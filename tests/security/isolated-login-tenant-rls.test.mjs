import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomBytes} from 'node:crypto';
import pg from 'pg';
import {createApp} from '../../src/app.mjs';
import {assertRestrictedRuntime} from '../../src/runtime-preflight.mjs';

const secret='fictional-test-only-strong-token-secret-9c92789dc3b9';
const demoPass='fictional-strong-ui-demo-passphrase-0001';
const issuer='market-sales-test-issuer';
const orgA='20000000-0000-4000-8000-000000000001';
const orgB='20000000-0000-4000-8000-000000000002';
const bStaff='20000000-0000-4000-8000-000000000021';

function signedTestToken(staff,org){
  const now=Math.floor(Date.now()/1000);
  const h=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
  const p=Buffer.from(JSON.stringify({sub:staff,org_id:org,iss:issuer,
    aud:'market-sales-isolated',iat:now,exp:now+1800})).toString('base64url');
  return h+'.'+p+'.'+createHmac('sha256',secret).update(h+'.'+p).digest('base64url');
}
const key=()=>randomBytes(22).toString('hex');
async function request(base,method,path,token,body){
  const headers={...(token?{Authorization:'Bearer '+token}:{})};
  if(body!==undefined){
    headers['Content-Type']='application/json';
    headers['Idempotency-Key']=key();
  }
  const res=await fetch(base+path,{method,headers,
    ...(body!==undefined?{body:JSON.stringify(body)}:{})});
  return {status:res.status,...await res.json()};
}
test('V3.2-06 protected SESSION_USER tenant mapping: 2 real separate nonowner app logins',async t=>{
  process.env.MS_STAGE='isolated-test';
  assert.ok(process.env.DATABASE_URL_RESTRICTED);
  assert.ok(process.env.DATABASE_URL_RESTRICTED_B);
  const owner=new pg.Pool({connectionString:process.env.DATABASE_URL,max:3});
  const poolA=new pg.Pool({connectionString:process.env.DATABASE_URL_RESTRICTED,max:5});
  const poolB=new pg.Pool({connectionString:process.env.DATABASE_URL_RESTRICTED_B,max:5});
  const appA=createApp(poolA,{secret,issuer,devLoginSecret:demoPass});
  const appB=createApp(poolB,{secret,issuer,devLoginSecret:demoPass});
  await Promise.all([new Promise(r=>appA.listen(0,'127.0.0.1',r)),
    new Promise(r=>appB.listen(0,'127.0.0.1',r))]);
  const a='http://127.0.0.1:'+appA.address().port;
  const b='http://127.0.0.1:'+appB.address().port;
  const tokenB=signedTestToken(bStaff,orgB);
  let studentA,studentB,contactA,contactB;
  try{
    await t.test('distinct nonowner logins have fixed, non-spoofable tenant mappings',async()=>{
      const x=await assertRestrictedRuntime(poolA),y=await assertRestrictedRuntime(poolB);
      assert.equal(x.role,'ms_isolated_api');assert.equal(x.tenant_id,orgA);
      assert.equal(y.role,'ms_isolated_api_b');assert.equal(y.tenant_id,orgB);
      assert.equal(x.protected_table_count,24);assert.equal(y.protected_table_count,24);
      await assert.rejects(assertRestrictedRuntime(owner),/DB owner\/elevated or unmapped tenant LOGIN/);
    });
    await t.test('owner-installed policies cover all 24 low-risk granted tables and exclude GUC',async()=>{
      const p=await owner.query(
        "SELECT tablename,policyname,qual,with_check FROM pg_policies "+
        "WHERE schemaname='ms' AND policyname LIKE '%_principal_tenant'");
      assert.equal(p.rowCount,24);
      assert.ok(p.rows.every(x=>!JSON.stringify(x).includes('ms.tenant_org')));
      const q=await owner.query(
        "SELECT count(*)::int AS count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "+
        "WHERE n.nspname='ms' AND c.relrowsecurity");
      assert.ok(q.rows[0].count>=24);
    });
    await t.test('A employee demo sign-in works only against A database principal',async()=>{
      const signed=await request(a,'POST','/api/v1/dev/login',null,
        {account_code:'sales-a',passphrase:demoPass});
      assert.equal(signed.status,200);
      const tokenA=signed.data.token;
      t.tokenA=tokenA;
      assert.equal((await request(b,'GET','/api/v1/me',tokenA)).status,403);
      assert.equal((await request(a,'GET','/api/v1/me',tokenB)).status,403);
      assert.equal((await request(b,'GET','/api/v1/me',tokenB)).data.organization_id,orgB);
    });
    await t.test('A and B separately create students and contacts through their own HTTP services',async()=>{
      const stA=await request(a,'POST','/api/v1/students',t.tokenA,
        {display_name:'虚构A机构学生',grade_label:'三年级'});
      const stB=await request(b,'POST','/api/v1/students',tokenB,
        {display_name:'虚构B机构学生',grade_label:'六年级'});
      assert.equal(stA.status,200);assert.equal(stB.status,200);
      studentA=stA.data.student_id;studentB=stB.data.student_id;
      const coA=await request(a,'POST','/api/v1/contacts',t.tokenA,
        {display_name:'虚构A机构联系人'});
      const coB=await request(b,'POST','/api/v1/contacts',tokenB,
        {display_name:'虚构B机构联系人'});
      assert.equal(coA.status,200);assert.equal(coB.status,200);
      contactA=coA.data.contact_id;contactB=coB.data.contact_id;
      const lA=await request(a,'POST','/api/v1/students/'+studentA+'/contacts',t.tokenA,
        {contact_id:contactA,relation_type:'母亲'});
      const lB=await request(b,'POST','/api/v1/students/'+studentB+'/contacts',tokenB,
        {contact_id:contactB,relation_type:'父亲'});
      assert.equal(lA.status,200);assert.equal(lB.status,200);
    });
    await t.test('separate login cannot read other tenant through core HTTP lists or staff tables',async()=>{
      const aRows=(await request(a,'GET','/api/v1/students',t.tokenA)).data.items;
      const bRows=(await request(b,'GET','/api/v1/students',tokenB)).data.items;
      assert.ok(aRows.some(x=>x.student_id===studentA));
      assert.ok(!aRows.some(x=>x.student_id===studentB));
      assert.ok(bRows.some(x=>x.student_id===studentB));
      assert.ok(!bRows.some(x=>x.student_id===studentA));
      const [aStaff,bStaffRows]=await Promise.all([
        poolA.query('SELECT organization_id FROM ms.staff_users'),
        poolB.query('SELECT organization_id FROM ms.staff_users')]);
      assert.ok(aStaff.rows.length>=4&&aStaff.rows.every(x=>x.organization_id===orgA));
      assert.ok(bStaffRows.rows.length>=1&&bStaffRows.rows.every(x=>x.organization_id===orgB));
      const [aContacts,bContacts]=await Promise.all([
        poolA.query('SELECT id FROM ms.contacts'),poolB.query('SELECT id FROM ms.contacts')]);
      assert.ok(aContacts.rows.some(x=>x.id===contactA));
      assert.ok(!aContacts.rows.some(x=>x.id===contactB));
      assert.ok(bContacts.rows.some(x=>x.id===contactB));
      assert.ok(!bContacts.rows.some(x=>x.id===contactA));
    });
    await t.test('direct parent/child relation lists enforce tenant, not just API filtering',async()=>{
      const [aR,bR]=await Promise.all([
        poolA.query('SELECT contact_id FROM ms.student_contacts'),
        poolB.query('SELECT contact_id FROM ms.student_contacts')]);
      assert.ok(aR.rows.some(x=>x.contact_id===contactA));
      assert.ok(!aR.rows.some(x=>x.contact_id===contactB));
      assert.ok(bR.rows.some(x=>x.contact_id===contactB));
      assert.ok(!bR.rows.some(x=>x.contact_id===contactA));
      const rolesB=await poolB.query('SELECT * FROM ms.user_role_grants');
      assert.equal(rolesB.rowCount,0);
      const rolesA=await poolA.query('SELECT * FROM ms.user_role_grants');
      assert.ok(rolesA.rowCount>=2);
    });
    await t.test('forging former ms.tenant_org GUC cannot reveal A data from B login',async()=>{
      const c=await poolB.connect();
      try{
        await c.query('BEGIN');
        await c.query("SELECT set_config('ms.tenant_org',$1,true)",[orgA]);
        const mapped=await c.query('SELECT ms.current_database_tenant() AS tenant');
        assert.equal(mapped.rows[0].tenant,orgB);
        const rows=await c.query('SELECT id FROM ms.students');
        assert.ok(rows.rows.some(x=>x.id===studentB));
        assert.ok(!rows.rows.some(x=>x.id===studentA));
        await assert.rejects(
          c.query("INSERT INTO ms.students(organization_id,display_name,owner_user_id) "+
            "VALUES($1,'跨机构假学生',$2)",[orgA,bStaff]),
          e=>e.code==='42501');
      }finally{await c.query('ROLLBACK');c.release();}
    });
    await t.test('SET ROLE still keeps original LOGIN tenant and cannot impersonate other login',async()=>{
      const c=await poolB.connect();
      try{
        await c.query('BEGIN');
        await c.query('SET LOCAL ROLE ms_lowrisk_runtime');
        const r=await c.query('SELECT current_user AS role,session_user AS login,ms.current_database_tenant() AS org');
        assert.equal(r.rows[0].role,'ms_lowrisk_runtime');
        assert.equal(r.rows[0].login,'ms_isolated_api_b');
        assert.equal(r.rows[0].org,orgB);
        const rows=await c.query('SELECT id FROM ms.students');
        assert.ok(!rows.rows.some(x=>x.id===studentA));
      }finally{await c.query('ROLLBACK');c.release();}
    });
    await t.test('tenant identity mapping is neither readable nor writable by either runtime login',async()=>{
      for(const pool of [poolA,poolB]){
        await assert.rejects(pool.query('SELECT * FROM ms.database_principal_tenants'),e=>e.code==='42501');
        await assert.rejects(pool.query("UPDATE ms.database_principal_tenants SET principal_name=principal_name WHERE false"),
          e=>e.code==='42501');
        await assert.rejects(pool.query('SELECT * FROM ms.sales_orders LIMIT 1'),e=>e.code==='42501');
        await assert.rejects(pool.query("UPDATE ms.staff_users SET status='disabled' WHERE false"),e=>e.code==='42501');
      }
    });
    await t.test('linking a foreign contact to local student is rejected by child RLS',async()=>{
      await assert.rejects(poolB.query(
        "INSERT INTO ms.student_contacts(student_id,contact_id,relation_type) VALUES($1,$2,'父亲')",
        [studentB,contactA]),e=>e.code==='42501');
    });
    await t.test('pooled queries retain their original tenant without transaction GUC setup',async()=>{
      const bRows=await poolB.query('SELECT id FROM ms.students');
      assert.ok(bRows.rows.some(x=>x.id===studentB));
      assert.ok(!bRows.rows.some(x=>x.id===studentA));
      const aRows=await poolA.query('SELECT id FROM ms.students');
      assert.ok(!aRows.rows.some(x=>x.id===studentB));
    });
  } finally {
    await Promise.all([new Promise(r=>appA.close(r)),new Promise(r=>appB.close(r))]);
    await Promise.all([poolA.end(),poolB.end(),owner.end()]);
  }
});
