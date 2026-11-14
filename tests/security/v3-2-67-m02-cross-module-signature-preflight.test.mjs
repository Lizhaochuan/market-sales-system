import test from 'node:test';
import assert from 'node:assert/strict';
import {
 preflightProposedThreePartyEvidence,proposedEnvelopeMayAuthorizeRelease
} from '../../src/cross-module-signature-preflight.mjs';
const org='11111111-1111-4111-8111-111111111111';
const hash='a'.repeat(64);
const fixture=()=>({
 protocol_version:'v3.2-66-proposed',
 handoff_id:'22222222-2222-4222-8222-222222222222',
 incident_id:'33333333-3333-4333-8333-333333333333',
 organization_id:org,sales_packet_digest:hash,
 request_nonce:'fictional_nonce_for_tests_00000001',
 original_records_preserved:true,
 events:[{source_event_id:'event-1',source_system:'market_sales',
   event_type:'audit_recorded',occurred_at:'2026-11-14T10:00:00Z',digest:hash}],
 parties:Object.fromEntries(['sales','finance','academic'].map((p,i)=>[p,{
   authority_domain:p,principal_id:'test-principal-'+p,
   organization_id:org,signed_receipt_id:'fixture-receipt-'+p,
   evidence_digest:hash,decision:'accepted',
   signed_at:'2026-11-14T10:01:00Z'
 }]))
});
const blocked=(x,code)=>{
 const r=preflightProposedThreePartyEvidence(x);
 assert.equal(r.reason_code,code);
 for(const k of ['accepted','signature_verified','external_trust_configured',
   'finance_authorized','execution_allowed','release_eligible',
   'compensation_write_allowed','original_records_mutable'])assert.equal(r[k],false,k);
 assert.equal(r.hold_active,true);
 assert.equal(r.failure_disposition,'reject_preserve_originals_escalate_manually');
 assert.equal(Object.isFrozen(r),true);
};
test('V3.2-67 all valid-looking three-party accepted receipts remain untrusted',()=>{
 assert.equal(proposedEnvelopeMayAuthorizeRelease,false);
 blocked(fixture(),'blocked_external_signature_verifier_revocation_and_replay_unavailable');
});
test('V3.2-67 fail closed for malformed, mutable or conflicting provenance',()=>{
 blocked(null,'blocked_missing_or_extra_envelope_fields');
 const extra=fixture();extra.finance_authorized=true;
 blocked(extra,'blocked_missing_or_extra_envelope_fields');
 const badVersion=fixture();badVersion.protocol_version='production';
 blocked(badVersion,'blocked_invalid_protocol_binding');
 const history=fixture();history.original_records_preserved=false;
 blocked(history,'blocked_original_history_not_preserved');
 const duplicateEvent=fixture();duplicateEvent.events.push({...duplicateEvent.events[0]});
 blocked(duplicateEvent,'blocked_invalid_or_duplicate_events');
 const orgMismatch=fixture();orgMismatch.parties.finance.organization_id='44444444-4444-4444-8444-444444444444';
 blocked(orgMismatch,'blocked_cross_organization_receipt');
 const digest=fixture();digest.parties.finance.evidence_digest='b'.repeat(64);
 blocked(digest,'blocked_snapshot_digest_mismatch');
 const selfApprove=fixture();selfApprove.parties.finance.principal_id=selfApprove.parties.sales.principal_id;
 blocked(selfApprove,'blocked_separation_of_duties');
 const duplicate=fixture();duplicate.parties.academic.signed_receipt_id=duplicate.parties.finance.signed_receipt_id;
 blocked(duplicate,'blocked_duplicate_receipt');
 const invalidTime=fixture();invalidTime.parties.finance.signed_at='not-verified';
 blocked(invalidTime,'blocked_invalid_party_receipt');
 const deny=fixture();deny.parties.finance.decision='rejected';
 blocked(deny,'blocked_external_rejected_claim');
 const correction=fixture();correction.parties.academic.decision='requires_correction';
 blocked(correction,'blocked_external_correction_claim');
 const fakeCrypto=fixture();fakeCrypto.parties.finance.signature_valid=true;
 blocked(fakeCrypto,'blocked_invalid_party_receipt');
});
