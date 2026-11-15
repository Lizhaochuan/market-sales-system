// EXT-001: synthetic IAM evidence intake contract. No real credentials, production
// evidence, approval or authorization to release CRM quarantine are persisted.
import {createHash,sign,verify} from 'node:crypto';

export const REQUIRED_IAM_ROLES=Object.freeze([
 'ATTESTER','ANCHOR_WRITER','ANCHOR_READER','SECURITY_REPORTER',
 'SALES','FINANCE','ACADEMIC','DEPLOYMENT'
]);
export const REQUIRED_DENIAL_CASES=Object.freeze([
 'ATTESTER_CANNOT_WRITE_CHECKPOINT','ANCHOR_WRITER_CANNOT_ATTEST',
 'SALES_CANNOT_MUTATE_FINANCE','FINANCE_CANNOT_MUTATE_ACADEMIC',
 'ACADEMIC_CANNOT_MUTATE_SALES','DEPLOYMENT_CANNOT_RELEASE_HOLD',
 'CROSS_ORGANIZATION_ACCESS_DENIED','REVOKED_IDENTITY_ACCESS_DENIED'
]);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH=/^[a-f0-9]{64}$/;
const SIG=/^[A-Za-z0-9+/]{86}==$/;
const ORG='11111111-1111-4111-8111-111111111111';
const TTL=3_600_000;
const fail=code=>{throw Object.assign(new Error(code),{code});};
const hasKeys=(value,keys)=>value!==null && typeof value==='object' &&
 !Array.isArray(value) &&
 Object.keys(value).length===keys.length &&
 keys.every(key=>Object.prototype.hasOwnProperty.call(value,key));
const exact=(items,required,key='id')=>Array.isArray(items) &&
 items.length===required.length &&
 required.every(x=>items.filter(y=>y?.[key]===x).length===1);
const canonical=value=>{
 if(Array.isArray(value)) return value.map(canonical);
 if(value!==null && typeof value==='object'){
  return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
 }
 return value;
};
const encoded=(domain,data)=>Buffer.from(domain+'|'+JSON.stringify(canonical(data)),'utf8');
const sha=value=>createHash('sha256').update(value).digest('hex');
const isUuid=x=>typeof x==='string' && UUID.test(x);
const validTime=x=>Number.isSafeInteger(x) && x>0;
const signature=(value)=>typeof value==='string' && SIG.test(value) &&
 Buffer.from(value,'base64').toString('base64')===value &&
 Buffer.from(value,'base64').length===64;
const signed=(data,key)=>sign(null,data,key).toString('base64');

