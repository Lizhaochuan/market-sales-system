import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
const read=p=>readFileSync(resolve(root,p),'utf8');
const m=JSON.parse(read('spec/v3-2-58-m02-versioned-campaign-revisions.json'));
test('V3.2-58 only owner may revise versioned drafts through protected function',()=>{
 assert.equal(m.schema_version,'v3.2-58-m02-versioned-campaign-draft-revisions-v1');
 assert.equal(m.parent_pr,64);assert.equal(m.parent_ci_run,43596399639);
 assert.equal(m.parent_ci_conclusion,'success');
 assert.deepEqual(m.business_status_allowed,['draft']);
 const sql=read(m.sql);
 for(const x of ['CREATE TABLE ms.isolated_campaign_draft_versions',
  'CREATE TABLE ms.isolated_campaign_draft_revision_receipts',
  'CREATE OR REPLACE VIEW ms.scoped_isolated_campaign_drafts',
  'COALESCE(v.version,1) AS version',
  'CREATE FUNCTION ms.revise_isolated_campaign_draft(',
  'campaign.owner_user_id IS DISTINCT FROM actor',
  "campaign.status<>'draft'",
  'current_version<>p_expected',
  'pg_advisory_xact_lock',
  "'CAMPAIGN_DRAFT_REVISED'",
  'before_business_json','after_business_json',
  'TO ms_scoped_lowrisk_writer'
 ])assert.ok(sql.includes(x),'Missing protected campaign revision property '+x);
 assert.ok(!sql.includes('GRANT UPDATE ON ms.marketing_campaigns'));
 assert.ok(!sql.includes('GRANT DELETE ON ms.campaign_channels'));
 const app=read('src/app.mjs'),write=read('src/scoped-legacy-write-adapter.mjs'),
  readAdapter=read('src/scoped-legacy-read-adapter.mjs');
 for(const x of ["'reviseCampaignDraft'","revise_own_campaign_draft:true",
  "if(!strictStaffMode&&route.op==='reviseCampaignDraft')"])
  assert.ok(app.includes(x),'Missing strict route '+x);
 assert.ok(write.includes("'reviseCampaignDraft'"));
 assert.ok(write.includes('ms.revise_isolated_campaign_draft($1,$2,$3,$4,$5,$6,$7,$8)'));
 assert.ok(readAdapter.includes('budget_cents,status,channel_ids,version FROM ms.scoped_isolated_campaign_drafts'));
});
test('V3.2-58 no published marketing/cost capabilities or changed production migrations',()=>{
 for(const k of ['direct_table_permission_granted','raw_audit_visible_to_staff',
  'campaign_activate_allowed','budget_approved','spend_or_cost_allocation_allowed',
  'finance_payment_mutation_allowed','source_attribution_allowed',
  'production_integration_allowed','execution_allowed','release_allowed',
  'merge_authorized','deploy_authorized','new_production_migration'])
  assert.equal(m[k],false,k);
 assert.equal(m.student_primary,true);assert.equal(m.family_optional,true);
 assert.equal(m.wrong_student_hold_active,true);
 assert.equal(m.historic_orders_payments_saleevents_lesson_consumption_preserved,true);
 assert.equal(m.latest_head_ci,'PENDING');
 assert.equal(readdirSync(resolve(root,'db/migrations')).filter(x=>/^\d{3}_.+\.sql$/.test(x)).length,38);
 const ui=read('web/index.html'),js=read('web/app.js');
 for(const x of ['id="campaign-revise-form"','id="campaign-revise-choice"',
  'id="campaign-revise-version"'])assert.ok(ui.includes(x));
 for(const x of ["register('campaign-revise-form'",
   "state.capabilities.revise_own_campaign_draft!==true",
   "expected_version:own.version","$('campaign-revise-choice').replaceChildren()"])
  assert.ok(js.includes(x),x);
 const o=JSON.parse(read('api/openapi/m02-isolated-campaign-drafts.v3.2.json'));
 assert.ok(o.paths['/api/v1/marketing-campaigns/drafts/{campaign_id}/revisions'].post);
 assert.equal(o['x-production-integration-allowed'],false);
 const workflow=read('.github/workflows/v3-2-core-api.yml');
 assert.ok(workflow.includes('create_v3_2_58_versioned_campaign_draft_revisions.sql'));
 assert.ok(workflow.includes('chatgpt/v3-2-58-m02-versioned-campaign-draft-revisions'));
 for(const p of ['api/openapi/market-sales.v1.json','api/openapi/crm-integration.v1.json'])
  assert.equal(JSON.parse(read(p))['x-contract-status'],m.external_contract_status);
 const doc=read('docs/V3.2-58_M02_VERSIONED_CAMPAIGN_REVISIONS.md');
 for(const x of ['hold_active','不合并','不部署','001—038','proposed-unimplemented'])
  assert.ok(doc.includes(x),x);
});
