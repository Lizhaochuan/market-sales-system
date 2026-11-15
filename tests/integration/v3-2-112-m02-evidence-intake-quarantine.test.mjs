import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {createIsolatedEvidenceIntakeQuarantine} from '../../src/cross-module-evidence-intake-quarantine.mjs';
import {createIsolatedPostgresEvidenceIntakeLedger} from '../helpers/v3-2-112-m02-evidence-intake-ledger.mjs';

if(process.env.V106_ISOLATED_PG!=='YES_TEST_ONLY')
 throw Error('V112 tests require disposable CI PostgreSQL');
const {Pool}=pg;
const org='11111111-1111-4111-8111-111111111111';
const otherOrg='22222222-2222-4222-8222-222222222222';
const student='99999999-9999-4999-8999-999999999999';
const family='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const roles={
 sales_owner:['crm_sales','student_order_attribution'],
 finance_owner:['finance_ledger','payment_ownership_reconciliation'],
 academic_owner:['academic_ledger','lesson_fulfilment_reconciliation'],
 security_identity_owner:['identity_provider','identity_key_revocation'],
 integration_owner:['integration_service','cross_domain_barrier_contract'],
 database_owner:['audit_store','audit_checkpoint_evidence']
};
const poolFor=(role='v106_writer_a')=>new Pool({
 host:'127.0.0.1',port:5432,database:'v106_isolated',
 user:role,password:role==='v106_writer_a'?
  'ephemeral-v106-A-only':'ephemeral-v106-B-only',
 max:5,connectionTimeoutMillis:2000
});
const incident=n=>'88888888-8888-4888-8888-'+String(n).padStart(12,'0');
const submission=n=>'bbbbbbbb-bbbb-4bbb-8bbb-'+String(n).padStart(12,'0');
const scope=n=>({organization_id:org,incident_id:incident(n),student_id:student});
function claim(n,owner_role='sales_owner',change={}){
 const [claimed_source_system,evidence_type]=roles[owner_role]||roles.sales_owner;
 return {schema_version:'v3.2-112-ci-untrusted-evidence-claim-v1',
  submission_id:submission(n),organization_id:org,incident_id:incident(n),
  student_id:student,family_id:null,owner_role,
  claimed_owner_id:owner_role+'-claim-owner-001',
  claimed_submitter_id:owner_role+'-claim-submit-001',
  claimed_source_system,evidence_type,source_revision:1,
  source_revocation_sequence:0,original_history_digest:'a'.repeat(64),
  evidence_digest:'b'.repeat(64),linked_v110_notice_digest:null,
  submitted_at_ms:1000000,expires_at_ms:1100000,
  claimed_approval_state:'UNVERIFIED_SUBMISSION',
  fixture_only:true,...change};
}
const safe=r=>{
 assert.equal(Object.isFrozen(r),true);
 assert.equal(r.hold_active,true);
 for(const key of ['external_authority_verified','finance_authorized',
  'academic_authorized','handoff_allowed','compensation_write_allowed',
  'release_eligible','production_integration_allowed',
  'merge_authorized','deploy_authorized'])
  assert.equal(r[key],false,key);
};
async function withStore(fn,role='v106_writer_a'){
 const pool=poolFor(role);
 try{
  const ledger=createIsolatedPostgresEvidenceIntakeLedger({pool});
  const gate=createIsolatedEvidenceIntakeQuarantine({
   ledger,getFixtureNow:()=>1000000});
  return await fn({pool,ledger,gate});
 }finally{await pool.end();}
}

