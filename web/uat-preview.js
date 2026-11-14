// Local-only UAT preview: no browser-persisted credentials or business writes.
// All human-readable fields are rendered with textContent, never innerHTML.
const $=id=>document.getElementById(id);
const state={token:null,requests:[],requestId:null,markdown:null,history:null};
const section={sales:'销售',finance:'财务',academic:'教务',security:'信息安全'};
function status(text,error=false){
 $('status').textContent=text;
 $('status').classList.toggle('error',error);
}
async function api(path,{raw=false}={}){
 if(!state.token)throw Error('请先验证本机测试身份');
 const response=await fetch(path,{
  method:'GET',cache:'no-store',headers:{Authorization:'Bearer '+state.token}
 });
 if(!response.ok){
  let message='权限核验未通过或来源报告不存在';
  try{message=(await response.json()).message||message;}catch{}
  throw Error(message);
 }
 return raw?response.text():(await response.json()).data;
}
function clearReport(){
 state.requestId=null;state.markdown=null;state.history=null;
 $('history-panel').hidden=true;
 $('audit-events').replaceChildren();
 $('audit-current').textContent='0';
 $('audit-change').textContent='0 / 0';
 $('audit-active').textContent='0 → 0';
 $('audit-from').value='0';$('audit-to').value='0';
 $('report-panel').hidden=true;
 $('export-panel').hidden=true;
 $('task-rows').replaceChildren();
 $('markdown-preview').textContent='';
}
function disconnect(){
 state.token=null;state.requests=[];
 $('signed-token').value='';$('login-form').reset();
 $('login-card').hidden=false;$('workspace').hidden=true;
 $('login-error').textContent='';$('request-choice').replaceChildren();
 clearReport();status('本次签名测试身份已清除，未保存到浏览器存储。');
}
async function refresh(){
 const response=await api('/api/v1/uat-preview/requests');
 if(!Array.isArray(response?.items))throw Error('受限来源列表格式不正确');
 state.requests=response.items.filter(x=>x&&typeof x.request_id==='string'&&
  x.production_integration_allowed===false&&x.execution_allowed===false&&
  x.release_allowed===false);
 if(state.requests.length!==response.items.length)
  throw Error('不允许展示来源准入已放开的申请');
 $('request-choice').replaceChildren();
 for(const source of state.requests){
  const option=document.createElement('option');
  option.value=source.request_id;
  option.textContent=(source.department==='finance'?'财务':'教务 / CRM')+
    ' · '+source.request_id.slice(0,8)+' · 仍被阻断';
  $('request-choice').append(option);
 }
 $('empty-state').hidden=state.requests.length!==0;
 $('view-report').disabled=state.requests.length===0;
 clearReport();
}
function makeCell(row,value){
 const cell=document.createElement('td');
 cell.textContent=String(value);
 row.append(cell);
 return cell;
}
function renderReport(report,markdown){
 if(!report||report.status!=='blocked_real_authority_missing'||
  report.production_integration_allowed!==false||
  report.execution_allowed!==false||report.release_allowed!==false||
  !Array.isArray(report.tasks)||report.tasks.length!==12||
  typeof markdown!=='string'||!markdown.includes('禁止真实联调'))
  throw Error('无法展示未通过安全校验的待办报告');
 const body=$('task-rows');
 body.replaceChildren();
 for(const task of report.tasks){
  if(task.status!=='待真实业务证据／禁止联调')
   throw Error('来源任务不处于强制阻断状态');
  const row=document.createElement('tr');
  const first=makeCell(row,task.label);
  const code=document.createElement('small');
  code.textContent=(section[task.department]||'未核实')+
   ' · '+task.code;
  first.append(document.createElement('br'),code);
  makeCell(row,task.owner);
  makeCell(row,task.evidence);
  makeCell(row,task.test);
  makeCell(row,task.reject);
  const last=makeCell(row,task.status);
  last.className='blocked';
  body.append(row);
 }
 $('metric-total').textContent=String(report.total);
 $('metric-gaps').textContent=String(report.reportedGaps);
 $('markdown-preview').textContent=markdown;
 $('report-panel').hidden=false;
 $('export-panel').hidden=false;
 state.requestId=report.requestId;
 state.markdown=markdown;
}
async function viewReport(){
 const id=$('request-choice').value;
 if(!state.requests.some(x=>x.request_id===id))throw Error('仅可查看当前本机构已授权的来源');
 clearReport();
 // Both endpoints repeat server-side OIDC binding, DB principal and tenant checks.
 const data=await api('/api/v1/uat-preview/reports/'+id);
 const markdown=await api('/api/v1/uat-preview/reports/'+id+'/markdown',{raw:true});
 if(data.report?.requestId!==id)throw Error('报告与所选来源编号不匹配');
 renderReport(data.report,markdown);
 const history=await api('/api/v1/uat-preview/reports/'+id+'/history');
 renderHistory(history.history,{initial:true});
 status('已重新核对员工及机构权限。该报告和虚构历史仍然禁止真实联调和纠错执行。');
}
function renderHistory(history,{initial=false}={}){
 if(!history||history.requestId!==state.requestId||
  history.production_integration_allowed!==false||
  history.execution_allowed!==false||history.release_allowed!==false||
  history.status!=='仍未取得真实权威证据'||
  !Array.isArray(history.events))throw Error('无效或不受阻的证据历史不可展示');
 state.history=history;
 if(initial){
  $('audit-from').value='0';
  $('audit-to').value=String(history.current);
 }
 $('audit-from').max=String(history.current);
 $('audit-to').max=String(history.current);
 $('audit-current').textContent=String(history.current);
 $('audit-change').textContent=String(history.added)+' / '+String(history.withdrawn);
 $('audit-active').textContent=String(history.activeBefore)+' → '+String(history.activeAfter);
 const target=$('audit-events');
 target.replaceChildren();
 for(const entry of history.events){
  if(!entry.fixtureRef?.startsWith('fictional_'))
   throw Error('审计记录不是虚构来源引用');
  const tr=document.createElement('tr');
  for(const value of [entry.sequence,entry.check,entry.action,entry.fixtureRef,
   entry.parentSequence===null?'—':entry.parentSequence,
   entry.reason,entry.observedAt]){
   makeCell(tr,value);
  }
  target.append(tr);
 }
 $('audit-notice').textContent=history.events.length?
  '仅虚构引用变动；历史保留，真实来源仍未授权。':
  '所选版本内没有虚构证据变动；不能视为业务通过。';
 $('history-panel').hidden=false;
}
function chosenVersionRange(){
 const start=$('audit-from').value,end=$('audit-to').value;
 const from=Number(start),to=Number(end),current=state.history?.current;
 if(!/^(0|[1-9][0-9]{0,7})$/.test(start)||
  !/^(0|[1-9][0-9]{0,7})$/.test(end)||
  !Number.isSafeInteger(from)||!Number.isSafeInteger(to)||
  from<0||to<from||to>current)throw Error('所选版本超出本机构已记录的虚构历史');
 return {from,to};
}
$('login-form').addEventListener('submit',async event=>{
 event.preventDefault();
 const token=$('signed-token').value.trim();
 $('signed-token').value='';
 $('login-error').textContent='';
 state.token=token;
 const button=event.submitter;button.disabled=true;
 try{
  await refresh();
  $('login-card').hidden=true;$('workspace').hidden=false;
  status('已按本机数据库员工身份完成验证，只读来源清单已加载。');
 }catch(error){
  state.token=null;state.requests=[];
  $('login-error').textContent=error.message||'当前身份不能查看该工作台';
  clearReport();
 }finally{button.disabled=false;}
});
$('disconnect').addEventListener('click',disconnect);
$('refresh').addEventListener('click',async event=>{
 const control=event.currentTarget;
 control.disabled=true;
 try{await refresh();status('已重新读取当前账号有权查看的来源；原预览已清除。');}
 catch(error){clearReport();status(error.message,true);}
 finally{control.disabled=false;}
});
$('request-choice').addEventListener('change',()=>{clearReport();status('来源已切换，请重新核验并查看报告。');});
$('view-report').addEventListener('click',async event=>{
 const control=event.currentTarget;
 control.disabled=true;
 try{await viewReport();}
 catch(error){clearReport();status(error.message,true);}
 finally{control.disabled=state.requests.length===0;}
});
$('download-report').addEventListener('click',async event=>{
 const control=event.currentTarget;
 control.disabled=true;
 try{
  if(!state.requestId||!state.markdown||
   !state.requests.some(x=>x.request_id===state.requestId))
   throw Error('请先查看当前来源的只读报告');
  const current=await api(
   '/api/v1/uat-preview/reports/'+state.requestId+'/markdown',{raw:true});
  if(!current.includes('禁止真实联调'))throw Error('导出内容缺失安全阻断声明');
  const blob=new Blob([current],{type:'text/markdown;charset=utf-8'});
  const href=URL.createObjectURL(blob);
  try{
   const link=document.createElement('a');
   link.href=href;link.download='uat-blockers-'+state.requestId+'.md';
   document.body.append(link);link.click();link.remove();
  }finally{setTimeout(()=>URL.revokeObjectURL(href),1000);}
  status('已生成当前权限范围内的 Markdown 待办副本；不代表验收通过。');
 }catch(error){clearReport();status(error.message,true);}
 finally{control.disabled=false;}
});

