import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createIsolatedFreezeHandoffLineage} from '../../src/cross-module-freeze-handoff-lineage.mjs';
const org='11111111-1111-4111-8111-111111111111',incident='33333333-3333-4333-8333-333333333333';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
function fixture(){
 let current=true,allowReceipt=true,rows=[];
 const reference={organization_id:org,incident_id:incident,
  final_reference:{source_digest:'c'.repeat(64),revocation_reference:{}},
  diff_reference:{organization_id:org,incident_id:incident,
   previous_audit_sequence:1,previous_audit_digest:'d'.repeat(64),
   new_audit_sequence:2,new_audit_digest:'e'.repeat(64)}};
 function add(){
  const p={organization_id:org,incident_id:incident,sequence:rows.length+1,
   previous_digest:rows.at(-1)?.freeze_digest||'0'.repeat(64),
   fixture_only:true,hold_active:true,handoff_allowed:false};
  const record=Object.freeze({...p,freeze_digest:hash(p)});
  rows=[...rows,record];return record;
 }
 const old=add(),newer=add();
 const freezeRegistry={audit:async()=>rows,verify:async({freeze_digest})=>({
  reason_code:current&&freeze_digest===rows.at(-1).freeze_digest?
   'BLOCKED_CURRENT_FIXTURE_FREEZE_NO_EXTERNAL_AUTHORITY':'SUPERSEDED_FREEZE_NOT_CURRENT',
  fixture_freeze_current:current&&freeze_digest===rows.at(-1).freeze_digest,
  hold_active:true,handoff_allowed:false,release_eligible:false})};
 const receipt=async({new_freeze_digest})=>({
  reason_code:allowReceipt?'BLOCKED_NEW_FIXTURE_FREEZE_NOT_REAL_HANDOFF':'RECHECK_TASKS_INCOMPLETE_OR_STALE',
  fixture_refreeze_recorded:allowReceipt,new_freeze_digest,hold_active:true,
  handoff_allowed:false,finance_authorized:false,academic_authorized:false,
  compensation_write_allowed:false,release_eligible:false});
 const gate=createIsolatedFreezeHandoffLineage({
  freezeRegistry,getFixtureRefreezeReceipt:receipt});
 const link=(a=old.freeze_digest,b=newer.freeze_digest,idempotency_key='v92-lineage-nonce-00001')=>
  gate.link({reference,old_freeze_digest:a,new_freeze_digest:b,idempotency_key});
 const inspect=(digest)=>gate.inspect({reference,freeze_digest:digest});
 return {gate,reference,old,newer,add,link,inspect,
  setCurrent:x=>current=x,setReceipt:x=>allowReceipt=x};
}
function safe(r){
 assert.equal(r.hold_active,true);
 for(const k of ['external_authority_verified','finance_authorized','academic_authorized',
  'handoff_allowed','compensation_write_allowed','release_eligible'])assert.equal(r[k],false,k);
 assert.ok(Object.isFrozen(r));
}
test('V3.2-92 adjacent verified replacement links and old record stays forbidden',async()=>{
 const f=fixture();const x=await f.link();safe(x);
 assert.equal(x.reason_code,'BLOCKED_FIXTURE_FREEZE_SUCCESSION_RECORDED');
 assert.equal(x.record.old_freeze_digest,f.old.freeze_digest);
 assert.equal(x.record.new_freeze_digest,f.newer.freeze_digest);
 const prior=await f.inspect(f.old.freeze_digest);safe(prior);
 assert.equal(prior.reason_code,'HISTORICAL_SUPERSEDED_FREEZE_BLOCKED');
 const newest=await f.inspect(f.newer.freeze_digest);safe(newest);
 assert.equal(newest.fixture_lineage_current,true);
});
test('V3.2-92 refuse unverified replacement, invalidated current and nonadjacent links',async()=>{
 const f=fixture();f.setReceipt(false);
 let r=await f.link();safe(r);
 assert.equal(r.reason_code,'GATED_REFREEZE_RECEIPT_UNVERIFIED');
 f.setReceipt(true);f.setCurrent(false);
 r=await f.link();safe(r);assert.equal(r.reason_code,'NEW_FREEZE_NOT_CURRENT');
 f.setCurrent(true);const third=f.add();
 r=await f.link();safe(r);assert.equal(r.reason_code,'NONADJACENT_OR_SUPERSEDED_FREEZE');
});
test('V3.2-92 prevent duplicate lineage and conflicting nonce, never revive old freeze',async()=>{
 const f=fixture();await f.link();
 const replay=await f.link();safe(replay);
 assert.equal(replay.reason_code,'BLOCKED_HISTORICAL_LINEAGE_REPLAY');
 const conflict=await f.link(f.old.freeze_digest,'f'.repeat(64));safe(conflict);
 assert.equal(conflict.reason_code,'FREEZE_LINEAGE_NONCE_CONFLICT');
 const duplicate=await f.link(f.old.freeze_digest,f.newer.freeze_digest,'v92-lineage-nonce-00002');
 safe(duplicate);assert.equal(duplicate.reason_code,'FREEZE_LINEAGE_FORK_OR_DUPLICATE');
});
test('V3.2-92 source changes invalidate current linked report and forged scope fails',async()=>{
 const f=fixture();await f.link();f.setCurrent(false);
 const x=await f.inspect(f.newer.freeze_digest);safe(x);
 assert.equal(x.reason_code,'LINKED_FREEZE_NOW_STALE');
 const forged=await f.gate.link({reference:f.reference,
  old_freeze_digest:f.old.freeze_digest,new_freeze_digest:f.newer.freeze_digest,
  idempotency_key:'v92-lineage-nonce-00003',handoff_allowed:true});safe(forged);
 assert.equal(forged.reason_code,'INVALID_FREEZE_LINEAGE_INPUT');
});
