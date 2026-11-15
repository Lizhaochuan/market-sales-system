import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {createIsolatedSourceTrustFence} from '../../src/cross-module-source-trust-fence.mjs';

const org='11111111-1111-4111-8111-111111111111';
const incident='33333333-3333-4333-8333-333333333333';
const scope={organization_id:org,incident_id:incident};
const domains=['sales','finance','academic'];
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const PEM=k=>k.publicKey.export({format:'pem',type:'spki'});
const enc=(object,privateKey)=>sign(null,Buffer.from(JSON.stringify(object)),privateKey)
 .toString('base64url');

function sharedStore(){
 const records=new Map(),queue=new Map();
 const advance=async(s,c)=>{
  const sk=s.organization_id+'|'+s.incident_id;
  const before=queue.get(sk)||Promise.resolve();
  const run=before.catch(()=>{}).then(()=>{
   const row=records.get(sk);
   let valid=true;
   if(row){
    const older=row;
    valid=c.trust_revision>=older.trust_revision&&
     c.incident_generation>=older.incident_generation&&
     c.revocation_sequence>=older.revocation_sequence&&
     c.observed_at_ms>=older.observed_at_ms&&
     (c.revocation_sequence!==older.revocation_sequence||
      c.revocation_digest===older.revocation_digest)&&
     (c.trust_revision!==older.trust_revision||
      c.roster_digest===older.roster_digest)&&
     domains.every(d=>{
      const n=c.domains[d],p=older.domains[d];
      return n.source_epoch>=p.source_epoch&&
       (n.source_epoch!==p.source_epoch||n.source_revision>=p.source_revision)&&
       (n.source_epoch!==p.source_epoch||n.source_revision!==p.source_revision||
        n.evidence_digest===p.evidence_digest);
     })&&domains.every(d=>
       c.active_key_ids[d]===older.active_key_ids[d]||
       (c.trust_revision>older.trust_revision&&
        c.revoked_key_ids.includes(older.active_key_ids[d])));
   }
   if(valid)records.set(sk,structuredClone(c));
   return {accepted:valid,checkpoint_digest:digest(c),
    reason_code:valid?'CHECKPOINT_ACCEPTED':'PERSISTED_CHECKPOINT_CONFLICT'};
  });
  queue.set(sk,run);
  try{return await run;}finally{if(queue.get(sk)===run)queue.delete(sk);}
 };
 return {advance,count:()=>records.size,read:()=>records.get(org+'|'+incident)};
}
function fixture(){
 let time=1000000,trustRevision=1,
  badGovernance=false,badSource=false,badScope=false,
  missingRevocation=false,malformedTrust=false,
  expired=false,dropFinance=false,slow=false,readCount=0;
 const gov=generateKeyPairSync('ed25519');
 const keys=Object.fromEntries(domains.map(d=>[d,[{
  key_id:d+'-key-001',pair:generateKeyPairSync('ed25519'),
  status:'active',activated_at_ms:900000
 }]]));
 const state=Object.fromEntries(domains.map(d=>[d,{
  source_epoch:1,source_revision:1,
  incident_generation:1,revocation_sequence:0,
  revocation_digest:'d'.repeat(64),evidence_digest:'a'.repeat(64)
 }]));
 const store=sharedStore();
 const revocations=[];
 function roster(){
  readCount++;
  const payload={
   schema_version:'v3.2-104-ci-trust-roster-v1',
   organization_id:badScope?'22222222-2222-4222-8222-222222222222':org,
   revision:trustRevision,issued_at_ms:time-1000,
   expires_at_ms:expired?time-1:time+60000,
   keys:domains.flatMap(d=>keys[d].map(k=>({
    domain:d,key_id:k.key_id,public_key_pem:PEM(k.pair),
    status:k.status,activated_at_ms:k.activated_at_ms
   }))),
   revocations:missingRevocation?[]:revocations.map(x=>({...x})),
   fixture_only:true
  };
  const signature=enc(payload,badGovernance?
   generateKeyPairSync('ed25519').privateKey:gov.privateKey);
  return malformedTrust?{...payload,signature,extra_auth:true}:
   {...payload,signature};
 }
 const sources=Object.fromEntries(domains.map(d=>[d,async()=>{
  if(dropFinance&&d==='finance')throw Error('missing source');
  if(slow&&d==='academic')
   await new Promise(resolve=>setTimeout(resolve,75));
  const k=keys[d].find(x=>x.status==='active');
  const s=state[d];
  const p={
   schema_version:'v3.2-104-ci-source-proof-v1',
   domain:d,organization_id:org,incident_id:incident,
   key_id:k.key_id,trust_revision:trustRevision,
   source_epoch:s.source_epoch,source_revision:s.source_revision,
   incident_generation:s.incident_generation,
   revocation_sequence:s.revocation_sequence,
   revocation_digest:s.revocation_digest,
   evidence_digest:s.evidence_digest,issued_at_ms:time-1000,
   expires_at_ms:time+60000,fixture_only:true
  };
  return {...p,signature:enc(p,badSource&&d==='finance'?
   generateKeyPairSync('ed25519').privateKey:k.pair.privateKey)};
 }]));
 function rotate(d){
  const old=keys[d].find(x=>x.status==='active');
  old.status='revoked';
  revocations.push({domain:d,key_id:old.key_id,
   sequence:revocations.length+1,revoked_at_ms:time-900});
  keys[d].push({key_id:d+'-key-'+String(keys[d].length+1).padStart(3,'0'),
   pair:generateKeyPairSync('ed25519'),status:'active',
   activated_at_ms:time-950});
  trustRevision++;
 }
 const create=(overrides={})=>createIsolatedSourceTrustFence({
  readTrustRoster:async()=>roster(),sourceReaders:sources,
  governancePublicKey:PEM(gov),checkpointStore:store,
  getFixtureNow:()=>time,timeoutMs:35,...overrides
 });
 const gate=create();
 return {gate,create,store,scope,keys,state,roster,rotate,
  modify:(d,patch)=>Object.assign(state[d],patch),
  all:patch=>domains.forEach(d=>Object.assign(state[d],patch)),
  clock:x=>time=x,tick:n=>time+=n,
  badGovernance:x=>badGovernance=x,badSource:x=>badSource=x,
  badScope:x=>badScope=x,missingRevocation:x=>missingRevocation=x,
  malformedTrust:x=>malformedTrust=x,expired:x=>expired=x,
  dropFinance:x=>dropFinance=x,slow:x=>slow=x,
  readCount:()=>readCount};
}
function safe(result){
 assert.ok(Object.isFrozen(result));
 assert.equal(result.hold_active,true);
 for(const key of ['external_authority_verified','finance_authorized',
  'academic_authorized','handoff_allowed','compensation_write_allowed',
  'release_eligible','production_integration_allowed'])
   assert.equal(result[key],false,key);
}

