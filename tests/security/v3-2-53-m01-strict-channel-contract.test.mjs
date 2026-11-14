import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const read=p=>readFileSync(resolve(root,p),'utf8');
const m=JSON.parse(read('spec/v3-2-53-m01-strict-channel-read.json'));
test('V3.2-53 strictly limits M01 employee channel read to security-barrier CI SQL',()=>{
 assert.equal(m.schema_version,'v3.2-53-m01-strict-scoped-channel-read-v1');
 assert.equal(m.parent_pr,59);
 assert.equal(m.parent_success_ci,43590064940);
 assert.equal(m.module,'M01');
 assert.equal(m.view_security_barrier,true);
 assert.equal(m.uses_existing_staff_pools,true);
 assert.equal(m.base_marketing_channels_select_granted,false);
 assert.equal(m.employee_raw_finance_or_crm_access_granted,false);
 assert.equal(m.new_database_credentials,false);
 const sql=read(m.view_sql);
 for(const a of ['CREATE VIEW ms.scoped_marketing_channel_catalog',
  'security_barrier=true','ms.current_scoped_organization_id()',
  'ms.current_scoped_staff_id() IS NOT NULL',
  'GRANT SELECT ON ms.scoped_marketing_channel_catalog TO ms_student_assignee_reader',
  "has_table_privilege(login_name,'ms.marketing_channels','SELECT')"])
  assert.ok(sql.includes(a),'Scoped SQL missing '+a);
 assert.ok(!sql.includes('GRANT SELECT ON ms.marketing_channels'));
 const adapter=read(m.runtime_adapter);
 assert.ok(adapter.includes("'listMarketingChannels'"));
 assert.ok(adapter.includes('FROM ms.scoped_marketing_channel_catalog'));
 assert.ok(adapter.includes('buildIsolatedChannelCatalog(r.rows,context.user.organization_id)'));
 assert.ok(adapter.includes("ms.scoped_employee_identity_valid($1,$2)"));
 const workflow=read('.github/workflows/v3-2-core-api.yml');
 assert.ok(workflow.includes('tests/sql/create_v3_2_53_scoped_channel_catalog.sql'));
 assert.ok(workflow.includes('chatgpt/v3-2-53-m01-strict-scoped-channel-read'));
 assert.ok(!workflow.includes('create_v3_2_53_new_migration.sql'));
});
test('V3.2-53 retains strict UI boundary and negative runtime tests',()=>{
 const js=read('web/app.js'),browser=read(m.observed_browser_test),real=read(m.observed_real_db_test);
 assert.ok(js.includes("const allowed=new Set(['overview','students','contacts','leads','channels','campaigns'])"));
 assert.ok(js.includes("(!state.strict&&nav.dataset.view==='campaigns')"),
  'market activities must be hidden for the broad demo login');
 assert.ok(js.slice(js.indexOf('const endpoints=state.strict?['),js.indexOf('  ]:['))
  .includes("['channels','/api/v1/marketing-channels']"));
 assert.ok(browser.includes("nav button[data-view=\"channels\"]"));
 assert.ok(browser.includes("toContainText(channelName)"));
 for(const a of ['has_table_privilege','strict employee JWT','scoped_marketing_channel_catalog',
  'mismatched per-employee DB LOGIN','revoked staff binding must block',
  "corrupted.status,500"])
  if(a!=='has_table_privilege')assert.ok(real.includes(a),'M01 strict regression missing '+a);
 assert.equal(JSON.parse(read('api/openapi/m01-isolated-channel-catalog.v3.2.json'))
  ['x-strict-employee-mode-enabled'],true);
});
test('V3.2-53 never implies production readiness or financial correction release',()=>{
 for(const k of ['base_marketing_channels_select_granted','employee_raw_finance_or_crm_access_granted',
  'new_database_credentials','channel_maintenance_writes_allowed',
  'marketing_attribution_approved','production_integration_allowed',
  'execution_allowed','release_allowed','merge_authorized','deploy_authorized',
  'new_migration'])assert.equal(m[k],false,k);
 assert.equal(m.student_primary,true);
 assert.equal(m.family_optional,true);
 assert.equal(m.wrong_student_hold_active_required,true);
 assert.equal(m.original_orders_payments_saleevents_lesson_history_preserved,true);
 assert.equal(m.latest_head_ci,'PENDING');
 for(const p of ['api/openapi/market-sales.v1.json','api/openapi/crm-integration.v1.json'])
  assert.equal(JSON.parse(read(p))['x-contract-status'],m.external_contract_status);
 assert.equal(readdirSync(resolve(root,'db/migrations')).filter(n=>/^\d{3}_.+\.sql$/.test(n)).length,m.migration_count);
 const doc=read('docs/V3.2-53_M01_STRICT_SCOPED_CHANNEL_READ.md');
 for(const a of ['hold_active','不合并','不部署','001—038','proposed-unimplemented'])
  assert.ok(doc.includes(a),'Missing safety boundary '+a);
});
