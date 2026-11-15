// EXT-001 CI fixture simulation of pinned external object versions and two
// independently authenticated storage observations. No external network,
// production IAM credentials, or release authorization are used.
import {createHash, createPublicKey, sign, verify} from 'node:crypto';
import {
 fingerprintFixtureExt001ForIntake,
 encodeFixtureExt001SourceAuthorization,
 issueFixtureExt001VerifiedProvenance
} from './cross-module-v121-iam-evidence.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HEX=/^[a-f0-9]{64}$/;
const VERSION=/^fixture-v[1-9][0-9]{0,7}-[a-z0-9-]{1,32}$/;
const ROLE_IDS=['EXT-001-E1','EXT-001-E2'];
const MAX_AGE_MS=30_000;
const MAX_BYTES=1_048_576;
const SOURCE_DOMAIN='FIXTURE_PRIMARY_STORE';
const AUDIT_DOMAIN='FIXTURE_AUDIT_MIRROR';
const required=(x,keys)=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 Object.keys(x).length===keys.length && keys.every(key=>Object.hasOwn(x,key));
const fail=code=>{throw Object.assign(new Error(code),{code});};
const sha=buf=>createHash('sha256').update(buf).digest('hex');
const isUuid=v=>typeof v==='string'&&UUID.test(v);
const isTime=v=>Number.isSafeInteger(v)&&v>0;
// The issuance path must re-read a monotonic injected clock after awaited I/O.
// This CI clock is not a trusted production time service.
function tickClock(clock,previous){
 let current;
 try{current=clock();}catch{fail('V121_IAM_SOURCE_CLOCK_UNAVAILABLE');}
 if(!isTime(current)||current<previous)
  fail('V121_IAM_SOURCE_CLOCK_ROLLBACK_OR_INVALID');
 return current;
}
const encode=(domain,value)=>Buffer.from(domain+'|'+JSON.stringify(value),'utf8');
const isSignature=value=>typeof value==='string'&&/^[A-Za-z0-9+/]{86}==$/.test(value)&&
 Buffer.from(value,'base64').length===64 &&
 Buffer.from(value,'base64').toString('base64')===value;
const fields=['schema_version','scope','organization_id','revision_no','revision_id',
 'envelope_digest','recorded_at_ms','expires_at_ms','objects'];

function checkManifest(manifest,envelope,fingerprint,nowMs){
 if(!required(manifest,fields) ||
    manifest.schema_version!=='v3.2-121-ext001-source-version-v1' ||
    manifest.scope!=='CI_FIXTURE_ONLY' ||
    manifest.organization_id!==envelope.body.organization_id ||
    manifest.revision_no!==envelope.body.revision_no ||
    manifest.revision_id!==envelope.body.revision_id ||
    manifest.envelope_digest!==fingerprint.evidence_digest ||
    !isTime(manifest.recorded_at_ms) || !isTime(manifest.expires_at_ms) ||
    manifest.recorded_at_ms>nowMs ||
    nowMs>=manifest.expires_at_ms ||
    manifest.expires_at_ms>envelope.body.valid_until_ms ||
    manifest.expires_at_ms-manifest.recorded_at_ms>3_600_000)
  fail('V121_IAM_SOURCE_MANIFEST_INVALID');
 if(!Array.isArray(manifest.objects)||manifest.objects.length!==2)
  fail('V121_IAM_SOURCE_MANIFEST_INVALID');
 for(const id of ROLE_IDS){
  const records=manifest.objects.filter(obj=>obj?.artifact_id===id);
  if(records.length!==1) fail('V121_IAM_SOURCE_MANIFEST_INVALID');
  const rec=records[0];
  const signedArtifact=envelope.body.artifacts.find(obj=>obj.id===id);
  if(!required(rec,['artifact_id','object_ref','object_version_id','generation','sha256']) ||
     rec.object_ref!==signedArtifact?.uri ||
     !/^fixture:\/\/ext001\/[a-z0-9-]+\/(iam-inventory|denial-tests)$/.test(rec.object_ref) ||
     typeof rec.object_version_id!=='string'||!VERSION.test(rec.object_version_id)||
     !Number.isSafeInteger(rec.generation)||rec.generation<1||
     typeof rec.sha256!=='string'||!HEX.test(rec.sha256)||
     rec.sha256!==signedArtifact.sha256)
   fail('V121_IAM_SOURCE_MANIFEST_INVALID');
 }
 // Each synthetic E1/E2 evidence object must have a distinct pinned
 // version identity. An aliased version makes a two-object coverage claim
 // ambiguous even when references and content digests differ.
 if(manifest.objects[0].object_ref===manifest.objects[1].object_ref ||
    manifest.objects[0].object_version_id===manifest.objects[1].object_version_id)
  fail('V121_IAM_SOURCE_MANIFEST_INVALID');
}