function validateBody(body){
 if(!hasKeys(body,['schema_version','scope','gap_id','organization_id',
  'revision_no','revision_id','collected_at_ms','valid_until_ms','producer',
  'artifacts','role_inventory','denial_matrix'])) fail('V121_IAM_EVIDENCE_SHAPE_INVALID');
 if(body.schema_version!=='v3.2-121-ext001-evidence-v1' ||
  body.scope!=='CI_FIXTURE_ONLY' || body.gap_id!=='EXT-001' ||
  body.organization_id!==ORG || !Number.isSafeInteger(body.revision_no) ||
  body.revision_no<1 || !isUuid(body.revision_id) ||
  !validTime(body.collected_at_ms) || !validTime(body.valid_until_ms) ||
  body.valid_until_ms<=body.collected_at_ms ||
  body.valid_until_ms-body.collected_at_ms>TTL)
  fail('V121_IAM_EVIDENCE_SCOPE_INVALID');
 const producer=body.producer;
 if(!hasKeys(producer,['principal_id','key_id','domain']) ||
  !isUuid(producer.principal_id) || !isUuid(producer.key_id) ||
  producer.domain!=='SECURITY') fail('V121_IAM_EVIDENCE_ISSUER_INVALID');
 if(!exact(body.artifacts,['EXT-001-E1','EXT-001-E2']) ||
  !exact(body.role_inventory,REQUIRED_IAM_ROLES,'role') ||
  !exact(body.denial_matrix,REQUIRED_DENIAL_CASES,'case'))
  fail('V121_IAM_EVIDENCE_INCOMPLETE');
 for(const art of body.artifacts){
  const kind=art.id==='EXT-001-E1'?'IAM_ROLE_INVENTORY':'RBAC_NEGATIVE_TESTS';
  if(!hasKeys(art,['id','kind','uri','sha256','source','classification',
   'captured_at_ms','expires_at_ms']) ||
   art.kind!==kind ||
   typeof art.uri!=='string' ||
   !/^fixture:\/\/ext001\/[a-z0-9-]+\/(iam-inventory|denial-tests)$/.test(art.uri) ||
   art.source!=='CI_SYNTHETIC' || art.classification!=='SYNTHETIC' ||
   typeof art.sha256!=='string' || !HASH.test(art.sha256) ||
   !validTime(art.captured_at_ms) || !validTime(art.expires_at_ms) ||
   art.captured_at_ms>body.collected_at_ms ||
   art.expires_at_ms<body.valid_until_ms)
   fail('V121_IAM_EVIDENCE_ARTIFACT_INVALID');
 }
 if(body.artifacts[0].sha256===body.artifacts[1].sha256)
  fail('V121_IAM_EVIDENCE_ARTIFACT_INVALID');
 for(const identity of body.role_inventory){
  const expected=REQUIRED_IAM_ROLES.includes(identity.role) &&
   ['SALES','FINANCE','ACADEMIC','DEPLOYMENT'].includes(identity.role)
   ?{principal_class:'HUMAN',authentication:'MFA'}
   :{principal_class:'SERVICE',authentication:'WORKLOAD_IDENTITY'};
  if(!hasKeys(identity,['role','principal_class','authentication','organization_id',
   'least_privilege_asserted']) ||
   identity.organization_id!==ORG ||
   identity.principal_class!==expected.principal_class ||
   identity.authentication!==expected.authentication ||
   identity.least_privilege_asserted!==true)
   fail('V121_IAM_EVIDENCE_IDENTITY_INVALID');
 }
 for(const item of body.denial_matrix){
  if(!hasKeys(item,['case','result','artifact_id']) ||
   item.result!=='DENIED_IN_FIXTURE' || item.artifact_id!=='EXT-001-E2')
   fail('V121_IAM_EVIDENCE_DENIAL_INVALID');
 }
}
const contentHash=body=>sha(encoded('v121-ext001-evidence-body-v1',body));
const reviewMaterial=review=>({
 reviewer_id:review.reviewer_id,key_id:review.key_id,
 domain:review.domain,decision:review.decision,
 reviewed_at_ms:review.reviewed_at_ms,body_digest:review.body_digest
});

export function signFixtureExt001Envelope(body,{issuerPrivateKey,reviewerPrivateKey,reviewerId,reviewerKeyId,reviewedAtMs}){
 validateBody(body);
 if(!isUuid(reviewerId) || !isUuid(reviewerKeyId) ||
  reviewerId===body.producer.principal_id ||
  reviewerKeyId===body.producer.key_id ||
  !validTime(reviewedAtMs) || reviewedAtMs<body.collected_at_ms ||
  reviewedAtMs>body.valid_until_ms) fail('V121_IAM_EVIDENCE_REVIEW_INVALID');
 const reviewer={reviewer_id:reviewerId,key_id:reviewerKeyId,
  domain:'AUDIT',decision:'AGREED_IN_FIXTURE',reviewed_at_ms:reviewedAtMs,
  body_digest:contentHash(body)};
 return {
  body,
  issuer_signature_b64:signed(encoded('v121-ext001-issuer-v1',body),issuerPrivateKey),
  reviewer:{...reviewer,signature_b64:signed(encoded('v121-ext001-review-v1',reviewer),reviewerPrivateKey)}
 };
}

