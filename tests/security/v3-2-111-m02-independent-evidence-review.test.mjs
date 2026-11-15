import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {createIsolatedIndependentEvidenceReview} from '../../src/cross-module-independent-evidence-review.mjs';
const org='11111111-1111-4111-8111-111111111111';
const incident='88888888-8888-4888-8888-888888888888';
const student='99999999-9999-4999-8999-999999999999';
const family='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherOrg='22222222-2222-4222-8222-222222222222';
const types={
 sales:'student_attribution_and_historical_order_context',
 finance:'independent_original_order_and_payment_reconciliation',
 academic:'independent_lesson_entitlement_and_fulfilment_reconciliation'};
const fields=['schema_version','organization_id','incident_id','student_id','family_id',
 'domain','evidence_type','signer_id','source_revision','revocation_sequence',
 'notification_sequence','notification_digest','original_history_digest',
 'evidence_digest','issued_at_ms','expires_at_ms','fixture_only'];
const domains=Object.keys(types);
const scope={organization_id:org,incident_id:incident,student_id:student};
const pem=pair=>pair.publicKey.export({format:'pem',type:'spki'});
const signEvidence=(e,key)=>({...e,signature:sign(null,
 Buffer.from(JSON.stringify(Object.fromEntries(fields.map(k=>[k,e[k]])))),
 key.privateKey).toString('base64url')});
