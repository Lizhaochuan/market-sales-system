import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
const read=p=>readFileSync(resolve(root,p),'utf8');
const m=JSON.parse(read('spec/v3-2-47-inflight-token-expiry.json'));
test('V3.2-47 requires JWT expiration check after DB read on all protected paths',()=>{
 assert.equal(m.schema_version,'v3.2-47-inflight-jwt-expiry-v1');
 assert.equal(m.parent_pr,53);
 assert.equal(m.route_count,7);
 assert.equal(m.protected_success_branches,6);
 assert.equal(m.expected_expired_http_status,401);
 assert.equal(m.expected_expired_code,'AUTH_REQUIRED');
 assert.equal(m.decision,'REVERIFY_SIGNED_TOKEN_AND_DATABASE_STAFF_AFTER_READ_BEFORE_RESPONSE');
 const src=read(m.code_path);
 const helper=src.slice(src.indexOf('const confirmStillAuthorized=async()=>'));
 assert.ok(helper.indexOf('verify(token);')>=0);
 assert.ok(helper.indexOf('verify(token);')<helper.indexOf('const recheck=await client.query('));
 assert.equal((src.match(/await confirmStillAuthorized\(\)/g)||[]).length,6);
 const testCode=read(m.dynamic_test);
 for(const anchor of [
  m.test_case,'const actualNow=Date.now',
  'const clockStart=Math.floor(actualNow()/1000)',
  'clockSeconds=clockStart+31','exp:clockStart+30',
  'assert.equal(completedRead,true',
  'assert.equal(response.status,401',
  "assert.equal(output.code,'AUTH_REQUIRED')",
  'Date.now=actualNow','A.connect=originalConnect',
  'assert.equal(recovered.status,200)'
 ])assert.ok(testCode.includes(anchor),'Missing active regression assertion: '+anchor);
});
test('V3.2-47 does not promote isolated expiry results into production authorization',()=>{
 for(const k of ['real_external_oidc_tested','production_integration_allowed',
  'execution_allowed','release_allowed','merge_authorized','deploy_authorized',
  'real_business_uat_completed','production_finance_source_connected',
  'production_crm_source_connected','atomic_revocation_delivery_proven','new_migration'])
  assert.equal(m[k],false,k);
 assert.equal(m.wrong_student_hold_active_required,true);
 assert.equal(m.student_primary,true);assert.equal(m.family_optional,true);
 assert.equal(m.latest_head_ci,'PENDING');
 for(const p of ['api/openapi/market-sales.v1.json','api/openapi/crm-integration.v1.json'])
  assert.equal(JSON.parse(read(p))['x-contract-status'],m.contracts);
 assert.equal(readdirSync(resolve(root,'db/migrations'))
  .filter(x=>/^\d{3}_.+\.sql$/.test(x)).length,m.expected_migration_count);
 const d=read('docs/V3.2-47_INFLIGHT_TOKEN_EXPIRY_RECHECK.md');
 for(const word of ['hold_active','不合并','不部署','401','403'])
  assert.ok(d.includes(word),word);
});
