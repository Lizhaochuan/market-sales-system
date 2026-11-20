import {workspaceAccess,departmentRoute,prepareSalesIntake,phoneNumber,lockPhone,salesAssignee} from './role-workspaces.mjs';
// V3.4 standalone sales workflow. Reuses Lead, workspace records/history and the
// existing financial ledger. No CRM client, external sync or messaging exists here.
import {fail,sameOrgStaff,ownsStudent} from './auth.mjs';
import {leadDesk} from './lead-desk.mjs';
const flags={hold_active:true,release_eligible:false,external_authority_verified:false,scope:'ISOLATED_STANDALONE_SALES'};
const pairs=a=>a.map(([id,label])=>({id,label}));
export const methods=pairs([['phone','电话'],['wechat_text','微信文字'],['wechat_voice','微信语音'],['video','视频通话'],['online_other','其他线上方式'],['campus','家长到校面谈'],['visit','销售外出面谈'],['event','线下活动接触'],['offline_other','其他线下方式']]);
export const stages=pairs([['needs_discovery','待了解需求'],['needs_confirmed','需求已确认'],['courses_introduced','课程及价格已介绍'],['trial_booked','已预约试听'],['trial_completed','已完成试听'],['enrollment_intent','有报名意向'],['enrolling','报名办理中'],['paused','暂缓'],['declined','明确不报名']]);
export const actions=pairs([['call','再次电话联系'],['wechat','微信文字联系'],['voice','微信语音联系'],['video','视频沟通'],['check_reply','等待回复并到期检查'],['send_materials','发送课程资料'],['return_visit','回访家长'],['invite','邀约线下面谈'],['confirm_visit','确认家长到校时间'],['visit_reminder','到访前提醒'],['reschedule_visit','重新预约面谈'],['confirm_trial','确认试听日期'],['schedule_trial','安排试听'],['trial_reminder','试听前确认'],['trial_feedback','回访试听结果'],['repeat_trial','再次试听'],['confirm_course','确认课程方案'],['confirm_price','确认价格'],['confirm_agreement','确认报名协议'],['first_payment','跟进首笔付款'],['balance','跟进剩余学费'],['verify_enrollment','核实报名信息'],['manager_help','主管协助'],['coordination','内部协调'],['regular_visit','定期回访'],['custom','自定义动作']]);
const reasons={phone:['无人接听','被拒接','无法接通','联系方式无效','其他'],wechat_voice:['无人接听','被拒接','无法接通','联系方式无效','其他'],wechat_text:['消息发送失败','无法联系对方','其他'],video:['无人接听','连接失败','对方取消','其他'],offline:['未到场','对方取消','其他']};
const offline=m=>['campus','visit','event','offline_other'].includes(m);
const activeActivityStates=['open','in_progress','pending','confirmed','rescheduled'];
const active=r=>activeActivityStates.includes(r.state);
const isFinance=ctx=>ctx.roles.includes('finance_verifier');
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
function fields(b,keys){if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).some(k=>!keys.includes(k)))fail(422,'VALIDATION_ERROR','包含不支持的字段');}
function text(x,max=1000){if(typeof x!=='string'||!x.trim()||x.trim().length>max)fail(422,'VALIDATION_ERROR','请补充必填事项或说明');return x.trim();}
function date(x){if(typeof x!=='string'||!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(x)||!Number.isFinite(Date.parse(x)))fail(422,'DATE_REQUIRED','请选择明确的日期和时间');return new Date(x).toISOString();}
function money(x,min=0){if(!Number.isSafeInteger(x)||x<min||x>9_000_000_000_000)fail(422,'VALIDATION_ERROR','金额或课时数超出范围');return x;}
async function audit(c,ctx,l,name,b){await c.query(`INSERT INTO ms.audit_events(organization_id,actor_user_id,target_type,target_id,event_name,after_business_json,reason_zh) VALUES($1,$2,'lead',$3,$4,$5,$6)`,[ctx.user.organization_id,ctx.user.id,l.id,'V34_'+name,b,'独立市场销售端业务记录']);}
function auditWorkflow(c,ctx,l,name,workflow,data={}){
 return audit(c,ctx,l,name,{
  ...data,
  stage:workflow.stage,
  terminal_state:workflow.terminal_state,
  primary_activity_id:workflow.primary_activity_id,
  workflow_version:workflow.version,
 });
}
async function save(c,ctx,l,kind,state,body,{student=null,opp=null,dedupe=null}={}){
 const r=(await c.query(`INSERT INTO ms_workspace.records(organization_id,owner_user_id,lead_id,kind,state,body,student_id,opportunity_id,dedupe_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[l.organization_id,l.owner_user_id,l.id,kind,state,{...body,v34:true},student,opp,dedupe])).rows[0];await history(c,ctx,r);return r;
}
async function history(c,ctx,r){await c.query('INSERT INTO ms_workspace.history(record_id,version,actor_user_id,state,body) VALUES($1,$2,$3,$4,$5)',[r.id,r.version,ctx.user.id,r.state,r.body]);}
async function update(c,ctx,r,state,body){const n=(await c.query('UPDATE ms_workspace.records SET state=$2,body=$3,version=version+1,updated_at=now() WHERE id=$1 RETURNING *',[r.id,state,body])).rows[0];await history(c,ctx,n);return n;}
async function record(c,l,id,kind){if(!uuid(id))fail(422,'VALIDATION_ERROR','业务编号错误');const r=(await c.query('SELECT * FROM ms_workspace.records WHERE id=$1 AND lead_id=$2 AND organization_id=$3 FOR UPDATE',[id,l.id,l.organization_id])).rows[0];if(!r||kind&&r.kind!==kind)fail(404,'NOT_FOUND','未找到该客户的业务记录');return r;}
async function linked(c,ctx,l,b={}){
 let rows=(await c.query('SELECT s.id,s.display_name FROM ms.lead_students ls JOIN ms.students s ON s.id=ls.student_id WHERE ls.lead_id=$1 AND s.organization_id=$2 AND s.archived_at IS NULL ORDER BY s.id',[l.id,l.organization_id])).rows;
 const newName=typeof b.student_name==='string'&&b.student_name.trim()?text(b.student_name,120):null;if(b.student_id&&newName)fail(422,'VALIDATION_ERROR','已有学生无需重复填写姓名');
 let s=b.student_id?rows.find(s=>s.id===b.student_id):!newName&&rows.length===1?rows[0]:null;
 if(!s){if(b.student_id||!newName)fail(422,'STUDENT_REQUIRED','请选择学生，或补充一次学生姓名');s=(await c.query('INSERT INTO ms.students(organization_id,owner_user_id,display_name) VALUES($1,$2,$3) RETURNING id,display_name',[l.organization_id,l.owner_user_id,newName])).rows[0];await c.query("INSERT INTO ms.lead_students(lead_id,student_id,confirmation_state) VALUES($1,$2,'pending_review')",[l.id,s.id]);}
 if((await c.query("SELECT 1 FROM ms.lead_student_downstream_correction_cases WHERE student_id=$1 AND status IN('pending','hold_active')",[s.id])).rowCount)fail(409,'HOLD_ACTIVE','学生关联正在核查，不能推进下游业务');
 let o=(await c.query('SELECT id FROM ms.opportunities WHERE originating_lead_id=$1 AND student_id=$2 AND owner_user_id=$3 ORDER BY created_at LIMIT 1',[l.id,s.id,l.owner_user_id])).rows[0];
 if(!o)o=(await c.query('INSERT INTO ms.opportunities(student_id,owner_user_id,originating_lead_id) VALUES($1,$2,$3) RETURNING id',[s.id,l.owner_user_id,l.id])).rows[0];return {student:s.id,opp:o.id};
}
async function activity(c,ctx,l,b){
 fields(b,['id','action','title','method','due_at','owner_user_id','appointment']);
 if(b.appointment){if(Object.keys(b).length!==1)fail(422,'VALIDATION_ERROR','请选择预约或普通待办之一');return makeAppointment(c,ctx,l,b.appointment);}
 if(b.id){const r=await record(c,l,b.id);if(!['tasks','appointments'].includes(r.kind)||!active(r))fail(422,'NEXT_REQUIRED','所选活动已结束');return r;}
 if(!actions.some(a=>a.id===b.action)||!methods.some(m=>m.id===b.method))fail(422,'NEXT_REQUIRED','请选择下一步动作和联系方式');
 if(b.owner_user_id&&b.owner_user_id!==l.owner_user_id)fail(422,'NEXT_REQUIRED','下一步须由当前 Lead 负责人执行；转交需独立复核');
 return save(c,ctx,l,'tasks','open',{action:b.action,title:text(b.title,300),method:b.method,due_at:date(b.due_at),assignee_user_id:l.owner_user_id});
}
async function next(c,ctx,l,w,b,{required=false,except=null}={}){
 let r;if(b)r=await activity(c,ctx,l,b);else if(!required&&w.primary_activity_id)r=await record(c,l,w.primary_activity_id);
 if(!r||!active(r)||r.id===except)fail(422,'NEXT_REQUIRED','未结案必须安排下一步：事项、方式、日期时间和负责人');
 w.primary_activity_id=r.id;return r;
}
async function bump(c,ctx,l,w,name,body={}){const n=(await c.query('UPDATE ms_workspace.lead_workflow SET version=version+1,stage=$2,terminal_state=$3,primary_activity_id=$4,do_not_contact=$5,pause_reason=$6,updated_at=now() WHERE lead_id=$1 RETURNING *',[l.id,w.stage,w.terminal_state,w.primary_activity_id,w.do_not_contact,w.pause_reason])).rows[0];await auditWorkflow(c,ctx,l,name,n,body);return {...flags,workflow:n};}
async function closeActivities(c,ctx,l,why){for(const r of (await c.query("SELECT * FROM ms_workspace.records WHERE lead_id=$1 AND kind='corrections' AND state IN('pending','approved') AND body->>'type'='lead_transfer' FOR UPDATE",[l.id])).rows)await update(c,ctx,r,'cancelled',{...r.body,close_reason:why});for(const r of (await c.query("SELECT * FROM ms_workspace.records WHERE lead_id=$1 AND kind IN('tasks','appointments') AND state IN('open','in_progress','pending','confirmed','rescheduled') ORDER BY id FOR UPDATE",[l.id])).rows)await update(c,ctx,r,'cancelled',{...r.body,close_reason:why});}
const advanceTrialStage=(cur,target)=>['enrollment_intent','enrolling'].includes(cur)?cur:cur==='trial_completed'&&target==='trial_booked'?cur:target;
async function validateStage(c,l,stage){
 if(!stages.some(s=>s.id===stage)&&stage!=='unclassified')fail(422,'VALIDATION_ERROR','请选择销售进展');
 if(stage==='declined')fail(422,'CLOSURE_REQUIRED','明确不报名请使用有原因和反馈的结案确认');
 if(stage==='enrolling'&&!(await c.query("SELECT 1 FROM ms_workspace.records WHERE lead_id=$1 AND kind='enrollments' AND state<>'cancelled'",[l.id])).rowCount)fail(422,'ORDER_FACT_REQUIRED','请先提交报名协议与订单');
 if(['trial_booked','trial_completed'].includes(stage)){
  const r=await c.query(`SELECT 1 FROM ms_workspace.records WHERE lead_id=$1 AND kind='appointments' AND body->>'type'='trial' AND state=ANY($2::text[])`,[l.id,stage==='trial_completed'?['completed']:['confirmed','rescheduled','completed']]);
  if(!r.rowCount)fail(422,'TRIAL_FACT_REQUIRED',stage==='trial_completed'?'请先记录实际试听完成及反馈':'请先保存具体试听预约');
 }
}
function evidence(b){const ref=text(b.evidence_ref,500);if(!b.attachment)return {evidence_ref:ref};const a=b.attachment;fields(a,['name','mime','base64']);const name=text(a.name,120),mime=a.mime;if(!['image/png','image/jpeg','application/pdf'].includes(mime)||typeof a.base64!=='string'||!/^[A-Za-z0-9+/]+={0,2}$/.test(a.base64))fail(422,'VALIDATION_ERROR','仅支持 PNG、JPEG、PDF 凭证');const bytes=Buffer.from(a.base64,'base64');if(bytes.length>1_048_576||bytes.length<4)fail(422,'VALIDATION_ERROR','凭证须小于1MB');const valid=mime==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):mime==='image/jpeg'?bytes[0]===255&&bytes[1]===216:bytes.subarray(0,5).toString()==='%PDF-';if(!valid)fail(422,'VALIDATION_ERROR','凭证格式与文件内容不符');return {evidence_ref:ref,attachment:{name,mime,base64:a.base64}};}
async function enrollmentState(c,ctx,l,r){const o=(await c.query('SELECT * FROM ms.sales_orders WHERE id=$1 FOR UPDATE',[r.body.order_id])).rows[0];const pending=(await c.query("SELECT COALESCE(sum((p.body->>'amount_cents')::bigint-COALESCE((SELECT sum((r.body->>'amount_cents')::bigint) FROM ms_workspace.records r WHERE r.kind='refunds' AND r.state='verified' AND r.body->>'payment_id'=p.id::text),0)),0)::text AS n FROM ms_workspace.records p WHERE p.kind='payments' AND p.state='verified' AND p.body->>'enrollment_id'=$1 AND COALESCE(p.body->>'allocated','false')='false'",[r.id])).rows[0];const net=Number(o.net_allocated_cents)+Number(pending.n),due=Number(o.amount_due_cents);const state=r.state==='cancelled'?'cancelled':r.body.agreement_confirmed&&net>0?'successful':r.body.agreement_confirmed?'awaiting_payment':'awaiting_agreement';const first=state==='successful'&&!r.body.first_success_at;await c.query('UPDATE ms.sales_orders SET payment_state=$2,version=version+1,updated_at=now() WHERE id=$1',[o.id,Number(o.net_allocated_cents)===0?'unpaid':Number(o.net_allocated_cents)===due?'fully_paid':'partially_paid']);const body={...r.body,unallocated_verified_cents:Number(pending.n),net_cents:net,balance_cents:due-net,payment_state:net===0?'unpaid':net===due?'settled':'partially_paid',...(first?{first_success_at:new Date().toISOString()}:{} )};const n=await update(c,ctx,r,state,body);if(first)await audit(c,ctx,l,'ENROLLMENT_SUCCESS',{enrollment_id:r.id,student_id:r.student_id,order_id:o.id,amount_cents:net});return n;}
async function financialQueue(c,ctx){if(!isFinance(ctx)&&!ctx.manager)fail(403,'FORBIDDEN','仅授权核实员或主管可查看核实队列');const r=await c.query(`SELECT r.*,w.version AS workflow_version,s.display_name AS student_name FROM ms_workspace.records r JOIN ms.leads l ON l.id=r.lead_id JOIN ms_workspace.lead_workflow w ON w.lead_id=l.id LEFT JOIN ms.students s ON s.id=r.student_id WHERE l.organization_id=$1 AND r.kind IN('payments','refunds') AND r.state IN('pending','approved') ORDER BY r.created_at`,[ctx.user.organization_id]);return {...flags,items:r.rows,can_verify:isFinance(ctx)};}
export async function salesWorkflow(c,ctx,{method,parts,body,query}){
 const [,id,action]=parts,org=ctx.user.organization_id,actor=ctx.user.id;
 if(ctx.roleWorkspaces&&id!=='options'){const r=await departmentRoute(c,ctx,{method,parts,body},{activity,audit,auditWorkflow,initialCommunication});if(r.handled)return {...flags,...r.value};}
 if(method==='GET'&&id==='options')return {...flags,...(ctx.roleWorkspaces?{access:workspaceAccess(ctx)}:{}),methods,stages,actions,classrooms:[],failure_reasons:reasons,can_verify:isFinance(ctx),manager:ctx.manager,catalog:ctx.roleWorkspaces&&!workspaceAccess(ctx).sales?[]:(await c.query("SELECT id,version,body FROM ms_workspace.records WHERE organization_id=$1 AND kind='course-catalog' AND state='active' ORDER BY body->>'course_label'",[org])).rows};
 if(method==='POST'&&id==='catalog'){fields(body,['course_label','standard_unit_cents','reason','expected_version']);if(!ctx.manager)fail(403,'FORBIDDEN','本地标准价目由主管维护');await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[org+':catalog']);const name=text(body.course_label,120),unit=money(body.standard_unit_cents),old=(await c.query("SELECT * FROM ms_workspace.records WHERE organization_id=$1 AND kind='course-catalog' AND lower(body->>'course_label')=lower($2) FOR UPDATE",[org,name])).rows[0];if(old&&old.version!==body.expected_version)fail(409,'VERSION_CONFLICT','本地价格已更新');const b={course_label:name,standard_unit_cents:unit,price_source:'LOCAL_APPROVED_PRICE',approved_by:actor,reason:text(body.reason),v34:true};const r=old?await update(c,ctx,old,'active',b):await save(c,ctx,{id:null,organization_id:org,owner_user_id:actor},'course-catalog','active',b);return {...flags,item:r};}
 if(method==='GET'&&id==='finance')return financialQueue(c,ctx);
 if(method==='GET'&&id==='metrics'){
  if(isFinance(ctx)&&!ctx.manager)fail(403,'FORBIDDEN','收款核实员不可访问销售统计');
  if(action==='drilldown')return metricsDrilldown(c,ctx,query);
  if(!action)return metrics(c,ctx,query);
  fail(404,'NOT_FOUND','没有找到统计入口');
 }
 if(method==='GET'&&!id)return listing(c,ctx,query);
 if(method==='POST'&&!id){
  fields(body,['contact_name','student_name','student_id','origin_group','source','notes','owner_user_id','contact_info','next','initial_communication']);
  if(isFinance(ctx)&&!ctx.manager)fail(403,'FORBIDDEN','收款核实员不应创建销售客户');
  const normalizedPhone=ctx.roleWorkspaces?await prepareSalesIntake(c,ctx,body):null;
  const {contact_info,student_id,next:arrangement,initial_communication,...intake}=body;
  if(student_id&&body.student_name)fail(422,'VALIDATION_ERROR','已有学生无需重复填写姓名');
  const created=await leadDesk(c,ctx,{method:'POST',parts:['leads'],body:intake});
  const l=(await c.query('SELECT * FROM ms.leads WHERE id=$1 FOR UPDATE',[created.lead_id])).rows[0];
  if(student_id){const s=await ownsStudent(c,ctx,student_id);if(s.owner_user_id!==l.owner_user_id)fail(403,'FORBIDDEN','已有学生须由当前负责人接单，转交需独立复核');await c.query("INSERT INTO ms.lead_students(lead_id,student_id,confirmation_state) VALUES($1,$2,'pending_review')",[l.id,student_id]);}
  const r=await activity(c,ctx,l,arrangement);
  const initialStage=initial_communication?await initialCommunication(c,ctx,l,initial_communication,r):'needs_discovery';
  const w=(await c.query('INSERT INTO ms_workspace.lead_workflow(lead_id,organization_id,primary_activity_id,contact_info,stage) VALUES($1,$2,$3,$4,$5) RETURNING *',[l.id,org,r.id,contact_info?text(contact_info,200):null,r.kind==='appointments'&&r.body.type==='trial'&&r.state==='confirmed'?advanceTrialStage(initialStage,'trial_booked'):initialStage])).rows[0];
  if(ctx.roleWorkspaces)await c.query("INSERT INTO ms_workspace.lead_directory(lead_id,organization_id,phone,department) VALUES($1,$2,$3,'sales')",[l.id,org,normalizedPhone]);
  await auditWorkflow(c,ctx,l,'INTAKE',w);return {...flags,lead_id:l.id,workflow:w};
 }
 if(!uuid(id))fail(404,'NOT_FOUND','没有找到工作台入口');
 // Lead lock serializes all transitions, payments and task replacement.
 const l=(await c.query(`SELECT * FROM ms.leads WHERE id=$1 AND organization_id=$2${method==='POST'?' FOR UPDATE':''}`,[id,org])).rows[0];if(!l)fail(404,'NOT_FOUND','没有找到客户');
 if(ctx.roleWorkspaces&&(await c.query("SELECT 1 FROM ms_workspace.lead_directory WHERE lead_id=$1 AND department='market'",[id])).rowCount)fail(403,'DEPARTMENT_FORBIDDEN','请先通过电话查询接收市场线索');
 const financeAction=['verify-payment','verify-refund','reject-payment'].includes(action)&&isFinance(ctx);
 const acceptTransfer=action==='accept-transfer'&&(await c.query("SELECT 1 FROM ms_workspace.records WHERE lead_id=$1 AND kind='corrections' AND state='approved' AND body->>'type'='lead_transfer' AND body->>'target_owner'=$2",[id,actor])).rowCount>0;
 if(!ctx.manager&&l.owner_user_id!==actor&&!financeAction&&!acceptTransfer)fail(403,'FORBIDDEN','仅负责人或授权主管可操作该客户');
 let w=(await c.query('SELECT * FROM ms_workspace.lead_workflow WHERE lead_id=$1',[id])).rows[0];
 if(method==='GET'){
  if(action==='history')return {...flags,items:(await c.query("SELECT h.*,r.kind FROM ms_workspace.history h JOIN ms_workspace.records r ON r.id=h.record_id WHERE r.lead_id=$1 AND r.organization_id=$2 AND(r.kind<>'workflow-drafts' OR r.body->>'recorded_by'=$3) ORDER BY h.record_id,h.version",[id,org,actor])).rows};
  const students=(await c.query('SELECT s.id,s.display_name FROM ms.lead_students ls JOIN ms.students s ON s.id=ls.student_id WHERE ls.lead_id=$1 AND s.organization_id=$2 AND s.archived_at IS NULL',[id,org])).rows;
  const records=(await c.query("SELECT * FROM ms_workspace.records WHERE lead_id=$1 AND(kind<>'workflow-drafts' OR body->>'recorded_by'=$2) ORDER BY created_at DESC,id",[id,actor])).rows;
  const events=(await c.query("SELECT a.event_name,a.after_business_json,a.happened_at,a.actor_user_id,u.display_name AS actor_name FROM ms.audit_events a LEFT JOIN ms.staff_users u ON u.id=a.actor_user_id WHERE a.organization_id=$1 AND a.target_type='lead' AND a.target_id=$2 ORDER BY a.happened_at DESC,a.id DESC",[org,id])).rows;
  return {...flags,lead:l,workflow:w??null,students,records,events:ctx.roleWorkspaces?events.filter(e=>!e.event_name.startsWith('V34_MARKET_CAPTURED')):events,needs_arrangement:!w||w.terminal_state==='open'&&!records.some(r=>r.id===w.primary_activity_id&&active(r))};
 }
 if(action==='supervise-arrangement')return issueArrangementSupervision(c,ctx,l,w,body);
 const supervision=supervisionTypes.get(action);
 if(supervision)return issueSupervision(c,ctx,l,w,body,supervision);
 if(!w){if(['closed','invalid'].includes(l.lead_state))fail(409,'LEGACY_TERMINAL_REVIEW','旧终态须由主管先核实，不自动重新开启');if(action!=='arrange')fail(409,'ARRANGEMENT_REQUIRED','旧客户缺少后续安排，请先补充下一步');
  if(!l.owner_user_id||!(await c.query("SELECT 1 FROM ms.staff_users WHERE id=$1 AND status='active'",[l.owner_user_id])).rowCount){if(!ctx.manager||!body.owner_user_id)fail(422,'ASSIGNEE_REQUIRED','待分配客户需要主管指定有效负责人');await sameOrgStaff(c,ctx,body.owner_user_id);if(ctx.roleWorkspaces)await salesAssignee(c,ctx,body.owner_user_id);const previous=l.owner_user_id;l.owner_user_id=body.owner_user_id;await c.query('UPDATE ms.leads SET owner_user_id=$2 WHERE id=$1',[id,l.owner_user_id]);await audit(c,ctx,l,'LEGACY_ASSIGNMENT_REPAIRED',{previous_owner:previous,new_owner:l.owner_user_id});}
  const supervisionId=await findArrangementSupervision(c,l);
  const r=await activity(c,ctx,l,body.next);w=(await c.query("INSERT INTO ms_workspace.lead_workflow(lead_id,organization_id,primary_activity_id,stage,terminal_state) VALUES($1,$2,$3,'unclassified','open') RETURNING *",[id,org,r.id])).rows[0];await auditWorkflow(c,ctx,l,'ARRANGEMENT_REPAIRED',w,{activity_id:r.id,...(supervisionId?{arrangement_supervision_id:supervisionId}:{})});return {...flags,workflow:w};}
 if(body?.expected_version!==w.version)fail(409,'VERSION_CONFLICT','客户或任务已更新，请刷新后再保存');
 if(w.terminal_state!=='open'&&!['reopen','request-correction','approve-correction','reject-correction','submit-refund','verify-refund'].includes(action))fail(409,'LEAD_CLOSED','已结案记录只能走有审计的纠正或重新开启流程');
 if(action==='contact'){fields(body,['expected_version','contact_info']);const value=ctx.roleWorkspaces?phoneNumber(body.contact_info):text(body.contact_info,200);if(ctx.roleWorkspaces){await lockPhone(c,org,value);if((await c.query('SELECT 1 FROM ms_workspace.lead_directory WHERE organization_id=$1 AND phone=$2 AND lead_id<>$3',[org,value,id])).rowCount)fail(409,'PHONE_MATCH_FOUND','该电话已有其他线索，请主管核实');await c.query("INSERT INTO ms_workspace.lead_directory(lead_id,organization_id,phone,department) VALUES($1,$2,$3,'sales') ON CONFLICT(lead_id) DO UPDATE SET phone=EXCLUDED.phone",[id,org,value]);}await c.query('UPDATE ms_workspace.lead_workflow SET contact_info=$2 WHERE lead_id=$1',[id,value]);await audit(c,ctx,l,'CONTACT_UPDATED',{previous:w.contact_info,current:value});return bump(c,ctx,l,w,'CONTACT_SAVED');}
 if(action==='source'){fields(body,['expected_version','source']);await leadDesk(c,ctx,{method:'POST',parts:['leads',id,'source'],body:{source:body.source}});return bump(c,ctx,l,w,'SOURCE_CORRECTED',{source:body.source});}
 if(action==='draft'){
  fields(body,['expected_version','draft']);if(!body.draft||typeof body.draft!=='object'||Array.isArray(body.draft)||JSON.stringify(body.draft).length>32768)fail(422,'VALIDATION_ERROR','草稿内容格式错误或过长');const draft=await save(c,ctx,l,'workflow-drafts','draft',{draft:body.draft,recorded_by:actor});await audit(c,ctx,l,'DRAFT_SAVED',{record_id:draft.id});return {...flags,saved_as:'DRAFT_ONLY'};
 }
 if(action==='arrange'){fields(body,['expected_version','next']);const prev=!body.next?.id&&w.primary_activity_id?await record(c,l,w.primary_activity_id):null;const r=await next(c,ctx,l,w,body.next,{required:true});if(prev&&prev.id!==r.id&&prev.kind==='tasks'&&active(prev))await update(c,ctx,prev,'cancelled',{...prev.body,close_reason:'已调整为新的下一步安排'});return bump(c,ctx,l,w,'NEXT_ARRANGED');}
 if(action==='followup'){
  fields(body,['expected_version','method','result','failure_reason','notes','purpose','invite_result','appointment','stage','pause_reason','next','task_id','student_ids','meeting_actual']);
  if(!methods.some(m=>m.id===body.method)||!['failed','waiting','communicated','other'].includes(body.result)||!['wechat_text','online_other'].includes(body.method)&&body.result==='waiting')fail(422,'VALIDATION_ERROR','请核对本次沟通方式和结果');
  const notes=body.notes?text(body.notes):null;
  if(body.result==='failed'&&!(reasons[body.method]||reasons[offline(body.method)?'offline':'phone']).includes(body.failure_reason))fail(422,'VALIDATION_ERROR','请选择对应的未联系成功原因');
  if((body.result==='other'||body.failure_reason==='其他')&&!notes)fail(422,'VALIDATION_ERROR','选择其他时说明必填');
  if(body.purpose&&body.result!=='communicated'&&!(body.result==='waiting'&&body.purpose==='invite'))fail(422,'VALIDATION_ERROR','未完成沟通不能记录沟通目的');
  if(body.invite_result&&body.purpose!=='invite')fail(422,'VALIDATION_ERROR','普通沟通不应填写面谈邀约');
  if(body.purpose==='invite'&&!['waiting','agreed_unscheduled','confirmed','unavailable','declined','other'].includes(body.invite_result))fail(422,'VALIDATION_ERROR','请选择邀约结果');
  if(body.result==='waiting'&&body.invite_result&&body.invite_result!=='waiting')fail(422,'INVITE_UNCONFIRMED','尚未回复的邀约不能认定家长已同意或确认');
  if(body.invite_result==='other'&&!notes)fail(422,'VALIDATION_ERROR','请说明邀约情况');
  if(body.next?.appointment&&body.result!=='communicated')fail(422,'APPOINTMENT_UNCONFIRMED','尚未完成沟通，不能确认本次新的预约；请安排下一次联系');
  let following=body.next;
  if(body.invite_result==='confirmed'){
   if(body.appointment?.type!=='meeting')fail(422,'VALIDATION_ERROR','请填写已确定的面谈预约');
   const a=await makeAppointment(c,ctx,l,body.appointment);following={id:a.id};
  }
  const current=body.task_id?await record(c,l,body.task_id):w.primary_activity_id?await record(c,l,w.primary_activity_id):null;
  if(body.task_id&&(!active(current)||current.kind!=='tasks'))fail(409,'TASK_FINISHED','该待办已完成或不是沟通待办');
  const successor=await next(c,ctx,l,w,following,{required:true,except:current&&(current.kind==='tasks'||['campus','visit'].includes(body.method)&&(['communicated'].includes(body.result)||body.result==='failed'&&['未到场','对方取消'].includes(body.failure_reason)))?current.id:null});
  if(current?.kind==='appointments'&&active(current)&&['campus','visit'].includes(body.method)&&body.result==='failed'&&['未到场','对方取消'].includes(body.failure_reason)){const status=body.failure_reason==='未到场'?'no_show':'cancelled';await update(c,ctx,current,status,{...current.body,actual_attendance:status==='no_show'?'absent':'not_recorded',feedback:notes||body.failure_reason,finished_at:new Date().toISOString(),finished_by:actor});await audit(c,ctx,l,'ACTIVITY_'+status.toUpperCase(),{record_id:current.id,type:current.body.type,feedback:notes||body.failure_reason});}
  let actualMeeting=null;
  if(['campus','visit'].includes(body.method)&&body.result==='communicated'){
   fields(body.meeting_actual,['confirmed_completed','at','place']);if(body.meeting_actual.confirmed_completed!==true)fail(422,'ACTUAL_MEETING_REQUIRED','请确认实际到场与面谈完成情况');const at=date(body.meeting_actual.at),place=body.meeting_actual.place?text(body.meeting_actual.place,200):null;if(Date.parse(at)>Date.now()+300000)fail(422,'ACTUAL_MEETING_REQUIRED','实际面谈不能记录为未来时间');
   const students=(await c.query('SELECT student_id FROM ms.lead_students WHERE lead_id=$1',[id])).rows;
   if(current?.kind==='appointments'&&current.body.type==='meeting'&&active(current))actualMeeting=await update(c,ctx,current,'completed',{...current.body,actual_attendance:'attended',feedback:notes||'已确认实际完成面谈',finished_at:at,finished_by:actor});
   else actualMeeting=await save(c,ctx,l,'appointments','completed',{type:'meeting',title:'现场实际面谈',action:'invite',method:body.method,due_at:at,finished_at:at,place,actual_attendance:'attended',feedback:notes||'已确认实际完成面谈',student_ids:body.student_ids??students.map(s=>s.student_id),was_scheduled:false,source:'WALK_IN_ACTUAL',recorded_by:actor,assignee_user_id:l.owner_user_id},{student:body.student_ids?.length===1?body.student_ids[0]:students.length===1?students[0].student_id:null});
   await audit(c,ctx,l,actualMeeting.body.was_scheduled===false?'WALK_IN_MEETING_COMPLETED':'ACTIVITY_COMPLETED',{record_id:actualMeeting.id,method:body.method,actual_at:at,was_scheduled:actualMeeting.body.was_scheduled!==false});
  }else if(body.meeting_actual)fail(422,'VALIDATION_ERROR','本次方式不应包含实际线下面谈资料');
  let stage=body.stage??w.stage;if(body.result!=='communicated'&&stage!==w.stage)fail(422,'STAGE_UNCHANGED','未完成沟通不能在本条记录中推进销售进展');if(stage!==w.stage)await validateStage(c,l,stage);if(stage==='paused'){w.pause_reason=text(body.pause_reason??w.pause_reason);}
  if(successor.kind==='appointments'&&successor.body.type==='trial'&&successor.state==='confirmed'&&following?.appointment)stage=advanceTrialStage(stage,'trial_booked');w.stage=stage;
  const completedTask=current?.kind==='tasks'&&active(current)?await update(
   c,ctx,current,'completed',{...current.body,completion:{method:body.method,result:body.result,notes},completed_at:new Date().toISOString(),completed_by:actor},
  ):null;
  const linkedIds=(await c.query('SELECT student_id FROM ms.lead_students WHERE lead_id=$1',[id])).rows.map(s=>s.student_id);const subjects=body.student_ids??(linkedIds.length<=1?linkedIds:null);if(!Array.isArray(subjects)||subjects.some(s=>!linkedIds.includes(s))||new Set(subjects).size!==subjects.length||linkedIds.length>1&&!subjects.length)fail(422,'STUDENT_REQUIRED','请选择本次实际沟通涉及的学生');
  await audit(c,ctx,l,'COMMUNICATION',{method:body.method,category:offline(body.method)?'offline':'online',result:body.result,failure_reason:body.failure_reason??null,notes,purpose:body.purpose??null,invite_result:body.invite_result??null,student_ids:subjects,stage,appointment_id:actualMeeting?.id??null,primary_activity_id:w.primary_activity_id,...(completedTask?{completed_task_id:completedTask.id,completed_task_version:completedTask.version}:{})});
  return bump(c,ctx,l,w,'FOLLOWUP_COMPLETED');
 }
 if(action==='appointment'){
  fields(body,['expected_version','appointment','next']);const prev=w.primary_activity_id?await record(c,l,w.primary_activity_id):null;const r=await makeAppointment(c,ctx,l,body.appointment);w.primary_activity_id=r.id;if(prev&&prev.id!==r.id&&prev.kind==='tasks'&&active(prev))await update(c,ctx,prev,'completed',{...prev.body,completion:{method:prev.body.method,result:'communicated',notes:'已直接确认并保存预约，原联系待办自动完成'},completed_at:new Date().toISOString(),completed_by:actor});if(r.body.type==='trial'&&r.state==='confirmed')w.stage=advanceTrialStage(w.stage,'trial_booked');return bump(c,ctx,l,w,'APPOINTMENT_CREATED',{record_id:r.id});
 }
 if(action==='activity'){
  fields(body,['expected_version','record_id','transition','due_at','reason','feedback','next','stage','pause_reason']);
  const r=await record(c,l,body.record_id);if(!['tasks','appointments'].includes(r.kind)||!active(r))fail(409,'TASK_FINISHED','活动已结束');
  const t=body.transition;
  if(t==='start'){await update(c,ctx,r,'in_progress',r.body);return bump(c,ctx,l,w,'ACTIVITY_STARTED',{record_id:r.id});}
  if(t==='reschedule'){const when=date(body.due_at),reason=text(body.reason);await update(c,ctx,r,'rescheduled',{...r.body,due_at:when,rescheduled_from:r.body.due_at,reschedule_reason:reason});return bump(c,ctx,l,w,'ACTIVITY_RESCHEDULED',{record_id:r.id,from:r.body.due_at,to:when,reason});}
  if(!['completed','cancelled','no_show','confirmed'].includes(t)||r.kind==='tasks'&&t==='completed')fail(422,'VALIDATION_ERROR','沟通待办须记录本次结果后完成');
  if(t==='confirmed'){if(r.kind!=='appointments')fail(422,'VALIDATION_ERROR','不是预约');await update(c,ctx,r,'confirmed',r.body);if(r.body.type==='trial')w.stage=advanceTrialStage(w.stage,'trial_booked');return bump(c,ctx,l,w,'APPOINTMENT_CONFIRMED',{record_id:r.id});}
  if(t!=='completed'&&body.stage&&body.stage!==w.stage)fail(422,'STAGE_UNCHANGED','未完成预约不能在本条记录中推进销售进展');
  const successor=await next(c,ctx,l,w,body.next,{required:r.id===w.primary_activity_id,except:r.id});
  const feedback=text(body.feedback??body.reason);await update(c,ctx,r,t,{...r.body,actual_attendance:t==='completed'?'attended':t==='no_show'?'absent':'not_recorded',feedback,finished_at:new Date().toISOString(),finished_by:actor});
  if(t==='completed'){
   if(body.stage){if(body.stage!==w.stage)await validateStage(c,l,body.stage);w.stage=r.kind==='appointments'&&r.body.type==='trial'&&body.stage==='trial_booked'?'trial_completed':body.stage;if(w.stage==='paused')w.pause_reason=text(body.pause_reason??w.pause_reason);}
   else if(r.kind==='appointments'&&r.body.type==='trial')w.stage=advanceTrialStage(w.stage,'trial_completed');
   if(r.kind==='appointments'&&r.body.type==='meeting'){const linkedIds=(await c.query('SELECT student_id FROM ms.lead_students WHERE lead_id=$1',[id])).rows.map(s=>s.student_id),subjects=r.body.student_ids?.length?r.body.student_ids:r.student_id?[r.student_id]:linkedIds;await audit(c,ctx,l,'COMMUNICATION',{method:r.body.method||'campus',category:'offline',result:'communicated',failure_reason:null,notes:feedback,purpose:null,invite_result:null,student_ids:subjects,stage:w.stage,appointment_id:r.id,primary_activity_id:w.primary_activity_id});}
  }
  if(body.next?.appointment&&successor.body.type==='trial'&&successor.state==='confirmed')w.stage=advanceTrialStage(w.stage,'trial_booked');
  return bump(c,ctx,l,w,'ACTIVITY_'+t.toUpperCase(),{record_id:r.id,type:r.body.type,feedback});
 }
 if(action==='quote'){
  fields(body,['expected_version','student_id','student_name','items','quote_id','quote_version','next']);
  const link=await linked(c,ctx,l,body);if(!Array.isArray(body.items)||!body.items.length||body.items.length>30)fail(422,'VALIDATION_ERROR','请填写课程明细');
  const items=[];let discount=0,unknownPrice=false;
  for(const i of body.items){fields(i,['course_label','quantity','unit_cents','standard_unit_cents']);const quantity=money(i.quantity,1);if(quantity>10000)fail(422,'VALIDATION_ERROR','课时数过大');const unit=money(i.unit_cents),price=(await c.query("SELECT body FROM ms_workspace.records WHERE organization_id=$1 AND kind='course-catalog' AND state='active' AND lower(body->>'course_label')=lower($2)",[org,i.course_label])).rows[0];const standard=price?Number(price.body.standard_unit_cents):i.standard_unit_cents==null?unit:money(i.standard_unit_cents);if(price&&i.standard_unit_cents!=null&&i.standard_unit_cents!==standard)fail(422,'PRICE_MISMATCH','标准价格以主管维护的本地价目为准');if(!price)unknownPrice=true;if(standard<unit)fail(422,'VALIDATION_ERROR','实际报价不能大于所填标准价');const line=money(quantity*unit);discount+=quantity*(standard-unit);items.push({course_label:text(i.course_label,120),quantity,proposed_unit_cents:unit,standard_unit_cents:standard,line_cents:line});}
  const total=money(items.reduce((n,i)=>n+i.line_cents,0));const b={v34:true,title:'课程方案',items,total_cents:total,discount_cents:discount,discount_state:discount>0||unknownPrice?'pending':'not_needed',unlisted_price:unknownPrice,price_source:'LOCAL_SALES_QUOTE',valid_until:new Date(Date.now()+7*86400000).toISOString(),quoted_by:actor};
  let r;if(body.quote_id){const old=await record(c,l,body.quote_id,'quotes');if(old.version!==body.quote_version||old.state!=='draft')fail(409,'VERSION_CONFLICT','课程方案已变更');r=await update(c,ctx,old,'draft',b);}else r=await save(c,ctx,l,'quotes','draft',b,link);
  await next(c,ctx,l,w,body.next);return bump(c,ctx,l,w,'QUOTE_SAVED',{record_id:r.id,total_cents:total});
 }
 if(action==='approve-discount'){
  fields(body,['expected_version','record_id','reason']);if(!ctx.manager)fail(403,'FORBIDDEN','需要主管独立批准优惠');const q=await record(c,l,body.record_id,'quotes');if(q.body.quoted_by===actor)fail(403,'FORBIDDEN','不能批准自己提交的优惠');await update(c,ctx,q,q.state,{...q.body,discount_state:'approved',discount_approved_by:actor,discount_reason:text(body.reason)});return bump(c,ctx,l,w,'DISCOUNT_APPROVED',{quote_id:q.id});
 }
 if(action==='reject-discount'){
  fields(body,['expected_version','record_id','reason']);if(!ctx.manager)fail(403,'FORBIDDEN','需要主管独立复核优惠');const q=await record(c,l,body.record_id,'quotes');if(q.body.quoted_by===actor||q.body.discount_state!=='pending')fail(403,'FORBIDDEN','不能退回自己提交或非待审的优惠方案');await update(c,ctx,q,q.state,{...q.body,discount_state:'rejected',discount_rejected_by:actor,discount_reject_reason:text(body.reason)});return bump(c,ctx,l,w,'DISCOUNT_REJECTED',{quote_id:q.id,reason:body.reason});
 }
 if(action==='enroll'){
  fields(body,['expected_version','quote_id','quote_version','agreement_ref','next']);const q=await record(c,l,body.quote_id,'quotes');
  if(q.body.total_cents<=0)fail(422,'ZERO_ORDER','零金额报名需要另行明确的业务政策');
  if(q.state!=='draft'||q.version!==body.quote_version||Date.parse(q.body.valid_until)<=Date.now()||['pending','rejected'].includes(q.body.discount_state))fail(409,'QUOTE_NOT_VALID','方案已更新、到期或优惠未获批准');
  const old=await c.query("SELECT id FROM ms_workspace.records WHERE lead_id=$1 AND kind='enrollments' AND state<>'cancelled' AND body->>'quote_id'=$2 AND (body->>'quote_version')::int=$3",[id,q.id,q.version]);if(old.rowCount)fail(409,'DUPLICATE_ENROLLMENT','本版课程方案已办理报名，请查看已有订单');
  const o=(await c.query('INSERT INTO ms.sales_orders(student_id,opportunity_id,amount_due_cents,order_state) VALUES($1,$2,$3,\'submitted\') RETURNING *',[q.student_id,q.opportunity_id,q.body.total_cents])).rows[0];
  const r=await save(c,ctx,l,'enrollments','awaiting_agreement',{order_id:o.id,quote_id:q.id,quote_version:q.version,quote_snapshot:q.body,amount_cents:q.body.total_cents,agreement_ref:text(body.agreement_ref,500),agreement_confirmed:false,net_cents:0,balance_cents:q.body.total_cents,payment_state:'unpaid',submitted_by:actor},{student:q.student_id,opp:q.opportunity_id});
  w.stage='enrolling';await next(c,ctx,l,w,body.next);return bump(c,ctx,l,w,'ENROLLMENT_SUBMITTED',{enrollment_id:r.id,order_id:o.id});
 }
 if(action==='confirm-agreement'){
  fields(body,['expected_version','record_id','evidence_ref']);if(!ctx.manager)fail(403,'FORBIDDEN','协议需主管独立核实');const r=await record(c,l,body.record_id,'enrollments');if(r.body.submitted_by===actor||r.state==='cancelled')fail(403,'FORBIDDEN','不能核实自己提交或已取消的协议');
  const n=await update(c,ctx,r,r.state,{...r.body,agreement_confirmed:true,agreement_verified_by:actor,agreement_evidence:text(body.evidence_ref,500)});
  await c.query("UPDATE ms.sales_orders SET order_state='accepted',version=version+1 WHERE id=$1",[r.body.order_id]);for(const p of (await c.query("SELECT * FROM ms_workspace.records WHERE kind='payments' AND state='verified' AND body->>'enrollment_id'=$1 AND COALESCE(body->>'allocated','false')='false' FOR UPDATE",[r.id])).rows){const returned=(await c.query("SELECT COALESCE(sum((body->>'amount_cents')::bigint),0)::text AS n FROM ms_workspace.records WHERE kind='refunds' AND state='verified' AND body->>'payment_id'=$1",[p.id])).rows[0];const alloc=p.body.amount_cents-Number(returned.n);if(alloc>0)await c.query("INSERT INTO ms.payment_allocations(receipt_id,order_id,allocated_cents,allocation_state,confirmed_by,confirmed_at,allocation_basis_ref) VALUES($1,$2,$3,'confirmed',$4,now(),$5)",[p.body.receipt_id,r.body.order_id,alloc,p.body.verified_by,p.body.verification_ref]);await update(c,ctx,p,'verified',{...p.body,allocated:true,allocated_cents:alloc});}await enrollmentState(c,ctx,l,n);return bump(c,ctx,l,w,'AGREEMENT_CONFIRMED',{enrollment_id:r.id});
 }
 if(action==='submit-payment'){
  fields(body,['expected_version','enrollment_id','amount_cents','receipt_ref','payment_kind','received_at','evidence_ref','attachment']);const e=await record(c,l,body.enrollment_id,'enrollments');if(e.state==='cancelled')fail(409,'CANCELLED','报名已取消');
  if(!['deposit','reservation','tuition','full'].includes(body.payment_kind))fail(422,'VALIDATION_ERROR','请选择款项类型');
  const ref=text(body.receipt_ref,200);if((await c.query("SELECT 1 FROM ms_workspace.records WHERE organization_id=$1 AND kind='payments' AND body->>'receipt_ref'=$2",[org,ref])).rowCount)fail(409,'DUPLICATE_PAYMENT','该款项参考号已登记');
  const r=await save(c,ctx,l,'payments','pending',{...evidence(body),amount_cents:money(body.amount_cents,1),receipt_ref:ref,payment_kind:body.payment_kind,received_at:date(body.received_at),enrollment_id:e.id,order_id:e.body.order_id,submitted_by:actor},{student:e.student_id,opp:e.opportunity_id});return bump(c,ctx,l,w,'PAYMENT_SUBMITTED',{payment_id:r.id});
 }
 if(action==='reject-payment'){fields(body,['expected_version','record_id','reason']);if(!isFinance(ctx))fail(403,'FORBIDDEN','仅收款核实员可退回核实资料');const r=await record(c,l,body.record_id);if(!['payments','refunds'].includes(r.kind)||r.state!=='pending'||r.body.submitted_by===actor)fail(409,'ALREADY_VERIFIED','该资料不能退回');await update(c,ctx,r,'rejected',{...r.body,rejected_by:actor,reject_reason:text(body.reason)});return bump(c,ctx,l,w,'PAYMENT_REJECTED',{record_id:r.id,reason:body.reason});}
 if(action==='verify-payment'){
  fields(body,['expected_version','record_id','evidence_ref']);if(!isFinance(ctx))fail(403,'FORBIDDEN','仅授权收款核实员可确认到账');const r=await record(c,l,body.record_id,'payments');if(r.state!=='pending')fail(409,'ALREADY_VERIFIED','该款项已处理');if(r.body.submitted_by===actor)fail(403,'FORBIDDEN','登记人不能核实自己的款项');
  const e=await record(c,l,r.body.enrollment_id,'enrollments');if(e.state==='cancelled')fail(409,'CANCELLED','报名已取消');const ev=text(body.evidence_ref,500);
  const receipt=(await c.query(`INSERT INTO ms.payment_receipt_projections(authority_system,external_tenant,external_payment_id,amount_cents,verification_state,verified_at,actual_received_at,authority_evidence_ref,source_revision) VALUES('standalone_sales',$1,$2,$3,'confirmed',now(),$4,$5,1) RETURNING id`,[org,r.body.receipt_ref,r.body.amount_cents,r.body.received_at,ev])).rows[0];
  if(r.body.amount_cents>e.body.balance_cents)fail(409,'OVERPAYMENT','金额超过该订单应收余额');
  if(e.body.agreement_confirmed)await c.query("INSERT INTO ms.payment_allocations(receipt_id,order_id,allocated_cents,allocation_state,confirmed_by,confirmed_at,allocation_basis_ref) VALUES($1,$2,$3,'confirmed',$4,now(),$5)",[receipt.id,e.body.order_id,r.body.amount_cents,actor,ev]);
  await update(c,ctx,r,'verified',{...r.body,receipt_id:receipt.id,allocated:e.body.agreement_confirmed,verified_by:actor,verification_ref:ev});await enrollmentState(c,ctx,l,e);return bump(c,ctx,l,w,'PAYMENT_VERIFIED',{payment_id:r.id,amount_cents:r.body.amount_cents});
 }
 if(action==='close-won'){
  fields(body,['expected_version','reason']);const es=(await c.query("SELECT * FROM ms_workspace.records WHERE lead_id=$1 AND kind='enrollments' AND state<>'cancelled' ORDER BY id FOR UPDATE",[id])).rows;if(!es.length||es.some(e=>e.state!=='successful'||e.body.balance_cents!==0))fail(409,'NOT_FULLY_PAID','所有有效订单均须协议有效且全额净付款，才能 Closed Won');
  if((await c.query("SELECT 1 FROM ms_workspace.records WHERE lead_id=$1 AND kind IN('payments','refunds','corrections') AND state IN('pending','approved')",[id])).rowCount)fail(409,'UNRESOLVED','尚有待核实款项或纠正事项');
  for(const e of es){await c.query(`INSERT INTO ms.sale_events(order_id,recognized_amount_cents,recognized_at,owner_snapshot_id,authority_evidence) VALUES($1,$2,now(),$3,$4) ON CONFLICT(order_id) DO NOTHING`,[e.body.order_id,e.body.amount_cents,l.owner_user_id,{source:'standalone_sales',agreement_verified_by:e.body.agreement_verified_by,closure_actor:actor,evidence:text(body.reason)}]);}
  w.terminal_state='won';w.primary_activity_id=null;await closeActivities(c,ctx,l,'正式全款成交');return bump(c,ctx,l,w,'CLOSED_WON',{reason:body.reason,order_ids:es.map(e=>e.body.order_id)});
 }
 if(action==='close-lost'){
  fields(body,['expected_version','reason','feedback','evidence_ref','do_not_contact']);const reason=text(body.reason,200),feedback=text(body.feedback),ev=text(body.evidence_ref,500);
  const allowed=['家长明确拒绝报名','价格原因','课程不匹配','明确不再考虑时间安排','已选择其他机构','联系方式无效且已核实','制度批准结束持续无回应','其他明确原因'];if(!allowed.includes(reason))fail(422,'VALIDATION_ERROR','请选择合法结案原因');
  if(['联系方式无效且已核实','制度批准结束持续无回应','其他明确原因'].includes(reason)&&!ctx.manager)fail(403,'APPROVAL_REQUIRED','该原因需要主管核实授权');
  if((await c.query("SELECT 1 FROM ms_workspace.records WHERE lead_id=$1 AND kind='enrollments' AND state<>'cancelled'",[id])).rowCount)fail(409,'ACTIVE_ORDER','已有报名订单，请先按审批流程处理取消及财务事项');
  if((await c.query("SELECT 1 FROM ms_workspace.records WHERE lead_id=$1 AND kind IN('payments','refunds','corrections') AND state IN('pending','approved') AND COALESCE(body->>'type','')<>'lead_transfer'",[id])).rowCount)fail(409,'UNRESOLVED','请先处理未核实的款项或纠正事项');
  w.terminal_state='lost';w.stage='declined';w.do_not_contact=body.do_not_contact===true;w.primary_activity_id=null;await closeActivities(c,ctx,l,'合法流失结案');return bump(c,ctx,l,w,'CLOSED_LOST',{reason,feedback,evidence_ref:ev,do_not_contact:w.do_not_contact});
 }
 if(action==='reopen'){
  fields(body,['expected_version','evidence_ref','customer_initiated','next']);if(!ctx.manager||w.terminal_state!=='lost')fail(403,'FORBIDDEN','仅主管可重新开启已流失客户');if(w.do_not_contact&&body.customer_initiated!==true)fail(422,'NO_CONTACT','需客户主动重新咨询的依据');const ev=text(body.evidence_ref,500);w.terminal_state='open';w.stage='needs_discovery';w.do_not_contact=false;await next(c,ctx,l,w,body.next,{required:true});return bump(c,ctx,l,w,'REOPENED',{evidence_ref:ev});
 }
 if(action==='request-transfer'){
  fields(body,['expected_version','owner_user_id','reason']);if((await c.query("SELECT 1 FROM ms_workspace.records WHERE lead_id=$1 AND kind='corrections' AND state IN('pending','approved') AND body->>'type'='lead_transfer'",[id])).rowCount)fail(409,'TRANSFER_PENDING','已有待处理转交申请');if(!ctx.manager)fail(403,'FORBIDDEN','负责人转交需要主管申请和另一主管复核');await sameOrgStaff(c,ctx,body.owner_user_id);if(ctx.roleWorkspaces)await salesAssignee(c,ctx,body.owner_user_id);const r=await save(c,ctx,l,'corrections','pending',{type:'lead_transfer',target_owner:body.owner_user_id,target_owner_name:(await c.query('SELECT display_name FROM ms.staff_users WHERE id=$1',[body.owner_user_id])).rows[0].display_name,reason:text(body.reason),requested_by:actor,requested_by_name:ctx.user.display_name});return bump(c,ctx,l,w,'TRANSFER_REQUESTED',{request_id:r.id});
 }
 if(action==='approve-transfer'){
  fields(body,['expected_version','record_id','reason']);if(!ctx.manager)fail(403,'FORBIDDEN','需要独立主管复核');const r=await record(c,l,body.record_id,'corrections');if(r.body.type!=='lead_transfer'||r.state!=='pending'||[r.body.requested_by,r.body.target_owner].includes(actor))fail(403,'FORBIDDEN','复核人必须独立于申请和接收人');await sameOrgStaff(c,ctx,r.body.target_owner);if(ctx.roleWorkspaces)await salesAssignee(c,ctx,r.body.target_owner);
  await update(c,ctx,r,'approved',{...r.body,approved_by:actor,review_reason:text(body.reason)});return bump(c,ctx,l,w,'TRANSFER_AWAITING_ACCEPTANCE',{request_id:r.id,target_owner:r.body.target_owner});
 }
 if(action==='reject-transfer'){
  fields(body,['expected_version','record_id','reason']);if(!ctx.manager)fail(403,'FORBIDDEN','需要独立主管复核');const r=await record(c,l,body.record_id,'corrections');if(r.body.type!=='lead_transfer'||r.state!=='pending'||r.body.requested_by===actor)fail(403,'FORBIDDEN','复核人必须独立于申请人且申请须处于待处理状态');
  await update(c,ctx,r,'rejected',{...r.body,rejected_by:actor,reject_reason:text(body.reason)});return bump(c,ctx,l,w,'TRANSFER_REJECTED',{request_id:r.id,reason:body.reason});
 }
 if(action==='accept-transfer'){
  fields(body,['expected_version','record_id']);const r=await record(c,l,body.record_id,'corrections');if(r.body.type!=='lead_transfer'||r.state!=='approved'||r.body.target_owner!==actor)fail(403,'FORBIDDEN','仅已批准的接收人可确认接手');await sameOrgStaff(c,ctx,actor);if(ctx.roleWorkspaces)await salesAssignee(c,ctx,actor);
  await c.query('UPDATE ms.leads SET owner_user_id=$2 WHERE id=$1',[id,actor]);await c.query('UPDATE ms.opportunities SET owner_user_id=$2,version=version+1 WHERE originating_lead_id=$1',[id,actor]);
  for(const a of (await c.query('SELECT * FROM ms_workspace.records WHERE lead_id=$1 ORDER BY id FOR UPDATE',[id])).rows){if(['tasks','appointments'].includes(a.kind)){await c.query('UPDATE ms_workspace.records SET owner_user_id=$2 WHERE id=$1',[a.id,actor]);await update(c,ctx,a,a.state,{...a.body,previous_owner:l.owner_user_id,assignee_user_id:actor});}else if(a.id===r.id)await update(c,ctx,a,'completed',{...a.body,accepted_by:actor});}
  return bump(c,ctx,l,w,'TRANSFER_ACCEPTED',{old_owner:l.owner_user_id,old_owner_name:(await c.query('SELECT display_name FROM ms.staff_users WHERE id=$1',[l.owner_user_id])).rows[0]?.display_name,new_owner:actor,new_owner_name:ctx.user.display_name});
 }
 if(['request-correction','approve-correction','reject-correction','submit-refund','verify-refund'].includes(action))return corrections(c,ctx,l,w,action,body);
 fail(404,'NOT_FOUND','未找到业务操作');
}
async function initialCommunication(c,ctx,l,b,nextActivity=null){
 fields(b,['method','result','failure_reason','at','place','notes','stage']);if(!methods.some(m=>m.id===b.method))fail(422,'VALIDATION_ERROR','请选择实际沟通方式');
 const res=b.result??'communicated';if(!['communicated','failed'].includes(res))fail(422,'VALIDATION_ERROR','请核对初次沟通结果');
 const at=date(b.at);if(Date.parse(at)>Date.now()+300000)fail(422,'ACTUAL_MEETING_REQUIRED','已经发生的沟通不能填未来时间');
 const notes=b.notes?text(b.notes):null,students=(await c.query('SELECT student_id FROM ms.lead_students WHERE lead_id=$1',[l.id])).rows.map(r=>r.student_id);
 if(res==='failed'){
  if(!(reasons[b.method]||reasons[offline(b.method)?'offline':'phone']).includes(b.failure_reason))fail(422,'VALIDATION_ERROR','请选择对应的未联系成功原因');
  if(b.failure_reason==='其他'&&!notes)fail(422,'VALIDATION_ERROR','选择其他时说明必填');
  if(b.stage&&b.stage!=='needs_discovery')fail(422,'STAGE_UNCHANGED','未完成沟通不能推进销售进展');
  if(nextActivity?.kind==='appointments')fail(422,'APPOINTMENT_UNCONFIRMED','尚未完成沟通，不能确认本次新的预约；请安排下一次联系');
  await audit(c,ctx,l,'COMMUNICATION',{method:b.method,category:offline(b.method)?'offline':'online',result:'failed',failure_reason:b.failure_reason,notes,student_ids:students,stage:'needs_discovery',actual_at:at,appointment_id:null,purpose:null,invite_result:null});return 'needs_discovery';
 }
 const stage=b.stage??'needs_discovery';if(!['needs_discovery','needs_confirmed','courses_introduced','enrollment_intent'].includes(stage))fail(422,'VALIDATION_ERROR','初次沟通进展不能替代试听或报名事实');
 let appointment_id=null;
 if(['campus','visit'].includes(b.method)){const place=b.place?text(b.place,200):null;const r=await save(c,ctx,l,'appointments','completed',{type:'meeting',title:'现场实际面谈',action:'invite',method:b.method,due_at:at,finished_at:at,place,actual_attendance:'attended',feedback:notes||'录入时确认面谈已完成',student_ids:students,was_scheduled:false,source:'WALK_IN_ACTUAL',recorded_by:ctx.user.id,assignee_user_id:l.owner_user_id},{student:students.length===1?students[0]:null});appointment_id=r.id;await audit(c,ctx,l,'WALK_IN_MEETING_COMPLETED',{record_id:r.id,actual_at:at,was_scheduled:false});}
 await audit(c,ctx,l,'COMMUNICATION',{method:b.method,category:offline(b.method)?'offline':'online',result:'communicated',failure_reason:null,notes,student_ids:students,stage,actual_at:at,appointment_id,purpose:null,invite_result:null});return stage;
}
async function makeAppointment(c,ctx,l,b){
 fields(b,['type','student_id','student_name','due_at','place','course','state']);if(!['meeting','trial'].includes(b.type)||!['pending','confirmed'].includes(b.state??'confirmed'))fail(422,'VALIDATION_ERROR','请核对预约类型与状态');
 const link=await linked(c,ctx,l,b),when=date(b.due_at),place=b.type==='trial'?text(b.place,200):(b.place?text(b.place,200):null),course=b.type==='trial'?text(b.course,120):null;
 const existing=(await c.query("SELECT * FROM ms_workspace.records WHERE lead_id=$1 AND kind='appointments' AND body->>'type'=$2 AND body->>'due_at'=$3 AND COALESCE(body->>'place','')=$4 AND COALESCE(body->>'course','')=$5 AND state IN('pending','confirmed','rescheduled','in_progress')",[l.id,b.type,when,place??'',course??''])).rows[0];if(existing)return existing;
 return save(c,ctx,l,'appointments',b.state??'confirmed',{type:b.type,title:b.type==='trial'?'学生试听':'家长线下面谈',action:b.type==='trial'?'schedule_trial':'invite',method:'campus',due_at:when,place,course,assignee_user_id:l.owner_user_id,actual_attendance:'not_recorded',source:'SALES_ENTERED' },link);
}
async function corrections(c,ctx,l,w,action,b){
 if(action==='request-correction'){
  fields(b,['expected_version','enrollment_id','reason','next']);const e=await record(c,l,b.enrollment_id,'enrollments');const r=await save(c,ctx,l,'corrections','pending',{type:'enrollment_correction',enrollment_id:e.id,requested_by:ctx.user.id,reason:text(b.reason),next:b.next??null});return bump(c,ctx,l,w,'CORRECTION_REQUESTED',{request_id:r.id});
 }
 if(action==='approve-correction'){
  fields(b,['expected_version','record_id','reason','next','cancel_enrollment']);if(!ctx.manager)fail(403,'FORBIDDEN','需要主管独立复核纠正申请');const r=await record(c,l,b.record_id,'corrections');if(r.state!=='pending'||r.body.requested_by===ctx.user.id||r.body.type!=='enrollment_correction')fail(403,'FORBIDDEN','不能复核自己或已处理的申请');
  if(w.terminal_state!=='open'){w.terminal_state='open';w.do_not_contact=false;await next(c,ctx,l,w,b.next,{required:true});}
  await update(c,ctx,r,'approved',{...r.body,approved_by:ctx.user.id,review_reason:text(b.reason)});const e=await record(c,l,r.body.enrollment_id,'enrollments');if(b.cancel_enrollment===true){if(e.body.net_cents!==0)fail(409,'BALANCE_REMAINS','须先核实退款，才可取消有有效收款的报名');await update(c,ctx,e,'cancelled',{...e.body,correction_id:r.id,cancel_reason:b.reason});await c.query("UPDATE ms.sales_orders SET order_state='cancelled',version=version+1 WHERE id=$1",[e.body.order_id]);await update(c,ctx,{...r,version:r.version+1},'completed',{...r.body,completed_by:ctx.user.id});}else await update(c,ctx,e,'exception',{...e.body,correction_id:r.id});return bump(c,ctx,l,w,'CORRECTION_APPROVED',{request_id:r.id});
 }
 if(action==='reject-correction'){
  fields(b,['expected_version','record_id','reason']);if(!ctx.manager)fail(403,'FORBIDDEN','需要主管独立复核纠正申请');const r=await record(c,l,b.record_id,'corrections');if(r.state!=='pending'||r.body.requested_by===ctx.user.id||r.body.type!=='enrollment_correction')fail(403,'FORBIDDEN','不能复核自己或已处理的申请');
  await update(c,ctx,r,'rejected',{...r.body,rejected_by:ctx.user.id,reject_reason:text(b.reason)});return bump(c,ctx,l,w,'CORRECTION_REJECTED',{request_id:r.id,reason:b.reason});
 }
 if(action==='submit-refund'){
  fields(b,['expected_version','payment_id','correction_id','amount_cents','refund_ref','reason','evidence_ref','attachment']);const p=await record(c,l,b.payment_id,'payments'),cor=await record(c,l,b.correction_id,'corrections');if(p.state!=='verified'||cor.state!=='approved'||cor.body.enrollment_id!==p.body.enrollment_id)fail(409,'CORRECTION_REQUIRED','退款须有对应订单的独立批准纠正申请');
  if((await c.query("SELECT 1 FROM ms_workspace.records WHERE organization_id=$1 AND kind='refunds' AND body->>'refund_ref'=$2",[l.organization_id,b.refund_ref])).rowCount)fail(409,'DUPLICATE_REFUND','退款参考号已登记');
  const r=await save(c,ctx,l,'refunds','pending',{...evidence(b),amount_cents:money(b.amount_cents,1),refund_ref:text(b.refund_ref,200),payment_id:p.id,correction_id:cor.id,reason:text(b.reason),submitted_by:ctx.user.id},{student:p.student_id,opp:p.opportunity_id});return bump(c,ctx,l,w,'REFUND_SUBMITTED',{refund_id:r.id});
 }
 fields(b,['expected_version','record_id','evidence_ref','cancel_enrollment']);if(!isFinance(ctx))fail(403,'FORBIDDEN','退款须由收款核实员确认实际退款');const r=await record(c,l,b.record_id,'refunds');if(r.state!=='pending'||r.body.submitted_by===ctx.user.id)fail(409,'ALREADY_VERIFIED','不能重复确认或自核退款');
 const p=await record(c,l,r.body.payment_id,'payments'),e=await record(c,l,p.body.enrollment_id,'enrollments'),ev=text(b.evidence_ref,500);
 const already=(await c.query("SELECT COALESCE(sum((body->>'amount_cents')::bigint),0)::text AS n FROM ms_workspace.records WHERE kind='refunds' AND state='verified' AND body->>'payment_id'=$1",[p.id])).rows[0];if(Number(already.n)+r.body.amount_cents>p.body.amount_cents)fail(409,'OVER_REFUND','退款超过该笔收款的有效余额');
 const ref=(await c.query("INSERT INTO ms.refund_projections(authority_system,external_tenant,external_refund_id,original_receipt_id,amount_cents,verification_state,verified_at,actual_refunded_at,evidence_ref,source_revision) VALUES('standalone_sales',$1,$2,$3,$4,'confirmed',now(),now(),$5,1) RETURNING id",[l.organization_id,r.body.refund_ref,p.body.receipt_id,r.body.amount_cents,ev])).rows[0];
 await c.query("INSERT INTO ms.finance_economic_events(authority_system,external_tenant,economic_event_key,kind,original_receipt_id,refund_id,amount_cents,verification_state,verified_at) VALUES('standalone_sales',$1,$2,'refund',$3,$4,$5,'confirmed',now())",[l.organization_id,r.body.refund_ref,p.body.receipt_id,ref.id,r.body.amount_cents]);
 if(p.body.allocated)await c.query("INSERT INTO ms.refund_allocations(refund_id,order_id,allocated_cents,allocation_state,reason) VALUES($1,$2,$3,'confirmed',$4)",[ref.id,e.body.order_id,r.body.amount_cents,r.body.reason]);
 await update(c,ctx,r,'verified',{...r.body,refund_id:ref.id,verified_by:ctx.user.id,verification_ref:ev});const n=await enrollmentState(c,ctx,l,e);
 if(b.cancel_enrollment===true){if(n.body.net_cents!==0)fail(409,'BALANCE_REMAINS','仍有有效净收款，不能直接取消报名');await update(c,ctx,n,'cancelled',{...n.body,cancelled_by:ctx.user.id,cancel_reason:r.body.reason});await c.query("UPDATE ms.sales_orders SET order_state='cancelled',version=version+1 WHERE id=$1",[e.body.order_id]);}
 const cor=await record(c,l,r.body.correction_id,'corrections');await update(c,ctx,cor,'completed',{...cor.body,completed_by:ctx.user.id});await audit(c,ctx,l,'CREDIT_ADJUSTMENT',{order_id:e.body.order_id,amount_cents:-r.body.amount_cents,refund_id:r.id});return bump(c,ctx,l,w,'REFUND_VERIFIED',{refund_id:r.id});
}
const supervisionTypes=new Map([
 ['supervise-appointment',{table:'appointment_supervision',schemaVersion:37,target:'appointment',kind:'appointments',label:'预约',notOverdue:'APPOINTMENT_NOT_OVERDUE'}],
 ['supervise-followup',{table:'followup_supervision',schemaVersion:38,target:'task',kind:'tasks',label:'跟进待办',notOverdue:'FOLLOWUP_NOT_OVERDUE'}],
]);
const canSupervise=ctx=>ctx.manager&&(!ctx.roleWorkspaces||workspaceAccess(ctx).sales_manager);
const arrangementSupervisionVersion=39;
async function supervisionInstalled(c,version){
 return (await c.query('SELECT 1 FROM ms_workspace.schema_versions WHERE version=$1',[version])).rowCount>0;
}
async function requireSupervision(c,ctx,version,label){
 if(!canSupervise(ctx))fail(403,'FORBIDDEN','仅销售主管可发起'+label+'督办');
 if(!await supervisionInstalled(c,version))fail(409,'SUPERVISION_UNAVAILABLE','当前工作台尚未启用'+label+'督办');
}
function supervisionDetails(body,extraFields=[]){
 fields(body,[...extraFields,'due_at','reason']);
 const deadline=date(body.due_at),reason=text(body.reason);
 if(Date.parse(deadline)<=Date.now())fail(422,'VALIDATION_ERROR','督办截止时间须晚于当前时间');
 return {deadline,reason};
}
async function pendingArrangementSupervision(c,lead){
 const {rows:[item]}=await c.query(`
  SELECT id FROM ms_workspace.arrangement_supervision_status
  WHERE organization_id=$1 AND lead_id=$2 AND evidence_event_id IS NULL
  ORDER BY created_at,id LIMIT 1`,[lead.organization_id,lead.id]);
 return item?.id??null;
}
async function findArrangementSupervision(c,lead){
 if(!await supervisionInstalled(c,arrangementSupervisionVersion))return null;
 return pendingArrangementSupervision(c,lead);
}
async function issueArrangementSupervision(c,ctx,lead,workflow,body){
 await requireSupervision(c,ctx,arrangementSupervisionVersion,'待补安排');
 const {deadline,reason}=supervisionDetails(body);
 const assigned=await c.query("SELECT 1 FROM ms.staff_users WHERE id=$1 AND organization_id=$2 AND status='active'",
  [lead.owner_user_id,lead.organization_id]);
 if(workflow||['closed','invalid'].includes(lead.lead_state)||!assigned.rowCount){
  fail(409,'ARRANGEMENT_SUPERVISION_INELIGIBLE','仅可督办已有有效负责人且缺少首要安排的旧线索');
 }
 if(ctx.roleWorkspaces)await salesAssignee(c,ctx,lead.owner_user_id);
 if(await pendingArrangementSupervision(c,lead))fail(409,'SUPERVISION_ALREADY_OPEN','该客户已有待补安排督办');
 const {rows:[item]}=await c.query(`
  INSERT INTO ms_workspace.arrangement_supervision(organization_id,lead_id,issued_by,reason,due_at)
  VALUES($1,$2,$3,$4,$5) RETURNING id,lead_id,due_at,created_at`,
  [lead.organization_id,lead.id,ctx.user.id,reason,deadline]);
 return {...flags,item};
}
async function issueSupervision(c,ctx,lead,workflow,body,{table,schemaVersion,target,kind,label,notOverdue}){
 await requireSupervision(c,ctx,schemaVersion,label);
 const targetId=target+'_id',targetVersion=target+'_version';
 const {deadline,reason}=supervisionDetails(body,[targetId,targetVersion]);
 const activity=await record(c,lead,body[targetId],kind);
 if(activity.version!==body[targetVersion])fail(409,'VERSION_CONFLICT',label+'已更新，请刷新后再发起督办');
 if(workflow?.terminal_state!=='open'||!lead.owner_user_id||lead.owner_user_id!==activity.owner_user_id||
    !active(activity)||!(Date.parse(activity.body.due_at)<Date.now())){
  fail(409,notOverdue,'只能督办有当前负责人且已到期未处理的'+label);
 }
 const existing=await c.query(`
  SELECT 1 FROM ms_workspace.${table}_status
  WHERE organization_id=$1 AND lead_id=$2 AND ${targetId}=$3 AND resolved_version IS NULL`,
  [lead.organization_id,lead.id,activity.id],
 );
 if(existing.rowCount)fail(409,'SUPERVISION_ALREADY_OPEN','该'+label+'已有待处理的督办');
 const {rows:[item]}=await c.query(`
  INSERT INTO ms_workspace.${table}(organization_id,lead_id,${targetId},${targetVersion},issued_by,reason,due_at)
  VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,${targetId},due_at,created_at`,
  [lead.organization_id,lead.id,activity.id,activity.version,ctx.user.id,reason,deadline],
 );
 return {...flags,item};
}
async function supervisionReports(c,ctx,scope){
 const types=[...supervisionTypes.values()];
 const installed=await c.query('SELECT version FROM ms_workspace.schema_versions WHERE version=ANY($1::int[])',
  [[...types.map(type=>type.schemaVersion),arrangementSupervisionVersion]]);
 const versions=new Set(installed.rows.map(row=>row.version));
 const {where,params}=salesLeadScope(ctx,scope);
 const reports={};
 for(const {table,target,schemaVersion} of types){
  reports[table]=null;
  if(!versions.has(schemaVersion))continue;
  const {rows:items}=await c.query(`
   SELECT a.id,a.lead_id,a.${target}_id,a.reason,a.due_at,a.created_at,a.resolved_version,
    a.resolution_state,a.resolved_at,l.owner_user_id,r.body->>'title' AS ${target}_title,r.state AS activity_state,
    co.display_name AS contact_name,u.display_name AS owner_name
   FROM ms.leads l JOIN ms_workspace.${table}_status a ON a.lead_id=l.id AND a.organization_id=l.organization_id
   JOIN ms_workspace.records r ON r.id=a.${target}_id AND r.lead_id=l.id AND r.organization_id=l.organization_id
   LEFT JOIN ms.contacts co ON co.id=l.contact_id AND co.organization_id=l.organization_id
   LEFT JOIN ms.staff_users u ON u.id=l.owner_user_id AND u.organization_id=l.organization_id
   WHERE ${where} ORDER BY (a.resolved_version IS NULL) DESC,a.created_at DESC,a.id`,params);
  reports[table]={can_issue:canSupervise(ctx),items};
 }
 reports.arrangement_supervision=null;
 if(versions.has(arrangementSupervisionVersion)){
  const {rows:items}=await c.query(`
   SELECT a.id,a.lead_id,a.reason,a.due_at,a.created_at,a.resolved_at,a.activity_id,a.evidence_event_id,
    l.owner_user_id,co.display_name AS contact_name,u.display_name AS owner_name,
    (w.lead_id IS NULL AND l.lead_state NOT IN ('closed','invalid') AND u.status='active') IS TRUE AS can_repair
   FROM ms.leads l JOIN ms_workspace.arrangement_supervision_status a ON a.lead_id=l.id AND a.organization_id=l.organization_id
   LEFT JOIN ms_workspace.lead_workflow w ON w.lead_id=l.id
   LEFT JOIN ms.contacts co ON co.id=l.contact_id AND co.organization_id=l.organization_id
   LEFT JOIN ms.staff_users u ON u.id=l.owner_user_id AND u.organization_id=l.organization_id
   WHERE ${where} ORDER BY (a.evidence_event_id IS NULL) DESC,a.created_at DESC,a.id`,params);
  reports.arrangement_supervision={can_issue:canSupervise(ctx),items};
 }
 return reports;
}
function maskPhone(v){if(!v)return '';const s=String(v).trim();if(s.length>=8)return s.slice(0,s.length-8)+'****'+s.slice(-4);if(s.length>=5)return s.slice(0,2)+'***'+s.slice(-2);return '****';}
function metricsScope(query={}){
 fields(query,['view_mode','start_at','end_at','owner_id','source','as_of_at']);
 const {view_mode,start_at,end_at,owner_id,source,as_of_at}=query;
 if(view_mode!==undefined&&!['cohort','event','snapshot'].includes(view_mode)){
  fail(422,'VALIDATION_ERROR','请选择有效的统计口径');
 }
 if(owner_id!==undefined&&!uuid(owner_id)){
  fail(422,'VALIDATION_ERROR','请选择有效的顾问');
 }
 if(source!==undefined&&(typeof source!=='string'||source.length>200)){
  fail(422,'VALIDATION_ERROR','请选择有效的原始来源');
 }
 const dimensions={owner_id:owner_id??null,source:source?.trim()??null};
 function boundary(value){

  const match=typeof value==='string'&&/^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-]\d{2}:[0-5]\d)$/.exec(value);
  if(!match)fail(422,'DATE_REQUIRED','请选择有效时间并指定时区');
  const calendarDate=new Date(match[1]+'T00:00:00Z');
  if(!Number.isFinite(calendarDate.getTime())||calendarDate.toISOString().slice(0,10)!==match[1]){
   fail(422,'DATE_REQUIRED','请选择有效的起止日期');
  }
  return date(value);
 }
 if(view_mode==='snapshot'||as_of_at!==undefined){
  if((view_mode!==undefined&&view_mode!=='snapshot')||start_at!==undefined||end_at!==undefined){
   fail(422,'VALIDATION_ERROR','历史时点不能与建档或当期时间范围混用');
  }
  const instant=boundary(as_of_at);
  if(Date.parse(instant)>Date.now())fail(422,'VALIDATION_ERROR','历史时点不能晚于当前时间');
  return {view_mode:'snapshot',as_of_at:instant,...dimensions};
 }
 const hasWindow=view_mode!==undefined||start_at!==undefined||end_at!==undefined;
 if(!hasWindow)return {view_mode:'current',start_at:null,end_at:null,...dimensions};
 const start=boundary(start_at),end=boundary(end_at);
 if(Date.parse(start)>=Date.parse(end))fail(422,'VALIDATION_ERROR','结束时间须晚于开始时间');
 return {view_mode:view_mode??'cohort',start_at:start,end_at:end,...dimensions};
}
function salesLeadScope(ctx,scope){
 const params=[ctx.user.organization_id,ctx.user.id,ctx.manager];
 const conditions=['l.organization_id=$1','(l.owner_user_id=$2 OR $3::boolean)'];
 if(ctx.roleWorkspaces)conditions.push("NOT EXISTS(SELECT 1 FROM ms_workspace.lead_directory d WHERE d.lead_id=l.id AND d.department='market')");
 if(scope?.owner_id)conditions.push(`l.owner_user_id=$${params.push(scope.owner_id)}::uuid`);
 if(scope?.source!=null)conditions.push(`COALESCE((
  SELECT NULLIF(btrim(source_event.event_type),'') FROM ms.contact_events source_event
  WHERE source_event.id=l.source_event_id AND source_event.organization_id=l.organization_id
 ),'')=$${params.push(scope.source)}`);
 if(scope?.view_mode==='cohort'){
  conditions.push(`l.created_at>=$${params.push(scope.start_at)}::timestamptz`);
  conditions.push(`l.created_at<$${params.push(scope.end_at)}::timestamptz`);
 }
 return {where:conditions.join(' AND '),params};
}
const activeScopedStudent='s.organization_id=l.organization_id AND s.archived_at IS NULL';
const salesPathMetricKeys=['direct_to_trial_students','direct_enroll_without_trial_students'];
function salesPathFacts(ctx,scope){
 const {where,params}=salesLeadScope(ctx,scope);
 let period='';
 if(scope.view_mode==='event'){
  const start=params.push(scope.start_at),end=params.push(scope.end_at);
  period=`WHERE recorded_at >= $${start}::timestamptz AND recorded_at < $${end}::timestamptz`;
 }
 const sql=`
  WITH scoped_students AS (
   SELECT l.id AS lead_id,s.id AS student_id,s.display_name
   FROM ms.leads l JOIN ms.lead_students ls ON ls.lead_id=l.id AND ls.confirmation_state<>'withdrawn'
   JOIN ms.students s ON s.id=ls.student_id AND ${activeScopedStudent}
   WHERE ${where}
  ), milestones AS (
   SELECT s.lead_id,s.student_id,s.display_name,h.recorded_at,
    CASE
     WHEN h.body->>'type'='meeting' AND h.state='completed' THEN 'meeting_completed'
     WHEN h.body->>'type'='trial' AND h.state='completed' THEN 'trial_completed'
     WHEN h.body->>'type'='trial' AND h.state='confirmed' THEN 'trial_confirmed'
    END AS milestone
   FROM scoped_students s JOIN ms_workspace.records r
    ON r.lead_id=s.lead_id AND r.organization_id=$1 AND r.kind='appointments'
   JOIN ms_workspace.history h ON h.record_id=r.id AND h.state IN ('confirmed','completed')
   WHERE CASE WHEN jsonb_typeof(h.body->'student_ids')='array'
     THEN (h.body->'student_ids') ? s.student_id::text ELSE r.student_id=s.student_id END
   UNION ALL
   SELECT s.lead_id,s.student_id,s.display_name,a.happened_at,'enrollment_succeeded'
   FROM scoped_students s JOIN ms.audit_events a
    ON a.organization_id=$1 AND a.target_type='lead' AND a.target_id=s.lead_id
    AND a.event_name='V34_ENROLLMENT_SUCCESS' AND a.after_business_json->>'student_id'=s.student_id::text
  ), first_milestones AS (
   SELECT lead_id,student_id,display_name,
    min(recorded_at) FILTER (WHERE milestone='meeting_completed') AS meeting_completed,
    min(recorded_at) FILTER (WHERE milestone='trial_confirmed') AS trial_confirmed,
    min(recorded_at) FILTER (WHERE milestone='trial_completed') AS trial_completed,
    min(recorded_at) FILTER (WHERE milestone='enrollment_succeeded') AS enrollment_succeeded
   FROM milestones GROUP BY lead_id,student_id,display_name
  ), paths AS (
   SELECT lead_id,student_id,display_name,trial_confirmed AS recorded_at,'direct_to_trial_students' AS metric
   FROM first_milestones
   WHERE trial_confirmed IS NOT NULL AND (meeting_completed IS NULL OR trial_confirmed<meeting_completed)
   UNION ALL
   SELECT lead_id,student_id,display_name,enrollment_succeeded,'direct_enroll_without_trial_students'
   FROM first_milestones
   WHERE enrollment_succeeded IS NOT NULL AND (trial_completed IS NULL OR enrollment_succeeded<trial_completed)
  ), path_students AS (
   SELECT metric,student_id AS id,display_name,min(recorded_at) AS recorded_at,count(*)::int AS lead_count
   FROM paths ${period} GROUP BY metric,student_id,display_name
  )`;
 return {sql,params};
}
async function salesPathCounts(c,ctx,scope){
 const {sql,params}=salesPathFacts(ctx,scope);
 const rows=(await c.query(`${sql} SELECT metric,count(*)::int AS total FROM path_students GROUP BY metric`,params)).rows;
 const counts=new Map(rows.map(row=>[row.metric,row.total]));
 return Object.fromEntries(salesPathMetricKeys.map(metric=>[metric,counts.get(metric)??0]));
}
async function salesPathDrilldown(c,ctx,scope,metric,page,pageSize){
 const {sql,params}=salesPathFacts(ctx,scope);
 const key=params.push(metric),limit=params.push(pageSize),offset=params.push((page-1)*pageSize);
 const result=(await c.query(`${sql}, matching AS (
   SELECT id,display_name,recorded_at,lead_count FROM path_students WHERE metric=$${key}
  ), page_rows AS (
   SELECT * FROM matching ORDER BY display_name,id LIMIT $${limit} OFFSET $${offset}
  )
  SELECT (SELECT count(*)::int FROM matching) AS total,
   COALESCE(jsonb_agg(to_jsonb(page_rows) ORDER BY display_name,id),'[]'::jsonb) AS items
  FROM page_rows`,params)).rows[0];
 return {...flags,metric,filters:scope,page,page_size:pageSize,...result};
}
async function metricsDrilldown(c,ctx,query={}){
 const {metric,page='1',page_size='20',...filters}=query;
 if(!/^[1-9]\d{0,5}$/.test(page)||!/^[1-9]\d?$/.test(page_size)||Number(page_size)>50){
  fail(422,'VALIDATION_ERROR','请选择有效页码，每页最多 50 条');
 }
 const scope=metricsScope(filters);
 if(scope.view_mode!=='snapshot'&&salesPathMetricKeys.includes(metric))return salesPathDrilldown(c,ctx,scope,metric,Number(page),Number(page_size));
 if(scope.view_mode==='event')return eventMetricsDrilldown(c,ctx,scope,metric,Number(page),Number(page_size));
 if(scope.view_mode==='snapshot')return snapshotDrilldown(c,ctx,scope,metric,Number(page),Number(page_size));
 if(!['leads','students','won_leads','lost_leads'].includes(metric))fail(422,'VALIDATION_ERROR','该指标暂不支持查看明细');
 const {where,params}=salesLeadScope(ctx,scope);
 const limit=params.push(Number(page_size)),offset=params.push((Number(page)-1)*Number(page_size));
 const students=metric==='students';
 const terminalState=metric==='won_leads'?'won':metric==='lost_leads'?'lost':null;
 const terminalFilter=terminalState?` AND EXISTS (
  SELECT 1 FROM ms_workspace.lead_workflow current_workflow
  WHERE current_workflow.lead_id=l.id AND current_workflow.organization_id=l.organization_id
    AND current_workflow.terminal_state=$${params.push(terminalState)}
 )`:'';
 const matching=students?`
  SELECT s.id,s.display_name,count(DISTINCT l.id)::int AS lead_count
  FROM ms.leads l
  JOIN ms.lead_students ls ON ls.lead_id=l.id
  JOIN ms.students s ON s.id=ls.student_id AND ${activeScopedStudent}
  WHERE ${where}
  GROUP BY s.id,s.display_name
 `:`SELECT l.id,l.created_at,l.owner_user_id,l.contact_id,l.lead_state FROM ms.leads l WHERE ${where}${terminalFilter}`;
 const order=students?'display_name,id':'created_at DESC,id';
 const pageQuery=`SELECT * FROM matching ORDER BY ${order} LIMIT $${limit} OFFSET $${offset}`;
 const projection=students?pageQuery:`
  SELECT m.id,m.created_at,
    co.display_name AS contact_name,u.display_name AS owner_name,
    COALESCE(w.terminal_state,CASE WHEN m.lead_state IN ('closed','invalid') THEN 'legacy_closed' ELSE 'open' END) AS terminal_state
  FROM (${pageQuery}) m
  LEFT JOIN ms.contacts co ON co.id=m.contact_id AND co.organization_id=$1
  LEFT JOIN ms.staff_users u ON u.id=m.owner_user_id AND u.organization_id=$1
  LEFT JOIN ms_workspace.lead_workflow w ON w.lead_id=m.id AND w.organization_id=$1
 `;
 const result=(await c.query(`
  WITH matching AS (${matching}), page_rows AS (${projection})
  SELECT (SELECT count(*)::int FROM matching) AS total,
         COALESCE(jsonb_agg(to_jsonb(page_rows) ORDER BY ${order}),'[]'::jsonb) AS items
  FROM page_rows`,params)).rows[0];
 return {...flags,metric,filters:scope,page:Number(page),page_size:Number(page_size),...result};
}
async function listing(c,ctx,query={},scope=null){
 const q=typeof query?.q==='string'?query.q.trim().slice(0,100):'';
 const digits=q.replace(/[^0-9]/g,'');
 const {where,params}=salesLeadScope(ctx,scope);
 let qWhere='';
 if(q){
  params.push('%'+q+'%');
  const qIdx='$'+params.length;
  let dClause='';
  if(digits.length>=4){
   params.push('%'+digits+'%');
   dClause=` OR regexp_replace(COALESCE(w.contact_info,''),'[^0-9]','','g') ILIKE $${params.length}`;
  }
  qWhere=` AND (c.display_name ILIKE ${qIdx} OR w.contact_info ILIKE ${qIdx} OR EXISTS(SELECT 1 FROM ms.lead_students ls JOIN ms.students s ON s.id=ls.student_id WHERE ls.lead_id=l.id AND ${activeScopedStudent} AND s.display_name ILIKE ${qIdx})${dClause})`;
 }
 const rows=(await c.query(`SELECT l.id,l.lead_state,l.owner_user_id,l.created_at,c.display_name AS contact_name,u.display_name AS owner_name,u.status AS owner_status,NULLIF(btrim(e.event_type),'') AS original_source,(SELECT a.after_business_json->>'source' FROM ms.audit_events a WHERE a.organization_id=l.organization_id AND a.target_type='lead' AND a.target_id=l.id AND a.event_name='LEAD_SOURCE_UPDATED' ORDER BY a.happened_at DESC,a.id DESC LIMIT 1) AS current_source,
  w.stage,w.version,w.updated_at,w.terminal_state,w.primary_activity_id,w.do_not_contact,w.contact_info,
  a.body AS next_action,a.state AS activity_state,a.kind AS activity_kind,
  (SELECT jsonb_build_object('result',ae.after_business_json->>'result','failure_reason',ae.after_business_json->>'failure_reason','method',ae.after_business_json->>'method','happened_at',ae.happened_at) FROM ms.audit_events ae WHERE ae.organization_id=l.organization_id AND ae.target_type='lead' AND ae.target_id=l.id AND ae.event_name='V34_COMMUNICATION' ORDER BY ae.happened_at DESC,ae.id DESC LIMIT 1) AS last_communication,
  (SELECT jsonb_build_object('type',ap.body->>'type','state',ap.state,'due_at',ap.body->>'due_at','actual_attendance',ap.body->>'actual_attendance') FROM ms_workspace.records ap WHERE ap.lead_id=l.id AND ap.organization_id=l.organization_id AND ap.kind='appointments' ORDER BY (ap.state IN('pending','confirmed','rescheduled','in_progress')) DESC,(ap.state<>'cancelled') DESC,ap.updated_at DESC,ap.created_at DESC,ap.id DESC LIMIT 1) AS latest_appointment,
  (SELECT jsonb_agg(jsonb_build_object('id',s.id,'name',s.display_name)) FROM ms.lead_students ls JOIN ms.students s ON s.id=ls.student_id WHERE ls.lead_id=l.id AND ${activeScopedStudent}) AS students,
  (SELECT x.after_business_json->>'origin_group' FROM ms.audit_events x WHERE x.organization_id=l.organization_id AND x.target_type='lead' AND x.target_id=l.id AND x.event_name='LEAD_DESK_CREATED' ORDER BY x.happened_at LIMIT 1) AS origin_group
  FROM ms.leads l LEFT JOIN ms.contacts c ON c.id=l.contact_id LEFT JOIN ms.staff_users u ON u.id=l.owner_user_id LEFT JOIN ms.contact_events e ON e.id=l.source_event_id AND e.organization_id=l.organization_id
  LEFT JOIN ms_workspace.lead_workflow w ON w.lead_id=l.id LEFT JOIN ms_workspace.records a ON a.id=w.primary_activity_id
  WHERE ${where}${qWhere} ORDER BY l.created_at DESC,l.id`,params)).rows;
 const incoming=(await c.query("SELECT r.id,r.lead_id,r.body->>'reason' AS reason,w.version FROM ms_workspace.records r JOIN ms_workspace.lead_workflow w ON w.lead_id=r.lead_id WHERE r.organization_id=$1 AND r.kind='corrections' AND r.state='approved' AND r.body->>'type'='lead_transfer' AND r.body->>'target_owner'=$2",[ctx.user.organization_id,ctx.user.id])).rows;
 return {...flags,incoming,items:rows.map(({contact_info,...r})=>({...r,contact_info_masked:maskPhone(contact_info),terminal_state:r.terminal_state??(['closed','invalid'].includes(r.lead_state)?'legacy_closed':'open'),needs_arrangement:!r.version&&!['closed','invalid'].includes(r.lead_state),needs_assignment:!r.owner_user_id||r.owner_status!=='active',overdue:r.next_action?.due_at?Date.parse(r.next_action.due_at)<Date.now()&&r.terminal_state==='open':false})),staff:ctx.manager?(await c.query(`SELECT u.id,u.display_name FROM ms.staff_users u WHERE u.organization_id=$1 AND u.status='active' ${ctx.roleWorkspaces?"AND EXISTS(SELECT 1 FROM ms.user_role_grants g JOIN ms.role_templates rt ON rt.id=g.role_id WHERE g.user_id=u.id AND g.revoked_at IS NULL AND g.valid_from<=now() AND rt.role_code IN('sales_staff','sales_consultant','sales_manager','super_admin')) AND NOT EXISTS(SELECT 1 FROM ms.user_role_grants g JOIN ms.role_templates rt ON rt.id=g.role_id WHERE g.user_id=u.id AND g.revoked_at IS NULL AND g.valid_from<=now() AND rt.role_code IN('marketing','marketing_staff','marketing_manager','finance_verifier'))":''} ORDER BY u.display_name`,[ctx.user.organization_id])).rows:[]};
}
const eventMetricKeys=[
 'created_leads','communication_events','meeting_completion_events','trial_completion_events',
 'first_enrollment_success_events','won_events','lost_events','reopened_events',
];
function periodFacts(ctx,scope){
 const {where,params}=salesLeadScope(ctx,scope);
 const start=params.push(scope.start_at),end=params.push(scope.end_at);
 const sql=`
  WITH visible_leads AS (
   SELECT l.id,l.created_at,l.contact_id,l.owner_user_id FROM ms.leads l WHERE ${where}
  ), period_facts AS (
   SELECT l.id,l.id AS lead_id,l.created_at AS recorded_at,'created_leads' AS metric
   FROM visible_leads l WHERE l.created_at >= $${start}::timestamptz AND l.created_at < $${end}::timestamptz
   UNION ALL
   SELECT a.id,l.id,a.happened_at,
    CASE
     WHEN a.event_name='V34_COMMUNICATION' THEN 'communication_events'
     WHEN a.event_name='V34_WALK_IN_MEETING_COMPLETED'
       OR (a.event_name='V34_ACTIVITY_COMPLETED' AND a.after_business_json->>'type'='meeting') THEN 'meeting_completion_events'
     WHEN a.event_name='V34_ACTIVITY_COMPLETED' AND a.after_business_json->>'type'='trial' THEN 'trial_completion_events'
     WHEN a.event_name='V34_ENROLLMENT_SUCCESS' THEN 'first_enrollment_success_events'
     WHEN a.event_name='V34_CLOSED_WON' THEN 'won_events'
     WHEN a.event_name='V34_CLOSED_LOST' THEN 'lost_events'
     WHEN a.event_name='V34_REOPENED' THEN 'reopened_events'
    END
   FROM visible_leads l JOIN ms.audit_events a
    ON a.target_id=l.id AND a.target_type='lead' AND a.organization_id=$1
   WHERE a.happened_at >= $${start}::timestamptz AND a.happened_at < $${end}::timestamptz
  )`;
 return {sql,params};
}
async function eventMetrics(c,ctx,scope){
 const {sql,params}=periodFacts(ctx,scope);
 const rows=(await c.query(`${sql}
  SELECT metric,count(*)::int AS total FROM period_facts WHERE metric IS NOT NULL GROUP BY metric`,params)).rows;
 const counts=new Map(rows.map(row=>[row.metric,row.total]));
 const event_counts=Object.fromEntries(eventMetricKeys.map(metric=>[metric,counts.get(metric)??0]));
 const path_counts=await salesPathCounts(c,ctx,scope);
 return {...flags,timezone:'Asia/Shanghai',filters:scope,event_time_basis:'recorded_at',event_counts,path_counts};
}
async function eventMetricsDrilldown(c,ctx,scope,metric,page,pageSize){
 if(!eventMetricKeys.includes(metric))fail(422,'VALIDATION_ERROR','该当期指标暂不支持查看明细');
 const {sql,params}=periodFacts(ctx,scope);
 const key=params.push(metric),limit=params.push(pageSize),offset=params.push((page-1)*pageSize);
 const result=(await c.query(`${sql}, matching AS (
  SELECT id,lead_id,recorded_at FROM period_facts WHERE metric=$${key}
 ), page_rows AS (
  SELECT f.id,f.lead_id,f.recorded_at,co.display_name AS contact_name,u.display_name AS owner_name
  FROM (SELECT * FROM matching ORDER BY recorded_at DESC,id LIMIT $${limit} OFFSET $${offset}) f
  JOIN visible_leads l ON l.id=f.lead_id
  LEFT JOIN ms.contacts co ON co.id=l.contact_id AND co.organization_id=$1
  LEFT JOIN ms.staff_users u ON u.id=l.owner_user_id AND u.organization_id=$1
 )
 SELECT (SELECT count(*)::int FROM matching) AS total,
        COALESCE(jsonb_agg(to_jsonb(page_rows) ORDER BY recorded_at DESC,id),'[]'::jsonb) AS items
 FROM page_rows`,params)).rows[0];
 return {...flags,metric,filters:scope,page,page_size:pageSize,event_time_basis:'recorded_at',...result};
}
const snapshotMetricStates=new Map([
 ['snapshot_leads',null],['snapshot_open','open'],['snapshot_won','won'],
 ['snapshot_lost','lost'],['snapshot_unknown','unknown'],
]);
const snapshotActivityMetrics=new Map([
 ['snapshot_pending_activities','state=ANY(active_states)'],
 ['snapshot_overdue_activities','state=ANY(active_states) AND due_at<cutoff'],
 ['snapshot_unknown_activities','recorded_at IS NULL OR (state=ANY(active_states) AND due_at IS NULL)'],
]);
function historicalLeadStates(ctx,scope){
 const {where,params}=salesLeadScope(ctx,scope);
 const at=params.push(scope.as_of_at);
 const sql=`
  WITH snapshot AS (
   SELECT l.id,l.created_at,l.contact_id,l.owner_user_id,
    COALESCE(e.terminal_state,'unknown') AS terminal_state,e.stage,e.recorded_at
   FROM ms.leads l
   LEFT JOIN LATERAL (
    SELECT a.after_business_json->>'terminal_state' AS terminal_state,
           a.after_business_json->>'stage' AS stage,a.happened_at AS recorded_at
    FROM ms.audit_events a
    WHERE a.target_type='lead' AND a.target_id=l.id AND a.organization_id=l.organization_id
      AND a.happened_at <= $${at}::timestamptz AND left(a.event_name,4)='V34_'
      AND a.after_business_json->>'terminal_state' IN ('open','won','lost')
      AND NULLIF(a.after_business_json->>'stage','') IS NOT NULL
      AND jsonb_typeof(a.after_business_json->'workflow_version')='number'
    ORDER BY (a.after_business_json->>'workflow_version')::numeric DESC,a.happened_at DESC,a.id DESC
    LIMIT 1
   ) e ON true
   WHERE ${where} AND l.created_at <= $${at}::timestamptz
  )`;
 return {sql,params,at};
}
function historicalActivityStates(ctx,scope){
 const {sql,params,at}=historicalLeadStates(ctx,scope);
 const activeStates=params.push(activeActivityStates);
 return {params,sql:`${sql}, activity_snapshot AS (
  SELECT r.id,r.lead_id,r.kind,r.created_at,h.state,h.recorded_at,
   CASE WHEN h.body->>'due_at' ~ '^\\d{4}-\\d{2}-\\d{2}T'
         AND h.body->>'due_at' ~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
         AND pg_input_is_valid(h.body->>'due_at','timestamp with time zone')
        THEN (h.body->>'due_at')::timestamptz END AS due_at,
   $${at}::timestamptz AS cutoff,$${activeStates}::text[] AS active_states
  FROM snapshot l
  JOIN ms_workspace.records r ON r.lead_id=l.id AND r.organization_id=$1
  LEFT JOIN LATERAL (
   SELECT state,body,recorded_at FROM ms_workspace.history
   WHERE record_id=r.id AND recorded_at <= $${at}::timestamptz
   ORDER BY version DESC LIMIT 1
  ) h ON true
  WHERE r.kind IN ('tasks','appointments') AND r.created_at <= $${at}::timestamptz
 )`};
}
function historicalVisibleLeads(ctx,scope){
 const {where,params}=salesLeadScope(ctx,scope);
 const at=params.push(scope.as_of_at);
 const sql=`
  WITH visible_leads AS (
   SELECT l.id,l.contact_id,l.owner_user_id FROM ms.leads l
   WHERE ${where} AND l.created_at <= $${at}::timestamptz
  )`;
 return {sql,params,at};
}
async function historicalStudentCoverage(c,scope){
 const result=await c.query(
  'SELECT to_jsonb(applied_at) AS started_at,applied_at <= $1::timestamptz AS available FROM ms_workspace.schema_versions WHERE version=36',
  [scope.as_of_at],
 );
 return result.rows[0]??{started_at:null,available:false};
}
function historicalStudents(ctx,scope){
 const {sql,params,at}=historicalVisibleLeads(ctx,scope);
 return {params,sql:`${sql}, link_snapshot AS (
  SELECT DISTINCT ON (h.lead_id,h.student_id) h.lead_id,h.student_id,h.linked
  FROM visible_leads l JOIN ms_workspace.lead_student_history h ON h.lead_id=l.id
  WHERE h.recorded_at <= $${at}::timestamptz
  ORDER BY h.lead_id,h.student_id,h.recorded_at DESC,h.event_id DESC
 ), linked_students AS (
  SELECT student_id,count(*)::int AS lead_count FROM link_snapshot WHERE linked GROUP BY student_id
 ), student_snapshot AS (
  SELECT l.student_id,l.lead_count
  FROM linked_students l
  JOIN LATERAL (
   SELECT active FROM ms_workspace.student_archive_history h
   WHERE h.organization_id=$1 AND h.student_id=l.student_id AND h.recorded_at <= $${at}::timestamptz
   ORDER BY h.recorded_at DESC,h.event_id DESC LIMIT 1
  ) h ON h.active
 )`};
}
async function snapshotStudentDrilldown(c,ctx,scope,page,pageSize){
 const coverage=await historicalStudentCoverage(c,scope);
 if(!coverage.available)fail(422,'STUDENT_HISTORY_UNAVAILABLE','所选时点缺少可核对的学生关联历史');
 const {sql,params}=historicalStudents(ctx,scope);
 const limit=params.push(pageSize),offset=params.push((page-1)*pageSize);
 const result=(await c.query(`${sql}, matching AS (
  SELECT snapshot.student_id AS sort_id,s.id,s.display_name,snapshot.lead_count
  FROM student_snapshot snapshot
  LEFT JOIN ms.students s ON s.id=snapshot.student_id AND s.organization_id=$1 AND s.archived_at IS NULL
   AND EXISTS (
    SELECT 1 FROM link_snapshot h JOIN ms.lead_students current_link
     ON current_link.lead_id=h.lead_id AND current_link.student_id=h.student_id
    WHERE h.linked AND h.student_id=snapshot.student_id AND current_link.confirmation_state<>'withdrawn'
   )
 ), page_rows AS (
  SELECT * FROM matching ORDER BY display_name NULLS LAST,sort_id LIMIT $${limit} OFFSET $${offset}
 )
 SELECT (SELECT count(*)::int FROM matching) AS total,
  COALESCE(jsonb_agg(to_jsonb(page_rows)-'sort_id' ORDER BY display_name NULLS LAST,sort_id),'[]'::jsonb) AS items
 FROM page_rows`,params)).rows[0];
 return {...flags,metric:'snapshot_students',filters:scope,page,page_size:pageSize,...result};
}
const snapshotCashMetrics=new Map([
 ['snapshot_verified_receipts','receipt'],['snapshot_verified_refunds','refund'],
]);
function historicalCashFacts(ctx,scope){
 const {sql:visible,params,at}=historicalVisibleLeads(ctx,scope);
 const sql=`${visible}, verified_records AS (
   SELECT r.id,r.lead_id,r.kind,h.body
   FROM visible_leads l JOIN ms_workspace.records r ON r.lead_id=l.id AND r.organization_id=$1
   JOIN LATERAL (
    SELECT body FROM ms_workspace.history h
    WHERE h.record_id=r.id AND h.state='verified' AND h.recorded_at <= $${at}::timestamptz
    ORDER BY h.version LIMIT 1
   ) h ON true
   WHERE r.kind IN ('payments','refunds') AND r.created_at <= $${at}::timestamptz
  ), receipts AS (
   SELECT r.id,r.lead_id,p.id AS projection_id,p.amount_cents,p.verified_at
   FROM verified_records r
   JOIN ms.payment_receipt_projections p
    ON p.id::text=r.body->>'receipt_id' AND p.authority_system='standalone_sales'
    AND p.external_tenant=$1::uuid::text AND p.verified_at <= $${at}::timestamptz
    AND to_jsonb(p.amount_cents)=r.body->'amount_cents'
   WHERE r.kind='payments'
  ), cash_facts AS (
   SELECT id,lead_id,amount_cents,verified_at,'receipt' AS kind FROM receipts
   UNION ALL
   SELECT r.id,r.lead_id,f.amount_cents,f.verified_at,'refund' AS kind
   FROM verified_records r
   JOIN receipts p ON p.id::text=r.body->>'payment_id' AND p.lead_id=r.lead_id
   JOIN ms.refund_projections f
    ON f.id::text=r.body->>'refund_id' AND f.original_receipt_id=p.projection_id
    AND f.authority_system='standalone_sales' AND f.external_tenant=$1::uuid::text
    AND f.verified_at BETWEEN p.verified_at AND $${at}::timestamptz
    AND to_jsonb(f.amount_cents)=r.body->'amount_cents'
   WHERE r.kind='refunds'
  )`;
 return {sql,params};
}
async function snapshotCash(c,ctx,scope){
 const {sql,params}=historicalCashFacts(ctx,scope);
 return (await c.query(`${sql}
  SELECT count(*) FILTER (WHERE kind='receipt')::int AS receipts,
         count(*) FILTER (WHERE kind='refund')::int AS refunds,
         COALESCE(sum(amount_cents) FILTER (WHERE kind='receipt'),0)::text AS gross_cents,
         COALESCE(sum(amount_cents) FILTER (WHERE kind='refund'),0)::text AS refunded_cents,
         COALESCE(sum(CASE WHEN kind='receipt' THEN amount_cents ELSE -amount_cents END),0)::text AS net_cents
  FROM cash_facts`,params)).rows[0];
}
async function snapshotCashDrilldown(c,ctx,scope,metric,page,pageSize){
 const {sql,params}=historicalCashFacts(ctx,scope);
 const kind=params.push(snapshotCashMetrics.get(metric));
 const limit=params.push(pageSize),offset=params.push((page-1)*pageSize);
 const result=(await c.query(`${sql}, matching AS (
  SELECT * FROM cash_facts WHERE kind=$${kind}
 ), page_rows AS (
  SELECT m.id,m.lead_id,m.amount_cents::text AS amount_cents,m.verified_at,
         co.display_name AS contact_name,u.display_name AS owner_name
  FROM (SELECT * FROM matching ORDER BY verified_at DESC,id LIMIT $${limit} OFFSET $${offset}) m
  JOIN visible_leads l ON l.id=m.lead_id
  LEFT JOIN ms.contacts co ON co.id=l.contact_id AND co.organization_id=$1
  LEFT JOIN ms.staff_users u ON u.id=l.owner_user_id AND u.organization_id=$1
 )
 SELECT (SELECT count(*)::int FROM matching) AS total,
        COALESCE(jsonb_agg(to_jsonb(page_rows) ORDER BY verified_at DESC,id),'[]'::jsonb) AS items
 FROM page_rows`,params)).rows[0];
 return {...flags,metric,filters:scope,page,page_size:pageSize,...result};
}
async function snapshotMetrics(c,ctx,scope){
 const {sql,params}=historicalActivityStates(ctx,scope);
 const activityCounts=[...snapshotActivityMetrics].map(([key,predicate])=>
  `(SELECT count(*)::int FROM activity_snapshot WHERE ${predicate}) AS ${key}`,
 ).join(', ');
 const snapshot_counts=(await c.query(`${sql}
  SELECT count(*)::int AS snapshot_leads,
         count(*) FILTER (WHERE terminal_state='open')::int AS snapshot_open,
         count(*) FILTER (WHERE terminal_state='won')::int AS snapshot_won,
         count(*) FILTER (WHERE terminal_state='lost')::int AS snapshot_lost,
         count(*) FILTER (WHERE terminal_state='unknown')::int AS snapshot_unknown,
         ${activityCounts}
  FROM snapshot`,params)).rows[0];
 const snapshot_cash=await snapshotCash(c,ctx,scope);
 const student_history=await historicalStudentCoverage(c,scope);
 if(student_history.available){
  const studentQuery=historicalStudents(ctx,scope);
  snapshot_counts.snapshot_students=(await c.query(
   `${studentQuery.sql} SELECT count(*)::int AS total FROM student_snapshot`,studentQuery.params,
  )).rows[0].total;
 }
 return {...flags,timezone:'Asia/Shanghai',filters:scope,snapshot_counts,snapshot_cash,student_history};
}
async function snapshotActivityDrilldown(c,ctx,scope,metric,page,pageSize){
 const {sql,params}=historicalActivityStates(ctx,scope);
 const limit=params.push(pageSize),offset=params.push((page-1)*pageSize);
 const result=(await c.query(`${sql}, matching AS (
  SELECT * FROM activity_snapshot WHERE ${snapshotActivityMetrics.get(metric)}
 ), page_rows AS (
  SELECT m.id,m.lead_id,m.kind,m.created_at,m.state AS activity_state,m.due_at,m.recorded_at,
         co.display_name AS contact_name,u.display_name AS owner_name
  FROM (SELECT * FROM matching ORDER BY created_at DESC,id LIMIT $${limit} OFFSET $${offset}) m
  JOIN snapshot l ON l.id=m.lead_id
  LEFT JOIN ms.contacts co ON co.id=l.contact_id AND co.organization_id=$1
  LEFT JOIN ms.staff_users u ON u.id=l.owner_user_id AND u.organization_id=$1
 )
 SELECT (SELECT count(*)::int FROM matching) AS total,
        COALESCE(jsonb_agg(to_jsonb(page_rows) ORDER BY created_at DESC,id),'[]'::jsonb) AS items
 FROM page_rows`,params)).rows[0];
 return {...flags,metric,filters:scope,page,page_size:pageSize,...result};
}
async function snapshotDrilldown(c,ctx,scope,metric,page,pageSize){
 if(metric==='snapshot_students')return snapshotStudentDrilldown(c,ctx,scope,page,pageSize);
 if(snapshotCashMetrics.has(metric))return snapshotCashDrilldown(c,ctx,scope,metric,page,pageSize);
 if(snapshotActivityMetrics.has(metric))return snapshotActivityDrilldown(c,ctx,scope,metric,page,pageSize);
 if(!snapshotMetricStates.has(metric))fail(422,'VALIDATION_ERROR','该历史时点指标暂不支持查看明细');
 const {sql,params}=historicalLeadStates(ctx,scope);
 const state=snapshotMetricStates.get(metric);
 const stateWhere=state?`WHERE terminal_state=$${params.push(state)}`:'';
 const limit=params.push(pageSize),offset=params.push((page-1)*pageSize);
 const result=(await c.query(`${sql}, matching AS (
  SELECT * FROM snapshot ${stateWhere}
 ), page_rows AS (
  SELECT m.id,m.created_at,m.terminal_state,m.stage,m.recorded_at,
         co.display_name AS contact_name,u.display_name AS owner_name
  FROM (SELECT * FROM matching ORDER BY created_at DESC,id LIMIT $${limit} OFFSET $${offset}) m
  LEFT JOIN ms.contacts co ON co.id=m.contact_id AND co.organization_id=$1
  LEFT JOIN ms.staff_users u ON u.id=m.owner_user_id AND u.organization_id=$1
 )
 SELECT (SELECT count(*)::int FROM matching) AS total,
        COALESCE(jsonb_agg(to_jsonb(page_rows) ORDER BY created_at DESC,id),'[]'::jsonb) AS items
 FROM page_rows`,params)).rows[0];
 return {...flags,metric,filters:scope,page,page_size:pageSize,...result};
}
async function metrics(c,ctx,query){
 const scope=metricsScope(query);
 if(scope.view_mode==='event')return eventMetrics(c,ctx,scope);
 if(scope.view_mode==='snapshot')return snapshotMetrics(c,ctx,scope);
 const list=await listing(c,ctx,{},scope),ids=list.items.map(l=>l.id);
 const records=ids.length?(await c.query('SELECT * FROM ms_workspace.records WHERE lead_id=ANY($1::uuid[])',[ids])).rows:[];
 const events=ids.length?(await c.query("SELECT * FROM ms.audit_events WHERE organization_id=$1 AND target_type='lead' AND target_id=ANY($2::uuid[]) AND event_name LIKE 'V34_%' ORDER BY happened_at,id",[ctx.user.organization_id,ids])).rows:[];
 const comm=events.filter(e=>e.event_name==='V34_COMMUNICATION'),appointments=records.filter(r=>r.kind==='appointments'),enroll=records.filter(r=>r.kind==='enrollments');
 const studentKeys=l=>l.students?.length?l.students.map(s=>s.id):[];
 const unique=leads=>new Set(leads.flatMap(studentKeys)).size;
 const leadBy=id=>list.items.find(l=>l.id===id);
 const commLeads=cs=>cs.map(e=>leadBy(e.target_id));const uniqueComm=cs=>new Set(cs.flatMap(e=>e.after_business_json.student_ids||[])).size;
 const apStudents=rs=>new Set(rs.flatMap(r=>r.body.student_ids??(r.student_id?[r.student_id]:[]))).size;
 const failed=comm.filter(e=>e.after_business_json.result==='failed'),latest=new Map();for(const e of comm)latest.set(e.target_id,e);
 const failureStreak=l=>{let n=0;for(const e of comm.filter(e=>e.target_id===l.id).reverse()){if(e.after_business_json.result!=='failed')break;n++;}return n;};
 const day=d=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(d));const now=Date.now(),today=day(now),tasks=records.filter(r=>['tasks','appointments'].includes(r.kind));
 const pending=tasks.filter(active),completed=tasks.filter(r=>r.state==='completed');
 const isPastDue=activity=>Date.parse(activity.body.due_at)<now;
 const overdueActivities=pending.filter(isPastDue);
 const overdueActivitiesByLead=new Map();
 for(const activity of overdueActivities){
  overdueActivitiesByLead.set(activity.lead_id,(overdueActivitiesByLead.get(activity.lead_id)??0)+1);
 }
 const hasOverduePrimary=lead=>lead.terminal_state==='open'&&Date.parse(lead.next_action?.due_at)<now;
 const everSuccessful=enroll.filter(r=>r.body.first_success_at);
 const successful=everSuccessful.filter(r=>r.state==='successful');
 const offlineStudents=new Set([...comm.filter(e=>e.after_business_json.category==='offline'&&e.after_business_json.result==='communicated').flatMap(e=>e.after_business_json.student_ids||[]),...appointments.filter(a=>a.body.type==='meeting'&&a.state==='completed').flatMap(a=>a.body.student_ids??(a.student_id?[a.student_id]:[]))]);
 const count={leads:list.items.length,students:unique(list.items),unidentified_leads:list.items.filter(l=>!l.students?.length).length,attempted_students:uniqueComm(comm),contacted_students:uniqueComm(comm.filter(e=>e.after_business_json.result==='communicated')),failed_attempts:failed.length,waiting_leads:[...latest.values()].filter(e=>e.after_business_json.result==='waiting'&&leadBy(e.target_id).terminal_state==='open').length,
  online_communicated_students:uniqueComm(comm.filter(e=>e.after_business_json.category==='online'&&e.after_business_json.result==='communicated')),offline_communicated_students:offlineStudents.size,
  invited_students:uniqueComm(comm.filter(e=>e.after_business_json.purpose==='invite')),agreed_meeting_students:uniqueComm(comm.filter(e=>['agreed_unscheduled','confirmed'].includes(e.after_business_json.invite_result))),confirmed_meeting_students:apStudents(appointments.filter(r=>r.body.type==='meeting'&&r.body.was_scheduled!==false&&['confirmed','rescheduled','completed','no_show'].includes(r.state))),
  scheduled_meeting_attended_students:apStudents(appointments.filter(r=>r.body.type==='meeting'&&r.body.was_scheduled!==false&&r.body.actual_attendance==='attended')),walk_in_meeting_students:apStudents(appointments.filter(r=>r.body.type==='meeting'&&r.body.was_scheduled===false&&r.body.actual_attendance==='attended')),attended_meeting_students:apStudents(appointments.filter(r=>r.body.type==='meeting'&&r.body.actual_attendance==='attended')),completed_meeting_students:apStudents(appointments.filter(r=>r.body.type==='meeting'&&r.state==='completed')),
  trial_booked_students:apStudents(appointments.filter(r=>r.body.type==='trial'&&!['pending','cancelled'].includes(r.state))),trial_completed_students:apStudents(appointments.filter(r=>r.body.type==='trial'&&r.state==='completed')),
  enrollment_intent_students:unique(list.items.filter(l=>l.stage==='enrollment_intent')),enrollment_success_orders:successful.length,enrollment_success_students:apStudents(successful),historical_enrollment_success_orders:new Set(everSuccessful.map(r=>r.body.order_id??r.id)).size,historical_enrollment_success_students:apStudents(everSuccessful),settled_orders:enroll.filter(r=>r.state==='successful'&&r.body.balance_cents===0).length,
  received_cents:enroll.reduce((n,r)=>n+(r.body.net_cents||0),0),unsettled_cents:enroll.filter(r=>r.state!=='cancelled').reduce((n,r)=>n+(r.body.balance_cents??r.body.amount_cents??0),0),won_leads:list.items.filter(l=>l.terminal_state==='won').length,lost_leads:list.items.filter(l=>l.terminal_state==='lost').length,
  due_today:pending.filter(r=>r.body.due_at&&day(r.body.due_at)===today).length,completed_today:completed.filter(r=>(r.body.completed_at||r.body.finished_at)&&day(r.body.completed_at||r.body.finished_at)===today).length,overdue:overdueActivities.length,overdue_activities:overdueActivities.length,overdue_primary_leads:list.items.filter(hasOverduePrimary).length,missing_next:list.items.filter(l=>l.needs_arrangement).length,continuous_failed_leads:list.items.filter(l=>l.terminal_state==='open'&&failureStreak(l)>=2).length,stale_open_leads:list.items.filter(l=>l.terminal_state==='open'&&Date.parse(l.updated_at||l.created_at)<now-14*86400000).length,paused_leads:list.items.filter(l=>l.stage==='paused'&&l.terminal_state==='open').length,
  appointment_result_due:appointments.filter(r=>active(r)&&Date.parse(r.body.due_at)<now).length,unassigned_leads:list.items.filter(l=>l.needs_assignment&&l.terminal_state==='open').length,pending_transfer:records.filter(r=>r.kind==='corrections'&&r.body.type==='lead_transfer'&&['pending','approved'].includes(r.state)).length};
 const meetingSet=new Set(appointments.filter(r=>r.body.type==='meeting'&&r.body.actual_attendance==='attended').flatMap(r=>r.body.student_ids??(r.student_id?[r.student_id]:[]))),trialSet=new Set(appointments.filter(r=>r.body.type==='trial'&&r.state==='completed').map(r=>r.student_id));count.meeting_to_enrollment_students=apStudents(successful.filter(r=>meetingSet.has(r.student_id)&&appointments.some(a=>(a.student_id===r.student_id||a.body.student_ids?.includes(r.student_id))&&a.body.type==='meeting'&&a.state==='completed'&&Date.parse(a.body.finished_at)<=Date.parse(r.body.first_success_at))));count.trial_to_enrollment_students=apStudents(successful.filter(r=>trialSet.has(r.student_id)&&appointments.some(a=>(a.student_id===r.student_id||a.body.student_ids?.includes(r.student_id))&&a.body.type==='trial'&&a.state==='completed'&&Date.parse(a.body.finished_at)<=Date.parse(r.body.first_success_at))));
 const lostReasonHistory=new Map(),latestLossByLead=new Map();
 for(const event of events){
  if(event.event_name!=='V34_CLOSED_LOST')continue;
  const {reason,workflow_version:version}=event.after_business_json;
  if(typeof reason!=='string'||!reason.trim())continue;
  lostReasonHistory.set(reason,(lostReasonHistory.get(reason)??0)+1);
  const previous=latestLossByLead.get(event.target_id);
  // Workflow versions break timestamp ties and follow the lead's transition order.
  if(!previous||(version??0)>=previous.version)latestLossByLead.set(event.target_id,{reason,version:version??0});
 }
 const sources=new Map();
 for(const lead of list.items){
  const source=lead.original_source??'';
  if(!sources.has(source))sources.set(source,{source,leads:0,open:0,won:0,lost:0,legacy_closed:0});
  const row=sources.get(source);
  row.leads++;
  row[lead.terminal_state]++;
 }
 const bySource=[...sources.values()].sort((a,b)=>b.leads-a.leads||a.source.localeCompare(b.source,'zh-CN'));
 const currentLostReasons=new Map();
 for(const lead of list.items){
  if(lead.terminal_state!=='lost')continue;
  const loss=latestLossByLead.get(lead.id);
  if(loss)currentLostReasons.set(loss.reason,(currentLostReasons.get(loss.reason)??0)+1);
 }
 const pending_approvals=ctx.manager?[
  ...records.filter(r=>r.kind==='quotes'&&r.state==='draft'&&r.body.discount_state==='pending'&&leadBy(r.lead_id)?.terminal_state==='open').map(r=>({id:r.id,lead_id:r.lead_id,kind:'discount',title:'优惠/非标课程方案待审批',contact_name:leadBy(r.lead_id)?.contact_name,owner_name:leadBy(r.lead_id)?.owner_name,can_review:r.body.quoted_by!==ctx.user.id})),
  ...enroll.filter(r=>r.state!=='cancelled'&&!r.body.agreement_confirmed).map(r=>({id:r.id,lead_id:r.lead_id,kind:'agreement',title:'报名协议待独立核实',contact_name:leadBy(r.lead_id)?.contact_name,owner_name:leadBy(r.lead_id)?.owner_name,can_review:r.body.submitted_by!==ctx.user.id})),
  ...records.filter(r=>r.kind==='corrections'&&r.state==='pending').map(r=>({id:r.id,lead_id:r.lead_id,kind:r.body.type,title:r.body.type==='lead_transfer'?'客户转交待独立复核':'报名退款/取消纠正待审批',contact_name:leadBy(r.lead_id)?.contact_name,owner_name:leadBy(r.lead_id)?.owner_name,can_review:r.body.requested_by!==ctx.user.id&&r.body.target_owner!==ctx.user.id}))
 ]:[];
 const path_counts=await salesPathCounts(c,ctx,scope);
 const supervision=await supervisionReports(c,ctx,scope);
 if(supervision.arrangement_supervision?.can_issue){
  const eligibleOwners=new Set(list.staff.map(staff=>staff.id));
  supervision.arrangement_supervision.candidates=list.items.filter(l=>l.needs_arrangement&&eligibleOwners.has(l.owner_user_id)).map(l=>l.id);
 }
 return {...flags,timezone:'Asia/Shanghai',filters:scope,counts:count,path_counts,...supervision,by_source:bySource,channel_cost_status:'COST_NOT_CONFIGURED',activity_counts:{communications:comm.length,appointments:appointments.length,completed_activities:completed.length},by_owner:[...new Set(list.items.map(l=>l.owner_user_id))].map(owner=>{const owned=list.items.filter(l=>l.owner_user_id===owner),ownedIds=owned.map(l=>l.id),ownedEnrollment=enroll.filter(e=>ownedIds.includes(e.lead_id));return {owner_id:owner,name:owned[0].owner_name||'主管待分配',leads:owned.length,open:owned.filter(l=>l.terminal_state==='open').length,won:owned.filter(l=>l.terminal_state==='won').length,lost:owned.filter(l=>l.terminal_state==='lost').length,overdue:owned.filter(hasOverduePrimary).length,overdue_activities:owned.reduce((sum,l)=>sum+(overdueActivitiesByLead.get(l.id)??0),0),overdue_primary_leads:owned.filter(hasOverduePrimary).length,missing_next:owned.filter(l=>l.needs_arrangement).length,completed_communications:comm.filter(e=>e.actor_user_id===owner&&e.after_business_json.result==='communicated').length,enrollment_success_orders:ownedEnrollment.filter(e=>e.state==='successful').length,verified_net_cents:ownedEnrollment.reduce((n,e)=>n+(e.body.net_cents||0),0)};}),lost_reasons:Object.fromEntries(lostReasonHistory),current_lost_reasons:Object.fromEntries(currentLostReasons),pending_approvals,reminders:pending.map(r=>({id:r.id,lead_id:r.lead_id,title:r.body.title,due_at:r.body.due_at,owner_user_id:r.owner_user_id,version:r.version,overdue:isPastDue(r),kind:r.kind,type:r.kind==='appointments'?r.body.type:(r.body.action||'call'),appointment_type:r.kind==='appointments'?r.body.type:null})),failures:list.items.map(l=>({lead_id:l.id,consecutive:failureStreak(l)})).filter(l=>l.consecutive>0)};
}
