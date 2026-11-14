import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {normalizeUntrustedAuthorityCandidate} from '../../src/cross-module-authority-contract.mjs';
import {verifyReadOnlyFixtureEnvelope,fixtureReadOnlySigningBytes} from '../../src/cross-module-fixture-source-verifier.mjs';

const now=Date.now();
const iso=t=>new Date(t).toISOString();
const financePayload={
 schema_version:'v3.2-27-readonly-v1',
 department:'finance',source_kind:'finance_receipt',
 source_system:'fictional_finance',source_tenant:'fictional_org_a',
 source_object_ref:'receipt:fictional-001',source_revision:'v1',
 reported_status:'unverified_response',observed_at:iso(now-90_000),
 facts:{currency:'CNY',amount_cents:1000,
  original_record_ref:'order:fictional-001'}
};
const academicPayload={
 ...financePayload,department:'academic',source_kind:'crm_entitlement',
 source_system:'fictional_crm',source_object_ref:'package:fictional-001',
 reported_status:'result_unknown',
 facts:{student_ref:'student:fictional-a',package_ref:'package:fictional-a',
  delivered_units:10,consumed_units:4,remaining_units:6}
};
const fKeys=generateKeyPairSync('ed25519');
const aKeys=generateKeyPairSync('ed25519');
const fPublic=fKeys.publicKey.export({type:'spki',format:'pem'});
const aPublic=aKeys.publicKey.export({type:'spki',format:'pem'});
const src={
 finance:{
  environment:'isolated-fictional',department:'finance',
  tenant:'fictional_org_a',sourceSystem:'fictional_finance',
  issuer:'issuer:fictional-finance',audience:'readonly:fictional-crm',
  keyId:'key:fixture-finance-01',publicKeyPem:fPublic,
  activeFrom:iso(now-86_400_000),expiresAt:iso(now+86_400_000)
 },
 academic:{
  environment:'isolated-fictional',department:'academic',
  tenant:'fictional_org_a',sourceSystem:'fictional_crm',
  issuer:'issuer:fictional-academic',audience:'readonly:fictional-crm',
  keyId:'key:fixture-academic-01',publicKeyPem:aPublic,
  activeFrom:iso(now-86_400_000),expiresAt:iso(now+86_400_000)
 }
};
const config=(department='finance',ledger=new Map(),overrides={})=>({
 trustedFixtures:[src.finance,src.academic],
 expectedDepartment:department,
 expectedTenant:'fictional_org_a',
 expectedAudience:'readonly:fictional-crm',
 nowMs:now,
 ledger,
 ...overrides
});
function envelope(department='finance',overrides={},payloadOverride){
 const ref=src[department];
 const payload=payloadOverride|| (department==='finance'?financePayload:academicPayload);
 const payloadHash=normalizeUntrustedAuthorityCandidate(payload,{
  expectedDepartment:department,expectedTenant:'fictional_org_a',
  allowedSourceSystems:[ref.sourceSystem],nowMs:now
 }).candidate_sha256;
 const out={
  schema_version:'v3.2-28-fixture-transport-v1',
  department,source_system:ref.sourceSystem,source_tenant:ref.tenant,
  issuer:ref.issuer,audience:ref.audience,key_id:ref.keyId,
  batch_id:'batch:fictional-0001',page_index:1,
  previous_cursor:null,next_cursor:null,is_final_page:true,
  source_sequence:1,source_watermark:100,
  issued_at:iso(now-1000),payload_sha256:payloadHash,payload,signature:''
 };
 Object.assign(out,overrides);
 const secret=department==='finance'?fKeys.privateKey:aKeys.privateKey;
 out.signature=sign(null,fixtureReadOnlySigningBytes(out),secret).toString('base64url');
 return out;
}
const verify=(x,ctx=config())=>verifyReadOnlyFixtureEnvelope(x,ctx);
const rejected=fn=>assert.throws(fn,e=>e.code==='SOURCE_FIXTURE_REJECTED');

