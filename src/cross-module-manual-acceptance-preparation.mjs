// V3.2-78: CI-only fictional manual UAT preparation ledger.
// Materials, internal reviews and historical records can never authorize handoff.
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const FIELD=/^[a-z0-9][a-z0-9._:-]{5,127}$/;
const exact=(x,fields)=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null)&&
 Object.keys(x).length===fields.length&&fields.every(k=>Object.hasOwn(x,k));
const REQUIREMENTS=Object.freeze([
 Object.freeze({code:'finance_signature',owner:'finance',checker:'sales'}),
 Object.freeze({code:'academic_signature',owner:'academic',checker:'sales'}),
 Object.freeze({code:'order_payment_reconciliation',owner:'finance',checker:'sales'}),
 Object.freeze({code:'lesson_entitlement_reconciliation',owner:'academic',checker:'sales'}),
 Object.freeze({code:'three_party_joint_acceptance',owner:'sales',checker:'finance'}),
 Object.freeze({code:'external_atomic_receipt',owner:'sales',checker:'academic'})
]);
const deny=reason_code=>Object.freeze({reason_code,fixture_materials_prepared:false,
 authoritative_evidence_verified:false,external_signature_verified:false,
 independent_three_party_acceptance_verified:false,finance_authorized:false,
 academic_authorized:false,handoff_allowed:false,compensation_write_allowed:false,
 release_eligible:false,hold_active:true,production_integration_allowed:false});
