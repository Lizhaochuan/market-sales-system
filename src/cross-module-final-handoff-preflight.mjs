// V3.2-76: CI-only final handoff preflight composition, never a handoff API.
// It combines prior isolated checks but cannot establish external authority,
// atomicity, signed approvals or permission to release holds.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
const exact=(x,fields)=>plain(x)&&Object.keys(x).length===fields.length&&
 fields.every(k=>Object.hasOwn(x,k));
const deny=(reason_code,checks={})=>Object.freeze({
 reason_code,fixture_preflight_consistent:false,
 internal_review_consistent:false,revocation_reference_current:false,
 three_domain_recovery_consistent:false,
 ...checks,
 external_finance_signature_verified:false,
 external_academic_signature_verified:false,
 original_orders_and_payments_reconciled:false,
 original_lessons_and_entitlements_reconciled:false,
 independent_three_party_acceptance_verified:false,
 external_handoff_receipt_verified:false,
 external_authority_verified:false,
 finance_authorized:false,academic_authorized:false,
 handoff_allowed:false,compensation_write_allowed:false,
 release_eligible:false,hold_active:true,production_integration_allowed:false
});
function verified(res,flag,reason){
 return plain(res)&&res[flag]===true&&res.reason_code===reason&&
 res.handoff_allowed===false&&res.release_eligible===false&&res.hold_active===true;
}
/**
 * Pass only distinct fixture adapters from the CI harness, never client-supplied
 * approval booleans. Even if all offline preconditions hold, real authority is
 * absent and release is ALWAYS blocked. Async checks do not provide a lock.
 */
export function createIsolatedFinalHandoffPreflight({reconfirmation,recovery,ledger}={}){
 if(!reconfirmation||typeof reconfirmation.check!=='function'||
  !recovery||typeof recovery.check!=='function'||
  !ledger||typeof ledger.checkHistoricalPacket!=='function')
  throw new TypeError('All independent CI-only adapters required');
 async function check(input={}){
  if(!exact(input,['organization_id','incident_id','source_digest',
    'revocation_reference','afterFirstRead'])||
   !UUID.test(input.organization_id)||!UUID.test(input.incident_id)||
   !SHA.test(input.source_digest)||typeof input.afterFirstRead!=='function')
   return deny('INVALID_FINAL_PREFLIGHT_INPUT');
  const org=input.organization_id.toLowerCase(),incident=input.incident_id.toLowerCase();
  const ref=input.revocation_reference;
  if(!exact(ref,['organization_id','incident_id','source_epoch',
   'revocation_sequence','revocation_digest','evidence_event_ids'])||
   typeof ref.organization_id!=='string'||typeof ref.incident_id!=='string'||
   !UUID.test(ref.organization_id)||!UUID.test(ref.incident_id)||
   ref.organization_id.toLowerCase()!==org||ref.incident_id.toLowerCase()!==incident)
   return deny('REVOCATION_REFERENCE_SCOPE_MISMATCH');
  const reviewed={organization_id:org,incident_id:incident,source_digest:input.source_digest};
  let firstReview,firstRevocation,threeDomain,secondReview,secondRevocation;
  try{
   firstReview=reconfirmation.check(reviewed);
   if(!verified(firstReview,'fixture_reconfirmation_complete',
     'BLOCKED_REAL_EXTERNAL_REVIEW_AND_HANDOFF_MISSING'))
    return deny('INTERNAL_RECONFIRMATION_INCOMPLETE_OR_STALE');
   firstRevocation=ledger.checkHistoricalPacket(ref);
   if(!verified(firstRevocation,'revocation_preflight_consistent',
     'BLOCKED_EXTERNAL_REVOCATION_AUTHORITY_UNAVAILABLE'))
    return deny('REVOCATION_REFERENCE_STALE_OR_REVOKED');
   threeDomain=await recovery.check({
    organization_id:org,incident_id:incident,afterFirstRead:input.afterFirstRead});
   if(!verified(threeDomain,'fixture_consistency_verified',
     'BLOCKED_EXTERNAL_RECOVERY_AUTHORITY_UNAVAILABLE'))
    return deny('THREE_DOMAIN_RECOVERY_CHANGED_OR_UNAVAILABLE');
   secondReview=reconfirmation.check(reviewed);
   if(!verified(secondReview,'fixture_reconfirmation_complete',
     'BLOCKED_REAL_EXTERNAL_REVIEW_AND_HANDOFF_MISSING'))
    return deny('INTERNAL_RECONFIRMATION_CHANGED_AT_FINAL_READ');
   secondRevocation=ledger.checkHistoricalPacket(ref);
   if(!verified(secondRevocation,'revocation_preflight_consistent',
     'BLOCKED_EXTERNAL_REVOCATION_AUTHORITY_UNAVAILABLE'))
    return deny('REVOCATION_CHANGED_AT_FINAL_READ');
  }catch{
   return deny('FINAL_PREFLIGHT_DEPENDENCY_UNAVAILABLE');
  }
  return Object.freeze({...deny('BLOCKED_EXTERNAL_THREE_PARTY_ACCEPTANCE_AND_ATOMIC_HANDOFF_MISSING',{
   fixture_preflight_consistent:true,internal_review_consistent:true,
   revocation_reference_current:true,three_domain_recovery_consistent:true})});
 }
 return Object.freeze({check});
}
