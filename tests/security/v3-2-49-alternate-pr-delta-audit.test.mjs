import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
const read=p=>readFileSync(resolve(root,p),'utf8');
const p='spec/v3-2-49-alternate-pr-delta-audit.json';
const m=JSON.parse(read(p));
test('V3.2-49 alternative patch findings must not be silently treated as duplicate or shipped',()=>{
 assert.equal(m.schema_version,'v3.2-49-alternate-delta-audit-v1');
 assert.equal(m.baseline_pr,55);
 assert.equal(m.baseline_head,'2e4bdcfe3c4a063da549ca77aaf097c6c8b4e3b8');
 assert.equal(m.baseline_ci_run,43586865765);
 assert.equal(m.baseline_ci_outcome,'success');
 assert.deepEqual(m.alternates.map(x=>[x.alternate_pr,x.canonical_pr]),
  [[27,28],[37,34],[38,39]]);
 assert.deepEqual(m.alternates.map(x=>x.migration_number),['027','032','035']);
 for(const pair of m.alternates){
  assert.equal(pair.not_equivalent,true);
  assert.ok(pair.delta.length>15);
  assert.ok(pair.needs.length>25);
  assert.ok(pair.source_findings.length>=3);
  assert.ok(pair.canonical_findings.length>=3);
  assert.ok(!existsSync(resolve(root,'db/migrations',pair.alternate_migration)),
   'Conflicting migration unexpectedly entered selected mainline '+pair.alternate_migration);
  const selected=read('db/migrations/'+pair.selected_migration);
  for(const anchor of pair.canonical_findings)assert.ok(selected.includes(anchor),
   'Selected migration drifted: '+anchor);
 }
 assert.match(m.selection_policy,/DO_NOT_CHERRY_PICK/);
});
test('V3.2-49 preserves invariant migration numbers, source contracts and blocked release',()=>{
 const names=readdirSync(resolve(root,'db/migrations'))
  .filter(n=>/^\d{3}_.+\.sql$/.test(n)).sort();
 assert.equal(names.length,38);
 assert.deepEqual(names.map(x=>x.slice(0,3)),
  Array.from({length:38},(_,i)=>String(i+1).padStart(3,'0')));
 assert.equal(m.all_selected_migrations_expected,38);
 assert.equal(m.new_migration,false);
 assert.equal(m.migration_039_allowed,false);
 assert.equal(m.candidate_prs_preserved_as_drafts,true);
 for(const k of ['merge_authorized','deploy_authorized','execution_allowed',
  'production_integration_allowed','release_allowed','real_approvals_complete'])
  assert.equal(m[k],false,k);
 assert.equal(m.student_primary,true);
 assert.equal(m.family_optional,true);
 assert.equal(m.wrong_student_hold_active_required,true);
 assert.equal(m.preserve_original_orders_finance_saleevent_and_lesson_history,true);
 for(const path of ['api/openapi/market-sales.v1.json',
  'api/openapi/crm-integration.v1.json'])
  assert.equal(JSON.parse(read(path))['x-contract-status'],m.contracts);
 const doc=read('docs/V3.2-49_ALTERNATE_PR_DELTA_AUDIT.md');
 for(const phrase of ['#27','#37','#38','hold_active','不合并',
  '不部署','proposed-unimplemented','001—038'])
  assert.ok(doc.includes(phrase),'Missing conflict disclosure '+phrase);
 const gate=read('db/migrations/034_preintegration_authority_hard_gates.sql');
 assert.match(gate,/CHECK\(NOT production_verified\)/);
 assert.ok(read('README.md').includes('docs/V3.2-48_MARKET_SALES_DELIVERY_CLOSURE.md'));
});
