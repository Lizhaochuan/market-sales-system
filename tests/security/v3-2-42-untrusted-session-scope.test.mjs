// V3.2-42: simulated caller-controlled PostgreSQL GUCs must never become identity.
// Uses fictional tenants, nonowner preview logins and the isolated CI database only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import pg from 'pg';
const root=fileURLToPath(new URL('../../',import.meta.url));
const read=p=>readFileSync(resolve(root,p),'utf8');
const m=JSON.parse(read('spec/v3-2-42-untrusted-session-scope.json'));
const key=()=>randomBytes(20).toString('hex');
const cfg=n=>new pg.Pool({connectionString:process.env[n],max:1});
const identity=async client=>(await client.query(
 'SELECT session_user AS login,current_user AS principal,'+
 'ms.current_scoped_organization_id() AS org,ms.current_scoped_staff_id() AS staff'
)).rows[0];
test('V3.2-42 client controlled GUC claims never change DB tenant identity',async t=>{
 const A=cfg('DATABASE_URL_UAT_PREVIEW_A');
 const B=cfg('DATABASE_URL_UAT_PREVIEW_B');
 const financeB=cfg('DATABASE_URL_PLAN_B');
 try{
  const ia=await identity(A),ib=await identity(B);
  assert.ok(ia.org&&ib.org&&ia.staff&&ib.staff);
  assert.notEqual(ia.org,ib.org);
  assert.notEqual(ia.staff,ib.staff);
  const sourceB=(await financeB.query(
   'SELECT ms.propose_fixture_source_readiness($1,$2,$3,$4,$5,$6) AS result',
   ['finance','fictional_guc_tenant_probe','fictional_org_b',
    '仅用于验证伪造会话上下文不得跨机构读取',
    '测试来源引用无需真实授权',key()]
  )).rows[0].result;
  assert.ok(sourceB);
  await t.test('A cannot read B report even after spoofing session values',async()=>{
   const client=await A.connect();
   try{
    await client.query('BEGIN');
    try{
     for(const name of m.candidate_untrusted_contexts){
      const spoof=name==='request.jwt.claims'
       ?JSON.stringify({sub:ib.staff,org_id:ib.org,tenant:ib.org,role:'superadmin'})
       :name==='app.staff_id'?ib.staff:
        name==='app.role'?'superadmin':ib.org;
      await client.query('SELECT set_config($1,$2,true)',[name,spoof]);
     }
     const after=await identity(client);
     assert.equal(after.login,ia.login);
     assert.equal(after.principal,ia.principal);
     assert.equal(after.org,ia.org);
     assert.equal(after.staff,ia.staff);
     const options=(await client.query(
      'SELECT source_request_id FROM ms.scoped_uat_preview_choices')).rows;
     assert.ok(!options.some(x=>x.source_request_id===sourceB),
      'spoofed scope leaked foreign request');
     await assert.rejects(
      client.query('SELECT ms.readonly_integration_uat_report($1) AS result',[sourceB]),
      err=>err.code===m.expected_cross_tenant_sqlstate,
      'cross-tenant report must be rejected even with spoofed custom GUCs');
    }finally{await client.query('ROLLBACK');}
   }finally{client.release();}
   const reset=await identity(A);
   assert.equal(reset.org,ia.org);
   assert.equal(reset.staff,ia.staff);
  });
  await t.test('B still has access to its own blocked fixture report',async()=>{
   const row=(await B.query(
    'SELECT ms.readonly_integration_uat_report($1) AS result',[sourceB]
   )).rows[0].result;
   assert.equal(row.department,'finance');
   assert.equal(row.production_integration_allowed,false);
   assert.equal(row.execution_allowed,false);
   assert.equal(row.release_allowed,false);
  });
 }finally{await Promise.all([A.end(),B.end(),financeB.end()]);}
});
test('V3.2-42 cannot promote simulated identity or source to production',()=>{
 assert.equal(m.schema_version,'v3.2-42-untrusted-session-scope-v1');
 assert.equal(m.parent_pr,48);
 assert.equal(m.expected_source_of_trust,'SESSION_USER_AND_DATABASE_SCOPED_PRINCIPAL');
 assert.equal(m.test_uses_fictional_source_request,true);
 assert.equal(m.new_migration,false);
 for(const k of ['production_integration_allowed','execution_allowed','release_allowed',
  'merge_authorized','deploy_authorized','live_authority_verified',
  'real_business_uat_completed','real_finance_source_connected','real_crm_source_connected'])
  assert.equal(m[k],false,k);
 assert.equal(m.wrong_student_downstream_hold_required,true);
 assert.equal(m.student_primary,true);assert.equal(m.family_optional,true);
 for(const p of ['api/openapi/crm-integration.v1.json','api/openapi/market-sales.v1.json'])
  assert.equal(JSON.parse(read(p))['x-contract-status'],m.contracts);
 assert.equal(readdirSync(resolve(root,'db/migrations')).filter(n=>/^\d{3}_.+\.sql$/.test(n)).length,38);
 const doc=read('docs/V3.2-42_UNTRUSTED_SESSION_SCOPE_REGRESSION.md');
 for(const text of ['hold_active','SESSION_USER','不合并','不部署','42501'])
  assert.ok(doc.includes(text),text);
});
