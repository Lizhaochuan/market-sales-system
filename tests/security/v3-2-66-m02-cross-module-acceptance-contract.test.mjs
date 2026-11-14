import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
const read=p=>readFileSync(resolve(root,p),'utf8');
const m=JSON.parse(read('spec/v3-2-66-m02-cross-module-acceptance-protocol.json'));
test('V3.2-66 three-party future prerequisites remain read-only and deny every release',()=>{
 assert.equal(m.schema_version,'v3.2-66-m02-cross-module-acceptance-protocol-v1');
 assert.equal(m.parent_pr,72);assert.equal(m.parent_ci,43616283006);
 assert.equal(m.parent_ci_conclusion,'success');
 assert.deepEqual(m.required_parties,['sales','finance','academic']);
 assert.equal(m.max_items,100);
 assert.deepEqual(m.acceptance_statuses,
  ['blocked_sales_packet_incomplete','blocked_trusted_finance_identity_missing']);
 const sql=read(m.sql);
 for(const key of [
  'CREATE VIEW ms.scoped_isolated_campaign_cross_module_acceptance_prerequisites',
  'WITH (security_barrier=true)',
  'FROM ms.scoped_isolated_campaign_escalation_evidence_gates e',
  "WHERE e.incident_status='manual_escalated'",
  'ms.current_scoped_staff_id() IS NOT NULL',
  "'blocked_sales_packet_incomplete'",
  "'blocked_trusted_finance_identity_missing'",
  'false AS finance_principal_verified','false AS finance_signed_receipt_verified',
  'false AS finance_budget_decision_verified','false AS academic_principal_verified',
  'false AS academic_student_impact_reconciled',
  'false AS academic_signed_attestation_verified',
  'false AS cross_module_evidence_reconciled',
  'false AS three_party_acceptance_verified','false AS compensation_history_verified',
  'true AS hold_active','false AS release_eligible',
  'false AS finance_authorized','false AS execution_allowed',
  'false AS activity_publish_allowed',
  'GRANT SELECT ON ms.scoped_isolated_campaign_cross_module_acceptance_prerequisites'])
  assert.ok(sql.includes(key),'Missing hard-block contract: '+key);
 for(const forbidden of ['GRANT INSERT ON ms.marketing_costs','GRANT UPDATE ON ms.marketing_campaigns',
  'CREATE TABLE ms.external_finance_attestations','CREATE FUNCTION ms.accept_finance',
  'GRANT UPDATE ON ms.scoped_isolated_campaign_cross_module_acceptance_prerequisites'])
  assert.equal(sql.includes(forbidden),false,'Forbidden external authorization: '+forbidden);
 const app=read('src/app.mjs'),adapter=read('src/scoped-legacy-read-adapter.mjs');
 assert.ok(app.includes("'listCampaignCrossModuleAcceptancePrerequisites'"));
 assert.ok(adapter.includes('FROM ms.scoped_isolated_campaign_cross_module_acceptance_prerequisites'));
 assert.ok(adapter.includes('LIMIT 101'));
 const api=JSON.parse(read('api/openapi/m02-isolated-campaign-drafts.v3.2.json'));
 const endpoint=api.paths['/api/v1/marketing-campaigns/finance-incidents/acceptance-prerequisites'];
 assert.ok(endpoint.get);assert.equal(endpoint.post,undefined);
 assert.equal(api['x-finance-and-academic-trust-chains-established'],false);
 assert.equal(api['x-three-party-release-endpoint-implemented'],false);
});
test('V3.2-66 future protocol is only a proposal, not verified signatures',()=>{
 const p=JSON.parse(read('spec/v3-2-66-proposed-acceptance-envelope.schema.json'));
 assert.equal(p.properties.protocol_version.const,'v3.2-66-proposed');
 assert.equal(p.additionalProperties,false);
 assert.deepEqual(p.properties.parties.required,['sales','finance','academic']);
 for(const party of p.properties.parties.required){
  const x=p.properties.parties.properties[party];
  assert.equal(x.additionalProperties,false);
  assert.equal(x.properties.authority_domain.const,party);
  for(const k of ['principal_id','organization_id','signed_receipt_id','evidence_digest',
    'decision','signed_at'])assert.ok(x.required.includes(k),party+' '+k);
 }
 assert.equal(p.properties.original_records_preserved.const,true);
 assert.equal(m.protocol_status,'proposed-unimplemented');
 for(const k of ['signed_receipt_transport_available','trusted_finance_identity_mapped',
  'trusted_academic_identity_mapped','independent_finance_decision_verified',
  'independent_academic_attestation_verified','external_snapshot_reconciliation_implemented',
  'cross_module_acceptance_implemented','three_party_hold_release_available',
  'finance_authorized','execution_allowed','production_integration_allowed',
  'release_allowed','merge_authorized','deploy_authorized','new_production_migration'])
  assert.equal(m[k],false,k);
 for(const k of ['student_primary','family_optional','downstream_wrong_student_hold_active',
  'original_orders_payments_saleevents_lesson_history_preserved'])
  assert.equal(m[k],true,k);
 assert.equal(m.latest_head_ci,'PENDING');
 assert.equal(readdirSync(resolve(root,'db/migrations')).filter(x=>/^\d{3}_.+\.sql$/.test(x)).length,38);
 const ui=read('web/app.js'),html=read('web/index.html');
 for(const key of ['id="campaign-acceptance-list"','id="campaign-acceptance-total"',
  'id="campaign-acceptance-status"'])assert.ok(html.includes(key),key);
 for(const key of ['renderCampaignAcceptancePrerequisites()','campaignAcceptanceLoadError',
  'state.campaignAcceptancePrerequisites=[]',
  "'campaignAcceptancePrerequisites','/api/v1/marketing-campaigns/finance-incidents/acceptance-prerequisites'",
  "$('campaign-acceptance-list').replaceChildren()"])assert.ok(ui.includes(key),key);
 const wf=read('.github/workflows/v3-2-core-api.yml');
 assert.ok(wf.includes(m.sql));
 assert.ok(wf.includes('chatgpt/v3-2-66-m02-cross-module-acceptance-protocol'));
 for(const path of ['api/openapi/market-sales.v1.json','api/openapi/crm-integration.v1.json'])
  assert.equal(JSON.parse(read(path))['x-contract-status'],m.external_contract_status);
 const doc=read('docs/V3.2-66_M02_CROSS_MODULE_ACCEPTANCE_PROTOCOL.md');
 for(const key of ['hold_active','proposed-unimplemented','001—038','不合并','不部署'])
  assert.ok(doc.includes(key),key);
});
