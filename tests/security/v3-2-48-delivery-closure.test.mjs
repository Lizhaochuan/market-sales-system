import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const root=fileURLToPath(new URL('../../',import.meta.url));
const file=p=>resolve(root,p);
const read=p=>readFileSync(file(p),'utf8');
const spec=JSON.parse(read('spec/v3-2-48-delivery-closure-manifest.json'));

test('V3.2-48 must distinguish isolated implementation evidence from 14 production-ready modules',()=>{
 assert.equal(spec.schema_version,'v3.2-48-delivery-closure-v1');
 assert.equal(spec.repository,'Lizhaochuan/market-sales-system');
 assert.equal(spec.baseline_primary_last_pr,54);
 assert.equal(spec.baseline_primary_head,'9f438cdbb9ab85cb0a3ea2686b8d927c2e7bcb0a');
 assert.equal(spec.baseline_ci.run_id,43586142266);
 assert.equal(spec.baseline_ci.conclusion,'success');
 assert.equal(spec.baseline_ci.classification,'ISOLATED_CI_ONLY');
 assert.equal(spec.delivery_model,'DRAFT_CHAIN_NOT_MERGED_NO_PRODUCTION');
 assert.equal(spec.modules.length,14);
 const legal=new Set(['ISOLATED_PARTIAL','DESIGN_OR_SCHEMA_ONLY','EXTERNAL_AUTHORITY_BLOCKED']);
 for(let i=0;i<14;i++){
  const item=spec.modules[i];
  assert.equal(item.code,'M'+String(i+1).padStart(2,'0'));
  assert.ok(legal.has(item.assessment),'unverified production claim in '+item.code);
  assert.ok(item.limit.length>6);
  assert.ok(item.evidence.length>=1);
  for(const path of item.evidence)assert.ok(existsSync(file(path)),item.code+' missing: '+path);
 }
 assert.equal(spec.student_primary,true);
 assert.equal(spec.family_optional,true);
 assert.equal(spec.wrong_student_downstream_hold_active_required,true);
 assert.equal(spec.preserve_immutable_order_finance_saleevent_lesson_history,true);
});

test('V3.2-48 canonical open Draft chain cannot silently include alternatives',()=>{
 const canonical=[
  ...Array.from({length:23},(_,i)=>i+4),
  ...Array.from({length:9},(_,i)=>i+28),
  ...Array.from({length:16},(_,i)=>i+39)
 ];
 assert.deepEqual(spec.canonical_primary_pr_chain,canonical);
 assert.equal(canonical.length,48);
 assert.equal(new Set(canonical).size,48);
 assert.equal(canonical.at(-1),54);
 assert.deepEqual(spec.alternate_or_source_prs.map(p=>p.pr),[1,2,3,27,37,38]);
 for(const alt of [27,37,38])assert.ok(!canonical.includes(alt));
 assert.equal(spec.snapshot_compare_main.ahead_by,515);
 assert.equal(spec.snapshot_compare_main.behind_by,0);
 assert.equal(spec.snapshot_compare_main.changed_files,243);
 assert.match(spec.snapshot_compare_main.meaning,/NOT_A_MERGE/);
});

test('V3.2-48 database numbering and candidate migration conflict remain blocked',()=>{
 const names=readdirSync(file('db/migrations')).filter(n=>/^\d{3}_.+\.sql$/.test(n)).sort();
 assert.equal(names.length,38);
 assert.deepEqual(names.map(n=>n.slice(0,3)),Array.from({length:38},(_,i)=>String(i+1).padStart(3,'0')));
 assert.equal(spec.migration.expected_count,38);
 assert.equal(names[31],spec.migration.selected_032);
 assert.equal(names[34],spec.migration.selected_035);
 assert.equal(names.includes(spec.migration.unselected_032),false);
 assert.equal(names.includes(spec.migration.unselected_035),false);
 assert.equal(spec.migration.forbid_duplicates,true);
 assert.equal(spec.migration.forbid_039,true);
 assert.equal(spec.new_migration,false);
 for(const path of ['api/openapi/crm-integration.v1.json','api/openapi/market-sales.v1.json'])
  assert.equal(JSON.parse(read(path))['x-contract-status'],'proposed-unimplemented');
});

test('V3.2-48 delivery report must not grant external authority, merging, or release',()=>{
 const g=spec.external_gates;
 assert.equal(g.required_count,16);
 for(const key of ['all_real_approvals_complete','r01_to_r10_completed','finance_authority_verified',
   'crm_authority_verified','independent_uat_passed','real_data_integration_started'])
  assert.equal(g[key],false,key);
 for(const key of ['production_integration_allowed','execution_allowed','release_allowed',
   'merge_authorized','deploy_authorized','other_crm_repository_unchanged'])
  assert.equal(spec[key],key==='other_crm_repository_unchanged',key);
 assert.equal(spec.production_status,'BLOCKED');
 const doc=read('docs/V3.2-48_MARKET_SALES_DELIVERY_CLOSURE.md');
 const readme=read('README.md');
 for(const phrase of ['M01','M14','hold_active','R01','R10','BP-01','TP-01','不合并','不部署',
  'proposed-unimplemented','001—038'])
  assert.ok(doc.includes(phrase),'missing delivery boundary: '+phrase);
 assert.ok(readme.includes('docs/V3.2-48_MARKET_SALES_DELIVERY_CLOSURE.md'));
});
