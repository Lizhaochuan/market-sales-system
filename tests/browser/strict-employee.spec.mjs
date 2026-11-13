import {test,expect} from '@playwright/test';
import {createSign,generateKeyPairSync,randomUUID} from 'node:crypto';
import pg from 'pg';
import {createApp} from '../../src/app.mjs';

const org='20000000-0000-4000-8000-000000000001';
const A='20000000-0000-4000-8000-000000000011';
const B='20000000-0000-4000-8000-000000000012';
const M='20000000-0000-4000-8000-000000000013';
const M2='20000000-0000-4000-8000-000000000014';
const issuer='https://fictional-browser-strict-staff.example.invalid';
const audience='strict-chinese-staff-workbench';
const secret='fictional-test-only-strong-token-secret-9c92789dc3b9';
const open=s=>new Promise(ok=>s.listen(0,'127.0.0.1',ok));
const close=s=>new Promise(ok=>s.close(ok));

test('真实 Chromium：原中文工作台签名员工测试身份登录，原学生/联系人按钮经受限数据库写入',async({browser},testInfo)=>{
  process.env.MS_STAGE='isolated-test';
  const owner=new pg.Pool({connectionString:process.env.DATABASE_URL,max:5});
  const aRead=new pg.Pool({connectionString:process.env.DATABASE_URL_ASSIGNEE_A,max:3});
  const bRead=new pg.Pool({connectionString:process.env.DATABASE_URL_ASSIGNEE_B,max:3});
  const aWrite=new pg.Pool({connectionString:process.env.DATABASE_URL_WRITE_A,max:3});
  const bWrite=new pg.Pool({connectionString:process.env.DATABASE_URL_WRITE_B,max:3});
  const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  const jwk={...publicKey.export({format:'jwk'}),alg:'RS256',
    kid:'browser-strict-employee-test',use:'sig'};
  const externalIdentity={issuer,audience,jwks:{keys:[jwk]}};
  const subA='browser-strict-a-'+randomUUID(),subB='browser-strict-b-'+randomUUID();
  const token=(sub)=>{
    const now=Math.floor(Date.now()/1000);
    const h=Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT',kid:jwk.kid})).toString('base64url');
    const p=Buffer.from(JSON.stringify({
      iss:issuer,aud:audience,sub,iat:now,exp:now+900,
      org_id:'20000000-0000-4000-8000-000000000002',
      role:'super_admin',staff_id:M
    })).toString('base64url');
    return h+'.'+p+'.'+createSign('RSA-SHA256').update(h+'.'+p)
      .sign(privateKey).toString('base64url');
  };
  const app=createApp(owner,{
    secret,issuer:'market-sales-test-issuer',externalIdentity,
    strictStaffMode:true,
    scopedReadPools:new Map([[A,aRead],[B,bRead]]),
    scopedWritePools:new Map([[A,aWrite],[B,bWrite]])
  });
  const pages={};
  const name='严格员工中文学生-'+randomUUID();
  const contactName='严格员工中文家长-'+randomUUID();
  async function approved(target,subject){
    const r=await owner.query(
      "INSERT INTO ms.identity_change_requests(organization_id,action,target_staff_id,"+
      "issuer,subject,requested_by,request_evidence_ref,request_reason_zh) "+
      "VALUES($1,'bind',$2,$3,$4,$5,'虚构浏览器员工资料','两位主管独立核实') RETURNING id",
      [org,target,issuer,subject,M]);
    await owner.query(
      "INSERT INTO ms.identity_change_decisions(request_id,reviewer_user_id,decision,"+
      "review_evidence_ref,reason_zh) VALUES($1,$2,'approved','独立主管复核凭证','核实通过')",
      [r.rows[0].id,M2]);
    await owner.query(
      "UPDATE ms.identity_change_requests SET status='approved',decided_by=$2,decided_at=now()"+
      " WHERE id=$1",[r.rows[0].id,M2]);
    await owner.query(
      "INSERT INTO ms.staff_identity_bindings(staff_user_id,issuer,subject,bound_by,approval_request_id) "+
      "VALUES($1,$2,$3,$4,$5)",[target,issuer,subject,M2,r.rows[0].id]);
  }
  async function login(account,sub){
    const page=await browser.newPage();
    pages[account]=page;
    await page.goto('http://127.0.0.1:'+app.address().port+'/');
    await expect(page.getByRole('heading',{name:'登录演示工作台'})).toBeVisible();
    await expect(page.locator('#login-form')).toBeHidden();
    await page.locator('#external-login-form input[name="signed_token"]').fill(token(sub));
    await page.getByRole('button',{name:'验证员工身份并进入'}).click();
    await expect(page.getByRole('heading',{name:'工作概览'})).toBeVisible();
    await expect(page.locator('#strict-scope-note')).toBeVisible();
    await expect(page.locator('#staff-role')).toContainText('低权限模式');
    await expect(page.locator('#external-login-form input[name="signed_token"]'))
      .toHaveValue('');
    expect(await page.evaluate(()=>localStorage.length)).toBe(0);
    await expect(page.locator('nav button[data-view="opportunities"]')).toBeHidden();
    await expect(page.locator('nav button[data-view="families"]')).toBeHidden();
    await expect(page.locator('nav button[data-view="leads"]')).toBeHidden();
    return page;
  }
  try{
    await approved(A,subA);await approved(B,subB);
    await open(app);
    const a=await login('A',subA);
    await a.getByRole('button',{name:'学生客户'}).click();
    await a.locator('#student-form input[name="display_name"]').fill(name);
    await a.locator('#student-form input[name="grade_label"]').fill('孩子个人年级');
    await a.getByRole('button',{name:'保存学生档案'}).click();
    await expect(a.locator('#students-list')).toContainText(name);
    await expect(a.locator('#students-list')).not.toContainText('孩子个人年级');
    await a.getByRole('button',{name:'家长与联系人'}).click();
    await expect(a.locator('#contact-link-form')).toBeHidden();
    await a.locator('#contact-form input[name="display_name"]').fill(contactName);
    await a.getByRole('button',{name:'保存联系人'}).click();
    await expect(a.locator('#contacts-list')).toContainText(contactName);
    await testInfo.attach('chinese-strict-employee-workbench',{
      body:await a.screenshot({fullPage:true}),contentType:'image/png'
    });
    const db=await owner.query('SELECT owner_user_id FROM ms.students WHERE display_name=$1',
      [name]);
    expect(db.rows[0].owner_user_id).toBe(A);
    const family=await owner.query('SELECT COUNT(*)::int AS n FROM ms.family_memberships '+
      'WHERE student_id=(SELECT id FROM ms.students WHERE display_name=$1)',[name]);
    expect(family.rows[0].n).toBe(0);

    const b=await login('B',subB);
    await b.getByRole('button',{name:'学生客户'}).click();
    await expect(b.locator('#students-list')).not.toContainText(name);
    await b.getByRole('button',{name:'家长与联系人'}).click();
    await expect(b.locator('#contacts-list')).not.toContainText(contactName);
    await b.locator('#contact-form input[name="display_name"]').fill('只属于销售B-'+randomUUID());
    await b.getByRole('button',{name:'保存联系人'}).click();
    await expect(b.locator('#toast')).toContainText('未采集电话和微信');
    await b.setViewportSize({width:390,height:844});
    await expect(b.locator('#strict-scope-note')).toBeVisible();
    const overflow=await b.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);

    await a.getByRole('button',{name:'退出演示账号'}).click();
    await expect(a.locator('#workspace')).toBeHidden();
    await expect(a.locator('#external-login-form')).toBeVisible();
    expect(await a.evaluate(()=>localStorage.length)).toBe(0);
  }finally{
    await Promise.allSettled(Object.values(pages).map(x=>x.close()));
    await Promise.allSettled([app].filter(s=>s.listening).map(close));
    await Promise.all([owner.end(),aRead.end(),bRead.end(),aWrite.end(),bWrite.end()]);
  }
});
