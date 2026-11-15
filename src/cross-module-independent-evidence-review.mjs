// V3.2-111 — CI-only review of independent evidence responsibility.
// Fixture signatures and a V3.2-110 negative receipt NEVER authorize handoff.
import {createHash,createPublicKey,verify as verifySignature} from 'node:crypto';
const DOMAINS=Object.freeze(['sales','finance','academic']);
const TYPES=Object.freeze({
 sales:'student_attribution_and_historical_order_context',
 finance:'independent_original_order_and_payment_reconciliation',
 academic:'independent_lesson_entitlement_and_fulfilment_reconciliation'
});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{64}$/;
const SIGNER=/^[a-z0-9][a-z0-9._:-]{5,127}$/;
const FIELDS=['schema_version','organization_id','incident_id','student_id',
 'family_id','domain','evidence_type','signer_id','source_revision',
 'revocation_sequence','notification_sequence','notification_digest',
 'original_history_digest','evidence_digest','issued_at_ms','expires_at_ms',
 'fixture_only'];
const STATUS_FIELDS=['schema_version','organization_id','incident_id',
 'domain','signer_id','source_revision','revocation_sequence','revoked',
 'observed_at_ms'];
const PERSISTENCE_FIELDS=['notification_sequence','notification_digest',
 'lease_state'];
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
const exact=(x,keys)=>plain(x)&&Object.keys(x).length===keys.length&&
 keys.every(k=>Object.hasOwn(x,k));
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const payload=(x,keys)=>Object.fromEntries(keys.map(k=>[k,x[k]]));
const fault=code=>{const e=new Error(code);e.code=code;throw e;};
const deny=(reason_code,extra={})=>Object.freeze({
 reason_code,fixture_independent_evidence_crosschecked:false,
 external_authority_verified:false,finance_authorized:false,
 academic_authorized:false,handoff_allowed:false,
 compensation_write_allowed:false,release_eligible:false,
 hold_active:true,production_integration_allowed:false,
 merge_authorized:false,deploy_authorized:false,...extra
});
function makePublicKey(x){
 const k=createPublicKey(x);
 if(k.asymmetricKeyType!=='ed25519')throw TypeError('Fixture evidence key must be Ed25519');
 return k;
}
function checkEvidence(raw,domain,key,s,receipt,now){
 if(!exact(raw,[...FIELDS,'signature'])||
  typeof raw.signature!=='string')
  fault('EVIDENCE_SIGNATURE_OR_ENVELOPE_INVALID');
 let sig;
 try{sig=Buffer.from(raw.signature,'base64url');}
 catch{fault('EVIDENCE_SIGNATURE_OR_ENVELOPE_INVALID');}
 if(sig.length!==64||sig.toString('base64url')!==raw.signature||
  !verifySignature(null,Buffer.from(JSON.stringify(payload(raw,FIELDS))),key,sig))
  fault('EVIDENCE_SIGNATURE_OR_ENVELOPE_INVALID');
 const e=payload(raw,FIELDS),t=now();
 if(e.schema_version!=='v3.2-111-ci-independent-evidence-v1'||
  e.fixture_only!==true||e.organization_id!==s.organization_id||
  e.incident_id!==s.incident_id||e.student_id!==s.student_id||
  !(e.family_id===null||typeof e.family_id==='string'&&UUID.test(e.family_id))||
  e.domain!==domain||e.evidence_type!==TYPES[domain]||
  !SIGNER.test(e.signer_id)||!Number.isSafeInteger(e.source_revision)||
  e.source_revision<1||!Number.isSafeInteger(e.revocation_sequence)||
  e.revocation_sequence<0||
  e.notification_sequence!==receipt.notification_sequence||
  e.notification_digest!==receipt.notification_digest||
  !SHA.test(e.original_history_digest)||!SHA.test(e.evidence_digest)||
  !Number.isSafeInteger(e.issued_at_ms)||
  !Number.isSafeInteger(e.expires_at_ms)||
  e.issued_at_ms>t||e.expires_at_ms<=t||
  e.expires_at_ms-e.issued_at_ms>300000)
  fault('EVIDENCE_SCOPE_HISTORY_OR_EXPIRY_INVALID');
 return Object.freeze(e);
}
function receiptValid(r){
 if(!plain(r)||r.reason_code!=='BLOCKED_CI_LEASE_LOSS_AND_NEGATIVE_RECEIPT'||
  r.fixture_negative_receipt_current!==true||
  r.hold_active!==true||r.external_authority_verified!==false||
  r.finance_authorized!==false||r.academic_authorized!==false||
  r.handoff_allowed!==false||r.compensation_write_allowed!==false||
  r.release_eligible!==false||!SHA.test(r.notification_digest)||
  !Number.isSafeInteger(r.notification_sequence)||r.notification_sequence<1)
  fault('V110_NEGATIVE_RECEIPT_MISSING_OR_UNCERTAIN');
}
export function createIsolatedIndependentEvidenceReview({
 negativeReceiptGate,fetchSignedEvidence,fixtureDomainPublicKeys,
 readFixtureRevocationStatus,readReceiptPersistence,getFixtureNow,
 afterFirstScan=async()=>{}
}={}){
 if(!negativeReceiptGate||typeof negativeReceiptGate.inspect!=='function'||
  typeof fetchSignedEvidence!=='function'||!exact(fixtureDomainPublicKeys,DOMAINS)||
  !DOMAINS.every(d=>typeof fixtureDomainPublicKeys[d]==='string')||
  typeof readFixtureRevocationStatus!=='function'||
  typeof readReceiptPersistence!=='function'||
  typeof getFixtureNow!=='function'||typeof afterFirstScan!=='function')
  throw TypeError('V110 negative gate and independent fixture identity sources required');
 const keys={},fingerprints=new Set();
 for(const d of DOMAINS){
  const k=makePublicKey(fixtureDomainPublicKeys[d]);
  const finger=sha(k.export({type:'spki',format:'der'}).toString('base64'));
  if(fingerprints.has(finger))throw TypeError('Independent fixture domains must not share evidence signer keys');
  fingerprints.add(finger);keys[d]=k;
 }
 const queues=new Map(),clockHigh=new Map();
 function now(s){
  let t;
  try{t=getFixtureNow();}catch{fault('EVIDENCE_CLOCK_UNAVAILABLE');}
  const scope=s.organization_id+'|'+s.incident_id;
  if(!Number.isSafeInteger(t)||t<=0||t<(clockHigh.get(scope)||0))
   fault('EVIDENCE_CLOCK_ROLLBACK');
  clockHigh.set(scope,t);
  return t;
 }
 async function scan(s,receipt,evidence){
  const persisted=await readReceiptPersistence({scope:s});
  if(!exact(persisted,PERSISTENCE_FIELDS)||
   persisted.notification_sequence!==receipt.notification_sequence||
   persisted.notification_digest!==receipt.notification_digest||
   persisted.lease_state!=='revoked')
   fault('V110_NEGATIVE_RECEIPT_PERSISTENCE_UNVERIFIED');
  for(const d of DOMAINS){
   const e=evidence[d];
   const status=await readFixtureRevocationStatus({
    scope:s,domain:d,signer_id:e.signer_id});
   if(!exact(status,STATUS_FIELDS)||
    status.schema_version!=='v3.2-111-ci-revocation-status-v1'||
    status.organization_id!==s.organization_id||
    status.incident_id!==s.incident_id||status.domain!==d||
    status.signer_id!==e.signer_id||
    status.source_revision!==e.source_revision||
    status.revocation_sequence!==e.revocation_sequence||
    status.revoked!==false||
    !Number.isSafeInteger(status.observed_at_ms)||
    status.observed_at_ms>now(s))
    fault('EVIDENCE_REVOKED_STALE_OR_UNVERIFIED');
  }
  return sha({persisted,source_revisions:DOMAINS.map(d=>[
   d,evidence[d].source_revision,evidence[d].revocation_sequence])});
 }
 async function inspect(input={}){
  if(!exact(input,['organization_id','incident_id','student_id'])||
   !UUID.test(input.organization_id)||!UUID.test(input.incident_id)||
   !UUID.test(input.student_id))
   return deny('INVALID_THREE_PARTY_REVIEW_SCOPE');
  const s={organization_id:input.organization_id.toLowerCase(),
   incident_id:input.incident_id.toLowerCase(),
   student_id:input.student_id.toLowerCase()};
  const id=s.organization_id+'|'+s.incident_id;
  const previous=queues.get(id)||Promise.resolve();
  const work=previous.catch(()=>{}).then(async()=>{
   try{
    now(s);
    // V110 inspect can change *only* isolated notice and lease audit records;
    // it cannot commit a business order, payment, lesson or handoff.
    const receipt=await negativeReceiptGate.inspect({
     organization_id:s.organization_id,incident_id:s.incident_id});
    receiptValid(receipt);
    const raws=await Promise.all(DOMAINS.map(domain=>
     fetchSignedEvidence({scope:s,domain,notification_digest:receipt.notification_digest,
      notification_sequence:receipt.notification_sequence})));
    const evidence={};
    DOMAINS.forEach((d,i)=>{evidence[d]=checkEvidence(
     raws[i],d,keys[d],s,receipt,()=>now(s));});
    const signerIds=DOMAINS.map(d=>evidence[d].signer_id);
    if(new Set(signerIds).size!==3)
     fault('EVIDENCE_SIGNER_SEPARATION_FAILED');
    const history=DOMAINS.map(d=>evidence[d].original_history_digest);
    const families=DOMAINS.map(d=>evidence[d].family_id);
    if(new Set(history).size!==1||new Set(families).size!==1)
     fault('EVIDENCE_HISTORY_OR_STUDENT_RELATION_CONFLICT');
    const first=await scan(s,receipt,evidence);
    await afterFirstScan({scope:s,evidence});
    const second=await scan(s,receipt,evidence);
    if(first!==second)fault('EVIDENCE_REVOCATION_OR_RECEIPT_CHANGED');
    return deny('BLOCKED_FIXTURE_INDEPENDENT_EVIDENCE_NOT_REAL_AUTHORITY',{
     fixture_independent_evidence_crosschecked:true,
     evidence_count:3,negative_receipt_digest:receipt.notification_digest,
     student_id:s.student_id,original_history_digest:history[0],
     evidence_review_digest:sha(DOMAINS.map(d=>raws[DOMAINS.indexOf(d)]))});
   }catch(e){
    return deny(typeof e?.code==='string'&&e.code.length<=128?
     e.code:'EVIDENCE_REVIEW_DEPENDENCY_UNAVAILABLE');
   }
  });
  queues.set(id,work);
  try{return await work;}
  finally{if(queues.get(id)===work)queues.delete(id);}
 }
 return Object.freeze({inspect});
}
