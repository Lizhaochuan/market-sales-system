import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash} from 'node:crypto';
import {
 REQUIRED_IAM_ROLES,REQUIRED_DENIAL_CASES,signFixtureExt001Envelope,
 fingerprintFixtureExt001ForIntake
} from '../../src/cross-module-v121-iam-evidence.mjs';
import {
 signFixtureExt001SourceManifest,verifyFixtureExt001SourceVersion,
 issueFixtureExt001FromTwoSources
} from '../../src/cross-module-v121-iam-source-version.mjs';

const org='11111111-1111-4111-8111-111111111111';
const id={
 issuer:'00000000-0000-4000-8000-0000000000c2',
 reviewer:'00000000-0000-4000-8000-0000000000c4',
 primary:'00000000-0000-4000-8000-0000000000e1',
 audit:'00000000-0000-4000-8000-0000000000e2',
 issuerActor:'00000000-0000-4000-8000-0000000000c1',
 reviewerActor:'00000000-0000-4000-8000-0000000000c3',
 primaryActor:'00000000-0000-4000-8000-0000000000e3',
 auditActor:'00000000-0000-4000-8000-0000000000e4'
};
const k=Object.fromEntries(
 ['issuer','reviewer','primary','audit'].map(role=>[role,generateKeyPairSync('ed25519')])
);
const hashed=v=>createHash('sha256').update(v).digest('hex');
const raw={
 'EXT-001-E1':Buffer.from('versioned immutable synthetic IAM inventory'),
 'EXT-001-E2':Buffer.from('versioned immutable synthetic denial results')
};
function setup(revision=1){
 const body={
  schema_version:'v3.2-121-ext001-evidence-v1',
  scope:'CI_FIXTURE_ONLY',gap_id:'EXT-001',organization_id:org,
  revision_no:revision,revision_id:'00000000-0000-4000-8000-0000000000e5',
  collected_at_ms:100_000,valid_until_ms:200_000,
  producer:{principal_id:id.issuerActor,key_id:id.issuer,domain:'SECURITY'},
  artifacts:[
   {id:'EXT-001-E1',kind:'IAM_ROLE_INVENTORY',uri:'fixture://ext001/archive/iam-inventory',
    sha256:hashed(raw['EXT-001-E1']),source:'CI_SYNTHETIC',classification:'SYNTHETIC',
    captured_at_ms:90_000,expires_at_ms:200_000},
   {id:'EXT-001-E2',kind:'RBAC_NEGATIVE_TESTS',uri:'fixture://ext001/archive/denial-tests',
    sha256:hashed(raw['EXT-001-E2']),source:'CI_SYNTHETIC',classification:'SYNTHETIC',
    captured_at_ms:90_000,expires_at_ms:200_000}
  ],
  role_inventory:REQUIRED_IAM_ROLES.map(role=>{
   const human=['SALES','FINANCE','ACADEMIC','DEPLOYMENT'].includes(role);
   return {role,principal_class:human?'HUMAN':'SERVICE',
    authentication:human?'MFA':'WORKLOAD_IDENTITY',
    organization_id:org,least_privilege_asserted:true};
  }),
  denial_matrix:REQUIRED_DENIAL_CASES.map(value=>({
   case:value,result:'DENIED_IN_FIXTURE',artifact_id:'EXT-001-E2'
  }))
 };
 const envelope=signFixtureExt001Envelope(body,{
  issuerPrivateKey:k.issuer.privateKey,reviewerPrivateKey:k.reviewer.privateKey,
  reviewerId:id.reviewerActor,reviewerKeyId:id.reviewer,reviewedAtMs:110_000
 });
 const trustedKeys=new Map([
  [id.issuer,{status:'ACTIVE',domain:'SECURITY',principal_id:id.issuerActor,publicKey:k.issuer.publicKey}],
  [id.reviewer,{status:'ACTIVE',domain:'AUDIT',principal_id:id.reviewerActor,publicKey:k.reviewer.publicKey}]
 ]);
 const sourceKeys=new Map([
  [id.primary,{status:'ACTIVE',domain:'FIXTURE_PRIMARY_STORE',
   principal_id:id.primaryActor,publicKey:k.primary.publicKey}],
  [id.audit,{status:'ACTIVE',domain:'FIXTURE_AUDIT_MIRROR',
   principal_id:id.auditActor,publicKey:k.audit.publicKey}]
 ]);
 const manifest={
  schema_version:'v3.2-121-ext001-source-version-v1',scope:'CI_FIXTURE_ONLY',
  organization_id:org,revision_no:revision,revision_id:body.revision_id,
  envelope_digest:fingerprintFixtureExt001ForIntake(envelope,{trustedKeys,nowMs:120_000}).evidence_digest,
  recorded_at_ms:111_000,expires_at_ms:195_000,
  objects:body.artifacts.map((art,i)=>({
   artifact_id:art.id,object_ref:art.uri,
   object_version_id:'fixture-v'+revision+'-'+(i===0?'inventory':'denials'),
   generation:revision,sha256:art.sha256
  }))
 };
 const signManifest=(m=manifest)=>signFixtureExt001SourceManifest(m,{
  primaryPrivateKey:k.primary.privateKey,auditPrivateKey:k.audit.privateKey,
  primaryKeyId:id.primary,primaryPrincipalId:id.primaryActor,
  auditKeyId:id.audit,auditPrincipalId:id.auditActor
 });
 let primaryCalls=0,auditCalls=0;
 const primaryReader=async rec=>{
  primaryCalls++;
  return {artifact_id:rec.artifact_id,object_ref:rec.object_ref,
   object_version_id:rec.object_version_id,generation:rec.generation,
   sha256:rec.sha256,bytes:Buffer.from(raw[rec.artifact_id]),
   observed_at_ms:119_990,is_current:true,lock_mode:'FIXTURE_IMMUTABLE',
   source_domain:'FIXTURE_PRIMARY_STORE'};
 };
 const auditReader=async rec=>{
  auditCalls++;
  return {artifact_id:rec.artifact_id,object_ref:rec.object_ref,
   object_version_id:rec.object_version_id,generation:rec.generation,
   sha256:rec.sha256,bytes:Buffer.from(raw[rec.artifact_id]),
   observed_at_ms:119_995,is_current:true,lock_mode:'FIXTURE_IMMUTABLE',
   source_domain:'FIXTURE_AUDIT_MIRROR'};
 };
 return {
  envelope,manifest,signManifest,sourceKeys,primaryReader,auditReader,
  options:{envelope,trustedKeys,sourceKeys,sourceProof:signManifest(),
   primaryReader,auditReader,nowMs:120_000,clock:()=>120_000,
   sourceKeyVersion:1,sourceAuthSigner:async()=>('a'.repeat(64))},
  calls:()=>[primaryCalls,auditCalls]
 };
}
const rejects=async(fn,code)=>assert.rejects(fn(),{code});

