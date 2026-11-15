// V3.2-94: CI-only manual recovery application and three-party internal review.
// No historical mutation, production repair, compensation, approval or release.
import {createHash} from 'node:crypto';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{64}$/;
const ID=/^[a-z0-9][a-z0-9._:-]{5,127}$/;
const NONCE=/^[a-z0-9][a-z0-9._:-]{15,127}$/;
const ROLES=Object.freeze(['sales','finance','academic']);
const valid=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
const exact=(x,fields)=>valid(x)&&Object.keys(x).length===fields.length&&
 fields.every(f=>Object.hasOwn(x,f));
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const fail=code=>{const e=new Error(code);e.code=code;throw e;};
const deny=(reason_code,detail={})=>Object.freeze({
 reason_code,fixture_recovery_review_complete:false,
 history_repair_allowed:false,automatic_recovery_allowed:false,
 external_authority_verified:false,finance_authorized:false,
 academic_authorized:false,handoff_allowed:false,compensation_write_allowed:false,
 release_eligible:false,hold_active:true,production_integration_allowed:false,...detail
});
const key=(org,incident)=>org+'\0'+incident;
const AUDIT_FAILURES=new Set([
 'FREEZE_HISTORY_MISSING','FREEZE_HISTORY_GAP_OR_WRONG_SCOPE',
 'FREEZE_HISTORY_DUPLICATE','FREEZE_PREDECESSOR_BROKEN','FREEZE_UNSAFE_STATE',
 'FREEZE_DIGEST_TAMPERED','LINEAGE_HISTORY_MISSING',
 'LINEAGE_HISTORY_GAP_OR_WRONG_SCOPE','LINEAGE_PREDECESSOR_BROKEN',
 'LINEAGE_DIGEST_TAMPERED','LINEAGE_UNSAFE_STATE',
 'LINEAGE_FREEZE_REFERENCE_MISSING','LINEAGE_FORK_OR_REPLAY',
 'LINEAGE_NONADJACENT_FREEZE','LINEAGE_DISCONNECTED',
 'LATEST_FREEZE_NOT_LINKED','CURRENT_FREEZE_INVALID_OR_UNAUTHORIZED',
 'LINEAGE_CHANGED_DURING_AUDIT'
]);
const requiredSteps=Object.freeze([
 'quarantine_affected_scope_and_preserve_original_evidence',
 'independent_sales_finance_academic_history_reconciliation',
 'obtain_trusted_source_versions_and_revocation_watermarks',
 'rebuild_all_current_reviews_and_six_external_authority_gaps',
 'create_new_isolated_lineage_only_after_independent_acceptance'
]);
export function createIsolatedManualLineageRecovery({
 integrityAudit,getFixtureEvidenceWatermark,getFixtureActor
}={}){
 if(!integrityAudit||typeof integrityAudit.audit!=='function'||
 typeof getFixtureEvidenceWatermark!=='function'||
 typeof getFixtureActor!=='function')throw TypeError('Independent CI-only adapters required');
 const cases=new Map(),nonces=new Map();
 function actor(org,id,role){
  let a;
  try{a=getFixtureActor(org,id);}catch{fail('ACTOR_UNAVAILABLE');}
  if(!exact(a,['actor_id','organization_id','role','active','fixture_only'])||
   a.actor_id!==id||a.organization_id.toLowerCase()!==org||
   a.role!==role||a.active!==true||a.fixture_only!==true)
   fail('INDEPENDENT_FIXTURE_ACTOR_NOT_VERIFIED');
 }
 async function snapshot(org,incident){
  let state,watermark;
  try{
   state=await integrityAudit.audit({organization_id:org,incident_id:incident,
    afterFirstRead:async()=>{}});
   watermark=await getFixtureEvidenceWatermark(org,incident);
  }catch{fail('INTEGRITY_OR_EVIDENCE_UNAVAILABLE');}
  if(!valid(state)||!AUDIT_FAILURES.has(state.reason_code)||
   state.hold_active!==true||state.handoff_allowed!==false||
   state.history_repair_allowed!==false||
   state.automatic_recovery_allowed!==false||
   !Array.isArray(state.recovery_steps)||state.recovery_steps.length!==5||
   state.recovery_steps.some((s,i)=>s!==requiredSteps[i]))
   fail('NO_VERIFIED_RECOVERABLE_AUDIT_FAILURE');
  if(!exact(watermark,['organization_id','incident_id','source_revision',
    'incident_generation','evidence_digest'])||
    typeof watermark.organization_id!=='string'||
    typeof watermark.incident_id!=='string'||
    watermark.organization_id.toLowerCase()!==org||
    watermark.incident_id.toLowerCase()!==incident||
    !Number.isSafeInteger(watermark.source_revision)||
    watermark.source_revision<1||
    !Number.isSafeInteger(watermark.incident_generation)||
    watermark.incident_generation<1||!SHA.test(watermark.evidence_digest))
   fail('INDEPENDENT_EVIDENCE_WATERMARK_INVALID');
  return {failure_code:state.reason_code,
   watermark:{organization_id:org,incident_id:incident,
    source_revision:watermark.source_revision,
    incident_generation:watermark.incident_generation,
    evidence_digest:watermark.evidence_digest}};
 }
 async function apply(input={}){
  if(!exact(input,['organization_id','incident_id','action','actor_id',
   'evidence_sha256','idempotency_key'])||
   !UUID.test(input.organization_id)||!UUID.test(input.incident_id)||
   !['apply','review_sales','review_finance','review_academic','conclude'].includes(input.action)||
   typeof input.actor_id!=='string'||!ID.test(input.actor_id)||
   !SHA.test(input.evidence_sha256)||
   typeof input.idempotency_key!=='string'||!NONCE.test(input.idempotency_key))
   fail('INVALID_RECOVERY_EVENT_INPUT');
  const org=input.organization_id.toLowerCase(),
   incident=input.incident_id.toLowerCase(),scope=key(org,incident);
  const source=await snapshot(org,incident),fingerprint=sha(source);
  const events=cases.get(scope)||[],last=events.at(-1);
  const nonce=scope+'\0'+input.idempotency_key;
  const payloadKey={action:input.action,actor_id:input.actor_id,
   evidence_sha256:input.evidence_sha256,fingerprint};
  const existing=nonces.get(nonce);
  if(existing){
   if(existing.fingerprint!==sha(payloadKey))fail('RECOVERY_NONCE_CONFLICT');
   return existing.record;
  }
  const active=events.filter(x=>x.source_fingerprint===fingerprint);
  const current=active.at(-1);
  const next=!current?'apply':current.action==='apply'?'review_sales':
   current.action==='review_sales'?'review_finance':
   current.action==='review_finance'?'review_academic':
   current.action==='review_academic'?'conclude':null;
  if(input.action!==next)fail('RECOVERY_ACTION_OUT_OF_SEQUENCE');
  const required=input.action==='apply'||input.action==='review_sales'?'sales':
   input.action==='review_finance'?'finance':
   input.action==='review_academic'?'academic':'sales';
  actor(org,input.actor_id,required);
  if(input.action.startsWith('review_')&&
   active.some(x=>x.actor_id===input.actor_id))
   fail('INDEPENDENT_REVIEWER_REQUIRED');
  if(input.action==='conclude'&&
   active.some(x=>x.actor_id===input.actor_id))
   fail('INDEPENDENT_CONCLUSION_ACTOR_REQUIRED');
  if(input.action!=='apply'&&input.evidence_sha256!==active[0].evidence_sha256)
   fail('RECOVERY_EVIDENCE_DIGEST_MISMATCH');
  const payload={schema_version:'v3.2-94-ci-manual-recovery-v1',
   organization_id:org,incident_id:incident,
   sequence:events.length+1,previous_digest:last?.record_digest||'0'.repeat(64),
   source_fingerprint:fingerprint,
   source_revision:source.watermark.source_revision,
   incident_generation:source.watermark.incident_generation,
   failure_code:source.failure_code,evidence_sha256:input.evidence_sha256,
   action:input.action,actor_id:input.actor_id,
   status:input.action==='conclude'?'closed_administratively':
    input.action==='apply'?'awaiting_independent_reviews':'in_internal_review',
   fixture_only:true,hold_active:true,handoff_allowed:false,
   release_eligible:false};
  const record=Object.freeze({...payload,record_digest:sha(payload)});
  cases.set(scope,[...events,record]);
  nonces.set(nonce,{fingerprint:sha(payloadKey),record});
  return record;
 }
 async function report(input={}){
  if(!exact(input,['organization_id','incident_id'])||
   !UUID.test(input.organization_id)||!UUID.test(input.incident_id))
   return deny('INVALID_RECOVERY_REPORT_INPUT');
  const org=input.organization_id.toLowerCase(),
   incident=input.incident_id.toLowerCase(),scope=key(org,incident);
  const events=cases.get(scope)||[];
  let prior='0'.repeat(64);
  for(let i=0;i<events.length;i++){
   const row=events[i],{record_digest,...body}=row;
   if(row.sequence!==i+1||row.previous_digest!==prior||
    row.organization_id!==org||row.incident_id!==incident||
    sha(body)!==record_digest)
    return deny('RECOVERY_AUDIT_HISTORY_INVALID');
   prior=record_digest;
  }
  let source;
  try{source=await snapshot(org,incident);}
  catch{return deny('RECOVERY_EVIDENCE_OR_AUDIT_UNAVAILABLE');}
  const fingerprint=sha(source);
  const current=events.filter(x=>x.source_fingerprint===fingerprint);
  const completed=current.at(-1)?.action==='conclude';
  return Object.freeze({...deny('BLOCKED_MANUAL_RECOVERY_NOT_BUSINESS_RELEASE'),
   fixture_recovery_review_complete:completed,
   status:current.at(-1)?.status||'awaiting_application',
   source_fingerprint:fingerprint,history_count:events.length,
   current_review_events:current.length,
   required_external_authority_categories:6,
   original_history_preserved:true,
   events:Object.freeze([...events])});
 }
 return Object.freeze({apply,report});
}
