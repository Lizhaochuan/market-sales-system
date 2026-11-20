// Department boundaries for the explicitly enabled, isolated role workspace.
import {fail} from './auth.mjs';
import {leadDesk} from './lead-desk.mjs';
export function workspaceAccess(ctx){
 const r=ctx.roles,admin=r.includes('super_admin'),market=r.some(x=>['marketing','marketing_staff','marketing_manager'].includes(x)),finance=r.includes('finance_verifier');
 return {enabled:true,admin,market:admin||market,sales:admin||!market&&!finance&&r.some(x=>['sales_staff','sales_consultant','sales_manager'].includes(x)),market_manager:admin||r.includes('marketing_manager'),sales_manager:admin||r.includes('sales_manager'),finance};
}
export function guardWorkspaceRoute(ctx,op,parts){
 if(!ctx.roleWorkspaces){if(ctx.roles.some(r=>['marketing','marketing_staff','marketing_manager'].includes(r)))fail(403,'DEPARTMENT_FORBIDDEN','市场身份须使用已启用部门隔离的工作台');return;}
 if(op==='getMe')return;
 const a=workspaceAccess(ctx);
 if(op==='workspace'&&parts[0]?.startsWith('workflow'))return;
 if(!a.admin)fail(403,'DEPARTMENT_FORBIDDEN','请使用本角色的工作台入口');
}
export function phoneNumber(value){
 if(typeof value!=='string'||value.length>40)fail(422,'PHONE_REQUIRED','请输入电话号码');
 let v=value.replace(/[\s()（）-]/g,'');if(v.startsWith('0086'))v='+86'+v.slice(4);if(/^\+861\d{10}$/.test(v))v=v.slice(3);
 if(!/^\+?\d{7,15}$/.test(v))fail(422,'PHONE_REQUIRED','请输入有效电话号码');return v;
}
const text=(v,max=1000)=>{if(typeof v!=='string'||!v.trim()||v.trim().length>max)fail(422,'VALIDATION_ERROR','请填写必要信息');return v.trim();};
const check=(b,keys)=>{if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).some(k=>!keys.includes(k)))fail(422,'VALIDATION_ERROR','包含不支持的字段');};
export async function lockPhone(c,org,phone){await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[org+':phone:'+phone]);}
async function matches(c,ctx,phone){return (await c.query(`SELECT d.lead_id,d.department,l.owner_user_id,u.display_name AS owner_name,co.display_name AS contact_name,e.event_type AS source,
 (SELECT jsonb_agg(jsonb_build_object('id',s.id,'name',s.display_name)) FROM ms.lead_students ls JOIN ms.students s ON s.id=ls.student_id WHERE ls.lead_id=l.id AND s.organization_id=l.organization_id AND s.archived_at IS NULL) AS students
 FROM ms_workspace.lead_directory d JOIN ms.leads l ON l.id=d.lead_id JOIN ms.contacts co ON co.id=l.contact_id LEFT JOIN ms.staff_users u ON u.id=l.owner_user_id LEFT JOIN ms.contact_events e ON e.id=l.source_event_id
 WHERE d.organization_id=$1 AND d.phone=$2 ORDER BY d.created_at,d.lead_id`,[ctx.user.organization_id,phone])).rows;}
