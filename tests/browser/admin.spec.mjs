import { test, expect } from '@playwright/test';

const passphrase='fictional-strong-ui-demo-passphrase-0001';
async function login(page,account){
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'登录演示工作台'})).toBeVisible();
  await page.locator('#login-form select[name="account_code"]').selectOption(account);
  await page.locator('#login-form input[name="passphrase"]').fill(passphrase);
  await page.getByRole('button',{name:'进入工作台'}).click();
  await expect(page.getByRole('heading',{name:'工作概览'})).toBeVisible();
}
async function navigate(page,name){
  await page.getByRole('button',{name}).click();
  await expect(page.locator('#page-title')).toHaveText(name);
}
async function logout(page){
  await page.getByRole('button',{name:'退出演示账号'}).click();
  await expect(page.getByRole('heading',{name:'登录演示工作台'})).toBeVisible();
}

test('真实 Chromium：中文学生、联系人、咨询、商机、审计及销售权限流程',async({page},testInfo)=>{
  await login(page,'sales-a');
  await navigate(page,'学生客户');
  await page.locator('#student-form input[name="display_name"]').fill('浏览器模拟学生甲');
  await page.locator('#student-form input[name="grade_label"]').fill('小学三年级');
  await page.getByRole('button',{name:'保存学生档案'}).click();
  await expect(page.locator('#students-list')).toContainText('浏览器模拟学生甲');
  await expect(page.locator('#students-list')).toContainText('模拟销售顾问 A');

  await navigate(page,'家长与联系人');
  await page.locator('#contact-form input[name="display_name"]').fill('浏览器模拟家长');
  await page.getByRole('button',{name:'保存联系人'}).click();
  await expect(page.locator('#contacts-list')).toContainText('浏览器模拟家长');
  await page.locator('#contact-link-form select[name="student_id"]').selectOption({label:'浏览器模拟学生甲'});
  await page.locator('#contact-link-form select[name="contact_id"]').selectOption({label:'浏览器模拟家长'});
  await page.getByRole('button',{name:'关联至该学生'}).click();
  await expect(page.locator('#toast')).toContainText('联系人已关联');

  await navigate(page,'咨询与线索');
  await page.locator('#event-form select[name="contact_id"]').selectOption({label:'浏览器模拟家长'});
  await page.getByRole('button',{name:'保存本次咨询'}).click();
  await expect(page.locator('#toast')).toContainText('真实咨询已登记');
  await expect(page.locator('#lead-form select[name="source_event_ref"] option:checked'))
    .toContainText('浏览器模拟家长');
  await page.getByRole('button',{name:'创建销售线索'}).click();
  await expect(page.locator('#leads-list')).toContainText('浏览器模拟家长');
  await expect(page.locator('#leads-list')).toContainText('未识别具体学生');
  await page.locator('#lead-link-form input[name="evidence_ref"]').fill('虚构家长确认学生身份');
  await page.getByRole('button',{name:'关联学生（待核实）'}).click();
  await expect(page.locator('#toast')).toContainText('待核实关联');

  await navigate(page,'销售商机');
  await page.locator('#opportunity-form select[name="student_id"]').selectOption({label:'浏览器模拟学生甲'});
  await page.locator('#opportunity-form input[name="predicted_yuan"]').fill('6000.00');
  await page.getByRole('button',{name:'创建销售商机'}).click();
  await expect(page.locator('#opportunities-list')).toContainText('浏览器模拟学生甲');
  await expect(page.locator('#opportunities-list')).toContainText('¥6,000.00');

  await navigate(page,'业务变更记录');
  await page.locator('#audit-type').selectOption('student');
  await page.locator('#audit-object').selectOption({label:'浏览器模拟学生甲'});
  await page.getByRole('button',{name:'查看记录'}).click();
  await expect(page.locator('#audit-list')).toContainText('新建学生客户');
  await expect(page.locator('#audit-list')).toContainText('负责人：模拟销售顾问 A');
  await expect(page.locator('#audit-list')).not.toContainText('before_business_json');
  await testInfo.attach('chinese-business-audit',{body:await page.screenshot({fullPage:true}),contentType:'image/png'});

  await logout(page);
  await login(page,'sales-b');
  await navigate(page,'学生客户');
  await expect(page.locator('#students-list')).not.toContainText('浏览器模拟学生甲');
  await page.locator('#student-form input[name="display_name"]').fill('浏览器模拟学生乙');
  await page.getByRole('button',{name:'保存学生档案'}).click();
  await expect(page.locator('#students-list')).toContainText('浏览器模拟学生乙');
  await expect(page.locator('#students-list')).not.toContainText('浏览器模拟学生甲');

  await logout(page);
  await login(page,'supervisor');
  await navigate(page,'学生客户');
  await expect(page.locator('#students-list')).toContainText('浏览器模拟学生甲');
  await expect(page.locator('#students-list')).toContainText('浏览器模拟学生乙');

  await navigate(page,'家庭关系核实');
  await page.locator('#family-form input[name="display_name"]').fill('浏览器模拟家庭');
  await page.locator('#family-form select[name="student_a"]').selectOption({label:'浏览器模拟学生甲'});
  await page.locator('#family-form select[name="student_b"]').selectOption({label:'浏览器模拟学生乙'});
  await page.locator('#family-form input[name="verification_evidence_ref"]').fill('演示家庭关系核实材料待复核');
  await page.getByRole('button',{name:'提交核实申请'}).click();
  await expect(page.locator('#families-list')).toContainText('浏览器模拟家庭');
  await expect(page.locator('#families-list')).toContainText('待核实');
  await testInfo.attach('family-review-pending',{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
});

test('真实 Chromium：移动窄屏可操作、业务名称安全显示、无收款模块',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await login(page,'sales-a');
  await navigate(page,'学生客户');
  await page.locator('#student-form input[name="display_name"]')
    .fill('浏览器模拟学生 <img src=x onerror=alert(1)>');
  await page.getByRole('button',{name:'保存学生档案'}).click();
  await expect(page.locator('#students-list')).toContainText('<img src=x onerror=alert(1)>');
  expect(await page.locator('#students-list img').count()).toBe(0);
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  const navText=await page.locator('nav[aria-label="模块导航"]').innerText();
  expect(navText).not.toContain('收款确认');
  expect(navText).not.toContain('CRM 发课');
  await navigate(page,'工作概览');
  await expect(page.locator('.footnote')).toContainText('未启用');
});


test('真实 Chromium：独立两位主管审核家庭关系，记录中文变更和角色边界',async({page})=>{
  await login(page,'supervisor');
  await navigate(page,'学生客户');
  for(const name of ['双人审核虚构学生甲','双人审核虚构学生乙']){
    await page.locator('#student-form input[name="display_name"]').fill(name);
    await page.getByRole('button',{name:'保存学生档案'}).click();
    await expect(page.locator('#students-list')).toContainText(name);
  }
  await navigate(page,'家庭关系核实');
  await page.locator('#family-form input[name="display_name"]').fill('双人审核浏览器演示家庭');
  await page.locator('#family-form select[name="student_a"]').selectOption({label:'双人审核虚构学生甲'});
  await page.locator('#family-form select[name="student_b"]').selectOption({label:'双人审核虚构学生乙'});
  await page.locator('#family-form input[name="verification_evidence_ref"]').fill('申请人待核实的材料编号');
  await page.getByRole('button',{name:'提交核实申请'}).click();
  await expect(page.locator('#families-list')).toContainText('双人审核浏览器演示家庭');
  await expect(page.locator('#families-list')).toContainText('待核实');
  await expect(page.locator('#family-decision-form button[type="submit"]')).toBeDisabled();

  await logout(page);
  await login(page,'supervisor-2');
  await navigate(page,'家庭关系核实');
  await page.locator('#family-review-select').selectOption({label:'双人审核浏览器演示家庭（申请人：模拟销售主管）'});
  await expect(page.locator('#family-decision-form button[type="submit"]')).toBeEnabled();
  await page.locator('#family-decision-form input[name="review_evidence_ref"]').fill('第二主管独立核对编号');
  await page.locator('#family-decision-form textarea[name="reason_zh"]').fill('第二主管人工核实：两名学生关系符合模拟证据');
  await page.getByRole('button',{name:'提交独立审核决定'}).click();
  await expect(page.locator('#families-list')).toContainText('已核实');
  await expect(page.locator('#families-list')).toContainText('审核人：模拟第二主管');

  await navigate(page,'业务变更记录');
  await page.locator('#audit-type').selectOption('family');
  await page.locator('#audit-object').selectOption({label:'双人审核浏览器演示家庭 · 已核实'});
  await page.getByRole('button',{name:'查看记录'}).click();
  await expect(page.locator('#audit-list')).toContainText('独立主管核实批准');
  await expect(page.locator('#audit-list')).toContainText('第二主管');
  await expect(page.locator('#audit-list')).not.toContainText('before_business_json');
  await logout(page);
  await login(page,'sales-a');
  await navigate(page,'家庭关系核实');
  await expect(page.locator('#family-form button[type="submit"]')).toBeDisabled();
  await expect(page.locator('#family-decision-form button[type="submit"]')).toBeDisabled();
});
