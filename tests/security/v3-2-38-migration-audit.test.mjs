import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
const read=p=>readFileSync(resolve(root,p),'utf8');
const a=JSON.parse(read('spec/v3-2-38-migration-conflict-audit.json'));
const d=read('docs/V3.2-38_MIGRATION_OBJECT_CONFLICT_AUDIT.md');
test('V3.2-38 is non-production static review and all gates remain closed',()=>{
 assert.equal(a.schema_version,'v3.2-38-migration-audit-v1');
 assert.equal(a.parent_pr,44);
 for(const k of ['production_integration_allowed','execution_allowed','release_allowed','merge_authorized','deploy_authorized','real_business_uat_completed','new_migration'])assert.equal(a[k],false,k);
 assert.equal(a.hold_active_required,true);
 assert.equal(a.correct_student_primary,true);
 assert.equal(a.family_optional,true);
 assert.equal(a.recovery_test,'NOT_RUN');
 assert.equal(a.external_approvals,'MISSING');
 for(const word of ['hold_active','proposed-unimplemented','不合并','不部署','NOT RUN'])assert.ok(d.includes(word),word);
});
test('V3.2-38 reconciles two 032/035 variant migration numbers without changing mainline',()=>{
 assert.deepEqual(a.sql_variants.map(x=>x.migration),['032','035']);
 assert.deepEqual(a.sql_variants.map(x=>[x.primary_pr,x.alternate_pr]),[[34,37],[39,38]]);
 for(const v of a.sql_variants){
  assert.equal(v.decision,'KEEP_PRIMARY_ALTERNATE_REVIEW_REQUIRED');
  assert.ok(read(v.primary_path).length>1000,v.primary_path);
  assert.ok(d.includes(v.alternate_path),v.alternate_path);
 }
 const names=readdirSync(resolve(root,'db/migrations')).filter(x=>/^\d{3}_.+\.sql$/.test(x)).sort();
 assert.equal(names.length,38);
 assert.deepEqual(names.map(x=>x.slice(0,3)),Array.from({length:38},(_,i)=>String(i+1).padStart(3,'0')));
 assert.equal(a.migration_range.last,'038');
});
test('V3.2-38 does not promote tentative finance/CRM contracts',()=>{
 for(const p of ['api/openapi/crm-integration.v1.json','api/openapi/market-sales.v1.json'])assert.equal(JSON.parse(read(p))['x-contract-status'],'proposed-unimplemented');
 assert.equal(a.special_dependency.pr,38);
 assert.equal(a.special_dependency.provided_by_pr,34);
 assert.equal(a.special_dependency.uses,'ms.source_readiness_requests');
 assert.equal(a.review,'STATIC_ONLY_NOT_COMPLETE');
});
