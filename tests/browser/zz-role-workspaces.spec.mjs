import {test,expect} from '@playwright/test';import pg from 'pg';import {readFile} from 'node:fs/promises';import {createApp} from '../../src/app.mjs';
let pool,app,url;const pass='0';
test.beforeAll(async()=>{process.env.MS_STAGE='isolated-test';pool=new pg.Pool({connectionString:process.env.DATABASE_URL});for(const [v,f]of[[34,'039_v34_sales_loop.sql'],[35,'040_role_workspaces.sql'],[36,'041_historical_student_links.sql'],[37,'042_appointment_supervision.sql'],[38,'043_followup_supervision.sql'],[39,'044_arrangement_supervision.sql'],[40,'045_appointment_supervision_evidence.sql']]){const e=(await pool.query("SELECT to_regclass('ms_workspace.schema_versions') t")).rows[0].t;if(!e||!(await pool.query('SELECT 1 FROM ms_workspace.schema_versions WHERE version=$1',[v])).rowCount)await pool.query(await readFile(new URL('../../db/workspace-migrations/'+f,import.meta.url),'utf8'));}await pool.query(await readFile(new URL('../fixtures/v34-demo-finance.sql',import.meta.url),'utf8'));await pool.query(await readFile(new URL('../fixtures/role-workspaces-demo.sql',import.meta.url),'utf8'));app=createApp(pool,{secret:'fictional-role-browser-key-at-least32',devLoginSecret:pass,workspaceEnabled:true,v34Enabled:true,roleWorkspaces:true});await new Promise(r=>app.listen(0,'127.0.0.1',r));url='http://127.0.0.1:'+app.address().port;});
test.afterAll(async()=>{if(app)await new Promise(r=>app.close(r));await pool?.end();});
async function login(page,who='sales-a'){await page.goto(url);await page.locator('#login-form [name="account_code"]').selectOption(who);await page.locator('#login-form [name="passphrase"]').fill(pass);await page.locator('#login-form').getByRole('button',{name:'进入工作台'}).click();await expect(page.locator('#sales-workflow')).toBeVisible();}
async function lookup(page,phone){await page.getByRole('button',{name:'销售 · 新建 / 查询 Leads',exact:true}).click();await page.locator('#v35-lookup [name="phone"]').fill(phone);await page.locator('#v35-lookup [name="phone"]').press('Enter');}
async function nextTomorrow(page,f){await f.locator('.v34-next').getByRole('button',{name:'明天',exact:true}).click();}
const phone=()=>String(13000000000+Math.floor(Math.random()*900000000));
test('role UI: sales lands on dated todo, phone intake opens one customer operation at a time',async({page})=>{
 await login(page);await expect(page.locator('#v34-tasks')).toBeVisible();await expect(page.getByRole('button',{name:'市场 · 市场 Leads',exact:true})).toBeHidden();const number=phone();await lookup(page,number);const f=page.locator('#v34-intake');await expect(f).toBeVisible();await f.locator('[name="contact_name"]').fill('卡片验收家长');await f.locator('[name="student_name"]').fill('卡片验收学生');await nextTomorrow(page,f);await f.getByRole('button',{name:'保存客户及首次安排'}).click();await expect(page.locator('#v35-actions')).toBeVisible();await expect(page.locator('#v34-followup')).toHaveCount(0);await expect(page.locator('#v34-contact')).toHaveCount(0);await expect(page.locator('#v34-source')).toHaveCount(0);
 await expect(page.locator('#v35-actions').getByRole('button',{name:'记跟进',exact:true})).toHaveCount(0);await page.locator('#v34-primary').getByRole('button',{name:'去跟进 / 记录沟通结果',exact:true}).click();const follow=page.locator('#v34-followup');await expect(follow).toBeVisible();await expect(page.locator('#v34-quote')).toHaveCount(0);await follow.locator('[name="result"]').selectOption('failed');await expect(follow.locator('[name="next_kind"]')).toBeHidden();await expect(follow.locator('[name="next_kind"] option[value="trial"]')).toHaveJSProperty('disabled',true);await nextTomorrow(page,follow);const day=(await follow.locator('[name="next_at"]').inputValue()).slice(0,10);await follow.getByRole('button',{name:'保存结果并安排下一步'}).click();await expect(page.locator('#v35-actions')).toBeVisible();await expect(follow).toHaveCount(0);
 await page.getByRole('button',{name:'我的待办',exact:true}).click();await page.locator('#v34-tasks [name="task_day"]').fill(day);await page.locator('#v34-tasks [name="task_day"]').dispatchEvent('change');await expect(page.locator('#v35-task-count')).toContainText('需要跟进');const row=page.locator('#v34-tasks article').filter({hasText:'卡片验收学生'}).first();await row.getByRole('button',{name:'查看进展 / 继续跟进'}).click();await expect(page.locator('#v34-followup')).toBeVisible();await page.getByRole('button',{name:'返回客户概览',exact:true}).click();await expect(page.locator('#v35-actions')).toBeVisible();await expect(page.locator('#sales-workflow')).toContainText('当前来源');
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
 const labels=await page.evaluate(async()=>{const shDay=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());const todayIso=new Date(shDay+'T18:00:00+08:00').toISOString();const pastIso=new Date(Date.now()-2*86400000).toISOString();const labels=['今日不得误判'+Date.now(),'真正逾期'+Date.now()];const times=[todayIso,pastIso];for(let i=0;i<2;i++){await api('/api/v1/isolated-workspace/workflow',{method:'POST',body:{contact_name:labels[i],contact_info:String(13000000000+Math.floor(Math.random()*900000000)),origin_group:'sales',source:'到店',next:{action:'call',method:'phone',title:labels[i],due_at:times[i]}}});}return labels;});await page.locator('#v35-continuation').getByRole('button',{name:'返回我的待办',exact:true}).click();await page.locator('[name="task_day"]').fill(date.slice(0,10));await page.locator('[name="task_day"]').dispatchEvent('change');await expect(page.locator('#v35-overdue-tasks')).not.toContainText(labels[0]);await expect(page.locator('#v35-overdue-tasks')).toContainText(labels[1]);await expect(page.locator('#v35-day-tasks')).toContainText('直接试听'+number);await expect(page.getByText('后续安排',{exact:true})).toHaveCount(0);
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
 const handoverRows=page.locator('#v35-handover-tasks article');
 const handoverCount=await handoverRows.count();
 if(handoverCount){
  for(let i=0;i<handoverCount;i++)await expect(handoverRows.nth(i)).toContainText(/待补安排|待确认接手|待主管独立复核/);
  await expect(page.locator('#v35-handover-tasks')).not.toContainText('暂无待审批或待接手事项');
 }else{
  await expect(page.locator('#v35-handover-tasks')).toContainText('暂无待审批或待接手事项');
 }
 await expect(page.locator('#v35-handover-tasks')).not.toContainText(callName);
 await expect(page.locator('#v35-handover-tasks')).not.toContainText(trialName);

 // Refresh preserves handover filter
 await page.evaluate(()=>window.__refreshBusinessWorkspace());
 await expect(filters.getByRole('button',{name:'待审批/待接手'})).toHaveClass(/primary/);
 await expect(page.locator('#v35-day-tasks')).toBeHidden();
 await expect(page.locator('#v35-handover-tasks')).toBeVisible();

 // 5. Supervisor privilege separation: non-skippable assertion ensuring lead exists
 const leadRes=await pool.query("SELECT l.id FROM ms.leads l JOIN ms.contacts c ON c.id=l.contact_id WHERE l.organization_id='20000000-0000-4000-8000-000000000001' AND c.display_name=$1",[callName]);
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

test('PC-02a: wide-screen side-detail preserves list search/filter/sort and unsaved drafts',async({page})=>{
 await page.setViewportSize({width:1280,height:720});
 await login(page,'sales-a');

 // Create two leads for sales-a
 let pc02Day='';
 for(const name of ['PC02测试B','PC02测试A']){
  await lookup(page,phone());
  const f=page.locator('#v34-intake');
  await f.locator('[name="contact_name"]').fill(name);
  await f.locator('[name="student_name"]').fill(name+'学生');
  await nextTomorrow(page,f);
  if(name==='PC02测试A')pc02Day=(await f.locator('[name="next_at"]').inputValue()).slice(0,10);
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
 await page.evaluate(()=>window.__refreshBusinessWorkspace());
 await expect(follow.locator('[name="notes"]')).toHaveValue('PC02未保存草稿保护');

 // Direct switch A -> B: B does NOT see A's draft
 await list.locator('.v35-lead-compact').filter({hasText:'PC02测试B'}).getByRole('button',{name:'打开客户'}).click();
 await expect(side.locator('h2')).toContainText('PC02测试B');
 await expect(side.locator('#v34-followup')).toHaveCount(0);

 // Direct switch B -> A: A's draft and card are restored without confusion
 await list.locator('.v35-lead-compact').filter({hasText:'PC02测试A'}).getByRole('button',{name:'打开客户'}).click();
 await expect(side.locator('h2')).toContainText('PC02测试A');
 await expect(side.locator('#v34-followup')).toBeVisible();
 await expect(side.locator('#v34-followup [name="notes"]')).toHaveValue('PC02未保存草稿保护');

 // Direct nav switch away from editing card: draft preserved across top navigation
 await page.getByRole('button',{name:'我的待办',exact:true}).click();
 await expect(page.locator('#v34-tasks')).toBeVisible();
 await page.getByRole('button',{name:'销售 · 新建 / 查询 Leads',exact:true}).click();
 await expect(list).toBeVisible();
 await list.locator('.v35-lead-compact').filter({hasText:'PC02测试A'}).getByRole('button',{name:'打开客户'}).click();
 await expect(side.locator('#v34-followup [name="notes"]')).toHaveValue('PC02未保存草稿保护');

 // Back to list preserves search, filter, sort and retains in-memory draft
 await side.getByRole('button',{name:'返回客户列表',exact:true}).click();
 await expect(page.locator('#v35-side-detail')).toHaveCount(0);
 await expect(list).toBeVisible();
 await expect(list.locator('[name="my_lead_search"]')).toHaveValue('PC02测试');
 await expect(list.locator('[name="my_lead_state"]')).toHaveValue('open');
 await expect(list.locator('[name="my_lead_sort"]')).toHaveValue('name_asc');

 // Re-open customer: unsaved draft is NOT silently lost
 await list.locator('.v35-lead-compact').filter({hasText:'PC02测试A'}).getByRole('button',{name:'打开客户'}).click();
 await expect(page.locator('#v35-side-detail')).toBeVisible();
 await expect(page.locator('#v34-followup [name="notes"]')).toHaveValue('PC02未保存草稿保护');

 // Actively confirm discard: clears draft and resets card
 page.once('dialog',d=>d.accept());
 await page.locator('#v35-side-detail').getByRole('button',{name:'放弃未保存修改',exact:true}).click();
 await expect(page.locator('#v34-followup')).toHaveCount(0);

 // Normal return without modifications is unaffected
 await page.locator('#v35-side-detail').getByRole('button',{name:'返回客户列表',exact:true}).click();
 await expect(page.locator('#v35-side-detail')).toHaveCount(0);
 await expect(list).toBeVisible();
 await list.locator('.v35-lead-compact').filter({hasText:'PC02测试A'}).getByRole('button',{name:'打开客户'}).click();
 await expect(page.locator('#v35-side-detail')).toBeVisible();
 await expect(page.locator('#v34-followup')).toHaveCount(0);
 await page.locator('#v35-side-detail').getByRole('button',{name:'返回客户列表',exact:true}).click();
 await expect(page.locator('#v35-side-detail')).toHaveCount(0);
 await expect(list).toBeVisible();

 // Tasks view side-detail + back to tasks
 await page.getByRole('button',{name:'我的待办',exact:true}).click();
 await expect(page.locator('#v34-tasks')).toBeVisible();
 const day=pc02Day;
 await page.locator('#v34-tasks [name="task_day"]').fill(day);
 await page.locator('#v34-tasks [name="task_day"]').dispatchEvent('change');
 await page.locator('#v34-tasks article').filter({hasText:'PC02测试A'}).first().getByRole('button',{name:'查看进展 / 继续跟进'}).click();
 await expect(page.locator('#v35-side-detail')).toBeVisible();
 await expect(page.locator('#v34-tasks')).toBeVisible();
 await page.locator('#v35-side-detail').getByRole('button',{name:'返回我的待办',exact:true}).click();
 await expect(page.locator('#v35-side-detail')).toHaveCount(0);
});

test('PC-02b: 390px narrow layout, 403 role revocation cleanup, and cross-employee isolation',async({page})=>{
 await page.setViewportSize({width:1280,height:720});
 await login(page,'sales-a');
 await lookup(page,phone());
 const f=page.locator('#v34-intake');
 await f.locator('[name="contact_name"]').fill('PC02隔离测试');
 await f.locator('[name="student_name"]').fill('PC02隔离学生');
 await nextTomorrow(page,f);
 await f.getByRole('button',{name:'保存客户及首次安排'}).click();
 await expect(page.locator('#v35-actions')).toBeVisible();

 // 390px narrow screen: opening detail hides list, back restores list with search preserved, no horizontal overflow
 await page.setViewportSize({width:390,height:844});
 await page.getByRole('button',{name:'销售 · 新建 / 查询 Leads',exact:true}).click();
 await expect(page.locator('#v35-my-leads')).toBeVisible();
 await page.locator('#v35-my-leads [name="my_lead_search"]').fill('PC02隔离测试');
 await page.locator('#v35-my-leads .v35-lead-compact').filter({hasText:'PC02隔离测试'}).getByRole('button',{name:'打开客户'}).click();
 await expect(page.locator('#v35-side-detail')).toBeVisible();
 await expect(page.locator('#v35-my-leads')).toBeHidden();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.locator('#v35-side-detail').getByRole('button',{name:'返回客户列表',exact:true}).click();
 await expect(page.locator('#v35-my-leads')).toBeVisible();
 await expect(page.locator('#v35-my-leads [name="my_lead_search"]')).toHaveValue('PC02隔离测试');

 // 1280px screen: form preservation on 400 and 503
 await page.setViewportSize({width:1280,height:720});
 await page.locator('#v35-my-leads .v35-lead-compact').filter({hasText:'PC02隔离测试'}).getByRole('button',{name:'打开客户'}).click();
 await page.locator('#v34-primary').getByRole('button',{name:'去跟进 / 记录沟通结果',exact:true}).click();
 const follow=page.locator('#v34-followup');
 await follow.locator('[name="result"]').selectOption('communicated');
 await follow.locator('[name="notes"]').fill('未提交跟进记录');
 await nextTomorrow(page,follow);

 // Save POST returns 400: preserves form and uncommitted input
 await page.route('**/api/v1/isolated-workspace/workflow/**',route=>{
  if(route.request().method()==='POST'&&!route.request().url().endsWith('/lookup')){
   return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({code:'BAD_REQUEST',message:'参数校验失败'})});
  }
  return route.continue();
 });
 await follow.locator('[type="submit"]').click();
 await expect(follow).toBeVisible();
 await expect(follow.locator('[name="notes"]')).toHaveValue('未提交跟进记录');
 await expect(page.locator('#v34-message')).toContainText('参数校验失败');
 await page.unroute('**/api/v1/isolated-workspace/workflow/**');

 // Save POST returns 503: preserves form and uncommitted input
 await page.route('**/api/v1/isolated-workspace/workflow/**',route=>{
  if(route.request().method()==='POST'&&!route.request().url().endsWith('/lookup')){
   return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'UNAVAILABLE',message:'服务暂不可用'})});
  }
  return route.continue();
 });
 await follow.locator('[type="submit"]').click();
 await expect(follow).toBeVisible();
 await expect(follow.locator('[name="notes"]')).toHaveValue('未提交跟进记录');
 await page.unroute('**/api/v1/isolated-workspace/workflow/**');

 // Save POST returns 403: fail-closed cleanup
 await page.route('**/api/v1/isolated-workspace/workflow/**',route=>{
  if(route.request().method()==='POST'&&!route.request().url().endsWith('/lookup')){
   return route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({code:'FORBIDDEN',message:'角色已撤销'})});
  }
  return route.continue();
 });
 await follow.locator('[type="submit"]').click();
 await expect(page.locator('#sales-workflow')).toContainText('角色已撤销');
 await expect(page.locator('#v35-sales-box')).toBeHidden();
 await expect(page.locator('#v35-side-detail')).toHaveCount(0);
 await page.unroute('**/api/v1/isolated-workspace/workflow/**');

 // Detail GET returns 403: fail-closed cleanup
 await login(page,'sales-a');
 await page.getByRole('button',{name:'销售 · 新建 / 查询 Leads',exact:true}).click();
 await expect(page.locator('#v35-my-leads')).toBeVisible();
 await page.route(/\/api\/v1\/isolated-workspace\/workflow\/[0-9a-fA-F-]+$/,route=>{
  if(route.request().method()==='GET'){
   return route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({code:'FORBIDDEN',message:'无权查看客户'})});
  }
  return route.continue();
 });
 await page.locator('#v35-my-leads .v35-lead-compact').first().getByRole('button',{name:'打开客户'}).click();
 await expect(page.locator('#sales-workflow')).toContainText('角色已撤销');
 await expect(page.locator('#v35-sales-box')).toBeHidden();
 await expect(page.locator('#v35-side-detail')).toHaveCount(0);
 await page.unroute(/\/api\/v1\/isolated-workspace\/workflow\/[0-9a-fA-F-]+$/);

 // Detail GET returns 404: safe cleanup
 await login(page,'sales-a');
 await page.getByRole('button',{name:'销售 · 新建 / 查询 Leads',exact:true}).click();
 await expect(page.locator('#v35-my-leads')).toBeVisible();
 await page.route(/\/api\/v1\/isolated-workspace\/workflow\/[0-9a-fA-F-]+$/,route=>{
  if(route.request().method()==='GET'){
   return route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({code:'NOT_FOUND',message:'客户不存在'})});
  }
  return route.continue();
 });
 await page.locator('#v35-my-leads .v35-lead-compact').first().getByRole('button',{name:'打开客户'}).click();
 await expect(page.locator('#sales-workflow')).toContainText('客户不存在');
 await expect(page.locator('#v35-sales-box')).toBeHidden();
 await expect(page.locator('#v35-side-detail')).toHaveCount(0);
 await page.unroute(/\/api\/v1\/isolated-workspace\/workflow\/[0-9a-fA-F-]+$/);

 // Cross-employee isolation: sales-b cannot see sales-a leads or list search state or drafts
 await login(page,'sales-b');
 await page.getByRole('button',{name:'销售 · 新建 / 查询 Leads',exact:true}).click();
 await expect(page.locator('#v35-my-leads [name="my_lead_search"]')).toHaveValue('');
 await expect(page.locator('#v35-my-leads')).not.toContainText('PC02隔离测试');
 await expect(page.locator('#v35-side-detail')).toHaveCount(0);
});

