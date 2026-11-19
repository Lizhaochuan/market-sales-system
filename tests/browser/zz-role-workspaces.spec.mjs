import {test,expect} from '@playwright/test';import pg from 'pg';import {readFile} from 'node:fs/promises';import {createApp} from '../../src/app.mjs';
let pool,app,url;const pass='0';
test.beforeAll(async()=>{process.env.MS_STAGE='isolated-test';pool=new pg.Pool({connectionString:process.env.DATABASE_URL});for(const [v,f]of[[34,'039_v34_sales_loop.sql'],[35,'040_role_workspaces.sql']]){const e=(await pool.query("SELECT to_regclass('ms_workspace.schema_versions') t")).rows[0].t;if(!e||!(await pool.query('SELECT 1 FROM ms_workspace.schema_versions WHERE version=$1',[v])).rowCount)await pool.query(await readFile(new URL('../../db/workspace-migrations/'+f,import.meta.url),'utf8'));}await pool.query(await readFile(new URL('../fixtures/v34-demo-finance.sql',import.meta.url),'utf8'));await pool.query(await readFile(new URL('../fixtures/role-workspaces-demo.sql',import.meta.url),'utf8'));app=createApp(pool,{secret:'fictional-role-browser-key-at-least32',devLoginSecret:pass,workspaceEnabled:true,v34Enabled:true,roleWorkspaces:true});await new Promise(r=>app.listen(0,'127.0.0.1',r));url='http://127.0.0.1:'+app.address().port;});
test.afterAll(async()=>{if(app)await new Promise(r=>app.close(r));await pool?.end();});
async function login(page,who='sales-a'){await page.goto(url);await page.locator('#login-form [name="account_code"]').selectOption(who);await page.locator('#login-form [name="passphrase"]').fill(pass);await page.locator('#login-form').getByRole('button',{name:'进入工作台'}).click();await expect(page.locator('#sales-workflow')).toBeVisible();}
async function lookup(page,phone){await page.getByRole('button',{name:'销售 · 新建 / 查询 Leads',exact:true}).click();await page.locator('#v35-lookup [name="phone"]').fill(phone);await page.locator('#v35-lookup [name="phone"]').press('Enter');}
async function nextTomorrow(page,f){await f.locator('.v34-next').getByRole('button',{name:'明天',exact:true}).click();}
const phone=()=>String(13000000000+Math.floor(Math.random()*900000000));
test('role UI: sales lands on dated todo, phone intake opens one customer operation at a time',async({page})=>{
 await login(page);await expect(page.locator('#v34-tasks')).toBeVisible();await expect(page.getByRole('button',{name:'市场 · 市场 Leads',exact:true})).toBeHidden();const number=phone();await lookup(page,number);const f=page.locator('#v34-intake');await expect(f).toBeVisible();await f.locator('[name="contact_name"]').fill('卡片验收家长');await f.locator('[name="student_name"]').fill('卡片验收学生');await nextTomorrow(page,f);await f.getByRole('button',{name:'保存客户及首次安排'}).click();await expect(page.locator('#v35-actions')).toBeVisible();await expect(page.locator('#v34-followup')).toHaveCount(0);await expect(page.locator('#v34-contact')).toHaveCount(0);await expect(page.locator('#v34-source')).toHaveCount(0);
 await expect(page.locator('#v35-actions').getByRole('button',{name:'记跟进',exact:true})).toHaveCount(0);await page.locator('#v34-primary').getByRole('button',{name:'去跟进 / 记录沟通结果',exact:true}).click();const follow=page.locator('#v34-followup');await expect(follow).toBeVisible();await expect(page.locator('#v34-quote')).toHaveCount(0);await follow.locator('[name="result"]').selectOption('failed');await expect(follow.locator('[name="next_kind"]')).toBeHidden();await expect(follow.locator('[name="next_kind"] option[value="trial"]')).toHaveJSProperty('disabled',true);await nextTomorrow(page,follow);await follow.getByRole('button',{name:'保存结果并安排下一步'}).click();await expect(page.locator('#v35-actions')).toBeVisible();await expect(follow).toHaveCount(0);
 await page.getByRole('button',{name:'我的待办',exact:true}).click();const day=await page.evaluate(()=>{const d=new Date();d.setDate(d.getDate()+1);return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);});await page.locator('#v34-tasks [name="task_day"]').fill(day);await page.locator('#v34-tasks [name="task_day"]').dispatchEvent('change');await expect(page.locator('#v35-task-count')).toContainText('需要跟进');const row=page.locator('#v34-tasks article').filter({hasText:'卡片验收学生'}).first();await row.getByRole('button',{name:'查看进展 / 继续跟进'}).click();await expect(page.locator('#v34-followup')).toBeVisible();await page.getByRole('button',{name:'返回客户概览',exact:true}).click();await expect(page.locator('#v35-actions')).toBeVisible();await expect(page.locator('#sales-workflow')).toContainText('当前来源');
 await page.locator('#v35-actions').getByRole('button',{name:'约面谈 / 试听',exact:true}).click();const ap=page.locator('#v34-appointment');await expect(ap.locator('[name="place"]')).toBeHidden();await ap.locator('[name="type"]').selectOption('trial');await expect(ap.getByLabel('教室名称')).toBeVisible();await expect(ap.getByLabel('教室名称')).toHaveValue('101教室');await ap.locator('[name="type"]').selectOption('meeting');await expect(ap.locator('[name="place"]')).toBeHidden();const time=await page.evaluate(()=>{const d=new Date();d.setDate(d.getDate()+2);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);});await ap.locator('[name="at"]').fill(time);await ap.getByRole('button',{name:'保存预约'}).click();await expect(page.locator('#v35-actions').getByRole('button',{name:'补充日常沟通',exact:true})).toBeVisible();await page.locator('#v34-primary').getByRole('button',{name:'记录面谈结果',exact:true}).click();await expect(page.locator('form[id^="activity-"]')).toBeVisible();await expect(page.locator('form[id^="retime-"]')).toHaveCount(0);
 await page.getByRole('button',{name:'返回客户概览',exact:true}).click();await page.locator('#v35-actions').getByRole('button',{name:'课程方案',exact:true}).click();await page.locator('#v34-quote').getByRole('button',{name:'保存课程方案',exact:true}).click();await expect(page.locator('#v35-actions').getByRole('button',{name:'办理报名',exact:true})).toBeVisible();await page.locator('#v35-actions').getByRole('button',{name:'办理报名',exact:true}).click();await expect(page.locator('#v34-enroll')).toBeVisible();await expect(page.locator('#v34-quote')).toHaveCount(0);
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('role UI: market handoff retains one Lead, sales cannot see private notes, roles have different home pages',async({page})=>{
 const number=phone(),name='市场交接'+number;await login(page,'market-a');await expect(page.locator('#v35-market')).toBeVisible();await expect(page.getByRole('button',{name:'我的待办',exact:true})).toBeHidden();const form=page.locator('#v35-market-intake');await form.locator('..').locator('summary').click();await form.locator('[name="phone"]').fill(number);await form.locator('[name="contact_name"]').fill(name);await form.locator('[name="student_name"]').fill('交接验收学生');await form.locator('[name="notes"]').fill('市场私有备注不得向销售展示');await form.getByRole('button',{name:'保存并提交销售交接'}).click();await expect(page.locator('#v35-market')).toContainText(name);
 await login(page,'market-b');await expect(page.locator('#v35-market')).not.toContainText(name);await login(page,'market-manager');await expect(page.locator('#v35-market')).toContainText(name);
 await login(page);await lookup(page,number);await expect(page.locator('#v35-lookup')).toContainText('匹配到市场线索');await expect(page.locator('#sales-workflow')).not.toContainText('市场私有备注');await page.getByRole('button',{name:'接收并安排首次跟进'}).click();const claim=page.locator('#v35-claim');await nextTomorrow(page,claim);await claim.getByRole('button',{name:'接收并保存首次安排'}).click();await expect(page.locator('#v35-actions')).toBeVisible();await expect(page.locator('#sales-workflow')).toContainText('市场活动');
 await login(page,'sales-b');await lookup(page,number);await expect(page.locator('#v35-lookup')).toContainText('已有销售负责');await expect(page.locator('#v35-lookup')).not.toContainText('交接验收学生');await login(page,'general-admin');await expect(page.getByRole('button',{name:'市场 · 市场 Leads',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'销售 · 新建 / 查询 Leads',exact:true})).toBeVisible();
});
test('role UI: customer details stay behind More, expiry restores only the current operation card',async({page})=>{
 await login(page);await lookup(page,phone());const intake=page.locator('#v34-intake');await intake.locator('[name="contact_name"]').fill('草稿卡片家长');await nextTomorrow(page,intake);await intake.getByRole('button',{name:'保存客户及首次安排'}).click();await page.getByRole('button',{name:'更多操作',exact:true}).click();await page.getByRole('button',{name:'修正当前获客来源',exact:true}).click();await expect(page.locator('#v34-source')).toBeVisible();await expect(page.locator('#v34-followup')).toHaveCount(0);await page.getByRole('button',{name:'返回客户概览',exact:true}).click();await page.locator('#v34-primary').getByRole('button',{name:'去跟进 / 记录沟通结果',exact:true}).click();await page.locator('#v34-followup [name="notes"]').fill('只恢复本次卡片草稿');await page.evaluate(()=>logout('expired'));await page.locator('#login-form [name="passphrase"]').fill(pass);await page.locator('#login-form').getByRole('button',{name:'进入工作台'}).click();await expect(page.locator('#v34-followup [name="notes"]')).toHaveValue('只恢复本次卡片草稿');await expect(page.locator('#v34-source')).toHaveCount(0);
});
test('role UI: no singleton next selector, legacy timer disabled and refresh never clears typed intake',async({page})=>{
 await page.clock.install();const legacyRequests=[];page.on('request',r=>{if(r.url().includes('/isolated-workspace/automation/run'))legacyRequests.push(r.url());});
 await login(page);await lookup(page,phone());const f=page.locator('#v34-intake');await expect(f.locator('[name="next_existing"]')).toBeHidden();await f.locator('[name="contact_name"]').fill('一分钟后仍保留的家长');await f.locator('[name="student_name"]').fill('未保存的学生');await f.locator('[name="notes"]').fill('录到一半不能清空');await nextTomorrow(page,f);const at=await f.locator('[name="next_at"]').inputValue();
 await page.clock.runFor(61000);await expect(f.locator('[name="contact_name"]')).toHaveValue('一分钟后仍保留的家长');await expect(f.locator('[name="notes"]')).toHaveValue('录到一半不能清空');await expect(f.locator('[name="next_at"]')).toHaveValue(at);expect(legacyRequests).toHaveLength(0);await expect(page.locator('#toast')).not.toContainText('请使用本角色的工作台入口');
 await page.getByRole('button',{name:'刷新数据',exact:true}).click();await expect(f.locator('[name="student_name"]')).toHaveValue('未保存的学生');await f.getByRole('button',{name:'保存客户及首次安排'}).click();await expect(page.locator('#v35-actions')).toBeVisible();
 await page.locator('#v34-primary').getByRole('button',{name:'去跟进 / 记录沟通结果',exact:true}).click();const follow=page.locator('#v34-followup');await follow.locator('[name="notes"]').fill('临时断网时保留');await page.route('**/workflow/options',r=>r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'TEMPORARY',message:'临时不可用'})}));await page.getByRole('button',{name:'刷新数据',exact:true}).click();await expect(page.locator('#v34-message')).toContainText('未保存的输入已保留');await expect(follow.locator('[name="notes"]')).toHaveValue('临时断网时保留');await page.unroute('**/workflow/options');await page.route('**/workflow/options',r=>r.fulfill({status:403,contentType:'application/json',body:JSON.stringify({code:'FORBIDDEN',message:'角色已撤销'})}));await page.getByRole('button',{name:'刷新数据',exact:true}).click();await expect(page.locator('#sales-workflow')).toContainText('角色已撤销');await expect(page.locator('#v34-followup')).toHaveCount(0);
});
test('continuous cards: completed meeting → dated confirmation call → booked trial → explicit result → followup',async({page})=>{
 await login(page);const number=phone(),name='连续流程'+number;await lookup(page,number);const f=page.locator('#v34-intake');await f.locator('[name="contact_name"]').fill(name);await f.locator('[name="student_name"]').fill('连续流程学生');await f.locator('[name="notes"]').fill('刚面谈完，需电话确认试听时间');await f.locator('[name="initial_method"]').selectOption('campus');await f.locator('[name="initial_stage"]').selectOption('needs_confirmed');await f.locator('[name="next_action"]').selectOption('confirm_trial');await expect(f.locator('[name="next_title"]')).toHaveValue('联系家长确定试听时间');await nextTomorrow(page,f);await f.getByRole('button',{name:'保存客户及首次安排'}).click();await expect(page.locator('#v35-continuation')).toContainText('本次记录已保存');
 await page.locator('#v35-continuation').getByRole('button',{name:'返回我的待办',exact:true}).click();const dates=await page.evaluate(()=>[1,2,3].map(n=>{const d=new Date();d.setDate(d.getDate()+n);d.setHours(10,0,0,0);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);}));await page.locator('[name="task_day"]').fill(dates[0].slice(0,10));await page.locator('[name="task_day"]').dispatchEvent('change');await page.locator('#v35-day-tasks article').filter({hasText:'连续流程学生'}).getByRole('button',{name:'查看进展 / 继续跟进'}).click();const call=page.locator('#v34-followup');await expect(call).toBeVisible();await expect(call).toContainText('本次待办：联系家长确定试听时间');await expect(call).toContainText('刚面谈完');await call.locator('[name="result"]').selectOption('communicated');await call.locator('[name="notes"]').fill('已和家长确认试听时间');await call.locator('[name="next_kind"]').selectOption('trial');await call.locator('[name="next_booking_at"]').fill(dates[1]);await call.getByRole('button',{name:'保存结果并安排下一步'}).click();await expect(page.locator('#v35-continuation')).toContainText('预约已保存');
 await page.locator('#v35-continuation').getByRole('button',{name:'返回我的待办',exact:true}).click();await page.locator('[name="task_day"]').fill(dates[1].slice(0,10));await page.locator('[name="task_day"]').dispatchEvent('change');await expect(page.getByText('后续安排',{exact:true})).toHaveCount(0);await page.locator('#v35-day-tasks article').filter({hasText:'连续流程学生'}).getByRole('button',{name:'查看进展 / 继续跟进'}).click();const actual=page.locator('form[id^="activity-"]');await expect(actual).toBeVisible();await expect(actual.locator('[name="transition"]')).toHaveValue('');await actual.locator('[name="transition"]').selectOption('completed');await actual.locator('[name="feedback"]').fill('实际试听已结束，家长反馈满意');await expect(actual.locator('[name="next_action"]')).toHaveValue('trial_feedback');await actual.locator('[name="next_at"]').fill(dates[2]);await actual.getByRole('button',{name:'保存实际结果与下一步'}).click();await expect(page.locator('#v35-continuation')).toContainText('试听已结束，继续跟进');await page.getByRole('button',{name:'现在记录试听回访',exact:true}).click();await expect(page.locator('#v34-followup')).toContainText('回访家长试听感受');
});
test('daily tasks: only selected day and real overdue; already booked intake creates trial directly',async({page})=>{
 await login(page);const number=phone();await lookup(page,number);const f=page.locator('#v34-intake');await f.locator('[name="contact_name"]').fill('当场约好'+number);await f.locator('[name="student_name"]').fill('直接试听'+number);await f.locator('[name="initial_method"]').selectOption('phone');await f.locator('[name="next_kind"]').selectOption('trial');const date=await page.evaluate(()=>{const d=new Date();d.setDate(d.getDate()+3);d.setHours(10,0,0,0);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);});await f.locator('[name="next_booking_at"]').fill(date);await expect(f.locator('[name="next_at"]')).toBeHidden();await f.getByRole('button',{name:'保存客户及首次安排'}).click();await expect(page.locator('#v35-continuation')).toContainText('预约已保存');await expect(page.locator('#v34-primary')).toContainText('学生试听');
 const labels=await page.evaluate(async()=>{const labels=['今日不得误判'+Date.now(),'真正逾期'+Date.now()];for(let i=0;i<2;i++){const d=new Date();d.setDate(d.getDate()-i);d.setHours(12,0,0,0);await api('/api/v1/isolated-workspace/workflow',{method:'POST',body:{contact_name:labels[i],contact_info:String(13000000000+Math.floor(Math.random()*900000000)),origin_group:'sales',source:'到店',next:{action:'call',method:'phone',title:labels[i],due_at:d.toISOString()}}});}return labels;});await page.locator('#v35-continuation').getByRole('button',{name:'返回我的待办',exact:true}).click();await page.locator('[name="task_day"]').fill(date.slice(0,10));await page.locator('[name="task_day"]').dispatchEvent('change');await expect(page.locator('#v35-overdue-tasks')).not.toContainText(labels[0]);await expect(page.locator('#v35-overdue-tasks')).toContainText(labels[1]);await expect(page.locator('#v35-day-tasks')).toContainText('直接试听'+number);await expect(page.getByText('后续安排',{exact:true})).toHaveCount(0);
});
test('role UI: my-leads search, single-card draft restore, sibling student, meeting stage, and declined carry-over',async({page})=>{
 await login(page);const number=phone(),parent='全闭环家长'+number.slice(-4);await lookup(page,number);const f=page.locator('#v34-intake');
 await expect(f.locator('[name="next_kind"]')).toBeHidden();await f.locator('[name="initial_method"]').selectOption('phone_failed');await expect(f.locator('[name="next_kind"]')).toBeHidden();
 await f.locator('[name="contact_name"]').fill(parent);await f.locator('[name="student_name"]').fill('大宝'+number.slice(-4));await nextTomorrow(page,f);await f.getByRole('button',{name:'保存客户及首次安排'}).click();
 await page.getByRole('button',{name:'销售 · 新建 / 查询 Leads',exact:true}).click();await expect(page.locator('#v35-my-leads')).toBeVisible();await page.locator('#v35-my-leads [name="my_lead_search"]').fill(number);await page.locator('#v35-my-leads article').filter({hasText:parent}).getByRole('button',{name:'打开客户'}).click();
 await page.locator('#v34-primary').getByRole('button',{name:'去跟进 / 记录沟通结果',exact:true}).click();await page.locator('#v34-followup [name="notes"]').fill('保存草稿稍后恢复');await page.locator('#v34-followup').getByRole('button',{name:'先保存草稿',exact:true}).click();
 await expect(page.locator('#v35-actions').getByRole('button',{name:'恢复未完成跟进草稿',exact:true})).toBeVisible();await page.locator('#v35-actions').getByRole('button',{name:'恢复未完成跟进草稿',exact:true}).click();await expect(page.locator('#v34-followup [name="notes"]')).toHaveValue('保存草稿稍后恢复');
 await page.getByRole('button',{name:'返回客户概览',exact:true}).click();await page.locator('#v35-actions').getByRole('button',{name:'课程方案',exact:true}).click();await page.locator('#v34-quote [name="student_id"]').selectOption('__new__');await page.locator('#v34-quote [name="student_name"]').fill('二宝'+number.slice(-4));await page.locator('#v34-quote').getByRole('button',{name:'保存课程方案',exact:true}).click();await expect(page.locator('#sales-workflow')).toContainText('二宝'+number.slice(-4));
 await page.locator('#v34-primary').getByRole('button',{name:'去跟进 / 记录沟通结果',exact:true}).click();await page.locator('#v34-followup [name="result"]').selectOption('communicated');await page.locator('#v34-followup [name="notes"]').fill('家长明确表示改去住家旁机构');await page.locator('#v34-followup [name="stage"]').selectOption('declined');
 await expect(page.locator('#v34-lost')).toBeVisible();await expect(page.locator('#v34-lost [name="feedback"]')).toHaveValue('家长明确表示改去住家旁机构');
});
test('PC-01: daily todo quick filters, overdue badges, refresh preservation, and 390px layout',async({page})=>{
 await login(page);
 await expect(page.locator('#v34-tasks')).toBeVisible();
 await expect(page.locator('#v35-task-filters')).toBeVisible();
 const filters=page.locator('#v35-task-filters');
 await expect(filters.getByRole('button',{name:'全部当日'})).toBeVisible();
 await expect(filters.getByRole('button',{name:'已逾期'})).toBeVisible();
 await expect(filters.getByRole('button',{name:'今日面谈/试听'})).toBeVisible();
 await expect(filters.getByRole('button',{name:'待审批/待接手'})).toBeVisible();

 const callName='当日电话'+Date.now();
 const trialName='当日试听'+Date.now();
 const overdueName='逾期日常'+Date.now();

 // Explicitly compute reference dates strictly in Asia/Shanghai timezone
 const shTodayStr=await page.evaluate(()=>{
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 });
 const [shY,shM,shD]=shTodayStr.split('-').map(Number);
 const shNoonUtc=Date.UTC(shY,shM-1,shD,4,0,0); // 12:00 in Asia/Shanghai is 04:00 UTC
 const dTodayIso=new Date(shNoonUtc).toISOString();
 const dOverdueIso=new Date(shNoonUtc-2*86400000).toISOString();
 const shTomorrowStr=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(shNoonUtc+86400000));

 await page.evaluate(async({cName,tName,oName,todayIso,overdueIso})=>{
  await api('/api/v1/isolated-workspace/workflow',{method:'POST',body:{contact_name:cName,student_name:cName+'学生',contact_info:String(13000000000+Math.floor(Math.random()*900000000)),origin_group:'sales',source:'到店',next:{action:'call',method:'phone',title:'跟进电话'+cName,due_at:todayIso}}});
  await api('/api/v1/isolated-workspace/workflow',{method:'POST',body:{contact_name:tName,student_name:tName+'学生',contact_info:String(13000000000+Math.floor(Math.random()*900000000)),origin_group:'sales',source:'到店',next:{appointment:{type:'trial',student_name:tName+'学生',due_at:todayIso,place:'101教室',course:'体验课',state:'confirmed'}}}});
  await api('/api/v1/isolated-workspace/workflow',{method:'POST',body:{contact_name:oName,student_name:oName+'学生',contact_info:String(13000000000+Math.floor(Math.random()*900000000)),origin_group:'sales',source:'到店',next:{action:'call',method:'phone',title:'逾期跟进'+oName,due_at:overdueIso}}});
 },{cName:callName,tName:trialName,oName:overdueName,todayIso:dTodayIso,overdueIso:dOverdueIso});

 await page.evaluate(()=>window.__refreshBusinessWorkspace());

 // 1. "全部当日" default: both call and trial appear
 await expect(page.locator('#v35-day-tasks')).toBeVisible();
 await expect(page.locator('#v35-day-tasks')).toContainText(callName);
 await expect(page.locator('#v35-day-tasks')).toContainText(trialName);

 // 2. "今日面谈/试听" filter: positive and negative assertions
 await filters.getByRole('button',{name:'今日面谈/试听'}).click();
 await expect(filters.getByRole('button',{name:'今日面谈/试听'})).toHaveClass(/primary/);
 await expect(page.locator('#v35-day-tasks')).toContainText(trialName);
 await expect(page.locator('#v35-day-tasks')).not.toContainText(callName);
 await expect(page.locator('#v35-handover-tasks')).toBeHidden();

 // Empty state for appointments on a day without appointments
 await page.locator('#v34-tasks [name="task_day"]').fill(shTomorrowStr);
 await page.locator('#v34-tasks [name="task_day"]').dispatchEvent('change');
 await expect(page.locator('#v35-day-tasks')).toContainText('当天没有面谈或试听安排');
 await page.locator('#v34-tasks [name="task_day"]').fill(shTodayStr);
 await page.locator('#v34-tasks [name="task_day"]').dispatchEvent('change');
 await expect(page.locator('#v35-day-tasks')).toContainText(trialName);

 // Refresh preserves appointment filter
 await page.evaluate(()=>window.__refreshBusinessWorkspace());
 await expect(filters.getByRole('button',{name:'今日面谈/试听'})).toHaveClass(/primary/);
 await expect(page.locator('#v35-day-tasks')).toContainText(trialName);
 await expect(page.locator('#v35-day-tasks')).not.toContainText(callName);

 // 3. "已逾期" filter: positive and negative assertions
 await filters.getByRole('button',{name:'已逾期'}).click();
 await expect(filters.getByRole('button',{name:'已逾期'})).toHaveClass(/primary/);
 await expect(page.locator('#v35-overdue-tasks')).toBeVisible();
 await expect(page.locator('#v35-overdue-tasks')).toContainText('已逾期');
 await expect(page.locator('#v35-overdue-tasks')).toContainText(overdueName);
 await expect(page.locator('#v35-day-tasks')).toBeHidden();
 await expect(page.locator('#v35-handover-tasks')).toBeHidden();

 // 4. "待审批/待接手" filter for sales consultant (sales-a): daily tasks hidden, no supervisor approvals exposed
 await filters.getByRole('button',{name:'待审批/待接手'}).click();
 await expect(filters.getByRole('button',{name:'待审批/待接手'})).toHaveClass(/primary/);
 await expect(page.locator('#v35-day-tasks')).toBeHidden();
 await expect(page.locator('#v35-overdue-tasks')).toBeHidden();
 await expect(page.locator('#v35-task-count')).toBeHidden();
 await expect(page.locator('#v35-approvals')).toHaveCount(0);
 await expect(page.locator('#v35-handover-tasks')).toBeVisible();
 await expect(page.locator('#v35-handover-tasks')).toContainText('暂无待审批或待接手事项');

 // Refresh preserves handover filter
 await page.evaluate(()=>window.__refreshBusinessWorkspace());
 await expect(filters.getByRole('button',{name:'待审批/待接手'})).toHaveClass(/primary/);
 await expect(page.locator('#v35-day-tasks')).toBeHidden();
 await expect(page.locator('#v35-handover-tasks')).toBeVisible();

 // 5. Supervisor privilege separation: non-skippable assertion ensuring lead exists
 const leadRes=await pool.query("SELECT id FROM ms.leads WHERE organization_id='20000000-0000-4000-8000-000000000001' AND contact_name=$1",[callName]);
 expect(leadRes.rows.length).toBe(1);
 const leadId=leadRes.rows[0].id;
 const corrId='35000000-0000-4000-8000-'+String(Date.now()).slice(-12).padStart(12,'0');
 await pool.query("INSERT INTO ms_workspace.records(id,organization_id,owner_user_id,lead_id,kind,state,body) VALUES($1,'20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000011',$2,'corrections','pending',$3)",[corrId,leadId,JSON.stringify({type:'lead_transfer',requested_by:'20000000-0000-4000-8000-000000000011',target_owner:'20000000-0000-4000-8000-000000000012',reason:'主管复核交接'})]);
 await login(page,'supervisor');
 await page.locator('#v35-task-filters').getByRole('button',{name:'待审批/待接手'}).click();
 await expect(page.locator('#v35-approvals')).toBeVisible();
 await expect(page.locator('#v35-approvals')).toContainText('待主管独立复核');
 await expect(page.locator('#v35-day-tasks')).toBeHidden();

 // Switch back to sales-a: approvals section must NOT exist
 await login(page,'sales-a');
 await page.locator('#v35-task-filters').getByRole('button',{name:'待审批/待接手'}).click();
 await expect(page.locator('#v35-approvals')).toHaveCount(0);

 // 6. Return to "全部当日"
 await page.locator('#v35-task-filters').getByRole('button',{name:'全部当日'}).click();
 await expect(page.locator('#v35-day-tasks')).toBeVisible();

 // 7. 390px mobile viewport verification
 await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('PC-02: side-detail preserves list state, protects unsaved drafts, and enforces isolation/revocation',async({page})=>{
 await page.setViewportSize({width:1280,height:720});
 await login(page,'sales-a');

 // Create two leads for sales-a
 for(const name of ['PC02测试B','PC02测试A']){
  await lookup(page,phone());
  const f=page.locator('#v34-intake');
  await f.locator('[name="contact_name"]').fill(name);
  await f.locator('[name="student_name"]').fill(name+'学生');
  await nextTomorrow(page,f);
  await f.getByRole('button',{name:'保存客户及首次安排'}).click();
  await expect(page.locator('#v35-actions')).toBeVisible();
 }

 // Go to "我的客户列表"
 await page.getByRole('button',{name:'销售 · 新建 / 查询 Leads',exact:true}).click();
 const list=page.locator('#v35-my-leads');
 await expect(list).toBeVisible();
 await expect(list.locator('.v35-list-controls')).toBeVisible();

 // Apply search, filter, and sort
 await list.locator('[name="my_lead_search"]').fill('PC02测试');
 await list.locator('[name="my_lead_state"]').selectOption('open');
 await list.locator('[name="my_lead_sort"]').selectOption('name_asc');

 const rowsText=await list.locator('.v35-lead-compact strong').allTextContents();
 expect(rowsText.length).toBeGreaterThanOrEqual(2);
 const idxA=rowsText.findIndex(t=>t.includes('PC02测试A'));
 const idxB=rowsText.findIndex(t=>t.includes('PC02测试B'));
 expect(idxA).toBeGreaterThanOrEqual(0);
 expect(idxB).toBeGreaterThan(idxA);

 // Open PC02测试A in side-detail on 1280px wide screen
 await list.locator('.v35-lead-compact').filter({hasText:'PC02测试A'}).getByRole('button',{name:'打开客户'}).click();
 const side=page.locator('#v35-side-detail');
 await expect(side).toBeVisible();
 await expect(list).toBeVisible();
 await expect(list.locator('.v35-lead-compact.active')).toContainText('PC02测试A');

 // Single-operation card inside side-detail + unsaved draft protection on refresh
 await side.locator('#v34-primary').getByRole('button',{name:'去跟进 / 记录沟通结果',exact:true}).click();
 const follow=side.locator('#v34-followup');
 await expect(follow).toBeVisible();
 await expect(side.locator('#v34-quote')).toHaveCount(0);
 await follow.locator('[name="notes"]').fill('PC02未保存草稿保护');
 await follow.locator('[name="notes"]').evaluate(el=>{el.closest('form').dataset.userDirty='1';});
 await page.evaluate(()=>window.__refreshBusinessWorkspace());
 await expect(follow.locator('[name="notes"]')).toHaveValue('PC02未保存草稿保护');

 // Back to list preserves search, filter, sort
 await side.getByRole('button',{name:'返回客户列表',exact:true}).click();
 await expect(page.locator('#v35-side-detail')).toHaveCount(0);
 await expect(list).toBeVisible();
 await expect(list.locator('[name="my_lead_search"]')).toHaveValue('PC02测试');
 await expect(list.locator('[name="my_lead_state"]')).toHaveValue('open');
 await expect(list.locator('[name="my_lead_sort"]')).toHaveValue('name_asc');

 // Tasks view side-detail + back preserves taskFilter
 await page.getByRole('button',{name:'我的待办',exact:true}).click();
 await page.locator('#v35-task-filters').getByRole('button',{name:'已逾期'}).click();
 await page.locator('#v35-task-filters').getByRole('button',{name:'全部当日'}).click();
 const day=await page.evaluate(()=>{const d=new Date();d.setDate(d.getDate()+1);return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);});
 await page.locator('#v34-tasks [name="task_day"]').fill(day);
 await page.locator('#v34-tasks [name="task_day"]').dispatchEvent('change');
 await page.locator('#v34-tasks article').filter({hasText:'PC02测试A'}).first().getByRole('button',{name:'查看进展 / 继续跟进'}).click();
 await expect(page.locator('#v35-side-detail')).toBeVisible();
 await expect(page.locator('#v34-tasks')).toBeVisible();
 await page.locator('#v35-side-detail').getByRole('button',{name:'返回我的待办',exact:true}).click();
 await expect(page.locator('#v35-side-detail')).toHaveCount(0);

 // 390px narrow screen: opening detail hides list, back restores list with search preserved, no horizontal overflow
 await page.setViewportSize({width:390,height:844});
 await page.getByRole('button',{name:'销售 · 新建 / 查询 Leads',exact:true}).click();
 await page.locator('#v35-my-leads [name="my_lead_search"]').fill('PC02测试A');
 await page.locator('#v35-my-leads .v35-lead-compact').filter({hasText:'PC02测试A'}).getByRole('button',{name:'打开客户'}).click();
 await expect(page.locator('#v35-side-detail')).toBeVisible();
 await expect(page.locator('#v35-my-leads')).toBeHidden();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.locator('#v35-side-detail').getByRole('button',{name:'返回客户列表',exact:true}).click();
 await expect(page.locator('#v35-my-leads')).toBeVisible();
 await expect(page.locator('#v35-my-leads [name="my_lead_search"]')).toHaveValue('PC02测试A');

 // Role revocation (403) clears open detail and unsaved form
 await page.locator('#v35-my-leads .v35-lead-compact').filter({hasText:'PC02测试A'}).getByRole('button',{name:'打开客户'}).click();
 await expect(page.locator('#v35-side-detail')).toBeVisible();
 await page.route('**/api/v1/isolated-workspace/workflow/options',route=>route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({code:'FORBIDDEN',message:'角色已撤销'})}));
 await page.evaluate(()=>window.__refreshBusinessWorkspace());
 await expect(page.locator('#v35-side-detail')).toHaveCount(0);
 await expect(page.locator('#sales-workflow')).toContainText('角色已撤销');
 await page.unroute('**/api/v1/isolated-workspace/workflow/options');

 // Cross-employee isolation: sales-b cannot see sales-a leads or list search state
 await page.setViewportSize({width:1280,height:720});
 await login(page,'sales-b');
 await page.getByRole('button',{name:'销售 · 新建 / 查询 Leads',exact:true}).click();
 await expect(page.locator('#v35-my-leads [name="my_lead_search"]')).toHaveValue('');
 await expect(page.locator('#v35-my-leads')).not.toContainText('PC02测试A');
 await expect(page.locator('#v35-my-leads')).not.toContainText('PC02测试B');
});


