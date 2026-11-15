import {test,expect} from '@playwright/test';
test('fictional workspace: tasks, quote versions, order intent, safe totals, logout and mobile',async({page},testInfo)=>{
 await page.goto('/?workspace=legacy');
 await page.locator('#login-form select').selectOption('sales-a');
 await page.locator('#login-form input').fill('fictional-strong-ui-demo-passphrase-0001');
 await page.getByRole('button',{name:'进入工作台',exact:true}).click();
 await expect(page.locator('#workspace-business-nav')).toBeVisible();
 const name='工作台学生'+Date.now();
 const taskName='需要完成的跟进任务'+name;
 const quoteName='课程报价 '+name+' <img src=x onerror=alert(1)>';
 await page.getByRole('button',{name:'学生客户',exact:false}).click();
 await page.locator('#student-form input[name="display_name"]').fill(name);
 await page.getByRole('button',{name:'保存学生档案'}).click();
 await expect(page.locator('#students-list')).toContainText(name);
 await page.getByRole('button',{name:'销售商机',exact:false}).click();
 await page.locator('#opportunity-form select[name="student_id"]').selectOption({label:name});
 await page.locator('#opportunity-form input[name="predicted_yuan"]').fill('1234.56');
 await page.getByRole('button',{name:'创建销售商机'}).click();
 await expect(page.locator('#opportunities-list')).toContainText(name);
 await page.locator('#workspace-business-nav').click();
 await expect(page.locator('#business-status')).toContainText('已读取');
 const form=page.locator('#business-form');
 await form.locator('[name="title"]').fill(taskName);
 await page.locator('#business-student').selectOption({label:name});
 await page.locator('#business-opportunity').selectOption({label:name+' · 新建'});
 await page.locator('#business-save').click();
 await expect(page.locator('#business-records')).toContainText(taskName);
 const task=page.locator('#business-records article').filter({hasText:taskName});
 await task.getByRole('button',{name:'已完成',exact:true}).click();
 await expect(task).toContainText('已完成');
 await task.getByRole('button',{name:'查看历史版本'}).click();
 await expect(page.locator('#business-history')).toContainText('第1版');
 await expect(page.locator('#business-history')).toContainText('第2版');
 await page.locator('#business-kind').selectOption('quotes');
 await expect(page.locator('#business-status')).toContainText('报价草稿');
 await form.locator('[name="title"]').fill(quoteName);
 await page.locator('#business-student').selectOption({label:name});
 await page.locator('#business-opportunity').selectOption({label:name+' · 新建'});
 const future=new Date(Date.now()+86400000);future.setMinutes(future.getMinutes()-future.getTimezoneOffset());
 await form.locator('[name="at"]').fill(future.toISOString().slice(0,16));
 await form.locator('[name="course_label"]').fill('课程A');
 await form.locator('[name="quantity"]').fill('3');
 await form.locator('[name="amount"]').fill('199.99');
 await page.locator('#business-add-line').click();
 await page.locator('#business-extra-lines [data-quote-field="course"]').fill('课程B');
 await page.locator('#business-extra-lines [data-quote-field="quantity"]').fill('2');
 await page.locator('#business-extra-lines [data-quote-field="amount"]').fill('100.01');
 await page.locator('#business-save').click();
 await expect(page.locator('#business-records')).toContainText('¥799.99');
 await expect(page.locator('#business-records img')).toHaveCount(0);
 await page.locator('#business-records article').filter({hasText:quoteName}).getByRole('button',{name:'编辑',exact:true}).click();
 await expect(page.locator('#business-extra-lines [data-quote-field="course"]')).toHaveValue('课程B');
 await page.locator('#business-save').click();
 await expect(page.locator('#business-records')).toContainText('第2版');
 await expect(page.locator('#business-records')).toContainText('¥799.99');
 await page.locator('#business-kind').selectOption('order-intents');
 await expect(page.locator('#business-status')).toContainText('报名意向');
 await form.locator('[name="title"]').fill('待确认报名意向');
 await page.locator('#business-save').click();
 await expect(page.locator('#business-records')).toContainText('待确认报名意向');
 await expect(page.locator('#business-records')).toContainText('¥799.99');
 await expect(page.locator('#business-external')).toContainText('尚无经财务确认的收入或提成数据');
 await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
 await testInfo.attach('isolated-business-workspace-mobile',{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
 await page.getByRole('button',{name:'退出演示账号'}).click();
 await expect(page.locator('#business-records')).toBeEmpty();
 await expect(page.locator('#business-pipeline')).toBeEmpty();
 await expect(page.locator('#workspace-business-nav')).toBeHidden();
});

test('workspace refresh failure clears records and delayed requests cannot refill logout',async({page})=>{
 await page.goto('/?workspace=legacy');
 await page.locator('#login-form input').fill('fictional-strong-ui-demo-passphrase-0001');
 await page.getByRole('button',{name:'进入工作台',exact:true}).click();
 await page.locator('#workspace-business-nav').click();
 await expect(page.locator('#business-status')).toContainText('已读取');
 await page.route('**/api/v1/isolated-workspace/**',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'UNAVAILABLE',message:'测试服务不可用'})}));
 await page.locator('#business-refresh').click();
 await expect(page.locator('#business-status')).toContainText('读取失败，已清空旧数据');
 await expect(page.locator('#business-records')).toBeEmpty();
 await expect(page.locator('#business-summary')).toBeEmpty();
 await page.unroute('**/api/v1/isolated-workspace/**');
 let release;
 const gate=new Promise(resolve=>{release=resolve;});
 await page.route('**/api/v1/isolated-workspace/summary',async route=>{await gate;await route.continue();});
 const started=page.waitForRequest('**/api/v1/isolated-workspace/summary');
 await page.locator('#business-refresh').click();await started;
 await page.getByRole('button',{name:'退出演示账号'}).click();
 const finished=page.waitForResponse('**/api/v1/isolated-workspace/summary');release();await finished;
 await expect(page.locator('#business-student')).toBeEmpty();
 await expect(page.locator('#business-records')).toBeEmpty();
 await expect(page.locator('#business-pipeline')).toBeEmpty();
});

