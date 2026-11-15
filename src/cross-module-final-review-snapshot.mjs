// V3.2-97 isolated final review snapshots: never business approval.
// In-memory history and SHA-256 are not durable trusted audit or atomic locks.
import {createHash} from 'node:crypto';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{64}$/;
const NONCE=/^[a-z0-9][a-z0-9._:-]{15,127}$/;
const GAP=['finance_independent_signature','academic_independent_signature',
 'order_payment_reconciliation','lesson_entitlement_reconciliation',
 'three_party_acceptance','atomic_handoff_receipt'];
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
const exact=(x,fields)=>plain(x)&&Object.keys(x).length===fields.length&&fields.every(f=>Object.hasOwn(x,f));
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const denied=(reason_code,other={})=>Object.freeze({
 reason_code,fixture_final_review_current:false,
 external_authority_verified:false,finance_authorized:false,academic_authorized:false,
 handoff_allowed:false,compensation_write_allowed:false,release_eligible:false,
 hold_active:true,production_integration_allowed:false,...other});
function validRef(x){
 return exact(x,['organization_id','incident_id','final_reference','diff_reference'])&&
 UUID.test(x.organization_id)&&UUID.test(x.incident_id)&&
 exact(x.final_reference,['source_digest','revocation_reference'])&&
 SHA.test(x.final_reference.source_digest)&&
 exact(x.diff_reference,['organization_id','incident_id','previous_audit_sequence',
  'previous_audit_digest','new_audit_sequence','new_audit_digest'])&&
 UUID.test(x.diff_reference.organization_id)&&UUID.test(x.diff_reference.incident_id)&&
 x.diff_reference.organization_id.toLowerCase()===x.organization_id.toLowerCase()&&
 x.diff_reference.incident_id.toLowerCase()===x.incident_id.toLowerCase()&&
 Number.isSafeInteger(x.diff_reference.previous_audit_sequence)&&
 x.diff_reference.previous_audit_sequence>0&&
 Number.isSafeInteger(x.diff_reference.new_audit_sequence)&&
 x.diff_reference.new_audit_sequence>x.diff_reference.previous_audit_sequence&&
 SHA.test(x.diff_reference.previous_audit_digest)&&SHA.test(x.diff_reference.new_audit_digest);
}
function water(x,org,incident){
 if(!exact(x,['organization_id','incident_id','source_epoch','source_revision',
 'revocation_sequence','revocation_digest','incident_generation','evidence_digest'])||
 x.organization_id?.toLowerCase()!==org||x.incident_id?.toLowerCase()!==incident||
 !Number.isSafeInteger(x.source_epoch)||x.source_epoch<1||
 !Number.isSafeInteger(x.source_revision)||x.source_revision<1||
 !Number.isSafeInteger(x.incident_generation)||x.incident_generation<1||
 !Number.isSafeInteger(x.revocation_sequence)||x.revocation_sequence<0||
 !SHA.test(x.revocation_digest)||!SHA.test(x.evidence_digest))return null;
 return {source_epoch:x.source_epoch,source_revision:x.source_revision,
  revocation_sequence:x.revocation_sequence,revocation_digest:x.revocation_digest,
  incident_generation:x.incident_generation,evidence_digest:x.evidence_digest};
}
function normalizeCombined(x){
 if(!plain(x)||x.reason_code!=='BLOCKED_EXTERNAL_HANDOFF_WITH_CURRENT_FIXTURE_RECOVERY'||
 x.fixture_combined_consistency!==true||x.fixture_recovery_current!==true||
 x.hold_active!==true||x.handoff_allowed!==false||x.compensation_write_allowed!==false||
 x.release_eligible!==false||x.external_authority_verified!==false||
 x.finance_authorized!==false||x.academic_authorized!==false||
 !SHA.test(x.comparison_digest)||!Number.isSafeInteger(x.recovery_expires_at_ms)||
 !Number.isSafeInteger(x.remaining_count)||x.remaining_count<0||
 !Array.isArray(x.pending_tasks)||x.pending_tasks.length!==x.remaining_count||
 !Array.isArray(x.external_requirements)||x.external_requirements.length!==6)return null;
 const gaps=new Set(),tasks=[],items=new Set();
 for(const g of x.external_requirements){
  if(!plain(g)||!GAP.includes(g.code)||gaps.has(g.code)||
   g.status!=='requires_external_authority')return null;
  gaps.add(g.code);
 }
 for(const t of x.pending_tasks){
  if(!plain(t)||typeof t.item!=='string'||!t.item||items.has(t.item)||
   !['sales','finance','academic'].includes(t.owner_department)||
   !['pending','in_review','reviewer_revoked_recheck_required'].includes(t.status)||
   !SHA.test(t.difference_digest))return null;
  items.add(t.item);
  tasks.push({item:t.item,owner_department:t.owner_department,
   status:t.status,difference_digest:t.difference_digest});
 }
 tasks.sort((a,b)=>a.item.localeCompare(b.item,'en'));
 return {comparison_digest:x.comparison_digest,remaining_count:x.remaining_count,
  recovery_expires_at_ms:x.recovery_expires_at_ms,tasks,
  external_requirements:[...gaps].sort()};
}
function normalizeConclusion(x){
 if(!plain(x)||x.reason_code!=='BLOCKED_CONCLUSION_NOT_BUSINESS_AUTHORIZATION'||
 x.fixture_conclusion_current!==true||x.status!=='fixture_current_not_authorized'||
 x.hold_active!==true||x.handoff_allowed!==false||
 x.compensation_write_allowed!==false||x.release_eligible!==false||
 x.history_repair_allowed!==false||x.automatic_recovery_allowed!==false||
 x.finance_authorized!==false||x.academic_authorized!==false||
 x.external_authority_verified!==false||!SHA.test(x.current_source_fingerprint)||
 !Number.isSafeInteger(x.expires_at_ms)||x.expires_at_ms<1||
 !Number.isSafeInteger(x.history_count)||x.history_count<5||
 !Array.isArray(x.events)||x.events.length!==x.history_count)return null;
 const last=x.events.at(-1);
 if(!plain(last)||last.action!=='conclude'||!SHA.test(last.event_digest)||
 last.source_fingerprint!==x.current_source_fingerprint||
 last.expires_at_ms!==x.expires_at_ms||
 last.hold_active!==true||last.handoff_allowed!==false)return null;
 return {source_fingerprint:x.current_source_fingerprint,
  expires_at_ms:x.expires_at_ms,history_count:x.history_count,
  conclusion_event_digest:last.event_digest};
}
export function createIsolatedFinalReviewSnapshot({unifiedRecoveryGate,
 recoveryConclusion,getFixtureWatermark,getFixtureNow}={}){
 if(!unifiedRecoveryGate||typeof unifiedRecoveryGate.report!=='function'||
 !recoveryConclusion||typeof recoveryConclusion.report!=='function'||
 typeof getFixtureWatermark!=='function'||typeof getFixtureNow!=='function')
 throw TypeError('Independent fictional gate, recovery, watermark and clock required');
 const histories=new Map(),nonces=new Map(),queues=new Map(),clockHigh=new Map();
 const scope=ref=>ref.organization_id.toLowerCase()+'|'+ref.incident_id.toLowerCase();
 function clock(key){
  const t=getFixtureNow();
  if(!Number.isSafeInteger(t)||t<1||t<(clockHigh.get(key)||0))return null;
  clockHigh.set(key,t);return t;
 }
 async function observe(ref){
  const org=ref.organization_id.toLowerCase(),incident=ref.incident_id.toLowerCase();
  const key=scope(ref),s={organization_id:org,incident_id:incident};
  const t=clock(key);if(t===null)return {error:'FINAL_REVIEW_CLOCK_UNTRUSTED'};
  const w1=water(await getFixtureWatermark(org,incident),org,incident);
  if(!w1)return {error:'FINAL_REVIEW_WATERMARK_INVALID'};
  const combined=normalizeCombined(await unifiedRecoveryGate.report({...ref,
   ...s,diff_reference:{...ref.diff_reference,...s},afterFirstRead:async()=>{}}));
  if(!combined)return {error:'FINAL_REVIEW_GATE_NOT_CURRENT'};
  const conclusion=normalizeConclusion(await recoveryConclusion.report(s));
  if(!conclusion)return {error:'FINAL_REVIEW_CONCLUSION_NOT_CURRENT'};
  const w2=water(await getFixtureWatermark(org,incident),org,incident);
  if(!w2)return {error:'FINAL_REVIEW_WATERMARK_INVALID'};
  if(hash(w1)!==hash(w2))return {error:'FINAL_REVIEW_WATERMARK_CHANGED'};
  if(combined.recovery_expires_at_ms!==conclusion.expires_at_ms||
   t>=conclusion.expires_at_ms)return {error:'FINAL_REVIEW_EXPIRED_OR_MISMATCHED'};
  const t2=clock(key);if(t2===null||t2>=conclusion.expires_at_ms)
   return {error:'FINAL_REVIEW_EXPIRED_OR_CLOCK_INVALID'};
  return {value:{reference_digest:hash({final_reference:ref.final_reference,
    diff_reference:{...ref.diff_reference,...s}}),
   watermark:w2,combined,conclusion}};
 }
 async function capture(input={}){
  if(!exact(input,['reference','idempotency_key','afterFirstRead'])||
   !validRef(input.reference)||typeof input.idempotency_key!=='string'||
   !NONCE.test(input.idempotency_key)||typeof input.afterFirstRead!=='function')
   return denied('INVALID_FINAL_REVIEW_CAPTURE_INPUT');
  const ref=input.reference,key=scope(ref),nonceKey=key+'|'+input.idempotency_key;
  const prior=queues.get(key)||Promise.resolve();
  const run=prior.catch(()=>{}).then(async()=>{
   const fingerprint=hash({reference:ref});
   const seen=nonces.get(nonceKey);
   if(seen){
    if(seen.fingerprint!==fingerprint)return denied('FINAL_REVIEW_NONCE_CONFLICT');
    return denied('BLOCKED_HISTORICAL_FINAL_REVIEW_REPLAY',{snapshot:seen.snapshot});
   }
   try{
    const a=await observe(ref);if(a.error)return denied(a.error);
    await input.afterFirstRead();
    const b=await observe(ref);if(b.error)return denied(b.error);
    if(hash(a.value)!==hash(b.value))return denied('FINAL_REVIEW_CHANGED_BETWEEN_READS');
    const c=await observe(ref);if(c.error)return denied(c.error);
    if(hash(b.value)!==hash(c.value))return denied('FINAL_REVIEW_CHANGED_AT_FINAL_READ');
    const records=histories.get(key)||[];
    const payload={schema_version:'v3.2-97-ci-final-review-v1',
     organization_id:ref.organization_id.toLowerCase(),
     incident_id:ref.incident_id.toLowerCase(),sequence:records.length+1,
     previous_digest:records.at(-1)?.snapshot_digest||'0'.repeat(64),
     idempotency_key:input.idempotency_key,observation:c.value,
     fixture_only:true,hold_active:true,handoff_allowed:false};
    const snapshot=Object.freeze({...payload,snapshot_digest:hash(payload)});
    histories.set(key,[...records,snapshot]);
    nonces.set(nonceKey,{fingerprint,snapshot});
    return denied('BLOCKED_FINAL_REVIEW_SNAPSHOT_RECORDED',{snapshot});
   }catch{return denied('FINAL_REVIEW_DEPENDENCY_UNAVAILABLE');}
  });
  queues.set(key,run);
  try{return await run;}finally{if(queues.get(key)===run)queues.delete(key);}
 }
 async function verify(input={}){
  if(!exact(input,['reference','snapshot_digest'])||
   !validRef(input.reference)||!SHA.test(input.snapshot_digest))
   return denied('INVALID_FINAL_REVIEW_VERIFY_INPUT');
  const key=scope(input.reference),rows=histories.get(key)||[];
  let prev='0'.repeat(64);
  for(let i=0;i<rows.length;i++){
   const r=rows[i],{snapshot_digest,...payload}=r;
   if(r.sequence!==i+1||r.previous_digest!==prev||
    snapshot_digest!==hash(payload))return denied('FINAL_REVIEW_CHAIN_INTEGRITY_FAILED');
   prev=snapshot_digest;
  }
  const found=rows.find(x=>x.snapshot_digest===input.snapshot_digest);
  if(!found)return denied('FINAL_REVIEW_SNAPSHOT_NOT_FOUND');
  if(found!==rows.at(-1))return denied('SUPERSEDED_FINAL_REVIEW_SNAPSHOT');
  try{
   const now=await observe(input.reference);
   if(now.error)return denied(now.error);
   if(hash(now.value)!==hash(found.observation))
    return denied('FINAL_REVIEW_SNAPSHOT_INVALIDATED');
   return denied('BLOCKED_CURRENT_FIXTURE_FINAL_REVIEW_NO_AUTHORITY',{
    fixture_final_review_current:true,snapshot_digest:found.snapshot_digest});
  }catch{return denied('FINAL_REVIEW_DEPENDENCY_UNAVAILABLE');}
 }
 function audit({organization_id,incident_id}={}){
  if(!UUID.test(organization_id)||!UUID.test(incident_id))return Object.freeze([]);
  return Object.freeze([...(histories.get(organization_id.toLowerCase()+'|'+
   incident_id.toLowerCase())||[])]);
 }
 return Object.freeze({capture,verify,audit});
}
