// V3.2-113: CI-only completeness and independent fixture reviewer assignment.
// A fixture reviewer is NOT an appointed real human or a business approver.
import {createHash,createPublicKey,verify as edVerify} from 'node:crypto';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const ID=/^[a-z0-9][a-z0-9._:-]{5,127}$/;
const ROLES=Object.freeze({
 sales_owner:['crm_sales','student_order_attribution'],
 finance_owner:['finance_ledger','payment_ownership_reconciliation'],
 academic_owner:['academic_ledger','lesson_fulfilment_reconciliation'],
 security_identity_owner:['identity_provider','identity_key_revocation'],
 integration_owner:['integration_service','cross_domain_barrier_contract'],
 database_owner:['audit_store','audit_checkpoint_evidence']
});
const CLAIM=['schema_version','submission_id','organization_id','incident_id',
 'student_id','family_id','owner_role','claimed_owner_id','claimed_submitter_id',
 'claimed_source_system','evidence_type','source_revision','source_revocation_sequence',
 'original_history_digest','evidence_digest','linked_v110_notice_digest',
 'submitted_at_ms','expires_at_ms','claimed_approval_state','fixture_only'];
const EVENT=['schema_version','scope','sequence','previous_event_digest',
 'claim_digest','submission_id','owner_role','evidence_digest','claimed_owner_id',
 'claimed_submitter_id','status','recorded_at_ms'];
const SOURCE_STATUS=['schema_version','organization_id','incident_id','student_id',
 'owner_role','source_revision','revocation_sequence','revoked','observed_at_ms',
 'fixture_only'];
const REVIEWER=['schema_version','organization_id','incident_id','student_id',
 'reviewer_id','reviewer_role','active','authorization_revision',
 'revocation_sequence','issued_at_ms','expires_at_ms','fixture_only'];
const ASSIGNMENT=['schema_version','scope','reviewer_id','reviewer_role',
 'reviewer_attestation_digest','intake_head_sequence','intake_head_digest',
 'evidence_snapshot_digest','evidence_count','status','assigned_at_ms'];
const exact=(x,keys)=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null)&&
 Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const payload=(x,keys)=>Object.fromEntries(keys.map(k=>[k,x[k]]));
const fault=code=>{const err=new Error(code);err.code=code;throw err;};
const denied=(reason_code,more={})=>Object.freeze({
 reason_code,fixture_review_assignment_recorded:false,
 external_reviewer_appointed:false,external_owner_verified:false,
 real_evidence_verified:false,finance_authorized:false,
 academic_authorized:false,external_authority_verified:false,
 handoff_allowed:false,compensation_write_allowed:false,
 release_eligible:false,hold_active:true,
 production_integration_allowed:false,merge_authorized:false,
 deploy_authorized:false,...more
});
const validScope=x=>exact(x,['organization_id','incident_id','student_id'])&&
 Object.values(x).every(v=>typeof v==='string'&&UUID.test(v));
