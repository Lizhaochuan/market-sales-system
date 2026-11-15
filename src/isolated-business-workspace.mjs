// Explicit opt-in fictional planning workspace. Never calls CRM, finance or messaging.
import {randomUUID,createHash} from 'node:crypto';
import {fail,ownsStudent,ownsOpportunity} from './auth.mjs';

const kinds=new Set(['tasks','trials','quotes','order-intents','expense-plans','automation-rules']);
const flags={scope:'FICTIONAL_PLANNING_ONLY',hold_active:true,release_eligible:false,
 external_authority_verified:false,finance_authorized:false,academic_authorized:false};
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(x);
const invalid=()=>fail(422,'VALIDATION_ERROR','请核对字段、金额、时间与所选学生');
function text(x,max=500){if(typeof x!=='string'||!x.trim()||x.trim().length>max)invalid();return x.trim();}
function integer(x,max=9_000_000_000_000,min=0){if(!Number.isSafeInteger(x)||x<min||x>max)invalid();return x;}
function date(x){if(typeof x!=='string'||!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(x)||!Number.isFinite(Date.parse(x)))invalid();return new Date(x).toISOString();}
function fields(body,names){if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!names.includes(k)))invalid();}
async function scope(c,ctx,body){
 let student=null,opportunity=null;
 if(body.student_id!=null){if(!uuid(body.student_id))invalid();student=await ownsStudent(c,ctx,body.student_id);
  // Additional shared read permission is not permission to create workflow writes.
  if(!ctx.manager&&student.owner_user_id!==ctx.user.id)fail(403,'FORBIDDEN','仅负责人可操作该学生的业务草稿');}
 if(body.opportunity_id!=null){if(!uuid(body.opportunity_id))invalid();opportunity=await ownsOpportunity(c,ctx,body.opportunity_id);
  if(student&&opportunity.student_id!==student.id)invalid();
  if(!student)student=await ownsStudent(c,ctx,opportunity.student_id);}
 return {studentId:student?.id??null,opportunityId:opportunity?.id??null};
}
async function visibleRecord(c,ctx,id,kind,lock=false){
 if(!uuid(id))invalid();
 const r=await c.query(`SELECT * FROM ms_workspace.records WHERE id=$1 AND kind=$2 AND organization_id=$3
  AND (owner_user_id=$4 OR $5::boolean)${lock?' FOR UPDATE':''}`,
 [id,kind,ctx.user.organization_id,ctx.user.id,ctx.manager]);
 if(!r.rowCount)fail(404,'NOT_FOUND','未找到有权操作的业务记录');
 await scope(c,ctx,r.rows[0]);return r.rows[0];
}
async function save(c,ctx,{id=randomUUID(),kind,state,body,studentId=null,opportunityId=null,dedupeKey=null}){
 const r=await c.query(`INSERT INTO ms_workspace.records
  (id,organization_id,owner_user_id,kind,state,body,student_id,opportunity_id,dedupe_key)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(organization_id,owner_user_id,dedupe_key) DO NOTHING RETURNING *`,
 [id,ctx.user.organization_id,ctx.user.id,kind,state,body,studentId,opportunityId,dedupeKey]);
 if(!r.rowCount)return null;
 await history(c,ctx,r.rows[0]);return r.rows[0];
}
async function history(c,ctx,row){
 await c.query(`INSERT INTO ms_workspace.history(record_id,version,actor_user_id,state,body)
  VALUES($1,$2,$3,$4,$5)`,[row.id,row.version,ctx.user.id,row.state,row.body]);
}
async function normalize(c,ctx,kind,b){
 const base=['student_id','opportunity_id','title','expected_version'];
 const allowed={tasks:['due_at'],trials:['requested_slot_at'],quotes:['items','valid_until'],
  'order-intents':['quote_id','quote_version'],'expense-plans':['amount_cents','purpose'],
  'automation-rules':['action','inactive_days','due_in_days','enabled']};
 fields(b,[...base,...allowed[kind]]);
 const linked=await scope(c,ctx,b);
 const body={title:text(b.title,120)};
 if(kind==='tasks')body.due_at=b.due_at==null?null:date(b.due_at);
 if(kind==='trials'){
  if(!linked.studentId)invalid();body.requested_slot_at=date(b.requested_slot_at);
  body.crm_status='NOT_CONNECTED';
 }
 if(kind==='quotes'){
  if(!linked.studentId||!linked.opportunityId||!Array.isArray(b.items)||b.items.length<1||b.items.length>30)invalid();
  body.items=b.items.map(item=>{
   fields(item,['course_label','quantity','proposed_unit_cents']);
   const quantity=integer(item.quantity,10000,1),unit=integer(item.proposed_unit_cents);
   const line=integer(quantity*unit);
   return {course_label:text(item.course_label,120),quantity,proposed_unit_cents:unit,line_cents:line};
  });
  body.total_cents=integer(body.items.reduce((sum,item)=>sum+item.line_cents,0));
  body.valid_until=date(b.valid_until);body.price_status='UNVERIFIED_PROPOSAL';
  body.discount_policy='NOT_APPROVED';
 }
 if(kind==='order-intents'){
  const quote=await visibleRecord(c,ctx,b.quote_id,'quotes');
  if(quote.version!==b.quote_version||quote.state!=='draft'||Date.parse(quote.body.valid_until)<=Date.now())
   fail(409,'STALE_QUOTE','报价草稿已更新、取消或到期，请重新核对');
  if(quote.student_id!==linked.studentId||quote.opportunity_id!==linked.opportunityId)invalid();
  body.quote_id=quote.id;body.quote_version=quote.version;body.quote_snapshot=quote.body;
  body.amount_cents=quote.body.total_cents;body.payment_state='NOT_COLLECTED';body.fulfillment_state='NOT_REQUESTED';
 }
 if(kind==='expense-plans'){
  body.amount_cents=integer(b.amount_cents);body.purpose=text(b.purpose);
  body.finance_status='NOT_AUTHORIZED';
 }
 if(kind==='automation-rules'){
  if(b.action!=='create_followup_task'||typeof b.enabled!=='boolean'||linked.studentId||linked.opportunityId)invalid();
  body.action=b.action;body.inactive_days=integer(b.inactive_days,365,1);
  body.due_in_days=integer(b.due_in_days,30,0);body.enabled=b.enabled;
 }
 return {body,...linked};
}
const stateFor=kind=>kind==='tasks'?'open':kind==='automation-rules'?'configured':'draft';
export async function workspaceOperation(c,ctx,{method,parts,body}){
 const [kind,id,action]=parts;
 if(method==='GET'&&kind==='summary'&&!id)return summary(c,ctx);
 if(method==='GET'&&kind==='interactions'&&!id){
  // Whole interaction text belongs to its recorder; sharing a student alone
  // must not disclose a sibling's or another employee's conversation details.
  const r=await c.query(`SELECT i.id,i.summary,i.contact_method,i.occurred_at FROM ms.interactions i
   WHERE i.organization_id=$1 AND (i.recorded_by=$2 OR $3::boolean)
   ORDER BY i.occurred_at DESC,i.id LIMIT 500`,[ctx.user.organization_id,ctx.user.id,ctx.manager]);
  return {...flags,items:r.rows};
 }
 if(method==='POST'&&kind==='automation'&&id==='run'&&!action){
  fields(body,[]);return runAutomation(c,ctx);
 }
 if(kind==='pipeline'){
  if(parts.length>2)fail(404,'NOT_FOUND','未找到该商机操作');
  return pipeline(c,ctx,{method,id,body});
 }
 if(!kinds.has(kind)||parts.length>3)fail(404,'NOT_FOUND','未找到该业务入口');
 if(method==='GET'){
  if(id&&action==='history'){
   await visibleRecord(c,ctx,id,kind);
   const r=await c.query('SELECT version,state,body,recorded_at FROM ms_workspace.history WHERE record_id=$1 ORDER BY version',[id]);
   return {...flags,items:r.rows};
  }
  if(id&&!action)return {...flags,item:await visibleRecord(c,ctx,id,kind)};
  if(action)fail(404,'NOT_FOUND','未找到该业务入口');
  const r=await c.query(`SELECT r.* FROM ms_workspace.records r
   LEFT JOIN ms.students s ON s.id=r.student_id LEFT JOIN ms.opportunities o ON o.id=r.opportunity_id
   WHERE r.organization_id=$1 AND (r.owner_user_id=$2 OR $3::boolean)
   AND r.kind=$4 AND (r.student_id IS NULL OR (s.archived_at IS NULL AND s.organization_id=$1 AND (s.owner_user_id=$2 OR $3::boolean)))
   AND (r.opportunity_id IS NULL OR (o.owner_user_id=$2 OR $3::boolean)) ORDER BY r.created_at DESC,r.id LIMIT 500`,
  [ctx.user.organization_id,ctx.user.id,ctx.manager,kind]);
  return {...flags,items:r.rows};
 }
 if(method!=='POST')fail(404,'NOT_FOUND','不支持该业务操作');
 // Serialize the actor's writes and background scans to keep dedupe predictable.
 await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[ctx.user.organization_id+':'+ctx.user.id]);
 if(!id){const normalized=await normalize(c,ctx,kind,body);
  return {...flags,item:await save(c,ctx,{kind,state:stateFor(kind),...normalized})};}
 const old=await visibleRecord(c,ctx,id,kind,true);
 integer(body?.expected_version,2147483647,1);
 if(body.expected_version!==old.version)fail(409,'VERSION_CONFLICT','记录已更新，请刷新后重试');
 if(['completed','cancelled'].includes(old.state))fail(409,'TERMINAL_RECORD','已结束记录不能修改');
 let nextBody,state=old.state;
 if(action==='state'){
  fields(body,['expected_version','state']);
  if(!(kind==='tasks'?['completed','cancelled']:['cancelled']).includes(body.state))invalid();
  state=body.state;nextBody=old.body;
 }else if(!action){
  if(kind==='order-intents')fail(409,'IMMUTABLE_INTENT','报名意向保存后只能取消；新报价须新建意向');
  const normalized=await normalize(c,ctx,kind,body);
  if(normalized.studentId!==old.student_id||normalized.opportunityId!==old.opportunity_id)invalid();
  nextBody=normalized.body;
 }else fail(404,'NOT_FOUND','未找到该业务操作');
 const r=await c.query(`UPDATE ms_workspace.records SET body=$2,state=$3,version=version+1,updated_at=now()
  WHERE id=$1 RETURNING *`,[id,nextBody,state]);
 await history(c,ctx,r.rows[0]);return {...flags,item:r.rows[0]};
}
async function pipeline(c,ctx,{method,id,body}){
 if(method==='GET'&&!id){
  const r=await c.query(`SELECT o.id,o.student_id,s.display_name AS student_name,o.stage,o.lifecycle_state,
   o.predicted_amount_cents,o.version,o.updated_at FROM ms.opportunities o JOIN ms.students s ON s.id=o.student_id
   WHERE s.organization_id=$1 AND s.archived_at IS NULL AND (o.owner_user_id=$2 OR $3::boolean)
   ORDER BY o.created_at DESC,o.id LIMIT 500`,[ctx.user.organization_id,ctx.user.id,ctx.manager]);
  return {...flags,items:r.rows};
 }
 if(method!=='POST'||!uuid(id))fail(404,'NOT_FOUND','未找到商机操作');
 fields(body,['expected_version','stage','lifecycle_state','reason']);
 await ownsOpportunity(c,ctx,id);
 const stages=['new','contacted','needs_analysis','proposal','negotiation'];
 if(!stages.includes(body.stage)||!['open','paused','lost'].includes(body.lifecycle_state))
  fail(422,'AUTHORITY_REQUIRED','仅可更新销售跟进阶段；试听完成和正式成交须由外部权威确认');
 const expected=integer(body.expected_version,2147483647,1),reason=text(body.reason);
 const old=(await c.query('SELECT * FROM ms.opportunities WHERE id=$1 FOR UPDATE',[id])).rows[0];
 const holds=await c.query(`SELECT 1 FROM ms.lead_student_downstream_correction_cases
  WHERE student_id=$1 AND status IN ('pending','hold_active') LIMIT 1`,[old.student_id]);
 if(holds.rowCount)fail(409,'HOLD_ACTIVE','学生关联正在隔离核查，不能推进商机');
 if(old.version.toString()!==expected.toString())fail(409,'VERSION_CONFLICT','商机已更新，请刷新重试');
 if(!['open','paused'].includes(old.lifecycle_state))fail(409,'TERMINAL_RECORD','已结束商机不能在此重开');
 const r=await c.query(`UPDATE ms.opportunities SET stage=$2,lifecycle_state=$3,version=version+1,updated_at=now() WHERE id=$1 RETURNING id,stage,lifecycle_state,version`,
 [id,body.stage,body.lifecycle_state]);
 await c.query(`INSERT INTO ms.opportunity_stage_history(opportunity_id,from_stage,to_stage,changed_by,reason)
  VALUES($1,$2,$3,$4,$5)`,[id,old.stage,body.stage,ctx.user.id,reason]);
 await c.query(`INSERT INTO ms.audit_events(organization_id,actor_user_id,target_type,target_id,event_name,before_business_json,after_business_json,reason_zh)
  VALUES($1,$2,'opportunity',$3,'isolated_pipeline_changed',$4,$5,$6)`,
 [ctx.user.organization_id,ctx.user.id,id,old,r.rows[0],reason]);
 return {...flags,item:r.rows[0]};
}
async function runAutomation(c,ctx){
 await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[ctx.user.organization_id+':'+ctx.user.id]);
 const rules=(await c.query(`SELECT * FROM ms_workspace.records WHERE organization_id=$1 AND owner_user_id=$2
  AND kind='automation-rules' AND state='configured' AND body->>'enabled'='true' ORDER BY id LIMIT 50`,[ctx.user.organization_id,ctx.user.id])).rows;
 let created=0;
 for(const rule of rules){
  const candidates=(await c.query(`SELECT o.id,o.student_id,o.updated_at FROM ms.opportunities o JOIN ms.students s ON s.id=o.student_id
   WHERE o.owner_user_id=$1 AND s.organization_id=$2 AND s.archived_at IS NULL AND o.lifecycle_state='open'
   AND o.updated_at<now()-($3::integer*interval '1 day') ORDER BY o.updated_at,o.id LIMIT 500`,
  [ctx.user.id,ctx.user.organization_id,rule.body.inactive_days])).rows;
  for(const o of candidates){
   const dedupeKey=createHash('sha256').update([rule.id,rule.version,o.id,o.updated_at.toISOString()].join('|')).digest('hex');
   const item=await save(c,ctx,{kind:'tasks',state:'open',studentId:o.student_id,opportunityId:o.id,
    dedupeKey,body:{title:'跟进提醒：'+rule.body.title,due_at:new Date(Date.now()+rule.body.due_in_days*86400000).toISOString(),
     automation_rule_id:rule.id,automation_rule_version:rule.version}});
   if(item)created++;
  }
 }
 return {...flags,created,delivery:'IN_APP_ONLY'};
}
async function summary(c,ctx){
 const org=ctx.user.organization_id,actor=ctx.user.id,manager=ctx.manager;
 const pipelineResult=await pipeline(c,ctx,{method:'GET'});
 const forecast=(await c.query(`SELECT count(*)::integer AS open_opportunities,
  COALESCE(sum(o.predicted_amount_cents),0)::text AS forecast_cents
  FROM ms.opportunities o JOIN ms.students s ON s.id=o.student_id
  WHERE s.organization_id=$1 AND s.archived_at IS NULL AND o.lifecycle_state='open'
  AND (o.owner_user_id=$2 OR $3::boolean)`,[org,actor,manager])).rows[0];
 const records=(await c.query(`SELECT r.* FROM ms_workspace.records r LEFT JOIN ms.students s ON s.id=r.student_id
  LEFT JOIN ms.opportunities o ON o.id=r.opportunity_id WHERE r.organization_id=$1 AND (r.owner_user_id=$2 OR $3::boolean)
  AND (r.student_id IS NULL OR (s.organization_id=$1 AND s.archived_at IS NULL AND (s.owner_user_id=$2 OR $3::boolean)))
  AND (r.opportunity_id IS NULL OR (o.owner_user_id=$2 OR $3::boolean))`,[org,actor,manager])).rows;
 const counts=Object.fromEntries([...kinds].map(kind=>[kind,records.filter(r=>r.kind===kind&&r.state!=='cancelled').length]));
 const openTasks=records.filter(r=>r.kind==='tasks'&&r.state==='open');
 return {...flags,counts,overdue_tasks:openTasks.filter(r=>r.body.due_at&&Date.parse(r.body.due_at)<Date.now()).length,
  open_tasks:openTasks.length,pipeline:pipelineResult.items,
  forecast_cents:forecast.forecast_cents,open_opportunities:forecast.open_opportunities,
  pipeline_display_limit:500,
  confirmed_revenue_cents:null,commission_cents:null,
  integrations:{crm:'NOT_CONNECTED',finance:'NOT_CONNECTED',iam:'UNVERIFIED',worm:'UNVERIFIED'},
  policies:{partial_payment_entitlement:false,automatic_shared_payment_allocation:false,old_quote_price_guaranteed:false,
   discount_approval:false,refund_commission_policy:'PENDING',cross_campus_access:false,real_import_or_marketing:false}};
}
