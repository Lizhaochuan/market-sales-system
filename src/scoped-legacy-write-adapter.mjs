// V3.2-13: migrate existing POST /api/v1/students and /api/v1/contacts.
// The server MUST opt in explicitly. No database-owner writes or old
// organization-wide receipt fallback for either migrated operation.
// Parent authentication context comes from the trusted main request handler;
// actual data mutations run only through employee-specific function-only LOGIN.
import {fail} from './auth.mjs';
import {assertScopedLowriskWriter} from './scoped-lowrisk-write-api.mjs';

export const migratedLegacyWrites=new Set(['createStudent','createContact','linkContact','createEvent','requestContactCustody','decideContactCustody','requestCustodyReview','decideCustodyReview','requestLeadCandidate','decideLeadCandidate','requestConversionReadiness','decideConversionReadiness','revokeConversionReadiness','requestAttributionDispute','decideAttributionDispute','requestFinalLeadConversion','decideFinalLeadConversion','executeFinalLeadConversion','requestLeadStudentAssociation','decideLeadStudentAssociation','requestLeadAdjustment','decideLeadAdjustment','requestLeadStudentLinkReview','decideLeadStudentLinkReview','requestDownstreamStudentCorrection','decideDownstreamStudentCorrection','requestDownstreamReconciliation','decideDownstreamReconciliation']);
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
  if(op==='requestDownstreamReconciliation'){
    only(body,['case_id','resolution','evidence_ref','independent_basis_ref','reason_zh']);
    if(!['original_student_valid','external_action_required'].includes(body.resolution))
      fail(422,'VALIDATION_ERROR','请选择原关联经核查正确或确有错误需跨部门处理');
    return {params:[uuid(body.case_id,'已确认的纠错保护案件'),body.resolution,
      approvalText(body.evidence_ref,'原始核查材料引用',200),
      approvalText(body.independent_basis_ref,'独立对照依据',200),
      approvalText(body.reason_zh,'跨部门核查理由',400)]};
  }
  if(op==='decideDownstreamReconciliation'){
    only(body,['decision','evidence_ref','reason_zh']);
    if(!['approved','rejected'].includes(body.decision))
      fail(422,'VALIDATION_ERROR','请选择批准或驳回第二轮核查');
    return {params:[uuid(routeParams?.[0],'第二轮独立核查申请'),body.decision,
      approvalText(body.evidence_ref,'第二名主管核对证据',200),
      approvalText(body.reason_zh,'第二名主管核查理由',400)]};
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
      case 'requestDownstreamReconciliation':
        result=await client.query(
          'SELECT ms.request_downstream_reconciliation($1,$2,$3,$4,$5,$6) AS result',
          [...parsed.params,idempotencyKey]);break;
      case 'decideDownstreamReconciliation':
        result=await client.query(
          'SELECT ms.decide_downstream_reconciliation($1,$2,$3,$4,$5) AS result',
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
