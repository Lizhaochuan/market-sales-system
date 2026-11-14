import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
const read=p=>readFileSync(resolve(root,p),'utf8');
const m=JSON.parse(read('spec/v3-2-52-m01-channel-workbench.json'));
test('V3.2-52 channels render as isolated Chinese text, fail closed and clear on logout',()=>{
 assert.equal(m.schema_version,'v3.2-52-m01-chinese-channel-workbench-v1');
 assert.equal(m.parent_pr,58);
 assert.equal(m.verified_parent_ci.run_id,43589267498);
 assert.equal(m.verified_parent_ci.conclusion,'success');
 const html=read(m.html),js=read(m.js),browser=read(m.browser_regression);
 for(const marker of ['data-view="channels"','data-panel="channels"',
  'id="channels-status"','id="channels-list"','获客渠道'])
  assert.ok(html.includes(marker),marker);
 for(const marker of ["state.channelLoadError","state.channelCatalog",
  "if(key==='channels')","'m01-isolated-channel-catalog-v1'",
  "$('channels-list').replaceChildren()","x.effective_status==='inactive'",
  "['channels','/api/v1/marketing-channels']"])
  assert.ok(js.includes(marker),'M01 data lifecycle missing: '+marker);
 assert.ok(js.includes("state.strict&&!allowed.has(nav.dataset.view)"));
 assert.ok(!js.slice(js.indexOf('const endpoints=state.strict?['),
  js.indexOf('  ]:[')).includes("['channels'"),
  'strict-mode refresh must never query blocked channel endpoint');
 for(const marker of ["<img src=x onerror=alert(1)>",
  "not.toContainText('上级停用的虚构子渠道')",
  "await page.unroute('**/api/v1/marketing-channels')",
  "width:390","overflow","退出演示账号"])
  assert.ok(browser.includes(marker),'Missing Chromium browser assertion '+marker);
});
test('V3.2-52 explicit-vs-inherited inactive semantics agree with isolated OpenAPI',()=>{
 assert.equal(m.strict_staff_mode_visible,false);
 assert.equal(m.strict_staff_read_enabled,false);
 assert.equal(m.new_marketing_channel_write_api,false);
 const source=read(m.catalog_source);
 assert.ok(source.includes("current.status==='inactive'?'inactive'"));
 const o=JSON.parse(read(m.openapi));
 assert.deepEqual(o.paths['/api/v1/marketing-channels'].get.responses['200']
  .content['application/json'].schema.properties.data.properties.channels
  .items.properties.effective_status.enum,m.channel_status_enum);
 assert.equal(o['x-production-integration-allowed'],false);
 assert.equal(o['x-strict-employee-mode-enabled'],false);
 assert.ok(!o.paths['/api/v1/marketing-channels'].post);
});
test('V3.2-52 remains Draft-only partial UI and preserves immutable cross-module history',()=>{
 for(const k of ['production_integration_allowed','execution_allowed','release_allowed',
  'merge_authorized','deploy_authorized','real_finance_crm_connected',
  'official_marketing_attribution_completed','new_migration'])
  assert.equal(m[k],false,k);
 assert.equal(m.student_primary,true);assert.equal(m.family_optional,true);
 assert.equal(m.wrong_student_with_downstream_hold_active_required,true);
 assert.equal(m.preserve_original_orders_payments_saleevents_lessons,true);
 assert.equal(m.latest_head_ci,'PENDING');
 for(const p of ['api/openapi/market-sales.v1.json','api/openapi/crm-integration.v1.json'])
  assert.equal(JSON.parse(read(p))['x-contract-status'],m.external_contract_status);
 const sql=readdirSync(resolve(root,'db/migrations')).filter(x=>/^\d{3}_.+\.sql$/.test(x));
 assert.equal(sql.length,m.expected_migrations);
 const doc=read('docs/V3.2-52_M01_CHINESE_CHANNEL_WORKBENCH.md');
 for(const text of ['hold_active','不合并','不部署','001—038','proposed-unimplemented'])
  assert.ok(doc.includes(text),'Missing project safety boundary '+text);
});
