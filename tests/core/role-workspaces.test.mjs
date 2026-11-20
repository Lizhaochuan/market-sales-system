import test from 'node:test';import assert from 'node:assert/strict';import pg from 'pg';import {randomUUID} from 'node:crypto';import {readFile} from 'node:fs/promises';import {createApp} from '../../src/app.mjs';import {demoToken} from '../../src/dev-login.mjs';
test('Role workspaces: phone handoff, department privacy and persistent dated tasks',async t=>{
 process.env.MS_STAGE='isolated-test';const pool=new pg.Pool({connectionString:process.env.DATABASE_URL}),org=randomUUID(),A=randomUUID(),B=randomUUID(),M=randomUUID(),K=randomUUID(),K2=randomUUID(),KM=randomUUID(),G=randomUUID(),F=randomUUID();const secret='fictional-role-workspaces-test-key-2026';let app;
 try{
 for(const [v,f]of[[34,'039_v34_sales_loop.sql'],[35,'040_role_workspaces.sql']]){const exists=(await pool.query("SELECT to_regclass('ms_workspace.schema_versions') t")).rows[0].t;if(!exists||!(await pool.query('SELECT 1 FROM ms_workspace.schema_versions WHERE version=$1',[v])).rowCount)await pool.query(await readFile(new URL('../../db/workspace-migrations/'+f,import.meta.url),'utf8'));}
 await pool.query("INSERT INTO ms.organizations(id,name) VALUES($1,'虚构部门验收机构')",[org]);
 for(const [id,name]of[[A,'销售A'],[B,'销售B'],[M,'销售主管'],[K,'市场A'],[K2,'市场B'],[KM,'市场主管'],[G,'总管理者'],[F,'收款核实员']])await pool.query('INSERT INTO ms.staff_users(id,organization_id,display_name) VALUES($1,$2,$3)',[id,org,name]);
 for(const [role,users]of[['sales_staff',[A,B]],['sales_manager',[M]],['marketing_staff',[K,K2]],['marketing_manager',[KM]],['super_admin',[G]],['finance_verifier',[F]]]){const r=(await pool.query('INSERT INTO ms.role_templates(organization_id,role_code,label_zh) VALUES($1,$2,$2) RETURNING id',[org,role])).rows[0];for(const u of users)await pool.query('INSERT INTO ms.user_role_grants(user_id,role_id,granted_by) VALUES($1,$2,$3)',[u,r.id,G]);}
 app=createApp(pool,{secret,workspaceEnabled:true,v34Enabled:true,roleWorkspaces:true});await new Promise(r=>app.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.address().port,root='/api/v1/isolated-workspace/workflow';
 const req=async(path,body,user=A,key=randomUUID())=>{const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+demoToken({id:user,organization_id:org},secret,'market-sales-test-issuer'),'content-type':'application/json','idempotency-key':key},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,...await r.json()};};
 const w=(p,b,u,k)=>req(root+p,b,u,k),good=r=>{assert.equal(r.status,200,JSON.stringify(r));return r.data;};const next=(days=0)=>({action:'call',method:'phone',title:'联系家长了解需求',due_at:new Date(Date.now()+days*86400000).toISOString()});let lead;
 await t.test('market capture preserves source and exposes neither sales nor other market owners',async()=>{lead=good(await w('/market',{phone:'138 0000 0035',contact_name:'虚构家长',student_name:'虚构学生',source:'市场活动',notes:'市场内部预算SECRET'},K)).lead_id;assert.equal(good(await w('/market',undefined,K)).items.length,1);assert.equal(good(await w('/market',undefined,K2)).items.length,0);assert.equal(good(await w('/market',undefined,KM)).items.length,1);assert.equal((await w('',undefined,K)).status,403);assert.equal((await w('/'+lead,undefined,KM)).status,403);assert.equal((await w('/market',undefined,M)).status,403);assert.equal((await req('/api/v1/leads',undefined,K)).status,403);assert.equal((await req('/api/v1/contact-events',undefined,M)).status,403);assert.equal(good(await w('',undefined,M)).items.length,0);assert.equal(good(await w('/options',undefined,K)).catalog.length,0);const legacy=createApp(pool,{secret});await new Promise(r=>legacy.listen(0,'127.0.0.1',r));try{const r=await fetch('http://127.0.0.1:'+legacy.address().port+'/api/v1/leads',{headers:{authorization:'Bearer '+demoToken({id:K,organization_id:org},secret,'market-sales-test-issuer')}});assert.equal(r.status,403);}finally{await new Promise(r=>legacy.close(r));}});
 await t.test('normalized phone match returns minimum handoff data, no private market notes',async()=>{const r=good(await w('/lookup',{phone:'+86 13800000035'}));assert.equal(r.items[0].lead_id,lead);assert.equal(r.items[0].status,'market_available');assert.equal(JSON.stringify(r).includes('SECRET'),false);assert.equal((await w('/lookup',{phone:'13800000035'},K)).status,403);assert.equal((await w('/lookup',{phone:'bad'})).status,422);});
 await t.test('claim requires dated first action; repeated/concurrent claims do not duplicate leads or tasks',async()=>{assert.equal((await w('/'+lead+'/claim',{phone:'13800000035'})).status,422);assert.equal(good(await w('/market',undefined,K)).items[0].handoff_state,'market');const key=randomUUID(),b={phone:'13800000035',next:next()};good(await w('/'+lead+'/claim',b,A,key));good(await w('/'+lead+'/claim',b,A,key));assert.equal((await w('/'+lead+'/claim',b,B)).status,409);const d=good(await w('/'+lead));assert.equal(d.records.length,1);assert.equal(d.workflow.contact_info,'13800000035');assert.ok(d.events.some(e=>e.event_name==='V34_MARKET_HANDOFF_ACCEPTED'));assert.equal(good(await w('/market',undefined,K)).items[0].handoff_state,'sales');assert.equal((await w('/'+lead,undefined,K)).status,403);});
 await t.test('metrics returns the same contract for a salesperson with no visible leads',async()=>{
  const populated=good(await w('/metrics',undefined,A));
  const empty=good(await w('/metrics',undefined,B));
  assert.equal(populated.counts.leads,1);
  assert.ok(populated.reminders.some(r=>r.lead_id===lead));
  assert.deepEqual(Object.keys(empty).sort(),Object.keys(populated).sort());
  assert.deepEqual(Object.keys(empty.counts).sort(),Object.keys(populated.counts).sort());
  for(const [name,value] of Object.entries(empty.counts))assert.equal(value,0,name);
  assert.equal(empty.timezone,'Asia/Shanghai');
  assert.deepEqual(empty.activity_counts,{communications:0,appointments:0,completed_activities:0});
  assert.deepEqual(empty.lost_reasons,{});
  for(const field of ['by_owner','pending_approvals','reminders','failures'])assert.deepEqual(empty[field],[],field);
  assert.equal(empty.hold_active,true);
  assert.equal(empty.release_eligible,false);
 });
 await t.test('finance-only staff can open the verification queue but cannot read sales metrics',async()=>{
  assert.equal((await w('/metrics',undefined,F)).status,403);
  assert.equal(good(await w('/options',undefined,F)).can_verify,true);
  assert.equal(good(await w('/finance',undefined,F)).can_verify,true);
  assert.equal((await w('/'+lead,undefined,F)).status,403);
  for(const manager of [M,G]){
   assert.equal(good(await w('/metrics',undefined,manager)).counts.leads,1);
   assert.ok(Array.isArray(good(await w('/finance',undefined,manager)).items));
  }
 });
 await t.test('existing sales assignment discloses no lead/student details to another salesperson',async()=>{const r=good(await w('/lookup',{phone:'13800000035'},B)).items[0];assert.equal(r.status,'assigned');assert.equal(r.lead_id,undefined);assert.equal(r.contact_name,undefined);assert.equal(r.students,undefined);assert.equal((await w('/'+lead,undefined,B)).status,403);assert.equal(good(await w('/lookup',{phone:'13800000035'},M)).items[0].lead_id,lead);});
 await t.test('new phone creates one sales lead; duplicate intake and market/finance assignment rejected',async()=>{const b={contact_name:'直接咨询',student_name:'虚构另一学生',contact_info:'13900000035',origin_group:'sales',source:'到店',next:next(1)};const x=good(await w('',b));assert.ok(x.lead_id);assert.equal((await w('',b)).status,409);assert.equal((await w('',{...b,contact_info:'13900000036',origin_group:'market'})).status,403);assert.equal((await w('',{...b,contact_info:'13900000036',owner_user_id:K},M)).status,422);assert.equal((await w('',{...b,contact_info:'13900000036'},K)).status,403);await pool.query('DELETE FROM ms_workspace.lead_directory WHERE lead_id=$1',[x.lead_id]);good(await w('/'+x.lead_id+'/contact',{expected_version:x.workflow.version,contact_info:'13900000039'}));assert.equal(good(await w('/lookup',{phone:'13900000039'})).items[0].lead_id,x.lead_id);});
 await t.test('saved followup creates the dated work item and cannot leave an empty chain',async()=>{const d=good(await w('/'+lead));good(await w('/'+lead+'/followup',{expected_version:d.workflow.version,method:'phone',result:'communicated',notes:'家长已沟通',next:next(2)}));const m=good(await w('/metrics'));assert.ok(m.reminders.some(r=>r.lead_id===lead&&r.title==='联系家长了解需求'));assert.equal(m.reminders.filter(r=>r.lead_id===lead).length,1);assert.equal((await w('/metrics',undefined,KM)).status,403);await pool.query('SELECT ms_workspace.assert_active_chain($1)',[lead]);});
 await t.test('concurrent phone intake and handoff have exactly one winner',async()=>{const b={contact_name:'并发客户',contact_info:'13900000037',origin_group:'sales',source:'到店',next:next()};const creates=await Promise.all([w('',b,A),w('',b,B)]);assert.deepEqual(creates.map(r=>r.status).sort(),[200,409]);const x=good(await w('/market',{phone:'13900000038',contact_name:'并发交接',source:'市场活动'},K2)).lead_id;const claims=await Promise.all([w('/'+x+'/claim',{phone:'13900000038',next:next()},A),w('/'+x+'/claim',{phone:'13900000038',next:next()},B)]);assert.deepEqual(claims.map(r=>r.status).sort(),[200,409]);assert.equal((await pool.query('SELECT count(*)::int n FROM ms_workspace.records WHERE lead_id=$1',[x])).rows[0].n,1);});
 await t.test('tenant lookup cannot discover another organization phone',async()=>{const org2=randomUUID(),u=randomUUID(),role=randomUUID();await pool.query("INSERT INTO ms.organizations(id,name) VALUES($1,'虚构另一个机构')",[org2]);await pool.query("INSERT INTO ms.staff_users(id,organization_id,display_name) VALUES($1,$2,'另机构销售')",[u,org2]);await pool.query("INSERT INTO ms.role_templates(id,organization_id,role_code,label_zh) VALUES($1,$2,'sales_staff','销售')",[role,org2]);await pool.query('INSERT INTO ms.user_role_grants(user_id,role_id,granted_by) VALUES($1,$2,$1)',[u,role]);const r=await fetch(base+root+'/lookup',{method:'POST',headers:{authorization:'Bearer '+demoToken({id:u,organization_id:org2},secret,'market-sales-test-issuer'),'content-type':'application/json','idempotency-key':randomUUID()},body:JSON.stringify({phone:'13800000035'})});assert.equal(r.status,200);assert.equal((await r.json()).data.items.length,0);});
 await t.test('general manager sees both departments; revocation immediately removes market authority',async()=>{assert.equal(good(await w('/market',undefined,G)).items.length,2);assert.equal(good(await w('',undefined,G)).items.length,4);assert.equal(good(await req('/api/v1/me',undefined,KM)).workspace_access.sales,false);await pool.query('UPDATE ms.user_role_grants SET revoked_at=now() WHERE user_id=$1',[K]);assert.equal((await w('/market',undefined,K)).status,403);assert.equal((await w('/lookup',{phone:'13800000035'},K)).status,403);});
 let flow;
 await t.test('actual initial meeting and next contact are saved together; invalid future facts roll back',async()=>{const b={contact_name:'先面谈再录入',student_name:'连续跟进学生',contact_info:'13900000040',origin_group:'sales',source:'到店',initial_communication:{method:'campus',at:new Date(Date.now()-60000).toISOString(),place:'接待室',notes:'需求已聊清，需联系确定试听时间',stage:'needs_confirmed'},next:{...next(1),action:'confirm_trial',title:'联系家长确定试听时间'}};const key=randomUUID();flow=good(await w('',b,A,key)).lead_id;good(await w('',b,A,key));const d=good(await w('/'+flow));assert.equal(d.workflow.stage,'needs_confirmed');assert.equal(d.records.filter(r=>r.kind==='tasks').length,1);assert.equal(d.records.filter(r=>r.kind==='appointments'&&r.state==='completed').length,1);assert.equal(d.events.filter(e=>e.event_name==='V34_COMMUNICATION').length,1);assert.equal((await w('',{...b,contact_info:'13900000041',initial_communication:{...b.initial_communication,at:new Date(Date.now()+86400000).toISOString()}})).status,422);assert.equal(good(await w('/lookup',{phone:'13900000041'})).items.length,0);});
 await t.test('confirmed trial is the followup successor without duplicate contact tasks',async()=>{let d=good(await w('/'+flow));const old=d.workflow.primary_activity_id;const b={expected_version:d.workflow.version,method:'phone',result:'communicated',purpose:'trial',notes:'家长已确认试听时间',next:{appointment:{type:'trial',due_at:new Date(Date.now()+86400000).toISOString(),place:'试听室',course:'数学'}}};assert.equal((await w('/'+flow+'/followup',{...b,next:{appointment:{...b.next.appointment,due_at:'bad'}}})).status,422);assert.equal(good(await w('/'+flow)).workflow.primary_activity_id,old);for(const failed of [{...b,result:'failed',failure_reason:'无人接听'},{...b,method:'wechat_text',result:'waiting'}])assert.equal((await w('/'+flow+'/followup',failed)).status,422);assert.equal(good(await w('/'+flow)).workflow.primary_activity_id,old);good(await w('/'+flow+'/followup',b));d=good(await w('/'+flow));assert.equal(d.workflow.stage,'trial_booked');assert.equal(d.records.find(r=>r.id===old).state,'completed');assert.equal(d.records.filter(r=>r.kind==='tasks'&&r.state==='open').length,0);const a=d.records.find(r=>r.id===d.workflow.primary_activity_id);assert.equal(a.body.type,'trial');assert.equal(a.state,'confirmed');good(await w('/'+flow+'/activity',{expected_version:d.workflow.version,record_id:a.id,transition:'completed',feedback:'家长确认实际已试听',next:{...next(2),action:'trial_feedback',title:'回访试听感受'}}));d=good(await w('/'+flow));assert.equal(d.workflow.stage,'trial_completed');assert.equal(d.records.find(r=>r.id===d.workflow.primary_activity_id).body.action,'trial_feedback');});
 await t.test('already agreed trial can be captured on intake and market handoff without a fake confirmation task',async()=>{const a={type:'trial',due_at:new Date(Date.now()+2*86400000).toISOString(),place:'试听室',course:'英语'};const id=good(await w('',{contact_name:'当场约好',student_name:'直接预约学生',contact_info:'13900000042',origin_group:'sales',source:'到店',initial_communication:{method:'phone',at:new Date().toISOString(),stage:'courses_introduced'},next:{appointment:a}})).lead_id;let d=good(await w('/'+id));assert.equal(d.workflow.stage,'trial_booked');assert.equal(d.records.filter(r=>r.kind==='tasks').length,0);const mk=good(await w('/market',{phone:'13900000043',contact_name:'市场面谈已完成',student_name:'市场交接直接试听',source:'市场活动'},K2)).lead_id;good(await w('/'+mk+'/claim',{phone:'13900000043',initial_communication:{method:'campus',at:new Date().toISOString(),place:'接待室'},next:{appointment:a}}));d=good(await w('/'+mk));assert.equal(d.records.filter(r=>r.kind==='tasks').length,0);assert.equal(d.workflow.stage,'trial_booked');await pool.query('SELECT ms_workspace.assert_active_chain($1)',[mk]);});
  await t.test('direct appointment or new arrangement closes superseded contact task without orphan reminders',async()=>{const id=good(await w('',{contact_name:'直接改约家长',student_name:'直接改约学生',contact_info:'13900000044',origin_group:'sales',source:'主动咨询',next:next(-1)})).lead_id;let d=good(await w('/'+id));const t1=d.workflow.primary_activity_id;good(await w('/'+id+'/arrange',{expected_version:d.workflow.version,next:{...next(1),title:'调整后的联系待办'}}));d=good(await w('/'+id));const t2=d.workflow.primary_activity_id;assert.equal(d.records.find(r=>r.id===t1).state,'cancelled');good(await w('/'+id+'/appointment',{expected_version:d.workflow.version,appointment:{type:'trial',due_at:new Date(Date.now()+2*86400000).toISOString(),place:'校区接待室',course:'数学',state:'confirmed'}}));d=good(await w('/'+id));assert.equal(d.records.find(r=>r.id===t2).state,'completed');assert.equal(good(await w('/metrics')).reminders.filter(r=>r.lead_id===id).length,1);await pool.query('SELECT ms_workspace.assert_active_chain($1)',[id]);});
  await t.test('failed initial call records attempt and blocks unconfirmed booking; intake booking links student before communication audit',async()=>{
   const ap={type:'trial',due_at:new Date(Date.now()+2*86400000).toISOString(),place:'试听室',course:'数学'};
   assert.equal((await w('',{contact_name:'首呼未接误约',student_name:'误约学生',contact_info:'13900000045',origin_group:'sales',source:'网络咨询',initial_communication:{method:'phone',result:'failed',failure_reason:'无人接听',at:new Date().toISOString()},next:{appointment:ap}})).status,422);
   const f1=good(await w('',{contact_name:'首呼未接家长',student_name:'首呼未接学生',contact_info:'13900000045',origin_group:'sales',source:'网络咨询',initial_communication:{method:'phone',result:'failed',failure_reason:'无人接听',at:new Date().toISOString()},next:next(1)})).lead_id;
   const d1=good(await w('/'+f1));assert.equal(d1.workflow.stage,'needs_discovery');assert.equal(d1.workflow.contact_info,'13900000045');assert.equal(d1.events.find(e=>e.event_name==='V34_COMMUNICATION').after_business_json.result,'failed');
   const listRes=good(await w(''));const listItem=listRes.items.find(i=>i.id===f1);assert.equal(listItem.contact_info,undefined);assert.equal(listItem.contact_info_masked,'139****0045');assert.equal(JSON.stringify(listRes).includes('13900000045'),false);
   const qRes=good(await w('?q=13900000045'));assert.equal(qRes.items.length,1);assert.equal(qRes.items[0].id,f1);assert.equal(qRes.items[0].contact_info,undefined);assert.equal(qRes.items[0].contact_info_masked,'139****0045');assert.equal(JSON.stringify(qRes).includes('13900000045'),false);
   assert.equal(good(await w('?q=13900000045',undefined,B)).items.length,0);
   const f2=good(await w('',{contact_name:'无初填学生直接预约',contact_info:'13900000046',origin_group:'sales',source:'到店',initial_communication:{method:'phone',at:new Date().toISOString(),stage:'enrollment_intent'},next:{appointment:{...ap,student_name:'预约创建学生'}}})).lead_id;
   const d2=good(await w('/'+f2));assert.equal(d2.workflow.stage,'enrollment_intent');assert.equal(d2.events.find(e=>e.event_name==='V34_COMMUNICATION').after_business_json.student_ids.length,1);
   const mk=good(await w('/market',{phone:'13900000047',contact_name:'市场首呼未接',student_name:'交接首呼学生',source:'市场活动'},K2)).lead_id;
   assert.equal((await w('/'+mk+'/claim',{phone:'13900000047',initial_communication:{method:'phone',result:'failed',failure_reason:'无人接听',at:new Date().toISOString()},next:{appointment:ap}})).status,422);
   good(await w('/'+mk+'/claim',{phone:'13900000047',initial_communication:{method:'phone',result:'failed',failure_reason:'被拒接',at:new Date().toISOString()},next:next(1)}));
   assert.equal(good(await w('/'+mk)).events.find(e=>e.event_name==='V34_COMMUNICATION').after_business_json.failure_reason,'被拒接');
   const f3=good(await w('',{contact_name:'面谈免填地点家长',student_name:'面谈免填地点学生',contact_info:'13900000048',origin_group:'sales',source:'到店',initial_communication:{method:'campus',at:new Date().toISOString(),stage:'needs_confirmed'},next:{appointment:{type:'meeting',due_at:new Date(Date.now()+2*86400000).toISOString()}}})).lead_id;
   assert.equal(good(await w('/'+f3)).records.filter(r=>r.kind==='appointments').every(r=>r.body.place===null),true);
  });
 await t.test('sales listing and current student counts exclude archived students without deleting lead history',async()=>{
  const contactName='归档回归家长', phone='13900000049';
  const firstName='归档回归甲学生', secondName='归档回归乙学生';
  const id=good(await w('',{
   contact_name:contactName,student_name:firstName,contact_info:phone,origin_group:'sales',source:'到店',
   initial_communication:{method:'phone',at:new Date(Date.now()-60000).toISOString(),stage:'enrollment_intent'},
   next:next(1),
  })).lead_id;
  const original=good(await w('/'+id));
  const firstId=original.students[0].id;
  const secondId=(await pool.query(
   'INSERT INTO ms.students(organization_id,owner_user_id,display_name) VALUES($1,$2,$3) RETURNING id',
   [org,A,secondName],
  )).rows[0].id;
  await pool.query("INSERT INTO ms.lead_students(lead_id,student_id,confirmation_state) VALUES($1,$2,'pending_review')",[id,secondId]);

  const search=async(q,user=A)=>good(await w('?q='+encodeURIComponent(q),undefined,user)).items;
  const listed=async()=>good(await w('')).items.find(item=>item.id===id);
  const metrics=async()=>good(await w('/metrics'));
  const archive=async(studentId)=>pool.query('UPDATE ms.students SET archived_at=now() WHERE id=$1',[studentId]);
  const before=await metrics();
  assert.equal(original.workflow.stage,'enrollment_intent');
  assert.ok(original.events.some(event=>event.event_name==='V34_COMMUNICATION'));
  assert.deepEqual((await listed()).students.map(student=>student.id).sort(),[firstId,secondId].sort());
  assert.deepEqual((await search(firstName)).map(item=>item.id),[id]);

  await archive(firstId);
  assert.deepEqual((await listed()).students,[{id:secondId,name:secondName}]);
  assert.deepEqual(await search(firstName),[]);
  assert.deepEqual((await search(secondName)).map(item=>item.id),[id]);
  assert.deepEqual(await search(secondName,B),[]);
  assert.deepEqual(await search(phone,B),[]);
  const partial=await metrics();
  assert.equal(partial.counts.students,before.counts.students-1);
  assert.equal(partial.counts.enrollment_intent_students,before.counts.enrollment_intent_students-1);
  assert.equal(partial.counts.unidentified_leads,before.counts.unidentified_leads);

  await archive(secondId);
  assert.equal((await listed()).students,null);
  assert.deepEqual(await search(secondName),[]);
  for(const q of [contactName,phone]){
   const items=await search(q);
   assert.deepEqual(items.map(item=>item.id),[id]);
   assert.equal(items[0].students,null);
   assert.equal(items[0].contact_info,undefined);
   assert.equal(items[0].contact_info_masked,'139****0049');
  }
  const empty=await metrics();
  assert.equal(empty.counts.leads,before.counts.leads);
  assert.equal(empty.counts.students,before.counts.students-2);
  assert.equal(empty.counts.enrollment_intent_students,before.counts.enrollment_intent_students-2);
  assert.equal(empty.counts.unidentified_leads,before.counts.unidentified_leads+1);
  assert.deepEqual(empty.activity_counts,before.activity_counts);
  const detail=good(await w('/'+id));
  assert.deepEqual(detail.students,[]);
  assert.deepEqual(detail.events,original.events);
  assert.deepEqual(detail.records,original.records);
 });
 await t.test('market listing and phone lookup omit archived students while duplicate detection and handoff still work',async()=>{
  const phone='13900000050', contactName='市场归档回归家长';
  const firstName='市场归档甲学生', secondName='市场归档乙学生';
  const intake={phone,contact_name:contactName,student_name:firstName,source:'市场活动',notes:'仅市场可见的归档回归备注'};
  const id=good(await w('/market',intake,K2)).lead_id;
  const firstId=(await pool.query('SELECT student_id FROM ms.lead_students WHERE lead_id=$1',[id])).rows[0].student_id;
  const secondId=(await pool.query(
   'INSERT INTO ms.students(organization_id,owner_user_id,display_name) VALUES($1,$2,$3) RETURNING id',
   [org,K2,secondName],
  )).rows[0].id;
  await pool.query("INSERT INTO ms.lead_students(lead_id,student_id,confirmation_state) VALUES($1,$2,'pending_review')",[id,secondId]);

  const market=async()=>good(await w('/market',undefined,K2)).items.find(item=>item.id===id);
  const lookup=async(user=A)=>good(await w('/lookup',{phone},user)).items;
  const archive=async(studentId)=>pool.query('UPDATE ms.students SET archived_at=now() WHERE id=$1',[studentId]);
  const claim=()=>w('/'+id+'/claim',{phone,next:next(1)});

  assert.deepEqual((await market()).students.sort(),[firstName,secondName].sort());
  await archive(firstId);
  assert.deepEqual((await market()).students,[secondName]);
  assert.deepEqual(await lookup(),[{
   lead_id:id,status:'market_available',contact_name:contactName,source:'市场活动',students:[{id:secondId,name:secondName}],
  }]);

  await archive(secondId);
  assert.equal((await market()).students,null);
  const [match]=await lookup();
  assert.equal(match.status,'market_available');
  assert.deepEqual(match.students,[]);
  assert.equal((await w('/market',intake,K2)).code,'PHONE_EXISTS');
  assert.equal((await w('',{contact_name:contactName,contact_info:phone,origin_group:'sales',source:'到店',next:next(1)})).code,'PHONE_MATCH_FOUND');

  assert.equal(good(await claim()).lead_id,id);
  assert.equal((await market()).handoff_state,'sales');
  assert.deepEqual((await market()).students,null);
  assert.deepEqual(await lookup(),[{
   lead_id:id,status:'sales_available',contact_name:contactName,owner_name:'销售A',students:[],
  }]);
  assert.deepEqual(await lookup(B),[{status:'assigned',owner_name:'销售A'}]);
  const detail=good(await w('/'+id));
  assert.ok(detail.records.some(r=>r.id===detail.workflow.primary_activity_id&&r.kind==='tasks'));
  assert.ok(detail.events.some(entry=>entry.event_name==='V34_MARKET_HANDOFF_ACCEPTED'));
  assert.ok(!detail.events.some(entry=>entry.event_name==='V34_MARKET_CAPTURED'));
  const audit=(await pool.query(
   "SELECT event_name FROM ms.audit_events WHERE organization_id=$1 AND target_type='lead' AND target_id=$2 AND event_name IN ('V34_MARKET_CAPTURED','V34_MARKET_HANDOFF_ACCEPTED') ORDER BY event_name",
   [org,id],
  )).rows;
  assert.deepEqual(audit.map(entry=>entry.event_name),['V34_MARKET_CAPTURED','V34_MARKET_HANDOFF_ACCEPTED']);
  const linked=(await pool.query('SELECT student_id FROM ms.lead_students WHERE lead_id=$1',[id])).rows;
  assert.deepEqual(linked.map(row=>row.student_id).sort(),[firstId,secondId].sort());
 });

 await t.test('hidden archived student still blocks handoff when linked to another lead',async()=>{
  const phone='13900000051';
  const id=good(await w('/market',{phone,contact_name:'历史共享关联家长',student_name:'历史共享关联学生',source:'市场活动'},K2)).lead_id;
  const studentId=(await pool.query('SELECT student_id FROM ms.lead_students WHERE lead_id=$1',[id])).rows[0].student_id;
  await pool.query("INSERT INTO ms.lead_students(lead_id,student_id,confirmation_state) VALUES($1,$2,'pending_review')",[lead,studentId]);
  await pool.query('UPDATE ms.students SET archived_at=now() WHERE id=$1',[studentId]);

  const [match]=good(await w('/lookup',{phone})).items;
  assert.equal(match.status,'market_available');
  assert.deepEqual(match.students,[]);
  const result=await w('/'+id+'/claim',{phone,next:next(1)});
  assert.equal(result.status,409);
  assert.equal(result.code,'STUDENT_REVIEW_REQUIRED');
  assert.equal(good(await w('/market',undefined,K2)).items.find(item=>item.id===id).handoff_state,'market');
 });
 }finally{if(app)await new Promise(r=>app.close(r));await pool.end();}
});
