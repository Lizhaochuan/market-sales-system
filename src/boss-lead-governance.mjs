import {fail} from './auth.mjs';

const campusCode=/^[A-Z0-9][A-Z0-9_-]{0,39}$/;
const unassigned='@unassigned';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const actions=new Set(['submit-qualification','decide-qualification','assign-campus','request-campus-transfer','decide-campus-transfer']);
export const isGovernanceAction=action=>actions.has(action);
const supervisor=ctx=>ctx.manager||ctx.roles.includes('marketing_manager');

export async function loadCampusAccess(c,ctx){
 const version=await c.query('SELECT 1 FROM ms_workspace.schema_versions WHERE version=41');
 if(!version.rowCount)return {installed:false,configured:false,restricted:false,grants:[],choices:[]};
 const org=ctx.user.organization_id;
 const {rows:campuses}=await c.query(
  'SELECT code,display_name,active FROM ms_workspace.service_campuses WHERE organization_id=$1 ORDER BY display_name,code',[org],
 );
 const restricted=campuses.length>0&&supervisor(ctx)&&!ctx.roles.includes('super_admin');
 const {rows}=restricted?await c.query(
  'SELECT campus_code FROM ms_workspace.service_campus_grants WHERE organization_id=$1 AND staff_id=$2 AND revoked_at IS NULL ORDER BY campus_code',
  [org,ctx.user.id],
 ):{rows:[]};
 const grants=rows.map(row=>row.campus_code).filter(code=>code===unassigned||campuses.some(row=>row.code===code));
 return {installed:true,configured:campuses.length>0,restricted,grants,
  choices:campuses.filter(row=>!restricted||grants.includes(row.code))};
}

