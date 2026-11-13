import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createSign,randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';
import {createApp} from '../../src/app.mjs';
import {createIsolatedIdentityGateway} from '../../src/isolated-identity-gateway.mjs';

const orgA='20000000-0000-4000-8000-000000000001';
const orgB='20000000-0000-4000-8000-000000000002';
const staffA='20000000-0000-4000-8000-000000000011';
const staffB='20000000-0000-4000-8000-000000000021';
const secret='fictional-test-only-strong-token-secret-9c92789dc3b9';
const issuer='https://fictional-identity-route.example.invalid';
const audience='market-sales-routing-audience';
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const close=server=>new Promise(resolve=>server.close(resolve));
const origin=server=>'http://127.0.0.1:'+server.address().port;
const key=()=>randomBytes(20).toString('hex');

test('V3.2-07: signed identity chooses protected tenant database, not org header/claim',async t=>{
  process.env.MS_STAGE='isolated-test';
  const owner=new pg.Pool({connectionString:process.env.DATABASE_URL,max:4});
  const poolA=new pg.Pool({connectionString:process.env.DATABASE_URL_RESTRICTED,max:5});
  const poolB=new pg.Pool({connectionString:process.env.DATABASE_URL_RESTRICTED_B,max:5});
  const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  const jwk={...publicKey.export({format:'jwk'}),kid:'test-route-2026',alg:'RS256',use:'sig'};
  const externalIdentity={issuer,audience,jwks:{keys:[jwk]}};
  const subjectA='route-a-'+randomUUID(),subjectB='route-b-'+randomUUID();
  const token=(subject,overrides={})=>{
    const now=Math.floor(Date.now()/1000);
    const h=Buffer.from(JSON.stringify({alg:'RS256',kid:jwk.kid,typ:'JWT'})).toString('base64url');
    const p=Buffer.from(JSON.stringify({iss:issuer,aud:audience,sub:subject,
      iat:now,exp:now+900,...overrides})).toString('base64url');
    return h+'.'+p+'.'+createSign('RSA-SHA256').update(h+'.'+p).sign(privateKey).toString('base64url');
  };
  const appA=createApp(poolA,{secret,issuer:'market-sales-test-issuer',externalIdentity});
  const appB=createApp(poolB,{secret,issuer:'market-sales-test-issuer',externalIdentity});
  const servers=[appA,appB];let gateway;
  try{
    await owner.query(
      "INSERT INTO ms.staff_identity_bindings(staff_user_id,issuer,subject,bound_by) "+
      "VALUES($1,$3,$4,$2),($5,$3,$6,$2)",
      [staffA,'20000000-0000-4000-8000-000000000013',issuer,subjectA,staffB,subjectB]);
    await Promise.all([listen(appA),listen(appB)]);
    gateway=createIsolatedIdentityGateway({externalIdentity,registrations:[
      {issuer,subject:subjectA,upstream:origin(appA)},
      {issuer,subject:subjectB,upstream:origin(appB)}
    ]});
    servers.push(gateway);await listen(gateway);
    const base=origin(gateway);
    const call=async(method,path,jwt,body,headers={})=>{
      const res=await fetch(base+path,{method,headers:{
        ...(jwt?{Authorization:'Bearer '+jwt}:{}),
        ...headers,
        ...(body!==undefined?{'Content-Type':'application/json','Idempotency-Key':key()}: {})
      },...(body!==undefined?{body:JSON.stringify(body)}:{})});
      return {status:res.status,...await res.json()};
    };
    const tokenA=token(subjectA,{org_id:orgB,role:'super_admin'});
    const tokenB=token(subjectB,{org_id:orgA,role:'super_admin'});
    await t.test('preapproved issuer+subject directs request to its own DB LOGIN despite forged org and role claims',async()=>{
      const a=await call('GET','/api/v1/me',tokenA);
      const b=await call('GET','/api/v1/me',tokenB);
      assert.equal(a.status,200);assert.equal(b.status,200);
      assert.equal(a.data.staff_id,staffA);assert.equal(a.data.organization_id,orgA);
      assert.equal(a.data.capabilities.manage_identity_requests,false);
      assert.equal(b.data.staff_id,staffB);assert.equal(b.data.organization_id,orgB);
    });
    await t.test('business data never crosses tenant via supplied host, org headers or query',async()=>{
      const a=await call('POST','/api/v1/students',tokenA,
        {display_name:'身份路由虚构A学生'}, {'X-Organization-ID':orgB,'X-Forwarded-Host':'malicious.invalid'});
      const b=await call('POST','/api/v1/students',tokenB,
        {display_name:'身份路由虚构B学生'}, {'X-Organization-ID':orgA});
      assert.equal(a.status,200);assert.equal(b.status,200);
      const listA=await call('GET','/api/v1/students?org_id='+orgB,tokenA);
      const listB=await call('GET','/api/v1/students?org_id='+orgA,tokenB);
      assert.equal(listA.status,200);assert.equal(listB.status,200);
      assert.ok(listA.data.items.some(x=>x.student_id===a.data.student_id));
      assert.ok(!listA.data.items.some(x=>x.student_id===b.data.student_id));
      assert.ok(listB.data.items.some(x=>x.student_id===b.data.student_id));
      assert.ok(!listB.data.items.some(x=>x.student_id===a.data.student_id));
    });
    await t.test('tampered JWT, unknown subject and HS256 demo tokens never select a database',async()=>{
      const tampered=tokenA.split('.');
      tampered[2]=randomBytes(256).toString('base64url');
      assert.equal((await call('GET','/api/v1/me',tampered.join('.'))).status,401);
      assert.equal((await call('GET','/api/v1/me',token('unbound-'+randomUUID()))).status,403);
      assert.equal((await call('GET','/api/v1/me',null)).status,401);
      const none=Buffer.from(JSON.stringify({alg:'none'})).toString('base64url');
      assert.equal((await call('GET','/api/v1/me',none+'.invalid.')).status,401);
    });
    await t.test('gateway blocks demo login, arbitrary paths and unauthorized target origins',async()=>{
      assert.equal((await call('POST','/api/v1/dev/login',tokenA,{account_code:'sales-a'})).status,404);
      assert.equal((await call('GET','/internal/config',tokenA)).status,404);
      assert.throws(()=>createIsolatedIdentityGateway({externalIdentity,
        registrations:[{issuer,subject:'f',upstream:'https://example.com'}]}));
      assert.throws(()=>createIsolatedIdentityGateway({externalIdentity,
        registrations:[
          {issuer,subject:'repeat',upstream:origin(appA)},
          {issuer,subject:'repeat',upstream:origin(appB)}
        ]}));
    });
    await t.test('stale static route cannot bypass current database identity revocation',async()=>{
      await owner.query('UPDATE ms.staff_identity_bindings SET revoked_at=now() WHERE issuer=$1 AND subject=$2',[issuer,subjectA]);
      const denied=await call('GET','/api/v1/me',tokenA);
      assert.equal(denied.status,403);
      const alive=await call('GET','/api/v1/me',tokenB);
      assert.equal(alive.status,200);
    });
    await t.test('a misconfigured mapping to another org fails closed at DB staff lookup',async()=>{
      const wrong=createIsolatedIdentityGateway({externalIdentity,registrations:[
        {issuer,subject:subjectB,upstream:origin(appA)}
      ]});
      await listen(wrong);try{
        const res=await fetch(origin(wrong)+'/api/v1/me',{
          headers:{Authorization:'Bearer '+tokenB}});
        assert.equal(res.status,403);
      }finally{await close(wrong);}
    });
  }finally{
    await Promise.allSettled(servers.filter(x=>x.listening).map(close));
    await Promise.all([owner.end(),poolA.end(),poolB.end()]);
  }
});