export function verifyFixtureExt001Envelope(envelope,{trustedKeys,nowMs}={}){
 if(!hasKeys(envelope,['body','issuer_signature_b64','reviewer']))
  fail('V121_IAM_EVIDENCE_SHAPE_INVALID');
 const body=envelope.body;
 validateBody(body);
 if(!validTime(nowMs) || nowMs<body.collected_at_ms ||
  nowMs>=body.valid_until_ms) fail('V121_IAM_EVIDENCE_STALE');
 const r=envelope.reviewer;
 if(!hasKeys(r,['reviewer_id','key_id','domain','decision',
  'reviewed_at_ms','body_digest','signature_b64']) ||
  !isUuid(r.reviewer_id) || !isUuid(r.key_id) ||
  r.reviewer_id===body.producer.principal_id || r.key_id===body.producer.key_id ||
  r.domain!=='AUDIT' || r.decision!=='AGREED_IN_FIXTURE' ||
  !validTime(r.reviewed_at_ms) || r.reviewed_at_ms<body.collected_at_ms ||
  r.reviewed_at_ms>nowMs || r.reviewed_at_ms>=body.valid_until_ms ||
  r.body_digest!==contentHash(body))
  fail('V121_IAM_EVIDENCE_REVIEW_INVALID');
 if(!(trustedKeys instanceof Map)) fail('V121_IAM_EVIDENCE_TRUST_INVALID');
 const producer=trustedKeys.get(body.producer.key_id);
 const auditor=trustedKeys.get(r.key_id);
 if(!producer || !auditor ||
   producer.status!=='ACTIVE' || auditor.status!=='ACTIVE' ||
   producer.domain!=='SECURITY' || auditor.domain!=='AUDIT' ||
   producer.principal_id!==body.producer.principal_id ||
   auditor.principal_id!==r.reviewer_id ||
   !producer.publicKey || !auditor.publicKey)
  fail('V121_IAM_EVIDENCE_TRUST_INVALID');
 if(!signature(envelope.issuer_signature_b64) ||
    !verify(null,encoded('v121-ext001-issuer-v1',body),producer.publicKey,
     Buffer.from(envelope.issuer_signature_b64,'base64')) ||
    !signature(r.signature_b64) ||
    !verify(null,encoded('v121-ext001-review-v1',reviewMaterial(r)),auditor.publicKey,
     Buffer.from(r.signature_b64,'base64')))
  fail('V121_IAM_EVIDENCE_SIGNATURE_INVALID');
 return Object.freeze({
  decision:'FIXTURE_EVIDENCE_INTERNALLY_CONSISTENT_STILL_HOLD',
  gap_id:'EXT-001',verified_fixture_artifacts:2,
  simulated_denial_checks:REQUIRED_DENIAL_CASES.length,
  provenance_verified_externally:false,
  production_evidence_collected:false,
  independent_production_review_completed:false,
  production_gap_status:'UNVERIFIED',
  release_authorized:false,merge_allowed:false,deploy_allowed:false,
  quarantine_active:true,hold_active:true,release_eligible:false
 });
}


// Intake metadata is derived only after validating BOTH synthetic signatures.
// No untrusted caller may provide digest or issuer identity as a substitute.
export function fingerprintFixtureExt001ForIntake(envelope,{trustedKeys,nowMs}={}){
 verifyFixtureExt001Envelope(envelope,{trustedKeys,nowMs});
 const body=envelope.body;
 return Object.freeze({
  gap_id:'EXT-001',
  organization_id:body.organization_id,
  revision_no:body.revision_no,
  revision_id:body.revision_id,
  issuer_signature_digest:sha(Buffer.from(envelope.issuer_signature_b64,'base64')),
  reviewer_signature_digest:sha(Buffer.from(envelope.reviewer.signature_b64,'base64')),
  evidence_digest:sha(encoded('v121-ext001-intake-envelope-v1',envelope)),
  evidence_e1_digest:body.artifacts.find(a=>a.id==='EXT-001-E1').sha256,
  evidence_e2_digest:body.artifacts.find(a=>a.id==='EXT-001-E2').sha256,
  issuer_id:body.producer.principal_id,
  reviewer_id:envelope.reviewer.reviewer_id,
  valid_until_ms:body.valid_until_ms,
  production_evidence_collected:false,
  release_eligible:false,
  hold_active:true
 });
}


// Verify actual fixture file bytes, not just issuer-declared hashes. No I/O
// or remote URI resolving is performed here; caller must supply the bytes.
export function verifyFixtureExt001BytesAndFingerprint(envelope,{trustedKeys,nowMs,artifactBytes}={}){
 const fingerprint=fingerprintFixtureExt001ForIntake(envelope,{trustedKeys,nowMs});
 if(!(artifactBytes instanceof Map) || artifactBytes.size!==2 ||
  !['EXT-001-E1','EXT-001-E2'].every(id=>artifactBytes.has(id)))
  fail('V121_IAM_FILE_BYTES_MISSING');
 for(const art of envelope.body.artifacts){
  const bytes=artifactBytes.get(art.id);
  if(!Buffer.isBuffer(bytes) || bytes.length===0 || bytes.length>1_048_576)
   fail('V121_IAM_FILE_BYTES_INVALID');
  if(sha(bytes)!==art.sha256)
   fail('V121_IAM_FILE_DIGEST_MISMATCH');
 }
 return Object.freeze({
  ...fingerprint,
  file_bytes_verified_in_fixture:true,
  production_evidence_collected:false,
  release_eligible:false,hold_active:true
 });
}


