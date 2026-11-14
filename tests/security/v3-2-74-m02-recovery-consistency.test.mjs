import test from 'node:test';
import assert from 'node:assert/strict';
import {createIsolatedThreePartyRecoveryCheck} from '../../src/cross-module-recovery-consistency.mjs';
const org='11111111-1111-4111-8111-111111111111';
const incident='33333333-3333-4333-8333-333333333333';
const alt='22222222-2222-4222-8222-222222222222';
const domains=['market_sales','finance','academic'];
const make=(domain)=>({organization_id:org,incident_id:incident,domain,source_epoch:1,
 source_revision:1,revocation_sequence:0,revocation_digest:'a'.repeat(64),
 recovery_generation:1,availability:'online',hold_active:true});
const fixtures=()=>Object.fromEntries(domains.map(d=>[d,make(d)]));
const noRelease=r=>{
 assert.equal(r.hold_active,true);assert.equal(r.automatic_recovery_allowed,false);
 for(const k of ['external_authority_verified','finance_authorized','academic_authorized',
 'handoff_allowed','compensation_write_allowed','release_eligible'])assert.equal(r[k],false,k);
 assert.ok(Object.isFrozen(r));
};
function setup(){
 const rows=fixtures();
 const gate=createIsolatedThreePartyRecoveryCheck({getFixtureSnapshot:async ({domain})=>({...rows[domain]})});
 const run=(afterFirstRead=async()=>{})=>gate.check({organization_id:org,incident_id:incident,afterFirstRead});
 return {rows,gate,run};
}
test('V3.2-74 three stable fictional domains never allow real release',async()=>{
 const f=setup(),r=await f.run();noRelease(r);
 assert.equal(r.fixture_consistency_verified,true);
 assert.equal(r.reason_code,'BLOCKED_EXTERNAL_RECOVERY_AUTHORITY_UNAVAILABLE');
 const repeated=await f.run();noRelease(repeated);
 assert.equal(repeated.fixture_consistency_verified,true);
});
test('V3.2-74 offline and poisoned domain fails closed',async()=>{
 const f=setup();f.rows.finance.availability='offline';
 const offline=await f.run();noRelease(offline);
 assert.equal(offline.reason_code,'FIXTURE_DOMAIN_INVALID_OR_UNAVAILABLE');
 f.rows.finance.availability='online';f.rows.academic.hold_active=false;
 const fake=await f.run();noRelease(fake);
 assert.equal(fake.reason_code,'FIXTURE_DOMAIN_INVALID_OR_UNAVAILABLE');
 f.rows.academic.hold_active=true;f.rows.academic.organization_id=alt;
 const cross=await f.run();noRelease(cross);
 assert.equal(cross.reason_code,'FIXTURE_DOMAIN_INVALID_OR_UNAVAILABLE');
});
test('V3.2-74 delayed revocation and source epoch changes never reuse old decision',async()=>{
 const f=setup();
 const changed=await f.run(async()=>{f.rows.finance.revocation_sequence=1;});
 noRelease(changed);assert.equal(changed.reason_code,'FIXTURE_DOMAIN_CHANGED_DURING_RECOVERY');
 const stable=await f.run();noRelease(stable);assert.equal(stable.fixture_consistency_verified,true);
 const restarted=await f.run(async()=>{f.rows.academic.source_epoch=2;
  f.rows.academic.recovery_generation=2;});
 noRelease(restarted);assert.equal(restarted.reason_code,'FIXTURE_DOMAIN_CHANGED_DURING_RECOVERY');
});
test('V3.2-74 regression, altered digest and false recovery are rejected',async()=>{
 const f=setup();noRelease(await f.run());
 f.rows.finance.revocation_sequence=1;f.rows.finance.revocation_digest='b'.repeat(64);
 noRelease(await f.run());
 f.rows.finance.revocation_sequence=0;
 const rollback=await f.run();noRelease(rollback);
 assert.equal(rollback.reason_code,'RECOVERY_WATERMARK_REGRESSION');
 f.rows.finance.revocation_sequence=1;f.rows.finance.revocation_digest='c'.repeat(64);
 const conflict=await f.run();noRelease(conflict);
 assert.equal(conflict.reason_code,'REVOCATION_WATERMARK_CONFLICT');
 f.rows.finance.revocation_digest='b'.repeat(64);f.rows.finance.recovery_generation=2;
 const invalidRecovery=await f.run();noRelease(invalidRecovery);
 assert.equal(invalidRecovery.reason_code,'RECOVERY_WITHOUT_NEW_SOURCE_EPOCH');
});
test('V3.2-74 absence, exception and unknown client approval fail closed',async()=>{
 const f=setup();
 const bad=await f.gate.check({organization_id:org,incident_id:incident,
  afterFirstRead:async()=>{},finance_authorized:true});noRelease(bad);
 // Unknown values never become authorization even for a stable fixture check.
 assert.equal(bad.handoff_allowed,false);
 const thrown=await f.run(async()=>{throw Error('interrupted')});noRelease(thrown);
 assert.equal(thrown.reason_code,'RECOVERY_CHECK_INTERRUPTED');
 const missing=createIsolatedThreePartyRecoveryCheck({getFixtureSnapshot:async()=>{throw Error('offline')}});
 const denied=await missing.check({organization_id:org,incident_id:incident,afterFirstRead:async()=>{}});
 noRelease(denied);assert.equal(denied.reason_code,'FIXTURE_DOMAIN_UNAVAILABLE');
});
