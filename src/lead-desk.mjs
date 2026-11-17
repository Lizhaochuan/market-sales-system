// A single lead is the operator's workspace. Existing domain records remain
// transactional storage details, never separate conversion steps for sales.
import {fail,ownsLead,ownsStudent,sameOrgStaff} from './auth.mjs';
const sources=['市场活动','网络咨询','到店','转介绍','主动咨询','其他'];
const choices=entries=>entries.map(([id,display_name])=>({id,display_name}));
const communicationResults=choices([['not_connected','未接通'],['communicated','已沟通'],['message_left','已留言待回复'],['other','其他']]);
const salesStages=choices([['needs_discovery','待了解需求'],['needs_confirmed','需求已确认'],['trial_booked','已约试听'],['trial_completed','已完成试听'],['enrollment_pending_payment','报名待付款'],['enrolled','已报名'],['paused','暂缓'],['declined','明确不报名']]);
const followupOptions={communication_results:communicationResults,sales_stages:salesStages};
const flags={hold_active:true,release_eligible:false,external_authority_verified:false};
function check(b,keys){if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).some(k=>!keys.includes(k)))fail(422,'VALIDATION_ERROR','请核对填写内容');}
function text(x,max=500){if(typeof x!=='string'||!x.trim()||x.trim().length>max)fail(422,'VALIDATION_ERROR','内容为空或过长');return x.trim();}
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
async function event(c,ctx,id,name,body){await c.query(`INSERT INTO ms.audit_events
 (organization_id,actor_user_id,target_type,target_id,event_name,after_business_json,reason_zh)
 VALUES($1,$2,'lead',$3,$4,$5,$6)`,[ctx.user.organization_id,ctx.user.id,id,name,body,'隔离销售跟进记录']);}
async function lead(c,ctx,id,lock=false){
 if(!uuid(id))fail(422,'VALIDATION_ERROR','线索编号错误');
 await ownsLead(c,ctx,id);
 return (await c.query(`SELECT * FROM ms.leads WHERE id=$1${lock?' FOR UPDATE':''}`,[id])).rows[0];
}
// Sales observations are independent of academic/finance authority. Old mixed
// results cannot safely be inferred as stages or classified communication facts.
async function currentSalesStage(c,ctx,id){
 const r=await c.query(`SELECT after_business_json AS report FROM ms.audit_events
  WHERE organization_id=$1 AND target_type='lead' AND target_id=$2
  AND event_name IN ('LEAD_DESK_CREATED','LEAD_DESK_FOLLOWUP_V2')
  AND after_business_json ? 'sales_stage' ORDER BY happened_at DESC,id DESC LIMIT 1`,[ctx.user.organization_id,id]);
 return {sales_stage:r.rows[0]?.report.sales_stage??'unclassified',stage_version:r.rows[0]?.report.stage_version??0,sales_stage_basis:r.rows[0]?.report.sales_stage&&r.rows[0].report.sales_stage!=='unclassified'?'SALES_REPORTED':'UNCLASSIFIED'};
}
async function studentChoices(c,ctx,id){return (await c.query(`SELECT s.id,s.display_name FROM ms.lead_students ls
 JOIN ms.students s ON s.id=ls.student_id WHERE ls.lead_id=$1 AND s.organization_id=$2 AND s.archived_at IS NULL
 AND (s.owner_user_id=$3 OR $4::boolean) ORDER BY s.id`,[id,ctx.user.organization_id,ctx.user.id,ctx.manager])).rows;}