test('versioned source manifest is independently signed and both stores are read twice before HOLD result',async()=>{
 const x=setup();
 const r=await verifyFixtureExt001SourceVersion(x.options);
 assert.equal(r.decision,'TWO_FIXTURE_SOURCES_RECHECKED_STILL_HOLD');
 assert.deepEqual(x.calls(),[4,4]);
 assert.equal(r.objects_verified,2);
 assert.equal(r.read_rounds,2);
 assert.equal(r.artifactBytes.get('EXT-001-E1').toString(),raw['EXT-001-E1'].toString());
 assert.equal(r.production_source_authenticated,false);
 assert.equal(r.release_authorized,false);
 assert.equal(r.hold_active,true);
 assert.equal(r.release_eligible,false);
 assert.ok(Object.isFrozen(r));
});

test('new current object version, replaced bytes, stale mirror, weak lock and missing files are rejected',async()=>{
 const x=setup();
 const p=x.primaryReader;
 await rejects(()=>verifyFixtureExt001SourceVersion({
  ...x.options,primaryReader:async o=>({...await p(o),object_version_id:'fixture-v2-inventory'})
 }),'V121_IAM_SOURCE_VERSION_OR_FRESHNESS_MISMATCH');
 await rejects(()=>verifyFixtureExt001SourceVersion({
  ...x.options,primaryReader:async o=>({...await p(o),generation:44})
 }),'V121_IAM_SOURCE_VERSION_OR_FRESHNESS_MISMATCH');
 await rejects(()=>verifyFixtureExt001SourceVersion({
  ...x.options,primaryReader:async o=>({...await p(o),bytes:Buffer.from('replaced file')})
 }),'V121_IAM_SOURCE_CONTENT_MISMATCH');
 await rejects(()=>verifyFixtureExt001SourceVersion({
  ...x.options,auditReader:async o=>({...await x.auditReader(o),object_version_id:'fixture-v0-stale'})
 }),'V121_IAM_SOURCE_VERSION_OR_FRESHNESS_MISMATCH');
 await rejects(()=>verifyFixtureExt001SourceVersion({
  ...x.options,primaryReader:async o=>({...await p(o),lock_mode:'UNLOCKED'})
 }),'V121_IAM_SOURCE_VERSION_OR_FRESHNESS_MISMATCH');
 await rejects(()=>verifyFixtureExt001SourceVersion({
  ...x.options,primaryReader:async o=>({...await p(o),is_current:false})
 }),'V121_IAM_SOURCE_VERSION_OR_FRESHNESS_MISMATCH');
 await rejects(()=>verifyFixtureExt001SourceVersion({
  ...x.options,primaryReader:async o=>({...await p(o),observed_at_ms:80_000})
 }),'V121_IAM_SOURCE_VERSION_OR_FRESHNESS_MISMATCH');
 await rejects(()=>verifyFixtureExt001SourceVersion({
  ...x.options,primaryReader:async()=>{throw Error('object deleted');}
 }),'V121_IAM_SOURCE_UNAVAILABLE');
 await rejects(()=>verifyFixtureExt001SourceVersion({
  ...x.options,auditReader:async()=>Promise.reject(Error('mirror offline'))
 }),'V121_IAM_SOURCE_UNAVAILABLE');
 await rejects(()=>verifyFixtureExt001SourceVersion({
  ...x.options,primaryReader:async o=>({...await p(o),bytes:Buffer.alloc(0)})
 }),'V121_IAM_SOURCE_BYTES_INVALID');
});