$('compare-history').addEventListener('click',async event=>{
 const control=event.currentTarget;
 control.disabled=true;
 try{
  if(!state.requestId||!state.history)throw Error('请先查看当前来源报告');
  const {from,to}=chosenVersionRange();
  const response=await api('/api/v1/uat-preview/reports/'+state.requestId+
   '/diff/'+from+'/'+to);
  renderHistory(response.history);
  status('仅对比虚构引用版本差异，所有真实联调和补偿仍处于阻断。');
 }catch(error){state.history=null;$('history-panel').hidden=true;status(error.message,true);}
 finally{control.disabled=false;}
});
$('export-history').addEventListener('click',async event=>{
 const control=event.currentTarget;
 control.disabled=true;
 try{
  if(!state.requestId||!state.history||
   !state.requests.some(x=>x.request_id===state.requestId))
   throw Error('必须重新核对当前机构的来源报告');
  const {from,to}=chosenVersionRange();
  if(from!==state.history.from||to!==state.history.to)
   throw Error('请先点击「核对版本差异」，再导出当前选择的版本');
  const id=state.requestId;
  // Re-check signed employee, scoped DB identity and the latest
  // fictional-only revision before attempting export.
  const latest=await api('/api/v1/uat-preview/reports/'+id+'/history');
  if(latest.history?.current!==state.history.current)
   throw Error('发现较新虚构证据历史，请重新查看报告后再导出');
  const markdown=await api('/api/v1/uat-preview/reports/'+id+
   '/diff/'+from+'/'+to+'/markdown',{raw:true});
  if(!markdown.includes('禁止真实联调')||
   !markdown.includes('禁止解除学生错误关联隔离'))
   throw Error('导出内容缺失安全隔离声明');
  const blob=new Blob([markdown],{type:'text/markdown;charset=utf-8'});
  const href=URL.createObjectURL(blob);
  try{
   const link=document.createElement('a');
   link.href=href;link.download='uat-audit-'+id+'-'+from+'-'+to+'.md';
   document.body.append(link);link.click();link.remove();
  }finally{setTimeout(()=>URL.revokeObjectURL(href),1000);}
  status('已重新核对身份、机构和最新历史水位；仅导出虚构证据差异。');
 }catch(error){status(error.message,true);}
 finally{control.disabled=false;}
});
