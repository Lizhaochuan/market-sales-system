// Student access operator console. TEST ONLY, JWT lives in JS memory.
// Never persist credentials to cookies, localStorage, URL, logs or HTML.
const $=id=>document.getElementById(id);
const state={token:null,students:[],staff:[],requests:[],grants:[]};
const randomKey=()=>crypto.randomUUID().replaceAll('-','');
function element(tag,className,content){
  const n=document.createElement(tag);
  if(className)n.className=className;
  if(content!==undefined)n.textContent=String(content);
  return n;
}
function dateZh(value){
  if(!value)return '无需到期';
  const d=new Date(value);
  return Number.isFinite(d.getTime())?
    new Intl.DateTimeFormat('zh-CN',{
      year:'numeric',month:'2-digit',day:'2-digit',
      hour:'2-digit',minute:'2-digit',hour12:false
    }).format(d):'时间待核实';
}
function status(message,isError=false){
  const n=$('status');
  n.textContent=message;
  n.className='status '+(isError?'error':'ok');
}
async function api(path,{method='GET',body,token=state.token,key}={}){
  const response=await fetch(path,{
    method,
    headers:{
      ...(token?{Authorization:'Bearer '+token}:{}),
      ...(body!==undefined?{'Content-Type':'application/json',
        'Idempotency-Key':key||randomKey()}:{})
    },
    ...(body!==undefined?{body:JSON.stringify(body)}:{})
  });
  let result;
  try{result=await response.json();}catch{throw Error('隔离服务暂时无法返回可读结果');}
  if(!response.ok)throw Error(result.message||'当前员工没有执行该操作的权限');
  return result.data;
}
function fillSelect(id,items,valueKey,label){
  const select=$(id),old=select.value;
  select.replaceChildren();
  if(!items.length){
    const placeholder=element('option','', '暂无可选业务记录');
    placeholder.value='';select.append(placeholder);select.disabled=true;return;
  }
  select.disabled=false;
  for(const item of items){
    const option=element('option','',label(item));
    option.value=item[valueKey];select.append(option);
  }
  if(items.some(v=>v[valueKey]===old))select.value=old;
}
function showRecords(id,items,labelFn,infoFn,statusFn){
  const container=$(id);container.replaceChildren();
  if(!items.length){
    container.append(element('p','note','当前没有可查看的记录。'));
    return;
  }
  for(const value of items){
    const item=element('div','item'),left=element('div');
    left.append(element('strong','',labelFn(value)),
      element('p','',infoFn(value)));
    item.append(left,element('span','tag',statusFn(value)));
    container.append(item);
  }
}
function render(){
  fillSelect('student-choice',state.students,'student_id',s=>s.student_name);
  fillSelect('staff-choice',state.staff,'staff_id',s=>s.staff_name);
  const pending=state.requests.filter(x=>x.status_zh==='待独立审批');
  fillSelect('review-choice',pending,'request_id',x=>
    x.action_zh+' · '+x.student_name+' → '+x.target_name);
  const valid=state.grants.filter(x=>x.status_zh==='有效');
  fillSelect('revoke-choice',valid,'grant_id',x=>
    x.student_name+' · 接收人：'+x.grantee_name);
  showRecords('requests-list',state.requests,
    x=>x.action_zh+' · '+x.student_name,
    x=>'接收员工：'+x.target_name+
      (x.expires_at?' · 到期：'+dateZh(x.expires_at):'')+
      ' · 申请时间：'+dateZh(x.created_at),x=>x.status_zh);
  showRecords('grants-list',state.grants,
    x=>x.student_name+' · 共享给 '+x.grantee_name,
    x=>'到期时间：'+dateZh(x.expires_at),x=>x.status_zh);
  const isTransfer=$('action-type').value==='transfer';
  $('duration-label').hidden=isTransfer;
  $('duration').disabled=isTransfer;
}
async function refresh(){
  const [students,staff,requests,grants]=await Promise.all([
    api('/api/v1/student-access/students'),
    api('/api/v1/student-access/staff'),
    api('/api/v1/student-access/requests'),
    api('/api/v1/student-access/grants')
  ]);
  state.students=students.items;
  state.staff=staff.items;
  state.requests=requests.items;
  state.grants=grants.items;
  render();
}
function disconnect(){
  state.token=null;
  state.students=[];state.staff=[];state.requests=[];state.grants=[];
  $('signed-token').value='';
  $('connect-panel').hidden=false;
  $('workspace').hidden=true;
  $('connect-error').textContent='';
  $('status').textContent='';
}
async function runForm(form,build,success){
  const submit=form.querySelector('button[type="submit"]');
  submit.disabled=true;
  try{
    const d=Object.fromEntries(new FormData(form).entries());
    await build(d);
    form.reset();
    await refresh();
    status(success);
  }catch(err){
    status(err.message||'操作未能完成',true);
  }finally{submit.disabled=false;}
}
$('connect-form').addEventListener('submit',async e=>{
  e.preventDefault();
  const token=$('signed-token').value.trim();
  $('signed-token').value='';
  $('connect-error').textContent='';
  state.token=token;
  try{
    await refresh();
    $('connect-panel').hidden=true;
    $('workspace').hidden=false;
    status('当前员工身份已验证。只会显示其有权操作的学生。');
  }catch(err){
    state.token=null;
    $('connect-error').textContent=err.message||'员工身份验证失败';
  }
});
$('disconnect').addEventListener('click',disconnect);
$('refresh').addEventListener('click',()=>refresh()
  .then(()=>status('已重新核对当前员工权限和审核状态'))
  .catch(e=>status(e.message,true)));
$('action-type').addEventListener('change',render);
document.querySelectorAll('.tabs button').forEach(button=>{
  button.addEventListener('click',()=>{
    document.querySelectorAll('.tabs button').forEach(b=>
      b.removeAttribute('aria-current'));
    button.setAttribute('aria-current','page');
    document.querySelectorAll('[data-panel]').forEach(panel=>
      panel.hidden=panel.dataset.panel!==button.dataset.tab);
    status('');
  });
});
$('request-form').addEventListener('submit',e=>{
  e.preventDefault();
  runForm(e.currentTarget,async d=>{
    const action=d.action;
    const request={
      action,student_id:d.student_id,target_staff_id:d.target_staff_id,
      reason_zh:d.reason_zh.trim(),evidence_ref:d.evidence_ref.trim()
    };
    if(action==='share'){
      const days=Number(d.duration);
      if(![1,7,30].includes(days))throw Error('共享到期时长不正确');
      request.expires_at=new Date(Date.now()+days*86400000-120000).toISOString();
    }
    await api('/api/v1/student-access/requests',{method:'POST',body:request});
  },'学生变更申请已提交，尚未生效。需要另一位有效主管独立批准。');
});
$('decision-form').addEventListener('submit',e=>{
  e.preventDefault();
  runForm(e.currentTarget,async d=>{
    await api('/api/v1/student-access/requests/'+encodeURIComponent(d.request_id)+'/decision',{
      method:'POST',body:{
        decision:d.decision,reason_zh:d.reason_zh.trim(),
        evidence_ref:d.evidence_ref.trim()
      }
    });
  },'独立审批结果已保存。请核对最新授权或负责人状态。');
});
$('revoke-form').addEventListener('submit',e=>{
  e.preventDefault();
  runForm(e.currentTarget,async d=>{
    await api('/api/v1/student-access/grants/'+encodeURIComponent(d.grant_id)+'/revoke',{
      method:'POST',body:{reason_zh:d.reason_zh.trim()}
    });
  },'指定学生查看共享已撤销，后续读取立即受到限制。');
});
