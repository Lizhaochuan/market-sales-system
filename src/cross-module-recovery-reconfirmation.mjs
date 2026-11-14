// V3.2-75 CI-only recovery evidence reconfirmation. No real identities,
// signatures, finance/academic approval, transfer or release capabilities.
import {createHash} from 'node:crypto';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const REQUIRED=['market_sales','finance','academic'];
const REVIEW_STAGES=['sales_evidence_check','independent_safety_check'];
const own=(o,k)=>Object.hasOwn(o,k);
const plain=o=>o!==null&&typeof o==='object'&&!Array.isArray(o)&&
 (Object.getPrototypeOf(o)===Object.prototype||Object.getPrototypeOf(o)===null);
const exact=(o,fields)=>plain(o)&&Object.keys(o).length===fields.length&&fields.every(k=>own(o,k));
const pos=n=>Number.isSafeInteger(n)&&n>0;
const fail=code=>{const e=new Error(code);e.code=code;throw e;};
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const denied=reason_code=>Object.freeze({reason_code,
 fixture_reconfirmation_complete:false,independent_external_signatures_verified:false,
 finance_authorized:false,academic_authorized:false,handoff_allowed:false,
 compensation_write_allowed:false,release_eligible:false,hold_active:true,
 production_integration_allowed:false});
function validateSnapshot(snapshot,org,incident){
 if(!exact(snapshot,['organization_id','incident_id','generation','sources'])||
  typeof snapshot.organization_id!=='string'||
  typeof snapshot.incident_id!=='string'||
  !UUID.test(snapshot.organization_id)||!UUID.test(snapshot.incident_id)||
  snapshot.organization_id.toLowerCase()!==org||
  snapshot.incident_id.toLowerCase()!==incident||
  !pos(snapshot.generation)||!Array.isArray(snapshot.sources)||
  snapshot.sources.length!==REQUIRED.length)return null;
 const seen=new Set(),sources=[];
 for(const s of snapshot.sources){
  if(!exact(s,['domain','source_epoch','source_revision','revocation_sequence',
   'revocation_digest','evidence_digest','hold_active','availability'])||
   !REQUIRED.includes(s.domain)||seen.has(s.domain)||
   !pos(s.source_epoch)||!pos(s.source_revision)||
   !Number.isSafeInteger(s.revocation_sequence)||s.revocation_sequence<0||
   !SHA.test(s.revocation_digest)||!SHA.test(s.evidence_digest)||
   s.hold_active!==true||s.availability!=='online')return null;
  seen.add(s.domain);
  sources.push({domain:s.domain,source_epoch:s.source_epoch,
   source_revision:s.source_revision,revocation_sequence:s.revocation_sequence,
   revocation_digest:s.revocation_digest,evidence_digest:s.evidence_digest});
 }
 sources.sort((a,b)=>REQUIRED.indexOf(a.domain)-REQUIRED.indexOf(b.domain));
 return Object.freeze({generation:snapshot.generation,sources,
  digest:hash({generation:snapshot.generation,sources})});
}
function validateReviewer(x,stage){
 return exact(x,['reviewer_id','role','active','fixture_only'])&&
 typeof x.reviewer_id==='string'&&/^[A-Za-z0-9_-]{4,64}$/.test(x.reviewer_id)&&
 x.role===stage&&x.active===true&&x.fixture_only===true;
}
/**
 * All calls are test-only; the test harness resolves the source and reviewer
 * from independent callbacks. Serialized synchronous in-memory records are
 * NOT a durable multi-node transaction or an identity provider.
 */
