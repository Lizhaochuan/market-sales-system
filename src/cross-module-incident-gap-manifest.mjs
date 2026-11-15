// V3.2-119: bounded CI-only incident gap coverage and reproducible digest export.
// Student is the record unit. No household inference, external approval or release.
import {createHash} from 'node:crypto';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{64}$/;
const SCOPE=['organization_id','incident_id'];
const GAP=['hold_sequence','reason_code','hold_event_digest','message_digest'];
const REPORT=['checked_through','hold_head_digest','outbox_prefix',
 'negative_receipt_prefix','gaps','gap_digest','snapshot_digest'];
const EVENT=['schema_version','scope','sequence','previous_event_digest',
 'student_count','hold_event_count','scanned_student_count',
 'missing_scan_count','stale_scan_count','unresolved_gap_count',
 'source_snapshot_digest','manifest_digest','manifest','status','recorded_at_ms'];
const MANIFEST=['schema_version','organization_id','incident_id','students',
 'coverage_status','unresolved_gap_count','student_count'];
const STUDENT=['student_id','checked_through','outbox_prefix',
 'negative_receipt_prefix','scan_status','snapshot_digest','gaps'];
const STATUS=['CURRENT_TEST_SCAN','UNSCANNED_HOLD_STUDENT','STALE_TEST_SCAN'];
const REASONS=['OUTBOX_MISSING','NEGATIVE_RECEIPT_PENDING',
 'NEGATIVE_RECEIPT_OVERDUE'];
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
const exact=(x,keys)=>plain(x)&&Object.keys(x).length===keys.length&&
 keys.every(k=>Object.hasOwn(x,k));
const fail=c=>{const e=new Error(c);e.code=c;throw e;};
const scopeOk=s=>exact(s,SCOPE)&&SCOPE.every(k=>UUID.test(s[k])&&typeof s[k]==='string');
const DENY={
 external_source_verified:false,external_recipient_verified:false,
 external_authority_verified:false,finance_authorized:false,
 academic_authorized:false,handoff_allowed:false,
 compensation_write_allowed:false,release_eligible:false,
 hold_active:true,production_integration_allowed:false,
 merge_authorized:false,deploy_authorized:false
};
const blocked=(reason_code,more={})=>Object.freeze({
 reason_code,fixture_incident_manifest_recorded:false,...DENY,...more
});

// The caller is the SQL reader, never the client. It must discover ALL
// incident's HOLD-students inside one PostgreSQL transaction; rejecting
// oversized incidents is safer than silently truncating a student roster.
export function buildIsolatedIncidentGapManifest({scope,studentReports,maxStudents=8}={}){
 if(!scopeOk(scope)||!Array.isArray(studentReports)||
  !Number.isSafeInteger(maxStudents)||maxStudents<1||maxStudents>16||
  studentReports.length===0)
  fail('INCIDENT_MANIFEST_SCOPE_OR_SOURCE_INVALID');
 if(studentReports.length>maxStudents)
  fail('INCIDENT_MANIFEST_COVERAGE_LIMIT_EXCEEDED');
 let last='',holdCount=0,gapCount=0,scanned=0,missing=0,stale=0;
 const students=[];
 for(const entry of studentReports){
  if(!exact(entry,['student_id','report','scan_status'])||
   typeof entry.student_id!=='string'||!UUID.test(entry.student_id)||
   entry.student_id<=last||!STATUS.includes(entry.scan_status)||
   !exact(entry.report,REPORT))
   fail('INCIDENT_MANIFEST_STUDENT_SCOPE_OR_ORDER_INVALID');
  last=entry.student_id;
  const r=entry.report;
  if(!Number.isSafeInteger(r.checked_through)||r.checked_through<1||
   r.checked_through>64||!SHA.test(r.hold_head_digest)||
   !Number.isSafeInteger(r.outbox_prefix)||r.outbox_prefix<0||
   r.outbox_prefix>r.checked_through||
   !Number.isSafeInteger(r.negative_receipt_prefix)||
   r.negative_receipt_prefix<0||
   r.negative_receipt_prefix>r.outbox_prefix||
   !Array.isArray(r.gaps)||r.gaps.length>r.checked_through||
   !SHA.test(r.gap_digest)||!SHA.test(r.snapshot_digest)||
   sha(r.gaps)!==r.gap_digest)
   fail('INCIDENT_MANIFEST_STUDENT_REPORT_INVALID');
  let prior=0;
  for(const g of r.gaps){
   if(!exact(g,GAP)||!Number.isSafeInteger(g.hold_sequence)||
    g.hold_sequence<=prior||g.hold_sequence>r.checked_through||
    !REASONS.includes(g.reason_code)||
    !SHA.test(g.hold_event_digest)||!SHA.test(g.message_digest)||
    (g.reason_code==='OUTBOX_MISSING'&&g.message_digest!=='0'.repeat(64))||
    (g.reason_code!=='OUTBOX_MISSING'&&g.message_digest==='0'.repeat(64)))
    fail('INCIDENT_MANIFEST_GAP_CORRUPTED');
   prior=g.hold_sequence;
  }
  holdCount+=r.checked_through;gapCount+=r.gaps.length;
  if(entry.scan_status==='CURRENT_TEST_SCAN')scanned++;
  else if(entry.scan_status==='UNSCANNED_HOLD_STUDENT')missing++;
  else stale++;
  students.push({student_id:entry.student_id,checked_through:r.checked_through,
   outbox_prefix:r.outbox_prefix,
   negative_receipt_prefix:r.negative_receipt_prefix,
   scan_status:entry.scan_status,snapshot_digest:r.snapshot_digest,
   gaps:r.gaps.map(g=>({...g}))});
 }
 if(holdCount>maxStudents*64)
  fail('INCIDENT_MANIFEST_COVERAGE_LIMIT_EXCEEDED');
 const manifest=Object.freeze({
  schema_version:'v3.2-119-ci-incident-gap-export-v1',
  organization_id:scope.organization_id,incident_id:scope.incident_id,
  students:Object.freeze(students.map(s=>Object.freeze({
   ...s,gaps:Object.freeze(s.gaps.map(g=>Object.freeze(g)))}))),
  coverage_status:missing||stale?'INCOMPLETE_FIXTURE_SCAN_COVERAGE':
   'CURRENT_FIXTURE_SCANS_STILL_NOT_REAL_APPROVAL',
  unresolved_gap_count:gapCount,student_count:students.length
 });
 return Object.freeze({
  manifest,manifest_digest:sha(manifest),
  source_snapshot_digest:sha(students),
  student_count:students.length,hold_event_count:holdCount,
  scanned_student_count:scanned,missing_scan_count:missing,
  stale_scan_count:stale,unresolved_gap_count:gapCount
 });
}

