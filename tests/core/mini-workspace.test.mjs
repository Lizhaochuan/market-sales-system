import test from 'node:test';
import assert from 'node:assert/strict';
import {createContext, runInContext} from 'node:vm';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {createApp} from '../../src/app.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../miniprogram');
const workflow='/api/v1/isolated-workspace/workflow';
const passphrase='0';
function miniRuntime(wx, loginConfig) {
 const sandbox=createContext({wx,Page:page=>{sandbox.page=page;}});
 const modules=new Map();
 function load(path) {
  const file=resolve(root,path.endsWith('.js')?path:path+'.js');
  if(loginConfig && file===resolve(root,'lib/login-config.js'))return loginConfig;
  if(modules.has(file))return modules.get(file).exports;
  const module={exports:{}};
  modules.set(file,module);
  const compile=runInContext('(function(module,exports,require){'+readFileSync(file,'utf8')+'\n})',sandbox,{filename:file});
  compile(module,module.exports,specifier=>load(resolve(dirname(file),specifier)));
  return module.exports;
 }
 function page(path) {
  load(path);
  return Object.assign(sandbox.page,{setData(fields) {
   for(const [key,value] of Object.entries(fields)){
    const parts=key.split('.');
    const last=parts.pop();
    const parent=parts.reduce((data,step)=>data[step]??={},this.data);
    parent[last]=value;
   }
  }});
 }
 return {load,page};
}
const real=value=>JSON.parse(JSON.stringify(value));

