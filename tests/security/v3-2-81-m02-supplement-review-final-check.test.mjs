import test from 'node:test';
import assert from 'node:assert/strict';
import {createIsolatedManualAcceptancePreparation} from '../../src/cross-module-manual-acceptance-preparation.mjs';
import {createIsolatedSupplementVersionChain} from '../../src/cross-module-supplement-version-chain.mjs';
import {createIsolatedSupplementReview} from '../../src/cross-module-supplement-independent-review.mjs';
import {createIsolatedSupplementReviewFinalCheck} from '../../src/cross-module-supplement-review-final-check.mjs';
const org='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const incident='33333333-3333-4333-8333-333333333333';
const requirement_code='finance_signature',A='a'.repeat(64),B='b'.repeat(64),C='c'.repeat(64);
function fixture(){
 let revision=1,checkerActive=true;
 const actor=(_,id)=>id==='finance_owner'?{actor_id:id,role:'finance',
  organization_id:org,active:true,fixture_only:true}:
  id==='sales_checker'?{actor_id:id,role:'sales',organization_id:org,
   active:checkerActive,fixture_only:true}:null;
 const preparation=createIsolatedManualAcceptancePreparation({
  getFixtureActor:actor,getFixtureEvidenceRevision:()=>revision});
 const submit=(key)=>preparation.record({organization_id:org,incident_id:incident,
  requirement_code,stage:'submitted',actor_id:'finance_owner',source_revision:revision,
  evidence_sha256:A,idempotency_key:key});
 submit('v81-original-submission-00001');
 const supplements=createIsolatedSupplementVersionChain({
  preparation,getFixtureRevision:()=>revision});
 const append=(supplement_version,parent_digest,evidence_sha256,idempotency_key)=>supplements.append({
  organization_id:org,incident_id:incident,requirement_code,source_revision:revision,
  supplement_version,parent_digest,evidence_sha256,submitted_by:'finance_owner',idempotency_key});
 const reviews=createIsolatedSupplementReview({supplements,preparation,getFixtureActor:actor});
 const review=x=>reviews.review({organization_id:org,incident_id:incident,requirement_code,
  source_revision:x.source_revision,supplement_version:x.supplement_version,
  chain_digest:x.chain_digest,reviewer_id:'sales_checker',
  idempotency_key:'v81-review-'+x.supplement_version+'-00001'});
 const gate=createIsolatedSupplementReviewFinalCheck({supplements,reviews});
 const check=(afterFirstRead=async()=>{},changes={})=>gate.check({organization_id:org,
  incident_id:incident,requirement_code,afterFirstRead,...changes});
 return {append,review,gate,check,setCheckerActive:v=>checkerActive=v,
  setRevision:v=>revision=v,submit};
}
function safe(result,reason){
 assert.equal(result.reason_code,reason);assert.equal(result.hold_active,true);
 assert.equal(Object.isFrozen(result),true);
 for(const field of ['external_signatures_verified','external_authority_verified',
  'finance_authorized','academic_authorized','handoff_allowed',
  'compensation_write_allowed','release_eligible','production_integration_allowed'])
 assert.equal(result[field],false,field);
}
test('V3.2-81 stable latest independent review cannot authorize real handoff',async()=>{
 const f=fixture(),one=f.append(1,A,B,'v81-supplement-1-00001');f.review(one);
 const r=await f.check();safe(r,'BLOCKED_NONATOMIC_EXTERNAL_AUTHORITY_NOT_CONNECTED');
 assert.equal(r.fixture_supplement_review_consistent,true);
});
test('V3.2-81 supplement appended after initial review invalidates old approval',async()=>{
 const f=fixture(),one=f.append(1,A,B,'v81-supplement-1-00001');f.review(one);
 const r=await f.check(async()=>{f.append(2,one.chain_digest,C,'v81-supplement-2-00001');});
 safe(r,'INDEPENDENT_REVIEW_STALE_OR_UNAVAILABLE');
 assert.equal(r.fixture_supplement_review_consistent,false);
});
test('V3.2-81 actor revocation or source revision change blocks',async()=>{
 const f=fixture(),one=f.append(1,A,B,'v81-supplement-1-00001');f.review(one);
 safe(await f.check(async()=>{f.setCheckerActive(false);}),
  'INDEPENDENT_REVIEW_STALE_OR_UNAVAILABLE');
 f.setCheckerActive(true);
 safe(await f.check(async()=>{f.setRevision(2);}),
  'SUPPLEMENT_CHAIN_STALE_OR_UNAVAILABLE');
});
test('V3.2-81 forged scope, dependency faults and missing review block',async()=>{
 const f=fixture(),one=f.append(1,A,B,'v81-supplement-1-00001');
 safe(await f.check(),'INDEPENDENT_REVIEW_STALE_OR_UNAVAILABLE');
 f.review(one);
 safe(await f.check(async()=>{}, {finance_authorized:true}),
  'INVALID_FINAL_SUPPLEMENT_CHECK_INPUT');
 safe(await f.check(async()=>{}, {organization_id:other}),
  'SUPPLEMENT_CHAIN_STALE_OR_UNAVAILABLE');
 safe(await f.check(async()=>{throw Error('offline');}),
  'FINAL_SUPPLEMENT_DEPENDENCY_UNAVAILABLE');
});