async function context(c,ctx,l,b){
 let choices=await studentChoices(c,ctx,l.id),student;
 if(b.student_id){student=choices.find(s=>s.id===b.student_id);if(!student)fail(403,'FORBIDDEN','学生不属于当前线索可操作范围');}
 else if(choices.length===1)student=choices[0];
 else if(choices.length>1)fail(422,'STUDENT_REQUIRED','请选择本次涉及的学生');
 else{
  if(!b.student_name)fail(422,'STUDENT_REQUIRED','预约课程前补充学生姓名即可');
  student=(await c.query(`INSERT INTO ms.students(organization_id,display_name,owner_user_id)
   VALUES($1,$2,$3) RETURNING id,display_name`,[ctx.user.organization_id,text(b.student_name,120),l.owner_user_id])).rows[0];
  await c.query("INSERT INTO ms.lead_students(lead_id,student_id,confirmation_state) VALUES($1,$2,'pending_review')",[l.id,student.id]);
 }
 const s=await ownsStudent(c,ctx,student.id);
 if(!ctx.manager&&s.owner_user_id!==ctx.user.id)fail(403,'FORBIDDEN','只有负责人可以操作');
 const hold=await c.query("SELECT 1 FROM ms.lead_student_downstream_correction_cases WHERE student_id=$1 AND status IN('pending','hold_active') LIMIT 1",[student.id]);
 if(hold.rowCount)fail(409,'HOLD_ACTIVE','该学生正在隔离核查，暂不能推进');
 let opp=(await c.query('SELECT id FROM ms.opportunities WHERE originating_lead_id=$1 AND student_id=$2 AND owner_user_id=$3 ORDER BY created_at,id LIMIT 1',[l.id,student.id,l.owner_user_id])).rows[0];
 if(!opp)opp=(await c.query('INSERT INTO ms.opportunities(student_id,owner_user_id,originating_lead_id) VALUES($1,$2,$3) RETURNING id',[student.id,l.owner_user_id,l.id])).rows[0];
 return {student_id:student.id,opportunity_id:opp.id};
}
export async function leadDesk(c,ctx,{method,parts,body},workspace){
 const [,id,action]=parts,org=ctx.user.organization_id,actor=ctx.user.id;
 if(method==='GET'&&!id){
  const r=await c.query(`SELECT l.id,l.lead_state,l.owner_user_id,l.created_at,co.display_name AS contact_name,u.display_name AS owner_name,
   e.event_type AS original_source,e.original_source_text AS original_notes,
   (SELECT a.after_business_json FROM ms.audit_events a WHERE a.target_type='lead' AND a.target_id=l.id AND a.organization_id=$1
    AND a.event_name='LEAD_DESK_CREATED' ORDER BY a.happened_at,a.id LIMIT 1) AS origin,
   (SELECT a.after_business_json FROM ms.audit_events a WHERE a.target_type='lead' AND a.target_id=l.id AND a.organization_id=$1
    AND a.event_name IN ('LEAD_DESK_CREATED','LEAD_DESK_SOURCE','LEAD_SOURCE_UPDATED') ORDER BY a.happened_at DESC,a.id DESC LIMIT 1) AS source,
   (SELECT a.after_business_json FROM ms.audit_events a WHERE a.target_type='lead' AND a.target_id=l.id AND a.organization_id=$1
    AND a.event_name='LEAD_DESK_LOST' ORDER BY a.happened_at DESC,a.id DESC LIMIT 1) AS lost,
   (SELECT a.after_business_json FROM ms.audit_events a WHERE a.target_type='lead' AND a.target_id=l.id AND a.organization_id=$1 AND a.event_name IN ('LEAD_DESK_FOLLOWUP','LEAD_DESK_FOLLOWUP_V2') ORDER BY a.happened_at DESC,a.id DESC LIMIT 1) AS followup,
   COALESCE(stage.report->>'sales_stage','unclassified') AS sales_stage,
   COALESCE((stage.report->>'stage_version')::integer,0) AS stage_version,
   CASE WHEN stage.report IS NULL OR stage.report->>'sales_stage'='unclassified' THEN 'UNCLASSIFIED' ELSE 'SALES_REPORTED' END AS sales_stage_basis,
   (SELECT count(*)::integer FROM ms.sale_events se JOIN ms.opportunities o ON o.id=(SELECT so.opportunity_id FROM ms.sales_orders so WHERE so.id=se.order_id)
     WHERE o.originating_lead_id=l.id) AS won_count
   ,(SELECT sum(se.recognized_amount_cents)::text FROM ms.sale_events se JOIN ms.sales_orders so ON so.id=se.order_id JOIN ms.opportunities o ON o.id=so.opportunity_id WHERE o.originating_lead_id=l.id) AS won_amount_cents
   FROM ms.leads l LEFT JOIN ms.contacts co ON co.id=l.contact_id
   LEFT JOIN ms.contact_events e ON e.id=l.source_event_id LEFT JOIN ms.staff_users u ON u.id=l.owner_user_id
   LEFT JOIN LATERAL (SELECT a.after_business_json AS report FROM ms.audit_events a
    WHERE a.organization_id=$1 AND a.target_type='lead' AND a.target_id=l.id
    AND a.event_name IN ('LEAD_DESK_CREATED','LEAD_DESK_FOLLOWUP_V2') AND a.after_business_json ? 'sales_stage'
    ORDER BY a.happened_at DESC,a.id DESC LIMIT 1) stage ON true
   WHERE l.organization_id=$1 AND (l.owner_user_id=$2 OR $3::boolean) ORDER BY l.created_at DESC,l.id LIMIT 500`,[org,actor,ctx.manager]);
  return {...flags,followup_options:followupOptions,items:r.rows,staff:ctx.manager?(await c.query("SELECT id,display_name FROM ms.staff_users WHERE organization_id=$1 AND status='active' ORDER BY display_name",[org])).rows:[]};
 }
 if(method==='POST'&&!id){
  check(body,['contact_name','student_name','origin_group','source','notes','owner_user_id']);
  if(!['market','sales'].includes(body.origin_group)||!sources.includes(body.source))fail(422,'VALIDATION_ERROR','请选择来源');
  const owner=body.owner_user_id||actor;
  if(!uuid(owner))fail(422,'VALIDATION_ERROR','负责人编号错误');
  if(owner!==actor&&!ctx.manager)fail(403,'FORBIDDEN','只有主管可以分配给其他销售');
  await sameOrgStaff(c,ctx,owner);
  const co=(await c.query('INSERT INTO ms.contacts(organization_id,display_name,created_by) VALUES($1,$2,$3) RETURNING id',[org,text(body.contact_name,120),owner])).rows[0];
  const notes=body.notes?text(body.notes,1000):null;
  const e=(await c.query(`INSERT INTO ms.contact_events(organization_id,contact_id,event_type,occurred_at,recorded_by,original_source_text)
   VALUES($1,$2,$3,now(),$4,$5) RETURNING id`,[org,co.id,body.source,owner,notes])).rows[0];
  const l=(await c.query(`INSERT INTO ms.leads(organization_id,contact_id,source_event_id,owner_user_id,lead_state)
   VALUES($1,$2,$3,$4,'working') RETURNING id`,[org,co.id,e.id,owner])).rows[0];
  await event(c,ctx,l.id,'LEAD_DESK_CREATED',{origin_group:body.origin_group,source:body.source,sales_stage:'needs_discovery',stage_version:0});
  if(body.student_name){
   const s=(await c.query('INSERT INTO ms.students(organization_id,display_name,owner_user_id) VALUES($1,$2,$3) RETURNING id',[org,text(body.student_name,120),owner])).rows[0];
   await c.query("INSERT INTO ms.lead_students(lead_id,student_id,confirmation_state) VALUES($1,$2,'pending_review')",[l.id,s.id]);
  }
  return {...flags,lead_id:l.id};
 }
 const l=await lead(c,ctx,id,method==='POST');
 if(method==='GET'&&!action){
  const students=await studentChoices(c,ctx,id);
  const records=(await c.query(`SELECT r.* FROM ms_workspace.records r JOIN ms.opportunities o ON o.id=r.opportunity_id
   JOIN ms.students s ON s.id=r.student_id WHERE o.originating_lead_id=$1 AND r.organization_id=$2
   AND (r.owner_user_id=$3 OR $4::boolean) AND s.archived_at IS NULL AND(s.owner_user_id=$3 OR $4::boolean)
   ORDER BY r.created_at DESC,r.id`,[id,org,actor,ctx.manager])).rows;
  const events=(await c.query(`SELECT event_name,after_business_json,happened_at FROM ms.audit_events WHERE organization_id=$1
   AND target_type='lead' AND target_id=$2 AND event_name LIKE 'LEAD_DESK_%' ORDER BY happened_at DESC,id DESC`,[org,id])).rows;
  return {...flags,...await currentSalesStage(c,ctx,id),students,records,events};
 }
 if(method!=='POST'||!action)fail(404,'NOT_FOUND','没有找到该操作');
 if(['closed','invalid','converted'].includes(l.lead_state))fail(409,'LEAD_CLOSED','已结束的线索不能继续修改');
 if(action==='source'){
  check(body,['source']);if(!sources.includes(body.source))fail(422,'VALIDATION_ERROR','请选择来源');
  await event(c,ctx,id,'LEAD_SOURCE_UPDATED',{source:body.source});return {...flags};
 }
 if(action==='followup'){
  check(body,['result','sales_stage','expected_stage_version','notes','next_at','next_action']);
  if(!communicationResults.some(r=>r.id===body.result))fail(422,'VALIDATION_ERROR','请选择本次沟通结果');
  const notes=body.notes?text(body.notes,1000):null;
  if(body.result==='other'&&!notes)fail(422,'VALIDATION_ERROR','选择其他沟通结果时请填写说明');
  const current=await currentSalesStage(c,ctx,id),stage=body.sales_stage??current.sales_stage;
  if(!salesStages.some(s=>s.id===stage)&&!(stage==='unclassified'&&current.sales_stage==='unclassified'))fail(422,'VALIDATION_ERROR','请选择当前销售阶段');
  if((body.sales_stage!==undefined||body.expected_stage_version!==undefined)&&(!Number.isSafeInteger(body.expected_stage_version)||body.expected_stage_version!==current.stage_version))fail(409,'VERSION_CONFLICT','客户阶段已更新，请刷新后再保存，避免覆盖新阶段');
  let next=null;if(body.next_at){if(!Number.isFinite(Date.parse(body.next_at)))fail(422,'VALIDATION_ERROR','请选择下次跟进时间');next=new Date(body.next_at).toISOString();}
  const report={schema_version:2,result:body.result,sales_stage:stage,previous_sales_stage:current.sales_stage,
   stage_version:current.stage_version+1,sales_stage_basis:stage==='unclassified'?'UNCLASSIFIED':'SALES_REPORTED',
   notes,next_at:next,next_action:body.next_action?text(body.next_action,300):null};
  await event(c,ctx,id,'LEAD_DESK_FOLLOWUP_V2',report);
  return {...flags,...report};
 }
 if(action==='lost'){
  check(body,['reason']);if(!['暂无需求','价格原因','时间不合适','无法联系','选择其他机构','其他'].includes(body.reason))fail(422,'VALIDATION_ERROR','请选择流失原因');
  const paid=await c.query('SELECT 1 FROM ms.sale_events se JOIN ms.sales_orders so ON so.id=se.order_id JOIN ms.opportunities o ON o.id=so.opportunity_id WHERE o.originating_lead_id=$1 LIMIT 1',[id]);
  if(paid.rowCount)fail(409,'AUTHORITY_REQUIRED','已有正式成交记录，不能改成流失');
  await c.query("UPDATE ms.leads SET lead_state='closed' WHERE id=$1",[id]);
  await event(c,ctx,id,'LEAD_DESK_LOST',{reason:body.reason});return {...flags};
 }
 if(action==='trial'||action==='quote'){
  check(body,['student_id','student_name',...(action==='trial'?['requested_slot_at']:['items'])]);
  const link=await context(c,ctx,l,body);
  const b=action==='trial'?{...link,title:'试听申请',requested_slot_at:body.requested_slot_at}:
   {...link,title:'课程方案',valid_until:new Date(Date.now()+7*86400000).toISOString(),items:body.items};
  const saved=await workspace(c,{...ctx,workspaceOwner:l.owner_user_id},{method:'POST',parts:[action==='trial'?'trials':'quotes'],body:b});
  await event(c,ctx,id,action==='trial'?'LEAD_DESK_TRIAL':'LEAD_DESK_QUOTE',{record_id:saved.item.id});return saved;
 }
 if(action==='revise-quote'){
  check(body,['quote_id','expected_version','items']);
  if(!uuid(body.quote_id))fail(422,'VALIDATION_ERROR','课程方案编号错误');
  const q=(await c.query(`SELECT r.* FROM ms_workspace.records r JOIN ms.opportunities o ON o.id=r.opportunity_id
   WHERE r.id=$1 AND r.kind='quotes' AND o.originating_lead_id=$2 AND r.organization_id=$3`,[body.quote_id,id,org])).rows[0];
  if(!q)fail(404,'NOT_FOUND','未找到当前客户的课程方案');
  await context(c,ctx,l,{student_id:q.student_id});
  return workspace(c,ctx,{method:'POST',parts:['quotes',q.id],body:{title:q.body.title,student_id:q.student_id,opportunity_id:q.opportunity_id,items:body.items,valid_until:q.body.valid_until,expected_version:body.expected_version}});
 }
 if(action==='deal'){
  check(body,['quote_id','quote_version']);
  const quote=(await c.query(`SELECT r.* FROM ms_workspace.records r JOIN ms.opportunities o ON o.id=r.opportunity_id
   WHERE r.id=$1 AND r.kind='quotes' AND o.originating_lead_id=$2 AND r.organization_id=$3`,[body.quote_id,id,org])).rows[0];
  if(!quote)fail(404,'NOT_FOUND','请选择当前客户的课程方案');
  if(!Number.isSafeInteger(body.quote_version)||quote.version!==body.quote_version||quote.state!=='draft'||Date.parse(quote.body.valid_until)<=Date.now())fail(409,'STALE_QUOTE','课程方案已变更或到期，请刷新后确认');
  const linked=await context(c,ctx,l,{student_id:quote.student_id});
  const existing=await c.query(`SELECT * FROM ms_workspace.records WHERE kind='order-intents' AND organization_id=$1
   AND opportunity_id=$2 AND body->>'quote_id'=$3 AND body->>'quote_version'=$4 AND state='draft'`,[org,linked.opportunity_id,quote.id,String(body.quote_version)]);
  if(existing.rowCount)return {...flags,payment_confirmation:'PENDING',item:existing.rows[0]};
  const saved=await workspace(c,{...ctx,workspaceOwner:l.owner_user_id},{method:'POST',parts:['order-intents'],body:{...linked,title:'报名确认',quote_id:quote.id,quote_version:body.quote_version}});
  await event(c,ctx,id,'LEAD_DESK_DEAL_REQUESTED',{record_id:saved.item.id});
  return {...saved,payment_confirmation:'PENDING'};
 }
 fail(404,'NOT_FOUND','该操作未开放');
}