function setup(){
 const keys=Object.fromEntries(domains.map(d=>[d,generateKeyPairSync('ed25519')]));
 const pins=Object.fromEntries(domains.map(d=>[d,pem(keys[d])]));
 const digest='a'.repeat(64);
 let time=1000000,receiptAvailable=true,receiptMode='blocked',
  receiptOrg=org,receiptDigest=digest,persistenceMode='revoked',
  persSequence=1,persDigest=digest,sourceUnavailable=null,history='b'.repeat(64);
 let studentOverride=student,familyValue=null,forgedDomain=null;
 const person=Object.fromEntries(domains.map(d=>[d,{
  signer_id:d+'-independent-actor-001',source_revision:1,
  revocation_sequence:0,revoked:false,observed_at_ms:1000000
 }]));
 const evidence=domain=>{
  const p=person[domain];
  return {
   schema_version:'v3.2-111-ci-independent-evidence-v1',
   organization_id:org,incident_id:incident,
   student_id:studentOverride,family_id:familyValue,domain,
   evidence_type:types[domain],signer_id:p.signer_id,
   source_revision:p.source_revision,revocation_sequence:p.revocation_sequence,
   notification_sequence:1,notification_digest:digest,
   original_history_digest:history,
   evidence_digest:(domain==='sales'?'c':domain==='finance'?'d':'e').repeat(64),
   issued_at_ms:time-100,expires_at_ms:time+10000,fixture_only:true
  };
 };
 const gate={inspect:async()=>receiptAvailable?{
  reason_code:receiptMode==='blocked'?
   'BLOCKED_CI_LEASE_LOSS_AND_NEGATIVE_RECEIPT':'LEASE_NEGATIVE_RECEIPT_COMMIT_UNCERTAIN',
  fixture_negative_receipt_current:receiptMode==='blocked',
  notification_digest:receiptDigest,notification_sequence:1,
  external_authority_verified:false,finance_authorized:false,
  academic_authorized:false,handoff_allowed:false,
  compensation_write_allowed:false,release_eligible:false,hold_active:true,
  organization_id:receiptOrg}:{
  reason_code:'LEASE_PRECONDITION_NOT_CURRENT',hold_active:true,
  handoff_allowed:false}};
 const fetchSignedEvidence=async({domain})=>{
  if(sourceUnavailable===domain)throw Error('source offline');
  const payload=evidence(domain);
  return signEvidence(payload,
   forgedDomain===domain?generateKeyPairSync('ed25519'):keys[domain]);
 };
 const readFixtureRevocationStatus=async({scope:s,domain,signer_id})=>({
  schema_version:'v3.2-111-ci-revocation-status-v1',
  organization_id:s.organization_id,incident_id:s.incident_id,
  domain,signer_id,...person[domain]
 });
 // Avoid duplicate signer_id when spreading object: function's output is
 // correct shape because earlier signer_id is overwritten, not duplicated.
 const readReceiptPersistence=async()=>({
  notification_sequence:persSequence,notification_digest:persDigest,
  lease_state:persistenceMode
 });
 const create=(extra={})=>createIsolatedIndependentEvidenceReview({
  negativeReceiptGate:gate,fetchSignedEvidence,fixtureDomainPublicKeys:pins,
  readFixtureRevocationStatus,readReceiptPersistence,getFixtureNow:()=>time,...extra
 });
 return {create,scope,keys,pins,person,evidence,gate,fetchSignedEvidence,
  readFixtureRevocationStatus,readReceiptPersistence,
  setReceiptMode:v=>receiptMode=v,setReceiptAvailable:v=>receiptAvailable=v,
  setReceiptDigest:v=>receiptDigest=v,setPersistence:v=>persistenceMode=v,
  setPersistDigest:v=>persDigest=v,setPersistSequence:v=>persSequence=v,
  setOffline:v=>sourceUnavailable=v,setHistory:v=>history=v,
  setFamily:v=>familyValue=v,setStudent:v=>studentOverride=v,
  setForgedDomain:v=>forgedDomain=v,setTime:v=>time=v,
  mutatePerson:(d,patch)=>Object.assign(person[d],patch)
 };
}
function safe(r){
 assert.equal(Object.isFrozen(r),true);
 assert.equal(r.hold_active,true);
 for(const k of ['external_authority_verified','finance_authorized',
  'academic_authorized','handoff_allowed','compensation_write_allowed',
  'release_eligible','production_integration_allowed',
  'merge_authorized','deploy_authorized'])
  assert.equal(r[k],false,k);
}
test('REV-01 three independent fixture signers plus current V110 negative receipt remain blocked',async()=>{
 const f=setup(),r=await f.create().inspect(scope);safe(r);
 assert.equal(r.reason_code,'BLOCKED_FIXTURE_INDEPENDENT_EVIDENCE_NOT_REAL_AUTHORITY');
 assert.equal(r.fixture_independent_evidence_crosschecked,true);
 assert.equal(r.evidence_count,3);
 assert.equal(r.student_id,student);
 assert.equal(r.negative_receipt_digest,'a'.repeat(64));
});
test('REV-02 shared or swapped signing roots fail independent signatory rule',async()=>{
 const f=setup();
 assert.throws(()=>f.create({fixtureDomainPublicKeys:{...f.pins,
  finance:f.pins.sales}}),/must not share/);
 const x=f.create({fixtureDomainPublicKeys:{...f.pins,
  finance:f.pins.academic,academic:f.pins.finance}});
 const r=await x.inspect(scope);safe(r);
 assert.equal(r.reason_code,'EVIDENCE_SIGNATURE_OR_ENVELOPE_INVALID');
});
test('REV-03 forged finance signature, missing academic evidence, and signer reuse fail',async()=>{
 const f=setup();f.setForgedDomain('finance');
 let r=await f.create().inspect(scope);safe(r);
 assert.equal(r.reason_code,'EVIDENCE_SIGNATURE_OR_ENVELOPE_INVALID');
 const g=setup();g.setOffline('academic');
 r=await g.create().inspect(scope);safe(r);
 assert.equal(r.reason_code,'EVIDENCE_REVIEW_DEPENDENCY_UNAVAILABLE');
 const h=setup();h.mutatePerson('finance',{signer_id:h.person.sales.signer_id});
 r=await h.create().inspect(scope);safe(r);
 assert.equal(r.reason_code,'EVIDENCE_SIGNER_SEPARATION_FAILED');
});
test('REV-04 absent, uncertain or falsely positive V110 receipt never meets entry gate',async()=>{
 for(const mode of ['uncertain','not-current']){
  const f=setup();
  if(mode==='uncertain')f.setReceiptMode('uncertain');
  else f.setReceiptAvailable(false);
  const r=await f.create().inspect(scope);safe(r);
  assert.equal(r.reason_code,'V110_NEGATIVE_RECEIPT_MISSING_OR_UNCERTAIN');
 }
 const f=setup();
 const falseGate={inspect:async()=>({
  reason_code:'BUSINESS_HANDOFF_COMMITTED',handoff_allowed:true,hold_active:false,
  fixture_negative_receipt_current:true,
  notification_digest:'a'.repeat(64),notification_sequence:1})};
 const r=await f.create({negativeReceiptGate:falseGate}).inspect(scope);safe(r);
 assert.equal(r.reason_code,'V110_NEGATIVE_RECEIPT_MISSING_OR_UNCERTAIN');
});
test('REV-05 notice digest, sequence and SQL lease revoke must match V110 receipt',async()=>{
 for(const change of [
  x=>x.setPersistence('active'),
  x=>x.setPersistSequence(2),
  x=>x.setPersistDigest('e'.repeat(64))
 ]){
  const f=setup();change(f);
  const r=await f.create().inspect(scope);safe(r);
  assert.equal(r.reason_code,'V110_NEGATIVE_RECEIPT_PERSISTENCE_UNVERIFIED');
 }
});
test('REV-06 stale or revoked finance/academic staff evidence rejected',async()=>{
 for(const change of [
  f=>f.mutatePerson('finance',{revoked:true}),
  f=>f.mutatePerson('academic',{revocation_sequence:1}),
  f=>f.mutatePerson('finance',{source_revision:2})
 ]){
  const f=setup(),snapshot=Object.fromEntries(
   domains.map(d=>[d,f.evidence(d)]));
  // Simulate a signer's prior signed record becoming stale relative to
  // the independent revocation read; only the read version changes.
  change(f);
  const r=await f.create({
   fetchSignedEvidence:async({domain})=>signEvidence(snapshot[domain],f.keys[domain])
  }).inspect(scope);
  safe(r);
  assert.equal(r.reason_code,'EVIDENCE_REVOKED_STALE_OR_UNVERIFIED');
 }
});
test('REV-07 delayed role revocation between two independent checks is caught',async()=>{
 const f=setup(),r=await f.create({
  afterFirstScan:async()=>f.mutatePerson('finance',{revoked:true})
 }).inspect(scope);safe(r);
 assert.equal(r.reason_code,'EVIDENCE_REVOKED_STALE_OR_UNVERIFIED');
});
test('REV-08 notice database state changed after first revocation check is caught',async()=>{
 const f=setup(),r=await f.create({
  afterFirstScan:async()=>f.setPersistence('active')
 }).inspect(scope);safe(r);
 assert.equal(r.reason_code,'V110_NEGATIVE_RECEIPT_PERSISTENCE_UNVERIFIED');
});
test('REV-09 student association and optional sibling family must be consistent',async()=>{
 const f=setup();f.setFamily(family);
 let r=await f.create().inspect(scope);safe(r);
 assert.equal(r.fixture_independent_evidence_crosschecked,true);
 const g=setup();g.setStudent('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
 r=await g.create().inspect(scope);safe(r);
 assert.equal(r.reason_code,'EVIDENCE_SCOPE_HISTORY_OR_EXPIRY_INVALID');
 const h=setup();h.setFamily('not-a-uuid');
 r=await h.create().inspect(scope);safe(r);
 assert.equal(r.reason_code,'EVIDENCE_SCOPE_HISTORY_OR_EXPIRY_INVALID');
});
test('REV-10 immutable history digest mismatch cannot pass three-party review',async()=>{
 const f=setup();
 const r=await f.create({
  fetchSignedEvidence:async({domain})=>{
   const p=f.evidence(domain);
   if(domain==='finance')p.original_history_digest='f'.repeat(64);
   return signEvidence(p,f.keys[domain]);
  }
 }).inspect(scope);safe(r);
 assert.equal(r.reason_code,'EVIDENCE_HISTORY_OR_STUDENT_RELATION_CONFLICT');
});
test('REV-11 cross-tenant or fake approval fields rejected before fixture reads',async()=>{
 const f=setup();
 for(const input of [
  {...scope,finance_authorized:true},
  {...scope,incident_id:'bad'},
  {...scope,organization_id:otherOrg,student_id:'bad'},
  {organization_id:org,incident_id:incident}
 ]){
  const r=await f.create().inspect(input);safe(r);
  assert.equal(r.reason_code,'INVALID_THREE_PARTY_REVIEW_SCOPE');
 }
});
test('REV-12 unsigned, expired or tampered source document cannot obtain even fixture-current review',async()=>{
 const f=setup();f.setTime(1000020);
 const r=await f.create({
  fetchSignedEvidence:async({domain})=>{
   const p=f.evidence(domain);
   if(domain==='finance')p.evidence_digest='f'.repeat(64);
   const v=signEvidence(p,f.keys[domain]);
   if(domain==='finance')v.evidence_digest='e'.repeat(64);
   return v;
  }
 }).inspect(scope);safe(r);
 assert.equal(r.reason_code,'EVIDENCE_SIGNATURE_OR_ENVELOPE_INVALID');
 const g=setup();
 const original=Object.fromEntries(domains.map(d=>[d,g.evidence(d)]));
 g.setTime(1100000);
 const expired=await g.create({
  fetchSignedEvidence:async({domain})=>signEvidence(original[domain],g.keys[domain])
 }).inspect(scope);safe(expired);
 assert.equal(expired.reason_code,'EVIDENCE_SCOPE_HISTORY_OR_EXPIRY_INVALID');
});
test('REV-13 even complete fixtures cannot claim real authority, merge, deploy or atomic handoff',async()=>{
 const f=setup(),r=await f.create().inspect(scope);safe(r);
 assert.equal(r.fixture_independent_evidence_crosschecked,true);
 assert.equal(r.handoff_allowed,false);
 assert.equal(r.production_integration_allowed,false);
 assert.throws(()=>createIsolatedIndependentEvidenceReview({}),TypeError);
});
