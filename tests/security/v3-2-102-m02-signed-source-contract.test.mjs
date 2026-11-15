import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {createIsolatedSignedSourceContract} from '../../src/cross-module-signed-source-contract.mjs';
import {createIsolatedReadOnlyVerificationFacade} from '../../src/cross-module-readonly-verification-facade.mjs';

const org='11111111-1111-4111-8111-111111111111';
const incident='33333333-3333-4333-8333-333333333333';
const domains=['sales','finance','academic'];
const scope={organization_id:org,incident_id:incident};
function fixture(){
 let t=1000000,expired=false,sourceEpoch=1,generation=1,
  revSeq=0,revDigest='d'.repeat(64),maxDelay=0,wrongScope=false,
  equivocation=false,brokenSignature=false,failDomain=null,
  mutateBetween=false,requestCount=0;
 const keys={};
 const publicKeys={};
 const revision={sales:1,finance:1,academic:1};
 for(const d of domains){
  const kp=generateKeyPairSync('ed25519');
  keys[d]=kp.privateKey;
  publicKeys[d]=kp.publicKey.export({type:'spki',format:'pem'});
 }
 const make=(d)=>{
  const payload={
   schema_version:'v3.2-102-ci-source-proof-v1',domain:d,
   organization_id:wrongScope&&d==='finance'?
    '22222222-2222-4222-8222-222222222222':org,
   incident_id:incident,source_epoch:sourceEpoch,
   source_revision:revision[d],
   revocation_sequence:revSeq,revocation_digest:revDigest,
   incident_generation:generation,
   evidence_digest:(equivocation&&d==='finance'?'f':'a').repeat(64),
   issued_at_ms:expired?t-400000:t-1000,
   expires_at_ms:expired?t-1000:t+60000,
   fixture_only:true
  };
  const signature=sign(null,Buffer.from(JSON.stringify(payload)),keys[d])
   .toString('base64url');
  return {...payload,signature:brokenSignature&&d==='finance'?
   'a'.repeat(86):signature};
 };
 const readers=Object.fromEntries(domains.map(d=>[d,async()=>{
  requestCount++;
  if(failDomain===d)throw Error('synthetic external outage');
  if(mutateBetween&&requestCount===4)revision.sales++;
  if(maxDelay&&d==='academic')
   await new Promise(resolve=>setTimeout(resolve,maxDelay));
  return make(d);
 }]));
 const create=(overrides={})=>createIsolatedSignedSourceContract({
  readers,fixturePublicKeys:publicKeys,getFixtureNow:()=>t,
  timeoutMs:100,...overrides});
 const boundary=create();
 return {boundary,make,readers,publicKeys,create,
  advance:n=>t+=n,setTime:n=>t=n,
  setExpired:n=>expired=n,setEpoch:n=>sourceEpoch=n,
  setGeneration:n=>generation=n,setRevocation:(n,d='e'.repeat(64))=>{
   revSeq=n;revDigest=d;},
  setDelay:n=>maxDelay=n,setWrongScope:n=>wrongScope=n,
  setEquivocation:n=>equivocation=n,setBadSignature:n=>brokenSignature=n,
  setFailDomain:n=>failDomain=n,setMutateBetween:n=>mutateBetween=n,
  setRevision:(d,n)=>revision[d]=n};
}
function safe(r){
 assert.equal(r.hold_active,true);
 for(const f of ['external_authority_verified','finance_authorized',
  'academic_authorized','handoff_allowed','compensation_write_allowed',
  'release_eligible','production_integration_allowed'])assert.equal(r[f],false,f);
 assert.ok(Object.isFrozen(r));
}
test('V3.2-102 pinned fixture Ed25519 proofs combine to read-only V101 watermark',async()=>{
 const x=fixture(),r=await x.boundary.inspect(scope);safe(r);
 assert.equal(r.fixture_signed_sources_consistent,true);
 const w=await x.boundary.getFixtureWatermark(org,incident);
 assert.equal(w.organization_id,org);
 assert.equal(w.incident_id,incident);
 assert.equal(w.revocation_sequence,0);
 assert.match(w.evidence_digest,/^[0-9a-f]{64}$/);
 assert.ok(Object.isFrozen(w));
});
test('V3.2-102 missing source, timed out source or wrong domain key fail closed',async()=>{
 const x=fixture();x.setFailDomain('academic');
 let r=await x.boundary.inspect(scope);safe(r);
 assert.equal(r.reason_code,'FIXTURE_SOURCE_UNAVAILABLE');
 x.setFailDomain(null);x.setDelay(150);
 r=await x.boundary.inspect(scope);safe(r);
 assert.equal(r.reason_code,'FIXTURE_SOURCE_TIMEOUT');
 x.setDelay(0);x.setBadSignature(true);
 r=await x.boundary.inspect(scope);safe(r);
 assert.equal(r.reason_code,'FIXTURE_SOURCE_SIGNATURE_INVALID');
});
test('V3.2-102 expired, out-of-tenant, malformed and invalid root contract deny',async()=>{
 const x=fixture();x.setExpired(true);
 let r=await x.boundary.inspect(scope);safe(r);
 assert.equal(r.reason_code,'FIXTURE_SOURCE_ENVELOPE_INVALID_OR_EXPIRED');
 x.setExpired(false);x.setWrongScope(true);
 r=await x.boundary.inspect(scope);safe(r);
 assert.equal(r.reason_code,'FIXTURE_SOURCE_ENVELOPE_INVALID_OR_EXPIRED');
 r=await x.boundary.inspect({organization_id:'bad',incident_id:incident});safe(r);
 assert.equal(r.reason_code,'INVALID_SOURCE_SCOPE');
 assert.throws(()=>x.create({fixturePublicKeys:{sales:x.publicKeys.sales}}),
  {name:'TypeError'});
});
test('V3.2-102 version, generation and revocation rollback reject replay',async()=>{
 for(const change of [
  x=>{x.setRevision('finance',3);},
  x=>{x.setGeneration(3);},
  x=>{x.setRevocation(3);}
 ]){
  const x=fixture();
  await x.boundary.getFixtureWatermark(org,incident);
  change(x);
  await x.boundary.getFixtureWatermark(org,incident);
  if(change.toString().includes("Revision"))
   x.setRevision('finance',1);
  else if(change.toString().includes("Generation"))
   x.setGeneration(1);
  else x.setRevocation(0,'d'.repeat(64));
  const r=await x.boundary.inspect(scope);safe(r);
  assert.equal(r.reason_code,'FIXTURE_SOURCE_VERSION_ROLLBACK');
 }
});
test('V3.2-102 signed same-version equivocation and revocation-digest equivocation reject',async()=>{
 const x=fixture();
 await x.boundary.getFixtureWatermark(org,incident);
 x.setEquivocation(true);
 let r=await x.boundary.inspect(scope);safe(r);
 assert.equal(r.reason_code,'FIXTURE_SOURCE_SAME_VERSION_EQUIVOCATION');
 const y=fixture();
 await y.boundary.getFixtureWatermark(org,incident);
 y.setRevocation(0,'e'.repeat(64));
 r=await y.boundary.inspect(scope);safe(r);
 assert.equal(r.reason_code,'FIXTURE_REVOCATION_DIGEST_EQUIVOCATION');
});
test('V3.2-102 second source read detects in-flight data change and clock rollback',async()=>{
 const x=fixture();x.setMutateBetween(true);
 let r=await x.boundary.inspect(scope);safe(r);
 assert.equal(r.reason_code,'FIXTURE_SOURCE_CHANGED_BETWEEN_READS');
 const y=fixture();await y.boundary.getFixtureWatermark(org,incident);
 y.setTime(999999);
 r=await y.boundary.inspect(scope);safe(r);
 assert.equal(r.reason_code,'FIXTURE_SOURCE_CLOCK_ROLLBACK');
});
test('V3.2-102 signed read boundary can feed V101 facade without granting authority',async()=>{
 const x=fixture(),reference={...scope,
  final_reference:{source_digest:'1'.repeat(64),revocation_reference:{}},
  diff_reference:{...scope,previous_audit_sequence:1,
   previous_audit_digest:'2'.repeat(64),new_audit_sequence:2,
   new_audit_digest:'3'.repeat(64)}};
 const safeResponse={
  hold_active:true,external_authority_verified:false,finance_authorized:false,
  academic_authorized:false,handoff_allowed:false,
  compensation_write_allowed:false,release_eligible:false};
 const facade=createIsolatedReadOnlyVerificationFacade({
  unifiedRecoveryGate:{report:async()=>({...safeResponse,
   reason_code:'BLOCKED_EXTERNAL_HANDOFF_WITH_CURRENT_FIXTURE_RECOVERY',
   fixture_combined_consistency:true,fixture_recovery_current:true,
   comparison_digest:'4'.repeat(64),remaining_count:0,
   recovery_expires_at_ms:1100000,pending_tasks:[],
   external_requirements:[
    'finance_independent_signature','academic_independent_signature',
    'order_payment_reconciliation','lesson_entitlement_reconciliation',
    'three_party_acceptance','atomic_handoff_receipt'
   ].map(code=>({code,status:'requires_external_authority'}))})},
  finalReview:{verify:async()=>({...safeResponse,
   reason_code:'BLOCKED_CURRENT_FIXTURE_FINAL_REVIEW_NO_AUTHORITY',
   fixture_final_review_current:true,snapshot_digest:'5'.repeat(64)})},
  attestation:{report:async()=>({...safeResponse,
   reason_code:'BLOCKED_CI_ATTESTATION_COMPLETE_NO_EXTERNAL_AUTHORITY',
   fixture_acknowledgement_current:true,current_snapshot_digest:'5'.repeat(64),
   acknowledgement_digest:'6'.repeat(64),completed_steps:5,required_steps:5})},
  attestationLifecycle:{inspect:async()=>({...safeResponse,
   reason_code:'BLOCKED_CURRENT_ADMINISTRATIVE_ACKNOWLEDGEMENT',
   fixture_acknowledgement_current:true,
   acknowledgement_digest:'6'.repeat(64),history_count:5})},
  getFixtureWatermark:x.boundary.getFixtureWatermark});
 const input={reference,snapshot_digest:'5'.repeat(64),
  acknowledgement_digest:'6'.repeat(64),afterFirstRead:async()=>{}};
 let r=await facade.verify(input);safe(r);
 assert.equal(r.fixture_internal_review_current,true);
 assert.equal(r.external_gap_count,6);
 x.setBadSignature(true);
 r=await facade.verify(input);safe(r);
 assert.equal(r.reason_code,'READ_ONLY_VERIFICATION_DEPENDENCY_UNAVAILABLE');
});