test('source and audit witnesses cannot impersonate each other or reuse earlier signed review',async()=>{
 const x=setup();
 const mutate=(callback)=>{
  const clone=structuredClone(x.manifest);
  callback(clone);
  return x.signManifest(clone);
 };
 await rejects(()=>verifyFixtureExt001SourceVersion({
  ...x.options,sourceProof:mutate(m=>{m.revision_no=2;})
 }),'V121_IAM_SOURCE_MANIFEST_INVALID');
 await rejects(()=>verifyFixtureExt001SourceVersion({
  ...x.options,sourceProof:mutate(m=>{m.objects[0].sha256='f'.repeat(64);})
 }),'V121_IAM_SOURCE_MANIFEST_INVALID');
 await rejects(()=>verifyFixtureExt001SourceVersion({
  ...x.options,sourceProof:mutate(m=>{m.objects[0].object_ref=m.objects[1].object_ref;})
 }),'V121_IAM_SOURCE_MANIFEST_INVALID');
 // Different E1/E2 object refs cannot alias one pinned version identity.
 // The manifest is signed again, so rejection proves a semantic check,
 // rather than a generic signature mismatch.
 await rejects(()=>verifyFixtureExt001SourceVersion({
  ...x.options,sourceProof:mutate(m=>{
   m.objects[1].object_version_id=m.objects[0].object_version_id;
  })
 }),'V121_IAM_SOURCE_MANIFEST_INVALID');
 const forged=structuredClone(x.options.sourceProof);
 forged.manifest.objects[0].object_version_id='fixture-v9-attacker';
 await rejects(()=>verifyFixtureExt001SourceVersion({...x.options,sourceProof:forged}),
  'V121_IAM_SOURCE_SIGNATURE_INVALID');
 const sameKey=structuredClone(x.options.sourceProof);
 sameKey.audit_witness.key_id=sameKey.primary_witness.key_id;
 await rejects(()=>verifyFixtureExt001SourceVersion({...x.options,sourceProof:sameKey}),
  'V121_IAM_SOURCE_WITNESSES_NOT_INDEPENDENT');
 const staleKeys=new Map(x.sourceKeys);
 staleKeys.set(id.primary,{...staleKeys.get(id.primary),status:'REVOKED'});
 await rejects(()=>verifyFixtureExt001SourceVersion({...x.options,sourceKeys:staleKeys}),
  'V121_IAM_SOURCE_TRUST_INVALID');
 await rejects(()=>verifyFixtureExt001SourceVersion({
  ...x.options,auditReader:x.options.primaryReader
 }),'V121_IAM_SOURCE_READERS_NOT_INDEPENDENT');
 await rejects(()=>verifyFixtureExt001SourceVersion({
  ...x.options,sourceProof:mutate(m=>{m.expires_at_ms=119_999;})
 }),'V121_IAM_SOURCE_MANIFEST_INVALID');
 const newEnvelope=setup(2).envelope;
 await rejects(()=>verifyFixtureExt001SourceVersion({...x.options,envelope:newEnvelope}),
  'V121_IAM_SOURCE_MANIFEST_INVALID');
});

