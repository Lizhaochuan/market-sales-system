import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
const read=p=>readFileSync(resolve(root,p),'utf8');
const m=JSON.parse(read('spec/v3-2-55-m01-channel-review-workbench.json'));
test('V3.2-55 channel approval UI only reads scoped SQL minimal pending and owns',()=>{
 assert.equal(m.schema_version,'v3.2-55-m01-channel-review-workbench-v1');
 assert.equal(m.parent_pr,61);assert.equal(m.parent_ci,43592191142);
 assert.equal(m.parent_conclusion,'success');
 const sql=read(m.read_sql);
 for(const x of ['CREATE VIEW ms.scoped_isolated_channel_change_requests',
  'security_barrier=true','ms.current_scoped_organization_id()',
  'ms.current_scoped_staff_id()','q.requested_by=ms.current_scoped_staff_id()',
  'q.status=\'pending\'','can_review',
  'GRANT SELECT ON ms.scoped_isolated_channel_change_requests TO ms_student_assignee_reader',
  "has_table_privilege(login_name,'ms.isolated_channel_change_requests','SELECT')"])
  assert.ok(sql.includes(x),'Missing read scope '+x);
 assert.ok(!sql.includes('GRANT SELECT ON ms.isolated_channel_change_requests'));
 const app=read('src/app.mjs'),adapter=read('src/scoped-legacy-read-adapter.mjs');
 for(const x of ['listChannelChangeRequests','review_channel_change:ctx.manager',
  "if(!strictStaffMode&&['listCampaignDrafts','createCampaignDraft','listChannelChangeRequests','listChannelAuditHistory','requestChannelChange','reviewChannelChange'].includes(route.op))"])
  assert.ok(app.includes(x),'Missing staff restricted route '+x);
 assert.ok(adapter.includes('FROM ms.scoped_isolated_channel_change_requests'));
 assert.ok(adapter.includes("if(['listChannelChangeRequests','listChannelAuditHistory','listCampaignDrafts','listCampaignSalesReviews'].includes(operation)&&r.rows.length>100)"));
 const html=read(m.web_html),js=read(m.web_js);
 for(const x of ['id="channel-maintenance-workbench" hidden',
  'id="channel-request-form"','id="channel-review-form"',
  'id="channel-requests-list"','id="channel-requests-status"'])
  assert.ok(html.includes(x),'Missing form '+x);
 for(const x of ['state.channelRequestLoadError','state.channelRequests',
  "'channelRequests','/api/v1/marketing-channels/change-requests'",
  "register('channel-request-form'","register('channel-review-form'",
  "x.status==='pending'&&x.can_review===true",
  "$('channel-requests-list').replaceChildren()"])
  assert.ok(js.includes(x),'Missing closed-loop UI logic '+x);
});
test('V3.2-55 CI-only delivery preserves project security and immutable history',()=>{
 for(const k of ['has_production_database_migration','actual_real_finance_crm_integration',
  'official_marketing_attribution_complete','production_integration_allowed',
  'execution_allowed','release_allowed','merge_authorized','deploy_authorized',
  'legacy_demo_can_write_channels','raw_request_evidence_exposed'])
  assert.equal(m[k],false,k);
 assert.equal(m.student_primary,undefined);
 assert.equal(m.single_student_primary,true);assert.equal(m.family_optional,true);
 assert.equal(m.hold_active_for_downstream_wrong_link,true);
 assert.equal(m.migration_count,38);assert.equal(m.latest_head_ci,'PENDING');
 assert.equal(readdirSync(resolve(root,'db/migrations'))
  .filter(n=>/^\d{3}_.+\.sql$/.test(n)).length,38);
 for(const p of ['api/openapi/market-sales.v1.json','api/openapi/crm-integration.v1.json'])
  assert.equal(JSON.parse(read(p))['x-contract-status'],m.external_contract_state);
 const full=read('.github/workflows/v3-2-core-api.yml');
 assert.ok(full.includes('create_v3_2_55_channel_review_read_view.sql'));
 assert.ok(full.includes('chatgpt/v3-2-55-m01-channel-review-workbench'));
 for(const a of ['tests/security/m01-channel-review-scoped-list.test.mjs',
  'tests/browser/m01-channel-approval.spec.mjs'])
  assert.ok(read(a).length>1000);
 const doc=read('docs/V3.2-55_M01_CHANNEL_REVIEW_WORKBENCH.md');
 for(const s of ['hold_active','不合并','不部署','001—038','proposed-unimplemented'])
  assert.ok(doc.includes(s),'Missing business hold '+s);
});