test('PC-03a: compact columnar view, card toggle, structured facts, phone masking, and responsive layout',async({page})=>{
 await page.setViewportSize({width:1440,height:900});
 const suffix=String(Date.now()).slice(-4);
 const pMarket='13899'+suffix+'11';
 const pOverdue='13988'+suffix+'22';
 const pTrial='13777'+suffix+'33';
 const pMarketMask=pMarket.slice(0,3)+'****'+pMarket.slice(-4);
 const pOverdueMask=pOverdue.slice(0,3)+'****'+pOverdue.slice(-4);
 const pTrialMask=pTrial.slice(0,3)+'****'+pTrial.slice(-4);

 // 1. Market creates a lead with confidential market notes
 await login(page,'market-a');
 const mf=page.locator('#v35-market-intake');
 await mf.locator('..').locator('summary').click();
 await mf.locator('[name="phone"]').fill(pMarket);
 await mf.locator('[name="contact_name"]').fill('PC03交接家长'+suffix);
 await mf.locator('[name="student_name"]').fill('PC03交接学生'+suffix);
 await mf.locator('[name="notes"]').fill('市场内部机密备注PC03-'+suffix);
 await mf.getByRole('button',{name:'保存并提交销售交接'}).click();
 await expect(page.locator('#v35-market')).toContainText('PC03交接家长'+suffix);

 // 2. Sales-a claims market lead with a task titled "联系家长确定试听时间" (must NOT mislabel as 试听预约)
 await login(page,'sales-a');
 await page.evaluate(async({pMarket,pOverdue,pTrial,suffix})=>{
  const tom=new Date(Date.now()+86400000).toISOString();
  const past=new Date(Date.now()-2*86400000).toISOString();
  const lkp=await api('/api/v1/isolated-workspace/workflow/lookup',{method:'POST',body:{phone:pMarket}});
  const mItem=lkp.items.find(i=>i.status==='market_available');
  await api('/api/v1/isolated-workspace/workflow/'+mItem.lead_id+'/claim',{method:'POST',body:{phone:pMarket,initial_communication:{method:'phone',at:new Date(Date.now()-3600000).toISOString(),stage:'courses_introduced',notes:'初次电话沟通'},next:{action:'confirm_trial',method:'phone',title:'联系家长确定试听时间',due_at:tom}}});
  await api('/api/v1/isolated-workspace/workflow',{method:'POST',body:{contact_name:'PC03逾期家长'+suffix,student_name:'PC03逾期学生'+suffix,contact_info:pOverdue,origin_group:'sales',source:'网络咨询',initial_communication:{method:'phone',result:'failed',failure_reason:'无人接听',at:new Date(Date.now()-3600000).toISOString()},next:{action:'call',method:'phone',title:'逾期回访'+suffix,due_at:past}}});
  const tr=await api('/api/v1/isolated-workspace/workflow',{method:'POST',body:{contact_name:'PC03试听家长'+suffix,student_name:'PC03试听学生'+suffix,contact_info:pTrial,origin_group:'sales',source:'转介绍',initial_communication:{method:'phone',at:new Date(Date.now()-3600000).toISOString(),stage:'courses_introduced'},next:{appointment:{type:'trial',due_at:tom,place:'101教室',course:'数学'}}}});
  // Add a quote/enrollment intent on trial lead (must NOT mislabel as 已收款/已全款结案)
  const det=await api('/api/v1/isolated-workspace/workflow/'+tr.lead_id);
  const sid=det.students[0].id;
  await api('/api/v1/isolated-workspace/workflow/'+tr.lead_id+'/quote',{method:'POST',body:{expected_version:det.workflow.version,student_id:sid,items:[{course_label:'数学',unit_cents:10000,quantity:10}]}});
 },{pMarket,pOverdue,pTrial,suffix});

 // Add a multi-student & no-contact lead via DB to cover edge cases
 const noContactId='36000000-0000-4000-8000-'+String(Date.now()).slice(-12).padStart(12,'0');
 const cId='36000000-0000-4000-8001-'+String(Date.now()).slice(-12).padStart(12,'0');
 const s1Id='36000000-0000-4000-8002-'+String(Date.now()).slice(-12).padStart(12,'0');
 const s2Id='36000000-0000-4000-8003-'+String(Date.now()).slice(-12).padStart(12,'0');
 const org='20000000-0000-4000-8000-000000000001';
 const owner='20000000-0000-4000-8000-000000000011';
 await pool.query("INSERT INTO ms.contacts(id,organization_id,display_name) VALUES($1,$2,$3)",[cId,org,'PC03无电话家长'+suffix]);
 await pool.query("INSERT INTO ms.leads(id,organization_id,contact_id,owner_user_id,lead_state) VALUES($1,$2,$3,$4,'working')",[noContactId,org,cId,owner]);
 await pool.query("INSERT INTO ms.students(id,organization_id,display_name,owner_user_id) VALUES($1,$2,$3,$4),($5,$2,$6,$4)",[s1Id,org,'PC03大宝'+suffix,owner,s2Id,'PC03二宝'+suffix]);
 await pool.query("INSERT INTO ms.lead_students(lead_id,student_id,confirmation_state) VALUES($1,$2,'confirmed'),($1,$3,'confirmed')",[noContactId,s1Id,s2Id]);

 const listRespPromise=page.waitForResponse(r=>r.url().endsWith('/api/v1/isolated-workspace/workflow')&&r.request().method()==='GET');
 await page.getByRole('button',{name:'销售 · 新建 / 查询 Leads',exact:true}).click();
 const listResp=await listRespPromise;
 const listBody=await listResp.json();
 const listBodyStr=JSON.stringify(listBody);
 expect(listBodyStr).not.toContain(pMarket);
 expect(listBodyStr).not.toContain(pOverdue);
 expect(listBodyStr).not.toContain(pTrial);
 expect(listBody.data.items.every(i=>i.contact_info===undefined)).toBe(true);
 expect(listBody.data.items.some(i=>i.contact_info_masked===pMarketMask)).toBe(true);
 expect(listBody.data.items.some(i=>i.contact_info_masked===pOverdueMask)).toBe(true);
 expect(listBody.data.items.some(i=>i.contact_info_masked===pTrialMask)).toBe(true);
 const list=page.locator('#v35-my-leads');
 await expect(list).toBeVisible();

 // Phone search via server-side ?q= works without exposing raw phone in response or DOM
 const qRespPromise=page.waitForResponse(r=>r.url().includes('/api/v1/isolated-workspace/workflow?q=')&&r.request().method()==='GET');
 await list.locator('[name="my_lead_search"]').fill(pMarket);
 const qBody=await (await qRespPromise).json();
 expect(JSON.stringify(qBody)).not.toContain(pMarket);
 expect(qBody.data.items.every(i=>i.contact_info===undefined)).toBe(true);
 await expect(list).toContainText('PC03交接学生'+suffix);
 await expect(list).not.toContainText('PC03逾期学生'+suffix);
 expect(await list.innerHTML()).not.toContain(pMarket);

 // 3. Default compact columnar view assertions
 await expect(list.getByRole('button',{name:'列式视图'})).toHaveAttribute('aria-pressed','true');
 await expect(list.locator('.v35-table-head')).toBeVisible();
 await list.locator('[name="my_lead_search"]').fill(suffix);
 await expect(list).toContainText(pMarketMask);

 // Verify masked phones and NO raw phones anywhere in #v35-my-leads HTML (text, title, aria-label, data-*)
 const listHtml=await list.innerHTML();
 expect(listHtml).toContain(pMarketMask);
 expect(listHtml).toContain(pOverdueMask);
 expect(listHtml).toContain(pTrialMask);
 expect(listHtml).not.toContain(pMarket);
 expect(listHtml).not.toContain(pOverdue);
 expect(listHtml).not.toContain(pTrial);
 expect(listHtml).not.toContain('市场内部机密备注PC03');

 // Verify structured fields & non-mislabeling
 const marketRow=list.locator('.v35-lead-compact').filter({hasText:'PC03交接学生'+suffix});
 await expect(marketRow).toContainText('市场活动');
 await expect(marketRow).toContainText('已沟通（电话）');
 await expect(marketRow).toContainText('未预约面谈/试听');
 await expect(marketRow).toContainText('联系家长确定试听时间');

 const overdueRow=list.locator('.v35-lead-compact').filter({hasText:'PC03逾期学生'+suffix});
 await expect(overdueRow).toContainText('网络咨询');
 await expect(overdueRow).toContainText('未接通（无人接听）');
 await expect(overdueRow).toContainText('未预约面谈/试听');
 await expect(overdueRow.locator('.badge.warning')).toContainText('已逾期');

 const trialRow=list.locator('.v35-lead-compact').filter({hasText:'PC03试听学生'+suffix});
 await expect(trialRow).toContainText('转介绍');
 await expect(trialRow).toContainText('试听 · 已预约');
 await expect(trialRow).toContainText('跟进中');
 await expect(trialRow).not.toContainText('已全款结案');
 await expect(trialRow).not.toContainText('已收款');

 const multiRow=list.locator('.v35-lead-compact').filter({hasText:'PC03大宝'+suffix+'、PC03二宝'+suffix});
 await expect(multiRow).toContainText('未留电话');
 await expect(multiRow).toContainText('待补安排');

 // 4. Preserve search, filter, sort, selected lead, and unsaved card draft when toggling views
 await list.locator('[name="my_lead_state"]').selectOption('open');
 await list.locator('[name="my_lead_sort"]').selectOption('name_asc');
 await marketRow.getByRole('button',{name:'打开客户'}).click();
 const side=page.locator('#v35-side-detail');
 await expect(side).toBeVisible();
 await side.locator('#v34-primary').getByRole('button',{name:'去跟进 / 记录沟通结果',exact:true}).click();
 await side.locator('#v34-followup [name="notes"]').fill('PC03切换视图保留草稿');

 // Switch to Card View
 await list.getByRole('button',{name:'卡片视图'}).click();
 await expect(list.getByRole('button',{name:'卡片视图'})).toHaveAttribute('aria-pressed','true');
 await expect(list.locator('.v35-table-head')).toHaveCount(0);
 await expect(list.locator('[name="my_lead_search"]')).toHaveValue(suffix);
 await expect(list.locator('[name="my_lead_state"]')).toHaveValue('open');
 await expect(list.locator('[name="my_lead_sort"]')).toHaveValue('name_asc');
 await expect(list.locator('.v35-lead-compact.active')).toContainText('PC03交接学生'+suffix);
 await expect(side.locator('#v34-followup [name="notes"]')).toHaveValue('PC03切换视图保留草稿');
 const cardHtml=await list.innerHTML();
 expect(cardHtml).toContain(pMarketMask);
 expect(cardHtml).not.toContain(pMarket);
 expect(cardHtml).not.toContain('市场内部机密备注PC03');

 // Switch back to Columnar View
 await list.getByRole('button',{name:'列式视图'}).click();
 await expect(list.getByRole('button',{name:'列式视图'})).toHaveAttribute('aria-pressed','true');
 await expect(side.locator('#v34-followup [name="notes"]')).toHaveValue('PC03切换视图保留草稿');

 // Discard draft and close side detail for clean responsive check
 page.once('dialog',d=>d.accept());
 await side.getByRole('button',{name:'放弃未保存修改',exact:true}).click();
 await side.getByRole('button',{name:'返回客户列表',exact:true}).click();
 await expect(side).toBeHidden();

 // Empty state check
 await list.locator('[name="my_lead_search"]').fill('绝对不存在的客户关键字XYZ');
 await expect(list).toContainText('暂无匹配客户');
 await list.locator('[name="my_lead_search"]').fill(suffix);

 // 5. Responsive check on 1280px and 390px (zero horizontal overflow in both views)
 await page.setViewportSize({width:1280,height:720});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await list.getByRole('button',{name:'卡片视图'}).click();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('PC-03b: authorized detail shows full phone without market notes, cross-employee & 403 isolation',async({page})=>{
 await page.setViewportSize({width:1280,height:720});
 const suffix=String(Date.now()).slice(-4);
 const pAuth='13655'+suffix+'44';
 const pAuthMask=pAuth.slice(0,3)+'****'+pAuth.slice(-4);

 await login(page,'market-a');
 const mf=page.locator('#v35-market-intake');
 await mf.locator('..').locator('summary').click();
 await mf.locator('[name="phone"]').fill(pAuth);
 await mf.locator('[name="contact_name"]').fill('PC03授权家长'+suffix);
 await mf.locator('[name="student_name"]').fill('PC03授权学生'+suffix);
 await mf.locator('[name="notes"]').fill('市场绝密备注不得泄露-'+suffix);
 await mf.getByRole('button',{name:'保存并提交销售交接'}).click();
 await expect(page.locator('#v35-market')).toContainText('PC03授权家长'+suffix);

 await login(page,'sales-a');
 const leadId=await page.evaluate(async({pAuth})=>{
  const tom=new Date(Date.now()+86400000).toISOString();
  const lkp=await api('/api/v1/isolated-workspace/workflow/lookup',{method:'POST',body:{phone:pAuth}});
  const mItem=lkp.items.find(i=>i.status==='market_available');
  const r=await api('/api/v1/isolated-workspace/workflow/'+mItem.lead_id+'/claim',{method:'POST',body:{phone:pAuth,next:{action:'call',method:'phone',title:'初次联系',due_at:tom}}});
  return r.lead_id;
 },{pAuth});

 await page.getByRole('button',{name:'销售 · 新建 / 查询 Leads',exact:true}).click();
 const list=page.locator('#v35-my-leads');
 await list.locator('[name="my_lead_search"]').fill(suffix);
 const row=list.locator('.v35-lead-compact').filter({hasText:'PC03授权学生'+suffix});
 await expect(row).toContainText(pAuthMask);
 expect(await list.innerHTML()).not.toContain(pAuth);

 // Authorized detail shows full phone, never market notes
 await row.getByRole('button',{name:'打开客户'}).click();
 const side=page.locator('#v35-side-detail');
 await expect(side).toBeVisible();
 await expect(side).toContainText('联系方式：'+pAuth);
 await expect(side).not.toContainText('市场绝密备注不得泄露');

 // Cross-employee isolation: sales-b cannot see lead in list or via API
 await login(page,'sales-b');
 await page.getByRole('button',{name:'销售 · 新建 / 查询 Leads',exact:true}).click();
 await expect(page.locator('#v35-my-leads')).not.toContainText('PC03授权学生'+suffix);
 await expect(page.locator('#v35-my-leads')).not.toContainText(pAuthMask);
 const status=await page.evaluate(async(id)=>{try{await api('/api/v1/isolated-workspace/workflow/'+id);return 200;}catch(e){return e.status;}},leadId);
 expect(status).toBe(403);
 const bSearch=await page.evaluate(async(q)=>api('/api/v1/isolated-workspace/workflow?q='+encodeURIComponent(q)),pAuth);
 expect(bSearch.items).toHaveLength(0);
 expect(JSON.stringify(bSearch)).not.toContain(pAuth);
 expect(JSON.stringify(bSearch)).not.toContain(pAuthMask);

 // 403 fail-closed wipes list and nav
 await page.route('**/api/v1/isolated-workspace/workflow/options',r=>r.fulfill({status:403,contentType:'application/json',body:JSON.stringify({code:'FORBIDDEN',message:'角色已撤销'})}));
 await page.getByRole('button',{name:'刷新数据',exact:true}).click();
 await expect(page.locator('#sales-workflow')).toContainText('角色已撤销');
 await expect(page.locator('#v35-sales-box')).toBeHidden();
 await page.unroute('**/api/v1/isolated-workspace/workflow/options');
});

test('PC-04c: saved views reject embedded separated phones in either field and retain ordinary identifiers',async({page})=>{
 await login(page,'sales-a');
 await page.getByRole('button',{name:'销售 · 新建 / 查询 Leads',exact:true}).click();
 const list=page.locator('#v35-my-leads');
 const search=list.locator('[name="my_lead_search"]');
 const name=list.locator('[name="saved_view_name"]');
 const save=list.getByRole('button',{name:'保存当前视图'});
 const chips=list.locator('.v35-saved-chip');
 for(const field of ['search','name']){
  for(const value of ['电话139 1234 5678视图','客户+86-139-1234-5678','家长(139)1234-5678','家长（139）1234—5678','13912345678 13812345678','电话139 1234 5678 138 1234 5678视图']){
   await search.fill(field==='search'?value:'学生1');
   await name.fill(field==='name'?value:'04A视图');
   await save.click();
   await expect(list.locator('#v35-saved-view-hint')).toContainText('不能包含电话号码');
   await expect(chips).toHaveCount(0);
  }
 }
 let count=0;
 for(const value of ['学生1','04A','2026课程计划','班级04A学生1','计划2026-11-20']){
  await search.fill(value);await name.fill(value);await save.click();
  await expect(chips).toHaveCount(++count);
  await expect(list.locator('#v35-saved-view-hint')).toBeEmpty();
  await search.fill('其它');
  await chips.getByRole('button',{name:value,exact:true}).click();
  await expect(search).toHaveValue(value);
 }
 await login(page,'sales-a');
 await page.getByRole('button',{name:'销售 · 新建 / 查询 Leads',exact:true}).click();
 await expect(chips).toHaveCount(0);
});

test('PC-04a: read-only stage kanban, saved views, draft preservation, phone masking, and cross-employee isolation',async({page})=>{
 await page.setViewportSize({width:1440,height:900});
 const suffix='04A'+String(Date.now()).slice(-4);
 const pDisc='13811'+String(Date.now()).slice(-6);
 const pTrial='13822'+String(Date.now()).slice(-6);
 const pLost='13833'+String(Date.now()).slice(-6);
 const pDiscMask=pDisc.slice(0,3)+'****'+pDisc.slice(-4);

 await login(page,'sales-a');
 const ids=await page.evaluate(async({pDisc,pTrial,pLost,suffix})=>{
  const tom=new Date(Date.now()+86400000).toISOString();
  const d=await api('/api/v1/isolated-workspace/workflow',{method:'POST',body:{contact_name:'KB待了解家长'+suffix,student_name:'KB待了解学生'+suffix,contact_info:pDisc,origin_group:'sales',source:'到店',next:{action:'call',method:'phone',title:'了解需求'+suffix,due_at:tom}}});
  const t=await api('/api/v1/isolated-workspace/workflow',{method:'POST',body:{contact_name:'KB试听家长'+suffix,student_name:'KB试听学生'+suffix,contact_info:pTrial,origin_group:'sales',source:'网络咨询',initial_communication:{method:'phone',at:new Date(Date.now()-3600000).toISOString(),stage:'courses_introduced'},next:{appointment:{type:'trial',due_at:tom,place:'101教室',course:'英语'}}}});
  const l=await api('/api/v1/isolated-workspace/workflow',{method:'POST',body:{contact_name:'KB流失家长'+suffix,student_name:'KB流失学生'+suffix,contact_info:pLost,origin_group:'sales',source:'转介绍',next:{action:'call',method:'phone',title:'初始跟进'+suffix,due_at:tom}}});
  const det=await api('/api/v1/isolated-workspace/workflow/'+l.lead_id);
  await api('/api/v1/isolated-workspace/workflow/'+l.lead_id+'/close-lost',{method:'POST',body:{expected_version:det.workflow.version,reason:'价格原因',feedback:'家长明确不报名',evidence_ref:'沟通记录截图01'}});
  return {discId:d.lead_id,trialId:t.lead_id,lostId:l.lead_id};
 },{pDisc,pTrial,pLost,suffix});

 await page.getByRole('button',{name:'销售 · 新建 / 查询 Leads',exact:true}).click();
 const list=page.locator('#v35-my-leads');
 await list.locator('[name="my_lead_search"]').fill(suffix);
 await list.getByRole('button',{name:'阶段看板'}).click();
 await expect(list.getByRole('button',{name:'阶段看板'})).toHaveAttribute('aria-pressed','true');

 const board=page.locator('#v35-kanban-board');
 await expect(board).toBeVisible();
 // Each lead appears exactly once and in its true stage/terminal column
 await expect(board.locator(`[data-lead-id="${ids.discId}"]`)).toHaveCount(1);
 await expect(board.locator(`[data-lead-id="${ids.trialId}"]`)).toHaveCount(1);
 await expect(board.locator(`[data-lead-id="${ids.lostId}"]`)).toHaveCount(1);
 await expect(board.locator('[data-stage-col="needs_discovery"]')).toContainText('KB待了解学生'+suffix);
 await expect(board.locator('[data-stage-col="trial_booked"]')).toContainText('KB试听学生'+suffix);
 await expect(board.locator('[data-stage-col="__lost__"]')).toContainText('KB流失学生'+suffix);

 // Strictly read-only: no draggable cards, no stage selects, no raw phones
 expect(await board.locator('[draggable="true"]').count()).toBe(0);
 expect(await board.locator('select,input').count()).toBe(0);
 const boardHtml=await board.innerHTML();
 expect(boardHtml).toContain(pDiscMask);
 expect(boardHtml).not.toContain(pDisc);
 expect(boardHtml).not.toContain(pTrial);
 expect(boardHtml).not.toContain(pLost);

 // Open lead from Kanban -> side detail shows full phone, draft preserved across view toggles
 await board.locator(`[data-lead-id="${ids.discId}"]`).getByRole('button',{name:'打开客户'}).click();
 const side=page.locator('#v35-side-detail');
 await expect(side).toBeVisible();
 await expect(side).toContainText('联系方式：'+pDisc);
 await side.locator('#v34-primary').getByRole('button',{name:'去跟进 / 记录沟通结果',exact:true}).click();
 await side.locator('#v34-followup [name="notes"]').fill('PC04看板草稿不丢失');
 await list.getByRole('button',{name:'列式视图'}).click();
 await expect(side.locator('#v34-followup [name="notes"]')).toHaveValue('PC04看板草稿不丢失');
 await list.getByRole('button',{name:'阶段看板'}).click();
 await expect(side.locator('#v34-followup [name="notes"]')).toHaveValue('PC04看板草稿不丢失');
 page.once('dialog',d=>d.accept());
 await side.getByRole('button',{name:'放弃未保存修改',exact:true}).click();
 await side.getByRole('button',{name:'返回客户列表',exact:true}).click();

 // 1. Negative checks: reject saving phone numbers (embedded prefixes/suffixes, separators, spaces, parens, country codes)
 const initialChipsCount=await page.locator('#v35-saved-views .v35-saved-chip').count();

 // 1a. Embedded in search: 家长139 1234 5678
 await list.locator('[name="my_lead_search"]').fill('家长139 1234 5678');
 await list.locator('[name="saved_view_name"]').fill('正常视图名');
 await list.getByRole('button',{name:'保存当前视图'}).click();
 await expect(page.locator('#v35-saved-view-hint')).toContainText('不能包含电话号码');
 expect(await page.locator('#v35-saved-views .v35-saved-chip').count()).toBe(initialChipsCount);

 // 1b. Embedded in view name with spaces: 电话139 1234 5678视图
 await list.locator('[name="my_lead_search"]').fill('正常搜索词');
 await list.locator('[name="saved_view_name"]').fill('电话139 1234 5678视图');
 await list.getByRole('button',{name:'保存当前视图'}).click();
 await expect(page.locator('#v35-saved-view-hint')).toContainText('不能包含电话号码');
 expect(await page.locator('#v35-saved-views .v35-saved-chip').count()).toBe(initialChipsCount);

 // 1c. Embedded with country code & dashes: 客户+86-139-1234-5678
 await list.locator('[name="saved_view_name"]').fill('客户+86-139-1234-5678');
 await list.getByRole('button',{name:'保存当前视图'}).click();
 await expect(page.locator('#v35-saved-view-hint')).toContainText('不能包含电话号码');
 expect(await page.locator('#v35-saved-views .v35-saved-chip').count()).toBe(initialChipsCount);

 // 1d. Embedded with parentheses & dashes: 家长(139)1234-5678
 await list.locator('[name="saved_view_name"]').fill('家长(139)1234-5678');
 await list.getByRole('button',{name:'保存当前视图'}).click();
 await expect(page.locator('#v35-saved-view-hint')).toContainText('不能包含电话号码');
 expect(await page.locator('#v35-saved-views .v35-saved-chip').count()).toBe(initialChipsCount);

 // 1e. Continuous 11-digit phone in search & view name
 await list.locator('[name="my_lead_search"]').fill('13912345678');
 await list.locator('[name="saved_view_name"]').fill('电话13800000000视图');
 await list.getByRole('button',{name:'保存当前视图'}).click();
 await expect(page.locator('#v35-saved-view-hint')).toContainText('不能包含电话号码');
 expect(await page.locator('#v35-saved-views .v35-saved-chip').count()).toBe(initialChipsCount);

 // 2. Positive checks: ordinary business identifiers with digits (学生1, 04A, 2026课程计划, 进行中看板+suffix) save and restore cleanly
 // 2a. Save "学生1" view with "2026课程计划" search
 await list.locator('[name="my_lead_search"]').fill('2026课程计划');
 await list.locator('[name="saved_view_name"]').fill('学生1');
 await list.getByRole('button',{name:'保存当前视图'}).click();
 await expect(page.locator('#v35-saved-view-hint')).toHaveText('');
 await expect(page.locator('#v35-saved-views')).toContainText('学生1');
 expect(await page.locator('#v35-saved-views .v35-saved-chip').count()).toBe(initialChipsCount+1);

 // 2b. Restore "学生1" view
 await list.locator('[name="my_lead_search"]').fill('');
 await page.locator('#v35-saved-views').getByRole('button',{name:'学生1',exact:true}).click();
 await expect(list.locator('[name="my_lead_search"]')).toHaveValue('2026课程计划');

 // 2c. Delete "学生1" view
 await page.locator('#v35-saved-views').getByRole('button',{name:'删除视图 学生1',exact:true}).click();
 await expect(page.locator('#v35-saved-views')).not.toContainText('学生1');
 expect(await page.locator('#v35-saved-views .v35-saved-chip').count()).toBe(initialChipsCount);

 // 2d. Save and restore "进行中看板"+suffix (includes "04A" alphanumeric token)
 await list.locator('[name="my_lead_search"]').fill(suffix);
 await list.locator('[name="my_lead_state"]').selectOption('open');
 await list.locator('[name="saved_view_name"]').fill('进行中看板'+suffix);
 await list.getByRole('button',{name:'保存当前视图'}).click();
 await expect(page.locator('#v35-saved-view-hint')).toHaveText('');
 await expect(page.locator('#v35-saved-views')).toContainText('进行中看板'+suffix);

 await list.locator('[name="my_lead_search"]').fill('');
 await list.locator('[name="my_lead_state"]').selectOption('all');
 await list.getByRole('button',{name:'列式视图'}).click();
 await page.locator('#v35-saved-views').getByRole('button',{name:'进行中看板'+suffix,exact:true}).click();
 await expect(list.locator('[name="my_lead_search"]')).toHaveValue(suffix);
 await expect(list.locator('[name="my_lead_state"]')).toHaveValue('open');
 await expect(list.getByRole('button',{name:'阶段看板'})).toHaveAttribute('aria-pressed','true');
 await expect(board.locator(`[data-lead-id="${ids.lostId}"]`)).toHaveCount(0);

 await page.locator('#v35-saved-views').getByRole('button',{name:'删除视图 进行中看板'+suffix,exact:true}).click();
 await expect(page.locator('#v35-saved-views')).not.toContainText('进行中看板'+suffix);

 // Responsive 1280x720 and 390x844 zero horizontal overflow
 await page.setViewportSize({width:1280,height:720});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);

 // Save a view on sales-a then login as sales-b -> saved view must NOT leak
 await list.locator('[name="saved_view_name"]').fill('A专属视图'+suffix);
 await list.getByRole('button',{name:'保存当前视图'}).click();
 await login(page,'sales-b');
 await page.getByRole('button',{name:'销售 · 新建 / 查询 Leads',exact:true}).click();
 await expect(page.locator('#v35-saved-views')).not.toContainText('A专属视图'+suffix);
 await expect(page.locator('#v35-my-leads')).not.toContainText('KB待了解学生'+suffix);
});

test('PC-04b: week calendar navigation, cross-month/year & Asia/Shanghai midnight, structured types, 390px & 403 fail-closed',async({page})=>{
 await page.setViewportSize({width:1440,height:900});
 const suffix='04B'+String(Date.now()).slice(-4);
 const shTodayStr=await page.evaluate(()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()));
 const [shY,shM,shD]=shTodayStr.split('-').map(Number);
 const shNoonUtc=Date.UTC(shY,shM-1,shD,4,0,0);
 const overdueIso=new Date(shNoonUtc-2*86400000).toISOString();

 await login(page,'sales-a');
 await page.evaluate(async({suffix,overdueIso})=>{
  const p=()=>String(13700000000+Math.floor(Math.random()*900000000));
  // Misleading title task (must show 跟进待办, NOT 试听)
  await api('/api/v1/isolated-workspace/workflow',{method:'POST',body:{contact_name:'WC任务家长'+suffix,student_name:'WC任务学生'+suffix,contact_info:p(),origin_group:'sales',source:'到店',next:{action:'call',method:'phone',title:'假装试听沟通'+suffix,due_at:overdueIso}}});
  // Cross-year Asia/Shanghai midnight boundary: 2026-12-31T16:30:00Z is 2027-01-01 00:30 Asia/Shanghai
  await api('/api/v1/isolated-workspace/workflow',{method:'POST',body:{contact_name:'WC跨年家长'+suffix,student_name:'WC跨年学生'+suffix,contact_info:p(),origin_group:'sales',source:'网络咨询',initial_communication:{method:'phone',at:new Date(Date.now()-3600000).toISOString(),stage:'courses_introduced'},next:{appointment:{type:'meeting',due_at:'2026-12-31T16:30:00.000Z'}}}});
 },{suffix,overdueIso});

 await page.getByRole('button',{name:'我的待办',exact:true}).click();
 // Set task_day to 2026-12-31 so week view opens on 2026-12-28 ~ 2027-01-03
 await page.locator('#v34-tasks [name="task_day"]').fill('2026-12-31');
 await page.locator('#v34-tasks [name="task_day"]').dispatchEvent('change');
 await page.locator('#v35-task-view-toggle').getByRole('button',{name:'周日程视图'}).click();
 await expect(page.locator('#v35-week-calendar')).toBeVisible();
 await expect(page.locator('#v35-week-range')).toContainText('2026-12-28 ~ 2027-01-03');

 // 2026-12-31T16:30:00Z MUST appear under 2027-01-01 (Asia/Shanghai), NOT 2026-12-31
 const jan1Col=page.locator('#v35-week-calendar [data-day="2027-01-01"]');
 const dec31Col=page.locator('#v35-week-calendar [data-day="2026-12-31"]');
 await expect(jan1Col).toContainText('WC跨年学生'+suffix);
 await expect(jan1Col).toContainText('面谈');
 await expect(dec31Col).not.toContainText('WC跨年学生'+suffix);

 // Navigate next/prev/current week
 await page.locator('#v35-week-calendar').getByRole('button',{name:'下一周'}).click();
 await expect(page.locator('#v35-week-range')).toContainText('2027-01-04 ~ 2027-01-10');
 await page.locator('#v35-week-calendar').getByRole('button',{name:'上一周'}).click();
 await expect(page.locator('#v35-week-range')).toContainText('2026-12-28 ~ 2027-01-03');

 // Open side detail directly from week calendar item
 await jan1Col.locator('.v35-week-item').filter({hasText:'WC跨年学生'+suffix}).getByRole('button',{name:'查看进展 / 继续跟进'}).click();
 await expect(page.locator('#v35-side-detail')).toBeVisible();
 await page.locator('#v35-side-detail').getByRole('button',{name:'返回我的待办',exact:true}).click();

 // Back to current week -> overdue task shows structured 跟进待办 (not 试听) and 已逾期 badge
 await page.locator('#v35-week-calendar').getByRole('button',{name:'回到本周'}).click();
 const overdueItem=page.locator('#v35-week-calendar .v35-week-item').filter({hasText:'WC任务学生'+suffix});
 await expect(overdueItem).toContainText('跟进待办');
 await expect(overdueItem).not.toContainText(' · 试听');
 await expect(overdueItem.locator('.badge.warning')).toContainText('已逾期');

 // 390x844 vertical layout zero horizontal overflow
 await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);

 // 403 fail-closed wipes week calendar
 await page.route('**/api/v1/isolated-workspace/workflow/options',r=>r.fulfill({status:403,contentType:'application/json',body:JSON.stringify({code:'FORBIDDEN',message:'角色已撤销'})}));
 await page.getByRole('button',{name:'刷新数据',exact:true}).click();
 await expect(page.locator('#sales-workflow')).toContainText('角色已撤销');
 await expect(page.locator('#v35-week-calendar')).toHaveCount(0);
 await page.unroute('**/api/v1/isolated-workspace/workflow/options');
});





