import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
const read=p=>readFileSync(resolve(root,p),'utf8');
const m=JSON.parse(read('spec/v3-2-40-tenant-evidence-matrix.json'));
test('V3.2-40 only traces existing fixture test anchors',()=>{
 assert.equal(m.schema_version,'v3.2-40-evidence-matrix-v1');
 assert.equal(m.parent_pr,46);
 assert.equal(m.evidence_classification,'EXISTING_TEST_SOURCE_INSPECTED_NOT_LIVE_UAT');
 assert.equal(m.ci_latest_head_required,true);
 assert.equal(m.checks.length,10);
 for(let i=0;i<10;i++)assert.equal(m.checks[i].id,'T'+String(i+1).padStart(2,'0'));
 for(const check of m.checks.slice(0,6)){
  assert.equal(check.status,'EXISTING_FIXTURE_TEST');
  assert.ok(read(check.evidence).includes(check.anchor),'Missing test anchor '+check.id);
 }
 for(const check of m.checks.slice(6)){
  assert.equal(check.status,'NOT_PROVEN');
  assert.equal(check.evidence,null);
 }
});
test('V3.2-40 cannot promote CI evidence to authorization',()=>{
 for(const k of ['production_integration_allowed','execution_allowed','release_allowed','merge_authorized','deploy_authorized','real_business_uat_completed','new_migration'])assert.equal(m[k],false,k);
 assert.equal(m.hold_active_required,true);
 const d=read('docs/V3.2-40_TENANT_TEST_EVIDENCE_MATRIX.md');
 for(const word of ['hold_active','不合并','不部署','NOT PROVEN','proposed-unimplemented'])assert.ok(d.includes(word),word);
 for(const p of ['api/openapi/crm-integration.v1.json','api/openapi/market-sales.v1.json'])assert.equal(JSON.parse(read(p))['x-contract-status'],'proposed-unimplemented');
 const migrations=readdirSync(resolve(root,'db/migrations')).filter(x=>/^\d{3}_.+\.sql$/.test(x));
 assert.equal(migrations.length,38);
});
