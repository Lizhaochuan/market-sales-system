// V3.2-121: CI-only lease-and-watermark gate. Not external IAM authority.
import {createHash, verify} from 'node:crypto';
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const HEX=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const FIELDS=['organization_id','incident_id','signer_id','notice_id','authority_epoch','revocation_watermark','lease_sequence','issued_at_ms','expires_at_ms'];
const exact=(x,fields)=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===fields.length&&fields.every(k=>Object.hasOwn(x,k));
const fail=code=>{const e=new Error(code);e.code=code;throw e;};
export function encodeFixtureLease(lease){
 if(!exact(lease,FIELDS)||!['organization_id','incident_id','signer_id'].every(k=>typeof lease[k]==='string'&&UUID.test(lease[k]))||
  typeof lease.notice_id!=='string'||!HEX.test(lease.notice_id)||
  !['authority_epoch','lease_sequence'].every(k=>Number.isSafeInteger(lease[k])&&lease[k]>=1)||
  !Number.isSafeInteger(lease.revocation_watermark)||lease.revocation_watermark<0||
  !Number.isSafeInteger(lease.issued_at_ms)||lease.issued_at_ms<1||
  !Number.isSafeInteger(lease.expires_at_ms)||lease.expires_at_ms<=lease.issued_at_ms||
  lease.expires_at_ms-lease.issued_at_ms>30000)fail('LEASE_FORMAT_INVALID');
 return Buffer.from(JSON.stringify(['v121-isolated-lease-v1',...FIELDS.map(k=>lease[k])]));
}
export function createFixtureLeaseGate({publicKey,clock,loadAuthority}={}){
 if(!publicKey||typeof clock!=='function'||typeof loadAuthority!=='function')throw TypeError('trusted fixture verifier required');
 const watermarks=new Map();
 async function verifyLease({lease,signature_b64,scope}={}){
  const payload=encodeFixtureLease(lease);
  if(!scope||Object.keys(scope).sort().join('|')!=='incident_id|notice_id|organization_id|signer_id'||
   ['organization_id','incident_id','signer_id','notice_id'].some(k=>lease[k]!==scope[k]))
   fail('LEASE_SCOPE_MISMATCH');
  if(typeof signature_b64!=='string'||!/^[A-Za-z0-9+/]{86}==$/.test(signature_b64))
   fail('LEASE_SIGNATURE_INVALID');
  let valid=false;
  try{valid=verify(null,payload,publicKey,Buffer.from(signature_b64,'base64'));}catch{}
  if(!valid)fail('LEASE_SIGNATURE_INVALID');
  const now=clock();
  if(!Number.isSafeInteger(now)||now<lease.issued_at_ms||now>=lease.expires_at_ms)
   fail('LEASE_EXPIRED');
  const current=await loadAuthority(scope);
  if(!exact(current,['active','authority_epoch','revocation_watermark','lease_sequence'])||
    current.active!==true||
    current.authority_epoch!==lease.authority_epoch||
    current.revocation_watermark!==lease.revocation_watermark||
    current.lease_sequence!==lease.lease_sequence)fail('LEASE_AUTHORITY_CHANGED');
  const key=scope.organization_id+'|'+scope.incident_id+'|'+scope.signer_id;
  const prior=watermarks.get(key);
  if(prior&&(lease.authority_epoch<prior.authority_epoch||
    lease.revocation_watermark<prior.revocation_watermark||
    (lease.authority_epoch===prior.authority_epoch&&lease.lease_sequence<prior.lease_sequence)))
   fail('LEASE_WATERMARK_REGRESSION');
  watermarks.set(key,{authority_epoch:lease.authority_epoch,revocation_watermark:lease.revocation_watermark,lease_sequence:lease.lease_sequence});
  return Object.freeze({fixture_lease_valid:true,lease_digest:sha(lease),hold_active:true,
   external_authority_verified:false,release_eligible:false,merge_authorized:false,deploy_authorized:false});
 }
 return Object.freeze({verifyLease});
}
