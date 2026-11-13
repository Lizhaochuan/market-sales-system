// V3.2-13: migrate existing POST /api/v1/students and /api/v1/contacts.
// The server MUST opt in explicitly. No database-owner writes or old
// organization-wide receipt fallback for either migrated operation.
// Parent authentication context comes from the trusted main request handler;
// actual data mutations run only through employee-specific function-only LOGIN.
import {fail} from './auth.mjs';
import {assertScopedLowriskWriter} from './scoped-lowrisk-write-api.mjs';

export const migratedLegacyWrites=new Set(['createStudent','createContact']);
const MAX=100;
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
function strictBody(op,body){
  if(!body||typeof body!=='object'||Array.isArray(body))
    fail(422,'VALIDATION_ERROR','请求内容不是有效业务对象');
  const allowed=op==='createStudent'?
    ['display_name','grade_label','school_name']:
    ['display_name','do_not_contact'];
  if(Object.keys(body).some(k=>!allowed.includes(k)))
    fail(422,'VALIDATION_ERROR','当前员工不能指定其他负责人或填写未开放的个人信息');
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
  pools,context,claims,operation,body,idempotencyKey
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
  const parsed=strictBody(operation,body);
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
    const result=operation==='createStudent'?
      await client.query(
        'SELECT ms.create_scoped_student($1,$2,$3,$4) AS result',
        [...parsed.params,idempotencyKey]):
      await client.query(
        'SELECT ms.create_scoped_contact($1,$2,$3) AS result',
        [...parsed.params,idempotencyKey]);
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
