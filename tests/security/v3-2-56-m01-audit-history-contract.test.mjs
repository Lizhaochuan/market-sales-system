import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const read=p=>readFileSync(resolve(root,p),'utf8');
const m=JSON.parse(read('spec/v3-2-56-m01-audit-history.json'));
test('V3.2-56 M01 event chronology requires staff-only scope and no raw audit fields',()=>{
 assert.equal(m.schema_version,'v3.2-56-m01-scoped-channel-audit-history-v1');
 assert.equal(m.parent_pr,62);assert.equal(m.parent_ci,43593610382);
 assert.equal(m.parent_ci_conclusion,'success');
 assert.equal(m.max_events,100);assert.equal(m.view_security_barrier,true);
 const sql=read(m.sql);
 for(const x of ['CREATE VIEW ms.scoped_isolated_channel_audit_history',
   'security_barrier=true','JOIN ms.scoped_isolated_channel_change_requests',
   "a.target_type='marketing_channel_request'",
   "a.event_name IN","q.reviewed_by=ms.current_scoped_staff_id()",
   'GRANT SELECT ON ms.scoped_isolated_channel_audit_history TO ms_student_assignee_reader',
   "has_table_privilege(login_name,'ms.audit_events','SELECT')",
   "has_table_privilege(login_name,'ms.audit_events','UPDATE')",
   "has_table_privilege(login_name,'ms.audit_events','DELETE')"])
  assert.ok(sql.includes(x),'Missing history scope '+x);
 assert.ok(!sql.includes('GRANT SELECT ON ms.audit_events'));
 assert.ok(!sql.includes('CREATE TABLE ms.audit_events'));
 const app=read('src/app.mjs'),adapter=read('src/scoped-legacy-read-adapter.mjs');
 for(const x of ['listChannelAuditHistory',"['listCampaignDrafts','createCampaignDraft','listChannelChangeRequests','listChannelAuditHistory',",
   '/api\\/v1\\/marketing-channels\\/change-requests\\/audit-history'])
  assert.ok(app.includes(x),'Strict audit route missing '+x);
 for(const x of ["'listChannelAuditHistory'","FROM ms.scoped_isolated_channel_audit_history",
   "['listChannelChangeRequests','listChannelAuditHistory','listCampaignDrafts','listCampaignSalesReviews'].includes(operation)&&r.rows.length>100"])
  assert.ok(adapter.includes(x),'Audit read bound missing '+x);
 const openapi=JSON.parse(read('api/openapi/m01-isolated-channel-maintenance.v3.2.json'));
 assert.ok(openapi.paths['/api/v1/marketing-channels/change-requests/audit-history'].get);
 assert.equal(openapi['x-production-integration-allowed'],false);
});
test('V3.2-56 frontend fail-closed history and immutable project guardrails',()=>{
 const html=read('web/index.html'),js=read('web/app.js');
 for(const x of ['id="channel-audit-panel"','id="channel-audit-list"',
  'id="channel-audit-status"']) assert.ok(html.includes(x),x);
 for(const x of ['state.channelAuditHistory','state.channelAuditLoadError',
  "'channelAuditHistory','/api/v1/marketing-channels/change-requests/audit-history'",
  "state.channelAuditHistory=valid?items:[]",
  "$('channel-audit-list').replaceChildren()",
  "state.channelAuditLoadError||"])assert.ok(js.includes(x),'Fail closed missing '+x);
 for(const k of ['raw_audit_json_exposed','raw_evidence_refs_exposed',
  'audit_app_role_update_or_delete','raw_audit_base_table_select_to_employee',
  'has_new_production_migration','has_real_finance_or_crm_integration',
  'has_real_channel_campaign_attribution','production_integration_allowed',
  'execution_allowed','release_allowed','merge_authorized','deploy_authorized'])
  assert.equal(m[k],false,k);
 assert.equal(m.student_primary,true);assert.equal(m.family_optional,true);
 assert.equal(m.wrong_student_downstream_hold_active,true);
 assert.equal(m.original_orders_payment_saleevents_lessons_preserved,true);
 assert.equal(m.latest_head_ci,'PENDING');
 assert.equal(readdirSync(resolve(root,'db/migrations'))
  .filter(n=>/^\d{3}_.+\.sql$/.test(n)).length,m.migration_count);
 for(const p of ['api/openapi/market-sales.v1.json','api/openapi/crm-integration.v1.json'])
  assert.equal(JSON.parse(read(p))['x-contract-status'],m.external_contract_status);
 const work=read('.github/workflows/v3-2-core-api.yml');
 assert.ok(work.includes('create_v3_2_56_scoped_channel_audit_history.sql'));
 assert.ok(work.includes('chatgpt/v3-2-56-m01-scoped-channel-audit-history'));
 const doc=read('docs/V3.2-56_M01_CHANNEL_AUDIT_HISTORY.md');
 for(const x of ['hold_active','不合并','不部署','001—038','proposed-unimplemented'])
  assert.ok(doc.includes(x),'Missing boundary '+x);
});