export async function salesAssignee(c,ctx,id){
 const r=await c.query(`SELECT u.id FROM ms.staff_users u WHERE u.id=$1 AND u.organization_id=$2 AND u.status='active'
 AND EXISTS(SELECT 1 FROM ms.user_role_grants g JOIN ms.role_templates rt ON rt.id=g.role_id WHERE g.user_id=u.id AND g.revoked_at IS NULL AND g.valid_from<=now() AND rt.role_code IN('sales_staff','sales_consultant','sales_manager','super_admin'))
 AND NOT EXISTS(SELECT 1 FROM ms.user_role_grants g JOIN ms.role_templates rt ON rt.id=g.role_id WHERE g.user_id=u.id AND g.revoked_at IS NULL AND g.valid_from<=now() AND rt.role_code IN('marketing','marketing_staff','marketing_manager','finance_verifier'))`,[id,ctx.user.organization_id]);
 if(!r.rowCount)fail(422,'SALES_OWNER_REQUIRED','请选择有效的销售负责人');return id;
}
export async function prepareSalesIntake(c,ctx,b){
 const a=workspaceAccess(ctx);if(!a.sales)fail(403,'DEPARTMENT_FORBIDDEN','当前角色不能新建销售客户');
 if(b.origin_group!=='sales')fail(403,'DEPARTMENT_FORBIDDEN','市场线索请通过市场交接入口接收');
 const phone=phoneNumber(b.contact_info);await lockPhone(c,ctx.user.organization_id,phone);
 if((await matches(c,ctx,phone)).length)fail(409,'PHONE_MATCH_FOUND','该电话已有线索，请先查询并选择已有客户');
 await salesAssignee(c,ctx,b.owner_user_id||ctx.user.id);return phone;
}
export async function departmentRoute(c,ctx,{method,parts,body},helpers){
 const [,id,action]=parts,a=workspaceAccess(ctx),org=ctx.user.organization_id,actor=ctx.user.id;
 if(id==='market'){
  if(!a.market)fail(403,'DEPARTMENT_FORBIDDEN','市场工作台仅限市场人员及总管理者');
  if(method==='GET')return {handled:true,value:{access:a,items:(await c.query(`SELECT d.lead_id AS id,d.phone,d.marketing_notes,d.created_at,d.market_owner_id,u.display_name AS market_owner_name,d.department AS handoff_state,co.display_name AS contact_name,e.event_type AS source,
   (SELECT jsonb_agg(s.display_name) FROM ms.lead_students ls JOIN ms.students s ON s.id=ls.student_id WHERE ls.lead_id=l.id AND s.organization_id=l.organization_id AND s.archived_at IS NULL) AS students
   FROM ms_workspace.lead_directory d JOIN ms.leads l ON l.id=d.lead_id JOIN ms.contacts co ON co.id=l.contact_id JOIN ms.contact_events e ON e.id=l.source_event_id LEFT JOIN ms.staff_users u ON u.id=d.market_owner_id
   WHERE d.organization_id=$1 AND d.market_owner_id IS NOT NULL AND (d.market_owner_id=$2 OR $3) ORDER BY d.created_at DESC`,[org,actor,a.market_manager])).rows}};
  check(body,['phone','contact_name','student_name','source','notes']);const phone=phoneNumber(body.phone);await lockPhone(c,org,phone);
  if((await matches(c,ctx,phone)).length)fail(409,'PHONE_EXISTS','该电话号码已有线索，请联系主管核对，避免重复录入');
  const created=await leadDesk(c,{...ctx,manager:false},{method:'POST',parts:['leads'],body:{contact_name:body.contact_name,student_name:body.student_name||undefined,origin_group:'market',source:body.source}});
  await c.query("INSERT INTO ms_workspace.lead_directory(lead_id,organization_id,phone,department,market_owner_id,marketing_notes) VALUES($1,$2,$3,'market',$4,$5)",[created.lead_id,org,phone,actor,body.notes?text(body.notes):null]);
  await helpers.audit(c,ctx,{id:created.lead_id},'MARKET_CAPTURED',{market_owner_id:actor,source:body.source});return {handled:true,value:{lead_id:created.lead_id}};
 }
 if(id==='lookup'){
  if(!a.sales)fail(403,'DEPARTMENT_FORBIDDEN','电话号码查重仅限销售接单');check(body,['phone']);const phone=phoneNumber(body.phone);
  const found=await matches(c,ctx,phone);return {handled:true,value:{phone,items:found.map(r=>{const own=r.owner_user_id===actor||a.sales_manager;return r.department==='market'?{lead_id:r.lead_id,status:'market_available',contact_name:r.contact_name,source:r.source,students:r.students||[]} :own?{lead_id:r.lead_id,status:'sales_available',contact_name:r.contact_name,owner_name:r.owner_name,students:r.students||[]}:{status:'assigned',owner_name:r.owner_name};})}};
 }
 if(action==='claim'){
  if(!a.sales)fail(403,'DEPARTMENT_FORBIDDEN','只有销售可接收市场线索');check(body,['phone','next','initial_communication']);if(!/^[0-9a-f-]{36}$/i.test(id))fail(422,'VALIDATION_ERROR','线索编号错误');const phone=phoneNumber(body.phone);
  const l=(await c.query('SELECT * FROM ms.leads WHERE id=$1 AND organization_id=$2 FOR UPDATE',[id,org])).rows[0];if(!l)fail(404,'NOT_FOUND','未找到匹配线索');await lockPhone(c,org,phone);
  const d=(await c.query('SELECT * FROM ms_workspace.lead_directory WHERE lead_id=$1 AND organization_id=$2 AND phone=$3 FOR UPDATE',[id,org,phone])).rows[0];if(!d)fail(404,'NOT_FOUND','未找到匹配线索');
  if(d.department!=='market'){if(l.owner_user_id===actor)return {handled:true,value:{lead_id:id}};fail(409,'ALREADY_ASSIGNED','该线索已由其他销售接收');}
  await salesAssignee(c,ctx,actor);
  // Market capture created these student identities; never move a shared/global identity silently.
  const linked=(await c.query('SELECT s.id,s.owner_user_id FROM ms.lead_students ls JOIN ms.students s ON s.id=ls.student_id WHERE ls.lead_id=$1',[id])).rows;
  for(const s of linked){if(s.owner_user_id!==l.owner_user_id||(await c.query('SELECT 1 FROM ms.lead_students WHERE student_id=$1 AND lead_id<>$2',[s.id,id])).rowCount)fail(409,'STUDENT_REVIEW_REQUIRED','学生身份已有其他关联，需主管核实后交接');}
  const old=l.owner_user_id;l.owner_user_id=actor;await c.query('UPDATE ms.leads SET owner_user_id=$2 WHERE id=$1',[id,actor]);
  for(const s of linked)await c.query('UPDATE ms.students SET owner_user_id=$2 WHERE id=$1',[s.id,actor]);
  const task=await helpers.activity(c,ctx,l,body.next);const initialStage=body.initial_communication?await helpers.initialCommunication(c,ctx,l,body.initial_communication,task):'needs_discovery';await c.query('INSERT INTO ms_workspace.lead_workflow(lead_id,organization_id,primary_activity_id,contact_info,stage) VALUES($1,$2,$3,$4,$5)',[id,org,task.id,phone,task.kind==='appointments'&&task.body.type==='trial'&&task.state==='confirmed'?(['enrollment_intent','enrolling'].includes(initialStage)?initialStage:'trial_booked'):initialStage]);
  await c.query("UPDATE ms_workspace.lead_directory SET department='sales',handed_to=$2,handed_at=now() WHERE lead_id=$1",[id,actor]);await helpers.audit(c,ctx,l,'MARKET_HANDOFF_ACCEPTED',{market_owner_id:old,sales_owner_id:actor,primary_activity_id:task.id});
  return {handled:true,value:{lead_id:id}};
 }
 if(!a.sales&&!a.finance&&!a.admin)fail(403,'DEPARTMENT_FORBIDDEN','当前角色不可访问销售业务');
 return {handled:false};
}
