import {test,expect} from '@playwright/test';
import pg from 'pg';
import {createSign,generateKeyPairSync,randomUUID} from 'node:crypto';
import {createApp} from '../../src/app.mjs';

const org='20000000-0000-4000-8000-000000000001';
const ids={
 A:'20000000-0000-4000-8000-000000000011',
 B:'20000000-0000-4000-8000-000000000012',
 M:'20000000-0000-4000-8000-000000000013'
};
const reviewer='20000000-0000-4000-8000-000000000014';
const issuer='https://fictional-browser-contact-custody.example.invalid';
const audience='isolated-custody-chinese-workbench';
const open=s=>new Promise(ok=>s.listen(0,'127.0.0.1',ok));
const close=s=>new Promise(ok=>s.close(ok));

test('真实 Chromium：A→B 独立交接、B 申请撤回、主管复核、管理权恢复 A',async({browser},testInfo)=>{
 process.env.MS_STAGE='isolated-test';
 const owner=new pg.Pool({connectionString:process.env.DATABASE_URL,max:4});
 const directory=new pg.Pool({connectionString:process.env.DATABASE_URL_AUTH_DIRECTORY,max:3});
 const urls={
  readA:process.env.DATABASE_URL_ASSIGNEE_A,readB:process.env.DATABASE_URL_ASSIGNEE_B,
  readM:process.env.DATABASE_URL_ASSIGNEE_MANAGER,
  writeA:process.env.DATABASE_URL_WRITE_A,writeB:process.env.DATABASE_URL_WRITE_B,
  writeM:process.env.DATABASE_URL_WRITE_MANAGER
 };
 const pools=Object.fromEntries(Object.entries(urls)
  .map(([k,v])=>[k,new pg.Pool({connectionString:v,max:3})]));
 const kp=generateKeyPairSync('rsa',{modulusLength:2048});
 const jwk={...kp.publicKey.export({format:'jwk'}),kid:'custody-browser-test',alg:'RS256',use:'sig'};
 const subs={A:'browser-custody-a-'+randomUUID(),
  B:'browser-custody-b-'+randomUUID(),M:'browser-custody-m-'+randomUUID()};
 let broadCalls=0;
 const app=createApp({connect(){broadCalls++;throw Error('broad SQL is forbidden');}},{
  secret:'browser-custody-test-secret-strong-enough-for-isolated',
  strictStaffMode:true,identityDirectoryPool:directory,
  externalIdentity:{issuer,audience,jwks:{keys:[jwk]}},
  scopedReadPools:new Map([[ids.A,pools.readA],[ids.B,pools.readB],[ids.M,pools.readM]]),
  scopedWritePools:new Map([[ids.A,pools.writeA],[ids.B,pools.writeB],[ids.M,pools.writeM]])
 });
 const pages={};
 function sign(who){
  const n=Math.floor(Date.now()/1000);
  const h=Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT',kid:jwk.kid})).toString('base64url');
  const p=Buffer.from(JSON.stringify({iss:issuer,aud:audience,sub:subs[who],iat:n,
   exp:n+900,role:'super_admin',
   org_id:'20000000-0000-4000-8000-000000000002'})).toString('base64url');
  return h+'.'+p+'.'+createSign('RSA-SHA256').update(h+'.'+p)
   .sign(kp.privateKey).toString('base64url');
 }
 async function bind(who){
  const requester=who==='M'?ids.A:ids.M;
  const q=await owner.query(
   "INSERT INTO ms.identity_change_requests(organization_id,action,target_staff_id,"+
   "issuer,subject,requested_by,request_evidence_ref,request_reason_zh) "+
   "VALUES($1,'bind',$2,$3,$4,$5,'虚构员工身份证明','双人审核虚构身份') RETURNING id",
   [org,ids[who],issuer,subs[who],requester]);
  await owner.query(
   "INSERT INTO ms.identity_change_decisions(request_id,reviewer_user_id,decision,"+
   "review_evidence_ref,reason_zh) VALUES($1,$2,'approved','双主管虚构证明','测试独立核实')",
   [q.rows[0].id,reviewer]);
  await owner.query(
   "UPDATE ms.identity_change_requests SET status='approved',decided_by=$2,decided_at=now() WHERE id=$1",
   [q.rows[0].id,reviewer]);
  await owner.query(
   "INSERT INTO ms.staff_identity_bindings(staff_user_id,issuer,subject,bound_by,approval_request_id) "+
   "VALUES($1,$2,$3,$4,$5)",[ids[who],issuer,subs[who],reviewer,q.rows[0].id]);
 }
 async function login(who){
  const page=await browser.newPage();
  pages[who]=page;
  await page.goto('http://127.0.0.1:'+app.address().port+'/');
  await page.locator('#external-login-form input[name="signed_token"]').fill(sign(who));
  await page.getByRole('button',{name:'验证员工身份并进入'}).click();
  await expect(page.locator('#workspace')).toBeVisible();
  await page.locator('button[data-view="contacts"]').click();
  await expect(page.locator('#contact-custody-workbench')).toBeVisible();
  expect(await page.evaluate(()=>localStorage.length)).toBe(0);
  return page;
 }
 const name='独立交接联系人的虚构家长-'+randomUUID();
 try{
  await bind('A');await bind('B');await bind('M');
  await open(app);
  const a=await login('A');
  await a.locator('#contact-form input[name="display_name"]').fill(name);
  await a.getByRole('button',{name:'保存联系人'}).click();
  await expect(a.locator('#contacts-list')).toContainText(name);
  const contact=(await owner.query(
   'SELECT id,created_by FROM ms.contacts WHERE display_name=$1',[name])).rows[0];
  expect(contact.created_by).toBe(ids.A);

  const b=await login('B');
  await expect(b.locator('#contacts-list')).not.toContainText(name);
  const body=a.locator('#custody-request-form');
  await body.locator('select[name="contact_id"]').selectOption({label:name});
  await body.locator('select[name="target_staff_id"]').selectOption({
    label:'模拟销售顾问 B'
  });
  await body.locator('textarea[name="reason_zh"]')
   .fill('测试联系人由销售A交给销售B负责，先待独立审核');
  await body.locator('input[name="evidence_ref"]')
   .fill('虚构家长确认转交记录，不含个人证明');
  await body.getByRole('button',{name:'提交联系人交接申请'}).click();
  await expect(a.locator('#custody-requests-list')).toContainText(name);
  await expect(a.locator('#custody-requests-list')).toContainText('待核实');
  await b.getByRole('button',{name:'刷新数据'}).click();
  await expect(b.locator('#contacts-list')).not.toContainText(name);

  const m=await login('M');
  await expect(m.locator('#custody-decision-card')).toBeVisible();
  await expect(m.locator('#custody-requests-list')).toContainText(name);
  const approvalChoice=m.locator('#custody-decision-form select[name="request_id"]');
  const approvalId=await approvalChoice.locator('option').filter({hasText:name}).first().getAttribute('value');
  expect(approvalId).toBeTruthy();
  await approvalChoice.selectOption(approvalId);
  await m.locator('#custody-decision-form textarea[name="reason_zh"]')
   .fill('独立主管核实当前联系人管理人和接收员工后批准');
  await m.locator('#custody-decision-form input[name="evidence_ref"]')
   .fill('虚构独立审核材料说明');
  await m.getByRole('button',{name:'保存联系人交接审核'}).click();
  await expect.poll(async()=>(
    await owner.query('SELECT assignee_id FROM ms.contact_custody_assignments WHERE contact_id=$1 AND revoked_at IS NULL',[contact.id])
  ).rows[0]?.assignee_id).toBe(ids.B);
  await b.getByRole('button',{name:'刷新数据'}).click();
  await expect(b.locator('#contacts-list')).toContainText(name);
  const rows=await owner.query(
   'SELECT c.created_by,a.assignee_id FROM ms.contacts c '+
   'JOIN ms.contact_custody_assignments a ON a.contact_id=c.id '+
   'WHERE c.id=$1 AND a.revoked_at IS NULL',[contact.id]);
  expect(rows.rowCount).toBe(1);
  expect(rows.rows[0].created_by).toBe(ids.A);
  expect(rows.rows[0].assignee_id).toBe(ids.B);
  expect(broadCalls).toBe(0);
  // V3.2-16: the recipient initiates a withdrawal; M independently reviews.
  const requestReview=b.locator('#custody-review-request-form');
  await requestReview.locator('select[name="assignment_id"]').selectOption({label:name});
  await requestReview.locator('select[name="kind"]').selectOption('withdrawal');
  await requestReview.locator('textarea[name="reason_zh"]')
   .fill('客户要求撤回当前管理权，等待独立审核');
  await requestReview.locator('input[name="evidence_ref"]')
   .fill('虚构客户撤回要求与独立复核依据');
  await requestReview.getByRole('button',{name:'提交撤回或复核申请'}).click();
  await expect(b.locator('#custody-reviews-list')).toContainText(name);
  await m.getByRole('button',{name:'刷新数据'}).click();
  await expect(m.locator('#custody-review-decision-card')).toBeVisible();
  const decideReview=m.locator('#custody-review-decision-form');
  const reviewChoice=decideReview.locator('select[name="review_id"]');
  const reviewId=await reviewChoice.locator('option').filter({hasText:name}).first().getAttribute('value');
  expect(reviewId).toBeTruthy();
  await reviewChoice.selectOption(reviewId);
  await decideReview.locator('select[name="result"]').selectOption('reversed');
  await decideReview.locator('textarea[name="reason_zh"]')
   .fill('独立复核确认管理权需要恢复原任员工');
  await decideReview.locator('input[name="evidence_ref"]')
   .fill('虚构独立复核证据记录');
  await decideReview.getByRole('button',{name:'保存独立复核决定'}).click();
  await expect.poll(async()=>(
    await owner.query('SELECT assignee_id FROM ms.contact_custody_assignments WHERE contact_id=$1 AND revoked_at IS NULL',[contact.id])
  ).rows[0]?.assignee_id).toBe(ids.A);
  await expect.poll(async()=>(
    await pools.readB.query('SELECT COUNT(*)::int AS n FROM ms.scoped_contacts_directory WHERE contact_id=$1',[contact.id])
  ).rows[0]?.n).toBe(0);
  await b.getByRole('button',{name:'刷新数据'}).click();
  await a.getByRole('button',{name:'刷新数据'}).click();
  await expect(b.locator('#contacts-list')).not.toContainText(name);
  await expect(a.locator('#contacts-list')).toContainText(name);
  expect((await owner.query('SELECT assignee_id FROM ms.contact_custody_assignments WHERE contact_id=$1 AND revoked_at IS NULL',[contact.id])).rows[0].assignee_id).toBe(ids.A);
  await m.setViewportSize({width:390,height:844});
  await expect(m.locator('#custody-decision-card')).toBeVisible();
  const overflow=await m.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await testInfo.attach('chinese-contact-custody-approval',{
   body:await m.screenshot({fullPage:true}),contentType:'image/png'
  });
  const visibleText=await m.locator('#contact-custody-workbench').innerText();
  expect(visibleText).not.toContain('staff_identity_bindings');
  expect(visibleText).not.toContain('SELECT');
  expect(visibleText).not.toContain('虚构独立审核材料说明');
 }finally{
  await Promise.allSettled(Object.values(pages).map(p=>p.close()));
  if(app.listening)await close(app);
  await Promise.all([owner.end(),directory.end(),...Object.values(pools).map(p=>p.end())]);
 }
});
