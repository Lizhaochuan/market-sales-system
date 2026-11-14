import test from 'node:test';
import assert from 'node:assert/strict';
import {createIsolatedManualAcceptancePreparation} from '../../src/cross-module-manual-acceptance-preparation.mjs';
import {createIsolatedSupplementVersionChain} from '../../src/cross-module-supplement-version-chain.mjs';
const org='11111111-1111-4111-8111-111111111111';
const alt='22222222-2222-4222-8222-222222222222';
const incident='33333333-3333-4333-8333-333333333333';
const code='finance_signature';
const A='a'.repeat(64), B='b'.repeat(64), C='c'.repeat(64);
function setup(){
 let revision=1;
 const prep=createIsolatedManualAcceptancePreparation({
  getFixtureEvidenceRevision:()=>revision,
  getFixtureActor:(_,id)=>id==='finance_owner'?{
   actor_id:id,role:'finance',organization_id:org,active:true,fixture_only:true
  }:id==='sales_checker'?{
   actor_id:id,role:'sales',organization_id:org,active:true,fixture_only:true
  }:null
 });
 const submit=(stage,actor_id,key,evidence_sha256=A)=>prep.record({
  organization_id:org,incident_id:incident,requirement_code:code,stage,actor_id,
  source_revision:revision,evidence_sha256,idempotency_key:key
 });
 submit('submitted','finance_owner','prepare-fixture-submitted-0001');
 const chain=createIsolatedSupplementVersionChain({
  preparation:prep,getFixtureRevision:()=>revision
 });
 const request=(supplement_version,parent_digest,evidence_sha256,key,extra={})=>({
  organization_id:org,incident_id:incident,requirement_code:code,
  source_revision:revision,supplement_version,parent_digest,evidence_sha256,
  submitted_by:'finance_owner',idempotency_key:key,...extra});
 const scope=()=>({organization_id:org,incident_id:incident,requirement_code:code});
 return {chain,prep,submit,request,scope,setRevision:v=>{revision=v;}};
}
function blocked(r){
 assert.equal(r.hold_active,true);assert.equal(Object.isFrozen(r),true);
 for(const k of ['external_evidence_authenticated','external_finance_signature_verified',
  'external_academic_signature_verified','three_party_acceptance_verified',
  'finance_authorized','academic_authorized','handoff_allowed',
  'compensation_write_allowed','release_eligible'])assert.equal(r[k],false,k);
}
test('V3.2-79 immutable supplements link to the original submission and prior digest',()=>{
 const f=setup();
 const first=f.chain.append(f.request(1,A,B,'supplement-fixture-nonce-0001'));
 assert.equal(first.original_submission_sha256,A);
 assert.equal(Object.isFrozen(first),true);
 assert.strictEqual(f.chain.append(f.request(1,A,B,'supplement-fixture-nonce-0001')),first);
 const second=f.chain.append(f.request(2,first.chain_digest,C,'supplement-fixture-nonce-0002'));
 assert.equal(second.parent_digest,first.chain_digest);
 const result=f.chain.report(f.scope());blocked(result);
 assert.equal(result.fixture_chain_valid,true);
 assert.equal(result.fixture_supplements_current,true);
 assert.equal(result.independent_supplement_review_verified,false);
 assert.equal(f.chain.audit(f.scope()).length,2);
});
test('V3.2-79 rejects skipped version, changed nonce, wrong parent and forged permission',()=>{
 const f=setup();
 assert.throws(()=>f.chain.append(f.request(2,A,B,'supplement-fixture-nonce-0002')),
  {code:'SUPPLEMENT_VERSION_GAP_OR_REPLAY'});
 assert.throws(()=>f.chain.append(f.request(1,C,B,'supplement-fixture-nonce-0001')),
  {code:'SUPPLEMENT_PARENT_DIGEST_MISMATCH'});
 assert.throws(()=>f.chain.append(f.request(1,A,A,'supplement-fixture-nonce-0001')),
  {code:'SUPPLEMENT_EVIDENCE_UNCHANGED'});
 const one=f.chain.append(f.request(1,A,B,'supplement-fixture-nonce-0001'));
 assert.throws(()=>f.chain.append(f.request(1,A,C,'supplement-fixture-nonce-0001')),
  {code:'SUPPLEMENT_IDEMPOTENCY_CONFLICT'});
 assert.throws(()=>f.chain.append(f.request(2,one.chain_digest,C,'supplement-fixture-nonce-0002',
  {handoff_allowed:true})),{code:'INVALID_SUPPLEMENT_REQUEST'});
 assert.throws(()=>f.chain.append(f.request(2,one.chain_digest,C,'supplement-fixture-nonce-0002',
  {organization_id:alt})),{code:'ORIGINAL_SUBMISSION_NOT_FOUND'});
 assert.throws(()=>f.chain.append(f.request(2,one.chain_digest,C,'supplement-fixture-nonce-0002',
  {submitted_by:'sales_checker'})),{code:'SUPPLEMENT_OWNER_NOT_ORIGINAL_SUBMITTER'});
});
test('V3.2-79 revised source invalidates all old supplement decisions while preserving history',()=>{
 const f=setup();
 const first=f.chain.append(f.request(1,A,B,'supplement-fixture-nonce-0001'));
 f.setRevision(2);
 blocked(f.chain.report(f.scope()));
 assert.equal(f.chain.report(f.scope()).fixture_chain_valid,false);
 assert.equal(f.chain.audit(f.scope()).length,1);
 assert.throws(()=>f.chain.append(f.request(2,first.chain_digest,C,'supplement-fixture-nonce-0002',
  {source_revision:1})),{code:'SOURCE_REVISION_STALE'});
 f.submit('submitted','finance_owner','prepare-fixture-submitted-0002');
 const second=f.chain.append(f.request(1,A,C,'supplement-fixture-nonce-0002'));
 assert.equal(second.supplement_version,1);
 assert.equal(f.chain.report(f.scope()).fixture_chain_valid,true);
 assert.equal(f.chain.audit(f.scope()).length,2);
 assert.throws(()=>f.chain.append(f.request(1,A,B,'supplement-fixture-nonce-0001',
  {source_revision:1})),{code:'SOURCE_REVISION_STALE'});
});
test('V3.2-79 old idempotent retry is disallowed after a superseding version',()=>{
 const f=setup();
 f.chain.append(f.request(1,A,B,'supplement-fixture-nonce-0001'));
 const first=f.chain.audit(f.scope())[0];
 f.chain.append(f.request(2,first.chain_digest,C,'supplement-fixture-nonce-0002'));
 assert.throws(()=>f.chain.append(f.request(1,A,B,'supplement-fixture-nonce-0001')),
  {code:'SUPERSEDED_SUPPLEMENT_REPLAY'});
 assert.equal(f.chain.audit(f.scope()).length,2);
});
