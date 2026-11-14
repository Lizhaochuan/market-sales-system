// V3.2-36: structural handover contract only.
// Passing checks verifies documentation/source consistency, NOT actual finance/CRM UAT.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
const read=relative=>readFileSync(resolve(root,relative),'utf8');
const manifest=JSON.parse(read('spec/v3-2-36-handover-baseline.json'));
const technical=read('docs/V3.2-36_MARKET_SALES_CROSS_MODULE_TECHNICAL_HANDOVER.md');
const decisions=read('docs/V3.2-36_INTEGRATION_READINESS_AND_DECISION_REGISTER.md');

test('V3.2-36 is a handover-only baseline: all production execution gates stay false',()=>{
 assert.equal(manifest.schema_version,'v3.2-36-handover-v1');
 assert.equal(manifest.repository,'Lizhaochuan/market-sales-system');
 assert.equal(manifest.baseline_sha,
  'f412d95ae01cbe7a108a006c637b34587cad4f57');
 assert.equal(manifest.baseline_draft_pr,42);
 assert.equal(manifest.scope,'independent-market-sales-only');
 assert.equal(manifest.migrations.new_migration_this_stage,false);
 for(const flag of [
  'production_integration_allowed','execution_allowed','release_allowed',
  'real_finance_source_connected','real_crm_source_connected',
  'live_authority_verified','real_business_uat_completed',
  'production_release_authorized','original_order_mutation_allowed',
  'original_payment_allocation_mutation_allowed',
  'original_lesson_history_mutation_allowed',
  'v3_2_23_mistaken_link_release_usable_for_downstream_wrong_student',
  'merge_authorized','deploy_authorized'
 ]) assert.equal(manifest[flag],false,flag);
 for(const flag of [
  'student_primary_management_unit','family_relation_optional',
  'wrong_student_downstream_hold_required','requires_manual_external_approval'
 ]) assert.equal(manifest[flag],true,flag);
 assert.equal(manifest.contract_state,'proposed-unimplemented');
});

test('V3.2-24 through 35 has exactly twelve successive traceable phases and thirteen docs',()=>{
 assert.equal(manifest.phase_range.phase_count,12);
 assert.equal(manifest.phase_range.first,'V3.2-24');
 assert.equal(manifest.phase_range.last,'V3.2-35');
 assert.equal(manifest.phases.length,12);
 const docPaths=[];
 for(let i=0;i<12;i++){
  const phase=manifest.phases[i];
  assert.equal(phase.version,'V3.2-'+(24+i));
  assert.ok(typeof phase.scope==='string'&&phase.scope.length>12);
  assert.ok(Array.isArray(phase.docs)&&phase.docs.length>0);
  for(const document of phase.docs){
   assert.ok(document.startsWith('docs/V3.2-'+(24+i)+'_'),document);
   assert.ok(existsSync(resolve(root,document)),'Missing handover source '+document);
   assert.ok(read(document).startsWith('# V3.2-'+(24+i)),document);
   docPaths.push(document);
  }
  if(i===0){
   assert.equal(phase.kind,'design_only');
   assert.equal(phase.migration,null);
  }else{
   assert.equal(phase.kind,'isolated_fixture');
   assert.equal(phase.migration?.slice(14,17),
    String(i+27).padStart(3,'0'),phase.version);
   assert.ok(existsSync(resolve(root,phase.migration)),phase.migration);
  }
 }
 assert.equal(docPaths.length,13);
 assert.equal(new Set(docPaths).size,13);
});

test('migrations 001-038 are sequential and V3.2-25..35 map to 028-038',()=>{
 const names=readdirSync(resolve(root,'db/migrations'))
  .filter(x=>/^\d{3}_.+\.sql$/.test(x)).sort();
 assert.equal(manifest.migrations.first,'001');
 assert.equal(manifest.migrations.last,'038');
 assert.equal(names.length,manifest.migrations.expected_count);
 assert.deepEqual(names.map(x=>x.slice(0,3)),
  Array.from({length:38},(_,i)=>String(i+1).padStart(3,'0')));
 assert.equal(manifest.phases.slice(1).length,11);
 assert.deepEqual(manifest.phases.slice(1).map(p=>p.migration.slice(14,17)),
  Array.from({length:11},(_,i)=>String(i+28).padStart(3,'0')));
});