// Integrity checks are SHA-256 transport checks, NOT signatures from an
// organization or proof of real external custody.
export function verifyIsolatedIncidentGapExport(raw){
 if(!exact(raw,['schema_version','manifest','manifest_sha256',
  'audit_event','audit_event_sha256'])||
  raw.schema_version!=='v3.2-119-ci-export-envelope-v1'||
  !SHA.test(raw.manifest_sha256)||!SHA.test(raw.audit_event_sha256)||
  !exact(raw.manifest,MANIFEST)||!exact(raw.audit_event,EVENT)||
  sha(raw.manifest)!==raw.manifest_sha256||
  sha(raw.audit_event)!==raw.audit_event_sha256||
  raw.audit_event.manifest_digest!==raw.manifest_sha256||
  JSON.stringify(raw.audit_event.manifest)!==JSON.stringify(raw.manifest)||
  raw.audit_event.source_snapshot_digest!==sha(raw.manifest.students)||
  raw.audit_event.status!=='HOLD_ACTIVE_MANIFEST_AUDIT_ONLY')
  return false;
 try{
  const p=buildIsolatedIncidentGapManifest({
   scope:{organization_id:raw.manifest.organization_id,
    incident_id:raw.manifest.incident_id},
   studentReports:raw.manifest.students.map(s=>({
    student_id:s.student_id,scan_status:s.scan_status,
    report:{checked_through:s.checked_through,
     hold_head_digest:'0'.repeat(64), // no canonical hold head in export
     outbox_prefix:s.outbox_prefix,
     negative_receipt_prefix:s.negative_receipt_prefix,
     gaps:s.gaps,gap_digest:sha(s.gaps),
     snapshot_digest:s.snapshot_digest}
   })),maxStudents:16
  });
  return p.manifest_digest===raw.manifest_sha256&&
   p.manifest.coverage_status===raw.manifest.coverage_status&&
   p.manifest.unresolved_gap_count===raw.manifest.unresolved_gap_count&&
   p.manifest.student_count===raw.manifest.student_count&&
   p.student_count===raw.audit_event.student_count&&
   p.hold_event_count===raw.audit_event.hold_event_count&&
   p.scanned_student_count===raw.audit_event.scanned_student_count&&
   p.missing_scan_count===raw.audit_event.missing_scan_count&&
   p.stale_scan_count===raw.audit_event.stale_scan_count&&
   p.unresolved_gap_count===raw.audit_event.unresolved_gap_count;
 }catch{return false;}
}
export function createIsolatedIncidentGapAudit({
 ledger,getFixtureNow,afterCommit=async()=>{}
}={}){
 if(!ledger||['captureAndAppend','capture','head','event'].some(k=>
   typeof ledger[k]!=='function')||
  typeof getFixtureNow!=='function'||typeof afterCommit!=='function')
  throw TypeError('V119 requires isolated incident SQL audit and CI clock');
 const lanes=new Map(),clocks=new Map();
 function now(scope){
  let t;try{t=getFixtureNow();}catch{fail('INCIDENT_MANIFEST_CLOCK_UNAVAILABLE');}
  const k=scope.organization_id+'|'+scope.incident_id;
  if(!Number.isSafeInteger(t)||t<1||t<(clocks.get(k)||0))
   fail('INCIDENT_MANIFEST_CLOCK_ROLLBACK');
  clocks.set(k,t);return t;
 }
 async function aggregate(scope={}){
  if(!scopeOk(scope))return blocked('INCIDENT_MANIFEST_SCOPE_INVALID');
  const k=scope.organization_id+'|'+scope.incident_id;
  const earlier=lanes.get(k)||Promise.resolve();
  const work=earlier.catch(()=>{}).then(async()=>{
   try{
    const t=now(scope),result=await ledger.captureAndAppend(scope,t);
    if(!exact(result,['accepted','sequence','event_digest','reason_code','summary'])||
     result.accepted!==true||
     result.reason_code!=='FIXTURE_INCIDENT_MANIFEST_STORED'||
     !Number.isSafeInteger(result.sequence)||result.sequence<1||
     !SHA.test(result.event_digest)||
     !exact(result.summary,['manifest','manifest_digest',
      'source_snapshot_digest','student_count','hold_event_count',
      'scanned_student_count','missing_scan_count','stale_scan_count',
      'unresolved_gap_count']))
     fail('INCIDENT_MANIFEST_SQL_REPLAY_OR_UNCERTAIN');
    await afterCommit({scope,summary:result.summary});
    const [head,event,current]=await Promise.all([
     ledger.head(scope),ledger.event(scope,result.sequence),
     ledger.capture(scope,now(scope))
    ]);
    if(!head||head.sequence!==result.sequence||
     head.event_digest!==result.event_digest||
     !exact(event,EVENT)||sha(event)!==result.event_digest||
     event.status!=='HOLD_ACTIVE_MANIFEST_AUDIT_ONLY')
     fail('INCIDENT_MANIFEST_POSTCOMMIT_READBACK_UNVERIFIED');
    const changed=current.source_snapshot_digest!==
     result.summary.source_snapshot_digest;
    return blocked(changed?'BLOCKED_INCIDENT_SOURCE_CHANGED_AFTER_COMMIT':
     'BLOCKED_FIXTURE_INCIDENT_MANIFEST_STORED',{
     fixture_incident_manifest_recorded:true,
     manifest_digest:result.summary.manifest_digest,
     audit_sequence:result.sequence,
     student_count:result.summary.student_count,
     hold_event_count:result.summary.hold_event_count,
     unresolved_gap_count:result.summary.unresolved_gap_count,
     unscanned_student_count:result.summary.missing_scan_count,
     stale_student_count:result.summary.stale_scan_count,
     coverage_status:result.summary.manifest.coverage_status});
   }catch(e){return blocked(typeof e?.code==='string'&&e.code.length<128?
    e.code:'INCIDENT_MANIFEST_DEPENDENCY_UNAVAILABLE');}
  });
  lanes.set(k,work);
  try{return await work;}finally{if(lanes.get(k)===work)lanes.delete(k);}
 }
 async function exportLatest(scope={}){
  if(!scopeOk(scope))return blocked('INCIDENT_MANIFEST_SCOPE_INVALID');
  try{
   const head=await ledger.head(scope);
   if(!head)return blocked('BLOCKED_NO_INCIDENT_MANIFEST');
   const event=await ledger.event(scope,head.sequence);
   if(!exact(event,EVENT)||sha(event)!==head.event_digest||
    event.sequence!==head.sequence||
    event.status!=='HOLD_ACTIVE_MANIFEST_AUDIT_ONLY'||
    sha(event.manifest)!==event.manifest_digest)
    fail('INCIDENT_MANIFEST_EXPORT_INTEGRITY_UNVERIFIED');
   const envelope={schema_version:'v3.2-119-ci-export-envelope-v1',
    manifest:event.manifest,manifest_sha256:event.manifest_digest,
    audit_event:event,audit_event_sha256:head.event_digest};
   if(!verifyIsolatedIncidentGapExport(envelope))
    fail('INCIDENT_MANIFEST_EXPORT_INTEGRITY_UNVERIFIED');
   return blocked('BLOCKED_INCIDENT_MANIFEST_EXPORT_READY',{
    fixture_export_json:JSON.stringify(envelope)+'\n',
    manifest_sha256:event.manifest_digest,audit_sequence:head.sequence});
  }catch(e){return blocked(typeof e?.code==='string'&&e.code.length<128?
    e.code:'INCIDENT_MANIFEST_DEPENDENCY_UNAVAILABLE');}
 }
 return Object.freeze({aggregate,exportLatest});
}
