// This client is confined to the repository's loopback, fictional-data service.
const ROOT = '/api/v1/isolated-workspace/workflow';
const ORIGIN = 'http://127.0.0.1:33105';
let token = '';
let identity = null;
let epoch = 0;
const scrubbers = new Set();

function reset() {
  epoch += 1;
  token = '';
  identity = null;
  for (const scrub of scrubbers) scrub();
}
function observeReset(scrub) {
  scrubbers.add(scrub);
  return () => scrubbers.delete(scrub);
}
function logout() {
  reset();
  wx.reLaunch({url: '/pages/login/index'});
}
function expired() {
  logout();
  return Object.assign(new Error('会话或权限已变化，请重新登录'), {status: 403});
}
function encode(values) {
  const terms = Object.entries(values || {}).filter(([, value]) => value !== '' && value != null);
  return terms.length ? '?' + terms.map(([key, value]) => encodeURIComponent(key) + '=' + encodeURIComponent(value)).join('&') : '';
}
function request(path, {body, key, anonymous = false} = {}) {
  const ticket = epoch;
  return new Promise((resolve, reject) => {
    if (!anonymous && !token) return reject(expired());
    const header = {'content-type': 'application/json'};
    if (!anonymous) header.Authorization = 'Bearer ' + token;
    if (key) header['Idempotency-Key'] = key;
    function current() {
      if (ticket === epoch) return true;
      reject(Object.assign(new Error('会话已变更'), {stale: true}));
      return false;
    }
    wx.request({
      url: ORIGIN + path, method: body === undefined ? 'GET' : 'POST', data: body, header, timeout: 12000,
      success(response) {
        if (!current()) return;
        if (!anonymous && [401, 403].includes(response.statusCode)) return reject(expired());
        if (response.statusCode === 200 && response.data && response.data.code === 'OK') return resolve(response.data.data);
        reject(Object.assign(new Error(response.data?.message || '操作未完成'), {
          status: response.statusCode, code: response.data?.code, retryable: response.statusCode >= 500,
        }));
      },
      fail() {
        if (current()) reject(Object.assign(new Error('网络中断，请重试同一次提交'), {retryable: true}));
      },
    });
  });
}
async function login(account, passphrase) {
  reset();
  const ticket = epoch;
  const session = await request('/api/v1/dev/login', {body: {account_code: account, passphrase}, anonymous: true});
  if (ticket !== epoch) throw Object.assign(new Error('会话已变更'), {stale: true});
  if (session.stage !== 'isolated-test' || typeof session.token !== 'string') throw new Error('仅支持隔离演示服务');
  token = session.token;
  identity = await request('/api/v1/me');
  if (ticket !== epoch) throw Object.assign(new Error('会话已变更'), {stale: true});
  return identity;
}
function read(path = '', query) {
  return request(ROOT + path + encode(query));
}
function newKey() {
  return 'mini-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) + '-' + Math.random().toString(36).slice(2);
}
function mutation(path, payload) {
  const ticket = epoch;
  const body = JSON.parse(JSON.stringify(payload));
  const key = newKey();
  return () => {
    if (ticket !== epoch) return Promise.reject(Object.assign(new Error('会话已变更'), {stale: true}));
    return request(ROOT + path, {body, key});
  };
}
module.exports = {login, logout, read, mutation, observeReset, identity: () => identity};
