import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import pg from 'pg';
import {createApp} from '../../src/app.mjs';
const secret='fictional-workspace-only-secret-at-least-32-characters';
const issuer='market-sales-test-issuer';
const token=(sub,org)=>{
 const h=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
 const iat=Math.floor(Date.now()/1000);
 const p=Buffer.from(JSON.stringify({sub,org_id:org,iss:issuer,aud:'market-sales-isolated',iat,exp:iat+600})).toString('base64url');
 return h+'.'+p+'.'+createHmac('sha256',secret).update(h+'.'+p).digest('base64url');
};
test('lead desk: one lead flow, ownership, version binding and safe financial boundary',async t=>{
 process.env.MS_STAGE='isolated-test';
 assert.ok(process.env.DATABASE_URL);
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
 const org=randomUUID(),otherOrg=randomUUID(),a=randomUUID(),b=randomUUID(),m=randomUUID(),outsider=randomUUID();
 let server;
 try{
  await pool.query('INSERT INTO ms.organizations(id,name) VALUES($1,\'工作台测试机构\'),($2,\'另一机构\')',[org,otherOrg]);
  await pool.query(`INSERT INTO ms.staff_users(id,organization_id,display_name) VALUES
   ($1,$2,'顾问A'),($3,$2,'顾问B'),($4,$2,'主管'),($5,$6,'外机构员工')`,[a,org,b,m,outsider,otherOrg]);
  const role=(await pool.query("INSERT INTO ms.role_templates(organization_id,role_code,label_zh) VALUES($1,'sales_manager','主管') RETURNING id",[org])).rows[0].id;
  await pool.query('INSERT INTO ms.user_role_grants(user_id,role_id,granted_by) VALUES($1,$2,$1)',[m,role]);
  const sa=(await pool.query("INSERT INTO ms.students(organization_id,display_name,owner_user_id) VALUES($1,'学生甲',$2) RETURNING id",[org,a])).rows[0].id;
  const sb=(await pool.query("INSERT INTO ms.students(organization_id,display_name,owner_user_id) VALUES($1,'学生乙',$2) RETURNING id",[org,b])).rows[0].id;
  const opp=(await pool.query("INSERT INTO ms.opportunities(student_id,owner_user_id,predicted_amount_cents,updated_at) VALUES($1,$2,123456,now()-interval '10 days') RETURNING id",[sa,a])).rows[0].id;
  const oppB=(await pool.query("INSERT INTO ms.opportunities(student_id,owner_user_id) VALUES($1,$2) RETURNING id",[sb,b])).rows[0].id;
  const ta=token(a,org),tb=token(b,org),tm=token(m,org),tx=token(outsider,otherOrg);
  server=createApp(pool,{secret,workspaceEnabled:true});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const root='http://127.0.0.1:'+server.address().port+'/api/v1/isolated-workspace/';
  const request=async(method,path,body,auth=ta,key=randomUUID())=>{
   const res=await fetch(root+path,{method,headers:{Authorization:'Bearer '+auth,
    'Content-Type':'application/json','Idempotency-Key':key},...(body===undefined?{}:{body:JSON.stringify(body)})});
   return {status:res.status,...await res.json()};
  };
  const post=(path,body,auth,key)=>request('POST',path,body,auth,key);
  const get=(path,auth)=>request('GET',path,undefined,auth);
  let leadId,quote;
  await t.test('one intake creates lead with optional student; idempotent retry',async()=>{
   const b={contact_name:'测试家长',student_name:'测试学生',origin_group:'market',source:'市场活动',notes:'家长原话'},key=randomUUID();
   const r=await post('leads',b,ta,key);assert.equal(r.status,200,JSON.stringify(r));leadId=r.data.lead_id;
   assert.equal((await post('leads',b,ta,key)).data.lead_id,leadId);
   const list=await get('leads');assert.equal(list.data.items.length,1);assert.equal(list.data.items[0].origin.origin_group,'market');
   assert.equal((await get('leads/'+leadId)).data.students.length,1);
   assert.equal((await pool.query('SELECT count(*)::int n FROM ms.opportunities WHERE originating_lead_id=$1',[leadId])).rows[0].n,0);
  });
  await t.test('B and outside tenant cannot read or operate A lead',async()=>{
   assert.equal((await get('leads',tb)).data.items.length,0);
   assert.equal((await get('leads/'+leadId,tb)).status,403);
   assert.equal((await post('leads/'+leadId+'/followup',{result:'已联系'},tb)).status,403);
   assert.equal((await get('leads/'+leadId,tx)).status,404);
   assert.equal((await get('leads',tm)).data.items.length,1);
  });
  await t.test('source correction preserves attribution and follow-up is a select plus optional note',async()=>{
   assert.equal((await post('leads/'+leadId+'/source',{source:'转介绍'})).status,200);
   const l=(await get('leads')).data.items[0];assert.equal(l.source.source,'转介绍');assert.equal(l.origin.source,'市场活动');assert.equal(l.original_notes,'家长原话');
   assert.equal((await post('leads/'+leadId+'/followup',{result:'已联系',next_at:new Date(Date.now()+86400000).toISOString()})).status,200);
   assert.equal((await post('leads/'+leadId+'/followup',{result:'已成交'})).status,422);
  });
  await t.test('trial creates internal context automatically but no real booking',async()=>{
   const r=await post('leads/'+leadId+'/trial',{requested_slot_at:new Date(Date.now()+86400000).toISOString()});assert.equal(r.status,200,JSON.stringify(r));
   assert.equal(r.data.item.body.crm_status,'NOT_CONNECTED');
   assert.equal((await pool.query('SELECT count(*)::int n FROM ms.opportunities WHERE originating_lead_id=$1',[leadId])).rows[0].n,1);
  });
  await t.test('course amount calculates from lessons, edits preserve versions, stale deal refused',async()=>{
   const items=[{course_label:'数学',quantity:10,proposed_unit_cents:15000},{course_label:'英语',quantity:20,proposed_unit_cents:20000}];
   let r=await post('leads/'+leadId+'/quote',{items});assert.equal(r.status,200,JSON.stringify(r));quote=r.data.item;assert.equal(quote.body.total_cents,550000);
   r=await post('leads/'+leadId+'/revise-quote',{quote_id:quote.id,expected_version:1,items:[{course_label:'英语',quantity:2,proposed_unit_cents:19999}]});assert.equal(r.status,200,JSON.stringify(r));quote=r.data.item;assert.equal(quote.body.total_cents,39998);
   assert.equal((await post('leads/'+leadId+'/deal',{quote_id:quote.id,quote_version:1})).status,409);
   assert.equal((await get('quotes/'+quote.id+'/history')).data.items.length,2);
  });
  await t.test('confirm enrollment snapshots latest amount, repeat deduplicates and never recognizes income',async()=>{
   const b={quote_id:quote.id,quote_version:2};const r=await post('leads/'+leadId+'/deal',b);assert.equal(r.status,200,JSON.stringify(r));
   assert.equal(r.data.item.body.amount_cents,39998);assert.equal(r.data.payment_confirmation,'PENDING');
   assert.equal((await post('leads/'+leadId+'/deal',b)).data.item.id,r.data.item.id);
   assert.equal((await pool.query('SELECT count(*)::int n FROM ms.sales_orders WHERE opportunity_id=$1',[quote.opportunity_id])).rows[0].n,0);
   assert.equal((await get('leads')).data.items[0].won_count,0);
   assert.equal((await post('leads/'+leadId+'/won',{})).status,404);
  });
  await t.test('manager intake assigns A; manager-created courses remain visible to A',async()=>{
   const r=await post('leads',{contact_name:'市场新客',student_name:'新生',origin_group:'market',source:'网络咨询',owner_user_id:a},tm);assert.equal(r.status,200,JSON.stringify(r));
   const q=await post('leads/'+r.data.lead_id+'/quote',{items:[{course_label:'数学',quantity:1,proposed_unit_cents:100}]},tm);assert.equal(q.status,200,JSON.stringify(q));
   assert.equal((await get('leads/'+r.data.lead_id)).data.records.length,1);
   assert.equal((await post('leads',{contact_name:'越权',origin_group:'sales',source:'到店',owner_user_id:b})).status,403);
  });
  await t.test('invalid trial rolls back internally created student and opportunity',async()=>{
   const r=await post('leads',{contact_name:'未识别学生家长',origin_group:'sales',source:'到店'});const id=r.data.lead_id;
   assert.equal((await post('leads/'+id+'/trial',{student_name:'不应残留的学生',requested_slot_at:'bad-date'})).status,422);
   assert.equal((await get('leads/'+id)).data.students.length,0);
   assert.equal((await pool.query('SELECT count(*)::int n FROM ms.opportunities WHERE originating_lead_id=$1',[id])).rows[0].n,0);
   assert.equal((await post('leads/'+id+'/deal',{quote_id:quote.id,quote_version:2})).status,404);
  });
  await t.test('lost lead retains history and refuses new activity',async()=>{
   assert.equal((await post('leads/'+leadId+'/lost',{reason:'时间不合适'})).status,200);
   assert.equal((await get('leads')).data.items.find(l=>l.id===leadId).lost.reason,'时间不合适');
   assert.equal((await post('leads/'+leadId+'/followup',{result:'已联系'})).status,409);
   assert.ok((await get('leads/'+leadId)).data.records.length>=3);
  });
 }finally{if(server)await new Promise(resolve=>server.close(resolve));await pool.end();}
});
