import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
const read=p=>readFileSync(resolve(root,p),'utf8');
const m=JSON.parse(read('spec/v3-2-61-m02-finance-handoff-integrity.json'));
test('V3.2-61 readiness remains read-only and rejects changed plan snapshots',()=>{
 const sql=read(m.sql);
 for(const k of ['CREATE OR REPLACE VIEW ms.scoped_isolated_campaign_finance_handoffs',
  'WITH (security_barrier=true)','blocked_missing_campaign','blocked_campaign_not_draft',
  'blocked_snapshot_mismatch','ready_for_external_manual_check',
  'q.campaign_snapshot IS DISTINCT FROM jsonb_build_object(',
  'q.requested_by=ms.current_scoped_staff_id()',
  'q.reviewed_by=ms.current_scoped_staff_id()',
  "q.status='sales_approved_pending_finance'","false AS finance_authorized",
  'false AS execution_allowed'])
  assert.ok(sql.includes(k),'Missing readiness safety '+k);
 for(const k of ['CREATE TABLE ms.marketing_costs','GRANT INSERT','CREATE FUNCTION ms.approve_finance'])
  assert.equal(sql.includes(k),false);
 const adapter=read('src/scoped-legacy-read-adapter.mjs');
 assert.ok(adapter.includes('campaign_status,readiness_status FROM ms.scoped_isolated_campaign_finance_handoffs'));
 const ui=read('web/app.js');
 assert.ok(ui.includes("x.readiness_status==='ready_for_external_manual_check'"));
 assert.ok(ui.includes('blocked_snapshot_mismatch'));
 assert.ok(ui.includes("state.campaignFinanceHandoffs=valid?items:[]"));
 const api=JSON.parse(read('api/openapi/m02-isolated-campaign-drafts.v3.2.json'));
 assert.equal(api['x-finance-readiness-does-not-authorize-spend'],true);
 assert.equal(api['x-finance-approval-implemented'],false);
});
test('V3.2-61 preserves external authority and all earlier isolation gates',()=>{
 assert.equal(m.schema_version,'v3.2-61-m02-finance-handoff-integrity-v1');
 assert.equal(m.parent_pr,67);
 assert.deepEqual(m.status_codes,['ready_for_external_manual_check',
 'blocked_missing_campaign','blocked_campaign_not_draft','blocked_snapshot_mismatch']);
 for(const k of ['finance_authorized','execution_allowed','release_allowed',
  'merge_authorized','deploy_authorized','production_integration_allowed','new_production_migration'])
  assert.equal(m[k],false,k);
 assert.equal(m.migration_count,38);
 assert.equal(readdirSync(resolve(root,'db/migrations')).filter(x=>/^\d{3}_.+\.sql$/.test(x)).length,38);
 const ci=read('.github/workflows/v3-2-core-api.yml');
 assert.ok(ci.includes(m.sql));
 assert.ok(ci.includes('chatgpt/v3-2-61-m02-finance-handoff-integrity'));
 const docs=read('docs/V3.2-61_M02_FINANCE_HANDOFF_INTEGRITY.md');
 for(const x of ['hold_active','001—038','proposed-unimplemented','不合并','不部署'])
  assert.ok(docs.includes(x),x);
});