export function createIsolatedRecoveryReconfirmation({getFixtureSnapshot,getFixtureReviewer}={}){
 if(typeof getFixtureSnapshot!=='function'||typeof getFixtureReviewer!=='function')
  throw new TypeError('Independent fictional source and reviewer providers required');
 const records=new Map(),nonces=new Map(),history=[];
 function source(org,incident){
  let value;
  try{value=getFixtureSnapshot(org,incident);}catch{fail('FIXTURE_SOURCE_UNAVAILABLE');}
  const result=validateSnapshot(value,org,incident);
  if(!result)fail('FIXTURE_SOURCE_INVALID_OR_OFFLINE');
  return result;
 }
 const key=(org,incident)=>org+'\0'+incident;
 function reconfirm({organization_id,incident_id,stage,reviewer_id,
  source_digest,idempotency_key}={}){
  if(!exact(arguments[0],['organization_id','incident_id','stage','reviewer_id','source_digest','idempotency_key'])||
   !UUID.test(organization_id)||!UUID.test(incident_id)||
   !REVIEW_STAGES.includes(stage)||typeof reviewer_id!=='string'||
   !SHA.test(source_digest)||typeof idempotency_key!=='string'||
   !/^[A-Za-z0-9._:-]{16,128}$/.test(idempotency_key))
   fail('INVALID_RECONFIRMATION_REQUEST');
  const org=organization_id.toLowerCase(),incident=incident_id.toLowerCase();
  const current=source(org,incident);
  if(current.digest!==source_digest)fail('EVIDENCE_RECONFIRMATION_STALE');
  let reviewer;
  try{reviewer=getFixtureReviewer(org,reviewer_id);}
  catch{fail('FIXTURE_REVIEWER_UNAVAILABLE');}
  if(!validateReviewer(reviewer,stage)||reviewer.reviewer_id!==reviewer_id)
   fail('INDEPENDENT_REVIEWER_NOT_VERIFIED');
  const scope=key(org,incident),nonceKey=scope+'\0'+idempotency_key;
  const payload={organization_id:org,incident_id:incident,stage,reviewer_id,
   source_digest:current.digest,generation:current.generation};
  const fingerprint=hash(payload),previous=nonces.get(nonceKey);
  if(previous){
   if(previous.fingerprint!==fingerprint)fail('RECONFIRMATION_NONCE_CONFLICT');
   return previous.record;
  }
  const existing=records.get(scope)||[];
  const same=existing.filter(x=>x.source_digest===current.digest);
  if(same.some(x=>x.stage===stage))fail('REVIEW_STAGE_ALREADY_RECORDED');
  if(same.some(x=>x.reviewer_id===reviewer_id))fail('REVIEWER_SELF_APPROVAL_FORBIDDEN');
  if(stage==='independent_safety_check'&&!same.some(x=>x.stage==='sales_evidence_check'))
   fail('SALES_EVIDENCE_CHECK_REQUIRED');
  const record=Object.freeze({...payload,sequence:history.length+1,
   fixture_only:true,finance_authorized:false,academic_authorized:false,
   handoff_allowed:false,release_eligible:false,hold_active:true});
  const next=[...existing,record];
  records.set(scope,next);nonces.set(nonceKey,{fingerprint,record});
  history.push(record);
  return record;
 }
 function check({organization_id,incident_id,source_digest}={}){
  if(!exact(arguments[0],['organization_id','incident_id','source_digest'])||
   !UUID.test(organization_id)||!UUID.test(incident_id)||!SHA.test(source_digest))
   return denied('INVALID_RECONFIRMATION_REFERENCE');
  const org=organization_id.toLowerCase(),incident=incident_id.toLowerCase();
  let current;
  try{current=source(org,incident);}catch{return denied('FIXTURE_SOURCE_UNAVAILABLE_OR_INVALID');}
  if(current.digest!==source_digest)return denied('EVIDENCE_CHANGED_RECONFIRMATION_REQUIRED');
  const same=(records.get(key(org,incident))||[]).filter(x=>x.source_digest===current.digest);
  if(!REVIEW_STAGES.every(stage=>same.some(x=>x.stage===stage))||
   new Set(same.map(x=>x.reviewer_id)).size!==REVIEW_STAGES.length)
   return denied('INDEPENDENT_RECONFIRMATION_INCOMPLETE');
  for(const row of same){
   let reviewer;
   try{reviewer=getFixtureReviewer(org,row.reviewer_id);}
   catch{return denied('REVIEWER_REVOKED_OR_UNAVAILABLE');}
   if(!validateReviewer(reviewer,row.stage)||reviewer.reviewer_id!==row.reviewer_id)
    return denied('REVIEWER_REVOKED_OR_UNAVAILABLE');
  }
  return Object.freeze({...denied('BLOCKED_REAL_EXTERNAL_REVIEW_AND_HANDOFF_MISSING'),
   fixture_reconfirmation_complete:true});
 }
 function audit({organization_id,incident_id}={}){
  if(!UUID.test(organization_id)||!UUID.test(incident_id))return Object.freeze([]);
  const entries=records.get(key(organization_id.toLowerCase(),incident_id.toLowerCase()))||[];
  return Object.freeze([...entries]);
 }
 return Object.freeze({reconfirm,check,audit});
}
