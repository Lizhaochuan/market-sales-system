import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
const read=p=>readFileSync(resolve(root,p),'utf8');
const m=JSON.parse(read('spec/v3-2-65-m02-escalation-evidence-gates.json'));
test('V3.2-65 read-only evidence gates require distinct trusted sales actors',()=>{
 assert.equal(m.schema_version,'v3.2-65-m02-escalation-evidence-gates-v1');
 assert.equal(m.parent_pr,71);assert.equal(m.parent_ci,43615508209);
 assert.equal(m.parent_ci_conclusion,'success');
 assert.equal(m.max_items,100);
 assert.deepEqual(m.packet_requirements,[
  'sales_reporter_addendum','independent_sales_reviewer_addendum',
  'independent_finance_requirements_note']);
 const sql=read(m.sql);
 for(const part of [
  'CREATE VIEW ms.scoped_isolated_campaign_escalation_evidence_gates',
  'WITH (security_barrier=true)',
  'FROM ms.scoped_isolated_campaign_finance_incidents i',
  'WHERE i.status=\'manual_escalated\'',
  'f.organization_id=ms.current_scoped_organization_id()',
  'f.recorded_by=i.reported_by',
  'f.recorded_by=i.reviewed_by',
  "f.responsibility_boundary='sales_reporter'",
  "f.responsibility_boundary='independent_sales_reviewer'",
  "f.note_type='sales_evidence_addendum'",
  "f.note_type='external_finance_requirements_pending'",
  "'blocked_missing_reporter_evidence'",
  "'blocked_missing_independent_sales_evidence'",
  "'blocked_missing_finance_requirements_note'",
  "'sales_packet_collected_external_acceptance_pending'",
  'false AS finance_acceptance_verified',
  'false AS academic_acceptance_verified',
  'false AS cross_department_accepted',
  'true AS hold_active',
  'false AS finance_authorized,false AS execution_allowed'
 ])assert.ok(sql.includes(part),'Required evidence boundary: '+part);
 for(const forbidden of [
  'GRANT INSERT ON ms.marketing_costs','CREATE FUNCTION ms.approve_finance',
  'GRANT UPDATE ON ms.isolated_campaign_finance_incidents',
  'GRANT INSERT ON ms.scoped_isolated_campaign_escalation_evidence_gates',
  'CREATE TABLE ms.isolated_campaign_finance_acceptances'])
  assert.equal(sql.includes(forbidden),false,'Forbidden privilege '+forbidden);
 const app=read('src/app.mjs'),adapter=read('src/scoped-legacy-read-adapter.mjs');
 assert.ok(app.includes("'listCampaignFinanceEscalationEvidenceGates'"));
 assert.ok(adapter.includes('FROM ms.scoped_isolated_campaign_escalation_evidence_gates'));
 assert.ok(adapter.includes('LIMIT 101'));
 const o=JSON.parse(read('api/openapi/m02-isolated-campaign-drafts.v3.2.json'));
 const route=o.paths['/api/v1/marketing-campaigns/finance-incidents/evidence-gates'];
 assert.ok(route.get);assert.equal(route.post,undefined);
 assert.equal(o['x-sales-evidence-not-cross-department-acceptance'],true);
 assert.equal(o['x-academic-acceptance-implemented'],false);
 assert.equal(o['x-finance-acceptance-implemented'],false);
 assert.equal(o['x-escalation-evidence-allows-hold-release'],false);
});
test('V3.2-65 preserves financial, academic and CRM isolation gates',()=>{
 for(const key of ['finance_acceptance_implemented','academic_acceptance_implemented',
  'cross_department_acceptance_implemented','finance_authorized','execution_allowed',
  'escalation_hold_release_allowed','production_integration_allowed',
  'release_allowed','merge_authorized','deploy_authorized','new_production_migration'])
  assert.equal(m[key],false,key);
 for(const key of ['student_primary','family_optional','downstream_wrong_student_hold_active',
   'original_orders_payments_saleevents_lesson_history_preserved'])
  assert.equal(m[key],true,key);
 assert.equal(m.latest_head_ci,'PENDING');
 assert.equal(readdirSync(resolve(root,'db/migrations')).filter(x=>/^\d{3}_.+\.sql$/.test(x)).length,38);
 const ui=read('web/app.js'),html=read('web/index.html');
 for(const key of ['id="campaign-evidence-list"','id="campaign-evidence-total"',
   'id="campaign-evidence-status"'])assert.ok(html.includes(key),key);
 for(const key of ['renderCampaignEscalationEvidence()','campaignEvidenceLoadError',
   'state.campaignEscalationEvidence=[]',
   "'campaignEscalationEvidence','/api/v1/marketing-campaigns/finance-incidents/evidence-gates'",
   "$('campaign-evidence-list').replaceChildren()"])assert.ok(ui.includes(key),key);
 const wf=read('.github/workflows/v3-2-core-api.yml');
 assert.ok(wf.includes(m.sql));
 assert.ok(wf.includes('chatgpt/v3-2-65-m02-escalation-evidence-gates'));
 for(const p of ['api/openapi/market-sales.v1.json','api/openapi/crm-integration.v1.json'])
  assert.equal(JSON.parse(read(p))['x-contract-status'],m.external_contract_status);
 const doc=read('docs/V3.2-65_M02_ESCALATION_EVIDENCE_GATES.md');
 for(const key of ['hold_active','proposed-unimplemented','001—038','不合并','不部署'])
  assert.ok(doc.includes(key),key);
});
