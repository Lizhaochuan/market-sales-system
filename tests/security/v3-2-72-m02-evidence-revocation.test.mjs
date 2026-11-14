import test from 'node:test';
import assert from 'node:assert/strict';
import {createIsolatedRevocationLedger} from '../../src/cross-module-evidence-revocation-ledger.mjs';
const org='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
const incident='33333333-3333-4333-8333-333333333333';
const sha='a'.repeat(64);
const revoked=(source_epoch,revocation_sequence,idempotency_key,event_id='E-1')=>({
 organization_id:org,incident_id:incident,event_id,event_sha256:sha,
 source_epoch,revocation_sequence,idempotency_key});
const assertBlocked=x=>{
 for(const k of ['finance_authorized','academic_authorized','handoff_allowed',
 'compensation_write_allowed','release_eligible','external_source_authenticated'])
 assert.equal(x[k],false,k);
 assert.equal(x.hold_active,true);assert.equal(Object.isFrozen(x),true);
};
test('V3.2-72 old packet is invalid after revocation and never authorizes release',()=>{
 let epoch=1;const ledger=createIsolatedRevocationLedger({getFixtureSourceEpoch:()=>epoch});
 const before=ledger.viewFixtureWatermark(org,incident);
 const ref=()=>({organization_id:org,incident_id:incident,source_epoch:epoch,
  revocation_sequence:before.revocation_sequence,
  revocation_digest:before.revocation_digest,evidence_event_ids:['E-1']});
 assertBlocked(ledger.checkHistoricalPacket(ref()));
 const first=ledger.recordRevocation(revoked(1,1,'revocation-first-key-00001'));
 assert.equal(first.revocation_sequence,1);
 assert.equal(ledger.recordRevocation(revoked(1,1,'revocation-first-key-00001')),first);
 assert.equal(ledger.checkHistoricalPacket(ref()).reason_code,'REVOCATION_LEDGER_CHANGED');
 const current=ledger.viewFixtureWatermark(org,incident);
 assert.equal(ledger.checkHistoricalPacket({...ref(),
  revocation_sequence:current.revocation_sequence,
  revocation_digest:current.revocation_digest}).reason_code,
 'HISTORICAL_PACKET_USES_REVOKED_EVIDENCE');
 epoch=2;
 assert.equal(ledger.checkHistoricalPacket({...ref(),
  revocation_sequence:current.revocation_sequence,
  revocation_digest:current.revocation_digest}).reason_code,'SOURCE_EPOCH_STALE');
 assertBlocked(ledger.checkHistoricalPacket(ref()));
});
test('V3.2-72 tenant boundaries, replay, gaps and tampering are rejected',()=>{
 const ledger=createIsolatedRevocationLedger({getFixtureSourceEpoch:()=>1});
 ledger.recordRevocation(revoked(1,1,'revocation-first-key-00001'));
 assert.throws(()=>ledger.recordRevocation(revoked(1,1,'revocation-first-key-00001','E-2')),
 /REVOCATION_NONCE_CONFLICT/);
 assert.throws(()=>ledger.recordRevocation(revoked(1,3,'revocation-third-key-00001','E-3')),
 /REVOCATION_SEQUENCE_GAP_OR_ROLLBACK/);
 assert.throws(()=>ledger.recordRevocation(revoked(1,2,'revocation-second-key-00001','E-1')),
 /REVOKED_EVENT_DIGEST_CONFLICT/);
 const a=ledger.viewFixtureWatermark(org,incident);
 const b=ledger.viewFixtureWatermark(other,incident);
 assert.equal(a.revocation_sequence,1);assert.equal(b.revocation_sequence,0);
 const attempt={organization_id:other,incident_id:incident,source_epoch:1,
  revocation_sequence:a.revocation_sequence,revocation_digest:a.revocation_digest,
  evidence_event_ids:['E-1']};
 assert.equal(ledger.checkHistoricalPacket(attempt).reason_code,'REVOCATION_LEDGER_CHANGED');
 const forged={organization_id:org,incident_id:incident,source_epoch:1,
  revocation_sequence:1,revocation_digest:a.revocation_digest,
  evidence_event_ids:['E-2'],finance_authorized:true};
 assert.equal(ledger.checkHistoricalPacket(forged).reason_code,'INVALID_REVOCATION_REFERENCE');
 assert.equal(ledger.checkHistoricalPacket({...forged,finance_authorized:undefined,
  evidence_event_ids:['E-2']}).reason_code,'INVALID_REVOCATION_REFERENCE');
});
