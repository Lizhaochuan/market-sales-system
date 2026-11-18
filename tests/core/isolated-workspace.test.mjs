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
test('isolated planning workspace: real PostgreSQL, HTTP, durable versions and safe defaults',async t=>{
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
  const saved={};
  const quoteBody={title:'课程方案',student_id:sa,opportunity_id:opp,valid_until:new Date(Date.now()+86400000).toISOString(),
   items:[{course_label:'课程A',quantity:3,proposed_unit_cents:19999},{course_label:'课程B',quantity:2,proposed_unit_cents:10001}]};
  await t.test('unauthenticated, forged tenant and unknown routes fail',async()=>{
   assert.equal((await get('summary','')).status,401);
   assert.equal((await get('summary',token(a,otherOrg))).status,403);
   assert.equal((await post('release',{release_eligible:true})).status,404);
   assert.equal((await get('tasks/'+randomUUID()+'/unknown')).status,404);
  });
  await t.test('task create, retry, version update, terminal state and append-only history',async()=>{
   const input={title:'联系学生甲',student_id:sa,opportunity_id:opp,due_at:new Date(Date.now()-1000).toISOString()},key=randomUUID();
   const first=await post('tasks',input,ta,key);assert.equal(first.status,200);saved.task=first.data.item;
   assert.equal((await post('tasks',input,ta,key)).data.item.id,saved.task.id);
   assert.equal((await post('tasks',{...input,title:'改写请求'},ta,key)).status,409);
   const updated=await post('tasks/'+saved.task.id,{...input,title:'再次联系',expected_version:1});
   assert.equal(updated.data.item.version,2);
   assert.equal((await post('tasks/'+saved.task.id,{...input,expected_version:1})).status,409);
   assert.equal((await post('tasks/'+saved.task.id+'/state',{expected_version:2,state:'completed'})).status,200);
   assert.equal((await post('tasks/'+saved.task.id+'/state',{expected_version:3,state:'open'})).status,409);
   const h=await get('tasks/'+saved.task.id+'/history');assert.equal(h.data.items.length,3);
   assert.equal(h.data.items[0].body.title,'联系学生甲');
   await assert.rejects(pool.query('DELETE FROM ms_workspace.history WHERE record_id=$1',[saved.task.id]),/append only/);
  });
  await t.test('ownership, tenant, forged authorization and cross-student associations rejected',async()=>{
   assert.equal((await get('tasks/'+saved.task.id,tb)).status,404);
   assert.equal((await get('tasks/'+saved.task.id,tx)).status,404);
   assert.equal((await get('tasks',tb)).data.items.length,0);
   assert.equal((await post('tasks',{title:'混用学生',student_id:sb,opportunity_id:opp})).status,403);
   assert.equal((await post('tasks',{title:'混用商机',student_id:sa,opportunity_id:oppB})).status,403);
   assert.equal((await post('tasks',{title:'伪造放行',release_eligible:true})).status,422);
   assert.equal((await get('tasks/'+saved.task.id,tm)).status,200);
  });
  await t.test('trial is only a draft; cannot self-confirm scheduling or attendance',async()=>{
   const r=await post('trials',{title:'试听申请',student_id:sa,opportunity_id:opp,requested_slot_at:new Date(Date.now()+86400000).toISOString()});
   assert.equal(r.status,200);assert.equal(r.data.item.state,'draft');assert.equal(r.data.item.body.crm_status,'NOT_CONNECTED');
   assert.equal((await post('trials/'+r.data.item.id+'/state',{expected_version:1,state:'confirmed'})).status,422);
   assert.equal((await pool.query('SELECT count(*)::int n FROM ms.trial_bookings WHERE student_id=$1',[sa])).rows[0].n,0);
  });
  await t.test('integer quote totals, immutable history, stale intent refusal and snapshot binding',async()=>{
   const r=await post('quotes',quoteBody);assert.equal(r.status,200);saved.quote=r.data.item;
   assert.equal(saved.quote.body.total_cents,79999);
   assert.equal(saved.quote.body.price_status,'UNVERIFIED_PROPOSAL');
   const intent={title:'学生甲报名意向',student_id:sa,opportunity_id:opp,quote_id:saved.quote.id,quote_version:1};
   const order=await post('order-intents',intent);assert.equal(order.status,200);saved.intent=order.data.item;
   const revised=await post('quotes/'+saved.quote.id,{...quoteBody,title:'课程方案第二版',expected_version:1,items:[{course_label:'课程A',quantity:1,proposed_unit_cents:50000}]});
   assert.equal(revised.data.item.version,2);
   assert.equal((await post('order-intents',intent)).status,409);
   const stored=await get('order-intents/'+saved.intent.id);
   assert.equal(stored.data.item.body.quote_snapshot.total_cents,79999);
   assert.equal((await post('quotes',{...quoteBody,items:[{course_label:'错误金额',quantity:1,proposed_unit_cents:0.1}]})).status,422);
   assert.equal((await post('quotes',{...quoteBody,items:[{course_label:'溢出',quantity:10000,proposed_unit_cents:Number.MAX_SAFE_INTEGER}]})).status,422);
   assert.equal((await post('order-intents',{...intent,student_id:sb},tm)).status,422);
   assert.equal((await pool.query('SELECT count(*)::int n FROM ms.sales_orders WHERE student_id=$1',[sa])).rows[0].n,0);
   assert.equal((await pool.query('SELECT count(*)::int n FROM ms.sale_events WHERE owner_snapshot_id=$1',[a])).rows[0].n,0);
  });
  await t.test('expense plan does not authorize payment or cost allocation',async()=>{
   const r=await post('expense-plans',{title:'活动预算',amount_cents:10001,purpose:'拟投放渠道，待审批'});
   assert.equal(r.status,200);assert.equal(r.data.item.body.finance_status,'NOT_AUTHORIZED');
   assert.equal((await post('expense-plans',{title:'假支出',amount_cents:10,purpose:'测试',finance_authorized:true})).status,422);
  });
  await t.test('personal reminders deduplicate concurrent scans and never send messages',async()=>{
   const rule=await post('automation-rules',{title:'三日未跟进',action:'create_followup_task',inactive_days:3,due_in_days:1,enabled:true});
   assert.equal(rule.status,200);saved.rule=rule.data.item;
   const results=await Promise.all([post('automation/run',{}),post('automation/run',{})]);
   assert.equal(results.reduce((n,r)=>n+r.data.created,0),1);
   assert.ok(results.every(r=>r.data.delivery==='IN_APP_ONLY'));
   assert.equal((await post('automation/run',{})).data.created,0);
   assert.equal((await post('automation/run',{},tb)).data.created,0);
   assert.equal((await post('automation-rules',{title:'非法动作',action:'send_marketing_sms',inactive_days:1,due_in_days:1,enabled:true})).status,422);
   assert.equal((await post('automation-rules/'+saved.rule.id,{title:'停用',action:'create_followup_task',inactive_days:3,due_in_days:1,enabled:false,expected_version:1})).status,200);
   assert.equal((await post('automation/run',{})).data.created,0);
  });
  await t.test('pipeline updates have expected version and cannot forge won or completed trials',async()=>{
   const input={expected_version:1,stage:'contacted',lifecycle_state:'open',reason:'虚构电话跟进'};
   const results=await Promise.all([post('pipeline/'+opp,input),post('pipeline/'+opp,input)]);
   assert.deepEqual(results.map(x=>x.status).sort(),[200,409]);
   assert.equal((await post('pipeline/'+opp,{...input,expected_version:2,lifecycle_state:'won'})).status,422);
   assert.equal((await post('pipeline/'+opp,{...input,expected_version:2,stage:'trial_completed'})).status,422);
   assert.equal((await post('pipeline/'+oppB,input)).status,403);
   assert.equal((await pool.query('SELECT count(*)::int n FROM ms.opportunity_stage_history WHERE opportunity_id=$1',[opp])).rows[0].n,1);
  });
  await t.test('summary distinguishes forecasts from unknown revenue and real integrations',async()=>{
   const s=(await get('summary')).data;
   assert.equal(s.forecast_cents,'123456');assert.equal(s.confirmed_revenue_cents,null);assert.equal(s.commission_cents,null);
   assert.equal(s.integrations.crm,'NOT_CONNECTED');assert.equal(s.hold_active,true);assert.equal(s.release_eligible,false);
   assert.equal((await get('summary',tb)).data.forecast_cents,'0');
  });
  await t.test('active downstream hold blocks pipeline without changing its history',async()=>{
   const lead=(await pool.query("INSERT INTO ms.leads(organization_id,owner_user_id) VALUES($1,$2) RETURNING id",[org,a])).rows[0].id;
   const association=(await pool.query(`INSERT INTO ms.lead_student_association_requests
    (organization_id,lead_id,student_id,requested_by,evidence_ref,reason_zh,request_key)
    VALUES($1,$2,$3,$4,'虚构证据','虚构原因',$5) RETURNING id`,[org,lead,sa,a,randomUUID()])).rows[0].id;
   await pool.query(`INSERT INTO ms.lead_student_downstream_correction_cases
    (organization_id,association_request_id,lead_id,student_id,requested_by,evidence_ref,reason_zh,request_key,
     opportunity_count,quote_count,order_count,allocation_count,refund_allocation_count,trial_count,sale_event_count,entitlement_count)
    VALUES($1,$2,$3,$4,$5,'虚构证据','虚构原因',$6,1,0,0,0,0,0,0,0)`,[org,association,lead,sa,a,randomUUID()]);
   const r=await post('pipeline/'+opp,{expected_version:2,stage:'negotiation',lifecycle_state:'open',reason:'不得越过隔离'});
   assert.equal(r.status,409);assert.equal(r.code,'HOLD_ACTIVE');
   assert.equal((await pool.query('SELECT version FROM ms.opportunities WHERE id=$1',[opp])).rows[0].version,'2');
  });
  await t.test('records survive an independent database session; writes roll back on history failure',async()=>{
   const observer=new pg.Client({connectionString:process.env.DATABASE_URL});await observer.connect();
   try{assert.equal((await observer.query('SELECT count(*)::int n FROM ms_workspace.history WHERE record_id=$1',[saved.quote.id])).rows[0].n,2);}finally{await observer.end();}
   await pool.query(`CREATE FUNCTION ms_workspace.test_reject_history() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.body->>'title'='故障回滚用例' THEN RAISE EXCEPTION 'Injected test fault'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER test_history_fault BEFORE INSERT ON ms_workspace.history FOR EACH ROW EXECUTE FUNCTION ms_workspace.test_reject_history()`);
   try{
    assert.equal((await post('tasks',{title:'故障回滚用例'})).status,500);
    assert.equal((await pool.query("SELECT count(*)::int n FROM ms_workspace.records WHERE body->>'title'='故障回滚用例'")).rows[0].n,0);
   }finally{await pool.query('DROP TRIGGER test_history_fault ON ms_workspace.history; DROP FUNCTION ms_workspace.test_reject_history()');}
  });
  await t.test('revoked employee cannot read or run rules with an otherwise valid token',async()=>{
   await pool.query("UPDATE ms.staff_users SET status='disabled' WHERE id=$1",[a]);
   assert.equal((await get('summary')).status,403);assert.equal((await post('automation/run',{})).status,403);
  });
 }finally{if(server)await new Promise(resolve=>server.close(resolve));await pool.end();}
});
