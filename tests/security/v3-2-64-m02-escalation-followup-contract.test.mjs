import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
const read=p=>readFileSync(resolve(root,p),'utf8');
const m=JSON.parse(read('spec/v3-2-64-m02-escalation-followup-evidence.json'));
test('V3.2-64 escalation evidence remains sales-only and append-only',()=>{
 assert.equal(m.schema_version,'v3.2-64-m02-escalation-followup-evidence-v1');
 assert.equal(m.parent_pr,70);assert.equal(m.parent_ci,43614602899);
 assert.equal(m.parent_ci_conclusion,'success');assert.equal(m.allowed_status,'manual_escalated');
 assert.deepEqual(m.allowed_writer_roles,['sales_reporter','independent_sales_reviewer']);
 const sql=read(m.sql);
 for(const part of [
 'CREATE TABLE ms.isolated_campaign_finance_escalation_followups',
 'CREATE VIEW ms.scoped_isolated_campaign_finance_escalation_followups',
 'WITH (security_barrier=true)',
 'CREATE FUNCTION ms.append_isolated_campaign_finance_escalation_followup',
 'FROM ms.isolated_campaign_finance_incidents',
 "incident.status<>'manual_escalated'",
 'actor IS DISTINCT FROM incident.reported_by',
 'actor IS DISTINCT FROM incident.reviewed_by',
 "r.role_code='sales_manager'","'awaiting_external_finance_authority'",
 "WHEN 'CAMPAIGN_FINANCE_ESCALATION_FOLLOWUP_RECORDED' THEN 'manual_escalated'",
 'ms.scoped_isolated_campaign_finance_incident_audit_history',
 'false AS finance_authorized,false AS execution_allowed'])
  assert.ok(sql.includes(part),'Missing non-release contract '+part);
 for(const forbidden of ['CREATE FUNCTION ms.approve_finance',
 'GRANT INSERT ON ms.marketing_costs',
 'GRANT INSERT ON ms.isolated_campaign_finance_escalation_followups',
 'GRANT UPDATE ON ms.isolated_campaign_finance_incidents'])
  assert.equal(sql.includes(forbidden),false,'Forbidden finance escalation authority: '+forbidden);
 const app=read('src/app.mjs'),adapter=read('src/scoped-legacy-read-adapter.mjs'),
 write=read('src/scoped-legacy-write-adapter.mjs');
 for(const name of ['listCampaignFinanceEscalationFollowups','appendCampaignFinanceEscalationFollowup'])
  assert.ok(app.includes("'"+name+"'"),name);
 assert.ok(adapter.includes('FROM ms.scoped_isolated_campaign_finance_escalation_followups'));
 assert.ok(adapter.includes('LIMIT 101'));
 assert.ok(write.includes('ms.append_isolated_campaign_finance_escalation_followup'));
 const o=JSON.parse(read('api/openapi/m02-isolated-campaign-drafts.v3.2.json'));
 assert.ok(o.paths['/api/v1/marketing-campaigns/finance-incidents/follow-ups'].get);
 assert.ok(o.paths['/api/v1/marketing-campaigns/finance-incidents/{incident_id}/follow-ups'].post);
 assert.equal(o['x-external-finance-acceptance-implemented'],false);
 assert.equal(o['x-escalation-hold-can-be-released'],false);
 assert.equal(o['x-finance-approval-implemented'],false);
});
test('V3.2-64 preserves CRM/finance boundaries and UI fail closed',()=>{
 for(const k of ['external_finance_acceptance_implemented','escalation_hold_release_allowed',
  'finance_authorized','execution_allowed','production_integration_allowed',
  'release_allowed','merge_authorized','deploy_authorized','new_production_migration'])
 assert.equal(m[k],false,k);
 for(const k of ['student_primary','family_optional','downstream_wrong_student_hold_active',
  'original_orders_payments_saleevents_lesson_history_preserved'])
 assert.equal(m[k],true,k);
 assert.equal(m.latest_head_ci,'PENDING');
 assert.equal(readdirSync(resolve(root,'db/migrations')).filter(n=>/^\d{3}_.+\.sql$/.test(n)).length,38);
 const html=read('web/index.html'),ui=read('web/app.js');
 for(const k of ['id="campaign-escalation-followup-panel"',
  'id="campaign-escalation-followup-form"','id="campaign-escalation-list"'])
 assert.ok(html.includes(k),k);
 for(const k of ['renderCampaignEscalationFollowups()',
  "register('campaign-escalation-followup-form'",
  'state.campaignEscalationFollowups=[]','campaignEscalationLoadError',
  "'campaignEscalationFollowups','/api/v1/marketing-campaigns/finance-incidents/follow-ups'",
  "$('campaign-escalation-list').replaceChildren()"])
 assert.ok(ui.includes(k),k);
 const wf=read('.github/workflows/v3-2-core-api.yml');
 assert.ok(wf.includes(m.sql));
 assert.ok(wf.includes('chatgpt/v3-2-64-m02-escalation-followup-evidence'));
 for(const p of ['api/openapi/market-sales.v1.json','api/openapi/crm-integration.v1.json'])
 assert.equal(JSON.parse(read(p))['x-contract-status'],m.external_contract_status);
 const docs=read('docs/V3.2-64_M02_ESCALATION_FOLLOWUP_EVIDENCE.md');
 for(const k of ['hold_active','proposed-unimplemented','001—038','不合并','不部署'])
 assert.ok(docs.includes(k),k);
});
