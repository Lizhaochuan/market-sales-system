import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {
 REQUIRED_IAM_ROLES,REQUIRED_DENIAL_CASES,
 signFixtureExt001Envelope,verifyFixtureExt001Envelope,verifyFixtureExt001BytesAndFingerprint,issueFixtureExt001VerifiedProvenance
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
 scope:'CI_FIXTURE_ONLY',gap_id:'EXT-001',organization_id:org,revision_no:1,
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


test('signed revision and actual E1/E2 bytes must match before isolated provenance admission',()=>{
 const e1=Buffer.from('synthetic role inventory version one');
 const e2=Buffer.from('synthetic RBAC denial tests version one');
 const bytes=()=>new Map([['EXT-001-E1',Buffer.from(e1)],['EXT-001-E2',Buffer.from(e2)]]);
 const env=signBody(safeBody());
 const opts={trustedKeys:trusted(),nowMs:120_000};
 const result=verifyFixtureExt001BytesAndFingerprint(env,{...opts,artifactBytes:bytes()});
 assert.equal(result.revision_no,1);
 assert.equal(result.revision_id,env.body.revision_id);
 assert.equal(result.file_bytes_verified_in_fixture,true);
 assert.match(result.issuer_signature_digest,/^[a-f0-9]{64}$/);
 assert.match(result.reviewer_signature_digest,/^[a-f0-9]{64}$/);
 assert.equal(result.production_evidence_collected,false);
 assert.equal(result.hold_active,true);
 assert.equal(result.release_eligible,false);
 const switched=bytes();
 switched.set('EXT-001-E1',Buffer.from('synthetic role inventory version TWO'));
 assert.throws(()=>verifyFixtureExt001BytesAndFingerprint(env,{...opts,artifactBytes:switched}),
  {code:'V121_IAM_FILE_DIGEST_MISMATCH'});
 const swapped=bytes();
 swapped.set('EXT-001-E1',e2);
 swapped.set('EXT-001-E2',e1);
 assert.throws(()=>verifyFixtureExt001BytesAndFingerprint(env,{...opts,artifactBytes:swapped}),
  {code:'V121_IAM_FILE_DIGEST_MISMATCH'});
 assert.throws(()=>verifyFixtureExt001BytesAndFingerprint(env,{...opts,artifactBytes:new Map([['EXT-001-E1',e1]])}),
  {code:'V121_IAM_FILE_BYTES_MISSING'});
 assert.throws(()=>verifyFixtureExt001BytesAndFingerprint(env,{...opts,artifactBytes:new Map([['EXT-001-E1',e1],['EXT-001-E2','not raw bytes']])}),
  {code:'V121_IAM_FILE_BYTES_INVALID'});
 assert.throws(()=>verifyFixtureExt001BytesAndFingerprint(env,{...opts,artifactBytes:new Map([['EXT-001-E1',e1],['EXT-001-E2',Buffer.alloc(0)]])}),
  {code:'V121_IAM_FILE_BYTES_INVALID'});
 assert.throws(()=>verifyFixtureExt001BytesAndFingerprint(env,{...opts,artifactBytes:new Map([['EXT-001-E1',e1],['EXT-001-E2',Buffer.alloc(1_048_577)]])}),
  {code:'V121_IAM_FILE_BYTES_INVALID'});
 const forged=structuredClone(env);
 forged.body.revision_no=2;
 assert.throws(()=>verifyFixtureExt001BytesAndFingerprint(forged,{...opts,artifactBytes:bytes()}),
  {code:'V121_IAM_EVIDENCE_REVIEW_INVALID'});
 const oldReview=signBody(safeBody());
 const updated=safeBody();
 updated.revision_no=2;
 updated.artifacts[0].sha256=digest('synthetic changed E1 file');
 const newIssuer=signBody(updated);
 assert.notEqual(newIssuer.reviewer.body_digest,oldReview.reviewer.body_digest);
 assert.notEqual(newIssuer.issuer_signature_b64,oldReview.issuer_signature_b64);
 const mixed={...newIssuer,reviewer:oldReview.reviewer};
 assert.throws(()=>verifyFixtureExt001BytesAndFingerprint(mixed,{...opts,artifactBytes:bytes()}),
  {code:'V121_IAM_EVIDENCE_REVIEW_INVALID'});
});


test('independent provenance attester cannot be called with stale file bytes or unsigned revision',async()=>{
 const envelope=signBody(safeBody());
 const artifactBytes=new Map([
  ['EXT-001-E1',Buffer.from('synthetic role inventory version one')],
  ['EXT-001-E2',Buffer.from('synthetic RBAC denial tests version one')]
 ]);
 const receiptId='00000000-0000-4000-8000-0000000000c6';
 let calls=0;
 const attester={query:async(sql,args)=>{
  calls++;
  assert.match(sql,/fixture_attest_iam_provenance/);
  assert.equal(args[0],org);
  assert.equal(args[1],1);
  assert.equal(args[2],envelope.body.revision_id);
  assert.equal(args[3],receiptId);
  assert.equal(args[7],issuerId);
  assert.equal(args[8],reviewerId);
  assert.equal(args[9].length,64);
  assert.equal(args[10].length,64);
  return {rows:[{verdict:'ATTESTED_SYNTHETIC_STILL_HOLD'}]};
 }};
 const settings={envelope,artifactBytes,trustedKeys:trusted(),
  nowMs:120_000,revisionNo:1,receiptId,attester};
 const result=await issueFixtureExt001VerifiedProvenance(settings);
 assert.equal(result.verdict,'ATTESTED_SYNTHETIC_STILL_HOLD');
 assert.equal(result.release_authorized,false);
 assert.equal(result.production_evidence_collected,false);
 assert.equal(result.hold_active,true);
 assert.equal(calls,1);
 await assert.rejects(issueFixtureExt001VerifiedProvenance({...settings,revisionNo:2}),
  {code:'V121_IAM_PROVENANCE_SIGNED_REVISION_MISMATCH'});
 await assert.rejects(issueFixtureExt001VerifiedProvenance({...settings,receiptId:'bad'}),
  {code:'V121_IAM_PROVENANCE_INPUT_INVALID'});
 await assert.rejects(issueFixtureExt001VerifiedProvenance({...settings,attester:null}),
  {code:'V121_IAM_PROVENANCE_ATTESTER_UNAVAILABLE'});
 const changedBytes=new Map(artifactBytes);
 changedBytes.set('EXT-001-E1',Buffer.from('replaced after audit'));
 await assert.rejects(issueFixtureExt001VerifiedProvenance({...settings,artifactBytes:changedBytes}),
  {code:'V121_IAM_FILE_DIGEST_MISMATCH'});
 const reviewerSwapped=structuredClone(envelope);
 reviewerSwapped.reviewer.reviewer_id=issuerId;
 await assert.rejects(issueFixtureExt001VerifiedProvenance({...settings,envelope:reviewerSwapped}),
  {code:'V121_IAM_EVIDENCE_REVIEW_INVALID'});
 const changedProof=structuredClone(envelope);
 changedProof.body.revision_no=2;
 await assert.rejects(issueFixtureExt001VerifiedProvenance({...settings,envelope:changedProof}),
  {code:'V121_IAM_EVIDENCE_REVIEW_INVALID'});
 assert.equal(calls,1,'No rejected proof may cause SQL attestation');
 await assert.rejects(issueFixtureExt001VerifiedProvenance({...settings,
  attester:{query:async()=>({rows:[{verdict:'WRONG'}]})}}),
  {code:'V121_IAM_PROVENANCE_ATTESTATION_INDETERMINATE'});
});
