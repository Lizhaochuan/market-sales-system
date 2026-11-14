import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {randomUUID} from 'node:crypto';

const A='20000000-0000-4000-8000-000000000011';
const B='20000000-0000-4000-8000-000000000012';
const M='20000000-0000-4000-8000-000000000013';
const M2='20000000-0000-4000-8000-000000000014';
const ORG='20000000-0000-4000-8000-000000000001';
const FOREIGN='20000000-0000-4000-8000-000000000002';

test('V3.2-56 channel history view isolates owner, independent reviewer and pending manager without exposing raw evidence',async()=>{
 process.env.MS_STAGE='isolated-test';
 const admin=new pg.Pool({connectionString:process.env.DATABASE_URL,max:3});
 const readers=new Map([
  [A,new pg.Pool({connectionString:process.env.DATABASE_URL_ASSIGNEE_A,max:2})],
  [B,new pg.Pool({connectionString:process.env.DATABASE_URL_ASSIGNEE_B,max:2})],
  [M,new pg.Pool({connectionString:process.env.DATABASE_URL_ASSIGNEE_MANAGER,max:2})],
  [M2,new pg.Pool({connectionString:process.env.DATABASE_URL_ASSIGNEE_MANAGER_2,max:2})]
 ]);
 const rows=[
  {org:ORG,requester:A,reviewer:null,status:'pending',name:'本机构员工A待审核'},
  {org:ORG,requester:B,reviewer:M,status:'rejected',name:'本机构主管M已驳回'},
  {org:ORG,requester:M,reviewer:null,status:'pending',name:'本机构主管M自己的申请'},
  {org:ORG,requester:B,reviewer:M2,status:'applied',name:'本机构主管M2已批准'},
  {org:FOREIGN,requester:A,reviewer:null,status:'pending',name:'伪造跨机构申请不可见'}
 ];
 try{
  for(const q of rows){
   const i=await admin.query(
    'INSERT INTO ms.isolated_channel_change_requests(organization_id,requested_by,action,'+
    'proposed_name,proposed_type,evidence_ref,request_reason,request_key,'+
    'request_fingerprint,status,reviewed_by,review_decision) '+
    'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id',
    [q.org,q.requester,'create',q.name,'web',
     '仅管理员可见的秘密审计材料-'+randomUUID(),
     '不可直接从工作台读取的原始申请理由',randomUUID().replaceAll('-',''),
     'a'.repeat(64),q.status,q.reviewer,
     q.reviewer?(q.status==='rejected'?'rejected':'approved'):null]);
   q.id=i.rows[0].id;
   const secret='AUDIT_PRIVATE_MARKER_'+randomUUID();
   q.secret=secret;
   for(const [event,actor] of [
    ['CHANNEL_CHANGE_REQUESTED',q.requester],
    ...(q.reviewer?[[q.status==='applied'?'CHANNEL_CHANGE_APPLIED':'CHANNEL_CHANGE_REJECTED',q.reviewer]]:[])
   ]){
    const a=await admin.query(
     'INSERT INTO ms.audit_events(organization_id,actor_user_id,target_type,target_id,event_name,'+
     'before_business_json,after_business_json,reason_zh) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
     [q.org,actor,'marketing_channel_request',q.id,event,
      {private_detail:secret},{secret},
      '不可对销售工作台公开的审计原文：'+secret]);
    (q.auditIds??=[]).push(a.rows[0].id);
   }
  }
  const get=async staff=>{
   const p=readers.get(staff);
   const r=await p.query('SELECT audit_id,request_id,event_name,actor_user_id,happened_at,'+
    'action,status,requested_by FROM ms.scoped_isolated_channel_audit_history');
   assert.ok(r.rows.every(x=>Object.keys(x).every(k=>[
    'audit_id','request_id','event_name','actor_user_id',
    'happened_at','action','status','requested_by'].includes(k))));
   for(const q of rows)
    assert.ok(!JSON.stringify(r.rows).includes(q.secret),'raw evidence must never appear');
   return r.rows.filter(x=>rows.some(q=>q.id===x.request_id));
  };
  const a=await get(A);
  assert.equal(a.filter(x=>x.request_id===rows[0].id).length,1);
  assert.ok(!a.some(x=>x.request_id===rows[1].id||
   x.request_id===rows[2].id||x.request_id===rows[3].id||x.request_id===rows[4].id));
  const b=await get(B);
  assert.equal(b.filter(x=>x.request_id===rows[1].id).length,2);
  assert.equal(b.filter(x=>x.request_id===rows[3].id).length,2);
  assert.ok(!b.some(x=>x.request_id===rows[0].id||x.request_id===rows[2].id));
  const m=await get(M);
  assert.equal(m.filter(x=>x.request_id===rows[0].id).length,1,
   'manager sees only pending reviewable others');
  assert.equal(m.filter(x=>x.request_id===rows[1].id).length,2,
   'manager sees past independently reviewed history');
  assert.equal(m.filter(x=>x.request_id===rows[2].id).length,1,
   'manager sees own submission');
  assert.ok(!m.some(x=>x.request_id===rows[3].id||x.request_id===rows[4].id),
   'manager cannot browse other managers completed approvals or foreign institution');
  const m2=await get(M2);
  assert.equal(m2.filter(x=>x.request_id===rows[3].id).length,2);
  assert.equal(m2.filter(x=>x.request_id===rows[2].id).length,1);
  assert.ok(!m2.some(x=>x.request_id===rows[1].id||x.request_id===rows[4].id));
  for(const pool of readers.values()){
   await assert.rejects(pool.query('SELECT * FROM ms.audit_events'),e=>e.code==='42501');
   await assert.rejects(pool.query("UPDATE ms.audit_events SET event_name='CHANGED' WHERE FALSE"),
    e=>e.code==='42501');
   await assert.rejects(pool.query('DELETE FROM ms.audit_events WHERE FALSE'),e=>e.code==='42501');
   await assert.rejects(pool.query('SELECT * FROM ms.isolated_channel_change_requests'),e=>e.code==='42501');
   await assert.rejects(pool.query('SELECT * FROM ms.payment_allocations'),e=>e.code==='42501');
  }
 }finally{
  const ids=rows.map(x=>x.id).filter(Boolean);
  if(ids.length){
   await admin.query('DELETE FROM ms.audit_events WHERE target_type=$1 AND target_id=ANY($2::uuid[])',
    ['marketing_channel_request',ids]);
   await admin.query('DELETE FROM ms.isolated_channel_change_requests WHERE id=ANY($1::uuid[])',[ids]);
  }
  await Promise.allSettled([admin,...readers.values()].map(p=>p.end()));
 }
});
