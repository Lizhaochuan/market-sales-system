// V3.2-115: CI-only reviewer invalidation observation and append-only HOLD.
// No automatic release, production writes, or real staff/finance authority.
import {createHash,createPublicKey,verify as edVerify} from 'node:crypto';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const ID=/^[a-z0-9][a-z0-9._:-]{5,127}$/;
const SCOPE=['organization_id','incident_id','student_id'];
const SIGNAL=['schema_version',...SCOPE,'reviewer_id','source_revision',
 'revocation_sequence','revoked','issued_at_ms','expires_at_ms','fixture_only'];
const EVENT=['schema_version','scope','sequence','previous_event_digest',
 'assignment_digest','intake_head_digest','lifecycle_head_digest',
 'reviewer_id','trigger_kind','source_signal_digest','cause_digest',
 'status','recorded_at_ms'];
const LIFECYCLE=['schema_version','scope','sequence','previous_event_digest',
 'assignment_digest','intake_head_digest','evidence_snapshot_digest',
 'action_id','action_kind','reason_code','previous_reviewer_id','next_reviewer_id',
 'action_digest','identity_status_digest','status','recorded_at_ms'];
const TRIGGERS=['EVIDENCE_UPDATED','REVIEWER_CHANGED','REVIEWER_UNASSIGNED',
 'REVIEWER_REVOKED','SOURCE_PROOF_UNVERIFIED'];
const exact=(x,fields)=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null)&&
 Object.keys(x).length===fields.length&&fields.every(k=>Object.hasOwn(x,k));
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const fields=(x,keys)=>Object.fromEntries(keys.map(k=>[k,x[k]]));
const error=code=>{const e=new Error(code);e.code=code;throw e;};
const DENIED={
 external_authority_verified:false,external_reviewer_appointed:false,
 external_owner_verified:false,real_evidence_verified:false,
 finance_authorized:false,academic_authorized:false,handoff_allowed:false,
 compensation_write_allowed:false,release_eligible:false,hold_active:true,
 production_integration_allowed:false,merge_authorized:false,deploy_authorized:false
};
const denied=(reason_code,more={})=>Object.freeze({reason_code,
 fixture_hold_event_recorded:false,review_hold_status:'HOLD_ACTIVE',
 ...DENIED,...more});
