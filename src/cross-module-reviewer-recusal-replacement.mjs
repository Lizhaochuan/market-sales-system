// V3.2-114 CI-only recusal and replacement evidence; never real reviewer approval.
import {createHash,createPublicKey,verify as verifySignature} from 'node:crypto';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const ID=/^[a-z0-9][a-z0-9._:-]{5,127}$/;
const ROLES=['sales_owner','finance_owner','academic_owner','security_identity_owner','integration_owner','database_owner'];
const REASONS=['conflict_of_interest','role_change','role_revoked','reassignment_after_recusal'];
const REQUEST=['organization_id','incident_id','student_id','action_id','action_kind',
 'reason_code','previous_reviewer_id','next_reviewer_id'];
const ACTION=['schema_version',...REQUEST,'sequence','previous_event_digest',
 'assignment_digest','intake_head_digest','evidence_snapshot_digest',
 'issued_at_ms','expires_at_ms','fixture_only'];
const IDENTITY=['schema_version','organization_id','incident_id','student_id',
 'reviewer_id','reviewer_role','active','role_revision','revocation_sequence',
 'observed_at_ms','expires_at_ms','fixture_only'];
const AUDIT=['schema_version','scope','sequence','previous_event_digest',
 'assignment_digest','intake_head_digest','evidence_snapshot_digest',
 'action_id','action_kind','reason_code','previous_reviewer_id','next_reviewer_id',
 'action_digest','identity_status_digest','status','recorded_at_ms'];
const INTAKE=['schema_version','scope','sequence','previous_event_digest',
 'claim_digest','submission_id','owner_role','evidence_digest',
 'claimed_owner_id','claimed_submitter_id','status','recorded_at_ms'];
const exact=(x,fields)=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null)&&
 Object.keys(x).length===fields.length&&fields.every(k=>Object.hasOwn(x,k));
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const data=(x,keys)=>Object.fromEntries(keys.map(k=>[k,x[k]]));
const error=code=>{const e=new Error(code);e.code=code;throw e;};
const deny=(reason_code,more={})=>Object.freeze({
 reason_code,fixture_transition_recorded:false,external_reviewer_appointed:false,
 external_owner_verified:false,real_evidence_verified:false,
 external_authority_verified:false,finance_authorized:false,
 academic_authorized:false,handoff_allowed:false,
 compensation_write_allowed:false,release_eligible:false,
 hold_active:true,production_integration_allowed:false,
 merge_authorized:false,deploy_authorized:false,...more
});
const validScope=s=>exact(s,['organization_id','incident_id','student_id'])&&
 Object.values(s).every(x=>typeof x==='string'&&UUID.test(x));
