// Fictional planning only; credentials remain in the existing in-memory session.
(()=>{
 const root='/api/v1/isolated-workspace/';
 const labels={tasks:'跟进任务',trials:'试听申请',quotes:'报价草稿','order-intents':'报名意向',
  'expense-plans':'费用计划','automation-rules':'本地提醒规则'};
 const statuses={open:'待完成',completed:'已完成',cancelled:'已取消',draft:'草稿，待外部确认',configured:'规则已保存'};
 const stageNames={new:'新建',contacted:'已联系',needs_analysis:'需求确认',proposal:'方案沟通',negotiation:'意向协商'};
 let enabled=false,records=[],summary=null,editing=null,generation=0,loading=false;
 const nav=node('button','nav-item','▣  业务计划与任务');nav.type='button';nav.hidden=true;nav.id='workspace-business-nav';
 document.querySelector('nav[aria-label="模块导航"]').append(nav);
 const panel=node('section','view');panel.dataset.panel='business-workspace';panel.id='business-workspace';
 // Static template only. All business text below is assigned with textContent.
 panel.innerHTML=`<div class="panel"><h2>业务计划与任务</h2>
  <p>这里只保存虚构业务计划。预计金额不计入收入；试听、价格、收款、提成与课时均待真实系统确认。</p>
  <p id="business-status" role="status">请选择业务类型</p>
  <div id="business-summary" class="scope-grid"></div>
  <form id="business-form" class="field-stack">
   <label>业务类型<select name="kind" id="business-kind"></select></label>
   <label>名称<input name="title" required maxlength="120"></label>
   <label data-business-field="student">学生<select name="student_id" id="business-student"></select></label>
   <label data-business-field="opportunity">商机<select name="opportunity_id" id="business-opportunity"></select></label>
   <label data-business-field="time">计划时间<input type="datetime-local" name="at"></label>
   <label data-business-field="course">拟选课程<input name="course_label" maxlength="120"></label>
   <label data-business-field="quantity">拟购数量（整数）<input name="quantity" type="number" min="1" max="10000" value="1"></label>
   <div data-business-field="extra"><div id="business-extra-lines"></div><button class="secondary" type="button" id="business-add-line">增加课程明细</button></div>
   <label data-business-field="amount">计划金额（元，报价为拟议单价）<input name="amount" inputmode="decimal" placeholder="0.00"></label>
   <label data-business-field="quote">报价草稿<select name="quote_id" id="business-quote"></select></label>
   <label data-business-field="purpose">计划用途<textarea name="purpose" maxlength="500"></textarea></label>
   <label data-business-field="inactive">未跟进天数<input name="inactive_days" type="number" min="1" max="365" value="3"></label>
   <label data-business-field="due">提醒后几天到期<input name="due_in_days" type="number" min="0" max="30" value="1"></label>
   <label data-business-field="enabled">规则开关<select name="enabled"><option value="true">启用本人商机的本地任务提醒</option><option value="false">停用</option></select></label>
   <div><button class="primary" type="submit" id="business-save">保存业务计划</button>
   <button class="secondary" type="button" id="business-reset">取消编辑</button></div>
  </form></div>
  <div class="panel"><div class="panel-header"><h3>已保存记录</h3><button class="secondary" type="button" id="business-refresh">刷新业务计划</button></div>
   <div id="business-records"></div><div id="business-history" aria-live="polite"></div></div>
  <div class="panel"><h3>商机推进与预计金额</h3><p>仅推进销售沟通阶段，不认定试听完成或正式成交。</p><div id="business-pipeline"></div></div>
  <div class="panel"><h3>本人跟进历史</h3><p>在原跟进记录页面登记的一次沟通，仅保留一条记录。</p><div id="business-interactions"></div></div>
  <div class="panel"><h3>本地自动提醒</h3><p>启用规则后，登录期间每分钟扫描本人商机，生成一次待办任务；不会向家长或员工发送外部消息。</p>
   <button class="secondary" type="button" id="business-scan">立即检查本人待跟进商机</button></div>
  <div class="panel"><h3>收入、业绩与集成状态</h3><p id="business-external">尚无经财务确认的收入或提成数据。CRM、财务未连接；真实身份与审计存储未验收。</p></div>`;
 document.querySelector('main.main').append(panel);
 for(const [value,label] of Object.entries(labels))$('business-kind').append(option(value,label));
 const kind=()=>$('business-kind').value;
 function fields(){
  const shown={tasks:['student','opportunity','time'],trials:['student','opportunity','time'],
   quotes:['student','opportunity','time','course','quantity','amount','extra'],
   'order-intents':['quote'],'expense-plans':['amount','purpose'],
   'automation-rules':['inactive','due','enabled']}[kind()];
  panel.querySelectorAll('[data-business-field]').forEach(el=>{
   el.hidden=!shown.includes(el.dataset.businessField);
   el.querySelectorAll('input,textarea,select').forEach(input=>input.disabled=el.hidden);
  });
  $('business-save').textContent=editing?'保存新版本':'保存业务计划';
 }
 function reset(){editing=null;$('business-extra-lines').replaceChildren();$('business-form').reset();fields();}
 function extraLine(value={course_label:'',quantity:1,proposed_unit_cents:0}){
  const row=node('div','field-stack');row.classList.add('business-quote-line');
  for(const [field,label,type,initial] of [['course','拟选课程','text',value.course_label],['quantity','拟购数量','number',value.quantity],['amount','拟议单价（元）','text',(value.proposed_unit_cents/100).toFixed(2)]]){
   const container=node('label','',label),input=node('input');input.type=type;input.dataset.quoteField=field;input.value=initial;
   if(type==='number'){input.min=1;input.max=10000;}else input.maxLength=120;
   container.append(input);row.append(container);
  }
  row.append(button('移除此课程',()=>row.remove()));$('business-extra-lines').append(row);
 }
 function active(){return enabled&&state.token&&!state.strict;}
 function clear(){
  generation++;records=[];summary=null;editing=null;nav.hidden=true;
  for(const id of ['business-records','business-summary','business-pipeline','business-history','business-student','business-opportunity','business-quote','business-interactions'])$(id).replaceChildren();
  $('business-form').reset();$('business-status').textContent='未登录，业务计划已清空。';
  $('business-extra-lines').replaceChildren();
  $('business-quote')._quotes=[];
  panel.classList.remove('active');
 }
 async function refreshBusiness(){
  if(!active()){clear();return;}
  const ticket=++generation,token=state.token;nav.hidden=false;
  const selected=kind();
  // Clear old data before a request so a failure cannot leave stale records.
  for(const id of ['business-records','business-summary','business-pipeline','business-history','business-interactions'])$(id).replaceChildren();
  try{
   const [s,list,quotes,interactions]=await Promise.all([api(root+'summary'),api(root+selected),api(root+'quotes'),api(root+'interactions')]);
   if(ticket!==generation||token!==state.token||!active())return;
   summary=s;records=list.items;
   $('business-status').textContent='已读取 '+records.length+' 条'+labels[selected]+'。';
   setSelect($('business-student'),state.students,'student_id',v=>v.display_name,true);
   setSelect($('business-opportunity'),summary.pipeline,'id',v=>v.student_name+' · '+(stageNames[v.stage]||'历史阶段'),true);
   setSelect($('business-quote'),quotes.items.filter(x=>x.state==='draft'&&Date.parse(x.body.valid_until)>Date.now()),
    'id',v=>v.body.title+' · 第'+v.version+'版 · '+yuan(v.body.total_cents));
   $('business-quote')._quotes=quotes.items;
   for(const item of interactions.items)$('business-interactions').append(node('p','',formatDate(item.occurred_at)+' · '+item.contact_method+' · '+item.summary));
   for(const [title,value] of [['待完成任务',s.open_tasks],['逾期任务',s.overdue_tasks],['在跟进商机预计金额',yuan(s.forecast_cents)],['在跟进商机',s.open_opportunities]]){
    const box=node('div','stat-card');box.append(node('span','',title),node('strong','',String(value)));$('business-summary').append(box);
   }
   renderRecords();renderPipeline();fields();
  }catch(e){if(ticket===generation&&token===state.token){records=[];summary=null;
   $('business-student').replaceChildren();$('business-opportunity').replaceChildren();$('business-quote').replaceChildren();
   $('business-quote')._quotes=[];$('business-status').textContent='读取失败，已清空旧数据。'+e.message;}}
 }
 function button(label,action){const b=node('button','secondary',label);b.type='button';
  b.addEventListener('click',async()=>{b.disabled=true;try{await action();}catch(e){toast(e.message,true);}finally{b.disabled=false;}});return b;}
 function describe(row){
  const b=row.body;return [b.title,statuses[row.state]||'待核实','第'+row.version+'版',
   b.total_cents!=null?'拟议总额 '+yuan(b.total_cents):'',b.amount_cents!=null?'计划金额 '+yuan(b.amount_cents):'',
   b.due_at?'到期 '+formatDate(b.due_at):'',b.requested_slot_at?'申请 '+formatDate(b.requested_slot_at):'',
   b.enabled===false?'已停用':kind()==='automation-rules'?'仅本人本地任务':''].filter(Boolean).join(' · ');
 }
 function renderRecords(){
  const el=$('business-records');el.replaceChildren();
  if(!records.length)el.append(node('p','muted','暂无记录，请先保存一项计划。'));
  for(const row of records){
   const card=node('article','audit-item');card.append(node('strong','',describe(row)));
   for(const item of row.body.items||[])card.append(node('p','',item.course_label+' × '+item.quantity+' · 拟议单价 '+yuan(item.proposed_unit_cents)));
   const actions=node('div','topbar-actions');
   actions.append(button('查看历史版本',async()=>{
    const token=state.token,ticket=generation;
    const r=await api(root+kind()+'/'+row.id+'/history');
    if(token!==state.token||ticket!==generation)return;
    const history=$('business-history');history.replaceChildren(node('h3','',row.body.title+' · 历史版本'));
    for(const x of r.items){history.append(node('p','',describe(x)+' · '+formatDate(x.recorded_at)));
     for(const item of x.body.items||[])history.append(node('p','',item.course_label+' × '+item.quantity+' · '+yuan(item.proposed_unit_cents)));}
   }));
   if(!['completed','cancelled'].includes(row.state)){
    if(kind()!=='order-intents')actions.append(button('编辑',()=>{
     editing=row;const form=$('business-form');form.elements.title.value=row.body.title;
     form.elements.student_id.value=row.student_id||'';form.elements.opportunity_id.value=row.opportunity_id||'';
     const at=row.body.due_at||row.body.requested_slot_at||row.body.valid_until;
     if(at){const date=new Date(at);form.elements.at.value=new Date(date-date.getTimezoneOffset()*60000).toISOString().slice(0,16);}
     form.elements.course_label.value=row.body.items?.[0]?.course_label||'';
     form.elements.quantity.value=row.body.items?.[0]?.quantity||1;
     $('business-extra-lines').replaceChildren();for(const item of row.body.items?.slice(1)||[])extraLine(item);
     form.elements.amount.value=((row.body.items?.[0]?.proposed_unit_cents??row.body.amount_cents??0)/100).toFixed(2);
     form.elements.purpose.value=row.body.purpose||'';
     form.elements.inactive_days.value=row.body.inactive_days||3;form.elements.due_in_days.value=row.body.due_in_days??1;
     form.elements.enabled.value=String(row.body.enabled??true);fields();form.scrollIntoView({block:'start'});
    }));
    for(const next of kind()==='tasks'?['completed','cancelled']:['cancelled'])actions.append(button(statuses[next],async()=>{
     await api(root+kind()+'/'+row.id+'/state',{method:'POST',body:{expected_version:row.version,state:next}});await refreshBusiness();
    }));
   }
   card.append(actions);el.append(card);
  }
 }
 function renderPipeline(){
  const el=$('business-pipeline');el.replaceChildren();
  for(const o of summary.pipeline){
   const card=node('article','audit-item');card.append(node('strong','',o.student_name+' · '+yuan(o.predicted_amount_cents)));
   const stage=node('select'),life=node('select'),reason=node('input');reason.placeholder='本次推进原因';reason.maxLength=500;
   stage.setAttribute('aria-label','商机阶段');life.setAttribute('aria-label','商机状态');reason.setAttribute('aria-label','推进原因');
   for(const [key,label] of Object.entries(stageNames))stage.append(option(key,label));stage.value=o.stage;
   for(const [key,label] of [['open','跟进中'],['paused','暂停'],['lost','失单']])life.append(option(key,label));life.value=o.lifecycle_state;
   card.append(stage,life,reason,button('保存商机推进',async()=>{
    await api(root+'pipeline/'+o.id,{method:'POST',body:{expected_version:Number(o.version),stage:stage.value,lifecycle_state:life.value,reason:reason.value}});
    await refreshBusiness();
   }));el.append(card);
  }
 }
 $('business-form').addEventListener('submit',async event=>{
  event.preventDefault();const submit=$('business-save');submit.disabled=true;
  try{
   const f=Object.fromEntries(new FormData(event.target));const k=kind();let body={title:f.title};
   if(['tasks','trials','quotes'].includes(k))body={...body,student_id:f.student_id||null,opportunity_id:f.opportunity_id||null};
   if(k==='tasks')body.due_at=f.at?localIso(f.at):null;
   if(k==='trials')body.requested_slot_at=localIso(f.at);
   if(k==='quotes')body={...body,valid_until:localIso(f.at),items:[{course_label:f.course_label,quantity:Number(f.quantity),proposed_unit_cents:cents(f.amount)},
    ...Array.from(panel.querySelectorAll('.business-quote-line')).map(row=>({
     course_label:row.querySelector('[data-quote-field="course"]').value,
     quantity:Number(row.querySelector('[data-quote-field="quantity"]').value),
     proposed_unit_cents:cents(row.querySelector('[data-quote-field="amount"]').value)
    }))]};
   if(k==='order-intents'){
    const q=$('business-quote')._quotes?.find(x=>x.id===f.quote_id);if(!q)throw Error('请选择有效的报价草稿');
    body={...body,quote_id:q.id,quote_version:q.version,student_id:q.student_id,opportunity_id:q.opportunity_id};
   }
   if(k==='expense-plans')body={...body,amount_cents:cents(f.amount),purpose:f.purpose};
   if(k==='automation-rules')body={...body,action:'create_followup_task',enabled:f.enabled==='true',inactive_days:Number(f.inactive_days),due_in_days:Number(f.due_in_days)};
   if(editing)body.expected_version=editing.version;
   await api(root+k+(editing?'/'+editing.id:''),{method:'POST',body});
   const selected=k;reset();$('business-kind').value=selected;await refreshBusiness();toast('业务计划已保存，仍待外部确认');
  }catch(e){toast(e.message,true);}finally{submit.disabled=false;}
 });
 async function scan(){
  if(!active()||loading)return;loading=true;
  const token=state.token;
  try{const result=await api(root+'automation/run',{method:'POST',body:{}});
   if(!active()||token!==state.token)return;
   await refreshBusiness();return result;}
  catch(e){if(active())toast(e.message,true);}finally{loading=false;}
 }
 nav.addEventListener('click',()=>{setView('business-workspace');$('page-title').textContent='业务计划与任务';refreshBusiness();});
 $('business-kind').addEventListener('change',()=>{editing=null;$('business-extra-lines').replaceChildren();fields();refreshBusiness();});
 $('business-add-line').addEventListener('click',()=>{if(panel.querySelectorAll('.business-quote-line').length<29)extraLine();});
 $('business-reset').addEventListener('click',()=>{const selected=kind();reset();$('business-kind').value=selected;fields();});
 $('business-refresh').addEventListener('click',refreshBusiness);
 $('business-scan').addEventListener('click',()=>scan().then(result=>{if(result&&active())toast('已生成 '+result.created+' 条本人本地任务');}));
 window.addEventListener('isolated-session-change',refreshBusiness);
 window.addEventListener('isolated-session-clear',clear);
 setInterval(()=>{if(active())scan();},60_000);
 fetch('/api/v1/health',{cache:'no-store'}).then(r=>r.json()).then(r=>{enabled=r?.data?.isolated_workspace===true;if(active())refreshBusiness();}).catch(()=>{});
 fields();
})();