function checkWitness(witness,domain,issuer,envelope,manifest,trustedKeys){
 if(!required(witness,['domain','key_id','principal_id','signature_b64'])||
    witness.domain!==domain||!isUuid(witness.key_id)||
    !isUuid(witness.principal_id)||!isSignature(witness.signature_b64)||
    witness.key_id===envelope.body.producer.key_id ||
    witness.key_id===envelope.reviewer.key_id ||
    witness.principal_id===envelope.body.producer.principal_id ||
    witness.principal_id===envelope.reviewer.reviewer_id)
  fail('V121_IAM_SOURCE_TRUST_INVALID');
 const trusted=trustedKeys.get(witness.key_id);
 if(!trusted||trusted.status!=='ACTIVE'||trusted.domain!==domain||
    trusted.principal_id!==witness.principal_id||!trusted.publicKey)
  fail('V121_IAM_SOURCE_TRUST_INVALID');
 if(!verify(null,encode('v121-ext001-'+issuer+'-manifest-v1',manifest),
   trusted.publicKey,Buffer.from(witness.signature_b64,'base64')))
  fail('V121_IAM_SOURCE_SIGNATURE_INVALID');
}

export function signFixtureExt001SourceManifest(manifest,{
 primaryPrivateKey,auditPrivateKey,primaryKeyId,primaryPrincipalId,
 auditKeyId,auditPrincipalId
}){
 if(!isUuid(primaryKeyId)||!isUuid(auditKeyId)||
    !isUuid(primaryPrincipalId)||!isUuid(auditPrincipalId))
  fail('V121_IAM_SOURCE_SIGNER_INVALID');
 return {
  manifest,
  primary_witness:{
   domain:SOURCE_DOMAIN,key_id:primaryKeyId,principal_id:primaryPrincipalId,
   signature_b64:sign(null,encode('v121-ext001-primary-manifest-v1',manifest),
    primaryPrivateKey).toString('base64')
  },
  audit_witness:{
   domain:AUDIT_DOMAIN,key_id:auditKeyId,principal_id:auditPrincipalId,
   signature_b64:sign(null,encode('v121-ext001-audit-manifest-v1',manifest),
    auditPrivateKey).toString('base64')
  }
 };
}

// Distinct role IDs are insufficient if two roles alias the same Ed25519 key.
// This is fixture-only local key separation, not external identity proof.
function checkKeySeparation(envelope,trustedKeys,sourceKeys,primary,audit){
 const refs=[
  [trustedKeys,envelope.body.producer.key_id],
  [trustedKeys,envelope.reviewer.key_id],
  [sourceKeys,primary.key_id],
  [sourceKeys,audit.key_id]
 ];
 const observed=new Set();
 for(const [registry,keyId] of refs){
  const entry=registry?.get(keyId);
  if(!entry?.publicKey) fail('V121_IAM_SOURCE_TRUST_INVALID');
  let publicKey;
  try{
   publicKey=entry.publicKey?.type==='public'
    ?entry.publicKey:createPublicKey(entry.publicKey);
   if(publicKey.type!=='public'||publicKey.asymmetricKeyType!=='ed25519')
    fail('V121_IAM_SOURCE_TRUST_INVALID');
  }catch{
   fail('V121_IAM_SOURCE_TRUST_INVALID');
  }
  const digest=sha(publicKey.export({type:'spki',format:'der'}));
  if(observed.has(digest))
   fail('V121_IAM_SOURCE_WITNESSES_NOT_INDEPENDENT');
  observed.add(digest);
 }
}

