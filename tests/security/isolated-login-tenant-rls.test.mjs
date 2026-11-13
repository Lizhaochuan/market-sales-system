import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac, randomBytes} from 'node:crypto';
import pg from 'pg';
import {createApp} from '../../src/app.mjs';
import {assertRestrictedRuntime} from '../../src/runtime-preflight.mjs';

const secret='fictional-test-only-strong-token-secret-9c92789dc3b9';
const demoPass='fictional-strong-ui-demo-passphrase-0001';
const issuer='market-sales-test-issuer';
const demoOrg='20000000-0000-4000-8000-000000000001';
const randomKey=()=>randomBytes(20).toString('hex');

function signedDemoToken(staff,org){
  const now=Math.floor(Date.now()/1000);
  const h=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
  const p=Buffer.from(JSON.stringify({sub:staff,org_id:org,iss:issuer,
    aud:'market-sales-isolated',iat:now,exp:now+1800})).toString('base64url');
  const sig=createHmac('sha256',secret).update(h+'.'+p).digest('base64url');
  return h+'.'+p+'.'+sig;
}
test('V3.2-05 real nonowner LOGIN role with isolated HTTP tenant RLS and finance denial',async t=>{
  process.env.MS_STAGE='isolated-test';
  assert.ok(process.env.DATABASE_URL_RESTRICTED,'Restricted CI LOGIN connection required');
  const owner=new pg.Pool({connectionString:process.env.DATABASE_URL,max:5});
  const restricted=new pg.Pool({connectionString:process.env.DATABASE_URL_RESTRICTED,max:5});
  const app=createApp(restricted,{secret,issuer,devLoginSecret:demoPass});
  await new Promise(ok=>app.listen(0,'127.0.0.1',ok));
  const base='http://127.0.0.1:'+app.address().port;
  async function invoke(method,path,token,body){
    const headers={...(token?{Authorization:'Bearer '+token}:{})};
    if(body!==undefined){
      headers['Content-Type']='application/json';
      headers['Idempotency-Key']=randomKey();
    }
    const r=await fetch(base+path,{method,headers,
      ...(body!==undefined?{body:JSON.stringify(body)}:{})});
    return {status:r.status,...await r.json()};
  }
  let otherOrg,otherStaff;
  try{
    await t.test('application login really uses a nonowner, non-superuser, non-BYPASSRLS principal',async()=>{
      const q=await restricted.query(
        "SELECT current_user AS current_role,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole "+
        "FROM pg_roles WHERE rolname=current_user");
      assert.equal(q.rows[0].current_role,'ms_isolated_api');
      assert.equal(q.rows[0].rolsuper,false);
      assert.equal(q.rows[0].rolbypassrls,false);
      assert.equal(q.rows[0].rolcreatedb,false);
      assert.equal(q.rows[0].rolcreaterole,false);
      const priv=await restricted.query(
        "SELECT has_table_privilege(current_user,'ms.sales_orders','SELECT') AS finance,"+
        "has_table_privilege(current_user,'ms.staff_users','UPDATE') AS can_suspend,"+
        "has_schema_privilege(current_user,'ms','CREATE') AS can_create");
      assert.equal(priv.rows[0].finance,false);
      assert.equal(priv.rows[0].can_suspend,false);
      assert.equal(priv.rows[0].can_create,false);
    });
    await t.test('fail-closed startup gate accepts runtime login but rejects database owner',async()=>{
      const acceptable=await assertRestrictedRuntime(restricted);
      assert.equal(acceptable.role,'ms_isolated_api');
      await assert.rejects(assertRestrictedRuntime(owner),
        e=>e.message.includes('owner/elevated DB credentials'));
    });
    await t.test('RLS hides unscoped student rows from direct restricted LOGIN',async()=>{
      const r=await restricted.query('SELECT count(*)::int AS total FROM ms.students');
      assert.equal(r.rows[0].total,0);
    });
    const aLogin=await invoke('POST','/api/v1/dev/login',null,
      {account_code:'sales-a',passphrase:demoPass});
    assert.equal(aLogin.status,200);
    const aToken=aLogin.data.token;
    let studentA,studentB;
    await t.test('tenant A can create and list own student and contact over real restricted API',async()=>{
      const st=await invoke('POST','/api/v1/students',aToken,
        {display_name:'A机构虚构隔离学生',grade_label:'三年级'});
      assert.equal(st.status,200);studentA=st.data.student_id;
      const contact=await invoke('POST','/api/v1/contacts',aToken,
        {display_name:'A机构虚构联系人'});
      assert.equal(contact.status,200);
      const list=await invoke('GET','/api/v1/students',aToken);
      assert.equal(list.status,200);
      assert.ok(list.data.items.some(x=>x.student_id===studentA));
    });
    await t.test('create a different fictional organization and employee as migration owner only',async()=>{
      const o=await owner.query("INSERT INTO ms.organizations(name) VALUES('独立虚构B机构') RETURNING id");
      otherOrg=o.rows[0].id;
      const u=await owner.query(
        "INSERT INTO ms.staff_users(organization_id,display_name,status) "+
        "VALUES($1,'B机构虚构员工','active') RETURNING id",[otherOrg]);
      otherStaff=u.rows[0].id;
      assert.notEqual(otherOrg,demoOrg);
    });
    const bToken=signedDemoToken(otherStaff,otherOrg);
    await t.test('tenant B can write its own student but not see tenant A through HTTP',async()=>{
      const added=await invoke('POST','/api/v1/students',bToken,
        {display_name:'B机构虚构隔离学生',grade_label:'一年级'});
      assert.equal(added.status,200);studentB=added.data.student_id;
      const a=await invoke('GET','/api/v1/students',aToken);
      const b=await invoke('GET','/api/v1/students',bToken);
      assert.equal(a.status,200);assert.equal(b.status,200);
      assert.ok(a.data.items.some(x=>x.student_id===studentA));
      assert.ok(!a.data.items.some(x=>x.student_id===studentB));
      assert.ok(b.data.items.some(x=>x.student_id===studentB));
      assert.ok(!b.data.items.some(x=>x.student_id===studentA));
      assert.equal((await invoke('GET','/api/v1/students/'+studentB,aToken)).status,404);
    });
    await t.test('direct restricted SQL obeys RLS row filter and write WITH CHECK',async()=>{
      const c=await restricted.connect();
      try{
        await c.query('BEGIN');
        await c.query("SELECT set_config('ms.tenant_org',$1,true)",[demoOrg]);
        const read=await c.query("SELECT id FROM ms.students WHERE id=ANY($1::uuid[])",[[studentA,studentB]]);
        assert.deepEqual(read.rows.map(r=>r.id),[studentA]);
        await assert.rejects(
          c.query("INSERT INTO ms.students(organization_id,display_name,owner_user_id) "+
            "VALUES($1,'伪造B机构学生',$2)",[otherOrg,otherStaff]),
          e=>e.code==='42501');
      }finally{
        await c.query('ROLLBACK');c.release();
      }
    });
    await t.test('pooled HTTP transaction does not leak organization scope after completion',async()=>{
      const direct=await restricted.query('SELECT count(*)::int AS total FROM ms.students');
      assert.equal(direct.rows[0].total,0);
      const a=await invoke('GET','/api/v1/students',aToken);
      assert.equal(a.status,200);
      assert.ok(!a.data.items.some(x=>x.student_id===studentB));
    });
    await t.test('DB role blocks finance, staff edits and unaudited identity writes',async()=>{
      await assert.rejects(restricted.query('SELECT * FROM ms.sales_orders LIMIT 1'),e=>e.code==='42501');
      await assert.rejects(restricted.query("UPDATE ms.staff_users SET status='disabled' WHERE false"),
        e=>e.code==='42501');
      await assert.rejects(restricted.query(
        "INSERT INTO ms.staff_identity_bindings(staff_user_id,issuer,subject,bound_by) "+
        "VALUES($1,'https://unapproved.example.invalid','unapproved-login-test',$2)",
        ['20000000-0000-4000-8000-000000000011',
         '20000000-0000-4000-8000-000000000013']),
        e=>['23514','42501'].includes(e.code));
    });
  } finally{
    await new Promise(ok=>app.close(ok));
    await restricted.end();await owner.end();
  }
});