test('a delayed save cannot reset another employee session or expose the prior task',async({page})=>{
 await page.goto('/?workspace=legacy');
 const login=async account=>{
  await page.locator('#login-form select').selectOption(account);
  await page.locator('#login-form input').fill('fictional-strong-ui-demo-passphrase-0001');
  await page.getByRole('button',{name:'进入工作台',exact:true}).click();
  await page.locator('#workspace-business-nav').click();
  await expect(page.locator('#business-status')).toContainText('已读取');
 };
 await login('sales-a');
 let release;const gate=new Promise(resolve=>{release=resolve;});
 await page.route('**/api/v1/isolated-workspace/tasks',async route=>{
  if(route.request().method()==='POST')await gate;await route.continue();
 });
 const name='保存期间退出'+Date.now();
 await page.locator('#business-form [name="title"]').fill(name);
 const started=page.waitForRequest(request=>request.url().endsWith('/isolated-workspace/tasks')&&request.method()==='POST');
 await page.locator('#business-save').click();await started;
 await expect(page.locator('#business-kind')).toBeDisabled();
 await page.getByRole('button',{name:'退出演示账号'}).click();
 await login('sales-b');
 await page.locator('#business-kind').selectOption('quotes');
 await expect(page.locator('#business-status')).toContainText('报价草稿');
 const finished=page.waitForResponse(response=>response.url().endsWith('/isolated-workspace/tasks')&&response.request().method()==='POST');
 release();await finished;
 await expect(page.locator('#business-kind')).toHaveValue('quotes');
 await expect(page.locator('#business-kind')).toBeEnabled();
 await expect(page.locator('#business-records')).not.toContainText(name);
});

