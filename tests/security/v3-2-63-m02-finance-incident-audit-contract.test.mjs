import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
const read=p=>readFileSync(resolve(root,p),'utf8');
const m=JSON.parse(read('spec/v3-2-63-m02-finance-incident-audit-timeline.json'));
test('V3.2-63 scoped immutable incident history never grants finance authority',()=>{
 assert.equal(m.schema_version,'v3.2-63-m02-finance-incident-audit-timeline-v1');
 assert.equal(m.parent_pr,69);assert.equal(m.parent_ci,43613664095);
 assert.equal(m.parent_ci_conclusion,'success');
 assert.equal(m.max_items,100);
 assert.deepEqual(m.events,[
  'CAMPAIGN_FINANCE_HANDOFF_ISSUE_REPORTED',
  'CAMPAIGN_FINANCE_ISSUE_ESCALATED',
  'CAMPAIGN_FINANCE_ISSUE_RECHECK_REQUESTED']);
 const sql=read(m.sql);
 for(const x of [
  'CREATE VIEW ms.scoped_isolated_campaign_finance_incident_audit_history',
  'WITH (security_barrier=true)',
  'JOIN ms.scoped_isolated_campaign_finance_incidents',
  "a.target_type='marketing_campaign_finance_incident'",
  'a.organization_id=ms.current_scoped_organization_id()',
  'ms.current_scoped_staff_id() IS NOT NULL',
  'a.actor_user_id,a.happened_at',
  'AS event_status','AS current_incident_status',
  'false AS finance_authorized,false AS execution_allowed',
  'GRANT SELECT ON ms.scoped_isolated_campaign_finance_incident_audit_history',
  "has_table_privilege(login_name,'ms.audit_events','SELECT')"])
   assert.ok(sql.includes(x),'Required minimal scoped audit boundary: '+x);
 for(const forbidden of [
  'before_business_json','after_business_json','evidence_ref',
  'GRANT UPDATE ON ms.audit_events','GRANT DELETE ON ms.audit_events',
  'CREATE FUNCTION ms.approve_finance','GRANT INSERT ON ms.marketing_costs'])
  assert.equal(sql.includes(forbidden),false,'Forbidden audit/finance exposure '+forbidden);
 const adapter=read('src/scoped-legacy-read-adapter.mjs');
 assert.ok(adapter.includes('FROM ms.scoped_isolated_campaign_finance_incident_audit_history'));
 assert.ok(adapter.includes("'listCampaignFinanceIncidentHistory'"));
 assert.ok(adapter.includes('LIMIT 101'));
 const app=read('src/app.mjs');
 assert.ok(app.includes("'listCampaignFinanceIncidentHistory'"));
 const o=JSON.parse(read('api/openapi/m02-isolated-campaign-drafts.v3.2.json'));
 const route=o.paths['/api/v1/marketing-campaigns/finance-incidents/audit-history'];
 assert.ok(route.get);assert.equal(route.post,undefined);
 assert.equal(o['x-finance-incident-audit-readonly'],true);
 assert.equal(o['x-finance-incident-history-allows-spend'],false);
});
test('V3.2-63 UI and unchanged finance and CRM hard holds',()=>{
 for(const k of ['manual_escalation_persists_hold','student_primary','family_optional',
  'downstream_wrong_student_hold_active',
  'original_orders_payments_saleevents_lesson_history_preserved'])
  assert.equal(m[k],true,k);
 for(const k of ['mutable_audit','raw_audit_evidence_exposed','finance_authorized',
  'execution_allowed','production_integration_allowed','release_allowed',
  'merge_authorized','deploy_authorized','new_production_migration'])
  assert.equal(m[k],false,k);
 assert.equal(m.latest_head_ci,'PENDING');
 assert.equal(readdirSync(resolve(root,'db/migrations')).filter(n=>/^\d{3}_.+\.sql$/.test(n)).length,38);
 for(const p of ['api/openapi/market-sales.v1.json','api/openapi/crm-integration.v1.json'])
  assert.equal(JSON.parse(read(p))['x-contract-status'],m.external_contract_status);
 const html=read('web/index.html'),ui=read('web/app.js');
 for(const k of ['id="campaign-incident-history-list"',
   'id="campaign-incident-history-status"','id="campaign-incident-history-total"'])
  assert.ok(html.includes(k),k);
 for(const k of ['renderCampaignIncidentHistory()','state.campaignIncidentHistory=[]',
  'campaignIncidentHistoryLoadError','blocked_active_incident',
  "'campaignIncidentHistory','/api/v1/marketing-campaigns/finance-incidents/audit-history'",
  "$('campaign-incident-history-list').replaceChildren()"])
  assert.ok(ui.includes(k),k);
 const wf=read('.github/workflows/v3-2-core-api.yml');
 assert.ok(wf.includes(m.sql));
 assert.ok(wf.includes('chatgpt/v3-2-63-m02-finance-incident-audit-timeline'));
 const doc=read('docs/V3.2-63_M02_FINANCE_INCIDENT_AUDIT_TIMELINE.md');
 for(const x of ['hold_active','不合并','不部署','001—038','proposed-unimplemented'])
  assert.ok(doc.includes(x),x);
});
