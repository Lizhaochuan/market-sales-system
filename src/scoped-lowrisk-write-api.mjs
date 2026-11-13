// V3.2-12: restricted low-risk student/contact writes.
// Only disposable localhost PG; no payment or production CRM writes.
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {createExternalTokenVerifier} from './external-identity.mjs';

const LOCAL=new Set(['127.0.0.1','::1','::ffff:127.0.0.1']);
const KEY=/^[a-zA-Z0-9_-]{16,128}$/;
const limit=8192;
function send(res,status,code,message,trace,data){
  res.writeHead(status,{
    'Content-Type':'application/json; charset=utf-8',
    'X-Content-Type-Options':'nosniff',
    'Cache-Control':'no-store'
  });
  res.end(JSON.stringify({code,message,request_id:trace,
    ...(data===undefined?{}:{data})}));
}
function text(v,label,max=100){
  if(typeof v!=='string'||v.trim().length<1||v.trim().length>max)
    throw Object.assign(new Error(label+'内容缺失或长度超限'),{status:422});
  return v.trim();
}
function optionalText(v,label,max=100){
  if(v===undefined||v===null)return null;
  if(typeof v!=='string'||v.trim().length>max)
    throw Object.assign(new Error(label+'内容长度超限'),{status:422});
  return v.trim()||null;
}
function checkBody(value,fields){
  if(!value||typeof value!=='object'||Array.isArray(value)||
    Object.keys(value).some(k=>!fields.includes(k)))
    throw Object.assign(new Error('提交内容包含未开放的个人信息或字段'),{status:422});
}
async function bodyJson(req){
  if(req.headers['content-type']?.split(';')[0]?.trim()!=='application/json')
    throw Object.assign(new Error('请使用 JSON 格式提交'),{status:415});
  const chunks=[];let total=0;
  for await(const data of req){
    total+=data.length;
    if(total>limit)throw Object.assign(new Error('提交内容过长'),{status:413});
    chunks.push(data);
  }
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  catch{throw Object.assign(new Error('提交内容不是有效 JSON'),{status:422});}
}
export async function assertScopedLowriskWriter(pool){
  if(process.env.MS_STAGE!=='isolated-test')
    throw new Error('Restricted lowrisk writes are isolated-test only');
  const r=await pool.query(
    "SELECT current_user AS login,session_user AS principal,rolsuper,rolbypassrls,"+
    "has_table_privilege(current_user,'ms.students','SELECT') AS students_read,"+
    "has_table_privilege(current_user,'ms.students','INSERT') AS students_insert,"+
    "has_table_privilege(current_user,'ms.contacts','INSERT') AS contacts_insert,"+
    "has_table_privilege(current_user,'ms.sales_orders','SELECT') AS finance_read,"+
    "has_table_privilege(current_user,'ms.audit_events','UPDATE') AS audit_edit,"+
    "has_function_privilege(current_user,'ms.create_scoped_student(text,text,text,text)','EXECUTE') AS student_fn,"+
    "has_function_privilege(current_user,'ms.create_scoped_contact(text,boolean,text)','EXECUTE') AS contact_fn,"+
    "has_function_privilege(current_user,'ms.link_scoped_student_contact(uuid,uuid,text,text)','EXECUTE') AS relationship_fn,"+
    "has_function_privilege(current_user,'ms.create_scoped_contact_consultation(uuid,text,timestamptz,text)','EXECUTE') AS consultation_fn,"+
    "has_function_privilege(current_user,'ms.scoped_employee_identity_valid(text,text)','EXECUTE') AS identity_fn,"+
    "ms.current_scoped_staff_id() AS staff_id,"+
    "ms.current_scoped_organization_id() AS organization_id "+
    "FROM pg_roles WHERE rolname=current_user");
  const x=r.rows[0];
  if(!x||x.login!==x.principal||x.rolsuper||x.rolbypassrls||
    x.students_read||x.students_insert||x.contacts_insert||x.finance_read||
    x.audit_edit||!x.student_fn||!x.contact_fn||!x.relationship_fn||!x.consultation_fn||!x.identity_fn||
    !x.staff_id||!x.organization_id)
    throw new Error('Low-risk service must use mapped nonowner function-only staff login');
  return {login:x.login,restricted:true};
}
export function createScopedLowriskWriteApi(pool,{externalIdentity}={}){
  if(process.env.MS_STAGE!=='isolated-test'||!pool?.connect)
    throw new Error('Employee low-risk write API is isolated-test only');
  const verify=createExternalTokenVerifier(externalIdentity);
  return createServer(async(req,res)=>{
    const trace=randomUUID();let client;
    try{
      if(!LOCAL.has(req.socket.remoteAddress)){
        send(res,403,'FORBIDDEN','仅限本机隔离测试',trace);return;
      }
      const path=new URL(req.url,'http://localhost');
      const student=path.pathname==='/api/v1/lowrisk/students';
      const contact=path.pathname==='/api/v1/lowrisk/contacts';
      if(req.method!=='POST'||path.search||(!student&&!contact)){
        send(res,404,'NOT_FOUND','该低风险操作尚未开放',trace);return;
      }
      const token=(req.headers.authorization||'').match(/^Bearer (\S+)$/i)?.[1];
      if(!token){
        send(res,401,'AUTH_REQUIRED','请使用已验证的员工签名身份',trace);return;
      }
      const claims=verify(token);
      const key=req.headers['idempotency-key'];
      if(typeof key!=='string'||!KEY.test(key)){
        send(res,422,'VALIDATION_ERROR','需要16至128位有效防重复编号',trace);return;
      }
      const body=await bodyJson(req);
      const values=student?['display_name','grade_label','school_name']:
        ['display_name','do_not_contact'];
      checkBody(body,values);
      const name=text(body.display_name,student?'学生姓名':'联系人称呼');
      const grade=student?optionalText(body.grade_label,'年级'):null;
      const school=student?optionalText(body.school_name,'学校'):null;
      const optout=body.do_not_contact===undefined?false:body.do_not_contact;
      if(contact&&typeof optout!=='boolean')
        throw Object.assign(new Error('拒绝联系的设置不正确'),{status:422});
      client=await pool.connect();
      await client.query('BEGIN');
      const authorized=await client.query(
        'SELECT ms.scoped_employee_identity_valid($1,$2) AS allowed',
        [claims.issuer,claims.subject]);
      if(authorized.rows[0]?.allowed!==true){
        await client.query('ROLLBACK');
        send(res,403,'FORBIDDEN','员工身份尚未批准、已撤销或与数据库员工不一致',trace);return;
      }
      const result=student?
        await client.query(
          'SELECT ms.create_scoped_student($1,$2,$3,$4) AS data',
          [name,grade,school,key]):
        await client.query(
          'SELECT ms.create_scoped_contact($1,$2,$3) AS data',
          [name,optout,key]);
      await client.query('COMMIT');
      send(res,200,'OK',student?'已建立学生独立档案':'已登记联系人',
        trace,result.rows[0].data);
    }catch(error){
      if(client)try{await client.query('ROLLBACK');}catch{}
      const sqlCode=String(error?.code||'');
      const code=Number.isInteger(error?.status)?error.status:
        sqlCode==='42501'?403:sqlCode==='23505'?409:
        sqlCode==='23514'||sqlCode==='22P02'?422:500;
      const message=code===500?'低风险操作未完成，请核实当前业务结果':
        code===409?'防重复编号已经用于其他业务内容':
        code===403?'没有执行该员工操作的权限':
        error?.message||'操作未成功';
      send(res,code,
        code===403?'FORBIDDEN':code===409?'BUSINESS_CONFLICT':
        [413,415,422].includes(code)?'VALIDATION_ERROR':
        code===401?'AUTH_REQUIRED':'INTERNAL_ERROR',
        message,trace);
    }finally{if(client)client.release();}
  });
}
