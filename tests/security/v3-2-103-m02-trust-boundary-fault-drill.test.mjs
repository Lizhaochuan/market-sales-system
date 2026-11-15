import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {createIsolatedSignedSourceContract} from '../../src/cross-module-signed-source-contract.mjs';

const org='11111111-1111-4111-8111-111111111111';
const incident='33333333-3333-4333-8333-333333333333';
const scope={organization_id:org,incident_id:incident};
const domains=['sales','finance','academic'];

function fixture(){
 let time=1000000;
 const root={},alternate={},pins={};
 const state=Object.fromEntries(domains.map(d=>[d,{
  source_epoch:1,source_revision:1,revocation_sequence:0,
  revocation_digest:'d'.repeat(64),incident_generation:1,
  evidence_digest:'a'.repeat(64),unavailable:false,delay_ms:0,
  rotate_signer:false,bad_scope:false,expired:false,malformed:false
 }]));
 for(const d of domains){
  root[d]=generateKeyPairSync('ed25519');
  alternate[d]=generateKeyPairSync('ed25519');
  pins[d]=root[d].publicKey.export({format:'pem',type:'spki'});
 }
 const proof=d=>{
  const s=state[d];
  const p={
   schema_version:'v3.2-102-ci-source-proof-v1',domain:d,
   organization_id:s.bad_scope?'22222222-2222-4222-8222-222222222222':org,
   incident_id:incident,source_epoch:s.source_epoch,
   source_revision:s.source_revision,
   revocation_sequence:s.revocation_sequence,
   revocation_digest:s.revocation_digest,
   incident_generation:s.incident_generation,evidence_digest:s.evidence_digest,
   issued_at_ms:s.expired?time-400000:time-1000,
   expires_at_ms:s.expired?time-1000:time+60000,fixture_only:true
  };
  const signature=sign(null,Buffer.from(JSON.stringify(p)),
   s.rotate_signer?alternate[d].privateKey:root[d].privateKey)
   .toString('base64url');
  return s.malformed?{...p,signature,finance_authorized:true}:{...p,signature};
 };
 const readers=Object.fromEntries(domains.map(d=>[d,async()=>{
  const s=state[d];
  if(s.unavailable)throw Error('injected source outage');
  if(s.delay_ms)await new Promise(resolve=>setTimeout(resolve,s.delay_ms));
  return proof(d);
 }]));
 const create=(override={})=>createIsolatedSignedSourceContract({
  readers,fixturePublicKeys:pins,getFixtureNow:()=>time,
  timeoutMs:35,...override
 });
 const boundary=create();
 const change=(d,values)=>Object.assign(state[d],values);
 const changeAll=values=>domains.forEach(d=>change(d,values));
 return {pins,root,alternate,readers,create,boundary,proof,change,changeAll,
  clock:value=>time=value,tick:value=>time+=value};
}
function safe(result){
 assert.ok(Object.isFrozen(result));
 assert.equal(result.hold_active,true);
 for(const key of ['external_authority_verified','finance_authorized',
  'academic_authorized','handoff_allowed','compensation_write_allowed',
  'release_eligible','production_integration_allowed'])
  assert.equal(result[key],false,key);
}
test('V3.2-103 rejects a shared fixture root, swapped pins and a non-Ed25519 root',async()=>{
 const f=fixture();
 assert.throws(()=>f.create({fixturePublicKeys:{...f.pins,
  finance:f.pins.sales}}),/distinct Ed25519 public keys/);
 const swapped=f.create({fixturePublicKeys:{...f.pins,
  finance:f.pins.academic,academic:f.pins.finance}});
 const bad=await swapped.inspect(scope);safe(bad);
 assert.equal(bad.reason_code,'FIXTURE_SOURCE_SIGNATURE_INVALID');
 const rsa=generateKeyPairSync('rsa',{modulusLength:2048});
 assert.throws(()=>f.create({fixturePublicKeys:{...f.pins,
  academic:rsa.publicKey.export({format:'pem',type:'spki'})}}),/Ed25519/);
});
test('V3.2-103 unexpected key rotation is rejected; reverting to pinned key only yields blocked fixture',async()=>{
 const f=fixture();
 const baseline=await f.boundary.inspect(scope);safe(baseline);
 assert.equal(baseline.fixture_signed_sources_consistent,true);
 f.change('finance',{rotate_signer:true,source_revision:2});
 let result=await f.boundary.inspect(scope);safe(result);
 assert.equal(result.reason_code,'FIXTURE_SOURCE_SIGNATURE_INVALID');
 f.change('finance',{rotate_signer:false});
 result=await f.boundary.inspect(scope);safe(result);
 assert.equal(result.fixture_signed_sources_consistent,true);
 assert.equal(result.handoff_allowed,false);
});
test('V3.2-103 connection error, timeout, late response, retry and wrong scope fail closed',async()=>{
 const f=fixture();
 f.change('academic',{unavailable:true});
 let r=await f.boundary.inspect(scope);safe(r);
 assert.equal(r.reason_code,'FIXTURE_SOURCE_UNAVAILABLE');
 f.change('academic',{unavailable:false,delay_ms:65});
 r=await f.boundary.inspect(scope);safe(r);
 assert.equal(r.reason_code,'FIXTURE_SOURCE_TIMEOUT');
 // A late fixture response must not become a financial or academic approval.
 await new Promise(resolve=>setTimeout(resolve,70));
 f.change('academic',{delay_ms:0});
 r=await f.boundary.inspect(scope);safe(r);
 assert.equal(r.fixture_signed_sources_consistent,true);
 f.change('academic',{bad_scope:true});
 r=await f.boundary.inspect(scope);safe(r);
 assert.equal(r.reason_code,'FIXTURE_SOURCE_ENVELOPE_INVALID_OR_EXPIRED');
});
test('V3.2-103 source epoch, revocation and generation divergence across domains all block',async()=>{
 for(const change of [
  {source_epoch:2},{revocation_sequence:1},{incident_generation:2},
  {revocation_digest:'e'.repeat(64)}
 ]){
  const f=fixture();
  await f.boundary.getFixtureWatermark(org,incident);
  f.change('finance',change);
  const r=await f.boundary.inspect(scope);safe(r);
  assert.equal(r.reason_code,'FIXTURE_CROSS_DOMAIN_WATERMARK_CONFLICT');
 }
});
test('V3.2-103 rollback and equal-version equivocation cannot reuse previous successful proof',async()=>{
 const f=fixture();
 await f.boundary.getFixtureWatermark(org,incident);
 f.changeAll({source_epoch:2,source_revision:4,incident_generation:2,
  revocation_sequence:3,revocation_digest:'e'.repeat(64)});
 await f.boundary.getFixtureWatermark(org,incident);
 f.changeAll({source_epoch:1});
 let r=await f.boundary.inspect(scope);safe(r);
 assert.equal(r.reason_code,'FIXTURE_SOURCE_VERSION_ROLLBACK');
 const g=fixture();
 await g.boundary.getFixtureWatermark(org,incident);
 g.change('sales',{evidence_digest:'9'.repeat(64)});
 r=await g.boundary.inspect(scope);safe(r);
 assert.equal(r.reason_code,'FIXTURE_SOURCE_SAME_VERSION_EQUIVOCATION');
});
test('V3.2-103 signed but expired or unrecognized envelope cannot bypass checks',async()=>{
 const f=fixture();
 f.changeAll({expired:true});
 let r=await f.boundary.inspect(scope);safe(r);
 assert.equal(r.reason_code,'FIXTURE_SOURCE_ENVELOPE_INVALID_OR_EXPIRED');
 f.changeAll({expired:false});
 f.change('sales',{malformed:true});
 r=await f.boundary.inspect(scope);safe(r);
 assert.equal(r.reason_code,'FIXTURE_SOURCE_ENVELOPE_INVALID_OR_EXPIRED');
});
test('V3.2-103 fresh adapter after restart loses in-memory high water; records production blocker',async()=>{
 const f=fixture();
 f.changeAll({source_epoch:3,source_revision:5,incident_generation:4,
  revocation_sequence:2,revocation_digest:'e'.repeat(64)});
 const advanced=await f.boundary.inspect(scope);safe(advanced);
 assert.equal(advanced.fixture_signed_sources_consistent,true);
 f.changeAll({source_epoch:1,source_revision:1,incident_generation:1,
  revocation_sequence:0,revocation_digest:'d'.repeat(64)});
 const oldProcess=await f.boundary.inspect(scope);safe(oldProcess);
 assert.equal(oldProcess.reason_code,'FIXTURE_SOURCE_VERSION_ROLLBACK');
 const restarted=f.create(); // No external monotone ledger persists between processes.
 const afterRestart=await restarted.inspect(scope);safe(afterRestart);
 assert.equal(afterRestart.fixture_signed_sources_consistent,true);
 // Demonstrates missing durable replay protection, NOT real approval.
 assert.equal(afterRestart.handoff_allowed,false);
});
test('V3.2-103 valid fixture signatures do not attest business truth or authorize handoff',async()=>{
 const f=fixture();
 await f.boundary.getFixtureWatermark(org,incident);
 // A fixture signer can invent a higher revision with arbitrary contents.
 f.changeAll({source_revision:2,evidence_digest:'f'.repeat(64)});
 const r=await f.boundary.inspect(scope);safe(r);
 assert.equal(r.fixture_signed_sources_consistent,true);
 assert.equal(r.external_authority_verified,false);
 assert.equal(r.finance_authorized,false);
 assert.equal(r.academic_authorized,false);
});
test('V3.2-103 verification is scoped to organization and incident and rejects clock rollback',async()=>{
 const f=fixture();
 const invalid=await f.boundary.inspect({
  organization_id:'bad',incident_id:incident});safe(invalid);
 assert.equal(invalid.reason_code,'INVALID_SOURCE_SCOPE');
 await f.boundary.getFixtureWatermark(org,incident);
 f.clock(999999);
 const result=await f.boundary.inspect(scope);safe(result);
 assert.equal(result.reason_code,'FIXTURE_SOURCE_CLOCK_ROLLBACK');
});
