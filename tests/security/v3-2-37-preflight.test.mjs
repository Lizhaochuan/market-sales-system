import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
const read=p=>readFileSync(resolve(root,p),'utf8');
const m=JSON.parse(read('spec/v3-2-37-preflight.json'));
const doc=read('docs/V3.2-37_INTEGRATION_DEPENDENCY_AND_PREFLIGHT.md');
test('V3.2-37 preserves non-production integration boundary',()=>{
 assert.equal(m.schema_version,'v3.2-37-preflight-v1');
 assert.equal(m.baseline_pr,43);
 assert.equal(m.baseline_sha,'3ad9d96afab9c860fb0eccd88b130aba0a1a38c7');
 assert.equal(m.scope,'documentation-only');
 assert.equal(m.status,'BLOCKED_NOT_AUTHORIZED');
 for(const k of ['new_migration','production_integration_allowed','execution_allowed','release_allowed','merge_authorized','deploy_authorized','real_business_uat_completed','all_review_tasks_complete'])assert.equal(m[k],false,k);
 assert.equal(m.wrong_student_downstream_hold_required,true);
 for(const k of ['hold_active','proposed-unimplemented','不合并','不部署','NOT RUN'])assert.ok(doc.includes(k),k);
});
test('V3.2-37 documents primary and alternate PR dependency branches',()=>{
 assert.deepEqual(m.primary_pr_chain,[29,30,31,32,33,34,35,36,39,40,41,42,43]);
 assert.deepEqual(m.alternate_prs.map(x=>x.number),[37,38]);
 for(const n of [...m.primary_pr_chain,...m.alternate_prs.map(x=>x.number)])assert.ok(doc.includes('#'+n),'PR '+n);
 for(const item of m.alternate_prs)assert.equal(item.decision,'NOT_SELECTED_REVIEW_REQUIRED');
});
test('V3.2-37 does not bypass authority or invent migration 039',()=>{
 const names=readdirSync(resolve(root,'db/migrations')).filter(x=>/^\d{3}_.+\.sql$/.test(x)).sort();
 assert.equal(m.migration_first,'001');assert.equal(m.migration_last,'038');
 assert.equal(names.length,m.migration_count);
 assert.deepEqual(names.map(x=>x.slice(0,3)),Array.from({length:38},(_,i)=>String(i+1).padStart(3,'0')));
 assert.deepEqual(m.required_approvals,['AUTH-FIN','AUTH-CRM','AUTH-CONTRACT','AUTH-SEC']);
 const prior=JSON.parse(read('spec/v3-2-36-handover-baseline.json'));
 assert.equal(prior.blocked_dependencies.length,8);
 for(const dep of m.required_approvals)assert.ok(prior.blocked_dependencies.some(x=>x.code===dep));
 for(const p of ['api/openapi/market-sales.v1.json','api/openapi/crm-integration.v1.json'])assert.equal(JSON.parse(read(p))['x-contract-status'],'proposed-unimplemented');
});
