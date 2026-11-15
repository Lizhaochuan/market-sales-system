import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {encodeFixtureReceiptProof,verifyFixtureNegativeReceiptProof} from '../../src/cross-module-fixture-receipt-proof.mjs';
const uid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const {publicKey,privateKey}=generateKeyPairSync('ed25519');
const {publicKey:other}=generateKeyPairSync('ed25519');
const statement={organization_id:uid(1),incident_id:uid(2),notice_id:'a'.repeat(64),
 receipt_sequence:1,receipt_state:'NEGATIVE_RECEIPT',signer_id:uid(3),
 authority_epoch:4,revocation_watermark:2,issued_at_ms:100,expires_at_ms:200};
const signature=sign(null,encodeFixtureReceiptProof(statement),privateKey).toString('base64');
const authority=async()=>({authority_epoch:4,revocation_watermark:2,active:true});
const attempt=(changes={},extras={})=>verifyFixtureNegativeReceiptProof({
 statement:{...statement,...changes},signature_b64:signature,publicKey,clock:()=>150,authority,...extras});
test('valid temporary signature remains HOLD and unauthorised',async()=>{
 const result=await attempt();
 assert.equal(result.fixture_signature_valid,true);
 assert.equal(result.hold_active,true);
 assert.equal(result.release_eligible,false);
 assert.equal(result.external_authority_verified,false);
});
test('payload / tenant / notice / signer tampering rejected',async()=>{
 for(const changes of [{receipt_state:'COPY_NOT_RETRACTABLE'},{incident_id:uid(9)},
 {notice_id:'b'.repeat(64)},{signer_id:uid(8)},{receipt_sequence:2}]){
  await assert.rejects(attempt(changes),{code:'FIXTURE_RECEIPT_SIGNATURE_INVALID'});
 }
});
test('independent key cannot be substituted',async()=>{
 await assert.rejects(attempt({}, {publicKey:other}),{code:'FIXTURE_RECEIPT_SIGNATURE_INVALID'});
});
test('signature expires at end boundary and before issue time',async()=>{
 await assert.rejects(attempt({}, {clock:()=>200}),{code:'FIXTURE_RECEIPT_PROOF_EXPIRED'});
 await assert.rejects(attempt({}, {clock:()=>99}),{code:'FIXTURE_RECEIPT_PROOF_EXPIRED'});
});
test('revoked signers and changed epoch or watermark rejected',async()=>{
 for(const snapshot of [{authority_epoch:4,revocation_watermark:2,active:false},
 {authority_epoch:5,revocation_watermark:2,active:true},
 {authority_epoch:4,revocation_watermark:3,active:true}]){
  await assert.rejects(attempt({}, {authority:async()=>snapshot}),{code:'FIXTURE_RECEIPT_AUTHORITY_STALE'});
 }
});
test('missing trusted authority or malformed signature rejected',async()=>{
 await assert.rejects(attempt({}, {authority:null}),{code:'FIXTURE_RECEIPT_PROOF_UNTRUSTED'});
 await assert.rejects(attempt({}, {signature_b64:'not a signature'}),{code:'FIXTURE_RECEIPT_PROOF_UNTRUSTED'});
});
test('reject caller-injected approval flags and positive receipt',()=>{
 assert.throws(()=>encodeFixtureReceiptProof({...statement,finance_authorized:true}),{code:'FIXTURE_RECEIPT_PROOF_INVALID'});
 assert.throws(()=>encodeFixtureReceiptProof({...statement,receipt_state:'FIXTURE_ACKNOWLEDGED'}),{code:'FIXTURE_RECEIPT_PROOF_INVALID'});
});
test('authority outage is not treated as approval',async()=>{
 await assert.rejects(attempt({}, {authority:async()=>{throw Error('offline');}}),/offline/);
});
