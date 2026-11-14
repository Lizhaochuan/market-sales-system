// Chinese-language demo UI. Data is always from the isolated API, never from
// localStorage, hardcoded students, or a direct CRM/finance connection.
const $=id=>document.getElementById(id);
const state={token:null,user:null,strict:false,view:'overview',channels:[],channelCatalog:null,channelLoadError:false,channelRequests:[],channelRequestLoadError:false,channelAuditHistory:[],channelAuditLoadError:false,campaignDrafts:[],campaignLoadError:false,campaignSalesReviews:[],campaignSalesLoadError:false,students:[],contacts:[],events:[],leads:[],opportunities:[],families:[],identityStaff:[],identityRequests:[],identityBindings:[],custodyRequests:[],custodyStaff:[],custodyActive:[],custodyReviews:[],relatedStudents:[],candidateConsultations:[],leadCandidates:[],readinessReviews:[],attributionDisputes:[],disputableCandidates:[],finalLeadConversions:[],leadStudentRequests:[],leadAdjustmentRequests:[],leadCorrectionNotes:[],studentLinkReviews:[],currentStudentLinks:[],downstreamCorrectionCases:[],downstreamCorrectionEligible:[],downstreamReconciliations:[],preferredEventId:null,preferredLeadId:null,capabilities:{}};
const viewInfo={
  overview:['业务总览','工作概览'],channels:['获客管理','获客渠道'],campaigns:['获客管理','市场活动'],students:['客户管理','学生客户'],
  contacts:['客户管理','家长与联系人'],leads:['获客管理','咨询与线索'],
  opportunities:['销售管理','销售商机'],interactions:['客户沟通','跟进记录'],
  families:['客户管理','家庭关系核实'],audit:['操作历史','业务变更记录'],identity:['访问安全','员工身份审批']
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
    leads:[state.leads,'lead_id',v=>'线索 · '+(v.contact_display_name||'未指定联系人')+' · '+labelStatus(v.lead_state)],
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
    if(res.status===401&&token===state.token&&state.token){logout(false);throw Error('当前登录已过期，请重新进入演示工作台');}
    throw Error(result.message||'操作未完成，请查看状态');
  }
  return result.data;
}
async function refresh(){
  const endpoints=state.strict?[
    ['campaignDrafts','/api/v1/marketing-campaigns/drafts'],
    ['campaignSalesReviews','/api/v1/marketing-campaigns/sales-reviews'],
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
    state.channelRequests=[];state.channelRequestLoadError=false;
    state.channelAuditHistory=[];state.channelAuditLoadError=false;state.custodyRequests=[];state.custodyStaff=[];state.custodyActive=[];state.custodyReviews=[];state.relatedStudents=[];state.candidateConsultations=[];state.leadCandidates=[];state.readinessReviews=[];state.attributionDisputes=[];state.disputableCandidates=[];state.finalLeadConversions=[];state.leadStudentRequests=[];state.leadAdjustmentRequests=[];state.leadCorrectionNotes=[];state.studentLinkReviews=[];state.currentStudentLinks=[];state.downstreamCorrectionCases=[];state.downstreamCorrectionEligible=[];state.downstreamReconciliations=[];}
  for(let i=0;i<endpoints.length;i++){
    const [key]=endpoints[i],r=results[i];
    if(key==='campaignSalesReviews'){
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
  state.token=null;state.user=null;state.capabilities={};state.strict=false;
  state.channels=[];state.channelCatalog=null;state.channelLoadError=false;
  state.campaignDrafts=[];state.campaignLoadError=false;
  state.campaignSalesReviews=[];state.campaignSalesLoadError=false;
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
  applyStrictLayout();
  for(const key of ['students','contacts','events','leads','opportunities','families','identityStaff','identityRequests','identityBindings','custodyRequests','custodyStaff','custodyActive','custodyReviews','relatedStudents','candidateConsultations','leadCandidates','readinessReviews','attributionDisputes','disputableCandidates','finalLeadConversions','leadStudentRequests','leadAdjustmentRequests','leadCorrectionNotes','studentLinkReviews','currentStudentLinks','downstreamCorrectionCases','downstreamCorrectionEligible','downstreamReconciliations'])state[key]=[];
  document.querySelectorAll('[data-manager-only]').forEach(el=>el.hidden=true);
  $('workspace').hidden=true;$('login-screen').hidden=false;
  $('login-form').reset();$('external-login-form').reset();$('audit-list').replaceChildren();
  if(notice)toast('已退出演示账号');
}
function applyStrictLayout(){
  const allowed=new Set(['overview','students','contacts','leads','channels','campaigns']);
  for(const nav of document.querySelectorAll('button[data-view]')){
    nav.hidden=(state.strict&&!allowed.has(nav.dataset.view))||
      (!state.strict&&nav.dataset.view==='campaigns');
  }
  const contactLink=$('contact-link-form');
  if(contactLink)contactLink.closest('.panel').hidden=false;
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
  state.strict=false;applyStrictLayout();
  $('staff-name').textContent=payload.data.display_name;
  $('staff-role').textContent=payload.data.role_label;
  $('avatar').textContent=payload.data.display_name.slice(0,1);
  $('login-screen').hidden=true;$('workspace').hidden=false;
  setView('overview');
  await refresh();
  return '已进入虚构数据演示工作台';
});
// A second, local-only test entrypoint to the same Chinese workbench.
 // It does NOT implement OIDC authorization-code/PKCE/MFA or production SSO.
register('external-login-form',async d=>{
  const signed=d.signed_token?.trim();
  if(!signed||signed.length>8192)throw Error('员工测试签名凭据无效');
  state.token=signed;
  let profile;
  try{profile=await api('/api/v1/me');}
  catch(e){state.token=null;throw e;}
  state.user=profile;
  state.capabilities=profile.capabilities||{};
  state.strict=state.capabilities.strict_employee_mode===true;
  applyStrictLayout();
  $('staff-name').textContent=profile.display_name;
  $('staff-role').textContent=state.strict?'已核实测试员工 · 低权限模式':'已核实测试员工';
  $('avatar').textContent=profile.display_name.slice(0,1);
  $('login-screen').hidden=true;$('workspace').hidden=false;
  setView('overview');
  await refresh();
  return state.strict?'已进入员工专属数据库严格权限测试模式':'已通过外部签名验证（隔离环境）';
});
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
$('refresh-button').addEventListener('click',()=>refresh().then(()=>toast(
  state.channelLoadError?'渠道目录读取失败，已清空旧数据':'当前权限范围内的数据已刷新',
  state.channelLoadError)).catch(e=>toast(e.message,true)));
$('logout-button').addEventListener('click',()=>logout());
setDefaultDate();
fetch('/api/v1/health',{cache:'no-store'}).then(r=>r.json()).then(r=>{
  if(r?.data?.strict_employee_mode){
    $('login-form').hidden=true;
    $('external-login-form').querySelector('h2').textContent='严格员工测试模式登录';
  }
}).catch(()=>{});