function checkRead(read,record,reader,nowMs){
 if(!required(read,['artifact_id','object_ref','object_version_id','generation',
  'sha256','bytes','observed_at_ms','is_current','lock_mode','source_domain'])||
  read.artifact_id!==record.artifact_id||
  read.object_ref!==record.object_ref||
  read.object_version_id!==record.object_version_id||
  read.generation!==record.generation||
  read.source_domain!==reader||
  read.is_current!==true||read.lock_mode!=='FIXTURE_IMMUTABLE'||
  !isTime(read.observed_at_ms)||
  read.observed_at_ms>nowMs||
  nowMs-read.observed_at_ms>MAX_AGE_MS)
  fail('V121_IAM_SOURCE_VERSION_OR_FRESHNESS_MISMATCH');
 if(!Buffer.isBuffer(read.bytes)||read.bytes.length<1||
  read.bytes.length>MAX_BYTES)
  fail('V121_IAM_SOURCE_BYTES_INVALID');
 if(read.sha256!==record.sha256||sha(read.bytes)!==record.sha256)
  fail('V121_IAM_SOURCE_CONTENT_MISMATCH');
}

const get=(reader,reference)=>Promise.resolve().then(()=>reader(reference));

// Two fetch rounds protect against substitution during the evaluation window.
// In production both readers MUST use independently authenticated providers.
export async function verifyFixtureExt001SourceVersion({
 envelope,trustedKeys,sourceKeys,sourceProof,primaryReader,auditReader,nowMs,clock
}={}){
 let lastTime=nowMs;
 const currentTime=()=>{
  if(clock===undefined) return nowMs; // direct, non-issuing fixture verifier
  if(typeof clock!=='function')
   fail('V121_IAM_SOURCE_CLOCK_ROLLBACK_OR_INVALID');
  lastTime=tickClock(clock,lastTime);
  return lastTime;
 };
 const fingerprint=fingerprintFixtureExt001ForIntake(envelope,{
  trustedKeys,nowMs:currentTime()
 });
 if(!sourceProof||!required(sourceProof,['manifest','primary_witness','audit_witness']))
  fail('V121_IAM_SOURCE_MANIFEST_INVALID');
 checkManifest(sourceProof.manifest,envelope,fingerprint,currentTime());
 if(!(sourceKeys instanceof Map)) fail('V121_IAM_SOURCE_TRUST_INVALID');
 const p=sourceProof.primary_witness,a=sourceProof.audit_witness;
 if(p?.key_id===a?.key_id||p?.principal_id===a?.principal_id)
  fail('V121_IAM_SOURCE_WITNESSES_NOT_INDEPENDENT');
 checkWitness(p,SOURCE_DOMAIN,'primary',envelope,sourceProof.manifest,sourceKeys);
 checkWitness(a,AUDIT_DOMAIN,'audit',envelope,sourceProof.manifest,sourceKeys);
 checkKeySeparation(envelope,trustedKeys,sourceKeys,p,a);
 if(typeof primaryReader!=='function'||typeof auditReader!=='function'||
    primaryReader===auditReader)
  fail('V121_IAM_SOURCE_READERS_NOT_INDEPENDENT');
 const artifactBytes=new Map();
 for(let round=0;round<2;round++){
  for(const record of sourceProof.manifest.objects){
   let primary,audited;
   try{
    primary=await get(primaryReader,record);
    audited=await get(auditReader,record);
   }catch{
    fail('V121_IAM_SOURCE_UNAVAILABLE');
   }
   checkRead(primary,record,SOURCE_DOMAIN,currentTime());
   checkRead(audited,record,AUDIT_DOMAIN,currentTime());
   if(!primary.bytes.equals(audited.bytes))
    fail('V121_IAM_SOURCE_CROSS_CHECK_MISMATCH');
   if(round===0){
    artifactBytes.set(record.artifact_id,Buffer.from(primary.bytes));
   }else if(!artifactBytes.get(record.artifact_id).equals(primary.bytes)){
    fail('V121_IAM_SOURCE_CHANGED_DURING_RECHECK');
   }
  }
  // Reads await untrusted fixture providers. Detect key revocation or key
  // material replacement during either round, before attester admission.
  fingerprintFixtureExt001ForIntake(envelope,{trustedKeys,nowMs:currentTime()});
  checkManifest(sourceProof.manifest,envelope,fingerprint,currentTime());
  checkWitness(p,SOURCE_DOMAIN,'primary',envelope,sourceProof.manifest,sourceKeys);
  checkWitness(a,AUDIT_DOMAIN,'audit',envelope,sourceProof.manifest,sourceKeys);
  checkKeySeparation(envelope,trustedKeys,sourceKeys,p,a);
 }
 return Object.freeze({
  decision:'TWO_FIXTURE_SOURCES_RECHECKED_STILL_HOLD',
  revision_no:fingerprint.revision_no,
  revision_id:fingerprint.revision_id,
  envelope_digest:fingerprint.evidence_digest,
  objects_verified:2,
  read_rounds:2,
  artifactBytes,
  production_source_authenticated:false,
  production_evidence_collected:false,
  release_authorized:false,
  quarantine_active:true,
  hold_active:true,
  release_eligible:false
 });
}

