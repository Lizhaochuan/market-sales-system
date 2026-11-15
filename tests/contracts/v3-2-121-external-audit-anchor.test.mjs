import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {encodeFixtureAuditAnchor,signFixtureAuditAnchor,verifyFixtureAuditAnchor,verifyFixtureActiveAuditAnchor,inspectFixtureArchivedAuditAnchor}
 from '../helpers/v3-2-121-fixture-external-audit-anchor.mjs';

const a='11111111-1111-4111-8111-111111111111';
const failure='00000000-0000-4000-8000-0000000000b1';
const incident='00000000-0000-4000-8000-000000000002';
const event='00000000-0000-4000-8000-0000000000e9';
const signer='00000000-0000-4000-8000-0000000000a8';
const digest='a'.repeat(64);
const keys=generateKeyPairSync('ed25519');
const foreign=generateKeyPairSync('ed25519');
const publicKeys=new Map([[signer,keys.publicKey]]);
const statement=Object.freeze({
 organization_id:a,failure_id:failure,incident_id:incident,event_id:event,
 snapshot_sequence:4,remediation_version:7,accepted_review_roles:1,
 observed_digest:digest,signer_id:signer,issued_at_ms:100,expires_at_ms:200
});
const current=Object.freeze({
 ...statement,rebuild_status:'REBUILT_STILL_HOLD',verdict:'SNAPSHOT_MATCH_STILL_HOLD',
 snapshot_matches:true,hold_active:true,release_eligible:false
});
const options=anchor=>({anchor,publicKeys,current,nowMs:150,minimumSequence:4});

test('domain separated Ed25519 proof never grants release even when valid',()=>{
 const anchor=signFixtureAuditAnchor(statement,keys.privateKey);
 assert.match(encodeFixtureAuditAnchor(statement).toString(),/^v121-external-audit-anchor-v1\|/);
 assert.deepEqual(verifyFixtureAuditAnchor(options(anchor)),{
  status:'ANCHOR_MATCH_STILL_HOLD',hold_active:true,release_eligible:false,checkpoint_sequence:4
 });
 assert.throws(()=>verifyFixtureAuditAnchor({...options(anchor),nowMs:200}),{code:'V121_ANCHOR_EXPIRED'});
 assert.throws(()=>verifyFixtureAuditAnchor({...options(anchor),nowMs:99}),{code:'V121_ANCHOR_EXPIRED'});
 assert.throws(()=>verifyFixtureAuditAnchor({...options(anchor),minimumSequence:5}),{code:'V121_ANCHOR_ROLLBACK_DETECTED'});
});

test('forgery, untrusted signer, mismatched scope, stale historical fingerprint all fail closed',()=>{
 const anchor=signFixtureAuditAnchor(statement,keys.privateKey);
 const forged={...anchor,statement:{...statement,observed_digest:'b'.repeat(64)}};
 assert.throws(()=>verifyFixtureAuditAnchor(options(forged)),{code:'V121_ANCHOR_SIGNATURE_INVALID'});
 const invalidKey=signFixtureAuditAnchor(statement,foreign.privateKey);
 assert.throws(()=>verifyFixtureAuditAnchor(options(invalidKey)),{code:'V121_ANCHOR_SIGNATURE_INVALID'});
 assert.throws(()=>verifyFixtureAuditAnchor({...options(anchor),publicKeys:new Map()}),{code:'V121_ANCHOR_SIGNER_UNTRUSTED'});
 assert.throws(()=>verifyFixtureAuditAnchor({...options(anchor),current:{...current,observed_digest:'b'.repeat(64)}}),{code:'V121_ANCHOR_CONTENT_MISMATCH'});
 assert.throws(()=>verifyFixtureAuditAnchor({...options(anchor),current:{...current,incident_id:'00000000-0000-4000-8000-000000000099'}}),{code:'V121_ANCHOR_SCOPE_MISMATCH'});
 assert.throws(()=>verifyFixtureAuditAnchor({...options(anchor),current:{...current,verdict:'SNAPSHOT_MISMATCH',snapshot_matches:false}}),{code:'V121_ANCHOR_REBUILD_NOT_SAFE'});
 assert.throws(()=>verifyFixtureAuditAnchor({...options(anchor),current:{...current,snapshot_sequence:3}}),{code:'V121_ANCHOR_ROLLBACK_DETECTED'});
 assert.throws(()=>signFixtureAuditAnchor({...statement,expires_at_ms:50_000},keys.privateKey),{code:'V121_ANCHOR_ENVELOPE_INVALID'});
});


test('persisted key lifecycle revocation disables current authority while retaining forensic proof',()=>{
 const anchor=signFixtureAuditAnchor(statement,keys.privateKey);
 const state=new Map([[signer,'REGISTERED']]);
 assert.equal(verifyFixtureActiveAuditAnchor({...options(anchor),keyStates:state}).status,'ANCHOR_MATCH_STILL_HOLD');
 state.set(signer,'RETIRED');
 assert.throws(()=>verifyFixtureActiveAuditAnchor({...options(anchor),keyStates:state}),{code:'V121_ANCHOR_KEY_RETIRED'});
 assert.deepEqual(inspectFixtureArchivedAuditAnchor({anchor,publicKeys,keyStates:state}),{
  status:'RETIRED_HISTORICAL_ONLY',cryptographically_valid:true,hold_active:true,release_eligible:false
 });
 state.set(signer,'REVOKED');
 assert.throws(()=>verifyFixtureActiveAuditAnchor({...options(anchor),keyStates:state}),{code:'V121_ANCHOR_KEY_REVOKED'});
 assert.equal(inspectFixtureArchivedAuditAnchor({anchor,publicKeys,keyStates:state}).status,'REVOKED_HISTORICAL_ONLY');
 assert.throws(()=>inspectFixtureArchivedAuditAnchor({
  anchor:{...anchor,statement:{...statement,observed_digest:'c'.repeat(64)}},publicKeys,keyStates:state
 }),{code:'V121_ANCHOR_SIGNATURE_INVALID'});
 assert.throws(()=>verifyFixtureActiveAuditAnchor({...options(anchor),keyStates:new Map()}),{code:'V121_ANCHOR_SIGNER_UNTRUSTED'});
});
