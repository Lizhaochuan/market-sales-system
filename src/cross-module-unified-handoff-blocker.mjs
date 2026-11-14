// V3.2-82: CI-only unified final handoff blocker.
// Fictional checks can never authorize external signatures, settlement or hold release.
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const CODES=Object.freeze(['finance_signature','academic_signature',
 'order_payment_reconciliation','lesson_entitlement_reconciliation',
 'three_party_joint_acceptance','external_atomic_receipt']);
const exact=(x,fields)=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null)&&
 Object.keys(x).length===fields.length&&fields.every(k=>Object.hasOwn(x,k));
const blocked=(reason_code,checks=[])=>Object.freeze({reason_code,
 fixture_unified_consistency:false,
 checked_requirement_count:checks.length,
 checks:Object.freeze(checks.map(x=>Object.freeze({...x}))),
 external_authority_verified:false,external_finance_signature_verified:false,
 external_academic_signature_verified:false,real_three_party_acceptance_verified:false,
 finance_authorized:false,academic_authorized:false,handoff_allowed:false,
 compensation_write_allowed:false,release_eligible:false,
 hold_active:true,production_integration_allowed:false});
function validBlocked(x,flag,reason){
 return x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 x.reason_code===reason&&x[flag]===true&&
 x.handoff_allowed===false&&x.compensation_write_allowed===false&&
 x.release_eligible===false&&x.hold_active===true&&
 x.finance_authorized===false&&x.academic_authorized===false;
}
/**
 * All adapters are instantiated and supplied by the trusted CI harness.
 * The callback models a pause between isolated read passes, not a transaction.
 * Even success returns BLOCKED, never a real authorization.
 */
export function createIsolatedUnifiedHandoffBlocker({finalPreflight,supplementFinalCheck}={}){
 if(!finalPreflight||typeof finalPreflight.check!=='function'||
    !supplementFinalCheck||typeof supplementFinalCheck.check!=='function')
  throw new TypeError('Independent offline final and supplement gates required');
 async function check(input={}){
  if(!exact(input,['organization_id','incident_id','final_reference','afterFirstRead'])||
    !UUID.test(input.organization_id)||!UUID.test(input.incident_id)||
    typeof input.afterFirstRead!=='function'||
    !exact(input.final_reference,['source_digest','revocation_reference'])||
    !/^[a-f0-9]{64}$/.test(input.final_reference.source_digest))
   return blocked('INVALID_UNIFIED_HANDOFF_INPUT');
  const organization_id=input.organization_id.toLowerCase();
  const incident_id=input.incident_id.toLowerCase();
  const ref=input.final_reference;
  const scope={organization_id,incident_id};
  const statuses=[];
  async function readAll(pass){
   const final=await finalPreflight.check({
    ...scope,source_digest:ref.source_digest,
    revocation_reference:ref.revocation_reference,
    afterFirstRead:async()=>{}
   });
   if(!validBlocked(final,'fixture_preflight_consistent',
    'BLOCKED_EXTERNAL_THREE_PARTY_ACCEPTANCE_AND_ATOMIC_HANDOFF_MISSING')||
    final.internal_review_consistent!==true||
    final.revocation_reference_current!==true||
    final.three_domain_recovery_consistent!==true||
    final.external_authority_verified!==false)
    return 'FINAL_HANDOFF_PRECHECK_FAILED';
   for(const requirement_code of CODES){
    const result=await supplementFinalCheck.check({
      ...scope,requirement_code,afterFirstRead:async()=>{}
    });
    if(!validBlocked(result,'fixture_supplement_review_consistent',
      'BLOCKED_NONATOMIC_EXTERNAL_AUTHORITY_NOT_CONNECTED')||
      result.external_authority_verified!==false)
     return 'SUPPLEMENT_REVIEW_PRECHECK_FAILED_'+requirement_code.toUpperCase();
    statuses.push({pass,requirement_code,status:'fixture_consistent_not_authorized'});
   }
   return null;
  }
  try{
   const first=await readAll(1);
   if(first)return blocked(first,statuses);
   await input.afterFirstRead();
   const second=await readAll(2);
   if(second)return blocked(second,statuses);
   // Another complete reread closes gaps within the second pass, though
   // it still does not provide post-check atomicity.
   const third=await readAll(3);
   if(third)return blocked(third,statuses);
  }catch{return blocked('UNIFIED_HANDOFF_DEPENDENCY_UNAVAILABLE',statuses);}
  return Object.freeze({...blocked('BLOCKED_REAL_THREE_PARTY_ATOMIC_HANDOFF_MISSING',statuses),
   fixture_unified_consistency:true});
 }
 return Object.freeze({check});
}
