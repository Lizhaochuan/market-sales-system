import test from 'node:test';
import assert from 'node:assert/strict';
import {createIsolatedHandoffGapReporter} from '../../src/cross-module-handoff-gap-report.mjs';
const org='11111111-1111-4111-8111-111111111111';
const incident='33333333-3333-4333-8333-333333333333';
const input=()=>({organization_id:org,incident_id:incident,
 source_digest:'a'.repeat(64),revocation_reference:{},
 afterFirstRead:async()=>{}});
const safe=(reason_code,consistent=false)=>({
 reason_code,fixture_preflight_consistent:consistent,
 internal_review_consistent:consistent,revocation_reference_current:consistent,
 three_domain_recovery_consistent:consistent,hold_active:true,
 handoff_allowed:false,release_eligible:false,compensation_write_allowed:false,
 finance_authorized:false,academic_authorized:false,external_authority_verified:false});
const successful=()=>safe('BLOCKED_EXTERNAL_THREE_PARTY_ACCEPTANCE_AND_ATOMIC_HANDOFF_MISSING',true);
function assertBlocked(r){
 assert.equal(Object.isFrozen(r),true);
 assert.equal(Object.isFrozen(r.items),true);
 assert.equal(r.items.length,7);
 assert.equal(r.missing_authoritative_checks,6);
 assert.equal(r.hold_active,true);
 for(const k of ['external_authority_verified','finance_authorized','academic_authorized',
  'handoff_allowed','compensation_write_allowed','release_eligible',
  'production_integration_allowed'])assert.equal(r[k],false,k);
 for(const x of r.items)assert.equal(Object.isFrozen(x),true);
 assert.equal(r.items.filter(x=>x.status==='needs_external_authority').length,6);
}
test('V3.2-77 full fictional preflight still reports six external blockers',async()=>{
 const reporter=createIsolatedHandoffGapReporter({finalPreflight:{check:async()=>successful()}});
 const r=await reporter.report(input());assertBlocked(r);
 assert.equal(r.reason_code,'BLOCKED_REAL_EXTERNAL_HANDOFF_GAPS');
 assert.equal(r.local_check_consistent,true);
 assert.equal(r.items[0].status,'not_verified');
});
test('V3.2-77 incomplete local checks are identified but not authorized',async()=>{
 const reporter=createIsolatedHandoffGapReporter({finalPreflight:{
  check:async()=>safe('INTERNAL_RECONFIRMATION_INCOMPLETE_OR_STALE')}});
 const r=await reporter.report(input());assertBlocked(r);
 assert.equal(r.local_check_consistent,false);
 assert.equal(r.items[0].status,'blocked');
 assert.equal(r.local_reason_code,'INTERNAL_RECONFIRMATION_INCOMPLETE_OR_STALE');
});
test('V3.2-77 forged success and broken hold from dependency fail closed',async()=>{
 for(const altered of [{handoff_allowed:true},{finance_authorized:true},
  {release_eligible:true},{academic_authorized:true},{external_authority_verified:true}]){
  const reporter=createIsolatedHandoffGapReporter({finalPreflight:{
   check:async()=>({...successful(),...altered})}});
  const r=await reporter.report(input());assertBlocked(r);
  assert.equal(r.reason_code,'FINAL_PREFLIGHT_AUTHORITY_PROTOCOL_VIOLATION');
 }
 const bad=createIsolatedHandoffGapReporter({finalPreflight:{
  check:async()=>({...successful(),hold_active:false})}});
 assert.equal((await bad.report(input())).reason_code,'FINAL_PREFLIGHT_HOLD_PROTOCOL_VIOLATION');
});
test('V3.2-77 input tampering, cross-scope substitution and outage fail closed',async()=>{
 const reporter=createIsolatedHandoffGapReporter({finalPreflight:{check:async()=>successful()}});
 for(const mutation of [{finance_authorized:true},
  {organization_id:'22222222-2222-2222-2222-222222222222',approved:true},
  {source_digest:'invalid'},{incident_id:null}]){
  const r=await reporter.report({...input(),...mutation});
  if(mutation.finance_authorized||mutation.approved||mutation.source_digest||mutation.incident_id===null){
   assertBlocked(r);assert.equal(r.reason_code,'INVALID_GAP_REPORT_INPUT');
  }
 }
 const unavailable=createIsolatedHandoffGapReporter({finalPreflight:{
  check:async()=>{throw Error('fixture offline');}}});
 const r=await unavailable.report(input());assertBlocked(r);
 assert.equal(r.reason_code,'FINAL_PREFLIGHT_UNAVAILABLE');
});
