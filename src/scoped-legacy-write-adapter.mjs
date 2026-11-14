// V3.2-13: migrate existing POST /api/v1/students and /api/v1/contacts.
// The server MUST opt in explicitly. No database-owner writes or old
// organization-wide receipt fallback for either migrated operation.
// Parent authentication context comes from the trusted main request handler;
// actual data mutations run only through employee-specific function-only LOGIN.
import {fail} from './auth.mjs';
import {assertScopedLowriskWriter} from './scoped-lowrisk-write-api.mjs';

export const migratedLegacyWrites=new Set(['requestCampaignSalesReview','decideCampaignSalesReview','reviseCampaignDraft','createCampaignDraft','requestChannelChange','reviewChannelChange','createStudent','createContact','linkContact','createEvent','requestContactCustody','decideContactCustody','requestCustodyReview','decideCustodyReview','requestLeadCandidate','decideLeadCandidate','requestConversionReadiness','decideConversionReadiness','revokeConversionReadiness','requestAttributionDispute','decideAttributionDispute','requestFinalLeadConversion','decideFinalLeadConversion','executeFinalLeadConversion','requestLeadStudentAssociation','decideLeadStudentAssociation','requestLeadAdjustment','decideLeadAdjustment','requestLeadStudentLinkReview','decideLeadStudentLinkReview','requestDownstreamStudentCorrection','decideDownstreamStudentCorrection','attestDownstreamReconciliation','resolveDownstreamReconciliation']);
const MAX=100;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const relationTypes=new Set(['父亲','母亲','其他监护人','其他联系人']);
const eventTypes=new Set(['电话咨询','到店咨询','微信咨询','线上咨询']);
function uuid(v,name){
  if(typeof v!=='string'||!UUID.test(v))
    fail(422,'VALIDATION_ERROR',name+'编号格式不正确');
  return v;
}
function only(body,allowed){
  if(!body||typeof body!=='object'||Array.isArray(body))
    fail(422,'VALIDATION_ERROR','请求内容不是有效业务对象');
  if(Object.keys(body).some(k=>!allowed.includes(k)))
    fail(422,'VALIDATION_ERROR','此操作包含未允许的字段或未经核实的身份材料');
}
function cleanName(v,label){
  if(typeof v!=='string'||!v.trim()||v.trim().length>MAX)
    fail(422,'VALIDATION_ERROR',label+'不能为空或长度超限');
  return v.trim();
}
function cleanOptional(v,label){
  if(v===undefined||v===null)return null;
  if(typeof v!=='string'||v.trim().length>MAX)
    fail(422,'VALIDATION_ERROR',label+'长度超限');
  return v.trim()||null;
}
function approvalText(v,label,max){
  if(typeof v!=='string'||v.trim().length<2||v.trim().length>max)
    fail(422,'VALIDATION_ERROR',label+'不能为空或长度超限');
  return v.trim();
}
function strictBody(op,body,routeParams){
  if(op==='requestCampaignSalesReview'){
    only(body,['expected_version','evidence_ref','reason_zh']);
    if(!Number.isSafeInteger(body.expected_version)||body.expected_version<1||
       body.expected_version>2147483645)
      fail(422,'VALIDATION_ERROR','活动草稿版本无效');
    return {params:[uuid(routeParams?.[0],'市场活动草稿'),
      body.expected_version,
      approvalText(body.evidence_ref,'活动审核依据',200),
      approvalText(body.reason_zh,'活动审核理由',400)]};
  }
  if(op==='decideCampaignSalesReview'){
    only(body,['decision','evidence_ref','reason_zh']);
    if(!['approved','rejected'].includes(body.decision))
      fail(422,'VALIDATION_ERROR','销售主管应明确批准或驳回');
    return {params:[uuid(routeParams?.[0],'销售审核请求'),body.decision,
      approvalText(body.evidence_ref,'销售主管审批凭据',200),
      approvalText(body.reason_zh,'销售主管审批理由',400)]};
  }
  if(op==='reviseCampaignDraft'){
    only(body,['expected_version','name','starts_at','ends_at','budget_cents','channel_ids']);
    if(!Number.isSafeInteger(body.expected_version)||
       body.expected_version<1||body.expected_version>2147483645)
      fail(422,'VALIDATION_ERROR','草稿版本无效，请刷新活动列表');
    // Reuse exactly the bounded validation for draft fields.
    const create=strictBody('createCampaignDraft',{
      name:body.name,starts_at:body.starts_at,ends_at:body.ends_at,
      budget_cents:body.budget_cents,channel_ids:body.channel_ids
    },routeParams);
    return {params:[uuid(routeParams?.[0],'本人市场活动草稿'),
      body.expected_version,...create.params]};
  }
  if(op==='createCampaignDraft'){
    only(body,['name','starts_at','ends_at','budget_cents','channel_ids']);
    const name=cleanName(body.name,'活动名称');
    if(name.length<2||/[\u0000-\u001f\u007f]/.test(name))
      fail(422,'VALIDATION_ERROR','活动名称至少2字且不包含控制字符');
    if(!Number.isSafeInteger(body.budget_cents)||
        body.budget_cents<0||body.budget_cents>100000000000)
      fail(422,'VALIDATION_ERROR','计划预算必须为有效的非负整数分且不能超过上限');
    const parseTime=(value,label)=>{
      if(value===undefined||value===null||value==='')return null;
      if(typeof value!=='string'||!/\d{4}-\d\d-\d\dT/.test(value))
        fail(422,'VALIDATION_ERROR',label+'格式错误');
      const d=new Date(value);
      if(!Number.isFinite(d.getTime()))fail(422,'VALIDATION_ERROR',label+'不是有效时间');
      return d;
    };
    const start=parseTime(body.starts_at,'开始时间');
    const end=parseTime(body.ends_at,'结束时间');
    if(start&&end&&end.getTime()<start.getTime())
      fail(422,'VALIDATION_ERROR','活动结束时间不得早于开始时间');
    if(!Array.isArray(body.channel_ids)||body.channel_ids.length<1||
       body.channel_ids.length>20||
       new Set(body.channel_ids).size!==body.channel_ids.length)
      fail(422,'VALIDATION_ERROR','必须选择1至20个不重复渠道');
    const channels=body.channel_ids.map(x=>uuid(x,'关联渠道'));
    return {params:[name,start,end,body.budget_cents,channels]};
  }
  if(op==='requestChannelChange'){
    only(body,['action','channel_id','name','parent_id','channel_type','evidence_ref','reason_zh']);
    if(!['create','edit','deactivate'].includes(body.action))
      fail(422,'VALIDATION_ERROR','渠道变更类型必须为新增、编辑或停用');
    const id=body.action==='create'?null:uuid(body.channel_id,'目标渠道');
    if(body.action==='create'&&body.channel_id!==undefined)
      fail(422,'VALIDATION_ERROR','新增渠道不能指定现有渠道');
    if(body.action==='deactivate'&&
       ['name','parent_id','channel_type'].some(x=>body[x]!==undefined))
      fail(422,'VALIDATION_ERROR','停用不能同时更改渠道名称或层级');
    const name=body.action==='deactivate'?null:cleanName(body.name,'渠道名称');
    const type=body.action==='deactivate'?null:cleanName(body.channel_type,'渠道类别');
    if(name&&name.length>100||type&&type.length>60)
      fail(422,'VALIDATION_ERROR','渠道名称或类别超出允许长度');
    const parent=body.action==='deactivate'?null:
      body.parent_id==null?null:uuid(body.parent_id,'上级渠道');
    return {params:[body.action,id,name,parent,type,
      approvalText(body.evidence_ref,'渠道维护依据',200),
      approvalText(body.reason_zh,'渠道维护理由',400)]};
  }
  if(op==='reviewChannelChange'){
    only(body,['decision','evidence_ref','reason_zh']);
    if(!['approved','rejected'].includes(body.decision))
      fail(422,'VALIDATION_ERROR','请选择批准执行或驳回');
    return {params:[uuid(routeParams?.[0],'渠道维护申请'),
      body.decision,approvalText(body.evidence_ref,'独立审批凭据',200),
      approvalText(body.reason_zh,'独立审批理由',400)]};
  }
  if(op==='attestDownstreamReconciliation'){
    only(body,['finding','student_evidence_ref','opportunity_evidence_ref','finance_evidence_ref','reason_zh']);
    if(!['original_student_confirmed','wrong_student_confirmed'].includes(body.finding))
      fail(422,'VALIDATION_ERROR','请选择确认原学生或确认错误关联');
    return {params:[uuid(routeParams?.[0],'下游纠错案件'),body.finding,
      approvalText(body.student_evidence_ref,'指定学生核实证据',200),
      approvalText(body.opportunity_evidence_ref,'商机核查证据',200),
      approvalText(body.finance_evidence_ref,'订单财务影响核查证据',200),
      approvalText(body.reason_zh,'核查原因',400)]};
  }
  if(op==='resolveDownstreamReconciliation'){
    only(body,['resolution','evidence_ref','reason_zh']);
    if(!['release_verified','escalate_manual'].includes(body.resolution))
      fail(422,'VALIDATION_ERROR','请选择安全释放或转人工处理');
    return {params:[uuid(routeParams?.[0],'独立核查结论'),
      body.resolution,approvalText(body.evidence_ref,'二次复核凭据',200),
      approvalText(body.reason_zh,'二次复核理由',400)]};
  }
  if(op==='requestDownstreamStudentCorrection'){
    only(body,['association_request_id','evidence_ref','reason_zh']);
    return {params:[uuid(body.association_request_id,'指定学生原关联'),
      approvalText(body.evidence_ref,'下游纠错核实依据',200),
      approvalText(body.reason_zh,'下游纠错原因',400)]};
  }
  if(op==='decideDownstreamStudentCorrection'){
    only(body,['decision','evidence_ref','reason_zh']);
    if(!['hold_active','rejected'].includes(body.decision))
      fail(422,'VALIDATION_ERROR','请选择维持下游隔离或驳回');
    return {params:[uuid(routeParams?.[0],'下游学生纠错案件'),
      body.decision,
      approvalText(body.evidence_ref,'独立主管核实材料',200),
      approvalText(body.reason_zh,'审核原因',400)]};
  }
  if(op==='requestLeadStudentLinkReview'){
    only(body,['association_request_id','action','basis_kind','evidence_ref','confirmation_ref','reason_zh']);
    if(!['verify','withdraw'].includes(body.action))
      fail(422,'VALIDATION_ERROR','只能申请核实或撤回指定学生关联');
    if(body.action==='verify'&&!['student_consultation','independent_student_confirmation'].includes(body.basis_kind))
      fail(422,'VALIDATION_ERROR','请指定独立人工核实的业务依据类型');
    if(body.action==='withdraw'&&(body.basis_kind!==undefined||body.confirmation_ref!==undefined))
      fail(422,'VALIDATION_ERROR','错误关联撤回不得伪造新的核实证明');
    return {params:[uuid(body.association_request_id,'单名学生原关联'),
      body.action,body.action==='verify'?body.basis_kind:null,
      approvalText(body.evidence_ref,'核实或撤回证据',200),
      body.action==='verify'?approvalText(body.confirmation_ref,'人工确认的依据',200):null,
      approvalText(body.reason_zh,'申请理由',400)]};
  }
  if(op==='decideLeadStudentLinkReview'){
    only(body,['decision','evidence_ref','reason_zh']);
    if(!['approved','rejected'].includes(body.decision))
      fail(422,'VALIDATION_ERROR','请选择独立核实通过或驳回');
    return {params:[uuid(routeParams?.[0],'核实或撤回申请'),body.decision,
      approvalText(body.evidence_ref,'独立主管复核凭据',200),
      approvalText(body.reason_zh,'独立审核理由',400)]};
  }
  if(op==='requestLeadStudentAssociation'){
    only(body,['lead_id','student_id','evidence_ref','reason_zh']);
    return {params:[uuid(body.lead_id,'本人正式线索'),
      uuid(body.student_id,'指定学生'),
      approvalText(body.evidence_ref,'学生待核实关联依据',200),
      approvalText(body.reason_zh,'学生关联申请理由',400)]};
  }
  if(op==='decideLeadStudentAssociation'){
    only(body,['decision','evidence_ref','reason_zh']);
    if(!['approved_pending','rejected'].includes(body.decision))
      fail(422,'VALIDATION_ERROR','请选择登记待核实或驳回学生关联');
    return {params:[uuid(routeParams?.[0],'学生关联申请'),body.decision,
      approvalText(body.evidence_ref,'独立学生审核依据',200),
      approvalText(body.reason_zh,'审核理由',400)]};
  }
  if(op==='requestLeadAdjustment'){
    only(body,['lead_id','action','proposed_note','evidence_ref','reason_zh']);
    if(!['invalidate','correct_note'].includes(body.action))
      fail(422,'VALIDATION_ERROR','请选择线索作废或更正说明');
    if(body.action==='invalidate'&&body.proposed_note!==undefined&&body.proposed_note!==null&&body.proposed_note!=='')
      fail(422,'VALIDATION_ERROR','作废不能填写新的业务说明');
    const note=body.action==='correct_note'?
      approvalText(body.proposed_note,'更正业务说明',200):null;
    return {params:[uuid(body.lead_id,'本人正式线索'),body.action,note,
      approvalText(body.evidence_ref,'更正或作废依据',200),
      approvalText(body.reason_zh,'申请理由',400)]};
  }
  if(op==='decideLeadAdjustment'){
    only(body,['decision','evidence_ref','reason_zh']);
    if(!['approved','rejected'].includes(body.decision))
      fail(422,'VALIDATION_ERROR','请选择批准或驳回调整');
    return {params:[uuid(routeParams?.[0],'线索调整申请'),body.decision,
      approvalText(body.evidence_ref,'独立审核材料',200),
      approvalText(body.reason_zh,'审核理由',400)]};
  }
  if(op==='requestFinalLeadConversion'){
    only(body,['readiness_id','evidence_ref','reason_zh']);
    return {params:[uuid(body.readiness_id,'已通过的转换预审'),
      approvalText(body.evidence_ref,'最终申请材料',200),
      approvalText(body.reason_zh,'最终申请理由',400)]};
  }
  if(op==='decideFinalLeadConversion'){
    only(body,['decision','evidence_ref','reason_zh']);
    if(!['approved','rejected'].includes(body.decision))
      fail(422,'VALIDATION_ERROR','请选择批准或驳回最终转换');
    return {params:[uuid(routeParams?.[0],'最终转换申请'),body.decision,
      approvalText(body.evidence_ref,'最终审批依据',200),
      approvalText(body.reason_zh,'最终审批理由',400)]};
  }
  if(op==='executeFinalLeadConversion'){
    only(body,[]);
    return {params:[uuid(routeParams?.[0],'最终转换授权')]};
  }
  if(op==='requestConversionReadiness'){
    only(body,['candidate_id','evidence_ref','reason_zh']);
    return {params:[uuid(body.candidate_id,'已核查候选'),
      approvalText(body.evidence_ref,'预审材料',200),
      approvalText(body.reason_zh,'预审理由',400)]};
  }
  if(op==='decideConversionReadiness'){
    only(body,['decision','evidence_ref','reason_zh']);
    if(!['cleared','rejected'].includes(body.decision))
      fail(422,'VALIDATION_ERROR','请选择通过预审或驳回');
    return {params:[uuid(routeParams?.[0],'预审申请'),body.decision,
      approvalText(body.evidence_ref,'复核材料',200),
      approvalText(body.reason_zh,'复核理由',400)]};
  }
  if(op==='revokeConversionReadiness'){
    only(body,['evidence_ref','reason_zh']);
    return {params:[uuid(routeParams?.[0],'预审申请'),
      approvalText(body.evidence_ref,'撤销依据',200),
      approvalText(body.reason_zh,'撤销理由',400)]};
  }
  if(op==='requestAttributionDispute'){
    only(body,['candidate_id','own_event_id','evidence_ref','reason_zh']);
    return {params:[uuid(body.candidate_id,'被争议候选'),
      uuid(body.own_event_id,'本人真实咨询'),
      approvalText(body.evidence_ref,'争议凭据',200),
      approvalText(body.reason_zh,'争议理由',400)]};
  }
  if(op==='decideAttributionDispute'){
    only(body,['decision','evidence_ref','reason_zh']);
    if(!['upheld','rejected'].includes(body.decision))
      fail(422,'VALIDATION_ERROR','请选择支持异议或驳回异议');
    return {params:[uuid(routeParams?.[0],'归因争议'),body.decision,
      approvalText(body.evidence_ref,'裁决凭据',200),
      approvalText(body.reason_zh,'裁决理由',400)]};
  }
  if(op==='requestLeadCandidate'){
    only(body,['source_event_id','evidence_ref','reason_zh']);
    return {params:[uuid(body.source_event_id,'真实咨询'),
      approvalText(body.evidence_ref,'咨询核实依据',200),
      approvalText(body.reason_zh,'申请理由',400)]};
  }
  if(op==='decideLeadCandidate'){
    only(body,['decision','evidence_ref','reason_zh']);
    if(!['reviewed_eligible','rejected'].includes(body.decision))
      fail(422,'VALIDATION_ERROR','请选择候选核查通过或驳回');
    return {params:[uuid(routeParams?.[0],'候选申请'),body.decision,
      approvalText(body.evidence_ref,'独立审核依据',200),
      approvalText(body.reason_zh,'审批理由',400)]};
  }
  if(op==='requestCustodyReview'){
    only(body,['assignment_id','kind','evidence_ref','reason_zh']);
    if(!['withdrawal','dispute'].includes(body.kind))
      fail(422,'VALIDATION_ERROR','请选择撤回或争议复核');
    return {params:[uuid(body.assignment_id,'交接管理权'),body.kind,
      approvalText(body.evidence_ref,'虚构材料说明',200),
      approvalText(body.reason_zh,'申请理由',400)]};
  }
  if(op==='decideCustodyReview'){
    only(body,['result','evidence_ref','reason_zh']);
    if(!['upheld','reversed','rejected'].includes(body.result))
      fail(422,'VALIDATION_ERROR','请选择维持、撤回或驳回复核');
    return {params:[uuid(routeParams?.[0],'复核申请'),body.result,
      approvalText(body.evidence_ref,'复核证据',200),
      approvalText(body.reason_zh,'复核理由',400)]};
  }
  if(op==='requestContactCustody'){
    only(body,['contact_id','target_staff_id','evidence_ref','reason_zh']);
    return {params:[
      uuid(body.contact_id,'联系人'),
      uuid(body.target_staff_id,'接收员工'),
      approvalText(body.evidence_ref,'核实材料说明',200),
      approvalText(body.reason_zh,'交接理由',400)
    ]};
  }
  if(op==='decideContactCustody'){
    only(body,['decision','evidence_ref','reason_zh']);
    if(!['approved','rejected'].includes(body.decision))
      fail(422,'VALIDATION_ERROR','请选择批准或驳回');
    return {params:[
      uuid(routeParams?.[0],'交接申请'),body.decision,
      approvalText(body.evidence_ref,'独立复核材料',200),
      approvalText(body.reason_zh,'审核理由',400)
    ]};
  }
  if(op==='linkContact'){
    only(body,['contact_id','relation_type','verification_state','is_primary']);
    if(body.verification_state!==undefined&&body.verification_state!=='unverified')
      fail(422,'VALIDATION_ERROR','监护关系只能登记为待核实，不能直接确认');
    if(body.is_primary!==undefined&&body.is_primary!==false)
      fail(422,'VALIDATION_ERROR','未核实前不能设为主要监护人');
    const relation=cleanName(body.relation_type,'联系人关系');
    if(!relationTypes.has(relation))
      fail(422,'VALIDATION_ERROR','联系人关系类型不正确');
    return {params:[uuid(routeParams?.[0],'学生'),
      uuid(body.contact_id,'联系人'),relation]};
  }
  if(op==='createEvent'){
    only(body,['contact_id','event_type','occurred_at']);
    const eventType=cleanName(body.event_type,'咨询方式');
    if(!eventTypes.has(eventType))
      fail(422,'VALIDATION_ERROR','咨询方式不正确');
    if(typeof body.occurred_at!=='string'||
      !/^\d{4}-\d\d-\d\dT/.test(body.occurred_at))
      fail(422,'VALIDATION_ERROR','请填写实际发生的咨询时间');
    const date=new Date(body.occurred_at);
    if(!Number.isFinite(date.getTime()))
      fail(422,'VALIDATION_ERROR','咨询时间格式不正确');
    return {params:[uuid(body.contact_id,'联系人'),eventType,date]};
  }
  const allowed=op==='createStudent'?
    ['display_name','grade_label','school_name']:
    ['display_name','do_not_contact'];
  only(body,allowed);
  const name=cleanName(body.display_name,op==='createStudent'?'学生姓名':'联系人称呼');
  if(op==='createStudent')return {
    operation:'createStudent',
    params:[name,cleanOptional(body.grade_label,'年级'),
      cleanOptional(body.school_name,'学校')]
  };
  if(body.do_not_contact!==undefined&&typeof body.do_not_contact!=='boolean')
    fail(422,'VALIDATION_ERROR','拒绝主动联系设置必须为是或否');
  return {operation:'createContact',params:[name,body.do_not_contact===true]};
}
export async function writeLegacyViaStaffPool({
  pools,context,claims,operation,body,idempotencyKey,routeParams
}){
  if(process.env.MS_STAGE!=='isolated-test')
    throw Error('Migrated legacy writes must run only in isolated-test');
  if(!migratedLegacyWrites.has(operation))
    throw Error('Unrecognized migrated write');
  // Signed HS256 demo tokens have no externally verified claim, and
  // therefore cannot use this strict path. Fail closed, without fallback.
  if(!claims?.issuer||!claims?.subject)
    fail(403,'STAFF_WRITE_RESTRICTED','此操作需要已批准的外部员工签名身份');
  if(!(pools instanceof Map))
    throw Error('Trusted employee write pool registry required');
  const pool=pools.get(context.user.id);
  if(!pool||typeof pool.connect!=='function')
    fail(403,'STAFF_WRITE_RESTRICTED','该员工尚未配置经核准的低权限写入账号');
  const parsed=strictBody(operation,body,routeParams);
  let client;
  try{
    client=await pool.connect();
    // Pin every authorization and mutation to the SAME PostgreSQL session.
    // This preflight also refuses an owner or any direct base-table grants.
    await assertScopedLowriskWriter(client);
    await client.query('BEGIN');
    const r=await client.query(
      'SELECT ms.current_scoped_staff_id() AS staff_id,'+
      'ms.current_scoped_organization_id() AS org_id,'+
      'ms.scoped_employee_identity_valid($1,$2) AS identity_ok',
      [claims.issuer,claims.subject]
    );
    const x=r.rows[0];
    if(!x||x.staff_id!==context.user.id||
      x.org_id!==context.user.organization_id||x.identity_ok!==true)
      fail(403,'STAFF_WRITE_RESTRICTED','员工签名身份与专属数据库账号不一致或已失效');
    let result;
    switch(operation){
      case 'requestCampaignSalesReview':
        result=await client.query(
          'SELECT ms.request_isolated_campaign_sales_review($1,$2,$3,$4,$5) AS result',
          [...parsed.params,idempotencyKey]);break;
      case 'decideCampaignSalesReview':
        result=await client.query(
          'SELECT ms.decide_isolated_campaign_sales_review($1,$2,$3,$4,$5) AS result',
          [...parsed.params,idempotencyKey]);break;
      case 'reviseCampaignDraft':
        result=await client.query(
          'SELECT ms.revise_isolated_campaign_draft($1,$2,$3,$4,$5,$6,$7,$8) AS result',
          [...parsed.params,idempotencyKey]);break;
      case 'createCampaignDraft':
        result=await client.query(
          'SELECT ms.create_isolated_campaign_draft($1,$2,$3,$4,$5,$6) AS result',
          [...parsed.params,idempotencyKey]);break;
      case 'requestChannelChange':
        result=await client.query(
          'SELECT ms.request_isolated_channel_change($1,$2,$3,$4,$5,$6,$7,$8) AS result',
          [...parsed.params,idempotencyKey]);break;
      case 'reviewChannelChange':
        result=await client.query(
          'SELECT ms.review_isolated_channel_change($1,$2,$3,$4,$5) AS result',
          [...parsed.params,idempotencyKey]);break;
      case 'attestDownstreamReconciliation':
        result=await client.query(
          'SELECT ms.attest_downstream_student_reconciliation($1,$2,$3,$4,$5,$6,$7) AS result',
          [...parsed.params,idempotencyKey]);break;
      case 'resolveDownstreamReconciliation':
        result=await client.query(
          'SELECT ms.resolve_downstream_student_reconciliation($1,$2,$3,$4,$5) AS result',
          [...parsed.params,idempotencyKey]);break;
      case 'requestDownstreamStudentCorrection':
        result=await client.query(
          'SELECT ms.request_downstream_student_correction($1,$2,$3,$4) AS result',
          [...parsed.params,idempotencyKey]);break;
      case 'decideDownstreamStudentCorrection':
        result=await client.query(
          'SELECT ms.decide_downstream_student_correction($1,$2,$3,$4,$5) AS result',
          [...parsed.params,idempotencyKey]);break;
      case 'requestLeadStudentLinkReview':
        result=await client.query(
          'SELECT ms.request_lead_student_link_review($1,$2,$3,$4,$5,$6,$7) AS result',
          [...parsed.params,idempotencyKey]);break;
      case 'decideLeadStudentLinkReview':
        result=await client.query(
          'SELECT ms.decide_lead_student_link_review($1,$2,$3,$4,$5) AS result',
          [...parsed.params,idempotencyKey]);break;
      case 'requestLeadStudentAssociation':
        result=await client.query(
          'SELECT ms.request_lead_student_association($1,$2,$3,$4,$5) AS result',
          [...parsed.params,idempotencyKey]);break;
      case 'decideLeadStudentAssociation':
        result=await client.query(
          'SELECT ms.decide_lead_student_association($1,$2,$3,$4,$5) AS result',
          [...parsed.params,idempotencyKey]);break;
      case 'requestLeadAdjustment':
        result=await client.query(
          'SELECT ms.request_lead_adjustment($1,$2,$3,$4,$5,$6) AS result',
          [...parsed.params,idempotencyKey]);break;
      case 'decideLeadAdjustment':
        result=await client.query(
          'SELECT ms.decide_lead_adjustment($1,$2,$3,$4,$5) AS result',
          [...parsed.params,idempotencyKey]);break;
      case 'requestFinalLeadConversion':
        result=await client.query(
          'SELECT ms.request_final_lead_conversion($1,$2,$3,$4) AS result',
          [...parsed.params,idempotencyKey]);break;
      case 'decideFinalLeadConversion':
        result=await client.query(
          'SELECT ms.decide_final_lead_conversion($1,$2,$3,$4,$5) AS result',
          [...parsed.params,idempotencyKey]);break;
      case 'executeFinalLeadConversion':
        result=await client.query(
          'SELECT ms.execute_final_lead_conversion($1,$2) AS result',
          [...parsed.params,idempotencyKey]);break;
      case 'requestConversionReadiness':
        result=await client.query(
          'SELECT ms.submit_lead_conversion_preflight($1,$2,$3,$4) AS result',
          [...parsed.params,idempotencyKey]);break;
      case 'decideConversionReadiness':
        result=await client.query(
          'SELECT ms.decide_lead_conversion_preflight($1,$2,$3,$4,$5) AS result',
          [...parsed.params,idempotencyKey]);break;
      case 'revokeConversionReadiness':
        result=await client.query(
          'SELECT ms.revoke_lead_conversion_clearance($1,$2,$3,$4) AS result',
          [...parsed.params,idempotencyKey]);break;
      case 'requestAttributionDispute':
        result=await client.query(
          'SELECT ms.submit_lead_attribution_dispute($1,$2,$3,$4,$5) AS result',
          [...parsed.params,idempotencyKey]);break;
      case 'decideAttributionDispute':
        result=await client.query(
          'SELECT ms.decide_lead_attribution_dispute($1,$2,$3,$4,$5) AS result',
          [...parsed.params,idempotencyKey]);break;
      case 'requestLeadCandidate':
        result=await client.query(
          'SELECT ms.request_consultation_lead_candidate($1,$2,$3,$4) AS result',
          [...parsed.params,idempotencyKey]);break;
      case 'decideLeadCandidate':
        result=await client.query(
          'SELECT ms.decide_consultation_lead_candidate($1,$2,$3,$4,$5) AS result',
          [...parsed.params,idempotencyKey]);break;
      case 'createStudent':
        result=await client.query(
          'SELECT ms.create_scoped_student($1,$2,$3,$4) AS result',
          [...parsed.params,idempotencyKey]);break;
      case 'createContact':
        result=await client.query(
          'SELECT ms.create_scoped_contact($1,$2,$3) AS result',
          [...parsed.params,idempotencyKey]);break;
      case 'linkContact':
        result=await client.query(
          'SELECT ms.link_scoped_student_contact($1,$2,$3,$4) AS result',
          [...parsed.params,idempotencyKey]);break;
      case 'createEvent':
        result=await client.query(
          'SELECT ms.create_scoped_contact_consultation($1,$2,$3,$4) AS result',
          [...parsed.params,idempotencyKey]);break;
      case 'requestCustodyReview':
        result=await client.query(
          'SELECT ms.request_custody_review($1,$2,$3,$4,$5) AS result',
          [...parsed.params,idempotencyKey]);break;
      case 'decideCustodyReview':
        result=await client.query(
          'SELECT ms.decide_custody_review($1,$2,$3,$4,$5) AS result',
          [...parsed.params,idempotencyKey]);break;
      case 'requestContactCustody':
        result=await client.query(
          'SELECT ms.request_scoped_contact_custody($1,$2,$3,$4,$5) AS result',
          [...parsed.params,idempotencyKey]);break;
      case 'decideContactCustody':
        result=await client.query(
          'SELECT ms.decide_scoped_contact_custody($1,$2,$3,$4,$5) AS result',
          [...parsed.params,idempotencyKey]);break;
      default:throw Error('Unsupported restricted write');
    }
    await client.query('COMMIT');
    return result.rows[0].result;
  }catch(e){
    if(client)try{await client.query('ROLLBACK');}catch{}
    // Keep a business conflict readable; never expose raw SQL or identities.
    if(e?.code==='23505')
      fail(409,'IDEMPOTENCY_CONFLICT','防重复编号已用于其他操作或不同业务内容');
    if(e?.code==='23514'||e?.code==='22P02')
      fail(422,'VALIDATION_ERROR','填写的业务内容不符合保存要求');
    if(e?.code==='42501')
      fail(403,'STAFF_WRITE_RESTRICTED','当前员工没有该项低权限操作的授权');
    throw e;
  }finally{if(client)client.release();}
}
