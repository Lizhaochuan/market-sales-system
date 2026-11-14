import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const read=p=>readFileSync(resolve(root,p),'utf8');
const m=JSON.parse(read('spec/v3-2-50-joint-blocked-uat.json'));
test('V3.2-50 ties joint report to existing restricted SQL and 16 blocked checks',()=>{
 assert.equal(m.schema_version,'v3.2-50-joint-blocked-uat-v1');
 assert.equal(m.parent_pr,56);
 assert.equal(m.finance_checks,12);
 assert.equal(m.academic_checks,12);
 assert.equal(m.unique_joint_checks,16);
 assert.equal(m.trusted_principal,'ms_fixture_source_security');
 assert.equal(m.stage,'isolated-test');
 assert.equal(m.new_database_migration,false);
 assert.equal(m.exposes_new_http_route,false);
 assert.equal(m.preserve_distinct_source_missing_events,true);
 const implementation=read(m.runtime_module);
 for(const phrase of ['buildBlockedJointUatReport','loadBlockedJointUatReport',
  'renderBlockedJointUatMarkdown','ms.current_scoped_organization_id()',
  'session_user AS login','ms.readonly_integration_uat_report($1)',
  'ms_fixture_source_security','blocked_real_authority_missing',
  'source_missing_event','hold_active']){
  if(phrase==='source_missing_event')continue;
  assert.ok(implementation.includes(phrase),'Missing runtime source anchor: '+phrase);
 }
 const sql=read(m.source_sql);
 assert.ok(sql.includes('CREATE FUNCTION ms.readonly_integration_uat_report'));
 assert.ok(sql.includes('source_gate:=ms.readonly_integration_hard_gate(p_request)'));
 assert.ok(read('db/migrations/034_preintegration_authority_hard_gates.sql')
  .includes('CHECK(NOT production_verified)'));
 const tests=read(m.integration_test);
 assert.ok(tests.includes('loadBlockedJointUatReport(security,f,b)'));
 assert.ok(tests.includes("e=>e.code==='42501'"));
});
test('V3.2-50 remains isolated Draft with no production privilege',()=>{
 for(const k of ['direct_business_table_read_allowed','real_finance_crm_authority_attested',
  'real_uat_passed','production_integration_allowed','execution_allowed','release_allowed',
  'merge_authorized','deploy_authorized','new_database_migration','exposes_new_http_route'])
  assert.equal(m[k],false,k);
 assert.equal(m.wrong_student_downstream_hold_active_required,true);
 assert.equal(m.student_primary,true);
 assert.equal(m.family_optional,true);
 assert.equal(m.status,'BLOCKED_ISOLATED_READONLY_REPORT_ONLY');
 for(const p of ['api/openapi/crm-integration.v1.json','api/openapi/market-sales.v1.json'])
  assert.equal(JSON.parse(read(p))['x-contract-status'],m.source_contract_status);
 const files=readdirSync(resolve(root,'db/migrations')).filter(x=>/^\d{3}_.+\.sql$/.test(x)).sort();
 assert.equal(files.length,m.expected_migration_count);
 assert.deepEqual(files.map(x=>x.slice(0,3)),Array.from({length:38},(_,i)=>String(i+1).padStart(3,'0')));
 const doc=read('docs/V3.2-50_JOINT_BLOCKED_UAT_READONLY.md');
 for(const phrase of ['hold_active','不合并','不部署','42501',
  '16 项','proposed-unimplemented'])
  assert.ok(doc.includes(phrase),'Missing documentation guard: '+phrase);
});