// All interpolated SQL identifiers originate in the application. User values are bound parameters.
function campusAt(alias,at){
 return `(SELECT e.after_business_json->>'campus_code' FROM ms.audit_events e
  WHERE e.organization_id=${alias}.organization_id AND e.target_type='lead' AND e.target_id=${alias}.id
   AND e.event_name='V34_SERVICE_CAMPUS_EFFECTIVE' AND e.happened_at<=${at}
   AND (e.after_business_json->>'effective_at')::timestamptz<=${at}
  ORDER BY (e.after_business_json->>'effective_at')::timestamptz DESC,e.happened_at DESC,e.id DESC LIMIT 1)`;
}
export function campusConditions(ctx,params,scope=null,alias='l',timestamp=null){
 const access=ctx.campusAccess;
 const code=scope?.campus_id;
 if(code!=null&&!campusCode.test(code)&&code!==unassigned)fail(422,'VALIDATION_ERROR','请选择有效校区');
 if(code!=null&&!access?.configured)fail(422,'CAMPUS_MAPPING_UNAVAILABLE','真实校区映射待补充');
 if(code!=null&&(code===unassigned?access.restricted&&!access.grants.includes(code):!access.choices.some(row=>row.code===code)))fail(403,'FORBIDDEN','无权查询所选校区');
 if(!access?.restricted&&code==null)return [];
 const at=timestamp??(scope?.as_of_at?`$${params.push(scope.as_of_at)}::timestamptz`:'statement_timestamp()');
 const current=`COALESCE(${campusAt(alias,at)},'@unassigned')`;
 const conditions=[];
 if(access.restricted)conditions.push(`${current}=ANY($${params.push(access.grants)}::text[])`);
 if(code!=null)conditions.push(`${current}=$${params.push(code)}`);
 return conditions;
}
export async function requireCampusLead(c,ctx,lead){
 if(!ctx.campusAccess?.restricted)return;
 const params=[lead.organization_id,lead.id];
 const conditions=campusConditions(ctx,params);
 const result=await c.query(`SELECT 1 FROM ms.leads l WHERE l.organization_id=$1 AND l.id=$2 AND ${conditions.join(' AND ')}`,params);
 if(!result.rowCount)fail(403,'FORBIDDEN','无权查看或处理该服务校区的线索');
}
function evidence(value){
 if(typeof value!=='string'||!value.trim()||value.trim().length>500)fail(422,'VALIDATION_ERROR','请提供有效的核验依据');
 return value.trim();
}
function check(body,fields){
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!fields.includes(k))){
  fail(422,'VALIDATION_ERROR','包含不支持的字段');
 }
}
async function latest(c,lead,event){
 const {rows:[row]}=await c.query(`SELECT id,actor_user_id,after_business_json AS facts FROM ms.audit_events
  WHERE organization_id=$1 AND target_type='lead' AND target_id=$2 AND event_name=$3
  ORDER BY happened_at DESC,(after_business_json->>'sequence')::int DESC NULLS LAST,id DESC LIMIT 1`,[lead.organization_id,lead.id,'V34_'+event]);
 return row??null;
}
async function pending(c,lead,kind){
 const {rows:[row]}=await c.query(`SELECT e.id,e.actor_user_id,e.after_business_json AS facts FROM ms.audit_events e
  WHERE e.organization_id=$1 AND e.target_type='lead' AND e.target_id=$2 AND e.event_name=$3
   AND NOT EXISTS (SELECT 1 FROM ms.audit_events d WHERE d.organization_id=e.organization_id AND d.target_type=e.target_type
    AND d.target_id=e.target_id AND d.event_name=$4 AND d.after_business_json->>'request_id'=e.id::text)
  ORDER BY e.happened_at DESC,e.id DESC LIMIT 1`,[lead.organization_id,lead.id,'V34_'+kind+'_REQUESTED','V34_'+kind+'_DECIDED']);
 return row??null;
}
async function currentCampus(c,lead){
 const {rows:[row]}=await c.query(`SELECT ${campusAt('l','statement_timestamp()')} AS code FROM ms.leads l WHERE l.organization_id=$1 AND l.id=$2`,[lead.organization_id,lead.id]);
 return row?.code??null;
}
async function ensureCampusTarget(c,ctx,code){
 if(typeof code!=='string'||!campusCode.test(code))fail(422,'VALIDATION_ERROR','请选择有效的服务校区');
 if(ctx.campusAccess.restricted&&!ctx.campusAccess.grants.includes(code))fail(403,'FORBIDDEN','无权审批转入该校区');
 const result=await c.query('SELECT 1 FROM ms_workspace.service_campuses WHERE organization_id=$1 AND code=$2 AND active',
  [ctx.user.organization_id,code]);
 if(!result.rowCount)fail(422,'VALIDATION_ERROR','请选择有效的服务校区');
}
async function duplicateTarget(c,ctx,lead,target){
 if(typeof target!=='string'||!uuid.test(target)||target===lead.id)fail(422,'VALIDATION_ERROR','请选择不同的主线索');
 const {rows:[canonical]}=await c.query(`SELECT id,organization_id,owner_user_id FROM ms.leads l WHERE id=$1 AND organization_id=$2
  ${ctx.roleWorkspaces?"AND NOT EXISTS (SELECT 1 FROM ms_workspace.lead_directory d WHERE d.lead_id=l.id AND d.department='market')":''}`,
  [target,lead.organization_id]);
 if(!canonical||(!ctx.manager&&canonical.owner_user_id!==ctx.user.id))fail(404,'NOT_FOUND','未找到可归并的主线索');
 await requireCampusLead(c,ctx,canonical);
 const other=await latest(c,canonical,'LEAD_QUALIFICATION_EFFECTIVE');
 const referenced=await c.query(`SELECT 1 FROM ms.audit_events e
  WHERE e.organization_id=$1 AND e.event_name='V34_LEAD_QUALIFICATION_EFFECTIVE'
   AND e.after_business_json->>'primary_lead_id'=$2 AND e.after_business_json->>'verdict'='duplicate'
   AND NOT EXISTS (SELECT 1 FROM ms.audit_events newer WHERE newer.organization_id=e.organization_id
    AND newer.target_id=e.target_id AND newer.target_type=e.target_type AND newer.event_name=e.event_name
    AND ((newer.happened_at,(newer.after_business_json->>'sequence')::int)>(e.happened_at,(e.after_business_json->>'sequence')::int)))
   LIMIT 1`,[lead.organization_id,lead.id]);
 if(other?.facts.verdict==='duplicate'||referenced.rowCount)fail(409,'DUPLICATE_CHAIN','主线索不能形成循环或多级归并');
}
const invalidReasons=['test','mistake','spam','false_contact'];
export async function readGovernance(c,ctx,lead){
 const effective=await latest(c,lead,'LEAD_QUALIFICATION_EFFECTIVE');
 const [qualification,campusTransfer]=await Promise.all([
  pending(c,lead,'LEAD_QUALIFICATION'),
  ctx.campusAccess.configured?pending(c,lead,'CAMPUS_TRANSFER'):null,
 ]);
 return {qualification:effective?.facts??{verdict:'pending'},qualification_request:qualification,
  campus_code:ctx.campusAccess.configured?await currentCampus(c,lead):null,campus_request:campusTransfer};
}
async function audit(c,ctx,lead,name,facts){
 await c.query(`WITH moment AS (SELECT clock_timestamp() AS at)
  INSERT INTO ms.audit_events(organization_id,actor_user_id,target_type,target_id,event_name,after_business_json,reason_zh,happened_at)
  SELECT $1,$2,'lead',$3,$4,
   CASE WHEN $4='V34_SERVICE_CAMPUS_EFFECTIVE' THEN $5::jsonb||jsonb_build_object('effective_at',at) ELSE $5::jsonb END,
   '独立市场销售端核验与校区归属记录',at FROM moment`,[lead.organization_id,ctx.user.id,lead.id,'V34_'+name,facts]);
}
export async function applyGovernance(c,ctx,lead,action,body){
 const actor=ctx.user.id;
 const decision=action.startsWith('decide-');
 if(decision?!ctx.manager:lead.owner_user_id!==actor){
  fail(403,'FORBIDDEN',decision?'仅销售主管可审核':'仅当前负责人可提交');
 }
 if(action.includes('qualification')){
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[lead.organization_id+':qualification']);
  const effective=await latest(c,lead,'LEAD_QUALIFICATION_EFFECTIVE');
  const request=await pending(c,lead,'LEAD_QUALIFICATION');
  const sequence=(effective?.facts.sequence??0)+1;
  if(decision){
   check(body,['request_id','approved','evidence']);
   if(!request||request.id!==body.request_id)fail(409,'REQUEST_CHANGED','待审核核验已变化');
   if(request.actor_user_id===actor)fail(403,'FORBIDDEN','不能审核本人提交的核验');
   if(typeof body.approved!=='boolean')fail(422,'VALIDATION_ERROR','请选择审批结果');
   const justification=evidence(body.evidence);
   if(body.approved){
    if(request.facts.verdict==='duplicate')await duplicateTarget(c,ctx,lead,request.facts.primary_lead_id);
    await audit(c,ctx,lead,'LEAD_QUALIFICATION_EFFECTIVE',{...request.facts,sequence,request_id:request.id,previous:effective?.facts.verdict??'pending'});
   }
   await audit(c,ctx,lead,'LEAD_QUALIFICATION_DECIDED',{request_id:request.id,approved:body.approved,evidence:justification});
  }else{
   check(body,['verdict','reason','evidence','primary_lead_id']);
   if(request)fail(409,'REVIEW_PENDING','已有待审核核验');
   if(!['valid','invalid','pending','duplicate'].includes(body.verdict))fail(422,'VALIDATION_ERROR','请选择核验状态');
   if(body.verdict==='invalid'&&!invalidReasons.includes(body.reason))fail(422,'VALIDATION_ERROR','请选择无效原因');
   const facts={verdict:body.verdict,evidence:evidence(body.evidence),...(body.verdict==='invalid'?{reason:body.reason}:{})};
   if(body.verdict==='duplicate'){
    await duplicateTarget(c,ctx,lead,body.primary_lead_id);
    facts.primary_lead_id=body.primary_lead_id;
   }
   const review=Boolean(effective)||['invalid','duplicate'].includes(body.verdict);
   if(review)await audit(c,ctx,lead,'LEAD_QUALIFICATION_REQUESTED',facts);
   else if(body.verdict==='valid')await audit(c,ctx,lead,'LEAD_QUALIFICATION_EFFECTIVE',{...facts,sequence});
   else await audit(c,ctx,lead,'LEAD_QUALIFICATION_OBSERVED',facts);
  }
  return;
 }
 if(!ctx.campusAccess.configured)fail(409,'CAMPUS_MAPPING_UNAVAILABLE','真实校区映射待补充');
 const current=await currentCampus(c,lead);
 const request=await pending(c,lead,'CAMPUS_TRANSFER');
 if(action==='assign-campus'){
  check(body,['campus_code','evidence']);
  if(current||request)fail(409,'CAMPUS_ASSIGNED','已有校区归属，请走跨校区审批');
  await ensureCampusTarget(c,ctx,body.campus_code);
  await audit(c,ctx,lead,'SERVICE_CAMPUS_EFFECTIVE',{campus_code:body.campus_code,evidence:evidence(body.evidence)});
 }else if(action==='request-campus-transfer'){
  check(body,['campus_code','evidence']);
  if(!current||request||current===body.campus_code)fail(409,'CAMPUS_TRANSFER_UNAVAILABLE','需要已有归属及不同目标校区，且没有待审批申请');
  await ensureCampusTarget(c,ctx,body.campus_code);
  await audit(c,ctx,lead,'CAMPUS_TRANSFER_REQUESTED',{from_campus:current,campus_code:body.campus_code,evidence:evidence(body.evidence)});
 }else{
  check(body,['request_id','approved','evidence']);
  if(!request||request.id!==body.request_id||request.facts.from_campus!==current)fail(409,'REQUEST_CHANGED','待审核校区转归已变化');
  if(request.actor_user_id===actor)fail(403,'FORBIDDEN','不能审核本人提交的校区转归');
  if(typeof body.approved!=='boolean')fail(422,'VALIDATION_ERROR','请选择审批结果');
  const justification=evidence(body.evidence);
  if(body.approved){
   await ensureCampusTarget(c,ctx,request.facts.campus_code);
   await audit(c,ctx,lead,'SERVICE_CAMPUS_EFFECTIVE',{...request.facts,request_id:request.id});
  }
  await audit(c,ctx,lead,'CAMPUS_TRANSFER_DECIDED',{request_id:request.id,approved:body.approved,evidence:justification});
 }
}