export async function issueFixtureExt001FromTwoSources(args){
 if(typeof args?.clock!=='function')
  fail('V121_IAM_SOURCE_CLOCK_REQUIRED');
 let lastTime=0;
 const clock=()=>{
  lastTime=tickClock(args.clock,lastTime);
  return lastTime;
 };
 const verified=await verifyFixtureExt001SourceVersion({
  ...args,nowMs:clock(),clock
 });
 if(typeof args.sourceAuthSigner!=='function' ||
    !Number.isSafeInteger(args.sourceKeyVersion) || args.sourceKeyVersion<1)
  fail('V121_IAM_SOURCE_AUTH_REQUIRED');
 const sourceBindingDigest=sha(encode('v121-ext001-source-binding-v1',args.sourceProof));
 const sourceFingerprint=fingerprintFixtureExt001ForIntake(args.envelope,{
  trustedKeys:args.trustedKeys,nowMs:clock()
 });
 const payload=encodeFixtureExt001SourceAuthorization({
  ...sourceFingerprint,receipt_id:args.receiptId
 },sourceBindingDigest,args.sourceKeyVersion);
 let sourceMac;
 try{
  sourceMac=await args.sourceAuthSigner(payload);
 }catch{
  // A remote verifier outage or refusal cannot silently fall back to
  // the legacy SQL path or cause any database attestation.
  fail('V121_IAM_SOURCE_SIGNER_UNAVAILABLE');
 }
 if(typeof sourceMac!=='string'||!/^[a-f0-9]{64}$/.test(sourceMac))
  fail('V121_IAM_SOURCE_AUTH_INVALID');
 // A delayed signer may outlive source revocation or content replacement.
 // Re-read both independent stores again before the SQL write.
 const afterSigner=await verifyFixtureExt001SourceVersion({
  ...args,nowMs:clock(),clock
 });
 if(afterSigner.revision_id!==verified.revision_id||
    afterSigner.envelope_digest!==verified.envelope_digest||
    !['EXT-001-E1','EXT-001-E2'].every(id=>
      verified.artifactBytes.get(id).equals(afterSigner.artifactBytes.get(id))))
  fail('V121_IAM_SOURCE_CHANGED_DURING_SIGNING');
 const result=await issueFixtureExt001VerifiedProvenance({
  envelope:args.envelope,
  artifactBytes:verified.artifactBytes,
  trustedKeys:args.trustedKeys,
  nowMs:clock(),
  revisionNo:verified.revision_no,
  receiptId:args.receiptId,
  attester:args.attester,
  // The signed manifest plus both witness signatures are bound into the
  // isolated SQL provenance row, not merely displayed in JS output.
  sourceBindingDigest,
  sourceAuthorization:{key_version:args.sourceKeyVersion,mac:sourceMac}
 });
 // A database attestation may finish after a source has been revoked,
 // replaced, or expired. A failed post-check cannot undo a committed SQL
 // append-only row; it must fail closed and preserve forensic history.
 const post=await verifyFixtureExt001SourceVersion({
  ...args,nowMs:clock(),clock
 });
 const completedAt=clock();
 if(completedAt>=args.sourceProof.manifest.expires_at_ms ||
    completedAt>=args.envelope.body.valid_until_ms)
  fail('V121_IAM_SOURCE_EXPIRED_AFTER_RECHECK');
 if(post.envelope_digest!==verified.envelope_digest||
    post.revision_id!==verified.revision_id||
    !['EXT-001-E1','EXT-001-E2'].every(id=>
      verified.artifactBytes.get(id).equals(post.artifactBytes.get(id))))
  fail('V121_IAM_SOURCE_CHANGED_AFTER_ATTESTATION');
 return Object.freeze({
  ...result,
  source_checked_in_fixture:true,
  independent_read_rounds:6,
  post_signer_source_rechecked:true,
  post_attestation_source_rechecked:true,
  production_source_authenticated:false,
  production_evidence_collected:false,
  release_authorized:false,
  hold_active:true,release_eligible:false
 });
}
