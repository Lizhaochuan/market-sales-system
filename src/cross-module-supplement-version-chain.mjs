// V3.2-79: CI-only append-only fictional evidence supplement chain.
// Not a production persistence, signing, finance or academic authorization API.
import {createHash} from 'node:crypto';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const SAFE=/^[a-z0-9][a-z0-9._:-]{5,127}$/;
const CODES=new Set(['finance_signature','academic_signature',
 'order_payment_reconciliation','lesson_entitlement_reconciliation',
 'three_party_joint_acceptance','external_atomic_receipt']);
const exact=(x,fields)=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null)&&
 Object.keys(x).length===fields.length&&fields.every(k=>Object.hasOwn(x,k));
const sha=x=>createHash('sha256').update(JSON.stringify(x),'utf8').digest('hex');
const error=code=>{const e=new Error(code);e.code=code;throw e;};
const key=(org,incident,code)=>org+'\0'+incident+'\0'+code;
const denied=(reason_code,records=[])=>Object.freeze({
 reason_code,fixture_supplements_current:false,fixture_chain_valid:false,
 external_evidence_authenticated:false,external_finance_signature_verified:false,
 external_academic_signature_verified:false,three_party_acceptance_verified:false,
 finance_authorized:false,academic_authorized:false,handoff_allowed:false,
 compensation_write_allowed:false,release_eligible:false,hold_active:true,
 records:Object.freeze(records)
});
export function createIsolatedSupplementVersionChain({preparation,getFixtureRevision}={}){
 if(!preparation||typeof preparation.audit!=='function'||
  typeof getFixtureRevision!=='function')
  throw TypeError('Independent fixture preparation and revision required');
 const chains=new Map(),nonces=new Map();
 function revision(org,incident){
  let result;
  try{result=getFixtureRevision(org,incident);}catch{error('SOURCE_REVISION_UNAVAILABLE');}
  if(!Number.isSafeInteger(result)||result<1)error('SOURCE_REVISION_UNAVAILABLE');
  return result;
 }
 function anchor(org,incident,requirement_code,source_revision){
  let history;
  try{history=preparation.audit({organization_id:org,incident_id:incident});}
  catch{error('PREPARATION_AUDIT_UNAVAILABLE');}
  if(!Array.isArray(history))error('PREPARATION_AUDIT_UNAVAILABLE');
  const rows=history.filter(x=>x&&x.organization_id===org&&
   x.incident_id===incident&&x.requirement_code===requirement_code&&
   x.source_revision===source_revision);
  const submitted=rows.filter(x=>x.stage==='submitted');
  if(submitted.length!==1||submitted[0].fixture_only!==true||
   !SHA.test(submitted[0].evidence_sha256))error('ORIGINAL_SUBMISSION_NOT_FOUND');
  const reviewed=rows.filter(x=>x.stage==='reviewed');
  if(reviewed.length>1)error('PREPARATION_AUDIT_CONFLICT');
  if(reviewed.length===1&&(reviewed[0].fixture_only!==true||
   reviewed[0].evidence_sha256!==submitted[0].evidence_sha256||
   reviewed[0].actor_id===submitted[0].actor_id))error('PREPARATION_AUDIT_CONFLICT');
  return submitted[0];
 }
 function append(input={}){
  if(!exact(input,['organization_id','incident_id','requirement_code',
   'source_revision','supplement_version','parent_digest','evidence_sha256',
   'submitted_by','idempotency_key'])||
   !UUID.test(input.organization_id)||!UUID.test(input.incident_id)||
   !CODES.has(input.requirement_code)||
   !Number.isSafeInteger(input.source_revision)||input.source_revision<1||
   !Number.isSafeInteger(input.supplement_version)||input.supplement_version<1||
   !SHA.test(input.parent_digest)||!SHA.test(input.evidence_sha256)||
   typeof input.submitted_by!=='string'||!SAFE.test(input.submitted_by)||
   typeof input.idempotency_key!=='string'||!SAFE.test(input.idempotency_key))
   error('INVALID_SUPPLEMENT_REQUEST');
  const org=input.organization_id.toLowerCase(),incident=input.incident_id.toLowerCase();
  if(revision(org,incident)!==input.source_revision)error('SOURCE_REVISION_STALE');
  const original=anchor(org,incident,input.requirement_code,input.source_revision);
  if(input.submitted_by!==original.actor_id)
   error('SUPPLEMENT_OWNER_NOT_ORIGINAL_SUBMITTER');
  const scope=key(org,incident,input.requirement_code),items=chains.get(scope)||[];
  const active=items.filter(x=>x.source_revision===input.source_revision);
  const last=active.at(-1);
  const expected=last?last.supplement_version+1:1;
  const expectedParent=last?last.chain_digest:original.evidence_sha256;
  const nonceKey=org+'\0'+input.idempotency_key;
  const payload={organization_id:org,incident_id:incident,
   requirement_code:input.requirement_code,source_revision:input.source_revision,
   supplement_version:input.supplement_version,parent_digest:input.parent_digest,
   evidence_sha256:input.evidence_sha256,submitted_by:input.submitted_by};
  const nonceFingerprint=sha(payload),previous=nonces.get(nonceKey);
  if(previous){
   if(previous.fingerprint!==nonceFingerprint)error('SUPPLEMENT_IDEMPOTENCY_CONFLICT');
   if(last!==previous.record)error('SUPERSEDED_SUPPLEMENT_REPLAY');
   return previous.record;
  }
  if(input.supplement_version!==expected)error('SUPPLEMENT_VERSION_GAP_OR_REPLAY');
  if(input.parent_digest!==expectedParent)error('SUPPLEMENT_PARENT_DIGEST_MISMATCH');
  if(input.evidence_sha256===input.parent_digest)
   error('SUPPLEMENT_EVIDENCE_UNCHANGED');
  const record=Object.freeze({...payload,chain_digest:sha({
   schema_version:'v3.2-79-ci-supplement-v1',...payload}),
   original_submission_sha256:original.evidence_sha256,
   fixture_only:true,approval_granted:false,handoff_allowed:false,
   release_eligible:false,hold_active:true});
  chains.set(scope,[...items,record]);
  nonces.set(nonceKey,{fingerprint:nonceFingerprint,record});
  return record;
 }
 function report(input={}){
  if(!exact(input,['organization_id','incident_id','requirement_code'])||
   !UUID.test(input.organization_id)||!UUID.test(input.incident_id)||
   !CODES.has(input.requirement_code))
   return denied('INVALID_SUPPLEMENT_REPORT_SCOPE');
  const org=input.organization_id.toLowerCase(),incident=input.incident_id.toLowerCase();
  let current,original;
  try{
   current=revision(org,incident);
   original=anchor(org,incident,input.requirement_code,current);
  }catch{return denied('SOURCE_OR_ORIGINAL_SUBMISSION_UNAVAILABLE');}
  const items=(chains.get(key(org,incident,input.requirement_code))||[])
   .filter(x=>x.source_revision===current);
  if(items.length===0)return denied('NO_CURRENT_SUPPLEMENT_RECORDED');
  let parent=original.evidence_sha256;
  for(let i=0;i<items.length;i++){
   const x=items[i];
   if(x.supplement_version!==i+1||x.parent_digest!==parent||
      x.original_submission_sha256!==original.evidence_sha256||
      x.chain_digest!==sha({schema_version:'v3.2-79-ci-supplement-v1',
       organization_id:x.organization_id,incident_id:x.incident_id,
       requirement_code:x.requirement_code,source_revision:x.source_revision,
       supplement_version:x.supplement_version,parent_digest:x.parent_digest,
       evidence_sha256:x.evidence_sha256,submitted_by:x.submitted_by}))
    return denied('SUPPLEMENT_CHAIN_INTEGRITY_FAILED',items);
   parent=x.chain_digest;
  }
  return Object.freeze({...denied('BLOCKED_INDEPENDENT_SUPPLEMENT_REVIEW_AND_EXTERNAL_AUTHORITY_MISSING',items),
   fixture_supplements_current:true,fixture_chain_valid:true,
   current_source_revision:current,current_chain_digest:parent,
   independent_supplement_review_verified:false});
 }
 function audit(input={}){
  if(!exact(input,['organization_id','incident_id','requirement_code'])||
   !UUID.test(input.organization_id)||!UUID.test(input.incident_id)||
   !CODES.has(input.requirement_code))return Object.freeze([]);
  return Object.freeze([...(chains.get(key(input.organization_id.toLowerCase(),
   input.incident_id.toLowerCase(),input.requirement_code))||[])]);
 }
 return Object.freeze({append,report,audit});
}
