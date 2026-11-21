const session = require('../../lib/session');
const mutations = require('../../lib/mutation-page');
const ui = require('../../lib/presentation');
const empty = {
  staffMode:false, staffApprovals:[], staffSelection:null, access:{}, name:'', nav:[], rows:[], staff:[], incoming:[], market:[], marketStats:null, results:[],
  report:null, dayTasks:[], overdue:[], approvals:[], supervision:[], cards:[], drill:null, searchRows:null,
  sources:[], campuses:[], options:null, filter:{}, filterMode:0, message:'', notice:'',
  date:ui.day(), section:'', busy:false, saving:false, conflict:false, retryable:false, dimension:{},
  reminders:[], marketHanded:[], rate:'', coverage:'', firstResponse:'', connection:'', costMissing:false, financeCoverage:'', noMatch:false,
};
const supervisionKeys = [
  ['appointment','预约督办'], ['followup','跟进督办'], ['arrangement','待补安排'], ['transfer','顾问转交'], ['collaboration','重点协同'],
];
const drillMetrics = new Set(['leads','students','won_leads','lost_leads','overdue_activities','overdue_primary_leads','missing_next']);
const modes = ['当前进展','建档日期','当期事件','历史时点'];

Page({
  data:{...empty, modes},
  onLoad() {
    this.unsubscribe = session.observeReset(() => {
      this.ticket = (this.ticket || 0) + 1;
      this.retryTask = null;
      this.phoneForLookup = '';
      this.setData({...empty});
    });
  },
  onUnload() { this.unsubscribe?.(); this.ticket = (this.ticket || 0) + 1; this.retryTask = null; },
  async onShow() {
    if (!session.identity()) return session.logout();
    await this.refresh();
  },
  async refresh() {
    const ticket = this.ticket = (this.ticket || 0) + 1;
    this.setData({busy:true, conflict:false, message:''});
    try {
      const me = session.identity();
      if (session.isStaffSession()) {
        const {items, approvals = []} = await session.readStaffTasks();
        if (this.ticket !== ticket) return;
        const schedules = ui.dueItems(items, this.data.date);
        const manager = me.capabilities?.strict_mobile_review === true;
        this.setData({staffMode:true, name:me.display_name, section:manager && this.data.section === 'staff-review' ? 'staff-review' : 'tasks',
          nav:[{id:'tasks',label:'待办'}, ...(manager ? [{id:'staff-review',label:'审批'}] : [])],
          staffApprovals:approvals, reminders:items, dayTasks:schedules.selected, overdue:schedules.overdue});
        return;
      }
      const options = await session.read('/options');
      const access = options.access || {};
      const nav = ui.tabs(access).map(([id,label]) => ({id,label}));
      const requested = this.data.section;
      const adminMarket = access.admin && ['market','market-intake','market-report'].includes(requested);
      const section = adminMarket || nav.some(item => item.id === requested) ? requested : nav[0].id;
      const [list, report, managerReport, market, marketStats] = await Promise.all([
        access.sales ? session.read() : null,
        access.sales ? session.read('/metrics') : null,
        access.sales_manager && Object.keys(this.data.filter).length ? session.read('/metrics', this.data.filter) : null,
        access.market ? session.read('/market') : null,
        access.market_manager ? session.read('/market-metrics') : null,
      ]);
      if (this.ticket !== ticket) return;
      const rows = (list?.items || []).map(row => ({...row, stageLabel:ui.stages[row.stage] || row.stage || '待核实',
        nextAt:ui.clock(row.next_action?.due_at)}));
      const incoming = (list?.incoming || []).map(row => ({...row, contact_name:rows.find(item=>item.id===row.lead_id)?.contact_name || '待接手客户'}));
      const schedules = ui.dueItems(report?.reminders || [], this.data.date);
      const supervision = supervisionKeys.flatMap(([key,label]) => (report?.[key+'_supervision']?.items || []).map(item => ({
        ...item, key, label, due:ui.clock(item.due_at), resolved: item.resolved_at || item.accepted_at ? ui.clock(item.resolved_at || item.accepted_at) : '',
        proof: item.evidence || item.resolution_state || (item.state==='completed' ? '接手已确认' : ''),
      })));
      const boss = managerReport || report;
      const sources = [{source:'',name:'全部来源'}, ...(report?.by_source || []).filter(row=>row.source).map(row=>({source:row.source,name:row.source}))];
      const campuses = [{id:'',name:'全部授权校区'}];
      const cs = options.campus;
      if (cs?.configured) {
        if (!cs.restricted || cs.grants.includes('@unassigned')) campuses.push({id:'@unassigned',name:'未归属'});
        for (const item of cs.choices) campuses.push({id:item.code,name:item.display_name});
      }
      this.setData({access, nav, name:me.display_name, options, section, rows, incoming, report:boss,
        market:market?.items || [], marketStats, searchRows:null, marketHanded:(market?.items || []).filter(item=>item.handoff_state==='sales'),
        approvals:report?.pending_approvals || [], supervision, sources, campuses,
        staff:[{id:'',display_name:'全部顾问'}, ...(list?.staff || [])],
        dayTasks:schedules.selected, overdue:schedules.overdue, reminders:report?.reminders || [],
        ...this.reportData(boss)});
    } catch (error) {
      if (this.ticket === ticket && !error.stale) this.setData({message:error.message});
    } finally {
      if (this.ticket === ticket) this.setData({busy:false});
    }
  },
  reportData(report) {
    const snapshot = report?.filters?.view_mode === 'snapshot';
    const event = report?.filters?.view_mode === 'event';
    const stats = snapshot ? report.snapshot_counts : event ? report.event_counts : report?.counts;
    const exceptions=['overdue_activities','overdue_primary_leads','missing_next'];
    const keys = Object.keys(stats || {}).filter(key=>Object.hasOwnProperty.call(ui.metricLabels,key));
    keys.sort((a,b)=>Number(exceptions.includes(b))-Number(exceptions.includes(a)));
    const cards = keys.map(key=>({key,label:ui.metricLabels[key],value:stats[key],
      drill:snapshot ? ['snapshot_leads','snapshot_open','snapshot_won','snapshot_lost'].includes(key) : event || drillMetrics.has(key)}));
    const q = report?.qualification;
    if (q) for (const key of ['valid','invalid','pending']) cards.push({key:'qualification_'+key,label:ui.metricLabels['qualification_'+key],value:q[key],drill:true});
    const first = report?.first_response_sla;
    return {cards, rate:q ? ui.percent(q.valid_rate) : '', coverage:q ? ui.percent(q.coverage) : '',
      firstResponse:first ? first.on_time+' 准时 · '+first.overdue+' 超时' : '', connection:report?.connection_24h ? ui.percent(report.connection_24h.rate) : '', costMissing:report?.channel_cost_status === 'COST_NOT_CONFIGURED',
      financeCoverage:report?.snapshot_cash?.status || ''};
  },
  select(event) { this.setData({section:event.currentTarget.dataset.id, drill:null, staffSelection:null, message:'', notice:''}); },
  selectDate(event) {
    const date = event.detail.value;
    const due = ui.dueItems(this.data.reminders || [], date);
    this.setData({date,dayTasks:due.selected,overdue:due.overdue});
  },
  async search(event) {
    const q = event.detail.value.query?.trim();
    if (!q) return this.setData({searchRows:null});
    try {
      const result = await session.read('', {q});
      this.setData({searchRows:result.items.map(row=>({...row, stageLabel:ui.stages[row.stage] || '待核实', nextAt:ui.clock(row.next_action?.due_at)}))});
    } catch (error) { if (!error.stale && session.identity()) this.setData({message:error.message}); }
  },
  async lookup(event) {
    if (this.data.saving || this.retryTask) return;
    const phone = event.detail.value.phone?.trim();
    if (!phone) return this.setData({message:'请输入电话号码'});
    this.phoneForLookup = phone;
    this.setData({results:[], noMatch:false, conflict:false, message:''});
    await mutations.run(this, '/lookup', {phone});
  },
  claim(event) {
    const v = event.detail.value;
    return this.change(() => ['/'+event.currentTarget.dataset.id+'/claim',
      {phone:this.phoneForLookup, next:ui.action(v.title,v.date,v.time)}]);
  },
  create(event) {
    const v = event.detail.value;
    return this.change(() => ['', {contact_name:v.name, ...(v.student ? {student_name:v.student} : {}),
      contact_info:this.phoneForLookup, origin_group:'sales', source:v.source, next:ui.action(v.title,v.date,v.time)}]);
  },
  marketCreate(event) {
    const v = event.detail.value;
    return this.change(() => ['/market',{phone:v.phone,contact_name:v.name,student_name:v.student,source:v.source,notes:v.notes}]);
  },
  accept(event) {
    const item = this.data.incoming.find(row=>row.id===event.currentTarget.dataset.id);
    if (item) return this.change(() => ['/'+item.lead_id+'/accept-transfer',{record_id:item.id,expected_version:item.version}]);
  },
  openStaffAction(event) {
    if (this.data.saving || this.retryTask) return;
    const {id, operation} = event.currentTarget.dataset;
    const item = (operation === 'followup' ? this.data.reminders : this.data.staffApprovals).find(row => row.id === id);
    if (item) this.setData({staffSelection:{...item, operation}, message:'', notice:''});
  },
  closeStaffAction() {
    if (!this.data.saving && !this.retryTask) this.setData({staffSelection:null});
  },
  submitStaffAction(event) {
    const item = this.data.staffSelection;
    if (!item) return;
    const form = event.detail.value;
    return this.change(() => {
      const path = '/' + item.operation + '/' + item.id;
      if (item.operation === 'followup') {
        const next = ui.action(form.title, form.date, form.time);
        return [path,{expected_version:item.expected_version,result:form.result,notes:form.notes,title:next.title,due_at:next.due_at},true];
      }
      if (!['approve','reject'].includes(form.decision)) throw new Error('请选择审批结果');
      return [path,{approved:form.decision === 'approve',evidence:form.evidence},true];
    });
  },
  async change(build) {
    if (this.data.conflict) return;
    try { const [path,body,staffAction] = build(); await mutations.run(this,path,body,staffAction); }
    catch (error) { this.setData({message:error.message}); }
  },
  retry() { return mutations.retry(this); },
  async afterMutation(result) {
    if (Array.isArray(result?.items) && Object.hasOwnProperty.call(result,'phone')) {
      this.setData({results:result.items, noMatch:result.items.length===0});
      return;
    }
    this.phoneForLookup = '';
    this.setData({results:[], noMatch:false, staffSelection:null, notice:'已保存'});
    await this.refresh();
    if (result?.lead_id && this.data.access.sales && this.data.section==='customers') this.openById(result.lead_id);
  },
  dimensionChange(event) { this.setData({['dimension.'+event.currentTarget.dataset.id]:Number(event.detail.value)}); },
  filterChange(event) { this.setData({filterMode:Number(event.detail.value)}); },
  async filters(event) {
    const v = event.detail.value, mode = this.data.filterMode;
    const owner = this.data.staff[this.data.dimension?.owner || 0]?.id;
    const source = this.data.sources[this.data.dimension?.source || 0]?.source;
    const campus = this.data.campuses[this.data.dimension?.campus || 0]?.id;
    const filter = {...(owner ? {owner_id:owner} : {}), ...(source ? {source} : {}), ...(campus ? {campus_id:campus} : {})};
    try {
      if (mode === 3) Object.assign(filter,{view_mode:'snapshot',as_of_at:ui.time(v.asDate,v.asTime)});
      if (mode === 1 || mode === 2) {
        if (!v.to || v.from > v.to) throw new Error('请选择有效的日期范围');
        const exclusiveEnd = ui.day(Date.parse(ui.time(v.to,'00:00')) + 86400000);
        Object.assign(filter,{view_mode:mode===1?'cohort':'event',start_at:ui.time(v.from,'00:00'),end_at:ui.time(exclusiveEnd,'00:00')});
      }
      this.setData({filter,drill:null});
      await this.refresh();
    } catch (error) { this.setData({message:error.message}); }
  },
  clearFilters() { this.setData({filter:{},filterMode:0,dimension:{},drill:null}); return this.refresh(); },
  openDrill(event) { return this.loadDrill(event.currentTarget.dataset.id,1); },
  nextDrill() { const d=this.data.drill; if(d.page*d.page_size<d.total) return this.loadDrill(d.metric,d.page+1); },
  prevDrill() { const d=this.data.drill; if(d.page>1) return this.loadDrill(d.metric,d.page-1); },
  closeDrill() { this.setData({drill:null}); },
  async loadDrill(metric,page) {
    const ticket = this.ticket;
    this.setData({message:''});
    try {
      const d = await session.read('/metrics/drilldown',{...this.data.filter,metric,page});
      if (ticket!==this.ticket || this.data.section!=='boss') return;
      this.setData({drill:{...d,label:ui.metricLabels[metric],items:d.items.map(item=>({
        ...item, lead:item.lead_id || (metric.includes('students') ? '' : item.id), at:ui.clock(item.recorded_at || item.created_at),
      }))}});
    } catch (error) { if(!error.stale && session.identity()) this.setData({message:error.message}); }
  },
  open(event) { this.openById(event.currentTarget.dataset.id, event.currentTarget.dataset.mode, event.currentTarget.dataset.record); },
  openById(id, mode, record) {
    if (!id) return;
    wx.navigateTo({url:'/pages/lead/index?id='+encodeURIComponent(id)+(mode ? '&mode='+encodeURIComponent(mode) : '')+(record ? '&record='+encodeURIComponent(record) : '')});
  },
  logout() { session.logout(); },
});
