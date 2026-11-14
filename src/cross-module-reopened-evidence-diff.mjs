// V3.2-86: CI-only read-only diff between two fictional blocker audit snapshots.
// Reporting changes and follow-up history never conveys release authority.
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const CODES=Object.freeze([
 'finance_signature','academic_signature','order_payment_reconciliation',
 'lesson_entitlement_reconciliation','three_party_joint_acceptance',
 'external_atomic_receipt'
]);
const OWNERS=Object.freeze({
 finance_signature:'finance',academic_signature:'academic',
 order_payment_reconciliation:'finance',lesson_entitlement_reconciliation:'academic',
 three_party_joint_acceptance:'sales',external_atomic_receipt:'sales'
});
const GAPS=Object.freeze([
 'finance_independent_signature','academic_independent_signature',
 'order_payment_reconciliation','lesson_entitlement_reconciliation',
 'three_party_acceptance','atomic_handoff_receipt'
]);
const exact=(x,fields)=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null)&&
 Object.keys(x).length===fields.length&&fields.every(k=>Object.hasOwn(x,k));
function freezeResult(reason_code,differences=[],followup_status='not_verified'){
 const requirements=GAPS.map(code=>Object.freeze({code,status:'requires_external_authority'}));
 return Object.freeze({reason_code,fixture_comparison_complete:false,
  differences:Object.freeze(differences.map(x=>Object.freeze({...x}))),
  followup_status,external_requirements:Object.freeze(requirements),
  external_authority_verified:false,finance_authorized:false,academic_authorized:false,
  handoff_allowed:false,compensation_write_allowed:false,release_eligible:false,
  hold_active:true,production_integration_allowed:false});
}
function checkRecord(r,org,incident,seq,digest){
 if(!r||r.organization_id!==org||r.incident_id!==incident||
   r.sequence!==seq||r.record_digest!==digest||r.fixture_only!==true||
   r.hold_active!==true||r.handoff_allowed!==false||
   !Number.isSafeInteger(r.source_revision)||r.source_revision<1||
   !Number.isSafeInteger(r.source_epoch)||r.source_epoch<1||
   !Number.isSafeInteger(r.revocation_sequence)||r.revocation_sequence<0||
   !SHA.test(r.revocation_digest)||!SHA.test(r.source_snapshot_digest_after)||
   !Array.isArray(r.supplements)||r.supplements.length!==CODES.length)return false;
 const seen=new Set();
 for(const row of r.supplements){
  if(!exact(row,['requirement_code','supplement_version','chain_digest'])||
   !CODES.includes(row.requirement_code)||seen.has(row.requirement_code)||
   !Number.isSafeInteger(row.supplement_version)||row.supplement_version<1||
   !SHA.test(row.chain_digest))return false;
  seen.add(row.requirement_code);
 }
 return true;
}
function compare(left,right){
 const rows=[];
 for(const [field,owner] of [['source_revision','sales'],['source_epoch','sales'],
  ['revocation_sequence','sales'],['revocation_digest','sales'],
  ['source_snapshot_digest_after','sales']]){
  if(left[field]!==right[field])rows.push({
   item:field,owner_department:owner,change_type:'changed',
   // Report only field names and digests/versions, not personal data.
   before:left[field],after:right[field],rereview_required:true});
 }
 const prior=new Map(left.supplements.map(x=>[x.requirement_code,x]));
 const next=new Map(right.supplements.map(x=>[x.requirement_code,x]));
 for(const code of CODES){
  const a=prior.get(code),b=next.get(code);
  if(a.supplement_version!==b.supplement_version||a.chain_digest!==b.chain_digest)
   rows.push({item:code,owner_department:OWNERS[code],
    change_type:'changed',before_version:a.supplement_version,
    after_version:b.supplement_version,before_digest:a.chain_digest,
    after_digest:b.chain_digest,rereview_required:true});
 }
 return rows;
}
export function createIsolatedReopenedEvidenceDiff({audit,followup,getFixtureCurrentSourceRevision}={}){
 if(!audit||typeof audit.verify!=='function'||typeof audit.audit!=='function'||
   !followup||typeof followup.report!=='function'||
   typeof getFixtureCurrentSourceRevision!=='function')
  throw new TypeError('Independent fictional audit, follow-up and source adapters required');
 async function report(input={}){
  const fields=['organization_id','incident_id','previous_audit_sequence',
   'previous_audit_digest','new_audit_sequence','new_audit_digest'];
  if(!exact(input,fields)||!UUID.test(input.organization_id)||
   !UUID.test(input.incident_id)||!Number.isSafeInteger(input.previous_audit_sequence)||
   input.previous_audit_sequence<1||!Number.isSafeInteger(input.new_audit_sequence)||
   input.new_audit_sequence<1||!SHA.test(input.previous_audit_digest)||
   !SHA.test(input.new_audit_digest))
   return freezeResult('INVALID_DIFF_REPORT_INPUT');
  const org=input.organization_id.toLowerCase(),incident=input.incident_id.toLowerCase();
  const scoped={organization_id:org,incident_id:incident};
  let verified,rows,current,follow;
  try{
   verified=await audit.verify(scoped);
   if(!verified||verified.reason_code!=='BLOCKED_FIXTURE_AUDIT_CHAIN_ONLY'||
     verified.hold_active!==true||verified.handoff_allowed!==false)
    return freezeResult('AUDIT_CHAIN_NOT_VERIFIED');
   rows=await audit.audit(scoped);
   current=await getFixtureCurrentSourceRevision(org,incident);
   follow=await followup.report({...scoped,
    previous_audit_sequence:input.previous_audit_sequence,
    previous_audit_digest:input.previous_audit_digest,
    new_audit_sequence:input.new_audit_sequence,
    new_audit_digest:input.new_audit_digest});
  }catch{return freezeResult('DIFF_DEPENDENCY_UNAVAILABLE');}
  if(!Array.isArray(rows)||!Number.isSafeInteger(current)||current<1)
   return freezeResult('DIFF_SOURCE_OR_AUDIT_INVALID');
  const left=rows.find(x=>x?.sequence===input.previous_audit_sequence);
  const right=rows.find(x=>x?.sequence===input.new_audit_sequence);
  if(!checkRecord(left,org,incident,input.previous_audit_sequence,input.previous_audit_digest)||
   !checkRecord(right,org,incident,input.new_audit_sequence,input.new_audit_digest)||
   right.sequence<=left.sequence||right.source_revision<left.source_revision)
   return freezeResult('AUDIT_REFERENCES_INVALID_OR_OUT_OF_ORDER');
  if(current!==right.source_revision)return freezeResult('DIFF_SOURCE_REVISION_STALE');
  if(!follow||follow.reason_code!=='BLOCKED_FOLLOWUP_STATUS_IS_NOT_AUTHORIZATION'||
   follow.hold_active!==true||follow.handoff_allowed!==false||
   !['awaiting_reopen','reopened','under_rereview','closed_administratively'].includes(follow.status))
   return freezeResult('FOLLOWUP_REPORT_NOT_VERIFIED');
  const changes=compare(left,right);
  if(changes.length===0)return freezeResult('NO_MATERIAL_CHANGE_TO_REVIEW',[],follow.status);
  // Final source check detects changes while this asynchronous report is built.
  try{
   if(await getFixtureCurrentSourceRevision(org,incident)!==right.source_revision)
    return freezeResult('DIFF_SOURCE_CHANGED_DURING_REPORT',changes,follow.status);
  }catch{return freezeResult('DIFF_DEPENDENCY_UNAVAILABLE',changes,follow.status);}
  return Object.freeze({...freezeResult('BLOCKED_REVIEW_CHANGED_EVIDENCE_AND_EXTERNAL_GAPS',
   changes,follow.status),fixture_comparison_complete:true,
   rereview_departments:Object.freeze([...new Set(changes.map(x=>x.owner_department))]),
   all_external_gaps_open:true});
 }
 return Object.freeze({report});
}
