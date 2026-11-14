import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
const read=p=>readFileSync(resolve(root,p),'utf8');
const m=JSON.parse(read('spec/v3-2-60-m02-finance-handoff-readonly.json'));
test('V3.2-60 finance handoff is a strictly scoped read-only preparation',()=>{
 assert.equal(m.schema_version,'v3.2-60-m02-finance-handoff-readonly-v1');
 assert.equal(m.parent_pr,66);assert.equal(m.parent_ci,43603294713);
 assert.equal(m.parent_ci_conclusion,'success');
 assert.equal(m.eligible_status,'sales_approved_pending_finance');
 assert.equal(m.authorized_readers,'requester_or_actual_sales_approver_only');
 assert.equal(m.max_items,100);
 const sql=read(m.sql);
 for(const part of ['CREATE VIEW ms.scoped_isolated_campaign_finance_handoffs WITH (security_barrier=true)',
  "q.status='sales_approved_pending_finance'",
  'q.organization_id=ms.current_scoped_organization_id()',
  'q.requested_by=ms.current_scoped_staff_id()',
  'q.reviewed_by=ms.current_scoped_staff_id()',
  "'awaiting_external_finance_authority'","false AS finance_authorized",
  'false AS execution_allowed','GRANT SELECT ON ms.scoped_isolated_campaign_finance_handoffs'])
  assert.ok(sql.includes(part),part);
 for(const part of ['CREATE TABLE ms.isolated_campaign_finance','GRANT INSERT ON ms.marketing_costs',
  'CREATE FUNCTION ms.approve_finance','GRANT UPDATE ON ms.marketing_campaigns'])
  assert.ok(!sql.includes(part),'Forbidden authority '+part);
 const app=read('src/app.mjs');
 const readAdapter=read('src/scoped-legacy-read-adapter.mjs');
 assert.ok(app.includes("'listCampaignFinanceHandoffs'"));
 assert.ok(readAdapter.includes('FROM ms.scoped_isolated_campaign_finance_handoffs'));
 assert.ok(readAdapter.includes("'listCampaignFinanceHandoffs'"));
 assert.ok(readAdapter.includes('LIMIT 101'));
 const openapi=JSON.parse(read('api/openapi/m02-isolated-campaign-drafts.v3.2.json'));
 const route=openapi.paths['/api/v1/marketing-campaigns/finance-handoffs'];
 assert.ok(route.get);assert.equal(route.post,undefined);
 assert.equal(openapi['x-finance-handoff-readonly'],true);
 assert.equal(openapi['x-finance-approval-implemented'],false);
});
test('V3.2-60 never treats financial handoff as authorization or production integration',()=>{
 for(const key of ['finance_authorized','execution_allowed','finance_approval_api_available',
  'finance_role_mapped','finance_decision_recorded','campaign_launch_allowed',
  'costs_created','raw_evidence_in_view','new_production_migration',
  'production_integration_allowed','release_allowed','merge_authorized','deploy_authorized'])
  assert.equal(m[key],false,key);
 assert.equal(m.staff_primary_student,true);
 assert.equal(m.family_on_demand,true);
 assert.equal(m.wrong_student_with_downstream_hold_active,true);
 assert.equal(m.original_orders_payments_saleevents_lesson_consumption_preserved,true);
 assert.equal(m.latest_head_ci,'PENDING');
 assert.equal(readdirSync(resolve(root,'db/migrations')).filter(x=>/^\d{3}_.+\.sql$/.test(x)).length,38);
 for(const path of ['api/openapi/market-sales.v1.json','api/openapi/crm-integration.v1.json'])
  assert.equal(JSON.parse(read(path))['x-contract-status'],m.external_contract_status);
 const ui=read('web/app.js'),html=read('web/index.html');
 assert.ok(html.includes('id="campaign-finance-list"'));
 assert.ok(ui.includes('renderCampaignFinanceHandoffs()'));
 assert.ok(ui.includes("'campaignFinanceHandoffs','/api/v1/marketing-campaigns/finance-handoffs'"));
 assert.ok(ui.includes("state.campaignFinanceHandoffs=[]"));
 const ci=read('.github/workflows/v3-2-core-api.yml');
 assert.ok(ci.includes(m.sql));assert.ok(ci.includes('chatgpt/v3-2-60-m02-finance-handoff-readonly'));
 const docs=read('docs/V3.2-60_M02_FINANCE_HANDOFF_READONLY.md');
 for(const phrase of ['hold_active','proposed-unimplemented','不合并','不部署','001—038'])
  assert.ok(docs.includes(phrase),phrase);
});
