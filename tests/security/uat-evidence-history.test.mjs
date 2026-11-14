import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyBlockedFixtureHistory,renderBlockedFixtureHistoryMarkdown}
 from '../../src/uat-evidence-history.mjs';

const request='20000000-0000-4000-8000-000000000123';
const add=(sequence=1,ref='fictional_audit_alpha')=>({
 sequence,check_code:'finance_reconciliation',event_kind:'fixture_added',
 fixture_ref:ref,parent_sequence:null,reason_code:'fixture_received',
 created_at:'2026-11-14T00:00:00.000Z'
});
const withdrawal=(sequence=2,ref='fictional_audit_alpha',parent=1)=>({
 sequence,check_code:'finance_reconciliation',event_kind:'fixture_withdrawn',
 fixture_ref:ref,parent_sequence:parent,reason_code:'fixture_revoked',
 created_at:'2026-11-14T00:00:10.000Z'
});
const base=()=>({
 schema_version:'v3.2-34-fixture-uat-audit-v1',
 source_request_id:request,department:'finance',
 from_sequence:0,to_sequence:2,current_sequence:2,
 changed_event_count:2,added_count:1,withdrawn_count:1,
 active_before:0,active_after:0,
 events:[add(),withdrawal()],
 real_evidence_verified:false,
 production_integration_allowed:false,execution_allowed:false,release_allowed:false
});
test('V3.2-34 only fictional immutable audit diff and zero real authority',async t=>{
 await t.test('added then withdrawn audit emits redacted Chinese timeline',()=>{
  const h=verifyBlockedFixtureHistory(base());
  assert.equal(h.from,0);assert.equal(h.to,2);
  assert.equal(h.activeBefore,0);assert.equal(h.activeAfter,0);
  assert.equal(h.added,1);assert.equal(h.withdrawn,1);
  assert.equal(h.execution_allowed,false);
  assert.equal(h.release_allowed,false);
  assert.equal(h.events[1].parentSequence,1);
  const md=renderBlockedFixtureHistoryMarkdown(base());
  assert.match(md,/虚构 UAT 证据历史/);
  assert.match(md,/禁止真实联调/);
  assert.match(md,/禁止解除学生错误关联隔离/);
  assert.match(md,/fictional_audit_alpha/);
  assert.ok(!md.includes('银行卡号'));
 });
 await t.test('empty history remains blocked despite no missing events',()=>{
  const empty={...base(),to_sequence:0,current_sequence:0,
   changed_event_count:0,added_count:0,withdrawn_count:0,events:[]};
  const h=verifyBlockedFixtureHistory(empty);
  assert.equal(h.events.length,0);
  assert.equal(h.status,'仍未取得真实权威证据');
  assert.equal(h.production_integration_allowed,false);
 });
 await t.test('range comparison with earlier parent can be verified as a diff',()=>{
  const x={...base(),from_sequence:1,to_sequence:2,events:[withdrawal()],
   changed_event_count:1,added_count:0,withdrawn_count:1,
   active_before:1,active_after:0};
  assert.equal(verifyBlockedFixtureHistory(x).withdrawn,1);
 });
 await t.test('forged success fields, wrong counts, wrong domains always fail',()=>{
  for(const name of ['real_evidence_verified','production_integration_allowed',
   'execution_allowed','release_allowed']){
   const x=base();x[name]=true;assert.throws(()=>verifyBlockedFixtureHistory(x),TypeError);
  }
  const changes=[
   x=>x.department='academic',
   x=>x.source_request_id='../../other',
   x=>x.to_sequence=3,
   x=>x.added_count=2,
   x=>x.active_after=1,
   x=>x.events[0].fixture_ref='real-bank-ref',
   x=>x.events[0].check_code='academic_attendance_balance',
   x=>x.events[0].event_kind='approved',
   x=>x.events[0].created_at='yesterday',
   x=>x.events[0].sequence=99,
   x=>x.events[1].parent_sequence=2,
   x=>x.events[1].fixture_ref='fictional_different_ref',
   x=>x.events[1].reason_code='fixture_received',
   x=>x.events.reverse(),
   x=>x.events.pop()
  ];
  for(const mutate of changes){
   const x=base();x.events=x.events.map(y=>({...y}));mutate(x);
   assert.throws(()=>verifyBlockedFixtureHistory(x),TypeError);
  }
 });
});
