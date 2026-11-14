import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
const read=p=>readFileSync(resolve(root,p),'utf8');
const m=JSON.parse(read('spec/v3-2-45-final-recheck-failclosed.json'));
test('V3.2-45 dynamic E2E simulates late identity DB failure for six protected routes',()=>{
 assert.equal(m.schema_version,'v3.2-45-final-recheck-failclosed-v1');
 assert.equal(m.parent_pr,51);
 assert.equal(m.protected_paths.length,6);
 assert.equal(new Set(m.protected_paths).size,6);
 assert.equal(m.expected_fault,'08006');
 assert.equal(m.expected_http_status,500);
 assert.equal(m.cache_control,'no-store, max-age=0');
 assert.equal(m.return_sensitive_data_on_recheck_error,false);
 assert.equal(m.recover_after_fault_injection,true);
 const source=read(m.dynamic_test);
 for(const anchor of [
  m.test_name,
  "if(identityChecks===2)",
  "code:'08006'",
  "assert.equal(response.status,500",
  "assert.equal(intercepted,targets.length",
  "A.connect=originalConnect",
  "assert.equal(recovered.status,200"
 ])assert.ok(source.includes(anchor),'Missing dynamic test anchor '+anchor);
 assert.match(read('src/uat-preview-api.mjs'),/const confirmStillAuthorized=async\(\)=>/);
});
test('V3.2-45 does not turn isolation test into real authority',()=>{
 assert.equal(m.does_not_prove_atomic_revocation,true);
 for(const key of [
  'production_integration_allowed','execution_allowed','release_allowed',
  'merge_authorized','deploy_authorized','real_business_uat_completed',
  'real_finance_source_connected','real_crm_source_connected',
  'production_service_revocation_proven','new_migration'
 ])assert.equal(m[key],false,key);
 assert.equal(m.wrong_student_downstream_hold_active_required,true);
 assert.equal(m.student_primary,true);assert.equal(m.family_optional,true);
 assert.equal(m.ci_latest_head,'PENDING');
 for(const p of ['api/openapi/crm-integration.v1.json','api/openapi/market-sales.v1.json'])
  assert.equal(JSON.parse(read(p))['x-contract-status'],m.contracts);
 const files=readdirSync(resolve(root,'db/migrations')).filter(n=>/^\d{3}_.+\.sql$/.test(n));
 assert.equal(files.length,m.expected_migration_count);
 const doc=read('docs/V3.2-45_FINAL_RECHECK_FAILCLOSED.md');
 for(const word of ['hold_active','不合并','不部署','08006','proposed-unimplemented'])
  assert.ok(doc.includes(word),'Missing documentation guard '+word);
});
