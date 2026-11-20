const session = require('../../lib/session');
const mutations = require('../../lib/mutation-page');
const ui = require('../../lib/presentation');

const active = new Set(['open','pending','confirmed','rescheduled','in_progress']);
const modes = [
  {id:'summary',label:'客户概览'},{id:'followup',label:'记跟进'},{id:'appointment',label:'新预约'},
];
const results = [['communicated','已完成沟通'],['failed','未联系成功'],['waiting','已发消息待回复'],['other','其他']];
const methods = [['phone','电话'],['wechat_text','微信文字'],['wechat_voice','微信语音'],['video','视频'],['online_other','其他线上方式']];
const titles = {confirm:'确认预约',start:'开始执行',reschedule:'预约改期',completed:'已实际完成',no_show:'未到场',cancelled:'已取消'};
const empty = {lead:null, members:[], activities:[], timeline:[], history:[], approvals:[], targets:[], collaborations:[],
  form:{}, draft:null, message:'', notice:'', saving:false, retryable:false, conflict:false};
const label = value => ui.states[value] || value;
const missing = value => value == null || !String(value).trim();
const choice = (list, id) => list[Math.max(0,list.findIndex(value=>value[0]===id))];

function nextFrom(value) { return ui.action(value.next_title,value.next_date,value.next_time); }
function appointmentFrom(value) {
  const type=value.appType;
  return {type,due_at:ui.time(value.appDate,value.appTime),state:value.confirmed?'confirmed':'pending',
    ...(value.appStudent ? {student_id:value.appStudent} : value.appStudentName ? {student_name:value.appStudentName} : {}),
    ...(type==='trial' ? {place:value.place,course:value.course} : {})};
}
function draftValues(form) {
  return Object.fromEntries(Object.entries({
    method:form.method, result:form.result, failure_reason:form.failure_reason, notes:form.notes,
    next_title:form.next_title, next_at:form.next_date&&form.next_time ? form.next_date+'T'+form.next_time : '',
  }).filter(([,value])=>typeof value==='string' && value.length));
}
function formDefaults(draft = {}) {
  const m=choice(methods,draft.method),r=choice(results,draft.result);
  return {method:m[0],methodIndex:methods.indexOf(m), result:r[0],resultIndex:results.indexOf(r),
    failure_reason:draft.failure_reason || '',notes:draft.notes || '',next_title:draft.next_title || '',
    next_date:draft.next_at?.slice(0,10) || '', next_time:draft.next_at?.slice(11,16) || '',
    appType:'meeting',confirmed:false,appDate:ui.day(),appTime:'',studentIds:[]};
}
function reviews(detail, actor) {
  const entries = [];
  for (const record of detail.records) {
    const b=record.body;
    let entry;
    if (record.kind==='quotes' && record.state==='draft' && b.discount_state==='pending' && b.quoted_by!==actor)
      entry={label:'优惠独立审批',action:'approve-discount',reject:'reject-discount'};
    if (record.kind==='enrollments' && record.state!=='cancelled' && !b.agreement_confirmed && b.submitted_by!==actor)
      entry={label:'独立核实报名协议',action:'confirm-agreement'};
    if (record.kind==='corrections' && record.state==='pending' && b.requested_by!==actor) {
      if (b.type==='enrollment_correction') entry={label:'报名纠正审批',action:'approve-correction',reject:'reject-correction'};
      if (b.type==='lead_transfer' && b.target_owner!==actor) entry={label:'顾问转交独立审批',action:'approve-transfer',reject:'reject-transfer'};
    }
    if (entry) entries.push({...entry,id:record.id,evidence:b.reason || ''});
  }
  const q=detail.governance?.qualification_request;
  const campus=detail.governance?.campus_request;
  if(q && q.actor_user_id!==actor) entries.push({id:q.id,label:'线索核验审批',action:'decide-qualification',reject:'decide-qualification',evidence:q.facts.evidence});
  if(campus && campus.actor_user_id!==actor) entries.push({id:campus.id,label:'服务校区转归审批',action:'decide-campus-transfer',reject:'decide-campus-transfer',evidence:campus.facts.evidence});
  return entries;
}
Page({
  data:{...empty, modes, methodLabels:methods.map(x=>x[1]), resultLabels:results.map(x=>x[1]),
    transitions:[{id:'confirm',label:titles.confirm},{id:'start',label:titles.start},{id:'reschedule',label:titles.reschedule},
      {id:'completed',label:titles.completed},{id:'no_show',label:titles.no_show},{id:'cancelled',label:titles.cancelled}]},
  onLoad(query) {
    this.id=query.id;
    this.readOnly=query.mode==='audit';
    this.preferred=query.record;
    this.setData({form:formDefaults(), mode:query.mode || 'summary'});
    this.unsubscribe=session.observeReset(()=>{
      this.ticket=(this.ticket || 0)+1;
      this.retryTask=null;
      this.detail=null;
      this.setData({...empty, version:null, selected:null, members:[], failureReasons:[], recipients:[], reviewChoices:[]});
    });
  },
  onUnload() { this.unsubscribe?.(); this.ticket=(this.ticket || 0)+1; this.retryTask=null; this.detail=null; },
  onShow() { return this.refresh(); },
  async refresh() {
    const t=this.ticket=(this.ticket || 0)+1;
    this.setData({busy:true,conflict:false,message:''});
    try {
      const me=session.identity();
      const [detail,options,history,report,list]=await Promise.all([
        session.read('/'+this.id),
        session.read('/options'),
        this.readOnly ? session.read('/'+this.id+'/history') : null,
        this.readOnly ? null : session.read('/metrics'),
        me?.workspace_access?.sales ? session.read() : null,
      ]);
      if(this.ticket!==t) return;
      this.detail=detail;
      const w=detail.workflow;
      const isOwner=detail.lead.owner_user_id===me.staff_id;
      const manager=options.manager && !this.readOnly;
      const leadMode=this.data.mode;
      const now=Date.now();
      const activities=detail.records.filter(record=>['tasks','appointments'].includes(record.kind)).map(record=>({
        id:record.id,kind:record.kind,state:record.state,version:record.version, title:record.body.title,
        local:ui.clock(record.body.due_at), label:label(record.state), active:active.has(record.state),
        overdue:active.has(record.state)&&Date.parse(record.body.due_at)<now,
        location:record.body.place, course:record.body.course, result:record.body.feedback || record.body.completion?.notes || '',
      }));
      const selected=activities.find(row=>row.id===(this.preferred || this.data.selected?.id)) || activities.find(row=>row.id===w?.primary_activity_id);
      const lead=list?.items.find(row=>row.id===this.id);
      const display=detail.events.map(event=>({key:event.event_name, label:ui.events[event.event_name] || event.event_name,
        at:ui.clock(event.happened_at), actor:event.actor_name || '系统记录',
        text:event.after_business_json?.notes || event.after_business_json?.feedback || ''}));
      const editableModes=modes.filter(item=>item.id==='summary'||isOwner||manager);
      const targets=[];
      if (manager) {
        if (!w && detail.needs_arrangement) targets.push({id:'arrange',label:'待补安排',action:'supervise-arrangement'});
        if (w?.terminal_state==='open') {
          targets.push({id:'collaboration',label:'重点协同',action:'supervise-collaboration'});
          for (const row of activities.filter(record=>record.overdue)) targets.push({id:row.id,label:row.title,action:row.kind==='tasks'?'supervise-followup':'supervise-appointment'});
          if (list?.staff.some(row=>row.id!==detail.lead.owner_user_id)) targets.push({id:'transfer',label:'顾问转交',action:'supervise-transfer'});
        }
      }
      this.setData({lead:{name:lead?.contact_name || this.data.lead?.name || '客户详情', owner:lead?.owner_name || '',
        stage:ui.stages[w?.stage] || w?.stage || '待核实', state:label(w?.terminal_state) || '',
        doNotContact:!!w?.do_not_contact, campus:detail.governance?.campus_code || '未归属',
        verdict:w && detail.governance?.qualification?.verdict==='pending'?'待核验':label(detail.governance?.qualification?.verdict)},
        members:detail.students.map(row=>({id:row.id,name:row.display_name})), version:w?.version ?? null,
        isOwner,manager,editableModes,canEdit:!this.readOnly && !!w && w.terminal_state==='open' && (isOwner || manager),
        canRepair:!this.readOnly && !w && detail.needs_arrangement && (isOwner || manager),
        readOnly:this.readOnly, mode:this.readOnly?'audit':leadMode,
        timeline:display, history:(history?.items || []).map(item=>({id:item.id,version:item.version,kind:item.kind,
          at:ui.clock(item.recorded_at),state:label(item.state)})),
        activities, selected, draft:!this.readOnly && isOwner ? detail.records.find(row=>row.kind==='workflow-drafts')?.body.draft || null : null,
        failureReasons:options.failure_reasons[this.data.form.method] || options.failure_reasons.phone,
        reasonMap:options.failure_reasons, approvals:manager ? reviews(detail,me.staff_id) : [], targets,
        recipients:(list?.staff || []).filter(row=>row.id!==detail.lead.owner_user_id),
        collaborations:isOwner&&!this.readOnly ? (report?.collaboration_supervision?.items || []).filter(row=>row.lead_id===this.id&&!row.resolved_at) : [],
      });
    } catch(error) {
      if(this.ticket===t && !error.stale) this.setData({message:error.message});
    } finally { if(this.ticket===t) this.setData({busy:false}); }
  },
  setMode(event) { this.setData({mode:event.currentTarget.dataset.mode,message:''}); },
  selectActivity(event) {
    const selected=this.data.activities.find(row=>row.id===event.currentTarget.dataset.id);
    if (!selected) return;
    this.preferred=selected.id;
    this.setData({selected,mode:selected.kind==='tasks'?'followup':'activity',message:''});
  },
  edit(event) { this.setData({['form.'+event.currentTarget.dataset.key]:event.detail.value}); },
  pick(event) {
    const key=event.currentTarget.dataset.key, index=Number(event.detail.value);
    if(key==='method') this.setData({'form.method':methods[index][0],'form.methodIndex':index,'form.failure_reason':'',failureReasons:this.data.reasonMap[methods[index][0]] || this.data.reasonMap.phone});
    if(key==='result') this.setData({'form.result':results[index][0],'form.resultIndex':index});
    if(key==='failure_reason') this.setData({'form.failure_reason':this.data.failureReasons[index]});
    if(key==='appStudent') this.setData({'form.appStudent':this.data.members[index].id,'form.appStudentName':this.data.members[index].name});
    if(key==='target') this.setData({target:this.data.targets[index]});
    if(key==='recipient') this.setData({recipient:this.data.recipients[index]});
  },
  setType(event) { this.setData({'form.appType':event.currentTarget.dataset.id}); },
  setTransition(event) { this.setData({transition:event.currentTarget.dataset.id}); },
  setDecision(event) { this.setData({decision:event.currentTarget.dataset.id, reviewId:event.currentTarget.dataset.record}); },
  restore() { this.setData({form:formDefaults(this.data.draft),mode:'followup',notice:'已恢复个人草稿，请核对后再正式保存'}); },
  change(action, build, versioned=true) {
    if(this.readOnly || this.data.conflict || this.data.busy) return;
    try {
      const body=build();
      return mutations.run(this,'/'+this.id+'/'+action,versioned ? {...body,expected_version:this.data.version} : body);
    } catch(error) { this.setData({message:error.message}); }
  },
  saveDraft() { return this.change('draft',()=>({draft:draftValues(this.data.form)})); },
  saveFollowup() {
    const f=this.data.form;
    return this.change('followup',()=>{
      if(f.result==='waiting'&&!['wechat_text','online_other'].includes(f.method)) throw new Error('待回复适用于已发送消息');
      if(f.result==='failed'&&missing(f.failure_reason)) throw new Error('请选择未联系成功原因');
      if(this.data.members.length>1&&!f.studentIds.length) throw new Error('请选择本次实际沟通的学生');
      const selected=this.data.selected;
      return {method:f.method,result:f.result,notes:f.notes,
        ...(f.result==='failed' ? {failure_reason:f.failure_reason} : {}),
        ...(f.studentIds.length ? {student_ids:f.studentIds} : {}),
        ...(selected?.active&&selected.kind==='tasks' ? {task_id:selected.id} : {}), next:nextFrom(f)};
    });
  },
  saveAppointment() { return this.change('appointment',()=>({appointment:appointmentFrom(this.data.form)})); },
  saveActivity() {
    const f=this.data.form,t=this.data.transition,item=this.data.selected;
    if (!item?.active || !t) return this.setData({message:'请选择待处理预约和操作'});
    return this.change('activity',()=>{
      const common={record_id:item.id,transition:t==='confirm'?'confirmed':t};
      if(t==='reschedule') return {...common,due_at:ui.time(f.appDate,f.appTime),reason:f.reason};
      if(['completed','no_show','cancelled'].includes(t)) {
        if(t==='completed' && !f.actual) throw new Error('请确认到场及实际完成');
        const next=item.id===this.detail.workflow?.primary_activity_id || f.next_title ? nextFrom(f) : null;
        return {...common,feedback:f.reason,...(next ? {next} : {})};
      }
      return common;
    });
  },
  repair() { return this.change('arrange',()=>({next:nextFrom(this.data.form),
    ...(!this.detail.lead.owner_user_id && this.data.recipient ? {owner_user_id:this.data.recipient.id} : {}),
  }),false); },
  review(event) {
    const item=this.data.approvals.find(row=>row.id===event.currentTarget.dataset.id);
    const approved=this.data.decision==='approve';
    if (!item || this.data.reviewId!==item.id || (!approved && !item.reject)) return this.setData({message:'请选择本申请的审批结果'});
    const v=event.detail.value, action=approved?item.action:item.reject;
    if(action.startsWith('decide-')) return this.change(action,()=>({request_id:item.id,approved,evidence:v.reason}),false);
    if(action==='confirm-agreement') return this.change(action,()=>({record_id:item.id,evidence_ref:v.reason}));
    return this.change(action,()=>({record_id:item.id,reason:v.reason,
      ...(action==='approve-correction' && v.next_title ? {next:nextFrom(v)} : {}),
      ...(action==='approve-correction' && v.cancel ? {cancel_enrollment:true} : {})}));
  },
  supervise(event) {
    const target=this.data.target,v=event.detail.value;
    if (!target) return this.setData({message:'请选择督办类型'});
    return this.change(target.action,()=>{
      const payload={reason:v.reason,due_at:ui.time(v.date,v.time)};
      if(target.action==='supervise-transfer'){
        if(!this.data.recipient) throw new Error('请选择接收顾问');
        return {...payload,owner_user_id:this.data.recipient.id};
      }
      const type=target.action==='supervise-appointment'?'appointment':target.action==='supervise-followup'?'task':'';
      if(type) Object.assign(payload,{[type+'_id']:target.id,[type+'_version']:this.data.activities.find(row=>row.id===target.id).version});
      return payload;
    },target.action==='supervise-transfer');
  },
  collaborate(event) {
    return this.change('complete-collaboration',()=>({request_id:event.currentTarget.dataset.id,evidence:event.detail.value.evidence}),false);
  },
  retry() { return mutations.retry(this); },
  async afterMutation(result) {
    const draft=result?.saved_as==='DRAFT_ONLY';
    if(!draft) {
      this.preferred=null;
      this.setData({mode:'summary',form:formDefaults(),transition:'',target:null,recipient:null,decision:'',reviewId:''});
    }
    this.setData({notice:draft?'已保存个人草稿':'已保存，后续安排已保留'});
    await this.refresh();
  },
});
