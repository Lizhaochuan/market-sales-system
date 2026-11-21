import {fail} from './auth.mjs';

const endpoint = 'https://api.weixin.qq.com/sns/jscode2session';

// Resolve the subject through WeChat, then require an approved directory binding
// before issuing the same short-lived credential used by strict staff routes.
export function createWeChatStaffSession({appId, appSecret, issuer, resolveStaff, issueCredential, fetcher = fetch}) {
  if (!/^wx[0-9a-f]{16}$/i.test(appId ?? '') || typeof appSecret !== 'string' || !appSecret ||
    !issuer?.startsWith('https://') || typeof resolveStaff !== 'function' || typeof issueCredential !== 'function') {
    throw new Error('WeChat staff session requires app configuration and trusted identity adapters');
  }
  return async body => {
    if (!body || typeof body !== 'object' || Object.keys(body).length !== 1 ||
      typeof body.code !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(body.code)) {
      fail(422, 'VALIDATION_ERROR', '请提供有效的微信登录凭证');
    }
    const url = new URL(endpoint);
    url.search = new URLSearchParams({appid:appId, secret:appSecret, js_code:body.code, grant_type:'authorization_code'});
    let result;
    try {
      const response = await fetcher(url, {redirect:'error',signal:AbortSignal.timeout(5000)});
      if (!response.ok) throw new Error('upstream unavailable');
      result = await response.json();
    } catch {
      fail(502, 'WECHAT_UNAVAILABLE', '微信身份服务暂不可用，请重试');
    }
    if (!result || (result.errcode !== undefined && result.errcode !== 0) ||
      typeof result.openid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(result.openid)) {
      fail(401, 'AUTH_REQUIRED', '微信登录凭证已失效或无法验证');
    }
    const claims = {issuer,subject:appId+':'+result.openid};
    await resolveStaff(claims);
    return {credential:await issueCredential(claims)};
  };
}
