// V3.2-81 CI-only read-only supplement / reviewer double-check.
// This is NOT an atomic transaction, a signature verification or an authorization.
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const CODES=new Set(['finance_signature','academic_signature',
 'order_payment_reconciliation','lesson_entitlement_reconciliation',
 'three_party_joint_acceptance','external_atomic_receipt']);
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
const exact=(x,keys)=>plain(x)&&Object.keys(x).length===keys.length&&
 keys.every(k=>Object.hasOwn(x,k));
const blocked=(reason_code,consistent=false)=>Object.freeze({
 reason_code,fixture_supplement_review_consistent:consistent,
 external_signatures_verified:false,external_authority_verified:false,
 finance_authorized:false,academic_authorized:false,handoff_allowed:false,
 compensation_write_allowed:false,release_eligible:false,hold_active:true,
 production_integration_allowed:false
});
export function createIsolatedSupplementReviewFinalCheck({supplements,reviews}={}){
 if(!supplements||typeof supplements.report!=='function'||typeof supplements.audit!=='function'||
  !reviews||typeof reviews.report!=='function'||typeof reviews.audit!=='function')
  throw new TypeError('Independent CI-only supplement and reviewer adapters required');
 function read(scope){
  const chain=supplements.report(scope),review=reviews.report(scope);
  if(!plain(chain)||chain.fixture_chain_valid!==true||
   chain.fixture_supplements_current!==true||
   chain.reason_code!=='BLOCKED_INDEPENDENT_SUPPLEMENT_REVIEW_AND_EXTERNAL_AUTHORITY_MISSING'||
   chain.hold_active!==true||chain.handoff_allowed!==false||
   !Number.isSafeInteger(chain.current_source_revision)||chain.current_source_revision<1||
   !SHA.test(chain.current_chain_digest))
   return {error:'SUPPLEMENT_CHAIN_STALE_OR_UNAVAILABLE'};
  if(!plain(review)||review.fixture_independent_supplement_review_current!==true||
   review.reason_code!=='BLOCKED_EXTERNAL_SUPPLEMENT_AUTHORITY_NOT_CONNECTED'||
   review.hold_active!==true||review.handoff_allowed!==false||
   review.release_eligible!==false)
   return {error:'INDEPENDENT_REVIEW_STALE_OR_UNAVAILABLE'};
  const items=supplements.audit(scope),reviewRows=reviews.audit(scope);
  if(!Array.isArray(items)||!Array.isArray(reviewRows))
   return {error:'SUPPLEMENT_AUDIT_UNAVAILABLE'};
  const current=items.filter(x=>x&&x.organization_id===scope.organization_id&&
   x.incident_id===scope.incident_id&&x.requirement_code===scope.requirement_code&&
   x.source_revision===chain.current_source_revision);
  const latest=current.at(-1);
  if(!latest||latest.fixture_only!==true||latest.chain_digest!==chain.current_chain_digest||
   !Number.isSafeInteger(latest.supplement_version)||latest.supplement_version<1||
   !SHA.test(latest.evidence_sha256)||!SHA.test(latest.original_submission_sha256))
   return {error:'LATEST_SUPPLEMENT_AUDIT_MISMATCH'};
  const matching=reviewRows.filter(x=>x&&
   x.organization_id===scope.organization_id&&x.incident_id===scope.incident_id&&
   x.requirement_code===scope.requirement_code&&
   x.source_revision===latest.source_revision&&
   x.supplement_version===latest.supplement_version&&
   x.chain_digest===latest.chain_digest);
  if(matching.length!==1||matching[0].fixture_only!==true||
   matching[0].original_submission_sha256!==latest.original_submission_sha256||
   matching[0].submitted_by!==latest.submitted_by||
   matching[0].reviewer_id===latest.submitted_by||
   matching[0].hold_active!==true||matching[0].handoff_allowed!==false||
   matching[0].release_eligible!==false)
   return {error:'INDEPENDENT_REVIEW_AUDIT_MISMATCH'};
  const token=[latest.source_revision,latest.supplement_version,
   latest.chain_digest,latest.evidence_sha256,latest.original_submission_sha256,
   latest.submitted_by,matching[0].reviewer_id].join(':');
  return {token};
 }
 return Object.freeze({
  async check(input={}){
   if(!exact(input,['organization_id','incident_id','requirement_code','afterFirstRead'])||
    !UUID.test(input.organization_id)||!UUID.test(input.incident_id)||
    !CODES.has(input.requirement_code)||typeof input.afterFirstRead!=='function')
    return blocked('INVALID_FINAL_SUPPLEMENT_CHECK_INPUT');
   const scope={organization_id:input.organization_id.toLowerCase(),
    incident_id:input.incident_id.toLowerCase(),requirement_code:input.requirement_code};
   let first,second,third;
   try{
    first=read(scope);if(first.error)return blocked(first.error);
    await input.afterFirstRead();
    second=read(scope);if(second.error)return blocked(second.error);
    if(first.token!==second.token)
     return blocked('SUPPLEMENT_OR_REVIEW_CHANGED_DURING_CHECK');
    third=read(scope);if(third.error)return blocked(third.error);
    if(third.token!==second.token)return blocked('SUPPLEMENT_CHANGED_AT_FINAL_READ');
   }catch{return blocked('FINAL_SUPPLEMENT_DEPENDENCY_UNAVAILABLE');}
   return blocked('BLOCKED_NONATOMIC_EXTERNAL_AUTHORITY_NOT_CONNECTED',true);
  }
 });
}
