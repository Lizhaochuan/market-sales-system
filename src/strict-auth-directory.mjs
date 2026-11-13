// V3.2-15: strict employee HTTP authentication through a function-only
// PostgreSQL directory LOGIN. The verified RSA claims are the only lookup key.
// Does NOT expose staff/role/identity tables to a gateway or business pool.
import {fail} from './auth.mjs';

export async function assertStrictIdentityDirectory(pool){
  if(process.env.MS_STAGE!=='isolated-test')
    throw Error('Strict identity directory is isolated-test only');
  if(!pool||typeof pool.connect!=='function')
    throw Error('Strict identity directory requires a dedicated DB pool');
  const q=await pool.query(
    "SELECT current_user AS login,session_user AS principal, "+
    "rolsuper,rolbypassrls,rolcreatedb,rolcreaterole, "+
    "has_schema_privilege(current_user,'ms','CREATE') AS schema_create, "+
    "has_table_privilege(current_user,'ms.staff_users','SELECT') AS raw_staff, "+
    "has_table_privilege(current_user,'ms.role_templates','SELECT') AS raw_roles, "+
    "has_table_privilege(current_user,'ms.user_role_grants','SELECT') AS raw_grants, "+
    "has_table_privilege(current_user,'ms.staff_identity_bindings','SELECT') AS raw_bindings, "+
    "has_table_privilege(current_user,'ms.identity_change_requests','SELECT') AS raw_requests, "+
    "has_table_privilege(current_user,'ms.identity_change_decisions','SELECT') AS raw_decisions, "+
    "has_table_privilege(current_user,'ms.students','SELECT') AS raw_students, "+
    "has_table_privilege(current_user,'ms.contacts','SELECT') AS raw_contacts, "+
    "has_table_privilege(current_user,'ms.sales_orders','SELECT') AS raw_finance, "+
    "has_table_privilege(current_user,'ms.audit_events','UPDATE') AS audit_edit, "+
    "has_function_privilege(current_user,"+
    "'ms.resolve_strict_verified_staff(text,text)','EXECUTE') AS can_resolve "+
    "FROM pg_roles WHERE rolname=current_user"
  );
  const x=q.rows[0];
  if(!x||x.login!==x.principal||x.rolsuper||x.rolbypassrls||
    x.rolcreatedb||x.rolcreaterole||x.schema_create||
    x.raw_staff||x.raw_roles||x.raw_grants||x.raw_bindings||
    x.raw_requests||x.raw_decisions||x.raw_students||
    x.raw_contacts||x.raw_finance||x.audit_edit||!x.can_resolve)
    throw Error('Strict identity directory refuses privileged or raw-table database LOGIN');
  return {restricted:true,employee_directory_login:x.login};
}

export async function resolveStrictDirectoryContext(pool,claims){
  if(process.env.MS_STAGE!=='isolated-test')
    throw Error('Strict identity directory is isolated-test only');
  if(!claims||typeof claims.issuer!=='string'||
    typeof claims.subject!=='string'||!claims.subject)
    fail(401,'AUTH_REQUIRED','需要可信的员工签名身份');
  let client;
  try{
    client=await pool.connect();
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const result=await client.query(
      'SELECT staff_id,organization_id,display_name,role_codes '+
      'FROM ms.resolve_strict_verified_staff($1,$2)',
      [claims.issuer,claims.subject]
    );
    if(result.rowCount!==1){
      fail(403,'FORBIDDEN','该员工身份未获独立批准、已撤销或账号已停用');
    }
    const s=result.rows[0];
    if(!s.staff_id||!s.organization_id||typeof s.display_name!=='string'||
      !Array.isArray(s.role_codes)||s.role_codes.some(x=>typeof x!=='string'))
      throw Error('Invalid strict employee directory projection');
    await client.query('COMMIT');
    return {
      user:{
        id:s.staff_id,organization_id:s.organization_id,
        display_name:s.display_name,status:'active'
      },
      roles:s.role_codes,
      manager:s.role_codes.some(code=>['sales_manager','super_admin'].includes(code))
    };
  }catch(e){
    if(client)try{await client.query('ROLLBACK');}catch{}
    throw e;
  }finally{if(client)client.release();}
}
