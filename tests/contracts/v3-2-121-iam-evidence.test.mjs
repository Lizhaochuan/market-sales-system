import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {
 REQUIRED_IAM_ROLES,REQUIRED_DENIAL_CASES,
 signFixtureExt001Envelope,verifyFixtureExt001Envelope
} from '../../src/cross-module-v121-iam-evidence.mjs';
import {validateFixtureV121Handover}
 from '../../src/cross-module-v121-production-handover.mjs';

const org='11111111-1111-4111-8111-111111111111';
const issuerId='00000000-0000-4000-8000-0000000000c1';
const issuerKey='00000000-0000-4000-8000-0000000000c2';
const reviewerId='00000000-0000-4000-8000-0000000000c3';
const reviewerKey='00000000-0000-4000-8000-0000000000c4';
const issuerKeys=generateKeyPairSync('ed25519');
const reviewerKeys=generateKeyPairSync('ed25519');
const digest=x=>createHash('sha256').update(x).digest('hex');
const safeBody=()=>({
 schema_version:'v3.2-121-ext001-evidence-v1',
 scope:'CI_FIXTURE_ONLY',gap_id:'EXT-001',organization_id:org,
 revision_id:'00000000-0000-4000-8000-0000000000c5',
 collected_at_ms:100_000,valid_until_ms:200_000,
 producer:{principal_id:issuerId,key_id:issuerKey,domain:'SECURITY'},
 artifacts:[
  {id:'EXT-001-E1',kind:'IAM_ROLE_INVENTORY',
   uri:'fixture://ext001/isolated/iam-inventory',sha256:digest('synthetic role inventory version one'),
   source:'CI_SYNTHETIC',classification:'SYNTHETIC',
   captured_at_ms:99_000,expires_at_ms:200_000},
  {id:'EXT-001-E2',kind:'RBAC_NEGATIVE_TESTS',
   uri:'fixture://ext001/isolated/denial-tests',sha256:digest('synthetic RBAC denial tests version one'),
   source:'CI_SYNTHETIC',classification:'SYNTHETIC',
   captured_at_ms:99_001,expires_at_ms:200_000}
 ],
 role_inventory:REQUIRED_IAM_ROLES.map(role=>{
  const human=['SALES','FINANCE','ACADEMIC','DEPLOYMENT'].includes(role);
  return {role,principal_class:human?'HUMAN':'SERVICE',
   authentication:human?'MFA':'WORKLOAD_IDENTITY',
   organization_id:org,least_privilege_asserted:true};
 }),
 denial_matrix:REQUIRED_DENIAL_CASES.map(x=>({
  case:x,result:'DENIED_IN_FIXTURE',artifact_id:'EXT-001-E2'
 }))
});
const signBody=body=>signFixtureExt001Envelope(body,{
 issuerPrivateKey:issuerKeys.privateKey,reviewerPrivateKey:reviewerKeys.privateKey,
 reviewerId,reviewerKeyId:reviewerKey,reviewedAtMs:110_000
});
const trusted=()=>new Map([
 [issuerKey,{status:'ACTIVE',domain:'SECURITY',principal_id:issuerId,publicKey:issuerKeys.publicKey}],
 [reviewerKey,{status:'ACTIVE',domain:'AUDIT',principal_id:reviewerId,publicKey:reviewerKeys.publicKey}]
]);
const verified=env=>verifyFixtureExt001Envelope(env,{trustedKeys:trusted(),nowMs:120_000});
const changed=(edit,expected)=>{
 const env=signBody(safeBody());
 edit(env);
 assert.throws(()=>verified(env),{code:expected});
};

