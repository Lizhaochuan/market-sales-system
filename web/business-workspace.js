// Fictional planning only; credentials remain in the existing in-memory session.
(()=>{
 const root='/api/v1/isolated-workspace/';
 const labels={tasks:'跟进任务',trials:'试听申请',quotes:'报价草稿','order-intents':'报名意向',
  'expense-plans':'费用计划','automation-rules':'本地提醒规则'};
 const statuses={open:'待完成',completed:'已完成',cancelled:'已取消',draft:'草稿，待外部确认',configured:'规则已保存'};
 const stageNames={new:'新建',contacted:'已联系',needs_analysis:'需求确认',proposal:'方案沟通',negotiation:'意向协商'};
 let enabled=false,records=[],summary=null,editing=null,generation=0,loading=false,saving=false,sessionEpoch=0,atDirty=false;
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
   <label>说明（选填，自动命名）<input name="title" maxlength="120" placeholder="可直接留空"></label>
   <label data-business-field="student">学生<select name="student_id" id="business-student"></select></label>
   <label data-business-field="opportunity">商机<select name="opportunity_id" id="business-opportunity"></select></label>
   <p id="business-task-scope-hint" class="form-hint" hidden></p>
   <label data-business-field="time"><span data-field-label="time">计划时间</span><input type="datetime-local" name="at"></label>
   <div id="business-trial-presets" hidden>
    <span class="fineprint">仅表达家长希望的试听时段并待外部确认，不会实际排课；若只改日期请点击右侧快捷时段：</span>
    <div class="trial-preset-row">
     <button type="button" class="secondary compact-btn" data-trial-time="10:00">上午 10:00</button>
     <button type="button" class="secondary compact-btn" data-trial-time="14:00">下午 14:00</button>
     <button type="button" class="secondary compact-btn" data-trial-time="16:00">下午 16:00</button>
     <button type="button" class="secondary compact-btn" data-trial-time="19:00">晚上 19:00</button>
    </div>
   </div>
   <label data-business-field="course"><span data-field-label="course">第 1 门课程 · 拟选课程</span><input name="course_label" list="business-course-choices" maxlength="120"><datalist id="business-course-choices"><option value="数学"><option value="英语"><option value="语文"><option value="物理"><option value="化学"></datalist></label>
   <label data-business-field="quantity"><span data-field-label="quantity">第 1 门课程 · 课时数</span><input name="quantity" type="number" min="1" max="10000" value="1"></label>
   <label data-business-field="amount"><span data-field-label="amount">计划金额（元，报价为拟议单价）</span><input name="amount" inputmode="decimal" placeholder="0.00"></label>
   <div data-business-field="extra"><div id="business-extra-lines"></div><button class="secondary" type="button" id="business-add-line">增加课程明细</button></div>
   <p id="business-quote-preview" class="form-hint" hidden></p>
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
 const toLocalInput=d=>new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);
 function defaultAtFor(k){
  const d=new Date();
  if(k==='tasks'||k==='trials'){d.setDate(d.getDate()+1);d.setHours(10,0,0,0);return toLocalInput(d);}
  if(k==='quotes'){d.setDate(d.getDate()+7);d.setHours(23,59,0,0);return toLocalInput(d);}
  return '';
 }
 function renumberExtraLines(){
  panel.querySelectorAll('#business-extra-lines .business-quote-line').forEach((row,idx)=>{
   const num=idx+2;
   const head=row.querySelector('.business-quote-line-head');
   if(head)head.textContent='第 '+num+' 门课程明细';
   const lc=row.querySelector('[data-field-label="course"]'),lq=row.querySelector('[data-field-label="quantity"]'),la=row.querySelector('[data-field-label="amount"]');
   if(lc)lc.textContent='第 '+num+' 门课程 · 拟选课程';
   if(lq)lq.textContent='第 '+num+' 门课程 · 课时数';
   if(la)la.textContent='第 '+num+' 门课程 · 每课时价格（元）';
  });
 }
 function updateTaskHint(){
  const hint=$('business-task-scope-hint');if(!hint)return;
  if(kind()!=='tasks'){hint.hidden=true;hint.textContent='';return;}
  const studentSelect=$('business-student'),oppSelect=$('business-opportunity');
  const sOpt=studentSelect.selectedOptions?.[0],oOpt=oppSelect.selectedOptions?.[0];
  if(!studentSelect.value&&!oppSelect.value){
   hint.textContent='当前未关联具体学生或商机，保存后将记为通用待办任务（仍可随时补充关联）。';
  }else{
   const parts=[];
   if(studentSelect.value&&sOpt)parts.push('学生「'+sOpt.textContent+'」');
   if(oppSelect.value&&oOpt)parts.push('商机「'+oOpt.textContent+'」');
   hint.textContent='本任务将关联：'+parts.join(' / ');
  }
  hint.hidden=false;
 }
 function updateQuotePreview(){
  const preview=$('business-quote-preview');if(!preview)return;
  if(kind()!=='quotes'){preview.hidden=true;preview.textContent='';return;}
  const form=$('business-form');
  const rawLines=[
   {qty:form.elements.quantity.value,amount:form.elements.amount.value},
   ...Array.from(panel.querySelectorAll('#business-extra-lines .business-quote-line')).map(row=>({
    qty:row.querySelector('[data-quote-field="quantity"]').value,
    amount:row.querySelector('[data-quote-field="amount"]').value
   }))
  ];
  try{
   let total=0;
   for(const line of rawLines){
    const q=Number(line.qty);
    if(!Number.isSafeInteger(q)||q<1||q>10000)throw Error('invalid qty');
    const unit=cents(line.amount.trim()===''?'0':line.amount.trim());
    const sub=q*unit;
    if(!Number.isSafeInteger(sub)||!Number.isSafeInteger(total+sub))throw Error('overflow');
    total+=sub;
   }
   preview.textContent='报价合计：'+yuan(total)+'（共 '+rawLines.length+' 门课程，按整数分合计，未获正式定价授权）';
   const opp=summary?.pipeline.find(o=>o.id===$('business-opportunity').value);
   if(opp?.predicted_amount_cents!=null)preview.textContent+='；此前预计 '+yuan(opp.predicted_amount_cents)+'（仅供参考）';
  }catch{
   preview.textContent='拟议总额预览：请确认每门课程的课时数（正整数）和单价（非负两位小数）';
  }
  preview.hidden=false;
 }
 function syncOpportunityOptions(autoPickSingle=false){
  const studentSelect=$('business-student'),oppSelect=$('business-opportunity');
  const sid=studentSelect.value;
  for(const opt of oppSelect.options){
   if(!opt.value){opt.hidden=false;opt.disabled=false;continue;}
   const match=!sid||opt.dataset.studentId===sid;
   opt.hidden=!match;opt.disabled=!match;
  }
  const chosen=oppSelect.selectedOptions?.[0];
  if(oppSelect.value&&(!chosen||chosen.disabled))oppSelect.value='';
  if(autoPickSingle&&sid&&!oppSelect.value){
   const matches=[...oppSelect.options].filter(o=>o.value&&!o.disabled);
   if(matches.length===1)oppSelect.value=matches[0].value;
  }
  updateTaskHint();
 }
 function fields(){
  const k=kind(),form=$('business-form');
  const shown={tasks:['student','opportunity','time'],trials:['student','opportunity','time'],
   quotes:['student','opportunity','time','course','quantity','amount','extra'],
   'order-intents':['quote'],'expense-plans':['amount','purpose'],
   'automation-rules':['inactive','due','enabled']}[k];
  panel.querySelectorAll('[data-business-field]').forEach(el=>{
   el.hidden=!shown.includes(el.dataset.businessField);
   el.querySelectorAll('input,textarea,select').forEach(input=>input.disabled=el.hidden);
  });
  const labelMap={
   time:k==='trials'?'期望试听时间（仅申请，不会直接排课）':k==='quotes'?'报价草稿有效期截止':'计划跟进截止时间',
   amount:k==='quotes'?'第 1 门课程 · 每课时价格（元）':'计划金额（元，未获财务批准）',
   course:'第 1 门课程 · 拟选课程',
   quantity:'第 1 门课程 · 课时数'
  };
  for(const [key,txt] of Object.entries(labelMap)){
   const span=form.querySelector('[data-field-label="'+key+'"]');
   if(span)span.textContent=txt;
  }
  $('business-student').required=(k==='trials'||k==='quotes');
  $('business-opportunity').required=(k==='quotes');
  form.elements.at.required=(k==='trials'||k==='quotes');
  form.elements.course_label.required=(k==='quotes');
  form.elements.quantity.required=(k==='quotes');
  form.elements.amount.required=(k==='quotes'||k==='expense-plans');
  $('business-quote').required=(k==='order-intents');
  form.elements.purpose.required=(k==='expense-plans');
  form.elements.inactive_days.required=(k==='automation-rules');
  form.elements.due_in_days.required=(k==='automation-rules');
  $('business-trial-presets').hidden=(k!=='trials');
  if(!editing&&!atDirty){
   form.elements.at.value=defaultAtFor(k);
  }
  updateTaskHint();updateQuotePreview();renumberExtraLines();
  $('business-save').textContent=editing?'保存新版本':'保存业务计划';
 }
 function reset(){editing=null;atDirty=false;$('business-extra-lines').replaceChildren();$('business-form').reset();syncOpportunityOptions(false);fields();}
 function extraLine(value={course_label:'',quantity:1,proposed_unit_cents:0}){
  const row=node('div','field-stack');row.classList.add('business-quote-line');
  row.append(node('strong','business-quote-line-head','补充课程明细'));
  const unitVal=value.amount_text!==undefined?value.amount_text:((value.proposed_unit_cents??0)/100).toFixed(2);
  for(const [field,label,type,initial] of [['course','拟选课程','text',value.course_label||''],['quantity','课时数','number',value.quantity??1],['amount','每课时价格（元）','text',unitVal]]){
   const container=node('label');
   container.append(node('span','',label));container.lastChild.dataset.fieldLabel=field;
   const input=node('input');input.type=type;input.dataset.quoteField=field;input.value=initial;input.required=true;
   if(type==='number'){input.min=1;input.max=10000;}else input.maxLength=120;
   container.append(input);row.append(container);
  }
  row.append(button('移除此课程',()=>{row.remove();renumberExtraLines();updateQuotePreview();}));
  $('business-extra-lines').append(row);
  renumberExtraLines();updateQuotePreview();
 }
 function active(){return enabled&&state.token&&!state.strict&&!state.user?.workspace_access?.enabled;}
 function clear(){
  generation++;sessionEpoch++;saving=false;records=[];summary=null;editing=null;atDirty=false;nav.hidden=true;
  for(const id of ['business-records','business-summary','business-pipeline','business-history','business-student','business-opportunity','business-quote','business-interactions'])$(id).replaceChildren();
  $('business-form').reset();$('business-status').textContent='未登录，业务计划已清空。';
  $('business-extra-lines').replaceChildren();
  $('business-kind').disabled=false;$('business-save').disabled=false;$('business-reset').disabled=false;
  $('business-quote')._quotes=[];
  $('business-trial-presets').hidden=true;$('business-task-scope-hint').hidden=true;$('business-quote-preview').hidden=true;
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
   const oppEl=$('business-opportunity'),prevOpp=oppEl.value;
   oppEl.replaceChildren(option('','不选择'));
   for(const v of summary.pipeline){
    const opt=option(v.id,v.student_name+' · '+(stageNames[v.stage]||'历史阶段'));
    opt.dataset.studentId=v.student_id;oppEl.append(opt);
   }
   if([...oppEl.options].some(o=>o.value===prevOpp))oppEl.value=prevOpp;
   syncOpportunityOptions(false);
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
  const b=row.body,rowKind=row.kind||kind();
  const studentName=row.student_id?(state.students.find(s=>s.student_id===row.student_id)?.display_name||''):'';
  return ['['+(labels[rowKind]||'计划')+']',studentName,b.title,statuses[row.state]||'待核实','第'+row.version+'版',
   b.total_cents!=null?'拟议总额 '+yuan(b.total_cents):'',b.amount_cents!=null?'计划金额 '+yuan(b.amount_cents):'',
   b.due_at?'到期 '+formatDate(b.due_at):'',b.requested_slot_at?'申请 '+formatDate(b.requested_slot_at):'',
   b.enabled===false?'已停用':rowKind==='automation-rules'?'仅本人本地任务':''].filter(Boolean).join(' · ');
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
     editing=row;atDirty=true;const form=$('business-form');form.elements.title.value=row.body.title;
     form.elements.student_id.value=row.student_id||'';syncOpportunityOptions(false);
     form.elements.opportunity_id.value=row.opportunity_id||'';
     const at=row.body.due_at||row.body.requested_slot_at||row.body.valid_until;
     if(at){const date=new Date(at);form.elements.at.value=toLocalInput(date);}
     else form.elements.at.value='';
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
   if(kind()==='quotes'&&row.state==='draft')actions.append(button('生成报名意向',async()=>{
    await window.__openBusinessAction('order-intents',row.student_id,row.opportunity_id);
    $('business-quote').value=row.id;
   }));
   card.append(actions);el.append(card);
  }
 }
 function renderPipeline(){
  const el=$('business-pipeline');el.replaceChildren();
  for(const o of summary.pipeline){
   const card=node('article','audit-item business-pipeline-card');card.append(node('strong','',o.student_name+' · '+yuan(o.predicted_amount_cents)));
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
 function snapshotDraft(){
  if(!active())return null;
  const form=$('business-form'),extraRows=Array.from(panel.querySelectorAll('#business-extra-lines .business-quote-line'));
  const hasDraft=Boolean(editing||atDirty||form.elements.title.value.trim()||form.elements.student_id.value||
   form.elements.opportunity_id.value||form.elements.course_label.value.trim()||
   form.elements.amount.value.trim()||form.elements.purpose.value.trim()||extraRows.length);
  if(!hasDraft)return null;
  return {
   kind:kind(),editing:editing?structuredClone(editing):null,atDirty,
   fields:{
    title:form.elements.title.value,student_id:form.elements.student_id.value,
    opportunity_id:form.elements.opportunity_id.value,at:form.elements.at.value,
    course_label:form.elements.course_label.value,quantity:form.elements.quantity.value,
    amount:form.elements.amount.value,quote_id:form.elements.quote_id.value,
    purpose:form.elements.purpose.value,inactive_days:form.elements.inactive_days.value,
    due_in_days:form.elements.due_in_days.value,enabled:form.elements.enabled.value
   },
   extraLines:extraRows.map(row=>({
    course_label:row.querySelector('[data-quote-field="course"]').value,
    quantity:row.querySelector('[data-quote-field="quantity"]').value,
    amount_text:row.querySelector('[data-quote-field="amount"]').value
   }))
  };
 }
 async function restoreDraft(draft){
  if(!draft||!active())return false;
  const form=$('business-form'),prevKind=kind();
  editing=draft.editing||null;atDirty=!!draft.atDirty;
  if([...$('business-kind').options].some(o=>o.value===draft.kind))$('business-kind').value=draft.kind;
  $('business-extra-lines').replaceChildren();
  fields();
  if(draft.fields.student_id&&[...form.elements.student_id.options].some(o=>o.value===draft.fields.student_id)){
   form.elements.student_id.value=draft.fields.student_id;
  }
  syncOpportunityOptions(false);
  if(draft.fields.opportunity_id&&[...form.elements.opportunity_id.options].some(o=>o.value===draft.fields.opportunity_id&&!o.disabled)){
   form.elements.opportunity_id.value=draft.fields.opportunity_id;
  }
  if(draft.fields.quote_id&&[...form.elements.quote_id.options].some(o=>o.value===draft.fields.quote_id)){
   form.elements.quote_id.value=draft.fields.quote_id;
  }
  for(const k of ['title','at','course_label','quantity','amount','purpose','inactive_days','due_in_days','enabled']){
   if(draft.fields[k]!==undefined)form.elements[k].value=draft.fields[k];
  }
  for(const line of draft.extraLines||[])extraLine(line);
  updateTaskHint();updateQuotePreview();renumberExtraLines();
  if(draft.kind!==prevKind){
   try{
    const list=await api(root+kind());
    if(active()){records=list.items;$('business-status').textContent='已读取 '+records.length+' 条'+labels[kind()]+'。';renderRecords();}
   }catch{}
  }
  return true;
 }
 $('business-form').addEventListener('submit',async event=>{
  event.preventDefault();if(saving)return;saving=true;
  const session=sessionEpoch,token=state.token;
  const submit=$('business-save');submit.disabled=true;
  $('business-kind').disabled=true;$('business-reset').disabled=true;
  try{
   const f=Object.fromEntries(new FormData(event.target));const k=kind();
   const student=state.students.find(x=>x.student_id===f.student_id);
   const autoTitle=(student?.display_name||'客户')+'的'+labels[k];
   let body={title:f.title.trim()||autoTitle};
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
   if(session!==sessionEpoch||token!==state.token)return;
   const selected=k,savedTitle=body.title;reset();$('business-kind').value=selected;await refreshBusiness();
   toast('已保存'+labels[selected]+'「'+savedTitle+'」，仍待外部确认');
  }catch(e){if(session===sessionEpoch)toast(e.message,true);}finally{if(session===sessionEpoch){saving=false;submit.disabled=false;
   $('business-kind').disabled=false;$('business-reset').disabled=false;}}
 });
 async function scan(forceRefresh=false){
  if(!active()||loading||saving)return;loading=true;
  const token=state.token,session=sessionEpoch;
  try{const result=await api(root+'automation/run',{method:'POST',body:{}});
   if(!active()||token!==state.token||session!==sessionEpoch)return;
   if(forceRefresh||result.created>0)await refreshBusiness();
   return result;}
  catch(e){if(active())toast(e.message,true);}finally{loading=false;}
 }
 nav.addEventListener('click',()=>{setView('business-workspace');$('page-title').textContent='业务计划与任务';refreshBusiness();});
 $('business-kind').addEventListener('change',()=>{editing=null;atDirty=false;$('business-extra-lines').replaceChildren();fields();refreshBusiness();});
 $('business-student').addEventListener('change',()=>syncOpportunityOptions(true));
 $('business-opportunity').addEventListener('change',()=>{
  const opt=$('business-opportunity').selectedOptions?.[0];
  if(opt?.dataset.studentId&&$('business-student').value!==opt.dataset.studentId){
   $('business-student').value=opt.dataset.studentId;syncOpportunityOptions(false);
  }else updateTaskHint();
 });
 $('business-form').elements.at.addEventListener('input',()=>{atDirty=true;});
 $('business-form').elements.at.addEventListener('change',()=>{atDirty=true;});
 $('business-form').addEventListener('input',e=>{
  if(e.target.name==='quantity'||e.target.name==='amount'||e.target.dataset?.quoteField==='quantity'||e.target.dataset?.quoteField==='amount')updateQuotePreview();
 });
 panel.querySelectorAll('[data-trial-time]').forEach(btn=>{
  btn.addEventListener('click',()=>{
   const atInput=$('business-form').elements.at;
   const cur=atInput.value&&/^\d{4}-\d{2}-\d{2}T/.test(atInput.value)?atInput.value.slice(0,10):defaultAtFor('trials').slice(0,10);
   atInput.value=cur+'T'+btn.dataset.trialTime;atDirty=true;
  });
 });
 $('business-add-line').addEventListener('click',()=>{if(panel.querySelectorAll('.business-quote-line').length<29)extraLine();});
 $('business-reset').addEventListener('click',()=>{const selected=kind();reset();$('business-kind').value=selected;fields();});
 $('business-refresh').addEventListener('click',refreshBusiness);
 $('business-scan').addEventListener('click',()=>scan(true).then(result=>{if(result&&active())toast('已生成 '+result.created+' 条本人本地任务');}));
 window.__openBusinessAction=async(k,studentId,opportunityId)=>{
  if(!active()||saving)return;
  reset();$('business-kind').value=k;setView('business-workspace');await refreshBusiness();
  $('business-student').value=studentId||'';syncOpportunityOptions(false);
  $('business-opportunity').value=opportunityId||'';fields();
  $('business-form').scrollIntoView({block:'start'});
 };
 window.__refreshBusinessWorkspace=refreshBusiness;
 window.__snapshotBusinessDraft=snapshotDraft;
 window.__restoreBusinessDraft=restoreDraft;
 window.addEventListener('isolated-session-clear',clear);
 setInterval(()=>{if(active())scan(false);},60_000);
 fetch('/api/v1/health',{cache:'no-store'}).then(r=>r.json()).then(r=>{enabled=r?.data?.isolated_workspace===true;if(active())refreshBusiness();}).catch(()=>{});
 fields();
})();

