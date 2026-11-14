// V3.2-77: CI-only, read-only, least-data final handoff gap report.
// Reports blockers, never grants a finance/academic/handoff/release capability.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{64}$/;
const isObject=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
const shape=(x,fields)=>isObject(x)&&Object.keys(x).length===fields.length&&
 fields.every(k=>Object.hasOwn(x,k));
const REPORT_STATES=new Set(['blocked','needs_external_authority','not_verified']);
const authoritativeGaps=Object.freeze([
 ['external_finance_signature_verified','财务独立签名及签名撤销状态'],
 ['external_academic_signature_verified','教务独立签名及签名撤销状态'],
 ['original_orders_and_payments_reconciled','原订单、收付款及资金归属核对'],
 ['original_lessons_and_entitlements_reconciled','学生、课时、课程权益及履约核对'],
 ['independent_three_party_acceptance_verified','销售、财务、教务联合验收'],
 ['external_handoff_receipt_verified','外部原子交接及可信签收回执']
]);
function result(reason_code,localConsistent=false,localReason=null){
 const checks=[
  ['fixture_preflight_consistent','虚构预检一致性',
   localConsistent?'not_verified':'blocked'],
  ...authoritativeGaps.map(([,label])=>[label,label,'needs_external_authority'])
 ].map(([code,title,status])=>Object.freeze({code,title,status}));
 return Object.freeze({schema_version:'v3.2-77-m02-handoff-gap-report-v1',
  reason_code,local_check_consistent:localConsistent,
  local_reason_code:localReason,missing_authoritative_checks:authoritativeGaps.length,
  items:Object.freeze(checks),fixture_only:true,external_authority_verified:false,
  finance_authorized:false,academic_authorized:false,handoff_allowed:false,
  compensation_write_allowed:false,release_eligible:false,hold_active:true,
  production_integration_allowed:false});
}
export function createIsolatedHandoffGapReporter({finalPreflight}={}){
 if(!finalPreflight||typeof finalPreflight.check!=='function')
  throw new TypeError('Independent CI-only handoff preflight required');
 return Object.freeze({
  async report(input={}){
   // Require the exact pass-through reference and no caller approval fields.
   if(!shape(input,['organization_id','incident_id','source_digest',
    'revocation_reference','afterFirstRead'])||
    !UUID.test(input.organization_id)||!UUID.test(input.incident_id)||
    !SHA.test(input.source_digest)||typeof input.afterFirstRead!=='function')
    return result('INVALID_GAP_REPORT_INPUT');
   let preflight;
   try{preflight=await finalPreflight.check(input);}
   catch{return result('FINAL_PREFLIGHT_UNAVAILABLE');}
   if(!isObject(preflight)||typeof preflight.reason_code!=='string')
    return result('FINAL_PREFLIGHT_INVALID_RESPONSE');
   // An "approved" answer from any dependency is a protocol violation, not
   // a release authorization. Never trust raw client-provided green flags.
   for(const flag of ['handoff_allowed','release_eligible','compensation_write_allowed',
    'finance_authorized','academic_authorized','external_authority_verified']){
    if(preflight[flag]!==false)return result('FINAL_PREFLIGHT_AUTHORITY_PROTOCOL_VIOLATION');
   }
   if(preflight.hold_active!==true)return result('FINAL_PREFLIGHT_HOLD_PROTOCOL_VIOLATION');
   const stable=preflight.reason_code===
    'BLOCKED_EXTERNAL_THREE_PARTY_ACCEPTANCE_AND_ATOMIC_HANDOFF_MISSING'&&
    preflight.fixture_preflight_consistent===true&&
    preflight.internal_review_consistent===true&&
    preflight.revocation_reference_current===true&&
    preflight.three_domain_recovery_consistent===true;
   // "Stable" is only a fictional test observation. Six external evidence
   // groups remain unverified and every execution permission remains false.
   return result(stable?'BLOCKED_REAL_EXTERNAL_HANDOFF_GAPS':
    'BLOCKED_LOCAL_OR_EXTERNAL_PREFLIGHT_GAPS',stable,preflight.reason_code);
  }
 });
}
