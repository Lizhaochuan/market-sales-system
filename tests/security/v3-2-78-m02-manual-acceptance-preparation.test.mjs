import test from 'node:test';
import assert from 'node:assert/strict';
import {createIsolatedManualAcceptancePreparation} from '../../src/cross-module-manual-acceptance-preparation.mjs';
const org='11111111-1111-4111-8111-111111111111';
const alt='22222222-2222-4222-8222-222222222222';
const incident='33333333-3333-4333-8333-333333333333';
const requirements=[
 ['finance_signature','finance','sales'],
 ['academic_signature','academic','sales'],
 ['order_payment_reconciliation','finance','sales'],
 ['lesson_entitlement_reconciliation','academic','sales'],
 ['three_party_joint_acceptance','sales','finance'],
 ['external_atomic_receipt','sales','academic']
];
function setup(){
 let revision=1;
 const identities=new Map([
  ['f-owner',{role:'finance',active:true}],['a-owner',{role:'academic',active:true}],
  ['s-owner',{role:'sales',active:true}],['f-check',{role:'finance',active:true}],
  ['a-check',{role:'academic',active:true}],['s-check',{role:'sales',active:true}]
 ]);
 const ledger=createIsolatedManualAcceptancePreparation({
  getFixtureEvidenceRevision:()=>revision,
  getFixtureActor:(organization_id,actor_id)=>{
   const a=identities.get(actor_id);
   return a?{actor_id,role:a.role,active:a.active,organization_id,fixture_only:true}:null;
  }
 });
 const request=(requirement_code,stage,actor_id,idempotency_key,extra={})=>({
  organization_id:org,incident_id:incident,requirement_code,stage,actor_id,
  source_revision:revision,evidence_sha256:'a'.repeat(64),idempotency_key,...extra});
 const report=()=>ledger.report({organization_id:org,incident_id:incident});
 return {ledger,request,report,identities,setRevision:x=>{revision=x;}};
}
function safe(x){
 assert.equal(x.hold_active,true);
 for(const k of ['authoritative_evidence_verified','external_signature_verified',
  'independent_three_party_acceptance_verified','finance_authorized',
  'academic_authorized','handoff_allowed','compensation_write_allowed',
  'release_eligible','production_integration_allowed'])
  assert.equal(x[k],false,k);
 assert.equal(Object.isFrozen(x),true);
}
test('V3.2-78 six-stage preparation stays blocked even with all local reviews',()=>{
 const f=setup();safe(f.report());assert.equal(f.report().items.length,6);
 for(const [code,owner,checker] of requirements){
  const a=owner[0]+'-owner',b=checker[0]+'-check';
  const first=f.ledger.record(f.request(code,'submitted',a,code+'-submit-nonce-0001'));
  assert.equal(f.ledger.record(f.request(code,'submitted',a,code+'-submit-nonce-0001')),first);
  f.ledger.record(f.request(code,'reviewed',b,code+'-review-nonce-0001'));
 }
 const all=f.report();safe(all);
 assert.equal(all.fixture_materials_prepared,true);
 assert.equal(all.items.length,6);
 assert.equal(all.items.filter(x=>x.status==='fixture_review_recorded_not_authorized').length,6);
 assert.equal(f.ledger.audit({organization_id:org,incident_id:incident}).length,12);
});
test('V3.2-78 independent review requires original submission and digest match',()=>{
 const f=setup();
 assert.throws(()=>f.ledger.record(f.request('finance_signature','reviewed','s-check','review-nonce-00001')),{code:'SUBMISSION_REQUIRED_BEFORE_INDEPENDENT_REVIEW'});
 assert.throws(()=>f.ledger.record(f.request('finance_signature','submitted','s-owner','submit-nonce-00001')),{code:'INDEPENDENT_FIXTURE_ACTOR_NOT_VERIFIED'});
 f.ledger.record(f.request('finance_signature','submitted','f-owner','submit-nonce-00001'));
 assert.throws(()=>f.ledger.record(f.request('finance_signature','reviewed','s-check','review-nonce-00001',{evidence_sha256:'b'.repeat(64)})),{code:'REVIEW_EVIDENCE_DIGEST_MISMATCH'});
 assert.throws(()=>f.ledger.record(f.request('finance_signature','submitted','f-owner','submit-nonce-00002')),{code:'REQUIREMENT_STAGE_ALREADY_RECORDED'});
 f.ledger.record(f.request('finance_signature','reviewed','s-check','review-nonce-00001'));
 assert.equal(f.report().items[0].status,'fixture_review_recorded_not_authorized');
 f.identities.get('s-check').active=false;
 assert.equal(f.report().items[0].status,'reviewer_revoked_or_unavailable');
 safe(f.report());
});
test('V3.2-78 tenant mismatch, replay conflict and fake authority fail closed',()=>{
 const f=setup();const data=f.request('finance_signature','submitted','f-owner','submit-nonce-00001');
 assert.throws(()=>f.ledger.record({...data,organization_id:alt}),{code:'INDEPENDENT_FIXTURE_ACTOR_NOT_VERIFIED'});
 assert.throws(()=>f.ledger.record({...data,finance_authorized:true}),{code:'INVALID_MANUAL_PREPARATION_INPUT'});
 f.ledger.record(data);
 assert.throws(()=>f.ledger.record({...data,evidence_sha256:'b'.repeat(64)}),{code:'PREPARATION_IDEMPOTENCY_CONFLICT'});
 safe(f.report());
});
test('V3.2-78 revised source invalidates current preparation without deleting audit',()=>{
 const f=setup();f.ledger.record(f.request('finance_signature','submitted','f-owner','submit-nonce-00001'));
 f.setRevision(2);
 assert.equal(f.report().items[0].status,'awaiting_material');
 assert.equal(f.ledger.audit({organization_id:org,incident_id:incident}).length,1);
 assert.throws(()=>f.ledger.record(f.request('finance_signature','reviewed','s-check','review-nonce-00001',{source_revision:1})),{code:'SOURCE_REVISION_STALE'});
 safe(f.report());
});
