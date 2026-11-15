// V3.2-101: one read-only CI facade across V3.2-96/97/98/99.
// It is NOT a trusted production authority, external signature or handoff API.
import {createHash} from 'node:crypto';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const DIGEST=/^[a-f0-9]{64}$/;
const GAPS=new Set(['finance_independent_signature','academic_independent_signature',
 'order_payment_reconciliation','lesson_entitlement_reconciliation',
 'three_party_acceptance','atomic_handoff_receipt']);
const exact=(x,keys)=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null)&&
 Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const deny=(reason_code,extra={})=>Object.freeze({
 reason_code,fixture_internal_review_current:false,
 external_authority_verified:false,finance_authorized:false,
 academic_authorized:false,handoff_allowed:false,compensation_write_allowed:false,
 release_eligible:false,hold_active:true,production_integration_allowed:false,
 ...extra
});
function referenceOK(x){
 return exact(x,['organization_id','incident_id','final_reference','diff_reference'])&&
 UUID.test(x.organization_id)&&UUID.test(x.incident_id)&&
 exact(x.final_reference,['source_digest','revocation_reference'])&&
 DIGEST.test(x.final_reference.source_digest)&&
 exact(x.diff_reference,['organization_id','incident_id','previous_audit_sequence',
  'previous_audit_digest','new_audit_sequence','new_audit_digest'])&&
 UUID.test(x.diff_reference.organization_id)&&UUID.test(x.diff_reference.incident_id)&&
 x.organization_id.toLowerCase()===x.diff_reference.organization_id.toLowerCase()&&
 x.incident_id.toLowerCase()===x.diff_reference.incident_id.toLowerCase()&&
 Number.isSafeInteger(x.diff_reference.previous_audit_sequence)&&
 x.diff_reference.previous_audit_sequence>0&&
 Number.isSafeInteger(x.diff_reference.new_audit_sequence)&&
 x.diff_reference.new_audit_sequence>x.diff_reference.previous_audit_sequence&&
 DIGEST.test(x.diff_reference.previous_audit_digest)&&
 DIGEST.test(x.diff_reference.new_audit_digest);
}
const normal=x=>{
 const organization_id=x.organization_id.toLowerCase(),
  incident_id=x.incident_id.toLowerCase();
 return {organization_id,incident_id,final_reference:x.final_reference,
  diff_reference:{...x.diff_reference,organization_id,incident_id}};
};
function watermark(x,scope){
 if(!exact(x,['organization_id','incident_id','source_epoch','source_revision',
  'revocation_sequence','revocation_digest','incident_generation','evidence_digest'])||
  typeof x.organization_id!=='string'||typeof x.incident_id!=='string'||
  x.organization_id.toLowerCase()!==scope.organization_id||
  x.incident_id.toLowerCase()!==scope.incident_id||
  !Number.isSafeInteger(x.source_epoch)||x.source_epoch<=0||
  !Number.isSafeInteger(x.source_revision)||x.source_revision<=0||
  !Number.isSafeInteger(x.incident_generation)||x.incident_generation<=0||
  !Number.isSafeInteger(x.revocation_sequence)||x.revocation_sequence<0||
  !DIGEST.test(x.revocation_digest)||!DIGEST.test(x.evidence_digest))return null;
 return Object.freeze({source_epoch:x.source_epoch,source_revision:x.source_revision,
  revocation_sequence:x.revocation_sequence,revocation_digest:x.revocation_digest,
  incident_generation:x.incident_generation,evidence_digest:x.evidence_digest});
}
const safe=x=>x&&x.hold_active===true&&x.handoff_allowed===false&&
 x.finance_authorized===false&&x.academic_authorized===false&&
 x.compensation_write_allowed===false&&x.release_eligible===false&&
 x.external_authority_verified===false;