test('two independently signed, synthetic EXT-001 evidence references stay HOLD, never production proof',()=>{
 const env=signBody(safeBody());
 const result=verified(env);
 assert.deepEqual(result,{
  decision:'FIXTURE_EVIDENCE_INTERNALLY_CONSISTENT_STILL_HOLD',
  gap_id:'EXT-001',verified_fixture_artifacts:2,simulated_denial_checks:8,
  provenance_verified_externally:false,production_evidence_collected:false,
  independent_production_review_completed:false,production_gap_status:'UNVERIFIED',
  release_authorized:false,merge_allowed:false,deploy_allowed:false,
  quarantine_active:true,hold_active:true,release_eligible:false
 });
 assert.ok(Object.isFrozen(result));
 assert.equal('production_receipt' in result,false);
});

test('rejects missing evidence, invalid provenance, cross-organization scope and unsafe auth inventory',()=>{
 changed(e=>{e.body.artifacts.pop();},'V121_IAM_EVIDENCE_INCOMPLETE');
 changed(e=>{e.body.artifacts[1].id='EXT-001-E1';},'V121_IAM_EVIDENCE_INCOMPLETE');
 changed(e=>{e.body.role_inventory.pop();},'V121_IAM_EVIDENCE_INCOMPLETE');
 changed(e=>{e.body.denial_matrix.pop();},'V121_IAM_EVIDENCE_INCOMPLETE');
 changed(e=>{e.body.organization_id='22222222-2222-4222-8222-222222222222';},'V121_IAM_EVIDENCE_SCOPE_INVALID');
 changed(e=>{e.body.scope='PRODUCTION';},'V121_IAM_EVIDENCE_SCOPE_INVALID');
 changed(e=>{e.body.gap_id='EXT-002';},'V121_IAM_EVIDENCE_SCOPE_INVALID');
 changed(e=>{e.body.artifacts[0].source='PRODUCTION_IAM';},'V121_IAM_EVIDENCE_ARTIFACT_INVALID');
 changed(e=>{e.body.artifacts[0].uri='https://real-production.example/secrets';},'V121_IAM_EVIDENCE_ARTIFACT_INVALID');
 changed(e=>{e.body.artifacts[0].token='credential';},'V121_IAM_EVIDENCE_ARTIFACT_INVALID');
 changed(e=>{e.body.artifacts[0].sha256='0';},'V121_IAM_EVIDENCE_ARTIFACT_INVALID');
 changed(e=>{e.body.artifacts[1].sha256=e.body.artifacts[0].sha256;},'V121_IAM_EVIDENCE_ARTIFACT_INVALID');
 changed(e=>{e.body.role_inventory[0].least_privilege_asserted=false;},'V121_IAM_EVIDENCE_IDENTITY_INVALID');
 changed(e=>{e.body.role_inventory[5].authentication='PASSWORD_ONLY';},'V121_IAM_EVIDENCE_IDENTITY_INVALID');
 changed(e=>{e.body.denial_matrix[0].result='ALLOWED';},'V121_IAM_EVIDENCE_DENIAL_INVALID');
 changed(e=>{e.body.denial_matrix[0].artifact_id='EXT-001-E1';},'V121_IAM_EVIDENCE_DENIAL_INVALID');
 changed(e=>{e.body.producer.domain='FINANCE';},'V121_IAM_EVIDENCE_ISSUER_INVALID');
});