test('INTAKE-01 metadata-only unverified owner claim is quarantined in real disposable PostgreSQL',async()=>{
 await withStore(async({ledger,gate})=>{
  const c=claim(11201),r=await gate.receive(c);safe(r);
  assert.equal(r.reason_code,'BLOCKED_EVIDENCE_RECEIVED_PENDING_EXTERNAL_VERIFICATION');
  assert.equal(r.review_status,'PENDING_INDEPENDENT_VERIFICATION');
  assert.equal(r.intake_recorded,true);
  assert.equal(r.sequence,1);
  const row=await ledger.event(scope(11201),1);
  assert.equal(row.claimed_owner_id,c.claimed_owner_id);
  assert.equal(row.status,'PENDING_INDEPENDENT_VERIFICATION');
  assert.equal(row.claim_digest.length,64);
  assert.equal(row.original_order_content,undefined);
  const current=await gate.inspect(scope(11201));safe(current);
  assert.equal(current.reason_code,'BLOCKED_EVIDENCE_INTAKE_QUARANTINED');
  assert.equal(current.latest_sequence,1);
 });
});
test('INTAKE-02 all six roles can submit claims but none become verified or assigned',async()=>{
 let i=11210;
 for(const role of Object.keys(roles)){
  await withStore(async({gate,ledger})=>{
   const n=i++,result=await gate.receive(claim(n,role));safe(result);
   assert.equal(result.owner_role,role);
   assert.equal(result.review_status,'PENDING_INDEPENDENT_VERIFICATION');
   assert.equal((await ledger.event(scope(n),1)).status,'PENDING_INDEPENDENT_VERIFICATION');
  });
 }
});
test('INTAKE-03 self-approved, forged authorization or extra fields fail before any SQL insertion',async()=>{
 const patches=[
  {claimed_approval_state:'APPROVED'},
  {claimed_approval_state:'VERIFIED'},
  {finance_authorized:true},
  {handoff_allowed:true},
  {source_revocation_sequence:-1},
  {evidence_digest:'not-a-sha'},
  {claimed_submitter_id:'sales_owner-claim-owner-001'}
 ];
 let n=11220;
 for(const patch of patches){
  const id=n++;
  await withStore(async({gate,ledger})=>{
   const r=await gate.receive(claim(id,'sales_owner',patch));safe(r);
   assert.equal(r.reason_code,'EVIDENCE_INTAKE_CLAIM_INVALID_OR_PREAPPROVED');
   assert.equal(await ledger.head(scope(id)),null);
  });
 }
});
test('INTAKE-04 wrong evidence source / claimed role cannot impersonate finance or academic',async()=>{
 const n=11230;
 await withStore(async({gate,ledger})=>{
  const r=await gate.receive(claim(n,'finance_owner',{
   claimed_source_system:'academic_ledger'}));safe(r);
  assert.equal(r.reason_code,'EVIDENCE_INTAKE_CLAIM_INVALID_OR_PREAPPROVED');
  assert.equal(await ledger.head(scope(n)),null);
 });
});
test('INTAKE-05 optional sibling-family binding and V110 negative notice claim remain unverified',async()=>{
 const n=11231;
 await withStore(async({gate,ledger})=>{
  const r=await gate.receive(claim(n,'academic_owner',{
   family_id:family,linked_v110_notice_digest:'f'.repeat(64)
  }));safe(r);
  assert.equal(r.intake_recorded,true);
  assert.equal(r.finance_authorized,false);
  assert.equal(r.review_status,'PENDING_INDEPENDENT_VERIFICATION');
  assert.equal((await ledger.event(scope(n),1)).evidence_digest,'b'.repeat(64));
 });
});
test('INTAKE-06 duplicate evidence submission ID cannot be replayed after new adapter instance',async()=>{
 const n=11232;
 await withStore(async({ledger,gate})=>{
  const initial=claim(n);assert.equal((await gate.receive(initial)).intake_recorded,true);
  const restarted=createIsolatedEvidenceIntakeQuarantine({
   ledger,getFixtureNow:()=>1000000});
  const r=await restarted.receive(initial);safe(r);
  assert.equal(r.reason_code,'EVIDENCE_INTAKE_COMMIT_UNVERIFIED');
  assert.equal((await ledger.head(scope(n))).sequence,1);
 });
});
test('INTAKE-07 two competing SQL writers cannot both create the same initial sequence',async()=>{
 const n=11233,p1=poolFor(),p2=poolFor();
 try{
  const l1=createIsolatedPostgresEvidenceIntakeLedger({pool:p1});
  const l2=createIsolatedPostgresEvidenceIntakeLedger({pool:p2});
  // Barrier forces both independent instances to read the same old SQL head,
  // so the test probes a real conflicting first INSERT, not scheduler timing.
  let release,arrived=0;
  const barrier=new Promise(resolve=>{release=resolve;});
  const synchronized=ledger=>{
   let first=true;
   return {
    head:async s=>{
     const value=await ledger.head(s);
     if(first){
      first=false;
      if(++arrived===2)release();
      await barrier;
     }
     return value;
    },
    event:ledger.event,append:ledger.append
   };
  };
  const a=createIsolatedEvidenceIntakeQuarantine({
   ledger:synchronized(l1),getFixtureNow:()=>1000000});
  const b=createIsolatedEvidenceIntakeQuarantine({
   ledger:synchronized(l2),getFixtureNow:()=>1000000});
  const [ra,rb]=await Promise.all([
   a.receive(claim(n)),
   b.receive(claim(n,'finance_owner',{
    submission_id:submission(n+1000),claimed_source_system:'finance_ledger',
    evidence_type:'payment_ownership_reconciliation'
   }))
  ]);
  safe(ra);safe(rb);
  assert.equal([ra,rb].filter(x=>x.intake_recorded).length,1);
  assert.equal([ra,rb].filter(x=>x.reason_code==='EVIDENCE_INTAKE_COMMIT_UNVERIFIED').length,1);
  assert.equal((await l1.head(scope(n))).sequence,1);
 }finally{await Promise.all([p1.end(),p2.end()]);}
});
test('INTAKE-08 second distinct submission extends immutable event chain',async()=>{
 const n=11234;
 await withStore(async({ledger,gate})=>{
  const one=await gate.receive(claim(n));safe(one);
  const two=await gate.receive(claim(n,'finance_owner',{
   submission_id:submission(n+1000)}));safe(two);
  assert.equal(one.intake_recorded,true);
  assert.equal(two.intake_recorded,true);
  assert.equal(two.sequence,2);
  const latest=await ledger.event(scope(n),2);
  assert.equal(latest.previous_event_digest,one.event_digest);
  assert.equal((await ledger.head(scope(n))).event_digest,two.event_digest);
  assert.equal((await ledger.event(scope(n),1)).owner_role,'sales_owner');
 });
});
test('INTAKE-09 injected SQL precommit failure rolls back event and head together',async()=>{
 const n=11235;
 await withStore(async({ledger,pool})=>{
  const broken=createIsolatedPostgresEvidenceIntakeLedger({
   pool,beforeCommit:async()=>{throw Error('injected-transaction-failure');}
  });
  const gate=createIsolatedEvidenceIntakeQuarantine({
   ledger:broken,getFixtureNow:()=>1000000});
  const r=await gate.receive(claim(n));safe(r);
  assert.equal(r.reason_code,'EVIDENCE_INTAKE_DEPENDENCY_UNAVAILABLE');
  assert.equal(await ledger.head(scope(n)),null);
  assert.equal(await ledger.event(scope(n),1),null);
 });
});
test('INTAKE-10 lost confirmation after SQL COMMIT stays blocked even when event persisted',async()=>{
 const n=11236;
 await withStore(async({ledger})=>{
  const gate=createIsolatedEvidenceIntakeQuarantine({
   ledger,getFixtureNow:()=>1000000,
   afterCommit:async()=>{throw Error('acknowledgement-channel-lost');}
  });
  const r=await gate.receive(claim(n));safe(r);
  assert.equal(r.reason_code,'EVIDENCE_INTAKE_DEPENDENCY_UNAVAILABLE');
  assert.equal((await ledger.head(scope(n))).sequence,1);
  assert.equal((await ledger.event(scope(n),1)).status,'PENDING_INDEPENDENT_VERIFICATION');
 });
});
test('INTAKE-11 tenant B database role cannot insert into tenant A evidence log',async()=>{
 const n=11237;
 await withStore(async({gate,ledger})=>{
  const r=await gate.receive(claim(n));safe(r);
  assert.equal(r.intake_recorded,false);
  assert.equal(await ledger.head(scope(n)),null);
 },'v106_writer_b');
});
test('INTAKE-12 writer cannot update historical event or protected payment table',async()=>{
 const n=11238;
 await withStore(async({gate,pool})=>{
  assert.equal((await gate.receive(claim(n))).intake_recorded,true);
  await assert.rejects(pool.query(
   'UPDATE v106_test.evidence_intake_events SET event_digest=$1 WHERE student_id=$2',
   ['f'.repeat(64),student]),/permission denied/i);
  await assert.rejects(pool.query(
   'DELETE FROM v106_test.evidence_intake_events WHERE student_id=$1',
   [student]),/permission denied/i);
  await assert.rejects(pool.query(
   'UPDATE v106_test.protected_business_fixture SET example_payment_amount=0'),
   /permission denied/i);
 });
});
test('INTAKE-13 altered head digest is detected; no business rights are returned',async()=>{
 const n=11239;
 await withStore(async({gate,ledger,pool})=>{
  assert.equal((await gate.receive(claim(n))).intake_recorded,true);
  await pool.query(
   'UPDATE v106_test.evidence_intake_heads SET event_digest=$1 WHERE organization_id=$2 AND incident_id=$3 AND student_id=$4',
   ['f'.repeat(64),org,incident(n),student]);
  const r=await gate.inspect(scope(n));safe(r);
  assert.equal(r.reason_code,'EVIDENCE_INTAKE_EVENT_UNVERIFIED');
  assert.equal(r.intake_recorded,false);
  const append=await gate.receive(claim(n,'finance_owner',{
   submission_id:submission(n+1000)}));safe(append);
  assert.equal(append.reason_code,'EVIDENCE_INTAKE_PREVIOUS_EVENT_UNVERIFIED');
  assert.equal((await ledger.head(scope(n))).sequence,1);
 });
});
test('INTAKE-14 unknown scope, expired claim and clock rollback cannot claim verified status',async()=>{
 const n=11240;
 await withStore(async({gate,ledger,pool})=>{
  const invalid=await gate.receive(claim(n,'sales_owner',{incident_id:'invalid'}));safe(invalid);
  assert.equal(invalid.reason_code,'EVIDENCE_INTAKE_SCOPE_INVALID');
  const expired=await gate.receive(claim(n,'sales_owner',{
   submitted_at_ms:800000,expires_at_ms:999999
  }));safe(expired);
  assert.equal(expired.reason_code,'EVIDENCE_INTAKE_CLAIM_INVALID_OR_PREAPPROVED');
  assert.equal(await ledger.head(scope(n)),null);
 });
 const pool=poolFor();
 try{
  const ledger=createIsolatedPostgresEvidenceIntakeLedger({pool});
  let clock=1000000;
  const gate=createIsolatedEvidenceIntakeQuarantine({ledger,
   getFixtureNow:()=>clock});
  const id=11241;
  assert.equal((await gate.receive(claim(id))).intake_recorded,true);
  clock=999999;
  const r=await gate.receive(claim(id,'finance_owner',{
   submission_id:submission(id+1000)}));safe(r);
  assert.equal(r.reason_code,'INTAKE_CLOCK_ROLLBACK');
 }finally{await pool.end();}
});