test('Native mini program uses the PC workflow through the isolated HTTP boundary',async t=>{
 process.env.MS_STAGE='isolated-test';
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
 const migrations=['039_v34_sales_loop','040_role_workspaces','041_historical_student_links','042_appointment_supervision',
  '043_followup_supervision','044_arrangement_supervision','045_appointment_supervision_evidence','046_service_campus_directory'];
 for(const [index,name] of migrations.entries()){
  const exists=await pool.query("SELECT to_regclass('ms_workspace.schema_versions') AS versions");
  if(!exists.rows[0].versions || !(await pool.query('SELECT 1 FROM ms_workspace.schema_versions WHERE version=$1',[34+index])).rowCount)
   await pool.query(readFileSync(new URL('../../db/workspace-migrations/'+name+'.sql',import.meta.url),'utf8'));
 }
 for(const fixture of ['v34-demo-finance','role-workspaces-demo'])
  await pool.query(readFileSync(new URL('../fixtures/'+fixture+'.sql',import.meta.url),'utf8'));
 const app=createApp(pool,{secret:'fictional-mini-regression-secret-at-least32',devLoginSecret:passphrase,workspaceEnabled:true,v34Enabled:true,roleWorkspaces:true});
 await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await new Promise(resolve=>app.close(resolve));await pool.end();});
 const origin='http://127.0.0.1:'+app.address().port;
 let failAfterCommit=false;
 const writes=[];
 const routes=[];
 const wx={
  reLaunch(value){routes.push(value.url);},
  navigateTo(value){routes.push(value.url);},
  request(options) {
   const path=new URL(options.url).pathname;
   if(options.method==='POST'&&path.startsWith(workflow))writes.push({key:options.header['Idempotency-Key'],body:options.data,path});
   void (async()=>{
    try {
     const response=await fetch(origin+new URL(options.url).pathname+new URL(options.url).search,{method:options.method,headers:options.header,
      body:options.data===undefined?undefined:JSON.stringify(options.data)});
     const data=await response.json();
     if(failAfterCommit && options.method==='POST' && path.endsWith('/followup')){
      failAfterCommit=false;
      options.fail();
      return;
     }
     options.success({statusCode:response.status,data});
    } catch { options.fail(); }
   })();
  },
 };
 const runt=miniRuntime(wx), session=runt.load('lib/session'), ui=runt.load('lib/presentation');
 async function pc(path,token,body){
  const response=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',
   ...(token?{authorization:'Bearer '+token}:{}),'idempotency-key':randomUUID()},
   ...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:response.status,...await response.json()};
 }
 const pcUser=(await pc('/api/v1/dev/login',null,{account_code:'sales-a',passphrase})).data;
 const sales=await session.login('sales-a',passphrase);
 assert.equal(sales.workspace_access.sales,true);
 assert.deepEqual(real(ui.tabs(sales.workspace_access).map(pair=>pair[0])),['tasks','customers','calendar','handoff']);

 const suffix=String(Math.floor(Math.random()*10000000)).padStart(7,'0');
 const next=ui.action('虚拟首个联系任务',ui.day(Date.now()+86400000),'20:47');
 const lead=(await pc(workflow,pcUser.token,{contact_name:'小程序虚构家长',student_name:'小程序虚构学生',
  contact_info:'1391'+suffix,origin_group:'sales',source:'主动咨询',next})).data.lead_id;
 const workspace=runt.page('pages/workspace/index');
 workspace.onLoad();
 await workspace.onShow();
 assert.ok(workspace.data.rows.some(row=>row.id===lead));
 assert.doesNotMatch(JSON.stringify(workspace.data.rows),new RegExp('1391'+suffix));
 assert.equal(workspace.data.nav.length,4);

 const page=runt.page('pages/lead/index');
 page.onLoad({id:lead,mode:'followup'});
 await page.onShow();
 assert.ok(page.data.canEdit);
 page.setData({'form.notes':'虚拟弱网跟进','form.next_title':'手动设置的回访','form.next_date':ui.day(Date.now()+2*86400000),'form.next_time':'22:37'});
 await page.saveDraft();
 assert.equal(page.data.notice,'已保存个人草稿');
 assert.equal((await pc(workflow+'/'+lead,pcUser.token)).data.workflow.version,page.data.version);
 assert.equal(new Date(ui.time(page.data.form.next_date,'22:37')).toISOString().slice(11,16),'14:37');
 failAfterCommit=true;
 await page.saveFollowup();
 assert.ok(page.data.retryable);
 await page.retry();
 assert.equal(page.data.retryable,false);
 const replay=writes.filter(item=>item.path.endsWith('/followup'));
 assert.equal(replay.length,2);
 assert.equal(replay[0].key,replay[1].key);
 assert.deepEqual(real(replay[0].body),real(replay[1].body));
 let pcDetail=(await pc(workflow+'/'+lead,pcUser.token)).data;
 assert.equal(pcDetail.events.filter(event=>event.event_name==='V34_COMMUNICATION').length,1);
 assert.equal(pcDetail.records.find(record=>record.id===pcDetail.workflow.primary_activity_id).body.due_at.slice(11,16),'14:37');

 const stale=page.data.version;
 assert.equal((await pc(workflow+'/'+lead+'/arrange',pcUser.token,{expected_version:stale,next})).status,200);
 page.setData({'form.appType':'meeting','form.appDate':ui.day(Date.now()+3*86400000),'form.appTime':'10:00'});
 await page.saveAppointment();
 assert.equal(page.data.conflict,true);
 await page.refresh();
 await page.saveAppointment();
 pcDetail=(await pc(workflow+'/'+lead,pcUser.token)).data;
 const appointment=pcDetail.records.find(record=>record.id===pcDetail.workflow.primary_activity_id);
 assert.equal(appointment.kind,'appointments');
 assert.equal(appointment.state,'pending');
 assert.equal(appointment.body.place,null);
 const draftView=(await pc(workflow+'/'+lead,pcUser.token)).data.records.find(record=>record.kind==='workflow-drafts');
 assert.equal(draftView.body.draft.notes,'虚拟弱网跟进');

 const manager=await session.login('supervisor',passphrase);
 assert.equal(manager.workspace_access.sales_manager,true);
 await workspace.refresh();
 workspace.select({currentTarget:{dataset:{id:'boss'}}});
 await workspace.loadDrill('leads',1);
 assert.equal(workspace.data.drill.total,workspace.data.report.counts.leads);
 page.onUnload();
 page.onLoad({id:lead,mode:'audit'});
 await page.onShow();
 assert.equal(page.data.readOnly,true);
 assert.equal(page.data.draft,null);
 assert.equal(page.data.lead.name,'小程序虚构家长');
 assert.ok(page.data.timeline.some(event=>event.key==='V34_COMMUNICATION'));

 const grant=await pool.query(`SELECT g.id FROM ms.user_role_grants g JOIN ms.role_templates r ON r.id=g.role_id
  WHERE g.user_id=$1 AND r.role_code='sales_manager' AND g.revoked_at IS NULL`,[manager.staff_id]);
 assert.ok(grant.rowCount>0);
 const ids=grant.rows.map(row=>row.id);
 try {
  await pool.query('UPDATE ms.user_role_grants SET revoked_at=now() WHERE id=ANY($1::uuid[])',[ids]);
  await assert.rejects(session.read('/'+lead),error=>error.status===403);
  assert.equal(page.data.lead,null);
  assert.equal(workspace.data.rows.length,0);
 } finally {
  await pool.query('UPDATE ms.user_role_grants SET revoked_at=NULL WHERE id=ANY($1::uuid[])',[ids]);
 }
 await session.login('sales-b',passphrase);
 await assert.rejects(session.read('/'+lead),error=>error.status===403);
 assert.equal(session.identity(),null);
 assert.equal(page.data.lead,null);
 assert.equal(workspace.data.rows.length,0);
 assert.equal(routes.at(-1),'/pages/login/index');
 await session.login('market-a',passphrase);
 const marketBoard=await session.read('/market');
 assert.ok(Array.isArray(marketBoard.items));
 await assert.rejects(session.read('/metrics'),error=>error.status===403);
 page.onUnload();
 workspace.onUnload();
});

