// V3.2-33 standalone, localhost-only UAT blocker viewer.
// No live financial/CRM connection, no production auth or write routes.
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createExternalTokenVerifier} from './external-identity.mjs';
import {buildBlockedUatTasks,renderBlockedUatMarkdown} from './integration-uat-blocker-report.mjs';
import {verifyBlockedFixtureHistory,renderBlockedFixtureHistoryMarkdown} from './uat-evidence-history.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCAL=new Set(['127.0.0.1','::1','::ffff:127.0.0.1']);
const CSP="default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; "+
 "base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'";
function headers(type='application/json; charset=utf-8'){
 return {'Content-Type':type,'Cache-Control':'no-store, max-age=0',
  'X-Content-Type-Options':'nosniff','Content-Security-Policy':CSP,
  'X-Frame-Options':'DENY','Referrer-Policy':'no-referrer',
  'Cross-Origin-Resource-Policy':'same-origin'};
}
function send(res,status,code,message,trace,data){
 res.writeHead(status,headers());
 res.end(JSON.stringify({code,message,request_id:trace,
  ...(data===undefined?{}:{data})}));
}
export async function assertUatPreviewPool(pool){
 if(process.env.MS_STAGE!=='isolated-test'||!pool?.query)
  throw Error('UAT report preview remains isolated-test only');
 const {rows}=await pool.query(
  "SELECT current_user AS principal,session_user AS login,rolsuper,rolbypassrls,"+
  "has_table_privilege(current_user,'ms.sales_orders','SELECT') AS raw_orders,"+
  "has_table_privilege(current_user,'ms.payment_allocations','SELECT') AS raw_finance,"+
  "has_table_privilege(current_user,'ms.crm_entitlement_links','SELECT') AS raw_crm,"+
  "has_table_privilege(current_user,'ms.integration_missing_evidence_events','SELECT') AS raw_uat,"+
  "has_table_privilege(current_user,'ms.fixture_uat_evidence_events','SELECT') AS raw_evidence,"+
  "has_table_privilege(current_user,'ms.sales_orders','UPDATE') AS update_orders,"+
  "has_function_privilege(current_user,"+
    "'ms.record_integration_missing_evidence(uuid,text,text,text,text,text)','EXECUTE') AS can_write_gap,"+
  "has_function_privilege(current_user,"+
    "'ms.propose_fixture_source_readiness(text,text,text,text,text,text)','EXECUTE') AS can_propose,"+
  "has_function_privilege(current_user,"+
    "'ms.record_fixture_uat_evidence(uuid,text,text,text,integer,text,text)','EXECUTE') AS can_write_evidence,"+
  "has_function_privilege(current_user,"+
    "'ms.readonly_fixture_uat_diff(uuid,integer,integer)','EXECUTE') AS can_audit,"+
  "has_function_privilege(current_user,"+
    "'ms.readonly_fixture_uat_diff_guarded(uuid,integer,integer,integer)','EXECUTE') AS can_guard_export,"+
  "has_function_privilege(current_user,"+
    "'ms.readonly_fixture_uat_freeze_state(uuid)','EXECUTE') AS can_read_freeze,"+
  "has_function_privilege(current_user,"+
    "'ms.freeze_fixture_uat_source(uuid,text,text,text)','EXECUTE') AS can_freeze,"+
  "has_function_privilege(current_user,"+
    "'ms.scoped_employee_identity_valid(text,text)','EXECUTE') AS can_validate_identity,"+
  "has_function_privilege(current_user,"+
    "'ms.readonly_integration_uat_report(uuid)','EXECUTE') AS can_report,"+
  "has_table_privilege(current_user,'ms.scoped_uat_preview_choices','SELECT') AS can_list "+
  "FROM pg_roles WHERE rolname=current_user"
 );
 const x=rows[0];
 if(!x||x.principal!==x.login||x.rolsuper||x.rolbypassrls||
  x.raw_orders||x.raw_finance||x.raw_crm||x.raw_uat||x.raw_evidence||x.update_orders||
  x.can_write_gap||x.can_propose||x.can_write_evidence||!x.can_validate_identity||
  !x.can_report||!x.can_list||!x.can_audit||!x.can_guard_export||
  !x.can_read_freeze||x.can_freeze)
   throw Error('UAT preview must use a dedicated function-only and read-only DB LOGIN');
 const p=await pool.query(
   'SELECT ms.current_scoped_staff_id() AS staff_id,'+
   'ms.current_scoped_organization_id() AS org_id');
 if(!UUID.test(p.rows[0]?.staff_id||'')||
    !UUID.test(p.rows[0]?.org_id||''))
   throw Error('UAT preview DB principal has no verified institution/employee mapping');
 return {principal:x.principal,restricted:true};
}
export function createUatPreviewApi(pool,{externalIdentity}={}){
 if(process.env.MS_STAGE!=='isolated-test'||!pool?.connect)
  throw Error('UAT preview is isolated-test and localhost-only');
 const verify=createExternalTokenVerifier(externalIdentity);
 return createServer(async(req,res)=>{
  const trace=randomUUID();
  let client;
  try{
   if(!LOCAL.has(req.socket.remoteAddress)){
    send(res,403,'FORBIDDEN','只允许在本地隔离环境访问',trace);return;
   }
   const url=new URL(req.url,'http://localhost');
   if(url.search||url.hash){
    send(res,404,'NOT_FOUND','禁止带参数的页面或接口路径',trace);return;
   }
   const staticAssets={
    '/uat':['../web/uat-preview.html','text/html; charset=utf-8'],
    '/uat/':['../web/uat-preview.html','text/html; charset=utf-8'],
    '/uat/app.js':['../web/uat-preview.js','text/javascript; charset=utf-8'],
    '/uat/styles.css':['../web/uat-preview.css','text/css; charset=utf-8']
   };
   if(req.method==='GET'&&Object.hasOwn(staticAssets,url.pathname)){
    const [file,type]=staticAssets[url.pathname];
    const bytes=await readFile(new URL(file,import.meta.url));
    res.writeHead(200,headers(type));res.end(bytes);return;
   }
   if(req.method!=='GET'){
    send(res,405,'METHOD_NOT_ALLOWED','仅允许只读查看和导出预览',trace);return;
   }
   const isList=url.pathname==='/api/v1/uat-preview/requests';
   const match=/^\/api\/v1\/uat-preview\/reports\/([0-9a-f-]{36})(\/markdown)?$/.exec(url.pathname);
   const historyMatch=/^\/api\/v1\/uat-preview\/reports\/([0-9a-f-]{36})\/history$/.exec(url.pathname);
   const diffMatch=/^\/api\/v1\/uat-preview\/reports\/([0-9a-f-]{36})\/diff\/([0-9]{1,8})\/([0-9]{1,8})(\/markdown)?$/.exec(url.pathname);
   const freezeMatch=/^\\/api\\/v1\\/uat-preview\\/reports\\/([0-9a-f-]{36})\\/freeze-state$/.exec(url.pathname);
   if(!isList&&!match&&!historyMatch&&!diffMatch&&!freezeMatch){
    send(res,404,'NOT_FOUND','没有开放该只读操作',trace);return;
   }
   const reportId=match?.[1]||historyMatch?.[1]||diffMatch?.[1]||freezeMatch?.[1];
   if(reportId&&!UUID.test(reportId)){
    send(res,422,'VALIDATION_ERROR','来源申请编号格式不正确',trace);return;
   }
   const token=(req.headers.authorization||'').match(/^Bearer (\S+)$/i)?.[1];
   if(!token){
    send(res,401,'AUTH_REQUIRED','需要有效的签名员工测试身份',trace);return;
   }
   const claims=verify(token);
   client=await pool.connect();
   // The DB LOGIN is preconfigured out of band, independent from JWT claims.
   const permission=await client.query(
    'SELECT ms.scoped_employee_identity_valid($1,$2) AS permitted',
    [claims.issuer,claims.subject]);
   if(permission.rows[0]?.permitted!==true){
    send(res,403,'FORBIDDEN','签名身份与本机构数据库员工未绑定或已撤销',trace);return;
   }
   if(isList){
    const result=await client.query(
     'SELECT source_request_id,department,required_gate_count,'+
     'recorded_missing_events,status_zh,production_integration_allowed,'+
     'execution_allowed,release_allowed '+
     'FROM ms.scoped_uat_preview_choices ORDER BY source_request_id LIMIT 50');
    if(result.rows.some(r=>r.production_integration_allowed!==false||
      r.execution_allowed!==false||r.release_allowed!==false))
      throw Error('Preview must remain blocked');
    send(res,200,'OK','已查询本机构受限待办清单',trace,{
     items:result.rows.map(r=>({
      request_id:r.source_request_id,department:r.department,
      required_gate_count:r.required_gate_count,
      recorded_missing_events:r.recorded_missing_events,
      status_zh:r.status_zh,
      production_integration_allowed:false,execution_allowed:false,
      release_allowed:false
     }))
    });return;
   }
   if(freezeMatch){
    const value=await client.query('SELECT ms.readonly_fixture_uat_freeze_state($1) AS result',[reportId]);
    const state=value.rows[0]?.result;
    if(!state||state.execution_allowed!==false||state.release_allowed!==false||
      state.production_integration_allowed!==false)throw Error('Unsafe freeze state');
    send(res,200,'OK','历史冻结状态仅供只读审计',trace,{freeze_state:state});return;
   }
   if(historyMatch||diffMatch){
    const from=diffMatch?Number(diffMatch[2]):0;
    const to=diffMatch?Number(diffMatch[3]):null;
    const exportAudit=Boolean(diffMatch?.[4]);
    let result;
    if(exportAudit){
     const etag=req.headers['if-match'];
     if(typeof etag!=='string'||!/^\"(0|[1-9][0-9]{0,7})\"$/.test(etag)){
      send(res,428,'PRECONDITION_REQUIRED','必须提供预览时的准确历史水位',trace);return;
     }
     const expected=Number(etag.slice(1,-1));
     result=await client.query(
      'SELECT ms.readonly_fixture_uat_diff_guarded($1,$2,$3,$4) AS report',
      [reportId,from,to,expected]);
    }else{
     result=await client.query(
      'SELECT ms.readonly_fixture_uat_diff($1,$2,$3) AS report',
      [reportId,from,to]);
    }
    const historyRaw=result.rows[0]?.report;
    const history=verifyBlockedFixtureHistory(historyRaw);
    if(diffMatch?.[4]){
     const markdown=renderBlockedFixtureHistoryMarkdown(historyRaw);
     res.writeHead(200,{...headers('text/markdown; charset=utf-8'),
      'Content-Disposition':'attachment; filename="uat-audit-'+reportId+'-'+from+'-'+to+'.md"'});
     res.end(markdown);return;
    }
    send(res,200,'OK','虚构证据历史差异只读预览，真实联调仍被阻断',trace,{history});return;
   }
   const result=await client.query(
    'SELECT ms.readonly_integration_uat_report($1) AS report',[match[1]]);
   const raw=result.rows[0]?.report;
   // Strict validation here and on both preview/export paths.
   const report=buildBlockedUatTasks(raw);
   if(match[2]){
    const markdown=renderBlockedUatMarkdown(raw);
    res.writeHead(200,{...headers('text/markdown; charset=utf-8'),
     'Content-Disposition':'attachment; filename="uat-blockers-'+match[1]+'.md"'});
    res.end(markdown);return;
   }
   send(res,200,'OK','只读待办预览，真实联调仍被阻断',trace,{report});
  }catch(error){
   const code=String(error?.code||'');
   const status=code==='42501'?403:code==='55000'?412:
    code==='AUTH_REQUIRED'||error?.status===401?401:
    code==='22P02'||code==='23514'?422:500;
   const message=status===403?'机构或员工无权查看该来源报告':
    status===401?'员工签名测试凭据无效':
    status===422?'请求或来源报告无效':
    status===412?'历史版本已变化或冻结状态不一致':'当前只读预览无法完成，请核实隔离环境';
   send(res,status,status===403?'FORBIDDEN':status===401?'AUTH_REQUIRED':
    status===422?'VALIDATION_ERROR':status===412?'STALE_SNAPSHOT':'INTERNAL_ERROR',message,trace);
  }finally{if(client)client.release();}
 });
}