function validScope(scope){
 return exact(scope,SCOPE)&&SCOPE.every(k=>typeof scope[k]==='string'&&UUID.test(scope[k]));
}
function status(raw,key,scope,reviewer,at){
 if(!exact(raw,[...SIGNAL,'signature'])||typeof raw.signature!=='string')
  error('SOURCE_PROOF_UNVERIFIED');
 let signature;
 try{signature=Buffer.from(raw.signature,'base64url');}
 catch{error('SOURCE_PROOF_UNVERIFIED');}
 if(signature.length!==64||signature.toString('base64url')!==raw.signature||
  !edVerify(null,Buffer.from(JSON.stringify(fields(raw,SIGNAL))),key,signature))
  error('SOURCE_PROOF_UNVERIFIED');
 const p=fields(raw,SIGNAL);
 if(p.schema_version!=='v3.2-115-ci-reviewer-status-v1'||
  SCOPE.some(k=>p[k]!==scope[k])||p.reviewer_id!==reviewer||
  !Number.isSafeInteger(p.source_revision)||p.source_revision<1||
  !Number.isSafeInteger(p.revocation_sequence)||p.revocation_sequence<0||
  typeof p.revoked!=='boolean'||p.fixture_only!==true||
  !Number.isSafeInteger(p.issued_at_ms)||p.issued_at_ms>at||
  !Number.isSafeInteger(p.expires_at_ms)||p.expires_at_ms<=at||
  p.expires_at_ms-p.issued_at_ms>300000||
  (p.revoked&&p.revocation_sequence===0))
  error('SOURCE_PROOF_UNVERIFIED');
 return {status:p,digest:sha(raw)};
}
export function createIsolatedReviewerInvalidationHold({
 assignmentLedger,intakeLedger,lifecycleLedger,holdLedger,
 readSignedFixtureReviewerStatus,fixtureReviewerStatusPublicKey,
 getFixtureNow,afterCommit=async()=>{}
}={}){
 if(!assignmentLedger||typeof assignmentLedger.read!=='function'||
  !intakeLedger||typeof intakeLedger.head!=='function'||
  !lifecycleLedger||typeof lifecycleLedger.head!=='function'||
  typeof lifecycleLedger.event!=='function'||
  !holdLedger||typeof holdLedger.head!=='function'||
  typeof holdLedger.event!=='function'||typeof holdLedger.append!=='function'||
  typeof readSignedFixtureReviewerStatus!=='function'||
  typeof fixtureReviewerStatusPublicKey!=='string'||
  typeof getFixtureNow!=='function'||typeof afterCommit!=='function')
  throw TypeError('V115 requires test-only audit ledgers and pinned source status key');
 const key=createPublicKey(fixtureReviewerStatusPublicKey);
 if(key.asymmetricKeyType!=='ed25519')throw TypeError('Ed25519 fixture status key required');
 const queues=new Map(),highClock=new Map();
 function now(scope){
  let t;
  try{t=getFixtureNow();}catch{error('HOLD_CLOCK_UNAVAILABLE');}
  const k=SCOPE.map(x=>scope[x]).join('|');
  if(!Number.isSafeInteger(t)||t<1||t<(highClock.get(k)||0))
   error('HOLD_CLOCK_UNVERIFIED');
  highClock.set(k,t);return t;
 }
 async function evidence(scope){
  const assignment=await assignmentLedger.read(scope);
  if(!assignment||assignment.schema_version!=='v3.2-113-ci-review-assignment-v1'||
   assignment.status!=='PENDING_REAL_OWNER_CONFIRMATION'||
   !validScope(assignment.scope)||SCOPE.some(k=>assignment.scope[k]!==scope[k])||
   typeof assignment.reviewer_id!=='string'||!ID.test(assignment.reviewer_id)||
   !SHA.test(assignment.intake_head_digest))
   error('HOLD_UPSTREAM_ASSIGNMENT_UNVERIFIED');
  const intake=await intakeLedger.head(scope);
  if(intake!==null&&(!exact(intake,['sequence','event_digest'])||
   !Number.isSafeInteger(intake.sequence)||intake.sequence<1||
   !SHA.test(intake.event_digest)))
   error('HOLD_INTAKE_HEAD_UNVERIFIED');
  const head=await lifecycleLedger.head(scope);
  if(head!==null&&(!exact(head,['sequence','event_digest'])||
   !Number.isSafeInteger(head.sequence)||head.sequence<1||
   head.sequence>32||!SHA.test(head.event_digest)))
   error('HOLD_LIFECYCLE_HEAD_UNVERIFIED');
  let last=assignment.reviewer_id,previous='0'.repeat(64);
  for(let i=1;i<=(head?.sequence||0);i++){
   const e=await lifecycleLedger.event(scope,i);
   if(!exact(e,LIFECYCLE)||e.schema_version!=='v3.2-114-ci-review-lifecycle-v1'||
    !validScope(e.scope)||SCOPE.some(k=>e.scope[k]!==scope[k])||
    e.sequence!==i||e.previous_event_digest!==previous||
    e.assignment_digest!==sha(assignment)||
    e.intake_head_digest!==assignment.intake_head_digest||
    e.previous_reviewer_id!==last||
    e.status!=='PENDING_REAL_AUTHORITY_CONFIRMATION')
    error('HOLD_LIFECYCLE_CHAIN_UNVERIFIED');
   last=e.next_reviewer_id;previous=sha(e);
  }
  if(head&&head.event_digest!==previous)
   error('HOLD_LIFECYCLE_CHAIN_UNVERIFIED');
  return {
   assignment_digest:sha(assignment),
   intake_head_digest:intake?.event_digest??'0'.repeat(64),
   lifecycle_head_digest:head?.event_digest??'0'.repeat(64),
   reviewer_id:last,
   changed_intake:intake?.event_digest!==assignment.intake_head_digest,
   changed_lifecycle:head!==null
  };
 }
 async function signalFor(scope,id,t){
  if(id===null)return {digest:'0'.repeat(64),kind:'REVIEWER_UNASSIGNED'};
  try{
   const raw=await readSignedFixtureReviewerStatus({scope,reviewer_id:id});
   const x=status(raw,key,scope,id,t);
   return {digest:x.digest,
    kind:x.status.revoked?'REVIEWER_REVOKED':null};
  }catch{
   // The safe incident label is "unverified", not the untrusted assertion
   // that an actual employee was revoked.
   return {digest:'0'.repeat(64),kind:'SOURCE_PROOF_UNVERIFIED'};
  }
 }
 async function observe(input={}){
  if(!validScope(input))return denied('INVALID_HOLD_OBSERVATION_SCOPE');
  const scope=fields(input,SCOPE),k=SCOPE.map(x=>scope[x]).join('|');
  const before=queues.get(k)||Promise.resolve();
  const run=before.catch(()=>{}).then(async()=>{
   try{
    const t=now(scope),baseline=await evidence(scope);
    const sig=await signalFor(scope,baseline.reviewer_id,t);
    const reason=baseline.changed_intake?'EVIDENCE_UPDATED':
     baseline.changed_lifecycle?'REVIEWER_CHANGED':
     sig.kind;
    if(reason===null)return denied('BLOCKED_REVIEW_PENDING_REAL_AUTHORITY');
    if(!TRIGGERS.includes(reason))error('HOLD_UNEXPECTED_TRIGGER');
    const prior=await holdLedger.head(scope);
    if(prior!==null&&(!exact(prior,['sequence','event_digest'])||
     !Number.isSafeInteger(prior.sequence)||prior.sequence<1||
     prior.sequence>64||!SHA.test(prior.event_digest)))
     error('HOLD_HEAD_UNVERIFIED');
    if(prior){
     const last=await holdLedger.event(scope,prior.sequence);
     if(!exact(last,EVENT)||sha(last)!==prior.event_digest||
      last.status!=='HOLD_PENDING_EXTERNAL_AUTHORITY')
      error('HOLD_PREVIOUS_EVENT_UNVERIFIED');
    }
    const cause=sha({
     assignment_digest:baseline.assignment_digest,
     intake_head_digest:baseline.intake_head_digest,
     lifecycle_head_digest:baseline.lifecycle_head_digest,
     reviewer_id:baseline.reviewer_id,
     trigger_kind:reason,source_signal_digest:sig.digest
    });
    const record={
     schema_version:'v3.2-115-ci-invalidation-hold-v1',
     scope,sequence:(prior?.sequence||0)+1,
     previous_event_digest:prior?.event_digest??'0'.repeat(64),
     assignment_digest:baseline.assignment_digest,
     intake_head_digest:baseline.intake_head_digest,
     lifecycle_head_digest:baseline.lifecycle_head_digest,
     reviewer_id:baseline.reviewer_id,
     trigger_kind:reason,source_signal_digest:sig.digest,cause_digest:cause,
     status:'HOLD_PENDING_EXTERNAL_AUTHORITY',recorded_at_ms:t
    };
    const result=await holdLedger.append(scope,record);
    const expected=sha(record);
    if(!exact(result,['accepted','event_digest','reason_code'])||
     result.accepted!==true||result.event_digest!==expected||
     result.reason_code!=='REVIEW_HOLD_EVENT_APPENDED')
     error('HOLD_SQL_REPLAY_CONFLICT_OR_UNCERTAIN');
    await afterCommit({scope,record});
    const [head,event,newState,newSignal]=await Promise.all([
     holdLedger.head(scope),holdLedger.event(scope,record.sequence),
     evidence(scope),signalFor(scope,baseline.reviewer_id,now(scope))
    ]);
    if(head?.sequence!==record.sequence||head.event_digest!==expected||
     sha(event)!==expected)
     error('HOLD_DURABILITY_UNVERIFIED');
    if(sha(newState)!==sha(baseline)||newSignal.digest!==sig.digest||
     newSignal.kind!==sig.kind)
     return denied('BLOCKED_HOLD_EVENT_RECORDED_SOURCE_CHANGED',{
      fixture_hold_event_recorded:true,hold_sequence:record.sequence,
      trigger_kind:reason,event_digest:expected});
    return denied('BLOCKED_HOLD_EVENT_RECORDED',{
     fixture_hold_event_recorded:true,hold_sequence:record.sequence,
     trigger_kind:reason,event_digest:expected});
   }catch(e){
    return denied(typeof e?.code==='string'&&e.code.length<=128?
     e.code:'HOLD_DEPENDENCY_UNAVAILABLE');
   }
  });
  queues.set(k,run);
  try{return await run;}
  finally{if(queues.get(k)===run)queues.delete(k);}
 }
 async function statusOf(input={}){
  if(!validScope(input))return denied('INVALID_HOLD_OBSERVATION_SCOPE');
  try{
   const head=await holdLedger.head(input);
   if(!head)return denied('BLOCKED_NO_RECORDED_HOLD_STILL_UNAUTHORIZED');
   if(!exact(head,['sequence','event_digest'])||!SHA.test(head.event_digest)||
    !Number.isSafeInteger(head.sequence)||head.sequence<1)
    error('HOLD_HEAD_UNVERIFIED');
   const event=await holdLedger.event(input,head.sequence);
   if(!exact(event,EVENT)||sha(event)!==head.event_digest||
    event.status!=='HOLD_PENDING_EXTERNAL_AUTHORITY')
    error('HOLD_EVENT_UNVERIFIED');
   return denied('BLOCKED_HOLD_RECORDED_PENDING_EXTERNAL_AUTHORITY',{
    hold_sequence:head.sequence,trigger_kind:event.trigger_kind});
  }catch(e){
   return denied(typeof e?.code==='string'&&e.code.length<=128?
    e.code:'HOLD_DEPENDENCY_UNAVAILABLE');
  }
 }
 return Object.freeze({observe,statusOf});
}
