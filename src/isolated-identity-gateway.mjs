// V3.2-07 isolated-only external identity -> tenant database router.
// This is NOT a production OIDC login/callback server and must not listen on
// public interfaces. Caller-supplied org claims/headers are never routing keys.
import { createServer } from 'node:http';
import { createExternalTokenVerifier } from './external-identity.mjs';

const LOCAL=['127.0.0.1','::1','::ffff:127.0.0.1'];
const MAX_BODY=256*1024;
const failResponse=(res,status,code,message)=>{
  res.writeHead(status,{
    'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff'
  });
  res.end(JSON.stringify({code,message}));
};
const identityKey=(issuer,subject)=>JSON.stringify([issuer,subject]);
function assertLoopback(origin){
  const url=new URL(origin);
  if(url.protocol!=='http:'||url.username||url.password||!url.port||
    !['127.0.0.1','[::1]'].includes(url.hostname)||
    url.pathname!=='/'||url.search||url.hash)
    throw new Error('Isolated tenant target must be a fixed loopback HTTP origin');
  return url.origin;
}
async function readBody(req){
  let size=0;const chunks=[];
  for await (const part of req){
    size+=part.length;
    if(size>MAX_BODY){
      const error=new Error('request too large');error.httpStatus=413;throw error;
    }
    chunks.push(part);
  }
  return Buffer.concat(chunks);
}
export function createIsolatedIdentityGateway({externalIdentity,registrations,tenantUpstreams,resolveTenant}={}){
  if(process.env.MS_STAGE!=='isolated-test')
    throw new Error('Trusted identity routing is not production enabled');
  const verify=createExternalTokenVerifier(externalIdentity);
  const approvedDirectoryMode=resolveTenant!==undefined||tenantUpstreams!==undefined;
  const routes=new Map();
  if(approvedDirectoryMode){
    if(typeof resolveTenant!=='function'||!Array.isArray(tenantUpstreams)||
      !tenantUpstreams.length||registrations!==undefined)
      throw new Error('Approved directory mode requires resolver and fixed tenant upstreams only');
    const tenantId=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    for(const entry of tenantUpstreams){
      if(!entry||typeof entry.tenantId!=='string'||!tenantId.test(entry.tenantId))
        throw new Error('Invalid configured tenant ID');
      const id=entry.tenantId.toLowerCase();
      if(routes.has(id))throw new Error('Duplicate tenant upstream');
      routes.set(id,assertLoopback(entry.upstream));
    }
  }else{
    if(!Array.isArray(registrations)||!registrations.length)
      throw new Error('Administrator-supplied identity registrations required');
    for(const r of registrations){
      if(!r||r.issuer!==externalIdentity.issuer||
        typeof r.subject!=='string'||!r.subject.trim()||r.subject.length>255)
        throw new Error('Invalid trusted identity registration');
      const id=identityKey(r.issuer,r.subject);
      if(routes.has(id))throw new Error('Duplicate issuer/subject registration');
      routes.set(id,assertLoopback(r.upstream));
    }
  }
  return createServer(async(req,res)=>{
    try{
      if(!LOCAL.includes(req.socket.remoteAddress)){
        failResponse(res,403,'FORBIDDEN','隔离访问只允许本机');return;
      }
      const url=new URL(req.url,'http://localhost');
      if(!['GET','POST'].includes(req.method)||
        !url.pathname.startsWith('/api/v1/')||
        url.pathname==='/api/v1/dev/login'||
        url.pathname==='/api/v1/health'){
        failResponse(res,404,'NOT_FOUND','该路由未开放');return;
      }
      const token=(req.headers.authorization||'').match(/^Bearer (\S+)$/i)?.[1];
      if(!token){
        failResponse(res,401,'AUTH_REQUIRED','需要已核验的员工身份令牌');return;
      }
      const claims=verify(token);
      const routeKey=approvedDirectoryMode
        ? await resolveTenant(claims.issuer,claims.subject)
        : identityKey(claims.issuer,claims.subject);
      const upstream=routes.get(approvedDirectoryMode&&typeof routeKey==='string'
        ? routeKey.toLowerCase() : routeKey);
      if(!upstream){
        failResponse(res,403,'FORBIDDEN','身份未获可信机构路由授权');return;
      }
      if(req.method==='POST' && req.headers['content-type']?.split(';')[0]?.trim()!=='application/json'){
        failResponse(res,415,'INVALID_CONTENT_TYPE','仅允许 JSON 业务请求');return;
      }
      const body=req.method==='POST'?await readBody(req):undefined;
      const destination=new URL(url.pathname+url.search,upstream);
      const headers={Authorization:'Bearer '+token};
      if(req.method==='POST'){
        headers['Content-Type']='application/json';
        if(typeof req.headers['idempotency-key']==='string')
          headers['Idempotency-Key']=req.headers['idempotency-key'];
      }
      // Only protocol-level safe headers are forwarded. Cookies, org/role
      // headers, x-forwarded-host and client-supplied routing information are not.
      // The destination rechecks token+subject against a CURRENT nonrevoked
      // staff binding in its own institution-scoped PostgreSQL connection.
      const upstreamResponse=await fetch(destination,{
        method:req.method,headers,redirect:'manual',cache:'no-store',
        ...(body!==undefined?{body}:{}),
        signal:AbortSignal.timeout(10000)
      });
      if(upstreamResponse.status>=300&&upstreamResponse.status<400){
        failResponse(res,502,'UPSTREAM_REJECTED','机构业务服务返回不可接受的跳转');return;
      }
      const result=await upstreamResponse.text();
      res.writeHead(upstreamResponse.status,{
        'Content-Type':'application/json; charset=utf-8',
        'Cache-Control':'no-store',
        'X-Content-Type-Options':'nosniff'
      });
      res.end(result);
    }catch(e){
      if(res.headersSent){res.end();return;}
      if(e?.status&&e?.code){
        failResponse(res,e.status,e.code,e.message);return;
      }
      if(e?.httpStatus===413){
        failResponse(res,413,'BODY_TOO_LARGE','请求内容超过隔离网关限制');return;
      }
      failResponse(res,502,'GATEWAY_UNAVAILABLE','可信机构路由暂不可用');
    }
  });
}
