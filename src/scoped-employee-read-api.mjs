// V3.2-09: separate read-only API using a DB LOGIN fixed to one employee.
// Not a replacement for the original wider-permission /api/v1 endpoints.
// NO body writes, demo sessions, credentials in query params, arbitrary SQL
// or production deployment. Runs only on localhost with fictional data.
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {createExternalTokenVerifier} from './external-identity.mjs';

const paths=new Map([
  ['/api/v1/scoped/students','ms.student_directory_assigned'],
  ['/api/v1/scoped/contacts','ms.scoped_contacts_directory'],
  ['/api/v1/scoped/contact-events','ms.scoped_contact_events_directory'],
  ['/api/v1/scoped/leads','ms.scoped_leads_directory'],
  ['/api/v1/scoped/opportunities','ms.scoped_opportunities_directory']
]);
const LOCAL=new Set(['127.0.0.1','::1','::ffff:127.0.0.1']);
function send(res,status,code,message,requestId,data){
  res.writeHead(status,{
    'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff'
  });
  res.end(JSON.stringify({
    code,message,request_id:requestId,
    ...(data!==undefined?{data}:{})
  }));
}
export async function assertScopedReadPool(pool){
  if(process.env.MS_STAGE!=='isolated-test')
    throw new Error('Scoped employee read API is isolated-test only');
  const r=await pool.query(
    "SELECT current_user AS login,session_user AS original_login, "+
    "rolsuper,rolbypassrls,rolcreatedb,rolcreaterole, "+
    "has_table_privilege(current_user,'ms.students','SELECT') AS raw_students, "+
    "has_table_privilege(current_user,'ms.contacts','SELECT') AS raw_contacts, "+
    "has_table_privilege(current_user,'ms.staff_identity_bindings','SELECT') AS raw_identity, "+
    "has_table_privilege(current_user,'ms.sales_orders','SELECT') AS finance, "+
    "has_table_privilege(current_user,'ms.scoped_contacts_directory','SELECT') AS contacts_view, "+
    "has_function_privilege(current_user,'ms.scoped_employee_identity_valid(text,text)','EXECUTE') AS check_identity, "+
    "ms.current_scoped_staff_id() AS scoped_staff_id, "+
    "ms.current_scoped_organization_id() AS scoped_organization_id "+
    "FROM pg_roles WHERE rolname=current_user"
  );
  const x=r.rows[0];
  if(!x||x.login!==x.original_login||x.rolsuper||x.rolbypassrls||
    x.rolcreatedb||x.rolcreaterole||x.raw_students||x.raw_contacts||
    x.raw_identity||x.finance||!x.contacts_view||!x.check_identity)
    throw new Error('Employee scoped read API refuses elevated or unscoped DB LOGIN');
  return {employee_db_login:x.login,restricted:true};
}
export function createScopedEmployeeReadApi(pool,{externalIdentity}={}){
  if(process.env.MS_STAGE!=='isolated-test')
    throw new Error('Scoped employee read API cannot run in production');
  if(!pool||typeof pool.connect!=='function')
    throw new Error('Employee restricted PostgreSQL connection required');
  const verify=createExternalTokenVerifier(externalIdentity);
  return createServer(async(req,res)=>{
    const requestId=randomUUID();
    let client;
    try{
      if(!LOCAL.has(req.socket.remoteAddress)){
        send(res,403,'FORBIDDEN','仅本机隔离测试可以访问',requestId);return;
      }
      const url=new URL(req.url,'http://localhost');
      if(req.method!=='GET'||!paths.has(url.pathname)||url.search){
        send(res,404,'NOT_FOUND','没有开放该员工查询接口',requestId);return;
      }
      const token=(req.headers.authorization||'').match(/^Bearer (\S+)$/i)?.[1];
      if(!token){
        send(res,401,'AUTH_REQUIRED','需要有效员工外部身份',requestId);return;
      }
      const claims=verify(token);
      client=await pool.connect();
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const check=await client.query(
        'SELECT ms.scoped_employee_identity_valid($1,$2) AS permitted',
        [claims.issuer,claims.subject]);
      if(check.rows[0]?.permitted!==true){
        await client.query('ROLLBACK');
        send(res,403,'FORBIDDEN','该员工未获当前数据访问授权',requestId);return;
      }
      // The table identifier comes ONLY from this internal hard-coded whitelist.
      // The database VIEW is security-barrier protected, and runs in the same
      // repeatable-read snapshot as binding verification.
      const table=paths.get(url.pathname);
      const result=await client.query('SELECT * FROM '+table+' ORDER BY 1 LIMIT 100');
      await client.query('COMMIT');
      send(res,200,'OK','查询成功',requestId,{items:result.rows});
    }catch(error){
      if(client)try{await client.query('ROLLBACK');}catch{}
      const status=error?.status===401?401:500;
      const code=status===401?'AUTH_REQUIRED':'INTERNAL_ERROR';
      send(res,status,code,status===401?'外部身份凭据无效':'隔离查询失败',requestId);
    }finally{
      if(client)client.release();
    }
  });
}