test('UAT fixes: Step 2 notes/carryover/jump, Step 3 future default, Step 4 presets, Step 5 quote order & Step 8 toggle',async({page})=>{
 await page.goto('/?workspace=legacy');
 await page.locator('#login-form select').selectOption('sales-a');
 await page.locator('#login-form input').fill('fictional-strong-ui-demo-passphrase-0001');
 await page.getByRole('button',{name:'进入工作台',exact:true}).click();
 await expect(page.locator('#session-countdown')).toBeVisible();
 await expect(page.locator('#session-countdown')).toContainText('会话剩余');

 // Step 8(b): no dead port-3300 anchor; button toggles explanation note cleanly
 await expect(page.locator('a[href*="3300"]')).toHaveCount(0);
 await expect(page.locator('#student-access-note')).toBeHidden();
 await page.locator('#student-access-entry').click();
 await expect(page.locator('#student-access-note')).toBeVisible();
 await expect(page.locator('#student-access-entry')).toHaveAttribute('aria-expanded','true');
 await page.locator('#student-access-entry').click();
 await expect(page.locator('#student-access-note')).toBeHidden();

 const suffix=String(Date.now());
 const studentName='联调学生'+suffix;
 const contactName='联调家长'+suffix;

 // Step 1: create student & parent, link them
 await page.locator('nav button[data-view="students"]').click();
 await page.locator('#student-form [name="display_name"]').fill(studentName);
 await page.getByRole('button',{name:'保存学生档案'}).click();
 await expect(page.locator('#students-list')).toContainText(studentName);

 await page.locator('nav button[data-view="contacts"]').click();
 await page.locator('#contact-form [name="display_name"]').fill(contactName);
 await page.getByRole('button',{name:'保存联系人'}).click();
 await expect(page.locator('#contacts-list')).toContainText(contactName);
 await page.locator('#contact-link-form [name="student_id"]').selectOption({label:studentName});
 await page.locator('#contact-link-form [name="contact_id"]').selectOption({label:contactName});
 await page.getByRole('button',{name:'关联至该学生'}).click();
 await expect(page.locator('#toast')).toContainText('联系人已关联');

 // Step 2(a): consultation notes saved and visible
 await page.locator('nav button[data-view="leads"]').click();
 await page.locator('#event-form [name="contact_id"]').selectOption({label:contactName});
 await page.locator('#event-form [name="original_source_text"]').fill('周末可试听英语与数学');
 await page.getByRole('button',{name:'保存本次咨询'}).click();
 await expect(page.locator('#events-list')).toContainText('周末可试听英语与数学');

 // Step 2(b): convert to lead -> single-student candidate carried to lead-link-form -> badge updates after link
 await page.getByRole('button',{name:'创建销售线索'}).click();
 await expect(page.locator('#leads-list')).toContainText('周末可试听英语与数学');
 await expect(page.locator('#leads-list')).toContainText('未识别具体学生');
 await expect(page.locator('#lead-link-candidate-hint')).toBeVisible();
 await expect(page.locator('#lead-link-candidate-hint')).toContainText(studentName);
 await expect(page.locator('#lead-link-form [name="student_id"] option:checked')).toHaveText(studentName);
 await expect(page.locator('#lead-link-form [name="evidence_ref"]')).toHaveValue('');
 await page.getByRole('button',{name:'关联学生（待核实）'}).click();
 await expect(page.locator('#leads-list')).toContainText('已关联学生（待核实）');

 const leadCard=page.locator('#leads-list .record').filter({hasText:contactName});
 await leadCard.getByRole('combobox',{name:'当前线索来源'}).selectOption('市场转入');
 await expect(page.locator('#toast')).toContainText('来源已更新');
 await page.locator('#refresh-button').click();
 await expect(leadCard.getByRole('combobox',{name:'当前线索来源'})).toHaveValue('市场转入');

 // Step 2(c): one-click jump to create opportunity with student & notes carried over
 await page.getByRole('button',{name:'去建商机（'+studentName+'） →',exact:true}).click();
 await expect(page.locator('#page-title')).toHaveText('销售商机');
 await expect(page.locator('#opportunity-form [name="student_id"] option:checked')).toHaveText(studentName);
 await expect(page.locator('#opportunity-carry-hint')).toContainText('周末可试听英语与数学');
 await page.locator('#opportunity-form [name="predicted_yuan"]').fill('3800');
 await page.getByRole('button',{name:'创建销售商机'}).click();
 await expect(page.locator('#opportunities-list')).toContainText(studentName);

 // Step 3: one click on the opportunity carries the student and opens a task.
 await page.locator('#opportunities-list .record').filter({hasText:studentName}).getByRole('button',{name:'记跟进',exact:true}).click();
 await expect(page.locator('#business-status')).toContainText('已读取');
 const defaultTaskAt=await page.locator('#business-form [name="at"]').inputValue();
 expect(defaultTaskAt).toMatch(/T10:00$/);
 expect(new Date(defaultTaskAt).getTime()).toBeGreaterThan(Date.now()+3600_000);
 await expect(page.locator('#business-task-scope-hint')).toContainText(studentName);
 await page.locator('#business-student').selectOption({label:studentName});
 await expect(page.locator('#business-opportunity option:checked')).toContainText(studentName);
 await expect(page.locator('#business-form [name="title"]')).toHaveValue('');
 await page.locator('#business-save').click();
 await expect(page.locator('#business-records')).toContainText('[跟进任务] · '+studentName);
 await expect(page.locator('#business-summary')).toContainText('逾期任务0');

 // Step 4: trial presets
 await page.locator('#business-kind').selectOption('trials');
 await expect(page.locator('#business-trial-presets')).toBeVisible();
 await expect(page.locator('#business-form [name="at"]')).toHaveValue(/T10:00$/);
 await page.getByRole('button',{name:'下午 16:00',exact:true}).click();
 await expect(page.locator('#business-form [name="at"]')).toHaveValue(/T16:00$/);
 await page.locator('#business-student').selectOption({label:studentName});
 await page.locator('#business-form [name="title"]').fill('英语试听申请'+suffix);
 await page.locator('#business-save').click();
 await expect(page.locator('#business-records')).toContainText('[试听申请] · '+studentName);

 // Step 5: Course 1 fields before Course 2 + live total preview
 await page.locator('#business-kind').selectOption('quotes');
 await page.locator('#business-student').selectOption({label:studentName});
 await page.locator('#business-form [name="title"]').fill('双科方案'+suffix);
 await page.locator('#business-form [name="course_label"]').fill('数学');
 await page.locator('#business-form [name="quantity"]').fill('1');
 await page.locator('#business-form [name="amount"]').fill('200');
 await expect(page.locator('#business-form [data-field-label="amount"]')).toHaveText('第 1 门课程 · 每课时价格（元）');
 await page.locator('#business-add-line').click();
 await expect(page.locator('#business-extra-lines .business-quote-line-head')).toHaveText('第 2 门课程明细');
 const c1Box=await page.locator('#business-form [name="amount"]').boundingBox();
 const c2Box=await page.locator('#business-extra-lines [data-quote-field="course"]').boundingBox();
 expect(c1Box.y).toBeLessThan(c2Box.y);
 await page.locator('#business-extra-lines [data-quote-field="course"]').fill('英语');
 await page.locator('#business-extra-lines [data-quote-field="quantity"]').fill('1');
 await page.locator('#business-extra-lines [data-quote-field="amount"]').fill('150');
 await expect(page.locator('#business-quote-preview')).toContainText('¥350.00');
 await page.locator('#business-extra-lines [data-quote-field="amount"]').fill('180');
 await expect(page.locator('#business-quote-preview')).toContainText('¥380.00');
 await page.locator('#business-save').click();
 await expect(page.locator('#business-records')).toContainText('¥380.00');

 // Verify 390px mobile layout has zero horizontal overflow
 await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
});