test('remote recheck is mandatory before attestation, with no SQL call on invalid source or audit',async()=>{
 const x=setup();
 let issued=0;
 const receiptId='00000000-0000-4000-8000-0000000000e6';
 const attester={query:async()=>{
  issued++;
  return {rows:[{verdict:'ATTESTED_SOURCE_PROVENANCE_STILL_HOLD'}]};
 }};
 const r=await issueFixtureExt001FromTwoSources({...x.options,receiptId,attester});
 assert.equal(issued,1);
 assert.equal(r.independent_read_rounds,6);
 assert.equal(r.post_signer_source_rechecked,true);
 assert.equal(r.post_attestation_source_rechecked,true);
 assert.equal(r.source_checked_in_fixture,true);
 assert.equal(r.source_version_bound_in_fixture,true);
 assert.match(r.source_binding_digest,/^[a-f0-9]{64}$/);
 assert.deepEqual(x.calls(),[12,12]);
 assert.equal(r.release_authorized,false);
 assert.equal(r.production_evidence_collected,false);
 assert.equal(r.hold_active,true);
 await rejects(()=>issueFixtureExt001FromTwoSources({
  ...x.options,receiptId,attester,
  auditReader:async()=>{throw Error('audit source not reachable');}
 }),'V121_IAM_SOURCE_UNAVAILABLE');
 await rejects(()=>issueFixtureExt001FromTwoSources({
  ...x.options,receiptId,attester,
  primaryReader:async rec=>({...await x.primaryReader(rec),bytes:Buffer.from('wrong bytes')})
 }),'V121_IAM_SOURCE_CONTENT_MISMATCH');
 assert.equal(issued,1,'Failed source verification must not issue DB attestation');
});


test('distinct signed source witnesses cannot alias the same Ed25519 public key',async()=>{
 const x=setup();
 // Two different principals and key IDs sign correctly using one keypair.
 // Their signatures are valid, but the trust boundary is not independent.
 const aliasedKeys=new Map(x.sourceKeys);
 aliasedKeys.set(id.audit,{...aliasedKeys.get(id.audit),publicKey:k.primary.publicKey});
 const aliasedProof=signFixtureExt001SourceManifest(x.manifest,{
  primaryPrivateKey:k.primary.privateKey,auditPrivateKey:k.primary.privateKey,
  primaryKeyId:id.primary,primaryPrincipalId:id.primaryActor,
  auditKeyId:id.audit,auditPrincipalId:id.auditActor
 });
 await rejects(()=>verifyFixtureExt001SourceVersion({
  ...x.options,sourceKeys:aliasedKeys,sourceProof:aliasedProof
 }),'V121_IAM_SOURCE_WITNESSES_NOT_INDEPENDENT');
});

