// V3.2-67: proposal-only structural preflight. NO trusted key, signature verification,
// finance acceptance, academic attestation, compensation execution or hold-release branch.
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sha256=/^[a-f0-9]{64}$/;
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const keys=(x,required)=>record(x)&&Object.keys(x).length===required.length&&
  required.every(k=>Object.hasOwn(x,k));
const safeString=(x,max=256)=>typeof x==='string'&&x.trim().length>0&&x.length<=max;
const knownDate=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(x)&&Number.isFinite(Date.parse(x));
const envelopeKeys=['protocol_version','handoff_id','incident_id','organization_id','sales_packet_digest','events','parties','original_records_preserved','request_nonce'];
const eventKeys=['source_event_id','source_system','event_type','occurred_at','digest'];
const partyKeys=['authority_domain','principal_id','organization_id','signed_receipt_id','evidence_digest','decision','signed_at'];
const parties=['sales','finance','academic'];
export const proposedEnvelopeMayAuthorizeRelease=false;
export function preflightProposedThreePartyEvidence(input){
 const deny=(reason_code)=>Object.freeze({
   accepted:false,signature_verified:false,external_trust_configured:false,
   finance_authorized:false,execution_allowed:false,hold_active:true,
   release_eligible:false,compensation_write_allowed:false,
   original_records_mutable:false,
   failure_disposition:'reject_preserve_originals_escalate_manually',
   reason_code
 });
 if(!keys(input,envelopeKeys))return deny('blocked_missing_or_extra_envelope_fields');
 if(input.protocol_version!=='v3.2-66-proposed'||!uuid.test(input.handoff_id)||
    !uuid.test(input.incident_id)||!uuid.test(input.organization_id)||
    !sha256.test(input.sales_packet_digest)||!safeString(input.request_nonce,128)||
    input.request_nonce.length<16)
   return deny('blocked_invalid_protocol_binding');
 if(input.original_records_preserved!==true)return deny('blocked_original_history_not_preserved');
 if(!Array.isArray(input.events)||input.events.length<1||input.events.length>100)
   return deny('blocked_invalid_event_chain');
 const eventIds=new Set();
 for(const event of input.events){
   if(!keys(event,eventKeys)||!safeString(event.source_event_id)||
      !['market_sales','crm_finance','academic'].includes(event.source_system)||
      !safeString(event.event_type)||!knownDate(event.occurred_at)||
      !sha256.test(event.digest)||eventIds.has(event.source_system+':'+event.source_event_id))
    return deny('blocked_invalid_or_duplicate_events');
   eventIds.add(event.source_system+':'+event.source_event_id);
 }
 if(!keys(input.parties,parties))return deny('blocked_missing_or_extra_parties');
 const principalIds=new Set(),receipts=new Set(),decisions=[];
 for(const party of parties){
   const x=input.parties[party];
   if(!keys(x,partyKeys)||x.authority_domain!==party||!safeString(x.principal_id)||
      !uuid.test(x.organization_id)||!safeString(x.signed_receipt_id)||
      !sha256.test(x.evidence_digest)||!['accepted','rejected','requires_correction'].includes(x.decision)||
      !knownDate(x.signed_at))
      return deny('blocked_invalid_party_receipt');
   if(x.organization_id!==input.organization_id)
      return deny('blocked_cross_organization_receipt');
   if(x.evidence_digest!==input.sales_packet_digest)
      return deny('blocked_snapshot_digest_mismatch');
   if(principalIds.has(x.principal_id))return deny('blocked_separation_of_duties');
   if(receipts.has(x.signed_receipt_id))return deny('blocked_duplicate_receipt');
   principalIds.add(x.principal_id);receipts.add(x.signed_receipt_id);
   decisions.push(x.decision);
 }
 if(decisions.includes('rejected'))return deny('blocked_external_rejected_claim');
 if(decisions.includes('requires_correction'))return deny('blocked_external_correction_claim');
 // The input contains only unverified claims. No trusted verifier/revocation/replay
 // registry exists, so even three structurally correct "accepted" receipts fail.
 return deny('blocked_external_signature_verifier_revocation_and_replay_unavailable');
}
