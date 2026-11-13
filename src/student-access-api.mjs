// V3.2-11 standalone restricted business API for student share/transfer.
// Only localhost + fictional isolated-test. No DB base-table grants.
// IMPORTANT: legitimate staff JWT -> SESSION_USER employee mapping is required.
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createExternalTokenVerifier} from './external-identity.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY=/^[a-zA-Z0-9_-]{16,128}$/;
const LOCAL=new Set(['127.0.0.1','::1','::ffff:127.0.0.1']);
const limit=8192;
function answer(res,status,code,message,id,data){
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(JSON.stringify({code,message,request_id:id,
    ...(data===undefined?{}:{data})}));
}
function validateBody(body,allowed){
  if(!body||typeof body!=='object'||Array.isArray(body)||
    Object.keys(body).some(k=>!allowed.includes(k)))
    throw Object.assign(new Error('提交内容包含不允许的字段'),{status:422});
}
function requiredText(value,label,max=400,min=2){
  if(typeof value!=='string'||value.trim().length<min||
    value.trim().length>max)throw Object.assign(
      new Error(label+'内容缺失或长度超限'),{status:422});
  return value.trim();
}
function id(value,label){
  if(typeof value!=='string'||!UUID.test(value))
    throw Object.assign(new Error(label+'编号不正确'),{status:422});
  return value;
}
async function jsonBody(req){
  if(req.headers['content-type']?.split(';')[0]?.trim()!=='application/json')
    throw Object.assign(new Error('请使用 JSON 格式提交'),{status:415});
  const chunks=[];let n=0;
  for await(const chunk of req){
    n+=chunk.length;
    if(n>limit)throw Object.assign(new Error('提交内容过长'),{status:413});
    chunks.push(chunk);
  }
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  catch{throw Object.assign(new Error('提交内容不是有效 JSON'),{status:422});}
}
export async function assertStudentAccessOperatorPool(pool){
  if(process.env.MS_STAGE!=='isolated-test')
    throw new Error('Access governance must remain isolated');
  const r=await pool.query(
    "SELECT current_user AS login,session_user AS principal,rolsuper,rolbypassrls,"+
    "has_table_privilege(current_user,'ms.students','SELECT') AS raw_students,"+
    "has_table_privilege(current_user,'ms.data_scope_grants','SELECT') AS raw_grants,"+
    "has_table_privilege(current_user,'ms.student_access_requests','SELECT') AS raw_requests,"+
    "has_table_privilege(current_user,'ms.sales_orders','SELECT') AS financial,"+
    "has_function_privilege(current_user,"+
      "'ms.request_student_access(text,uuid,uuid,timestamptz,text,text,text)','EXECUTE') AS request_allowed,"+
    "has_function_privilege(current_user,"+
      "'ms.decide_student_access(uuid,text,text,text,text)','EXECUTE') AS decide_allowed,"+
    "has_function_privilege(current_user,"+
      "'ms.scoped_employee_identity_valid(text,text)','EXECUTE') AS identity_allowed "+
    "FROM pg_roles WHERE rolname=current_user"
  );
  const x=r.rows[0];
  if(!x||x.login!==x.principal||x.rolsuper||x.rolbypassrls||
    x.raw_students||x.raw_grants||x.raw_requests||x.financial||
    !x.request_allowed||!x.decide_allowed||!x.identity_allowed)
    throw new Error('Student access operator needs strictly function-only mapped DB LOGIN');
  return {login:x.login,restricted:true};
}