test('detects altered payload, signatures, reviewer impersonation and revoked trust independently',()=>{
 changed(e=>{e.body.artifacts[0].sha256=digest('changed inventory');},'V121_IAM_EVIDENCE_REVIEW_INVALID');
 changed(e=>{e.body.artifacts[0].captured_at_ms=98_000;},'V121_IAM_EVIDENCE_REVIEW_INVALID');
 changed(e=>{e.reviewer.reviewer_id=issuerId;},'V121_IAM_EVIDENCE_REVIEW_INVALID');
 changed(e=>{e.reviewer.domain='SECURITY';},'V121_IAM_EVIDENCE_REVIEW_INVALID');
 changed(e=>{e.reviewer.decision='SIGNED_PRODUCTION';},'V121_IAM_EVIDENCE_REVIEW_INVALID');
 changed(e=>{e.reviewer.body_digest='f'.repeat(64);},'V121_IAM_EVIDENCE_REVIEW_INVALID');
 changed(e=>{e.reviewer.reviewed_at_ms=200_000;},'V121_IAM_EVIDENCE_REVIEW_INVALID');
 changed(e=>{e.reviewer.reviewed_at_ms=125_000;},'V121_IAM_EVIDENCE_REVIEW_INVALID');
 changed(e=>{e.issuer_signature_b64='A'.repeat(86)+'==';},'V121_IAM_EVIDENCE_SIGNATURE_INVALID');
 changed(e=>{e.reviewer.signature_b64='A'.repeat(86)+'==';},'V121_IAM_EVIDENCE_SIGNATURE_INVALID');
 const good=signBody(safeBody());
 assert.throws(()=>verifyFixtureExt001Envelope(good,{trustedKeys:new Map(),nowMs:120_000}),
  {code:'V121_IAM_EVIDENCE_TRUST_INVALID'});
 let t=trusted();t.get(issuerKey).status='REVOKED';
 assert.throws(()=>verifyFixtureExt001Envelope(good,{trustedKeys:t,nowMs:120_000}),
  {code:'V121_IAM_EVIDENCE_TRUST_INVALID'});
 t=trusted();t.get(reviewerKey).domain='SECURITY';
 assert.throws(()=>verifyFixtureExt001Envelope(good,{trustedKeys:t,nowMs:120_000}),
  {code:'V121_IAM_EVIDENCE_TRUST_INVALID'});
 t=trusted();t.get(reviewerKey).publicKey=issuerKeys.publicKey;
 assert.throws(()=>verifyFixtureExt001Envelope(good,{trustedKeys:t,nowMs:120_000}),
  {code:'V121_IAM_EVIDENCE_SIGNATURE_INVALID'});
});

test('rejects stale snapshots and out-of-window review with no fallback to partial acceptance',()=>{
 const env=signBody(safeBody());
 for(const when of [99_999,200_000,250_000]){
  assert.throws(()=>verifyFixtureExt001Envelope(env,{trustedKeys:trusted(),nowMs:when}),
   {code:'V121_IAM_EVIDENCE_STALE'});
 }
 const b=safeBody();b.valid_until_ms=b.collected_at_ms+3_600_001;
 assert.throws(()=>signBody(b),{code:'V121_IAM_EVIDENCE_SCOPE_INVALID'});
 b.valid_until_ms=200_000;
 b.artifacts[0].expires_at_ms=199_999;
 assert.throws(()=>signBody(b),{code:'V121_IAM_EVIDENCE_ARTIFACT_INVALID'});
 assert.throws(()=>signFixtureExt001Envelope(safeBody(),{
  issuerPrivateKey:issuerKeys.privateKey,reviewerPrivateKey:reviewerKeys.privateKey,
  reviewerId:issuerId,reviewerKeyId:reviewerKey,reviewedAtMs:110_000
 }),{code:'V121_IAM_EVIDENCE_REVIEW_INVALID'});
});

test('a valid simulated receipt cannot fill actual external readiness evidence or manual signoff',()=>{
 const r=JSON.parse(readFileSync(new URL('../../docs/market-sales/v3-2-121-release-readiness.json',import.meta.url),'utf8'));
 const h=JSON.parse(readFileSync(new URL('../../docs/market-sales/v3-2-121-production-handover.json',import.meta.url),'utf8'));
 assert.equal(validateFixtureV121Handover(r,h),true);
 assert.equal(verified(signBody(safeBody())).production_evidence_collected,false);
 assert.equal(r.production_gaps.find(x=>x.id==='EXT-001').status,'UNVERIFIED');
 const ext=h.tasks.find(x=>x.id==='EXT-001');
 assert.equal(ext.package_status,'NOT_COLLECTED');
 assert.deepEqual(ext.evidence_artifact_refs,[]);
 assert.equal(ext.independent_review_status,'NOT_REVIEWED');
 assert.equal(ext.manual_signoff_status,'NOT_SIGNED');
});
