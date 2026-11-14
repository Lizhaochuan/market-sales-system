// V3.2-74: isolated read-only three-domain recovery consistency model.
// All inputs are fictional fixture snapshots. No trusted production integration.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const DOMAINS=['market_sales','finance','academic'];
const own=(x,k)=>Object.prototype.hasOwnProperty.call(x,k);
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
const exact=(x,fields)=>plain(x)&&Object.keys(x).length===fields.length&&
 fields.every(k=>own(x,k));
const pos=x=>Number.isSafeInteger(x)&&x>0;
function blocked(reason_code,consistency=false){
 return Object.freeze({reason_code,fixture_consistency_verified:consistency,
  external_authority_verified:false,finance_authorized:false,
  academic_authorized:false,handoff_allowed:false,compensation_write_allowed:false,
  release_eligible:false,hold_active:true,automatic_recovery_allowed:false});
}
function snapshotValid(x,org,incident){
 return exact(x,['organization_id','incident_id','domain','source_epoch','source_revision',
  'revocation_sequence','revocation_digest','recovery_generation','availability','hold_active'])&&
 UUID.test(x.organization_id)&&UUID.test(x.incident_id)&&
 x.organization_id.toLowerCase()===org&&x.incident_id.toLowerCase()===incident&&
 DOMAINS.includes(x.domain)&&pos(x.source_epoch)&&pos(x.source_revision)&&
 Number.isSafeInteger(x.revocation_sequence)&&x.revocation_sequence>=0&&
 SHA.test(x.revocation_digest)&&pos(x.recovery_generation)&&
 x.availability==='online'&&x.hold_active===true;
}
const fingerprint=x=>[
 x.source_epoch,x.source_revision,x.revocation_sequence,
 x.revocation_digest,x.recovery_generation
].join(':');
/**
 * Provider must come from an independent CI harness, not a caller-supplied
 * 'approved' object. Two reads reject drift during a simulated recovery.
 * No lock is held and no authorization follows from a consistent read.
 */
export function createIsolatedThreePartyRecoveryCheck({getFixtureSnapshot}={}){
 if(typeof getFixtureSnapshot!=='function')
  throw new TypeError('Independent fictional snapshot provider required');
 const accepted=new Map();
 return Object.freeze({
  async check({organization_id,incident_id,afterFirstRead}={}){
   if(!exact(arguments[0],['organization_id','incident_id','afterFirstRead'])||
    !UUID.test(organization_id)||!UUID.test(incident_id)||
    typeof afterFirstRead!=='function')
    return blocked('INVALID_RECOVERY_CHECK_INPUT');
   const org=organization_id.toLowerCase(),incident=incident_id.toLowerCase();
   const scope=org+'\0'+incident;
   async function read(){
    const result=[];
    for(const domain of DOMAINS){
     let snapshot;
     try{snapshot=await getFixtureSnapshot({organization_id:org,incident_id:incident,domain});}
     catch{return {error:'FIXTURE_DOMAIN_UNAVAILABLE'};}
     if(!snapshotValid(snapshot,org,incident)||snapshot.domain!==domain)
      return {error:'FIXTURE_DOMAIN_INVALID_OR_UNAVAILABLE'};
     result.push(snapshot);
    }
    return {result};
   }
   const first=await read();
   if(first.error)return blocked(first.error);
   try{await afterFirstRead();}
   catch{return blocked('RECOVERY_CHECK_INTERRUPTED');}
   const second=await read();
   if(second.error)return blocked(second.error);
   for(let i=0;i<DOMAINS.length;i++){
    if(fingerprint(first.result[i])!==fingerprint(second.result[i]))
     return blocked('FIXTURE_DOMAIN_CHANGED_DURING_RECOVERY');
   }
   const current=second.result;
   // Cross-domain revisions are independently scoped; do not assume they
   // have equal integer values. Every domain must still have a valid hold.
   const prior=accepted.get(scope);
   if(prior){
    for(let i=0;i<DOMAINS.length;i++){
     const a=prior[i],b=current[i];
     if(b.source_epoch<a.source_epoch||
        b.source_revision<a.source_revision||
        b.revocation_sequence<a.revocation_sequence||
        b.recovery_generation<a.recovery_generation)
       return blocked('RECOVERY_WATERMARK_REGRESSION');
     if(b.source_epoch===a.source_epoch&&
        b.revocation_sequence===a.revocation_sequence&&
        b.revocation_digest!==a.revocation_digest)
       return blocked('REVOCATION_WATERMARK_CONFLICT');
     if(b.recovery_generation>a.recovery_generation&&
        b.source_epoch===a.source_epoch)
       return blocked('RECOVERY_WITHOUT_NEW_SOURCE_EPOCH');
    }
   }
   // This in-memory baseline is a test-only monotonic history, NOT durable
   // multi-instance authorization or a transaction/consensus protocol.
   accepted.set(scope,current.map(x=>Object.freeze({...x})));
   return blocked('BLOCKED_EXTERNAL_RECOVERY_AUTHORITY_UNAVAILABLE',true);
  }
 });
}
