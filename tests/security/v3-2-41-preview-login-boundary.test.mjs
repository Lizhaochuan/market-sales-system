// V3.2-41: isolated PostgreSQL LOGIN anti-escalation regression.
// Does not use any production finance/CRM identity or execute business writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const read=p=>readFileSync(resolve(root,p),'utf8');
const contract=JSON.parse(read('spec/v3-2-41-preview-login-boundary.json'));
const principals=[['DATABASE_URL_UAT_PREVIEW_A','ms_uat_preview_a'],['DATABASE_URL_UAT_PREVIEW_B','ms_uat_preview_b']];
test('V3.2-41 independent test DB LOGINs cannot assume writer or freeze roles',async t=>{
 const pools=principals.map(([env])=>new pg.Pool({connectionString:process.env[env],max:1}));
 try{
  for(let i=0;i<principals.length;i++){
   await t.test(principals[i][1]+' remains a nonowner with no privileged role membership',async()=>{
    const pool=pools[i];
    const row=(await pool.query(
     'SELECT session_user AS login, current_user AS principal,'+
     ' (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS superuser,'+
     ' (SELECT rolbypassrls FROM pg_roles WHERE rolname=current_user) AS bypassrls'
    )).rows[0];
    assert.equal(row.login,principals[i][1]);
    assert.equal(row.principal,principals[i][1]);
    assert.equal(row.superuser,false);
    assert.equal(row.bypassrls,false);
    for(const role of contract.forbidden_set_role){
     const membership=(await pool.query(
      'SELECT pg_has_role(session_user,$1,$2) AS permitted',[role,'MEMBER'])).rows[0].permitted;
     assert.equal(membership,false,principals[i][1]+' must not inherit '+role);
    }
    const client=await pool.connect();
    try{
     for(const role of contract.forbidden_set_role){
      // Role names are fixed in the JSON contract, not user-controlled input.
      await assert.rejects(client.query('SET ROLE '+role),
       e=>e.code==='42501','Expected SET ROLE denial for '+role);
      const current=(await client.query('SELECT current_user AS principal,session_user AS login')).rows[0];
      assert.equal(current.principal,principals[i][1]);
      assert.equal(current.login,principals[i][1]);
     }
    }finally{client.release();}
   });
   await t.test(principals[i][1]+' has no direct financial, lesson or gap-table write privileges',async()=>{
    const pool=pools[i];
    for(const table of contract.forbidden_direct_tables){
     const row=(await pool.query(
      'SELECT has_table_privilege(session_user,$1,$2) AS can_read,'+
      ' has_table_privilege(session_user,$1,$3) AS can_write',
      [table,'SELECT','UPDATE'])).rows[0];
     assert.equal(row.can_read,false,'direct read forbidden: '+table);
     assert.equal(row.can_write,false,'direct update forbidden: '+table);
    }
    for(const fn of contract.forbidden_function_signatures){
     const row=(await pool.query(
      'SELECT has_function_privilege(session_user,$1,$2) AS can_execute',
      [fn,'EXECUTE'])).rows[0];
     assert.equal(row.can_execute,false,'write function forbidden: '+fn);
    }
   });
  }
  await t.test('two dedicated logins resolve distinct organizations from DB principal',async()=>{
   const organizations=await Promise.all(pools.map(p=>p.query(
    'SELECT ms.current_scoped_organization_id() AS org')));
   const [a,b]=organizations.map(x=>x.rows[0].org);
   assert.ok(a&&b,'both test DB principals must resolve a tenant');
   assert.notEqual(a,b,'separate login must not resolve same tenant');
  });
 }finally{await Promise.all(pools.map(p=>p.end()));}
});
test('V3.2-41 can never promote fixture role checks to production approval',()=>{
 assert.equal(contract.schema_version,'v3.2-41-preview-login-boundary-v1');
 assert.equal(contract.parent_pr,47);
 assert.equal(contract.new_migration,false);
 assert.equal(contract.real_service_revocation_proven,false);
 assert.equal(contract.new_test_status,'ADDED_REQUIRES_LATEST_HEAD_CI');
 for(const k of ['production_integration_allowed','execution_allowed','release_allowed','merge_authorized','deploy_authorized','real_uat_completed'])
  assert.equal(contract[k],false,k);
 assert.equal(contract.downstream_wrong_student_hold_active_required,true);
 assert.equal(contract.student_primary,true);
 assert.equal(contract.family_optional,true);
 for(const p of ['api/openapi/crm-integration.v1.json','api/openapi/market-sales.v1.json'])
  assert.equal(JSON.parse(read(p))['x-contract-status'],contract.financial_crm_source_status);
 assert.equal(readdirSync(resolve(root,'db/migrations')).filter(x=>/^\d{3}_.+\.sql$/.test(x)).length,38);
 const doc=read('docs/V3.2-41_PREVIEW_LOGIN_ROLE_ESCALATION_REGRESSION.md');
 for(const phrase of ['hold_active','不合并','不部署','真实','SET ROLE'])
  assert.ok(doc.includes(phrase),'Required guard missing '+phrase);
});
