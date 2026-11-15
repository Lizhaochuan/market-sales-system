// V3.2-112 — untrusted evidence metadata intake; administrative quarantine ONLY.
// A submitted owner claim is never an assignment, sign-off or business authority.
import {createHash} from 'node:crypto';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const ID=/^[a-z0-9][a-z0-9._:-]{5,127}$/;
const DOMAINS=Object.freeze({
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
const RECORD=['schema_version','scope','sequence','previous_event_digest',
 'claim_digest','submission_id','owner_role','evidence_digest',
 'claimed_owner_id','claimed_submitter_id','status','recorded_at_ms'];
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
const exact=(x,fields)=>plain(x)&&Object.keys(x).length===fields.length&&
 fields.every(k=>Object.hasOwn(x,k));
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const reject=code=>{const e=new Error(code);e.code=code;throw e;};
const deny=(reason_code,extra={})=>Object.freeze({
 reason_code,intake_recorded:false,review_status:'EXTERNAL_OWNER_UNASSIGNED',
 external_authority_verified:false,finance_authorized:false,
 academic_authorized:false,handoff_allowed:false,
 compensation_write_allowed:false,release_eligible:false,
 hold_active:true,production_integration_allowed:false,
 merge_authorized:false,deploy_authorized:false,...extra
});
const goodScope=s=>exact(s,['organization_id','incident_id','student_id'])&&
 Object.values(s).every(x=>typeof x==='string'&&UUID.test(x));
function validateClaim(c,now){
 if(!exact(c,CLAIM)||c.schema_version!=='v3.2-112-ci-untrusted-evidence-claim-v1'||
  c.fixture_only!==true||!UUID.test(c.submission_id)||
  !UUID.test(c.organization_id)||!UUID.test(c.incident_id)||
  !UUID.test(c.student_id)||
  !(c.family_id===null||typeof c.family_id==='string'&&UUID.test(c.family_id))||
  !Object.hasOwn(DOMAINS,c.owner_role)||
  !ID.test(c.claimed_owner_id)||!ID.test(c.claimed_submitter_id)||
  c.claimed_owner_id===c.claimed_submitter_id||
  c.claimed_source_system!==DOMAINS[c.owner_role][0]||
  c.evidence_type!==DOMAINS[c.owner_role][1]||
  !Number.isSafeInteger(c.source_revision)||c.source_revision<1||
  !Number.isSafeInteger(c.source_revocation_sequence)||
  c.source_revocation_sequence<0||
  !SHA.test(c.original_history_digest)||!SHA.test(c.evidence_digest)||
  !(c.linked_v110_notice_digest===null||SHA.test(c.linked_v110_notice_digest))||
  !Number.isSafeInteger(c.submitted_at_ms)||!Number.isSafeInteger(c.expires_at_ms)||
  c.submitted_at_ms>now||c.expires_at_ms<=now||
  c.expires_at_ms-c.submitted_at_ms>86400000||
  c.claimed_approval_state!=='UNVERIFIED_SUBMISSION')
  reject('EVIDENCE_INTAKE_CLAIM_INVALID_OR_PREAPPROVED');
}
export function createIsolatedEvidenceIntakeQuarantine({
 ledger,getFixtureNow,afterCommit=async()=>{}
}={}){
 if(!ledger||typeof ledger.head!=='function'||typeof ledger.event!=='function'||
  typeof ledger.append!=='function'||typeof getFixtureNow!=='function'||
  typeof afterCommit!=='function')
  throw TypeError('CI-only evidence quarantine requires an isolated immutable event ledger');
 const queues=new Map(),clocks=new Map();
 function now(scope){
  let t;
  try{t=getFixtureNow();}catch{reject('INTAKE_CLOCK_UNAVAILABLE');}
  const key=scope.organization_id+'|'+scope.incident_id+'|'+scope.student_id;
  if(!Number.isSafeInteger(t)||t<=0||t<(clocks.get(key)||0))
   reject('INTAKE_CLOCK_ROLLBACK');
  clocks.set(key,t);return t;
 }
 async function receive(claim){
  // Do not persist raw documents, contact details or identity proofs.
  if(!plain(claim)||!UUID.test(claim.organization_id??'')||
   !UUID.test(claim.incident_id??'')||!UUID.test(claim.student_id??''))
   return deny('EVIDENCE_INTAKE_SCOPE_INVALID');
  const scope={organization_id:claim.organization_id.toLowerCase(),
   incident_id:claim.incident_id.toLowerCase(),
   student_id:claim.student_id.toLowerCase()};
  const key=Object.values(scope).join('|');
  const prior=queues.get(key)||Promise.resolve();
  const work=prior.catch(()=>{}).then(async()=>{
   try{
    validateClaim(claim,now(scope));
    const head=await ledger.head(scope);
    if(head!==null&&(!exact(head,['sequence','event_digest'])||
     !Number.isSafeInteger(head.sequence)||head.sequence<1||
     !SHA.test(head.event_digest)))
     reject('EVIDENCE_INTAKE_HEAD_UNVERIFIED');
    const record={schema_version:'v3.2-112-ci-quarantined-intake-v1',
     scope,sequence:(head?.sequence||0)+1,
     previous_event_digest:head?.event_digest||'0'.repeat(64),
     claim_digest:sha(claim),submission_id:claim.submission_id,
     owner_role:claim.owner_role,evidence_digest:claim.evidence_digest,
     claimed_owner_id:claim.claimed_owner_id,
     claimed_submitter_id:claim.claimed_submitter_id,
     status:'PENDING_INDEPENDENT_VERIFICATION',
     recorded_at_ms:now(scope)};
    const stored=await ledger.append(scope,record);
    const digest=sha(record);
    if(!exact(stored,['accepted','event_digest','reason_code'])||
     stored.accepted!==true||stored.event_digest!==digest||
     stored.reason_code!=='INTAKE_QUARANTINED')
     reject('EVIDENCE_INTAKE_COMMIT_UNVERIFIED');
    await afterCommit({scope,record});
    const [headAfter,eventAfter]=await Promise.all([
     ledger.head(scope),ledger.event(scope,record.sequence)]);
    if(headAfter?.sequence!==record.sequence||
     headAfter?.event_digest!==digest||sha(eventAfter)!==digest)
     reject('EVIDENCE_INTAKE_DURABILITY_UNVERIFIED');
    return deny('BLOCKED_EVIDENCE_RECEIVED_PENDING_EXTERNAL_VERIFICATION',{
     intake_recorded:true,sequence:record.sequence,
     event_digest:digest,owner_role:record.owner_role,
     review_status:'PENDING_INDEPENDENT_VERIFICATION'
    });
   }catch(e){
    return deny(typeof e?.code==='string'&&e.code.length<=128?
     e.code:'EVIDENCE_INTAKE_DEPENDENCY_UNAVAILABLE');
   }
  });
  queues.set(key,work);
  try{return await work;}
  finally{if(queues.get(key)===work)queues.delete(key);}
 }
 async function inspect(scope){
  if(!goodScope(scope))return deny('EVIDENCE_INTAKE_SCOPE_INVALID');
  try{
   const head=await ledger.head(scope);
   if(!head)return deny('NO_EVIDENCE_SUBMISSIONS');
   if(!exact(head,['sequence','event_digest'])||
    !Number.isSafeInteger(head.sequence)||head.sequence<1||!SHA.test(head.event_digest))
    reject('EVIDENCE_INTAKE_HEAD_UNVERIFIED');
   const ev=await ledger.event(scope,head.sequence);
   if(!exact(ev,RECORD)||ev.schema_version!=='v3.2-112-ci-quarantined-intake-v1'||
    !exact(ev.scope,['organization_id','incident_id','student_id'])||
    Object.keys(scope).some(k=>ev.scope[k]!==scope[k])||
    ev.sequence!==head.sequence||sha(ev)!==head.event_digest||
    ev.status!=='PENDING_INDEPENDENT_VERIFICATION')
    reject('EVIDENCE_INTAKE_EVENT_UNVERIFIED');
   return deny('BLOCKED_EVIDENCE_INTAKE_QUARANTINED',{
    review_status:ev.status,latest_sequence:ev.sequence,
    latest_event_digest:head.event_digest});
  }catch(e){
   return deny(typeof e?.code==='string'&&e.code.length<=128?
    e.code:'EVIDENCE_INTAKE_DEPENDENCY_UNAVAILABLE');
  }
 }
 return Object.freeze({receive,inspect});
}
