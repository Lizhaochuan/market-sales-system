// V3.2-121: CI-only revocation notice contract. No network sender or release path.
import {createHash} from 'node:crypto';
const HEX=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const STATES=new Set(['NOT_QUEUED','QUEUED','SENT_UNCONFIRMED','NEGATIVE_RECEIPT','COPY_NOT_RETRACTABLE','PROOF_EXPIRED','FIXTURE_ACKNOWLEDGED']);
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=code=>{const e=new Error(code);e.code=code;throw e;};
const exact=(x,keys)=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const INPUT=['organization_id','incident_id','export_version','manifest_digest','revocation_event_digest','recipient_id','epoch'];
const SCOPE=['organization_id','incident_id','export_version','manifest_digest','revocation_event_digest'];
const safe=()=>Object.freeze({hold_active:true,external_authority_verified:false,external_recipient_verified:false,finance_authorized:false,academic_authorized:false,handoff_allowed:false,compensation_write_allowed:false,release_eligible:false,merge_authorized:false,deploy_authorized:false});
const denied=(reason_code,extra={})=>Object.freeze({...safe(),notice_accepted:false,reason_code,...extra});
export function deriveFixtureRevocationNoticeId(input){
 if(!exact(input,INPUT)||!UUID.test(input.organization_id)||!UUID.test(input.incident_id)||
  !UUID.test(input.recipient_id)||!Number.isSafeInteger(input.export_version)||
  input.export_version<1||input.export_version>128||
  !Number.isSafeInteger(input.epoch)||input.epoch<1||
  !HEX.test(input.manifest_digest)||!HEX.test(input.revocation_event_digest))
  fail('NOTICE_INPUT_INVALID');
 return sha(['v3.2-121',...INPUT.map(k=>input[k])]);
}
// Ledger contract: appendNotice MUST atomically recheck V119 export and V120
// irrevocable revocation under SERIALIZABLE + FORCE RLS in disposable SQL.
export function createIsolatedRevocationNoticeService({ledger,clock}={}){
 if(!ledger||['appendNotice','listRecipients','listNotices','sourceHeads'].some(k=>typeof ledger[k]!=='function')||typeof clock!=='function')
  throw TypeError('ISOLATED_NOTICE_LEDGER_REQUIRED');
 const chains=new Map();
 async function enqueue(input){
  let id;try{id=deriveFixtureRevocationNoticeId(input);}catch{return denied('NOTICE_INPUT_INVALID');}
  const key=input.organization_id+'|'+input.incident_id;
  const previous=chains.get(key)||Promise.resolve();
  const task=previous.catch(()=>{}).then(async()=>{
   try{
    const time=clock();
    if(!Number.isSafeInteger(time)||time<1)fail('NOTICE_CLOCK_INVALID');
    const record=await ledger.appendNotice(Object.freeze({...input,notice_id:id,observed_at_ms:time}));
    if(!exact(record,['notice_id','state','source_verified','durable','event_digest'])||
      record.notice_id!==id||record.state!=='QUEUED'||record.source_verified!==true||
      record.durable!==true||!HEX.test(record.event_digest))fail('NOTICE_COMMIT_UNVERIFIED');
    const current=await ledger.sourceHeads(input);
    if(!current||current.manifest_digest!==input.manifest_digest||
      current.revocation_event_digest!==input.revocation_event_digest||
      current.revoked!==true)return denied('NOTICE_SOURCE_CHANGED_AFTER_COMMIT',{notice_id:id});
    return Object.freeze({...safe(),notice_accepted:true,notice_id:id,reason_code:'FIXTURE_REVOCATION_NOTICE_QUEUED'});
   }catch(e){return denied(typeof e?.code==='string'?e.code:'NOTICE_DEPENDENCY_UNAVAILABLE');}
  });
  chains.set(key,task);
  try{return await task;}finally{if(chains.get(key)===task)chains.delete(key);}
 }
 async function report(scope){
  if(!exact(scope,SCOPE)||!UUID.test(scope.organization_id)||!UUID.test(scope.incident_id)||
   !Number.isSafeInteger(scope.export_version)||scope.export_version<1||scope.export_version>128||
   !HEX.test(scope.manifest_digest)||!HEX.test(scope.revocation_event_digest))
   return denied('NOTICE_SCOPE_INVALID');
  try{
   const heads=await ledger.sourceHeads(scope);
   if(!heads||heads.revoked!==true||heads.manifest_digest!==scope.manifest_digest||
    heads.revocation_event_digest!==scope.revocation_event_digest)
    return denied('NOTICE_SOURCE_UNVERIFIED');
   const recipients=await ledger.listRecipients(scope);
   const notices=await ledger.listNotices(scope);
   if(!Array.isArray(recipients)||!Array.isArray(notices)||recipients.length>256||
    new Set(recipients).size!==recipients.length||recipients.some(r=>!UUID.test(r)))
    return denied('NOTICE_RECIPIENT_SET_UNVERIFIED');
   const map=new Map();
   for(const n of notices){
    if(!n||!UUID.test(n.recipient_id)||!STATES.has(n.state)||
      !Number.isSafeInteger(n.epoch)||n.epoch<1||!recipients.includes(n.recipient_id)||
      map.has(n.recipient_id))return denied('NOTICE_HISTORY_UNVERIFIED');
    map.set(n.recipient_id,n.state);
   }
   const gaps=recipients.sort().map(recipient_id=>({recipient_id,state:map.get(recipient_id)||'NOT_QUEUED'}));
   const pending=gaps.filter(x=>x.state!=='FIXTURE_ACKNOWLEDGED');
   return Object.freeze({...safe(),reason_code:'FIXTURE_REVOCATION_COVERAGE_ONLY',
    recipient_count:gaps.length,unconfirmed_count:pending.length,recipients:gaps,
    all_fixture_acknowledged:pending.length===0,real_delivery_verified:false});
  }catch{return denied('NOTICE_DEPENDENCY_UNAVAILABLE');}
 }
 return Object.freeze({enqueue,report});
}
