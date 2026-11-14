import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';

const A='20000000-0000-4000-8000-000000000011';
const B='20000000-0000-4000-8000-000000000012';
const M='20000000-0000-4000-8000-000000000013';
const M2='20000000-0000-4000-8000-000000000014';
const ORG='20000000-0000-4000-8000-000000000001';
const FOREIGN='20000000-0000-4000-8000-000000000002';

test('V3.2-55 nonowner SQL view only reveals own requests and independently reviewable same-org pending',async()=>{
 process.env.MS_STAGE='isolated-test';
 const admin=new pg.Pool({connectionString:process.env.DATABASE_URL,max:3});
 const readers=new Map([
  [A,new pg.Pool({connectionString:process.env.DATABASE_URL_ASSIGNEE_A,max:2})],
  [B,new pg.Pool({connectionString:process.env.DATABASE_URL_ASSIGNEE_B,max:2})],
  [M,new pg.Pool({connectionString:process.env.DATABASE_URL_ASSIGNEE_MANAGER,max:2})],
  [M2,new pg.Pool({connectionString:process.env.DATABASE_URL_ASSIGNEE_MANAGER_2,max:2})]
 ]);
 const payload=[
  {actor:A,org:ORG,action:'create',status:'pending',name:'虚构渠道A-'+randomUUID()},
  {actor:B,org:ORG,action:'create',status:'pending',name:'虚构渠道B-'+randomUUID()},
  {actor:M,org:ORG,action:'create',status:'pending',name:'虚构主管申请-'+randomUUID()},
  {actor:B,org:ORG,action:'create',status:'rejected',name:'虚构已驳回申请-'+randomUUID()},
  {actor:A,org:FOREIGN,action:'create',status:'pending',name:'虚构跨机构非法测试记录-'+randomUUID()}
 ];
 try{
  for(const row of payload){
   const x=await admin.query(
    "INSERT INTO ms.isolated_channel_change_requests(organization_id,requested_by,"+
    "action,proposed_name,proposed_type,evidence_ref,request_reason,request_key,"+
    "request_fingerprint,status) VALUES($1,$2,$3,$4,'online',$5,$6,$7,$8,$9) RETURNING id",
    [row.org,row.actor,row.action,row.name,
     '不可公开的测试身份证据-'+randomUUID(),
     '仅用于测试专属权限边界',randomUUID().replaceAll('-',''),
     'f'.repeat(64),row.status]);
   row.id=x.rows[0].id;
  }
  for(const [staff,pool] of readers){
   const r=await pool.query(
    'SELECT request_id,action,channel_id,proposed_name,proposed_parent_id,'+
    'proposed_type,status,created_at,requested_by,can_review '+
    'FROM ms.scoped_isolated_channel_change_requests');
   const ids=new Set(r.rows.map(x=>x.request_id));
   assert.ok(!ids.has(payload[4].id),'foreign organization never exposed');
   assert.ok(!r.rows.some(x=>Object.keys(x).some(k=>k.includes('evidence'))),
    'evidence refs deliberately omitted from projection');
   if(staff===A){
    assert.ok(ids.has(payload[0].id),'A sees own pending');
    assert.ok(!ids.has(payload[1].id)&&!ids.has(payload[2].id)&&!ids.has(payload[3].id),
      'A sees no other employee application');
   }
   if(staff===B){
    assert.ok(ids.has(payload[1].id)&&ids.has(payload[3].id),
     'B sees own pending and rejected history');
    assert.ok(!ids.has(payload[0].id)&&!ids.has(payload[2].id),
     'B sees no other employee application');
   }
   if(staff===M){
    assert.ok(ids.has(payload[0].id)&&ids.has(payload[1].id)&&ids.has(payload[2].id),
     'M sees requests needing manager review plus own');
    assert.ok(!ids.has(payload[3].id),'completed other-user request hidden');
    assert.equal(r.rows.find(x=>x.request_id===payload[2].id).can_review,false,
     'manager cannot review self');
    assert.equal(r.rows.find(x=>x.request_id===payload[0].id).can_review,true);
   }
   if(staff===M2){
    assert.ok(ids.has(payload[2].id),'second manager can independently review first manager');
    assert.equal(r.rows.find(x=>x.request_id===payload[2].id).can_review,true);
   }
   await assert.rejects(pool.query('SELECT * FROM ms.isolated_channel_change_requests'),
    e=>e.code==='42501');
   await assert.rejects(pool.query('SELECT * FROM ms.marketing_channels'),e=>e.code==='42501');
   await assert.rejects(pool.query('SELECT * FROM ms.sales_orders'),e=>e.code==='42501');
  }
 }finally{
  await admin.query(
    'DELETE FROM ms.isolated_channel_change_requests WHERE id=ANY($1::uuid[])',
    [payload.map(x=>x.id).filter(Boolean)]);
  await Promise.allSettled([admin,...readers.values()].map(p=>p.end()));
 }
});