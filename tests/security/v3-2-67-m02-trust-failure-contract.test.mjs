import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
const read=p=>readFileSync(resolve(root,p),'utf8');
const m=JSON.parse(read('spec/v3-2-67-m02-three-party-trust-failure-gates.json'));
test('V3.2-67 trust failure projection cannot authorize spend, compensation or release',()=>{
 assert.equal(m.schema_version,'v3.2-67-m02-three-party-trust-failure-gates-v1');
 assert.equal(m.parent_pr,73);assert.equal(m.parent_ci,43617160948);
 assert.equal(m.parent_ci_conclusion,'success');assert.equal(m.max_items,100);
 assert.deepEqual(m.failure_codes,[
  'blocked_sales_packet_incomplete','blocked_external_finance_trust_chain_unavailable']);
 const sql=read(m.sql);
 for(const k of ['CREATE VIEW ms.scoped_isolated_campaign_cross_module_trust_failure_gates',
  'WITH (security_barrier=true)',
  'FROM ms.scoped_isolated_campaign_cross_module_acceptance_prerequisites p',
  'ms.current_scoped_staff_id() IS NOT NULL',
  "'blocked_sales_packet_incomplete'","'blocked_external_finance_trust_chain_unavailable'",
  'reject_preserve_originals_escalate_manually',
  'append_only_compensation_requires_independent_authority',
  'false AS external_signature_verified','false AS signature_key_current_verified',
  'false AS signer_revocation_checked','false AS replay_nonce_registry_checked',
  'false AS compensation_write_allowed','false AS original_records_mutable',
  'false AS release_eligible','true AS hold_active',
  'false AS finance_authorized','false AS execution_allowed',
  'GRANT SELECT ON ms.scoped_isolated_campaign_cross_module_trust_failure_gates'])
  assert.ok(sql.includes(k),'Missing mandatory trust boundary '+k);
 for(const k of ['GRANT INSERT ON ms.marketing_costs',
  'CREATE FUNCTION ms.accept_finance','CREATE TABLE ms.compensation_execution',
  'GRANT UPDATE ON ms.scoped_isolated_campaign_cross_module_trust_failure_gates'])
  assert.equal(sql.includes(k),false,k);
 const readAdapter=read('src/scoped-legacy-read-adapter.mjs');
 assert.ok(readAdapter.includes("'listCampaignCrossModuleTrustFailureGates'"));
 assert.ok(readAdapter.includes('FROM ms.scoped_isolated_campaign_cross_module_trust_failure_gates'));
 assert.ok(readAdapter.includes('LIMIT 101'));
 const api=JSON.parse(read('api/openapi/m02-isolated-campaign-drafts.v3.2.json'));
 const op=api.paths['/api/v1/marketing-campaigns/finance-incidents/trust-failure-gates'];
 assert.ok(op.get);assert.equal(op.post,undefined);
 assert.equal(api['x-external-signature-verification-implemented'],false);
 assert.equal(api['x-incident-compensation-write-implemented'],false);
});
test('V3.2-67 all production and CRM correction safety gates remain blocked',()=>{
 for(const k of ['external_signature_verifier_implemented','finance_trust_anchor_configured',
  'academic_trust_anchor_configured','external_revocation_registry_configured',
  'external_nonce_registry_configured','compensation_write_allowed',
  'original_records_mutable','finance_authorized','execution_allowed','release_allowed',
  'merge_authorized','deploy_authorized','production_integration_allowed','new_production_migration'])
  assert.equal(m[k],false,k);
 assert.equal(m.default_failure_disposition,'reject_preserve_originals_escalate_manually');
 assert.equal(m.compensation_boundary,'append_only_compensation_requires_independent_authority');
 for(const k of ['student_primary','family_optional','downstream_wrong_student_hold_active',
  'original_orders_payments_saleevents_lesson_history_preserved'])
  assert.equal(m[k],true,k);
 assert.equal(m.latest_head_ci,'PENDING');
 assert.equal(readdirSync(resolve(root,'db/migrations')).filter(x=>/^\d{3}_.+\.sql$/.test(x)).length,38);
 const ui=read('web/app.js'),html=read('web/index.html');
 for(const k of ['id="campaign-trust-failure-list"','id="campaign-trust-failure-total"',
   'id="campaign-trust-failure-status"'])assert.ok(html.includes(k),k);
 for(const k of ['renderCampaignTrustFailureGates()',
  'campaignTrustFailureLoadError','state.campaignTrustFailureGates=[]',
  "'campaignTrustFailureGates','/api/v1/marketing-campaigns/finance-incidents/trust-failure-gates'",
  "$('campaign-trust-failure-list').replaceChildren()"])assert.ok(ui.includes(k),k);
 const wf=read('.github/workflows/v3-2-core-api.yml');
 assert.ok(wf.includes(m.sql));
 assert.ok(wf.includes('chatgpt/v3-2-67-m02-three-party-trust-failure-gates'));
 assert.ok(wf.includes('node --check src/cross-module-signature-preflight.mjs'));
 for(const path of ['api/openapi/market-sales.v1.json','api/openapi/crm-integration.v1.json'])
  assert.equal(JSON.parse(read(path))['x-contract-status'],m.external_contract_status);
 const d=read('docs/V3.2-67_M02_THREE_PARTY_TRUST_FAILURE_GATES.md');
 for(const k of ['hold_active','proposed-unimplemented','001—038','不合并','不部署'])
  assert.ok(d.includes(k),k);
});