test('Step 5 & Step 7: switching consultants clears consultation time; 401 expiry restores draft only for same employee in memory',async({page})=>{
 await page.goto('/?workspace=legacy');
 const login=async account=>{
  await page.locator('#login-form select').selectOption(account);
  await page.locator('#login-form input').fill('fictional-strong-ui-demo-passphrase-0001');
  await page.getByRole('button',{name:'进入工作台',exact:true}).click();
  await expect(page.locator('#workspace')).toBeVisible();
 };
 await login('sales-a');
 const student='草稿学生'+Date.now();
 await page.locator('nav button[data-view="students"]').click();
 await page.locator('#student-form [name="display_name"]').fill(student);
 await page.getByRole('button',{name:'保存学生档案'}).click();
 await expect(page.locator('#students-list')).toContainText(student);

 await page.locator('nav button[data-view="opportunities"]').click();
 await page.locator('#opportunity-form [name="student_id"]').selectOption({label:student});
 await page.getByRole('button',{name:'创建销售商机'}).click();

 // Set custom old consultation timestamp as A, then log out
 await page.locator('nav button[data-view="leads"]').click();
 await page.locator('#event-form [name="occurred_at"]').fill('2026-11-10T17:21');
 await page.getByRole('button',{name:'退出演示账号'}).click();

 // Consultant B should never inherit A's 17:21 timestamp
 await login('sales-b');
 await page.locator('nav button[data-view="leads"]').click();
 await expect(page.locator('#event-form [name="occurred_at"]')).not.toHaveValue('2026-11-10T17:21');
 await page.getByRole('button',{name:'退出演示账号'}).click();

 // Prepare an unsaved quote draft for A and simulate 401 expiry during save
 await login('sales-a');
 await page.locator('#workspace-business-nav').click();
 await page.locator('#business-kind').selectOption('quotes');
 await page.locator('#business-student').selectOption({label:student});
 await page.locator('#business-form [name="title"]').fill('超时保护报价');
 await page.locator('#business-form [name="course_label"]').fill('数学');
 await page.locator('#business-form [name="quantity"]').fill('1');
 await page.locator('#business-form [name="amount"]').fill('200');
 await page.locator('#business-add-line').click();
 await page.locator('#business-extra-lines [data-quote-field="course"]').fill('英语');
 await page.locator('#business-extra-lines [data-quote-field="quantity"]').fill('1');
 await page.locator('#business-extra-lines [data-quote-field="amount"]').fill('180');

 await page.route('**/api/v1/isolated-workspace/quotes',async route=>{
  if(route.request().method()==='POST'){
   await route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({code:'AUTH_REQUIRED',message:'expired'})});
  }else await route.continue();
 },{times:1});
 await page.locator('#business-save').click();
 await expect(page.locator('#session-expired-notice')).toBeVisible();
 await expect(page.locator('#session-expired-notice')).toContainText('模拟销售顾问 A');
 expect(await page.evaluate(()=>localStorage.length+sessionStorage.length)).toBe(0);

 // Re-login as same employee A restores draft automatically
 await login('sales-a');
 await expect(page.locator('#toast')).toContainText('已恢复刚才未保存的草稿');
 await expect(page.locator('#page-title')).toHaveText('业务计划与任务');
 await expect(page.locator('#business-form [name="title"]')).toHaveValue('超时保护报价');
 await expect(page.locator('#business-form [name="amount"]')).toHaveValue('200');
 await expect(page.locator('#business-extra-lines [data-quote-field="amount"]')).toHaveValue('180');
 await expect(page.locator('#business-quote-preview')).toContainText('¥380.00');
 await page.locator('#business-save').click();
 await expect(page.locator('#business-records')).toContainText('超时保护报价');

 // Another expired draft belonging to A must NOT be restored to Consultant B (and is discarded)
 await page.locator('#business-form [name="title"]').fill('绝不泄露给B的草稿');
 await page.locator('#business-student').selectOption({label:student});
 await page.locator('#business-form [name="course_label"]').fill('物理');
 await page.locator('#business-form [name="amount"]').fill('100');
 await page.route('**/api/v1/isolated-workspace/quotes',async route=>{
  if(route.request().method()==='POST'){
   await route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({code:'AUTH_REQUIRED',message:'expired'})});
  }else await route.continue();
 },{times:1});
 await page.locator('#business-save').click();
 await expect(page.locator('#session-expired-notice')).toBeVisible();
 await login('sales-b');
 await expect(page.locator('#page-title')).toHaveText('工作概览');
 await page.locator('#workspace-business-nav').click();
 await expect(page.locator('#business-form [name="title"]')).toHaveValue('');
 await expect(page.locator('#business-records')).not.toContainText('绝不泄露给B的草稿');
});


