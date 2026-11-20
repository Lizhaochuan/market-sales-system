// Standalone V3.4 daily workspace, opt-in only. All session/draft state is memory-only.
(()=>{
 const root='/api/v1/isolated-workspace/workflow',nav=document.querySelector('nav[aria-label="模块导航"]'),oldNav=[...nav.children].filter(n=>n.tagName==='BUTTON');
 const box=node('div');box.id='v35-sales-box';box.hidden=true;nav.prepend(box);
 const panel=node('section','view');panel.id='sales-workflow';panel.dataset.panel='sales-workflow';document.querySelector('main.main').append(panel);
 panel.addEventListener('input',e=>{const f=e.target?.closest?.('form');if(f&&f.id!=='v35-lookup'&&!f.closest('#v35-lookup')){f.dataset.userDirty='1';const db=$('v35-discard-draft');if(db&&selected)db.hidden=false;}});
 panel.addEventListener('change',e=>{const f=e.target?.closest?.('form');if(f&&f.id!=='v35-lookup'&&!f.closest('#v35-lookup')){f.dataset.userDirty='1';const db=$('v35-discard-draft');if(db&&selected)db.hidden=false;}});
 let detailHost=panel,enabled=false,view='leads',group='sales',rows=[],staff=[],options=null,selected=null,detail=null,report=null,queue=[],epoch=0,seq=0,searchSeq=0,busy=false,session=null,incoming=[],legacy=new URLSearchParams(location.search).get('workspace')==='legacy';
 let editingQuoteId=null,activityTarget=null,pendingLostFeedback='',card=null,claim=null,marketRows=[],lookupPhone='',lookupResult=null,taskDay=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),taskScope='mine',taskFilter='all',taskView='day',weekAnchorDay=taskDay,myLeadSearch='',myLeadSearchItems=null,myLeadState='all',myLeadSort='default',myLeadView='table',savedViews=[],savedViewSeq=0,listScrollTop=0,winScrollTop=0;
 let metricsQuery="";
 const leadDrafts=new Map();
 function wipeState(){epoch++;seq++;searchSeq++;busy=false;rows=[];staff=[];incoming=[];marketRows=[];options=null;selected=null;detail=null;card=null;activityTarget=null;editingQuoteId=null;pendingLostFeedback='';claim=null;lookupPhone='';lookupResult=null;queue=[];report=null;metricsQuery="";taskView='day';weekAnchorDay=dayKey(Date.now());myLeadSearch='';myLeadSearchItems=null;myLeadState='all';myLeadSort='default';myLeadView='table';savedViews=[];listScrollTop=0;winScrollTop=0;detailHost=panel;leadDrafts.clear();box.hidden=true;}
 function handleAuthFailure(e){if([401,403,404].includes(e?.status)){wipeState();panel.replaceChildren(node('p','',e.status===403?'角色已撤销，工作台已关闭':e.status===404?'客户不存在或无权访问':'登录已过期，工作台已关闭'));return true;}return false;}
 const dayKey=d=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(d));
 const shTimeText=d=>d?new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(d)):'';
 const shDayShift=(ymd,delta)=>{const [y,m,d]=ymd.split('-').map(Number);return new Date(Date.UTC(y,m-1,d+delta)).toISOString().slice(0,10);};
 const shWeekDays=anchor=>{const [y,m,d]=anchor.split('-').map(Number),dt=new Date(Date.UTC(y,m-1,d)),dow=(dt.getUTCDay()+6)%7,mon=Date.UTC(y,m-1,d-dow);return Array.from({length:7},(_,i)=>new Date(mon+i*86400000).toISOString().slice(0,10));};
 const label=(arr,id)=>arr?.find(x=>x.id===id)?.label||id||'待核实';
 const stage=id=>label(options?.stages,id==='unclassified'?'待核实（旧记录）':id);
 const terminalText=t=>t==='won'?'已全款结案':t==='lost'?'已流失结案':t==='legacy_closed'?'旧终态':'跟进中';
 const maskPhone=v=>{if(!v)return '';const s=String(v).trim();if(s.length>=8)return s.slice(0,s.length-8)+'****'+s.slice(-4);if(s.length>=5)return s.slice(0,2)+'***'+s.slice(-2);return '****';};
 const commText=lc=>!lc||!lc.result?'暂无沟通记录':lc.result==='communicated'?'已沟通（'+label(options?.methods,lc.method)+'）':lc.result==='failed'?'未接通'+(lc.failure_reason?'（'+lc.failure_reason+'）':''):lc.result==='waiting'?'已发消息待回复':'其他沟通';
 const appointmentStatusText=ap=>!ap||!ap.type?'未预约面谈/试听':(ap.type==='trial'?'试听':'面谈')+' · '+({pending:'待家长确认',confirmed:'已预约',rescheduled:'已改期',in_progress:'进行中',completed:'已完成',no_show:'未到场',cancelled:'已取消'}[ap.state]||ap.state);
 const isActive=r=>['open','in_progress','pending','confirmed','rescheduled'].includes(r.state);
 const local=d=>new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);
 const nextDay=()=>{const d=new Date();d.setDate(d.getDate()+1);d.setHours(10,0,0,0);return local(d);};
 function btn(p,title,run,cls='secondary'){const b=node('button',cls,title);b.type='button';b.addEventListener('click',run);p.append(b);return b;}
 function input(p,title,name,type='text',value='',required=false){const l=node('label','',title),i=node(type==='textarea'?'textarea':'input');if(type!=='textarea')i.type=type;i.name=name;i.value=value;i.required=required;i.setAttribute('aria-label',title);l.append(i);p.append(l);return i;}
 function select(p,title,name,values,value,required=false){const l=node('label','',title),s=node('select');s.name=name;s.required=required;s.setAttribute('aria-label',title);for(const v of values){const o=document.createElement('option');o.value=typeof v==='string'?v:v.id;o.textContent=typeof v==='string'?v:(v.label||v.display_name);s.append(o);}if(value!==undefined)s.value=value;l.append(s);p.append(l);return s;}
 function conditional(el,show){el.hidden=!show;for(const i of el.querySelectorAll('input,select,textarea'))i.disabled=!show||!!i.closest('[hidden]');}
 const data=f=>Object.fromEntries(new FormData(f));
 function form(p,id,title,saveLabel,run,{open=false,version=detail?.workflow?.version}={}){const d=node('details','panel'),h=node('summary','',title),f=node('form','field-stack');f.id=id;d.open=open;d.append(h,f);p.append(d);if(version){const v=input(f,'','expected_version','hidden',version);v.closest('label').hidden=true;}
  const submit=node('button','primary',saveLabel);submit.type='submit';f.addEventListener('submit',e=>{e.preventDefault();mutate(()=>run(f));});return {d,f,submit};}
 function announce(s){const m=$('v34-message');if(m)m.textContent=s;}
 function display(){setView('sales-workflow');$('page-title').textContent=selected?'客户跟进':view==='finance'?'收款与退款核实':view==='metrics'?'统计与提醒':view==='tasks'?'销售待办':group==='market'?'市场 Leads':'销售 Leads';$('page-eyebrow').textContent='每次联系有结果，每个下一步有时间与负责人';render();}
 function layout(){if(options?.access?.enabled){legacy=false;for(const b of box.querySelectorAll('[data-workflow-nav]')){const v=b.dataset.workflowNav,g=b.dataset.workflowGroup;if(g==='sales')b.textContent='销售 · 新建 / 查询 Leads';if(v==='tasks')b.textContent='我的待办';b.hidden=g==='market'?!options.access.market:v==='finance'?!options.can_verify&&!options.manager:!options.access.sales;}box.querySelector('.text-button').hidden=true;}if(!enabled||!state.token||state.strict){box.hidden=true;return;}box.hidden=false;for(const b of oldNav)b.hidden=!legacy||(b.dataset.managerOnly!==undefined&&!state.capabilities.manage_identity_requests);$('workspace-business-nav').hidden=!legacy;$('student-access-entry').hidden=!legacy;const hint=$('student-access-note')?.nextElementSibling;if(hint?.classList.contains('fineprint'))hint.hidden=!legacy;if(!legacy)$('student-access-note').hidden=true;}
 for(const [v,g,title]of[['leads','market','市场 · 市场 Leads'],['leads','sales','销售 · 销售 Leads'],['tasks',null,'销售待办'],['metrics',null,'统计与提醒'],['finance',null,'收款核实']]){const b=btn(box,title,()=>{if(!options){box.hidden=true;return;}saveCurrentLeadDraft();card=null;claim=null;lookupResult=null;view=v;if(g)group=g;selected=null;detail=null;listScrollTop=0;winScrollTop=0;refresh(true);},'nav-item');b.dataset.workflowNav=v;b.dataset.workflowGroup=g||'';}
 btn(box,'历史与管理',()=>{saveCurrentLeadDraft();legacy=!legacy;layout();if(legacy)setView('overview');else display();},'text-button');
 async function refresh(force=false){if(!enabled||!state.token||state.strict)return;const token=state.token,ticket=++seq,keepForm=!force&&session===state.token&&!!panel.querySelector('form[data-user-dirty="1"]');
  try{const o=await api(root+'/options');const access=o.access;const l=access?.enabled&&!access.sales?{items:[],staff:[],incoming:[]}:await api(root);if(access?.market){const m=await api(root+'/market');if(ticket!==seq||token!==state.token)return;marketRows=m.items;}if(ticket!==seq||token!==state.token)return;options=o;rows=l.items;staff=l.staff;incoming=l.incoming;
   if(session!==token){metricsQuery='';card=null;claim=null;lookupResult=null;lookupPhone='';taskView='day';weekAnchorDay=dayKey(Date.now());myLeadSearch='';myLeadSearchItems=null;myLeadState='all';myLeadSort='default';myLeadView='table';savedViews=[];listScrollTop=0;winScrollTop=0;selected=null;detail=null;leadDrafts.clear();if(access?.enabled){view=access.admin?'metrics':access.sales?'tasks':access.market?'leads':access.finance?'finance':'leads';group=access.sales?'sales':'market';}else if(o.can_verify)view='finance';}else{myLeadSearchItems=null;}layout();
   if(selected){const d=await api(root+'/'+selected);if(ticket!==seq||token!==state.token)return;detail=d;}
   if(view==='metrics'||view==='tasks'){const r=await api(root+'/metrics'+(view==='metrics'?metricsQuery:''));if(ticket!==seq||token!==state.token)return;report=r;}
   if(view==='finance'){const q=await api(root+'/finance');if(ticket!==seq||token!==state.token)return;queue=q.items;}
   if(!keepForm&&(force||session!==token&&!legacy||state.view==='sales-workflow'))display();session=token;
  }catch(e){if(ticket===seq&&token===state.token){if(keepForm&&![401,403,404].includes(e.status)){announce('刷新失败，未保存的输入已保留：'+e.message);return;}if(handleAuthFailure(e))return;panel.replaceChildren(node('p','','读取失败：'+e.message));}}
  }
 function hasDirtyForm(){return !!panel.querySelector('form[data-user-dirty="1"]');}
 function snapshotLead(leadId){if(!leadId)return null;const isDraftCard=card&&!['scheduled','recorded','trial-next'].includes(card);const forms=[...panel.querySelectorAll('form')].filter(f=>f.id!=='v35-lookup'&&!f.closest('#v35-lookup')).map(f=>({id:f.id,dirty:f.dataset.userDirty==='1',open:f.closest('details')?.open,fields:[...f.querySelectorAll('input,select,textarea')].filter(i=>i.type!=='file').map(i=>({name:i.name,value:i.value,checked:i.checked}))}));if(!forms.some(f=>f.dirty)&&!isDraftCard)return null;return {leadId,card:isDraftCard?card:null,activityTarget,editingQuoteId,forms};}
 function restoreLeadDraft(draft){if(!draft?.forms)return;if(draft.card)card=draft.card;if(draft.activityTarget)activityTarget=draft.activityTarget;if(draft.editingQuoteId)editingQuoteId=draft.editingQuoteId;for(const saved of draft.forms){const f=$(saved.id);if(!f)continue;if(saved.id==='v34-quote'){const count=saved.fields.filter(v=>v.name==='course').length;while(f.querySelectorAll('.v34-course').length<count){const add=[...f.querySelectorAll('button')].find(b=>b.textContent==='增加课程');if(add)add.click();else break;}}const used={};for(const v of saved.fields){const i=f.querySelectorAll('[name="'+v.name+'"]')[used[v.name]||0];used[v.name]=(used[v.name]||0)+1;if(!i)continue;if(i.type==='checkbox')i.checked=v.checked;else i.value=v.value;if(i.tagName==='SELECT')i.dispatchEvent(new Event('change',{bubbles:true}));}if(saved.open&&f.closest('details'))f.closest('details').open=true;if(saved.dirty)f.dataset.userDirty='1';f.dispatchEvent(new Event('input',{bubbles:true}));if(saved.id==='v34-quote')f.querySelector('[name="unit"]')?.dispatchEvent(new Event('input',{bubbles:true}));}}
 function saveCurrentLeadDraft(){if(!selected)return;const draft=snapshotLead(selected);if(draft)leadDrafts.set(selected,draft);}
 async function openLead(id,recordId=null){saveCurrentLeadDraft();const lp=panel.querySelector('.v35-split-list');if(lp)listScrollTop=lp.scrollTop;winScrollTop=window.scrollY;card=null;claim=null;activityTarget=null;pendingLostFeedback='';const token=state.token,ticket=++seq;selected=id;detail=null;display();try{const d=await api(root+'/'+id);if(token!==state.token||ticket!==seq)return;detail=d;if(recordId&&options?.access?.enabled){const r=d.records.find(r=>r.id===recordId&&isActive(r));if(r){activityTarget=r.id;card=r.kind==='appointments'?'activity-result':'followup';}}const savedDraft=leadDrafts.get(id);if(savedDraft){if(savedDraft.card)card=savedDraft.card;if(savedDraft.activityTarget)activityTarget=savedDraft.activityTarget;if(savedDraft.editingQuoteId)editingQuoteId=savedDraft.editingQuoteId;}display();if(savedDraft){restoreLeadDraft(savedDraft);announce('已恢复本客户未保存的临时草稿');}}catch(e){if(token===state.token&&ticket===seq){if(handleAuthFailure(e))return;announce(e.message);}}}
 async function mutate(run){if(busy)return;busy=true;const token=state.token,ticket=epoch;panel.querySelectorAll('button').forEach(b=>b.disabled=true);try{const destination=await run();if(token!==state.token||ticket!==epoch)return;if(options?.access?.enabled&&selected){card=typeof destination==='string'?destination:null;if(!['followup','activity','activity-result','activity-retime'].includes(card))activityTarget=null;}if(selected)leadDrafts.delete(selected);await refresh(true);if(token===state.token&&ticket===epoch)announce('已保存，后续安排已保留');}catch(e){if(token===state.token&&ticket===epoch){if(handleAuthFailure(e))return;announce(e.message);panel.querySelectorAll('button').forEach(b=>b.disabled=false);}}finally{if(ticket===epoch)busy=false;}}
 const post=(id,action,b)=>api(root+'/'+id+'/'+action,{method:'POST',body:{...b,expected_version:Number(b.expected_version)}});
 function timePresets(p,i){const row=node('div','trial-preset-row');for(const [title,days]of[['明天',1],['三天后',3],['一周后',7]])btn(row,title,()=>{const d=new Date();d.setDate(d.getDate()+days);d.setHours(10,0,0,0);i.value=local(d);i.dispatchEvent(new Event('input',{bubbles:true}));});p.append(row);}
 function nextFields(p,{allowExisting=true,exclude=null,defaultAction='call'}={}){
  const fieldset=node('fieldset','v34-next');fieldset.append(node('legend','','下一步怎么办？'));p.append(fieldset);
  const eligible=(detail?.records||[]).filter(r=>['tasks','appointments'].includes(r.kind)&&isActive(r)&&r.id!==exclude);
  const existing=select(fieldset,'下一步活动','next_existing',[{id:'',label:'安排新动作'},...(allowExisting?eligible.map(r=>({id:r.id,label:r.body.title+' · '+dateText(r.body.due_at)})):[])],'');
  if(options?.access?.enabled&&allowExisting&&eligible.some(r=>r.id===detail?.workflow?.primary_activity_id))existing.value=detail.workflow.primary_activity_id;
  if(existing.options.length===1){existing.closest('label').hidden=true;existing.disabled=true;}
  const custom=node('div','field-stack');fieldset.append(custom);let kind=null,booking=null;if(options?.access?.enabled){kind=select(custom,'接下来怎么做','next_kind',[{id:'task',label:'安排一次联系 / 跟进'},{id:'trial',label:'试听时间已确定，直接预约'},{id:'meeting',label:'面谈时间已确定，直接预约'}],'task');booking=node('div','field-stack');custom.append(booking);if(p.id==='v35-claim'&&claim?.students?.length){if(claim.students.length>1)select(booking,'本次预约学生','next_student_id',claim.students.map(s=>({id:s.id,label:s.name})),undefined,true);}else if(p.id!=='v34-intake')studentFields(booking,'next_');input(booking,'预约日期和时间','next_booking_at','datetime-local','',true);classroomField(booking,'next_booking_place');input(booking,'试听课程','next_booking_course','text','数学',true);}
  const taskFields=node('div','field-stack');custom.append(taskFields);const a=select(taskFields,'下一步做什么','next_action',options.actions,defaultAction,true);
  const m=select(taskFields,'下次通过什么方式','next_method',options.methods,'phone',true);
  const title=input(taskFields,'具体事项','next_title','text','了解学生需求，确认方便沟通的时间',true);title.maxLength=300;
  const at=input(taskFields,'执行日期和时间','next_at','datetime-local','',true);timePresets(taskFields,at);
  const presets={confirm_trial:['phone','联系家长确定试听时间'],schedule_trial:['phone','联系家长安排试听'],reschedule_visit:['phone','联系家长重新确定预约时间'],confirm_course:['phone','与家长确认课程方案'],first_payment:['phone','跟进首笔付款'],wechat:['wechat_text','微信询问家长方便到校的时间'],voice:['wechat_voice','语音确认家长下一次方便沟通的时间'],check_reply:['wechat_text','检查家长回复，如未回复主动再次询问'],trial_feedback:['phone','回访家长试听感受，确认下一步课程意向'],balance:['phone','确认剩余学费的约定付款时间'],confirm_visit:['phone','联系家长确定到校面谈日期和时间']};
  a.addEventListener('change',()=>{const v=presets[a.value];if(v){m.value=v[0];title.value=v[1];}else title.value=label(options.actions,a.value)+'，确认下一步具体安排';});
  function syncNext(){if(kind&&p.id==='v34-intake'&&p.elements.student_name)p.elements.student_name.required=kind.value!=='task'&&!p.elements.student_id?.value;conditional(custom,!existing.value);conditional(taskFields,!existing.value&&(!kind||kind.value==='task'));if(booking){const activeBooking=!existing.value&&kind.value!=='task',isTrial=activeBooking&&kind.value==='trial';conditional(booking,activeBooking);for(const n of ['next_booking_place','next_booking_course']){const el=booking.querySelector('[name="'+n+'"]');el.closest('label').hidden=kind.value!=='trial';el.disabled=!isTrial;el.required=isTrial;}}}existing.addEventListener('change',syncNext);kind?.addEventListener('change',syncNext);if(kind&&p.id==='v34-intake')p.elements.student_id?.addEventListener('change',syncNext);if(options?.access?.enabled&&defaultAction!=='call')a.dispatchEvent(new Event('change'));syncNext();
  return {el:fieldset,read:()=>existing.value?{id:existing.value}:kind&&kind.value!=='task'?{appointment:{type:kind.value,due_at:localIso(p.querySelector('[name="next_booking_at"]').value),...(kind.value==='trial'?{place:p.querySelector('[name="next_booking_place"]').value,course:p.querySelector('[name="next_booking_course"]').value}:{}),...(p.id==='v34-intake'?{}:studentBody(p,'next_'))}}:{action:a.value,method:m.value,title:title.value,due_at:localIso(at.value)},sync:syncNext,allowBooking:value=>{if(!kind)return;kind.closest('label').hidden=!value;kind.disabled=!value;if(!value&&kind.value!=='task')kind.value='task';for(const o of kind.options)if(o.value!=='task')o.disabled=!value;syncNext();},setAction:value=>{a.value=value;a.dispatchEvent(new Event('change'));}};
 }
 function classroomField(p,name){if(options?.classrooms?.length){const first=options.classrooms[0];return select(p,'教室名称',name,options.classrooms,typeof first==='string'?first:first.id,true);}const i=input(p,'教室名称',name,'text','101教室',true);i.placeholder='例如：101教室';return i;}
 function studentFields(f,prefix=''){if(!detail?.students?.length){input(f,'学生姓名',prefix+'student_name','text','',true);return;}const sel=select(f,'本次涉及学生',prefix+'student_id',[...detail.students.map(s=>({id:s.id,label:s.display_name})),{id:'__new__',label:'+ 新增同家庭学生'}],detail.students[0].id,true);const add=input(f,'新增学生姓名',prefix+'student_name','text','',true);const sync=()=>{const isNew=sel.value==='__new__';add.closest('label').hidden=!isNew;add.disabled=!isNew||!!add.closest('[hidden]');add.required=isNew;};sel.addEventListener('change',sync);sync();}
 function studentBody(f,prefix=''){const id=f.querySelector('[name="'+prefix+'student_id"]')?.value,name=f.querySelector('[name="'+prefix+'student_name"]')?.value;if(id==='__new__')return {student_name:name||''};const b={};if(id)b.student_id=id;else if(name!==undefined)b.student_name=name;return b;}
 const dateText=d=>d?new Date(d).toLocaleString('zh-CN',{hour12:false}):'未安排';
 function render(){panel.replaceChildren();const m=node('p','','');m.id='v34-message';m.setAttribute('role','status');panel.append(m);if(claim){renderClaim();return;}if(options?.access?.enabled&&!options.access.market&&!options.access.sales&&!options.access.finance){panel.append(node('p','','当前账号暂无工作台角色，请联系管理员分配。'));return;}if(options?.access?.enabled&&view==='leads'&&group==='market'){renderMarket();return;}if(options?.access?.enabled&&view==='leads'&&lookupResult!==null&&!selected){renderPhoneIntake();return;}if(options?.access?.enabled&&(view==='tasks'||(view==='leads'&&lookupResult===null))){const split=node('div','v35-split'+(selected?' has-detail':''));split.id='v35-split-workspace';const listPane=node('div','v35-split-list');split.append(listPane);panel.append(split);if(view==='tasks')renderRoleTasks(listPane);else renderPhoneIntake(listPane);listPane.addEventListener('scroll',()=>{listScrollTop=listPane.scrollTop;});if(selected){const side=node('aside','panel v35-side-detail');side.id='v35-side-detail';split.append(side);detailHost=side;renderLead(side);detailHost=panel;}requestAnimationFrame(()=>{if(listScrollTop)listPane.scrollTop=listScrollTop;if(!selected&&winScrollTop)window.scrollTo(0,winScrollTop);});return;}if(selected){detailHost=panel;renderLead(panel);detailHost=panel;return;}if(view==='metrics'){renderMetrics();return;}if(view==='finance'){renderFinance();return;}if(view==='tasks'){renderTasks();return;}renderList();}
 function renderList(intakeOnly=false){
  if(incoming.length){const q=node('p','form-hint','有 '+incoming.length+' 项经批准的客户转交等待您确认接手。');panel.append(q);btn(panel,'查看待接手客户',()=>{saveCurrentLeadDraft();view='tasks';refresh(true);});}
  const c=form(panel,'v34-intake',group==='market'?'录入市场 Lead':'接单 / 新建 Lead','保存客户及首次安排',async f=>{const b=data(f);const payload={contact_name:b.contact_name,student_name:b.student_name,contact_info:options?.access?.enabled?lookupPhone:b.contact_info,source:b.source,origin_group:group,notes:b.notes,next:n.read(),...(initial?.read()?{initial_communication:initial.read()}:{})};if(b.student_id){payload.student_id=b.student_id;delete payload.student_name;}if(options?.access?.enabled)payload.origin_group='sales';if(b.owner_user_id)payload.owner_user_id=b.owner_user_id;const token=state.token,ticket=epoch;const d=await api(root,{method:'POST',body:payload});if(token===state.token&&ticket===epoch){selected=d.lead_id;if(payload.next.appointment)return 'scheduled';if(payload.initial_communication)return 'recorded';}},{version:null});
  input(c.f,'联系人姓名','contact_name','text','',true);select(c.f,'已有学生（选填）','student_id',[{id:'',label:'新学生 / 暂未识别'},...state.students.map(s=>({id:s.student_id,label:s.display_name}))],'');const newName=input(c.f,'新学生姓名（可稍后补充）','student_name');c.f.elements.student_id.addEventListener('change',()=>{newName.closest('label').hidden=!!c.f.elements.student_id.value;});if(!options?.access?.enabled)input(c.f,'联系方式（选填）','contact_info');else c.f.append(node('p','form-hint','电话号码：'+lookupPhone));select(c.f,'最初获客来源','source',['市场活动','网络咨询','到店','转介绍','主动咨询','其他'],group==='market'?'市场活动':'主动咨询');input(c.f,'沟通内容或备注（选填）','notes');if(staff.length)select(c.f,'销售负责人','owner_user_id',staff,state.user.staff_id);
  const initial=options?.access?.enabled?initialFields(c.f):null,n=nextFields(c.f,{allowExisting:false});initial?.bind(n.allowBooking);c.f.append(c.submit);
  if(intakeOnly){c.d.open=true;return;}const list=node('div','panel');list.id='v34-leads';panel.append(list);const search=input(list,'查找客户','search','search');const filter=select(list,'客户状态','state_filter',[{id:'all',label:'全部'},{id:'open',label:'Open · 跟进中'},{id:'won',label:'Closed Won'},{id:'lost',label:'Closed Lost'},{id:'missing',label:'待补下一步安排'}],'all');const rowsEl=node('div');list.append(rowsEl);
  function draw(){rowsEl.replaceChildren();for(const l of rows.filter(l=>(group!=='market'||l.origin_group==='market')&&(!search.value||[l.contact_name,l.contact_info_masked,...(l.students||[]).map(s=>s.name)].some(v=>v?.includes(search.value)))&&(filter.value==='all'||filter.value==='missing'?filter.value!=='missing'||l.needs_arrangement:l.terminal_state===filter.value))){const card=node('article','lead-row');card.append(node('strong','',l.contact_name||'待识别客户'),node('p','',stage(l.stage)+' · '+l.terminal_state+' · '+l.owner_name));if(l.needs_assignment)card.append(node('p','form-hint warning','负责人待分配，需主管处理；原待办保留'));if(l.next_action)card.append(node('p',l.overdue?'form-hint warning':'form-hint','下一步：'+l.next_action.title+' · '+dateText(l.next_action.due_at)+(l.overdue?' · 已逾期':'')));else card.append(node('p','form-hint warning','待补安排：旧数据未设置下一步，不会自动编造时间'));btn(card,'打开客户',()=>openLead(l.id));rowsEl.append(card);}if(!rowsEl.childElementCount)rowsEl.append(node('p','','暂无记录'));}search.addEventListener('input',draw);filter.addEventListener('change',draw);draw();
 }
 function renderTasks(){const p=node('div','panel');p.id='v34-tasks';panel.append(p);for(const r of incoming){const card=node('article','lead-row');card.append(node('p','','待接手客户 · '+r.reason));btn(card,'确认接手并继承全部待办',()=>mutate(()=>post(r.lead_id,'accept-transfer',{record_id:r.id,expected_version:r.version})));p.append(card);}for(const a of report?.pending_approvals||[]){const card=node('article','lead-row');card.append(node('strong','',(a.contact_name||'待识别客户')+' · '+a.title),node('p','fineprint','负责人：'+(a.owner_name||'待分配')));if(a.can_review)btn(card,'前往独立复核',()=>openLead(a.lead_id));else card.append(node('p','fineprint','本人关联事项 · 须另一位主管独立复核'));p.append(card);}for(const r of report?.reminders||[]){const l=rows.find(l=>l.id===r.lead_id);if(!l)continue;const card=node('article','lead-row');card.append(node('strong','',l.contact_name||'待识别客户'),node('p','',r.title+' · '+dateText(r.due_at)+' · '+l.owner_name));if(r.overdue)card.append(node('p','form-hint warning','已逾期，仍须跟进；不会自动关闭'));btn(card,'执行 / 记结果',()=>openLead(l.id));p.append(card);}for(const l of rows.filter(l=>l.needs_arrangement)){const card=node('article','lead-row');card.append(node('p','','待补安排 · '+(l.contact_name||'待识别客户')+' · '+l.owner_name));btn(card,'补充安排',()=>openLead(l.id));p.append(card);}}
 function renderLead(host=panel){const l=rows.find(l=>l.id===selected);const backLabel=options?.access?.enabled?(view==='tasks'?'返回我的待办':view==='metrics'?'返回统计与提醒':'返回客户列表'):'返回客户列表';
  btn(host,backLabel,()=>{saveCurrentLeadDraft();selected=null;detail=null;card=null;activityTarget=null;if(options?.access?.enabled){if(view==='leads')lookupResult=null;refresh(true);}else{view='leads';display();}},'secondary');
  if(selected){
   const discardBtn=btn(host,'放弃未保存修改',()=>{if(confirm('确定放弃本次未保存的修改吗？')){leadDrafts.delete(selected);card=null;activityTarget=null;for(const f of panel.querySelectorAll('form[data-user-dirty="1"]')){delete f.dataset.userDirty;f.reset();}display();announce('已放弃未保存修改');}},'text-button');
   discardBtn.id='v35-discard-draft';
   discardBtn.hidden=!(leadDrafts.has(selected)||hasDirtyForm());
  }
  if(!l){host.append(node('p','','该记录已转交或无权访问'));return;}host.append(node('h2','',l.contact_name||'待识别客户'));if(!detail){host.append(node('p','','读取中…'));return;}
  const w=detail.workflow;host.append(node('p','',((detail.students||[]).map(s=>s.display_name).join('、')||'学生待识别')+' · 负责人：'+l.owner_name),node('p','','来源：'+(l.original_source||'待确认')+' · 进展：'+stage(w?.stage)+' · '+(w?.terminal_state||'旧记录待核实')));host.append(node('p','','当前来源：'+(l.current_source||l.original_source||'待确认')));
  if(w?.do_not_contact)host.append(node('p','form-hint warning','客户已明确要求不再联系，常规招生待办已停止。'));if(w?.contact_info)host.append(node('p','','联系方式：'+w.contact_info));const courses=[...new Set(detail.records.filter(r=>r.kind==='quotes').flatMap(r=>(r.body.items||[]).map(i=>i.course_label)))];if(courses.length)host.append(node('p','','意向课程：'+courses.join('、')));const es=detail.records.filter(r=>r.kind==='enrollments');host.append(node('p','','报名：'+(es.length?es.map(r=>enrollLabel(r.state)).join('、'):'未发起报名')));
  if(!w){const c=form(host,'v34-repair','补充下一步安排','保存安排',f=>post(selected,'arrange',{...data(f),next:n.read()}),{open:true,version:null}),n=nextFields(c.f,{allowExisting:false});c.f.append(c.submit);timeline();return;}
  const primary=detail.records.find(r=>r.id===w.primary_activity_id&&isActive(r));
  if(primary){const p=node('div','panel');p.id='v34-primary';p.append(node('h3','','下一步 · '+(Date.parse(primary.body.due_at)<Date.now()?'已逾期':primary.state==='pending'?'待家长确认':'待执行')),node('p','',primary.body.title),node('p','',dateText(primary.body.due_at)+' · '+label(options.methods,primary.body.method)+(primary.kind==='appointments'&&primary.body.type==='trial'&&primary.body.place?' · '+primary.body.place:'')+(primary.kind==='appointments'&&primary.body.course?' · '+primary.body.course:'')+' · '+l.owner_name));if(options?.access?.enabled){if(w.terminal_state==='open'&&!['followup','activity','activity-result','activity-retime'].includes(card)){const actions=node('div','trial-preset-row');p.append(actions);if(primary.kind==='tasks')btn(actions,'去跟进 / 记录沟通结果',()=>{activityTarget=primary.id;setCard('followup');},'primary');else{btn(actions,primary.body.type==='trial'?'记录试听结果':'记录面谈结果',()=>{activityTarget=primary.id;setCard('activity-result');},'primary');btn(actions,'预约改期',()=>{activityTarget=primary.id;setCard('activity-retime');});if(primary.state==='pending')btn(actions,'确认已与家长确定时间',()=>mutate(()=>post(selected,'activity',{expected_version:w.version,record_id:primary.id,transition:'confirmed'})));}}}else btn(p,'执行 / 记结果',()=>{if(primary.kind==='appointments')document.querySelector('[data-activity="'+primary.id+'"]')?.scrollIntoView({block:'center'});else{$('v34-followup')?.closest('details').setAttribute('open','');$('v34-followup')?.scrollIntoView({block:'center'});}});host.append(p);}
  if(options?.access?.enabled){renderCardOperations(l);return;}
  const open=w.terminal_state==='open';if(open){const contact=form(host,'v34-contact','补充 / 更新联系方式','保存联系方式',f=>post(selected,'contact',data(f)));input(contact.f,'联系方式','contact_info','text',w.contact_info||'',true);contact.f.append(contact.submit);const src=form(host,'v34-source','修正当前获客来源','保存当前来源',f=>post(selected,'source',data(f)));select(src.f,'当前获客来源','source',['市场活动','网络咨询','到店','转介绍','主动咨询','其他'],l.current_source||l.original_source);src.f.append(src.submit);followup();appointmentForm();quoteForm();enrollForm();closeLost();}
  records();managerForms();timeline();
 }
 function followup(){
  const leadId=selected,w=detail.workflow;const c=form(detailHost,'v34-followup','记跟进','保存结果并安排下一步',async f=>{const b=payload(f);await post(leadId,'followup',b);if(b.next?.appointment)return 'scheduled';},{open:true});
  if(detail.students.length>1){const subject=select(c.f,'本次实际涉及的学生（可多选）','student_ids',detail.students.map(s=>({id:s.id,label:s.display_name})),detail.students[0].id,true);subject.multiple=true;subject.size=Math.min(4,detail.students.length);}
  const category=select(c.f,'这次怎么联系','category',[{id:'online',label:'线上沟通'},{id:'offline',label:'线下沟通'}],'online');const method=select(c.f,'具体联系方式','method',options.methods.filter(m=>!['campus','visit','event','offline_other'].includes(m.id)),'phone',true);
  const result=select(c.f,'本次沟通结果','result',[{id:'',label:'请选择本次结果'},{id:'failed',label:'未联系成功'},{id:'communicated',label:'已完成沟通'},{id:'other',label:'其他'}],'',true);const reason=select(c.f,'未联系成功的原因','failure_reason',options.failure_reasons.phone,'无人接听');
  const notes=input(c.f,'沟通内容或说明','notes','textarea');notes.maxLength=1000;
  const purpose=select(c.f,'本次主要目的','purpose',[{id:'',label:'普通沟通（不涉及邀约）'},{id:'needs',label:'了解学生需求'},{id:'invite',label:'邀约家长线下面谈'},{id:'present_course',label:'介绍课程及价格'},{id:'trial',label:'跟进试听'},{id:'enrollment',label:'跟进报名'},{id:'return',label:'普通回访'},{id:'other',label:'其他'}],'');
  const invite=select(c.f,'邀约结果','invite_result',[{id:'waiting',label:'已发出邀请，待回复'},{id:'agreed_unscheduled',label:'家长同意，时间未定'},{id:'confirmed',label:'已确认面谈时间'},{id:'unavailable',label:'家长暂时不方便'},{id:'declined',label:'本次邀约被拒绝'},{id:'other',label:'其他'}],'waiting');
  const meeting=node('div','field-stack');c.f.append(meeting);studentFields(meeting,'meeting_');input(meeting,'面谈日期和时间','meeting_at','datetime-local','',true);
  const actual=node('div','field-stack');c.f.append(actual);input(actual,'确认已实际到场并完成本次面谈','actual_done','checkbox');input(actual,'实际面谈时间','actual_at','datetime-local',local(new Date()),true);
  const s=select(c.f,'当前销售进展','stage',[{id:'unclassified',label:'待核实（旧记录）'},...options.stages],w.stage);
  const pause=input(c.f,'暂缓原因','pause_reason','text',w.pause_reason||'');
  const context=activeTarget();if(options?.access?.enabled&&context)c.f.prepend(node('p','form-hint',context.kind==='appointments'?'当前已安排预约：'+context.body.title+' · '+dateText(context.body.due_at):'本次待办：'+context.body.title));const previous=detail.events.find(e=>e.event_name==='V34_COMMUNICATION');if(options?.access?.enabled&&previous)c.f.prepend(node('p','fineprint','上次沟通：'+(previous.after_business_json.notes||dateText(previous.happened_at))));
  const n=nextFields(c.f,{exclude:primaryTaskId(),defaultAction:context?.body.action==='confirm_trial'?'confirm_trial':'call'});c.f.append(c.submit);btn(c.f,'先保存草稿',()=>mutate(()=>post(leadId,'draft',{expected_version:data(c.f).expected_version,draft:data(c.f)})));
  function changeMethod(){const prev=method.value;method.replaceChildren();for(const m of options.methods.filter(m=>category.value==='offline'?['campus','visit','event','offline_other'].includes(m.id):!['campus','visit','event','offline_other'].includes(m.id)))method.append(option(m.id,m.label));if([...method.options].some(o=>o.value===prev))method.value=prev;changeResult();}
  function changeResult(){const prev=result.value;result.replaceChildren();for(const [id,label]of[['','请选择本次结果'],['failed','未联系成功'],...(['wechat_text','online_other'].includes(method.value)?[['waiting','已发送消息待回复']]:[]),['communicated','已完成沟通'],['other','其他']])result.append(option(id,label));if([...result.options].some(o=>o.value===prev))result.value=prev;const values=options.failure_reasons[method.value]||options.failure_reasons[category.value==='offline'?'offline':'phone'];reason.replaceChildren();for(const r of values)reason.append(option(r,r));sync();}
  function sync(){if(options?.access?.enabled)n.allowBooking(result.value==='communicated');const hasActual=['campus','visit'].includes(method.value)&&result.value==='communicated';conditional(actual,hasActual);actual.querySelector('[name="actual_done"]').required=hasActual;reason.closest('label').hidden=result.value!=='failed';reason.disabled=result.value!=='failed';notes.required=result.value==='other'||result.value==='failed'&&reason.value==='其他';purpose.closest('label').hidden=!['communicated','waiting'].includes(result.value);purpose.disabled=!['communicated','waiting'].includes(result.value);for(const o of purpose.options)o.disabled=result.value==='waiting'&&!['','invite'].includes(o.value);if(result.value==='waiting'&&!['','invite'].includes(purpose.value))purpose.value='';const inviting=['communicated','waiting'].includes(result.value)&&purpose.value==='invite';for(const o of invite.options)o.disabled=result.value==='waiting'&&o.value!=='waiting';if(result.value==='waiting')invite.value='waiting';invite.closest('label').hidden=!inviting;invite.disabled=!inviting;conditional(meeting,inviting&&invite.value==='confirmed');conditional(n.el,!(inviting&&invite.value==='confirmed'));s.closest('label').hidden=result.value!=='communicated';s.disabled=result.value!=='communicated';pause.closest('label').hidden=result.value!=='communicated'||s.value!=='paused';pause.required=s.value==='paused';if(s.value==='declined'){if(options?.access?.enabled){pendingLostFeedback=notes.value;setCard('lost');announce('明确不报名请填写结案确认；刚才填写的沟通说明已带入客户反馈。');return;}$('v34-lost')?.closest('details').setAttribute('open','');announce('明确不报名请填写下方结案确认；不要再安排招生联系。');}}
  for(const i of[result,reason,purpose,invite,s])i.addEventListener('change',sync);category.addEventListener('change',changeMethod);method.addEventListener('change',changeResult);c.f.addEventListener('input',sync);if(options?.access?.enabled&&context?.kind==='tasks'){const cm=context.body.method;category.value=['campus','visit','event','offline_other'].includes(cm)?'offline':'online';changeMethod();method.value=cm;changeResult();if(['confirm_trial','schedule_trial','trial_feedback'].includes(context.body.action))purpose.value='trial';}sync();
  function payload(f){const b=data(f),p={expected_version:b.expected_version,method:b.method,result:b.result,notes:b.notes,...(b.stage?{stage:b.stage}:{})};if(f.querySelector('[name="student_ids"]'))p.student_ids=[...f.querySelector('[name="student_ids"]').selectedOptions].map(o=>o.value);if(['campus','visit'].includes(b.method)&&b.result==='communicated')p.meeting_actual={confirmed_completed:f.elements.actual_done.checked,at:localIso(b.actual_at)};if(b.failure_reason)p.failure_reason=b.failure_reason;if(b.pause_reason)p.pause_reason=b.pause_reason;if(b.purpose)p.purpose=b.purpose;if(b.invite_result)p.invite_result=b.invite_result;if(b.invite_result==='confirmed')p.appointment={type:'meeting',due_at:localIso(b.meeting_at),...studentBody(f,'meeting_')};else p.next=n.read();if(primaryTaskId())p.task_id=primaryTaskId();return p;}
 }
 function activeTarget(){const target=activityTarget?detail?.records.find(r=>r.id===activityTarget&&isActive(r)):null;return target||detail?.records.find(r=>r.id===detail.workflow?.primary_activity_id&&isActive(r))||null;}
 function primaryTaskId(){const r=activeTarget();return r?.kind==='tasks'?r.id:null;}
 function applyFollowupDraft(draft){if(options?.access?.enabled&&!$('v34-followup'))setCard('followup');const f=$('v34-followup');if(!f)return;for(const [key,value] of Object.entries(draft||{})){const i=f.elements.namedItem(key);if(!i||!i.tagName||key==='expected_version')continue;i.value=String(value);if(i.tagName==='SELECT')i.dispatchEvent(new Event('change',{bubbles:true}));}if(f.closest('details'))f.closest('details').open=true;f.dataset.userDirty='1';f.dispatchEvent(new Event('input',{bubbles:true}));f.scrollIntoView({block:'center'});announce('已恢复未完成草稿；正式保存前会重新核对客户版本。');}
 function appointmentForm(){const id=selected;const c=form(detailHost,'v34-appointment','约面谈 / 试听','保存预约',f=>{const b=data(f);return post(id,'appointment',{expected_version:b.expected_version,appointment:{type:b.type,...studentBody(f),due_at:localIso(b.at),...(b.type==='trial'?{place:b.place,course:b.course}:{}),state:b.appointment_state}});});select(c.f,'预约类型','type',[{id:'meeting',label:'线下面谈'},{id:'trial',label:'学生试听'}],'meeting');studentFields(c.f);input(c.f,'预约日期和时间','at','datetime-local','',true);const place=classroomField(c.f,'place');const course=input(c.f,'试听课程','course','text','数学');select(c.f,'预约确认状态','appointment_state',[{id:'confirmed',label:'已与家长确认时间'},{id:'pending',label:'待家长确认'}],'confirmed');const sync=()=>{const isTrial=c.f.elements.type.value==='trial';place.closest('label').hidden=!isTrial;place.disabled=!isTrial;place.required=isTrial;course.closest('label').hidden=!isTrial;course.disabled=!isTrial;course.required=isTrial;};c.f.elements.type.addEventListener('change',sync);c.f.addEventListener('input',sync);sync();c.f.append(c.submit);}
 function quoteForm(record=null){const id=selected;$('v34-quote')?.closest('details').remove();const c=form(detailHost,'v34-quote',record?'修改课程方案':'课程方案','保存课程方案',f=>{const b=data(f),items=[...f.querySelectorAll('.v34-course')].map(r=>({course_label:r.querySelector('[name="course"]').value,quantity:Number(r.querySelector('[name="quantity"]').value),unit_cents:cents(r.querySelector('[name="unit"]').value),standard_unit_cents:cents(r.querySelector('[name="standard"]').value)}));return post(id,'quote',{expected_version:b.expected_version,...studentBody(f),items,...(record?{quote_id:record.id,quote_version:record.version}:{})});},{open:!!record});if(!record)studentFields(c.f);const lines=node('div');c.f.append(lines);const total=node('p','form-hint');
  const preview=()=>{try{let n=0;for(const r of lines.children)n+=Number(r.querySelector('[name="quantity"]').value)*cents(r.querySelector('[name="unit"]').value);total.textContent='合计：'+yuan(n);}catch{total.textContent='请填写有效课时和价格';}};
  function line(item={course_label:'数学',quantity:1,proposed_unit_cents:15000,standard_unit_cents:15000}){const r=node('div','v34-course');const name=input(r,'课程名称','course','text',item.course_label,true);name.setAttribute('list','v34-course-options');const q=input(r,'课时数','quantity','number',item.quantity,true);q.min='1';q.max='10000';input(r,'每课时标准价格（元）','standard','text',((item.standard_unit_cents??item.proposed_unit_cents)/100).toFixed(2),true);input(r,'每课时实际报价（元）','unit','text',(item.proposed_unit_cents/100).toFixed(2),true);name.addEventListener('input',()=>{const p=options.catalog.find(p=>p.body.course_label===name.value);if(p){r.querySelector('[name="standard"]').value=(p.body.standard_unit_cents/100).toFixed(2);r.querySelector('[name="unit"]').value=(p.body.standard_unit_cents/100).toFixed(2);preview();}});btn(r,'移除课程',()=>{if(lines.childElementCount>1){r.remove();preview();}});r.addEventListener('input',preview);lines.append(r);preview();}
  for(const i of record?.body.items||[undefined])line(i);const dl=node('datalist');dl.id='v34-course-options';for(const label of [...new Set([...options.catalog.map(p=>p.body.course_label),'数学','英语','语文','物理','化学'])])dl.append(option(label,label));c.f.append(dl);btn(c.f,'增加课程',()=>{if(lines.childElementCount<30)line();});c.f.append(total,node('p','fineprint','特殊优惠须独立主管批准，批准绑定此版方案。已有有效后续活动可继续使用，无须重复建任务。'),c.submit);}
 function enrollForm(){const quotes=detail.records.filter(r=>r.kind==='quotes'&&r.state==='draft'&&!['pending','rejected'].includes(r.body.discount_state));const id=selected,c=form(detailHost,'v34-enroll','办理报名','提交报名协议与订单',f=>{const b=data(f),q=quotes.find(q=>q.id===b.quote_id);if(!q)throw Error('请先保存有效课程方案并完成优惠审批');return post(id,'enroll',{expected_version:b.expected_version,quote_id:q.id,quote_version:q.version,agreement_ref:b.agreement_ref});});select(c.f,'使用课程方案','quote_id',quotes.map(q=>({id:q.id,label:'第'+q.version+'版 · '+yuan(q.body.total_cents)})),undefined,true);input(c.f,'报名协议或签署资料编号','agreement_ref','text','',true);c.f.append(node('p','fineprint','协议有效确认且首笔款项经授权核实到账，才算报名成功；尚有余额时保留下一步跟进。'),c.submit);}
 function closeLost(){const id=selected,prefill=pendingLostFeedback;pendingLostFeedback='';const c=form(detailHost,'v34-lost','结案确认 / Closed Lost','确认有依据的流失结案',f=>{const b=data(f);return post(id,'close-lost',{expected_version:b.expected_version,reason:b.reason,feedback:b.feedback,evidence_ref:b.evidence_ref,do_not_contact:f.elements.do_not_contact.checked});});select(c.f,'结案原因','reason',['家长明确拒绝报名','价格原因','课程不匹配','明确不再考虑时间安排','已选择其他机构','联系方式无效且已核实','制度批准结束持续无回应','其他明确原因']);input(c.f,'客户反馈','feedback','textarea',prefill,true);if(prefill)c.f.dataset.userDirty='1';input(c.f,'相关沟通依据或备注','evidence_ref','text','',true);input(c.f,'客户明确要求不再联系','do_not_contact','checkbox');c.f.append(c.submit);}
 function records(){const p=node('div','panel');p.id='v34-records';p.append(node('h3','','预约、方案、报名与款项'));detailHost.append(p);for(const r of detail.records){if(r.kind==='workflow-drafts'){const row=node('article','lead-row');row.append(node('strong','','未完成草稿（仅本员工可见）'));btn(row,'恢复这份草稿',()=>applyFollowupDraft(r.body.draft));p.append(row);continue;}const row=node('article','lead-row');row.dataset.activity=r.id;row.append(node('strong','',r.kind==='tasks'?'跟进待办 · '+r.body.title:r.kind==='appointments'?(r.body.type==='trial'?'试听':'线下面谈')+' · '+dateText(r.body.due_at):r.kind==='quotes'?'课程方案 · 第'+r.version+'版 · '+yuan(r.body.total_cents):r.kind==='enrollments'?'报名订单 · '+enrollLabel(r.state):r.kind==='payments'?'登记收款 · '+yuan(r.body.amount_cents):r.kind==='refunds'?'退款记录 · '+yuan(r.body.amount_cents):'审批与纠正事项'),node('p','',stateLabel(r.state)));
   if(r.kind==='tasks'){row.append(node('p','',dateText(r.body.due_at)+' · '+label(options.methods,r.body.method)));if(isActive(r)&&detail.workflow.terminal_state==='open'){btn(row,'设为主要下一步',()=>mutate(()=>post(selected,'arrange',{expected_version:detail.workflow.version,next:{id:r.id}})));const rt=form(row,'retime-'+r.id,'待办改期','保存改期',f=>{const b=data(f);return post(selected,'activity',{expected_version:b.expected_version,record_id:r.id,transition:'reschedule',due_at:localIso(b.due_at),reason:b.reason});});input(rt.f,'新执行时间','due_at','datetime-local',local(new Date(r.body.due_at)),true);input(rt.f,'改期原因','reason','text','',true);rt.f.append(rt.submit);const cancel=form(row,'cancel-'+r.id,'取消这项待办','取消待办并保留后续',f=>{const b=data(f);return post(selected,'activity',{expected_version:b.expected_version,record_id:r.id,transition:'cancelled',reason:b.reason,...(r.id===detail.workflow.primary_activity_id?{next:n.read()}:{})});});input(cancel.f,'取消原因','reason','text','',true);const n=nextFields(cancel.f,{exclude:r.id});if(r.id!==detail.workflow.primary_activity_id)conditional(n.el,false);cancel.f.append(cancel.submit);}}
   if(r.kind==='appointments'){const info=[r.body.type==='trial'?r.body.place:null,r.body.course].filter(Boolean).join(' · ');if(info)row.append(node('p','',info));row.append(node('p','','实际情况：'+(r.body.actual_attendance==='attended'?'已实际完成':r.body.actual_attendance==='absent'?'未到场':'尚未记录')));if(isActive(r)&&detail.workflow.terminal_state==='open')activityForms(row,r);}
   if(r.kind==='quotes'){for(const i of r.body.items)row.append(node('p','',i.course_label+' · '+i.quantity+'课时 × '+yuan(i.proposed_unit_cents)));if(r.body.discount_state==='rejected')row.append(node('p','form-hint warning','优惠方案已退回：'+(r.body.discount_reject_reason||'请调整后重新保存方案')));if(detail.workflow.terminal_state==='open'){btn(row,'修改课程方案',()=>{if(options?.access?.enabled){editingQuoteId=r.id;setCard('quote');return;}quoteForm(r);$('v34-quote').scrollIntoView({block:'center'});});if(r.body.discount_state==='pending'){row.append(node('p','form-hint warning',(r.body.unlisted_price?'非标准报价待独立主管批准':'优惠待独立主管批准')));if(options.manager){if(r.body.quoted_by===state.user?.staff_id)row.append(node('p','fineprint','本人提交的方案须由另一位主管独立审批。'));else{reviewForm(row,'优惠审批',r,'approve-discount','reason','批准依据');reviewForm(row,'退回优惠方案',r,'reject-discount','reason','退回原因');}}}}}
   if(r.kind==='enrollments'){row.append(node('p','','净收款 '+yuan(r.body.net_cents)+' · 未结清 '+yuan(r.body.balance_cents)),node('p','','协议：'+(r.body.agreement_confirmed?'已独立核实':'待独立核实')));if(r.body.unallocated_verified_cents>0)row.append(node('p','form-hint','其中待协议确认后挂账：'+yuan(r.body.unallocated_verified_cents)));if(options.manager&&!r.body.agreement_confirmed&&r.state!=='cancelled'){if(r.body.submitted_by===state.user?.staff_id)row.append(node('p','fineprint','本人提交的报名协议须由另一位主管独立核实。'));else reviewForm(row,'核实报名协议',r,'confirm-agreement','evidence_ref','核实签署与条款的依据');}if(detail.workflow.terminal_state==='open'&&r.state!=='cancelled')btn(row,'登记收款资料',()=>options?.access?.enabled?setCard('payment:'+r.id):paymentForm(row,r));btn(row,'退款 / 取消纠正申请',()=>options?.access?.enabled?setCard('correction:'+r.id):correctionForm(row,r));}
   if(r.kind==='payments'){row.append(node('p','','参考号：'+r.body.receipt_ref+' · '+(r.state==='verified'?'已由授权人员核实':r.state==='rejected'?'核实未通过，已退回':'登记资料不等于到账确认')));if(r.state==='rejected'&&r.body.reject_reason)row.append(node('p','form-hint warning','退回原因：'+r.body.reject_reason));}
   if(r.kind==='refunds'&&r.state==='rejected'&&r.body.reject_reason)row.append(node('p','form-hint warning','退回原因：'+r.body.reject_reason));
   if(r.kind==='corrections'){row.append(node('p','','申请原因：'+r.body.reason));if(r.body.target_owner_name)row.append(node('p','','接收人：'+r.body.target_owner_name+' · 申请人：'+(r.body.requested_by_name||'原主管')));if(r.body.enrollment_id){const e=detail.records.find(e=>e.id===r.body.enrollment_id);if(e)row.append(node('p','','关联报名：'+e.body.quote_snapshot.items.map(i=>i.course_label).join('、')+' · '+yuan(e.body.amount_cents)));}if(r.state==='rejected'&&r.body.reject_reason)row.append(node('p','form-hint warning','驳回原因：'+r.body.reject_reason));}
   if(r.kind==='corrections'&&r.state==='pending'&&options.manager){if(r.body.type==='lead_transfer'){if([r.body.requested_by,r.body.target_owner].includes(state.user?.staff_id))row.append(node('p','fineprint','须由独立于申请人和接收人的主管复核。'));else{reviewForm(row,'独立复核 Lead 转交',r,'approve-transfer','reason','复核原因');reviewForm(row,'驳回转交申请',r,'reject-transfer','reason','驳回原因');}}else{if(r.body.requested_by===state.user?.staff_id)row.append(node('p','fineprint','须由另一位主管独立复核本人申请。'));else{correctionApproval(row,r);reviewForm(row,'驳回纠正申请',r,'reject-correction','reason','驳回原因');}}}
   if(r.kind==='corrections'&&r.state==='approved'&&r.body.type==='enrollment_correction')refundForm(row,r);
   attachment(row,r);btn(row,'查看历史',()=>history(row,r));p.append(row);
  }}
 const stateLabel=s=>({open:'待执行',in_progress:'执行中',pending:'待确认',confirmed:'已确认',rescheduled:'已改期',completed:'已完成',cancelled:'已取消',no_show:'未到场',draft:'当前方案',successful:'报名成功',awaiting_agreement:'待确认协议',awaiting_payment:'待首笔付款',exception:'异常待核实',verified:'已核实',rejected:'已退回',approved:'已独立批准'}[s]||s);
 const enrollLabel=s=>({successful:'报名成功',awaiting_agreement:'待确认协议',awaiting_payment:'待首笔付款',cancelled:'报名已取消',exception:'异常待核实'}[s]||s);
 function activityForms(p,r){const id=selected,w=detail.workflow,hasOrder=detail.records.some(x=>x.kind==='enrollments'&&x.state!=='cancelled'),hasTrialDone=detail.records.some(x=>x.kind==='appointments'&&x.body.type==='trial'&&x.state==='completed'),hasTrialAny=detail.records.some(x=>x.kind==='appointments'&&x.body.type==='trial'&&['confirmed','rescheduled','completed'].includes(x.state));const stageOpts=r.body.type==='trial'?options.stages.filter(s=>['trial_completed','courses_introduced','enrollment_intent','paused',...(hasOrder||w.stage==='enrolling'?['enrolling']:[])].includes(s.id)):[...(w.stage==='unclassified'?[{id:'unclassified',label:'待核实（旧记录）'}]:[]),...options.stages.filter(s=>s.id!=='declined'&&(s.id!=='enrolling'||hasOrder||w.stage==='enrolling')&&(s.id!=='trial_completed'||hasTrialDone||w.stage==='trial_completed')&&(s.id!=='trial_booked'||hasTrialAny||w.stage==='trial_booked'))];const defaultStage=r.body.type==='trial'?(['enrollment_intent','enrolling'].includes(w.stage)?w.stage:'trial_completed'):w.stage;const c=form(p,'activity-'+r.id,options?.access?.enabled?(r.body.type==='trial'?'记录试听结果':'记录面谈结果'):'处理本次预约','保存实际结果与下一步',async f=>{const b=data(f),next=n.read();await post(id,'activity',{expected_version:b.expected_version,record_id:r.id,transition:b.transition,feedback:b.feedback,...(b.transition==='completed'&&b.stage?{stage:b.stage}:{}),...(b.transition==='completed'&&b.stage==='paused'&&b.pause_reason?{pause_reason:b.pause_reason}:{}),next});if(options?.access?.enabled){if(next.appointment)return 'scheduled';return b.transition==='completed'&&r.body.type==='trial'?'trial-next':'recorded';}});const result=select(c.f,'实际结果','transition',[{id:'completed',label:'已实际完成'},{id:'no_show',label:'家长 / 学生未到场'},{id:'cancelled',label:'取消本次预约'}]);input(c.f,'实际情况与反馈','feedback','textarea','',true);const st=select(c.f,'完成后的销售进展','stage',stageOpts,defaultStage),pause=input(c.f,'暂缓原因','pause_reason','text',w.pause_reason||'');const n=nextFields(c.f,{exclude:r.id,defaultAction:r.body.type==='trial'?'trial_feedback':'return_visit'});const syncActivity=()=>{const done=result.value==='completed',paused=done&&st.value==='paused';st.closest('label').hidden=!done;st.disabled=!done;pause.closest('label').hidden=!paused;pause.disabled=!paused;pause.required=paused;};if(options?.access?.enabled){result.querySelector('[value="completed"]').textContent=r.body.type==='trial'?'试听已结束':'面谈已完成';result.insertBefore(option('','请选择实际结果'),result.firstChild);result.value='';result.required=true;result.addEventListener('change',()=>{n.setAction(result.value==='completed'?(r.body.type==='trial'?'trial_feedback':'return_visit'):(r.body.type==='trial'?'confirm_trial':'reschedule_visit'));syncActivity();});btn(c.f,'改期，尚未完成',()=>{activityTarget=r.id;setCard('activity-retime');});}else result.addEventListener('change',syncActivity);st.addEventListener('change',syncActivity);syncActivity();c.f.append(c.submit);
  const retime=form(p,'retime-'+r.id,'修改预约时间','保存改期',f=>{const b=data(f);return post(id,'activity',{expected_version:b.expected_version,record_id:r.id,transition:'reschedule',due_at:localIso(b.due_at),reason:b.reason});});input(retime.f,'新执行时间','due_at','datetime-local',local(new Date(r.body.due_at)),true);input(retime.f,'改期原因','reason','text','',true);retime.f.append(retime.submit);
  if(r.state==='pending')btn(p,'确认已与家长确定时间',()=>mutate(()=>post(id,'activity',{expected_version:w.version,record_id:r.id,transition:'confirmed'})));
 }
 function reviewForm(p,title,r,action,key,label){const id=selected,c=form(p,action+'-'+r.id,title,'提交独立复核',f=>{const b=data(f);return post(id,action,{expected_version:b.expected_version,record_id:r.id,[key]:b[key]});});input(c.f,label,key,'text','',true);c.f.append(c.submit);}
 async function fileValue(f){const file=f.querySelector('[type="file"]')?.files[0];if(!file)return undefined;if(file.size>1048576)throw Error('凭证不能超过1MB');const bytes=new Uint8Array(await file.arrayBuffer());let s='';for(const b of bytes)s+=String.fromCharCode(b);return {name:file.name,mime:file.type,base64:btoa(s)};}
 function paymentForm(p,e){const id=selected,c=form(p,'payment-'+e.id,'登记待核实收款','提交收款资料',async f=>{const b=data(f);return post(id,'submit-payment',{expected_version:b.expected_version,enrollment_id:e.id,amount_cents:cents(b.amount),receipt_ref:b.receipt_ref,payment_kind:b.payment_kind,received_at:localIso(b.received_at),evidence_ref:b.evidence_ref,attachment:await fileValue(f)});},{open:true});select(c.f,'款项类型','payment_kind',[{id:'deposit',label:'定金'},{id:'reservation',label:'订金'},{id:'tuition',label:'部分学费'},{id:'full',label:'全部学费'}]);input(c.f,'实际登记金额（元）','amount','text','',true);input(c.f,'唯一流水或收款参考号','receipt_ref','text','',true);input(c.f,'实际收款日期和时间','received_at','datetime-local','',true);input(c.f,'凭证编号及说明','evidence_ref','text','',true);const file=input(c.f,'上传凭证（选填，PNG/JPEG/PDF，1MB内）','attachment','file');file.accept='image/png,image/jpeg,application/pdf';c.f.append(c.submit);}
 function correctionForm(p,e){const id=selected,c=form(p,'correction-'+e.id,'申请退款或取消纠正','提交独立复核申请',f=>{const b=data(f);return post(id,'request-correction',{expected_version:b.expected_version,enrollment_id:e.id,reason:b.reason});},{open:true});input(c.f,'纠正原因','reason','textarea','',true);c.f.append(c.submit);}
 function correctionApproval(p,r){const id=selected,c=form(p,'approve-correction-'+r.id,'独立审批纠正申请','批准纠正并保留后续安排',f=>{const b=data(f);return post(id,'approve-correction',{expected_version:b.expected_version,record_id:r.id,reason:b.reason,cancel_enrollment:f.elements.cancel_enrollment.checked,...(detail.workflow.terminal_state!=='open'?{next:n.read()}:{})});});input(c.f,'独立核实与批准依据','reason','textarea','',true);input(c.f,'无有效净收款时直接取消报名','cancel_enrollment','checkbox');const n=nextFields(c.f);if(detail.workflow.terminal_state==='open')conditional(n.el,false);c.f.append(c.submit);}
 function refundForm(p,cor){const id=selected,payments=detail.records.filter(r=>r.kind==='payments'&&r.state==='verified'&&r.body.enrollment_id===cor.body.enrollment_id);const c=form(p,'refund-'+cor.id,'登记经批准的退款资料','提交退款核实',async f=>{const b=data(f);return post(id,'submit-refund',{expected_version:b.expected_version,correction_id:cor.id,payment_id:b.payment_id,amount_cents:cents(b.amount),refund_ref:b.refund_ref,reason:b.reason,evidence_ref:b.evidence_ref,attachment:await fileValue(f)});});select(c.f,'原收款','payment_id',payments.map(p=>({id:p.id,label:p.body.receipt_ref+' · '+yuan(p.body.amount_cents)})));input(c.f,'实际退款金额（元）','amount','text','',true);input(c.f,'唯一退款参考号','refund_ref','text','',true);input(c.f,'退款原因','reason','text','',true);input(c.f,'实际退款凭证说明','evidence_ref','text','',true);const file=input(c.f,'上传退款凭证（选填）','attachment','file');file.accept='image/png,image/jpeg,application/pdf';c.f.append(c.submit);}
 function managerForms(){const w=detail.workflow,id=selected;
  if(w.terminal_state==='open'){
   const win=form(detailHost,'v34-win','全款成交结案 / Closed Won','核查全部订单并结案',f=>post(id,'close-won',data(f)));input(win.f,'本次结案业务依据','reason','textarea','',true);win.f.append(win.submit);
   if(options.manager){const transfer=form(detailHost,'v34-transfer','转交销售负责人（需独立复核）','发起转交申请',f=>post(id,'request-transfer',data(f)));select(transfer.f,'新的销售负责人','owner_user_id',staff);input(transfer.f,'转交原因','reason','text','',true);transfer.f.append(transfer.submit);}
  }else if(w.terminal_state==='lost'&&options.manager){const c=form(detailHost,'v34-reopen','客户重新咨询 / 授权重开','重新开启并安排联系',f=>{const b=data(f);return post(id,'reopen',{expected_version:b.expected_version,evidence_ref:b.evidence_ref,customer_initiated:f.elements.customer_initiated.checked,next:n.read()});});input(c.f,'客户主动咨询的依据','evidence_ref','text','',true);input(c.f,'确认客户主动重新咨询','customer_initiated','checkbox');const n=nextFields(c.f,{allowExisting:false});c.f.append(c.submit);}
 }
 function attachment(p,r){const a=r.body.attachment;if(!a)return;btn(p,'下载凭证 '+a.name,()=>{const bytes=Uint8Array.from(atob(a.base64),c=>c.charCodeAt(0)),url=URL.createObjectURL(new Blob([bytes],{type:a.mime})),link=document.createElement('a');link.href=url;link.download=a.name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});}
 async function history(p,r){const token=state.token,id=selected;try{const out=await api(root+'/'+id+'/history');if(token!==state.token||id!==selected)return;for(const h of out.items.filter(h=>h.record_id===r.id))p.append(node('p','fineprint','第'+h.version+'版 · '+stateLabel(h.state)+(h.body.due_at?' · '+dateText(h.body.due_at):'')+(h.body.total_cents!=null?' · '+yuan(h.body.total_cents):'')+(h.body.reschedule_reason?' · '+h.body.reschedule_reason:'')));}catch(e){if(token===state.token&&id===selected){if(handleAuthFailure(e))return;announce(e.message);}}}
 function timeline(){const p=node('details','panel');p.id='v34-timeline';p.append(node('summary','','完整历史'));detailHost.append(p);for(const e of detail.events){const row=node('article','lead-row'),b=e.after_business_json;row.append(node('p','',dateText(e.happened_at)+' · '+(e.actor_name||'历史员工')+' · '+eventName(e.event_name)));if(e.event_name==='V34_COMMUNICATION')row.append(node('p','',label(options.methods,b.method)+' · '+({failed:'未联系成功',waiting:'已发送消息待回复',communicated:'已完成沟通',other:'其他'}[b.result]||b.result)+(b.failure_reason?' · '+b.failure_reason:'')+(b.notes?' · '+b.notes:'')),node('p','','销售进展：'+stage(b.stage)));else if(e.event_name==='V34_TRANSFER_ACCEPTED')row.append(node('p','',(b.old_owner_name||'原负责人')+' → '+(b.new_owner_name||'新负责人')));else if(b.reason||b.feedback)row.append(node('p','',b.reason||b.feedback));else if(!e.event_name.startsWith('V34_'))row.append(node('p','fineprint','旧记录原文：'+(b.result||b.reason||b.source||'历史业务记录')+(b.notes?' · '+b.notes:'')));p.append(row);}}
 function eventName(name){return ({LEAD_DESK_CREATED:'线索录入（旧记录）',LEAD_SOURCE_UPDATED:'来源修正',LEAD_DESK_FOLLOWUP:'旧版跟进记录',LEAD_DESK_FOLLOWUP_V2:'旧版沟通与阶段记录',V34_WALK_IN_MEETING_COMPLETED:'主动到访面谈已完成',V34_COMMUNICATION:'沟通结果',V34_FOLLOWUP_COMPLETED:'本次跟进完成并保留下一步',V34_INTAKE:'接单与首次安排',V34_MARKET_HANDOFF_ACCEPTED:'接收市场线索并安排首次跟进',V34_NEXT_ARRANGED:'下一步安排',V34_APPOINTMENT_CREATED:'预约创建',V34_APPOINTMENT_CONFIRMED:'确认预约时间',V34_ACTIVITY_STARTED:'开始执行活动',V34_ACTIVITY_COMPLETED:'实际活动完成',V34_ACTIVITY_NO_SHOW:'预约未到场',V34_ACTIVITY_CANCELLED:'预约取消',V34_ACTIVITY_RESCHEDULED:'预约改期',V34_QUOTE_SAVED:'课程方案保存',V34_DISCOUNT_APPROVED:'独立批准优惠方案',V34_DISCOUNT_REJECTED:'退回优惠方案',V34_ENROLLMENT_SUBMITTED:'报名资料提交',V34_AGREEMENT_CONFIRMED:'协议独立核实',V34_PAYMENT_SUBMITTED:'登记收款',V34_PAYMENT_VERIFIED:'授权核实到账',V34_PAYMENT_REJECTED:'退回收款或退款资料',V34_ENROLLMENT_SUCCESS:'报名成功',V34_CLOSED_WON:'全额付款成交结案',V34_CLOSED_LOST:'流失结案',V34_REOPENED:'授权重新开启',V34_CORRECTION_REQUESTED:'纠正申请',V34_CORRECTION_APPROVED:'独立批准纠正',V34_CORRECTION_REJECTED:'驳回纠正申请',V34_REFUND_SUBMITTED:'登记退款资料',V34_REFUND_VERIFIED:'实际退款核实',V34_CREDIT_ADJUSTMENT:'退款金额调整',V34_TRANSFER_REQUESTED:'转交申请',V34_TRANSFER_APPROVED:'独立复核转交',V34_TRANSFER_REJECTED:'驳回转交申请',V34_TRANSFER_AWAITING_ACCEPTANCE:'转交已获独立批准，待接手',V34_TRANSFER_ACCEPTED:'新负责人确认接手',V34_CONTACT_UPDATED:'更新联系方式',V34_CONTACT_SAVED:'保存联系方式',V34_SOURCE_CORRECTED:'修正获客来源',V34_ARRANGEMENT_REPAIRED:'补充旧记录下一步安排',V34_LEGACY_ASSIGNMENT_REPAIRED:'主管分配历史客户负责人',V34_DRAFT_SAVED:'保存未完成草稿'}[name]||'历史业务变更');}
 function renderFinance(){const p=node('div','panel');p.id='v34-finance';p.append(node('h2','','待独立核实的款项'));panel.append(p);if(!queue.length)p.append(node('p','','当前无待核实款项'));for(const r of queue){const row=node('article','lead-row');row.append(node('strong','',(r.student_name||'学生')+' · '+(r.kind==='payments'?'收款':'退款')+' '+yuan(r.body.amount_cents)),node('p','','参考号：'+(r.body.receipt_ref||r.body.refund_ref)),node('p','','登记凭证：'+r.body.evidence_ref));attachment(row,r);if(options.can_verify){const reject=form(row,'reject-'+r.id,'资料不符合核实要求 / 退回','退回资料',f=>post(r.lead_id,'reject-payment',{record_id:r.id,expected_version:r.workflow_version,reason:data(f).reason}),{version:null});input(reject.f,'退回原因','reason','text','',true);reject.f.append(reject.submit);const c=form(row,'verify-'+r.id,'核实实际'+(r.kind==='payments'?'到账':'退款'),'提交授权核实',f=>{const b=data(f);return post(r.lead_id,r.kind==='payments'?'verify-payment':'verify-refund',{expected_version:r.workflow_version,record_id:r.id,evidence_ref:b.evidence_ref,...(r.kind==='refunds'?{cancel_enrollment:f.elements.cancel_enrollment.checked}:{})});},{version:null});input(c.f,'独立查验实际资金的依据','evidence_ref','text','',true);if(r.kind==='refunds')input(c.f,'净收款为零时同时取消报名','cancel_enrollment','checkbox');c.f.append(c.submit);}else row.append(node('p','fineprint','主管可查看队列，到账和退款仅由独立收款核实员确认。'));p.append(row);}}
 function renderMetricsFilters(panel){
  const filters=report.filters;
  const form=node('form','field-stack');
  form.id='v34-metrics-filters';
  panel.append(form);
  const mode=select(form,'统计口径','view_mode',[
   {id:'cohort',label:'按建档日期看当前进展'},
   {id:'event',label:'当期发生量'},
   {id:'snapshot',label:'历史时点状态'},
  ],filters?.view_mode==='current'||!filters?.view_mode?'cohort':filters.view_mode);
  const hint=node('p','form-hint');
  form.append(hint);
  const range=node('div','field-stack');
  const start=input(range,'开始日期','created_from','date',filters?.start_at?dayKey(new Date(filters.start_at)):'');
  const end=input(range,'结束日期','created_to','date',filters?.end_at?shDayShift(dayKey(new Date(filters.end_at)),-1):'');
  const instant=node('div','field-stack');
  const at=filters?.as_of_at?new Date(filters.as_of_at):null;
  const instantValue=at?dayKey(at)+'T'+shTimeText(at):'';
  const asOf=input(instant,'历史时点（上海时间）','as_of_at','datetime-local',instantValue);
  form.append(range,instant);
  function describe(){
   const snapshot=mode.value==='snapshot';
   conditional(range,!snapshot);
   conditional(instant,snapshot);
   hint.textContent=snapshot
    ?'根据截至所选时点的审计记录还原线索状态。筛选按当前权限、当前顾问和原始来源。'
    :mode.value==='event'
     ?'按上海日期统计系统在当期记录的事件，包含更早建档的线索。'
     :'按上海时间的建档日期筛选，指标显示所选线索的当前进展。';
  }
  mode.addEventListener('change',describe);
  describe();
  const owner=options.manager
   ?select(form,'顾问','owner_id',[{id:'',label:'全部顾问'},...staff],filters?.owner_id??'')
   :null;
  const buttons=node('div','filter-group');
  const submit=node('button','primary','应用筛选');
  submit.type='submit';
  buttons.append(submit);
  btn(buttons,'清除筛选',()=>{metricsQuery='';refresh(true);});
  form.append(buttons);
  const message=node('p','form-hint');
  message.setAttribute('role','status');
  form.append(message);

  form.addEventListener('submit',event=>{
   event.preventDefault();
   const query=new URLSearchParams();
   if(mode.value==='snapshot'){
    const timestamp=asOf.value.length===16?asOf.value+':00+08:00':asOf.value+'+08:00';
    if(!asOf.value||Date.parse(timestamp)>Date.now()){
     message.textContent='请选择不晚于当前时间的历史时点。';
     return;
    }
    query.set('view_mode','snapshot');
    query.set('as_of_at',timestamp);
   }else{
    if((mode.value==='event'&&!start.value)||Boolean(start.value)!==Boolean(end.value)||start.value>end.value){
     message.textContent='请同时选择开始和结束日期，结束日期不能早于开始日期。';
     return;
    }
    if(start.value){
     query.set('view_mode',mode.value);
     query.set('start_at',start.value+'T00:00:00+08:00');
     query.set('end_at',shDayShift(end.value,1)+'T00:00:00+08:00');
    }
   }
   if(owner?.value)query.set('owner_id',owner.value);
   if(filters?.source!=null)query.set('source',filters.source);
   metricsQuery=query.size?'?'+query.toString():'';
   submit.disabled=true;
   refresh(true);
  });
 }
 function renderOriginalSources(target){
  const section=node('section','panel');
  section.id='v34-metrics-sources';
  section.append(node('h3','','原始来源对比'));
  const selectedSource=report.filters?.source;
  const sourceLabel=source=>source||'未记录来源';
  const applySource=source=>{
   const query=new URLSearchParams(metricsQuery);
   if(source===null)query.delete('source');
   else query.set('source',source);
   metricsQuery=query.size?'?'+query.toString():'';
   refresh(true);
  };
  if(selectedSource!=null){
   section.append(node('p','form-hint','当前来源筛选：'+sourceLabel(selectedSource)));
   btn(section,'清除来源筛选',()=>applySource(null));
  }
  if(report.channel_cost_status==='COST_NOT_CONFIGURED'){
   section.append(node('p','form-hint','待配置成本源'));
  }
  const rows=report.by_source||[];
  if(!rows.length)section.append(node('p','','当前筛选范围内没有线索'));
  for(const source of rows){
   const row=node('article','lead-row');
   row.append(node('strong','',sourceLabel(source.source)));
   row.append(node('p','fineprint',
    '线索 '+source.leads+' 条 · 跟进中 '+source.open+' 条 · 正式成交 '+source.won+' 条 · 当前失单 '+source.lost+' 条'+
    (source.legacy_closed?' · 旧记录已关闭 '+source.legacy_closed+' 条':''),
   ));
   if(selectedSource==null&&source.source.length<=200){
    btn(row,'筛选来源：'+sourceLabel(source.source),()=>applySource(source.source));
   }
   section.append(row);
  }
  target.append(section);
 }
 const eventMetricsLabels={
   created_leads:'新建线索（条）',
   communication_events:'沟通记录（次）',
   meeting_completion_events:'完成面谈（次）',
   trial_completion_events:'完成试听（次）',
   first_enrollment_success_events:'首次报名成功（次）',
   won_events:'正式成交结案（次）',
   lost_events:'失单结案（次）',
   reopened_events:'失单后重开（次）',
  };
 const snapshotMetricsLabels={
  snapshot_leads:'已建档线索（条）',
  snapshot_students:'当时已关联学生（人）',
  snapshot_open:'当时跟进中（条）',
  snapshot_won:'当时正式成交（条）',
  snapshot_lost:'当时失单（条）',
  snapshot_unknown:'历史状态证据不足（条）',
  snapshot_pending_activities:'当时未完成活动（项）',
  snapshot_overdue_activities:'当时逾期活动（项）',
  snapshot_unknown_activities:'活动时间或版本证据不足（项）',
 };
 const metricsDrilldownTitles={
  leads:'线索明细',
  students:'学生明细',
  won_leads:'正式成交明细',
  lost_leads:'当前失单明细',
 };
 const cashDrilldownTitles={
  snapshot_verified_receipts:'历史已核实收款明细',
  snapshot_verified_refunds:'历史已核实退款明细',
 };
 function historicalYuan(cents){
  const value=BigInt(cents),absolute=value<0n?-value:value;
  return (value<0n?'-':'')+'¥'+(absolute/100n).toLocaleString('zh-CN')+'.'+String(absolute%100n).padStart(2,'0');
 }
 function renderMetricsDrilldown(target,scope,metric){
  const section=node('section','panel');
  const students=metric==='students'||metric==='snapshot_students',period=Object.hasOwn(eventMetricsLabels,metric);
  const cash=Object.hasOwn(cashDrilldownTitles,metric);
  const snapshot=cash||Object.hasOwn(snapshotMetricsLabels,metric);
  const activity=snapshot&&metric.endsWith('_activities');
  const metricLabel=eventMetricsLabels[metric]??snapshotMetricsLabels[metric];
  const title=metricLabel?metricLabel.replace(/（.）$/,'')+'明细':cashDrilldownTitles[metric]??metricsDrilldownTitles[metric];
  section.id='v34-metrics-'+metric;
  section.dataset.metricsDrilldown='';
  section.append(node('h3','',title));
  btn(section,'关闭'+title,()=>section.remove());
  const results=node('div');
  section.append(results);
  target.append(section);
  const query=new URLSearchParams(scope);
  query.set('metric',metric);

  async function load(page){
   const token=state.token;
   query.set('page',String(page));
   results.replaceChildren(node('p','form-hint','正在读取'+title+'…'));
   try{
    const data=await api(root+'/metrics/drilldown?'+query);
    if(token!==state.token||!section.isConnected)return;
    results.replaceChildren(node('p','form-hint','共 '+data.total+(students?' 名学生':cash?' 笔款项':activity?' 项活动':period&&metric!=='created_leads'?' 条记录':' 条线索')));
    for(const item of data.items){
     const row=node('article','lead-row');
     if(students){
      row.append(node('strong','',item.display_name||(snapshot?'当前不可查看学生姓名':'未填写学生姓名')));
      row.append(node('p','fineprint',(snapshot?'所选时点关联 ':'在当前筛选范围内关联 ')+item.lead_count+' 条线索'));
     }else{
      row.append(node('strong','',item.contact_name||'未填写家长姓名'));
      const recordTime=item.recorded_at?dayKey(new Date(item.recorded_at))+' '+shTimeText(item.recorded_at)+' 记录':null;
      let description;
      if(cash)description=historicalYuan(item.amount_cents)+' · '+dayKey(new Date(item.verified_at))+' '+shTimeText(item.verified_at)+' 核实';
      else if(period)description=recordTime;
      else if(activity){
       const due=item.due_at?dayKey(new Date(item.due_at))+' '+shTimeText(item.due_at):'到期时间证据不足';
       description=(item.kind==='appointments'?'预约':'跟进待办')+' · '+(recordTime?due+' · '+recordTime:'历史版本证据不足');
      }else if(snapshot){
       description=recordTime?terminalText(item.terminal_state)+' · '+stage(item.stage)+' · '+recordTime:'历史状态证据不足';
      }else description=dayKey(new Date(item.created_at))+' 建档 · '+terminalText(item.terminal_state);
      const owner=(snapshot?'当前顾问：':'')+(item.owner_name||'待分配');
      row.append(node('p','fineprint',owner+' · '+description));
     }
     results.append(row);
    }
    if(!data.items.length)results.append(node('p','','此页没有'+(students?'学生':cash?'款项':activity?'活动':period?'记录':'线索')));
    if(data.page>1)btn(results,'上一页',()=>load(data.page-1));
    if(data.page*data.page_size<data.total)btn(results,'下一页',()=>load(data.page+1));
   }catch(e){
    if(token!==state.token||!section.isConnected)return;
    if(handleAuthFailure(e))return;
    results.replaceChildren(node('p','warning','读取'+title+'失败：'+e.message));
   }
  }
  load(1);
 }
 function renderRecordedMetrics(target){
  const grid=node('div','scope-grid');
  const snapshot=report.filters.view_mode==='snapshot';
  const labels=snapshot?snapshotMetricsLabels:eventMetricsLabels;
  const counts=snapshot?report.snapshot_counts:report.event_counts;
  target.append(node('h3','',snapshot?'历史时点状态':'当期发生量'));
  if(snapshot){
   target.append(node('p','form-hint','截至 '+dayKey(new Date(report.filters.as_of_at))+' '+shTimeText(report.filters.as_of_at)+'（上海时间）'));
   target.append(node('p','form-hint','缺少到期时间证据的活动可能仍计入未完成，但不计入逾期。'));
  }
  if(report.filters.source!=null){
   target.append(node('p','form-hint','当前来源筛选：'+(report.filters.source||'未记录来源')));
   btn(target,'清除来源筛选',()=>{
    const query=new URLSearchParams(metricsQuery);
    query.delete('source');
    metricsQuery='?'+query.toString();
    refresh(true);
   });
  }
  const appliedScope=metricsQuery;
  for(const [key,label]of Object.entries(labels)){
   const tile=node('div','stat-card');
   if(key==='snapshot_students'&&!report.student_history?.available){
    tile.append(node('p','',label),node('strong','','证据不足'));
    const since=report.student_history?.started_at;
    if(since)tile.append(node('p','fineprint','历史记录始于 '+dayKey(new Date(since))+' '+shTimeText(since)+'（上海时间）'));
    grid.append(tile);
    continue;
   }
   tile.append(node('p','',label),node('strong','',String(counts[key]??0)));
   btn(tile,'查看'+label.replace(/（.）$/,'')+'明细',()=>{
    target.querySelector('[data-metrics-drilldown]')?.remove();
    renderMetricsDrilldown(target,appliedScope,key);
   });
   grid.append(tile);
  }
  target.append(grid);
  if(snapshot)renderHistoricalCash(target,appliedScope);
 }
 function renderHistoricalCash(target,scope){
  const cash=report.snapshot_cash;
  if(!cash)return;
  const section=node('section','panel');
  section.id='v34-snapshot-cash';
  section.append(node('h3','','历史已核实收退款'));
  section.append(node('p','form-hint','按独立核实时间累计，包含可核对的本工作台收款及关联退款。'));
  section.append(node('p','','已核实收款 '+historicalYuan(cash.gross_cents)+' · '+cash.receipts+' 笔'));
  section.append(node('p','','已核实退款 '+historicalYuan(cash.refunded_cents)+' · '+cash.refunds+' 笔'));
  section.append(node('p','','净额 '+historicalYuan(cash.net_cents)));
  for(const [key,title]of Object.entries(cashDrilldownTitles)){
   btn(section,'查看'+title,()=>{
    target.querySelector('[data-metrics-drilldown]')?.remove();
    renderMetricsDrilldown(target,scope,key);
   });
  }
  target.append(section);
 }
 function renderMetrics(){if(!report){panel.append(node('p','','读取统计中…'));return;}const p=node('div','panel');p.id='v34-metrics';if(options?.access?.admin)p.append(node('p','form-hint','市场线索 '+marketRows.length+' 条 · 待销售接收 '+marketRows.filter(r=>r.handoff_state==='market').length+' 条；销售统计见下方，可分别进入两部门工作台。'));p.append(node('h2','','销售闭环统计'));panel.append(p);renderMetricsFilters(p);if(['event','snapshot'].includes(report.filters?.view_mode)){renderRecordedMetrics(p);return;}const labels={leads:'Lead 数',students:'已识别学生人数（去重）',unidentified_leads:'待识别学生 Lead',contacted_students:'实际联系学生人数',failed_attempts:'联系失败次数',waiting_leads:'当前待回复 Lead',online_communicated_students:'线上完成沟通学生',offline_communicated_students:'线下实际沟通学生',invited_students:'发起面谈邀约学生',agreed_meeting_students:'同意面谈学生',confirmed_meeting_students:'确认面谈学生',attended_meeting_students:'实际到场学生',walk_in_meeting_students:'主动到访面谈学生',completed_meeting_students:'完成面谈学生',meeting_to_enrollment_students:'面谈后报名成功学生',trial_booked_students:'试听预约学生',trial_completed_students:'实际试听完成学生',trial_to_enrollment_students:'试听后报名成功学生',enrollment_intent_students:'有报名意向学生',enrollment_success_students:'当前有效报名成功学生',enrollment_success_orders:'当前有效报名成功订单',historical_enrollment_success_students:'历史首次报名成功学生（去重）',historical_enrollment_success_orders:'历史首次报名成功订单',settled_orders:'已结清订单',won_leads:'Closed Won',lost_leads:'Closed Lost',due_today:'今日应跟进活动',completed_today:'今日完成活动',overdue_activities:'逾期活动数',overdue_primary_leads:'首要安排逾期客户数',missing_next:'待补下一步 Lead',unassigned_leads:'负责人待分配 Lead',continuous_failed_leads:'连续联系失败 Lead',stale_open_leads:'14天未更新的 Open Lead',paused_leads:'暂缓待恢复 Lead',appointment_result_due:'预约到期未确认结果',pending_transfer:'待独立复核转交'};
  const grid=node('div','scope-grid'),cohortQuery=metricsQuery;
  for(const [key,title]of Object.entries(labels)){
   const tile=node('div','stat-card');
   tile.append(node('p','',title),node('strong','',String(report.counts[key]??0)));
   if(Object.hasOwn(metricsDrilldownTitles,key)){
    btn(tile,'查看'+metricsDrilldownTitles[key],()=>{
     p.querySelector('[data-metrics-drilldown]')?.remove();
     renderMetricsDrilldown(p,cohortQuery,key);
    });
   }
   grid.append(tile);
  }
  p.append(grid);
  p.append(node('p','','已核实净收款：'+yuan(report.counts.received_cents||0)+' · 未结清：'+yuan(report.counts.unsettled_cents||0)));
  const booked=report.counts.trial_booked_students||0,completed=report.counts.trial_completed_students||0;p.append(node('p','','试听完成率：'+(booked?(completed/booked*100).toFixed(1)+'%':'暂无分母')+' · 试听后报名率：'+(completed?((report.counts.trial_to_enrollment_students||0)/completed*100).toFixed(1)+'%':'暂无分母')));
  if(options.manager){const c=form(panel,'v34-catalog','本地课程标准价目（主管）','保存本地价目',f=>{const b=data(f),old=options.catalog.find(p=>p.body.course_label.toLowerCase()===b.course_label.toLowerCase());return api(root+'/catalog',{method:'POST',body:{course_label:b.course_label,standard_unit_cents:cents(b.amount),reason:b.reason,expected_version:old?.version}});},{version:null});input(c.f,'课程名称','course_label','text','',true);input(c.f,'每课时标准价格（元）','amount','text','',true);input(c.f,'价格维护依据','reason','text','',true);c.f.append(c.submit);}
  const confirmed=report.counts.confirmed_meeting_students||0;p.append(node('p','','已确认预约到场率：'+(confirmed?((report.counts.scheduled_meeting_attended_students||0)/confirmed*100).toFixed(1)+'%':'暂无分母')+'（主动到访单列，不混入预约到场率分母）'));
  for(const o of report.by_owner)p.append(node('p','',o.name+' · 当前客户 '+o.leads+' · Open '+o.open+' · Won '+o.won+' · Lost '+o.lost+' · 当前有效报名订单 '+o.enrollment_success_orders+' · 当前客户已核实净收款 '+yuan(o.verified_net_cents)+' · 完成沟通 '+o.completed_communications+' 次 · 逾期活动 '+o.overdue_activities+' 项 · 首要安排逾期客户 '+o.overdue_primary_leads+' 条 · 待补安排 '+o.missing_next));
  renderOriginalSources(p);
  const currentLosses=Object.entries(report.current_lost_reasons||{});
  p.append(node('h3','','当前失单原因'));
  if(!currentLosses.length)p.append(node('p','fineprint','暂无当前失单原因'));
  for(const [reason,n]of currentLosses)p.append(node('p','',reason+' · '+n+' 条线索'));
  const historicalLosses=Object.entries(report.lost_reasons||{});
  if(historicalLosses.length){
   const history=node('details');
   history.append(node('summary','','历史失单原因（按结案次数）'));
   for(const [reason,n]of historicalLosses)history.append(node('p','',reason+' · '+n+' 次'));
   p.append(history);
  }
  const reminders=node('div','panel');reminders.append(node('h3','','到期与逾期提醒'));for(const r of report.reminders||[]){const row=node('p','',r.title+' · '+dateText(r.due_at)+(r.overdue?' · 已逾期':''));reminders.append(row);btn(reminders,'打开相关客户',()=>openLead(r.lead_id));}panel.append(reminders);}
 function setCard(value){if(value!=='quote')editingQuoteId=null;if(!value)activityTarget=null;card=value;display();(panel.querySelector('#v35-side-detail')||panel).querySelector('input:not([type="hidden"]),select,textarea')?.focus();}
 function renderCardOperations(l){
  const w=detail.workflow;if(card){btn(detailHost,'返回客户概览',()=>{saveCurrentLeadDraft();setCard(null);});}
  const catalog={followup:['记跟进',followup],appointment:['约面谈 / 试听',appointmentForm],quote:['课程方案',()=>quoteForm(editingQuoteId?detail.records.find(r=>r.id===editingQuoteId):null)],enroll:['办理报名',enrollForm],contact:['更新联系方式',()=>{const c=form(detailHost,'v34-contact','更新联系方式','保存联系方式',f=>post(selected,'contact',data(f)),{open:true});input(c.f,'电话号码','contact_info','tel',w.contact_info||'',true);c.f.append(c.submit);}],source:['修正当前获客来源',()=>{const c=form(detailHost,'v34-source','修正当前获客来源','保存当前来源',f=>post(selected,'source',data(f)),{open:true});select(c.f,'当前获客来源','source',['市场活动','网络咨询','到店','转介绍','主动咨询','其他'],l.current_source||l.original_source);c.f.append(c.submit);}],arrange:['调整下一步安排',()=>{const c=form(detailHost,'v34-arrange','调整下一步安排','保存安排',f=>post(selected,'arrange',{...data(f),next:n.read()}),{open:true}),n=nextFields(c.f);c.f.append(c.submit);}],lost:['客户明确不再继续',closeLost],management:['结案 / 转交 / 重开',managerForms],history:['完整历史',timeline],records:['业务记录与处理',records]};
  if(['scheduled','recorded','trial-next'].includes(card)){const p=node('section','panel');p.id='v35-continuation';detailHost.append(p);p.append(node('h3','',card==='scheduled'?'预约已保存':card==='trial-next'?'试听已结束，继续跟进':'本次记录已保存'));const next=detail.records.find(r=>r.id===w.primary_activity_id);if(next)p.append(node('p','','下一步已加入待办：'+next.body.title+' · '+dateText(next.body.due_at)));if(card==='trial-next'){btn(p,'现在记录试听回访',()=>{activityTarget=null;setCard('followup');});btn(p,'继续制定课程方案',()=>setCard('quote'));if(detail.records.some(r=>r.kind==='quotes'&&r.state==='draft'&&!['pending','rejected'].includes(r.body.discount_state)))btn(p,'继续办理报名',()=>setCard('enroll'));}btn(p,'返回我的待办',()=>{if(selected)leadDrafts.delete(selected);selected=null;detail=null;card=null;activityTarget=null;view='tasks';refresh(true);});btn(p,'继续处理其他事项',()=>{if(selected)leadDrafts.delete(selected);setCard(null);});return;}
  if(card?.startsWith('payment:')||card?.startsWith('correction:')){const [kind,id]=card.split(':'),r=detail.records.find(r=>r.id===id&&r.kind==='enrollments');if(r){if(kind==='payment')paymentForm(detailHost,r);else correctionForm(detailHost,r);}return;}
  if(['activity','activity-result','activity-retime'].includes(card)){const r=activeTarget();if(!r||r.kind!=='appointments'){setCard(null);return;}if(card==='activity'){const p=node('div','v35-action-grid');detailHost.append(p);btn(p,'记录本次预约结果',()=>setCard('activity-result'),'v35-action-card');btn(p,'修改预约时间',()=>setCard('activity-retime'),'v35-action-card');if(r.state==='pending')btn(p,'确认已与家长确定时间',()=>mutate(()=>post(selected,'activity',{expected_version:w.version,record_id:r.id,transition:'confirmed'})));}else{activityForms(detailHost,r);const remove=card==='activity-result'?'retime-':'activity-';$(remove+r.id)?.closest('details').remove();detailHost.querySelector(':scope > details').open=true;}return;}
  if(card==='management'){const p=node('div','v35-action-grid');detailHost.append(p);if(w.terminal_state==='open'){btn(p,'全款成交结案',()=>setCard('manage-win'),'v35-action-card');if(options.manager)btn(p,'转交销售负责人',()=>setCard('manage-transfer'),'v35-action-card');}else if(w.terminal_state==='lost'&&options.manager)btn(p,'客户重新咨询 / 重开',()=>setCard('manage-reopen'),'v35-action-card');else p.append(node('p','','当前无需处理结案或转交；退款与纠正请从报名记录进入。'));return;}
  if(card?.startsWith('manage-')){managerForms();for(const d of detailHost.querySelectorAll(':scope > details')){if(d.querySelector('form')?.id!=='v34-'+card.slice(7))d.remove();else d.open=true;}return;}
  if(card==='more'){const p=node('div','v35-action-grid');detailHost.append(p);for(const key of ['contact','source','arrange','lost','management','records','history']){if(w.terminal_state!=='open'&&['contact','source','arrange','lost'].includes(key))continue;btn(p,catalog[key][0],()=>setCard(key),'v35-action-card');}return;}
  if(card&&catalog[card]){catalog[card][1]();for(const d of detailHost.querySelectorAll(':scope > details'))d.open=true;return;}
  const grid=node('div','v35-action-grid');grid.id='v35-actions';detailHost.append(grid);
  if(w.terminal_state==='open'){const primary=detail.records.find(r=>r.id===w.primary_activity_id&&isActive(r));if(primary?.kind!=='tasks')btn(grid,primary?.kind==='appointments'?'补充日常沟通':catalog.followup[0],()=>{activityTarget=null;setCard('followup');},'v35-action-card');for(const key of ['appointment','quote'])btn(grid,catalog[key][0],()=>setCard(key),'v35-action-card');}
  const quotes=detail.records.some(r=>r.kind==='quotes'&&r.state==='draft'&&!['pending','rejected'].includes(r.body.discount_state));
  if(w.terminal_state==='open'&&quotes)btn(grid,'办理报名',()=>setCard('enroll'),'v35-action-card');
  const activeOrders=detail.records.filter(r=>r.kind==='enrollments'&&r.state!=='cancelled'),unresolved=detail.records.some(r=>['payments','refunds','corrections'].includes(r.kind)&&['pending','approved'].includes(r.state));
  if(w.terminal_state==='open'&&activeOrders.length&&activeOrders.every(e=>e.state==='successful'&&e.body.balance_cents===0)&&!unresolved)btn(grid,'全款结清 · 办理成交结案',()=>setCard('manage-win'),'v35-action-card');
  if(detail.records.some(r=>['enrollments','quotes','corrections','payments','refunds'].includes(r.kind)))btn(grid,'方案 / 报名进度',()=>setCard('records'),'v35-action-card');
  else if(detail.records.some(r=>r.kind==='appointments'))btn(grid,'预约记录与改期',()=>setCard('records'),'v35-action-card');
  const savedDraft=w.terminal_state==='open'?detail.records.find(r=>r.kind==='workflow-drafts'):null;if(savedDraft)btn(grid,'恢复未完成跟进草稿',()=>applyFollowupDraft(savedDraft.body.draft),'v35-action-card');
  btn(detailHost,'更多操作',()=>setCard('more'),'text-button');btn(detailHost,'查看跟进历史',()=>setCard('history'),'text-button');
  const latest=detail.events.find(e=>['V34_COMMUNICATION','V34_ACTIVITY_COMPLETED'].includes(e.event_name));if(latest)detailHost.append(node('p','form-hint','上次跟进：'+dateText(latest.happened_at)+' · '+(latest.after_business_json.notes||latest.after_business_json.feedback||eventName(latest.event_name))));
 }
 function renderRoleTasks(target=panel){
  const p=node('section','panel');p.id='v34-tasks';target.append(p);
  const head=node('div','v35-list-header');head.append(node('h2','','我的待办'));
  const viewToggle=node('div','v35-view-toggle');viewToggle.id='v35-task-view-toggle';viewToggle.setAttribute('role','group');viewToggle.setAttribute('aria-label','待办视图切换');
  const btnDay=btn(viewToggle,'日待办视图',()=>{if(taskView==='day')return;taskView='day';draw();},taskView==='day'?'primary':'secondary');
  const btnWeek=btn(viewToggle,'周日程视图',()=>{if(taskView==='week')return;taskView='week';weekAnchorDay=taskDay||dayKey(Date.now());draw();},taskView==='week'?'primary':'secondary');
  head.append(viewToggle);p.append(head);
  const day=input(p,'查看日期','task_day','date',taskDay);const scope=options.access.sales_manager?select(p,'查看范围','task_scope',[{id:'mine',label:'我的待办'},{id:'team',label:'销售团队待办'}],taskScope):null;
  const filterBar=node('div','filter-group');filterBar.id='v35-task-filters';filterBar.style.display='flex';filterBar.style.flexWrap='wrap';filterBar.style.gap='8px';filterBar.style.margin='10px 0';
  const filters=[{id:'all',label:'全部当日'},{id:'overdue',label:'已逾期'},{id:'appointments',label:'今日面谈/试听'},{id:'handover',label:'待审批/待接手'}];
  for(const f of filters){const b=btn(filterBar,f.label,()=>{taskFilter=f.id;draw();},f.id===taskFilter?'primary':'button');b.dataset.filter=f.id;}
  p.append(filterBar);
  const summary=node('p','form-hint');summary.id='v35-task-count';const today=node('div'),overdue=node('details');overdue.append(node('summary','','逾期未完成'));const dayHeading=node('h3','','当天待办');const handover=node('div');handover.id='v35-handover-tasks';
  const weekBox=node('div');weekBox.id='v35-week-calendar';
  p.append(summary,dayHeading,today,overdue,handover,weekBox);today.id='v35-day-tasks';overdue.id='v35-overdue-tasks';
  function renderHandover(){
   handover.replaceChildren();
   if(options.manager&&report?.pending_approvals?.length){
    const ap=node('section','panel');ap.id='v35-approvals';ap.append(node('h3','','待主管独立复核'));
    for(const a of report.pending_approvals){
     const q=node('article','lead-row');q.append(node('strong','',(a.contact_name||'待识别客户')+' · '+a.title),node('p','fineprint','负责人：'+(a.owner_name||'待分配')));
     if(a.can_review)btn(q,'前往独立复核',async()=>{await openLead(a.lead_id);if(options?.access?.enabled&&selected===a.lead_id)setCard('records');});
     else q.append(node('p','fineprint','本人关联事项 · 须由另一位主管独立复核'));
     ap.append(q);
    }
    handover.append(ap);
   }
   for(const r of incoming){
    const q=node('article','lead-row');q.append(node('p','','待确认接手 · '+r.reason));
    btn(q,'确认接手并继承全部待办',()=>mutate(()=>post(r.lead_id,'accept-transfer',{record_id:r.id,expected_version:r.version})));
    handover.append(q);
   }
   for(const l of rows.filter(l=>l.needs_arrangement&&(taskScope==='team'||l.owner_user_id===state.user.staff_id))){
    const q=node('article','lead-row');q.append(node('p','','待补安排 · '+l.contact_name));
    btn(q,'补充安排',()=>openLead(l.id));
    handover.append(q);
   }
   if(!handover.children.length&&taskFilter==='handover'){
    handover.append(node('p','','暂无待审批或待接手事项'));
   }
  }
  function renderWeek(all){
   weekBox.replaceChildren();
   const days=shWeekDays(weekAnchorDay||dayKey(Date.now())),todayStr=dayKey(Date.now()),wdLabels=['周一','周二','周三','周四','周五','周六','周日'];
   const navBar=node('div','v35-week-nav');
   btn(navBar,'上一周',()=>{weekAnchorDay=shDayShift(days[0],-7);draw();});
   btn(navBar,'回到本周',()=>{weekAnchorDay=dayKey(Date.now());draw();});
   btn(navBar,'下一周',()=>{weekAnchorDay=shDayShift(days[0],7);draw();});
   const rangeEl=node('span','form-hint',days[0]+' ~ '+days[6]+'（Asia/Shanghai）');rangeEl.id='v35-week-range';navBar.append(rangeEl);
   weekBox.append(navBar);
   const grid=node('div','v35-week-grid');weekBox.append(grid);
   days.forEach((dStr,idx)=>{
    const col=node('section','v35-week-day'+(dStr===todayStr?' is-today':''));col.dataset.day=dStr;
    const colHead=node('div','v35-week-day-head');
    colHead.append(node('span','',wdLabels[idx]+(dStr===todayStr?'（今日）':'')),node('span','fineprint',dStr));
    col.append(colHead);
    const items=all.filter(r=>dayKey(r.due_at)===dStr&&rows.some(l=>l.id===r.lead_id));
    if(!items.length){col.append(node('p','fineprint','无安排'));grid.append(col);return;}
    for(const r of items){
     const l=rows.find(x=>x.id===r.lead_id);if(!l)continue;
     const item=node('article','v35-week-item');
     const typeLabel=r.kind==='appointments'?((r.appointment_type==='trial'||r.type==='trial')?'试听':(r.appointment_type==='meeting'||r.type==='meeting')?'面谈':'预约'):'跟进待办';
     const isOverdue=dStr<todayStr||!!r.overdue;
     const meta=node('div','v35-col-next');
     meta.append(node('span','badge info',shTimeText(r.due_at)+' · '+typeLabel));
     if(isOverdue)meta.append(node('span','badge warning','已逾期'));
     item.append(meta,node('strong','',(l.students||[]).map(s=>s.name).join('、')||l.contact_name||'待识别客户'),node('p','fineprint',r.title+' · '+l.owner_name));
     btn(item,'查看进展 / 继续跟进',()=>resumeActivity(l.id,r.id));
     col.append(item);
    }
    grid.append(col);
   });
  }
  function draw(){taskDay=day.value;taskScope=scope?.value||'mine';today.replaceChildren();overdue.querySelectorAll('article,p.empty-hint').forEach(x=>x.remove());
   btnDay.className=taskView==='day'?'primary':'secondary';btnWeek.className=taskView==='week'?'primary':'secondary';
   btnDay.setAttribute('aria-pressed',String(taskView==='day'));btnWeek.setAttribute('aria-pressed',String(taskView==='week'));
   filterBar.querySelectorAll('button').forEach(b=>{b.className=b.dataset.filter===taskFilter?'primary':'button';});
   const all=(report?.reminders||[]).filter(r=>taskScope==='team'||r.owner_user_id===state.user.staff_id).sort((a,b)=>Date.parse(a.due_at)-Date.parse(b.due_at));
   if(taskView==='week'){
    day.closest('label').hidden=true;filterBar.hidden=true;summary.hidden=true;dayHeading.hidden=true;today.hidden=true;overdue.hidden=true;handover.hidden=true;weekBox.hidden=false;
    renderWeek(all);
    return;
   }
   day.closest('label').hidden=false;filterBar.hidden=false;weekBox.hidden=true;
   const due=all.filter(r=>dayKey(r.due_at)===taskDay);
   const people=new Set(due.flatMap(r=>{const l=rows.find(l=>l.id===r.lead_id);return l?.students?.length?l.students.map(s=>s.id):[r.lead_id];}));
   summary.textContent=taskDay+' · 需要跟进 '+people.size+' 人 · '+due.length+' 项事项';
   if(taskFilter==='handover'){
    dayHeading.hidden=true;today.hidden=true;overdue.hidden=true;handover.hidden=false;summary.hidden=true;
    renderHandover();
    return;
   }
   summary.hidden=false;handover.hidden=taskFilter!=='all';
   if(taskFilter==='overdue'){
    dayHeading.hidden=true;today.hidden=true;overdue.hidden=false;overdue.open=true;
   }else if(taskFilter==='appointments'){
    dayHeading.hidden=false;dayHeading.textContent=taskDay===dayKey(Date.now())?'当天面谈 / 试听':taskDay+' 面谈 / 试听';
    today.hidden=false;overdue.hidden=false;
   }else{
    dayHeading.hidden=false;dayHeading.textContent=taskDay===dayKey(Date.now())?'当天待办':taskDay+' 待办';
    today.hidden=false;overdue.hidden=false;
    renderHandover();
   }
   for(const r of all){
    const l=rows.find(l=>l.id===r.lead_id);if(!l)continue;
    const isAppointment=r.kind==='appointments'||r.type==='meeting'||r.type==='trial'||r.appointment_type==='meeting'||r.appointment_type==='trial';
    if(taskFilter==='appointments'&&!isAppointment)continue;
    const d=dayKey(r.due_at),isOverdue=d<dayKey(Date.now()),target=d===taskDay?today:isOverdue?overdue:null;
    if(!target)continue;
    const row=node('article','lead-row');
    row.append(node('strong','',(l.students||[]).map(s=>s.name).join('、')||l.contact_name),node('p','',r.title+' · '+dateText(r.due_at)));
    if(isOverdue){
     const days=Math.max(1,Math.round((Date.now()-Date.parse(r.due_at))/86400000));
     row.append(node('span','badge warning','已逾期 '+days+'天'));
    }
    row.append(node('p','fineprint','当前进展：'+stage(l.stage)+' · '+l.owner_name));
    btn(row,'查看进展 / 继续跟进',()=>resumeActivity(l.id,r.id));
    target.append(row);
   }
   if(taskFilter==='appointments'&&!today.querySelector('article'))today.append(node('p','','当天没有面谈或试听安排'));
   else if(!due.length&&!today.hidden)today.append(node('p','','当天没有待办事项'));
  }
  day.addEventListener('change',draw);scope?.addEventListener('change',draw);draw();
 }
 function renderPhoneIntake(target=panel){
  const p=node('section','panel');p.id='v35-lookup';target.append(p);p.append(node('h2','','新建 / 查询 Leads'));
  const f=node('form','field-stack');p.append(f);const phone=input(f,'电话号码','phone','tel',lookupPhone,true);phone.autocomplete='off';const b=node('button','primary','查询电话号码');b.type='submit';f.append(b);
  phone.addEventListener('change',()=>{if(phone.value.replace(/[^0-9]/g,'').length>=7)f.requestSubmit();});f.addEventListener('submit',e=>{e.preventDefault();const token=state.token,ticket=epoch;mutate(async()=>{const result=await api(root+'/lookup',{method:'POST',body:{phone:phone.value}});if(token!==state.token||ticket!==epoch)return;lookupPhone=result.phone;lookupResult=result.items;});});
  if(lookupResult===null){
   const list=node('section','panel');list.id='v35-my-leads';
   const head=node('div','v35-list-header');head.append(node('h3','',options.manager?'销售客户列表':'我的客户列表'));
   const toggle=node('div','v35-view-toggle');toggle.setAttribute('role','group');toggle.setAttribute('aria-label','列表视图切换');
   const btnTable=btn(toggle,'列式视图',()=>{if(myLeadView==='table')return;myLeadView='table';syncViewBtns();draw();},myLeadView==='table'?'primary':'secondary');
   const btnCards=btn(toggle,'卡片视图',()=>{if(myLeadView==='cards')return;myLeadView='cards';syncViewBtns();draw();},myLeadView==='cards'?'primary':'secondary');
   const btnKanban=btn(toggle,'阶段看板',()=>{if(myLeadView==='kanban')return;myLeadView='kanban';syncViewBtns();draw();},myLeadView==='kanban'?'primary':'secondary');
   const syncViewBtns=()=>{btnTable.className=myLeadView==='table'?'primary':'secondary';btnCards.className=myLeadView==='cards'?'primary':'secondary';btnKanban.className=myLeadView==='kanban'?'primary':'secondary';btnTable.setAttribute('aria-pressed',String(myLeadView==='table'));btnCards.setAttribute('aria-pressed',String(myLeadView==='cards'));btnKanban.setAttribute('aria-pressed',String(myLeadView==='kanban'));};
   syncViewBtns();head.append(toggle);list.append(head);
   const controls=node('div','v35-list-controls');list.append(controls);
   const search=input(controls,'查找客户（姓名 / 学生 / 电话）','my_lead_search','search',myLeadSearch);
   const filter=select(controls,'客户状态','my_lead_state',[{id:'all',label:'全部'},{id:'open',label:'跟进中'},{id:'won',label:'已全款结案'},{id:'lost',label:'已流失结案'},{id:'missing',label:'待补安排'}],myLeadState);
   const sortSel=select(controls,'排序方式','my_lead_sort',[{id:'default',label:'默认顺序'},{id:'due_asc',label:'下一步最近到期'},{id:'name_asc',label:'客户名称排序'}],myLeadSort);
   const savedBar=node('div','v35-saved-views');savedBar.id='v35-saved-views';list.append(savedBar);
   const svName=node('input');svName.type='text';svName.name='saved_view_name';svName.placeholder='视图名称（仅当前会话）';svName.setAttribute('aria-label','视图名称');
   const svChips=node('div','v35-saved-views');svChips.style.marginBottom='0';
   const drawSavedViews=()=>{
    svChips.replaceChildren();
    for(const sv of savedViews){
     const chip=node('span','v35-saved-chip');
     btn(chip,sv.name,()=>{search.value=sv.search;filter.value=sv.state;sortSel.value=sv.sort;myLeadSearch=sv.search;myLeadState=sv.state;myLeadSort=sv.sort;myLeadView=sv.view;syncViewBtns();onSearch();},'text-button');
     const del=btn(chip,'×',()=>{savedViews=savedViews.filter(x=>x.id!==sv.id);drawSavedViews();},'text-button');del.setAttribute('aria-label','删除视图 '+sv.name);
     svChips.append(chip);
    }
   };
   const isSensitivePhonePattern=s=>{
    if(!s||typeof s!=='string')return false;
    let clean=s.trim();
    if(!clean)return false;
    clean=clean.replace(/(?:19|20)\d{2}[-/.\u5e74](?:0?[1-9]|1[0-2])[-/.\u6708](?:0?[1-9]|[12]\d|3[01])\u65e5?(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?/g,' ');
    // Scan phone-shaped spans anywhere in text; do not combine digits across words.
    // Keep brackets explicit so separators remain inside a single candidate.
    const candRegex=/[+＋]?\d[\d\s\-–—_().（）【】\[\]·•/]*\d/g;
    for(const cand of clean.match(candRegex)||[]){
     // No upper bound: adjacent numbers or a numeric prefix must not hide a phone.
     if(cand.replace(/\D/g,'').length>=7)return true;
    }
    return false;
   };
   savedBar.append(svName);
   const svHint=node('span','form-hint');svHint.id='v35-saved-view-hint';savedBar.append(svHint);
   btn(savedBar,'保存当前视图',()=>{
    const rawSearch=(search.value||'').trim(),rawName=(svName.value||'').trim();
    if(isSensitivePhonePattern(rawSearch)||isSensitivePhonePattern(rawName)){
     svHint.textContent='安全提示：视图名称和搜索条件不能包含电话号码。请清除号码后保存非敏感筛选条件。';
     svHint.className='form-hint warning';
     announce('视图包含电话号码，已拒绝保存');
     return;
    }
    svHint.textContent='';
    svHint.className='form-hint';
    const name=rawName||('视图 '+(savedViews.length+1));
    savedViews.push({id:String(++savedViewSeq),name,search:search.value,state:filter.value,sort:sortSel.value,view:myLeadView});
    svName.value='';
    drawSavedViews();
    announce('视图已保存');
   },'secondary');
   savedBar.append(svChips);drawSavedViews();
   const rowsEl=node('div');list.append(rowsEl);
   const runServerSearch=q=>{
    const sTicket=++searchSeq,token=state.token,ticket=epoch;
    api(root+'?q='+encodeURIComponent(q)).then(d=>{if(token!==state.token||ticket!==epoch||sTicket!==searchSeq)return;myLeadSearchItems=d.items;draw();}).catch(e=>{if(token===state.token&&ticket===epoch&&sTicket===searchSeq)handleAuthFailure(e);});
   };
   const draw=()=>{
    myLeadSearch=search.value;myLeadState=filter.value;myLeadSort=sortSel.value;
    const qTrim=search.value.trim(),qDigits=qTrim.replace(/[^0-9]/g,''),useServer=qDigits.length>=4;
    rowsEl.className=myLeadView==='table'?'v35-leads-table':myLeadView==='kanban'?'v35-leads-kanban-wrap':'v35-leads-cards';
    rowsEl.replaceChildren();
    if(useServer&&myLeadSearchItems===null){rowsEl.append(node('p','','搜索中…'));return;}
    const baseRows=useServer?myLeadSearchItems:rows;
    const filtered=baseRows.filter(l=>(useServer||!qTrim||[l.contact_name,l.contact_info_masked,...(l.students||[]).map(s=>s.name)].some(v=>v?.includes(qTrim)))&&(filter.value==='all'||filter.value==='missing'?filter.value!=='missing'||l.needs_arrangement:l.terminal_state===filter.value));
    if(sortSel.value==='due_asc')filtered.sort((a,b)=>(a.next_action?Date.parse(a.next_action.due_at):Number.MAX_SAFE_INTEGER)-(b.next_action?Date.parse(b.next_action.due_at):Number.MAX_SAFE_INTEGER));
    else if(sortSel.value==='name_asc')filtered.sort((a,b)=>(a.contact_name||'').localeCompare(b.contact_name||'','zh-CN'));
    if(!filtered.length){rowsEl.append(node('p','','暂无匹配客户'));return;}
    if(myLeadView==='kanban'){
     rowsEl.append(node('p','form-hint','只读阶段看板：按真实销售阶段与终态分组投影，不可拖拽或直接改写业务事实；点击客户卡片进入侧边详情操作。'));
     const board=node('div','v35-leads-kanban');board.id='v35-kanban-board';rowsEl.append(board);
     const openStages=(options?.stages||[]).filter(s=>s.id!=='declined');
     const stageIds=new Set(openStages.map(s=>s.id));
     const hasUnclassified=filtered.some(l=>l.terminal_state==='open'&&!stageIds.has(l.stage));
     const hasLegacyClosed=filtered.some(l=>l.terminal_state==='legacy_closed');
     const cols=[...openStages.map(s=>({id:s.id,label:s.label})),...(hasUnclassified?[{id:'unclassified',label:'待核实（旧记录）'}]:[]),{id:'__won__',label:'已全款结案 (Closed Won)'},{id:'__lost__',label:'已流失结案 (Closed Lost)'},...(hasLegacyClosed?[{id:'__legacy_closed__',label:'旧终态'}]:[])];
     const colKey=l=>l.terminal_state==='won'?'__won__':l.terminal_state==='lost'?'__lost__':l.terminal_state==='legacy_closed'?'__legacy_closed__':(stageIds.has(l.stage)?l.stage:'unclassified');
     for(const col of cols){
      const colItems=filtered.filter(l=>colKey(l)===col.id);
      const colEl=node('section','v35-kanban-col');colEl.dataset.stageCol=col.id;
      const colHead=node('div','v35-kanban-col-head');colHead.append(node('span','',col.label),node('span','fineprint',colItems.length+' 个客户'));
      colEl.append(colHead);
      if(!colItems.length){colEl.append(node('p','fineprint','暂无客户'));board.append(colEl);continue;}
      for(const l of colItems){
       const studentNames=(l.students||[]).map(s=>s.name).join('、');
       const primaryLabel=studentNames||l.contact_name||'待识别客户';
       const masked=l.contact_info_masked||'未留电话';
       const overdueDays=l.overdue&&l.next_action?.due_at?Math.max(1,Math.round((Date.now()-Date.parse(l.next_action.due_at))/86400000)):0;
       const cardEl=node('article','v35-lead-compact v35-kanban-card'+(l.id===selected?' active':''));cardEl.dataset.leadId=l.id;
       cardEl.append(node('strong','',primaryLabel+(l.students?.length>1?'（'+l.students.length+'名学生）':'')),node('div','fineprint',(l.contact_name&&studentNames?l.contact_name+' · ':'')+masked+' · '+l.owner_name));
       cardEl.append(node('p','fineprint','最近沟通：'+commText(l.last_communication)+' · '+appointmentStatusText(l.latest_appointment)));
       if(l.next_action){
        const np=node('p',l.overdue?'form-hint warning':'fineprint','下一步：'+l.next_action.title+' · '+dateText(l.next_action.due_at));
        if(overdueDays)np.append(' ',node('span','badge warning','已逾期 '+overdueDays+'天'));
        cardEl.append(np);
       }else if(l.needs_arrangement)cardEl.append(node('p','form-hint warning','下一步：待补安排'));
       btn(cardEl,'打开客户',()=>openLead(l.id));
       colEl.append(cardEl);
      }
      board.append(colEl);
     }
     return;
    }
    if(myLeadView==='table'){
     const th=node('div','v35-table-head');
     for(const col of ['学生 / 客户与电话','阶段与来源','最近沟通','面谈 / 试听','下一步与逾期','操作'])th.append(node('span','',col));
     rowsEl.append(th);
    }
    for(const l of filtered){
     const studentNames=(l.students||[]).map(s=>s.name).join('、');
     const primaryLabel=studentNames||l.contact_name||'待识别客户';
     const masked=l.contact_info_masked||'未留电话';
     const src=l.current_source||l.original_source||'待确认';
     const stageStr=stage(l.stage)+' · '+terminalText(l.terminal_state);
     const commStr=commText(l.last_communication);
     const apptStr=appointmentStatusText(l.latest_appointment);
     const overdueDays=l.overdue&&l.next_action?.due_at?Math.max(1,Math.round((Date.now()-Date.parse(l.next_action.due_at))/86400000)):0;
     if(myLeadView==='table'){
      const q=node('article','lead-row v35-lead-compact v35-lead-row-table'+(l.id===selected?' active':''));
      const c1=node('div','v35-col v35-col-lead');
      c1.append(node('strong','',primaryLabel),node('div','fineprint',(l.contact_name&&studentNames?l.contact_name+' · ':'')+masked+' · '+l.owner_name));
      const c2=node('div','v35-col v35-col-stage');
      c2.append(node('span','',stageStr),node('div','fineprint','来源：'+src));
      const c3=node('div','v35-col v35-col-comm');
      c3.append(node('span','',commStr));
      const c4=node('div','v35-col v35-col-appt');
      c4.append(node('span','',apptStr));
      const c5=node('div','v35-col v35-col-next');
      if(l.next_action)c5.append(node('span',l.overdue?'form-hint warning':'',l.next_action.title+' · '+dateText(l.next_action.due_at)));
      else c5.append(node('span',l.needs_arrangement?'form-hint warning':'fineprint',l.needs_arrangement?'待补安排':'无待办'));
      if(overdueDays)c5.append(node('span','badge warning','已逾期 '+overdueDays+'天'));
      const c6=node('div','v35-col v35-col-action');
      btn(c6,'打开客户',()=>openLead(l.id));
      q.append(c1,c2,c3,c4,c5,c6);
      rowsEl.append(q);
     }else{
      const q=node('article','lead-row v35-lead-compact v35-lead-card'+(l.id===selected?' active':''));
      q.append(node('strong','',primaryLabel+(l.contact_name&&studentNames?' · '+l.contact_name:'')),node('p','',stageStr+' · 来源：'+src+' · '+l.owner_name+' · '+masked),node('p','fineprint','最近沟通：'+commStr+' · 面谈/试听：'+apptStr));
      if(l.next_action){
       const np=node('p',l.overdue?'form-hint warning':'form-hint','下一步：'+l.next_action.title+' · '+dateText(l.next_action.due_at));
       if(overdueDays)np.append(' ',node('span','badge warning','已逾期 '+overdueDays+'天'));
       q.append(np);
      }else if(l.needs_arrangement)q.append(node('p','form-hint warning','下一步：待补安排'));
      btn(q,'打开客户',()=>openLead(l.id));
      rowsEl.append(q);
     }
    }
   };
   const onSearch=()=>{const qTrim=search.value.trim(),qDigits=qTrim.replace(/[^0-9]/g,'');myLeadSearchItems=null;if(qDigits.length>=4){draw();runServerSearch(qTrim);}else{searchSeq++;draw();}};
   search.addEventListener('input',onSearch);filter.addEventListener('change',draw);sortSel.addEventListener('change',draw);
   if(myLeadSearch.trim().replace(/[^0-9]/g,'').length>=4&&myLeadSearchItems===null)runServerSearch(myLeadSearch.trim());
   draw();target.append(list);return;
  }
  btn(p,'清空号码查询 / 返回客户列表',()=>{saveCurrentLeadDraft();lookupPhone='';lookupResult=null;display();},'text-button');
  if(!lookupResult.length){p.append(node('p','form-hint','没有匹配线索，补充必要资料即可新建。'));renderList(true);return;}
  for(const r of lookupResult){const q=node('article','lead-row');p.append(q);if(r.status==='assigned'){q.append(node('p','','该号码已有销售负责：'+r.owner_name+'。请通过销售主管办理转交。'));continue;}q.append(node('strong','',r.contact_name),node('p','',(r.students||[]).map(s=>s.name).join('、')||'学生待补充'));
   if(r.status==='sales_available'){q.append(node('p','','已有销售线索 · '+r.owner_name));btn(q,'打开已有客户',()=>{card=null;openLead(r.lead_id);});continue;}
   q.append(node('p','','匹配到市场线索 · 来源：'+r.source+'。接收后沿用原记录。'));btn(q,'接收并安排首次跟进',()=>{saveCurrentLeadDraft();claim=r;card=null;display();});
  }
 }
 function renderClaim(){const c=form(panel,'v35-claim','接收市场线索 · '+claim.contact_name,'接收并保存首次安排',async f=>{const token=state.token,ticket=epoch;const r=await api(root+'/'+claim.lead_id+'/claim',{method:'POST',body:{phone:lookupPhone,next:n.read(),...(initial.read()?{initial_communication:initial.read()}:{})}});if(token!==state.token||ticket!==epoch)return;selected=r.lead_id;claim=null;lookupResult=null;if(n.read().appointment)return 'scheduled';if(initial.read())return 'recorded';},{open:true,version:null}),initial=initialFields(c.f),n=nextFields(c.f,{allowExisting:false});initial.bind(n.allowBooking);c.f.append(c.submit);btn(panel,'返回查询结果',()=>{saveCurrentLeadDraft();claim=null;display();});}
 function renderMarket(){
  const p=node('section','panel');p.id='v35-market';panel.append(p);p.append(node('h2','',options.access.market_manager?'市场管理':'我的市场线索'));
  const c=form(p,'v35-market-intake','录入市场线索','保存并提交销售交接',async f=>{const b=data(f);await api(root+'/market',{method:'POST',body:b});},{open:false,version:null});input(c.f,'电话号码','phone','tel','',true);input(c.f,'联系人姓名','contact_name','text','',true);input(c.f,'学生姓名（选填）','student_name');select(c.f,'获客来源','source',['市场活动','网络咨询','到店','转介绍','主动咨询','其他'],'市场活动');input(c.f,'市场内部备注（不向销售展示）','notes','textarea');c.f.append(c.submit);
  const search=input(p,'查询市场线索','market_search','search');const list=node('div');p.append(list);function draw(){list.replaceChildren();for(const r of marketRows.filter(r=>!search.value||[r.contact_name,r.phone,...(r.students||[])].some(v=>v?.includes(search.value)))){const q=node('article','lead-row');q.append(node('strong','',r.contact_name),node('p','',r.phone+' · '+r.source),node('p','',r.handoff_state==='market'?'待销售接收':'已交接销售'),node('p','fineprint','市场负责人：'+r.market_owner_name));if(r.marketing_notes)q.append(node('p','',r.marketing_notes));list.append(q);}if(!list.childElementCount)list.append(node('p','','暂无市场线索'));}search.addEventListener('input',draw);draw();
 }

 function initialFields(f){
  let onBook=null;
  const choice=select(f,'已经发生了什么','initial_method',[{id:'none',label:'尚未沟通，先安排联系'},{id:'phone_failed',label:'刚拨打电话未接通'},{id:'campus',label:'刚完成到校面谈'},{id:'phone',label:'刚完成电话沟通'},{id:'wechat_text',label:'刚完成微信沟通'}],'none');
  const area=node('div','field-stack');f.append(area);const at=input(area,'实际沟通时间','initial_at','datetime-local',local(new Date()),true);const failReason=select(area,'未接通原因','initial_failure_reason',options.failure_reasons.phone,'无人接听');const extraNotes=!f.elements.notes?input(area,'本次沟通内容（选填）','initial_notes','textarea'):null;const stage=select(area,'沟通后的销售进展','initial_stage',options.stages.filter(s=>['needs_discovery','needs_confirmed','courses_introduced','enrollment_intent'].includes(s.id)),'needs_discovery');
  const sync=()=>{const active=choice.value!=='none',failed=choice.value==='phone_failed',communicated=active&&!failed;conditional(area,active);failReason.closest('label').hidden=!failed;failReason.disabled=!failed;stage.closest('label').hidden=!communicated;stage.disabled=!communicated;const noteInput=f.elements.notes||extraNotes;if(noteInput)noteInput.required=failed&&failReason.value==='其他';onBook?.(communicated);};choice.addEventListener('change',sync);failReason.addEventListener('change',sync);sync();
  return {read:()=>choice.value==='none'?null:choice.value==='phone_failed'?{method:'phone',result:'failed',failure_reason:failReason.value,at:localIso(at.value),notes:f.elements.notes?.value||extraNotes?.value||''}:{method:choice.value,at:localIso(at.value),notes:f.elements.notes?.value||extraNotes?.value||'',stage:stage.value},bind:fn=>{onBook=fn;sync();}};
 }
 function resumeActivity(id,recordId){openLead(id,recordId);}

 const prior=window.__refreshBusinessWorkspace;window.__refreshBusinessWorkspace=async()=>{if(prior&&!state.user?.workspace_access?.enabled)await prior();await refresh();};
 const snapOld=window.__snapshotLeadDraft,restoreOld=window.__restoreLeadDraft;
 window.__snapshotLeadDraft=()=>{if(!enabled)return snapOld?.();if(state.view!=='sales-workflow')return null;return {v34:true,selected,view,group,card,activityTarget,editingQuoteId,lookupPhone,lookupResult,claim,forms:[...panel.querySelectorAll('form')].map(f=>({id:f.id,open:f.closest('details')?.open,fields:[...f.querySelectorAll('input,select,textarea')].filter(i=>i.type!=='file').map(i=>({name:i.name,value:i.value,checked:i.checked}))}))};};
 window.__restoreLeadDraft=async draft=>{if(!draft?.v34)return restoreOld?.(draft);if(!enabled||state.strict)return false;const token=state.token,ticket=epoch;selected=draft.selected;view=draft.view;group=draft.group;card=draft.card||null;activityTarget=draft.activityTarget||null;editingQuoteId=draft.editingQuoteId||null;lookupPhone=draft.lookupPhone||'';lookupResult=draft.lookupResult??null;claim=draft.claim||null;if(selected){if(!rows.some(l=>l.id===selected))return false;const d=await api(root+'/'+selected);if(ticket!==epoch||token!==state.token)return false;detail=d;}display();for(const saved of draft.forms){const f=$(saved.id);if(!f)continue;if(saved.id==='v34-quote'){const count=saved.fields.filter(v=>v.name==='course').length;while(f.querySelectorAll('.v34-course').length<count)[...f.querySelectorAll('button')].find(b=>b.textContent==='增加课程').click();}const used={};for(const v of saved.fields){const i=f.querySelectorAll('[name="'+v.name+'"]')[used[v.name]||0];used[v.name]=(used[v.name]||0)+1;if(!i)continue;if(i.type==='checkbox')i.checked=v.checked;else i.value=v.value;if(i.tagName==='SELECT')i.dispatchEvent(new Event('change',{bubbles:true}));}if(f.closest('details'))f.closest('details').open=saved.open;f.dispatchEvent(new Event('input',{bubbles:true}));if(saved.id==='v34-quote')f.querySelector('[name="unit"]')?.dispatchEvent(new Event('input',{bubbles:true}));}return true;};
 window.addEventListener('isolated-session-clear',()=>{epoch++;seq++;taskDay=dayKey(Date.now());taskScope='mine';taskFilter='all';wipeState();busy=false;session=null;panel.replaceChildren();});
 fetch('/api/v1/health',{cache:'no-store'}).then(r=>r.json()).then(r=>{enabled=r?.data?.sales_workflow_v34===true;if(enabled){document.querySelector('#login-screen .eyebrow').textContent='V3.4 · 隔离演示';document.querySelector('#login-screen .muted').textContent='可测试完整招生流程，请只录入虚构资料。所有收款核实均为本机演示记录。';$('demo-finance-option').hidden=false;if(r.data.role_workspaces)document.querySelectorAll('.role-demo-option').forEach(o=>o.hidden=false);if(state.token)refresh();}}).catch(()=>{});
 setInterval(()=>{if(enabled&&state.token&&state.view==='sales-workflow'&&!selected&&!busy)refresh();},60000);
})();