export function createStudentAccessApi(pool,{externalIdentity}={}){
  if(process.env.MS_STAGE!=='isolated-test'||!pool?.connect)
    throw new Error('Student access API is local isolated-test only');
  const verify=createExternalTokenVerifier(externalIdentity);
  return createServer(async(req,res)=>{
    const trace=randomUUID();
    let client;
    try{
      if(!LOCAL.has(req.socket.remoteAddress)){
        answer(res,403,'FORBIDDEN','仅限隔离本机访问',trace);return;
      }
      const url=new URL(req.url,'http://localhost');
      if(url.search){
        answer(res,404,'NOT_FOUND','未开放该业务路径',trace);return;
      }
      const path=url.pathname;
      // Static asset paths are fixed: no user-supplied filename, traversal,
      // arbitrary directory read, external network or browser token storage.
      const staticAssets={
        '/app/':['../web/access.html','text/html; charset=utf-8'],
        '/app':['../web/access.html','text/html; charset=utf-8'],
        '/app/access.js':['../web/access.js','application/javascript; charset=utf-8'],
        '/app/access.css':['../web/access.css','text/css; charset=utf-8']
      };
      if(req.method==='GET'&&Object.hasOwn(staticAssets,path)){
        const [file,type]=staticAssets[path];
        const body=await readFile(new URL(file,import.meta.url));
        res.writeHead(200,{
          'Content-Type':type,'Cache-Control':'no-store',
          'X-Content-Type-Options':'nosniff',
          'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
        });
        res.end(body);return;
      }
      const listStudents=req.method==='GET'&&path==='/api/v1/student-access/students';
      const listStaff=req.method==='GET'&&path==='/api/v1/student-access/staff';
      const listReq=req.method==='GET'&&path==='/api/v1/student-access/requests';
      const listGrants=req.method==='GET'&&path==='/api/v1/student-access/grants';
      const createReq=req.method==='POST'&&path==='/api/v1/student-access/requests';
      const decision=req.method==='POST'&&
        /^\/api\/v1\/student-access\/requests\/[0-9a-f-]+\/decision$/.test(path);
      const revoke=req.method==='POST'&&
        /^\/api\/v1\/student-access\/grants\/[0-9a-f-]+\/revoke$/.test(path);
      if(!(listStudents||listStaff||listReq||listGrants||createReq||decision||revoke)){
        answer(res,404,'NOT_FOUND','该操作未开放',trace);return;
      }
      const token=(req.headers.authorization||'').match(/^Bearer (\S+)$/i)?.[1];
      if(!token){
        answer(res,401,'AUTH_REQUIRED','请提供经过验证的员工身份',trace);return;
      }
      const claims=verify(token);
      const key=req.headers['idempotency-key'];
      if(req.method==='POST'&&(typeof key!=='string'||!KEY.test(key))){
        answer(res,422,'VALIDATION_ERROR','需要有效的操作防重复编号',trace);return;
      }
      const body=req.method==='POST'?await jsonBody(req):null;
      client=await pool.connect();
      await client.query('BEGIN');
      const auth=await client.query(
        'SELECT ms.scoped_employee_identity_valid($1,$2) AS permitted',
        [claims.issuer,claims.subject]);
      if(auth.rows[0]?.permitted!==true){
        await client.query('ROLLBACK');
        answer(res,403,'FORBIDDEN','员工身份未获批准或已经撤销',trace);return;
      }
      let data,message;
      if(listStudents){
        const result=await client.query('SELECT * FROM ms.list_student_access_choices()');
        data={items:result.rows};message='已查询本人负责的学生';
      }else if(listStaff){
        const result=await client.query('SELECT * FROM ms.list_student_access_staff()');
        data={items:result.rows};message='已查询本机构可选的接收员工';
      }else if(listReq){
        const result=await client.query('SELECT * FROM ms.list_student_access_requests()');
        data={items:result.rows};message='已查询学生授权及转交申请';
      }else if(listGrants){
        const result=await client.query('SELECT * FROM ms.list_student_share_grants()');
        data={items:result.rows};message='已查询指定学生查看授权';
      }else if(createReq){
        validateBody(body,['action','student_id','target_staff_id','expires_at','evidence_ref','reason_zh']);
        if(!['share','transfer'].includes(body.action))
          throw Object.assign(new Error('请选择临时共享或负责人转交'),{status:422});
        const expiry=body.action==='share'?new Date(body.expires_at):null;
        if(body.action==='share'&&!Number.isFinite(expiry?.getTime()))
          throw Object.assign(new Error('临时共享需要有效的到期时间'),{status:422});
        if(body.action==='transfer'&&body.expires_at!==undefined)
          throw Object.assign(new Error('负责人转交不能填写临时共享到期时间'),{status:422});
        const result=await client.query(
          'SELECT ms.request_student_access($1,$2,$3,$4,$5,$6,$7) AS id',
          [body.action,id(body.student_id,'学生'),id(body.target_staff_id,'接收员工'),
            expiry,requiredText(body.evidence_ref,'核实材料编号',200,1),
            requiredText(body.reason_zh,'申请原因'),key]);
        data={request_id:result.rows[0].id,status_zh:'待独立审批'};
        message='学生授权变更申请已提交，尚未生效';
      }else if(decision){
        validateBody(body,['decision','evidence_ref','reason_zh']);
        if(!['approved','rejected'].includes(body.decision))
          throw Object.assign(new Error('请选择批准或驳回'),{status:422});
        const rid=id(path.split('/')[5],'授权申请');
        const result=await client.query(
          'SELECT ms.decide_student_access($1,$2,$3,$4,$5) AS status_zh',
          [rid,body.decision,requiredText(body.evidence_ref,'审核材料编号',200,1),
            requiredText(body.reason_zh,'审核理由'),key]);
        data={request_id:rid,status_zh:result.rows[0].status_zh};
        message='独立主管审核结果已记录';
      }else{
        validateBody(body,['reason_zh']);
        const gid=id(path.split('/')[5],'学生共享授权');
        const result=await client.query('SELECT ms.revoke_student_share($1,$2,$3) AS status_zh',
          [gid,requiredText(body.reason_zh,'撤销原因'),key]);
        data={grant_id:gid,status_zh:result.rows[0].status_zh};
        message='指定学生查看授权已撤销';
      }
      await client.query('COMMIT');
      answer(res,200,'OK',message,trace,data);
    }catch(error){
      if(client)try{await client.query('ROLLBACK');}catch{}
      const code=String(error?.code||'');
      const status=Number.isInteger(error?.status)?error.status:
        code==='23505'?409:code==='42501'?403:code==='23514'||code==='22P02'?422:
        code==='AUTH_REQUIRED'?401:500;
      const label=status===409?'BUSINESS_CONFLICT':
        status===403?'FORBIDDEN':status===401?'AUTH_REQUIRED':
        [413,415,422].includes(status)?'VALIDATION_ERROR':'INTERNAL_ERROR';
      const message=status===500?'学生权限操作未完成，请核实原结果':
        status===409?'该学生授权申请或操作已经存在':
        status===403?'没有执行该学生授权操作的权限':
        error?.message||'身份验证失败';
      answer(res,status,label,message,trace);
    }finally{if(client)client.release();}
  });
}
