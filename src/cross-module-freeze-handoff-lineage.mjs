// V3.2-92: CI-only frozen-report succession ledger, not a production handoff.
import {createHash} from 'node:crypto';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{64}$/;
const NONCE=/^[a-z0-9][a-z0-9._:-]{15,127}$/;
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
const exact=(x,keys)=>plain(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const deny=(reason_code,more={})=>Object.freeze({reason_code,
 fixture_lineage_current:false,external_authority_verified:false,
 finance_authorized:false,academic_authorized:false,handoff_allowed:false,
 compensation_write_allowed:false,release_eligible:false,hold_active:true,
 production_integration_allowed:false,...more});
const scope=x=>x.organization_id.toLowerCase()+'|'+x.incident_id.toLowerCase();
function validReference(ref){
 return exact(ref,['organization_id','incident_id','final_reference','diff_reference'])&&
 UUID.test(ref.organization_id)&&UUID.test(ref.incident_id)&&
 exact(ref.final_reference,['source_digest','revocation_reference'])&&
 SHA.test(ref.final_reference.source_digest)&&
 exact(ref.diff_reference,['organization_id','incident_id','previous_audit_sequence',
  'previous_audit_digest','new_audit_sequence','new_audit_digest'])&&
 UUID.test(ref.diff_reference.organization_id)&&UUID.test(ref.diff_reference.incident_id)&&
 ref.diff_reference.organization_id.toLowerCase()===ref.organization_id.toLowerCase()&&
 ref.diff_reference.incident_id.toLowerCase()===ref.incident_id.toLowerCase()&&
 Number.isSafeInteger(ref.diff_reference.previous_audit_sequence)&&
 ref.diff_reference.previous_audit_sequence>0&&
 Number.isSafeInteger(ref.diff_reference.new_audit_sequence)&&
 ref.diff_reference.new_audit_sequence>ref.diff_reference.previous_audit_sequence&&
 SHA.test(ref.diff_reference.previous_audit_digest)&&
 SHA.test(ref.diff_reference.new_audit_digest);
}
function verifyChain(rows,ref){
 if(!Array.isArray(rows)||rows.length<2)return false;
 let previous='0'.repeat(64);
 for(let i=0;i<rows.length;i++){
  const row=rows[i];
  if(!plain(row)||row.organization_id!==ref.organization_id.toLowerCase()||
   row.incident_id!==ref.incident_id.toLowerCase()||
   row.sequence!==i+1||row.previous_digest!==previous||
   row.fixture_only!==true||row.hold_active!==true||
   row.handoff_allowed!==false||!SHA.test(row.freeze_digest))return false;
  const {freeze_digest,...payload}=row;
  if(sha(payload)!==freeze_digest)return false;
  previous=freeze_digest;
 }
 return true;
}
/**
 * getFixtureRefreezeReceipt is a trusted harness adapter. V3.2-91 currently
 * has no durable receipt API; this is NOT integration with real signatures.
 */
export function createIsolatedFreezeHandoffLineage({
 freezeRegistry,getFixtureRefreezeReceipt
}={}){
 if(!freezeRegistry||typeof freezeRegistry.audit!=='function'||
 typeof freezeRegistry.verify!=='function'||
 typeof getFixtureRefreezeReceipt!=='function')
 throw TypeError('Trusted CI-only freeze registry and receipt adapter required');
 const links=new Map(),nonces=new Map(),queues=new Map();
 async function snapshot(ref){
  const s={organization_id:ref.organization_id.toLowerCase(),
   incident_id:ref.incident_id.toLowerCase()};
  const rows=await freezeRegistry.audit(s);
  if(!verifyChain(rows,ref))return null;
  return rows;
 }
 async function link(input={}){
  if(!exact(input,['reference','old_freeze_digest','new_freeze_digest','idempotency_key'])||
   !validReference(input.reference)||!SHA.test(input.old_freeze_digest)||
   !SHA.test(input.new_freeze_digest)||
   input.old_freeze_digest===input.new_freeze_digest||
   typeof input.idempotency_key!=='string'||!NONCE.test(input.idempotency_key))
   return deny('INVALID_FREEZE_LINEAGE_INPUT');
  const ref=input.reference,sk=scope(ref);
  const last=queues.get(sk)||Promise.resolve();
  const run=last.catch(()=>{}).then(async()=>{
   const key=sk+'|'+input.idempotency_key;
   const fingerprint=sha({reference:ref,old:input.old_freeze_digest,new:input.new_freeze_digest});
   const prior=nonces.get(key);
   if(prior){
    if(prior.fingerprint!==fingerprint)return deny('FREEZE_LINEAGE_NONCE_CONFLICT');
    return deny('BLOCKED_HISTORICAL_LINEAGE_REPLAY',{record:prior.record});
   }
   let rows,receipt,current;
   try{
    rows=await snapshot(ref);
    if(!rows)return deny('FREEZE_AUDIT_CHAIN_INVALID');
    const old=rows.find(x=>x.freeze_digest===input.old_freeze_digest);
    const newer=rows.find(x=>x.freeze_digest===input.new_freeze_digest);
    if(!old||!newer||newer.sequence!==old.sequence+1||
     newer.previous_digest!==old.freeze_digest||
     newer!==rows.at(-1))return deny('NONADJACENT_OR_SUPERSEDED_FREEZE');
    const history=links.get(sk)||[];
    if(history.some(x=>x.old_freeze_digest===input.old_freeze_digest||
     x.new_freeze_digest===input.new_freeze_digest))return deny('FREEZE_LINEAGE_FORK_OR_DUPLICATE');
    if(history.length&&history.at(-1).new_freeze_digest!==input.old_freeze_digest)
     return deny('FREEZE_LINEAGE_DISCONNECTED');
    receipt=await getFixtureRefreezeReceipt({
     ...ref,old_freeze_digest:input.old_freeze_digest,
     new_freeze_digest:input.new_freeze_digest});
    if(!plain(receipt)||receipt.reason_code!=='BLOCKED_NEW_FIXTURE_FREEZE_NOT_REAL_HANDOFF'||
     receipt.fixture_refreeze_recorded!==true||
     receipt.new_freeze_digest!==input.new_freeze_digest||
     receipt.hold_active!==true||receipt.handoff_allowed!==false||
     receipt.finance_authorized!==false||receipt.academic_authorized!==false||
     receipt.release_eligible!==false||receipt.compensation_write_allowed!==false)
     return deny('GATED_REFREEZE_RECEIPT_UNVERIFIED');
    current=await freezeRegistry.verify({...ref,freeze_digest:input.new_freeze_digest});
    if(!plain(current)||current.reason_code!=='BLOCKED_CURRENT_FIXTURE_FREEZE_NO_EXTERNAL_AUTHORITY'||
     current.fixture_freeze_current!==true||current.hold_active!==true||
     current.handoff_allowed!==false||current.release_eligible!==false)
     return deny('NEW_FREEZE_NOT_CURRENT');
    const again=await snapshot(ref);
    if(!again||again.at(-1).freeze_digest!==input.new_freeze_digest)
     return deny('FREEZE_CHANGED_DURING_LINEAGE_LINK');
    const payload={schema_version:'v3.2-92-ci-lineage-v1',
     organization_id:ref.organization_id.toLowerCase(),
     incident_id:ref.incident_id.toLowerCase(),
     sequence:history.length+1,old_freeze_digest:input.old_freeze_digest,
     new_freeze_digest:input.new_freeze_digest,
     previous_link_digest:history.at(-1)?.link_digest||'0'.repeat(64),
     fixture_only:true,hold_active:true,handoff_allowed:false};
    const record=Object.freeze({...payload,link_digest:sha(payload)});
    links.set(sk,[...history,record]);nonces.set(key,{fingerprint,record});
    return deny('BLOCKED_FIXTURE_FREEZE_SUCCESSION_RECORDED',{record});
   }catch{return deny('FREEZE_LINEAGE_DEPENDENCY_UNAVAILABLE');}
  });
  queues.set(sk,run);
  try{return await run;}finally{if(queues.get(sk)===run)queues.delete(sk);}
 }
 async function inspect(input={}){
  if(!exact(input,['reference','freeze_digest'])||
   !validReference(input.reference)||!SHA.test(input.freeze_digest))
   return deny('INVALID_FREEZE_LINEAGE_INSPECT_INPUT');
  const ref=input.reference,sk=scope(ref);
  try{
   const rows=await snapshot(ref);
   if(!rows)return deny('FREEZE_AUDIT_CHAIN_INVALID');
   const linksForScope=links.get(sk)||[];
   let prev='0'.repeat(64);
   for(let i=0;i<linksForScope.length;i++){
    const row=linksForScope[i],{link_digest,...payload}=row;
    if(row.sequence!==i+1||row.previous_link_digest!==prev||
     link_digest!==sha(payload))return deny('LINEAGE_HISTORY_INTEGRITY_FAILED');
    prev=link_digest;
   }
   if(linksForScope.some(x=>x.old_freeze_digest===input.freeze_digest))
    return deny('HISTORICAL_SUPERSEDED_FREEZE_BLOCKED');
   const active=linksForScope.at(-1);
   if(!active||active.new_freeze_digest!==input.freeze_digest)
    return deny('FREEZE_NOT_LINKED_AS_CURRENT');
   const latest=await freezeRegistry.verify({...ref,freeze_digest:input.freeze_digest});
   if(!plain(latest)||latest.reason_code!=='BLOCKED_CURRENT_FIXTURE_FREEZE_NO_EXTERNAL_AUTHORITY'||
    latest.fixture_freeze_current!==true||latest.hold_active!==true||
    latest.handoff_allowed!==false)return deny('LINKED_FREEZE_NOW_STALE');
   return deny('BLOCKED_CURRENT_FIXTURE_LINEAGE_NO_EXTERNAL_AUTHORITY',{
    fixture_lineage_current:true,link_digest:active.link_digest});
  }catch{return deny('FREEZE_LINEAGE_DEPENDENCY_UNAVAILABLE');}
 }
 return Object.freeze({link,inspect});
}
