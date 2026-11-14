import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
const read=p=>readFileSync(resolve(root,p),'utf8');
const spec=JSON.parse(read('spec/v3-2-46-late-auth-denial.json'));
test('V3.2-46 exercises explicit late denial across seven real fixture HTTP routes',()=>{
 assert.equal(spec.schema_version,'v3.2-46-late-auth-denial-v1');
 assert.equal(spec.parent_pr,52);
 assert.equal(spec.response_branches,6);
 assert.equal(spec.actual_routes_covered,7);
 assert.equal(spec.simulated_final_auth_value,false);
 assert.equal(spec.initial_auth_uses_db,true);
 assert.equal(spec.expected_response_status,403);
 assert.equal(spec.expected_error_code,'FORBIDDEN');
 assert.equal(spec.expected_no_response_data,true);
 assert.equal(spec.expected_no_store,true);
 assert.equal(spec.recovery_after_injection,true);
 assert.equal(spec.source_mutations,false);
 const source=read(spec.dynamic_suite);
 for(const part of [
  spec.test_anchor, 'identityChecks===2', 'return {rows:[{permitted:false}]}',
  'assert.equal(response.status,403',
  "assert.equal(result.code,'FORBIDDEN')",
  'assert.equal(result.data,undefined',
  'assert.equal(deniedFinalChecks,targets.length',
  'A.connect=originalConnect', 'assert.equal(recovered.status,200'
 ])assert.ok(source.includes(part),'Missing runtime test proof: '+part);
 assert.ok(source.includes("'/api/v1/uat-preview/reports/'+sourceA+'/history'"));
 assert.match(read('src/uat-preview-api.mjs'),/const confirmStillAuthorized=async\(\)=>/);
});
test('V3.2-46 preserves hard external-authority and migration boundaries',()=>{
 assert.equal(spec.atomic_network_revocation_guarantee,false);
 assert.equal(spec.real_production_uat,false);
 for(const k of ['production_integration_allowed','execution_allowed','release_allowed',
  'merge_authorized','deploy_authorized','real_finance_crm_connected','new_migration'])
  assert.equal(spec[k],false,k);
 assert.equal(spec.wrong_student_hold_active_required,true);
 assert.equal(spec.student_primary,true);
 assert.equal(spec.family_optional,true);
 assert.equal(spec.latest_head_ci,'PENDING');
 for(const path of ['api/openapi/market-sales.v1.json','api/openapi/crm-integration.v1.json'])
  assert.equal(JSON.parse(read(path))['x-contract-status'],spec.contracts);
 const migrations=readdirSync(resolve(root,'db/migrations')).filter(n=>/^\d{3}_.+\.sql$/.test(n));
 assert.equal(migrations.length,spec.expected_migration_count);
 const doc=read('docs/V3.2-46_LATE_AUTHORIZATION_DENIAL_MATRIX.md');
 for(const word of ['hold_active','不合并','不部署','403','permitted=false'])
  assert.ok(doc.includes(word),word);
});
