const shifted = value => new Date(new Date(value).getTime() + 8 * 3600000).toISOString();
const day = (value = Date.now()) => shifted(value).slice(0, 10);
const clock = value => value ? shifted(value).slice(0, 16).replace('T', ' ') : '待安排';
const time = (date, hour) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !/^\d{2}:\d{2}$/.test(hour || '')) throw new Error('请选择上海日期和时间');
  return date + 'T' + hour + ':00+08:00';
};
const action = (title, date, hour, kind = 'call') => {
  if (!title?.trim()) throw new Error('请输入下一步事项');
  return {action: kind, method: 'phone', title: title.trim(), due_at: time(date, hour)};
};
const percent = value => value == null ? '暂无样本' : (Math.round(value * 1000) / 10) + '%';
const states = {open:'跟进中', pending:'待确认', confirmed:'已确认', rescheduled:'已改期', in_progress:'进行中', completed:'已完成', cancelled:'已取消', no_show:'未到场', won:'成交结案', lost:'流失结案', valid:'有效', invalid:'无效', duplicate:'已归并'};
const stages = {needs_discovery:'待了解需求', needs_confirmed:'需求已核实', courses_introduced:'已介绍课程', trial_booked:'已预约试听', trial_completed:'已完成试听', enrollment_intent:'有报名意向', enrolling:'报名办理中', paused:'暂缓'};
const events = {
  LEAD_DESK_CREATED:'录入线索', V34_INTAKE:'接单并安排下一步', V34_COMMUNICATION:'记录沟通',
  V34_MARKET_HANDOFF_ACCEPTED:'接收市场线索', V34_FOLLOWUP_COMPLETED:'完成跟进', V34_APPOINTMENT_CREATED:'新增预约',
  V34_ACTIVITY_RESCHEDULED:'预约改期', V34_ACTIVITY_COMPLETED:'记录活动结果', V34_ACTIVITY_NO_SHOW:'记录未到场',
  V34_TRANSFER_REQUESTED:'申请顾问转交', V34_TRANSFER_ACCEPTED:'顾问确认接手',
  V34_LEAD_QUALIFICATION_EFFECTIVE:'核验生效', V34_SERVICE_CAMPUS_EFFECTIVE:'服务校区生效',
};
const metricLabels = {
  leads:'线索数', students:'去重学生', won_leads:'成交结案', lost_leads:'流失结案',
  qualification_valid:'有效线索', qualification_invalid:'无效线索', qualification_pending:'待核验',
  historical_enrollment_success_students:'历史首次报名成功学生', enrollment_success_orders:'当前有效报名订单',
  overdue_activities:'逾期活动', overdue_primary_leads:'首要安排逾期', missing_next:'待补下一步',
  created_leads:'新增线索', communication_events:'沟通记录', meeting_completion_events:'完成面谈',
  trial_completion_events:'完成试听', first_enrollment_success_events:'首次报名成功事件',
  won_events:'成交事件', lost_events:'失单事件', snapshot_leads:'历史线索', snapshot_students:'历史去重学生',
  snapshot_open:'历史跟进中', snapshot_won:'历史成交', snapshot_lost:'历史失单',
};
function tabs(access) {
  if (access.admin || access.sales_manager) return [['tasks','待办'],['customers','客户'],['boss','驾驶舱'],['review','审批']];
  if (access.sales) return [['tasks','待办'],['customers','客户'],['calendar','日程'],['handoff','待接手']];
  if (access.market_manager) return [['market','市场线索'],['market-intake','录入'],['market-report','市场报表'],['account','账号']];
  if (access.market) return [['market','市场线索'],['market-intake','录入'],['market-handoff','已接收'],['account','账号']];
  return [['account','账号']];
}
function dueItems(reminders, selectedDay, current = new Date()) {
  const active = reminders.filter(item => item.due_at).slice().sort((a,b) => Date.parse(a.due_at) - Date.parse(b.due_at));
  const format = item => ({...item, local: clock(item.due_at), late: Date.parse(item.due_at) < Number(current)});
  return {
    selected: active.filter(item => day(item.due_at) === selectedDay).map(format),
    overdue: active.filter(item => Date.parse(item.due_at) < Number(current) && day(item.due_at) !== selectedDay).map(format),
  };
}
module.exports = {day, clock, time, action, percent, states, stages, events, metricLabels, tabs, dueItems};
