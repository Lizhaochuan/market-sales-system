import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
const read=p=>readFileSync(resolve(root,p),'utf8');
const m=JSON.parse(read('spec/v3-2-51-m01-channel-catalog.json'));
test('V3.2-51 M01 channel API is isolated GET-only with no strict mode downgrade',()=>{
 assert.equal(m.schema_version,'v3.2-51-m01-isolated-channel-catalog-v1');
 assert.equal(m.parent_pr,57);assert.equal(m.module,'M01');
 assert.equal(m.http_method,'GET');
 assert.equal(m.http_path,'/api/v1/marketing-channels');
 assert.equal(m.legacy_non_strict_only,true);
 assert.equal(m.strict_employee_route_migrated,false);
 assert.equal(m.strict_employee_mode_denied,true);
 const app=read(m.http_file);
 assert.ok(app.includes("['GET',/^\\/api\\/v1\\/marketing-channels$/,'listMarketingChannels']"));
 assert.ok(app.includes("FROM ms.marketing_channels WHERE organization_id=$1"));
 assert.ok(app.includes('buildIsolatedChannelCatalog(result.rows,org)'));
 const adapter=read('src/scoped-legacy-read-adapter.mjs');
 const list=adapter.slice(adapter.indexOf('export const migratedLegacyReads='),
  adapter.indexOf('const listQueries='));
 assert.ok(!list.includes("'listMarketingChannels'"),'must not accidentally bypass strict mode');
 const src=read(m.runtime_file);
 for(const s of ['inactive_inherited','parent_id','organization_id','nodes.has(row.id)',
  'depth>16','source_attribution_verified:false','production_integration_allowed:false'])
  assert.ok(src.includes(s),'Missing channel catalog guard: '+s);
 const t=read(m.http_test);
 for(const a of ['invalidParent.status,500','cycle.status,500','missing.status,401',
  'wrongOrg.status,403','effective_active_count','channelB'])
  assert.ok(t.includes(a),a);
});
test('V3.2-51 M01 remains partial and does not authorize real CRM/finance or merge',()=>{
 assert.equal(m.technical_status,'ISOLATED_PARTIAL_IMPLEMENTATION_ONLY');
 for(const key of ['has_write_routes','production_channel_acquisition_verified',
  'first_source_immutable_proven','opportunity_attribution_amount_verified',
  'production_integration_allowed','execution_allowed','release_allowed',
  'merge_authorized','deploy_authorized','real_finance_source_connected',
  'real_crm_source_connected'])
  assert.equal(m[key],false,key);
 assert.equal(m.student_primary,true);assert.equal(m.family_optional,true);
 assert.equal(m.wrong_student_hold_active_required,true);
 assert.equal(m.no_new_database_migration,true);
 assert.equal(m.latest_head_ci,'PENDING');
 for(const p of ['api/openapi/market-sales.v1.json','api/openapi/crm-integration.v1.json'])
  assert.equal(JSON.parse(read(p))['x-contract-status'],m.external_contracts);
 assert.equal(readdirSync(resolve(root,'db/migrations'))
  .filter(x=>/^\d{3}_.+\.sql$/.test(x)).length,m.expected_migration_count);
 const doc=read('docs/V3.2-51_M01_CHANNEL_CATALOG_READONLY.md');
 for(const x of ['hold_active','不合并','不部署','001—038','STRICT','proposed-unimplemented'])
  assert.ok(doc.includes(x),'Missing M01 documentation warning: '+x);
});
