import test from 'node:test';
import assert from 'node:assert/strict';
import {createIsolatedManualAcceptancePreparation} from '../../src/cross-module-manual-acceptance-preparation.mjs';
import {createIsolatedSupplementVersionChain} from '../../src/cross-module-supplement-version-chain.mjs';
import {createIsolatedSupplementReview} from '../../src/cross-module-supplement-independent-review.mjs';
const org='11111111-1111-4111-8111-111111111111';
const alt='22222222-2222-4222-8222-222222222222';
const incident='33333333-3333-4333-8333-333333333333';
const req='finance_signature',A='a'.repeat(64),B='b'.repeat(64),C='c'.repeat(64);
function fixture(){
 let revision=1,checkerActive=true;
 const actors={
  finance_owner:{actor_id:'finance_owner',role:'finance',organization_id:org,active:true,fixture_only:true},
  sales_checker:{actor_id:'sales_checker',role:'sales',organization_id:org,active:true,fixture_only:true}
 };
 const getFixtureActor=(_,id)=>id in actors?{...actors[id],
  active:id==='sales_checker'?checkerActive:true}:null;
 const preparation=createIsolatedManualAcceptancePreparation({
  getFixtureActor,getFixtureEvidenceRevision:()=>revision});
 const prepare=(nonce)=>preparation.record({organization_id:org,incident_id:incident,
  requirement_code:req,stage:'submitted',actor_id:'finance_owner',
  source_revision:revision,evidence_sha256:A,idempotency_key:nonce});
 prepare('prep-v80-submitted-nonce-0001');
 const supplements=createIsolatedSupplementVersionChain({
  preparation,getFixtureRevision:()=>revision});
 const append=(version,parent,evidence,nonce)=>supplements.append({
  organization_id:org,incident_id:incident,requirement_code:req,
  source_revision:revision,supplement_version:version,parent_digest:parent,
  evidence_sha256:evidence,submitted_by:'finance_owner',idempotency_key:nonce});
 const reviews=createIsolatedSupplementReview({supplements,preparation,getFixtureActor});
 const scope=()=>({organization_id:org,incident_id:incident,requirement_code:req});
 const reviewReq=(item,nonce,changes={})=>({
  organization_id:org,incident_id:incident,requirement_code:req,
  source_revision:item.source_revision,supplement_version:item.supplement_version,
  chain_digest:item.chain_digest,reviewer_id:'sales_checker',
  idempotency_key:nonce,...changes});
 return {append,reviews,scope,reviewReq,prepare,setRevision:n=>revision=n,
  setCheckerActive:flag=>checkerActive=flag};
}
function blocked(r){
 assert.equal(r.hold_active,true);assert.equal(Object.isFrozen(r),true);
 for(const k of ['external_evidence_authenticated','external_finance_signature_verified',
  'external_academic_signature_verified','independent_three_party_acceptance_verified',
  'finance_authorized','academic_authorized','handoff_allowed',
  'compensation_write_allowed','release_eligible','production_integration_allowed'])
  assert.equal(r[k],false,k);
}
test('V3.2-80 exact supplement review is independently recorded but never authorizes handoff',()=>{
 const f=fixture(),one=f.append(1,A,B,'v80-supplement-nonce-0001');
 blocked(f.reviews.report(f.scope()));
 const reviewed=f.reviews.review(f.reviewReq(one,'v80-review-nonce-0001'));
 assert.equal(reviewed.chain_digest,one.chain_digest);
 assert.equal(reviewed.original_submission_sha256,A);
 assert.strictEqual(f.reviews.review(f.reviewReq(one,'v80-review-nonce-0001')),reviewed);
 const state=f.reviews.report(f.scope());blocked(state);
 assert.equal(state.fixture_independent_supplement_review_current,true);
 assert.equal(f.reviews.audit(f.scope()).length,1);
});
test('V3.2-80 new supplement invalidates prior review while preserving immutable audit',()=>{
 const f=fixture(),one=f.append(1,A,B,'v80-supplement-nonce-0001');
 f.reviews.review(f.reviewReq(one,'v80-review-nonce-0001'));
 const two=f.append(2,one.chain_digest,C,'v80-supplement-nonce-0002');
 const now=f.reviews.report(f.scope());blocked(now);
 assert.equal(now.fixture_independent_supplement_review_current,false);
 assert.equal(now.reason_code,'INDEPENDENT_CURRENT_SUPPLEMENT_REVIEW_REQUIRED');
 assert.throws(()=>f.reviews.review(f.reviewReq(one,'v80-review-nonce-0002')),
  {code:'SUPPLEMENT_REVIEW_VERSION_STALE'});
 const accepted=f.reviews.review(f.reviewReq(two,'v80-review-nonce-0002'));
 assert.equal(accepted.supplement_version,2);
 assert.equal(f.reviews.audit(f.scope()).length,2);
 assert.throws(()=>f.reviews.review(f.reviewReq(one,'v80-review-nonce-0001')),
  {code:'SUPPLEMENT_REVIEW_VERSION_STALE'});
 blocked(f.reviews.report(f.scope()));
});
test('V3.2-80 wrong reviewer, forged approval, wrong scope and revoked identity fail closed',()=>{
 const f=fixture(),one=f.append(1,A,B,'v80-supplement-nonce-0001');
 assert.throws(()=>f.reviews.review(f.reviewReq(one,'v80-review-nonce-0001',
  {reviewer_id:'finance_owner'})),{code:'SELF_REVIEW_FORBIDDEN'});
 assert.throws(()=>f.reviews.review(f.reviewReq(one,'v80-review-nonce-0001',
  {handoff_allowed:true})),{code:'INVALID_SUPPLEMENT_REVIEW_INPUT'});
 assert.throws(()=>f.reviews.review(f.reviewReq(one,'v80-review-nonce-0001',
  {organization_id:alt})),{code:'CURRENT_SUPPLEMENT_NOT_VERIFIED'});
 f.reviews.review(f.reviewReq(one,'v80-review-nonce-0001'));
 f.setCheckerActive(false);
 const blockedState=f.reviews.report(f.scope());blocked(blockedState);
 assert.equal(blockedState.reason_code,'REVIEWER_REVOKED_OR_UNAVAILABLE');
});
test('V3.2-80 source revision changes invalidate reviews without rewriting history',()=>{
 const f=fixture(),one=f.append(1,A,B,'v80-supplement-nonce-0001');
 f.reviews.review(f.reviewReq(one,'v80-review-nonce-0001'));
 f.setRevision(2);
 const stale=f.reviews.report(f.scope());blocked(stale);
 assert.equal(stale.fixture_independent_supplement_review_current,false);
 assert.equal(f.reviews.audit(f.scope()).length,1);
 assert.throws(()=>f.reviews.review(f.reviewReq(one,'v80-review-nonce-0002')),
  {code:'CURRENT_SUPPLEMENT_NOT_VERIFIED'});
});
test('V3.2-80 duplicate review keys cannot alter bytes or approve twice',()=>{
 const f=fixture(),one=f.append(1,A,B,'v80-supplement-nonce-0001');
 f.reviews.review(f.reviewReq(one,'v80-review-nonce-0001'));
 assert.throws(()=>f.reviews.review(f.reviewReq(one,'v80-review-nonce-0001',
  {reviewer_id:'finance_owner'})),{code:'SELF_REVIEW_FORBIDDEN'});
 assert.throws(()=>f.reviews.review(f.reviewReq(one,'v80-review-nonce-0002')),
  {code:'SUPPLEMENT_VERSION_ALREADY_REVIEWED'});
 blocked(f.reviews.report(f.scope()));
});