test('V3.2-28 Ed25519 fixture source preparation never grants real correction authority',async t=>{
 await t.test('finance fixture verifies only transport, not financial authority',()=>{
  const x=verify(envelope());
  assert.equal(x.fixture_signature_verified,true);
  assert.equal(x.fixture_replay,'new');
  assert.equal(x.fixture_complete_page_chain,true);
  assert.equal(x.observed_source_watermark,100);
  for(const field of [
   'source_authenticated','finance_authority_verified',
   'crm_authority_verified','execution_allowed','release_allowed'])
   assert.equal(x[field],false,field);
 });
 await t.test('CRM fixture with unknown response cannot prove hours were not issued',()=>{
  const x=verify(envelope('academic'),config('academic'));
  assert.equal(x.fixture_signature_verified,true);
  assert.equal(x.execution_allowed,false);
  assert.equal(x.release_allowed,false);
 });
 await t.test('identical signed replay is idempotent, changed same-sequence content denied',()=>{
  const ledger=new Map(),c=config('finance',ledger),a=envelope();
  verify(a,c);
  assert.equal(verify(a,c).fixture_replay,'identical');
  const changed=envelope('finance',{source_watermark:101});
  rejected(()=>verify(changed,c));
  assert.equal(ledger.size,1);
 });
 await t.test('two-page source flow validates signed next cursor and final page',()=>{
  const ledger=new Map(),c=config('finance',ledger);
  const first=envelope('finance',{
   is_final_page:false,next_cursor:'cursor:page-two'
  });
  const one=verify(first,c);
  assert.equal(one.fixture_complete_page_chain,false);
  const second=envelope('finance',{
   source_sequence:2,page_index:2,
   previous_cursor:'cursor:page-two',source_watermark:102,
   is_final_page:true,next_cursor:null
  });
  const two=verify(second,c);
  assert.equal(two.fixture_complete_page_chain,true);
  assert.equal(two.execution_allowed,false);
  const third=envelope('finance',{
   batch_id:'batch:fictional-0002',source_sequence:3,page_index:1,
   previous_cursor:null,source_watermark:105
  });
  assert.equal(verify(third,c).observed_source_watermark,105);
 });
 await t.test('gap, rollback, incomplete batch and cursor mismatch fail closed',()=>{
  const setup=()=>{const ledger=new Map();const c=config('finance',ledger);
   verify(envelope('finance',{is_final_page:false,next_cursor:'cursor:page-two'}),c);
   return c;};
  rejected(()=>verify(envelope('finance',{source_sequence:3,page_index:2,previous_cursor:'cursor:page-two'}),setup()));
  rejected(()=>verify(envelope('finance',{source_sequence:2,page_index:2,previous_cursor:'cursor:wrong'}),setup()));
  rejected(()=>verify(envelope('finance',{source_sequence:2,page_index:2,
   previous_cursor:'cursor:page-two',source_watermark:99}),setup()));
  rejected(()=>verify(envelope('finance',{source_sequence:2,page_index:1,
   batch_id:'batch:fictional-0002'}),setup()));
  rejected(()=>verify(envelope('finance',{source_sequence:2,page_index:1,
   previous_cursor:null}),setup()));
 });
 const tamper=[
  ['issuer mismatch',{issuer:'issuer:fake-provider'}],
  ['audience mismatch',{audience:'readonly:attacker'}],
  ['tenant mismatch',{source_tenant:'fictional_org_b'}],
  ['system mismatch',{source_system:'attacker_proxy'}],
  ['unknown key ID',{key_id:'key:attacker-000001'}],
  ['invalid batch index',{page_index:0}],
  ['zero sequence',{source_sequence:0}],
  ['negative watermark',{source_watermark:-1}],
  ['partial page lacking cursor',{is_final_page:false,next_cursor:null}],
  ['final page with cursor',{is_final_page:true,next_cursor:'cursor:extra'}],
  ['orphan cursor',{previous_cursor:'cursor:unverified'}],
  ['too old signature',{issued_at:iso(now-11*60_000)}],
  ['future signature',{issued_at:iso(now+100_000)}],
  ['wrong source payload digest',{payload_sha256:'f'.repeat(64)}],
  ['foreign schema',{schema_version:'v3.2-29-unsafe-transport'}]
 ];
 for(const [name,patch] of tamper)
  await t.test('reject '+name,()=>rejected(()=>verify(envelope('finance',patch))));
 await t.test('real unsigned tampering cannot change any payload fact',()=>{
  const x=envelope();x.payload={...x.payload,
   facts:{...x.payload.facts,amount_cents:999999}};
  rejected(()=>verify(x));
 });
 await t.test('real unsigned tampering cannot change signed sequence',()=>{
  const x=envelope();x.source_watermark=999;
  rejected(()=>verify(x));
 });
 await t.test('modified signature fails',()=>{
  const x=envelope();x.signature='A'+x.signature.slice(1);
  rejected(()=>verify(x));
 });
 await t.test('wrong key despite same source name fails',()=>{
  const x=envelope();
  rejected(()=>verify(x,config('finance',new Map(),{
   trustedFixtures:[{...src.finance,publicKeyPem:aPublic}]
  })));
 });
 await t.test('duplicate key mapping cannot silently choose one',()=>{
  const x=envelope();
  rejected(()=>verify(x,config('finance',new Map(),{
   trustedFixtures:[src.finance,{...src.finance}]
  })));
 });
 await t.test('production or missing trust environment is not allowed',()=>{
  const x=envelope();
  rejected(()=>verify(x,config('finance',new Map(),{
   trustedFixtures:[{...src.finance,environment:'production'}]
  })));
  rejected(()=>verify(x,config('finance',new Map(),{trustedFixtures:[]})));
 });
 await t.test('expired or not-yet-active fixture keys rejected',()=>{
  const x=envelope();
  rejected(()=>verify(x,config('finance',new Map(),{
   trustedFixtures:[{...src.finance,expiresAt:iso(now-100)}]
  })));
  rejected(()=>verify(x,config('finance',new Map(),{
   trustedFixtures:[{...src.finance,activeFrom:iso(now+1000)}]
  })));
 });
 await t.test('missing, malformed and wrong configured context fail closed',()=>{
  const x=envelope();
  rejected(()=>verify(x,{...config(),ledger:undefined}));
  rejected(()=>verify(x,{...config(),expectedDepartment:'academic'}));
  rejected(()=>verify(x,{...config(),expectedTenant:'fictional_org_b'}));
  rejected(()=>verify(x,{...config(),expectedAudience:'readonly:other-test'}));
  rejected(()=>verify({...x,execution_allowed:true}));
  rejected(()=>verify({...x,signature:null}));
 });
 await t.test('old sequence replay cannot jump backwards even with valid signatures',()=>{
  const ledger=new Map(),c=config('finance',ledger);
  verify(envelope(),c);
  verify(envelope('finance',{source_sequence:2,page_index:1,
   batch_id:'batch:fictional-0002',source_watermark:200}),c);
  rejected(()=>verify(envelope(),c));
 });
});
