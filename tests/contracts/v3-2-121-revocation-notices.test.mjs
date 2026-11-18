import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveFixtureRevocationNoticeId,createIsolatedRevocationNoticeService} from '../../src/cross-module-revocation-notice-contract.mjs';
const uid=x=>('00000000-0000-4000-8000-'+String(x).padStart(12,'0'));
const a='a'.repeat(64),b='b'.repeat(64),c='c'.repeat(64);
const input={organization_id:uid(1),incident_id:uid(2),export_version:1,manifest_digest:a,revocation_event_digest:b,recipient_id:uid(3),epoch:1};
const scope=Object.fromEntries(['organization_id','incident_id','export_version','manifest_digest','revocation_event_digest'].map(k=>[k,input[k]]));
function fixture(overrides={}){
 let writes=0;
 const ledger={
  async appendNotice(n){writes++;return {notice_id:n.notice_id,state:'QUEUED',source_verified:true,durable:true,event_digest:c};},
  async sourceHeads(){return {manifest_digest:a,revocation_event_digest:b,revoked:true};},
  async listRecipients(){return [uid(3),uid(4)];},
  async listNotices(){return [{recipient_id:uid(3),epoch:1,state:'QUEUED'}];},
  ...overrides
 };
 return {svc:createIsolatedRevocationNoticeService({ledger,clock:()=>100}),writes:()=>writes};
}
test('deterministic version-and-recipient-bound id',()=>{
 assert.equal(deriveFixtureRevocationNoticeId(input),deriveFixtureRevocationNoticeId({...input}));
 assert.notEqual(deriveFixtureRevocationNoticeId(input),deriveFixtureRevocationNoticeId({...input,epoch:2}));
 assert.notEqual(deriveFixtureRevocationNoticeId(input),deriveFixtureRevocationNoticeId({...input,recipient_id:uid(4)}));
});
test('reject injected approval flags before persistence',async()=>{
 const f=fixture();
 assert.equal((await f.svc.enqueue({...input,finance_authorized:true})).reason_code,'NOTICE_INPUT_INVALID');
 assert.equal(f.writes(),0);
});
test('queued is not delivered, and does not release',async()=>{
 const result=await fixture().svc.enqueue(input);
 assert.equal(result.notice_accepted,true);
 assert.equal(result.hold_active,true);
 assert.equal(result.release_eligible,false);
 assert.equal(result.external_recipient_verified,false);
});
test('committed notice with changed revocation source remains blocked',async()=>{
 const f=fixture({sourceHeads:async()=>({manifest_digest:a,revocation_event_digest:c,revoked:true})});
 assert.equal((await f.svc.enqueue(input)).reason_code,'NOTICE_SOURCE_CHANGED_AFTER_COMMIT');
});
test('unverified SQL commit cannot be reported as queued',async()=>{
 const f=fixture({appendNotice:async n=>({notice_id:n.notice_id,state:'QUEUED',source_verified:false,durable:true,event_digest:c})});
 assert.equal((await f.svc.enqueue(input)).reason_code,'NOTICE_COMMIT_UNVERIFIED');
});
test('complete recipient enumeration shows missing holder',async()=>{
 const report=await fixture().svc.report(scope);
 assert.equal(report.recipient_count,2);
 assert.equal(report.unconfirmed_count,2);
 assert.equal(report.recipients[1].state,'NOT_QUEUED');
 assert.equal(report.hold_active,true);
});
test('even all local fixture acks cannot release',async()=>{
 const f=fixture({listNotices:async()=>[uid(3),uid(4)].map(recipient_id=>({recipient_id,state:'FIXTURE_ACKNOWLEDGED',epoch:1}))});
 const r=await f.svc.report(scope);
 assert.equal(r.all_fixture_acknowledged,true);
 assert.equal(r.real_delivery_verified,false);
 assert.equal(r.release_eligible,false);
});
test('duplicate/unknown recipients fail closed',async()=>{
 const f=fixture({listRecipients:async()=>[uid(3),uid(3)]});
 assert.equal((await f.svc.report(scope)).reason_code,'NOTICE_RECIPIENT_SET_UNVERIFIED');
});
test('unknown or duplicated ledger notices fail closed',async()=>{
 const f=fixture({listNotices:async()=>[1,2].map(()=>({recipient_id:uid(3),state:'QUEUED',epoch:1}))});
 assert.equal((await f.svc.report(scope)).reason_code,'NOTICE_HISTORY_UNVERIFIED');
});
test('source missing/rolled back fails closed',async()=>{
 const f=fixture({sourceHeads:async()=>({manifest_digest:a,revocation_event_digest:b,revoked:false})});
 assert.equal((await f.svc.report(scope)).reason_code,'NOTICE_SOURCE_UNVERIFIED');
});
test('ledger outage never enables business action',async()=>{
 const f=fixture({appendNotice:async()=>{throw Error('offline');}});
 const r=await f.svc.enqueue(input);
 assert.equal(r.notice_accepted,false);
 assert.equal(r.hold_active,true);
 assert.equal(r.reason_code,'NOTICE_DEPENDENCY_UNAVAILABLE');
});
test('invalid recipient / export version rejected',()=>{
 assert.throws(()=>deriveFixtureRevocationNoticeId({...input,recipient_id:'alice'}),{code:'NOTICE_INPUT_INVALID'});
 assert.throws(()=>deriveFixtureRevocationNoticeId({...input,export_version:0}),{code:'NOTICE_INPUT_INVALID'});
});