test('Native project does not persist credentials or private drafts to device storage',()=>{
 const config=JSON.parse(readFileSync(resolve(root,'app.json'),'utf8'));
 assert.deepEqual(config.pages,['pages/login/index','pages/workspace/index','pages/lead/index']);
 for(const page of config.pages){
  const settings=JSON.parse(readFileSync(resolve(root,page+'.json'),'utf8'));
  assert.ok(settings && typeof settings==='object' && !Array.isArray(settings),page);
 }
 for(const name of ['app.js','lib/session.js','lib/mutation-page.js','lib/presentation.js',...config.pages.map(page=>page+'.js')]){
  assert.doesNotMatch(readFileSync(resolve(root,name),'utf8'),/wx\.(setStorage|getStorage|uploadFile|requestSubscribeMessage)/,name);
 }
});

test('Native strict employee session reads only mobile tasks and clears them after revocation',async()=>{
 const calls=[],navigation=[];
 let revoked=false,strict=true;
 const wx={
  request(options){
   const path=new URL(options.url).pathname;
   calls.push(path);
   assert.equal(options.header.Authorization,'Bearer fictional-signed-staff');
   const data=path==='/api/v1/me'
    ?{display_name:'虚构员工',capabilities:{strict_employee_mode:strict}}
    :{items:[{id:'own-task',title:'虚构待办',due_at:new Date().toISOString()}]};
   options.success({statusCode:revoked?403:200,data:{code:revoked?'FORBIDDEN':'OK',data}});
  },
  reLaunch({url}){navigation.push(url);},
 };
 const runtime=miniRuntime(wx),session=runtime.load('lib/session');
 const page=runtime.page('pages/workspace/index');
 page.onLoad();
 await session.startStaffSession('fictional-signed-staff');
 await page.onShow();
 assert.equal(page.data.staffMode,true);
 assert.equal(page.data.dayTasks[0].title,'虚构待办');
 await assert.rejects(session.read('/options'),/仅支持查看待办/);
 await assert.rejects(session.mutation('/something',{})(),/当前员工会话不支持此操作/);
 revoked=true;
 await page.refresh();
 assert.equal(session.identity(),null);
 assert.equal(page.data.dayTasks.length,0);
 assert.deepEqual(calls,['/api/v1/me','/api/v1/mobile/tasks','/api/v1/mobile/tasks']);
 assert.deepEqual(navigation,['/pages/login/index']);
 revoked=false;strict=false;
 await assert.rejects(session.startStaffSession('fictional-signed-staff'),/未启用严格员工认证/);
 assert.equal(session.identity(),null);
 page.onUnload();
});

