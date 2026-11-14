// V3.2-73: asynchronous two-phase read-only race preflight in isolated CI.
// Not an authorization, lock, production trust anchor, finance, or academic API.
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
const fields=(x,names)=>plain(x)&&Object.keys(x).length===names.length&&
 names.every(n=>Object.hasOwn(x,n));
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH=/^[a-f0-9]{64}$/;
function deny(reason_code,stable=false){
 return Object.freeze({reason_code,isolated_read_set_stable:stable,
  external_authority_verified:false,finance_authorized:false,
  academic_authorized:false,handoff_allowed:false,
  compensation_write_allowed:false,release_eligible:false,
  hold_active:true});
}
const mark=x=>x&&x.revocation_sequence+':'+x.revocation_digest+':'+x.source_epoch;
function validWatermark(x){
 return fields(x,['source_epoch','revocation_sequence','revocation_digest',
 'fixture_only','handoff_allowed','release_eligible','hold_active'])&&
 (x.source_epoch===null||Number.isSafeInteger(x.source_epoch)&&x.source_epoch>0)&&
 Number.isSafeInteger(x.revocation_sequence)&&x.revocation_sequence>=0&&
 HASH.test(x.revocation_digest)&&x.fixture_only===true&&
 x.handoff_allowed===false&&x.release_eligible===false&&x.hold_active===true;
}
/**
 * Testing-only cross-module read consistency check. A pause simulates
 * a reviewer or cross-module network round trip; the second read is essential.
 * Never turn "stable" into permission to hand off, pay, or release hold.
 */
export function createIsolatedRevocationRacePreflight({ledger,preflight}={}){
 if(!ledger||typeof ledger.viewFixtureWatermark!=='function'||
  typeof ledger.checkHistoricalPacket!=='function'||
  !preflight||typeof preflight.preflight!=='function')
  throw TypeError('Read-only fixture ledger and provenance preflight required');
 return Object.freeze({
  async check({packet,frozen_reference,revocation_reference,beforeFinalCheck}={}){
   if(!fields(revocation_reference,
    ['organization_id','incident_id','source_epoch','revocation_sequence',
     'revocation_digest','evidence_event_ids'])||
    !UUID.test(revocation_reference.organization_id)||
    !UUID.test(revocation_reference.incident_id)||
    typeof beforeFinalCheck!=='function')
    return deny('INVALID_RACE_PREFLIGHT_INPUT');
   const org=revocation_reference.organization_id.toLowerCase();
   const incident=revocation_reference.incident_id.toLowerCase();
   let first,second,check1,check2,source1,source2;
   try{
    first=ledger.viewFixtureWatermark(org,incident);
    if(!validWatermark(first))return deny('INVALID_FIXTURE_WATERMARK');
    check1=ledger.checkHistoricalPacket(revocation_reference);
    if(!check1.revocation_preflight_consistent||
       check1.reason_code!=='BLOCKED_EXTERNAL_REVOCATION_AUTHORITY_UNAVAILABLE')
     return deny('REVOCATION_PRECHECK_BLOCKED');
    source1=preflight.preflight({packet,frozen_reference});
    if(!source1.fixture_provenance_consistent||
       source1.reason_code!=='BLOCKED_EXTERNAL_AUTHORITIES_NOT_CONNECTED')
     return deny('PROVENANCE_PRECHECK_BLOCKED');
    await beforeFinalCheck();
    second=ledger.viewFixtureWatermark(org,incident);
    if(!validWatermark(second))return deny('INVALID_FIXTURE_WATERMARK');
    if(mark(first)!==mark(second))return deny('REVOCATION_CHANGED_DURING_REVIEW');
    check2=ledger.checkHistoricalPacket(revocation_reference);
    if(!check2.revocation_preflight_consistent||
       check2.reason_code!=='BLOCKED_EXTERNAL_REVOCATION_AUTHORITY_UNAVAILABLE')
     return deny('REVOCATION_FINAL_RECHECK_BLOCKED');
    source2=preflight.preflight({packet,frozen_reference});
    if(!source2.fixture_provenance_consistent||
       source2.reason_code!=='BLOCKED_EXTERNAL_AUTHORITIES_NOT_CONNECTED')
     return deny('PROVENANCE_CHANGED_DURING_REVIEW');
    // Recheck after callbacks as well: no source mutation may be missed.
    const third=ledger.viewFixtureWatermark(org,incident);
    if(!validWatermark(third)||mark(second)!==mark(third))
     return deny('REVOCATION_CHANGED_AT_FINAL_READ');
    return deny('BLOCKED_NO_ATOMIC_EXTERNAL_HANDOFF_AUTHORITY',true);
   }catch{
    return deny('RACE_PREFLIGHT_DEPENDENCY_UNAVAILABLE');
   }
  }
 });
}
