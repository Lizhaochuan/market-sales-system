// V3.2-70: memory-only CI fixture registry. No production trust anchor,
// external signature, authority, payment, compensation or release endpoint.
import {createHash} from 'node:crypto';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hex=/^[a-f0-9]{64}$/;
const kinds=new Set(['market_sales','crm_finance','academic']);
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const keys=(x,required)=>object(x)&&Object.keys(x).length===required.length&&
  required.every(k=>Object.hasOwn(x,k));
const int=n=>Number.isSafeInteger(n)&&n>=1;
const reject=code=>{const e=new Error(code);e.code=code;throw e;};
const sha=x=>createHash('sha256').update(x,'utf8').digest('hex');
export const canSubmitToFinanceOrAcademic=false;
export const canExecuteCompensationOrRelease=false;
function normalize(packet){
 if(!keys(packet,['organization_id','incident_id','source_revision','evidence'])||
    !uuid.test(packet.organization_id)||!uuid.test(packet.incident_id)||
    !int(packet.source_revision)||!Array.isArray(packet.evidence)||
    packet.evidence.length===0||packet.evidence.length>100)
   reject('INVALID_PACKET');
 const seen=new Set();
 const evidence=packet.evidence.map(x=>{
  if(!keys(x,['source_system','source_event_id','source_revision','sha256'])||
     !kinds.has(x.source_system)||typeof x.source_event_id!=='string'||
     x.source_event_id.length<1||x.source_event_id.length>128||
     !int(x.source_revision)||!hex.test(x.sha256))
    reject('INVALID_EVIDENCE_ITEM');
  const k=x.source_system+'\0'+x.source_event_id;
  if(seen.has(k))reject('DUPLICATE_EVIDENCE_SOURCE_EVENT');
  seen.add(k);
  return {source_system:x.source_system,source_event_id:x.source_event_id,
    source_revision:x.source_revision,sha256:x.sha256};
 });
 evidence.sort((a,b)=>
  (a.source_system+'\0'+a.source_event_id).localeCompare(b.source_system+'\0'+b.source_event_id,'en'));
 // Fixed field ordering and no unknown fields: stable cryptographic digest.
 const canonical=JSON.stringify({schema_version:'v3.2-70-ci-candidate',
  organization_id:packet.organization_id.toLowerCase(),
  incident_id:packet.incident_id.toLowerCase(),source_revision:packet.source_revision,
  evidence});
 return {organization_id:packet.organization_id.toLowerCase(),
  incident_id:packet.incident_id.toLowerCase(),source_revision:packet.source_revision,
  evidence_digest:sha(canonical),canonical};
}
export function createIsolatedEvidenceFreezeRegistry({getTrustedSourceRevision}={}){
 if(typeof getTrustedSourceRevision!=='function')
  throw new TypeError('An independent CI fixture revision provider is required');
 const latest=new Map(),history=new Map(),nonces=new Map();
 const k=(org,id)=>org+'\0'+id;
 function trustedRevision(org,id){
  // This callback is injected by the fixture test environment, NOT accepted
  // as part of a client request and NOT connected to real CRM or finance.
  const n=getTrustedSourceRevision(org,id);
  if(!int(n))reject('TRUSTED_SOURCE_REVISION_UNAVAILABLE');
  return n;
 }
 function freeze({packet,idempotency_key}={}){
  const n=normalize(packet);
  if(typeof idempotency_key!=='string'||idempotency_key.length<16||
     idempotency_key.length>128||!/^[a-zA-Z0-9._:-]+$/.test(idempotency_key))
   reject('INVALID_IDEMPOTENCY_KEY');
  const key=k(n.organization_id,n.incident_id);
  const nonceKey=n.organization_id+'\0'+idempotency_key;
  const current=trustedRevision(n.organization_id,n.incident_id);
  if(current!==n.source_revision)reject('SOURCE_VERSION_STALE');
  const previous=nonces.get(nonceKey);
  if(previous){
   if(previous.key!==key||previous.digest!==n.evidence_digest||
      previous.source_revision!==n.source_revision)
    reject('IDEMPOTENCY_CONFLICT');
   const active=latest.get(key);
   if(active!==previous.result)reject('PREVIOUS_PACKET_SUPERSEDED');
   return active; // exact retry returns the very same immutable object
  }
  const old=latest.get(key);
  if(old&&old.source_revision===n.source_revision)
   reject('SOURCE_VERSION_ALREADY_FROZEN');
  if(old&&old.source_revision>n.source_revision)
   reject('SOURCE_REVISION_ROLLBACK');
  const result=Object.freeze({
   organization_id:n.organization_id,incident_id:n.incident_id,
   freeze_version:old?old.freeze_version+1:1,
   source_revision:n.source_revision,evidence_sha256:n.evidence_digest,
   evidence_count:packet.evidence.length,
   fixture_only:true,external_evidence_authenticity_verified:false,
   external_signed_receipt_verified:false,
   finance_authorized:false,compensation_write_allowed:false,
   release_eligible:false,hold_active:true,handoff_allowed:false
  });
  latest.set(key,result);
  history.set(key+'\0'+result.freeze_version,result);
  nonces.set(nonceKey,{key,digest:n.evidence_digest,
    source_revision:n.source_revision,result});
  return result;
 }
 function verifyForProposedHandoff({organization_id,incident_id,
   freeze_version,source_revision,evidence_sha256}={}){
  const rejectStatus=(reason_code)=>Object.freeze({
    reason_code,snapshot_current:false,hash_matches:false,
    external_signatures_verified:false,external_acceptance_verified:false,
    handoff_allowed:false,compensation_write_allowed:false,
    release_eligible:false,hold_active:true
  });
  if(!uuid.test(organization_id)||!uuid.test(incident_id)||
     !int(freeze_version)||!int(source_revision)||!hex.test(evidence_sha256))
   return rejectStatus('INVALID_FROZEN_PACKET_REFERENCE');
  const key=k(organization_id.toLowerCase(),incident_id.toLowerCase());
  const row=history.get(key+'\0'+freeze_version);
  if(!row)return rejectStatus('FROZEN_PACKET_NOT_FOUND');
  if(row.source_revision!==source_revision||row.evidence_sha256!==evidence_sha256)
   return rejectStatus('FROZEN_PACKET_DIGEST_OR_VERSION_MISMATCH');
  const active=latest.get(key);
  if(active!==row)return rejectStatus('FROZEN_PACKET_SUPERSEDED');
  if(trustedRevision(row.organization_id,row.incident_id)!==row.source_revision)
   return rejectStatus('FROZEN_SOURCE_VERSION_STALE');
  // Cryptographic stability is not independent verification of the sources.
  return Object.freeze({
   reason_code:'BLOCKED_EXTERNAL_SIGNATURE_AND_HANDOFF_AUTHORITY_UNAVAILABLE',
   snapshot_current:true,hash_matches:true,
   external_signatures_verified:false,external_acceptance_verified:false,
   handoff_allowed:false,compensation_write_allowed:false,
   release_eligible:false,hold_active:true
  });
 }
 return Object.freeze({freeze,verifyForProposedHandoff});
}
