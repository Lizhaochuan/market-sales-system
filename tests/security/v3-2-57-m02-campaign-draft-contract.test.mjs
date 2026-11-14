import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
const read=p=>readFileSync(resolve(root,p),'utf8');
const m=JSON.parse(read('spec/v3-2-57-m02-isolated-campaign-drafts.json'));
test('V3.2-57 M02 owner-bound only draft, bounded budget and channel security',()=>{
 assert.equal(m.schema_version,'v3.2-57-m02-isolated-campaign-drafts-v1');
 assert.equal(m.parent_pr,63);assert.equal(m.parent_ci_run,43594650394);
 assert.equal(m.parent_ci_conclusion,'success');
 assert.deepEqual(m.allowed_status,['draft']);
 assert.equal(m.max_campaigns_read,100);assert.equal(m.max_channels_per_draft,20);
 const sql=read(m.sql);
 for(const x of [
  'CREATE VIEW ms.scoped_isolated_campaign_drafts',
  'WITH (security_barrier=true)',
  'ms.current_scoped_staff_id()',
  'ms.current_scoped_organization_id()',
  'CREATE FUNCTION ms.create_isolated_campaign_draft(',
  "VALUES(org,trim(p_name),p_starts,p_ends,actor,p_budget,'draft')",
  'ms.isolated_campaign_draft_idempotency',
  "'CAMPAIGN_DRAFT_CREATED'",
  "TO ms_scoped_lowrisk_writer",
  "has_table_privilege(n,'ms.marketing_costs','INSERT')"
 ])assert.ok(sql.includes(x),'Missing M02 security property '+x);
 assert.ok(!sql.includes('GRANT INSERT ON ms.marketing_campaigns'));
 const app=read('src/app.mjs'),r=read('src/scoped-legacy-read-adapter.mjs'),w=read('src/scoped-legacy-write-adapter.mjs');
 for(const x of ["'listCampaignDrafts'","'createCampaignDraft'","create_campaign_draft:true"])
  assert.ok(app.includes(x),'Missing route or capability '+x);
 assert.ok(r.includes('FROM ms.scoped_isolated_campaign_drafts'));
 assert.ok(r.includes("'listCampaignDrafts'"));
 assert.ok(w.includes('ms.create_isolated_campaign_draft($1,$2,$3,$4,$5,$6)'));
 const o=JSON.parse(read('api/openapi/m02-isolated-campaign-drafts.v3.2.json'));
 assert.equal(o['x-production-integration-allowed'],false);
 assert.equal(o['x-marketing-costs-or-allocations-created'],false);
 assert.ok(o.paths['/api/v1/marketing-campaigns/drafts'].get);
 assert.ok(o.paths['/api/v1/marketing-campaigns/drafts'].post);
});
test('V3.2-57 UI and full CI remain isolated and preserve student/funds safeguards',()=>{
 const html=read(m.files.html),js=read(m.files.ui);
 for(const x of ['data-view="campaigns"','data-panel="campaigns"',
  'id="campaign-draft-form"','id="campaign-channel-choice"','id="campaigns-list"'])
  assert.ok(html.includes(x),x);
 for(const x of ['state.campaignLoadError',
  "'campaignDrafts','/api/v1/marketing-campaigns/drafts'",
  "register('campaign-draft-form'","$('campaigns-list').replaceChildren()"])
  assert.ok(js.includes(x),x);
 for(const k of ['direct_campaign_table_grants_to_staff',
  'campaign_draft_budget_is_spending_approval','spend_or_cost_allocation_allowed',
  'campaign_launch_allowed','source_attribution_allowed',
  'cross_organization_channels_allowed','inactive_or_inherited_inactive_channels_allowed',
  'real_finance_crm_connected','production_integration_allowed','execution_allowed',
  'release_allowed','merge_authorized','deploy_authorized','new_migration'])
  assert.equal(m[k],false,k);
 assert.equal(m.student_primary,true);assert.equal(m.family_optional,true);
 assert.equal(m.wrong_student_with_downstream_hold_active,true);
 assert.equal(m.original_saleevents_orders_payments_lesson_history_preserved,true);
 assert.equal(m.latest_head_ci,'PENDING');
 const migrations=readdirSync(resolve(root,'db/migrations')).filter(n=>/^\d{3}_.+\.sql$/.test(n));
 assert.equal(migrations.length,m.migration_count);
 for(const p of ['api/openapi/market-sales.v1.json','api/openapi/crm-integration.v1.json'])
  assert.equal(JSON.parse(read(p))['x-contract-status'],m.external_contract_status);
 const ci=read('.github/workflows/v3-2-core-api.yml');
 assert.ok(ci.includes('create_v3_2_57_isolated_campaign_drafts.sql'));
 assert.ok(ci.includes('chatgpt/v3-2-57-m02-isolated-campaign-drafts'));
 const doc=read('docs/V3.2-57_M02_ISOLATED_CAMPAIGN_DRAFTS.md');
 for(const x of ['hold_active','不合并','不部署','001—038','proposed-unimplemented'])
  assert.ok(doc.includes(x),'Missing safety boundary '+x);
});
