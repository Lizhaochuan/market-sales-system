// V3.2-80: CI-only independent supplement review ledger.
// A review acknowledges fictional material bytes only; never external authority.
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const SAFE=/^[a-z0-9][a-z0-9._:-]{5,127}$/;
const REQUIREMENTS=Object.freeze({
 finance_signature:{owner:'finance',checker:'sales'},
 academic_signature:{owner:'academic',checker:'sales'},
 order_payment_reconciliation:{owner:'finance',checker:'sales'},
 lesson_entitlement_reconciliation:{owner:'academic',checker:'sales'},
 three_party_joint_acceptance:{owner:'sales',checker:'finance'},
 external_atomic_receipt:{owner:'sales',checker:'academic'}
});
const exact=(x,keys)=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null)&&
 Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const reject=code=>{const e=new Error(code);e.code=code;throw e;};
const safeResult=(reason_code)=>Object.freeze({
 reason_code,fixture_independent_supplement_review_current:false,
 external_evidence_authenticated:false,external_finance_signature_verified:false,
 external_academic_signature_verified:false,independent_three_party_acceptance_verified:false,
 finance_authorized:false,academic_authorized:false,handoff_allowed:false,
 compensation_write_allowed:false,release_eligible:false,hold_active:true,
 production_integration_allowed:false
});
const scopeKey=(org,incident,requirement)=>org+'\0'+incident+'\0'+requirement;
export function createIsolatedSupplementReview({supplements,preparation,getFixtureActor}={}){
 if(!supplements||typeof supplements.report!=='function'||
  typeof supplements.audit!=='function'||!preparation||
  typeof preparation.audit!=='function'||typeof getFixtureActor!=='function')
  throw new TypeError('Independent CI-only evidence, audit and actor adapters required');
 const records=new Map(),nonces=new Map();
 function reviewer(org,id,role){
  let result;
  try{result=getFixtureActor(org,id);}catch{reject('REVIEWER_IDENTITY_UNAVAILABLE');}
  if(!exact(result,['actor_id','role','organization_id','active','fixture_only'])||
   result.actor_id!==id||result.role!==role||
   typeof result.organization_id!=='string'||
   result.organization_id.toLowerCase()!==org||
   result.active!==true||result.fixture_only!==true)
   reject('REVIEWER_IDENTITY_NOT_VALID');
 }
 function latest(org,incident,requirement){
  const q={organization_id:org,incident_id:incident,requirement_code:requirement};
  let state,history,originals;
  try{state=supplements.report(q);history=supplements.audit(q);
   originals=preparation.audit({organization_id:org,incident_id:incident});}
  catch{reject('EVIDENCE_CHAIN_UNAVAILABLE');}
  if(!state||state.fixture_chain_valid!==true||
   state.fixture_supplements_current!==true||
   state.reason_code!=='BLOCKED_INDEPENDENT_SUPPLEMENT_REVIEW_AND_EXTERNAL_AUTHORITY_MISSING'||
   !Number.isSafeInteger(state.current_source_revision)||
   !SHA.test(state.current_chain_digest)||
   !Array.isArray(history)||!Array.isArray(originals))
   reject('CURRENT_SUPPLEMENT_NOT_VERIFIED');
  const current=history.filter(x=>x&&x.organization_id===org&&x.incident_id===incident&&
   x.requirement_code===requirement&&
   x.source_revision===state.current_source_revision).at(-1);
  if(!current||current.fixture_only!==true||
   !Number.isSafeInteger(current.supplement_version)||
   current.supplement_version<1||current.chain_digest!==state.current_chain_digest||
   !SHA.test(current.evidence_sha256)||!SHA.test(current.original_submission_sha256))
   reject('LATEST_SUPPLEMENT_MISMATCH');
  const initial=originals.filter(x=>x&&x.organization_id===org&&
   x.incident_id===incident&&x.requirement_code===requirement&&
   x.source_revision===current.source_revision&&x.stage==='submitted');
  if(initial.length!==1||initial[0].fixture_only!==true||
   initial[0].evidence_sha256!==current.original_submission_sha256||
   initial[0].actor_id!==current.submitted_by)
   reject('ORIGINAL_SUBMISSION_MISMATCH');
  return current;
 }
 function review(input={}){
  if(!exact(input,['organization_id','incident_id','requirement_code',
   'source_revision','supplement_version','chain_digest','reviewer_id','idempotency_key'])||
   !UUID.test(input.organization_id)||!UUID.test(input.incident_id)||
   !Object.hasOwn(REQUIREMENTS,input.requirement_code)||
   !Number.isSafeInteger(input.source_revision)||input.source_revision<1||
   !Number.isSafeInteger(input.supplement_version)||input.supplement_version<1||
   !SHA.test(input.chain_digest)||typeof input.reviewer_id!=='string'||
   !SAFE.test(input.reviewer_id)||typeof input.idempotency_key!=='string'||
   !SAFE.test(input.idempotency_key))reject('INVALID_SUPPLEMENT_REVIEW_INPUT');
  const org=input.organization_id.toLowerCase(),incident=input.incident_id.toLowerCase();
  const current=latest(org,incident,input.requirement_code);
  if(current.source_revision!==input.source_revision||
   current.supplement_version!==input.supplement_version||
   current.chain_digest!==input.chain_digest)reject('SUPPLEMENT_REVIEW_VERSION_STALE');
  if(input.reviewer_id===current.submitted_by)reject('SELF_REVIEW_FORBIDDEN');
  reviewer(org,input.reviewer_id,REQUIREMENTS[input.requirement_code].checker);
  const sk=scopeKey(org,incident,input.requirement_code);
  const nonce=org+'\0'+input.idempotency_key;
  const payload=Object.freeze({organization_id:org,incident_id:incident,
   requirement_code:input.requirement_code,source_revision:input.source_revision,
   supplement_version:input.supplement_version,chain_digest:input.chain_digest,
   original_submission_sha256:current.original_submission_sha256,
   reviewer_id:input.reviewer_id,submitted_by:current.submitted_by,
   fixture_only:true,external_signature_verified:false,
   approval_granted:false,handoff_allowed:false,release_eligible:false,hold_active:true});
  const prior=nonces.get(nonce);
  if(prior){
   if(Object.keys(payload).some(k=>prior[k]!==payload[k]))
    reject('REVIEW_IDEMPOTENCY_CONFLICT');
   if(records.get(sk)?.at(-1)!==prior)reject('SUPERSEDED_REVIEW_REPLAY');
   return prior;
  }
  if(records.get(sk)?.some(x=>x.source_revision===payload.source_revision&&
   x.chain_digest===payload.chain_digest))reject('SUPPLEMENT_VERSION_ALREADY_REVIEWED');
  const next=[...(records.get(sk)||[]),payload];
  records.set(sk,next);nonces.set(nonce,payload);
  return payload;
 }
 function report(input={}){
  if(!exact(input,['organization_id','incident_id','requirement_code'])||
   !UUID.test(input.organization_id)||!UUID.test(input.incident_id)||
   !Object.hasOwn(REQUIREMENTS,input.requirement_code))
   return safeResult('INVALID_SUPPLEMENT_REVIEW_REPORT_SCOPE');
  const org=input.organization_id.toLowerCase(),incident=input.incident_id.toLowerCase();
  let current;
  try{current=latest(org,incident,input.requirement_code);}
  catch{return safeResult('LATEST_SUPPLEMENT_UNAVAILABLE_OR_STALE');}
  const sk=scopeKey(org,incident,input.requirement_code);
  const found=(records.get(sk)||[]).filter(x=>x.source_revision===current.source_revision&&
   x.supplement_version===current.supplement_version&&
   x.chain_digest===current.chain_digest);
  if(found.length!==1)return safeResult('INDEPENDENT_CURRENT_SUPPLEMENT_REVIEW_REQUIRED');
  try{reviewer(org,found[0].reviewer_id,REQUIREMENTS[input.requirement_code].checker);}
  catch{return safeResult('REVIEWER_REVOKED_OR_UNAVAILABLE');}
  if(found[0].reviewer_id===current.submitted_by)
   return safeResult('SELF_REVIEW_FORBIDDEN');
  return Object.freeze({...safeResult('BLOCKED_EXTERNAL_SUPPLEMENT_AUTHORITY_NOT_CONNECTED'),
   fixture_independent_supplement_review_current:true});
 }
 function audit(input={}){
  if(!exact(input,['organization_id','incident_id','requirement_code'])||
   !UUID.test(input.organization_id)||!UUID.test(input.incident_id)||
   !Object.hasOwn(REQUIREMENTS,input.requirement_code))return Object.freeze([]);
  return Object.freeze([...(records.get(scopeKey(input.organization_id.toLowerCase(),
   input.incident_id.toLowerCase(),input.requirement_code))||[])]);
 }
 return Object.freeze({review,report,audit});
}
