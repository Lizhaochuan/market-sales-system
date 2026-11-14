// V3.2-71: isolated fixture-only provenance preflight; no trusted production source.
import {createHash} from 'node:crypto';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{64}$/;
const KINDS=new Set(['market_sales','crm_finance','academic']);
const exact=(x,fields)=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null)&&
 Object.keys(x).length===fields.length&&fields.every(k=>Object.hasOwn(x,k));
const positive=n=>Number.isSafeInteger(n)&&n>0;
const blocked=(code)=>Object.freeze({reason_code:code,fixture_provenance_consistent:false,
 external_evidence_authenticity_verified:false,finance_authorized:false,
 academic_authorized:false,handoff_allowed:false,compensation_write_allowed:false,
 release_eligible:false,hold_active:true});
const key=x=>x.source_system+'\0'+x.source_event_id;
function normalizePacket(packet){
 if(!exact(packet,['organization_id','incident_id','source_revision','evidence'])||
  !UUID.test(packet.organization_id)||!UUID.test(packet.incident_id)||
  !positive(packet.source_revision)||!Array.isArray(packet.evidence)||
  packet.evidence.length===0||packet.evidence.length>100)return null;
 const seen=new Set(),evidence=[];
 for(const x of packet.evidence){
  if(!exact(x,['source_system','source_event_id','source_revision','sha256'])||
    !KINDS.has(x.source_system)||typeof x.source_event_id!=='string'||
    x.source_event_id.length<1||x.source_event_id.length>128||
    !positive(x.source_revision)||!SHA.test(x.sha256)||seen.has(key(x)))return null;
  seen.add(key(x));
  evidence.push({source_system:x.source_system,source_event_id:x.source_event_id,
    source_revision:x.source_revision,sha256:x.sha256});
 }
 evidence.sort((a,b)=>key(a).localeCompare(key(b),'en'));
 const canonical=JSON.stringify({schema_version:'v3.2-70-ci-candidate',
   organization_id:packet.organization_id.toLowerCase(),
   incident_id:packet.incident_id.toLowerCase(),source_revision:packet.source_revision,evidence});
 return {evidence,digest:createHash('sha256').update(canonical).digest('hex')};
}
function validateSnapshot(snapshot,org,incident){
 if(!exact(snapshot,['organization_id','incident_id','source_revision','events'])||
  !UUID.test(snapshot.organization_id)||!UUID.test(snapshot.incident_id)||
  snapshot.organization_id.toLowerCase()!==org||snapshot.incident_id.toLowerCase()!==incident||
  !positive(snapshot.source_revision)||!Array.isArray(snapshot.events)||
  snapshot.events.length>100)return null;
 const events=new Map();
 for(const e of snapshot.events){
  if(!exact(e,['source_system','source_event_id','source_revision','sha256','state','required'])||
   !KINDS.has(e.source_system)||typeof e.source_event_id!=='string'||
   e.source_event_id.length<1||e.source_event_id.length>128||
   !positive(e.source_revision)||!SHA.test(e.sha256)||
   !['active','revoked'].includes(e.state)||typeof e.required!=='boolean'||
   events.has(key(e)))return null;
  events.set(key(e),e);
 }
 return events;
}
/**
 * A test harness injects an independent, out-of-band snapshot provider.
 * No snapshot, tenant, identity or authorization claims from request bodies are trusted.
 * This is not a production signature, persistent registry or financial reconciliation.
 */
export function createIsolatedProvenancePreflight({getTrustedEvidenceSnapshot,registry}={}){
 if(typeof getTrustedEvidenceSnapshot!=='function'||
    !registry||typeof registry.verifyForProposedHandoff!=='function')
  throw new TypeError('Independent fixture source and frozen registry required');
 return Object.freeze({preflight({packet,frozen_reference}={}){
  const normalized=normalizePacket(packet);
  if(!normalized||!exact(frozen_reference,
   ['organization_id','incident_id','freeze_version','source_revision','evidence_sha256']))
   return blocked('INVALID_PROVENANCE_INPUT');
  const org=packet.organization_id.toLowerCase(),incident=packet.incident_id.toLowerCase();
  if(frozen_reference.organization_id.toLowerCase()!==org||
     frozen_reference.incident_id.toLowerCase()!==incident||
     frozen_reference.source_revision!==packet.source_revision||
     frozen_reference.evidence_sha256!==normalized.digest)
   return blocked('PACKET_FROZEN_REFERENCE_MISMATCH');
  let frozen;
  try{frozen=registry.verifyForProposedHandoff(frozen_reference);}
  catch{return blocked('FROZEN_REGISTRY_UNAVAILABLE');}
  if(!frozen.snapshot_current||!frozen.hash_matches||
     frozen.reason_code!=='BLOCKED_EXTERNAL_SIGNATURE_AND_HANDOFF_AUTHORITY_UNAVAILABLE')
   return blocked('FROZEN_REFERENCE_NOT_CURRENT');
  let snapshot;
  try{snapshot=getTrustedEvidenceSnapshot(org,incident);}
  catch{return blocked('FIXTURE_SOURCE_UNAVAILABLE');}
  const events=validateSnapshot(snapshot,org,incident);
  if(!events)return blocked('FIXTURE_SOURCE_INVALID_OR_WRONG_SCOPE');
  if(snapshot.source_revision!==packet.source_revision)
   return blocked('FIXTURE_SOURCE_REVISION_CHANGED');
  const included=new Set();
  for(const item of normalized.evidence){
   const k=key(item),source=events.get(k);
   if(!source)return blocked('UNKNOWN_FIXTURE_EVIDENCE_EVENT');
   if(source.state!=='active')return blocked('REVOKED_FIXTURE_EVIDENCE_EVENT');
   if(source.source_revision!==item.source_revision)
    return blocked('FIXTURE_EVENT_REVISION_MISMATCH');
   if(source.sha256!==item.sha256)
    return blocked('FIXTURE_EVENT_DIGEST_MISMATCH');
   included.add(k);
  }
  for(const [k,source] of events){
   if(source.state==='revoked'&&source.required)
    return blocked('REQUIRED_FIXTURE_EVENT_REVOKED');
   if(source.required&&!included.has(k))
    return blocked('REQUIRED_FIXTURE_EVENT_OMITTED');
  }
  return Object.freeze({...blocked('BLOCKED_EXTERNAL_AUTHORITIES_NOT_CONNECTED'),
   fixture_provenance_consistent:true});
 }});
}
