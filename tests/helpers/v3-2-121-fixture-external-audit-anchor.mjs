// V3.2-121 CI-only independent Ed25519 audit proof: no production authority or storage.
import {sign, verify, randomUUID, createHash} from 'node:crypto';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST=/^[0-9a-f]{64}$/;
const DOMAIN='v121-external-audit-anchor-v1';
const MAX_TTL_MS=30_000;
const fail=code=>{throw Object.assign(new Error(code),{code});};

function validate(statement){
 if(!statement || typeof statement!=='object' || Array.isArray(statement) ||
    Object.keys(statement).sort().join(',') !== [
     'accepted_review_roles','event_id','expires_at_ms','failure_id','incident_id',
     'issued_at_ms','observed_digest','organization_id','remediation_version',
     'signer_id','snapshot_sequence'].sort().join(','))
  fail('V121_ANCHOR_ENVELOPE_INVALID');
 if(!['organization_id','failure_id','incident_id','event_id','signer_id']
  .every(field=>typeof statement[field]==='string' && UUID.test(statement[field])) ||
  typeof statement.observed_digest!=='string' ||
  !DIGEST.test(statement.observed_digest) ||
  !['snapshot_sequence','remediation_version','accepted_review_roles',
     'issued_at_ms','expires_at_ms']
    .every(field=>Number.isSafeInteger(statement[field])) ||
  statement.snapshot_sequence<1 || statement.remediation_version<1 ||
  statement.accepted_review_roles<0 || statement.accepted_review_roles>2 ||
  statement.issued_at_ms<1 || statement.expires_at_ms<=statement.issued_at_ms ||
  statement.expires_at_ms-statement.issued_at_ms>MAX_TTL_MS)
  fail('V121_ANCHOR_ENVELOPE_INVALID');
}

export function encodeFixtureAuditAnchor(statement){
 validate(statement);
 return Buffer.from([
  DOMAIN,statement.organization_id,statement.failure_id,statement.incident_id,
  statement.event_id,statement.snapshot_sequence,statement.remediation_version,
  statement.accepted_review_roles,statement.observed_digest,statement.signer_id,
  statement.issued_at_ms,statement.expires_at_ms
 ].join('|'),'utf8');
}

export function signFixtureAuditAnchor(statement,privateKey){
 return {statement,signature_b64:sign(null,encodeFixtureAuditAnchor(statement),privateKey).toString('base64')};
}

// publicKeys is a trusted, caller-owned Map keyed by signer UUID, never keyed from the artifact itself.
export function verifyFixtureAuditAnchor({anchor,publicKeys,current,nowMs,minimumSequence=1}){
 const statement=anchor?.statement;
 const encoded=encodeFixtureAuditAnchor(statement);
 if(!(publicKeys instanceof Map) || !publicKeys.has(statement.signer_id))
  fail('V121_ANCHOR_SIGNER_UNTRUSTED');
 if(typeof anchor.signature_b64!=='string' || !/^[A-Za-z0-9+/]{86}==$/.test(anchor.signature_b64))
  fail('V121_ANCHOR_SIGNATURE_INVALID');
 const signature=Buffer.from(anchor.signature_b64,'base64');
 if(signature.length!==64 || signature.toString('base64')!==anchor.signature_b64 ||
    !verify(null,encoded,publicKeys.get(statement.signer_id),signature))
  fail('V121_ANCHOR_SIGNATURE_INVALID');
 if(!Number.isSafeInteger(nowMs) || nowMs<statement.issued_at_ms ||
    nowMs>=statement.expires_at_ms)
  fail('V121_ANCHOR_EXPIRED');
 if(!Number.isSafeInteger(minimumSequence) || minimumSequence<1 ||
    statement.snapshot_sequence<minimumSequence ||
    current?.snapshot_sequence<minimumSequence)
  fail('V121_ANCHOR_ROLLBACK_DETECTED');
 if(current?.rebuild_status!=='REBUILT_STILL_HOLD' ||
    current?.verdict!=='SNAPSHOT_MATCH_STILL_HOLD' ||
    current?.snapshot_matches!==true ||
    current?.hold_active!==true || current?.release_eligible!==false)
  fail('V121_ANCHOR_REBUILD_NOT_SAFE');
 if(statement.organization_id!==current.organization_id ||
    statement.failure_id!==current.failure_id ||
    statement.incident_id!==current.incident_id ||
    statement.event_id!==current.event_id)
  fail('V121_ANCHOR_SCOPE_MISMATCH');
 if(statement.snapshot_sequence!==current.snapshot_sequence ||
    statement.remediation_version!==current.remediation_version ||
    statement.accepted_review_roles!==current.accepted_review_roles ||
    statement.observed_digest!==current.observed_digest)
  fail('V121_ANCHOR_CONTENT_MISMATCH');
 return Object.freeze({status:'ANCHOR_MATCH_STILL_HOLD',
  hold_active:true,release_eligible:false,checkpoint_sequence:statement.snapshot_sequence});
}