// Exact byte contract mirrored by fixture_attest_iam_source_provenance in
// PostgreSQL. No secret is stored here; signing is a separate CI-only role.
export function encodeFixtureExt001SourceAuthorization(proof,sourceDigest,keyVersion){
 if(!proof||typeof sourceDigest!=='string'||
    !/^[a-f0-9]{64}$/.test(sourceDigest)||
    !Number.isSafeInteger(keyVersion)||keyVersion<1)
  fail('V121_IAM_SOURCE_AUTH_INVALID');
 const fields=[
  'v121-ext001-source-auth-v1',keyVersion,proof.organization_id,
  proof.revision_no,proof.revision_id,proof.receipt_id,
  proof.evidence_digest,proof.evidence_e1_digest,proof.evidence_e2_digest,
  proof.issuer_id,proof.reviewer_id,proof.issuer_signature_digest,
  proof.reviewer_signature_digest,proof.valid_until_ms,sourceDigest
 ];
 if(fields.some(x=>x===undefined||x===null))
  fail('V121_IAM_SOURCE_AUTH_INVALID');
 return Buffer.from(fields.join('|'),'utf8');
}

// This is the sole supported CI attester entrypoint: re-read submitted raw
// bytes, re-verify the two signatures, and enforce the signed revision number
// immediately before requesting the separate PostgreSQL attestation.
export async function issueFixtureExt001VerifiedProvenance({
 envelope,artifactBytes,trustedKeys,nowMs,revisionNo,receiptId,attester,sourceBindingDigest,sourceAuthorization
}={}){
 if(!Number.isSafeInteger(revisionNo) || revisionNo<1 ||
    !isUuid(receiptId)) fail('V121_IAM_PROVENANCE_INPUT_INVALID');
 const proof=verifyFixtureExt001BytesAndFingerprint(envelope,{
  artifactBytes,trustedKeys,nowMs
 });
 if(proof.revision_no!==revisionNo)
  fail('V121_IAM_PROVENANCE_SIGNED_REVISION_MISMATCH');
 if(!attester || typeof attester.query!=='function')
  fail('V121_IAM_PROVENANCE_ATTESTER_UNAVAILABLE');
 const sourceBound=sourceBindingDigest!==undefined;
 if(sourceBound && (typeof sourceBindingDigest!=='string'||
    !/^[a-f0-9]{64}$/.test(sourceBindingDigest)))
  fail('V121_IAM_SOURCE_BINDING_INVALID');
 if(sourceBound && (!sourceAuthorization||
    !Number.isSafeInteger(sourceAuthorization.key_version)||
    sourceAuthorization.key_version<1||
    typeof sourceAuthorization.mac!=='string'||
    !/^[a-f0-9]{64}$/.test(sourceAuthorization.mac)))
  fail('V121_IAM_SOURCE_AUTH_INVALID');
 const q=sourceBound
  ?'SELECT v121_anchor.fixture_attest_iam_source_provenance($1::uuid,$2::integer,$3::uuid,$4::uuid,$5::char(64),$6::char(64),$7::char(64),$8::uuid,$9::uuid,$10::char(64),$11::char(64),$12::timestamptz,$13::char(64),$14::integer,$15::char(64)) AS verdict'
  :'SELECT v121_anchor.fixture_attest_iam_provenance($1::uuid,$2::integer,$3::uuid,$4::uuid,$5::char(64),$6::char(64),$7::char(64),$8::uuid,$9::uuid,$10::char(64),$11::char(64),$12::timestamptz) AS verdict';
 const args=[proof.organization_id,revisionNo,proof.revision_id,receiptId,
  proof.evidence_digest,proof.evidence_e1_digest,proof.evidence_e2_digest,
  proof.issuer_id,proof.reviewer_id,proof.issuer_signature_digest,
  proof.reviewer_signature_digest,new Date(proof.valid_until_ms)];
 if(sourceBound) args.push(sourceBindingDigest,sourceAuthorization.key_version,sourceAuthorization.mac);
 const result=await attester.query(q,args);
 const permitted=sourceBound
  ?['ATTESTED_SOURCE_PROVENANCE_STILL_HOLD','EXACT_SOURCE_PROVENANCE_RETRY_STILL_HOLD']
  :['ATTESTED_SYNTHETIC_STILL_HOLD','EXACT_PROVENANCE_RETRY_STILL_HOLD'];
 if(!permitted.includes(result?.rows?.[0]?.verdict))
  fail('V121_IAM_PROVENANCE_ATTESTATION_INDETERMINATE');
 return Object.freeze({
  verdict:result.rows[0].verdict,
  receipt_id:receiptId,revision_no:revisionNo,
  envelope_digest:proof.evidence_digest,
  file_bytes_verified_in_fixture:true,
  source_version_bound_in_fixture:sourceBound,
  source_binding_digest:sourceBound?sourceBindingDigest:null,
  production_evidence_collected:false,
  release_authorized:false,hold_active:true,release_eligible:false
 });
}
