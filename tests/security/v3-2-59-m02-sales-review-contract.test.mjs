import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
const read=p=>readFileSync(resolve(root,p),'utf8');
const m=JSON.parse(read('spec/v3-2-59-m02-sales-review-finance-hold.json'));
test('V3.2-59 sales approval is independent and never releases finance execution',()=>{
 assert.equal(m.schema_version,'v3.2-59-m02-sales-review-finance-hold-v1');
 assert.equal(m.parent_pr,65);assert.equal(m.parent_ci,43598948163);
 assert.equal(m.parent_ci_conclusion,'success');
 assert.deepEqual(m.statuses,['pending_sales','sales_rejected','sales_approved_pending_finance']);
 const sql=read(m.sql);
 for(const s of [
  'CREATE TABLE ms.isolated_campaign_sales_reviews',
  'CREATE VIEW ms.scoped_isolated_campaign_sales_reviews WITH (security_barrier=true)',
  'ms.current_scoped_organization_id()','ms.current_scoped_staff_id()',
  'CREATE FUNCTION ms.request_isolated_campaign_sales_review(',
  'CREATE FUNCTION ms.decide_isolated_campaign_sales_review(',
  "r.role_code='sales_manager'",
  'q.requested_by=actor',
  "'sales_approved_pending_finance'",
  "'CAMPAIGN_SALES_REVIEW_REQUESTED'",
  "'CAMPAIGN_SALES_APPROVED_FINANCE_HOLD'",
  'finance_authorized',
  'TO ms_scoped_lowrisk_writer'])
  assert.ok(sql.includes(s),'Missing sales-only guard '+s);
 assert.ok(!sql.includes('GRANT UPDATE ON ms.marketing_campaigns'));
 assert.ok(!sql.includes('GRANT INSERT ON ms.marketing_costs'));
 const rev=read('tests/sql/create_v3_2_58_versioned_campaign_draft_revisions.sql');
 assert.ok(rev.includes("r.status IN"));
 assert.ok(rev.includes("'sales_approved_pending_finance'"));
 const app=read('src/app.mjs');
 for(const x of ["'listCampaignSalesReviews'","'requestCampaignSalesReview'",
  "'decideCampaignSalesReview'","review_campaign_sales:ctx.manager",
  "if(!strictStaffMode&&['listCampaignSalesReviews'"])
  assert.ok(app.includes(x),'Missing strict route '+x);
 const readAdapter=read('src/scoped-legacy-read-adapter.mjs');
 assert.ok(readAdapter.includes('FROM ms.scoped_isolated_campaign_sales_reviews'));
 const writeAdapter=read('src/scoped-legacy-write-adapter.mjs');
 assert.ok(writeAdapter.includes('ms.request_isolated_campaign_sales_review($1,$2,$3,$4,$5)'));
 assert.ok(writeAdapter.includes('ms.decide_isolated_campaign_sales_review($1,$2,$3,$4,$5)'));
 const o=JSON.parse(read('api/openapi/m02-isolated-campaign-drafts.v3.2.json'));
 assert.ok(o.paths['/api/v1/marketing-campaigns/sales-reviews'].get);
 assert.ok(o.paths['/api/v1/marketing-campaigns/drafts/{campaign_id}/sales-review-requests'].post);
 assert.ok(o.paths['/api/v1/marketing-campaigns/sales-reviews/{review_id}/decision'].post);
 assert.equal(o['x-production-integration-allowed'],false);
});
test('V3.2-59 UI and ongoing organization/student/finance boundaries remain blocked',()=>{
 for(const k of ['sales_approval_changes_campaign_status',
 'sales_approval_allows_finance_execution','sales_approval_allows_campaign_launch',
 'finance_approval_api_available','finance_approval_role_mapped',
 'finance_approval_simulated_as_real','raw_evidence_in_scoped_view',
 'staff_direct_ledger_table_access','new_production_migration',
 'production_integration_allowed','execution_allowed','release_allowed',
 'merge_authorized','deploy_authorized'])
  assert.equal(m[k],false,k);
 assert.equal(m.draft_revision_frozen_during_pending_and_finance_hold,true);
 assert.equal(m.staff_primary_student,true);assert.equal(m.family_on_demand,true);
 assert.equal(m.wrong_student_with_downstream_hold_active,true);
 assert.equal(m.original_orders_payments_saleevents_lesson_consumption_preserved,true);
 assert.equal(m.latest_head_ci,'PENDING');
 assert.equal(readdirSync(resolve(root,'db/migrations')).filter(n=>/^\d{3}_.+\.sql$/.test(n)).length,38);
 for(const p of ['api/openapi/market-sales.v1.json','api/openapi/crm-integration.v1.json'])
  assert.equal(JSON.parse(read(p))['x-contract-status'],m.external_contract_status);
 const js=read('web/app.js'),html=read('web/index.html');
 for(const s of ['id="campaign-sales-request-form"','id="campaign-sales-review-form"',
  'id="campaign-sales-list"'])assert.ok(html.includes(s),s);
 for(const s of ["register('campaign-sales-request-form'",
   "register('campaign-sales-review-form'","'campaignSalesReviews','/api/v1/marketing-campaigns/sales-reviews'",
   "$('campaign-sales-list').replaceChildren()"])
   assert.ok(js.includes(s),s);
 const ci=read('.github/workflows/v3-2-core-api.yml');
 assert.ok(ci.includes('create_v3_2_59_campaign_sales_review_finance_hold.sql'));
 assert.ok(ci.includes('chatgpt/v3-2-59-m02-campaign-sales-review-finance-hold'));
 const doc=read('docs/V3.2-59_M02_SALES_REVIEW_FINANCE_HOLD.md');
 for(const s of ['hold_active','不合并','不部署','001—038','proposed-unimplemented'])
  assert.ok(doc.includes(s),s);
});
