import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeUntrustedAuthorityCandidate as normalize} from '../../src/cross-module-authority-contract.mjs';

const now=Date.parse('2026-11-14T05:30:00.000Z');
const finance={
 schema_version:'v3.2-27-readonly-v1',department:'finance',
 source_kind:'finance_receipt',source_system:'fictional_finance',
 source_tenant:'fictional_org_a',source_object_ref:'receipt:fictional-001',
 source_revision:'v1',reported_status:'unverified_response',
 observed_at:'2026-11-14T05:20:00.000Z',
 facts:{currency:'CNY',amount_cents:5000,original_record_ref:'order:fictional-001'}
};
const academic={
 ...finance,department:'academic',source_kind:'crm_entitlement',
 source_system:'fictional_crm',source_object_ref:'package:fictional-001',
 reported_status:'result_unknown',
 facts:{student_ref:'student:fictional-a',package_ref:'package:fictional-a',
 delivered_units:10,consumed_units:2,remaining_units:8}
};
const ctxF={expectedDepartment:'finance',expectedTenant:'fictional_org_a',
 allowedSourceSystems:['fictional_finance'],nowMs:now};
const ctxA={expectedDepartment:'academic',expectedTenant:'fictional_org_a',
 allowedSourceSystems:['fictional_crm'],nowMs:now};

test('V3.2-27 strict untrusted finance/CRM candidate envelope has no authority effect',async t=>{
 await t.test('finance schema accepted only as UNTRUSTED and deterministic hash',()=>{
  const x=normalize(finance,ctxF),y=normalize(finance,ctxF);
  assert.equal(x.candidate_sha256,y.candidate_sha256);
  assert.match(x.candidate_sha256,/^[a-f0-9]{64}$/);
  assert.equal(x.source_authenticated,false);
  assert.equal(x.financially_reconciled,false);
  assert.equal(x.crm_reconciled,false);
  assert.equal(x.execution_allowed,false);
  assert.equal(x.release_allowed,false);
  assert.throws(()=>{x.normalized.facts.amount_cents=999;},TypeError);
 });
 await t.test('CRM receipt with unknown delivery NEVER proves unissued hours',()=>{
  const x=normalize(academic,ctxA);
  assert.equal(x.normalized.reported_status,'result_unknown');
  assert.equal(x.execution_allowed,false);
  assert.equal(x.release_allowed,false);
 });
 const rejects=[
  ['missing external trusted context',finance,{}],
  ['wrong organization tenant',{...finance,source_tenant:'fictional_org_b'},ctxF],
  ['wrong authorized source system',{...finance,source_system:'attacker_proxy'},ctxF],
  ['finance actor cannot claim CRM department',academic,ctxF],
  ['CRM actor cannot claim finance',finance,ctxA],
  ['cross-domain category',{...finance,source_kind:'crm_attendance'},ctxF],
  ['client-provided verified status',{...finance,reported_status:'verified'},ctxF],
  ['client-provided completed status',{...academic,reported_status:'completed'},ctxA],
  ['forged execution permission',{...finance,execution_allowed:true},ctxF],
  ['forged authenticated field',{...finance,source_authenticated:true},ctxF],
  ['unexpected monetary unit',{...finance,facts:{...finance.facts,currency:'USD'}},ctxF],
  ['negative amount',{...finance,facts:{...finance.facts,amount_cents:-1}},ctxF],
  ['floating amount',{...finance,facts:{...finance.facts,amount_cents:1.3}},ctxF],
  ['unsafe integer amount',{...finance,facts:{...finance.facts,amount_cents:9007199254740992}},ctxF],
  ['arbitrary payload key',{...academic,facts:{...academic.facts,ignore_existing_lessons:true}},ctxA],
  ['consumed lessons exceed delivered',{...academic,facts:{...academic.facts,delivered_units:1,consumed_units:3}},ctxA],
  ['unsafe source reference',{...finance,source_object_ref:'../../secret bank account'},ctxF],
  ['blank revision',{...finance,source_revision:''},ctxF],
  ['stale observation',{...finance,observed_at:'2020-01-01T00:00:00.000Z'},ctxF],
  ['future observation',{...finance,observed_at:'2026-12-01T00:00:00.000Z'},ctxF],
  ['invalid timestamp',{...finance,observed_at:'not-a-date'},ctxF],
  ['unknown schema',{...finance,schema_version:'v3-2-28'},ctxF],
  ['prototype-based envelope',Object.create(finance),ctxF],
  ['missing finance reference',{...finance,facts:{currency:'CNY',amount_cents:5}},ctxF]
 ];
 for(const [name,body,context] of rejects){
  await t.test(name,()=>assert.throws(()=>normalize(body,context),TypeError));
 }
 await t.test('source content changes change digest but never gain authority',()=>{
  const x=normalize(finance,ctxF),y=normalize({...finance,
   facts:{...finance.facts,amount_cents:5010}},ctxF);
  assert.notEqual(x.candidate_sha256,y.candidate_sha256);
  assert.equal(y.source_authenticated,false);
 });
});