test('V3.2-104 signed fixture governance roster and atomic checkpoint never grant real approval',async()=>{
 const f=fixture();
 const x=await f.gate.inspect(scope);safe(x);
 assert.equal(x.reason_code,'BLOCKED_FIXTURE_TRUST_FENCE_NO_EXTERNAL_AUTHORITY');
 assert.equal(x.fixture_trust_checkpoint_current,true);
 assert.equal(f.store.count(),1);
 const w=await f.gate.getFixtureWatermark(org,incident);
 assert.equal(w.organization_id,org);
 assert.equal(w.incident_id,incident);
 assert.ok(Object.isFrozen(w));
});
test('V3.2-104 non-governance signatures, invalid rosters and source signatures are rejected',async()=>{
 const f=fixture();f.badGovernance(true);
 let r=await f.gate.inspect(scope);safe(r);
 assert.equal(r.reason_code,'TRUST_GOVERNANCE_SIGNATURE_INVALID');
 f.badGovernance(false);f.malformedTrust(true);
 r=await f.gate.inspect(scope);safe(r);
 assert.equal(r.reason_code,'TRUST_ROSTER_INVALID');
 f.malformedTrust(false);f.badSource(true);
 r=await f.gate.inspect(scope);safe(r);
 assert.equal(r.reason_code,'TRUST_SOURCE_SIGNATURE_INVALID');
});
test('V3.2-104 rotation requires signed roster with old-key revocation event',async()=>{
 const f=fixture();
 await f.gate.getFixtureWatermark(org,incident);
 f.rotate('finance');
 f.missingRevocation(true);
 let r=await f.gate.inspect(scope);safe(r);
 assert.equal(r.reason_code,'TRUST_REVOCATION_PROOF_MISSING');
 f.missingRevocation(false);
 r=await f.gate.inspect(scope);safe(r);
 assert.equal(r.fixture_trust_checkpoint_current,true);
 assert.equal(f.store.read().trust_revision,2);
 assert.equal(f.store.read().revoked_key_ids.includes('finance-key-001'),true);
});
test('V3.2-104 shared checkpointer resists restart replay of old signed roster',async()=>{
 const f=fixture();await f.gate.getFixtureWatermark(org,incident);
 f.all({source_epoch:2,source_revision:3,incident_generation:2,
  revocation_sequence:2,revocation_digest:'e'.repeat(64),
  evidence_digest:'b'.repeat(64)});
 await f.gate.getFixtureWatermark(org,incident);
 const before=f.store.read();
 f.all({source_epoch:1,source_revision:1,incident_generation:1,
  revocation_sequence:0,revocation_digest:'d'.repeat(64),
  evidence_digest:'a'.repeat(64)});
 const restarted=f.create();
 const result=await restarted.inspect(scope);safe(result);
 assert.equal(result.reason_code,'TRUST_CHECKPOINT_REJECTED_OR_ROLLED_BACK');
 assert.equal(f.store.read().revocation_sequence,before.revocation_sequence);
 assert.equal(f.store.read().domains.finance.source_revision,3);
});
test('V3.2-104 roster rollback is refused across isolated gate instances',async()=>{
 const f=fixture();
 f.rotate('academic');
 await f.gate.getFixtureWatermark(org,incident);
 // New governance-signed roster revision cannot silently disappear after restart.
 const fake=f.roster();
 const modified={...fake,revision:1}; // signature will not match.
 const gate=f.create({readTrustRoster:async()=>modified});
 const r=await gate.inspect(scope);safe(r);
 assert.equal(r.reason_code,'TRUST_GOVERNANCE_SIGNATURE_INVALID');
});
test('V3.2-104 cross-domain causal mismatch, wrong tenant and expired roster reject',async()=>{
 const f=fixture();f.modify('finance',{incident_generation:2});
 let r=await f.gate.inspect(scope);safe(r);
 assert.equal(r.reason_code,'TRUST_CROSS_DOMAIN_CAUSAL_CONFLICT');
 f.modify('finance',{incident_generation:1});
 f.badScope(true);r=await f.gate.inspect(scope);safe(r);
 assert.equal(r.reason_code,'TRUST_ROSTER_INVALID');
 f.badScope(false);f.expired(true);
 r=await f.gate.inspect(scope);safe(r);
 assert.equal(r.reason_code,'TRUST_ROSTER_INVALID');
});
test('V3.2-104 source outage and timeout block without committing checkpoint',async()=>{
 const f=fixture();f.dropFinance(true);
 let r=await f.gate.inspect(scope);safe(r);
 assert.equal(r.reason_code,'TRUST_SOURCE_UNAVAILABLE');
 assert.equal(f.store.count(),0);
 f.dropFinance(false);f.slow(true);
 r=await f.gate.inspect(scope);safe(r);
 assert.equal(r.reason_code,'TRUST_SOURCE_TIMEOUT');
 assert.equal(f.store.count(),0);
});
test('V3.2-104 store failure or unverified success is not a valid fence',async()=>{
 const f=fixture();
 const bad=f.create({checkpointStore:{advance:async()=>({
  accepted:true,checkpoint_digest:'0'.repeat(64),
  reason_code:'CHECKPOINT_ACCEPTED'})}});
 const r=await bad.inspect(scope);safe(r);
 assert.equal(r.reason_code,'TRUST_CHECKPOINT_STORE_UNVERIFIED');
 const unavailable=f.create({checkpointStore:{advance:async()=>{throw Error('DB down');}}});
 const x=await unavailable.inspect(scope);safe(x);
 assert.equal(x.reason_code,'TRUST_CHECKPOINT_STORE_UNAVAILABLE');
});
test('V3.2-104 competing checkpoint advances must be rejected by store CAS',async()=>{
 const f=fixture();await f.gate.getFixtureWatermark(org,incident);
 f.all({source_revision:2,evidence_digest:'b'.repeat(64)});
 await f.gate.getFixtureWatermark(org,incident);
 // Simulate competing process: new instance sees older but signed values.
 const old=f.create();f.all({source_revision:1,evidence_digest:'a'.repeat(64)});
 const r=await old.inspect(scope);safe(r);
 assert.equal(r.reason_code,'TRUST_CHECKPOINT_REJECTED_OR_ROLLED_BACK');
});
test('V3.2-104 missing durable production store remains an explicit contract blocker',()=>{
 const f=fixture();
 assert.throws(()=>f.create({checkpointStore:{}}),TypeError);
 // The shared fixture store survives instance recreation but not Node process exit.
 // No production persistence, trusted root or finance/academic signoff is claimed.
 assert.equal(f.store.count(),0);
});
