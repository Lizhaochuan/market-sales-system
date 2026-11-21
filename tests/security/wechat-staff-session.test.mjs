import test from 'node:test';
import assert from 'node:assert/strict';
import {createWeChatStaffSession} from '../../src/wechat-staff-session.mjs';

const appId='wx0000000000000001',issuer='https://fictional-identity.example.invalid';
const defaults={appId,appSecret:'synthetic-fixture',issuer};

test('WeChat verified subject must be approved before issuing a strict credential',async()=>{
  const calls=[];
  const session=createWeChatStaffSession({...defaults,
    fetcher:async (url,options)=>{
      assert.equal(url.origin,'https://api.weixin.qq.com');
      assert.equal(url.searchParams.get('js_code'),'fictional-code');
      assert.equal(options.redirect,'error');
      return {ok:true,json:async()=>({openid:'fictional_openid',session_key:'omit-this'})};
    },
    resolveStaff:async claims=>calls.push(['resolve',claims]),
    issueCredential:async claims=>{calls.push(['issue',claims]);return 'signed-fixture';}
  });
  assert.deepEqual(await session({code:'fictional-code'}),{credential:'signed-fixture'});
  const claims={issuer,subject:appId+':fictional_openid'};
  assert.deepEqual(calls,[['resolve',claims],['issue',claims]]);
  await assert.rejects(session({code:'fictional-code',role:'super_admin'}),x=>x.status===422);
});

test('expired WeChat codes and unbound staff never receive a credential',async()=>{
  let result={errcode:40029};
  const session=createWeChatStaffSession({...defaults,
    fetcher:async()=>({ok:true,json:async()=>result}),
    resolveStaff:async()=>{throw Object.assign(new Error('unbound'),{status:403});},
    issueCredential:async()=>assert.fail('must not issue')
  });
  await assert.rejects(session({code:'expired'}),x=>x.status===401);
  result={openid:'fictional_openid'};
  await assert.rejects(session({code:'valid_code'}),x=>x.status===403);
});

test('HTTP session rejects unbound staff and only returns a credential accepted by strict auth',async t=>{
  const {createApp}=await import('../../src/app.mjs');
  const {generateKeyPairSync,sign}=await import('node:crypto');
  const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  const key={...publicKey.export({format:'jwk'}),kid:'fictional',alg:'RS256'};
  const audience='fictional-sales';
  const secret='fictional-isolated-test-secret-0000';
  let bound=true;
  const directory={connect:async()=>({release(){},async query(sql,args){
    if(!args)return {rows:[]};
    assert.deepEqual(args,[issuer,appId+':fictional_openid']);
    return {rowCount:bound?1:0,rows:bound?[{staff_id:'staff',organization_id:'org',display_name:'虚构员工',role_codes:['sales_staff']}]:[]};
  }})};
  function issueCredential(claims){
    const format=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
    const iat=Math.floor(Date.now()/1000);
    const raw=format({alg:'RS256',kid:'fictional'})+'.'+format({iss:issuer,aud:audience,sub:claims.subject,iat,exp:iat+300});
    return raw+'.'+sign('RSA-SHA256',Buffer.from(raw),privateKey).toString('base64url');
  }
  const wechatStaff={...defaults,fetcher:async()=>({ok:true,json:async()=>({openid:'fictional_openid'})}),issueCredential};
  process.env.MS_STAGE='isolated-test';
  const forbiddenPool={connect(){assert.fail('broad pool must not be used');}};
  assert.throws(()=>createApp(forbiddenPool,{secret,wechatStaff}),/strict employee mode/);
  const make=async options=>{
    const server=createApp(forbiddenPool,{secret,...options});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    t.after(()=>new Promise(resolve=>server.close(resolve)));
    return 'http://127.0.0.1:'+server.address().port;
  };
  const post=base=>fetch(base+'/api/v1/mobile/wechat/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:'fictional-code'})});
  assert.equal((await post(await make({}))).status,404);
  const base=await make({strictStaffMode:true,externalIdentity:{issuer,audience,jwks:{keys:[key]}},
    identityDirectoryPool:directory,scopedReadPools:new Map(),scopedWritePools:new Map(),wechatStaff});
  const response=await post(base);
  assert.equal(response.status,200);
  assert.equal(response.headers.get('cache-control'),'no-store');
  const {data:{credential}}=await response.json();
  const me=()=>fetch(base+'/api/v1/me',{headers:{Authorization:'Bearer '+credential}});
  assert.equal((await me()).status,200);
  bound=false;
  assert.equal((await post(base)).status,403);
  assert.equal((await me()).status,403);
});
