// V3.2-04 fictional identity governance view.
// All requests and decisions are performed by server-verified staff roles.
const identityStatus=x=>({pending:'待另一主管审核',approved:'已批准',rejected:'已驳回'})[x]||'状态待核对';
function identityOption(select,items,key,label){
  const old=select.value;
  select.replaceChildren();
  for(const row of items){
    const op=document.createElement('option');
    op.value=row[key];op.textContent=label(row);select.append(op);
  }
  if([...select.options].some(o=>o.value===old))select.value=old;
}
function identityDecisionDisabled(){
  const x=state.identityRequests.find(q=>q.request_id===$('identity-review-select').value);
  const approve=$('identity-decision-form').querySelector('button[type="submit"]');
  approve.disabled=!x||x.status!=='pending'||!state.capabilities.manage_identity_requests||
    x.requested_by===state.user?.staff_id||x.target_staff_id===state.user?.staff_id;
}
function paintIdentity(){
  $('identity-total').textContent=state.identityRequests.length+' 条';
  paint('identity-list',state.identityRequests,q=>record(
    (q.action==='bind'?'外部身份绑定 · ':'外部身份撤销 · ')+q.target_staff_name,
    '发行方：'+q.issuer+' · 申请人：'+q.requested_by_name+
      (q.decided_by_name?' · 审核人：'+q.decided_by_name:''),
    identityStatus(q.status),'审'));
  identityOption($('identity-staff-select'),state.identityStaff.filter(s=>s.status==='active'
     &&s.staff_id!==state.user?.staff_id),'staff_id',s=>s.display_name);
  identityOption($('identity-binding-select'),state.identityBindings.filter(b=>
     b.staff_user_id!==state.user?.staff_id),'binding_id',
     b=>b.staff_name+' · '+b.issuer);
  identityOption($('identity-review-select'),state.identityRequests.filter(q=>
    q.status==='pending'),'request_id',q=>
      (q.action==='bind'?'绑定':'撤销')+' · '+q.target_staff_name+
      ' · 申请人：'+q.requested_by_name);
  identityDecisionDisabled();
  fillAuditSelect();
}
async function refreshIdentity(){
  const allowed=state.capabilities.manage_identity_requests===true;
  document.querySelectorAll('[data-manager-only]').forEach(el=>el.hidden=!allowed);
  if(!allowed){
    for(const k of ['identityStaff','identityRequests','identityBindings'])state[k]=[];
    return;
  }
  try {
    const data=await Promise.all([
      api('/api/v1/identity/staff'),
      api('/api/v1/identity/change-requests'),
      api('/api/v1/identity/bindings')
    ]);
    state.identityStaff=data[0].items||[];
    state.identityRequests=data[1].items||[];
    state.identityBindings=data[2].items||[];
    paintIdentity();
  }catch(err){
    toast('员工身份申请列表读取失败：'+err.message,true);
  }
}
register('identity-bind-form',async d=>{
  if(!state.capabilities.manage_identity_requests)throw Error('无权申请员工身份变更');
  await api('/api/v1/identity/change-requests',{method:'POST',body:{
    action:'bind',target_staff_id:d.target_staff_id,
    issuer:d.issuer,subject:d.subject,
    request_evidence_ref:d.request_evidence_ref,request_reason_zh:d.request_reason_zh
  }});
  return '身份绑定申请已登记，等待另一名主管独立审核';
});
register('identity-revoke-form',async d=>{
  if(!state.capabilities.manage_identity_requests)throw Error('无权申请身份撤销');
  await api('/api/v1/identity/change-requests',{method:'POST',body:{
    action:'revoke',existing_binding_id:d.existing_binding_id,
    request_evidence_ref:d.request_evidence_ref,request_reason_zh:d.request_reason_zh
  }});
  return '外部身份撤销申请已登记；审批前原身份仍然有效';
});
register('identity-decision-form',async d=>{
  const q=state.identityRequests.find(x=>x.request_id===d.request_id);
  if(!q||q.status!=='pending')throw Error('请选择未处理的身份变更申请');
  if(!state.capabilities.manage_identity_requests||
    q.requested_by===state.user?.staff_id||q.target_staff_id===state.user?.staff_id)
    throw Error('申请人或目标员工本人不得审批');
  const result=await api('/api/v1/identity/change-requests/'+encodeURIComponent(q.request_id)+'/decision',{
    method:'POST',body:{
      decision:d.decision,review_evidence_ref:d.review_evidence_ref,reason_zh:d.reason_zh
    }
  });
  return '独立审批已保存：'+identityStatus(result.status)+'。变更历史可在业务审计中查看。';
});
$('identity-review-select').addEventListener('change',identityDecisionDisabled);
