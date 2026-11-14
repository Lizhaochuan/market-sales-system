import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
const read=p=>readFileSync(resolve(root,p),'utf8');
const m=JSON.parse(read('spec/v3-2-70-m02-immutable-evidence-packet-freeze.json'));
test('V3.2-70 packet freeze gates are read-only and never assert a real digest',()=>{
 assert.equal(m.schema_version,'v3.2-70-m02-immutable-evidence-packet-freeze-v1');
 assert.equal(m.parent_pr,76);assert.equal(m.parent_ci,43620862580);
 assert.equal(m.parent_ci_conclusion,'success');assert.equal(m.max_items,100);
 assert.equal(m.hash_algorithm,'SHA-256');
 const sql=read(m.sql);
 for(const part of [
  'CREATE VIEW ms.scoped_isolated_campaign_compensation_packet_freeze_gates',
  'WITH (security_barrier=true)',
  'FROM ms.scoped_isolated_campaign_compensation_evidence_approval_gates c',
  "WHERE c.incident_status='manual_escalated'",
  'ms.current_scoped_staff_id() IS NOT NULL',
  "'blocked_sales_packet_incomplete'",
  "'blocked_independent_sales_review_and_freeze_missing'",
  'fixture_only_not_available_in_runtime',
  'NULL::bigint AS frozen_source_revision','NULL::integer AS freeze_version',
  'NULL::text AS evidence_sha256','false AS evidence_packet_frozen',
  'false AS independent_sales_case_approved',
  'false AS trusted_source_revision_verified',
  'false AS canonical_digest_verified','false AS persistent_idempotency_registry_verified',
  'false AS revision_compare_and_swap_verified','false AS external_signature_verified',
  'false AS packet_handoff_allowed','false AS compensation_write_allowed',
  'true AS hold_active','false AS release_eligible',
  'false AS finance_authorized','false AS execution_allowed',
  'GRANT SELECT ON ms.scoped_isolated_campaign_compensation_packet_freeze_gates'
 ])assert.ok(sql.includes(part),'Missing freeze safety boundary: '+part);
 for(const bad of ['GRANT INSERT ON ms.marketing_costs','CREATE TABLE ms.production_evidence_packets',
  'CREATE FUNCTION ms.send_packet_to_finance',
  'GRANT UPDATE ON ms.scoped_isolated_campaign_compensation_packet_freeze_gates'])
  assert.equal(sql.includes(bad),false,bad);
 const adapter=read('src/scoped-legacy-read-adapter.mjs');
 assert.ok(adapter.includes("'listCampaignCompensationPacketFreezeGates'"));
 assert.ok(adapter.includes('FROM ms.scoped_isolated_campaign_compensation_packet_freeze_gates'));
 assert.ok(adapter.includes('LIMIT 101'));
 const api=JSON.parse(read('api/openapi/m02-isolated-campaign-drafts.v3.2.json'));
 const route=api.paths['/api/v1/marketing-campaigns/finance-incidents/packet-freeze-gates'];
 assert.ok(route.get);assert.equal(route.post,undefined);
 assert.equal(api['x-offline-evidence-freeze-fixture-implemented'],true);
 assert.equal(api['x-persistent-evidence-freeze-implemented'],false);
 assert.equal(api['x-cross-module-packet-handoff-implemented'],false);
});
test('V3.2-70 no fake authority, mutable history or migration',()=>{
 for(const k of ['authoritative_revision_integration_implemented',
 'persistent_freeze_registry_implemented','external_evidence_authenticity_verified',
 'finance_signed_receipt_verified','academic_signed_receipt_verified',
 'external_packet_handoff_implemented','compensation_write_allowed',
 'original_records_mutable','finance_authorized','execution_allowed',
 'release_allowed','merge_authorized','deploy_authorized',
 'production_integration_allowed','new_production_migration'])
  assert.equal(m[k],false,k);
 for(const k of ['offline_fixture_deterministic_freeze_implemented',
  'offline_fixture_nonce_replay_reject_implemented',
  'offline_fixture_stale_revision_reject_implemented','student_primary',
  'family_optional','downstream_wrong_student_hold_active',
  'original_orders_payments_saleevents_lesson_history_preserved'])
  assert.equal(m[k],true,k);
 assert.equal(m.latest_head_ci,'PENDING');
 assert.equal(readdirSync(resolve(root,'db/migrations')).filter(x=>/^\d{3}_.+\.sql$/.test(x)).length,38);
 const html=read('web/index.html'),ui=read('web/app.js');
 for(const k of ['id="campaign-packet-freeze-list"','id="campaign-packet-freeze-status"',
 'id="campaign-packet-freeze-total"'])assert.ok(html.includes(k),k);
 for(const k of ['renderCampaignPacketFreezeGates()','campaignPacketFreezeLoadError',
  'state.campaignPacketFreezeGates=[]',
  "'campaignPacketFreezeGates','/api/v1/marketing-campaigns/finance-incidents/packet-freeze-gates'",
  "$('campaign-packet-freeze-list').replaceChildren()"])assert.ok(ui.includes(k),k);
 const wf=read('.github/workflows/v3-2-core-api.yml');
 assert.ok(wf.includes(m.sql));
 assert.ok(wf.includes('node --check src/cross-module-evidence-freeze.mjs'));
 assert.ok(wf.includes('chatgpt/v3-2-70-m02-immutable-evidence-packet-freeze'));
 for(const p of ['api/openapi/market-sales.v1.json','api/openapi/crm-integration.v1.json'])
  assert.equal(JSON.parse(read(p))['x-contract-status'],m.external_contract_status);
 const doc=read('docs/V3.2-70_M02_IMMUTABLE_EVIDENCE_PACKET_FREEZE.md');
 for(const k of ['hold_active','proposed-unimplemented','001—038','不合并','不部署'])
  assert.ok(doc.includes(k),k);
});
