import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createIsolatedRecoveryReconfirmation} from '../../src/cross-module-recovery-reconfirmation.mjs';
import {createIsolatedRevocationLedger} from '../../src/cross-module-evidence-revocation-ledger.mjs';
import {createIsolatedThreePartyRecoveryCheck} from '../../src/cross-module-recovery-consistency.mjs';
import {createIsolatedFinalHandoffPreflight} from '../../src/cross-module-final-handoff-preflight.mjs';
const org='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
const incident='33333333-3333-4333-8333-333333333333';
const domains=['market_sales','finance','academic'];
const SHA='a'.repeat(64);
function fixture(){
 let epoch=1;
 let evidence={organization_id:org,incident_id:incident,generation:1,
  sources:domains.map(domain=>({domain,source_epoch:1,source_revision:1,
   revocation_sequence:0,revocation_digest:SHA,evidence_digest:'b'.repeat(64),
   hold_active:true,availability:'online'}))};
 let states=Object.fromEntries(domains.map(domain=>[domain,{
  organization_id:org,incident_id:incident,domain,source_epoch:1,
  source_revision:1,revocation_sequence:0,revocation_digest:SHA,
  recovery_generation:1,availability:'online',hold_active:true}]));
 const people={sales:{reviewer_id:'staffSales',role:'sales_evidence_check',active:true,fixture_only:true},
  audit:{reviewer_id:'staffAudit',role:'independent_safety_check',active:true,fixture_only:true}};
 const digest=()=>{
  const sources=evidence.sources.map(({domain,source_epoch,source_revision,
   revocation_sequence,revocation_digest,evidence_digest})=>
   ({domain,source_epoch,source_revision,revocation_sequence,revocation_digest,evidence_digest}));
  sources.sort((a,b)=>domains.indexOf(a.domain)-domains.indexOf(b.domain));
  return createHash('sha256').update(JSON.stringify({
   generation:evidence.generation,sources})).digest('hex');
 };
 const reconfirmation=createIsolatedRecoveryReconfirmation({
  getFixtureSnapshot:()=>evidence,
  getFixtureReviewer:(_,id)=>Object.values(people).find(x=>x.reviewer_id===id)||null
 });
 const ledger=createIsolatedRevocationLedger({getFixtureSourceEpoch:()=>epoch});
 const recovery=createIsolatedThreePartyRecoveryCheck({
  getFixtureSnapshot:async ({domain})=>states[domain]?{...states[domain]}:null});
 const gate=createIsolatedFinalHandoffPreflight({reconfirmation,recovery,ledger});
 const reference=()=>{
  const v=ledger.viewFixtureWatermark(org,incident);
  return {organization_id:org,incident_id:incident,source_epoch:epoch,
   revocation_sequence:v.revocation_sequence,
   revocation_digest:v.revocation_digest,evidence_event_ids:['E-1']};
 };
 const approve=()=>{
  const source_digest=digest();
  reconfirmation.reconfirm({organization_id:org,incident_id:incident,
   stage:'sales_evidence_check',reviewer_id:'staffSales',
   source_digest,idempotency_key:'v76-sales-review-nonce-00001'});
  reconfirmation.reconfirm({organization_id:org,incident_id:incident,
   stage:'independent_safety_check',reviewer_id:'staffAudit',
   source_digest,idempotency_key:'v76-audit-review-nonce-00001'});
 };
 const run=(afterFirstRead=async()=>{},overrides={})=>gate.check({
  organization_id:org,incident_id:incident,source_digest:digest(),
  revocation_reference:reference(),afterFirstRead,...overrides});
 return {gate,reconfirmation,ledger,recovery,people,evidence,states,approve,run,digest,
  setEpoch:x=>{epoch=x;}};
}
function blocked(x,reason){
 assert.equal(x.reason_code,reason);assert.equal(x.hold_active,true);
 for(const field of ['external_finance_signature_verified','external_academic_signature_verified',
  'original_orders_and_payments_reconciled','original_lessons_and_entitlements_reconciled',
  'independent_three_party_acceptance_verified','external_handoff_receipt_verified',
  'finance_authorized','academic_authorized','handoff_allowed','compensation_write_allowed',
  'release_eligible','production_integration_allowed'])
  assert.equal(x[field],false,field);
 assert.equal(Object.isFrozen(x),true);
}
test('V3.2-76 all fictional prechecks pass but external handoff remains impossible',async()=>{
 const f=fixture();f.approve();
 const result=await f.run();
 blocked(result,'BLOCKED_EXTERNAL_THREE_PARTY_ACCEPTANCE_AND_ATOMIC_HANDOFF_MISSING');
 for(const k of ['fixture_preflight_consistent','internal_review_consistent',
  'revocation_reference_current','three_domain_recovery_consistent'])
  assert.equal(result[k],true,k);
});
test('V3.2-76 missing review, revoked reviewer and forged external approval fail closed',async()=>{
 const f=fixture();
 blocked(await f.run(),'INTERNAL_RECONFIRMATION_INCOMPLETE_OR_STALE');
 f.approve();f.people.audit.active=false;
 blocked(await f.run(),'INTERNAL_RECONFIRMATION_INCOMPLETE_OR_STALE');
 f.people.audit.active=true;
 blocked(await f.run(async()=>{}, {external_finance_signature_verified:true}),
  'INVALID_FINAL_PREFLIGHT_INPUT');
 blocked(await f.run(async()=>{}, {organization_id:other}),
  'REVOCATION_REFERENCE_SCOPE_MISMATCH');
});
test('V3.2-76 async revocation and source changes invalidate final preflight',async()=>{
 const f=fixture();f.approve();
 const r=await f.run(async()=>{
  f.ledger.recordRevocation({organization_id:org,incident_id:incident,
   event_id:'E-1',event_sha256:SHA,source_epoch:1,
   revocation_sequence:1,idempotency_key:'v76-revocation-event-0001'});
 });
 blocked(r,'REVOCATION_CHANGED_AT_FINAL_READ');
 const another=fixture();another.approve();
 const change=await another.run(async()=>{another.evidence.sources[0].source_revision=2;});
 blocked(change,'INTERNAL_RECONFIRMATION_CHANGED_AT_FINAL_READ');
 const third=fixture();third.approve();
 const domain=await third.run(async()=>{third.states.academic.source_revision=2;});
 blocked(domain,'THREE_DOMAIN_RECOVERY_CHANGED_OR_UNAVAILABLE');
});
test('V3.2-76 revoked reference and dependency failures never grant access',async()=>{
 const f=fixture();f.approve();
 f.ledger.recordRevocation({organization_id:org,incident_id:incident,
  event_id:'E-1',event_sha256:SHA,source_epoch:1,
  revocation_sequence:1,idempotency_key:'v76-revocation-event-0001'});
 const stale=await f.run(async()=>{}, {revocation_reference:{
  organization_id:org,incident_id:incident,source_epoch:1,
  revocation_sequence:0,revocation_digest:createHash('sha256')
   .update(JSON.stringify([])).digest('hex'),evidence_event_ids:['E-1']}});
 blocked(stale,'REVOCATION_REFERENCE_STALE_OR_REVOKED');
 const unavailable=fixture();unavailable.approve();
 blocked(await unavailable.run(async()=>{throw Error('test network failure');}),
  'THREE_DOMAIN_RECOVERY_CHANGED_OR_UNAVAILABLE');
});
