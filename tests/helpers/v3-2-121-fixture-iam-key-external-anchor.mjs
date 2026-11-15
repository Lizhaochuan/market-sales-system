// CI-only independent Ed25519 checkpoint for the PostgreSQL source-key audit chain.
// This module has no database write or release capability. A caller-owned
// checkpoint store and trusted public key must live outside the SQL trust domain.
import {createHash, sign, verify} from 'node:crypto';

const DOMAIN='v121-ext001-source-key-external-anchor-v1';
const EVENT_DOMAIN='v121-ext001-source-key-event-v1';
const HASH=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const ZERO='0'.repeat(64);
const MAX_TTL=60_000;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=code=>{throw Object.assign(new Error(code),{code});};
const safeInt=x=>Number.isSafeInteger(x)&&x>0;
function exactKeys(value,names){
 return value!==null&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).sort().join('|')===names.slice().sort().join('|');
}
function canonicalStatement(statement){
 if(!exactKeys(statement,['schema_version','scope','organization_id',
  'event_count','head_event_digest','previous_anchor_digest','signer_id',
  'issued_at_ms','expires_at_ms'])||
  statement.schema_version!=='v1'||statement.scope!=='CI_FIXTURE_ONLY'||
  !UUID.test(statement.organization_id)||!UUID.test(statement.signer_id)||
  !safeInt(statement.event_count)||!HASH.test(statement.head_event_digest)||
  !HASH.test(statement.previous_anchor_digest)||
  !safeInt(statement.issued_at_ms)||!safeInt(statement.expires_at_ms)||
  statement.expires_at_ms<=statement.issued_at_ms||
  statement.expires_at_ms-statement.issued_at_ms>MAX_TTL)
  fail('V121_KEY_ANCHOR_STATEMENT_INVALID');
 return Buffer.from([
  DOMAIN,statement.schema_version,statement.scope,statement.organization_id,
  statement.event_count,statement.head_event_digest,
  statement.previous_anchor_digest,statement.signer_id,
  statement.issued_at_ms,statement.expires_at_ms
 ].join('|'),'utf8');
}
function encodedProof(anchor){
 if(!exactKeys(anchor,['statement','signature_b64']))
  fail('V121_KEY_ANCHOR_INVALID');
 const message=canonicalStatement(anchor.statement);
 const sig=anchor.signature_b64;
 if(typeof sig!=='string'||!/^[A-Za-z0-9+/]{86}==$/.test(sig))
  fail('V121_KEY_ANCHOR_SIGNATURE_INVALID');
 const bytes=Buffer.from(sig,'base64');
 if(bytes.length!==64||bytes.toString('base64')!==sig)
  fail('V121_KEY_ANCHOR_SIGNATURE_INVALID');
 return {message,bytes};
}
export function fingerprintFixtureIamKeyAnchor(anchor){
 const {message,bytes}=encodedProof(anchor);
 return sha(Buffer.concat([Buffer.from('v121-ext001-anchor-fingerprint-v1|'),message,
  Buffer.from('|'),bytes]));
}
export function rebuildFixtureIamKeyEvents(rows,organizationId){
 if(!UUID.test(organizationId)||!Array.isArray(rows)||rows.length<1)
  fail('V121_KEY_ANCHOR_HISTORY_INVALID');
 let prior=ZERO,lastKeyVersion=0,active=null;
 const states=new Map();
 for(let i=0;i<rows.length;i++){
  const r=rows[i];
  if(!exactKeys(r,['organization_id','event_index','key_version',
   'event_type','key_digest','previous_event_digest','event_digest','recorded_at'])||
   r.organization_id!==organizationId||r.event_index!==i+1||
   !safeInt(r.key_version)||!['ACTIVATED','REVOKED'].includes(r.event_type)||
   !HASH.test(r.key_digest)||!HASH.test(r.previous_event_digest)||
   !HASH.test(r.event_digest)||r.previous_event_digest!==prior||
   !(r.recorded_at instanceof Date)||!Number.isSafeInteger(r.recorded_at.getTime()))
   fail('V121_KEY_ANCHOR_HISTORY_INVALID');
  if(r.event_type==='ACTIVATED'){
   if(r.key_version<=lastKeyVersion||active!==null)
    fail('V121_KEY_ANCHOR_LIFECYCLE_INVALID');
   states.set(r.key_version,{fingerprint:r.key_digest,status:'ACTIVE'});
   active=r.key_version;
   lastKeyVersion=r.key_version;
  }else{
   const previous=states.get(r.key_version);
   if(active!==r.key_version||!previous||previous.fingerprint!==r.key_digest)
    fail('V121_KEY_ANCHOR_LIFECYCLE_INVALID');
   previous.status='REVOKED';active=null;
  }
  const calculated=sha(Buffer.from([
   EVENT_DOMAIN,organizationId,r.event_index,r.key_version,r.event_type,
   r.key_digest,prior,r.recorded_at.getTime()
  ].join('|'),'utf8'));
  if(calculated!==r.event_digest)
   fail('V121_KEY_ANCHOR_HISTORY_DIGEST_MISMATCH');
  prior=r.event_digest;
 }
 return Object.freeze({organization_id:organizationId,event_count:rows.length,
  head_event_digest:prior,active_key_version:active,
  hold_active:true,release_eligible:false});
}
export function signFixtureIamKeyExternalAnchor({
 rows,organizationId,signerId,privateKey,issuedAtMs,previousAnchor=null
}){
 if(!UUID.test(signerId)||!safeInt(issuedAtMs)||!privateKey)
  fail('V121_KEY_ANCHOR_INPUT_INVALID');
 const current=rebuildFixtureIamKeyEvents(rows,organizationId);
 if(previousAnchor&&(
   previousAnchor.statement?.organization_id!==organizationId||
   previousAnchor.statement?.event_count>=current.event_count))
  fail('V121_KEY_ANCHOR_ROLLBACK');
 const statement={
  schema_version:'v1',scope:'CI_FIXTURE_ONLY',organization_id:organizationId,
  event_count:current.event_count,head_event_digest:current.head_event_digest,
  previous_anchor_digest:previousAnchor?fingerprintFixtureIamKeyAnchor(previousAnchor):ZERO,
  signer_id:signerId,issued_at_ms:issuedAtMs,expires_at_ms:issuedAtMs+MAX_TTL
 };
 const message=canonicalStatement(statement);
 return Object.freeze({statement:Object.freeze(statement),
  signature_b64:sign(null,message,privateKey).toString('base64')});
}
export function verifyFixtureIamKeyExternalAnchor({
 rows,anchor,organizationId,publicKeys,keyStates,nowMs,
 previousAnchor=null,minimumEventCount=1
}){
 const {message,bytes}=encodedProof(anchor);
 const s=anchor.statement;
 if(!(publicKeys instanceof Map)||!publicKeys.has(s.signer_id)||
  !(keyStates instanceof Map)||keyStates.get(s.signer_id)!=='ACTIVE')
  fail('V121_KEY_ANCHOR_SIGNER_UNTRUSTED');
 let valid=false;
 try{valid=verify(null,message,publicKeys.get(s.signer_id),bytes);}
 catch{valid=false;}
 if(!valid)fail('V121_KEY_ANCHOR_SIGNATURE_INVALID');
 if(!safeInt(nowMs)||nowMs<s.issued_at_ms||nowMs>=s.expires_at_ms)
  fail('V121_KEY_ANCHOR_EXPIRED');
 if(s.organization_id!==organizationId)
  fail('V121_KEY_ANCHOR_SCOPE_INVALID');
 if(!safeInt(minimumEventCount)||s.event_count<minimumEventCount)
  fail('V121_KEY_ANCHOR_ROLLBACK');
 const expected=previousAnchor?fingerprintFixtureIamKeyAnchor(previousAnchor):ZERO;
 if(s.previous_anchor_digest!==expected||
   (previousAnchor&&previousAnchor.statement.event_count>=s.event_count))
  fail('V121_KEY_ANCHOR_PREVIOUS_MISMATCH');
 const current=rebuildFixtureIamKeyEvents(rows,organizationId);
 if(current.event_count!==s.event_count||
   current.head_event_digest!==s.head_event_digest)
  fail('V121_KEY_ANCHOR_CONTENT_MISMATCH');
 return Object.freeze({verdict:'EXTERNAL_FIXTURE_KEY_AUDIT_MATCH_STILL_HOLD',
  checkpoint_digest:fingerprintFixtureIamKeyAnchor(anchor),
  event_count:current.event_count,hold_active:true,release_eligible:false,
  production_evidence_collected:false,release_authorized:false});
}