function normalizedGate(x){
 if(!safe(x)||x.reason_code!=='BLOCKED_EXTERNAL_HANDOFF_WITH_CURRENT_FIXTURE_RECOVERY'||
  x.fixture_combined_consistency!==true||x.fixture_recovery_current!==true||
  !DIGEST.test(x.comparison_digest)||!Number.isSafeInteger(x.remaining_count)||
  x.remaining_count<0||!Number.isSafeInteger(x.recovery_expires_at_ms)||
  !Array.isArray(x.pending_tasks)||x.pending_tasks.length!==x.remaining_count||
  !Array.isArray(x.external_requirements)||x.external_requirements.length!==6)
  return null;
 const seen=new Set(),pending=[];
 for(const t of x.pending_tasks){
  if(!exact(t,['item','owner_department','status','difference_digest'])||
   typeof t.item!=='string'||!t.item||seen.has(t.item)||
   !['sales','finance','academic'].includes(t.owner_department)||
   !['pending','in_review','reviewer_revoked_recheck_required'].includes(t.status)||
   !DIGEST.test(t.difference_digest))return null;
  seen.add(t.item);
  pending.push({item:t.item,owner_department:t.owner_department,
   status:t.status,difference_digest:t.difference_digest});
 }
 const codes=new Set();
 for(const t of x.external_requirements){
  if(!exact(t,['code','status'])||!GAPS.has(t.code)||codes.has(t.code)||
   t.status!=='requires_external_authority')return null;
  codes.add(t.code);
 }
 pending.sort((a,b)=>a.item.localeCompare(b.item,'en'));
 return {comparison_digest:x.comparison_digest,remaining_count:x.remaining_count,
  expires_at_ms:x.recovery_expires_at_ms,pending,
  outstanding_external_gap_codes:[...codes].sort()};
}
function normalizedSnapshot(x,digest){
 if(!safe(x)||x.reason_code!=='BLOCKED_CURRENT_FIXTURE_FINAL_REVIEW_NO_AUTHORITY'||
  x.fixture_final_review_current!==true||x.snapshot_digest!==digest)
  return null;
 return {snapshot_digest:digest};
}
function normalizedAttestation(x,digest,receipt){
 if(!safe(x)||x.reason_code!=='BLOCKED_CI_ATTESTATION_COMPLETE_NO_EXTERNAL_AUTHORITY'||
  x.fixture_acknowledgement_current!==true||
  x.current_snapshot_digest!==digest||x.acknowledgement_digest!==receipt||
  x.completed_steps!==5||x.required_steps!==5)return null;
 return {acknowledgement_digest:receipt};
}
function normalizedLifecycle(x,receipt){
 if(!safe(x)||x.reason_code!=='BLOCKED_CURRENT_ADMINISTRATIVE_ACKNOWLEDGEMENT'||
  x.fixture_acknowledgement_current!==true||x.acknowledgement_digest!==receipt||
  !Number.isSafeInteger(x.history_count)||x.history_count<0)return null;
 return {acknowledgement_digest:receipt,history_count:x.history_count};
}
export function createIsolatedReadOnlyVerificationFacade({
 unifiedRecoveryGate,finalReview,attestation,attestationLifecycle,
 getFixtureWatermark
}={}){
 if(!unifiedRecoveryGate||typeof unifiedRecoveryGate.report!=='function'||
  !finalReview||typeof finalReview.verify!=='function'||
  !attestation||typeof attestation.report!=='function'||
  !attestationLifecycle||typeof attestationLifecycle.inspect!=='function'||
  typeof getFixtureWatermark!=='function')
  throw new TypeError('All five independent CI-only read adapters are required');
 async function read(ref,digest,receipt){
  const scope={organization_id:ref.organization_id,incident_id:ref.incident_id};
  const before=watermark(await getFixtureWatermark(scope.organization_id,scope.incident_id),scope);
  if(!before)return {error:'SOURCE_WATERMARK_MISSING_OR_WRONG_SCOPE'};
  const unified=normalizedGate(await unifiedRecoveryGate.report({...ref,
   afterFirstRead:async()=>{}}));
  if(!unified)return {error:'UNIFIED_GATE_NOT_VERIFIED'};
  const snapshot=normalizedSnapshot(await finalReview.verify({reference:ref,
   snapshot_digest:digest}),digest);
  if(!snapshot)return {error:'FINAL_REVIEW_SNAPSHOT_NOT_CURRENT'};
  const signed=normalizedAttestation(await attestation.report({reference:ref,
   snapshot_digest:digest}),digest,receipt);
  if(!signed)return {error:'INDEPENDENT_ATTESTATION_NOT_CURRENT'};
  // CRITICAL: V3.2-99 overlay MUST be consulted, not bypassed with V3.2-98's boolean.
  const lifecycleRaw=await attestationLifecycle.inspect({reference:ref,
   snapshot_digest:digest,acknowledgement_digest:receipt});
  const lifecycle=normalizedLifecycle(lifecycleRaw,receipt);
  if(!lifecycle)return {error:'LIFECYCLE_REVOKED_OR_STALE',
   lifecycle_reason:typeof lifecycleRaw?.reason_code==='string'?
    lifecycleRaw.reason_code:'UNVERIFIED'};
  const after=watermark(await getFixtureWatermark(scope.organization_id,scope.incident_id),scope);
  if(!after)return {error:'SOURCE_WATERMARK_MISSING_OR_WRONG_SCOPE'};
  if(hash(before)!==hash(after))return {error:'SOURCE_CHANGED_DURING_UNIFIED_READ'};
  return {value:{scope,reference_digest:hash({
   final_reference:ref.final_reference,diff_reference:ref.diff_reference}),
   watermark:after,unified,snapshot,attestation:signed,lifecycle}};
 }
 async function verify(input={}){
  if(!exact(input,['reference','snapshot_digest','acknowledgement_digest',
   'afterFirstRead'])||!referenceOK(input.reference)||
   !DIGEST.test(input.snapshot_digest)||
   !DIGEST.test(input.acknowledgement_digest)||
   typeof input.afterFirstRead!=='function')
   return deny('INVALID_READ_ONLY_VERIFICATION_INPUT');
  const ref=normal(input.reference),dig=input.snapshot_digest,receipt=input.acknowledgement_digest;
  try{
   const first=await read(ref,dig,receipt);
   if(first.error)return deny(first.error,first.lifecycle_reason?
    {lifecycle_reason:first.lifecycle_reason}:{});
   await input.afterFirstRead();
   const second=await read(ref,dig,receipt);
   if(second.error)return deny(second.error,second.lifecycle_reason?
    {lifecycle_reason:second.lifecycle_reason}:{});
   if(hash(first.value)!==hash(second.value))
    return deny('READ_ONLY_VERIFICATION_CHANGED_BETWEEN_READS');
   const third=await read(ref,dig,receipt);
   if(third.error)return deny(third.error,third.lifecycle_reason?
    {lifecycle_reason:third.lifecycle_reason}:{});
   if(hash(second.value)!==hash(third.value))
    return deny('READ_ONLY_VERIFICATION_CHANGED_AT_FINAL_READ');
   const u=third.value.unified;
   return deny('BLOCKED_CURRENT_FIXTURE_REVIEW_WITH_EXTERNAL_GAPS',{
    fixture_internal_review_current:true,
    organization_id:ref.organization_id,incident_id:ref.incident_id,
    snapshot_digest:dig,acknowledgement_digest:receipt,
    source_watermark_digest:hash(third.value.watermark),
    comparison_digest:u.comparison_digest,
    pending_task_count:u.remaining_count,
    external_gap_count:u.outstanding_external_gap_codes.length,
    verification_digest:hash(third.value)});
  }catch{return deny('READ_ONLY_VERIFICATION_DEPENDENCY_UNAVAILABLE');}
 }
 return Object.freeze({verify});
}