test('revocation during fixture remote reads rejects admission without issuing attestation',async()=>{
 const x=setup();
 let issued=0,reads=0;
 const attester={query:async()=>{
  issued++;
  return {rows:[{verdict:'ATTESTED_SOURCE_PROVENANCE_STILL_HOLD'}]};
 }};
 await rejects(()=>issueFixtureExt001FromTwoSources({
  ...x.options,
  receiptId:'00000000-0000-4000-8000-0000000000e6',
  attester,
  primaryReader:async rec=>{
   reads++;
   const result=await x.primaryReader(rec);
   if(reads===2){
    x.sourceKeys.set(id.primary,{...x.sourceKeys.get(id.primary),status:'REVOKED'});
   }
   return result;
  }
 }),'V121_IAM_SOURCE_TRUST_INVALID');
 assert.equal(issued,0,'source revoked during read cannot issue an attestation');
});

test('revoking source after SQL fixture attestation fails closed without erasing audit history',async()=>{
 const x=setup();
 const receiptId='00000000-0000-4000-8000-0000000000e6';
 let admitted=0,committed=0;
 const attester={query:async()=>{
  admitted++;
  committed++;
  x.sourceKeys.set(id.audit,{...x.sourceKeys.get(id.audit),status:'REVOKED'});
  return {rows:[{verdict:'ATTESTED_SOURCE_PROVENANCE_STILL_HOLD'}]};
 }};
 await rejects(()=>issueFixtureExt001FromTwoSources({
  ...x.options,receiptId,attester
 }),'V121_IAM_SOURCE_TRUST_INVALID');
 assert.equal(admitted,1);
 assert.equal(committed,1,'simulated committed history is retained after post-write rejection');
});

test('substituting pinned bytes after SQL fixture attestation fails closed',async()=>{
 const x=setup();
 const receiptId='00000000-0000-4000-8000-0000000000e6';
 let admitted=0,substitute=false;
 const attester={query:async()=>{
  admitted++;
  substitute=true;
  return {rows:[{verdict:'ATTESTED_SOURCE_PROVENANCE_STILL_HOLD'}]};
 }};
 await rejects(()=>issueFixtureExt001FromTwoSources({
  ...x.options,receiptId,attester,
  primaryReader:async rec=>{
   const r=await x.primaryReader(rec);
   return substitute?{...r,bytes:Buffer.from('replaced after SQL append')}:r;
  }
 }),'V121_IAM_SOURCE_CONTENT_MISMATCH');
 assert.equal(admitted,1);
});

test('SQL attestation must not accept missing clock, expired proof or clock rollback',async()=>{
 const receiptId='00000000-0000-4000-8000-0000000000e6';
 const x=setup();
 let calls=0;
 const attester={query:async()=>{calls++;return {rows:[{verdict:'ATTESTED_SOURCE_PROVENANCE_STILL_HOLD'}]};}};
 await rejects(()=>issueFixtureExt001FromTwoSources({
  ...x.options,clock:undefined,receiptId,attester
 }),'V121_IAM_SOURCE_CLOCK_REQUIRED');
 assert.equal(calls,0);
 const expired=setup();
 let current=120_000;
 await rejects(()=>issueFixtureExt001FromTwoSources({
  ...expired.options,
  clock:()=>current,
  receiptId,
  attester:{query:async()=>{
   calls++;
   current=200_000;
   return {rows:[{verdict:'ATTESTED_SOURCE_PROVENANCE_STILL_HOLD'}]};
  }}
 }),'V121_IAM_EVIDENCE_STALE');
 assert.equal(calls,1,'fixture SQL may have committed before expiry is detected');
 const backwards=setup();
 let at=120_000;
 await rejects(()=>issueFixtureExt001FromTwoSources({
  ...backwards.options,
  clock:()=>at,
  receiptId,
  attester:{query:async()=>{
   calls++;
   at=119_000;
   return {rows:[{verdict:'ATTESTED_SOURCE_PROVENANCE_STILL_HOLD'}]};
  }}
 }),'V121_IAM_SOURCE_CLOCK_ROLLBACK_OR_INVALID');
 assert.equal(calls,2);
});

