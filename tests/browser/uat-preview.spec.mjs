import {test,expect} from '@playwright/test';
import {generateKeyPairSync,createSign,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {createUatPreviewApi,assertUatPreviewPool} from '../../src/uat-preview-api.mjs';

const issuer='https://fictional-browser-uat.example.invalid';
const audience='isolated-browser-uat-preview';
const org='20000000-0000-4000-8000-000000000001';
const financeStaff='30000000-0000-4000-8000-000000000015';
const requester='20000000-0000-4000-8000-000000000011';
const reviewer='20000000-0000-4000-8000-000000000014';
const listen=s=>new Promise(r=>s.listen(0,'127.0.0.1',r));
const close=s=>new Promise(r=>s.close(r));

test('真实 Chromium：受限中文 UAT 页面显示待办及脱敏导出、跨机构拒绝',async({browser},info)=>{
 process.env.MS_STAGE='isolated-test';
 const owner=new pg.Pool({connectionString:process.env.DATABASE_URL,max:3});
 const restricted=new pg.Pool({connectionString:process.env.DATABASE_URL_UAT_PREVIEW_A,max:2});
 const finance=new pg.Pool({connectionString:process.env.DATABASE_URL_PLAN_FINANCE,max:2});
 const financeB=new pg.Pool({connectionString:process.env.DATABASE_URL_PLAN_B,max:2});
 const keys=generateKeyPairSync('rsa',{modulusLength:2048});
 const jwk={...keys.publicKey.export({format:'jwk'}),kid:'browser-uat-2026',alg:'RS256',use:'sig'};
 const externalIdentity={issuer,audience,jwks:{keys:[jwk]}};
 const subject='browser-uat-'+randomUUID();
 const jwt=(person=subject)=>{
  const now=Math.floor(Date.now()/1000);
  const header=Buffer.from(JSON.stringify({typ:'JWT',alg:'RS256',kid:jwk.kid})).toString('base64url');
  const claims=Buffer.from(JSON.stringify({iss:issuer,sub:person,aud:audience,iat:now,exp:now+900,
   role:'superadmin',org_id:'20000000-0000-4000-8000-000000000002'})).toString('base64url');
  return header+'.'+claims+'.'+createSign('RSA-SHA256').update(header+'.'+claims)
   .sign(keys.privateKey).toString('base64url');
 };
 let server,context;
 try{
  await assertUatPreviewPool(restricted);
  const sourceA=(await finance.query(
   'SELECT ms.propose_fixture_source_readiness($1,$2,$3,$4,$5,$6) AS id',
   ['finance','fictional_browser_uat','fictional_org_a',
    '本地 UAT 页面来源报告演练','虚构页面资料引用',randomUUID().replaceAll('-','')])).rows[0].id;
  const sourceB=(await financeB.query(
   'SELECT ms.propose_fixture_source_readiness($1,$2,$3,$4,$5,$6) AS id',
   ['finance','fictional_browser_uat_b','fictional_org_b',
    '另一机构不得访问 UAT 来源','虚构机构B资料引用',randomUUID().replaceAll('-','')])).rows[0].id;
  const approval=(await owner.query(
   "INSERT INTO ms.identity_change_requests(organization_id,action,target_staff_id,"+
   "issuer,subject,requested_by,request_evidence_ref,request_reason_zh) "+
   "VALUES($1,'bind',$2,$3,$4,$5,'虚构UAT身份材料','独立员工批准') RETURNING id",
   [org,financeStaff,issuer,subject,requester])).rows[0].id;
  await owner.query(
   "INSERT INTO ms.identity_change_decisions(request_id,reviewer_user_id,decision,"+
   "review_evidence_ref,reason_zh) VALUES($1,$2,'approved','虚构员工独立审核','受限只读身份校验')",
   [approval,reviewer]);
  await owner.query(
   "UPDATE ms.identity_change_requests SET status='approved',decided_by=$2,decided_at=now() WHERE id=$1",
   [approval,reviewer]);
  await owner.query(
   'INSERT INTO ms.staff_identity_bindings(staff_user_id,issuer,subject,bound_by,approval_request_id) '+
   'VALUES($1,$2,$3,$4,$5)',
   [financeStaff,issuer,subject,reviewer,approval]);
  server=createUatPreviewApi(restricted,{externalIdentity});
  await listen(server);
  const base='http://127.0.0.1:'+server.address().port;
  context=await browser.newContext({acceptDownloads:true,viewport:{width:1290,height:900}});
  const page=await context.newPage();
  await page.goto(base+'/uat');
  await expect(page.getByRole('heading',{name:'跨部门 UAT 待办报告'})).toBeVisible();
  await expect(page.getByText('真实联调暂未授权')).toBeVisible();
  await expect(page.locator('#workspace')).toBeHidden();
  const unauth=await page.request.get(base+'/api/v1/uat-preview/requests');
  expect(unauth.status()).toBe(401);
  await page.locator('#signed-token').fill(jwt('unapproved-'+randomUUID()));
  await page.getByRole('button',{name:'验证并查看待办'}).click();
  await expect(page.locator('#login-error')).toContainText('未绑定');
  await expect(page.locator('#workspace')).toBeHidden();

  await page.locator('#signed-token').fill(jwt());
  await page.getByRole('button',{name:'验证并查看待办'}).click();
  await expect(page.locator('#workspace')).toBeVisible();
  await expect(page.locator('#signed-token')).toHaveValue('');
  expect(await page.evaluate(()=>localStorage.length+sessionStorage.length)).toBe(0);
  await expect(page.locator('#request-choice')).toContainText(sourceA.slice(0,8));
  await expect(page.locator('#request-choice')).not.toContainText(sourceB.slice(0,8));
  await page.locator('#request-choice').selectOption(sourceA);
  await page.getByRole('button',{name:'查看待办报告'}).click();
  await expect(page.locator('#report-panel')).toBeVisible();
  await expect(page.locator('#task-rows tr')).toHaveCount(12);
  await expect(page.locator('#metric-total')).toHaveText('12');
  await expect(page.getByText('禁止联调',{exact:true})).toBeVisible();
  await expect(page.locator('#export-panel')).toBeVisible();
  await expect(page.locator('#markdown-preview')).toContainText('禁止真实联调');
  await expect(page.locator('#task-rows')).toContainText('财务');
  await expect(page.locator('#task-rows')).toContainText('信息安全');

  const blocked=await page.request.get(base+'/api/v1/uat-preview/reports/'+sourceB,{
   headers:{Authorization:'Bearer '+jwt()}
  });
  expect(blocked.status()).toBe(403);
  const noWrite=await page.request.post(base+'/api/v1/uat-preview/reports/'+sourceA,{
   headers:{Authorization:'Bearer '+jwt()},data:{execution_allowed:true}
  });
  expect(noWrite.status()).toBe(405);
  const [download]=await Promise.all([
   page.waitForEvent('download'),
   page.getByRole('button',{name:'导出本次脱敏 Markdown'}).click()
  ]);
  expect(download.suggestedFilename()).toBe('uat-blockers-'+sourceA+'.md');
  const markdown=await readFile(await download.path(),'utf8');
  expect(markdown).toContain('禁止真实联调');
  expect(markdown).toContain('财务');
  expect(markdown).not.toContain(subject);
  expect(markdown).not.toContain('AUTH_HMAC_SECRET');
  await page.setViewportSize({width:390,height:844});
  await expect(page.getByRole('heading',{name:'跨部门 UAT 待办报告'})).toBeVisible();
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await info.attach('chinese-uat-preview-mobile',{
   body:await page.screenshot({fullPage:true}),contentType:'image/png'
  });
  await page.getByRole('button',{name:'清除身份并退出'}).click();
  await expect(page.locator('#workspace')).toBeHidden();
  await expect(page.locator('#markdown-preview')).toHaveText('');
  expect(await page.evaluate(()=>localStorage.length+sessionStorage.length)).toBe(0);
 }finally{
  if(context)await context.close();
  if(server?.listening)await close(server);
  await Promise.all([owner.end(),restricted.end(),finance.end(),financeB.end()]);
 }
});
