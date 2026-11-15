import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import pg from 'pg';
import {createIsolatedSourceTrustFence} from '../../src/cross-module-source-trust-fence.mjs';
import {createIsolatedReadOnlyVerificationFacade} from '../../src/cross-module-readonly-verification-facade.mjs';
import {createIsolatedPostgresCheckpointStore} from '../helpers/v3-2-106-m02-postgres-checkpoint.mjs';

if(process.env.V106_ISOLATED_PG!=='YES_TEST_ONLY')throw Error('Disposable CI database guard missing');
const {Pool}=pg;
const organization_id='11111111-1111-4111-8111-111111111111';
const incident=i=>'44444444-4444-4444-8444-'+String(i).padStart(12,'0');
const domains=['sales','finance','academic'];
const rosterKeys=['schema_version','organization_id','revision','issued_at_ms',
 'expires_at_ms','keys','revocations','fixture_only'];
const sourceKeys=['schema_version','domain','organization_id','incident_id',
 'key_id','trust_revision','source_epoch','source_revision','incident_generation',
 'revocation_sequence','revocation_digest','evidence_digest','issued_at_ms',
 'expires_at_ms','fixture_only'];
const publicPem=pair=>pair.publicKey.export({format:'pem',type:'spki'});
const signed=(p,k)=>({...p,signature:sign(null,Buffer.from(JSON.stringify(p)),k)
 .toString('base64url')});
