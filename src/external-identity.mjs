// External OIDC access-token VERIFICATION ADAPTER, not an OIDC login service.
// Requires issuer, audience and a trusted key set configured out-of-band.
// Does not auto-provision employees or grant roles from identity token claims.
import { createPublicKey, verify as rsaVerify } from 'node:crypto';
import { fail } from './auth.mjs';

const b64url=/^[A-Za-z0-9_-]+$/;
function parsePart(raw,label){
  if(typeof raw!=='string'||!raw.length||!b64url.test(raw))fail(401,'AUTH_REQUIRED','外部身份凭据无效');
  try {
    const obj=JSON.parse(Buffer.from(raw,'base64url').toString('utf8'));
    if(!obj||typeof obj!=='object'||Array.isArray(obj))throw Error(label);
    return obj;
  }catch{fail(401,'AUTH_REQUIRED','外部身份凭据无效');}
}
export function createExternalTokenVerifier({issuer,audience,jwks}={}) {
  if(typeof issuer!=='string'||!issuer.startsWith('https://')||
     typeof audience!=='string'||!audience||
     !jwks||!Array.isArray(jwks.keys)||!jwks.keys.length)
    throw new Error('OIDC issuer, audience and trusted public JWKS are required');
  const keys=new Map();
  for(const jwk of jwks.keys){
    if(!jwk||jwk.kty!=='RSA'||jwk.alg&&jwk.alg!=='RS256'||
      typeof jwk.kid!=='string'||!jwk.kid||
      jwk.d||jwk.p||jwk.q||jwk.dp||jwk.dq||jwk.qi||
      jwk.use&&jwk.use!=='sig'||keys.has(jwk.kid))
      throw new Error('Invalid or duplicate trusted OIDC signing key');
    const pub=createPublicKey({key:jwk,format:'jwk'});
    if(pub.asymmetricKeyType!=='rsa'||(pub.asymmetricKeyDetails?.modulusLength||0)<2048)
      throw new Error('OIDC RS256 key must be RSA 2048 bits or stronger');
    keys.set(jwk.kid,pub);
  }
  return function verifyExternalToken(token){
    if(typeof token!=='string'||token.length>8192)fail(401,'AUTH_REQUIRED','外部身份凭据无效');
    const fields=token.split('.');
    if(fields.length!==3)fail(401,'AUTH_REQUIRED','外部身份凭据无效');
    const [h,p,s]=fields,header=parsePart(h,'header');
    if(header.alg!=='RS256'||header.typ&&header.typ!=='JWT'||
       !keys.has(header.kid)||typeof s!=='string'||!b64url.test(s))
      fail(401,'AUTH_REQUIRED','外部身份签名不受信任');
    const pub=keys.get(header.kid);
    if(!rsaVerify('RSA-SHA256',Buffer.from(h+'.'+p),pub,Buffer.from(s,'base64url')))
      fail(401,'AUTH_REQUIRED','外部身份签名无效');
    const claims=parsePart(p,'payload'),now=Math.floor(Date.now()/1000);
    const hasAudience=claims.aud===audience||
      Array.isArray(claims.aud)&&claims.aud.includes(audience);
    if(claims.iss!==issuer||!hasAudience||
      typeof claims.sub!=='string'||!claims.sub.trim()||claims.sub.length>255||
      !Number.isInteger(claims.exp)||!Number.isInteger(claims.iat)||
      claims.iat>now+60||claims.exp<=now||claims.exp-claims.iat>3600||
      claims.exp<claims.iat||
      claims.nbf!==undefined&&(!Number.isInteger(claims.nbf)||claims.nbf>now))
      fail(401,'AUTH_REQUIRED','外部身份发行方、权限或有效期不符合要求');
    return {issuer,subject:claims.sub};
  };
}
export async function resolveExternalStaff(c,{issuer,subject}){
  const r=await c.query(
    'SELECT u.id,u.organization_id FROM ms.staff_identity_bindings b '+
    'JOIN ms.staff_users u ON u.id=b.staff_user_id '+
    'WHERE b.issuer=$1 AND b.subject=$2 AND b.revoked_at IS NULL '+
    "AND u.status='active'",[issuer,subject]);
  if(r.rowCount!==1)fail(403,'FORBIDDEN','当前外部身份未获机构员工授权');
  return {staffId:r.rows[0].id,orgId:r.rows[0].organization_id,authMethod:'external-oidc'};
}
