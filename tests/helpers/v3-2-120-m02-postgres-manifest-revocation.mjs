// V3.2-120: disposable SQL transaction for incident export revocation evidence.
import {createHash} from 'node:crypto';
import {captureIsolatedIncidentGapSnapshot} from './v3-2-119-m02-postgres-incident-gap-manifest.mjs';
import {verifyIsolatedIncidentGapExport} from '../../src/cross-module-incident-gap-manifest.mjs';
import {classifyIsolatedExportRevision} from '../../src/cross-module-manifest-revocation-audit.mjs';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const ZERO='0'.repeat(64);
const SCOPE=['organization_id','incident_id'];
const EVENT=['schema_version','scope','sequence','previous_event_digest',
 'target_manifest_sequence','target_manifest_digest','target_source_digest',
 'latest_manifest_sequence','latest_manifest_digest','observed_source_digest',
 'classification','revocation_recorded','cause_digest','status','recorded_at_ms'];
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const exact=(x,keys)=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const scoped=x=>exact(x,SCOPE)&&SCOPE.every(k=>typeof x[k]==='string'&&UUID.test(x[k]));
const params=x=>SCOPE.map(k=>x[k].toLowerCase());
const fault=c=>{const e=new Error(c);e.code=c;throw e;};
const intSeq=x=>Number.isSafeInteger(x)&&x>=1&&x<=128;
async function loadV119History(c,scope){
 const h=await c.query(
  'SELECT sequence,event_digest,student_count,source_snapshot_digest,hold_active FROM v106_test.fixture_incident_gap_manifest_heads WHERE organization_id=$1 AND incident_id=$2 FOR SHARE',
  params(scope));
 if(h.rowCount!==1||h.rows[0].hold_active!==true)
  fault('EXPORT_REVOCATION_TARGET_HISTORY_MISSING');
 const count=Number(h.rows[0].sequence);
 if(!intSeq(count))fault('EXPORT_REVOCATION_TARGET_HISTORY_INVALID');
 const rows=await c.query(
  'SELECT sequence,event_payload,event_digest,manifest_digest,source_snapshot_digest FROM v106_test.fixture_incident_gap_manifest_events WHERE organization_id=$1 AND incident_id=$2 ORDER BY sequence',params(scope));
 if(rows.rowCount!==count)fault('EXPORT_REVOCATION_TARGET_HISTORY_GAP');
 const events=[];let prior=ZERO,studentCount=0;
 for(let i=0;i<rows.rows.length;i++){
  const r=rows.rows[i];let e;
  try{e=JSON.parse(r.event_payload);}catch{fault('EXPORT_REVOCATION_TARGET_HISTORY_TAMPERED');}
  const en={schema_version:'v3.2-119-ci-export-envelope-v1',
   manifest:e.manifest,manifest_sha256:e.manifest_digest,
   audit_event:e,audit_event_sha256:r.event_digest};
  if(Number(r.sequence)!==i+1||e.sequence!==i+1||
   e.previous_event_digest!==prior||sha(e)!==r.event_digest||
   e.source_snapshot_digest!==r.source_snapshot_digest||
   e.manifest_digest!==r.manifest_digest||
   e.student_count<studentCount||
   !verifyIsolatedIncidentGapExport(en)||
   e.scope.organization_id!==scope.organization_id||
   e.scope.incident_id!==scope.incident_id)
   fault('EXPORT_REVOCATION_TARGET_HISTORY_TAMPERED');
  prior=r.event_digest;studentCount=e.student_count;events.push(e);
 }
 if(prior!==h.rows[0].event_digest||
  studentCount!==Number(h.rows[0].student_count)||
  events[count-1].source_snapshot_digest!==h.rows[0].source_snapshot_digest)
  fault('EXPORT_REVOCATION_TARGET_HEAD_TAMPERED');
 return {events,head:{sequence:count,event_digest:prior}};
}
async function loadRevocationEvents(c,scope){
 const h=await c.query(
  'SELECT sequence,event_digest,revoked_export_count,hold_active FROM v106_test.fixture_manifest_revocation_heads WHERE organization_id=$1 AND incident_id=$2 FOR UPDATE',
  params(scope));
 if(!h.rowCount)return {head:null,events:[]};
 const head={sequence:Number(h.rows[0].sequence),
  event_digest:h.rows[0].event_digest,
  revoked_export_count:Number(h.rows[0].revoked_export_count)};
 if(h.rows[0].hold_active!==true||!intSeq(head.sequence)||
  !SHA.test(head.event_digest)||!Number.isSafeInteger(head.revoked_export_count)||
  head.revoked_export_count<0||head.revoked_export_count>head.sequence)
  fault('EXPORT_REVOCATION_AUDIT_HEAD_TAMPERED');
 const r=await c.query(
  'SELECT sequence,event_payload,event_digest FROM v106_test.fixture_manifest_revocation_events WHERE organization_id=$1 AND incident_id=$2 ORDER BY sequence',
  params(scope));
 if(r.rowCount!==head.sequence)
  fault('EXPORT_REVOCATION_AUDIT_HISTORY_GAP');
 const events=[];let prior=ZERO;const invalidated=new Set();
 for(let i=0;i<r.rows.length;i++){
  const row=r.rows[i];let event;
  try{event=JSON.parse(row.event_payload);}catch{
   fault('EXPORT_REVOCATION_AUDIT_HISTORY_TAMPERED');
  }
  if(!exact(event,EVENT)||event.schema_version!=='v3.2-120-ci-export-revocation-v1'||
   event.scope.organization_id!==scope.organization_id||
   event.scope.incident_id!==scope.incident_id||
   event.sequence!==i+1||Number(row.sequence)!==i+1||
   event.previous_event_digest!==prior||
   event.status!=='HOLD_ACTIVE_EXPORT_REVOCATION_AUDIT_ONLY'||
   event.revocation_recorded!==event.classification.startsWith('REVOKED_')||
   sha(event)!==row.event_digest)
   fault('EXPORT_REVOCATION_AUDIT_HISTORY_TAMPERED');
  prior=sha(event);events.push(event);
  if(event.revocation_recorded)invalidated.add(event.target_manifest_sequence);
 }
 if(head.event_digest!==prior||head.revoked_export_count!==invalidated.size)
  fault('EXPORT_REVOCATION_AUDIT_HISTORY_TAMPERED');
 return {head,events,invalidated};
}
export function createIsolatedPostgresManifestRevocation({
 pool,receiptOverdueMs=60000,maxStudents=8,beforeCommit=async()=>{}
}={}){
 if(process.env.V106_ISOLATED_PG!=='YES_TEST_ONLY'||!pool||
  typeof pool.connect!=='function'||typeof beforeCommit!=='function'||
  !Number.isSafeInteger(receiptOverdueMs)||receiptOverdueMs<1000||
  receiptOverdueMs>86400000||
  !Number.isSafeInteger(maxStudents)||maxStudents<1||maxStudents>8)
  throw TypeError('V120 requires only bounded disposable PostgreSQL');
 async function connect(){
  const c=await pool.connect();
  try{
   const r=await c.query('SELECT current_database() AS db,current_user AS actor');
   if(r.rows[0]?.db!=='v106_isolated'||
    !['v106_writer_a','v106_writer_b'].includes(r.rows[0]?.actor))
    fault('EXPORT_REVOCATION_SQL_WRITER_OR_DB_UNTRUSTED');
   return c;
  }catch(e){c.release();throw e;}
 }
 async function head(scope){
  if(!scoped(scope))fault('EXPORT_REVOCATION_SQL_SCOPE_INVALID');
  const c=await connect();
  try{
   const r=await c.query(
    'SELECT sequence,event_digest,revoked_export_count,hold_active FROM v106_test.fixture_manifest_revocation_heads WHERE organization_id=$1 AND incident_id=$2',params(scope));
   if(!r.rowCount)return null;
   if(r.rows[0].hold_active!==true)
    fault('EXPORT_REVOCATION_HOLD_FLAG_TAMPERED');
   return {sequence:Number(r.rows[0].sequence),
    event_digest:r.rows[0].event_digest,
    revoked_export_count:Number(r.rows[0].revoked_export_count)};
  }finally{c.release();}
 }
 async function event(scope,seq){
  if(!scoped(scope)||!intSeq(seq))fault('EXPORT_REVOCATION_SQL_EVENT_SCOPE_INVALID');
  const c=await connect();
  try{
   const r=await c.query(
    'SELECT event_payload,event_digest FROM v106_test.fixture_manifest_revocation_events WHERE organization_id=$1 AND incident_id=$2 AND sequence=$3',
    [...params(scope),seq]);
   if(!r.rowCount)return null;
   let e;
   try{e=JSON.parse(r.rows[0].event_payload);}catch{
    fault('EXPORT_REVOCATION_EVENT_TAMPERED');
   }
   if(!exact(e,EVENT)||sha(e)!==r.rows[0].event_digest)
    fault('EXPORT_REVOCATION_EVENT_TAMPERED');
   return e;
  }finally{c.release();}
 }
 async function capture(scope,t){
  if(!scoped(scope))fault('EXPORT_REVOCATION_SQL_SCOPE_INVALID');
  const c=await connect();let began=false;
  try{
   await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');began=true;
   const latest=await loadV119History(c,scope);
   const summary=await captureIsolatedIncidentGapSnapshot(
    c,scope,t,receiptOverdueMs,maxStudents);
   await c.query('COMMIT');began=false;
   return {source_snapshot_digest:summary.source_snapshot_digest,
    latest_manifest_digest:latest.head.event_digest};
  }catch(e){if(began)await c.query('ROLLBACK').catch(()=>{});throw e;
  }finally{c.release();}
 }
 async function observe(scope,targetSeq,t){
  if(!scoped(scope)||!intSeq(targetSeq)||
   !Number.isSafeInteger(t)||t<1)fault('EXPORT_REVOCATION_SQL_SCOPE_INVALID');
  for(let attempt=0;attempt<4;attempt++){
   const c=await connect();let began=false;
   try{
    await c.query('BEGIN ISOLATION LEVEL SERIALIZABLE');began=true;
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text,0))',
     ['v120|'+params(scope).join('|')]);
    const history=await loadV119History(c,scope);
    if(targetSeq>history.head.sequence)
     fault('EXPORT_REVOCATION_TARGET_SEQUENCE_ABSENT');
    const previous=await loadRevocationEvents(c,scope);
    const target=history.events[targetSeq-1],summary=
     await captureIsolatedIncidentGapSnapshot(c,scope,t,receiptOverdueMs,maxStudents);
    const already=previous.invalidated?.has(targetSeq)??false;
    if(previous.events.some(e=>e.target_manifest_sequence===targetSeq&&
     e.observed_source_digest===summary.source_snapshot_digest)){
     await c.query('ROLLBACK');began=false;
     return {accepted:false,sequence:0,event_digest:ZERO,
      reason_code:'EXPORT_REVOCATION_DUPLICATE_OBSERVATION',
      classification:'REPLAY_NOT_RECORDED',revocation_recorded:already,
      source_snapshot_digest:summary.source_snapshot_digest,
      latest_manifest_digest:history.head.event_digest};
    }
    const classification=classifyIsolatedExportRevision({
     target_manifest_sequence:targetSeq,
     target_manifest_digest:sha(target),
     target_source_digest:target.source_snapshot_digest,
     latest_manifest_sequence:history.head.sequence,
     latest_manifest_digest:history.head.event_digest,
     observed_source_digest:summary.source_snapshot_digest,
     previously_revoked:already
    });
    const revoked=classification.startsWith('REVOKED_'),seq=(previous.head?.sequence||0)+1;
    if(seq>128)fault('EXPORT_REVOCATION_AUDIT_LIMIT_EXCEEDED');
    const cause_digest=sha({scope,targetSeq,
     target_digest:sha(target),
     observed_source_digest:summary.source_snapshot_digest,
     classification});
    const record={schema_version:'v3.2-120-ci-export-revocation-v1',
     scope,sequence:seq,
     previous_event_digest:previous.head?.event_digest??ZERO,
     target_manifest_sequence:targetSeq,
     target_manifest_digest:sha(target),
     target_source_digest:target.source_snapshot_digest,
     latest_manifest_sequence:history.head.sequence,
     latest_manifest_digest:history.head.event_digest,
     observed_source_digest:summary.source_snapshot_digest,
     classification,revocation_recorded:revoked,cause_digest,
     status:'HOLD_ACTIVE_EXPORT_REVOCATION_AUDIT_ONLY',recorded_at_ms:t};
    const digest=sha(record);
    await c.query(
     'INSERT INTO v106_test.fixture_manifest_revocation_events (organization_id,incident_id,sequence,target_manifest_sequence,cause_digest,event_payload,event_digest) VALUES($1,$2,$3,$4,$5,$6,$7)',
     [...params(scope),seq,targetSeq,cause_digest,JSON.stringify(record),digest]);
    const count=(previous.head?.revoked_export_count||0)+(revoked&&!already?1:0);
    await c.query(
     `INSERT INTO v106_test.fixture_manifest_revocation_heads
      (organization_id,incident_id,sequence,event_digest,revoked_export_count,hold_active)
      VALUES($1,$2,$3,$4,$5,true)
      ON CONFLICT(organization_id,incident_id) DO UPDATE SET
       sequence=EXCLUDED.sequence,event_digest=EXCLUDED.event_digest,
       revoked_export_count=EXCLUDED.revoked_export_count`,
     [...params(scope),seq,digest,count]);
    await beforeCommit({scope,record,attempt});
    await c.query('COMMIT');began=false;
    return {accepted:true,sequence:seq,event_digest:digest,
     reason_code:'FIXTURE_EXPORT_OBSERVATION_APPENDED',
     classification,revocation_recorded:revoked,
     source_snapshot_digest:summary.source_snapshot_digest,
     latest_manifest_digest:history.head.event_digest};
   }catch(e){
    if(began)await c.query('ROLLBACK').catch(()=>{});
    if(['40001','40P01'].includes(e.code)&&attempt<3)continue;
    if(e.code==='23505')return {accepted:false,sequence:0,event_digest:ZERO,
     reason_code:'EXPORT_REVOCATION_SQL_DUPLICATE_OR_CONFLICT',
     classification:'REPLAY_NOT_RECORDED',revocation_recorded:false,
     source_snapshot_digest:ZERO,latest_manifest_digest:ZERO};
    throw e;
   }finally{c.release();}
  }
  fault('EXPORT_REVOCATION_RETRY_EXHAUSTED');
 }
 return Object.freeze({observe,head,event,capture});
}