const validId=x=>typeof x==='string'&&ID.test(x);
function pin(p){
 const k=createPublicKey(p);
 if(k.asymmetricKeyType!=='ed25519')throw TypeError('CI source must pin Ed25519 public key');
 return k;
}
function signed(raw,keys,pub,code){
 if(!exact(raw,[...keys,'signature'])||typeof raw.signature!=='string')error(code);
 let signature;
 try{signature=Buffer.from(raw.signature,'base64url');}catch{error(code);}
 if(signature.length!==64||signature.toString('base64url')!==raw.signature||
  !verifySignature(null,Buffer.from(JSON.stringify(data(raw,keys))),pub,signature))
  error(code);
 return data(raw,keys);
}
export function createIsolatedReviewerLifecycle({
 assignmentLedger,intakeLedger,lifecycleLedger,
 readSignedGovernanceAction,readSignedIdentityStatus,
 fixtureGovernancePublicKey,fixtureIdentityPublicKey,
 getFixtureNow,afterCommit=async()=>{}
}={}){
 if(!assignmentLedger||typeof assignmentLedger.read!=='function'||
  !intakeLedger||typeof intakeLedger.head!=='function'||
  typeof intakeLedger.event!=='function'||!lifecycleLedger||
  typeof lifecycleLedger.head!=='function'||typeof lifecycleLedger.event!=='function'||
  typeof lifecycleLedger.append!=='function'||
  typeof readSignedGovernanceAction!=='function'||
  typeof readSignedIdentityStatus!=='function'||
  typeof fixtureGovernancePublicKey!=='string'||
  typeof fixtureIdentityPublicKey!=='string'||
  typeof getFixtureNow!=='function'||typeof afterCommit!=='function')
  throw TypeError('V114 requires isolated signed action and identity roots plus SQL ledgers');
 const governance=pin(fixtureGovernancePublicKey),identity=pin(fixtureIdentityPublicKey);
 if(sha(governance.export({type:'spki',format:'der'}).toString('base64'))===
  sha(identity.export({type:'spki',format:'der'}).toString('base64')))
  throw TypeError('Governance and identity fixture signing roots must be distinct');
 const queues=new Map(),highTime=new Map();
 function now(scope){
  let t;
  try{t=getFixtureNow();}catch{error('REVIEW_LIFECYCLE_CLOCK_UNAVAILABLE');}
  const key=Object.values(scope).join('|');
  if(!Number.isSafeInteger(t)||t<1||t<(highTime.get(key)||0))
   error('REVIEW_LIFECYCLE_CLOCK_ROLLBACK');
  highTime.set(key,t);return t;
 }
 async function base(scope){
  const assigned=await assignmentLedger.read(scope);
  if(!assigned||assigned.schema_version!=='v3.2-113-ci-review-assignment-v1'||
   assigned.status!=='PENDING_REAL_OWNER_CONFIRMATION'||
   !validScope(assigned.scope)||
   Object.keys(scope).some(k=>assigned.scope[k]!==scope[k])||
   !validId(assigned.reviewer_id)||
   !SHA.test(assigned.intake_head_digest)||
   !SHA.test(assigned.evidence_snapshot_digest)||
   !Number.isSafeInteger(assigned.intake_head_sequence)||
   assigned.intake_head_sequence<6)
   error('REVIEW_ORIGINAL_ASSIGNMENT_UNVERIFIED');
  const head=await intakeLedger.head(scope);
  if(!exact(head,['sequence','event_digest'])||
   head.sequence!==assigned.intake_head_sequence||
   head.event_digest!==assigned.intake_head_digest||
   head.sequence>64)error('REVIEW_INTAKE_UPDATED_OR_UNVERIFIED');
  let previous='0'.repeat(64);const latest=new Map(),participants=new Set();
  for(let i=1;i<=head.sequence;i++){
   const event=await intakeLedger.event(scope,i);
   if(!exact(event,INTAKE)||event.schema_version!=='v3.2-112-ci-quarantined-intake-v1'||
    !validScope(event.scope)||Object.keys(scope).some(k=>event.scope[k]!==scope[k])||
    event.sequence!==i||event.previous_event_digest!==previous||
    event.status!=='PENDING_INDEPENDENT_VERIFICATION'||
    !ROLES.includes(event.owner_role)||!SHA.test(event.claim_digest))
    error('REVIEW_INTAKE_CHAIN_INVALID');
   previous=sha(event);latest.set(event.owner_role,event);
  }
  if(previous!==head.event_digest||latest.size!==6)
   error('REVIEW_INTAKE_CHAIN_INVALID');
  for(const event of latest.values()){
   if(!validId(event.claimed_owner_id)||!validId(event.claimed_submitter_id))
    error('REVIEW_INTAKE_PARTICIPANTS_INVALID');
   participants.add(event.claimed_owner_id);
   participants.add(event.claimed_submitter_id);
  }
  return {assigned,head,participants,assignment_digest:sha(assigned)};
 }
 async function lifecycle(scope,b){
  const head=await lifecycleLedger.head(scope);
  if(head!==null&&(!exact(head,['sequence','event_digest'])||
   !Number.isSafeInteger(head.sequence)||head.sequence<1||
   head.sequence>32||!SHA.test(head.event_digest)))
   error('REVIEW_LIFECYCLE_HEAD_UNVERIFIED');
  let previous='0'.repeat(64),current=b.assigned.reviewer_id;
  for(let i=1;i<=(head?.sequence||0);i++){
   const ev=await lifecycleLedger.event(scope,i);
   if(!exact(ev,AUDIT)||ev.schema_version!=='v3.2-114-ci-review-lifecycle-v1'||
    !validScope(ev.scope)||Object.keys(scope).some(k=>ev.scope[k]!==scope[k])||
    ev.sequence!==i||ev.previous_event_digest!==previous||
    ev.previous_reviewer_id!==current||ev.assignment_digest!==b.assignment_digest||
    ev.intake_head_digest!==b.head.event_digest||
    ev.evidence_snapshot_digest!==b.assigned.evidence_snapshot_digest||
    ev.status!=='PENDING_REAL_AUTHORITY_CONFIRMATION'||
    !['recuse','replace'].includes(ev.action_kind)||
    !REASONS.includes(ev.reason_code))
    error('REVIEW_LIFECYCLE_CHAIN_UNVERIFIED');
   current=ev.next_reviewer_id;previous=sha(ev);
  }
  if(head?.event_digest!==undefined&&head.event_digest!==previous)
   error('REVIEW_LIFECYCLE_CHAIN_UNVERIFIED');
  return {head,current};
 }
 async function identityState(scope,id,t){
  if(id===null)return null;
  const raw=await readSignedIdentityStatus({scope,reviewer_id:id});
  const s=signed(raw,IDENTITY,identity,'REVIEW_IDENTITY_SIGNATURE_INVALID');
  if(s.schema_version!=='v3.2-114-ci-identity-status-v1'||
   Object.keys(scope).some(k=>s[k]!==scope[k])||
   s.reviewer_id!==id||s.reviewer_role!=='independent_evidence_reviewer'||
   typeof s.active!=='boolean'||
   !Number.isSafeInteger(s.role_revision)||s.role_revision<1||
   !Number.isSafeInteger(s.revocation_sequence)||s.revocation_sequence<0||
   !Number.isSafeInteger(s.observed_at_ms)||s.observed_at_ms>t||
   !Number.isSafeInteger(s.expires_at_ms)||s.expires_at_ms<=t||
   s.fixture_only!==true)
   error('REVIEW_IDENTITY_REVOKED_OR_STALE');
  return {value:s,digest:sha(raw)};
 }
 async function transition(input={}){
  if(!exact(input,REQUEST)||!validScope({
   organization_id:input.organization_id,incident_id:input.incident_id,
   student_id:input.student_id})||
   !UUID.test(input.action_id)||!['recuse','replace'].includes(input.action_kind)||
   !REASONS.includes(input.reason_code)||
   !(input.previous_reviewer_id===null||validId(input.previous_reviewer_id))||
   !(input.next_reviewer_id===null||validId(input.next_reviewer_id))||
   input.previous_reviewer_id===input.next_reviewer_id||
   (input.action_kind==='recuse'&&input.next_reviewer_id!==null)||
   (input.action_kind==='replace'&&input.next_reviewer_id===null)||
   (input.reason_code==='reassignment_after_recusal'&&
    (input.action_kind!=='replace'||input.previous_reviewer_id!==null)))
   return deny('INVALID_REVIEW_LIFECYCLE_ACTION');
  const scope={organization_id:input.organization_id.toLowerCase(),
   incident_id:input.incident_id.toLowerCase(),
   student_id:input.student_id.toLowerCase()};
  const lock=Object.values(scope).join('|');
  const prior=queues.get(lock)||Promise.resolve();
  const work=prior.catch(()=>{}).then(async()=>{
   try{
    const t=now(scope),b=await base(scope),state=await lifecycle(scope,b);
    if(input.previous_reviewer_id!==state.current||
     (state.current===null&&input.action_kind==='recuse')||
     (state.current===null&&input.reason_code!=='reassignment_after_recusal')||
     (state.current!==null&&input.reason_code==='reassignment_after_recusal')||
     (input.next_reviewer_id!==null&&
      (b.participants.has(input.next_reviewer_id)||
       input.next_reviewer_id===b.assigned.reviewer_id)))
     error('REVIEWER_RECUSAL_CONFLICT_OR_REPLAY');
    const previousIdentity=await identityState(scope,state.current,t);
    const nextIdentity=await identityState(scope,input.next_reviewer_id,t);
    if(nextIdentity&&nextIdentity.value.active!==true)
     error('REPLACEMENT_REVIEWER_NOT_ACTIVE');
    if(state.current!==null&&
     ((input.reason_code==='role_revoked')===previousIdentity.value.active))
     error('REVIEWER_REVOCATION_REASON_MISMATCH');
    const actionRaw=await readSignedGovernanceAction({
     scope,request:input,sequence:(state.head?.sequence||0)+1,
     previous_event_digest:state.head?.event_digest||'0'.repeat(64),
     assignment_digest:b.assignment_digest,
     intake_head_digest:b.head.event_digest,
     evidence_snapshot_digest:b.assigned.evidence_snapshot_digest
    });
    const action=signed(actionRaw,ACTION,governance,
     'REVIEW_GOVERNANCE_ACTION_SIGNATURE_INVALID');
    if(action.schema_version!=='v3.2-114-ci-governance-action-v1'||
     Object.keys(input).some(k=>action[k]!==input[k])||
     action.sequence!==(state.head?.sequence||0)+1||
     action.previous_event_digest!==(state.head?.event_digest||'0'.repeat(64))||
     action.assignment_digest!==b.assignment_digest||
     action.intake_head_digest!==b.head.event_digest||
     action.evidence_snapshot_digest!==b.assigned.evidence_snapshot_digest||
     !Number.isSafeInteger(action.issued_at_ms)||action.issued_at_ms>t||
     !Number.isSafeInteger(action.expires_at_ms)||action.expires_at_ms<=t||
     action.expires_at_ms-action.issued_at_ms>300000||
     action.fixture_only!==true)
     error('REVIEW_GOVERNANCE_SCOPE_OR_EPOCH_INVALID');
    const identityBefore=sha([
     previousIdentity?.digest??null,nextIdentity?.digest??null]);
    const record={schema_version:'v3.2-114-ci-review-lifecycle-v1',
     scope,sequence:action.sequence,
     previous_event_digest:action.previous_event_digest,
     assignment_digest:b.assignment_digest,
     intake_head_digest:b.head.event_digest,
     evidence_snapshot_digest:b.assigned.evidence_snapshot_digest,
     action_id:input.action_id,action_kind:input.action_kind,
     reason_code:input.reason_code,
     previous_reviewer_id:input.previous_reviewer_id,
     next_reviewer_id:input.next_reviewer_id,
     action_digest:sha(actionRaw),identity_status_digest:identityBefore,
     status:'PENDING_REAL_AUTHORITY_CONFIRMATION',recorded_at_ms:t};
    const result=await lifecycleLedger.append(scope,record);
    if(!exact(result,['accepted','event_digest','reason_code'])||
     result.accepted!==true||result.event_digest!==sha(record)||
     result.reason_code!=='REVIEWER_LIFECYCLE_EVENT_STORED')
     error('REVIEW_LIFECYCLE_SQL_CONFLICT_OR_UNCERTAIN');
    await afterCommit({scope,record});
    const [event,head,sourceHead,oldAfter,newAfter]=await Promise.all([
     lifecycleLedger.event(scope,record.sequence),lifecycleLedger.head(scope),
     intakeLedger.head(scope),
     identityState(scope,state.current,now(scope)),
     identityState(scope,input.next_reviewer_id,now(scope))
    ]);
    if(sha(event)!==sha(record)||head?.event_digest!==sha(record)||
     head.sequence!==record.sequence||
     sourceHead?.sequence!==b.head.sequence||
     sourceHead.event_digest!==b.head.event_digest)
     error('REVIEW_LIFECYCLE_CHANGED_AFTER_COMMIT');
    if(sha([oldAfter?.digest??null,newAfter?.digest??null])!==identityBefore)
     error('REVIEW_IDENTITY_CHANGED_AFTER_COMMIT');
    return deny('BLOCKED_FIXTURE_REVIEWER_LIFECYCLE_RECORDED',{
     fixture_transition_recorded:true,
     lifecycle_sequence:record.sequence,event_digest:sha(record),
     pending_reviewer_id:record.next_reviewer_id,
     status:'PENDING_REAL_AUTHORITY_CONFIRMATION'});
   }catch(e){
    return deny(typeof e?.code==='string'&&e.code.length<=128?
     e.code:'REVIEW_LIFECYCLE_DEPENDENCY_UNAVAILABLE');
   }
  });
  queues.set(lock,work);
  try{return await work;}
  finally{if(queues.get(lock)===work)queues.delete(lock);}
 }
 return Object.freeze({transition});
}
