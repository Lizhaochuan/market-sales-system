import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {encodeFixtureLease,createFixtureLeaseGate} from '../../src/cross-module-fixture-authority-lease.mjs';
const uid=x=>'00000000-0000-4000-8000-'+String(x).padStart(12,'0');
const keys=generateKeyPairSync('ed25519');
const lease={organization_id:uid(1),incident_id:uid(2),signer_id:uid(3),notice_id:'a'.repeat(64),
 authority_epoch:2,revocation_watermark:5,lease_sequence:7,issued_at_ms:100,expires_at_ms:200};
const scope=Object.fromEntries(['organization_id','incident_id','signer_id','notice_id'].map(k=>[k,lease[k]]));
const signed=l=>sign(null,encodeFixtureLease(l),keys.privateKey).toString('base64');
const state=l=>({active:true,authority_epoch:l.authority_epoch,revocation_watermark:l.revocation_watermark,lease_sequence:l.lease_sequence});
function gate(opts={}){return createFixtureLeaseGate({publicKey:keys.publicKey,clock:()=>150,loadAuthority:async()=>state(lease),...opts});}
test('valid isolated lease remains HOLD',async()=>{
 const r=await gate().verifyLease({lease,signature_b64:signed(lease),scope});
 assert.equal(r.fixture_lease_valid,true);assert.equal(r.hold_active,true);assert.equal(r.release_eligible,false);
});
test('wrong scope or tampered signed lease denied',async()=>{
 const g=gate();
 await assert.rejects(g.verifyLease({lease:{...lease,notice_id:'b'.repeat(64)},signature_b64:signed(lease),scope}),{code:'LEASE_SCOPE_MISMATCH'});
 await assert.rejects(g.verifyLease({lease:{...lease,lease_sequence:8},signature_b64:signed(lease),scope}),{code:'LEASE_SIGNATURE_INVALID'});
});
test('expired and not yet valid lease denied',async()=>{
 for(const t of [99,200]){
  await assert.rejects(gate({clock:()=>t}).verifyLease({lease,signature_b64:signed(lease),scope}),{code:'LEASE_EXPIRED'});
 }
});
test('authority change, revocation and outage fail closed',async()=>{
 const signedLease={lease,signature_b64:signed(lease),scope};
 for(const s of [{...state(lease),active:false},{...state(lease),revocation_watermark:6},{...state(lease),authority_epoch:3}]){
  await assert.rejects(gate({loadAuthority:async()=>s}).verifyLease(signedLease),{code:'LEASE_AUTHORITY_CHANGED'});
 }
 await assert.rejects(gate({loadAuthority:async()=>{throw Error('offline');}}).verifyLease(signedLease),/offline/);
});
test('lease duration cannot exceed 30 seconds or be injected with release flag',()=>{
 assert.throws(()=>encodeFixtureLease({...lease,expires_at_ms:40000}),{code:'LEASE_FORMAT_INVALID'});
 assert.throws(()=>encodeFixtureLease({...lease,finance_authorized:true}),{code:'LEASE_FORMAT_INVALID'});
});
test('monotone watermark forbids rollback even after live source reverts',async()=>{
 let current=state(lease);
 const g=gate({loadAuthority:async()=>current});
 await g.verifyLease({lease,signature_b64:signed(lease),scope});
 const newer={...lease,lease_sequence:8,revocation_watermark:6};
 current=state(newer);
 await g.verifyLease({lease:newer,signature_b64:signed(newer),scope});
 current=state(lease);
 await assert.rejects(g.verifyLease({lease,signature_b64:signed(lease),scope}),{code:'LEASE_WATERMARK_REGRESSION'});
});
test('no authority identity or signature cannot be accepted',async()=>{
 await assert.rejects(gate().verifyLease({lease,scope}),{code:'LEASE_SIGNATURE_INVALID'});
 await assert.rejects(gate().verifyLease({lease,signature_b64:signed(lease),scope:{...scope,organization_id:uid(9)}}),{code:'LEASE_SCOPE_MISMATCH'});
});