function checkReviewer(raw,key,scope,reviewerId,t){
 if(!exact(raw,[...REVIEWER,'signature'])||typeof raw.signature!=='string')
  fault('REVIEWER_FIXTURE_ATTESTATION_INVALID');
 let sig;
 try{sig=Buffer.from(raw.signature,'base64url');}
 catch{fault('REVIEWER_FIXTURE_ATTESTATION_INVALID');}
 if(sig.length!==64||sig.toString('base64url')!==raw.signature||
  !edVerify(null,Buffer.from(JSON.stringify(payload(raw,REVIEWER))),key,sig))
  fault('REVIEWER_FIXTURE_ATTESTATION_INVALID');
 const r=payload(raw,REVIEWER);
 if(r.schema_version!=='v3.2-113-ci-reviewer-attestation-v1'||
  Object.keys(scope).some(k=>r[k]!==scope[k])||
  r.reviewer_id!==reviewerId||
  r.reviewer_role!=='independent_evidence_reviewer'||
  r.active!==true||r.fixture_only!==true||
  !Number.isSafeInteger(r.authorization_revision)||r.authorization_revision<1||
  !Number.isSafeInteger(r.revocation_sequence)||r.revocation_sequence<0||
  !Number.isSafeInteger(r.issued_at_ms)||!Number.isSafeInteger(r.expires_at_ms)||
  r.issued_at_ms>t||r.expires_at_ms<=t||
  r.expires_at_ms-r.issued_at_ms>300000)
  fault('REVIEWER_FIXTURE_INACTIVE_EXPIRED_OR_WRONG_SCOPE');
 return digest(raw);
}
function checkClaim(raw,event,scope,t){
 if(!exact(raw,CLAIM)||raw.schema_version!=='v3.2-112-ci-untrusted-evidence-claim-v1'||
  digest(raw)!==event.claim_digest||raw.submission_id!==event.submission_id||
  Object.keys(scope).some(k=>raw[k]!==scope[k])||
  raw.owner_role!==event.owner_role||
  raw.claimed_owner_id!==event.claimed_owner_id||
  raw.claimed_submitter_id!==event.claimed_submitter_id||
  raw.evidence_digest!==event.evidence_digest||
  raw.claimed_source_system!==ROLES[event.owner_role]?.[0]||
  raw.evidence_type!==ROLES[event.owner_role]?.[1]||
  raw.claimed_approval_state!=='UNVERIFIED_SUBMISSION'||
  raw.fixture_only!==true||
  !Number.isSafeInteger(raw.source_revision)||raw.source_revision<1||
  !Number.isSafeInteger(raw.source_revocation_sequence)||raw.source_revocation_sequence<0||
  !Number.isSafeInteger(raw.submitted_at_ms)||raw.submitted_at_ms>t||
  !Number.isSafeInteger(raw.expires_at_ms)||raw.expires_at_ms<=t||
  !SHA.test(raw.original_history_digest)||!SHA.test(raw.evidence_digest)||
  !SHA.test(raw.linked_v110_notice_digest)||
  !(raw.family_id===null||UUID.test(raw.family_id)))
  fault('REVIEW_EVIDENCE_MISSING_EXPIRED_OR_TAMPERED');
 return raw;
}
export function createIsolatedReviewerAssignment({
 intakeLedger,assignmentLedger,readFixtureClaim,readFixtureSourceStatus,
 readSignedFixtureReviewer,fixtureReviewerPublicKey,getFixtureNow,
 afterAssignmentWrite=async()=>{}
}={}){
 if(!intakeLedger||typeof intakeLedger.head!=='function'||
  typeof intakeLedger.event!=='function'||!assignmentLedger||
  typeof assignmentLedger.bind!=='function'||typeof assignmentLedger.read!=='function'||
  typeof readFixtureClaim!=='function'||typeof readFixtureSourceStatus!=='function'||
  typeof readSignedFixtureReviewer!=='function'||
  typeof fixtureReviewerPublicKey!=='string'||
  typeof getFixtureNow!=='function'||typeof afterAssignmentWrite!=='function')
  throw TypeError('V113 requires CI-only intake, review registry, and isolated SQL assignment ledger');
 const key=createPublicKey(fixtureReviewerPublicKey);
 if(key.asymmetricKeyType!=='ed25519')
  throw TypeError('Fixture reviewer public key must use Ed25519');
 const queues=new Map(),clockHigh=new Map();
 function now(scope){
  let t;
  try{t=getFixtureNow();}catch{fault('REVIEW_FIXTURE_CLOCK_INVALID');}
  const k=Object.values(scope).join('|');
  if(!Number.isSafeInteger(t)||t<=0||t<(clockHigh.get(k)||0))
   fault('REVIEW_FIXTURE_CLOCK_INVALID');
  clockHigh.set(k,t);return t;
 }
 async function collect(scope,t){
  const head=await intakeLedger.head(scope);
  if(!exact(head,['sequence','event_digest'])||
   !Number.isSafeInteger(head.sequence)||head.sequence<1||
   head.sequence>64||!SHA.test(head.event_digest))
   fault('REVIEW_INTAKE_CHAIN_MISSING_OR_UNVERIFIED');
  const latest=new Map();let previous='0'.repeat(64);
  for(let seq=1;seq<=head.sequence;seq++){
   const event=await intakeLedger.event(scope,seq);
   if(!exact(event,EVENT)||event.schema_version!=='v3.2-112-ci-quarantined-intake-v1'||
    !validScope(event.scope)||Object.keys(scope).some(k=>event.scope[k]!==scope[k])||
    event.sequence!==seq||event.previous_event_digest!==previous||
    event.status!=='PENDING_INDEPENDENT_VERIFICATION'||
    !Object.hasOwn(ROLES,event.owner_role)||!SHA.test(event.claim_digest)||
    !SHA.test(event.evidence_digest)||!UUID.test(event.submission_id))
    fault('REVIEW_INTAKE_CHAIN_MISSING_OR_UNVERIFIED');
   previous=digest(event);
   latest.set(event.owner_role,event);
  }
  if(head.event_digest!==previous)
   fault('REVIEW_INTAKE_CHAIN_MISSING_OR_UNVERIFIED');
  const missing=Object.keys(ROLES).filter(role=>!latest.has(role));
  if(missing.length)return {head,missing,claims:null,records:null};
  const claims={},records={};
  let familyMarker,historyMarker,noticeMarker;
  const owners=new Set(),submitters=new Set();
  for(const role of Object.keys(ROLES)){
   const record=latest.get(role);
   const raw=await readFixtureClaim({scope,submission_id:record.submission_id});
   const c=checkClaim(raw,record,scope,t);
   const fam=c.family_id??'NONE';
   if(familyMarker===undefined){familyMarker=fam;historyMarker=c.original_history_digest;
    noticeMarker=c.linked_v110_notice_digest;}
   if(fam!==familyMarker||c.original_history_digest!==historyMarker||
    c.linked_v110_notice_digest!==noticeMarker)
    fault('REVIEW_CROSS_MODULE_HISTORY_FAMILY_OR_NOTICE_CONFLICT');
   if(owners.has(c.claimed_owner_id)||submitters.has(c.claimed_submitter_id))
    fault('REVIEW_SUBMISSION_ROLE_SEPARATION_FAILED');
   owners.add(c.claimed_owner_id);submitters.add(c.claimed_submitter_id);
   claims[role]=c;records[role]=record;
  }
  return {head,missing:[],claims,records};
 }
 async function checkSources(scope,claims,t){
  const statuses=[];
  for(const role of Object.keys(ROLES)){
   const c=claims[role];
   const s=await readFixtureSourceStatus({scope,owner_role:role,
    claimed_owner_id:c.claimed_owner_id});
   if(!exact(s,SOURCE_STATUS)||s.schema_version!=='v3.2-113-ci-source-status-v1'||
    Object.keys(scope).some(k=>s[k]!==scope[k])||
    s.owner_role!==role||s.source_revision!==c.source_revision||
    s.revocation_sequence!==c.source_revocation_sequence||
    s.revoked!==false||s.fixture_only!==true||
    !Number.isSafeInteger(s.observed_at_ms)||s.observed_at_ms>t)
    fault('REVIEW_SOURCE_REVOKED_OR_STALE');
   statuses.push(s);
  }
  return digest(statuses);
 }
 async function assign(input={}){
  if(!exact(input,['organization_id','incident_id','student_id','reviewer_id'])||
   !UUID.test(input.organization_id)||!UUID.test(input.incident_id)||
   !UUID.test(input.student_id)||!ID.test(input.reviewer_id))
   return denied('INVALID_REVIEW_ASSIGNMENT_SCOPE');
  const scope={organization_id:input.organization_id.toLowerCase(),
   incident_id:input.incident_id.toLowerCase(),
   student_id:input.student_id.toLowerCase()};
  const ref=Object.values(scope).join('|');
  const previous=queues.get(ref)||Promise.resolve();
  const work=previous.catch(()=>{}).then(async()=>{
   try{
    const t=now(scope);
    const current=await collect(scope,t);
    if(current.missing.length)
     return denied('BLOCKED_REVIEW_EVIDENCE_SLOTS_INCOMPLETE',{
      missing_roles:Object.freeze(current.missing)});
    const {claims,head}=current;
    if(Object.values(claims).some(c=>
     c.claimed_owner_id===input.reviewer_id||
     c.claimed_submitter_id===input.reviewer_id))
     fault('REVIEWER_CONFLICT_WITH_SUBMITTER_OR_OWNER');
    const raw=await readSignedFixtureReviewer({scope,reviewer_id:input.reviewer_id});
    const reviewerDigest=checkReviewer(raw,key,scope,input.reviewer_id,t);
    const statusesBefore=await checkSources(scope,claims,t);
    const snapshotDigest=digest(Object.keys(ROLES).map(role=>({
     role,claim_digest:current.records[role].claim_digest,
     event_sequence:current.records[role].sequence})));
    const record={
     schema_version:'v3.2-113-ci-review-assignment-v1',scope,
     reviewer_id:input.reviewer_id,reviewer_role:'independent_evidence_reviewer',
     reviewer_attestation_digest:reviewerDigest,
     intake_head_sequence:head.sequence,intake_head_digest:head.event_digest,
     evidence_snapshot_digest:snapshotDigest,evidence_count:6,
     status:'PENDING_REAL_OWNER_CONFIRMATION',assigned_at_ms:t};
    const written=await assignmentLedger.bind(scope,record);
    const expected=digest(record);
    if(!exact(written,['accepted','assignment_digest','reason_code'])||
     written.accepted!==true||written.assignment_digest!==expected||
     written.reason_code!=='FIXTURE_REVIEW_ASSIGNED')
     fault('REVIEW_ASSIGNMENT_SQL_CONFLICT_OR_UNCERTAIN');
    await afterAssignmentWrite({scope,record});
    const [stored,afterHead,reviewerAgain]=await Promise.all([
     assignmentLedger.read(scope),intakeLedger.head(scope),
     readSignedFixtureReviewer({scope,reviewer_id:input.reviewer_id})]);
    if(digest(stored)!==expected||
     afterHead?.sequence!==head.sequence||
     afterHead?.event_digest!==head.event_digest)
     fault('REVIEW_ASSIGNMENT_OR_INTAKE_CHANGED_AFTER_COMMIT');
    if(checkReviewer(reviewerAgain,key,scope,input.reviewer_id,now(scope))!==reviewerDigest)
     fault('REVIEWER_REVOKED_OR_CHANGED_AFTER_ASSIGNMENT');
    if(await checkSources(scope,claims,now(scope))!==statusesBefore)
     fault('REVIEW_SOURCE_STATUS_CHANGED_AFTER_ASSIGNMENT');
    return denied('BLOCKED_FIXTURE_REVIEW_ASSIGNED_NO_REAL_AUTHORITY',{
     fixture_review_assignment_recorded:true,
     review_status:'PENDING_REAL_OWNER_CONFIRMATION',
     reviewer_id:input.reviewer_id,evidence_count:6,
     snapshot_digest:snapshotDigest,assignment_digest:expected});
   }catch(e){
    return denied(typeof e?.code==='string'&&e.code.length<=128?
     e.code:'REVIEW_ASSIGNMENT_DEPENDENCY_UNAVAILABLE');
   }
  });
  queues.set(ref,work);
  try{return await work;}
  finally{if(queues.get(ref)===work)queues.delete(ref);}
 }
 return Object.freeze({assign});
}
