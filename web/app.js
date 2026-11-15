// Chinese-language demo UI. Data is always from the isolated API, never from
// localStorage, hardcoded students, or a direct CRM/finance connection.
const $=id=>document.getElementById(id);
const state={token:null,user:null,strict:false,view:'overview',channels:[],channelCatalog:null,channelLoadError:false,channelRequests:[],channelRequestLoadError:false,channelAuditHistory:[],channelAuditLoadError:false,campaignDrafts:[],campaignLoadError:false,campaignSalesReviews:[],campaignSalesLoadError:false,campaignFinanceHandoffs:[],campaignFinanceLoadError:false,campaignFinanceIncidents:[],campaignIncidentLoadError:false,campaignIncidentHistory:[],campaignIncidentHistoryLoadError:false,campaignEscalationFollowups:[],campaignEscalationLoadError:false,campaignEscalationEvidence:[],campaignEvidenceLoadError:false,campaignAcceptancePrerequisites:[],campaignAcceptanceLoadError:false,campaignTrustFailureGates:[],campaignTrustFailureLoadError:false,campaignCompensationMatrix:[],campaignCompensationLoadError:false,campaignCompensationChecklist:[],campaignChecklistLoadError:false,campaignPacketFreezeGates:[],campaignPacketFreezeLoadError:false,students:[],contacts:[],events:[],leads:[],opportunities:[],families:[],identityStaff:[],identityRequests:[],identityBindings:[],custodyRequests:[],custodyStaff:[],custodyActive:[],custodyReviews:[],relatedStudents:[],candidateConsultations:[],leadCandidates:[],readinessReviews:[],attributionDisputes:[],disputableCandidates:[],finalLeadConversions:[],leadStudentRequests:[],leadAdjustmentRequests:[],leadCorrectionNotes:[],studentLinkReviews:[],currentStudentLinks:[],downstreamCorrectionCases:[],downstreamCorrectionEligible:[],downstreamReconciliations:[],preferredEventId:null,preferredLeadId:null,capabilities:{},sessionExpiresAt:null,sessionLifetimeMs:0,countdownTimer:null,sessionWarn5m:false,sessionWarn1m:false,expiredDraft:null};
const viewInfo={
  overview:['业务总览','工作概览'],channels:['获客管理','获客渠道'],campaigns:['获客管理','市场活动'],students:['客户管理','学生客户'],
  contacts:['客户管理','家长与联系人'],leads:['获客管理','咨询与线索'],
  opportunities:['销售管理','销售商机'],interactions:['客户沟通','跟进记录'],
  families:['客户管理','家庭关系核实'],audit:['操作历史','业务变更记录'],identity:['访问安全','员工身份审批'],
  'business-workspace':['业务计划','业务计划与任务']
};
function toast(message,error=false){
  const el=$('toast');el.textContent=message;el.classList.toggle('error',error);el.hidden=false;
  clearTimeout(toast.timeout);toast.timeout=setTimeout(()=>el.hidden=true,5000);
}
function labelStatus(value) {
  return ({
    unidentified:'未识别具体学生',new:'新建',working:'跟进中',converted:'已转化',
    pending:'待核实',approved:'已批准',verified:'已核实',rejected:'已驳回',active:'有效',
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
  if(!state.token)return;
  const d=new Date(),local=new Date(d.getTime()-d.getTimezoneOffset()*60000);
  document.querySelectorAll('#workspace input[type="datetime-local"]').forEach(el=>{
    if(el.closest('#business-form')||el.closest('#campaign-workbench'))return;
    if(!el.value)el.value=local.toISOString().slice(0,16);
  });
}
function parseTokenExp(token){
  if(typeof token!=='string')return null;
  const parts=token.split('.');
  if(parts.length<2)return null;
  try{
    const b64=parts[1].replace(/-/g,'+').replace(/_/g,'/');
    const pad=b64+'==='.slice((b64.length+3)%4);
    const bytes=Uint8Array.from(atob(pad),c=>c.charCodeAt(0));
    const json=JSON.parse(new TextDecoder().decode(bytes));
    return Number.isFinite(json?.exp)?json.exp*1000:null;
  }catch{return null;}
}
function stopSessionCountdown(){
  clearInterval(state.countdownTimer);state.countdownTimer=null;
  state.sessionExpiresAt=null;state.sessionLifetimeMs=0;
  state.sessionWarn5m=false;state.sessionWarn1m=false;
  const pill=$('session-countdown');
  if(pill){pill.hidden=true;pill.classList.remove('warning');pill.textContent='会话剩余 30:00';}
}
function updateSessionCountdown(){
  const pill=$('session-countdown');
  if(!state.token||!state.sessionExpiresAt){stopSessionCountdown();return;}
  const remainingMs=Math.max(0,state.sessionExpiresAt-Date.now());
  const secs=Math.ceil(remainingMs/1000);
  if(pill){
    pill.hidden=false;
    pill.classList.toggle('warning',secs<=300);
    if(secs<=0){
      pill.textContent='会话已过期，请重新登录';
    }else{
      const mm=String(Math.floor(secs/60)).padStart(2,'0');
      const ss=String(secs%60).padStart(2,'0');
      pill.textContent='会话剩余 '+mm+':'+ss;
    }
  }
  if(state.sessionLifetimeMs>360_000&&!state.sessionWarn5m&&remainingMs<=300_000&&remainingMs>60_000){
    state.sessionWarn5m=true;
    toast('演示登录将在 5 分钟内过期，请注意先保存当前草稿');
  }else if(state.sessionLifetimeMs>120_000&&!state.sessionWarn1m&&remainingMs<=60_000&&remainingMs>0){
    state.sessionWarn1m=true;
    toast('演示登录即将于 1 分钟内过期，请尽快保存表单',true);
  }
}
function startSessionCountdown(expiresAt){
  stopSessionCountdown();
  if(!Number.isFinite(expiresAt))return;
  state.sessionExpiresAt=expiresAt;
  state.sessionLifetimeMs=Math.max(0,expiresAt-Date.now());
  updateSessionCountdown();
  state.countdownTimer=setInterval(updateSessionCountdown,1000);
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
function syncLeadLinkCandidate(autoSelect=false){
  const form=$('lead-link-form');if(!form)return;
  const leadSelect=form.elements.lead_id,studentSelect=form.elements.student_id,hint=$('lead-link-candidate-hint');
  const lead=state.leads.find(x=>x.lead_id===leadSelect.value);
  if(!lead||!hint){if(hint){hint.hidden=true;hint.textContent='';}return;}
  const linked=lead.linked_students||[];
  const linkedIds=new Set(linked.map(s=>s.student_id));
  const candidates=(lead.contact_linked_students||[]).filter(s=>!linkedIds.has(s.student_id));
  if(candidates.length===1){
    const only=candidates[0];
    if(autoSelect&&[...studentSelect.options].some(o=>o.value===only.student_id)){
      studentSelect.value=only.student_id;
    }
    hint.textContent='第一步已将该联系人关联至学生「'+only.display_name+'」（'+only.relation_type+'），已自动预选；仍须填写核实依据并保存（保留学生独立身份）。';
    hint.hidden=false;
  }else if(candidates.length>1){
    hint.textContent='该联系人第一步已关联 '+candidates.length+' 名学生（'+candidates.map(s=>s.display_name).join('、')+'），请按本次咨询手动确认对应学生。';
    hint.hidden=false;
  }else if(linked.length>0){
    hint.textContent='当前线索已关联学生：'+linked.map(s=>s.display_name+'（'+(s.confirmation_state==='verified'?'已核实':'待核实')+'）').join('、')+'。';
    hint.hidden=false;
  }else{
    hint.hidden=true;hint.textContent='';
  }
}
function openOpportunityForStudent(studentId,lead){
  setView('opportunities');
  const form=$('opportunity-form');
  const select=form?.elements.student_id;
  if(select&&[...select.options].some(o=>o.value===studentId))select.value=studentId;
  const student=state.students.find(s=>s.student_id===studentId);
  const hint=$('opportunity-carry-hint');
  if(hint){
    const parts=['已从销售线索带入学生「'+(student?.display_name||'已选学生')+'」'];
    if(lead?.source_notes)parts.push('原咨询备注：'+lead.source_notes);
    parts.push('可直接填写预计金额并创建独立销售商机。');
    hint.textContent=parts.join('；');
    hint.hidden=false;
  }
  form?.scrollIntoView({block:'start'});
  form?.elements.predicted_yuan?.focus();
}
function fillOptions(){
  const defs={
    students:[state.students,'student_id',v=>v.display_name],
    contacts:[state.contacts,'contact_id',v=>v.display_name],
    events:[state.events,'event_id',v=>(v.contact_display_name||'未知联系人')+' · '+v.event_type+' · '+formatDate(v.occurred_at)+(v.original_source_text?'（'+(v.original_source_text.length>24?v.original_source_text.slice(0,24)+'…':v.original_source_text)+'）':'')],
    leads:[state.leads,'lead_id',v=>'线索 · '+(v.contact_display_name||'未指定联系人')+' · '+(v.linked_students?.length?('已关联 '+v.linked_students.map(s=>s.display_name).join('、')):labelStatus(v.lead_state))],
    candidateConsultations:[state.candidateConsultations,'event_id',
      v=>v.contact_name+' · '+v.event_type+' · '+formatDate(v.occurred_at)],
    eligibleLeadCandidates:[state.leadCandidates.filter(v=>v.status==='reviewed_eligible'),
      'candidate_id',v=>v.contact_name+' · '+v.event_type+' · 候选已核实'],
    clearedForFinal:[state.readinessReviews.filter(v=>
      v.status==='cleared'&&v.effective_status==='转换预审已通过（未创建线索）'),
      'review_id',v=>v.contact_name+' · 预审已通过'],
    ownedExecutedLeads:[state.finalLeadConversions.filter(v=>
      v.status==='executed'&&v.lead_id&&v.requested_by===state.user?.staff_id),
      'lead_id',v=>'本人已创建线索 · '+v.contact_name],
    ownedStudentChoices:[state.students.filter(v=>v.owner_user_id===state.user?.staff_id),
      'student_id',v=>v.display_name+' · 仅本学生'],
    downstreamCorrectionCandidates:[state.downstreamCorrectionEligible,
      'association_request_id',v=>v.student_name+' · 涉及'+v.opportunity_count+'项商机'],
    downstreamCasesForFinding:[state.downstreamReconciliations.filter(v=>v.case_status==='hold_active'&&!v.finding_id),
      'case_id',v=>v.student_name+' · 待第一主管核查'],
    downstreamFindingsForResolution:[state.downstreamReconciliations.filter(v=>v.case_status==='hold_active'&&v.finding_id&&!v.resolution),
      'finding_id',v=>v.student_name+' · '+(v.finding==='original_student_confirmed'?'原关联证据待独立确认':'疑似错误需人工处置')],
    pendingDownstreamCorrections:[state.downstreamCorrectionCases.filter(v=>v.status==='pending'),
      'case_id',v=>v.student_name+' · 下游影响待主管复核'],
    studentLinksPendingVerification:[state.currentStudentLinks.filter(v=>v.current_state==='pending_review'),
      'association_request_id',v=>v.student_name+' · 待核实'],
    studentLinksWithdrawable:[state.currentStudentLinks.filter(v=>['pending_review','verified'].includes(v.current_state)),
      'association_request_id',v=>v.student_name+' · '+(v.current_state==='verified'?'已人工核实':'待核实')],
    pendingStudentLinkReviews:[state.studentLinkReviews.filter(v=>v.status==='pending'),
      'review_id',v=>(v.action==='verify'?'核实':'撤回')+' · '+v.student_name],
    pendingLinkRequests:[state.leadStudentRequests.filter(v=>v.status==='pending'),
      'request_id',v=>v.student_name+' · 单学生待核实'],
    pendingAdjustmentRequests:[state.leadAdjustmentRequests.filter(v=>v.status==='pending'),
      'request_id',v=>v.action_name+' · 线索变更待审'],
    pendingFinalConversions:[state.finalLeadConversions.filter(v=>v.status==='pending'),
      'authorization_id',v=>v.contact_name+' · 等待最终授权'],
    approvedFinalConversions:[state.finalLeadConversions.filter(v=>v.status==='approved'),
      'authorization_id',v=>v.contact_name+' · 已批准待执行'],
    pendingReadiness:[state.readinessReviews.filter(v=>v.status==='pending'),
      'review_id',v=>v.contact_name+' · 待转换预审'],
    clearedReadiness:[state.readinessReviews.filter(v=>v.status==='cleared'),
      'review_id',v=>v.contact_name+' · 已通过，可撤销'],
    disputableCandidates:[state.disputableCandidates.map(v=>({
      ...v,choice_key:v.candidate_id+':'+v.own_event_id
    })),'choice_key',v=>v.contact_name+' · 本人'+v.own_event_type+'咨询'],
    pendingAttributionDisputes:[state.attributionDisputes.filter(v=>v.status==='pending'),
      'dispute_id',v=>v.contact_name+' · 跨员工归因争议'],
    pendingLeadCandidates:[state.leadCandidates.filter(v=>v.status==='pending'),
      'candidate_id',v=>v.contact_name+' · '+v.event_type],
    custodyStaff:[state.custodyStaff,'staff_id',v=>v.staff_name],
    custodyActive:[state.custodyActive,'assignment_id',v=>v.contact_name],
    custodyReviewPending:[state.custodyReviews.filter(v=>v.status==='pending'),
      'review_id',v=>v.contact_name+' · '+(v.kind==='withdrawal'?'申请撤回':'争议复核')],
    custodyPending:[state.custodyRequests.filter(v=>v.status==='pending'),
      'request_id',v=>v.contact_name+' · '+v.requester_name+' → '+v.target_name]
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
  let autoSelectCandidate=false;
  if(state.preferredLeadId){
    const select=document.querySelector('#lead-link-form select[name="lead_id"]');
    if([...select.options].some(o=>o.value===state.preferredLeadId)){
      select.value=state.preferredLeadId;
      autoSelectCandidate=true;
    }
    state.preferredLeadId=null;
  }
  setSelect($('family-review-select'),
    state.families.filter(v=>v.verification_state==='pending'), 
    'family_group_id',v=>v.display_name+'（申请人：'+(v.requested_by_name||'待核实')+'）');
  fillAuditSelect();
  syncLeadLinkCandidate(autoSelectCandidate);
}
function fillAuditSelect(){
  const ty=$('audit-type').value;
  const map={
    student:[state.students,'student_id',v=>v.display_name],
    lead:[state.leads,'lead_id',v=>'咨询线索 · '+(v.contact_display_name||'未指定联系人')],
    opportunity:[state.opportunities,'opportunity_id',v=>v.student_display_name+'的销售商机'],
    family:[state.families,'family_group_id',v=>v.display_name+' · '+labelStatus(v.verification_state)],
    identity_change:[state.identityRequests,'request_id',v=>(v.action==='bind'?'绑定':'撤销')+' · '+v.target_staff_name+' · '+labelStatus(v.status)]
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
function record(title,details,annotation,symbol='•',actions=[]){
  const el=node('div','record'),lhs=node('div','record-left');
  const icon=node('span','record-icon',symbol),b=node('div');
  b.append(node('div','record-name',title),node('div','record-meta',details));
  lhs.append(icon,b);
  if(!actions.length){
    el.append(lhs,node('span','record-end',annotation));return el;
  }
  const side=node('div','record-side'),actRow=node('div','record-actions');
  for(const act of actions){
    const btn=node('button','secondary compact-btn',act.label);
    btn.type='button';
    btn.addEventListener('click',act.onClick);
    actRow.append(btn);
  }
  side.append(node('span','record-end',annotation),actRow);
  el.append(lhs,side);return el;
}
function paint(id,items,make){
  const parent=$(id);parent.replaceChildren();
  if(!items.length){parent.append(node('div','empty','暂无可查看的记录。可以先使用左侧表单新增虚构演示数据。'));return;}
  for(const x of items)parent.append(make(x));
}
function channelFormFields(){
  const form=$('channel-request-form'),action=form.elements.action.value;
  const create=action==='create',deactivate=action==='deactivate';
  $('channel-target-row').hidden=create;
  $('channel-name-row').hidden=deactivate;
  $('channel-type-row').hidden=deactivate;
  $('channel-parent-row').hidden=deactivate;
  for(const field of ['name','channel_type']){
    form.elements[field].disabled=deactivate;
    form.elements[field].required=!deactivate;
  }
  form.elements.channel_id.disabled=create;
  form.elements.channel_id.required=!create;
  form.elements.parent_id.disabled=deactivate;
}
function renderChannelMaintenance(){
  const strict=state.strict;
  const ok=strict&&!state.channelRequestLoadError&&!state.channelLoadError&&!state.channelAuditLoadError;
  $('channel-maintenance-workbench').hidden=!strict;
  $('channel-request-card').hidden=!ok;
  $('channel-review-card').hidden=!ok||state.capabilities.review_channel_change!==true;
  $('channel-requests-total').textContent=state.channelRequests.length+' 条';
  $('channel-audit-total').textContent=state.channelAuditHistory.length+' 条';
  $('channel-audit-status').textContent=state.channelAuditLoadError
    ?'审计时间线未能验证，已清空旧记录并关闭渠道变更操作。'
    :'只显示本人申请、本人曾审核及当前有权复核的渠道变更事件；不包含原始审计数据。';
  $('channel-requests-status').textContent=state.channelRequestLoadError
    ?'无法确认申请及审批状态，旧记录已清空，禁止使用旧待办。'
    :'只显示本人的维护记录，以及本机构有效销售主管有权查看的待审批申请。';
  if(!ok){
    $('channel-requests-list').replaceChildren();
    $('channel-audit-list').replaceChildren();
    $('channel-target-choice').replaceChildren();
    $('channel-parent-choice').replaceChildren();
    $('channel-review-choice').replaceChildren();
    return;
  }
  paint('channel-audit-list',state.channelAuditHistory,x=>record(
    ({CHANNEL_CHANGE_REQUESTED:'提交渠道变更申请',
      CHANNEL_CHANGE_APPLIED:'独立主管批准并执行',
      CHANNEL_CHANGE_REJECTED:'独立主管驳回申请'})[x.event_name]||'未知审计事件',
    '事件时间：'+formatDate(x.happened_at)+
      ' · 申请类型：'+({create:'新增',edit:'编辑',deactivate:'停用'})[x.action],
    x.event_name==='CHANNEL_CHANGE_REQUESTED'?'仅申请，渠道尚未修改':
      x.event_name==='CHANNEL_CHANGE_APPLIED'?'独立审批后在隔离环境执行':'审批驳回，渠道未改',
    '审'));
  paint('channel-requests-list',state.channelRequests,x=>record(
    ({create:'新增渠道',edit:'编辑渠道',deactivate:'停用渠道'})[x.action]||'渠道申请',
    (x.proposed_name||state.channels.find(c=>c.channel_id===x.channel_id)?.name||'指定渠道')+
      ' · '+formatDate(x.created_at)+
      (x.requested_by===state.user?.staff_id?' · 本人申请':' · 待独立主管复核'),
    ({pending:'等待独立主管审核',applied:'审批通过，已在隔离数据执行',
      rejected:'审核驳回，渠道未变'})[x.status]||'状态待核实','渠'));
  const active=state.channels.filter(c=>c.effective_status==='active');
  setSelect($('channel-target-choice'),active,'channel_id',c=>c.name);
  const current=$('channel-target-choice').value;
  setSelect($('channel-parent-choice'),active.filter(c=>c.channel_id!==current),
    'channel_id',c=>c.name,true);
  const reviewable=state.channelRequests.filter(x=>x.status==='pending'&&x.can_review===true);
  setSelect($('channel-review-choice'),reviewable,'request_id',
    x=>({create:'新增',edit:'编辑',deactivate:'停用'})[x.action]+' · '+
      (x.proposed_name||state.channels.find(c=>c.channel_id===x.channel_id)?.name||'指定渠道'));
  $('channel-review-choice').required=true;
  $('channel-review-form').querySelector('button[type="submit"]').disabled=!reviewable.length;
  $('channel-request-form').querySelector('button[type="submit"]').disabled=
    !active.length&&$('channel-request-form').elements.action.value!=='create';
  channelFormFields();
}
function setCampaignRevisionChoice(){
  const form=$('campaign-revise-form');
  const own=state.campaignDrafts.filter(x=>x.owner_user_id===state.user?.staff_id&&
    !state.campaignSalesReviews.some(r=>r.campaign_id===x.campaign_id&&
      ['pending_sales','sales_approved_pending_finance'].includes(r.status)));
  const selector=$('campaign-revise-choice');
  setSelect(selector,own,'campaign_id',x=>x.name+' · 版本 '+x.version);
  const active=state.channels.filter(x=>x.effective_status==='active');
  setSelect($('campaign-revise-channel-choice'),active,'channel_id',x=>x.name);
  const selected=own.find(x=>x.campaign_id===selector.value);
  $('campaign-revise-panel').hidden=!selected||state.campaignLoadError||state.channelLoadError||state.campaignSalesLoadError;
  form.querySelector('button[type="submit"]').disabled=!selected||!active.length;
  if(!selected){
    $('campaign-revise-version').textContent='暂无本人可修改的活动草稿';
    return;
  }
  form.elements.name.value=selected.name;
  form.elements.budget_yuan.value=(Number(selected.budget_cents)/100).toFixed(2);
  for(const key of ['starts_at','ends_at']){
    const d=selected[key]&&new Date(selected[key]);
    if(d&&!Number.isNaN(d.getTime())){
      const local=new Date(d.getTime()-d.getTimezoneOffset()*60000);
      form.elements[key].value=local.toISOString().slice(0,16);
    }else form.elements[key].value='';
  }
  const selectedChannels=new Set(selected.channel_ids);
  for(const option of $('campaign-revise-channel-choice').options)
    option.selected=selectedChannels.has(option.value);
  $('campaign-revise-version').textContent='当前草稿版本 '+selected.version+'；保存时需与数据库版本一致';
}
function renderCampaignPacketFreezeGates(){
  const healthy=state.strict&&!state.campaignPacketFreezeLoadError&&
    !state.campaignChecklistLoadError&&!state.campaignCompensationLoadError&&
    !state.campaignTrustFailureLoadError&&!state.campaignAcceptanceLoadError&&
    !state.campaignEvidenceLoadError&&!state.campaignEscalationLoadError&&
    !state.campaignIncidentLoadError&&!state.campaignIncidentHistoryLoadError;
  $('campaign-packet-freeze-total').textContent=healthy
    ?state.campaignPacketFreezeGates.length+' 条':'0 条';
  $('campaign-packet-freeze-status').textContent=healthy
    ?'候选材料仅可离线演示摘要与版本防重；正式来源版本、材料冻结、持久防重和跨模块签收均未授权。'
    :'版本冻结状态读取失败，清空旧数据，仍禁止交接、补偿和解除隔离。';
  if(!healthy){$('campaign-packet-freeze-list').replaceChildren();return;}
  paint('campaign-packet-freeze-list',state.campaignPacketFreezeGates,x=>record(
    '补偿材料包版本与防重 · '+x.incident_id.slice(0,8),
    x.freeze_block_reason==='blocked_sales_packet_incomplete'
      ?'销售证据未齐，无法冻结材料包'
      :'独立销售审核及真实材料冻结未完成',
    '来源版本未验证 · 摘要未核验 · 无持久防重登记 · 禁止跨模块交接 · 保持隔离','禁'));
}
function renderCampaignCompensationChecklist(){
  const healthy=state.strict&&!state.campaignChecklistLoadError&&
    !state.campaignPacketFreezeLoadError&&
    !state.campaignCompensationLoadError&&!state.campaignTrustFailureLoadError&&
    !state.campaignAcceptanceLoadError&&!state.campaignEvidenceLoadError&&
    !state.campaignEscalationLoadError&&!state.campaignIncidentLoadError&&
    !state.campaignIncidentHistoryLoadError;
  $('campaign-checklist-total').textContent=healthy
    ?state.campaignCompensationChecklist.length+' 条':'0 条';
  $('campaign-checklist-status').textContent=healthy
    ?'四阶段只读验收清单：销售独立审核、财务原单对账、教务学生及课时核验、三方联合复核。全部尚未完成，不能解除隔离。'
    :'独立审批或证据状态无法验证，已清空旧清单并保持所有操作阻断。';
  if(!healthy){$('campaign-checklist-list').replaceChildren();return;}
  paint('campaign-checklist-list',state.campaignCompensationChecklist,x=>record(
    '补偿证据及审批顺序 · '+x.incident_id.slice(0,8),
    x.first_blocking_gate==='blocked_sales_evidence_missing'
      ?'销售材料未齐：不能进入独立审核'
      :'销售材料已收集，但独立销售方案审核尚未授权',
    '①销售独立审批未完成 · ②财务原单对账未完成 · ③教务履约核对未完成 · ④三方最终验收未完成 · 继续隔离','审'));
}
function renderCampaignCompensationMatrix(){
  const healthy=state.strict&&!state.campaignCompensationLoadError&&
    !state.campaignChecklistLoadError&&!state.campaignPacketFreezeLoadError&&
    !state.campaignTrustFailureLoadError&&!state.campaignAcceptanceLoadError&&
    !state.campaignEvidenceLoadError&&!state.campaignEscalationLoadError&&
    !state.campaignIncidentLoadError&&!state.campaignIncidentHistoryLoadError;
  $('campaign-compensation-total').textContent=healthy
    ?state.campaignCompensationMatrix.length+' 条':'0 条';
  $('campaign-compensation-status').textContent=healthy
    ?'只读补偿分类和三方责任。学生、订单、付款、SaleEvent 与课时的真实对账未做；禁止写入补偿或解除隔离。'
    :'补偿风险状态读取失败，已清空分类且仍不得补偿或放行。';
  if(!healthy){$('campaign-compensation-list').replaceChildren();return;}
  const classes={
    snapshot_integrity_conflict:'冻结活动快照不一致：销售独立复核',
    sales_evidence_gap:'销售证据未齐：补充材料，不得释放',
    external_authority_or_reconciliation_unknown:'外部权威及业务对账缺失'
  };
  paint('campaign-compensation-list',state.campaignCompensationMatrix,x=>record(
    '补偿责任分类 · '+x.incident_id.slice(0,8),
    classes[x.failure_classification],
    '销售核对 · 财务独立核对 · 教务独立核对 · 原记录保留 · 禁止补偿执行 · 持续隔离','禁'));
}
function renderCampaignTrustFailureGates(){
  const healthy=state.strict&&!state.campaignTrustFailureLoadError&&
    !state.campaignCompensationLoadError&&!state.campaignChecklistLoadError&&
    !state.campaignPacketFreezeLoadError&&
    !state.campaignAcceptanceLoadError&&!state.campaignEvidenceLoadError&&
    !state.campaignEscalationLoadError&&!state.campaignIncidentLoadError&&
    !state.campaignIncidentHistoryLoadError;
  $('campaign-trust-failure-total').textContent=healthy
    ?state.campaignTrustFailureGates.length+' 条':'0 条';
  $('campaign-trust-failure-status').textContent=healthy
    ?'外部签名、撤销状态和重放登记不可验证；失败只保留原始历史并人工升级，不允许补偿写入或解除隔离。'
    :'可信验证数据失效，旧状态已清空；绝不视为财务或教务批准。';
  if(!healthy){$('campaign-trust-failure-list').replaceChildren();return;}
  paint('campaign-trust-failure-list',state.campaignTrustFailureGates,x=>record(
    '三方可信验证阻断 · '+x.incident_id.slice(0,8),
    x.trust_failure_code==='blocked_sales_packet_incomplete'
      ?'销售资料不完整，不能进入三方签名验收'
      :'缺少独立财务签名信任链，验收拒绝',
    '验签未通过 · 撤销未核验 · 幂等重放未核验 · 原记录保全 · 不得执行补偿 · 持续隔离','禁'));
}
function renderCampaignAcceptancePrerequisites(){
  const healthy=state.strict&&!state.campaignAcceptanceLoadError&&
    !state.campaignTrustFailureLoadError&&!state.campaignCompensationLoadError&&
    !state.campaignChecklistLoadError&&!state.campaignPacketFreezeLoadError&&
    !state.campaignEvidenceLoadError&&!state.campaignEscalationLoadError&&
    !state.campaignIncidentLoadError&&!state.campaignIncidentHistoryLoadError;
  $('campaign-acceptance-total').textContent=healthy
    ?state.campaignAcceptancePrerequisites.length+' 条':'0 条';
  $('campaign-acceptance-status').textContent=healthy
    ?'三方权威尚未接入：无财务签收、无教务签名、无跨模块批准。所有状态只读、持续隔离。'
    :'三方准入验证失败，旧数据已清空，禁止据此操作或解除隔离。';
  if(!healthy){$('campaign-acceptance-list').replaceChildren();return;}
  paint('campaign-acceptance-list',state.campaignAcceptancePrerequisites,x=>record(
    '跨模块验收前置条件 · '+x.incident_id.slice(0,8),
    x.prerequisite_status==='blocked_sales_packet_incomplete'
      ?'销售证据未齐，禁止进入跨部门验收'
      :'销售材料已收集；可信财务身份、签收和教务核验仍缺失',
    '财务未签收 · 教务未核验 · 原历史未对账 · 持续隔离 · 不可发布','禁'));
}
function renderCampaignEscalationEvidence(){
  const healthy=state.strict&&!state.campaignEvidenceLoadError&&
    !state.campaignAcceptanceLoadError&&!state.campaignTrustFailureLoadError&&
    !state.campaignCompensationLoadError&&!state.campaignChecklistLoadError&&
    !state.campaignPacketFreezeLoadError&&
    !state.campaignEscalationLoadError&&!state.campaignIncidentLoadError&&
    !state.campaignIncidentHistoryLoadError;
  $('campaign-evidence-total').textContent=healthy
    ?state.campaignEscalationEvidence.length+' 条':'0 条';
  $('campaign-evidence-status').textContent=healthy
    ?'只核查销售证据完整性。财务签收、教务核验与跨模块验收均未接入，资金与活动始终阻断。'
    :'交接证据状态不可信，旧数据已清空且禁止追加材料。';
  if(!healthy){$('campaign-evidence-list').replaceChildren();return;}
  const statuses={
    blocked_missing_reporter_evidence:'缺少原报告人补充佐证',
    blocked_missing_independent_sales_evidence:'缺少独立销售复核人补充佐证',
    blocked_missing_finance_requirements_note:'缺少独立销售复核人记录的财务待核查事项',
    sales_packet_collected_external_acceptance_pending:
      '销售资料已收集，财务及教务未验收，持续阻断'
  };
  paint('campaign-evidence-list',state.campaignEscalationEvidence,x=>record(
    '人工升级异常 '+x.incident_id.slice(0,8),
    statuses[x.sales_packet_status],
    '销售材料'+(x.sales_packet_complete?'已齐':'不齐')+
    ' · 财务未签收 · 教务未核验 · 跨部门未通过 · 不可执行','核'));
}
function renderCampaignEscalationFollowups(){
  const healthy=state.strict&&!state.campaignEscalationLoadError&&
    !state.campaignEvidenceLoadError&&!state.campaignAcceptanceLoadError&&
    !state.campaignTrustFailureLoadError&&!state.campaignCompensationLoadError&&
    !state.campaignChecklistLoadError&&!state.campaignPacketFreezeLoadError&&
    !state.campaignIncidentLoadError&&!state.campaignIncidentHistoryLoadError&&
    !state.campaignFinanceLoadError;
  const escalated=state.campaignFinanceIncidents.filter(x=>
    x.status==='manual_escalated'&&
    (x.reported_by===state.user?.staff_id||x.reviewed_by===state.user?.staff_id));
  $('campaign-escalation-followup-panel').hidden=!healthy||!escalated.length;
  $('campaign-escalation-total').textContent=healthy?state.campaignEscalationFollowups.length+' 条':'0 条';
  $('campaign-escalation-status').textContent=healthy
    ?'仅销售原报告人或实际独立复核人可追加材料；仍待外部财务权威确认，不允许放行。'
    :'升级核查数据未通过验证，已清空旧记录并禁止提交。';
  if(!healthy){
    $('campaign-escalation-list').replaceChildren();
    $('campaign-escalation-choice').replaceChildren();
    return;
  }
  paint('campaign-escalation-list',state.campaignEscalationFollowups,x=>record(
    x.note_type==='sales_evidence_addendum'?'销售材料补充':'外部财务核查事项待确认',
    '异常编号 '+x.incident_id.slice(0,8)+' · 时间 '+formatDate(x.created_at),
    '仅销售侧记录 · 持续人工升级阻断 · 未获资金许可','补'));
  setSelect($('campaign-escalation-choice'),escalated,'incident_id',
    x=>(x.issue_kind==='integrity_mismatch'?'快照差异':'佐证缺口')+' · '+x.incident_id.slice(0,8));
}
function renderCampaignIncidentHistory(){
  const healthy=state.strict&&!state.campaignIncidentHistoryLoadError&&
    !state.campaignIncidentLoadError&&!state.campaignFinanceLoadError;
  $('campaign-incident-history-total').textContent=healthy?
    state.campaignIncidentHistory.length+' 条':'0 条';
  $('campaign-incident-history-status').textContent=healthy
    ?'只读销售侧异常事件记录。保留历史状态，不等于真实财务审批或放行。'
    :'审计记录无法核实，已清空历史并禁止异常登记或复核。';
  if(!healthy){$('campaign-incident-history-list').replaceChildren();return;}
  paint('campaign-incident-history-list',state.campaignIncidentHistory,x=>record(
    ({CAMPAIGN_FINANCE_HANDOFF_ISSUE_REPORTED:'资料异常登记',
      CAMPAIGN_FINANCE_ISSUE_ESCALATED:'独立销售主管人工升级',
      CAMPAIGN_FINANCE_ISSUE_RECHECK_REQUESTED:'独立销售主管要求再次核查',
      CAMPAIGN_FINANCE_ESCALATION_FOLLOWUP_RECORDED:'人工升级后销售侧补充材料'})[x.event_name],
    '异常编号 '+x.incident_id.slice(0,8)+' · 时间 '+formatDate(x.happened_at),
    '事件后状态：'+({open:'待复核',manual_escalated:'人工升级持续阻断',
      closed_for_recheck:'资料核查结束，仍待财务核验'})[x.event_status]+
    ' · 未获财务或支出许可','审'));
}
function renderCampaignIncidents(){
  const healthy=state.strict&&!state.campaignIncidentLoadError&&
    !state.campaignIncidentHistoryLoadError&&!state.campaignEscalationLoadError&&
    !state.campaignEvidenceLoadError&&!state.campaignAcceptanceLoadError&&
    !state.campaignTrustFailureLoadError&&!state.campaignCompensationLoadError&&
    !state.campaignChecklistLoadError&&!state.campaignPacketFreezeLoadError&&
    !state.campaignFinanceLoadError&&!state.campaignSalesLoadError;
  const available=state.campaignFinanceHandoffs;
  const pending=state.campaignFinanceIncidents.filter(x=>x.status==='open'&&
    x.can_triage===true&&x.reported_by!==state.user?.staff_id);
  $('campaign-incident-total').textContent=healthy?state.campaignFinanceIncidents.length+' 条':'0 条';
  $('campaign-incident-status').textContent=healthy
    ?'销售侧异常登记和独立复核。关闭佐证核查不等于财务批准；快照错误只能升级。'
    :'异常状态读取失败，已清空旧记录并关闭提交与复核。';
  $('campaign-incident-report-panel').hidden=!healthy||!available.length;
  $('campaign-incident-triage-panel').hidden=!healthy||
    state.capabilities.review_campaign_sales!==true||!pending.length;
  if(!healthy){
    $('campaign-incident-list').replaceChildren();
    $('campaign-incident-report-choice').replaceChildren();
    $('campaign-incident-triage-choice').replaceChildren();
    return;
  }
  paint('campaign-incident-list',state.campaignFinanceIncidents,x=>record(
    x.issue_kind==='integrity_mismatch'?'计划快照异常':'交接佐证材料缺口',
    '登记时间 '+formatDate(x.created_at)+' · 销售审核编号 '+x.review_id.slice(0,8),
    ({open:'待独立复核',manual_escalated:'人工升级，继续阻断',
      closed_for_recheck:'资料重新核对，仍未获财务授权'})[x.status],'异'));
  setSelect($('campaign-incident-report-choice'),available,'review_id',
    x=>x.campaign_name+' · '+x.readiness_status);
  setSelect($('campaign-incident-triage-choice'),pending,'incident_id',
    x=>(x.issue_kind==='integrity_mismatch'?'快照异常':'佐证缺口')+' · '+x.incident_id.slice(0,8));
}
function renderCampaignFinanceHandoffs(){
  const healthy=state.strict&&!state.campaignFinanceLoadError&&!state.campaignSalesLoadError;
  $('campaign-finance-total').textContent=healthy?state.campaignFinanceHandoffs.length+' 条':'0 条';
  $('campaign-finance-status').textContent=healthy
    ?'销售审核已通过的交接资料；尚未核实真实财务审批人，不能付款、投放或发布。'
    :'财务交接资料未通过验证，已清空旧数据，禁止使用。';
  if(!healthy){$('campaign-finance-list').replaceChildren();return;}
  paint('campaign-finance-list',state.campaignFinanceHandoffs,x=>record(
    x.campaign_name,
    '草稿版本 '+x.campaign_version+' · 计划预算 '+yuan(x.planned_budget_cents)+
      ' · 关联渠道 '+x.channel_count+' 个 · 销售审批时间 '+formatDate(x.sales_approved_at),
    (x.readiness_status==='ready_for_external_manual_check'
      ?'资料一致，可供外部财务人工复核；仍未获财务授权'
      :'交接资料存在异常，必须重新核实；禁止财务放行'),'财'));
}
function renderCampaignSalesReview(){
  const healthy=state.strict&&!state.campaignSalesLoadError&&
    !state.campaignLoadError&&!state.channelLoadError;
  const own=state.campaignDrafts.filter(x=>x.owner_user_id===state.user?.staff_id&&
    !state.campaignSalesReviews.some(r=>r.campaign_id===x.campaign_id&&
      ['pending_sales','sales_approved_pending_finance'].includes(r.status)));
  const pending=state.campaignSalesReviews.filter(x=>
    x.status==='pending_sales'&&x.can_sales_review===true&&
    x.requested_by!==state.user?.staff_id);
  $('campaign-sales-total').textContent=state.campaignSalesReviews.length+' 条';
  $('campaign-sales-status').textContent=state.campaignSalesLoadError
    ?'销售审批数据读取失败，已清空旧待办并禁止操作。'
    :'销售通过后仍在财务待确认中。尚无实际财务预算批准或活动执行许可。';
  $('campaign-sales-request-panel').hidden=!healthy||!own.length;
  $('campaign-sales-review-panel').hidden=!healthy||
    state.capabilities.review_campaign_sales!==true||!pending.length;
  if(!healthy){
    $('campaign-sales-list').replaceChildren();
    $('campaign-sales-request-choice').replaceChildren();
    $('campaign-sales-review-choice').replaceChildren();
    $('campaign-sales-request-version').textContent='尚未核实可提交的活动版本';
    return;
  }
  paint('campaign-sales-list',state.campaignSalesReviews,x=>record(
    ({pending_sales:'等待销售主管独立审核',
       sales_rejected:'销售审核驳回',
       sales_approved_pending_finance:'销售审核通过，仍等待财务确认'})[x.status],
    '活动：'+(state.campaignDrafts.find(c=>c.campaign_id===x.campaign_id)?.name||
      '本机构已授权草稿')+' · 申请版本：'+x.campaign_version+
      ' · 时间：'+formatDate(x.created_at),
    '预算未获财务授权，禁止投放或支出','审'));
  setSelect($('campaign-sales-request-choice'),own,'campaign_id',
    x=>x.name+' · 草稿版本 '+x.version);
  setSelect($('campaign-sales-review-choice'),pending,'review_id',
    x=>(state.campaignDrafts.find(c=>c.campaign_id===x.campaign_id)?.name||
      '本机构待审核草稿')+' · 申请版本 '+x.campaign_version);
  const selected=own.find(x=>x.campaign_id===$('campaign-sales-request-choice').value);
  $('campaign-sales-request-version').textContent=selected
    ?'当前版本 '+selected.version+'；提交后冻结草稿直至驳回，批准后仍等待财务确认。'
    :'没有可以提交的本人草稿';
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
  $('channels-total').textContent=state.channels.length+' 条';
  $('channels-status').textContent=state.channelLoadError
    ?'渠道目录未能读取或层级不一致，已拒绝展示。请联系隔离环境管理员。'
    :state.channelCatalog
      ?'本机构 '+state.channelCatalog.count+' 个渠道，其中有效 '+state.channelCatalog.effective_active_count+' 个；仅供虚构数据演示。'
      :'此模式尚未开放渠道目录。';
  if(state.channelLoadError){
    $('channels-list').replaceChildren(node('div','empty','渠道查询失败，未显示任何来源数据。'));
  }else paint('channels-list',state.channels,x=>record(
    '　'.repeat(Math.min(x.depth,16))+(x.depth?'↳ ':'')+x.name,
    '类别：'+(x.channel_type||'未分类')+' · 层级：'+x.depth+
      ' · '+(x.parent_channel_id?'有上级渠道':'一级渠道'),
    x.effective_status==='active'?'正常使用':
      x.effective_status==='inactive'?'本渠道已停用':'因上级渠道停用而不可用',
    '渠'));
  renderChannelMaintenance();
  $('campaign-workbench').hidden=!state.strict;
  $('campaigns-total').textContent=state.campaignDrafts.length+' 条';
  renderCampaignSalesReview();
  renderCampaignFinanceHandoffs();
  renderCampaignIncidents();
  renderCampaignIncidentHistory();
  renderCampaignEscalationFollowups();
  renderCampaignEscalationEvidence();
  renderCampaignAcceptancePrerequisites();
  renderCampaignTrustFailureGates();
  renderCampaignCompensationMatrix();
  renderCampaignCompensationChecklist();
  renderCampaignPacketFreezeGates();
  $('campaigns-status').textContent=state.campaignLoadError||state.channelLoadError
    ?'活动草稿或渠道目录读取失败，旧数据已清空，禁止新建。'
    :'只显示本人负责的草稿和主管有权查看的本机构草稿。预算均为未审批的计划金额。';
  if(!state.strict||state.campaignLoadError||state.channelLoadError||state.campaignSalesLoadError){
    $('campaigns-list').replaceChildren();
    $('campaign-channel-choice').replaceChildren();
    $('campaign-revise-choice').replaceChildren();
    $('campaign-revise-channel-choice').replaceChildren();
    $('campaign-revise-panel').hidden=true;
    $('campaign-create-panel').hidden=true;
  }else{
    $('campaign-create-panel').hidden=false;
    paint('campaigns-list',state.campaignDrafts,x=>record(
      x.name,
      '负责人：'+(x.owner_user_id===state.user?.staff_id?'本人':'同机构授权员工')+
       ' · 关联渠道：'+x.channel_ids.length+' 个'+
       ' · 计划开始：'+formatDate(x.starts_at)+
       ' · 计划结束：'+formatDate(x.ends_at),
      '草稿 v'+x.version+' · 计划预算 '+yuan(x.budget_cents)+'（未审批）','活'));
    const active=state.channels.filter(x=>x.effective_status==='active');
    setSelect($('campaign-channel-choice'),active,'channel_id',x=>x.name);
    $('campaign-draft-form').querySelector('button[type="submit"]').disabled=!active.length;
    setCampaignRevisionChoice();
  }
  paint('students-list',state.students,x=>record(
    x.display_name,'年级：'+(x.grade_label||'未填写')+' · 负责人：'+(x.owner_display_name||'待确认'),'独立档案','学'));
  paint('contacts-list',state.contacts,x=>record(
    x.display_name,x.do_not_contact?'已标记不接受主动联系':'可联系状态未核实','共享联系人','人'));
  const consultationBox=$('strict-consultation-list');
  if($('strict-consultation-card'))$('strict-consultation-card').hidden=!state.strict;
  if(consultationBox){
    consultationBox.hidden=!state.strict;
    if(state.strict)paint('strict-consultation-list',state.events,x=>record(
      x.event_type,
      '本员工登记的实际咨询 · '+formatDate(x.occurred_at),
      '已登记，不代表已形成销售线索','询'));
  }
  const demoEventsCard=$('demo-events-card');
  if(demoEventsCard){
    demoEventsCard.hidden=state.strict;
    if($('events-total'))$('events-total').textContent=state.events.length+' 条';
    if(!state.strict&&$('events-list'))paint('events-list',state.events,x=>{
      const details=['咨询时间：'+formatDate(x.occurred_at)];
      if(x.original_source_text)details.push('沟通备注：'+x.original_source_text);
      return record(
        (x.contact_display_name||'未指定联系人')+' · '+x.event_type,
        details.join(' · '),
        x.original_source_text?'已记备注':'已登记','询');
    });
  }
  paint('leads-list',state.leads,x=>{
    const linked=Array.isArray(x.linked_students)?x.linked_students:[];
    const linkedIds=new Set(linked.map(s=>s.student_id));
    const candidates=(Array.isArray(x.contact_linked_students)?x.contact_linked_students:[])
      .filter(s=>!linkedIds.has(s.student_id));
    const details=['创建时间：'+formatDate(x.created_at)];
    if(x.source_event_type)details.push('来源咨询：'+x.source_event_type);
    if(x.source_notes)details.push('咨询备注：'+x.source_notes);
    if(linked.length){
      details.push('已关联学生：'+linked.map(s=>s.display_name+'（'+(s.confirmation_state==='verified'?'已核实':'待核实')+'）').join('、'));
    }else if(candidates.length===1){
      details.push('联系人已关联学生：'+candidates[0].display_name+'（'+candidates[0].relation_type+'），请在“关联线索与具体学生”确认');
    }else if(candidates.length>1){
      details.push('联系人第一步已关联 '+candidates.length+' 名学生（'+candidates.map(s=>s.display_name).join('、')+'），请按本次咨询手动确认');
    }
    const badge=linked.length
      ?(linked.some(s=>s.confirmation_state==='verified')?'已关联学生（已核实）':'已关联学生（待核实）')
      :labelStatus(x.lead_state);
    const actions=[];
    if(!state.strict){
      if(linked.length){
        for(const s of linked){
          actions.push({
            label:'去建商机（'+s.display_name+'） →',
            onClick:()=>openOpportunityForStudent(s.student_id,x)
          });
        }
      }else{
        actions.push({
          label:'带入关联表单',
          onClick:()=>{
            const form=$('lead-link-form');if(!form)return;
            form.elements.lead_id.value=x.lead_id;
            syncLeadLinkCandidate(true);
            form.scrollIntoView({block:'start'});
            if(!form.elements.student_id.value)form.elements.student_id.focus();
            else form.elements.evidence_ref.focus();
          }
        });
      }
    }
    return record(x.contact_display_name||'未指定联系人',details.join(' · '),badge,'询',actions);
  });
  paint('opportunities-list',state.opportunities,x=>record(
    (x.student_display_name||'指定学生')+'的商机',
    '负责人：'+(x.owner_display_name||'待确认')+' · 预计金额：'+yuan(x.predicted_amount_cents),
    labelStatus(x.lifecycle_state),'商'));
  paint('families-list',state.families,x=>record(
    x.display_name,'关联学生：'+x.student_count+' 名 · 申请人：'+
      (x.requested_by_name||'原申请待查')+
      (x.verified_by_name?' · 审核人：'+x.verified_by_name:''),
    labelStatus(x.verification_state),'家'));
  fillOptions();
  $('lead-candidate-workbench').hidden=!state.strict;
  $('lead-candidate-decision-card').hidden=!state.strict||
    state.capabilities.review_lead_candidate!==true;
  if(state.strict)paint('lead-candidates-list',state.leadCandidates,x=>record(
    x.contact_name+' · '+x.event_type,
    '咨询时间：'+formatDate(x.occurred_at)+' · 申请时间：'+formatDate(x.created_at),
    ({pending:'待主管审核',reviewed_eligible:'候选核查通过（未生成线索）',rejected:'已驳回'})[x.status]||'状态待核对','候'));
  $('downstream-reconciliation-workbench').hidden=!state.strict;
  $('downstream-first-review-card').hidden=!state.strict||
    state.capabilities.attest_downstream_reconciliation!==true;
  $('downstream-second-review-card').hidden=!state.strict||
    state.capabilities.resolve_downstream_reconciliation!==true;
  if(state.strict)paint('downstream-reconciliations-list',state.downstreamReconciliations,x=>record(
    x.student_name,
    x.finding==='original_student_confirmed'?'原学生关联已核对':
      x.finding==='wrong_student_confirmed'?'原学生关联存在错误':'尚未完成第一轮核对',
    x.case_status==='released_verified'?'两名主管复核后安全解除隔离':
      x.resolution==='escalate_manual'?'需要人工跨模块纠错，保持隔离':
      x.finding_id?'待另一主管独立裁决':'销售隔离继续有效','审'));
  $('downstream-correction-workbench').hidden=!state.strict;
  $('downstream-correction-decision-card').hidden=!state.strict||
    state.capabilities.review_downstream_student_correction!==true;
  if(state.strict){
    paint('downstream-correction-cases-list',state.downstreamCorrectionCases,x=>record(
      x.student_name,
      '影响：'+x.opportunity_count+'项商机、'+x.quote_count+'项报价、'+x.order_count+
        '笔订单、'+x.allocation_count+'项收款分配、'+x.refund_allocation_count+
        '项退款分配、'+x.trial_count+'项试课',
      ({pending:'待核查：已阻止新的销售推进',
        hold_active:'已批准隔离：下游纠错尚未完成',
        rejected:'隔离已驳回：未修改原业务'})[x.status]||'需进一步核查','险'));
  }
  $('student-link-verification-workbench').hidden=!state.strict;
  $('student-link-verification-decision-card').hidden=!state.strict||
    state.capabilities.review_student_link_verification!==true;
  if(state.strict){
    paint('student-link-reviews-list',state.studentLinkReviews,x=>record(
      x.student_name,'操作：'+(x.action==='verify'?'正式人工核实':'撤回错误关联')+
        ' · '+formatDate(x.created_at),
      ({pending:'等待独立主管审核',approved:'审批已通过',rejected:'本次审核已驳回'})[x.status]||'待核实','核'));
    paint('student-link-current-list',state.currentStudentLinks,x=>record(
      x.student_name,'单名学生的销售线索关联',
      ({pending_review:'仍待核实',verified:'已人工确认销售关联（不代表监护人）',
        withdrawn:'错误关联已撤回，历史保留'})[x.current_state]||'待核查','学'));
  }
  $('lead-governance-workbench').hidden=!state.strict;
  $('lead-student-link-decision-card').hidden=!state.strict||
    state.capabilities.review_student_lead_link!==true;
  $('lead-adjustment-decision-card').hidden=!state.strict||
    state.capabilities.review_lead_adjustment!==true;
  if(state.strict){
    paint('lead-student-associations-list',state.leadStudentRequests,x=>record(
      x.student_name,'对应指定学生 · '+formatDate(x.created_at),
      ({pending:'待主管审核',approved_pending:'已登记待核实（未确认）',
        rejected:'已驳回'})[x.status]||'待核实','学'));
    paint('lead-adjustments-list',state.leadAdjustmentRequests,x=>record(
      x.action_name,'申请时间：'+formatDate(x.created_at),
      ({pending:'待主管审核',approved:'已批准并留存记录',
        rejected:'已驳回'})[x.status]||'待核实','改'));
    paint('lead-correction-notes-list',state.leadCorrectionNotes,x=>record(
      '线索业务说明更正',x.corrected_note,'更正时间：'+formatDate(x.applied_at),'注'));
  }
  $('final-lead-conversion-workbench').hidden=!state.strict;
  $('final-lead-conversion-decision-card').hidden=!state.strict||
    state.capabilities.approve_final_lead_conversion!==true;
  if(state.strict)paint('final-lead-conversions-list',state.finalLeadConversions,x=>record(
    x.contact_name,'申请时间：'+formatDate(x.created_at),
    ({pending:'等待最终独立审核',approved:'已批准，等待本人执行',
      rejected:'已驳回，不得创建线索',executed:'已创建一条正式销售线索'})[x.status]||'状态待核查','线'));
  $('conversion-readiness-workbench').hidden=!state.strict;
  $('readiness-decision-card').hidden=!state.strict||
    state.capabilities.review_conversion_readiness!==true;
  $('readiness-revoke-card').hidden=!state.strict||
    state.capabilities.review_conversion_readiness!==true;
  $('attribution-decision-card').hidden=!state.strict||
    state.capabilities.review_attribution_dispute!==true;
  if(state.strict){
    paint('readiness-list',state.readinessReviews,x=>record(
      x.contact_name,'预审申请时间：'+formatDate(x.created_at),
      x.effective_status,'审'));
    paint('attribution-disputes-list',state.attributionDisputes,x=>record(
      x.contact_name,'独立争议提交：'+formatDate(x.created_at),
      ({pending:'待独立裁决',upheld:'异议成立，原归因不能通过',rejected:'异议被驳回'})[x.status]||'待核实','议'));
  }
  $('contact-custody-workbench').hidden=!state.strict;
  $('custody-decision-card').hidden=!state.strict||
    state.capabilities.review_contact_custody!==true;
  $('custody-review-decision-card').hidden=!state.strict||
    state.capabilities.review_custody_disputes!==true;
  if(state.strict){
    paint('custody-reviews-list',state.custodyReviews,x=>record(
      x.contact_name,(x.kind==='withdrawal'?'撤回申请':'争议复核')+' · '+formatDate(x.created_at),
      ({pending:'待独立复核',reversed:'已撤回',upheld:'维持管理权',rejected:'已驳回'})[x.status]||'待核实','核'));
    paint('related-students-list',state.relatedStudents,x=>record(
      x.student_name,'关系：'+x.contact_relation+' · 仅基本信息，无财务和其他学生资料','关系最小查看','学'));
  }
  if(state.strict)paint('custody-requests-list',state.custodyRequests,
    x=>record(x.contact_name,
      '原管理人：'+x.requester_name+' · 申请接收：'+x.target_name+
      ' · 时间：'+formatDate(x.created_at),
      labelStatus(x.status),'交'));
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
    if(res.status===401&&token===state.token&&state.token){logout('expired');throw Error('当前登录已过期，请重新进入演示工作台');}
    throw Error(result.message||'操作未完成，请查看状态');
  }
  return result.data;
}
async function refresh(){
  const endpoints=state.strict?[
    ['campaignDrafts','/api/v1/marketing-campaigns/drafts'],
    ['campaignSalesReviews','/api/v1/marketing-campaigns/sales-reviews'],
    ['campaignFinanceHandoffs','/api/v1/marketing-campaigns/finance-handoffs'],
    ['campaignFinanceIncidents','/api/v1/marketing-campaigns/finance-incidents'],
    ['campaignIncidentHistory','/api/v1/marketing-campaigns/finance-incidents/audit-history'],
    ['campaignEscalationFollowups','/api/v1/marketing-campaigns/finance-incidents/follow-ups'],
    ['campaignEscalationEvidence','/api/v1/marketing-campaigns/finance-incidents/evidence-gates'],
    ['campaignAcceptancePrerequisites','/api/v1/marketing-campaigns/finance-incidents/acceptance-prerequisites'],
    ['campaignTrustFailureGates','/api/v1/marketing-campaigns/finance-incidents/trust-failure-gates'],
    ['campaignCompensationMatrix','/api/v1/marketing-campaigns/finance-incidents/compensation-matrix'],
    ['campaignCompensationChecklist','/api/v1/marketing-campaigns/finance-incidents/compensation-checklist'],
    ['campaignPacketFreezeGates','/api/v1/marketing-campaigns/finance-incidents/packet-freeze-gates'],
    ['channels','/api/v1/marketing-channels'],
    ['channelRequests','/api/v1/marketing-channels/change-requests'],
    ['channelAuditHistory','/api/v1/marketing-channels/change-requests/audit-history'],
    ['students','/api/v1/students'],['contacts','/api/v1/contacts'],
    ['events','/api/v1/contact-events'],
    ['custodyRequests','/api/v1/contact-custody/requests'],
    ['custodyStaff','/api/v1/contact-custody/staff'],
    ['custodyActive','/api/v1/contact-custody/active'],
    ['custodyReviews','/api/v1/contact-custody/reviews'],
    ['relatedStudents','/api/v1/contact-custody/related-students'],
    ['candidateConsultations','/api/v1/lead-candidates/consultations'],
    ['leadCandidates','/api/v1/lead-candidates'],
    ['readinessReviews','/api/v1/conversion-readiness'],
    ['attributionDisputes','/api/v1/attribution-disputes'],
    ['disputableCandidates','/api/v1/attribution-disputes/eligible'],
    ['finalLeadConversions','/api/v1/lead-conversions'],
    ['leadStudentRequests','/api/v1/lead-student-associations'],
    ['leadAdjustmentRequests','/api/v1/lead-adjustments'],
    ['leadCorrectionNotes','/api/v1/lead-correction-notes'],
    ['studentLinkReviews','/api/v1/lead-student-link-reviews'],
    ['currentStudentLinks','/api/v1/lead-student-links/current'],
    ['downstreamCorrectionCases','/api/v1/downstream-student-corrections'],
    ['downstreamCorrectionEligible','/api/v1/downstream-student-corrections/eligible'],
    ['downstreamReconciliations','/api/v1/downstream-reconciliations']
  ]:[
    ['students','/api/v1/students'],['contacts','/api/v1/contacts'],
    ['channels','/api/v1/marketing-channels'],
    ['events','/api/v1/contact-events'],['leads','/api/v1/leads'],
    ['opportunities','/api/v1/opportunities'],['families','/api/v1/family-groups']
  ];
  const results=await Promise.allSettled(endpoints.map(x=>api(x[1])));
  if(state.strict){
    for(const key of ['leads','opportunities','families'])state[key]=[];
  }
  else {
    state.campaignDrafts=[];state.campaignLoadError=false;
    state.campaignSalesReviews=[];state.campaignSalesLoadError=false;
    state.campaignFinanceHandoffs=[];state.campaignFinanceLoadError=false;
    state.campaignFinanceIncidents=[];state.campaignIncidentLoadError=false;
    state.campaignIncidentHistory=[];state.campaignIncidentHistoryLoadError=false;
    state.campaignEscalationFollowups=[];state.campaignEscalationLoadError=false;
    state.campaignEscalationEvidence=[];state.campaignEvidenceLoadError=false;
    state.campaignAcceptancePrerequisites=[];state.campaignAcceptanceLoadError=false;
    state.campaignTrustFailureGates=[];state.campaignTrustFailureLoadError=false;
    state.campaignCompensationMatrix=[];state.campaignCompensationLoadError=false;
    state.campaignCompensationChecklist=[];state.campaignChecklistLoadError=false;
    state.campaignPacketFreezeGates=[];state.campaignPacketFreezeLoadError=false;
    state.channelRequests=[];state.channelRequestLoadError=false;
    state.channelAuditHistory=[];state.channelAuditLoadError=false;state.custodyRequests=[];state.custodyStaff=[];state.custodyActive=[];state.custodyReviews=[];state.relatedStudents=[];state.candidateConsultations=[];state.leadCandidates=[];state.readinessReviews=[];state.attributionDisputes=[];state.disputableCandidates=[];state.finalLeadConversions=[];state.leadStudentRequests=[];state.leadAdjustmentRequests=[];state.leadCorrectionNotes=[];state.studentLinkReviews=[];state.currentStudentLinks=[];state.downstreamCorrectionCases=[];state.downstreamCorrectionEligible=[];state.downstreamReconciliations=[];}
  for(let i=0;i<endpoints.length;i++){
    const [key]=endpoints[i],r=results[i];
    if(key==='campaignPacketFreezeGates'){
      const items=r.status==='fulfilled'?r.value?.items:null;
      const fields=['incident_id','review_id','incident_status','issue_kind',
        'failure_classification','sales_packet_complete','freeze_block_reason',
        'freeze_registry_status','frozen_source_revision','freeze_version',
        'evidence_sha256','evidence_packet_frozen','independent_sales_case_approved',
        'trusted_source_revision_verified','canonical_digest_verified',
        'persistent_idempotency_registry_verified','revision_compare_and_swap_verified',
        'evidence_immutability_verified','external_signature_verified',
        'financial_receipt_verified','academic_receipt_verified',
        'historical_originals_integrity_verified','preserve_original_orders_required',
        'preserve_original_payments_required','preserve_original_sale_events_required',
        'preserve_original_lessons_required','original_records_mutable',
        'packet_handoff_allowed','compensation_write_allowed','hold_active',
        'release_eligible','finance_authorized','execution_allowed','activity_publish_allowed'];
      const denied=['evidence_packet_frozen','independent_sales_case_approved',
        'trusted_source_revision_verified','canonical_digest_verified',
        'persistent_idempotency_registry_verified','revision_compare_and_swap_verified',
        'evidence_immutability_verified','external_signature_verified',
        'financial_receipt_verified','academic_receipt_verified',
        'historical_originals_integrity_verified','original_records_mutable',
        'packet_handoff_allowed','compensation_write_allowed','release_eligible',
        'finance_authorized','execution_allowed','activity_publish_allowed'];
      const required=['preserve_original_orders_required','preserve_original_payments_required',
        'preserve_original_sale_events_required','preserve_original_lessons_required','hold_active'];
      const classes=['snapshot_integrity_conflict','sales_evidence_gap',
        'external_authority_or_reconciliation_unknown'];
      const valid=Array.isArray(items)&&items.length<=100&&items.every(x=>
        x&&Object.keys(x).every(k=>fields.includes(k))&&
        fields.every(k=>Object.hasOwn(x,k))&&
        typeof x.incident_id==='string'&&typeof x.review_id==='string'&&
        x.incident_status==='manual_escalated'&&
        ['integrity_mismatch','supporting_materials_gap'].includes(x.issue_kind)&&
        classes.includes(x.failure_classification)&&
        typeof x.sales_packet_complete==='boolean'&&
        x.freeze_block_reason===(x.sales_packet_complete
          ?'blocked_independent_sales_review_and_freeze_missing':'blocked_sales_packet_incomplete')&&
        x.freeze_registry_status==='fixture_only_not_available_in_runtime'&&
        x.frozen_source_revision===null&&x.freeze_version===null&&
        x.evidence_sha256===null&&denied.every(k=>x[k]===false)&&
        required.every(k=>x[k]===true));
      state.campaignPacketFreezeGates=valid?items:[];
      state.campaignPacketFreezeLoadError=!valid;
    }else if(key==='campaignCompensationChecklist'){
      const items=r.status==='fulfilled'?r.value?.items:null;
      const fields=['incident_id','review_id','incident_status','issue_kind','failure_classification',
        'sales_packet_complete','preserve_original_orders_required',
        'preserve_original_payments_required','preserve_original_sale_events_required',
        'preserve_original_lessons_required','sales_original_snapshot_verified',
        'sales_independent_case_approved','finance_original_order_evidence_verified',
        'finance_original_payment_evidence_verified','finance_independent_decision_signed',
        'academic_student_identity_verified','academic_original_lesson_evidence_verified',
        'academic_independent_decision_signed','compensation_history_chain_verified',
        'external_replay_and_revocation_verified','all_source_record_hashes_verified',
        'joint_three_party_approval_verified','first_blocking_gate','stage_1_sales',
        'stage_2_finance','stage_3_academic','stage_4_joint','checklist_state',
        'original_records_mutable','compensation_write_allowed','hold_active',
        'release_eligible','finance_authorized','execution_allowed','activity_publish_allowed'];
      const denied=['sales_original_snapshot_verified','sales_independent_case_approved',
        'finance_original_order_evidence_verified','finance_original_payment_evidence_verified',
        'finance_independent_decision_signed','academic_student_identity_verified',
        'academic_original_lesson_evidence_verified','academic_independent_decision_signed',
        'compensation_history_chain_verified','external_replay_and_revocation_verified',
        'all_source_record_hashes_verified','joint_three_party_approval_verified',
        'original_records_mutable','compensation_write_allowed','release_eligible',
        'finance_authorized','execution_allowed','activity_publish_allowed'];
      const required=['preserve_original_orders_required','preserve_original_payments_required',
        'preserve_original_sale_events_required','preserve_original_lessons_required','hold_active'];
      const kinds=['snapshot_integrity_conflict','sales_evidence_gap',
        'external_authority_or_reconciliation_unknown'];
      const valid=Array.isArray(items)&&items.length<=100&&items.every(x=>
        x&&Object.keys(x).every(k=>fields.includes(k))&&
        fields.every(k=>Object.hasOwn(x,k))&&
        typeof x.incident_id==='string'&&typeof x.review_id==='string'&&
        x.incident_status==='manual_escalated'&&
        ['integrity_mismatch','supporting_materials_gap'].includes(x.issue_kind)&&
        kinds.includes(x.failure_classification)&&
        typeof x.sales_packet_complete==='boolean'&&
        x.first_blocking_gate===(x.sales_packet_complete
          ?'blocked_independent_sales_case_authority_missing':'blocked_sales_evidence_missing')&&
        x.stage_1_sales==='01_sales_independent_case_review'&&
        x.stage_2_finance==='02_finance_originals_and_signed_decision'&&
        x.stage_3_academic==='03_academic_student_lesson_signed_decision'&&
        x.stage_4_joint==='04_joint_evidence_and_history_reconciliation'&&
        x.checklist_state==='proposal_only_no_compensation_or_release'&&
        denied.every(k=>x[k]===false)&&required.every(k=>x[k]===true));
      state.campaignCompensationChecklist=valid?items:[];
      state.campaignChecklistLoadError=!valid;
    }else if(key==='campaignCompensationMatrix'){
      const items=r.status==='fulfilled'?r.value?.items:null;
      const fields=['incident_id','review_id','incident_status','sales_packet_complete',
        'issue_kind','failure_classification','proposed_next_step',
        'sales_responsibility','finance_responsibility','academic_responsibility',
        'compensation_candidate_state','downstream_student_impact_assessed',
        'actual_order_reconciliation_verified','actual_payment_reconciliation_verified',
        'actual_sale_event_reconciliation_verified','actual_lesson_reconciliation_verified',
        'historical_compensation_chain_verified','independent_sales_case_accepted',
        'independent_finance_case_accepted','independent_academic_case_accepted',
        'all_original_records_integrity_verified','preserve_original_orders_required',
        'preserve_original_payments_required','preserve_original_sale_events_required',
        'preserve_original_lessons_required','original_records_mutable',
        'compensation_write_allowed','hold_active','release_eligible','finance_authorized',
        'execution_allowed','activity_publish_allowed'];
      const denied=['downstream_student_impact_assessed','actual_order_reconciliation_verified',
        'actual_payment_reconciliation_verified','actual_sale_event_reconciliation_verified',
        'actual_lesson_reconciliation_verified','historical_compensation_chain_verified',
        'independent_sales_case_accepted','independent_finance_case_accepted',
        'independent_academic_case_accepted','all_original_records_integrity_verified',
        'original_records_mutable','compensation_write_allowed','release_eligible',
        'finance_authorized','execution_allowed','activity_publish_allowed'];
      const required=['preserve_original_orders_required','preserve_original_payments_required',
        'preserve_original_sale_events_required','preserve_original_lessons_required',
        'hold_active'];
      const classes={
        snapshot_integrity_conflict:'independent_sales_snapshot_review_required',
        sales_evidence_gap:'sales_evidence_addenda_required',
        external_authority_or_reconciliation_unknown:'external_finance_academic_reconciliation_required'
      };
      const valid=Array.isArray(items)&&items.length<=100&&items.every(x=>
        x&&Object.keys(x).every(k=>fields.includes(k))&&
        fields.every(k=>Object.hasOwn(x,k))&&
        typeof x.incident_id==='string'&&typeof x.review_id==='string'&&
        x.incident_status==='manual_escalated'&&
        typeof x.sales_packet_complete==='boolean'&&
        ['integrity_mismatch','supporting_materials_gap'].includes(x.issue_kind)&&
        Object.hasOwn(classes,x.failure_classification)&&
        x.failure_classification===(x.issue_kind==='integrity_mismatch'
          ?'snapshot_integrity_conflict'
          :x.sales_packet_complete?'external_authority_or_reconciliation_unknown':'sales_evidence_gap')&&
        x.proposed_next_step===classes[x.failure_classification]&&
        x.sales_responsibility==='sales:original_reporter_and_independent_reviewer'&&
        x.finance_responsibility==='finance:trusted_independent_receipt_and_payment_reconciliation_required'&&
        x.academic_responsibility==='academic:trusted_student_and_lesson_reconciliation_required'&&
        x.compensation_candidate_state==='candidate_only_no_execution_authority'&&
        denied.every(k=>x[k]===false)&&required.every(k=>x[k]===true));
      state.campaignCompensationMatrix=valid?items:[];
      state.campaignCompensationLoadError=!valid;
    }else if(key==='campaignTrustFailureGates'){
      const items=r.status==='fulfilled'?r.value?.items:null;
      const fields=['incident_id','review_id','incident_status','sales_packet_complete',
        'trust_failure_code','failure_disposition','compensation_boundary',
        'external_signature_verified','signature_key_current_verified',
        'signer_role_separation_verified','signed_digest_bound_to_snapshot',
        'receipt_freshness_verified','signer_revocation_checked','replay_nonce_registry_checked',
        'finance_signed_receipt_verified','academic_signed_attestation_verified',
        'external_reconciliation_verified','compensation_write_allowed',
        'original_records_mutable','three_party_acceptance_verified','hold_active',
        'release_eligible','finance_authorized','execution_allowed','activity_publish_allowed'];
      const denied=['external_signature_verified','signature_key_current_verified',
        'signer_role_separation_verified','signed_digest_bound_to_snapshot',
        'receipt_freshness_verified','signer_revocation_checked','replay_nonce_registry_checked',
        'finance_signed_receipt_verified','academic_signed_attestation_verified',
        'external_reconciliation_verified','compensation_write_allowed',
        'original_records_mutable','three_party_acceptance_verified','release_eligible',
        'finance_authorized','execution_allowed','activity_publish_allowed'];
      const valid=Array.isArray(items)&&items.length<=100&&items.every(x=>
        x&&Object.keys(x).every(k=>fields.includes(k))&&
        fields.every(k=>Object.hasOwn(x,k))&&
        typeof x.incident_id==='string'&&typeof x.review_id==='string'&&
        x.incident_status==='manual_escalated'&&
        typeof x.sales_packet_complete==='boolean'&&
        x.trust_failure_code===(x.sales_packet_complete
          ?'blocked_external_finance_trust_chain_unavailable':'blocked_sales_packet_incomplete')&&
        x.failure_disposition==='reject_preserve_originals_escalate_manually'&&
        x.compensation_boundary==='append_only_compensation_requires_independent_authority'&&
        denied.every(k=>x[k]===false)&&x.hold_active===true);
      state.campaignTrustFailureGates=valid?items:[];
      state.campaignTrustFailureLoadError=!valid;
    }else if(key==='campaignAcceptancePrerequisites'){
      const items=r.status==='fulfilled'?r.value?.items:null;
      const fields=['incident_id','review_id','incident_status','sales_packet_complete',
        'prerequisite_status','finance_principal_verified','finance_signed_receipt_verified',
        'finance_budget_decision_verified','academic_principal_verified',
        'academic_student_impact_reconciled','academic_signed_attestation_verified',
        'cross_module_evidence_reconciled','three_party_acceptance_verified',
        'compensation_history_verified','hold_active','release_eligible','finance_authorized',
        'execution_allowed','activity_publish_allowed'];
      const denied=['finance_principal_verified','finance_signed_receipt_verified',
        'finance_budget_decision_verified','academic_principal_verified',
        'academic_student_impact_reconciled','academic_signed_attestation_verified',
        'cross_module_evidence_reconciled','three_party_acceptance_verified',
        'compensation_history_verified','release_eligible','finance_authorized',
        'execution_allowed','activity_publish_allowed'];
      const valid=Array.isArray(items)&&items.length<=100&&items.every(x=>
        x&&Object.keys(x).every(k=>fields.includes(k))&&
        fields.every(k=>Object.hasOwn(x,k))&&
        typeof x.incident_id==='string'&&typeof x.review_id==='string'&&
        x.incident_status==='manual_escalated'&&
        typeof x.sales_packet_complete==='boolean'&&
        x.prerequisite_status===(x.sales_packet_complete
          ?'blocked_trusted_finance_identity_missing':'blocked_sales_packet_incomplete')&&
        denied.every(k=>x[k]===false)&&x.hold_active===true);
      state.campaignAcceptancePrerequisites=valid?items:[];
      state.campaignAcceptanceLoadError=!valid;
    }else if(key==='campaignEscalationEvidence'){
      const items=r.status==='fulfilled'?r.value?.items:null;
      const fields=['incident_id','review_id','incident_status','reporter_evidence_present',
        'independent_sales_review_present','finance_requirements_documented',
        'sales_packet_complete','sales_packet_status','finance_acceptance_verified',
        'academic_acceptance_verified','cross_department_accepted','hold_active',
        'finance_authorized','execution_allowed'];
      const statuses=['blocked_missing_reporter_evidence',
        'blocked_missing_independent_sales_evidence',
        'blocked_missing_finance_requirements_note',
        'sales_packet_collected_external_acceptance_pending'];
      const valid=Array.isArray(items)&&items.length<=100&&items.every(x=>
        x&&Object.keys(x).every(k=>fields.includes(k))&&
        fields.every(k=>Object.hasOwn(x,k))&&
        ['incident_id','review_id'].every(k=>typeof x[k]==='string')&&
        x.incident_status==='manual_escalated'&&
        ['reporter_evidence_present','independent_sales_review_present',
          'finance_requirements_documented','sales_packet_complete']
          .every(k=>typeof x[k]==='boolean')&&
        x.sales_packet_complete===(
          x.reporter_evidence_present&&x.independent_sales_review_present&&
          x.finance_requirements_documented)&&
        statuses.includes(x.sales_packet_status)&&
        x.sales_packet_status===(x.reporter_evidence_present
          ?(x.independent_sales_review_present
            ?(x.finance_requirements_documented
              ?statuses[3]:statuses[2]):statuses[1]):statuses[0])&&
        x.finance_acceptance_verified===false&&x.academic_acceptance_verified===false&&
        x.cross_department_accepted===false&&x.hold_active===true&&
        x.finance_authorized===false&&x.execution_allowed===false);
      state.campaignEscalationEvidence=valid?items:[];
      state.campaignEvidenceLoadError=!valid;
    }else if(key==='campaignEscalationFollowups'){
      const items=r.status==='fulfilled'?r.value?.items:null;
      const fields=['followup_id','incident_id','review_id','recorded_by',
        'responsibility_boundary','note_type','created_at','incident_status',
        'finance_authorized','execution_allowed','external_authority_state'];
      const valid=Array.isArray(items)&&items.length<=100&&items.every(x=>
        x&&Object.keys(x).every(k=>fields.includes(k))&&
        fields.every(k=>Object.hasOwn(x,k))&&
        ['followup_id','incident_id','review_id','recorded_by','created_at']
          .every(k=>typeof x[k]==='string')&&
        ['sales_reporter','independent_sales_reviewer'].includes(x.responsibility_boundary)&&
        ['sales_evidence_addendum','external_finance_requirements_pending'].includes(x.note_type)&&
        x.incident_status==='manual_escalated'&&x.finance_authorized===false&&
        x.execution_allowed===false&&
        x.external_authority_state==='awaiting_external_finance_authority');
      state.campaignEscalationFollowups=valid?items:[];
      state.campaignEscalationLoadError=!valid;
    }else if(key==='campaignIncidentHistory'){
      const items=r.status==='fulfilled'?r.value?.items:null;
      const fields=['audit_id','incident_id','review_id','issue_kind','event_name',
        'actor_user_id','happened_at','event_status','current_incident_status',
        'finance_authorized','execution_allowed'];
      const expectedStatus={
        CAMPAIGN_FINANCE_HANDOFF_ISSUE_REPORTED:'open',
        CAMPAIGN_FINANCE_ISSUE_ESCALATED:'manual_escalated',
        CAMPAIGN_FINANCE_ISSUE_RECHECK_REQUESTED:'closed_for_recheck',
        CAMPAIGN_FINANCE_ESCALATION_FOLLOWUP_RECORDED:'manual_escalated'
      };
      const valid=Array.isArray(items)&&items.length<=100&&items.every(x=>
        x&&Object.keys(x).every(k=>fields.includes(k))&&
        fields.every(k=>Object.hasOwn(x,k))&&
        ['audit_id','incident_id','review_id','actor_user_id','happened_at']
         .every(k=>typeof x[k]==='string')&&
        ['integrity_mismatch','supporting_materials_gap'].includes(x.issue_kind)&&
        Object.hasOwn(expectedStatus,x.event_name)&&
        x.event_status===expectedStatus[x.event_name]&&
        ['open','manual_escalated','closed_for_recheck'].includes(x.current_incident_status)&&
        x.finance_authorized===false&&x.execution_allowed===false);
      state.campaignIncidentHistory=valid?items:[];
      state.campaignIncidentHistoryLoadError=!valid;
    }else if(key==='campaignFinanceIncidents'){
      const items=r.status==='fulfilled'?r.value?.items:null;
      const fields=['incident_id','review_id','campaign_id','reported_by','issue_kind',
        'observed_readiness','status','created_at','reviewed_at','reviewed_by','can_triage'];
      const valid=Array.isArray(items)&&items.length<=100&&items.every(x=>
        x&&Object.keys(x).every(k=>fields.includes(k))&&
        fields.every(k=>Object.hasOwn(x,k))&&
        ['incident_id','review_id','campaign_id','reported_by','created_at',
          'observed_readiness'].every(k=>typeof x[k]==='string')&&
        (x.reviewed_at===null||typeof x.reviewed_at==='string')&&
        (x.reviewed_by===null||typeof x.reviewed_by==='string')&&
        ['integrity_mismatch','supporting_materials_gap'].includes(x.issue_kind)&&
        ['open','manual_escalated','closed_for_recheck'].includes(x.status)&&
        typeof x.can_triage==='boolean');
      state.campaignFinanceIncidents=valid?items:[];
      state.campaignIncidentLoadError=!valid;
    }else if(key==='campaignFinanceHandoffs'){
      const items=r.status==='fulfilled'?r.value?.items:null;
      const fields=['review_id','campaign_id','campaign_version','requested_by',
        'sales_approved_by','submitted_at','sales_approved_at','campaign_name',
        'planned_budget_cents','channel_count','handoff_status','finance_authorized',
        'execution_allowed','campaign_status','readiness_status'];
      const valid=Array.isArray(items)&&items.length<=100&&items.every(x=>
        x&&Object.keys(x).every(k=>fields.includes(k))&&
        fields.every(k=>Object.hasOwn(x,k))&&
        ['review_id','campaign_id','requested_by','sales_approved_by',
          'submitted_at','sales_approved_at'].every(k=>typeof x[k]==='string')&&
        typeof x.campaign_name==='string'&&x.campaign_name.length<=100&&
        Number.isSafeInteger(x.campaign_version)&&x.campaign_version>=1&&
        Number.isSafeInteger(x.channel_count)&&x.channel_count>=1&&x.channel_count<=20&&
        Number.isSafeInteger(Number(x.planned_budget_cents))&&
        Number(x.planned_budget_cents)>=0&&Number(x.planned_budget_cents)<=100000000000&&
        x.handoff_status==='awaiting_external_finance_authority'&&
        x.finance_authorized===false&&x.execution_allowed===false&&
        x.campaign_status==='draft'&&
        ['ready_for_external_manual_check','blocked_missing_campaign',
          'blocked_campaign_not_draft','blocked_snapshot_mismatch',
          'blocked_active_incident'].includes(x.readiness_status));
      state.campaignFinanceHandoffs=valid?items:[];
      state.campaignFinanceLoadError=!valid;
    }else if(key==='campaignSalesReviews'){
      const items=r.status==='fulfilled'?r.value?.items:null;
      const valid=Array.isArray(items)&&items.length<=100&&items.every(x=>
        x&&typeof x.review_id==='string'&&typeof x.campaign_id==='string'&&
        Number.isSafeInteger(x.campaign_version)&&x.campaign_version>=1&&
        typeof x.requested_by==='string'&&typeof x.can_sales_review==='boolean'&&
        typeof x.created_at==='string'&&
        ['pending_sales','sales_rejected','sales_approved_pending_finance'].includes(x.status));
      state.campaignSalesReviews=valid?items:[];
      state.campaignSalesLoadError=!valid;
    }else if(key==='campaignDrafts'){
      const items=r.status==='fulfilled'?r.value?.items:null;
      const valid=Array.isArray(items)&&items.length<=100&&items.every(x=>
        x&&typeof x.campaign_id==='string'&&
        typeof x.name==='string'&&x.name.length<=100&&
        x.status==='draft'&&Number.isSafeInteger(x.version)&&x.version>=1&&
        typeof x.owner_user_id==='string'&&
        Array.isArray(x.channel_ids)&&x.channel_ids.length>=1&&
        x.channel_ids.length<=20&&
        x.channel_ids.every(v=>typeof v==='string')&&
        (x.starts_at===null||typeof x.starts_at==='string')&&
        (x.ends_at===null||typeof x.ends_at==='string')&&
        (typeof x.budget_cents==='number'||typeof x.budget_cents==='string')&&
        Number.isSafeInteger(Number(x.budget_cents))&&
        Number(x.budget_cents)>=0&&Number(x.budget_cents)<=100000000000);
      state.campaignDrafts=valid?items:[];
      state.campaignLoadError=!valid;
    }else if(key==='channels'){
      const data=r.status==='fulfilled'?r.value:null;
      const valid=data?.schema_version==='m01-isolated-channel-catalog-v1'&&
        data?.status==='isolated_readonly_not_production'&&
        data?.production_integration_allowed===false&&Array.isArray(data.channels)&&
        Number.isSafeInteger(data.count)&&data.channels.length===data.count;
      state.channelCatalog=valid?data:null;
      state.channels=valid?data.channels:[];
      state.channelLoadError=!valid;
    }else if(key==='channelAuditHistory'){
      const items=r.status==='fulfilled'?r.value?.items:null;
      const valid=Array.isArray(items)&&items.length<=100&&items.every(x=>
        x&&typeof x.audit_id==='string'&&typeof x.request_id==='string'&&
        typeof x.happened_at==='string'&&
        ['CHANNEL_CHANGE_REQUESTED','CHANNEL_CHANGE_APPLIED','CHANNEL_CHANGE_REJECTED'].includes(x.event_name)&&
        ['create','edit','deactivate'].includes(x.action)&&
        ['pending','applied','rejected'].includes(x.status)&&
        typeof x.actor_user_id==='string'&&typeof x.requested_by==='string'&&
        Object.keys(x).every(k=>['audit_id','request_id','event_name','actor_user_id',
        'happened_at','action','status','requested_by'].includes(k)));
      state.channelAuditHistory=valid?items:[];
      state.channelAuditLoadError=!valid;
    }else if(key==='channelRequests'){
      const items=r.status==='fulfilled'?r.value?.items:null;
      const valid=Array.isArray(items)&&items.length<=100&&items.every(x=>
        x&&typeof x.request_id==='string'&&
        ['create','edit','deactivate'].includes(x.action)&&
        ['pending','applied','rejected'].includes(x.status)&&
        typeof x.requested_by==='string'&&typeof x.can_review==='boolean');
      state.channelRequests=valid?items:[];
      state.channelRequestLoadError=!valid;
    }else state[key]=r.status==='fulfilled'?r.value.items||[]:[];
    if(r.status==='rejected'&&!((key==='families')&&!state.capabilities.review_family_audit)){
      toast('部分业务列表未能读取，请检查账号权限或数据库状态',true);
    }
  }
  render();
  await refreshIdentity();
  if(typeof window.__refreshBusinessWorkspace==='function'){
    await window.__refreshBusinessWorkspace();
  }else{
    window.dispatchEvent(new Event('isolated-session-change'));
  }
}
function setView(view){
  state.view=view;
  document.querySelectorAll('button[data-view]').forEach(x=>x.classList.toggle('active',x.dataset.view===view));
  if($('workspace-business-nav'))$('workspace-business-nav').classList.toggle('active',view==='business-workspace');
  document.querySelectorAll('.view').forEach(x=>x.classList.toggle('active',x.dataset.panel===view));
  const [eyebrow,title]=viewInfo[view]||viewInfo.overview;
  $('page-eyebrow').textContent=eyebrow;$('page-title').textContent=title;
  document.title=title+' · 市场与销售工作台';
  if(view==='audit')$('audit-list').replaceChildren();
}
function snapshotMainForms(){
  const out={};
  document.querySelectorAll('#workspace form').forEach(form=>{
    if(!form.id||form.id==='business-form'||form.id==='audit-form')return;
    const touchedText=[...form.elements].some(el=>{
      if(!el.name||el.disabled||el.type==='hidden'||el.type==='submit'||el.type==='button')return false;
      if(el.type==='checkbox'||el.type==='radio')return el.checked!==el.defaultChecked;
      if(el.tagName==='SELECT'||el.type==='datetime-local')return false;
      return el.value!==el.defaultValue&&el.value.trim()!=='';
    });
    if(form.dataset.userDirty!=='1'&&!touchedText)return;
    const fields={};
    for(const el of form.elements){
      if(!el.name||el.disabled||el.type==='hidden'||el.type==='submit'||el.type==='button')continue;
      if(el.type==='checkbox')fields[el.name]=el.checked;
      else if(el.tagName==='SELECT'&&el.multiple)continue;
      else fields[el.name]=el.value;
    }
    if(Object.keys(fields).length)out[form.id]=fields;
  });
  return out;
}
async function restoreExpiredDraft(draft){
  if(!draft)return false;
  let restored=false;
  if(draft.mainForms){
    for(const [formId,fields] of Object.entries(draft.mainForms)){
      const form=$(formId);if(!form)continue;
      for(const [name,val] of Object.entries(fields)){
        const el=form.elements[name];if(!el||el.disabled)continue;
        if(el.type==='checkbox'){el.checked=!!val;restored=true;}
        else if(el.tagName==='SELECT'){
          if([...el.options].some(o=>o.value===val)){el.value=val;restored=true;}
        }else{
          el.value=String(val);restored=true;
        }
      }
      if(restored)form.dataset.userDirty='1';
      if(formId==='lead-link-form')syncLeadLinkCandidate(false);
    }
  }
  if(draft.businessDraft&&typeof window.__restoreBusinessDraft==='function'){
    if(await window.__restoreBusinessDraft(draft.businessDraft))restored=true;
  }
  if(restored&&draft.view){
    if(draft.view==='business-workspace'){
      if(!$('workspace-business-nav')?.hidden){
        setView('business-workspace');
      }
    }else{
      const navBtn=document.querySelector('button[data-view="'+draft.view+'"]');
      if(navBtn&&!navBtn.hidden)setView(draft.view);
    }
  }
  return restored;
}
function logout(notice=true){
  stopSessionCountdown();
  if(notice==='expired'&&state.user?.staff_id){
    const businessDraft=typeof window.__snapshotBusinessDraft==='function'?window.__snapshotBusinessDraft():null;
    const mainForms=snapshotMainForms();
    if(businessDraft||Object.keys(mainForms).length){
      state.expiredDraft={
        staffId:state.user.staff_id,strict:state.strict,
        view:state.view,businessDraft,mainForms
      };
    }else state.expiredDraft=null;
  }else{
    state.expiredDraft=null;
  }
  const noticeEl=$('session-expired-notice');
  if(noticeEl){
    if(notice==='expired'){
      const who=state.user?.display_name||'原员工';
      noticeEl.textContent=state.expiredDraft
        ?'当前演示登录已过期（30 分钟会话超时）。未保存的草稿已暂存本地内存；由原员工「'+who+'」重新登录后将自动恢复，切换其他账号会自动清空。'
        :'当前演示登录已过期（30 分钟会话超时），请重新登录。';
      noticeEl.hidden=false;
    }else{
      noticeEl.hidden=true;noticeEl.textContent='';
    }
  }
  window.dispatchEvent(new Event('isolated-session-clear'));
  state.token=null;state.user=null;state.capabilities={};state.strict=false;
  state.preferredEventId=null;state.preferredLeadId=null;
  state.channels=[];state.channelCatalog=null;state.channelLoadError=false;
  state.campaignDrafts=[];state.campaignLoadError=false;
  state.campaignSalesReviews=[];state.campaignSalesLoadError=false;
  state.campaignFinanceHandoffs=[];state.campaignFinanceLoadError=false;
  state.campaignFinanceIncidents=[];state.campaignIncidentLoadError=false;
  state.campaignIncidentHistory=[];state.campaignIncidentHistoryLoadError=false;
  state.campaignEscalationFollowups=[];state.campaignEscalationLoadError=false;
  state.campaignEscalationEvidence=[];state.campaignEvidenceLoadError=false;
  state.campaignAcceptancePrerequisites=[];state.campaignAcceptanceLoadError=false;
  state.campaignTrustFailureGates=[];state.campaignTrustFailureLoadError=false;
  state.campaignCompensationMatrix=[];state.campaignCompensationLoadError=false;
  state.campaignCompensationChecklist=[];state.campaignChecklistLoadError=false;
  state.campaignPacketFreezeGates=[];state.campaignPacketFreezeLoadError=false;
  $('campaign-packet-freeze-list').replaceChildren();
  $('campaign-packet-freeze-total').textContent='0 条';
  $('campaign-packet-freeze-status').textContent='未登录，补偿证据冻结状态已清空。';
  $('campaign-checklist-list').replaceChildren();
  $('campaign-checklist-total').textContent='0 条';
  $('campaign-checklist-status').textContent='未登录，补偿独立验收清单已清空。';
  $('campaign-compensation-list').replaceChildren();
  $('campaign-compensation-total').textContent='0 条';
  $('campaign-compensation-status').textContent='未登录，三方补偿责任分类已清空。';
  $('campaign-trust-failure-list').replaceChildren();
  $('campaign-trust-failure-total').textContent='0 条';
  $('campaign-trust-failure-status').textContent='未登录，三方可信验证阻断已清空。';
  $('campaign-acceptance-list').replaceChildren();
  $('campaign-acceptance-total').textContent='0 条';
  $('campaign-acceptance-status').textContent='未登录，三方验收准入信息已清空。';
  $('campaign-evidence-list').replaceChildren();
  $('campaign-evidence-total').textContent='0 条';
  $('campaign-evidence-status').textContent='未登录，销售证据核验信息已清空。';
  $('campaign-escalation-list').replaceChildren();
  $('campaign-escalation-choice').replaceChildren();
  $('campaign-escalation-total').textContent='0 条';
  $('campaign-escalation-status').textContent='未登录，升级后补充材料已清空。';
  $('campaign-escalation-followup-panel').hidden=true;
  $('campaign-incident-history-list').replaceChildren();
  $('campaign-incident-history-total').textContent='0 条';
  $('campaign-incident-history-status').textContent='未登录，异常审计时间线已清空。';
  $('campaign-incident-list').replaceChildren();
  $('campaign-incident-report-choice').replaceChildren();
  $('campaign-incident-triage-choice').replaceChildren();
  $('campaign-incident-total').textContent='0 条';
  $('campaign-incident-status').textContent='未登录，交接异常记录已清空。';
  $('campaign-incident-report-panel').hidden=true;
  $('campaign-incident-triage-panel').hidden=true;
  $('campaign-finance-list').replaceChildren();
  $('campaign-finance-total').textContent='0 条';
  $('campaign-finance-status').textContent='未登录，财务交接资料已清空。';
  $('campaign-sales-list').replaceChildren();
  $('campaign-sales-request-choice').replaceChildren();
  $('campaign-sales-review-choice').replaceChildren();
  $('campaign-sales-request-version').textContent='未登录，销售审批记录已清空';
  $('campaign-sales-total').textContent='0 条';
  $('campaign-workbench').hidden=true;
  $('campaigns-list').replaceChildren();
  $('campaign-channel-choice').replaceChildren();
  $('campaign-revise-choice').replaceChildren();
  $('campaign-revise-channel-choice').replaceChildren();
  $('campaign-revise-panel').hidden=true;
  $('campaign-revise-version').textContent='未登录，草稿版本已清空';
  $('campaigns-total').textContent='0 条';
  $('campaigns-status').textContent='未登录，市场活动草稿已清空。';
  state.channelRequests=[];state.channelRequestLoadError=false;
  state.channelAuditHistory=[];state.channelAuditLoadError=false;
  $('channel-audit-list').replaceChildren();
  $('channel-audit-total').textContent='0 条';
  $('channel-audit-status').textContent='未登录，审计历史已清空。';
  $('channel-maintenance-workbench').hidden=true;
  $('channel-requests-list').replaceChildren();
  $('channel-review-choice').replaceChildren();
  $('channel-target-choice').replaceChildren();
  $('channel-parent-choice').replaceChildren();
  $('channel-requests-total').textContent='0 条';
  $('channel-requests-status').textContent='未登录，渠道审批信息已清空。';
  $('channels-list').replaceChildren();
  $('channels-total').textContent='0 条';
  $('channels-status').textContent='未登录，渠道目录已清空。';
  if($('events-list'))$('events-list').replaceChildren();
  if($('events-total'))$('events-total').textContent='0 条';
  if($('lead-link-candidate-hint')){$('lead-link-candidate-hint').hidden=true;$('lead-link-candidate-hint').textContent='';}
  if($('opportunity-carry-hint')){$('opportunity-carry-hint').hidden=true;$('opportunity-carry-hint').textContent='';}
  if($('student-access-note'))$('student-access-note').hidden=true;
  if($('student-access-entry'))$('student-access-entry').setAttribute('aria-expanded','false');
  applyStrictLayout();
  for(const key of ['students','contacts','events','leads','opportunities','families','identityStaff','identityRequests','identityBindings','custodyRequests','custodyStaff','custodyActive','custodyReviews','relatedStudents','candidateConsultations','leadCandidates','readinessReviews','attributionDisputes','disputableCandidates','finalLeadConversions','leadStudentRequests','leadAdjustmentRequests','leadCorrectionNotes','studentLinkReviews','currentStudentLinks','downstreamCorrectionCases','downstreamCorrectionEligible','downstreamReconciliations'])state[key]=[];
  document.querySelectorAll('#workspace form').forEach(form=>{
    form.reset();
    delete form.dataset.userDirty;
  });
  document.querySelectorAll('#workspace input[type="datetime-local"]').forEach(el=>{el.value='';});
  document.querySelectorAll('[data-manager-only]').forEach(el=>el.hidden=true);
  $('workspace').hidden=true;$('login-screen').hidden=false;
  $('login-form').reset();$('external-login-form').reset();$('audit-list').replaceChildren();
  if(notice==='expired')toast('当前登录已过期，请重新进入演示工作台',true);
  else if(notice)toast('已退出演示账号');
}
function applyStrictLayout(){
  const allowed=new Set(['overview','students','contacts','leads','channels','campaigns']);
  for(const nav of document.querySelectorAll('button[data-view]')){
    nav.hidden=(state.strict&&!allowed.has(nav.dataset.view))||
      (!state.strict&&nav.dataset.view==='campaigns');
  }
  const contactLink=$('contact-link-form');
  if(contactLink)contactLink.closest('.panel').hidden=false;
  const demoEvents=$('demo-events-card');
  if(demoEvents)demoEvents.hidden=state.strict;
  const notesRow=$('event-notes-row');
  if(notesRow){
    notesRow.hidden=state.strict;
    const textarea=notesRow.querySelector('textarea');
    if(textarea)textarea.disabled=state.strict;
  }
  // Consultation is now migrated; generating leads and linking leads to
  // children remain blocked server-side and hidden in the strict test UI.
  const leadForm=$('lead-form');
  if(leadForm)leadForm.closest('.panel').hidden=state.strict;
  const leadList=$('leads-list');
  if(leadList)leadList.closest('.panel').hidden=state.strict;
  const head=document.querySelector('[data-panel="leads"] .section-head p');
  if(head)head.textContent=state.strict?
    '这里只允许登记本人联系人实际发生的一次咨询；线索与商机仍须后续独立审核。':
    '先记录一次真实咨询，再形成线索；还不知道学生是谁时也可以登记。';
  $('strict-scope-note').hidden=!state.strict;
}
function register(id,action,{postRefresh=true}={}){
  const form=$(id);
  form.addEventListener('submit',async e=>{
    e.preventDefault();
    const submit=form.querySelector('button[type="submit"]');
    submit.disabled=true;
    try{
      const data=Object.fromEntries(new FormData(form).entries());
      const out=await action(data);
      form.reset();
      delete form.dataset.userDirty;
      if(postRefresh){setDefaultDate();await refresh();}
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
  const nextToken=payload.data.token;
  const profile=await api('/api/v1/me',{token:nextToken});
  const pendingDraft=state.expiredDraft;
  state.expiredDraft=null;
  state.token=nextToken;
  state.user={...payload.data,...profile};
  state.capabilities=profile.capabilities||{};
  state.strict=false;applyStrictLayout();
  const exp=parseTokenExp(nextToken)||(Number.isFinite(payload.data.expires_in_seconds)?Date.now()+payload.data.expires_in_seconds*1000:null);
  startSessionCountdown(exp);
  $('session-expired-notice').hidden=true;$('session-expired-notice').textContent='';
  $('staff-name').textContent=payload.data.display_name;
  $('staff-role').textContent=payload.data.role_label;
  $('avatar').textContent=payload.data.display_name.slice(0,1);
  $('login-screen').hidden=true;$('workspace').hidden=false;
  setView('overview');
  setDefaultDate();
  await refresh();
  if(pendingDraft&&pendingDraft.staffId===profile.staff_id&&pendingDraft.strict===state.strict){
    const restored=await restoreExpiredDraft(pendingDraft);
    if(restored)return '已恢复刚才未保存的草稿，请注意及时保存';
  }
  return '已进入虚构数据演示工作台';
},{postRefresh:false});
// A second, local-only test entrypoint to the same Chinese workbench.
 // It does NOT implement OIDC authorization-code/PKCE/MFA or production SSO.
register('external-login-form',async d=>{
  const signed=d.signed_token?.trim();
  if(!signed||signed.length>8192)throw Error('员工测试签名凭据无效');
  const profile=await api('/api/v1/me',{token:signed});
  const pendingDraft=state.expiredDraft;
  state.expiredDraft=null;
  state.token=signed;
  state.user=profile;
  state.capabilities=profile.capabilities||{};
  state.strict=state.capabilities.strict_employee_mode===true;
  applyStrictLayout();
  startSessionCountdown(parseTokenExp(signed));
  $('session-expired-notice').hidden=true;$('session-expired-notice').textContent='';
  $('staff-name').textContent=profile.display_name;
  $('staff-role').textContent=state.strict?'已核实测试员工 · 低权限模式':'已核实测试员工';
  $('avatar').textContent=profile.display_name.slice(0,1);
  $('login-screen').hidden=true;$('workspace').hidden=false;
  setView('overview');
  setDefaultDate();
  await refresh();
  if(pendingDraft&&pendingDraft.staffId===profile.staff_id&&pendingDraft.strict===state.strict){
    const restored=await restoreExpiredDraft(pendingDraft);
    if(restored)return '已恢复刚才未保存的草稿，请注意及时保存';
  }
  return state.strict?'已进入员工专属数据库严格权限测试模式':'已通过外部签名验证（隔离环境）';
},{postRefresh:false});
$('channel-request-form').elements.action.addEventListener('change',()=>{
  channelFormFields();
  renderChannelMaintenance();
});
$('channel-target-choice').addEventListener('change',()=>{
  const current=$('channel-target-choice').value;
  setSelect($('channel-parent-choice'),state.channels.filter(c=>
    c.effective_status==='active'&&c.channel_id!==current),
    'channel_id',c=>c.name,true);
});
$('campaign-revise-choice').addEventListener('change',setCampaignRevisionChoice);
$('campaign-sales-request-choice').addEventListener('change',()=>{
  const selected=state.campaignDrafts.find(x=>
    x.campaign_id===$('campaign-sales-request-choice').value);
  $('campaign-sales-request-version').textContent=selected
    ?'当前版本 '+selected.version+'；独立销售审核不代表财务预算批准'
    :'没有有效的本人草稿';
});
register('campaign-sales-request-form',async d=>{
  if(!state.strict||state.campaignLoadError||state.channelLoadError||
      state.campaignSalesLoadError||state.capabilities.request_campaign_sales_review!==true)
    throw Error('活动计划或销售审批权限尚未核实');
  const own=state.campaignDrafts.find(x=>x.campaign_id===d.campaign_id&&
    x.owner_user_id===state.user?.staff_id&&
    !state.campaignSalesReviews.some(r=>r.campaign_id===d.campaign_id&&
      ['pending_sales','sales_approved_pending_finance'].includes(r.status)));
  if(!own)throw Error('当前版本已在审核中，不可重复提交');
  const result=await api('/api/v1/marketing-campaigns/drafts/'+
    encodeURIComponent(own.campaign_id)+'/sales-review-requests',{
    method:'POST',body:{expected_version:own.version,
      evidence_ref:d.evidence_ref.trim(),reason_zh:d.reason_zh.trim()}
  });
  return result.status==='pending_sales'
    ?'活动销售审核已提交，仍是草稿，预算和支出均未获批准'
    :'已有该审核申请，状态：'+result.status;
});
register('campaign-escalation-followup-form',async d=>{
  if(!state.strict||state.campaignEscalationLoadError||state.campaignEvidenceLoadError||state.campaignAcceptanceLoadError||state.campaignTrustFailureLoadError||state.campaignCompensationLoadError||state.campaignChecklistLoadError||state.campaignPacketFreezeLoadError||state.campaignIncidentLoadError||
    state.campaignIncidentHistoryLoadError||state.campaignFinanceLoadError)
    throw Error('未核实人工升级异常和受限历史，请刷新重试');
  const incident=state.campaignFinanceIncidents.find(x=>
    x.incident_id===d.incident_id&&x.status==='manual_escalated'&&
    (x.reported_by===state.user?.staff_id||x.reviewed_by===state.user?.staff_id));
  if(!incident)throw Error('仅原登记人或原独立销售审核人可补充已升级异常');
  const result=await api('/api/v1/marketing-campaigns/finance-incidents/'+
    encodeURIComponent(incident.incident_id)+'/follow-ups',{
    method:'POST',body:{note_type:d.note_type,
      evidence_ref:d.evidence_ref.trim(),reason_zh:d.reason_zh.trim()}
  });
  return '已追加销售侧核查材料：'+result.incident_status+
    '；人工升级阻断保持，不代表外部财务已接收或批准';
});
register('campaign-incident-report-form',async d=>{
  if(!state.strict||state.campaignFinanceLoadError||state.campaignIncidentLoadError)
    throw Error('未核实可登记的财务交接资料');
  const handoff=state.campaignFinanceHandoffs.find(x=>x.review_id===d.review_id);
  if(!handoff)throw Error('未找到当前有权访问的交接计划');
  if(d.issue_kind==='integrity_mismatch'&&
    handoff.readiness_status==='ready_for_external_manual_check')
    throw Error('当前快照一致，不能将其误报为完整性错误');
  const outcome=await api('/api/v1/marketing-campaigns/finance-handoffs/'+
    encodeURIComponent(handoff.review_id)+'/incidents',{
    method:'POST',body:{issue_kind:d.issue_kind,
      evidence_ref:d.evidence_ref.trim(),reason_zh:d.reason_zh.trim()}
  });
  return '交接异常已登记：'+outcome.status+'；活动及预算仍未获授权';
});
register('campaign-incident-triage-form',async d=>{
  if(!state.strict||state.campaignIncidentLoadError||
    state.capabilities.review_campaign_sales!==true)
    throw Error('未核实独立销售主管复核权限');
  const incident=state.campaignFinanceIncidents.find(x=>
    x.incident_id===d.incident_id&&x.status==='open'&&x.can_triage===true&&
    x.reported_by!==state.user?.staff_id);
  if(!incident)throw Error('没有可独立复核的交接异常');
  if(incident.issue_kind==='integrity_mismatch'&&d.action==='close_for_recheck')
    throw Error('快照异常必须人工升级，不能通过关闭异常放行');
  const outcome=await api('/api/v1/marketing-campaigns/finance-incidents/'+
    encodeURIComponent(incident.incident_id)+'/decision',{
    method:'POST',body:{action:d.action,
      evidence_ref:d.evidence_ref.trim(),reason_zh:d.reason_zh.trim()}
  });
  return '异常已记录为 '+outcome.status+'，仍没有财务审批或支出权限';
});
register('campaign-sales-review-form',async d=>{
  if(!state.strict||state.campaignLoadError||state.campaignSalesLoadError||
     state.capabilities.review_campaign_sales!==true)
    throw Error('未核实有效销售主管审批权');
  const review=state.campaignSalesReviews.find(x=>
    x.review_id===d.review_id&&x.status==='pending_sales'&&
    x.can_sales_review===true&&x.requested_by!==state.user?.staff_id);
  if(!review)throw Error('没有有权审批的他人待审申请');
  const result=await api('/api/v1/marketing-campaigns/sales-reviews/'+
    encodeURIComponent(review.review_id)+'/decision',{
    method:'POST',body:{decision:d.decision,
      evidence_ref:d.evidence_ref.trim(),reason_zh:d.reason_zh.trim()}
  });
  return result.status==='sales_approved_pending_finance'
    ?'销售审核通过，但财务尚未确认；活动仍是草稿，禁止支出'
    :'销售审核已驳回；草稿保持未发布、预算未审批';
});
register('campaign-revise-form',async d=>{
  if(!state.strict||state.campaignLoadError||state.channelLoadError||state.campaignSalesLoadError||
    state.capabilities.revise_own_campaign_draft!==true)
    throw Error('当前活动资料或修改权限未经核实');
  const own=state.campaignDrafts.find(x=>
    x.campaign_id===d.campaign_id&&x.owner_user_id===state.user?.staff_id&&
    x.status==='draft'&&Number.isSafeInteger(x.version)&&
    !state.campaignSalesReviews.some(r=>r.campaign_id===x.campaign_id&&
      ['pending_sales','sales_approved_pending_finance'].includes(r.status)));

  if(!own)throw Error('只有草稿原负责人可以修改，需刷新重新核实');
  const ids=[...$('campaign-revise-channel-choice').selectedOptions].map(x=>x.value);
  if(ids.length<1||ids.length>20||new Set(ids).size!==ids.length||
    ids.some(id=>!state.channels.some(c=>
      c.channel_id===id&&c.effective_status==='active')))
    throw Error('修改必须使用本机构有效且不重复的渠道');
  const budget=cents(d.budget_yuan);
  if(budget>100000000000)throw Error('计划预算超出范围');
  const starts_at=d.starts_at?localIso(d.starts_at):null;
  const ends_at=d.ends_at?localIso(d.ends_at):null;
  if(starts_at&&ends_at&&new Date(ends_at)<new Date(starts_at))
    throw Error('活动结束时间不能早于开始时间');
  const response=await api('/api/v1/marketing-campaigns/drafts/'+
    encodeURIComponent(own.campaign_id)+'/revisions',{
    method:'POST',body:{expected_version:own.version,name:d.name.trim(),
      starts_at,ends_at,budget_cents:budget,channel_ids:ids}
  });
  return '草稿修改已保存至版本 '+response.version+'；计划预算仍未审批';
});
register('campaign-draft-form',async d=>{
  if(!state.strict||state.campaignLoadError||state.channelLoadError||
     state.capabilities.create_campaign_draft!==true)
    throw Error('活动草稿数据或员工权限尚未核实');
  const ids=[...$('campaign-channel-choice').selectedOptions].map(o=>o.value);
  if(ids.length<1||ids.length>20||ids.some(id=>
    !state.channels.some(c=>c.channel_id===id&&c.effective_status==='active')))
    throw Error('请选择一至二十个本机构有效渠道');
  const budget=cents(d.budget_yuan);
  if(budget>100000000000)throw Error('计划预算超出限制');
  const start=d.starts_at?localIso(d.starts_at):null;
  const end=d.ends_at?localIso(d.ends_at):null;
  if(start&&end&&new Date(end)<new Date(start))
    throw Error('结束时间不能早于开始时间');
  const result=await api('/api/v1/marketing-campaigns/drafts',{
    method:'POST',
    body:{name:d.name.trim(),starts_at:start,ends_at:end,
      budget_cents:budget,channel_ids:ids}
  });
  return '活动草稿已保存；负责人为本人，预算未审批，禁止实际支出或投放';
});
register('channel-request-form',async d=>{
  if(!state.strict||state.channelLoadError||state.channelRequestLoadError||state.channelAuditLoadError)
    throw Error('渠道请求状态无法确认，禁止提交');
  const action=d.action;
  const data={action,evidence_ref:d.evidence_ref.trim(),reason_zh:d.reason_zh.trim()};
  if(action!=='create'){
    if(!state.channels.some(c=>c.channel_id===d.channel_id&&c.effective_status==='active'))
      throw Error('请选择本机构仍有效的渠道');
    data.channel_id=d.channel_id;
  }
  if(action!=='deactivate'){
    data.name=d.name.trim();
    data.channel_type=d.channel_type.trim();
    data.parent_id=d.parent_id||null;
  }
  const result=await api('/api/v1/marketing-channels/change-requests',{
    method:'POST',body:data
  });
  return result.status==='pending'?'渠道维护申请已提交，尚未修改渠道，等待独立主管审核':
    '已找到相同申请，当前状态：'+result.status;
});
register('channel-review-form',async d=>{
  if(!state.strict||state.channelLoadError||state.channelRequestLoadError||state.channelAuditLoadError||
      state.capabilities.review_channel_change!==true)
    throw Error('当前没有经过核实的渠道审批权限');
  const selected=state.channelRequests.find(x=>x.request_id===d.request_id&&
    x.status==='pending'&&x.can_review===true);
  if(!selected||selected.requested_by===state.user?.staff_id)
    throw Error('只能审批本机构其他员工提交的待审核渠道申请');
  const result=await api('/api/v1/marketing-channels/change-requests/'+
    encodeURIComponent(d.request_id)+'/decision',{
      method:'POST',body:{decision:d.decision,evidence_ref:d.evidence_ref.trim(),
        reason_zh:d.reason_zh.trim()}
    });
  return result.status==='applied'?'独立主管已批准，隔离渠道变更已执行':
    '渠道申请已被独立主管驳回，原渠道没有变更';
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
register('custody-request-form',async d=>{
  await api('/api/v1/contact-custody/requests',{method:'POST',body:{
    contact_id:d.contact_id,target_staff_id:d.target_staff_id,
    reason_zh:d.reason_zh.trim(),evidence_ref:d.evidence_ref.trim()
  }});
  return '已提交联系人交接申请，当前管理人尚未改变；须由另一位有效主管独立审核';
});
register('custody-decision-form',async d=>{
  await api('/api/v1/contact-custody/requests/'+
    encodeURIComponent(d.request_id)+'/decision',{method:'POST',body:{
      decision:d.decision,reason_zh:d.reason_zh.trim(),
      evidence_ref:d.evidence_ref.trim()
    }});
  return d.decision==='approved'?
    '独立主管已批准这位联系人的管理权交接；学生、旧咨询和归因不变':
    '独立主管已驳回这项联系人交接申请';
});
register('custody-review-request-form',async d=>{
  await api('/api/v1/contact-custody/reviews',{method:'POST',body:{
    assignment_id:d.assignment_id,kind:d.kind,
    evidence_ref:d.evidence_ref.trim(),reason_zh:d.reason_zh.trim()
  }});
  return '撤回或争议申请已记录，等待独立主管复核；当前管理权暂不改变';
});
register('custody-review-decision-form',async d=>{
  await api('/api/v1/contact-custody/reviews/'+
    encodeURIComponent(d.review_id)+'/decision',{method:'POST',body:{
      result:d.result,evidence_ref:d.evidence_ref.trim(),reason_zh:d.reason_zh.trim()
    }});
  return d.result==='reversed'?'独立主管已撤回管理权；学生及历史咨询保持不变':
    '独立主管已记录复核结果；管理权保持不变';
});
register('lead-candidate-request-form',async d=>{
  await api('/api/v1/lead-candidates',{method:'POST',body:{
    source_event_id:d.source_event_id,evidence_ref:d.evidence_ref.trim(),
    reason_zh:d.reason_zh.trim()
  }});
  return '已提交本次真实咨询的销售线索候选；未创建正式线索，等待主管审核';
});
register('lead-candidate-decision-form',async d=>{
  await api('/api/v1/lead-candidates/'+encodeURIComponent(d.candidate_id)+
    '/decision',{method:'POST',body:{
      decision:d.decision,evidence_ref:d.evidence_ref.trim(),
      reason_zh:d.reason_zh.trim()
    }});
  return d.decision==='reviewed_eligible'?
    '候选条件已独立核查通过，但未生成正式销售线索':
    '本次线索候选已驳回，未生成正式销售线索';
});
register('conversion-readiness-request-form',async d=>{
  await api('/api/v1/conversion-readiness',{method:'POST',body:{
    candidate_id:d.candidate_id,evidence_ref:d.evidence_ref.trim(),reason_zh:d.reason_zh.trim()
  }});
  return '已登记转换预审，正式销售线索创建仍关闭';
});
register('conversion-readiness-decision-form',async d=>{
  await api('/api/v1/conversion-readiness/'+encodeURIComponent(d.review_id)+'/decision',
    {method:'POST',body:{decision:d.decision,
      evidence_ref:d.evidence_ref.trim(),reason_zh:d.reason_zh.trim()}});
  return d.decision==='cleared'?
    '预审条件核查通过，但不会创建正式线索或改变归因':
    '已驳回转换预审，没有生成正式线索';
});
register('conversion-readiness-revoke-form',async d=>{
  await api('/api/v1/conversion-readiness/'+encodeURIComponent(d.review_id)+'/revoke',
    {method:'POST',body:{evidence_ref:d.evidence_ref.trim(),reason_zh:d.reason_zh.trim()}});
  return '原转换预审许可已撤销，原审批决定保留不可改写';
});
register('attribution-dispute-request-form',async d=>{
  const parts=d.choice_key.split(':');
  if(parts.length!==2)throw Error('请先选中本人实际咨询与相关候选');
  await api('/api/v1/attribution-disputes',{method:'POST',body:{
    candidate_id:parts[0],own_event_id:parts[1],
    evidence_ref:d.evidence_ref.trim(),reason_zh:d.reason_zh.trim()
  }});
  return '跨员工归因争议已提交，原咨询与负责人保持不变';
});
register('attribution-dispute-decision-form',async d=>{
  await api('/api/v1/attribution-disputes/'+encodeURIComponent(d.dispute_id)+'/decision',
    {method:'POST',body:{decision:d.decision,
      evidence_ref:d.evidence_ref.trim(),reason_zh:d.reason_zh.trim()}});
  return d.decision==='upheld'?
    '异议成立，原候选不得通过归因预审；没有生成正式线索':
    '已驳回异议，原候选仍需单独通过转换预审';
});
register('final-lead-conversion-request-form',async d=>{
  await api('/api/v1/lead-conversions',{method:'POST',body:{
    readiness_id:d.readiness_id,evidence_ref:d.evidence_ref.trim(),
    reason_zh:d.reason_zh.trim()
  }});
  return '正式销售线索转换申请已提交，等待独立主管最终批准；尚未创建线索';
});
register('final-lead-conversion-decision-form',async d=>{
  await api('/api/v1/lead-conversions/'+encodeURIComponent(d.authorization_id)+
    '/decision',{method:'POST',body:{
      decision:d.decision,evidence_ref:d.evidence_ref.trim(),
      reason_zh:d.reason_zh.trim()
    }});
  return d.decision==='approved'?
    '最终授权已通过，但正式线索尚未创建；需原申请人再次确认执行':
    '最终转换已驳回，没有创建销售线索';
});
register('final-lead-conversion-execute-form',async d=>{
  const out=await api('/api/v1/lead-conversions/'+
    encodeURIComponent(d.authorization_id)+'/execute',{method:'POST',body:{}});
  if(!out?.lead_id)throw Error('没有返回已创建的正式线索，请核实实际业务状态');
  return '已原子创建一条正式销售线索；仍未自动关联学生、合同、收款或课时';
});
register('lead-student-link-request-form',async d=>{
  await api('/api/v1/lead-student-associations',{method:'POST',body:{
    lead_id:d.lead_id,student_id:d.student_id,
    reason_zh:d.reason_zh.trim(),evidence_ref:d.evidence_ref.trim()
  }});
  return '已提出与这一名学生的待核实关联；不会自动确认家庭或监护关系';
});
register('lead-student-link-decision-form',async d=>{
  await api('/api/v1/lead-student-associations/'+encodeURIComponent(d.request_id)+
    '/decision',{method:'POST',body:{
      decision:d.decision,reason_zh:d.reason_zh.trim(),
      evidence_ref:d.evidence_ref.trim()
    }});
  return d.decision==='approved_pending'?
    '已登记单名学生待核实关联，不代表监护身份或学生关系已确认':
    '已驳回指定学生的待核实关联';
});
register('lead-adjustment-request-form',async d=>{
  await api('/api/v1/lead-adjustments',{method:'POST',body:{
    lead_id:d.lead_id,action:d.action,
    ...(d.action==='correct_note'?{proposed_note:d.proposed_note.trim()}:{}),
    reason_zh:d.reason_zh.trim(),evidence_ref:d.evidence_ref.trim()
  }});
  return d.action==='invalidate'?
    '线索作废申请已提交，尚未作废，等待独立主管核查':
    '业务说明更正申请已提交，原始咨询和归因保持不变';
});
register('lead-adjustment-decision-form',async d=>{
  await api('/api/v1/lead-adjustments/'+encodeURIComponent(d.request_id)+
    '/decision',{method:'POST',body:{
      decision:d.decision,reason_zh:d.reason_zh.trim(),
      evidence_ref:d.evidence_ref.trim()
    }});
  return d.decision==='approved'?
    '独立主管已审核，线索状态或补充说明已留存不可改写记录':
    '已驳回该次线索调整申请';
});
register('student-link-verification-request-form',async d=>{
  if(d.action==='verify'&&!d.confirmation_ref.trim())
    throw Error('请填写对单名学生的人工核实依据');
  await api('/api/v1/lead-student-link-reviews',{method:'POST',body:{
    association_request_id:d.action==='verify'?d.verify_association:d.withdraw_association,
    action:d.action,
    ...(d.action==='verify'?{
      basis_kind:d.basis_kind,confirmation_ref:d.confirmation_ref.trim()
    }:{}),
    evidence_ref:d.evidence_ref.trim(),reason_zh:d.reason_zh.trim()
  }});
  return d.action==='verify'?
    '已申请核实这名学生与线索的实际关联，等待独立主管复核':
    '错误学生关联撤回申请已提交；原关联仍在，待主管审核';
});
register('student-link-verification-decision-form',async d=>{
  await api('/api/v1/lead-student-link-reviews/'+encodeURIComponent(d.review_id)+
    '/decision',{method:'POST',body:{
      decision:d.decision,evidence_ref:d.evidence_ref.trim(),reason_zh:d.reason_zh.trim()
    }});
  return d.decision==='rejected'?
    '本次核实或撤回申请已驳回，学生与线索状态没有变化':
    '已保存独立审核。仅改变所选学生的线索关联，家庭和监护关系仍未核实';
});
register('downstream-correction-request-form',async d=>{
  await api('/api/v1/downstream-student-corrections',{method:'POST',body:{
    association_request_id:d.association_request_id,
    evidence_ref:d.evidence_ref.trim(),reason_zh:d.reason_zh.trim()
  }});
  return '已登记指定学生的下游纠错案件，相关销售推进暂时隔离；并未撤回学生关联或改动商机、订单、财务';
});
register('downstream-correction-decision-form',async d=>{
  await api('/api/v1/downstream-student-corrections/'+encodeURIComponent(d.case_id)+
    '/decision',{method:'POST',body:{
      decision:d.decision,evidence_ref:d.evidence_ref.trim(),
      reason_zh:d.reason_zh.trim()
    }});
  return d.decision==='hold_active'?
    '已独立确认继续保护相关下游商机；错误学生关联尚未更正，财务和合同未变':
    '该次隔离保护申请已驳回，原业务记录未改变';
});
register('downstream-first-review-form',async d=>{
  await api('/api/v1/downstream-reconciliations/'+encodeURIComponent(d.case_id)+
    '/finding',{method:'POST',body:{
      finding:d.finding,
      student_evidence_ref:d.student_evidence_ref.trim(),
      opportunity_evidence_ref:d.opportunity_evidence_ref.trim(),
      finance_evidence_ref:d.finance_evidence_ref.trim(),
      reason_zh:d.reason_zh.trim()
    }});
  return d.finding==='original_student_confirmed'?
    '已记录原学生关联核实证据，尚未解除隔离，需另一名独立主管确认':
    '已记录错误学生关联，必须继续隔离并转跨模块人工纠错';
});
register('downstream-second-review-form',async d=>{
  await api('/api/v1/downstream-reconciliations/'+encodeURIComponent(d.finding_id)+
    '/resolution',{method:'POST',body:{
      resolution:d.resolution,
      evidence_ref:d.evidence_ref.trim(),reason_zh:d.reason_zh.trim()
    }});
  return d.resolution==='release_verified'?
    '若原关联已核实且完全没有订单、收退款、试课等影响，安全解除销售隔离':
    '已保留销售隔离，等待跨模块负责人另行完成实际纠错';
});
register('event-form',async d=>{
  const body={
    contact_id:d.contact_id,event_type:d.event_type,occurred_at:localIso(d.occurred_at)
  };
  const notes=typeof d.original_source_text==='string'?d.original_source_text.trim():'';
  if(!state.strict&&notes)body.original_source_text=notes;
  const created=await api('/api/v1/contact-events',{method:'POST',body});
  state.preferredEventId=created.event_id;
  return notes
    ?'一次真实咨询及沟通备注已登记，已自动选中本次咨询用于下一步创建线索'
    :'一次真实咨询已登记，已自动选中本次咨询用于下一步创建线索';
});
register('lead-form',async d=>{
  const lead=await api('/api/v1/leads',{method:'POST',body:{source_event_ref:d.source_event_ref}});
  state.preferredLeadId=lead.lead_id;
  return '咨询已转为销售线索，已选中新线索用于关联学生';
});
register('lead-link-form',async d=>{
  await api('/api/v1/leads/'+encodeURIComponent(d.lead_id)+'/students',{method:'POST',body:{
    student_ids:[d.student_id],evidence_ref:d.evidence_ref.trim()||'依据未填写（待核实）',confirmation_state:'pending_review'
  }});
  return '线索与学生已建立待核实关联';
});
register('opportunity-form',async d=>{
  const body={student_id:d.student_id};
  if(d.predicted_yuan.trim())body.predicted_amount_cents=cents(d.predicted_yuan.trim());
  await api('/api/v1/opportunities',{method:'POST',body});
  const hint=$('opportunity-carry-hint');
  if(hint){hint.hidden=true;hint.textContent='';}
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
$('lead-link-form').elements.lead_id.addEventListener('change',()=>syncLeadLinkCandidate(true));
$('student-access-entry')?.addEventListener('click',()=>{
  const note=$('student-access-note'),btn=$('student-access-entry');
  if(!note||!btn)return;
  note.hidden=!note.hidden;
  btn.setAttribute('aria-expanded',String(!note.hidden));
});
$('workspace').addEventListener('input',e=>{
  const form=e.target?.closest?.('form');
  if(form&&form.id!=='business-form'&&form.id!=='audit-form')form.dataset.userDirty='1';
});
$('workspace').addEventListener('change',e=>{
  const form=e.target?.closest?.('form');
  if(form&&form.id!=='business-form'&&form.id!=='audit-form')form.dataset.userDirty='1';
});
$('audit-type').addEventListener('change',fillAuditSelect);
$('refresh-button').addEventListener('click',()=>refresh().then(()=>toast(
  state.channelLoadError?'渠道目录读取失败，已清空旧数据':'当前权限范围内的数据已刷新',
  state.channelLoadError)).catch(e=>toast(e.message,true)));
$('logout-button').addEventListener('click',()=>logout());
fetch('/api/v1/health',{cache:'no-store'}).then(r=>r.json()).then(r=>{
  if(r?.data?.strict_employee_mode){
    $('login-form').hidden=true;
    $('external-login-form').querySelector('h2').textContent='严格员工测试模式登录';
  }
}).catch(()=>{});

