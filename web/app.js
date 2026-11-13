// Chinese-language demo UI. Data is always from the isolated API, never from
// localStorage, hardcoded students, or a direct CRM/finance connection.
const $=id=>document.getElementById(id);
const state={token:null,user:null,view:'overview',students:[],contacts:[],events:[],leads:[],opportunities:[],families:[],preferredEventId:null,preferredLeadId:null,capabilities:{}};
const viewInfo={
  overview:['业务总览','工作概览'],students:['客户管理','学生客户'],
  contacts:['客户管理','家长与联系人'],leads:['获客管理','咨询与线索'],
  opportunities:['销售管理','销售商机'],interactions:['客户沟通','跟进记录'],
  families:['客户管理','家庭关系核实'],audit:['操作历史','业务变更记录']
};
function toast(message,error=false){
  const el=$('toast');el.textContent=message;el.classList.toggle('error',error);el.hidden=false;
  clearTimeout(toast.timeout);toast.timeout=setTimeout(()=>el.hidden=true,5000);
}
function labelStatus(value) {
  return ({
    unidentified:'未识别具体学生',new:'新建',working:'跟进中',converted:'已转化',
    pending:'待核实',verified:'已核实',rejected:'已驳回',active:'有效',
    unverified:'待核实',draft:'草稿',closed:'已关闭',lost:'已失单',
    paused:'暂停',won:'已成交',open:'跟进中'
  })[value]||'待处理';
}
function formatDate(value){
  if(!value)return '未记录时间';
  const d=new Date(value);return Number.isNaN(d.getTime())?'时间待核实':
    new Intl.DateTimeFormat('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',
      hour:'2-digit',minute:'2-digit',hour12:false}).format(d);
}
function yuan(value){
  if(value==null)return '未填写';
  const n=Number(value);return Number.isSafeInteger(n)?
    new Intl.NumberFormat('zh-CN',{style:'currency',currency:'CNY'}).format(n/100):'金额待核实';
}
function cents(value){
  if(!/^(0|[1-9]\d{0,10})(\.\d{1,2})?$/.test(value))throw Error('金额请填写非负数，最多保留两位小数');
  const [whole,frac='']=value.split('.');const n=Number(whole)*100+Number((frac+'00').slice(0,2));
  if(!Number.isSafeInteger(n))throw Error('金额超出允许范围');return n;
}
function localIso(value){
  const d=new Date(value);if(!value||Number.isNaN(d.getTime()))throw Error('请填写有效的发生时间');
  return d.toISOString();
}
function setDefaultDate(){
  const d=new Date(),local=new Date(d.getTime()-d.getTimezoneOffset()*60000);
  document.querySelectorAll('input[type="datetime-local"]').forEach(el=>{
    if(!el.value)el.value=local.toISOString().slice(0,16);
  });
}
function option(value,text){
  const x=document.createElement('option');x.value=value;x.textContent=text;return x;
}
function setSelect(el,items,valueKey,labelFn,allowEmpty=false){
  if(!el)return;
  const previous=el.value;el.replaceChildren();
  if(allowEmpty)el.append(option('','不选择'));
  for(const item of items)el.append(option(item[valueKey],labelFn(item)));
  if([...el.options].some(o=>o.value===previous))el.value=previous;
}
function fillOptions(){
  const defs={
    students:[state.students,'student_id',v=>v.display_name],
    contacts:[state.contacts,'contact_id',v=>v.display_name],
    events:[state.events,'event_id',v=>(v.contact_display_name||'未知联系人')+' · '+v.event_type+' · '+formatDate(v.occurred_at)],
    leads:[state.leads,'lead_id',v=>'线索 · '+(v.contact_display_name||'未指定联系人')+' · '+labelStatus(v.lead_state)]
  };
  document.querySelectorAll('select[data-options]').forEach(el=>{
    const [items,key,label]=defs[el.dataset.options]||[[],'id',v=>String(v.id)];
    setSelect(el,items,key,label,!!el.dataset.empty);
  });
  if(state.preferredEventId){
    const select=document.querySelector('#lead-form select[name="source_event_ref"]');
    if([...select.options].some(o=>o.value===state.preferredEventId))select.value=state.preferredEventId;
    state.preferredEventId=null;
  }
  if(state.preferredLeadId){
    const select=document.querySelector('#lead-link-form select[name="lead_id"]');
    if([...select.options].some(o=>o.value===state.preferredLeadId))select.value=state.preferredLeadId;
    state.preferredLeadId=null;
  }
  setSelect($('family-review-select'),
    state.families.filter(v=>v.verification_state==='pending'), 
    'family_group_id',v=>v.display_name+'（申请人：'+(v.requested_by_name||'待核实')+'）');
  fillAuditSelect();
}
function fillAuditSelect(){
  const ty=$('audit-type').value;
  const map={
    student:[state.students,'student_id',v=>v.display_name],
    lead:[state.leads,'lead_id',v=>'咨询线索 · '+(v.contact_display_name||'未指定联系人')],
    opportunity:[state.opportunities,'opportunity_id',v=>v.student_display_name+'的销售商机'],
    family:[state.families,'family_group_id',v=>v.display_name+' · '+labelStatus(v.verification_state)]
  };
  const [arr,key,label]=map[ty];
  setSelect($('audit-object'),arr,key,label);
}
function node(tag,className,text){
  const el=document.createElement(tag);
  if(className)el.className=className;
  if(text!=null)el.textContent=String(text);
  return el;
}
function record(title,details,annotation,symbol='•'){
  const el=node('div','record'),lhs=node('div','record-left');
  const icon=node('span','record-icon',symbol),b=node('div');
  b.append(node('div','record-name',title),node('div','record-meta',details));
  lhs.append(icon,b);
  el.append(lhs,node('span','record-end',annotation));return el;
}
function paint(id,items,make){
  const parent=$(id);parent.replaceChildren();
  if(!items.length){parent.append(node('div','empty','暂无可查看的记录。可以先使用左侧表单新增虚构演示数据。'));return;}
  for(const x of items)parent.append(make(x));
}
function render(){
  $('stat-students').textContent=state.students.length;
  $('stat-contacts').textContent=state.contacts.length;
  $('stat-leads').textContent=state.leads.length;
  $('stat-opportunities').textContent=state.opportunities.length;
  for(const [id,items,label] of [
    ['students-total',state.students,'人'],['contacts-total',state.contacts,'人'],
    ['leads-total',state.leads,'条'],['opportunities-total',state.opportunities,'条'],
    ['families-total',state.families,'条']])$(id).textContent=items.length+' '+label;
  paint('students-list',state.students,x=>record(
    x.display_name,'年级：'+(x.grade_label||'未填写')+' · 负责人：'+(x.owner_display_name||'待确认'),'独立档案','学'));
  paint('contacts-list',state.contacts,x=>record(
    x.display_name,x.do_not_contact?'已标记不接受主动联系':'可联系状态未核实','共享联系人','人'));
  paint('leads-list',state.leads,x=>record(
    x.contact_display_name||'未指定联系人','创建时间：'+formatDate(x.created_at),labelStatus(x.lead_state),'询'));
  paint('opportunities-list',state.opportunities,x=>record(
    (x.student_display_name||'指定学生')+'的商机',
    '负责人：'+(x.owner_display_name||'待确认')+' · 预计金额：'+yuan(x.predicted_amount_cents),
    labelStatus(x.lifecycle_state),'商'));
  paint('families-list',state.families,x=>record(
    x.display_name,'关联学生：'+x.student_count+' 名 · 申请人：'+
      (x.requested_by_name||'原申请待查')+
      (x.verified_by_name?' · 审核人：'+x.verified_by_name:''),
    labelStatus(x.verification_state),'家'));
  const familyCanReview=state.capabilities.decide_other_person_family_review===true;
  const form=$('family-decision-form');
  form.querySelectorAll('input,textarea,select,button').forEach(el=>el.disabled=!familyCanReview);
  const familyForm=$('family-form');
  familyForm.querySelectorAll('input,select,button').forEach(el=>
    el.disabled=!(state.capabilities.propose_family_review===true));
  // The submitter is never allowed to review their own request.
  const pending=state.families.filter(v=>v.verification_state==='pending');
  const selected=pending.find(v=>v.family_group_id===$('family-review-select').value);
  if(selected&&selected.requested_by===state.user?.staff_id){
    form.querySelector('button[type="submit"]').disabled=true;
  }
  fillOptions();
}
async function api(path,{method='GET',body=null,token=state.token}={}){
  const headers={...(token?{Authorization:'Bearer '+token}:{})};
  if(body!==null){
    headers['Content-Type']='application/json';
    headers['Idempotency-Key']=crypto.randomUUID().replace(/-/g,'')+crypto.randomUUID().replace(/-/g,'');
  }
  const res=await fetch(path,{method,headers,cache:'no-store',...(body!==null?{body:JSON.stringify(body)}:{})});
  let result;try{result=await res.json();}catch{throw Error('服务器未返回可识别的业务结果');}
  if(!res.ok||result.code!=='OK'){
    if(res.status===401&&token===state.token&&state.token){logout(false);throw Error('当前登录已过期，请重新进入演示工作台');}
    throw Error(result.message||'操作未完成，请查看状态');
  }
  return result.data;
}
async function refresh(){
  const endpoints=[
    ['students','/api/v1/students'],['contacts','/api/v1/contacts'],
    ['events','/api/v1/contact-events'],['leads','/api/v1/leads'],
    ['opportunities','/api/v1/opportunities'],['families','/api/v1/family-groups']
  ];
  const results=await Promise.allSettled(endpoints.map(x=>api(x[1])));
  for(let i=0;i<endpoints.length;i++){
    const [key]=endpoints[i],r=results[i];
    state[key]=r.status==='fulfilled'?r.value.items||[]:[];
    if(r.status==='rejected'&&!((key==='families')&&!state.capabilities.review_family_audit)){
      toast('部分业务列表未能读取，请检查账号权限或数据库状态',true);
    }
  }
  render();
}
function setView(view){
  state.view=view;
  document.querySelectorAll('button[data-view]').forEach(x=>x.classList.toggle('active',x.dataset.view===view));
  document.querySelectorAll('.view').forEach(x=>x.classList.toggle('active',x.dataset.panel===view));
  const [eyebrow,title]=viewInfo[view]||viewInfo.overview;
  $('page-eyebrow').textContent=eyebrow;$('page-title').textContent=title;
  document.title=title+' · 市场与销售工作台';
  if(view==='audit')$('audit-list').replaceChildren();
}
function logout(notice=true){
  state.token=null;state.user=null;state.capabilities={};
  for(const key of ['students','contacts','events','leads','opportunities','families'])state[key]=[];
  $('workspace').hidden=true;$('login-screen').hidden=false;
  $('login-form').reset();$('audit-list').replaceChildren();
  if(notice)toast('已退出演示账号');
}
function register(id,action){
  const form=$(id);
  form.addEventListener('submit',async e=>{
    e.preventDefault();
    const submit=form.querySelector('button[type="submit"]');
    submit.disabled=true;
    try{
      const data=Object.fromEntries(new FormData(form).entries());
      const out=await action(data);
      form.reset();setDefaultDate();await refresh();
      toast(out||'操作已保存');
    }catch(err){toast(err.message||'操作未完成',true);}
    finally{submit.disabled=false;}
  });
}
register('login-form',async data=>{
  const res=await fetch('/api/v1/dev/login',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({account_code:data.account_code,passphrase:data.passphrase}),
    cache:'no-store'
  });
  const payload=await res.json();
  if(!res.ok||payload.code!=='OK')throw Error(payload.message||'演示登录失败');
  state.token=payload.data.token;
  const profile=await api('/api/v1/me');
  state.user={...payload.data,...profile};
  state.capabilities=profile.capabilities||{};
  $('staff-name').textContent=payload.data.display_name;
  $('staff-role').textContent=payload.data.role_label;
  $('avatar').textContent=payload.data.display_name.slice(0,1);
  $('login-screen').hidden=true;$('workspace').hidden=false;
  setView('overview');
  await refresh();
  return '已进入虚构数据演示工作台';
});
register('student-form',async d=>{
  await api('/api/v1/students',{method:'POST',body:{
    display_name:d.display_name,grade_label:d.grade_label||null,school_name:d.school_name||null
  }});
  return '学生档案已保存，未自动生成家庭';
});
register('contact-form',async d=>{
  await api('/api/v1/contacts',{method:'POST',body:{
    display_name:d.display_name,do_not_contact:d.do_not_contact==='on'
  }});
  return '联系人已保存，未采集电话和微信';
});
register('contact-link-form',async d=>{
  await api('/api/v1/students/'+encodeURIComponent(d.student_id)+'/contacts',{method:'POST',body:{
    contact_id:d.contact_id,relation_type:d.relation_type,verification_state:'unverified'
  }});
  return '联系人已关联至指定学生，关系状态仍待核实';
});
register('event-form',async d=>{
  const created=await api('/api/v1/contact-events',{method:'POST',body:{
    contact_id:d.contact_id,event_type:d.event_type,occurred_at:localIso(d.occurred_at)
  }});
  state.preferredEventId=created.event_id;
  return '一次真实咨询已登记，已自动选中本次咨询用于下一步创建线索';
});
register('lead-form',async d=>{
  const lead=await api('/api/v1/leads',{method:'POST',body:{source_event_ref:d.source_event_ref}});
  state.preferredLeadId=lead.lead_id;
  return '咨询已转为销售线索，已选中新线索用于关联学生';
});
register('lead-link-form',async d=>{
  await api('/api/v1/leads/'+encodeURIComponent(d.lead_id)+'/students',{method:'POST',body:{
    student_ids:[d.student_id],evidence_ref:d.evidence_ref,confirmation_state:'pending_review'
  }});
  return '线索与学生已建立待核实关联';
});
register('opportunity-form',async d=>{
  const body={student_id:d.student_id};
  if(d.predicted_yuan.trim())body.predicted_amount_cents=cents(d.predicted_yuan.trim());
  await api('/api/v1/opportunities',{method:'POST',body});
  return '已建立该学生的独立销售商机';
});
register('interaction-form',async d=>{
  if(d.other_student_id&&d.other_student_id===d.student_id)throw Error('同一学生不能在一次跟进中重复关联');
  const subjects=[{student_id:d.student_id}];
  if(d.other_student_id)subjects.push({student_id:d.other_student_id});
  await api('/api/v1/interactions',{method:'POST',body:{
    occurred_at:localIso(d.occurred_at),contact_method:d.contact_method,summary:d.summary,subjects
  }});
  return '已保存一次真实沟通，不重复计算跟进次数';
});
register('family-form',async d=>{
  if(d.student_a===d.student_b)throw Error('家庭申请必须选择两名不同学生');
  const r=await api('/api/v1/family-groups',{method:'POST',body:{
    display_name:d.display_name,student_ids:[d.student_a,d.student_b],
    verification_evidence_ref:d.verification_evidence_ref
  }});
  return r.verification_state==='pending'?'已提交家庭关系核实申请，尚未认定为已核实家庭':'申请状态待核实';
});
register('family-decision-form',async d=>{
  if(!state.capabilities.decide_other_person_family_review)
    throw Error('当前账号没有家庭关系审核权限');
  const item=state.families.find(x=>x.family_group_id===d.family_group_id);
  if(!item)throw Error('请选择待核实的家庭申请');
  if(item.requested_by===state.user.staff_id)throw Error('申请人不能审批自己的家庭关系申请');
  const result=await api('/api/v1/family-groups/'+encodeURIComponent(d.family_group_id)+'/decision',{
    method:'POST',body:{
      decision:d.decision,review_evidence_ref:d.review_evidence_ref,reason_zh:d.reason_zh
    }
  });
  return '独立审核已保存：'+labelStatus(result.verification_state)+'；审核记录可在业务变更记录中查看';
});
register('audit-form',async d=>{
  const r=await api('/api/v1/audit?object_type='+encodeURIComponent(d.object_type)+
    '&object_id='+encodeURIComponent(d.object_id));
  const el=$('audit-list');el.replaceChildren();
  if(!r.items?.length){el.append(node('div','empty','当前业务对象还没有可查看的变更记录'));return '记录读取完成';}
  for(const x of r.items){
    const item=node('div','audit-item');
    item.append(node('strong','',x.summary_zh||'业务状态发生变化'),node('span','when',formatDate(x.happened_at)));
    if(x.before_business_summary_zh)item.append(node('span','audit-value','变更前：'+x.before_business_summary_zh));
    if(x.after_business_summary_zh)item.append(node('span','audit-value','变更后：'+x.after_business_summary_zh));
    el.append(item);
  }
  return '已展示当前业务对象的变更历史';
});
document.querySelectorAll('button[data-view]').forEach(x=>x.addEventListener('click',()=>setView(x.dataset.view)));
$('family-review-select').addEventListener('change',()=>{
  const chosen=state.families.find(x=>x.family_group_id===$('family-review-select').value);
  $('family-decision-form').querySelector('button[type="submit"]').disabled=
    !state.capabilities.decide_other_person_family_review||
    !chosen||chosen.verification_state!=='pending'||chosen.requested_by===state.user?.staff_id;
});
$('audit-type').addEventListener('change',fillAuditSelect);
$('refresh-button').addEventListener('click',()=>refresh().then(()=>toast('当前权限范围内的数据已刷新')).catch(e=>toast(e.message,true)));
$('logout-button').addEventListener('click',()=>logout());
setDefaultDate();
