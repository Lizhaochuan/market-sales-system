import {test,expect} from '@playwright/test';
import {createSign,generateKeyPairSync,randomUUID} from 'node:crypto';
import pg from 'pg';
import {createApp} from '../../src/app.mjs';

const org='20000000-0000-4000-8000-000000000001';
const A='20000000-0000-4000-8000-000000000011';
const M='20000000-0000-4000-8000-000000000013';
const M2='20000000-0000-4000-8000-000000000014';
const issuer='https://fictional-m01-browser-approval.example.invalid';
const audience='m01-browser-approved-channel-maintenance';
const signingSecret='fictional-test-only-strong-token-secret-9c92789dc3b9';

test('M01 Chinese strict workbench: employee request, independent manager approval, channel history and logout',async({browser},testInfo)=>{
 test.setTimeout(90000);
 process.env.MS_STAGE='isolated-test';
 const admin=new pg.Pool({connectionString:process.env.DATABASE_URL,max:4});
 const directory=new pg.Pool({connectionString:process.env.DATABASE_URL_AUTH_DIRECTORY,max:2});
 const readA=new pg.Pool({connectionString:process.env.DATABASE_URL_ASSIGNEE_A,max:2});
 const readM=new pg.Pool({connectionString:process.env.DATABASE_URL_ASSIGNEE_MANAGER,max:2});
 const writeA=new pg.Pool({connectionString:process.env.DATABASE_URL_WRITE_A,max:2});
 const writeM=new pg.Pool({connectionString:process.env.DATABASE_URL_WRITE_MANAGER,max:2});
 const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
 const jwk={...publicKey.export({format:'jwk'}),kid:'m01-channels-'+randomUUID(),alg:'RS256',use:'sig'};
 const subjects=new Map([[A,'m01-browser-a-'+randomUUID()],[M,'m01-browser-manager-'+randomUUID()]]);
 const identity={issuer,audience,jwks:{keys:[jwk]}};
 const sign=staff=>{
  const now=Math.floor(Date.now()/1000);
  const h=Buffer.from(JSON.stringify({typ:'JWT',alg:'RS256',kid:jwk.kid})).toString('base64url');
  const payload=Buffer.from(JSON.stringify({iss:issuer,aud:audience,
   sub:subjects.get(staff),iat:now,exp:now+900,
   role:'super_admin',staff_id:M2,
   org_id:'20000000-0000-4000-8000-000000000002'})).toString('base64url');
  return h+'.'+payload+'.'+createSign('RSA-SHA256').update(h+'.'+payload)
   .sign(privateKey).toString('base64url');
 };
 async function approved(target,reviewer){
  const q=await admin.query(
   "INSERT INTO ms.identity_change_requests(organization_id,action,target_staff_id,"+
   "issuer,subject,requested_by,request_evidence_ref,request_reason_zh) "+
   "VALUES($1,'bind',$2,$3,$4,$5,'本机员工测试资料','独立主管核验') RETURNING id",
   [org,target,issuer,subjects.get(target),target===M?A:reviewer]);
  await admin.query(
   "INSERT INTO ms.identity_change_decisions(request_id,reviewer_user_id,decision,"+
   "review_evidence_ref,reason_zh) VALUES($1,$2,'approved','独立核实凭据','虚构员工核验')",
   [q.rows[0].id,M2]);
  await admin.query(
   "UPDATE ms.identity_change_requests SET status='approved',decided_by=$2,decided_at=now() WHERE id=$1",
   [q.rows[0].id,M2]);
  await admin.query(
   "INSERT INTO ms.staff_identity_bindings(staff_user_id,issuer,subject,bound_by,approval_request_id) "+
   "VALUES($1,$2,$3,$4,$5)",
   [target,issuer,subjects.get(target),M2,q.rows[0].id]);
 }
 let app,staffPage,managerPage,createdId;
 const name='隔离界面渠道-'+randomUUID();
 const changedName=name+'-改名';
 const login=async(staff)=>{
  const page=await browser.newPage();
  await page.goto('http://127.0.0.1:'+app.address().port+'/');
  await page.locator('#external-login-form input[name="signed_token"]').fill(sign(staff));
  await page.getByRole('button',{name:'验证员工身份并进入'}).click();
  await expect(page.locator('#page-title')).toHaveText('工作概览');
  await page.getByRole('button',{name:'获客渠道'}).click();
  await expect(page.locator('#channel-maintenance-workbench')).toBeVisible();
  await expect(page.locator('#channel-request-form')).toBeVisible();
  await expect(page.locator('#channel-requests-status')).toContainText('只显示本人');
  return page;
 };
 const reviewRequest=async(page,matchName)=>{
  await page.getByRole('button',{name:'刷新数据'}).click();
  const select=page.locator('#channel-review-choice');
  const opt=select.locator('option').filter({hasText:matchName}).first();
  await expect(opt).toBeAttached();
  const value=await opt.getAttribute('value');
  await select.selectOption(value);
  await page.locator('#channel-review-form select[name="decision"]').selectOption('approved');
  await page.locator('#channel-review-form input[name="evidence_ref"]').fill('独立虚构审批凭据');
  await page.locator('#channel-review-form textarea[name="reason_zh"]').fill('已复核当前机构渠道状态，批准执行');
  await page.locator('#channel-review-form button[type="submit"]').click();
  await expect(page.locator('#toast')).toContainText('独立主管已批准');
 };
 try{
  await approved(A,M);
  await approved(M,M2);
  app=createApp({connect(){throw Error('strict UI may not use the broad database connection');}},{
   secret:signingSecret,externalIdentity:identity,strictStaffMode:true,
   identityDirectoryPool:directory,
   scopedReadPools:new Map([[A,readA],[M,readM]]),
   scopedWritePools:new Map([[A,writeA],[M,writeM]])
  });
  await new Promise(ok=>app.listen(0,'127.0.0.1',ok));
  staffPage=await login(A);
  await expect(staffPage.locator('#channel-review-card')).toBeHidden();
  await staffPage.locator('#channel-request-form input[name="name"]').fill(name);
  await staffPage.locator('#channel-request-form input[name="channel_type"]').fill('online');
  await staffPage.locator('#channel-request-form input[name="evidence_ref"]').fill('虚构渠道调研编号');
  await staffPage.locator('#channel-request-form textarea[name="reason_zh"]').fill('申请创建虚构渠道');
  await staffPage.getByRole('button',{name:'提交渠道维护申请'}).click();
  await expect(staffPage.locator('#toast')).toContainText('尚未修改渠道');
  await expect(staffPage.locator('#channel-requests-list')).toContainText(name);
  await expect(staffPage.locator('#channel-audit-list')).toContainText('提交渠道变更申请');
  await expect(staffPage.locator('#channel-audit-list')).not.toContainText('审计原文');
  {
   const count=await admin.query('SELECT count(*)::int n FROM ms.marketing_channels WHERE name=$1',[name]);
   expect(count.rows[0].n).toBe(0);
  }
  managerPage=await login(M);
  await expect(managerPage.locator('#channel-review-card')).toBeVisible();
  await expect(managerPage.locator('#channel-requests-list')).toContainText(name);
  await expect(managerPage.locator('#channel-audit-list')).toContainText('提交渠道变更申请');
  await reviewRequest(managerPage,name);
  await staffPage.getByRole('button',{name:'刷新数据'}).click();
  await expect(staffPage.locator('#channels-list')).toContainText(name);
  await expect(staffPage.locator('#channel-requests-list')).toContainText('审批通过');
  await expect(staffPage.locator('#channel-audit-list')).toContainText('独立主管批准并执行');
  await managerPage.getByRole('button',{name:'刷新数据'}).click();
  await expect(managerPage.locator('#channel-audit-list')).toContainText('独立主管批准并执行');
  createdId=(await admin.query('SELECT id FROM ms.marketing_channels WHERE name=$1',[name])).rows[0]?.id;
  expect(createdId).toBeTruthy();

  // Same user cannot self-approve; no direct SQL write or unsafe HTML injection.
  await staffPage.locator('#channel-request-form select[name="action"]').selectOption('edit');
  await staffPage.locator('#channel-target-choice').selectOption(createdId);
  await staffPage.locator('#channel-request-form input[name="name"]').fill(changedName);
  await staffPage.locator('#channel-request-form input[name="channel_type"]').fill('referral');
  await staffPage.locator('#channel-request-form input[name="evidence_ref"]').fill('虚构更名依据');
  await staffPage.locator('#channel-request-form textarea[name="reason_zh"]').fill('申请独立审批修改渠道名称');
  await staffPage.getByRole('button',{name:'提交渠道维护申请'}).click();
  await expect(staffPage.locator('#toast')).toContainText('等待独立主管');
  expect((await admin.query('SELECT name FROM ms.marketing_channels WHERE id=$1',[createdId]))
   .rows[0].name).toBe(name);
  await reviewRequest(managerPage,changedName);
  await staffPage.getByRole('button',{name:'刷新数据'}).click();
  await expect(staffPage.locator('#channels-list')).toContainText(changedName);
  await staffPage.locator('#channel-request-form select[name="action"]').selectOption('deactivate');
  await staffPage.locator('#channel-target-choice').selectOption(createdId);
  await staffPage.locator('#channel-request-form input[name="evidence_ref"]').fill('模拟停用记录');
  await staffPage.locator('#channel-request-form textarea[name="reason_zh"]').fill('虚构渠道停用审批');
  await staffPage.getByRole('button',{name:'提交渠道维护申请'}).click();
  await expect(staffPage.locator('#toast')).toContainText('尚未修改渠道');
  expect((await admin.query('SELECT status FROM ms.marketing_channels WHERE id=$1',[createdId]))
   .rows[0].status).toBe('active');
  await reviewRequest(managerPage,changedName);
  expect((await admin.query('SELECT status FROM ms.marketing_channels WHERE id=$1',[createdId]))
   .rows[0].status).toBe('inactive');
  await staffPage.getByRole('button',{name:'刷新数据'}).click();
  await expect(staffPage.locator('#channels-list')).toContainText('本渠道已停用');
  // Audit failure must discard previously rendered events, hide both write
  // actions and never recycle old authorization until a healthy refresh.
  await staffPage.route('**/api/v1/marketing-channels/change-requests/audit-history',
   route=>route.fulfill({status:500,contentType:'application/json',
    body:JSON.stringify({code:'INTERNAL_ERROR',message:'虚构审计投影故障'})}));
  await staffPage.getByRole('button',{name:'刷新数据'}).click();
  await expect(staffPage.locator('#channel-audit-list')).toBeEmpty();
  await expect(staffPage.locator('#channel-audit-status')).toContainText('已清空旧记录');
  await expect(staffPage.locator('#channel-request-card')).toBeHidden();
  await staffPage.unroute('**/api/v1/marketing-channels/change-requests/audit-history');
  await staffPage.getByRole('button',{name:'刷新数据'}).click();
  await expect(staffPage.locator('#channel-audit-list')).toContainText('独立主管批准并执行');
  await expect(staffPage.locator('#channel-request-card')).toBeVisible();

  await testInfo.attach('m01-approval-workbench',{
   body:await staffPage.screenshot({fullPage:true}),contentType:'image/png'});
  await staffPage.getByRole('button',{name:'退出演示账号'}).click();
  await expect(staffPage.locator('#workspace')).toBeHidden();
  await expect(staffPage.locator('#channel-requests-list')).toBeEmpty();
  await expect(staffPage.locator('#channel-audit-list')).toBeEmpty();
  await expect(staffPage.locator('#channel-review-choice')).toBeEmpty();
  expect(await staffPage.evaluate(()=>localStorage.length)).toBe(0);
 }finally{
  await Promise.allSettled([staffPage,managerPage].filter(Boolean).map(x=>x.close()));
  if(app?.listening)await new Promise(ok=>app.close(ok));
  // Fixture never touches live records; delete ephemeral own test channel only.
  if(createdId){
   await admin.query('DELETE FROM ms.isolated_channel_change_requests WHERE channel_id=$1 OR result_channel_id=$1',[createdId]);
   await admin.query('DELETE FROM ms.marketing_channels WHERE id=$1',[createdId]);
  }
  await Promise.allSettled([admin,directory,readA,readM,writeA,writeM].map(x=>x.end()));
 }
});