test('PC-05: manually scheduled late follow-up keeps its exact time after sign-in', async ({page}) => {
 const student = '手动安排学生' + Date.now();
 const title = '按约定时间电话回访';
 const {manualTime, taskDay, displayTime} = await page.evaluate(() => {
  const todayInShanghai = new Intl.DateTimeFormat('en-CA', {
   timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const due = new Date(Date.parse(todayInShanghai + 'T22:37:00+08:00') + 2 * 86400000);
  return {
   manualTime: new Date(due.getTime() - due.getTimezoneOffset() * 60000).toISOString().slice(0, 16),
   taskDay: new Date(due.getTime() + 8 * 3600000).toISOString().slice(0, 10),
   displayTime: due.toLocaleString('zh-CN', {hour12: false}),
  };
 });

 await login(page);
 await lookup(page, phone());
 const form = page.locator('#v34-intake');
 await form.locator('[name="contact_name"]').fill('手动安排家长');
 await form.locator('[name="student_name"]').fill(student);
 await form.locator('[name="next_title"]').fill(title);

 const presetButtons = form.locator('.v34-next .trial-preset-row button');
 await expect(presetButtons).toHaveText(['明天', '三天后', '一周后']);
 const time = form.locator('[name="next_at"]');
 await nextTomorrow(page, form);
 await expect(time).toHaveValue(/^\d{4}-\d{2}-\d{2}T10:00$/);
 await expect(time).not.toHaveValue(manualTime);
 await time.fill(manualTime);
 await expect(time).toHaveValue(manualTime);

 const [saved] = await Promise.all([
  page.waitForResponse(response =>
   response.request().method() === 'POST' &&
   new URL(response.url()).pathname === '/api/v1/isolated-workspace/workflow'
  ),
  form.getByRole('button', {name: '保存客户及首次安排'}).click(),
 ]);
 expect(saved.ok()).toBe(true);
 const primary = page.locator('#v34-primary');
 await expect(primary).toContainText(title);
 await expect(primary).toContainText(displayTime);

 await login(page);
 const day = page.locator('#v34-tasks [name="task_day"]');
 await day.fill(taskDay);
 await day.dispatchEvent('change');
 const task = page.locator('#v35-day-tasks article').filter({hasText: student});
 await expect(task).toContainText(title);
 await expect(task).toContainText(displayTime);
});


test('Boss lead, student and closure drilldown follow Shanghai creation date and advisor filters', async ({page}) => {
 await login(page,'supervisor');
 await page.getByRole('button',{name:'统计与提醒',exact:true}).click();
 const panel=page.locator('#v34-metrics');
 const filters=panel.locator('#v34-metrics-filters');
 await expect(filters).toBeVisible();
 const owners=filters.getByRole('combobox',{name:'顾问'});
 const ownerIds=await owners.locator('option').evaluateAll(options=>options.map(option=>option.value).filter(Boolean));
 expect(ownerIds.length).toBeGreaterThanOrEqual(2);
 const seed=async(owner,createdAt,title,source='到店')=>{
  const result=await page.evaluate(({owner,number,title,source})=>api('/api/v1/isolated-workspace/workflow',{
   method:'POST',body:{
    owner_user_id:owner,contact_name:title+'家长',student_name:title+'学生',contact_info:number,origin_group:'sales',source,
    next:{action:'call',method:'phone',title,due_at:new Date(Date.now()+86400000).toISOString()},
   },
  }),{owner,number:phone(),title,source});
  await pool.query('UPDATE ms.leads SET created_at=$2 WHERE id=$1',[result.lead_id,createdAt]);
  return result;
 };
 await seed(ownerIds[0],'2024-04-01T00:00:00+08:00','窗口首位顾问测试');
 const lostLead=await seed(ownerIds[1],'2024-04-01T08:00:00+08:00','窗口第二位顾问测试','网络咨询');
 await seed(ownerIds[0],'2024-04-02T00:00:00+08:00','窗口之外测试');
 await page.evaluate(({lead_id,workflow})=>api('/api/v1/isolated-workspace/workflow/'+lead_id+'/close-lost',{
  method:'POST',body:{expected_version:workflow.version,reason:'价格原因',feedback:'家长明确反馈',evidence_ref:'复验虚构依据'},
 }),lostLead);
 await pool.query(
  "INSERT INTO ms.audit_events(organization_id,service_actor,target_type,target_id,event_name,happened_at) SELECT organization_id,'playwright-fixture','lead',id,'V34_REOPENED',$2 FROM ms.leads WHERE id=$1",
  [lostLead.lead_id,'2024-04-01T10:00:00+08:00'],
 );
 await pool.query(
  "INSERT INTO ms.audit_events(organization_id,service_actor,target_type,target_id,event_name,happened_at,after_business_json) SELECT organization_id,'playwright-fixture','lead',id,'V34_CLOSED_LOST',$2,$3 FROM ms.leads WHERE id=$1",
  [lostLead.lead_id,'2024-04-01T09:00:00+08:00',{workflow_version:2,stage:'declined',terminal_state:'lost'}],
 );
 const oldActivity=(await pool.query(
  "INSERT INTO ms_workspace.records(organization_id,owner_user_id,lead_id,kind,state,body,version,created_at) SELECT organization_id,owner_user_id,id,'appointments','completed','{}',2,$2 FROM ms.leads WHERE id=$1 RETURNING id,owner_user_id",
  [lostLead.lead_id,'2024-04-01T08:15:00+08:00'],
 )).rows[0];
 await pool.query(
  "INSERT INTO ms_workspace.history(record_id,version,actor_user_id,state,body,recorded_at) VALUES($1,1,$2,'confirmed',$3,$4),($1,2,$2,'completed',$3,$5)",
  [oldActivity.id,oldActivity.owner_user_id,{due_at:'2024-04-01T08:45:00+08:00'},'2024-04-01T08:15:00+08:00','2024-04-01T09:00:00+08:00'],
 );
 const verifiedAt='2024-04-01T09:10:00+08:00';
 const receipt=(await pool.query(
  "INSERT INTO ms.payment_receipt_projections(authority_system,external_tenant,external_payment_id,amount_cents,verification_state,verified_at) SELECT 'standalone_sales',organization_id::text,id::text,10000,'confirmed',$2 FROM ms.leads WHERE id=$1 RETURNING id",
  [lostLead.lead_id,verifiedAt],
 )).rows[0].id;
 const payment=(await pool.query(
  "INSERT INTO ms_workspace.records(organization_id,owner_user_id,lead_id,kind,state,body,version,created_at) SELECT organization_id,owner_user_id,id,'payments','verified',$2,1,$3 FROM ms.leads WHERE id=$1 RETURNING id,owner_user_id",
  [lostLead.lead_id,{receipt_id:receipt,amount_cents:10000},'2024-04-01T08:15:00+08:00'],
 )).rows[0];
 await pool.query(
  "INSERT INTO ms_workspace.history(record_id,version,actor_user_id,state,body,recorded_at) VALUES($1,1,$2,'verified',$3,$4)",
  [payment.id,payment.owner_user_id,{receipt_id:receipt,amount_cents:10000},verifiedAt],
 );
 const trialAt='2024-04-01T11:00:00+08:00';
 const trial=(await pool.query(
  "INSERT INTO ms_workspace.records(organization_id,owner_user_id,lead_id,student_id,kind,state,body,created_at) SELECT l.organization_id,l.owner_user_id,l.id,ls.student_id,'appointments','confirmed',$2,$3 FROM ms.leads l JOIN ms.lead_students ls ON ls.lead_id=l.id WHERE l.id=$1 RETURNING id,owner_user_id",
  [lostLead.lead_id,{type:'trial',due_at:'2024-04-02T10:00:00+08:00'},trialAt],
 )).rows[0];
 await pool.query(
  "INSERT INTO ms_workspace.history(record_id,version,actor_user_id,state,body,recorded_at) VALUES($1,1,$2,'confirmed',$3,$4)",
  [trial.id,trial.owner_user_id,{type:'trial'},trialAt],
 );
 const count=panel.locator('.stat-card').filter({has:page.getByText('Lead 数',{exact:true})}).locator('strong');

 const start=filters.getByLabel('开始日期');
 const end=filters.getByLabel('结束日期');
 const apply=filters.getByRole('button',{name:'应用筛选'});
 await start.fill('2024-04-01');
 await apply.click();
 await expect(filters.getByRole('status')).toContainText('请同时选择');
 await end.fill('2024-04-01');
 await apply.click();
 await expect(count).toHaveText('2');
 const channels=panel.locator('#v34-metrics-sources');
 await expect(channels).toContainText('待配置成本源');
 await expect(channels.locator('article').filter({hasText:'网络咨询'})).toContainText('当前失单 1 条');
 await channels.getByRole('button',{name:'筛选来源：网络咨询'}).click();
 await expect(channels).toContainText('当前来源筛选：网络咨询');
 await expect(count).toHaveText('1');
 await panel.getByRole('button',{name:'查看线索明细'}).click();
 await expect(panel.locator('#v34-metrics-leads')).toContainText('窗口第二位顾问测试家长');
 await expect(panel.locator('#v34-metrics-leads')).not.toContainText('窗口首位顾问测试家长');
 await channels.getByRole('button',{name:'清除来源筛选'}).click();
 await expect(count).toHaveText('2');
 const openDrilldown=panel.getByRole('button',{name:'查看线索明细'});
 const drilldown=panel.locator('#v34-metrics-leads');
 await openDrilldown.click();
 await expect(drilldown).toContainText('共 2 条线索');
 await expect(drilldown).toContainText('窗口首位顾问测试家长');
 await expect(drilldown).toContainText('窗口第二位顾问测试家长');
 await expect(drilldown).not.toContainText('窗口之外测试家长');
 await owners.selectOption(ownerIds[1]);
 await apply.click();
 await expect(count).toHaveText('1');
 await expect(owners).toHaveValue(ownerIds[1]);
 await expect(start).toHaveValue('2024-04-01');
 await expect(end).toHaveValue('2024-04-01');
 await expect(drilldown).toHaveCount(0);
 await openDrilldown.click();
 await expect(drilldown).toContainText('共 1 条线索');
 await expect(drilldown).toContainText('窗口第二位顾问测试家长');
 await expect(drilldown).not.toContainText('窗口首位顾问测试家长');
 const studentDrilldown=panel.locator('#v34-metrics-students');
 await panel.getByRole('button',{name:'查看学生明细'}).click();
 await expect(drilldown).toHaveCount(0);
 await expect(studentDrilldown).toContainText('共 1 名学生');
 await expect(studentDrilldown).toContainText('窗口第二位顾问测试学生');
 await expect(studentDrilldown).toContainText('在当前筛选范围内关联 1 条线索');
 await expect(studentDrilldown).not.toContainText('窗口首位顾问测试学生');
 await studentDrilldown.getByRole('button',{name:'关闭学生明细'}).click();
 await expect(studentDrilldown).toHaveCount(0);

 const lostDrilldown=panel.locator('#v34-metrics-lost_leads');
 await panel.getByRole('button',{name:'查看当前失单明细'}).click();
 await expect(lostDrilldown).toContainText('共 1 条线索');
 await expect(lostDrilldown).toContainText('窗口第二位顾问测试家长');
 await expect(lostDrilldown).not.toContainText('窗口首位顾问测试家长');
 const wonDrilldown=panel.locator('#v34-metrics-won_leads');
 await panel.getByRole('button',{name:'查看正式成交明细'}).click();
 await expect(lostDrilldown).toHaveCount(0);
 await expect(wonDrilldown).toContainText('共 0 条线索');

 await page.getByRole('button',{name:'我的待办',exact:true}).click();
 await expect(page.locator('#v34-tasks')).toBeVisible();
 await page.getByRole('button',{name:'统计与提醒',exact:true}).click();
 await expect(count).toHaveText('1');
 const mode=filters.getByRole('combobox',{name:'统计口径'});
 await mode.selectOption('event');
 await apply.click();
 await expect(panel.getByRole('heading',{name:'当期发生量'})).toBeVisible();
 const reopened=panel.locator('.stat-card').filter({has:page.getByText('失单后重开（次）',{exact:true})});
 await expect(reopened.locator('strong')).toHaveText('1');
 await expect(panel.getByRole('button',{name:'查看线索明细'})).toHaveCount(0);
 await reopened.getByRole('button',{name:'查看失单后重开明细'}).click();
 const eventDrilldown=panel.locator('#v34-metrics-reopened_events');
 await expect(eventDrilldown).toContainText('共 1 条记录');
 await expect(eventDrilldown).toContainText('窗口第二位顾问测试家长');
 await expect(eventDrilldown).toContainText('2024-04-01 10:00 记录');
 await expect(eventDrilldown).not.toContainText('窗口首位顾问测试家长');
 const paths=panel.locator('#v34-sales-paths');
 const directTrial=paths.locator('.stat-card').filter({hasText:'未完成面谈即确认试听'});
 await expect(directTrial.locator('strong')).toHaveText('1');
 await directTrial.getByRole('button',{name:'查看未完成面谈即确认试听明细'}).click();
 const pathDetail=panel.locator('#v34-metrics-direct_to_trial_students');
 await expect(pathDetail).toContainText('共 1 名学生');
 await expect(pathDetail).toContainText('窗口第二位顾问测试学生');
 await expect(pathDetail).toContainText('最早记录 2024-04-01 11:00');
 await mode.selectOption('snapshot');
 const asOf=filters.getByLabel('历史时点（上海时间）');
 await asOf.fill('2024-04-01T09:30');
 await apply.click();
 await expect(panel.getByRole('heading',{name:'历史时点状态'})).toBeVisible();
 await expect(asOf).toHaveValue('2024-04-01T09:30');
 const historicStudents=panel.locator('.stat-card').filter({has:page.getByText('当时已关联学生（人）',{exact:true})});
 await expect(historicStudents).toContainText('证据不足');
 await expect(historicStudents).toContainText('历史记录始于');
 await expect(historicStudents.getByRole('button')).toHaveCount(0);
 const snapshotLost=panel.locator('.stat-card').filter({has:page.getByText('当时失单（条）',{exact:true})});
 await expect(snapshotLost.locator('strong')).toHaveText('1');
 await snapshotLost.getByRole('button',{name:'查看当时失单明细'}).click();
 const snapshotDetail=panel.locator('#v34-metrics-snapshot_lost');
 await expect(snapshotDetail).toContainText('窗口第二位顾问测试家长');
 await expect(snapshotDetail).toContainText('2024-04-01 09:00 记录');
 const cash=panel.locator('#v34-snapshot-cash');
 await expect(cash).toContainText('已核实收款 ¥100.00 · 1 笔');
 await expect(cash).toContainText('已核实退款 ¥0.00 · 0 笔');
 await expect(cash).toContainText('净额 ¥100.00');
 await cash.getByRole('button',{name:'查看历史已核实收款明细'}).click();
 const cashDetail=panel.locator('#v34-metrics-snapshot_verified_receipts');
 await expect(cashDetail).toContainText('共 1 笔款项');
 await expect(cashDetail).toContainText('窗口第二位顾问测试家长');
 await expect(cashDetail).toContainText('¥100.00 · 2024-04-01 09:10 核实');
 const overdueActivity=panel.locator('.stat-card').filter({has:page.getByText('当时逾期活动（项）',{exact:true})});
 await expect(overdueActivity.locator('strong')).toHaveText('0');
 await asOf.fill('2024-04-01T08:55');
 await apply.click();
 await expect(overdueActivity.locator('strong')).toHaveText('1');
 await expect(cash).toContainText('已核实收款 ¥0.00 · 0 笔');
 await overdueActivity.getByRole('button',{name:'查看当时逾期活动明细'}).click();
 const overdueDetail=panel.locator('#v34-metrics-snapshot_overdue_activities');
 await expect(overdueDetail).toContainText('共 1 项活动');
 await expect(overdueDetail).toContainText('预约 · 2024-04-01 08:45');
 await mode.selectOption('cohort');
 await start.fill('2024-04-01');
 await end.fill('2024-04-01');
 await apply.click();
 await expect(count).toHaveText('1');
 await filters.getByRole('button',{name:'清除筛选'}).click();
 await expect(start).toHaveValue('');
 await expect(owners).toHaveValue('');
 await expect.poll(async()=>Number(await count.textContent())).toBeGreaterThan(2);
});


test('Boss appointment supervision issues an internal request and resolves it on the assigned appointment',async({page})=>{
 const root='/api/v1/isolated-workspace/workflow';
 await login(page,'sales-a');
 const result=await page.evaluate(({root,number})=>api(root,{
  method:'POST',body:{
   contact_name:'督办回归家长',student_name:'督办回归学生',contact_info:number,origin_group:'sales',source:'到店',
   next:{appointment:{type:'meeting',due_at:new Date(Date.now()-86400000).toISOString()}},
  },
 }),{root,number:phone()});
 const appointmentId=result.workflow.primary_activity_id;
 await login(page,'supervisor');
 await page.getByRole('button',{name:'统计与提醒',exact:true}).click();
 const supervision=page.locator('#v34-appointment-supervision');
 const issue=supervision.locator('#v34-appointment-supervise-'+appointmentId);
 await issue.locator('..').locator('summary').click();
 await issue.getByLabel('督办说明').fill('核实该场面谈结果');
 const shanghaiDeadline=new Date(Date.now()+86400000+8*3600000).toISOString().slice(0,16);
 await issue.getByLabel('督办截止（上海时间）').fill(shanghaiDeadline);
 await issue.getByRole('button',{name:'下发预约督办'}).click();
 const row=supervision.locator('article').filter({hasText:'核实该场面谈结果'});
 await expect(row).toContainText('待处理');
 await expect(issue).toHaveCount(0);

 await login(page,'sales-b');
 await expect(page.locator('#v34-tasks')).toBeVisible();
 await expect(row).toHaveCount(0);
 await login(page,'sales-a');
 await expect(row).toContainText('督办回归家长');
 await row.getByRole('button',{name:'处理指定预约'}).click();
 const activity=page.locator('#activity-'+appointmentId);
 await expect(activity).toBeVisible();
 await activity.getByRole('button',{name:'改期，尚未完成'}).click();
 const reschedule=page.locator('#retime-'+appointmentId);
 const localDate=new Date(Date.now()+2*86400000);
 const localTime=new Date(localDate.getTime()-localDate.getTimezoneOffset()*60000).toISOString().slice(0,16);
 await reschedule.getByLabel('新执行时间').fill(localTime);
 await reschedule.getByLabel('改期原因').fill('家长确认下次到校时间');
 await reschedule.getByRole('button',{name:'保存改期'}).click();
 await expect(row).toHaveCount(0);
 await login(page,'supervisor');
 await page.getByRole('button',{name:'统计与提醒',exact:true}).click();
 await expect(row).toContainText('已销项 · 已改期 · 预约版本 2');
});


test('Boss overdue followup supervision closes after the assigned advisor records an actual result',async({page})=>{
 const root='/api/v1/isolated-workspace/workflow';
 await login(page,'sales-a');
 const result=await page.evaluate(({root,number})=>api(root,{
  method:'POST',body:{
   contact_name:'逾期督办家长',student_name:'逾期督办学生',contact_info:number,origin_group:'sales',source:'到店',
   next:{action:'call',method:'phone',title:'拨打督办回归电话',due_at:new Date(Date.now()-86400000).toISOString()},
  },
 }),{root,number:phone()});
 const taskId=result.workflow.primary_activity_id;
 await login(page,'supervisor');
 await page.getByRole('button',{name:'统计与提醒',exact:true}).click();
 const supervision=page.locator('#v34-followup-supervision');
 const issue=supervision.locator('#v34-followup-supervise-'+taskId);
 await issue.locator('..').locator('summary').click();
 await issue.getByLabel('督办说明').fill('记录这次电话跟进');
 const shanghaiDeadline=new Date(Date.now()+86400000+8*3600000).toISOString().slice(0,16);
 await issue.getByLabel('督办截止（上海时间）').fill(shanghaiDeadline);
 await issue.getByRole('button',{name:'下发跟进督办'}).click();
 const row=supervision.locator('article').filter({hasText:'记录这次电话跟进'});
 await expect(row).toContainText('待处理');
 await login(page,'sales-a');
 await row.getByRole('button',{name:'处理指定跟进待办'}).click();
 const follow=page.locator('#v34-followup');
 await expect(follow).toBeVisible();
 await follow.locator('[name="result"]').selectOption('failed');
 await nextTomorrow(page,follow);
 const sent=page.waitForRequest(request=>request.method()==='POST'&&request.url().endsWith(result.lead_id+'/followup'));
 await follow.getByRole('button',{name:'保存结果并安排下一步'}).click();
 expect((await sent).postDataJSON().task_id).toBe(taskId);
 await expect(row).toHaveCount(0);
 await login(page,'supervisor');
 await page.getByRole('button',{name:'统计与提醒',exact:true}).click();
 await expect(row).toContainText('已销项 · 联系失败 · 跟进待办版本 2');
});


test('Boss arrangement supervision resolves when the assigned advisor repairs the legacy lead',async({page})=>{
 const {rows:[lead]}=await pool.query(`
  WITH contact AS (
   INSERT INTO ms.contacts(organization_id,display_name)
   VALUES('20000000-0000-4000-8000-000000000001','待补督办回归家长') RETURNING id,organization_id
  )
  INSERT INTO ms.leads(organization_id,contact_id,owner_user_id,lead_state)
   SELECT organization_id,id,'20000000-0000-4000-8000-000000000011','working' FROM contact RETURNING id
 `);
 await login(page,'supervisor');
 await page.getByRole('button',{name:'统计与提醒',exact:true}).click();
 const supervision=page.locator('#v34-arrangement-supervision');
 const issue=supervision.locator('#v34-arrangement-supervise-'+lead.id);
 await issue.locator('..').locator('summary').click();
 await issue.getByLabel('督办说明').fill('补齐督办回归安排');
 const shanghaiDeadline=new Date(Date.now()+86400000+8*3600000).toISOString().slice(0,16);
 await issue.getByLabel('督办截止（上海时间）').fill(shanghaiDeadline);
 await issue.getByRole('button',{name:'下发待补安排督办'}).click();
 const row=supervision.locator('article').filter({hasText:'补齐督办回归安排'});
 await expect(row).toContainText('待处理');
 await login(page,'sales-a');
 await row.getByRole('button',{name:'补齐指定客户安排'}).click();
 const repair=page.locator('#v34-repair');
 await expect(repair).toBeVisible();
 await nextTomorrow(page,repair);
 await repair.getByRole('button',{name:'保存安排'}).click();
 await expect(repair).toHaveCount(0);
 await expect(row).toHaveCount(0);
 await login(page,'supervisor');
 await page.getByRole('button',{name:'统计与提醒',exact:true}).click();
 await expect(row).toContainText('已销项 · 已补齐首要安排');
});


test('Boss transfer supervision tracks independent approval and the recipient acceptance',async({page})=>{
 const root='/api/v1/isolated-workspace/workflow';
 await login(page,'sales-a');
 const result=await page.evaluate(({root,number})=>api(root,{
  method:'POST',body:{
   contact_name:'转交督办回归家长',student_name:'转交督办回归学生',contact_info:number,origin_group:'sales',source:'到店',
   next:{action:'call',method:'phone',title:'转交后的跟进',due_at:new Date(Date.now()+86400000).toISOString()},
  },
 }),{root,number:phone()});
 await login(page,'supervisor');
 await page.getByRole('button',{name:'统计与提醒',exact:true}).click();
 const section=page.locator('#v34-transfer-supervision');
 const issue=section.locator('#v34-transfer-supervise');
 await issue.locator('..').getByText('发起转交申请',{exact:true}).click();
 await issue.getByLabel('客户',{exact:true}).selectOption(result.lead_id);
 await issue.getByLabel('接收人').selectOption('20000000-0000-4000-8000-000000000012');
 const reason='独立转交督办流程回归';
 await issue.getByLabel('转交说明').fill(reason);
 const deadline=new Date(Date.now()+86400000+8*3600000).toISOString().slice(0,16);
 await issue.getByLabel('督办截止（上海时间）').fill(deadline);
 await issue.getByRole('button',{name:'提交转交督办'}).click();
 const row=section.locator('article').filter({hasText:reason});
 await expect(row).toContainText('待独立复核');
 await login(page,'general-admin');
 await row.getByRole('button',{name:'打开转交申请'}).click();
 const approval=page.locator('form[id^="approve-transfer-"]');
 await approval.locator('..').getByText('独立复核 Lead 转交',{exact:true}).click();
 await approval.getByLabel('复核原因').fill('独立主管核对通过');
 await approval.getByRole('button',{name:'提交独立复核'}).click();
 await expect(approval).toHaveCount(0);
 await login(page,'sales-b');
 const incoming=page.locator('#v35-handover-tasks article').filter({hasText:reason});
 await incoming.getByRole('button',{name:'确认接手并继承全部待办'}).click();
 await expect(incoming).toHaveCount(0);
 await login(page,'supervisor');
 await page.getByRole('button',{name:'统计与提醒',exact:true}).click();
 await expect(row).toContainText('已销项 · 接收人已确认');
});
