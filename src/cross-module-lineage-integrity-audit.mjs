// V3.2-93: read-only CI audit of freeze succession and recovery blockers.
// No repair, signing, production persistence, handoff or release capability.
import {createHash} from 'node:crypto';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{64}$/;
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
const exact=(x,fields)=>plain(x)&&Object.keys(x).length===fields.length&&fields.every(k=>Object.hasOwn(x,k));
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const deny=(reason_code,extra={})=>Object.freeze({
 reason_code,fixture_integrity_current:false,history_repair_allowed:false,
 automatic_recovery_allowed:false,external_authority_verified:false,
 finance_authorized:false,academic_authorized:false,handoff_allowed:false,
 compensation_write_allowed:false,release_eligible:false,hold_active:true,
 production_integration_allowed:false,...extra
});
const recovery=Object.freeze([
 'quarantine_affected_scope_and_preserve_original_evidence',
 'independent_sales_finance_academic_history_reconciliation',
 'obtain_trusted_source_versions_and_revocation_watermarks',
 'rebuild_all_current_reviews_and_six_external_authority_gaps',
 'create_new_isolated_lineage_only_after_independent_acceptance'
]);
function validateFreeze(rows,org,incident){
 if(!Array.isArray(rows)||rows.length<2)return 'FREEZE_HISTORY_MISSING';
 let prev='0'.repeat(64),seen=new Set();
 for(let i=0;i<rows.length;i++){
  const x=rows[i];
  if(!plain(x)||x.organization_id!==org||x.incident_id!==incident||
   x.sequence!==i+1)return 'FREEZE_HISTORY_GAP_OR_WRONG_SCOPE';
  if(!SHA.test(x.freeze_digest)||seen.has(x.freeze_digest))return 'FREEZE_HISTORY_DUPLICATE';
  if(x.previous_digest!==prev)return 'FREEZE_PREDECESSOR_BROKEN';
  if(x.fixture_only!==true||x.hold_active!==true||x.handoff_allowed!==false)
   return 'FREEZE_UNSAFE_STATE';
  const {freeze_digest,...body}=x;
  if(digest(body)!==freeze_digest)return 'FREEZE_DIGEST_TAMPERED';
  seen.add(freeze_digest);prev=freeze_digest;
 }
 return null;
}
function validateLinks(links,freezes,org,incident){
 if(!Array.isArray(links)||links.length===0)return 'LINEAGE_HISTORY_MISSING';
 const freezeMap=new Map(freezes.map(x=>[x.freeze_digest,x]));
 let prev='0'.repeat(64),usedOld=new Set(),usedNew=new Set();
 for(let i=0;i<links.length;i++){
  const x=links[i];
  if(!plain(x)||x.organization_id!==org||x.incident_id!==incident||
   x.sequence!==i+1)return 'LINEAGE_HISTORY_GAP_OR_WRONG_SCOPE';
  if(!SHA.test(x.link_digest)||x.previous_link_digest!==prev)
   return 'LINEAGE_PREDECESSOR_BROKEN';
  const {link_digest,...body}=x;
  if(digest(body)!==link_digest)return 'LINEAGE_DIGEST_TAMPERED';
  if(x.fixture_only!==true||x.hold_active!==true||x.handoff_allowed!==false)
   return 'LINEAGE_UNSAFE_STATE';
  const old=freezeMap.get(x.old_freeze_digest),newer=freezeMap.get(x.new_freeze_digest);
  if(!old||!newer)return 'LINEAGE_FREEZE_REFERENCE_MISSING';
  if(usedOld.has(x.old_freeze_digest)||usedNew.has(x.new_freeze_digest))
   return 'LINEAGE_FORK_OR_REPLAY';
  if(newer.sequence!==old.sequence+1||newer.previous_digest!==old.freeze_digest)
   return 'LINEAGE_NONADJACENT_FREEZE';
  if(i>0&&links[i-1].new_freeze_digest!==x.old_freeze_digest)
   return 'LINEAGE_DISCONNECTED';
  usedOld.add(x.old_freeze_digest);usedNew.add(x.new_freeze_digest);prev=link_digest;
 }
 if(links.at(-1).new_freeze_digest!==freezes.at(-1).freeze_digest)
  return 'LATEST_FREEZE_NOT_LINKED';
 return null;
}
export function createIsolatedLineageIntegrityAudit({getFixtureFreezeHistory,
 getFixtureLineageHistory,verifyCurrentFreeze}={}){
 if(typeof getFixtureFreezeHistory!=='function'||
 typeof getFixtureLineageHistory!=='function'||
 typeof verifyCurrentFreeze!=='function')
  throw TypeError('Independent CI-only sources required');
 async function one(ref){
  const org=ref.organization_id.toLowerCase(),incident=ref.incident_id.toLowerCase();
  const s={organization_id:org,incident_id:incident};
  let freezes,links;
  try{
   freezes=await getFixtureFreezeHistory(s);
   links=await getFixtureLineageHistory(s);
  }catch{return {error:'AUDIT_DEPENDENCY_UNAVAILABLE'};}
  let problem=validateFreeze(freezes,org,incident);
  if(!problem)problem=validateLinks(links,freezes,org,incident);
  if(problem)return {error:problem};
  const active=links.at(-1).new_freeze_digest;
  let verification;
  try{verification=await verifyCurrentFreeze({...s,freeze_digest:active});}
  catch{return {error:'CURRENT_FREEZE_VERIFICATION_UNAVAILABLE'};}
  if(!plain(verification)||
   verification.reason_code!=='BLOCKED_CURRENT_FIXTURE_FREEZE_NO_EXTERNAL_AUTHORITY'||
   verification.fixture_freeze_current!==true||
   verification.hold_active!==true||verification.handoff_allowed!==false||
   verification.release_eligible!==false)
   return {error:'CURRENT_FREEZE_INVALID_OR_UNAUTHORIZED'};
  return {fingerprint:digest({freeze_digests:freezes.map(x=>x.freeze_digest),
   link_digests:links.map(x=>x.link_digest),active}),active,
   freeze_count:freezes.length,link_count:links.length};
 }
 async function audit(input={}){
  if(!exact(input,['organization_id','incident_id','afterFirstRead'])||
   !UUID.test(input.organization_id)||!UUID.test(input.incident_id)||
   typeof input.afterFirstRead!=='function')
   return deny('INVALID_LINEAGE_AUDIT_INPUT');
  const ref={organization_id:input.organization_id.toLowerCase(),
   incident_id:input.incident_id.toLowerCase()};
  try{
   const first=await one(ref);if(first.error)
    return deny(first.error,{recovery_steps:recovery});
   await input.afterFirstRead();
   const second=await one(ref);if(second.error)
    return deny(second.error,{recovery_steps:recovery});
   if(first.fingerprint!==second.fingerprint)
    return deny('LINEAGE_CHANGED_DURING_AUDIT',{recovery_steps:recovery});
   return Object.freeze({...deny('BLOCKED_CI_LINEAGE_INTEGRITY_ONLY'),
    fixture_integrity_current:true,active_freeze_digest:second.active,
    freeze_count:second.freeze_count,link_count:second.link_count,
    recovery_steps:recovery});
  }catch{return deny('AUDIT_DEPENDENCY_UNAVAILABLE',{recovery_steps:recovery});}
 }
 return Object.freeze({audit});
}
