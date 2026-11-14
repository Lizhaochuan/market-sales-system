// V3.2-27: STRICT SHAPE CHECK of an external response candidate.
// This is *never* an authentication check, trusted signature validation,
// financial reconciliation, CRM execution result, or authorization decision.
// No HTTP calls, credentials, queues or business database writes.
import {createHash} from 'node:crypto';

const DEPARTMENTS=new Set(['finance','academic']);
const REPORTED=new Set([
  'source_not_connected','unverified_response','result_unknown','disputed'
]);
const KINDS={
 finance:new Set(['finance_receipt','finance_allocation',
   'finance_refund','finance_dispute']),
 academic:new Set(['crm_entitlement','crm_attendance','crm_schedule'])
};
const SOURCE=/^[a-z][a-z0-9_-]{2,63}$/;
const TENANT=/^[A-Za-z0-9_-]{2,80}$/;
const REF=/^[A-Za-z0-9_:./-]{6,160}$/;
const REVISION=/^[A-Za-z0-9_:./-]{2,120}$/;
const EXACT_FIELDS=[
 'schema_version','department','source_kind','source_system',
 'source_tenant','source_object_ref','source_revision',
 'reported_status','observed_at','facts'
];
function plainObject(value) {
 return value!==null&&typeof value==='object'&&!Array.isArray(value)
  &&(Object.getPrototypeOf(value)===Object.prototype||
     Object.getPrototypeOf(value)===null);
}
function fieldsMatch(obj, expected) {
 return plainObject(obj)&&
   Object.keys(obj).length===expected.length&&
   expected.every(k=>Object.hasOwn(obj,k));
}
function boundedInt(n){return Number.isSafeInteger(n)&&n>=0;}
function finiteNonempty(v,pattern){return typeof v==='string'&&pattern.test(v);}
function validFacts(kind,facts){
 if(!plainObject(facts))return false;
 if(kind.startsWith('finance_')){
  return fieldsMatch(facts,['currency','amount_cents','original_record_ref'])
    &&facts.currency==='CNY'&&boundedInt(facts.amount_cents)
    &&finiteNonempty(facts.original_record_ref,REF);
 }
 return fieldsMatch(facts,[
   'student_ref','package_ref','delivered_units',
   'consumed_units','remaining_units'])
  &&finiteNonempty(facts.student_ref,REF)
  &&finiteNonempty(facts.package_ref,REF)
  &&boundedInt(facts.delivered_units)
  &&boundedInt(facts.consumed_units)
  &&boundedInt(facts.remaining_units)
  &&facts.consumed_units<=facts.delivered_units;
}

/**
 * Parser for *untrusted* candidate responses. The caller must provide
 * trusted out-of-band expected department / tenant and system allowlist;
 * a source cannot self-assert these and become an authorized provider.
 * Returned hash proves only exact canonical bytes, not source authenticity.
 */
export function normalizeUntrustedAuthorityCandidate(input,options={}){
 const {expectedDepartment,expectedTenant,allowedSourceSystems,nowMs=Date.now()}=options;
 if(!DEPARTMENTS.has(expectedDepartment) ||
    !finiteNonempty(expectedTenant,TENANT) ||
    !Array.isArray(allowedSourceSystems) ||
    allowedSourceSystems.length===0 ||
    !allowedSourceSystems.every(v=>finiteNonempty(v,SOURCE)) ||
    !Number.isFinite(nowMs))
  throw new TypeError('Untrusted candidate validation requires explicit trusted context');
 if(!fieldsMatch(input,EXACT_FIELDS)||
   input.schema_version!=='v3.2-27-readonly-v1'||
   input.department!==expectedDepartment||
   !KINDS[expectedDepartment].has(input.source_kind)||
   !finiteNonempty(input.source_system,SOURCE)||
   !allowedSourceSystems.includes(input.source_system)||
   input.source_tenant!==expectedTenant||
   !finiteNonempty(input.source_object_ref,REF)||
   !finiteNonempty(input.source_revision,REVISION)||
   !REPORTED.has(input.reported_status)||
   typeof input.observed_at!=='string'||
   !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(input.observed_at)||
   !Number.isFinite(Date.parse(input.observed_at))||
   Date.parse(input.observed_at)<nowMs-365*24*3600000||
   Date.parse(input.observed_at)>nowMs+5*60000||
   !validFacts(input.source_kind,input.facts))
  throw new TypeError('Invalid or untrusted candidate response contract');
 // Fixed-field canonical order, never incorporate caller-controlled extra keys.
 const facts=input.source_kind.startsWith('finance_')
  ?{currency:input.facts.currency,amount_cents:input.facts.amount_cents,
     original_record_ref:input.facts.original_record_ref}
  :{student_ref:input.facts.student_ref,package_ref:input.facts.package_ref,
     delivered_units:input.facts.delivered_units,consumed_units:input.facts.consumed_units,
     remaining_units:input.facts.remaining_units};
 const normalized={
  schema_version:'v3.2-27-readonly-v1',
  department:input.department,source_kind:input.source_kind,
  source_system:input.source_system,source_tenant:input.source_tenant,
  source_object_ref:input.source_object_ref,
  source_revision:input.source_revision,reported_status:input.reported_status,
  observed_at:input.observed_at,facts
 };
 const candidate_sha256=createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
 return Object.freeze({
  candidate_sha256,
  normalized:Object.freeze({...normalized,facts:Object.freeze(facts)}),
  source_authenticated:false,financially_reconciled:false,
  crm_reconciled:false,execution_allowed:false,release_allowed:false,
  reason_zh:'仅检查了候选数据格式；来源身份、资金与课时结果均未验证'
 });
}
