import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
const read=p=>readFileSync(resolve(root,p),'utf8');
const m=JSON.parse(read('spec/v3-2-69-m02-compensation-evidence-approval-gates.json'));
test('V3.2-69 staged approval evidence is unverified and immutable',()=>{
 assert.equal(m.schema_version,'v3.2-69-m02-compensation-evidence-approval-gates-v1');
 assert.equal(m.parent_pr,75);assert.equal(m.parent_ci,43619581974);
 assert.equal(m.parent_ci_conclusion,'success');assert.equal(m.max_items,100);
 assert.deepEqual(m.approval_order,[
   '01_sales_independent_case_review','02_finance_originals_and_signed_decision',
   '03_academic_student_lesson_signed_decision','04_joint_evidence_and_history_reconciliation'
 ]);
 const sql=read(m.sql);
 for(const part of [
  'CREATE VIEW ms.scoped_isolated_campaign_compensation_evidence_approval_gates',
  'WITH (security_barrier=true)',
  'FROM ms.scoped_isolated_campaign_compensation_responsibility_matrix c',
  'ms.current_scoped_staff_id() IS NOT NULL',
  "'blocked_sales_evidence_missing'",
  "'blocked_independent_sales_case_authority_missing'",
  'false AS sales_original_snapshot_verified','false AS sales_independent_case_approved',
  'false AS finance_original_order_evidence_verified',
  'false AS finance_original_payment_evidence_verified',
  'false AS finance_independent_decision_signed',
  'false AS academic_student_identity_verified',
  'false AS academic_original_lesson_evidence_verified',
  'false AS academic_independent_decision_signed',
  'false AS compensation_history_chain_verified',
  'false AS external_replay_and_revocation_verified',
  'false AS all_source_record_hashes_verified',
  'false AS joint_three_party_approval_verified',
  'true AS preserve_original_orders_required',
  'true AS preserve_original_payments_required',
  'true AS preserve_original_sale_events_required',
  'true AS preserve_original_lessons_required',
  'false AS original_records_mutable','false AS compensation_write_allowed',
  'true AS hold_active','false AS release_eligible','false AS finance_authorized',
  'GRANT SELECT ON ms.scoped_isolated_campaign_compensation_evidence_approval_gates'
 ]) assert.ok(sql.includes(part),'Missing uncompromised checklist: '+part);
 for(const bad of ['CREATE FUNCTION ms.approve_compensation',
   'CREATE FUNCTION ms.release_isolation','GRANT INSERT ON ms.marketing_costs',
   'GRANT UPDATE ON ms.sales_orders',
   'GRANT UPDATE ON ms.scoped_isolated_campaign_compensation_evidence_approval_gates'])
  assert.equal(sql.includes(bad),false,bad);
 const app=read('src/app.mjs'),adapter=read('src/scoped-legacy-read-adapter.mjs');
 assert.ok(app.includes("'listCampaignCompensationEvidenceApprovalGates'"));
 assert.ok(adapter.includes('FROM ms.scoped_isolated_campaign_compensation_evidence_approval_gates'));
 assert.ok(adapter.includes('LIMIT 101'));
 const api=JSON.parse(read('api/openapi/m02-isolated-campaign-drafts.v3.2.json'));
 const route=api.paths['/api/v1/marketing-campaigns/finance-incidents/compensation-checklist'];
 assert.ok(route.get);assert.equal(route.post,undefined);
 assert.equal(api['x-compensation-independent-approval-implemented'],false);
 assert.equal(api['x-compensation-originals-verified'],false);
 assert.equal(api['x-compensation-isolation-release-implemented'],false);
});
test('V3.2-69 sales primary, history immutable and no production access',()=>{
 for(const k of ['independent_sales_compensation_approval_implemented',
  'finance_original_record_reconciliation_implemented',
  'academic_student_lesson_reconciliation_implemented',
  'joint_three_party_acceptance_implemented','compensation_execution_implemented',
  'original_records_integrity_verified','compensation_write_allowed',
  'original_records_mutable','finance_authorized','execution_allowed',
  'release_allowed','merge_authorized','deploy_authorized',
  'production_integration_allowed','new_production_migration'])
  assert.equal(m[k],false,k);
 for(const k of ['student_primary','family_optional','downstream_wrong_student_hold_active',
  'original_orders_payments_saleevents_lesson_history_preserved'])
  assert.equal(m[k],true,k);
 assert.equal(m.latest_head_ci,'PENDING');
 assert.equal(readdirSync(resolve(root,'db/migrations')).filter(x=>/^\d{3}_.+\.sql$/.test(x)).length,38);
 const html=read('web/index.html'),ui=read('web/app.js');
 for(const k of ['id="campaign-checklist-list"','id="campaign-checklist-status"',
   'id="campaign-checklist-total"'])assert.ok(html.includes(k),k);
 for(const k of ['renderCampaignCompensationChecklist()','campaignChecklistLoadError',
   'state.campaignCompensationChecklist=[]',
   "'campaignCompensationChecklist','/api/v1/marketing-campaigns/finance-incidents/compensation-checklist'",
   "$('campaign-checklist-list').replaceChildren()"])assert.ok(ui.includes(k),k);
 const wf=read('.github/workflows/v3-2-core-api.yml');
 assert.ok(wf.includes(m.sql));
 assert.ok(wf.includes('chatgpt/v3-2-69-m02-compensation-evidence-approval-gates'));
 for(const p of ['api/openapi/market-sales.v1.json','api/openapi/crm-integration.v1.json'])
  assert.equal(JSON.parse(read(p))['x-contract-status'],m.external_contract_status);
 const doc=read('docs/V3.2-69_M02_COMPENSATION_EVIDENCE_APPROVAL_GATES.md');
 for(const k of ['hold_active','proposed-unimplemented','001—038','不合并','不部署'])
  assert.ok(doc.includes(k),k);
});