const error=code=>{const e=new Error(code);e.code=code;throw e;};
const key=(org,incident)=>org+'\0'+incident;
const reqByCode=new Map(REQUIREMENTS.map(r=>[r.code,r]));
const STAGES=new Set(['submitted','reviewed']);
export function createIsolatedManualAcceptancePreparation({getFixtureActor,getFixtureEvidenceRevision}={}){
 if(typeof getFixtureActor!=='function'||typeof getFixtureEvidenceRevision!=='function')
  throw new TypeError('Independent CI-only actor and revision providers required');
 const history=new Map(),nonces=new Map();
 function revision(org,incident){
  let n;
  try{n=getFixtureEvidenceRevision(org,incident);}
  catch{error('FIXTURE_REVISION_UNAVAILABLE');}
  if(!Number.isSafeInteger(n)||n<1)error('FIXTURE_REVISION_UNAVAILABLE');
  return n;
 }
 function actor(org,id,expectedRole){
  let identity;
  try{identity=getFixtureActor(org,id);}
  catch{error('FIXTURE_ACTOR_UNAVAILABLE');}
  if(!exact(identity,['actor_id','role','organization_id','active','fixture_only'])||
   identity.actor_id!==id||identity.role!==expectedRole||
   identity.organization_id?.toLowerCase()!==org||
   identity.active!==true||identity.fixture_only!==true)
   error('INDEPENDENT_FIXTURE_ACTOR_NOT_VERIFIED');
 }
 function record(input={}){
  if(!exact(input,['organization_id','incident_id','requirement_code','stage',
   'actor_id','source_revision','evidence_sha256','idempotency_key'])||
   !UUID.test(input.organization_id)||!UUID.test(input.incident_id)||
   !reqByCode.has(input.requirement_code)||!STAGES.has(input.stage)||
   typeof input.actor_id!=='string'||!FIELD.test(input.actor_id)||
   !Number.isSafeInteger(input.source_revision)||input.source_revision<1||
   !SHA.test(input.evidence_sha256)||typeof input.idempotency_key!=='string'||
   !FIELD.test(input.idempotency_key))
   error('INVALID_MANUAL_PREPARATION_INPUT');
  const org=input.organization_id.toLowerCase(),incident=input.incident_id.toLowerCase();
  const requirement=reqByCode.get(input.requirement_code);
  if(revision(org,incident)!==input.source_revision)error('SOURCE_REVISION_STALE');
  const role=input.stage==='submitted'?requirement.owner:requirement.checker;
  actor(org,input.actor_id,role);
  const scope=key(org,incident),nonce=scope+'\0'+input.idempotency_key;
  const immutable=Object.freeze({
   organization_id:org,incident_id:incident,requirement_code:input.requirement_code,
   stage:input.stage,actor_id:input.actor_id,source_revision:input.source_revision,
   evidence_sha256:input.evidence_sha256,fixture_only:true,
   evidence_authenticity_verified:false,approval_granted:false,
   handoff_allowed:false,release_eligible:false,hold_active:true
  });
  const past=nonces.get(nonce);
  if(past){
   const prior=past.record;
   if(Object.keys(immutable).some(k=>immutable[k]!==prior[k]))
    error('PREPARATION_IDEMPOTENCY_CONFLICT');
   // Idempotent retry of an obsolete generation may never be represented
   // as a current acceptance confirmation.
   return prior;
  }
  const all=history.get(scope)||[];
  const same=all.filter(x=>x.source_revision===input.source_revision&&
   x.requirement_code===input.requirement_code);
  if(same.some(x=>x.stage===input.stage))error('REQUIREMENT_STAGE_ALREADY_RECORDED');
  if(input.stage==='reviewed'){
   const submitted=same.find(x=>x.stage==='submitted');
   if(!submitted)error('SUBMISSION_REQUIRED_BEFORE_INDEPENDENT_REVIEW');
   if(submitted.actor_id===input.actor_id)error('SELF_REVIEW_FORBIDDEN');
   if(submitted.evidence_sha256!==input.evidence_sha256)
    error('REVIEW_EVIDENCE_DIGEST_MISMATCH');
  }
  history.set(scope,[...all,immutable]);nonces.set(nonce,{record:immutable});
  return immutable;
 }
 function report(input={}){
  if(!exact(input,['organization_id','incident_id'])||
   !UUID.test(input.organization_id)||!UUID.test(input.incident_id))
   return Object.freeze({...deny('INVALID_PREPARATION_REPORT_INPUT'),items:Object.freeze([])});
  const org=input.organization_id.toLowerCase(),incident=input.incident_id.toLowerCase();
  let current;
  try{current=revision(org,incident);}
  catch{return Object.freeze({...deny('FIXTURE_REVISION_UNAVAILABLE'),items:Object.freeze([])});}
  const currentRecords=(history.get(key(org,incident))||[]).filter(
   x=>x.source_revision===current);
  const items=REQUIREMENTS.map(r=>{
   const submitted=currentRecords.find(x=>x.requirement_code===r.code&&x.stage==='submitted');
   const reviewed=currentRecords.find(x=>x.requirement_code===r.code&&x.stage==='reviewed');
   let status='awaiting_material';
   if(submitted)status='awaiting_independent_check';
   if(submitted&&reviewed){
    // Re-check actors at read time: removed roles must invalidate fixture results.
    try{
     actor(org,submitted.actor_id,r.owner);
     actor(org,reviewed.actor_id,r.checker);
     if(submitted.actor_id!==reviewed.actor_id&&
      submitted.evidence_sha256===reviewed.evidence_sha256)
      status='fixture_review_recorded_not_authorized';
    }catch{status='reviewer_revoked_or_unavailable';}
   }
   return Object.freeze({requirement_code:r.code,owner:r.owner,checker:r.checker,
    status,external_authority_verified:false,release_eligible:false});
  });
  return Object.freeze({...deny('BLOCKED_EXTERNAL_MANUAL_ACCEPTANCE_REQUIRED'),
   fixture_materials_prepared:items.every(x=>x.status==='fixture_review_recorded_not_authorized'),
   source_revision:current,items:Object.freeze(items)});
 }
 function audit(input={}){
  if(!exact(input,['organization_id','incident_id'])||
   !UUID.test(input.organization_id)||!UUID.test(input.incident_id))
   return Object.freeze([]);
  return Object.freeze([...(history.get(key(input.organization_id.toLowerCase(),
   input.incident_id.toLowerCase()))||[])]);
 }
 return Object.freeze({record,report,audit});
}
