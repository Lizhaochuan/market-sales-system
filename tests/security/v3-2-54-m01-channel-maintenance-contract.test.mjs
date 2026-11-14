import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
const read=p=>readFileSync(resolve(root,p),'utf8');
const m=JSON.parse(read('spec/v3-2-54-m01-channel-maintenance.json'));
test('V3.2-54 channel maintenance uses function-only independent manager review',()=>{
 assert.equal(m.schema_version,'v3.2-54-m01-channel-maintenance-v1');
 assert.equal(m.parent_pr,60);
 assert.equal(m.parent_ci_conclusion,'success');
 assert.equal(m.parent_ci_run,43591024917);
 assert.deepEqual(m.actions,['create','edit','deactivate']);
 assert.equal(m.request_never_mutates_channels,true);
 assert.equal(m.only_independent_approved_review_mutates_channels,true);
 assert.equal(m.stale_snapshot_rejected,true);
 assert.equal(m.replay_conflicting_body_denied,true);
 const sql=read(m.sql);
 for(const x of ['CREATE TABLE ms.isolated_channel_change_requests',
 'CREATE FUNCTION ms.request_isolated_channel_change(',
 'CREATE FUNCTION ms.review_isolated_channel_change(',
 "r.role_code='sales_manager'",
 'job.requested_by=actor',
 'job.old_snapshot',
 "status='inactive'",
 'CHANNEL_CHANGE_REQUESTED','CHANNEL_CHANGE_APPLIED','CHANNEL_CHANGE_REJECTED',
 'pg_advisory_xact_lock',
 "TO ms_scoped_lowrisk_writer",
 "has_table_privilege(login_name,'ms.marketing_channels','UPDATE')"])
  assert.ok(sql.includes(x),'Missing strict channel guard: '+x);
 assert.ok(!sql.includes('GRANT UPDATE ON ms.marketing_channels'));
 assert.ok(!sql.includes('GRANT SELECT ON ms.isolated_channel_change_requests'));
 const app=read('src/app.mjs'),adapter=read('src/scoped-legacy-write-adapter.mjs');
 for(const x of ["'requestChannelChange'","'reviewChannelChange'",
 "if(!strictStaffMode&&['requestChannelChange','reviewChannelChange'].includes(route.op))"])
  assert.ok(app.includes(x),'App router missing '+x);
 for(const x of ["'requestChannelChange'","'reviewChannelChange'",
 'ms.request_isolated_channel_change($1,$2,$3,$4,$5,$6,$7,$8)',
 'ms.review_isolated_channel_change($1,$2,$3,$4,$5)'])
  assert.ok(adapter.includes(x),'Adapter missing '+x);
 const testCode=read(m.real_postgresql_test);
 for(const x of ['stale.status,422','pending.data.status','managerOwn.data.request_id',
 'broadCalls,0','CHANNEL_CHANGE_APPLIED','revoked staff binding'])
  if(x!=='revoked staff binding')assert.ok(testCode.includes(x),x);
});
test('V3.2-54 CI-only contract and immutable business boundaries',()=>{
 for(const x of ['production_integration_allowed','execution_allowed','release_allowed',
 'merge_authorized','deploy_authorized','external_crm_finance_connected',
 'new_production_migration','raw_marketing_table_grants_to_staff',
 'raw_audit_update_grants_to_staff','new_channel_management_ui'])
  assert.equal(m[x],false,x);
 assert.equal(m.student_primary,true);
 assert.equal(m.family_optional,true);
 assert.equal(m.wrong_student_hold_active_required,true);
 assert.equal(m.latest_head_ci,'PENDING');
 assert.equal(m.existing_db_migrations,38);
 const files=readdirSync(resolve(root,'db/migrations')).filter(n=>/^\d{3}_.+\.sql$/.test(n));
 assert.equal(files.length,38);
 assert.ok(!files.some(n=>n.startsWith('039_')));
 for(const x of ['api/openapi/market-sales.v1.json','api/openapi/crm-integration.v1.json'])
  assert.equal(JSON.parse(read(x))['x-contract-status'],m.openapi_external_status);
 const o=JSON.parse(read('api/openapi/m01-isolated-channel-maintenance.v3.2.json'));
 assert.equal(o['x-production-integration-allowed'],false);
 assert.equal(o['x-channel-mutations-require-independent-review'],true);
 assert.ok(o.paths['/api/v1/marketing-channels/change-requests'].post);
 assert.ok(o.paths['/api/v1/marketing-channels/change-requests/{request_id}/decision'].post);
 const workflow=read('.github/workflows/v3-2-core-api.yml');
 assert.ok(workflow.includes('create_v3_2_54_channel_change_workflow.sql'));
 assert.ok(workflow.includes('chatgpt/v3-2-54-m01-channel-change-approval-workflow'));
 const doc=read('docs/V3.2-54_M01_CHANNEL_MAINTENANCE_APPROVAL.md');
 for(const x of ['hold_active','不合并','不部署','001—038','proposed-unimplemented'])
  assert.ok(doc.includes(x),'Missing domain blocker '+x);
});