export const qualificationMetrics=['qualification_valid','qualification_invalid','qualification_pending'];
export async function qualificationReport(c,scope,base,metric,page=1,pageSize=20){
 const {where,params}=base;
 const at=scope.as_of_at?`$${params.push(scope.as_of_at)}::timestamptz`:'statement_timestamp()';
 const sql=`WITH candidates AS (
  SELECT l.id,l.contact_id,l.owner_user_id,l.created_at,
   COALESCE(e.verdict,'pending') AS verdict,e.recorded_at
  FROM ms.leads l
  LEFT JOIN LATERAL (
   SELECT a.after_business_json->>'verdict' AS verdict,a.happened_at AS recorded_at
   FROM ms.audit_events a WHERE a.organization_id=l.organization_id AND a.target_type='lead' AND a.target_id=l.id
    AND a.event_name='V34_LEAD_QUALIFICATION_EFFECTIVE' AND a.happened_at<=${at}
   ORDER BY a.happened_at DESC,(a.after_business_json->>'sequence')::int DESC,a.id DESC LIMIT 1
  ) e ON true
  WHERE ${where} AND l.created_at<=${at}
 ), eligible AS (SELECT * FROM candidates WHERE verdict<>'duplicate')`;
 if(metric){
  const status=params.push(metric.slice('qualification_'.length));
  const limit=params.push(pageSize),offset=params.push((page-1)*pageSize);
  return (await c.query(`${sql}, matching AS (SELECT * FROM eligible WHERE verdict=$${status}),
  page_rows AS (
   SELECT m.id,m.created_at,m.recorded_at,co.display_name AS contact_name,u.display_name AS owner_name,
    m.verdict AS terminal_state
   FROM (SELECT * FROM matching ORDER BY created_at DESC,id LIMIT $${limit} OFFSET $${offset}) m
   LEFT JOIN ms.contacts co ON co.id=m.contact_id AND co.organization_id=$1
   LEFT JOIN ms.staff_users u ON u.id=m.owner_user_id AND u.organization_id=$1
  ) SELECT (SELECT count(*)::int FROM matching) AS total,
   COALESCE(jsonb_agg(to_jsonb(page_rows) ORDER BY created_at DESC,id),'[]'::jsonb) AS items FROM page_rows`,params)).rows[0];
 }
 const {rows:[result]}=await c.query(`${sql}
  SELECT count(*)::int AS total,count(*) FILTER(WHERE verdict='valid')::int AS valid,
   count(*) FILTER(WHERE verdict='invalid')::int AS invalid,count(*) FILTER(WHERE verdict='pending')::int AS pending
  FROM eligible`,params);
 const checked=result.valid+result.invalid;
 return {...result,checked,valid_rate:checked?result.valid/checked:null,coverage:result.total?checked/result.total:null};
}
