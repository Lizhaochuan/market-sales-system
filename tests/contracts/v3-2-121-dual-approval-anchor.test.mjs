import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {createFixtureRecoveryGate,encodeFixtureRecoveryRequest,encodeFixtureRecoveryApproval} from '../../src/cross-module-fixture-dual-approval-anchor.mjs';
const ids={
 AUDIT_REVIEW:'00000000-0000-4000-8000-0000000000a1',
 SECURITY_REVIEW:'00000000-0000-4000-8000-0000000000b2'
};
const keys=Object.fromEntries(Object.keys(ids).map(role=>[role,generateKeyPairSync('ed25519')]));
const request={organization_id:'11111111-1111-4111-8111-111111111111',
 incident_id:'00000000-0000-4000-8000-000000000002',
 request_id:'00000000-0000-4000-8000-0000000000c3',key_version:4,
 audit_digest:'a'.repeat(64),issued_at_ms:100,expires_at_ms:200};
const digest=r=>createHash('sha256').update(encodeFixtureRecoveryRequest(r)).digest('hex');
const approvals=(r=request)=>{
 const rd=digest(r);
 return Object.keys(ids).map(role=>{
  const approval={approver_id:ids[role],role,request_digest:rd};
  return {...approval,signature_b64:sign(null,encodeFixtureRecoveryApproval(approval),keys[role].privateKey).toString('base64')};
 });
};
function gate(overrides={}){
 return createFixtureRecoveryGate({approverKeys:Object.fromEntries(Object.keys(ids).map(role=>[role,
 {approver_id:ids[role],publicKey:keys[role].publicKey}])),clock:()=>150,
 readAudit:async r=>({organization_id:r.organization_id,key_version:r.key_version,
  event_kind:'KEY_ISSUED',event_digest:r.audit_digest}),
 readAnchor:async r=>({request_digest:r.request_digest,audit_digest:r.audit_digest,anchored:true,source:'FIXTURE_SEPARATE_ARCHIVE'}),
 ...overrides});
}
test('two distinct Ed25519 reviewers and fixture anchor only prove HOLD',async()=>{
 const result=await gate().verifyRecovery({request,approvals:approvals()});
 assert.equal(result.fixture_recovery_verified,true);
 assert.equal(result.external_anchor_verified,false);
 assert.equal(result.real_person_approval,false);
 assert.equal(result.hold_active,true);
 assert.equal(result.release_eligible,false);
});
test('one signature or repeated reviewer identity cannot pass',async()=>{
 await assert.rejects(gate().verifyRecovery({request,approvals:approvals().slice(0,1)}),{code:'RECOVERY_TWO_PERSON_REQUIRED'});
 const forged=approvals();
 forged[1]={...forged[1],approver_id:forged[0].approver_id};
 await assert.rejects(gate().verifyRecovery({request,approvals:forged}),{code:'RECOVERY_TWO_PERSON_REQUIRED'});
});
test('role swapping and copied signatures fail Ed25519',async()=>{
 const copied=approvals();
 copied[1]={...copied[1],signature_b64:copied[0].signature_b64};
 await assert.rejects(gate().verifyRecovery({request,approvals:copied}),{code:'RECOVERY_SIGNATURE_INVALID'});
});
test('modified key version, tenant, incident, or audit digest breaks approval binding',async()=>{
 for(const change of [{key_version:5},{organization_id:'22222222-2222-4222-8222-222222222222'},
 {incident_id:'00000000-0000-4000-8000-000000000004'},{audit_digest:'b'.repeat(64)}]){
  await assert.rejects(gate().verifyRecovery({request:{...request,...change},approvals:approvals()}),
   {code:'RECOVERY_SIGNATURE_INVALID'});
 }
});
test('invalid or missing audit and unavailable archive fail closed',async()=>{
 await assert.rejects(gate({readAudit:async()=>null}).verifyRecovery({request,approvals:approvals()}),
 {code:'RECOVERY_AUDIT_MISMATCH'});
 await assert.rejects(gate({readAnchor:async()=>{throw Error('fixture archive offline');}}).verifyRecovery({request,approvals:approvals()}),
 /fixture archive offline/);
 await assert.rejects(gate({readAnchor:async r=>({request_digest:r.request_digest,audit_digest:r.audit_digest,anchored:false,source:'FIXTURE_SEPARATE_ARCHIVE'})}).verifyRecovery({request,approvals:approvals()}),
 {code:'RECOVERY_ANCHOR_UNVERIFIED'});
});
test('expired request fails even with two valid signers',async()=>{
 await assert.rejects(gate({clock:()=>200}).verifyRecovery({request,approvals:approvals()}),
 {code:'RECOVERY_EXPIRED'});
});
test('replay in same process is denied; do not claim durable replay protection',async()=>{
 const verifier=gate();
 await verifier.verifyRecovery({request,approvals:approvals()});
 await assert.rejects(verifier.verifyRecovery({request,approvals:approvals()}),{code:'RECOVERY_REPLAY'});
});
