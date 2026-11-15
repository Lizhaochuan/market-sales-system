// V3.2-121 fixture-only recovery approval verifier. No real approval or external archive.
import {createHash,verify} from 'node:crypto';
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const HEX=/^[a-f0-9]{64}$/;
const exact=(o,k)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===k.length&&k.every(x=>Object.hasOwn(o,x));
const error=code=>{const e=new Error(code);e.code=code;throw e;};
const REQUEST=['organization_id','incident_id','request_id','key_version','audit_digest','issued_at_ms','expires_at_ms'];
const APPROVAL=['approver_id','role','request_digest','signature_b64'];
const ROLES=['AUDIT_REVIEW','SECURITY_REVIEW'];
export function encodeFixtureRecoveryRequest(request){
 if(!exact(request,REQUEST)||!['organization_id','incident_id','request_id'].every(k=>typeof request[k]==='string'&&UUID.test(request[k]))||
 !Number.isSafeInteger(request.key_version)||request.key_version<2||
 typeof request.audit_digest!=='string'||!HEX.test(request.audit_digest)||
 !Number.isSafeInteger(request.issued_at_ms)||request.issued_at_ms<1||
 !Number.isSafeInteger(request.expires_at_ms)||request.expires_at_ms<=request.issued_at_ms||
 request.expires_at_ms-request.issued_at_ms>30000)error('RECOVERY_REQUEST_INVALID');
 return Buffer.from(JSON.stringify(['v121-fixture-recovery-v1',...REQUEST.map(k=>request[k])]));
}
export function encodeFixtureRecoveryApproval({request_digest,approver_id,role}){
 if(typeof request_digest!=='string'||!HEX.test(request_digest)||!UUID.test(approver_id||'')||!ROLES.includes(role))error('RECOVERY_APPROVAL_INVALID');
 return Buffer.from(JSON.stringify(['v121-fixture-approval-v1',request_digest,approver_id,role]));
}
export function createFixtureRecoveryGate({approverKeys,clock,readAudit,readAnchor}={}){
 if(!approverKeys||typeof clock!=='function'||typeof readAudit!=='function'||typeof readAnchor!=='function')
  throw TypeError('RECOVERY_TRUST_FIXTURE_REQUIRED');
 const used=new Set(); // Process-only: cannot replace durable workflow replay protection.
 async function verifyRecovery({request,approvals}={}){
  const requestBytes=encodeFixtureRecoveryRequest(request);
  const requestDigest=createHash('sha256').update(requestBytes).digest('hex');
  const now=clock();
  if(!Number.isSafeInteger(now)||now<request.issued_at_ms||now>=request.expires_at_ms)
   error('RECOVERY_EXPIRED');
  if(!Array.isArray(approvals)||approvals.length!==2||
    !approvals.every(x=>exact(x,APPROVAL))||
    new Set(approvals.map(x=>x.approver_id)).size!==2||
    new Set(approvals.map(x=>x.role)).size!==2||
    !ROLES.every(role=>approvals.some(a=>a.role===role)))
   error('RECOVERY_TWO_PERSON_REQUIRED');
  for(const approval of approvals){
   const identity=approverKeys[approval.role];
   if(!identity||identity.approver_id!==approval.approver_id||!identity.publicKey||
     approval.request_digest!==requestDigest||
     typeof approval.signature_b64!=='string'||!/^[A-Za-z0-9+/]{86}==$/.test(approval.signature_b64))
    error('RECOVERY_SIGNATURE_INVALID');
   let valid=false;
   try{valid=verify(null,encodeFixtureRecoveryApproval(approval),identity.publicKey,Buffer.from(approval.signature_b64,'base64'));}catch{}
   if(!valid)error('RECOVERY_SIGNATURE_INVALID');
  }
  const audit=await readAudit(request);
  if(!exact(audit,['organization_id','key_version','event_kind','event_digest'])||
    audit.organization_id!==request.organization_id||audit.key_version!==request.key_version||
    audit.event_kind!=='KEY_ISSUED'||audit.event_digest!==request.audit_digest)
   error('RECOVERY_AUDIT_MISMATCH');
  const anchor=await readAnchor({request_digest:requestDigest,audit_digest:request.audit_digest,organization_id:request.organization_id});
  if(!exact(anchor,['request_digest','audit_digest','anchored','source'])||
    anchor.request_digest!==requestDigest||anchor.audit_digest!==request.audit_digest||
    anchor.anchored!==true||anchor.source!=='FIXTURE_SEPARATE_ARCHIVE')
   error('RECOVERY_ANCHOR_UNVERIFIED');
  if(used.has(requestDigest))error('RECOVERY_REPLAY');
  used.add(requestDigest);
  return Object.freeze({fixture_recovery_verified:true,recovery_request_digest:requestDigest,
    external_anchor_verified:false,real_person_approval:false,hold_active:true,
    release_eligible:false,merge_authorized:false,deploy_authorized:false});
 }
 return Object.freeze({verifyRecovery});
}
