import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
const read=p=>readFileSync(resolve(root,p),'utf8');
const m=JSON.parse(read('spec/v3-2-68-m02-compensation-classification-matrix.json'));
test('V3.2-68 classified compensation responsibility never becomes approval',()=>{
 assert.equal(m.schema_version,'v3.2-68-m02-compensation-classification-matrix-v1');
 assert.equal(m.parent_pr,74);assert.equal(m.parent_ci,43618439287);
 assert.equal(m.parent_ci_conclusion,'success');
 assert.deepEqual(m.responsible_parties,['sales','finance','academic']);
 assert.deepEqual(m.classification_codes,[
  'snapshot_integrity_conflict','sales_evidence_gap',
  'external_authority_or_reconciliation_unknown']);
 const sql=read(m.sql);
 for(const k of ['CREATE VIEW ms.scoped_isolated_campaign_compensation_responsibility_matrix',
  'WITH (security_barrier=true)',
  'FROM ms.scoped_isolated_campaign_cross_module_trust_failure_gates t',
  'JOIN ms.scoped_isolated_campaign_finance_incidents i',
  "i.issue_kind='integrity_mismatch'","'snapshot_integrity_conflict'",
  "'sales_evidence_gap'","'external_authority_or_reconciliation_unknown'",
  'candidate_only_no_execution_authority',
  'false AS downstream_student_impact_assessed',
  'false AS actual_order_reconciliation_verified',
  'false AS actual_payment_reconciliation_verified',
  'false AS actual_sale_event_reconciliation_verified',
  'false AS actual_lesson_reconciliation_verified',
  'false AS historical_compensation_chain_verified',
  'false AS all_original_records_integrity_verified',
  'true AS preserve_original_orders_required','true AS preserve_original_payments_required',
  'true AS preserve_original_sale_events_required','true AS preserve_original_lessons_required',
  'false AS original_records_mutable','false AS compensation_write_allowed',
  'true AS hold_active','false AS release_eligible',
  'false AS finance_authorized','false AS execution_allowed',
  'GRANT SELECT ON ms.scoped_isolated_campaign_compensation_responsibility_matrix'])
  assert.ok(sql.includes(k),'Missing original preservation boundary '+k);
 for(const k of ['CREATE FUNCTION ms.execute_compensation','GRANT UPDATE ON ms.sales_orders',
  'GRANT INSERT ON ms.marketing_costs','GRANT UPDATE ON ms.audit_events',
  'GRANT UPDATE ON ms.scoped_isolated_campaign_compensation_responsibility_matrix'])
  assert.equal(sql.includes(k),false,'Forbidden mutable history or compensation path '+k);
 const app=read('src/app.mjs'),adapter=read('src/scoped-legacy-read-adapter.mjs');
 assert.ok(app.includes("'listCampaignCompensationResponsibilityMatrix'"));
 assert.ok(adapter.includes('FROM ms.scoped_isolated_campaign_compensation_responsibility_matrix'));
 assert.ok(adapter.includes('LIMIT 101'));
 const o=JSON.parse(read('api/openapi/m02-isolated-campaign-drafts.v3.2.json'));
 const route=o.paths['/api/v1/marketing-campaigns/finance-incidents/compensation-matrix'];
 assert.ok(route.get);assert.equal(route.post,undefined);
 assert.equal(o['x-cross-module-compensation-execution-implemented'],false);
 assert.equal(o['x-original-business-history-verification-implemented'],false);
 assert.equal(o['x-independent-three-party-compensation-approval-implemented'],false);
});
test('V3.2-68 fail-closed UI and CRM safety contracts',()=>{
 for(const k of ['historic_business_records_automatically_verified',
  'compensation_execute_endpoint_implemented','compensation_write_allowed',
  'original_records_mutable','finance_authorized','execution_allowed','release_allowed',
  'merge_authorized','deploy_authorized','production_integration_allowed','new_production_migration'])
  assert.equal(m[k],false,k);
 for(const k of ['student_primary','family_optional','downstream_wrong_student_hold_active',
  'original_orders_payments_saleevents_lesson_history_preserved'])
  assert.equal(m[k],true,k);
 assert.equal(m.latest_head_ci,'PENDING');
 assert.equal(readdirSync(resolve(root,'db/migrations')).filter(x=>/^\d{3}_.+\.sql$/.test(x)).length,38);
 const ui=read('web/app.js'),html=read('web/index.html');
 for(const k of ['id="campaign-compensation-list"','id="campaign-compensation-status"',
  'id="campaign-compensation-total"'])assert.ok(html.includes(k),k);
 for(const k of ['renderCampaignCompensationMatrix()',
  'campaignCompensationLoadError','state.campaignCompensationMatrix=[]',
  "'campaignCompensationMatrix','/api/v1/marketing-campaigns/finance-incidents/compensation-matrix'",
  "$('campaign-compensation-list').replaceChildren()"])assert.ok(ui.includes(k),k);
 const wf=read('.github/workflows/v3-2-core-api.yml');
 assert.ok(wf.includes(m.sql));assert.ok(wf.includes('node --check src/cross-module-compensation-preflight.mjs'));
 assert.ok(wf.includes('chatgpt/v3-2-68-m02-compensation-classification-matrix'));
 for(const path of ['api/openapi/market-sales.v1.json','api/openapi/crm-integration.v1.json'])
  assert.equal(JSON.parse(read(path))['x-contract-status'],m.external_contract_status);
 const doc=read('docs/V3.2-68_M02_COMPENSATION_RESPONSIBILITY_MATRIX.md');
 for(const k of ['hold_active','proposed-unimplemented','001—038','不合并','不部署'])
  assert.ok(doc.includes(k),k);
});
