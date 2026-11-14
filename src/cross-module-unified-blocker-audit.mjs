// V3.2-83: CI-only, append-only fictional unified-blocker audit snapshots.
// Hash chaining detects local mutations; it does NOT provide trusted external audit,
// durable storage, real signatures, approvals or atomic cross-system authorization.
import {createHash} from 'node:crypto';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const NONCE=/^[a-z0-9][a-z0-9._:-]{15,127}$/;
const CODES=Object.freeze(['finance_signature','academic_signature',
 'order_payment_reconciliation','lesson_entitlement_reconciliation',
 'three_party_joint_acceptance','external_atomic_receipt']);
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
const exact=(x,fields)=>object(x)&&Object.keys(x).length===fields.length&&
 fields.every(f=>Object.hasOwn(x,f));
const sha=x=>createHash('sha256').update(JSON.stringify(x),'utf8').digest('hex');
const blocked=(reason_code,record=null)=>Object.freeze({
 reason_code,fixture_audit_recorded:record!==null,record,
 external_authority_verified:false,finance_authorized:false,
 academic_authorized:false,handoff_allowed:false,
 compensation_write_allowed:false,release_eligible:false,hold_active:true
});
const fail=(code)=>{const e=new Error(code);e.code=code;throw e;};
function normalizeVersion(x,org,incident){
 if(!exact(x,['organization_id','incident_id','source_revision',
  'source_epoch','revocation_sequence','revocation_digest','supplements'])||
  typeof x.organization_id!=='string'||typeof x.incident_id!=='string'||
  !UUID.test(x.organization_id)||!UUID.test(x.incident_id)||
  x.organization_id.toLowerCase()!==org||x.incident_id.toLowerCase()!==incident||
  !Number.isSafeInteger(x.source_revision)||x.source_revision<1||
  !Number.isSafeInteger(x.source_epoch)||x.source_epoch<1||
  !Number.isSafeInteger(x.revocation_sequence)||x.revocation_sequence<0||
  !SHA.test(x.revocation_digest)||!Array.isArray(x.supplements)||
  x.supplements.length!==CODES.length)return null;
 const seen=new Set(),supplements=[];
 for(const row of x.supplements){
  if(!exact(row,['requirement_code','supplement_version','chain_digest'])||
   !CODES.includes(row.requirement_code)||seen.has(row.requirement_code)||
   !Number.isSafeInteger(row.supplement_version)||row.supplement_version<1||
   !SHA.test(row.chain_digest))return null;
  seen.add(row.requirement_code);
  supplements.push({requirement_code:row.requirement_code,
   supplement_version:row.supplement_version,chain_digest:row.chain_digest});
 }
 supplements.sort((a,b)=>CODES.indexOf(a.requirement_code)-CODES.indexOf(b.requirement_code));
 return {organization_id:org,incident_id:incident,source_revision:x.source_revision,
  source_epoch:x.source_epoch,revocation_sequence:x.revocation_sequence,
  revocation_digest:x.revocation_digest,supplements};
}
function safeGate(x){
 return object(x)&&typeof x.reason_code==='string'&&
 /^[A-Z][A-Z0-9_]{3,127}$/.test(x.reason_code)&&
 x.hold_active===true&&x.handoff_allowed===false&&
 x.compensation_write_allowed===false&&x.release_eligible===false&&
 x.finance_authorized===false&&x.academic_authorized===false&&
 x.external_authority_verified===false&&
 (x.fixture_unified_consistency===true||x.fixture_unified_consistency===false);
}
export function createIsolatedUnifiedBlockerAudit({unifiedBlocker,getFixtureVersionSnapshot}={}){
 if(!unifiedBlocker||typeof unifiedBlocker.check!=='function'||
  typeof getFixtureVersionSnapshot!=='function')
  throw new TypeError('Independent CI-only gate and version provider required');
 const entries=new Map(),nonces=new Map(),queues=new Map();
 async function collect(input={}){
  if(!exact(input,['organization_id','incident_id','idempotency_key',
   'final_reference','afterFirstRead'])||
   !UUID.test(input.organization_id)||!UUID.test(input.incident_id)||
   typeof input.idempotency_key!=='string'||!NONCE.test(input.idempotency_key)||
   !exact(input.final_reference,['source_digest','revocation_reference'])||
   !SHA.test(input.final_reference.source_digest)||
   typeof input.afterFirstRead!=='function')
   return blocked('INVALID_AUDIT_CAPTURE_INPUT');
  const org=input.organization_id.toLowerCase(),incident=input.incident_id.toLowerCase();
  const scope=org+'\0'+incident,nonceKey=scope+'\0'+input.idempotency_key;
  // Serialize capture writes within one fictional process. Not a durable lock.
  const previous=queues.get(scope)||Promise.resolve();
  const run=previous.catch(()=>{}).then(async()=>{
   let before,after,gate;
   try{
    before=normalizeVersion(await getFixtureVersionSnapshot(org,incident),org,incident);
    if(!before)return blocked('FIXTURE_VERSION_SNAPSHOT_INVALID');
    gate=await unifiedBlocker.check({organization_id:org,incident_id:incident,
     final_reference:input.final_reference,afterFirstRead:input.afterFirstRead});
    if(!safeGate(gate))return blocked('UNIFIED_BLOCKER_PROTOCOL_VIOLATION');
    after=normalizeVersion(await getFixtureVersionSnapshot(org,incident),org,incident);
    if(!after)return blocked('FIXTURE_VERSION_SNAPSHOT_INVALID');
   }catch{return blocked('AUDIT_DEPENDENCY_UNAVAILABLE');}
   const fingerprint=sha({scope,final_source_digest:input.final_reference.source_digest,
    final_revocation_reference:input.final_reference.revocation_reference,
    before,after,reason_code:gate.reason_code});
   const seen=nonces.get(nonceKey);
   if(seen){
    if(seen.fingerprint!==fingerprint)return blocked('AUDIT_NONCE_CONFLICT');
    // Replays are read-only and return exactly the historical immutable record,
    // but the record must never be interpreted as current clearance.
    return blocked('BLOCKED_HISTORICAL_AUDIT_REPLAY',seen.record);
   }
   const drift=sha(before)!==sha(after);
   const reason=drift?'FIXTURE_EVIDENCE_CHANGED_DURING_AUDIT':
    gate.reason_code==='BLOCKED_REAL_THREE_PARTY_ATOMIC_HANDOFF_MISSING'&&
    gate.fixture_unified_consistency===true?
    'BLOCKED_REAL_EXTERNAL_HANDOFF_NOT_AUTHORIZED':'UNIFIED_GATE_REJECTED';
   const list=entries.get(scope)||[];
   const payload={schema_version:'v3.2-83-ci-unified-audit-v1',
    organization_id:org,incident_id:incident,sequence:list.length+1,
    previous_digest:list.at(-1)?.record_digest||'0'.repeat(64),
    idempotency_key:input.idempotency_key,
    source_snapshot_digest_before:sha(before),
    source_snapshot_digest_after:sha(after),
    source_revision:after.source_revision,source_epoch:after.source_epoch,
    revocation_sequence:after.revocation_sequence,
    revocation_digest:after.revocation_digest,
    supplements:after.supplements.map(x=>Object.freeze({...x})),
    gate_reason_code:gate.reason_code,reason_code:reason,fixture_only:true,
    handoff_allowed:false,compensation_write_allowed:false,
    release_eligible:false,hold_active:true};
   const record=Object.freeze({...payload,
    supplements:Object.freeze(payload.supplements),
    record_digest:sha(payload)});
   entries.set(scope,[...list,record]);
   nonces.set(nonceKey,{fingerprint,record});
   return blocked(reason,record);
  });
  queues.set(scope,run);
  try{return await run;}finally{if(queues.get(scope)===run)queues.delete(scope);}
 }
 function audit(input={}){
  if(!exact(input,['organization_id','incident_id'])||
   !UUID.test(input.organization_id)||!UUID.test(input.incident_id))
   return Object.freeze([]);
  const scope=input.organization_id.toLowerCase()+'\0'+input.incident_id.toLowerCase();
  return Object.freeze([...(entries.get(scope)||[])]);
 }
 function verify(input={}){
  const list=audit(input);
  if(!exact(input,['organization_id','incident_id'])||
   !UUID.test(input.organization_id)||!UUID.test(input.incident_id))
   return blocked('INVALID_AUDIT_VERIFY_INPUT');
  let last='0'.repeat(64);
  for(let i=0;i<list.length;i++){
   const row=list[i],{record_digest,...payload}=row;
   if(row.sequence!==i+1||row.previous_digest!==last||
    record_digest!==sha(payload))return blocked('AUDIT_CHAIN_INTEGRITY_FAILED');
   last=record_digest;
  }
  return blocked('BLOCKED_FIXTURE_AUDIT_CHAIN_ONLY');
 }
 return Object.freeze({collect,audit,verify});
}
