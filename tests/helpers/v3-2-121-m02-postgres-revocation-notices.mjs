// V121 disposable PostgreSQL adapter. SQL verifies revocation before enqueue.
// This is not a network sender or evidence of real-world acknowledgement.
import {createHash} from 'node:crypto';
import {deriveFixtureRevocationNoticeId} from '../../src/cross-module-revocation-notice-contract.mjs';
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const fail=c=>{const e=new Error(c);e.code=c;throw e;};
const scopeParams=x=>[x.organization_id,x.incident_id];
export function createIsolatedPostgresRevocationNotices({pool}={}){
 if(process.env.V106_ISOLATED_PG!=='YES_TEST_ONLY'||!pool?.connect)
  throw TypeError('V121 requires disposable PostgreSQL');
 async function connect(){
  const c=await pool.connect();
  try{
   const r=await c.query('SELECT current_database() AS db,current_user AS actor');
   if(r.rows[0]?.db!=='v106_isolated'||!['v106_writer_a','v106_writer_b'].includes(r.rows[0]?.actor))
    fail('NOTICE_SQL_CONTEXT_UNTRUSTED');
   return c;
  }catch(e){c.release();throw e;}
 }
 async function verifyHistory(c,table,head,scope,code){
  const count=Number(head.sequence);
  if(!Number.isSafeInteger(count)||count<1||count>128)fail(code);
  const rows=await c.query(
   'SELECT sequence,event_payload,event_digest FROM v106_test.'+table+
   ' WHERE organization_id=$1 AND incident_id=$2 ORDER BY sequence',scopeParams(scope));
  if(rows.rowCount!==count)fail(code);
  let previous='0'.repeat(64);
  const events=[];
  for(let i=0;i<rows.rows.length;i++){
   const row=rows.rows[i];let event;
   try{event=JSON.parse(row.event_payload);}catch{fail(code);}
   const digest=sha(event);
   if(Number(row.sequence)!==i+1||event?.sequence!==i+1||
      event.previous_event_digest!==previous||digest!==row.event_digest||
      event.scope?.organization_id!==scope.organization_id||
      event.scope?.incident_id!==scope.incident_id)fail(code);
   previous=digest;events.push({event,digest});
  }
  if(previous!==head.event_digest)fail(code);
  return events;
 }
 async function source(c,scope){
  const p=scopeParams(scope);
  const mh=await c.query('SELECT sequence,event_digest,hold_active FROM v106_test.fixture_incident_gap_manifest_heads WHERE organization_id=$1 AND incident_id=$2 ',p);
  if(mh.rowCount!==1||mh.rows[0].hold_active!==true)fail('NOTICE_MANIFEST_HEAD_ABSENT');
  const manifests=await verifyHistory(c,'fixture_incident_gap_manifest_events',mh.rows[0],scope,'NOTICE_MANIFEST_HISTORY_INVALID');
  const target=manifests[scope.export_version-1];
  if(!target||target.digest!==scope.manifest_digest)
   fail('NOTICE_MANIFEST_VERSION_ABSENT');
  const rh=await c.query('SELECT sequence,event_digest,hold_active FROM v106_test.fixture_manifest_revocation_heads WHERE organization_id=$1 AND incident_id=$2 ',p);
  if(rh.rowCount!==1||rh.rows[0].hold_active!==true)fail('NOTICE_REVOCATION_HEAD_ABSENT');
  const revocations=await verifyHistory(c,'fixture_manifest_revocation_events',rh.rows[0],scope,'NOTICE_REVOCATION_HISTORY_INVALID');
  const match=revocations.find(({digest})=>digest===scope.revocation_event_digest);
  const event=match?.event;
  if(!event||event.target_manifest_sequence!==scope.export_version||
     event.target_manifest_digest!==scope.manifest_digest||
     event.revocation_recorded!==true||
     !['REVOKED_PREVIOUSLY','REVOKED_SUPERSEDED_BY_LATER_EXPORT',
       'REVOKED_SOURCE_CHANGED_AFTER_EXPORT'].includes(event.classification))
   fail('NOTICE_REVOCATION_UNPROVEN');
  return {manifest_digest:scope.manifest_digest,revocation_event_digest:scope.revocation_event_digest,revoked:true};
 }
 async function read(scope,callback){
  const c=await connect();let started=false;
  try{
   await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ');started=true;
   const output=await callback(c);
   await c.query('COMMIT');started=false;return output;
  }catch(e){if(started)await c.query('ROLLBACK').catch(()=>{});throw e;
  }finally{c.release();}
 }
 async function sourceHeads(scope){return read(scope,c=>source(c,scope));}
 async function listRecipients(scope){return read(scope,async c=>{
  await source(c,scope);
  const r=await c.query('SELECT recipient_id::text FROM v106_test.fixture_revocation_recipients WHERE organization_id=$1 AND incident_id=$2 ORDER BY recipient_id',scopeParams(scope));
  return r.rows.map(x=>x.recipient_id);
 });}
 async function listNotices(scope){return read(scope,async c=>{
  await source(c,scope);
  const r=await c.query('SELECT recipient_id::text,epoch,state,event_payload,event_digest FROM v106_test.fixture_revocation_notices WHERE organization_id=$1 AND incident_id=$2 AND export_version=$3 AND manifest_digest=$4 AND revocation_event_digest=$5 ORDER BY recipient_id,epoch',
   [...scopeParams(scope),scope.export_version,scope.manifest_digest,scope.revocation_event_digest]);
  return r.rows.map(x=>{
   let payload;try{payload=JSON.parse(x.event_payload);}catch{fail('NOTICE_HISTORY_TAMPERED');}
   if(sha(payload)!==x.event_digest||payload.recipient_id!==x.recipient_id||
      payload.epoch!==x.epoch)fail('NOTICE_HISTORY_TAMPERED');
   return {recipient_id:x.recipient_id,epoch:x.epoch,state:x.state};
  });
 });}
 async function appendNotice(input){
  const noticeInput=Object.fromEntries(['organization_id','incident_id','export_version','manifest_digest','revocation_event_digest','recipient_id','epoch'].map(k=>[k,input[k]]));
  const notice_id=deriveFixtureRevocationNoticeId(noticeInput);
  for(let attempt=0;attempt<4;attempt++){
   const c=await connect();let started=false;
   try{
    await c.query('BEGIN ISOLATION LEVEL SERIALIZABLE');started=true;
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text,0))',
     ['v121|'+scopeParams(input).join('|')]);
    await source(c,input);
    const found=await c.query('SELECT 1 FROM v106_test.fixture_revocation_recipients WHERE organization_id=$1 AND incident_id=$2 AND recipient_id=$3',
     [...scopeParams(input),input.recipient_id]);
    if(found.rowCount!==1)fail('NOTICE_RECIPIENT_NOT_REGISTERED');
    const payload={notice_id,organization_id:input.organization_id,incident_id:input.incident_id,
     export_version:input.export_version,manifest_digest:input.manifest_digest,
     revocation_event_digest:input.revocation_event_digest,recipient_id:input.recipient_id,epoch:input.epoch};
    const event_digest=sha(payload);
    const existing=await c.query('SELECT event_digest FROM v106_test.fixture_revocation_notices WHERE organization_id=$1 AND incident_id=$2 AND notice_id=$3',
     [...scopeParams(input),notice_id]);
    if(existing.rowCount){
     if(existing.rows[0].event_digest!==event_digest)fail('NOTICE_REPLAY_TAMPERED');
    }else{
     await c.query('INSERT INTO v106_test.fixture_revocation_notices (organization_id,incident_id,notice_id,recipient_id,export_version,epoch,manifest_digest,revocation_event_digest,event_digest,event_payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [...scopeParams(input),notice_id,input.recipient_id,input.export_version,input.epoch,input.manifest_digest,input.revocation_event_digest,event_digest,JSON.stringify(payload)]);
    }
    await c.query('COMMIT');started=false;
    return {notice_id,state:'QUEUED',source_verified:true,durable:true,event_digest};
   }catch(e){
    if(started)await c.query('ROLLBACK').catch(()=>{});
    if(['40001','40P01'].includes(e.code)&&attempt<3)continue;
    throw e;
   }finally{c.release();}
  }
  fail('NOTICE_SQL_RETRY_EXHAUSTED');
 }
 return Object.freeze({sourceHeads,listRecipients,listNotices,appendNotice});
}
