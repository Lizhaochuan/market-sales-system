import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const read=p=>readFileSync(resolve(root,p),'utf8');
const m=JSON.parse(read('spec/v3-2-44-inflight-revocation.json'));
test('V3.2-44 inserts a fresh identity check before every protected success response',()=>{
 assert.equal(m.schema_version,'v3.2-44-inflight-revocation-v1');
 assert.equal(m.parent_pr,50);
 assert.equal(m.late_authorization_checks,6);
 assert.equal(m.tested_revocation_window,'AFTER_DB_READ_BEFORE_HTTP_SEND');
 const src=read(m.runtime_source);
 assert.equal((src.match(/await confirmStillAuthorized\(\)/g)||[]).length,6);
 assert.match(src,/const confirmStillAuthorized=async\(\)=>\{/);
 assert.match(src,/ms\.scoped_employee_identity_valid\(\$1,\$2\) AS permitted/);
 const lines=src.split('\n');
 const successful=lines.filter(l=>/send\(res,200|res\.writeHead\(200/.test(l))
  .filter(l=>!l.includes('headers(type)'));
 assert.equal(successful.length,6);
 for(const line of successful){
  const i=lines.indexOf(line);
  assert.ok(lines.slice(Math.max(0,i-5),i).some(x=>x.includes('await confirmStillAuthorized()')),
   'Protected response missing late check: '+line);
 }
 const dynamic=read(m.dynamic_test);
 for(const anchor of [
  'Deterministically pause an actual database-backed list request',
  'FROM ms.scoped_uat_preview_choices','await continueResponse',
  "revoked_at=now()",'releaseRead();','deniedInFlight.status,403',
  'Promise.all(requests.map'
 ])assert.ok(dynamic.includes(anchor),anchor);
});
test('V3.2-44 does not claim atomic production revocation or enable any business writes',()=>{
 assert.equal(m.request_cancellation_before_revocation,false);
 assert.equal(m.atomic_revocation_and_delivery_guarantee,false);
 assert.equal(m.production_service_revocation_proven,false);
 for(const k of ['production_integration_allowed','execution_allowed','release_allowed',
  'merge_authorized','deploy_authorized','real_business_uat_completed',
  'real_finance_source_connected','real_crm_source_connected','new_migration'])
  assert.equal(m[k],false,k);
 assert.equal(m.blocked_release_status,'hold_active');
 assert.equal(m.student_primary,true);
 assert.equal(m.family_optional,true);
 assert.equal(m.ci_outcome,'PENDING_LATEST_HEAD_CI');
 for(const p of ['api/openapi/market-sales.v1.json','api/openapi/crm-integration.v1.json'])
  assert.equal(JSON.parse(read(p))['x-contract-status'],m.finance_crm_contract_status);
 const files=readdirSync(resolve(root,'db/migrations'))
  .filter(x=>/^\d{3}_.+\.sql$/.test(x));
 assert.equal(files.length,m.expected_migration_count);
 const doc=read('docs/V3.2-44_INFLIGHT_REVOCATION_RESPONSE_GATE.md');
 for(const word of ['hold_active','不合并','不部署','403','原子事务'])
  assert.ok(doc.includes(word),word);
});
