// Static, reproducible cross-stage evidence audit. All sources are CI-only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../../',import.meta.url));
const read=(p)=>readFileSync(resolve(root,p),'utf8');
const manifest=JSON.parse(read('spec/v3-2-100-m02-integration-review-manifest.json'));
const sha=/^[a-f0-9]{40}$/;
const importStages=/from\s+['"]\.\/?(?:\.\.\/)*cross-module-/;
const byStage=new Set(manifest.stages.map(x=>x.stage));
const unsafeFields=['finance_authorized','academic_authorized','handoff_allowed',
 'compensation_write_allowed','release_eligible','deploy_authorized',
 'merge_authorized'];

test('V3.2-100 manifest is scoped to one parent HEAD, 18 stages and denied release',()=>{
 assert.equal(manifest.schema_version,'v3.2-100-m02-integration-review-v1');
 assert.equal(manifest.reviewed_parent_pr,106);
 assert.ok(sha.test(manifest.reviewed_parent_head_sha));
 assert.equal(manifest.stages.length,18);
 assert.equal(byStage.size,18);
 assert.equal(manifest.coverage.stage_count,18);
 assert.equal(manifest.release_gate.hold_active,true);
 assert.equal(manifest.release_gate.external_contract_status,'proposed-unimplemented');
 assert.equal(manifest.release_gate.expected_production_migration_count_from_specs,38);
 assert.equal(manifest.release_gate.new_migrations_in_reviewed_prs,0);
 for(const field of unsafeFields)assert.equal(manifest.release_gate[field],false,field);
 assert.equal(manifest.release_gate.postgresql_test_result,undefined);
 assert.equal(manifest.coverage.postgresql_suite,'NOT_RUN');
 assert.equal(manifest.coverage.chromium_suite,'NOT_RUN');
 assert.equal(manifest.coverage.external_authority_contract_test,'NOT_RUN');
 assert.equal(manifest.coverage.production_e2e,'NOT_RUN');
});

test('V3.2-100 stage PR snapshot and parent chain are internally consistent',()=>{
 for(let i=0;i<18;i++){
  const x=manifest.stages[i],v=82+i;
  assert.equal(x.stage,'V3.2-'+v);
  assert.equal(x.pr_number,89+i);
  assert.equal(x.expected_parent_pr,88+i);
  assert.equal(x.pr_state_at_review,'draft_open_unmerged');
  assert.equal(x.pr_url,'https://github.com/Lizhaochuan/market-sales-system/pull/'+(89+i));
  assert.ok(sha.test(x.head_sha));
  assert.match(x.head_branch,new RegExp('^chatgpt/v3-2-'+v+'-m02-'));
  if(i)assert.equal(x.base_branch,manifest.stages[i-1].head_branch);
  assert.equal(x.ci.status,'completed');
  assert.equal(x.ci.conclusion,'success');
  assert.ok(Number.isSafeInteger(x.ci.run_id));
  assert.equal(x.pr_changed_file_count,5);
 }
 assert.equal(manifest.stages.at(-1).head_sha,manifest.reviewed_parent_head_sha);
});

test('V3.2-100 all 90 PR artifacts are present and CI-only specifications keep holds',()=>{
 const paths=new Set();
 for(let i=0;i<18;i++){
  const stage=manifest.stages[i],f=stage.files;
  assert.deepEqual(Object.keys(f).sort(),
   ['source','test','workflow','spec','document'].sort());
  for(const p of Object.values(f)){
   assert.ok(existsSync(resolve(root,p)),p+' must exist in checked out HEAD');
   assert.ok(!paths.has(p),'duplicate file: '+p);
   paths.add(p);
  }
  const spec=JSON.parse(read(f.spec));
  assert.equal(spec.module,'M02',f.spec);
  assert.equal(spec.parent_pr,88+i,f.spec);
  assert.equal(spec.external_contract_status,'proposed-unimplemented',f.spec);
  assert.equal(spec.migration_count,38,f.spec);
  assert.equal(spec.hold_active,true,f.spec);
  for(const field of unsafeFields){
   if(Object.hasOwn(spec,field))assert.equal(spec[field],false,f.spec+': '+field);
  }
  assert.ok(!Object.values(f).some(p=>/(^|\/)(?:migrations|prisma)\//.test(p)));
 }
 assert.equal(paths.size,90);
});

test('V3.2-100 all eighteen isolated factories are standalone, not production wiring',()=>{
 const app=read('src/app.mjs'),server=read('src/server.mjs');
 const pkg=JSON.parse(read('package.json'));
 assert.match(pkg.scripts['test'],/test:|node --test/);
 assert.ok(!/tests\/security\/v3-2-(8[2-9]|9[0-9])/.test(pkg.scripts['test']));
 for(const entry of manifest.stages){
  const code=read(entry.files.source);
  assert.match(code,/export\s+(?:async\s+)?function\s+createIsolated\w+/);
  assert.ok(!importStages.test(code),'Unexpected direct stage-module import: '+entry.files.source);
  assert.ok(!app.includes(entry.files.source.replace('src/','').replace(/\.mjs$/,'')));
  assert.ok(!server.includes(entry.files.source.replace('src/','').replace(/\.mjs$/,'')));
  assert.match(read(entry.files.test),/\btest\s*\(/);
  assert.ok(read(entry.files.test).includes(entry.files.source.split('/').at(-1)),
   'Stage test should import its source '+entry.files.test);
 }
});

test('V3.2-100 dedicated stage workflows run Node tests but omit doc/spec PR triggers',()=>{
 for(const entry of manifest.stages){
  const workflow=read(entry.files.workflow);
  assert.match(workflow,/pull_request:/);
  assert.match(workflow,/node-version:\s*['"]22['"]/);
  assert.match(workflow,/node --test/);
  assert.ok(workflow.includes(entry.files.test));
  assert.ok(!workflow.includes(entry.files.spec));
  assert.ok(!workflow.includes(entry.files.document));
 }
});

test('V3.2-100 findings remain non-releasing and distinguish offline from real acceptance',()=>{
 assert.equal(manifest.findings.length,7);
 assert.deepEqual(manifest.findings.map(x=>x.id),
  ['INT-001','INT-002','INT-003','INT-004','INT-005','INT-006','INT-007']);
 assert.ok(manifest.findings.some(x=>x.id==='INT-001'&&x.severity==='P0'));
 assert.equal(manifest.coverage.core_contract_suite_on_v3_2_99_head,'NOT_RUN');
 assert.ok(manifest.limitations.some(x=>x.includes('PostgreSQL')));
});
