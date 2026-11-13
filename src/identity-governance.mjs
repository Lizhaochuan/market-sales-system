// V3.2-04: isolated approval workflow. Not a production IAM provisioning service.
// Only the preapproved issuer+subject may be bound; no JWT claim grants roles.
import { fail } from './auth.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function id(x,name){if(typeof x!=='string'||!UUID.test(x))fail(422,'VALIDATION_ERROR',name+'编号不正确');return x;}
function field(x,name,max=200){
  if(typeof x!=='string'||!x.trim()||x.trim().length>max)
    fail(422,'VALIDATION_ERROR',name+'缺失或长度超限');
  return x.trim();
}
function bodyKeys(x,valid){
  if(!x||typeof x!=='object'||Array.isArray(x)||
     Object.keys(x).some(k=>!valid.includes(k)))
    fail(422,'VALIDATION_ERROR','身份变更申请包含不支持的字段');
}
function requireManager(ctx) {
  if(!ctx.manager)fail(403,'FORBIDDEN','只有本机构主管可以管理员工身份申请');
}
async function audit(c,ctx,targetId,event,message,before={},after={}) {
  await c.query(
    'INSERT INTO ms.audit_events(organization_id,actor_user_id,target_type,target_id,event_name,'+
    'before_business_json,after_business_json,reason_zh) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    [ctx.user.organization_id,ctx.user.id,'identity_change',targetId,event,
     JSON.stringify(before),JSON.stringify(after),message]);
}
async function getStaff(c,org,target) {
  const r=await c.query(
    "SELECT id,display_name FROM ms.staff_users WHERE id=$1 AND organization_id=$2 AND status='active'",
    [id(target,'目标员工'),org]);
  if(!r.rowCount)fail(404,'NOT_FOUND','本机构没有这位有效员工');
  return r.rows[0];
}
export async function identityOperation(c,ctx,op,pathArgs,body) {
  requireManager(ctx);
  const org=ctx.user.organization_id, actor=ctx.user.id;
  switch(op){
    case 'identityListStaff': {
      const r=await c.query(
        "SELECT id AS staff_id,display_name,status FROM ms.staff_users "+
        "WHERE organization_id=$1 ORDER BY display_name,id LIMIT 100",[org]);
      return {items:r.rows};
    }
    case 'identityListBindings': {
      const r=await c.query(
        "SELECT b.id AS binding_id,b.issuer,u.display_name AS staff_name,"+
        "b.staff_user_id,b.created_at FROM ms.staff_identity_bindings b "+
        "JOIN ms.staff_users u ON u.id=b.staff_user_id "+
        "WHERE u.organization_id=$1 AND b.revoked_at IS NULL "+
        "ORDER BY b.created_at DESC,b.id LIMIT 100",[org]);
      // Never return the external subject to the UI. It is an identity key.
      return {items:r.rows};
    }
    case 'identityListRequests': {
      const r=await c.query(
        "SELECT q.id AS request_id,q.action,q.status,q.issuer,q.requested_by,"+
        "q.target_staff_id,t.display_name AS target_staff_name,"+
        "r.display_name AS requested_by_name,d.display_name AS decided_by_name,"+
        "q.created_at FROM ms.identity_change_requests q "+
        "JOIN ms.staff_users t ON t.id=q.target_staff_id "+
        "JOIN ms.staff_users r ON r.id=q.requested_by "+
        "LEFT JOIN ms.staff_users d ON d.id=q.decided_by "+
        "WHERE q.organization_id=$1 ORDER BY q.created_at DESC,q.id LIMIT 100",[org]);
      return {items:r.rows};
    }
    case 'identityCreateRequest': {
      bodyKeys(body,['action','target_staff_id','issuer','subject','existing_binding_id',
        'request_evidence_ref','request_reason_zh']);
      if(!['bind','revoke'].includes(body.action))
        fail(422,'VALIDATION_ERROR','身份变更类型必须为绑定或撤销');
      const evidence=field(body.request_evidence_ref,'申请材料编号');
      const reason=field(body.request_reason_zh,'申请理由',400);
      let target,issuer,subject,bindingId=null;
      if(body.action==='bind') {
        if(body.existing_binding_id)fail(422,'VALIDATION_ERROR','新增身份绑定不能附带原绑定编号');
        target=await getStaff(c,org,body.target_staff_id);
        issuer=field(body.issuer,'身份发行方',255);
        if(!issuer.startsWith('https://'))
          fail(422,'VALIDATION_ERROR','必须填写可信的 HTTPS 身份发行方');
        if(process.env.OIDC_ISSUER&&issuer!==process.env.OIDC_ISSUER)
          fail(422,'VALIDATION_ERROR','身份发行方必须与服务端指定发行方一致');
        subject=field(body.subject,'外部身份唯一编号',255);
      }else{
        if(body.target_staff_id||body.issuer||body.subject)
          fail(422,'VALIDATION_ERROR','撤销必须选择已有身份，不可改写身份内容');
        bindingId=id(body.existing_binding_id,'已有身份绑定');
        const r=await c.query(
          "SELECT b.id,b.staff_user_id,b.issuer,b.subject,u.display_name "+
          "FROM ms.staff_identity_bindings b JOIN ms.staff_users u ON u.id=b.staff_user_id "+
          "WHERE b.id=$1 AND b.revoked_at IS NULL AND u.organization_id=$2 AND u.status='active'",
          [bindingId,org]);
        if(!r.rowCount)fail(404,'NOT_FOUND','本机构没有可撤销的有效身份关联');
        const x=r.rows[0];
        target={id:x.staff_user_id,display_name:x.display_name};
        issuer=x.issuer;subject=x.subject;
      }
      if(target.id===actor)fail(403,'FORBIDDEN','主管不能申请变更自己的外部身份');
      const r=await c.query(
        "INSERT INTO ms.identity_change_requests"+
        "(organization_id,action,target_staff_id,issuer,subject,existing_binding_id,requested_by,"+
        "request_evidence_ref,request_reason_zh) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)"+
        " RETURNING id,status",
        [org,body.action,target.id,issuer,subject,bindingId,actor,evidence,reason]);
      const x=r.rows[0];
      await audit(c,ctx,x.id,'IDENTITY_CHANGE_REQUESTED',
        '主管提交'+(body.action==='bind'?'员工身份绑定':'员工身份撤销')+
        '申请：'+target.display_name+'；申请理由：'+reason,
        {},{'员工':target.display_name,'变更':'待独立审核','身份发行方':issuer});
      return {request_id:x.id,status:'pending',target_staff_name:target.display_name};
    }
    case 'identityDecideRequest': {
      bodyKeys(body,['decision','review_evidence_ref','reason_zh']);
      if(!['approved','rejected'].includes(body.decision))
        fail(422,'VALIDATION_ERROR','审核决定必须是批准或驳回');
      const evidence=field(body.review_evidence_ref,'独立审核材料编号');
      const reason=field(body.reason_zh,'独立审核原因',400);
      const requestId=id(pathArgs[0],'身份变更申请');
      const r=await c.query(
        "SELECT q.*,s.display_name AS staff_name FROM ms.identity_change_requests q "+
        "JOIN ms.staff_users s ON s.id=q.target_staff_id "+
        "WHERE q.id=$1 AND q.organization_id=$2 FOR UPDATE OF q",[requestId,org]);
      if(!r.rowCount)fail(404,'NOT_FOUND','该身份变更申请不存在');
      const x=r.rows[0];
      if(x.status!=='pending')fail(409,'ALREADY_REVIEWED','该身份变更申请已经处理');
      if(x.requested_by===actor||x.target_staff_id===actor)
        fail(403,'SELF_APPROVAL_FORBIDDEN','申请人和关联目标本人都不能审批');
      // Database decision trigger independently checks reviewer role, tenant and
      // request state, so a form cannot fake role names to get an approval.
      await c.query(
        "INSERT INTO ms.identity_change_decisions"+
        "(request_id,reviewer_user_id,decision,review_evidence_ref,reason_zh)"+
        " VALUES($1,$2,$3,$4,$5)",[requestId,actor,body.decision,evidence,reason]);
      if(body.decision==='approved') {
        if(x.action==='bind'){
          await c.query(
            "INSERT INTO ms.staff_identity_bindings(staff_user_id,issuer,subject,bound_by,approval_request_id)"+
            " VALUES($1,$2,$3,$4,$5)",[x.target_staff_id,x.issuer,x.subject,actor,requestId]);
        }else{
          const changed=await c.query(
            "UPDATE ms.staff_identity_bindings SET revoked_at=now(),revocation_request_id=$3 "+
            "WHERE id=$1 AND staff_user_id=$2 AND revoked_at IS NULL RETURNING id",
            [x.existing_binding_id,x.target_staff_id,requestId]);
          if(!changed.rowCount)
            fail(409,'BINDING_CHANGED','原外部身份关联已经变化，无法执行旧撤销');
        }
      }
      await c.query(
        "UPDATE ms.identity_change_requests SET status=$2,decided_by=$3,decided_at=now() WHERE id=$1",
        [requestId,body.decision,actor]);
      await audit(c,ctx,requestId,
        body.decision==='approved'?'IDENTITY_CHANGE_APPROVED':'IDENTITY_CHANGE_REJECTED',
        '独立主管'+(body.decision==='approved'?'批准':'驳回')+
        '员工'+(x.action==='bind'?'身份绑定':'身份撤销')+
        '：'+x.staff_name+'；审核理由：'+reason,
        {'员工':x.staff_name,'审核状态':'待审核'},
        {'审核状态':body.decision==='approved'?'已批准':'已驳回',
         '审核人':ctx.user.display_name,'独立审核凭据编号':evidence});
      return {request_id:requestId,status:body.decision,action:x.action,
        target_staff_name:x.staff_name,reviewer_name:ctx.user.display_name};
    }
    default: fail(404,'NOT_FOUND','找不到身份管理操作');
  }
}
