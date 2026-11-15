// V3.2-121 disposable proof verifier. Not a production IAM or organizational signature.
import {verify} from 'node:crypto';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const FIELDS=['organization_id','incident_id','notice_id','receipt_sequence','receipt_state','signer_id','authority_epoch','revocation_watermark','issued_at_ms','expires_at_ms'];
const fail=code=>{const e=new Error(code);e.code=code;throw e;};
const exact=(x,keys)=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
export function encodeFixtureReceiptProof(statement){
 if(!exact(statement,FIELDS)||!UUID.test(statement.organization_id)||
  !UUID.test(statement.incident_id)||!UUID.test(statement.signer_id)||
  !SHA.test(statement.notice_id)||
  !Number.isSafeInteger(statement.receipt_sequence)||statement.receipt_sequence<1||
  statement.receipt_sequence>128||
  !['NEGATIVE_RECEIPT','COPY_NOT_RETRACTABLE'].includes(statement.receipt_state)||
  !Number.isSafeInteger(statement.authority_epoch)||statement.authority_epoch<1||
  !Number.isSafeInteger(statement.revocation_watermark)||statement.revocation_watermark<0||
  !Number.isSafeInteger(statement.issued_at_ms)||statement.issued_at_ms<1||
  !Number.isSafeInteger(statement.expires_at_ms)||statement.expires_at_ms<=statement.issued_at_ms)
  fail('FIXTURE_RECEIPT_PROOF_INVALID');
 return Buffer.from(JSON.stringify(['v3.2-121-fixture-negative-receipt',...FIELDS.map(k=>statement[k])]));
}
export async function verifyFixtureNegativeReceiptProof({statement,signature_b64,publicKey,clock,authority}={}){
 const encoded=encodeFixtureReceiptProof(statement);
 if(typeof signature_b64!=='string'||!/^[A-Za-z0-9+/]{86}==$/.test(signature_b64)||
    typeof clock!=='function'||typeof authority!=='function'||!publicKey)
  fail('FIXTURE_RECEIPT_PROOF_UNTRUSTED');
 const now=clock();
 if(!Number.isSafeInteger(now)||now<statement.issued_at_ms||now>=statement.expires_at_ms)
  fail('FIXTURE_RECEIPT_PROOF_EXPIRED');
 let ok=false;
 try{ok=verify(null,encoded,publicKey,Buffer.from(signature_b64,'base64'));}
 catch{fail('FIXTURE_RECEIPT_SIGNATURE_INVALID');}
 if(!ok)fail('FIXTURE_RECEIPT_SIGNATURE_INVALID');
 const state=await authority({organization_id:statement.organization_id,
  incident_id:statement.incident_id,signer_id:statement.signer_id});
 if(!exact(state,['authority_epoch','revocation_watermark','active'])||
  state.active!==true||state.authority_epoch!==statement.authority_epoch||
  state.revocation_watermark!==statement.revocation_watermark)
  fail('FIXTURE_RECEIPT_AUTHORITY_STALE');
 return Object.freeze({fixture_signature_valid:true,hold_active:true,
  external_authority_verified:false,external_recipient_verified:false,
  release_eligible:false});
}