// Extra policy gate for a persisted, append-only lifecycle registry.
// Cryptographic validity is distinct from present-day authorization.
export function verifyFixtureActiveAuditAnchor(args){
 const signer=args.anchor?.statement?.signer_id;
 const state=args.keyStates instanceof Map?args.keyStates.get(signer):null;
 if(state==='REVOKED') fail('V121_ANCHOR_KEY_REVOKED');
 if(state==='RETIRED') fail('V121_ANCHOR_KEY_RETIRED');
 if(state!=='REGISTERED') fail('V121_ANCHOR_SIGNER_UNTRUSTED');
 return verifyFixtureAuditAnchor(args);
}

// Historical signed evidence remains inspectable after a key is retired or revoked.
// No current-time trust or release decision is returned from this forensic path.
export function inspectFixtureArchivedAuditAnchor({anchor,publicKeys,keyStates}){
 const statement=anchor?.statement;
 const bytes=encodeFixtureAuditAnchor(statement);
 const key=publicKeys instanceof Map?publicKeys.get(statement.signer_id):null;
 if(!key) fail('V121_ANCHOR_SIGNER_UNTRUSTED');
 const signature=anchor?.signature_b64;
 if(typeof signature!=='string' || !/^[A-Za-z0-9+/]{86}==$/.test(signature))
  fail('V121_ANCHOR_SIGNATURE_INVALID');
 const sig=Buffer.from(signature,'base64');
 if(sig.length!==64 || sig.toString('base64')!==signature ||
    !verify(null,bytes,key,sig))
  fail('V121_ANCHOR_SIGNATURE_INVALID');
 const state=keyStates instanceof Map?keyStates.get(statement.signer_id):null;
 if(!['REGISTERED','RETIRED','REVOKED'].includes(state))
  fail('V121_ANCHOR_SIGNER_UNTRUSTED');
 return Object.freeze({
  status:state==='REVOKED'?'REVOKED_HISTORICAL_ONLY':
   state==='RETIRED'?'RETIRED_HISTORICAL_ONLY':'SIGNED_HISTORY_ONLY',
  cryptographically_valid:true,hold_active:true,release_eligible:false
 });
}


// Only the separately credentialed fixture attester can insert this immutable
// database ticket. The writer connection never receives attester credentials.
// Actual Ed25519 verification precedes the SQL request; PostgreSQL only binds
// the trusted attester's decision to the exact statement and signature.
export async function issueFixtureVerifiedAnchorTicket({
 anchor,publicKeys,keyStates,current,nowMs,minimumSequence,attester
}){
 verifyFixtureActiveAuditAnchor({anchor,publicKeys,keyStates,current,nowMs,minimumSequence});
 if(!attester || typeof attester.query!=='function')
  fail('V121_ANCHOR_ATTESTER_UNAVAILABLE');
 const ticket=randomUUID();
 const s=anchor.statement;
 await attester.query(
  'SELECT v121_anchor.attest_verified_checkpoint($1::uuid,$2::uuid,$3::uuid,$4::integer,$5::uuid,$6::jsonb,$7::text,$8::char(64))',
  [ticket,s.organization_id,s.failure_id,s.snapshot_sequence,s.signer_id,
   s,anchor.signature_b64,s.observed_digest]
 );
 return ticket;
}


// Read-only out-of-band CI monitor. Its signal is NOT proof of external IAM,
// and it never grants an authorization or writes to the attester database.
export function inspectFixtureStoredAdmission({admission,publicKeys,keyStates}){
 const proof={statement:admission?.signed_statement,signature_b64:admission?.signature_b64};
 const raw=JSON.stringify([
  admission?.organization_id,admission?.failure_id,admission?.snapshot_sequence,
  admission?.signer_id,admission?.observed_digest,proof.statement,proof.signature_b64
 ]);
 const digest=createHash('sha256').update(raw).digest('hex');
 const mismatched=!proof.statement ||
  admission.organization_id!==proof.statement.organization_id ||
  admission.failure_id!==proof.statement.failure_id ||
  admission.snapshot_sequence!==proof.statement.snapshot_sequence ||
  admission.signer_id!==proof.statement.signer_id ||
  admission.observed_digest!==proof.statement.observed_digest;
 if(mismatched){
  return Object.freeze({anomaly:'UNEXPECTED_ATTESTATION',
   evidence_digest:digest,hold_active:true,release_eligible:false});
 }
 try{
  inspectFixtureArchivedAuditAnchor({anchor:proof,publicKeys,keyStates});
  return Object.freeze({anomaly:null,evidence_digest:digest,
   hold_active:true,release_eligible:false});
 }catch(error){
  return Object.freeze({anomaly:
   error?.code==='V121_ANCHOR_SIGNATURE_INVALID'?'ATTESTER_SIGNATURE_INVALID':
   'UNEXPECTED_ATTESTATION',evidence_digest:digest,
   hold_active:true,release_eligible:false});
 }
}
