import test from 'node:test';import assert from 'node:assert/strict';import pg from 'pg';import {randomUUID,createHmac} from 'node:crypto';import {readFile} from 'node:fs/promises';import {createApp} from '../../src/app.mjs';
const secret='fictional-v34-workflow-only-signing-key-2026';
const token=(id,org)=>{const h=Buffer.from(JSON.stringify({typ:'JWT',alg:'HS256'})).toString('base64url'),now=Math.floor(Date.now()/1000),p=Buffer.from(JSON.stringify({sub:id,org_id:org,iss:'market-sales-test-issuer',aud:'market-sales-isolated',iat:now,exp:now+1800})).toString('base64url');return h+'.'+p+'.'+createHmac('sha256',secret).update(h+'.'+p).digest('base64url');};
test('V3.4 standalone sales acceptance TC01—TC28, real PostgreSQL and HTTP',async t=>{
 process.env.MS_STAGE='isolated-test';const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});let server;
 const org=randomUUID(),A=randomUUID(),B=randomUUID(),M=randomUUID(),M2=randomUUID(),F=randomUUID();
 try{
  if(!(await pool.query("SELECT to_regclass('ms_workspace.lead_workflow') AS t")).rows[0].t)await pool.query(await readFile(new URL('../../db/workspace-migrations/039_v34_sales_loop.sql',import.meta.url),'utf8'));
  await pool.query('INSERT INTO ms.organizations(id,name) VALUES($1,\'V34虚构验收机构\')',[org]);
  for(const [id,name]of[[A,'顾问A'],[B,'顾问B'],[M,'主管甲'],[M2,'主管乙'],[F,'收款核实员']])await pool.query('INSERT INTO ms.staff_users(id,organization_id,display_name) VALUES($1,$2,$3)',[id,org,name]);
  for(const [role,users]of[['sales_manager',[M,M2]],['finance_verifier',[F]]]){const rid=(await pool.query('INSERT INTO ms.role_templates(organization_id,role_code,label_zh) VALUES($1,$2,$2) RETURNING id',[org,role])).rows[0].id;for(const u of users)await pool.query('INSERT INTO ms.user_role_grants(user_id,role_id,granted_by) VALUES($1,$2,$3)',[u,rid,M]);}
  server=createApp(pool,{secret,workspaceEnabled:true,v34Enabled:true});await new Promise(r=>server.listen(0,'127.0.0.1',r));const root='http://127.0.0.1:'+server.address().port+'/api/v1/isolated-workspace/workflow';
  const req=async(path,body,user=A,key=randomUUID())=>{const r=await fetch(root+path,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token(user,org),'Content-Type':'application/json','Idempotency-Key':key},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,...await r.json()};};
  const good=r=>{assert.equal(r.status,200,JSON.stringify(r));return r.data;};
  const detail=async(id,user=A)=>good(await req('/'+id,undefined,user));
  const when=(days=1)=>new Date(Date.now()+days*86400000).toISOString();
  const next=(extra={})=>({action:'call',method:'phone',title:'联系家长了解需求',due_at:when(),...extra});
  const create=async(extra={})=>good(await req('',{contact_name:'验收家长',student_name:'独立验收学生',origin_group:'sales',source:'主动咨询',next:next(),...extra})).lead_id;
  const act=async(id,action,body={},user=A)=>req('/'+id+'/'+action,{expected_version:(await detail(id)).workflow.version,...body},user);
  good(await req('/catalog',{course_label:'数学',standard_unit_cents:10000,reason:'虚构标准价目'},M));good(await req('/catalog',{course_label:'英语',standard_unit_cents:1000,reason:'虚构标准价目'},M));
  let id=await create();
  await t.test('TC01/02/03: failed call requires exact successor; draft is not completion; source preserved',async()=>{
   const before=await detail(id);
   assert.deepEqual(before.events.find(e=>e.event_name==='V34_INTAKE').after_business_json,{
    stage:'needs_discovery',terminal_state:'open',primary_activity_id:before.workflow.primary_activity_id,workflow_version:before.workflow.version,
   });
   const no=await act(id,'followup',{method:'phone',result:'failed',failure_reason:'无人接听'});assert.equal(no.status,422);
   assert.equal((await detail(id)).records.find(r=>r.id===before.workflow.primary_activity_id).state,'open');
   good(await act(id,'draft',{draft:{method:'phone',result:'failed'}}));assert.equal((await detail(id,M)).records.filter(r=>r.kind==='workflow-drafts').length,0);
   good(await act(id,'followup',{method:'phone',result:'failed',failure_reason:'无人接听',next:next({method:'wechat_text',action:'wechat',title:'微信确认到校时间'})}));
   const d=await detail(id);assert.equal(d.workflow.stage,'needs_discovery');const p=d.records.find(r=>r.id===d.workflow.primary_activity_id);assert.equal(p.body.method,'wechat_text');assert.equal(p.state,'open');
   assert.equal((await pool.query('SELECT e.event_type FROM ms.leads l JOIN ms.contact_events e ON e.id=l.source_event_id WHERE l.id=$1',[id])).rows[0].event_type,'主动咨询');
   assert.equal((await req('',{contact_name:'无安排',origin_group:'sales',source:'主动咨询'})).status,422);
  });
  await t.test('TC04/05: waiting needs dated check; overdue never closes lead',async()=>{
   good(await act(id,'followup',{method:'wechat_text',result:'waiting',next:next({action:'check_reply',method:'wechat_text',due_at:when(-1)})}));
   assert.equal((await detail(id)).workflow.terminal_state,'open');const m=good(await req('/metrics'));assert.ok(m.counts.overdue>=1);assert.equal(m.counts.waiting_leads,1);
   assert.equal((await act(id,'followup',{method:'wechat_text',result:'failed',failure_reason:'无人接听',next:next()})).status,422);
  });
  await t.test('metrics separates overdue activities from leads with an overdue primary activity',async()=>{
   const metrics=async(user)=>good(await req('/metrics',undefined,user));
   const before=await metrics(A);
   const otherBefore=await metrics(B);
   const lead=await create();
   for(const days of [-2,-1]){
    good(await act(lead,'appointment',{appointment:{type:'meeting',due_at:when(days)}}));
   }
   const overdue=await metrics(A);
   assert.equal(overdue.counts.overdue_activities,before.counts.overdue_activities+2);
   assert.equal(overdue.counts.overdue_primary_leads,before.counts.overdue_primary_leads+1);
   assert.equal(overdue.counts.overdue,overdue.counts.overdue_activities);

   good(await req('',{contact_name:'另一顾问逾期回归',student_name:'另一顾问学生',origin_group:'sales',source:'主动咨询',next:next({due_at:when(-1)})},B));
   const other=await metrics(B);
   assert.equal(other.counts.overdue_activities,otherBefore.counts.overdue_activities+1);
   assert.equal(other.counts.overdue_primary_leads,otherBefore.counts.overdue_primary_leads+1);
   const team=await metrics(M);
   for(const key of ['overdue_activities','overdue_primary_leads']){
    assert.equal(team.counts[key],team.by_owner.reduce((sum,owner)=>sum+owner[key],0),key);
    assert.equal(team.by_owner.find(owner=>owner.owner_id===A)[key],overdue.counts[key],key);
    assert.equal(team.by_owner.find(owner=>owner.owner_id===B)[key],other.counts[key],key);
   }
   assert.equal(team.by_owner.find(owner=>owner.owner_id===A).overdue,overdue.counts.overdue_primary_leads);

   const {workflow}=await detail(lead);
   good(await act(lead,'activity',{record_id:workflow.primary_activity_id,transition:'reschedule',due_at:when(1),reason:'家长改约'}));
   const rescheduled=await metrics(A);
   assert.equal(rescheduled.counts.overdue_activities,before.counts.overdue_activities+1);
   assert.equal(rescheduled.counts.overdue_primary_leads,before.counts.overdue_primary_leads);
   assert.equal(rescheduled.reminders.filter(r=>r.lead_id===lead&&r.overdue).length,1);
  });
  await t.test('TC06/08: unscheduled/rejected invitation requires another real action and never auto loses',async()=>{
   for(const result of ['agreed_unscheduled','declined'])good(await act(id,'followup',{method:'phone',result:'communicated',purpose:'invite',invite_result:result,stage:'needs_confirmed',next:next({action:'confirm_visit'})}));
   assert.equal((await detail(id)).workflow.terminal_state,'open');assert.equal((await detail(id)).records.filter(r=>r.kind==='appointments').length,0);
  });
  let meeting;
  await t.test('TC07/18: confirmed meeting is the successor, replay does not duplicate appointment',async()=>{
   const input={expected_version:(await detail(id)).workflow.version,method:'phone',result:'communicated',purpose:'invite',invite_result:'confirmed',appointment:{type:'meeting',due_at:when(2),place:'虚构接待室',state:'confirmed'}};const key=randomUUID();
   good(await req('/'+id+'/followup',input,A,key));good(await req('/'+id+'/followup',input,A,key));const d=await detail(id);meeting=d.records.find(r=>r.kind==='appointments');assert.ok(meeting);assert.equal(d.workflow.primary_activity_id,meeting.id);assert.equal(d.records.filter(r=>r.kind==='appointments').length,1);
   assert.equal(d.records.filter(r=>r.kind==='tasks'&&['open','in_progress'].includes(r.state)).length,0);
  });
  await t.test('TC09/10: no-show retained, next mandatory, attendance does not imply price presentation',async()=>{
   assert.equal((await act(id,'activity',{record_id:meeting.id,transition:'no_show',feedback:'家长临时有事'})).status,422);
   good(await act(id,'activity',{record_id:meeting.id,transition:'no_show',feedback:'家长临时有事',next:next({action:'reschedule_visit'})}));
   assert.equal((await detail(id)).records.find(r=>r.id===meeting.id).state,'no_show');assert.equal((await detail(id)).workflow.stage,'needs_confirmed');
  });
  let trial;
  await t.test('TC11/12/13: standalone trial, audited reschedule, explicit completion requires successor',async()=>{
   assert.equal((await act(id,'followup',{method:'phone',result:'communicated',stage:'trial_completed',next:next()})).status,422);
   good(await act(id,'appointment',{appointment:{type:'trial',due_at:when(2),place:'虚构教室',course:'数学'}}));let d=await detail(id);trial=d.records.find(r=>r.kind==='appointments'&&r.body.type==='trial');
   good(await act(id,'activity',{record_id:trial.id,transition:'reschedule',due_at:when(3),reason:'家长改期'}));d=await detail(id);assert.equal(d.records.find(r=>r.id===trial.id).state,'rescheduled');
   assert.equal((await pool.query('SELECT count(*)::int n FROM ms_workspace.history WHERE record_id=$1',[trial.id])).rows[0].n,2);
   good(await act(id,'activity',{record_id:trial.id,transition:'completed',feedback:'实际试听完成，家长反馈积极',next:next({action:'trial_feedback'})}));
   d=await detail(id);assert.equal(d.workflow.stage,'trial_completed');assert.equal(d.records.find(r=>r.id===trial.id).body.actual_attendance,'attended');
  });
  await t.test('TC14: paused retains future method, time, reason and owner',async()=>{
   assert.equal((await act(id,'followup',{method:'phone',result:'communicated',stage:'paused',next:next()})).status,422);
   good(await act(id,'followup',{method:'phone',result:'communicated',stage:'paused',pause_reason:'下个月再考虑',next:next({due_at:when(20),action:'regular_visit'})}));
   assert.equal((await detail(id)).workflow.pause_reason,'下个月再考虑');
  });
  await t.test('TC15/16: concurrent completion creates one successor; DB constraint and failed insert retain old activity',async()=>{
   const d=await detail(id),v=d.workflow.version,b={expected_version:v,method:'phone',result:'failed',failure_reason:'无人接听',next:next()};const results=await Promise.all([req('/'+id+'/followup',b),req('/'+id+'/followup',b)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
   const current=await detail(id);await assert.rejects(pool.query("UPDATE ms_workspace.records SET state='completed' WHERE id=$1",[current.workflow.primary_activity_id]),/Open Lead/);
   await pool.query(`CREATE FUNCTION ms_workspace.v34_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.body->>'title'='FAULT_NEXT' THEN RAISE EXCEPTION 'test next failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER v34_fault BEFORE INSERT ON ms_workspace.records FOR EACH ROW EXECUTE FUNCTION ms_workspace.v34_fault()`);
   try{const r=await act(id,'followup',{method:'phone',result:'communicated',next:next({title:'FAULT_NEXT'})});assert.equal(r.status,500);assert.equal((await detail(id)).workflow.primary_activity_id,current.workflow.primary_activity_id);assert.equal((await detail(id)).records.find(r=>r.id===current.workflow.primary_activity_id).state,'open');}finally{await pool.query('DROP TRIGGER v34_fault ON ms_workspace.records; DROP FUNCTION ms_workspace.v34_fault()');}
  });
  await t.test('TC17: independent transfer preserves tasks, student identity and original author',async()=>{
   const transferId=await create();good(await act(transferId,'quote',{items:[{course_label:'数学',quantity:1,unit_cents:10000}]}));const quoteBefore=(await detail(transferId)).records.find(r=>r.kind==='quotes');good(await act(transferId,'request-transfer',{owner_user_id:B,reason:'主管协调转交'},M));const d=await detail(transferId),r=d.records.find(r=>r.kind==='corrections');assert.equal((await act(transferId,'approve-transfer',{record_id:r.id,reason:'自审'},M)).status,403);
   good(await act(transferId,'approve-transfer',{record_id:r.id,reason:'第二位主管独立核实'},M2));assert.equal((await req('/'+transferId,undefined,B)).status,403);assert.ok(good(await req('',undefined,B)).incoming.some(x=>x.lead_id===transferId));good(await act(transferId,'accept-transfer',{record_id:r.id},B));const moved=await detail(transferId,B);assert.equal(moved.records.find(r=>r.id===quoteBefore.id).version,quoteBefore.version);assert.equal(moved.records.find(r=>r.id===quoteBefore.id).owner_user_id,A);assert.equal(moved.lead.owner_user_id,B);assert.equal(moved.records.find(x=>x.id===moved.workflow.primary_activity_id).owner_user_id,B);assert.equal((await req('/'+transferId)).status,403);assert.equal((await pool.query('SELECT owner_user_id FROM ms.students WHERE id=$1',[moved.students[0].id])).rows[0].owner_user_id,A);
  });
  const enrollLead=await create();let enrollment,order;
  await t.test('TC19: valid agreement without receipt is not enrollment success',async()=>{
   good(await act(enrollLead,'quote',{items:[{course_label:'数学',quantity:10,unit_cents:10000}]}));let d=await detail(enrollLead),q=d.records.find(r=>r.kind==='quotes');
   good(await act(enrollLead,'enroll',{quote_id:q.id,quote_version:q.version,agreement_ref:'虚构签署协议001'}));d=await detail(enrollLead);enrollment=d.records.find(r=>r.kind==='enrollments');order=enrollment.body.order_id;
   good(await act(enrollLead,'confirm-agreement',{record_id:enrollment.id,evidence_ref:'主管核实签署身份与条款'},M));assert.equal((await detail(enrollLead)).records.find(r=>r.id===enrollment.id).state,'awaiting_payment');
  });
  let payment;
  await t.test('TC21/22/27: salesperson cannot verify; first verified partial payment succeeds but does not win',async()=>{
   const before=good(await req('/metrics')).counts;
   good(await act(enrollLead,'submit-payment',{enrollment_id:enrollment.id,amount_cents:10000,receipt_ref:randomUUID(),payment_kind:'deposit',received_at:when(-1),evidence_ref:'虚构付款资料'}));let d=await detail(enrollLead);payment=d.records.find(r=>r.kind==='payments');
   assert.equal((await act(enrollLead,'verify-payment',{record_id:payment.id,evidence_ref:'销售自核'})).status,403);
   good(await act(enrollLead,'verify-payment',{record_id:payment.id,evidence_ref:'核实员查验实际到账'},F));d=await detail(enrollLead);const e=d.records.find(r=>r.id===enrollment.id);assert.equal(e.state,'successful');assert.equal(e.body.balance_cents,90000);assert.equal(d.workflow.terminal_state,'open');assert.equal((await act(enrollLead,'close-won',{reason:'只有定金'})).status,409);assert.ok(d.workflow.primary_activity_id);
   const after=good(await req('/metrics')).counts;
   for(const key of ['enrollment_success_orders','enrollment_success_students','historical_enrollment_success_orders','historical_enrollment_success_students']){
    assert.equal(after[key],before[key]+1,key);
   }
   assert.equal(after.won_leads,before.won_leads);
   const partialWon=good(await req('/metrics/drilldown?metric=won_leads'));
   assert.equal(partialWon.total,after.won_leads);
   assert.ok(!partialWon.items.some(item=>item.id===enrollLead));
  });
  await t.test('finance-only staff cannot read sales metrics but can reject a pending payment',async()=>{
   assert.equal((await req('/metrics',undefined,F)).status,403);
   assert.equal(good(await req('/options',undefined,F)).can_verify,true);
   assert.ok(good(await req('/metrics',undefined,M)).counts.leads>0);
   assert.ok(Array.isArray(good(await req('/finance',undefined,M)).items));
   assert.equal((await req('/'+enrollLead,undefined,F)).status,403);
   good(await act(enrollLead,'submit-payment',{enrollment_id:enrollment.id,amount_cents:1000,receipt_ref:randomUUID(),payment_kind:'tuition',received_at:when(-1),evidence_ref:'待补到账资料'}));
   const queue=good(await req('/finance',undefined,F));
   assert.equal(queue.can_verify,true);
   const pending=queue.items.find(r=>r.lead_id===enrollLead&&r.kind==='payments'&&r.state==='pending');
   assert.ok(pending);
   good(await act(enrollLead,'reject-payment',{record_id:pending.id,reason:'凭证需重新提交'},F));
   const rejected=(await detail(enrollLead)).records.find(r=>r.id===pending.id);
   assert.equal(rejected.state,'rejected');
   assert.ok(!(good(await req('/finance',undefined,F))).items.some(r=>r.id===pending.id));
  });
  await t.test('TC20: payment alone does not establish signed enrollment',async()=>{
   const lead=await create();good(await act(lead,'quote',{items:[{course_label:'英语',quantity:1,unit_cents:1000}]}));let d=await detail(lead),q=d.records.find(r=>r.kind==='quotes');good(await act(lead,'enroll',{quote_id:q.id,quote_version:q.version,agreement_ref:'协议待核实'}));d=await detail(lead);const e=d.records.find(r=>r.kind==='enrollments');good(await act(lead,'submit-payment',{enrollment_id:e.id,amount_cents:1000,receipt_ref:randomUUID(),payment_kind:'full',received_at:when(-1),evidence_ref:'付款资料'}));d=await detail(lead);const p=d.records.find(r=>r.kind==='payments');good(await act(lead,'verify-payment',{record_id:p.id,evidence_ref:'到账已独立核实'},F));assert.equal((await detail(lead)).records.find(r=>r.id===e.id).state,'awaiting_agreement');good(await act(lead,'confirm-agreement',{record_id:e.id,evidence_ref:'协议后续独立核实'},M));assert.equal((await detail(lead)).records.find(r=>r.id===e.id).state,'successful');
  });
  await t.test('TC23/24: no single unanswered call closes; explicit rejection records evidence and stops contact',async()=>{
   const lead=await create();assert.equal((await act(lead,'close-lost',{reason:'无人接听',feedback:'一次未接',evidence_ref:'联系记录'})).status,422);
   good(await act(lead,'close-lost',{reason:'家长明确拒绝报名',feedback:'家长明确不再报名且不要再联系',evidence_ref:'家长明确反馈记录',do_not_contact:true}));const d=await detail(lead);assert.equal(d.workflow.terminal_state,'lost');assert.equal(d.workflow.do_not_contact,true);assert.equal(d.records.filter(r=>activeState(r.state)&&['tasks','appointments'].includes(r.kind)).length,0);
   assert.equal((await act(lead,'reopen',{evidence_ref:'无主动咨询',next:next()},M)).status,422);good(await act(lead,'reopen',{evidence_ref:'家长主动重新咨询',customer_initiated:true,next:next()},M));
  });
  await t.test('loss reasons count current lost leads once and retain all historical closures',async()=>{
   const lead=await create();
   const firstReason='价格原因', latestReason='课程不匹配';
   const metrics=async(user=A)=>good(await req('/metrics',undefined,user));
   const before=await metrics();
   const otherOwnerBefore=await metrics(B);
   const drill=async(user=A)=>good(await req('/metrics/drilldown?metric=lost_leads',undefined,user));
   const close=reason=>act(lead,'close-lost',{reason,feedback:'家长明确反馈',evidence_ref:'本次失单记录'});
   const reopen=()=>act(lead,'reopen',{evidence_ref:'家长重新咨询',next:next()},M);
   const count=(m,field,reason)=>m[field][reason]??0;

   good(await close(firstReason));
   const lost=await metrics();
   assert.equal(lost.counts.lost_leads,before.counts.lost_leads+1);
   assert.equal(count(lost,'current_lost_reasons',firstReason),count(before,'current_lost_reasons',firstReason)+1);
   assert.equal(count(lost,'lost_reasons',firstReason),count(before,'lost_reasons',firstReason)+1);
   const closedDrill=await drill();
   assert.equal(closedDrill.total,lost.counts.lost_leads);
   assert.equal(closedDrill.items.find(item=>item.id===lead).terminal_state,'lost');

   good(await reopen());
   const reopened=await metrics();
   assert.equal(reopened.counts.lost_leads,before.counts.lost_leads);
   assert.deepEqual(reopened.current_lost_reasons,before.current_lost_reasons);
   assert.deepEqual(reopened.lost_reasons,lost.lost_reasons);
   const reopenedDrill=await drill();
   assert.equal(reopenedDrill.total,reopened.counts.lost_leads);
   assert.ok(!reopenedDrill.items.some(item=>item.id===lead));

   good(await close(latestReason));
   const lostAgain=await metrics();
   assert.equal(lostAgain.counts.lost_leads,before.counts.lost_leads+1);
   assert.equal(count(lostAgain,'current_lost_reasons',firstReason),count(before,'current_lost_reasons',firstReason));
   assert.equal(count(lostAgain,'current_lost_reasons',latestReason),count(before,'current_lost_reasons',latestReason)+1);
   for(const reason of [firstReason,latestReason]){
    assert.equal(count(lostAgain,'lost_reasons',reason),count(before,'lost_reasons',reason)+1);
   }
   const closedAgainDrill=await drill();
   assert.equal(closedAgainDrill.total,lostAgain.counts.lost_leads);
   assert.equal(closedAgainDrill.items.filter(item=>item.id===lead).length,1);
   assert.ok(!(await drill(B)).items.some(item=>item.id===lead));
   const otherOwner=await metrics(B);
   assert.deepEqual(otherOwner.current_lost_reasons,otherOwnerBefore.current_lost_reasons);
   assert.deepEqual(otherOwner.lost_reasons,otherOwnerBefore.lost_reasons);
   good(await reopen());
  });
  await t.test('full net payment creates one full-payment SaleEvent only on legitimate closure',async()=>{
   good(await act(enrollLead,'submit-payment',{enrollment_id:enrollment.id,amount_cents:90000,receipt_ref:randomUUID(),payment_kind:'tuition',received_at:when(-1),evidence_ref:'第二笔收款资料'}));let d=await detail(enrollLead),p=d.records.find(r=>r.kind==='payments'&&r.state==='pending');good(await act(enrollLead,'verify-payment',{record_id:p.id,evidence_ref:'查验剩余款到账'},F));good(await act(enrollLead,'close-won',{reason:'独立协议核实与两笔有效款全额到账'}));assert.equal((await detail(enrollLead)).workflow.terminal_state,'won');assert.equal((await pool.query('SELECT count(*)::int n FROM ms.sale_events WHERE order_id=$1',[order])).rows[0].n,1);
   const won=good(await req('/metrics/drilldown?metric=won_leads'));
   assert.equal(won.total,good(await req('/metrics')).counts.won_leads);
   const result=won.items.find(item=>item.id===enrollLead);
   assert.equal(result.terminal_state,'won');
   assert.deepEqual(Object.keys(result).sort(),['contact_name','created_at','id','owner_name','terminal_state']);
  });
  await t.test('TC25: post-close refund requires audited reopening and independent correction, old success retained',async()=>{
   const before=good(await req('/metrics')).counts;
   const firstSuccess=(await detail(enrollLead)).records.find(r=>r.id===enrollment.id).body.first_success_at;
   assert.ok(firstSuccess);
   good(await act(enrollLead,'request-correction',{enrollment_id:enrollment.id,reason:'家长申请退回定金'}));let d=await detail(enrollLead),cor=d.records.find(r=>r.kind==='corrections');good(await act(enrollLead,'approve-correction',{record_id:cor.id,reason:'核实退款事由',next:next({action:'coordination',title:'内部核实退款后的订单余额'})},M));
   const underCorrection=good(await req('/metrics')).counts;
   assert.equal(underCorrection.enrollment_success_orders,before.enrollment_success_orders-1);
   assert.equal(underCorrection.enrollment_success_students,before.enrollment_success_students-1);
   assert.equal(underCorrection.historical_enrollment_success_orders,before.historical_enrollment_success_orders);
   assert.equal(underCorrection.historical_enrollment_success_students,before.historical_enrollment_success_students);
   assert.equal(underCorrection.won_leads,before.won_leads-1);
   const underCorrectionDrill=good(await req('/metrics/drilldown?metric=won_leads'));
   assert.equal(underCorrectionDrill.total,underCorrection.won_leads);
   assert.ok(!underCorrectionDrill.items.some(item=>item.id===enrollLead));
   good(await act(enrollLead,'submit-refund',{payment_id:payment.id,correction_id:cor.id,amount_cents:10000,refund_ref:randomUUID(),reason:'定金退回',evidence_ref:'已批准退款资料'}));d=await detail(enrollLead);const refund=d.records.find(r=>r.kind==='refunds');good(await act(enrollLead,'verify-refund',{record_id:refund.id,evidence_ref:'独立核实实际退款'},F));d=await detail(enrollLead);assert.equal(d.workflow.terminal_state,'open');assert.ok(d.workflow.primary_activity_id);assert.equal(d.records.find(r=>r.id===enrollment.id).body.balance_cents,10000);assert.equal((await pool.query('SELECT count(*)::int n FROM ms.sale_events WHERE order_id=$1',[order])).rows[0].n,1);assert.equal(d.events.filter(e=>e.event_name==='V34_ENROLLMENT_SUCCESS').length,1);
   assert.equal(d.records.find(r=>r.id===enrollment.id).body.first_success_at,firstSuccess);
   const afterRefund=good(await req('/metrics')).counts;
   assert.equal(afterRefund.historical_enrollment_success_orders,before.historical_enrollment_success_orders);
   assert.equal(afterRefund.historical_enrollment_success_students,before.historical_enrollment_success_students);
  });
  await t.test('TC26/28: legacy facts stay raw and missing arrangements become an exception list',async()=>{
   const old=(await pool.query("INSERT INTO ms.leads(organization_id,owner_user_id,lead_state) VALUES($1,$2,'working') RETURNING id",[org,A])).rows[0].id;await pool.query("INSERT INTO ms.audit_events(organization_id,actor_user_id,target_type,target_id,event_name,after_business_json,reason_zh) VALUES($1,$2,'lead',$3,'LEAD_DESK_FOLLOWUP','{\"result\":\"准备报名\"}','旧版记录')",[org,A,old]);const list=good(await req(''));assert.equal(list.items.find(l=>l.id===old).needs_arrangement,true);assert.equal((await detail(old)).workflow,null);assert.equal((await detail(old)).events[0].after_business_json.result,'准备报名');good(await actOld(old));
   async function actOld(id){return req('/'+id+'/arrange',{next:next()});}
   const repaired=await detail(old);
   assert.equal(repaired.workflow.stage,'unclassified');
   assert.deepEqual(repaired.events.find(e=>e.event_name==='V34_ARRANGEMENT_REPAIRED').after_business_json,{
    activity_id:repaired.workflow.primary_activity_id,stage:'unclassified',terminal_state:'open',
    primary_activity_id:repaired.workflow.primary_activity_id,workflow_version:repaired.workflow.version,
   });
  });
  await t.test('local standard price cannot be forged; special discount requires independent version-bound approval',async()=>{
   const lead=await create();assert.equal((await req('/catalog',{course_label:'绕过价目',standard_unit_cents:1,reason:'销售自定'})).status,403);
   assert.equal((await act(lead,'quote',{items:[{course_label:'数学',quantity:1,standard_unit_cents:1,unit_cents:1}]})).status,422);
   good(await act(lead,'quote',{items:[{course_label:'数学',quantity:1,standard_unit_cents:10000,unit_cents:5000}]},M));let d=await detail(lead),q=d.records.find(r=>r.kind==='quotes');
   assert.equal((await act(lead,'enroll',{quote_id:q.id,quote_version:q.version,agreement_ref:'优惠未批'})).status,409);
   assert.equal((await act(lead,'approve-discount',{record_id:q.id,reason:'自审'},M)).status,403);
   good(await act(lead,'approve-discount',{record_id:q.id,reason:'另一主管核实特别优惠'},M2));d=await detail(lead);q=d.records.find(r=>r.id===q.id);assert.equal(q.body.discount_state,'approved');assert.equal(q.version,2);
  });
  await t.test('same student may have multiple lead/course orders without duplicate student counts',async()=>{
   const original=await create(),d=await detail(original),student=d.students[0].id;const before=good(await req('/metrics')).counts.students;
   const second=await create({student_name:'',student_id:student});assert.equal((await detail(second)).students[0].id,student);assert.equal(good(await req('/metrics')).counts.students,before);
   const students=good(await req('/metrics/drilldown?metric=students&page_size=50'));
   assert.equal(students.total,before);
   assert.deepEqual(students.items.filter(item=>item.id===student),[{
    id:student,display_name:d.students[0].display_name,lead_count:2,
   }]);
   assert.deepEqual(good(await req('/metrics/drilldown?metric=students&owner_id='+A,undefined,B)).items,[]);
   for(const label of ['数学','英语']){good(await act(second,'quote',{items:[{course_label:label,quantity:1,unit_cents:label==='数学'?10000:1000}]}));let detail2=await detail(second),q=detail2.records.find(r=>r.kind==='quotes'&&r.body.items[0].course_label===label);good(await act(second,'enroll',{quote_id:q.id,quote_version:q.version,agreement_ref:'独立课程协议'+label}));}
   assert.equal((await detail(second)).records.filter(r=>r.kind==='enrollments').length,2);
  });
  await t.test('waiting invitation is not consent; financial queue is role protected',async()=>{
   const lead=await create();good(await act(lead,'followup',{method:'wechat_text',result:'waiting',purpose:'invite',invite_result:'waiting',next:next({method:'wechat_text',action:'check_reply'})}));
   assert.equal((await act(lead,'followup',{method:'wechat_text',result:'waiting',purpose:'invite',invite_result:'confirmed',next:next()})).status,422);
   assert.equal((await req('/finance')).status,403);
   assert.equal((await act(lead,'followup',{method:'phone',result:'failed',failure_reason:'无人接听',stage:'courses_introduced',next:next()})).status,422);
  });
  await t.test('walk-in parent is a real meeting fact, not a fabricated invitation or advance booking',async()=>{
   const lead=await create();const b={method:'campus',result:'communicated',stage:'needs_confirmed',meeting_actual:{confirmed_completed:true,at:new Date(Date.now()-60000).toISOString(),place:'实际到访接待室'},notes:'家长主动到校沟通需求，尚未介绍价格',next:next({action:'confirm_course'})};good(await act(lead,'followup',b));const d=await detail(lead),meeting=d.records.find(r=>r.kind==='appointments');assert.equal(meeting.state,'completed');assert.equal(meeting.body.was_scheduled,false);assert.equal(d.workflow.stage,'needs_confirmed');assert.equal(d.events.filter(e=>e.event_name==='V34_COMMUNICATION'&&e.after_business_json.purpose==='invite').length,0);assert.ok(d.workflow.primary_activity_id);
  });
  await t.test('cancelled trial and missed meeting retain followup without forcing a false stage regression',async()=>{
   const lead=await create();good(await act(lead,'appointment',{appointment:{type:'trial',due_at:when(2),place:'试听室',course:'数学'}}));let d=await detail(lead),trial=d.records.find(r=>r.kind==='appointments');good(await act(lead,'activity',{record_id:trial.id,transition:'cancelled',feedback:'家长请求改期，先联系确认',next:next()}));good(await act(lead,'followup',{method:'phone',result:'failed',failure_reason:'无人接听',next:next()}));assert.equal((await detail(lead)).workflow.stage,'trial_booked');
   good(await act(lead,'appointment',{appointment:{type:'meeting',due_at:when(2),place:'接待室'}}));d=await detail(lead);const meeting=d.records.find(r=>r.kind==='appointments'&&r.body.type==='meeting');good(await act(lead,'followup',{method:'campus',result:'failed',failure_reason:'未到场',next:next({action:'reschedule_visit'})}));assert.equal((await detail(lead)).records.find(r=>r.id===meeting.id).state,'no_show');
  });
  await t.test('scheduled meeting completion records offline communication and advances stage; trial never regresses higher stage; enrolling requires order',async()=>{
   const lead=await create();assert.equal((await act(lead,'followup',{method:'phone',result:'communicated',stage:'enrolling',next:next()})).status,422);
   good(await act(lead,'appointment',{appointment:{type:'meeting',due_at:when(1),place:'校区面谈室'}}));let d=await detail(lead),m=d.records.find(r=>r.kind==='appointments'&&r.body.type==='meeting');
   assert.equal((await act(lead,'activity',{record_id:m.id,transition:'no_show',feedback:'未到',stage:'courses_introduced',next:next()})).status,422);
   good(await act(lead,'activity',{record_id:m.id,transition:'completed',feedback:'面谈已介绍课程方案并确认报名意向',stage:'enrollment_intent',next:next({action:'confirm_course'})}));
   d=await detail(lead);assert.equal(d.workflow.stage,'enrollment_intent');assert.ok(d.events.some(e=>e.event_name==='V34_COMMUNICATION'&&e.after_business_json.appointment_id===m.id&&e.after_business_json.category==='offline'));
   good(await act(lead,'appointment',{appointment:{type:'trial',due_at:when(2),place:'试听教室',course:'数学'}}));d=await detail(lead);assert.equal(d.workflow.stage,'enrollment_intent');
   const extraTrial=d.records.find(r=>r.kind==='appointments'&&r.body.type==='trial');good(await act(lead,'activity',{record_id:extraTrial.id,transition:'completed',feedback:'二宝试听补充体验完成',next:next({action:'confirm_agreement'})}));
   assert.equal((await detail(lead)).workflow.stage,'enrollment_intent');
  });
  await t.test('sibling student can be added on existing lead; manager pending approvals and discount/transfer/correction rejections work cleanly',async()=>{
   const lead=await create();good(await act(lead,'quote',{student_name:'同家庭二宝',items:[{course_label:'数学',quantity:2,standard_unit_cents:10000,unit_cents:8000}]}));
   let d=await detail(lead);assert.equal(d.students.length,2);let q=d.records.find(r=>r.kind==='quotes');assert.equal(q.body.discount_state,'pending');
   const m1=good(await req('/metrics',undefined,M));assert.ok(m1.pending_approvals.some(a=>a.id===q.id&&a.kind==='discount'&&a.can_review===true));
   good(await act(lead,'reject-discount',{record_id:q.id,reason:'折扣超出当期活动范围'},M));d=await detail(lead);q=d.records.find(r=>r.id===q.id);assert.equal(q.body.discount_state,'rejected');
   assert.equal((await act(lead,'enroll',{quote_id:q.id,quote_version:q.version,agreement_ref:'退回方案不可报名'})).status,409);
   good(await act(lead,'quote',{quote_id:q.id,quote_version:q.version,student_id:q.student_id,items:[{course_label:'数学',quantity:2,standard_unit_cents:10000,unit_cents:9000}]}));d=await detail(lead);q=d.records.find(r=>r.id===q.id);
   good(await act(lead,'approve-discount',{record_id:q.id,reason:'调整后符合双科优惠标准'},M));d=await detail(lead);q=d.records.find(r=>r.id===q.id);
   good(await act(lead,'enroll',{quote_id:q.id,quote_version:q.version,agreement_ref:'二宝正式协议'}));d=await detail(lead);const e=d.records.find(r=>r.kind==='enrollments');
   good(await act(lead,'request-transfer',{owner_user_id:B,reason:'测试转交驳回'},M));d=await detail(lead);const tr=d.records.find(r=>r.kind==='corrections'&&r.body.type==='lead_transfer');
   assert.equal((await act(lead,'reject-transfer',{record_id:tr.id,reason:'自审驳回'},M)).status,403);
   good(await act(lead,'reject-transfer',{record_id:tr.id,reason:'当前阶段继续由原顾问跟进'},M2));assert.equal((await detail(lead)).records.find(r=>r.id===tr.id).state,'rejected');
   good(await act(lead,'request-correction',{enrollment_id:e.id,reason:'误点纠正申请'}));d=await detail(lead);const cor=d.records.find(r=>r.kind==='corrections'&&r.body.type==='enrollment_correction');
   good(await act(lead,'reject-correction',{record_id:cor.id,reason:'与家长核实订单无误无需取消'},M));assert.equal((await detail(lead)).records.find(r=>r.id===cor.id).state,'rejected');
  });
  await t.test('offline meetings omit location while trial classes require classroom name',async()=>{
   const lead=await create();
   good(await act(lead,'appointment',{appointment:{type:'meeting',due_at:when(1)}}));
   let d=await detail(lead);assert.equal(d.records.find(r=>r.kind==='appointments'&&r.body.type==='meeting').body.place,null);
   assert.equal((await act(lead,'appointment',{appointment:{type:'trial',due_at:when(2),course:'数学'}})).status,422);
   good(await act(lead,'appointment',{appointment:{type:'trial',due_at:when(2),place:'203教室',course:'数学'}}));
   good(await act(lead,'followup',{method:'campus',result:'communicated',meeting_actual:{confirmed_completed:true,at:new Date(Date.now()-30000).toISOString()},notes:'到校面谈无需填写地点',next:next()}));
   d=await detail(lead);assert.equal(d.records.find(r=>r.kind==='appointments'&&r.body.was_scheduled===false).body.place,null);
  });
  await t.test('metrics filters a lead creation cohort by an inclusive start, exclusive end and authorized owner',async()=>{
   const start='2024-04-01T00:00:00+08:00', end='2024-04-02T00:00:00+08:00';
   const seed=async(user,createdAt)=>{
    const response=good(await req('',{
     contact_name:'统计窗口家长',student_name:'统计窗口学生',origin_group:'sales',source:'主动咨询',next:next(),
    },user));
    await pool.query('UPDATE ms.leads SET created_at=$2 WHERE id=$1',[response.lead_id,createdAt]);
    return response.lead_id;
   };
   const before=await seed(A,'2024-03-31T23:59:59+08:00');
   const first=await seed(A,start);
   const other=await seed(B,'2024-04-01T12:00:00+08:00');
   const after=await seed(A,end);
   const foreignOrg=randomUUID();
   await pool.query("INSERT INTO ms.organizations(id,name) VALUES($1,'统计窗口其他机构')",[foreignOrg]);
   await pool.query("INSERT INTO ms.leads(organization_id,lead_state,created_at) VALUES($1,'working',$2)",[foreignOrg,start]);
   const scoped=(query,user)=>req('/metrics?'+new URLSearchParams(query),undefined,user);
   const drill=(query,user)=>req('/metrics/drilldown?'+new URLSearchParams({metric:'leads',...query}),undefined,user);
   const window={view_mode:'cohort',start_at:start,end_at:end};
   const team=good(await scoped(window,M));
   assert.equal(team.counts.leads,2);
   assert.deepEqual(team.filters,{view_mode:'cohort',start_at:'2024-03-31T16:00:00.000Z',end_at:'2024-04-01T16:00:00.000Z',owner_id:null});
   assert.deepEqual(team.reminders.map(row=>row.lead_id).sort(),[first,other].sort());
   assert.ok(team.reminders.every(row=>![before,after].includes(row.lead_id)));
   assert.deepEqual(good(await scoped({...window,owner_id:B},M)).reminders.map(row=>row.lead_id),[other]);
   assert.deepEqual(good(await scoped(window,A)).reminders.map(row=>row.lead_id),[first]);
   assert.equal(good(await scoped({...window,owner_id:B},A)).counts.leads,0);
   assert.equal((await scoped(window,F)).status,403);
   const firstPage=good(await drill({...window,page_size:1},M));
   const secondPage=good(await drill({...window,page:2,page_size:1},M));
   const beyond=good(await drill({...window,page:3,page_size:1},M));
   assert.equal(firstPage.total,team.counts.leads);
   assert.equal(secondPage.total,team.counts.leads);
   assert.equal(beyond.total,team.counts.leads);
   assert.deepEqual(beyond.items,[]);
   assert.deepEqual(firstPage.filters,team.filters);
   assert.deepEqual(firstPage.items.map(item=>item.id),[other]);
   assert.deepEqual(secondPage.items.map(item=>item.id),[first]);
   assert.deepEqual(Object.keys(firstPage.items[0]).sort(),['contact_name','created_at','id','owner_name','terminal_state']);
   assert.deepEqual(good(await drill(window,A)).items.map(item=>item.id),[first]);
   assert.deepEqual(good(await drill({...window,owner_id:B},M)).items.map(item=>item.id),[other]);
   assert.deepEqual(good(await drill({...window,owner_id:B},A)).items,[]);
   assert.equal((await drill(window,F)).status,403);
   const studentPage=good(await drill({...window,metric:'students',page_size:1},M));
   const studentPage2=good(await drill({...window,metric:'students',page_size:1,page:2},M));
   assert.equal(studentPage.total,team.counts.students);
   assert.equal(studentPage2.total,team.counts.students);
   assert.notEqual(studentPage.items[0].id,studentPage2.items[0].id);
   assert.equal(good(await drill({...window,metric:'students',owner_id:B},M)).total,1);
   assert.equal(good(await drill({...window,metric:'students',owner_id:B},A)).total,0);
   for(const invalid of [{metric:'unsupported'},{page:'0'},{page_size:'51'},{...window,view_mode:'event'}]){
    assert.equal((await drill(invalid,M)).status,422,JSON.stringify(invalid));
   }
   for(const invalid of [
    {start_at:start},
    {...window,end_at:start},
    {...window,start_at:'2024-02-30T00:00:00+08:00'},
    {...window,view_mode:'event'},
    {as_of_at:start},
    {owner_id:'not-a-uuid'},
   ])assert.equal((await scoped(invalid,M)).status,422,JSON.stringify(invalid));
  });
  await t.test('all managed Open Leads satisfy the database chain invariant; histories are append-only',async()=>{
   for(const r of (await pool.query('SELECT lead_id FROM ms_workspace.lead_workflow WHERE organization_id=$1',[org])).rows)await pool.query('SELECT ms_workspace.assert_active_chain($1)',[r.lead_id]);
   await assert.rejects(pool.query('UPDATE ms_workspace.history SET state=\'bad\' WHERE record_id=$1',[trial.id]),/append only/);
   const client=await pool.connect();try{await client.query('BEGIN');const seed=await readFile(new URL('../fixtures/v34-demo-finance.sql',import.meta.url),'utf8');await client.query(seed);await client.query("UPDATE ms.user_role_grants SET revoked_at=now() WHERE user_id='34000000-0000-4000-8000-000000000015'");await client.query(seed);assert.equal((await client.query("SELECT count(*)::int n FROM ms.user_role_grants WHERE user_id='34000000-0000-4000-8000-000000000015' AND revoked_at IS NULL")).rows[0].n,0);}finally{await client.query('ROLLBACK');client.release();}
  });
 }finally{if(server)await new Promise(r=>server.close(r));await pool.end();}
});
function activeState(s){return ['open','in_progress','pending','confirmed','rescheduled'].includes(s);}
