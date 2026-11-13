import {test,expect} from '@playwright/test';
import {generateKeyPairSync,createSign,randomUUID} from 'node:crypto';
import pg from 'pg';
import {createStudentAccessApi} from '../../src/student-access-api.mjs';

const org='20000000-0000-4000-8000-000000000001';
const A='20000000-0000-4000-8000-000000000011';
const B='20000000-0000-4000-8000-000000000012';
const M='20000000-0000-4000-8000-000000000013';
const M2='20000000-0000-4000-8000-000000000014';
const issuer='https://fictional-browser-access.example.invalid';
const audience='isolated-chinese-permissions-ui';
const listen=s=>new Promise(r=>s.listen(0,'127.0.0.1',r));
const close=s=>new Promise(r=>s.close(r));

test('真实 Chromium：中文独立授权页面完成学生共享→双主管审核→撤销→负责人转交',async({browser},testInfo)=>{
  process.env.MS_STAGE='isolated-test';
  const owner=new pg.Pool({connectionString:process.env.DATABASE_URL,max:5});
  const readB=new pg.Pool({connectionString:process.env.DATABASE_URL_ASSIGNEE_B,max:2});
  const pools={
    A:new pg.Pool({connectionString:process.env.DATABASE_URL_ACCESS_A,max:3}),
    B:new pg.Pool({connectionString:process.env.DATABASE_URL_ACCESS_B,max:3}),
    M:new pg.Pool({connectionString:process.env.DATABASE_URL_ACCESS_MANAGER,max:3})
  };
  const keys=generateKeyPairSync('rsa',{modulusLength:2048});
  const jwk={...keys.publicKey.export({format:'jwk'}),
    kid:'browser-access-2026',alg:'RS256',use:'sig'};
  const externalIdentity={issuer,audience,jwks:{keys:[jwk]}};
  const subjects={A:'ui-a-'+randomUUID(),B:'ui-b-'+randomUUID(),M:'ui-m-'+randomUUID()};
  const token=(person)=>{
    const now=Math.floor(Date.now()/1000);
    const h=Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT',kid:jwk.kid})).toString('base64url');
    const p=Buffer.from(JSON.stringify({
      iss:issuer,sub:subjects[person],aud:audience,iat:now,exp:now+900,
      org_id:'20000000-0000-4000-8000-000000000002',role:'super_admin'
    })).toString('base64url');
    return h+'.'+p+'.'+createSign('RSA-SHA256').update(h+'.'+p)
      .sign(keys.privateKey).toString('base64url');
  };
  const apps={
    A:createStudentAccessApi(pools.A,{externalIdentity}),
    B:createStudentAccessApi(pools.B,{externalIdentity}),
    M:createStudentAccessApi(pools.M,{externalIdentity})
  };
  const pages={},studentName='浏览器授权学生-'+randomUUID();
  let studentId;
  async function approveExternalIdentity(subject,target,requester){
    const q=await owner.query(
      "INSERT INTO ms.identity_change_requests(organization_id,action,target_staff_id,"+
      "issuer,subject,requested_by,request_evidence_ref,request_reason_zh) "+
      "VALUES($1,'bind',$2,$3,$4,$5,'虚构管理员批准材料','独立核实员工') RETURNING id",
      [org,target,issuer,subject,requester]);
    await owner.query(
      "INSERT INTO ms.identity_change_decisions(request_id,reviewer_user_id,decision,"+
      "review_evidence_ref,reason_zh) VALUES($1,$2,'approved','第二主管独立核验','员工材料符合要求')",
      [q.rows[0].id,M2]);
    await owner.query(
      "UPDATE ms.identity_change_requests SET status='approved',decided_by=$2,decided_at=now() WHERE id=$1",
      [q.rows[0].id,M2]);
    await owner.query(
      "INSERT INTO ms.staff_identity_bindings(staff_user_id,issuer,subject,bound_by,approval_request_id) "+
      "VALUES($1,$2,$3,$4,$5)",
      [target,issuer,subject,M2,q.rows[0].id]);
  }
  async function connect(person){
    const page=await browser.newPage();
    pages[person]=page;
    const address='http://127.0.0.1:'+apps[person].address().port+'/app';
    await page.goto(address);
    await expect(page.getByRole('heading',{name:'学生客户权限管理'})).toBeVisible();
    await page.locator('#signed-token').fill(token(person));
    await page.getByRole('button',{name:'连接本机隔离数据'}).click();
    await expect(page.locator('#workspace')).toBeVisible();
    await expect(page.locator('#signed-token')).toHaveValue('');
    expect(await page.evaluate(()=>localStorage.length)).toBe(0);
    return page;
  }
  try{
    await approveExternalIdentity(subjects.A,A,M);
    await approveExternalIdentity(subjects.B,B,M);
    await approveExternalIdentity(subjects.M,M,A);
    const record=await owner.query(
      "INSERT INTO ms.students(organization_id,display_name,grade_label,owner_user_id) "+
      "VALUES($1,$2,'儿童敏感年级',$3) RETURNING id",[org,studentName,A]);
    studentId=record.rows[0].id;
    await Promise.all(Object.values(apps).map(listen));

    const pageA=await connect('A');
    await pageA.locator('#student-choice').selectOption({label:studentName});
    await pageA.locator('#staff-choice').selectOption({label:'模拟销售顾问 B'});
    await pageA.locator('#request-form textarea[name="reason_zh"]')
      .fill('销售A申请销售B临时查看这位学生');
    await pageA.locator('#request-form input[name="evidence_ref"]')
      .fill('虚构学生授权核对材料');
    await pageA.getByRole('button',{name:'提交给独立主管审核'}).click();
    await expect(pageA.locator('#status')).toContainText('尚未生效');
    await pageA.getByRole('button',{name:'独立审核'}).click();
    await expect(pageA.locator('#requests-list')).toContainText(studentName);
    await expect(pageA.locator('#requests-list')).toContainText('待独立审批');

    const pageM=await connect('M');
    await pageM.getByRole('button',{name:'独立审核'}).click();
    await expect(pageM.locator('#requests-list')).toContainText(studentName);
    await pageM.locator('#review-choice').selectOption({
      label:'临时共享查看 · '+studentName+' → 模拟销售顾问 B'});
    await pageM.locator('#decision-form textarea[name="reason_zh"]')
      .fill('第二位主管已独立核实临时共享范围');
    await pageM.locator('#decision-form input[name="evidence_ref"]')
      .fill('虚构主管二次审核资料');
    await pageM.getByRole('button',{name:'保存独立审核结果'}).click();
    await expect(pageM.locator('#requests-list')).toContainText('已批准');

    const beforeRevoke=await readB.query(
      'SELECT student_id FROM ms.student_directory_assigned');
    expect(beforeRevoke.rows.some(x=>x.student_id===studentId)).toBe(true);
    const pageB=await connect('B');
    await pageB.getByRole('button',{name:'当前共享与撤销'}).click();
    await expect(pageB.locator('#grants-list')).toContainText(studentName);
    await expect(pageB.locator('#grants-list')).toContainText('有效');
    await pageB.locator('#revoke-choice').selectOption({
      label:studentName+' · 接收人：模拟销售顾问 B'});
    await pageB.locator('#revoke-form textarea[name="reason_zh"]')
      .fill('被授权员工不再需要查看该学生');
    await pageB.getByRole('button',{name:'立即撤销这项查看权限'}).click();
    await expect(pageB.locator('#grants-list')).toContainText('已撤销');
    const visibility=await readB.query(
      'SELECT student_id FROM ms.student_directory_assigned');
    expect(visibility.rows.some(x=>x.student_id===studentId)).toBe(false);

    await pageA.getByRole('button',{name:'提出授权申请'}).click();
    await pageA.locator('#action-type').selectOption('transfer');
    await expect(pageA.locator('#duration-label')).toBeHidden();
    await pageA.locator('#student-choice').selectOption({label:studentName});
    await pageA.locator('#staff-choice').selectOption({label:'模拟销售顾问 B'});
    await pageA.locator('#request-form textarea[name="reason_zh"]')
      .fill('销售A正式将该名学生负责人转交给销售B');
    await pageA.locator('#request-form input[name="evidence_ref"]')
      .fill('虚构客户负责人变更材料');
    await pageA.getByRole('button',{name:'提交给独立主管审核'}).click();
    await expect(pageA.locator('#status')).toContainText('尚未生效');
    const before=await owner.query('SELECT owner_user_id FROM ms.students WHERE id=$1',[studentId]);
    expect(before.rows[0].owner_user_id).toBe(A);

    await pageM.getByRole('button',{name:'刷新当前权限'}).click();
    await pageM.locator('#review-choice').selectOption({
      label:'学生负责人转交 · '+studentName+' → 模拟销售顾问 B'});
    await pageM.locator('#decision-form textarea[name="reason_zh"]')
      .fill('正式客户负责人转交已独立审核');
    await pageM.locator('#decision-form input[name="evidence_ref"]')
      .fill('虚构负责人转交独立核对记录');
    await pageM.getByRole('button',{name:'保存独立审核结果'}).click();
    await expect(pageM.locator('#status')).toContainText('已保存');
    const after=await owner.query('SELECT owner_user_id FROM ms.students WHERE id=$1',[studentId]);
    expect(after.rows[0].owner_user_id).toBe(B);

    await pageM.setViewportSize({width:390,height:844});
    await expect(pageM.getByRole('heading',{name:'学生客户权限管理'})).toBeVisible();
    const overflow=await pageM.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await testInfo.attach('chinese-access-approval-console',{
      body:await pageM.screenshot({fullPage:true}),contentType:'image/png'});
    const documentText=await pageM.locator('body').innerText();
    expect(documentText).not.toContain('儿童敏感年级');
    expect(documentText).not.toContain('before_business_json');
    expect(documentText).not.toContain('SELECT * FROM');
  }finally{
    await Promise.allSettled(Object.values(pages).map(p=>p.close()));
    await Promise.allSettled(Object.values(apps).filter(s=>s.listening).map(close));
    await Promise.all([owner.end(),readB.end(),...Object.values(pools).map(p=>p.end())]);
  }
});