test('sixteen authority responsibilities correspond exactly to V3.2-31 SQL checks',()=>{
 const sql=read('db/migrations/034_preintegration_authority_hard_gates.sql');
 const departments={sales:3,finance:4,academic:4,security:5};
 const all=[];
 for(const [department,n] of Object.entries(departments)){
  const entries=manifest.responsibility_checks[department];
  assert.equal(entries.length,n,department);
  for(const check of entries){
   assert.match(check,new RegExp('^'+department+'_'));
   assert.ok(sql.includes("'"+check+"'"),'Missing SQL gate '+check);
   assert.ok(decisions.includes('`'+check+'`'),'Missing owner matrix '+check);
   all.push(check);
  }
 }
 assert.equal(all.length,16);
 assert.equal(new Set(all).size,16);
 assert.match(sql,/production_verified boolean NOT NULL DEFAULT false/);
 assert.match(sql,/CHECK\(NOT production_verified\)/);
 assert.ok(decisions.includes('12 项/来源'));
});

test('R01-R10 release AND-gates cannot be misrepresented as already approved',()=>{
 const design=read('docs/V3.2-24_CROSS_MODULE_WRONG_STUDENT_CORRECTION_DESIGN.md');
 const cases=read('docs/V3.2-24_CROSS_MODULE_CORRECTION_ACCEPTANCE.md');
 assert.equal(manifest.release_requirements.length,10);
 for(let i=1;i<=10;i++){
  const id='R'+String(i).padStart(2,'0');
  const gate=manifest.release_requirements[i-1];
  assert.equal(gate.id,id);
  assert.equal(gate.acceptance,'BLOCKED_NOT_RUN');
  assert.equal(gate.production_pass,false);
  assert.ok(gate.description.length>14,id);
  assert.ok(design.includes(id),'Missing design gate '+id);
  assert.ok(technical.includes(id),'Missing handover gate '+id);
 }
 assert.match(cases,/NOT RUN/);
 assert.ok(technical.includes('hold_active'));
 assert.ok(technical.includes('release_verified'));
 assert.ok(technical.includes('R01—R10'));
});

test('all external authority/operations dependencies remain actionable but blocked',()=>{
 const expected=[
  'AUTH-FIN','AUTH-CRM','AUTH-CONTRACT','AUTH-SEC',
  'EXEC-FIN','EXEC-CRM','RELEASE','OPERATIONS'
 ];
 assert.deepEqual(manifest.blocked_dependencies.map(p=>p.code),expected);
 for(const item of manifest.blocked_dependencies){
  assert.ok(['MISSING_EXTERNAL_APPROVAL','NOT_IMPLEMENTED','NOT_RUN']
   .includes(item.status),item.code);
  assert.ok(item.owner.length>6&&item.request.length>18,item.code);
  assert.ok(decisions.includes('`'+item.code+'`'),item.code);
 }
 for(const word of ['原订单','真实财务','CRM','hold_active',
  'proposed-unimplemented','不合并','不部署']){
  assert.ok(technical.includes(word),'Missing handover guard '+word);
 }
});

test('OpenAPI contracts are still proposals and handover CI hook is installed',()=>{
 for(const source of [
  'api/openapi/crm-integration.v1.json','api/openapi/market-sales.v1.json']){
  const doc=JSON.parse(read(source));
  assert.equal(doc['x-contract-status'],manifest.contract_state,source);
 }
 const ci=read('.github/workflows/v3-2-core-api.yml');
 assert.ok(ci.includes('v3-2-36-integration-handover.test.mjs'));
 assert.ok(ci.includes('db/migrations/038_fixture_uat_security_freeze_and_consistent_export.sql'));
 assert.ok(!ci.includes('db/migrations/039_'));
 assert.ok(technical.includes(manifest.deliverables.self));
 assert.ok(technical.includes(manifest.deliverables.integration_checklist));
 assert.ok(decisions.includes(manifest.deliverables.self));
});
