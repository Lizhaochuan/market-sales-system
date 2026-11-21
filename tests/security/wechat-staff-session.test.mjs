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