test('Native WeChat login uses the isolated HTTPS strict route and handles failed sign-in',async()=>{
 const calls=[],navigation=[];
 let allow=false;
 const wx={
  login({success}){success({code:'fictional-wechat-code'});},
  request(options){
   const path=new URL(options.url).pathname;
   calls.push(path);
   assert.equal(new URL(options.url).origin,'https://fictional-sales.example.invalid');
   if(path==='/api/v1/mobile/wechat/session'){
    assert.deepEqual(real(options.data),{code:'fictional-wechat-code'});
    assert.equal(options.header.Authorization,undefined);
    options.success({statusCode:allow?200:403,data:allow
      ?{code:'OK',data:{credential:'fictional-signed-staff'}}
      :{code:'FORBIDDEN',message:'该员工尚未绑定'}});
    return;
   }
   assert.equal(path,'/api/v1/me');
   assert.equal(options.header.Authorization,'Bearer fictional-signed-staff');
   options.success({statusCode:200,data:{code:'OK',data:{display_name:'虚构员工',capabilities:{strict_employee_mode:true}}}});
  },
  reLaunch({url}){navigation.push(url);},
 };
 const runtime=miniRuntime(wx,{mode:'wechat',staffOrigin:'https://fictional-sales.example.invalid'});
 const session=runtime.load('lib/session'),page=runtime.page('pages/login/index');
 assert.equal(page.data.wechatEnabled,true);
 await page.submitWeChat();
 assert.equal(page.data.message,'该员工尚未绑定');
 assert.equal(session.identity(),null);
 assert.deepEqual(navigation,[]);
 await assert.rejects(session.login('sales-a','0'),/使用微信员工登录/);
 allow=true;
 await page.submitWeChat();
 assert.deepEqual(calls,['/api/v1/mobile/wechat/session','/api/v1/mobile/wechat/session','/api/v1/me']);
 assert.deepEqual(navigation,['/pages/workspace/index']);
 assert.equal(session.isStaffSession(),true);
});

test('Native strict workspace submits scoped follow-up and approval and retries with the same key',async()=>{
 const sent=[];
 let failOnce=true;
 const wx={
  request(options){
   const path=new URL(options.url).pathname;
   const result=data=>options.success({statusCode:200,data:{code:'OK',data}});
   if(path==='/api/v1/me')return result({display_name:'虚构主管',capabilities:{strict_employee_mode:true,strict_mobile_review:true}});
   if(path==='/api/v1/mobile/tasks')return result({
    items:[{id:'own-task',title:'虚构待办',expected_version:4,due_at:new Date().toISOString()}],
    approvals:[{id:'review',operation:'qualification',evidence:'虚构申请'}],
   });
   sent.push({path,body:options.data,key:options.header['Idempotency-Key']});
   if(failOnce){failOnce=false;return options.fail();}
   return result({saved:true});
  },
  reLaunch(){},
 };
 const runtime=miniRuntime(wx),session=runtime.load('lib/session');
 const page=runtime.page('pages/workspace/index');
 page.onLoad();
 await session.startStaffSession('fictional-signed-staff');
 await page.onShow();
 const click=dataset=>({currentTarget:{dataset}});
 const submit=value=>page.submitStaffAction({detail:{value}});
 page.openStaffAction(click({id:'own-task',operation:'followup'}));
 await submit({title:'再次联系',notes:'已咨询课程',result:'communicated',date:'2099-01-01',time:'22:37'});
 assert.equal(page.data.retryable,true);
 await page.retry();
 assert.deepEqual(sent[0],sent[1]);
 assert.equal(sent[1].path,'/api/v1/mobile/actions/followup/own-task');
 assert.equal(sent[1].body.due_at,'2099-01-01T22:37:00+08:00');
 assert.equal(sent[1].body.expected_version,4);
 page.select(click({id:'staff-review'}));
 page.openStaffAction(click({id:'review',operation:'qualification'}));
 await submit({decision:'reject',evidence:'证据不足'});
 assert.equal(page.data.section,'staff-review');
 assert.equal(sent[2].path,'/api/v1/mobile/actions/qualification/review');
 assert.deepEqual({...sent[2].body},{approved:false,evidence:'证据不足'});
 assert.equal(page.data.staffSelection,null);
 page.onUnload();
});
