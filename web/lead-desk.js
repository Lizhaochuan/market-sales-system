// Daily work stays on one lead; no browser persistence or external side effects.
(()=>{
 const root='/api/v1/isolated-workspace/leads',nav=document.querySelector('nav[aria-label="模块导航"]');
 const oldNav=[...nav.children],box=node('div');box.hidden=true;nav.prepend(box);
 const panel=node('section','view');panel.dataset.panel='lead-desk';panel.id='lead-desk';document.querySelector('main.main').append(panel);
 let group='sales',items=[],staff=[],selected=null,detail=null,epoch=0,seq=0,busy=false,enabled=false;
 let editingQuote=null;
 let legacy=new URLSearchParams(location.search).get('workspace')==='legacy',loginToken=null;
 const sources=['市场活动','网络咨询','到店','转介绍','主动咨询','其他'];
 function button(label,run,parent,cls='secondary'){const b=node('button',cls,label);b.type='button';b.addEventListener('click',run);parent.append(b);return b;}
 function field(parent,label,name,type='text',value=''){const l=node('label','',label),i=node('input');i.name=name;i.type=type;i.value=value;l.append(i);parent.append(l);return i;}
 function select(parent,label,name,values,value){const l=node('label','',label),s=node('select');s.name=name;for(const v of values)s.append(option(typeof v==='string'?v:v.id,typeof v==='string'?v:v.display_name));if(value)s.value=value;l.append(s);parent.append(l);return s;}
 function form(parent,title,submitLabel,save){const d=node('details','panel'),head=node('summary','',title),f=node('form','field-stack');d.append(head,f);parent.append(d);f.addEventListener('submit',e=>{e.preventDefault();mutate(()=>save(f));});const submit=node('button','primary',submitLabel);submit.type='submit';return {f,d,submit};}
 function local(d){return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);}
 function tomorrow(){const d=new Date();d.setDate(d.getDate()+1);d.setHours(10,0,0,0);return local(d);}
 const status=l=>Number(l.won_count)>0?'Closed Won':l.lost||['closed','invalid'].includes(l.lead_state)?'Closed Lost':'Following';
 function show(){setView('lead-desk');$('page-title').textContent=group==='market'?'市场 Leads':group==='deals'?'成交记录':'销售 Leads';$('page-eyebrow').textContent='接单 → 跟进 → 试听 → 成交';render();}
 for(const [key,label,section] of [['market','市场 Leads','市场'],['sales','销售 Leads','销售'],['deals','成交记录','成交与 CRM']]){
  box.append(node('div','sidebar-group-title',section));button(label,()=>{group=key;selected=null;detail=null;show();},box,'nav-item');
 }
 const legacyButton=button('历史与管理',()=>{legacy=!legacy;layout();if(legacy)setView('overview');else show();},box,'text-button');
 function layout(){
  $('student-access-entry').hidden=!legacy;
  const accessHint=$('student-access-note')?.nextElementSibling;if(accessHint?.classList.contains('fineprint'))accessHint.hidden=!legacy;
  if(!legacy)$('student-access-note').hidden=true;
  for(const n of oldNav)n.hidden=!legacy||(n.dataset.managerOnly!==undefined&&!state.capabilities.manage_identity_requests&&n.dataset.view==='identity');legacyButton.textContent=legacy?'返回简洁工作台':'历史与管理';}
 function note(msg){$('lead-message').textContent=msg;}
 async function mutate(run,preserve=false){if(busy)return;const draft=preserve?window.__snapshotLeadDraft?.():null;busy=true;const ticket=epoch,token=state.token;panel.querySelectorAll('button').forEach(b=>b.disabled=true);try{await run();if(ticket!==epoch||token!==state.token)return;await refresh();if(ticket!==epoch||token!==state.token)return;if(draft)await window.__restoreLeadDraft(draft);note('已保存');}catch(e){if(ticket===epoch&&token===state.token){note(e.message||'保存失败，请重试');panel.querySelectorAll('button').forEach(b=>b.disabled=false);}}finally{if(ticket===epoch)busy=false;}}
 async function refresh(){if(!enabled||!state.token||state.strict)return;const token=state.token,ticket=++seq;
  try{const data=await api(root);if(token!==state.token||ticket!==seq)return;items=data.items;staff=data.staff;box.hidden=false;layout();
   if(selected){const d=await api(root+'/'+selected);if(token!==state.token||ticket!==seq)return;detail=d;}
   if(loginToken!==token){loginToken=token;if(!legacy)show();}else if(state.view==='lead-desk')render();
  }catch(e){if(token!==state.token||ticket!==seq)return;items=[];detail=null;panel.replaceChildren(node('p','','读取失败，请点击刷新数据重试。'));}
 }
 async function open(id){const token=state.token,ticket=++seq;selected=id;detail=null;render();try{const d=await api(root+'/'+id);if(token!==state.token||ticket!==seq)return;detail=d;render();}catch(e){if(token===state.token&&ticket===seq)note(e.message);}}
 function render(){panel.replaceChildren();const msg=node('p','','');msg.id='lead-message';msg.setAttribute('role','status');panel.append(msg);
  if(selected){renderDetail();return;}
  if(group!=='deals'){
   const {f,submit}=form(panel,group==='market'?'录入市场 Lead':'接单 / 新建 Lead','保存 Lead',async f=>{
    const b=Object.fromEntries(new FormData(f));b.origin_group=group;const token=state.token,ticket=epoch;const saved=await api(root,{method:'POST',body:b});if(token===state.token&&ticket===epoch)selected=saved.lead_id;
   });f.id='lead-intake-form';field(f,'联系人姓名','contact_name').required=true;field(f,'学生姓名（选填）','student_name');select(f,'来源','source',sources,group==='market'?'市场活动':'到店');
   if(staff.length)select(f,'分配给','owner_user_id',staff,state.user.staff_id);field(f,'备注（选填）','notes').maxLength=1000;f.append(submit);
  }
  const list=node('div','panel');list.id='lead-list';panel.append(list);
  const search=field(list,'查找客户','lead_search','search');const filter=select(list,'状态','status_filter',['全部','Following','Closed Won','Closed Lost'],'全部');const rows=node('div');list.append(rows);
  function draw(){rows.replaceChildren();const visible=items.filter(l=>(group!=='market'||l.origin?.origin_group==='market')&&(group!=='deals'||Number(l.won_count)>0)&&(!search.value||(l.contact_name||'').includes(search.value))&&(filter.value==='全部'||status(l)===filter.value));
   if(!visible.length)rows.append(node('p','','暂无记录'));
   for(const l of visible){const card=node('article','lead-row');card.append(node('strong','',l.contact_name||'未命名联系人'),node('p','',`${status(l)} · ${l.source?.source||l.original_source||'来源待确认'} · ${l.owner_name||'未分配'}`));if(Number(l.won_count)>0)card.append(node('p','form-hint','成交金额：'+yuan(l.won_amount_cents)));if(l.followup?.next_at)card.append(node('p','form-hint','下次跟进：'+new Date(l.followup.next_at).toLocaleString()));button('打开客户',()=>open(l.id),card);rows.append(card);}
  }search.addEventListener('input',draw);filter.addEventListener('change',draw);draw();
  if(group==='deals')panel.append(node('p','form-hint','只有财务确认的成交才进入 Closed Won；当前未连接真实 CRM，未同步的记录不会显示为已同步。'));
 }
 function studentFields(f){if(detail.students.length===0)field(f,'学生姓名','student_name').required=true;else if(detail.students.length>1)select(f,'本次学生','student_id',detail.students);}
 function renderDetail(){const l=items.find(i=>i.id===selected);if(!l){selected=null;return render();}button('返回 Leads',()=>{selected=null;detail=null;render();},panel);panel.append(node('h2','',l.contact_name||'客户'),node('p','',status(l)+' · 负责人：'+(l.owner_name||'未分配')));
  if(!detail){panel.append(node('p','','正在读取…'));return;}
  if(l.original_notes)panel.append(node('p','form-hint','原始备注：'+l.original_notes));
  panel.append(node('p','fineprint','最初来源：'+(l.origin?.source||l.original_source||'待确认')));
  const closed=status(l)!=='Following'||l.lead_state==='converted';
  if(!closed){
   const source=select(panel,'当前来源','current_source',sources,l.source?.source||l.original_source);source.addEventListener('change',()=>mutate(()=>api(root+'/'+selected+'/source',{method:'POST',body:{source:source.value}}),true));
   const {f,d,submit}=form(panel,'记跟进','保存跟进',f=>{const b=Object.fromEntries(new FormData(f));if(b.next_at)b.next_at=localIso(b.next_at);return api(root+'/'+selected+'/followup',{method:'POST',body:b});});d.open=true;f.id='lead-followup-form';select(f,'本次结果','result',['已联系','未接通','待回复','试听后回访','准备报名','其他']);field(f,'补充说明（选填）','notes').maxLength=1000;
   const next=field(f,'下次跟进（选填）','next_at','datetime-local');const presets=node('div','trial-preset-row');for(const [label,days]of [['明天',1],['三天后',3],['一周后',7]])button(label,()=>{const d=new Date();d.setDate(d.getDate()+days);d.setHours(10,0,0,0);next.value=local(d);},presets);f.append(presets,submit);
   const trial=form(panel,'约试听','保存试听申请',f=>{const b=Object.fromEntries(new FormData(f));b.requested_slot_at=localIso(b.requested_slot_at);return api(root+'/'+selected+'/trial',{method:'POST',body:b});});trial.f.id='lead-trial-form';studentFields(trial.f);const at=field(trial.f,'希望试听时间','requested_slot_at','datetime-local',tomorrow());at.required=true;
   const times=node('div','trial-preset-row');for(const t of ['10:00','14:00','16:00','19:00'])button(t,()=>{at.value=(at.value||tomorrow()).slice(0,11)+t;},times);trial.f.append(times,node('p','fineprint','提交后待排课确认。'),trial.submit);
   courseForm();
   const lost=form(panel,'结束跟进 / Closed Lost','确认流失',f=>api(root+'/'+selected+'/lost',{method:'POST',body:Object.fromEntries(new FormData(f))}));select(lost.f,'流失原因','reason',['暂无需求','价格原因','时间不合适','无法联系','选择其他机构','其他']);lost.f.append(lost.submit);
  }
  const records=node('div','panel');records.id='lead-records';records.append(node('h3','','试听与课程方案'));panel.append(records);
  for(const r of detail.records){const a=node('article','lead-row');let line=r.kind==='trials'?'试听已申请 · 待排课确认 · '+new Date(r.body.requested_slot_at).toLocaleString():r.kind==='quotes'?'课程方案 · 第'+r.version+'版 · '+yuan(r.body.total_cents):r.kind==='order-intents'?'报名已确认意向（课程方案第'+r.body.quote_version+'版） · '+yuan(r.body.amount_cents)+' · 待收款确认 / CRM 未连接':r.body.title;a.append(node('p','',(r.state==='cancelled'?'已取消 · ':'')+line));
   if(r.kind==='quotes'){for(const i of r.body.items)a.append(node('p','fineprint',`${i.course_label}：${i.quantity} 课时 × ${yuan(i.proposed_unit_cents)} = ${yuan(i.line_cents)}`));
    if(!closed&&r.state==='draft'){button('修改课程方案',()=>courseForm(r,true),a);const hasIntent=detail.records.some(i=>i.kind==='order-intents'&&i.state==='draft'&&i.body.quote_id===r.id&&i.body.quote_version===r.version);if(!hasIntent)button('确认报名意向',()=>mutate(()=>api(root+'/'+selected+'/deal',{method:'POST',body:{quote_id:r.id,quote_version:r.version}})),a);}
    button('查看方案历史',async()=>{const token=state.token,id=selected;try{const h=await api('/api/v1/isolated-workspace/quotes/'+r.id+'/history');if(token!==state.token||id!==selected)return;const out=node('div');for(const v of h.items)out.append(node('p','','第'+v.version+'版 · '+yuan(v.body.total_cents)));a.append(out);}catch(e){note(e.message);}},a);
   }records.append(a);
  }
  const timeline=node('div','panel');timeline.id='lead-timeline';timeline.append(node('h3','','跟进记录'));for(const e of detail.events){const b=e.after_business_json;if(e.event_name==='LEAD_DESK_FOLLOWUP')timeline.append(node('p','',`${new Date(e.happened_at).toLocaleString()} · ${b.result}${b.notes?' · '+b.notes:''}${b.next_at?' · 下次 '+new Date(b.next_at).toLocaleString():''}`));if(e.event_name==='LEAD_DESK_LOST')timeline.append(node('p','','Closed Lost · '+b.reason));}panel.append(timeline);
 }
 function courseForm(record,focus=false){editingQuote=record?.id||null;$('lead-course-box')?.remove();const c=form(panel,record?'修改课程方案':'课程与成交','保存课程方案',async f=>{
   const items=[...f.querySelectorAll('.lead-course-line')].map(row=>({course_label:row.querySelector('[name="course"]').value,quantity:Number(row.querySelector('[name="lessons"]').value),proposed_unit_cents:cents(row.querySelector('[name="price"]').value)}));
   const b={items};const student=f.querySelector('[name="student_name"], [name="student_id"]');if(student)b[student.name]=student.value;
   if(record){b.quote_id=record.id;b.expected_version=record.version;}await api(root+'/'+selected+'/'+(record?'revise-quote':'quote'),{method:'POST',body:b});
  });c.d.id='lead-course-box';c.f.id='lead-course-form';if(!record)studentFields(c.f);const rows=node('div');c.f.append(rows);const total=node('p','form-hint');total.id='lead-course-total';
  function preview(){try{let sum=0;for(const row of rows.children)sum+=Number(row.querySelector('[name="lessons"]').value)*cents(row.querySelector('[name="price"]').value);total.textContent='合计：'+yuan(sum);}catch{total.textContent='请填写有效的课时数和每课时价格';}}
  function line(item={course_label:'数学',quantity:1,proposed_unit_cents:0}){const row=node('div','lead-course-line');select(row,'课程','course',['数学','英语','语文','物理','化学','生物','其他',...(!['数学','英语','语文','物理','化学','生物','其他'].includes(item.course_label)?[item.course_label]:[])],item.course_label);const qty=field(row,'课时数','lessons','number',item.quantity);qty.min='1';qty.max='10000';qty.required=true;const price=field(row,'每课时价格（元）','price','text',(item.proposed_unit_cents/100).toFixed(2));price.inputMode='decimal';price.required=true;button('移除',()=>{if(rows.children.length>1){row.remove();preview();}},row);row.addEventListener('input',preview);rows.append(row);preview();}
  for(const item of record?.body.items||[undefined])line(item);button('添加课程',()=>{if(rows.children.length<30)line();},c.f);c.f.append(total,c.submit);if(focus){c.d.open=true;c.d.scrollIntoView({block:'center'});}
 }
 window.__snapshotLeadDraft=()=>{
  if(state.view!=='lead-desk')return null;
  const forms=[...panel.querySelectorAll('form')].map(f=>({id:f.id,open:f.closest('details')?.open,fields:[...f.querySelectorAll('input,select')].map(i=>({name:i.name,value:i.value}))}));
  return {selected,group,editingQuote,forms};
 };
 window.__restoreLeadDraft=async draft=>{
  if(!enabled||state.strict||!draft)return false;
  const token=state.token,ticket=epoch;
  group=draft.group;selected=draft.selected;
  if(selected&&!items.some(l=>l.id===selected))return false;
  if(selected){const d=await api(root+'/'+selected);if(token!==state.token||ticket!==epoch)return false;detail=d;}
  if(token!==state.token||ticket!==epoch)return false;
  show();if(draft.editingQuote){const q=detail?.records.find(r=>r.id===draft.editingQuote);if(q)courseForm(q);}
  for(const saved of draft.forms){const f=$(saved.id);if(!f)continue;
   if(saved.id==='lead-course-form'){
    const needed=saved.fields.filter(i=>i.name==='course').length;
    while(f.querySelectorAll('.lead-course-line').length<needed)[...f.querySelectorAll('button')].find(b=>b.textContent==='添加课程').click();
   }
   const used={};for(const v of saved.fields){const inputs=f.querySelectorAll('[name="'+v.name+'"]'),i=inputs[used[v.name]||0];used[v.name]=(used[v.name]||0)+1;if(i)i.value=v.value;}
   if(f.closest('details'))f.closest('details').open=saved.open;f.dispatchEvent(new Event('input',{bubbles:true}));
  }
  $('lead-course-form')?.querySelector('input')?.dispatchEvent(new Event('input',{bubbles:true}));
  note('已恢复未保存内容');return true;
 };
 const prior=window.__refreshBusinessWorkspace;window.__refreshBusinessWorkspace=async()=>{if(prior)await prior();await refresh();};
 window.addEventListener('isolated-session-clear',()=>{epoch++;seq++;busy=false;items=[];staff=[];detail=null;selected=null;loginToken=null;box.hidden=true;panel.replaceChildren();$('student-access-entry').hidden=false;const hint=$('student-access-note')?.nextElementSibling;if(hint?.classList.contains('fineprint'))hint.hidden=false;});
 fetch('/api/v1/health',{cache:'no-store'}).then(r=>r.json()).then(r=>{enabled=r?.data?.isolated_workspace===true;if(enabled&&state.token&&!state.strict)refresh();}).catch(()=>{});
})();