const createPool=(role='v106_writer_a')=>new Pool({
 host:'127.0.0.1',port:5432,database:'v106_isolated',user:role,
 password:role==='v106_writer_a'?'ephemeral-v106-A-only':'ephemeral-v106-B-only',
 max:5,connectionTimeoutMillis:2500
});
function makeHarness(i,config={}){
 const scope={organization_id,incident_id:incident(i)};
 let clock=1000000,revision=1,governanceFault=false,missingRevocation=false;
 const governance=generateKeyPairSync('ed25519');
 const keys=Object.fromEntries(domains.map(d=>[d,[{
  id:d+'-fixture-001',pair:generateKeyPairSync('ed25519'),
  status:'active',activated_at_ms:clock-900
 }]]));
 const src=Object.fromEntries(domains.map(d=>[d,{
  epoch:1,version:1,generation:1,revocation_sequence:0,
  revocation_digest:'d'.repeat(64),evidence_digest:'a'.repeat(64),
  fault:null
 }]));
 let proofCalls=0;
 const revocations=[];
 const trustRoster=()=>{
  const p={schema_version:'v3.2-104-ci-trust-roster-v1',
   organization_id,revision,issued_at_ms:clock-100,
   expires_at_ms:clock+60000,keys:domains.flatMap(d=>keys[d].map(k=>({
    domain:d,key_id:k.id,public_key_pem:publicPem(k.pair),status:k.status,
    activated_at_ms:k.activated_at_ms
   }))),revocations:missingRevocation?[]:revocations.map(x=>({...x})),
   fixture_only:true};
  const k=governanceFault?generateKeyPairSync('ed25519').privateKey:
   governance.privateKey;
  return signed(p,k);
 };
 function proof(d,patch={}){
  const state=src[d],active=keys[d].find(k=>k.status==='active');
  const p={schema_version:'v3.2-104-ci-source-proof-v1',domain:d,
   organization_id,incident_id:scope.incident_id,key_id:active.id,
   trust_revision:revision,source_epoch:state.epoch,
   source_revision:state.version,incident_generation:state.generation,
   revocation_sequence:state.revocation_sequence,
   revocation_digest:state.revocation_digest,evidence_digest:state.evidence_digest,
   issued_at_ms:clock-200,expires_at_ms:clock+60000,fixture_only:true,
   ...patch};
  const signer=state.fault==='bad_signature'?generateKeyPairSync('ed25519').privateKey:
   active.pair.privateKey;
  return signed(p,signer);
 }
 const readers=Object.fromEntries(domains.map(d=>[d,async()=>{
  proofCalls++;
  if(src[d].fault==='outage')throw Error('synthetic outage');
  if(src[d].fault==='timeout')await new Promise(r=>setTimeout(r,100));
  if(src[d].fault==='old_key'){
   const stale=keys[d].find(k=>k.status==='revoked');
   if(stale)return signed({...proof(d),key_id:stale.id},stale.pair.privateKey);
  }
  return proof(d);
 }]));
 function gate(store,override={}){
  return createIsolatedSourceTrustFence({
   readTrustRoster:async()=>trustRoster(),
   sourceReaders:override.sourceReaders||readers,
   governancePublicKey:publicPem(governance),
   checkpointStore:store,getFixtureNow:()=>clock,timeoutMs:35
  });
 }
 function rotate(d){
  const old=keys[d].find(k=>k.status==='active');
  old.status='revoked';
  revocations.push({domain:d,key_id:old.id,sequence:revocations.length+1,
   revoked_at_ms:clock-400});
  keys[d].push({id:d+'-fixture-'+String(keys[d].length+1).padStart(3,'0'),
   pair:generateKeyPairSync('ed25519'),status:'active',
   activated_at_ms:clock-250});
  revision++;
 }
 const updateAll=patch=>domains.forEach(d=>Object.assign(src[d],patch));
 return {scope,gate,proof,readers,rotate,src,updateAll,trustRoster,
  setFault:(d,fault)=>{src[d].fault=fault;},
  setMissingRevocation:x=>missingRevocation=x,
  setGovernanceFault:x=>governanceFault=x,
  tick:n=>{clock+=n;},getClock:()=>clock,
  proofCalls:()=>proofCalls};
}
function safe(x){
 assert.equal(Object.isFrozen(x),true);
 assert.equal(x.hold_active,true);
 for(const k of ['external_authority_verified','finance_authorized',
  'academic_authorized','handoff_allowed','compensation_write_allowed',
  'release_eligible','production_integration_allowed'])assert.equal(x[k],false,k);
}
async function usePool(fn){
 const pool=createPool();
 try{return await fn(pool,createIsolatedPostgresCheckpointStore({pool}));}
 finally{await pool.end();}
}
test('V107-E2E-01 genuine source signatures advance a real isolated PostgreSQL checkpoint',async()=>{
 const h=makeHarness(1071);
 await usePool(async(_pool,store)=>{
  const result=await h.gate(store).inspect(h.scope);safe(result);
  assert.equal(result.reason_code,'BLOCKED_FIXTURE_TRUST_FENCE_NO_EXTERNAL_AUTHORITY');
  assert.equal(result.fixture_trust_checkpoint_current,true);
  const persisted=await store.read(h.scope);
  assert.equal(persisted.trust_revision,1);
  assert.equal(persisted.domains.finance.source_revision,1);
  assert.equal(persisted.active_key_ids.finance,'finance-fixture-001');
  assert.ok(h.proofCalls()>=6);
 });
});
test('V107-E2E-02 new application pool and verifier still reject signed older versions',async()=>{
 const h=makeHarness(1072);
 await usePool(async(_pool,store)=>{
  safe(await h.gate(store).inspect(h.scope));
  h.updateAll({epoch:2,version:3,generation:2,
   revocation_sequence:2,revocation_digest:'e'.repeat(64),
   evidence_digest:'b'.repeat(64)});
  const high=await h.gate(store).inspect(h.scope);
  assert.equal(high.fixture_trust_checkpoint_current,true);
 });
 h.updateAll({epoch:1,version:1,generation:1,revocation_sequence:0,
  revocation_digest:'d'.repeat(64),evidence_digest:'a'.repeat(64)});
 await usePool(async(_pool,newStore)=>{
  const freshVerifier=h.gate(newStore);
  const r=await freshVerifier.inspect(h.scope);safe(r);
  assert.equal(r.reason_code,'TRUST_CHECKPOINT_REJECTED_OR_ROLLED_BACK');
  const saved=await newStore.read(h.scope);
  assert.equal(saved.revocation_sequence,2);
  assert.equal(saved.domains.sales.source_epoch,2);
 });
});
test('V107-E2E-03 unsigned/forged, missing and expired source evidence cannot write checkpoint',async()=>{
 for(const [index,attack,reason] of [
  [1073,h=>h.setFault('finance','bad_signature'),'TRUST_SOURCE_SIGNATURE_INVALID'],
  [1074,h=>h.setFault('finance','outage'),'TRUST_SOURCE_UNAVAILABLE'],
  [1075,h=>h.setFault('academic','timeout'),'TRUST_SOURCE_TIMEOUT'],
  [1076,h=>h.setGovernanceFault(true),'TRUST_GOVERNANCE_SIGNATURE_INVALID']
 ]){
  const h=makeHarness(index);attack(h);
  await usePool(async(_pool,store)=>{
   const r=await h.gate(store).inspect(h.scope);safe(r);
   assert.equal(r.reason_code,reason);
   assert.equal(await store.read(h.scope),null);
  });
 }
});
test('V107-E2E-04 key rotation needs signed governance version and old-key revocation',async()=>{
 const h=makeHarness(1077);
 await usePool(async(_pool,store)=>{
  assert.equal((await h.gate(store).inspect(h.scope)).fixture_trust_checkpoint_current,true);
  h.tick(20);h.rotate('finance');h.setMissingRevocation(true);
  let r=await h.gate(store).inspect(h.scope);safe(r);
  assert.equal(r.reason_code,'TRUST_REVOCATION_PROOF_MISSING');
  assert.equal((await store.read(h.scope)).trust_revision,1);
  h.setMissingRevocation(false);
  r=await h.gate(store).inspect(h.scope);safe(r);
  assert.equal(r.fixture_trust_checkpoint_current,true);
  const saved=await store.read(h.scope);
  assert.equal(saved.trust_revision,2);
  assert.ok(saved.revoked_key_ids.includes('finance-fixture-001'));
  h.setFault('finance','old_key');
  r=await h.gate(store).inspect(h.scope);safe(r);
  assert.equal(r.reason_code,'TRUST_SOURCE_ENVELOPE_INVALID');
  assert.equal((await store.read(h.scope)).trust_revision,2);
 });
});
test('V107-E2E-05 signed same-version conflict and three-source causal disagreement fail closed',async()=>{
 const h=makeHarness(1078);
 await usePool(async(_pool,store)=>{
  assert.equal((await h.gate(store).inspect(h.scope)).fixture_trust_checkpoint_current,true);
  h.src.finance.evidence_digest='f'.repeat(64);
  let r=await h.gate(store).inspect(h.scope);safe(r);
  assert.equal(r.reason_code,'TRUST_CHECKPOINT_REJECTED_OR_ROLLED_BACK');
  assert.equal((await store.read(h.scope)).domains.finance.evidence_digest,'a'.repeat(64));
  h.src.finance.version=2;
  h.src.finance.generation=2;
  r=await h.gate(store).inspect(h.scope);safe(r);
  assert.equal(r.reason_code,'TRUST_CROSS_DOMAIN_CAUSAL_CONFLICT');
  assert.equal((await store.read(h.scope)).domains.finance.source_revision,1);
 });
});
test('V107-E2E-06 commit failure rolls back verified signed sources; retry commits once',async()=>{
 const h=makeHarness(1079),pool=createPool();
 try{
  const clean=createIsolatedPostgresCheckpointStore({pool});
  const bad=createIsolatedPostgresCheckpointStore({pool,
   beforeCommit:async()=>{throw Error('synthetic-commit-failure');}});
  const result=await h.gate(bad).inspect(h.scope);safe(result);
  assert.equal(result.reason_code,'TRUST_CHECKPOINT_STORE_UNAVAILABLE');
  assert.equal(await clean.read(h.scope),null);
  const recovered=await h.gate(clean).inspect(h.scope);safe(recovered);
  assert.equal(recovered.fixture_trust_checkpoint_current,true);
  assert.equal((await clean.read(h.scope)).trust_revision,1);
 }finally{await pool.end();}
});
test('V107-E2E-07 competing signed reports cannot commit conflicting same-version evidence',async()=>{
 const h=makeHarness(1080),p1=createPool(),p2=createPool();
 try{
  const store1=createIsolatedPostgresCheckpointStore({pool:p1});
  const store2=createIsolatedPostgresCheckpointStore({pool:p2});
  const variant=Object.fromEntries(domains.map(d=>[d,async()=>{
   const change=d==='finance'?{evidence_digest:'f'.repeat(64)}:{};
   return h.proof(d,change);
  }]));
  const [a,b]=await Promise.all([
   h.gate(store1).inspect(h.scope),
   h.gate(store2,{sourceReaders:variant}).inspect(h.scope)
  ]);
  safe(a);safe(b);
  assert.equal([a,b].filter(x=>x.fixture_trust_checkpoint_current===true).length,1);
  assert.equal([a,b].filter(x=>
   x.reason_code==='TRUST_CHECKPOINT_REJECTED_OR_ROLLED_BACK').length,1);
  const saved=await store1.read(h.scope);
  assert.ok(['a'.repeat(64),'f'.repeat(64)]
   .includes(saved.domains.finance.evidence_digest));
 }finally{await Promise.all([p1.end(),p2.end()]);}
});
test('V107-E2E-08 signed source cannot bypass PostgreSQL tenant row-level policy',async()=>{
 const h=makeHarness(1081),p=createPool('v106_writer_b');
 try{
  const store=createIsolatedPostgresCheckpointStore({pool:p});
  const r=await h.gate(store).inspect(h.scope);safe(r);
  assert.equal(r.reason_code,'TRUST_CHECKPOINT_STORE_UNAVAILABLE');
  assert.equal(await store.read(h.scope),null);
 }finally{await p.end();}
});
test('V107-E2E-09 upstream V101 facade stays blocked with genuine signed/PostgreSQL watermark',async()=>{
 const h=makeHarness(1082);
 await usePool(async(_pool,store)=>{
  const signedStore=h.gate(store);
  const falseFlags={
   hold_active:true,external_authority_verified:false,finance_authorized:false,
   academic_authorized:false,handoff_allowed:false,compensation_write_allowed:false,
   release_eligible:false
  };
  const digest='a'.repeat(64),receipt='b'.repeat(64);
  const facade=createIsolatedReadOnlyVerificationFacade({
   getFixtureWatermark:signedStore.getFixtureWatermark,
   unifiedRecoveryGate:{report:async()=>({...falseFlags,
    reason_code:'BLOCKED_EXTERNAL_HANDOFF_WITH_CURRENT_FIXTURE_RECOVERY',
    fixture_combined_consistency:true,fixture_recovery_current:true,
    comparison_digest:'c'.repeat(64),remaining_count:0,pending_tasks:[],
    recovery_expires_at_ms:1100000,
    external_requirements:['finance_independent_signature',
     'academic_independent_signature','order_payment_reconciliation',
     'lesson_entitlement_reconciliation','three_party_acceptance',
     'atomic_handoff_receipt'].map(code=>({code,status:'requires_external_authority'}))})},
   finalReview:{verify:async()=>({...falseFlags,
    reason_code:'BLOCKED_CURRENT_FIXTURE_FINAL_REVIEW_NO_AUTHORITY',
    fixture_final_review_current:true,snapshot_digest:digest})},
   attestation:{report:async()=>({...falseFlags,
    reason_code:'BLOCKED_CI_ATTESTATION_COMPLETE_NO_EXTERNAL_AUTHORITY',
    fixture_acknowledgement_current:true,current_snapshot_digest:digest,
    acknowledgement_digest:receipt,completed_steps:5,required_steps:5})},
   attestationLifecycle:{inspect:async()=>({...falseFlags,
    reason_code:'BLOCKED_CURRENT_ADMINISTRATIVE_ACKNOWLEDGEMENT',
    fixture_acknowledgement_current:true,acknowledgement_digest:receipt,
    history_count:5})}
  });
  const reference={...h.scope,
   final_reference:{source_digest:'d'.repeat(64),revocation_reference:{}},
   diff_reference:{...h.scope,previous_audit_sequence:1,
    previous_audit_digest:'e'.repeat(64),new_audit_sequence:2,
    new_audit_digest:'f'.repeat(64)}};
  const input={reference,snapshot_digest:digest,acknowledgement_digest:receipt,
   afterFirstRead:async()=>{}};
  const good=await facade.verify(input);safe(good);
  assert.equal(good.reason_code,'BLOCKED_CURRENT_FIXTURE_REVIEW_WITH_EXTERNAL_GAPS');
  assert.equal(good.external_gap_count,6);
  h.src.finance.fault='bad_signature';
  const bad=await facade.verify(input);safe(bad);
  assert.equal(bad.reason_code,'READ_ONLY_VERIFICATION_DEPENDENCY_UNAVAILABLE');
  assert.equal(bad.fixture_internal_review_current,false);
 });
});
