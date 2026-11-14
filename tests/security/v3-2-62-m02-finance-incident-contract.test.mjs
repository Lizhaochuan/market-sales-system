import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
const read=p=>readFileSync(resolve(root,p),'utf8');
const m=JSON.parse(read('spec/v3-2-62-m02-finance-incident-triage.json'));
test('V3.2-62 incident triage cannot authorize finance',()=>{
 assert.equal(m.schema_version,'v3.2-62-m02-finance-incident-triage-v1');
 assert.equal(m.parent_pr,68);assert.equal(m.parent_ci,43612969927);
 assert.equal(m.parent_ci_conclusion,'success');
 const sql=read(m.sql);
 for(const k of ['CREATE TABLE ms.isolated_campaign_finance_incidents',
 'CREATE VIEW ms.scoped_isolated_campaign_finance_incidents WITH (security_barrier=true)',
 'CREATE OR REPLACE VIEW ms.scoped_isolated_campaign_finance_handoffs',
 'ms.report_isolated_campaign_finance_incident','ms.triage_isolated_campaign_finance_incident',
 "'blocked_active_incident'","'manual_escalated'","'closed_for_recheck'",
 "r.role_code='sales_manager'","false AS finance_authorized",
 "GRANT SELECT ON ms.scoped_isolated_campaign_finance_incidents TO ms_student_assignee_reader"])
 assert.ok(sql.includes(k),'Missing '+k);
 for(const k of ['GRANT INSERT ON ms.marketing_costs','GRANT UPDATE ON ms.marketing_campaigns',
  'CREATE FUNCTION ms.approve_finance','GRANT INSERT ON ms.isolated_campaign_finance_incidents'])
 assert.equal(sql.includes(k),false,k);
 const app=read('src/app.mjs'),write=read('src/scoped-legacy-write-adapter.mjs'),
  adapter=read('src/scoped-legacy-read-adapter.mjs');
 for(const k of ['listCampaignFinanceIncidents','reportCampaignFinanceIncident','triageCampaignFinanceIncident'])
  assert.ok(app.includes("'"+k+"'"),k);
 assert.ok(adapter.includes('FROM ms.scoped_isolated_campaign_finance_incidents'));
 assert.ok(write.includes('ms.report_isolated_campaign_finance_incident'));
 assert.ok(write.includes('ms.triage_isolated_campaign_finance_incident'));
 const o=JSON.parse(read('api/openapi/m02-isolated-campaign-drafts.v3.2.json'));
 assert.ok(o.paths['/api/v1/marketing-campaigns/finance-incidents'].get);
 assert.ok(o.paths['/api/v1/marketing-campaigns/finance-handoffs/{review_id}/incidents'].post);
 assert.ok(o.paths['/api/v1/marketing-campaigns/finance-incidents/{incident_id}/decision'].post);
 assert.equal(o['x-finance-approval-implemented'],false);
});
test('V3.2-62 enforces fail-closed UI and unchanged external gates',()=>{
 for(const k of ['no_finance_approval','status_blocked_while_incident_active',
  'independent_active_manager_required','student_primary','family_optional',
  'downstream_wrong_student_hold_active','original_orders_payments_lessons_preserved',
  'no_production_migration']) assert.equal(m[k],true,k);
 for(const k of ['finance_authorized','execution_allowed','production_integration_allowed',
  'release_allowed','merge_authorized','deploy_authorized']) assert.equal(m[k],false,k);
 assert.equal(m.latest_head_ci,'PENDING');
 assert.equal(readdirSync(resolve(root,'db/migrations')).filter(n=>/^\d{3}_.+\.sql$/.test(n)).length,38);
 const ui=read('web/app.js'),html=read('web/index.html');
 for(const k of ['id="campaign-incident-list"','id="campaign-incident-report-form"',
  'id="campaign-incident-triage-form"']) assert.ok(html.includes(k),k);
 for(const k of ['renderCampaignIncidents()','state.campaignFinanceIncidents=[]',
  "'campaignFinanceIncidents','/api/v1/marketing-campaigns/finance-incidents'",
  "register('campaign-incident-report-form'","register('campaign-incident-triage-form'",
  "$('campaign-incident-list').replaceChildren()"]) assert.ok(ui.includes(k),k);
 const ci=read('.github/workflows/v3-2-core-api.yml');
 assert.ok(ci.includes(m.sql));assert.ok(ci.includes('chatgpt/v3-2-62-m02-finance-incident-triage'));
 for(const p of ['api/openapi/market-sales.v1.json','api/openapi/crm-integration.v1.json'])
 assert.equal(JSON.parse(read(p))['x-contract-status'],'proposed-unimplemented');
 const d=read('docs/V3.2-62_M02_FINANCE_INCIDENT_TRIAGE.md');
 for(const k of ['hold_active','不合并','不部署','001—038','proposed-unimplemented']) assert.ok(d.includes(k),k);
});
