// This module only supplies a local fictional-data demo login.
// It is deliberately NOT a production identity provider.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { fail } from './auth.mjs';

const validDemoSecret = expected => typeof expected==='string' &&
  (expected.length>=32 || expected==='0' && process.env.MS_STAGE==='isolated-test');

export function demoSecretMatches(input, expected) {
  if(!validDemoSecret(expected)) return false;
  if(typeof input!=='string'||input.length>1024) return false;
  const candidate=createHmac('sha256',expected).update(input).digest();
  const correct=createHmac('sha256',expected).update(expected).digest();
  return timingSafeEqual(candidate,correct);
}
export function demoToken(user,secret,issuer) {
  const now=Math.floor(Date.now()/1000);
  const header=Buffer.from(JSON.stringify({typ:'JWT',alg:'HS256'})).toString('base64url');
  const payload=Buffer.from(JSON.stringify({
    sub:user.id,org_id:user.organization_id,iss:issuer,
    aud:'market-sales-isolated',iat:now,exp:now+1800
  })).toString('base64url');
  const sig=createHmac('sha256',secret).update(header+'.'+payload).digest('base64url');
  return header+'.'+payload+'.'+sig;
}
export async function demoLogin(c,body,{secret,issuer,devLoginSecret}) {
  if(!validDemoSecret(devLoginSecret))
    fail(404,'NOT_FOUND','演示登录未启用');
  if(!body||typeof body!=='object'||Array.isArray(body)||
    !['sales-a','sales-b','supervisor','supervisor-2','finance','market-a','market-b','market-manager','general-admin'].includes(body.account_code)||
    !demoSecretMatches(body.passphrase,devLoginSecret))
    fail(401,'AUTH_REQUIRED','演示账号或访问口令不正确');
  // The demo prefix ensures this endpoint cannot authenticate real staff.
  const r=await c.query(
    "SELECT id,organization_id,display_name,status FROM ms.staff_users "+
    "WHERE external_identity_ref=$1 AND status='active'",
    ['demo:'+body.account_code]);
  if(r.rowCount!==1)fail(401,'AUTH_REQUIRED','演示账号未初始化');
  return {
    token:demoToken(r.rows[0],secret,issuer),
    display_name:r.rows[0].display_name,
    role_label:body.account_code==='general-admin'?'总管理者':body.account_code==='market-manager'?'市场主管':body.account_code.startsWith('market-')?'市场人员':body.account_code.startsWith('supervisor')?'主管':body.account_code==='finance'?'收款核实员':'销售顾问',
    account_code:body.account_code,
    expires_in_seconds:1800,
    stage:'isolated-test'
  };
}

