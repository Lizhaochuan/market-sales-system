import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createIsolatedLineageIntegrityAudit} from '../../src/cross-module-lineage-integrity-audit.mjs';
const org='11111111-1111-4111-8111-111111111111';
const incident='33333333-3333-4333-8333-333333333333';
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
function fixture(){
 let freezes=[],links=[],current=true;
 const addFreeze=()=>{
  const payload={organization_id:org,incident_id:incident,
   sequence:freezes.length+1,previous_digest:freezes.at(-1)?.freeze_digest||'0'.repeat(64),
   fixture_only:true,hold_active:true,handoff_allowed:false};
  const row=Object.freeze({...payload,freeze_digest:sha(payload)});
  freezes=[...freezes,row];return row;
 };
 const addLink=(old,newer)=>{
  const payload={schema_version:'v3.2-92-ci-lineage-v1',organization_id:org,
   incident_id:incident,sequence:links.length+1,
   old_freeze_digest:old.freeze_digest,new_freeze_digest:newer.freeze_digest,
   previous_link_digest:links.at(-1)?.link_digest||'0'.repeat(64),
   fixture_only:true,hold_active:true,handoff_allowed:false};
  const row=Object.freeze({...payload,link_digest:sha(payload)});
  links=[...links,row];return row;
 };
 const old=addFreeze(),newer=addFreeze();addLink(old,newer);
 const gate=createIsolatedLineageIntegrityAudit({
  getFixtureFreezeHistory:async()=>freezes,
  getFixtureLineageHistory:async()=>links,
  verifyCurrentFreeze:async({freeze_digest})=>({
   reason_code:'BLOCKED_CURRENT_FIXTURE_FREEZE_NO_EXTERNAL_AUTHORITY',
   fixture_freeze_current:current&&freeze_digest===freezes.at(-1)?.freeze_digest,
   hold_active:true,handoff_allowed:false,release_eligible:false})});
 const run=(afterFirstRead=async()=>{})=>gate.audit({organization_id:org,incident_id:incident,afterFirstRead});
 return {run,old,newer,addFreeze,addLink,setFreezes:x=>freezes=x,
  setLinks:x=>links=x,setCurrent:x=>current=x,
  freezes:()=>freezes,links:()=>links,gate};
}
function safe(r){
 assert.equal(r.hold_active,true);assert.equal(r.handoff_allowed,false);
 assert.equal(r.release_eligible,false);assert.equal(r.history_repair_allowed,false);
 assert.equal(r.automatic_recovery_allowed,false);
 assert.equal(r.finance_authorized,false);assert.equal(r.academic_authorized,false);
 assert.equal(Object.isFrozen(r),true);
}
test('V3.2-93 consistent CI lineage is never production authorization',async()=>{
 const f=fixture(),r=await f.run();safe(r);
 assert.equal(r.reason_code,'BLOCKED_CI_LINEAGE_INTEGRITY_ONLY');
 assert.equal(r.fixture_integrity_current,true);
 assert.equal(r.freeze_count,2);assert.equal(r.link_count,1);
});
test('V3.2-93 missing freeze, missing link, corrupted digest and wrong predecessor block',async()=>{
 const f=fixture();f.setFreezes([f.newer]);
 let r=await f.run();safe(r);assert.equal(r.reason_code,'FREEZE_HISTORY_MISSING');
 const g=fixture();g.setLinks([]);
 r=await g.run();safe(r);assert.equal(r.reason_code,'LINEAGE_HISTORY_MISSING');
 const h=fixture();h.setFreezes([{...h.old,source_revision:9},h.newer]);
 r=await h.run();safe(r);assert.equal(r.reason_code,'FREEZE_DIGEST_TAMPERED');
 const i=fixture();i.setLinks([{...i.links()[0],previous_link_digest:'f'.repeat(64)}]);
 r=await i.run();safe(r);assert.equal(r.reason_code,'LINEAGE_PREDECESSOR_BROKEN');
});
test('V3.2-93 fork and disconnected lineage cannot be repaired automatically',async()=>{
 const f=fixture(),third=f.addFreeze();
 f.addLink(f.old,third);
 const r=await f.run();safe(r);
 assert.equal(r.reason_code,'LINEAGE_FORK_OR_REPLAY');
 assert.equal(r.recovery_steps.length,5);
});
test('V3.2-93 new version, source revocation or concurrent change blocks',async()=>{
 const f=fixture();f.setCurrent(false);
 let r=await f.run();safe(r);
 assert.equal(r.reason_code,'CURRENT_FREEZE_INVALID_OR_UNAUTHORIZED');
 const g=fixture();
 r=await g.run(async()=>{const third=g.addFreeze();g.addLink(g.newer,third);});
 safe(r);assert.equal(r.reason_code,'LINEAGE_CHANGED_DURING_AUDIT');
});
test('V3.2-93 cross tenant and forged approval requests fail closed',async()=>{
 const f=fixture();
 for(const input of [
  {organization_id:'22222222-2222-4222-8222-222222222222',
   incident_id:incident,afterFirstRead:async()=>{}},
  {organization_id:org,incident_id:incident,afterFirstRead:async()=>{},handoff_allowed:true}
 ]){
  const r=await f.gate.audit(input);safe(r);
  assert.equal(r.fixture_integrity_current,false);
 }
});
