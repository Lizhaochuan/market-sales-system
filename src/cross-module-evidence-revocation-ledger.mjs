// V3.2-72: immutable, CI-only evidence revocation and stale-check token model.
// No HTTP access, production authority, finance, academic or release capability.
import {createHash} from 'node:crypto';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const digest=/^[0-9a-f]{64}$/;
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
const exact=(x,keys)=>plain(x)&&Object.keys(x).length===keys.length&&
 keys.every(k=>Object.hasOwn(x,k));
const positive=x=>Number.isSafeInteger(x)&&x>0;
const fail=reason_code=>Object.freeze({reason_code,revocation_preflight_consistent:false,
 historical_reference_current:false,external_source_authenticated:false,
 finance_authorized:false,academic_authorized:false,handoff_allowed:false,
 compensation_write_allowed:false,release_eligible:false,hold_active:true});
const checksum=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export function createIsolatedRevocationLedger({getFixtureSourceEpoch}={}){
 if(typeof getFixtureSourceEpoch!=='function')
  throw new TypeError('Independent source epoch provider is required');
 const store=new Map();
 const getKey=(org,incident)=>org+'\0'+incident;
 function epoch(org,incident){
  const value=getFixtureSourceEpoch(org,incident);
  if(!positive(value))throw Error('FIXTURE_EPOCH_UNAVAILABLE');
  return value;
 }
 function recordRevocation({organization_id,incident_id,event_id,event_sha256,
   source_epoch,revocation_sequence,idempotency_key}={}){
  if(!uuid.test(organization_id)||!uuid.test(incident_id)||
   typeof event_id!=='string'||event_id.length<1||event_id.length>128||
   !digest.test(event_sha256)||!positive(source_epoch)||!positive(revocation_sequence)||
   typeof idempotency_key!=='string'||idempotency_key.length<16||
   idempotency_key.length>128||!/^[A-Za-z0-9._:-]+$/.test(idempotency_key))
   throw Error('INVALID_REVOCATION_FIXTURE');
  const org=organization_id.toLowerCase(),incident=incident_id.toLowerCase();
  if(epoch(org,incident)!==source_epoch)throw Error('SOURCE_EPOCH_NOT_CURRENT');
  const key=getKey(org,incident),previous=store.get(key);
  const expected=previous?previous.sequence+1:1;
  const payload={organization_id:org,incident_id:incident,event_id,
   event_sha256,source_epoch,revocation_sequence};
  const fingerprint=checksum(payload);
  if(previous&&previous.nonces.has(idempotency_key)){
   const row=previous.nonces.get(idempotency_key);
   if(row.fingerprint!==fingerprint)throw Error('REVOCATION_NONCE_CONFLICT');
   return row.record;
  }
  if(revocation_sequence!==expected)throw Error('REVOCATION_SEQUENCE_GAP_OR_ROLLBACK');
  if(previous&&source_epoch<previous.epoch)throw Error('REVOCATION_EPOCH_ROLLBACK');
  const record=Object.freeze({...payload,fixture_only:true,
   finance_authorized:false,handoff_allowed:false,hold_active:true});
  const nonces=new Map(previous?.nonces||[]);
  nonces.set(idempotency_key,{fingerprint,record});
  const revoked=new Map(previous?.revoked||[]);
  const prior=revoked.get(event_id);
  if(prior)throw Error('ALREADY_REVOKED_EVENT');
  revoked.set(event_id,event_sha256);
  store.set(key,{epoch:source_epoch,sequence:revocation_sequence,nonces,revoked,
   fingerprint:checksum([...revoked].sort(([a],[b])=>a.localeCompare(b,'en')))});
  return record;
 }
 function checkHistoricalPacket({organization_id,incident_id,
   source_epoch,revocation_sequence,revocation_digest,evidence_event_ids}={}){
  if(!exact(arguments[0],['organization_id','incident_id','source_epoch','revocation_sequence','revocation_digest','evidence_event_ids'])||
    !uuid.test(organization_id)||!uuid.test(incident_id)||
    !positive(source_epoch)||!Number.isSafeInteger(revocation_sequence)||
    revocation_sequence<0||!Array.isArray(evidence_event_ids)||
    evidence_event_ids.length<1||evidence_event_ids.length>100||
    !evidence_event_ids.every(x=>typeof x==='string'&&x.length>0&&x.length<=128)||
    new Set(evidence_event_ids).size!==evidence_event_ids.length||
    !digest.test(revocation_digest))
   return fail('INVALID_REVOCATION_REFERENCE');
  const org=organization_id.toLowerCase(),incident=incident_id.toLowerCase();
  const current=store.get(getKey(org,incident));
  let observed;
  try{observed=epoch(org,incident);}catch{return fail('SOURCE_EPOCH_UNAVAILABLE');}
  if(observed!==source_epoch)return fail('SOURCE_EPOCH_STALE');
  const sequence=current?.sequence||0;
  const fingerprint=current?.fingerprint||checksum([]);
  if(revocation_sequence!==sequence||revocation_digest!==fingerprint)
   return fail('REVOCATION_LEDGER_CHANGED');
  if(evidence_event_ids.some(id=>current?.revoked.has(id)))
   return fail('HISTORICAL_PACKET_USES_REVOKED_EVIDENCE');
  return Object.freeze({...fail('BLOCKED_EXTERNAL_REVOCATION_AUTHORITY_UNAVAILABLE'),
   revocation_preflight_consistent:true,historical_reference_current:true});
 }
 function viewFixtureWatermark(organization_id,incident_id){
  if(!uuid.test(organization_id)||!uuid.test(incident_id))throw Error('INVALID_SCOPE');
  const x=store.get(getKey(organization_id.toLowerCase(),incident_id.toLowerCase()));
  return Object.freeze({source_epoch:x?.epoch??null,revocation_sequence:x?.sequence||0,
   revocation_digest:x?.fingerprint||checksum([]),fixture_only:true,
   handoff_allowed:false,release_eligible:false,hold_active:true});
 }
 return Object.freeze({recordRevocation,checkHistoricalPacket,viewFixtureWatermark});
}
