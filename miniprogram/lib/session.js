// This client is confined to the repository's loopback, fictional-data service.
const loginConfig = require('./login-config');
const ROOT = '/api/v1/isolated-workspace/workflow';
const ORIGIN = 'http://127.0.0.1:33105';
const wechatEnabled = loginConfig.mode === 'wechat';
function origin() {
  if (!wechatEnabled) return ORIGIN;
  const value = loginConfig.staffOrigin;
  if (typeof value !== 'string' || !/^https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::[0-9]{1,5})?$/i.test(value))
    throw new Error('微信员工登录需要配置 HTTPS 测试服务');
  return value;
}
let token = '';
let identity = null;
let staffSession = false;
let epoch = 0;
const scrubbers = new Set();

function reset() {
  epoch += 1;
  token = '';
  identity = null;
  staffSession = false;
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
      url: origin() + path, method: body === undefined ? 'GET' : 'POST', data: body, header, timeout: 12000,
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
  if (wechatEnabled) throw new Error('当前版本使用微信员工登录');
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
// Accept a short-lived signed credential from the isolated test harness or a future approved identity provider.
async function startStaffSession(credential) {
  reset();
  const ticket = epoch;
  if (typeof credential !== 'string' || !credential) throw new Error('缺少员工凭据');
  token = credential;
  try {
    const employee = await request('/api/v1/me');
    if (ticket !== epoch) throw Object.assign(new Error('会话已变更'), {stale: true});
    if (employee?.capabilities?.strict_employee_mode !== true) throw new Error('该服务未启用严格员工认证');
    staffSession = true;
    identity = employee;
    return employee;
  } catch (error) {
    if (ticket === epoch) reset();
    throw error;
  }
}
async function loginWithWeChat() {
  if (!wechatEnabled) throw new Error('微信员工登录未启用');
  origin();
  reset();
  const ticket = epoch;
  const code = await new Promise((resolve,reject) => wx.login({
    success(result) {
      if (typeof result.code === 'string' && result.code) resolve(result.code);
      else reject(new Error('微信未返回登录凭证，请重试'));
    },
    fail() { reject(new Error('微信员工登录失败，请重试')); },
  }));
  const stale = () => Object.assign(new Error('会话已变更'), {stale:true});
  if (ticket !== epoch) throw stale();
  const {credential} = await request('/api/v1/mobile/wechat/session', {body:{code},anonymous:true});
  if (ticket !== epoch) throw stale();
  return startStaffSession(credential);
}
function readStaffTasks() {
  if (!staffSession) return Promise.reject(new Error('需要严格员工会话'));
  return request('/api/v1/mobile/tasks');
}
function read(path = '', query) {
  if (staffSession) return Promise.reject(new Error('员工会话目前仅支持查看待办'));
  return request(ROOT + path + encode(query));
}
function newKey() {
  return 'mini-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) + '-' + Math.random().toString(36).slice(2);
}
function mutation(path, payload, staffAction = false) {
  const ticket = epoch;
  const body = JSON.parse(JSON.stringify(payload));
  const key = newKey();
  return () => {
    if (ticket !== epoch) return Promise.reject(Object.assign(new Error('会话已变更'), {stale: true}));
    if (staffAction !== staffSession) return Promise.reject(new Error('当前员工会话不支持此操作'));
    return request((staffAction ? '/api/v1/mobile/actions' : ROOT) + path, {body, key});
  };
}
module.exports = {login, loginWithWeChat, wechatEnabled, startStaffSession, readStaffTasks, isStaffSession: () => staffSession, logout, read, mutation, observeReset, identity: () => identity};