test('source reading that outlasts the manifest expiry does not reach SQL',async()=>{
 const x=setup();
 let time=120_000;
 let issued=0;
 await rejects(()=>issueFixtureExt001FromTwoSources({
  ...x.options,
  clock:()=>time,
  primaryReader:async rec=>{
   const result=await x.primaryReader(rec);
   time=196_000;
   return {...result,observed_at_ms:196_000};
  },
  auditReader:async rec=>({...await x.auditReader(rec),observed_at_ms:196_000}),
  receiptId:'00000000-0000-4000-8000-0000000000e6',
  attester:{query:async()=>{issued++;return {rows:[{verdict:'ATTESTED_SOURCE_PROVENANCE_STILL_HOLD'}]};}}
 }),'V121_IAM_SOURCE_MANIFEST_INVALID');
 assert.equal(issued,0);
});

test('source-auth signer is mandatory and fails closed before SQL when missing',async()=>{
 const x=setup();
 let sqlCalls=0;
 const receiptId='00000000-0000-4000-8000-0000000000e6';
 const attester={query:async()=>{sqlCalls++;return {rows:[{verdict:'ATTESTED_SOURCE_PROVENANCE_STILL_HOLD'}]};}};
 await rejects(()=>issueFixtureExt001FromTwoSources({
  ...x.options,receiptId,attester,sourceAuthSigner:undefined
 }),'V121_IAM_SOURCE_AUTH_REQUIRED');
 await rejects(()=>issueFixtureExt001FromTwoSources({
  ...x.options,receiptId,attester,sourceAuthSigner:async()=>('not-a-mac')
 }),'V121_IAM_SOURCE_AUTH_INVALID');
 assert.equal(sqlCalls,0);
});

test('signer outage or source revocation during signing stops before SQL attestation',async()=>{
 const receiptId='00000000-0000-4000-8000-0000000000e6';
 const x=setup();
 let issued=0;
 const attester={query:async()=>{
  issued++;
  return {rows:[{verdict:'ATTESTED_SOURCE_PROVENANCE_STILL_HOLD'}]};
 }};
 await rejects(()=>issueFixtureExt001FromTwoSources({
  ...x.options,receiptId,attester,
  sourceAuthSigner:async()=>{throw Error('signer is unavailable');}
 }),'V121_IAM_SOURCE_SIGNER_UNAVAILABLE');
 assert.equal(issued,0,'signer outage must not reach SQL');
 const y=setup();
 await rejects(()=>issueFixtureExt001FromTwoSources({
  ...y.options,receiptId,attester,
  sourceAuthSigner:async()=>{
   y.sourceKeys.set(id.audit,{...y.sourceKeys.get(id.audit),status:'REVOKED'});
   return 'a'.repeat(64);
  }
 }),'V121_IAM_SOURCE_TRUST_INVALID');
 assert.equal(issued,0,'source revoked during signing must not reach SQL');
 const z=setup();
 let swapped=false;
 await rejects(()=>issueFixtureExt001FromTwoSources({
  ...z.options,receiptId,attester,
  sourceAuthSigner:async()=>{swapped=true;return 'a'.repeat(64);},
  auditReader:async rec=>{
   const result=await z.auditReader(rec);
   return swapped?{...result,bytes:Buffer.from('changed after remote signing')}:result;
  }
 }),'V121_IAM_SOURCE_CONTENT_MISMATCH');
 assert.equal(issued,0,'file altered during signing must not reach SQL');
});
