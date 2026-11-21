import test from 'node:test';
import assert from 'node:assert/strict';
import {createSign,generateKeyPairSync,randomUUID} from 'node:crypto';
import pg from 'pg';
import {readFile} from 'node:fs/promises';
import {createApp} from '../../src/app.mjs';
import {
  assertStrictIdentityDirectory,resolveStrictDirectoryContext
} from '../../src/strict-auth-directory.mjs';

const org='20000000-0000-4000-8000-000000000001';
const studentOwner='20000000-0000-4000-8000-000000000011';
const manager='20000000-0000-4000-8000-000000000013';
const reviewer='20000000-0000-4000-8000-000000000014';
const issuer='https://fictional-strict-auth.example.invalid';
const audience='isolated-strict-auth-directory';
const listen=s=>new Promise(done=>s.listen(0,'127.0.0.1',done));
const close=s=>new Promise(done=>s.close(done));

test('V3.2-15 strict auth directory: nonowner function-only, no legacy DB query, live approved binding',async t=>{
  process.env.MS_STAGE='isolated-test';
  const admin=new pg.Pool({connectionString:process.env.DATABASE_URL,max:3});
  const directory=new pg.Pool({connectionString:process.env.DATABASE_URL_AUTH_DIRECTORY,max:3});
  const readA=new pg.Pool({connectionString:process.env.DATABASE_URL_ASSIGNEE_A,max:2});
  const writeA=new pg.Pool({connectionString:process.env.DATABASE_URL_WRITE_A,max:2});
  const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  const jwk={...publicKey.export({format:'jwk'}),kid:'fictional-strict-dir',alg:'RS256',use:'sig'};
  const externalIdentity={issuer,audience,jwks:{keys:[jwk]}};
  const subj='strict-dir-a-'+randomUUID();
  let ownerTouches=0;
  const forbiddenOldPool={connect(){ownerTouches++;throw Error('STRICT MODE BROAD POOL ACCESS');}};
  function sign(sub,extra={}){
    const now=Math.floor(Date.now()/1000);
    const h=Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT',kid:jwk.kid})).toString('base64url');
    const p=Buffer.from(JSON.stringify({
      iss:issuer,aud:audience,sub,iat:now,exp:now+900,
      org_id:'20000000-0000-4000-8000-000000000002',
      role:'super_admin',staff_id:reviewer,...extra
    })).toString('base64url');
    return h+'.'+p+'.'+createSign('RSA-SHA256').update(h+'.'+p)
      .sign(privateKey).toString('base64url');
  }
  const token=sign(subj),app=createApp(forbiddenOldPool,{
    secret:'fictional-auth-directory-stub-test-secret-128-bits-plus',
    externalIdentity,strictStaffMode:true,
    identityDirectoryPool:directory,
    scopedReadPools:new Map([[studentOwner,readA]]),
    scopedWritePools:new Map([[studentOwner,writeA]])
  });
  const request=async(path,credential=token)=>{
    const r=await fetch('http://127.0.0.1:'+app.address().port+path,{
      headers:credential?{Authorization:'Bearer '+credential}:{}
    });
    return {status:r.status,...await r.json()};
  };
  try{
    await t.test('real function-only auth login cannot SELECT staff, grants, bindings, finance, customer, or UPDATE audit',async()=>{
      const ok=await assertStrictIdentityDirectory(directory);
      assert.equal(ok.restricted,true);
      await assert.rejects(assertStrictIdentityDirectory(admin),/privileged or raw-table/);
      for(const table of ['ms.staff_users','ms.user_role_grants',
        'ms.role_templates','ms.staff_identity_bindings','ms.identity_change_requests',
        'ms.identity_change_decisions','ms.students','ms.contacts','ms.sales_orders']){
        await assert.rejects(directory.query('SELECT * FROM '+table+' LIMIT 1'),
          error=>error.code==='42501',table+' must be unreadable');
      }
      await assert.rejects(directory.query(
        "UPDATE ms.audit_events SET reason_zh='未经授权' WHERE FALSE"),
        error=>error.code==='42501');
    });
    await t.test('unknown and unapproved bindings project no staff or roles',async()=>{
      assert.equal((await directory.query(
        'SELECT * FROM ms.resolve_strict_verified_staff($1,$2)',
        [issuer,subj])).rowCount,0);
      await assert.rejects(resolveStrictDirectoryContext(directory,{
        issuer,subject:subj
      }),error=>error.status===403);
    });
    await listen(app);
    await t.test('RSA signed but unapproved identity refused without touching the legacy owner pool',async()=>{
      const got=await request('/api/v1/me');
      assert.equal(got.status,403);
      assert.equal(ownerTouches,0);
      assert.equal((await request('/api/v1/me',sign('not-approved-'+randomUUID()))).status,403);
    });
    const pending=await admin.query(
      "INSERT INTO ms.identity_change_requests(organization_id,action,target_staff_id,issuer,"+
      "subject,requested_by,request_evidence_ref,request_reason_zh) "+
      "VALUES($1,'bind',$2,$3,$4,$5,'虚构独立身份材料','批准本机隔离员工') RETURNING id",
      [org,studentOwner,issuer,subj,manager]);
    await admin.query(
      "INSERT INTO ms.identity_change_decisions(request_id,reviewer_user_id,decision,"+
      "review_evidence_ref,reason_zh) VALUES($1,$2,'approved','独立主管审查材料','已核验测试身份')",
      [pending.rows[0].id,reviewer]);
    await admin.query(
      "UPDATE ms.identity_change_requests SET status='approved',decided_by=$2,"+
      "decided_at=now() WHERE id=$1",[pending.rows[0].id,reviewer]);
    await admin.query(
      "INSERT INTO ms.staff_identity_bindings(staff_user_id,issuer,subject,bound_by,approval_request_id) "+
      "VALUES($1,$2,$3,$4,$5)",
      [studentOwner,issuer,subj,reviewer,pending.rows[0].id]);
    await t.test('approved staff cannot enter the Sales demo workflow or demo sign-in through strict auth',async()=>{
      const response=await request('/api/v1/isolated-workspace/workflow');
      assert.equal(response.status,404);
      assert.equal(response.code,'NOT_FOUND');
      const demo=await fetch('http://127.0.0.1:'+app.address().port+'/api/v1/dev/login',{
        method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({account_code:'sales-a',passphrase:'0'})
      });
      assert.equal(demo.status,404);
      assert.equal(ownerTouches,0);
    });
    await t.test('only approved actual employee roles returned; JWT super_admin/foreign org claims ignored',async()=>{
      const ctx=await resolveStrictDirectoryContext(directory,{issuer,subject:subj});
      assert.equal(ctx.user.id,studentOwner);
      assert.equal(ctx.user.organization_id,org);
      assert.equal(ctx.user.display_name,'模拟销售顾问 A');
      assert.equal(ctx.manager,false);
      assert.ok(!ctx.roles.includes('super_admin'));
      const me=await request('/api/v1/me');
      assert.equal(me.status,200,JSON.stringify(me));
      assert.equal(me.data.staff_id,studentOwner);
      assert.equal(me.data.organization_id,org);
      assert.equal(me.data.capabilities.manage_identity_requests,false);
      assert.equal(me.data.capabilities.strict_employee_mode,true);
      assert.equal(ownerTouches,0);
    });
    await t.test('same signed employee can only read own customer directory via SECOND function-only login',async()=>{
      const s=await request('/api/v1/students');
      const c=await request('/api/v1/contacts');
      assert.equal(s.status,200,JSON.stringify(s));
      assert.equal(c.status,200,JSON.stringify(c));
      assert.equal(ownerTouches,0);
    });
    await t.test('mobile tasks only expose active rows owned by the authenticated adviser',async()=>{
      for(const [version,file] of [[34,'039_v34_sales_loop.sql'],[42,'047_scoped_mobile_tasks.sql']]){
        const table=(await admin.query("SELECT to_regclass('ms_workspace.schema_versions') AS t")).rows[0].t;
        if(!table||!(await admin.query('SELECT 1 FROM ms_workspace.schema_versions WHERE version=$1',[version])).rowCount)
          await admin.query(await readFile(new URL('../../db/workspace-migrations/'+file,import.meta.url),'utf8'));
      }
      const client=await admin.connect(),leads=[];
      let newGrant;

      try{
        await client.query('BEGIN');
        await client.query("INSERT INTO ms.role_templates(organization_id,role_code,label_zh) VALUES($1,'sales_staff','虚构销售') ON CONFLICT DO NOTHING",[org]);
        newGrant=(await client.query(`INSERT INTO ms.user_role_grants(user_id,role_id,granted_by)
          SELECT $1,r.id,$2 FROM ms.role_templates r
          WHERE r.organization_id=$3 AND r.role_code='sales_staff'
           AND NOT EXISTS(SELECT 1 FROM ms.user_role_grants g WHERE g.user_id=$1 AND g.role_id=r.id AND g.revoked_at IS NULL)
          RETURNING id`,[studentOwner,reviewer,org])).rows[0]?.id;
        for(const owner of [studentOwner,'20000000-0000-4000-8000-000000000012']){
          const lead=randomUUID(), task=randomUUID();
          leads.push(lead);
          await client.query('INSERT INTO ms.leads(id,organization_id,owner_user_id) VALUES($1,$2,$3)',[lead,org,owner]);
          await client.query("INSERT INTO ms_workspace.records(id,lead_id,organization_id,owner_user_id,kind,state,body) VALUES($1,$2,$3,$4,'tasks','open',$5)",
            [task,lead,org,owner,{title:'虚构待办',due_at:'2099-01-01T01:00:00.000Z',method:'phone',action:'call',internal_note:'不应投影'}]);
          await client.query('INSERT INTO ms_workspace.lead_workflow(lead_id,organization_id,primary_activity_id) VALUES($1,$2,$3)',[lead,org,task]);
        }
        await client.query('COMMIT');
        const result=await request('/api/v1/mobile/tasks');
        assert.equal(result.status,200,JSON.stringify(result));
        const own=result.data.items.find(item=>item.lead_id===leads[0]);
        assert.ok(own);
        assert.equal(Object.hasOwn(own,'internal_note'),false);
        assert.ok(!result.data.items.some(item=>item.lead_id===leads[1]));
        assert.equal(ownerTouches,0);
        await assert.rejects(readA.query('SELECT body FROM ms_workspace.records'),error=>error.code==='42501');
      }finally{
        await client.query('ROLLBACK');
        for(const table of ['ms_workspace.lead_workflow','ms_workspace.records'])
          await client.query('DELETE FROM '+table+' WHERE lead_id=ANY($1::uuid[])',[leads]);
        await client.query('DELETE FROM ms.leads WHERE id=ANY($1::uuid[])',[leads]);
        if(newGrant)await client.query('DELETE FROM ms.user_role_grants WHERE id=$1',[newGrant]);
        client.release();
      }
    });
    await t.test('wrong audience/issuer/signature do not reach directory or old pool',async()=>{
      const wrong=await request('/api/v1/me',sign(subj,{aud:'another-api'}));
      assert.equal(wrong.status,401);
      assert.equal((await request('/api/v1/me',sign(subj,{iss:'https://other.invalid'}))).status,401);
      assert.equal(ownerTouches,0);
    });
    await t.test('revoking actual identity immediately invalidates previously signed token',async()=>{
      await admin.query(
        'UPDATE ms.staff_identity_bindings SET revoked_at=now() '+
        'WHERE issuer=$1 AND subject=$2 AND revoked_at IS NULL',
        [issuer,subj]);
      assert.equal((await request('/api/v1/me')).status,403);
      assert.equal((await request('/api/v1/students')).status,403);
      assert.equal((await request('/api/v1/mobile/tasks')).status,403);
      assert.equal(ownerTouches,0);
    });
  }finally{
    if(app.listening)await close(app);
    await Promise.all([admin.end(),directory.end(),readA.end(),writeA.end()]);
  }
});
