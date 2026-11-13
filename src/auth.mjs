import { createHmac, timingSafeEqual } from 'node:crypto';

export class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status; this.code = code;
  }
}
export const fail = (status,code,message) => { throw new AppError(status,code,message); };

const b64 = s => Buffer.from(s, 'base64url');
export function verifyToken(token, secret, issuer) {
  if (typeof token !== 'string' || token.length > 4096) fail(401,'AUTH_REQUIRED','身份凭据无效');
  const fields=token.split('.');
  if(fields.length!==3) fail(401,'AUTH_REQUIRED','身份凭据无效');
  const [h,p,s]=fields;
  const mac=createHmac('sha256',secret).update(h+'.'+p).digest();
  let actual;
  try { actual=b64(s); } catch { fail(401,'AUTH_REQUIRED','身份凭据无效'); }
  if(actual.length!==mac.length || !timingSafeEqual(mac,actual)) fail(401,'AUTH_REQUIRED','身份凭据无效');
  let header,body;
  try { header=JSON.parse(b64(h).toString('utf8'));body=JSON.parse(b64(p).toString('utf8')); }
  catch { fail(401,'AUTH_REQUIRED','身份凭据无效'); }
  const now=Math.floor(Date.now()/1000);
  if(header?.alg!=='HS256'||header?.typ!=='JWT'||body?.iss!==issuer||
    body?.aud!=='market-sales-isolated'||!body?.sub||
    !Number.isInteger(body?.iat)||!Number.isInteger(body?.exp)||
    body.iat>now+60||body.exp<=now||body.exp-body.iat>3600) {
    fail(401,'AUTH_REQUIRED','身份凭据无效或已经过期');
  }
  return {staffId:body.sub, orgId:body.org_id};
}
export async function staffContext(client, identity) {
  const r=await client.query(
    "SELECT id,organization_id,display_name,status FROM ms.staff_users WHERE id=$1",
    [identity.staffId]);
  const u=r.rows[0];
  if(!u||u.status!=='active'||u.organization_id!==identity.orgId)
    fail(403,'FORBIDDEN','当前账号没有该机构的访问权限');
  const roles=await client.query(
    "SELECT rt.role_code FROM ms.user_role_grants g JOIN ms.role_templates rt ON rt.id=g.role_id "+
    "WHERE g.user_id=$1 AND g.revoked_at IS NULL AND g.valid_from<=now() AND rt.organization_id=$2",
    [u.id,u.organization_id]);
  return {user:u,roles:roles.rows.map(x=>x.role_code),manager:roles.rows.some(x=>['sales_manager','super_admin'].includes(x.role_code))};
}
export async function ownsStudent(c,ctx,id) {
  const r=await c.query(
    "SELECT id,display_name,owner_user_id,organization_id FROM ms.students "+
    "WHERE id=$1 AND organization_id=$2 AND archived_at IS NULL",[id,ctx.user.organization_id]);
  const student=r.rows[0];
  if(!student)fail(404,'NOT_FOUND','没有找到有权查看的学生');
  if(!ctx.manager&&student.owner_user_id!==ctx.user.id) {
    const g=await c.query("SELECT 1 FROM ms.data_scope_grants WHERE user_id=$1 AND resource_type='student' "+
     "AND scope_type='specific' AND scope_ref=$2 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now()) LIMIT 1",
     [ctx.user.id,id]);
    if(!g.rowCount)fail(403,'FORBIDDEN','当前账号无权查看该学生');
  }
  return student;
}
export async function ownsLead(c,ctx,id) {
  const r=await c.query("SELECT id,organization_id,owner_user_id,contact_id,source_event_id FROM ms.leads "+
    "WHERE id=$1 AND organization_id=$2",[id,ctx.user.organization_id]);
  if(!r.rowCount)fail(404,'NOT_FOUND','没有找到该线索');
  if(!ctx.manager&&r.rows[0].owner_user_id!==ctx.user.id)
    fail(403,'FORBIDDEN','当前账号无权查看该线索');
  return r.rows[0];
}
export async function ownsOpportunity(c,ctx,id) {
  const r=await c.query(
    "SELECT o.id,o.student_id,o.owner_user_id,o.stage,o.lifecycle_state FROM ms.opportunities o "+
    "JOIN ms.students s ON s.id=o.student_id WHERE o.id=$1 AND s.organization_id=$2 AND s.archived_at IS NULL",
    [id,ctx.user.organization_id]);
  if(!r.rowCount)fail(404,'NOT_FOUND','没有找到该商机');
  const o=r.rows[0];
  if(!ctx.manager&&o.owner_user_id!==ctx.user.id)
    fail(403,'FORBIDDEN','当前账号无权查看该商机');
  return o;
}
export async function sameOrgStaff(c,ctx,id) {
  const r=await c.query("SELECT id FROM ms.staff_users WHERE id=$1 AND organization_id=$2 AND status='active'",
    [id,ctx.user.organization_id]);
  if(!r.rowCount)fail(422,'VALIDATION_ERROR','指定负责人不是本机构的有效员工');
  return id;
}
