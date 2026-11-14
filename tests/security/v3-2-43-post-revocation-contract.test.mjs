import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
const read=path=>readFileSync(resolve(root,path),'utf8');
const manifest=JSON.parse(read('spec/v3-2-43-post-revocation-regression.json'));
test('V3.2-43 has real post-commit dynamic regression anchors and strict request denial',()=>{
 assert.equal(manifest.schema_version,'v3.2-43-post-revocation-fixture-v1');
 assert.equal(manifest.parent_pr,49);
 assert.equal(manifest.scope,'isolated-fixture-post-commit-revalidation');
 assert.equal(manifest.suite,'tests/security/uat-preview-api.test.mjs');
 assert.equal(manifest.tested_post_commit_paths,7);
 assert.equal(manifest.concurrent_requests,12);
 assert.equal(manifest.expected_reauthentication_result,false);
 assert.equal(manifest.expected_http_status,403);
 assert.equal(manifest.requires_no_cache_headers,true);
 assert.equal(manifest.no_inflight_cancellation_claim,true);
 const source=read(manifest.suite);
 for(const anchor of [
  'revocation invalidates pinned DB session and concurrent next reads',
  'await A.connect()', 'ms.scoped_employee_identity_valid($1,$2)',
  'await owner.query(', 'revoked_at=now()', 'Promise.all(requests.map',
  "assert.equal(outcomes.length,12)", 'assert.equal(result.status,403',
  "no-store, max-age=0"
 ])assert.ok(source.includes(anchor),'Missing dynamic guard: '+anchor);
 assert.match(source,/await owner\.query\([\s\S]*?revoked_at=now\(\)[\s\S]*?await pinned\.query\(/);
});
test('V3.2-43 never promotes fixture revocation to production approval',()=>{
 for(const key of ['real_external_identity_provider_tested',
  'production_finance_crm_tenant_mapping_verified',
  'production_service_revocation_proven','live_uat_completed',
  'production_integration_allowed','execution_allowed','release_allowed',
  'merge_authorized','deploy_authorized','new_migration'
 ])assert.equal(manifest[key],false,key);
 assert.equal(manifest.downstream_wrong_student_hold_active_required,true);
 assert.equal(manifest.student_primary,true);
 assert.equal(manifest.family_optional,true);
 assert.equal(manifest.latest_head_ci_status,'PENDING_VERIFICATION');
 for(const p of ['api/openapi/market-sales.v1.json',
  'api/openapi/crm-integration.v1.json'])
  assert.equal(JSON.parse(read(p))['x-contract-status'],manifest.contracts);
 assert.equal(readdirSync(resolve(root,'db/migrations'))
  .filter(n=>/^\d{3}_.+\.sql$/.test(n)).length,manifest.source_migrations_expected);
 const doc=read('docs/V3.2-43_POST_REVOCATION_CONCURRENT_ACCESS.md');
 for(const word of ['hold_active','不合并','不部署','NOT PROVEN','completed/success'])
  assert.ok(doc.includes(word),word);
});
