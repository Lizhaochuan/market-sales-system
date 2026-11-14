// V3.2-32: deterministic human-readable UAT worklist from the isolated,
// restricted PostgreSQL read-only report. This NEVER attests real-world approval.
import {createHash} from 'node:crypto';

export const UAT_TASKS=Object.freeze({
 sales_contract_party:{
  department:'sales',owner:'销售负责人、合同签约责任人',
  evidence:'正确学生的独立身份核验、合同签约主体与合法更正依据（脱敏引用）',
  acceptance:'两人分别确认合同主体与目标学生相符，历史合同留存不覆盖',
  failure:'继续冻结关联更正；提交合同/学生主体争议人工复核'
 },
 sales_attribution_policy:{
  department:'sales',owner:'销售负责人、业绩审批责任人',
  evidence:'订单、SaleEvent、业绩/佣金原始版本与补偿调整政策',
  acceptance:'原成交及归因历史可追溯，新增补偿和业绩调整均有独立审批',
  failure:'不得直接改写业绩、原订单归因或佣金历史'
 },
 sales_release_responsibility:{
  department:'sales',owner:'销售负责人、财务与教务终验责任人',
  evidence:'跨模块 R01—R10 验收责任矩阵、各部门独立签署计划',
  acceptance:'合同、款项、课时、数据版本均有终验及解除隔离的单独授权流程',
  failure:'保持 hold_active；不得把三方方案审核当作实际执行完成'
 },
 finance_authority_owner:{
  department:'finance',owner:'财务负责人、收付权威系统所有人',
  evidence:'真实财务账套及权威数据源所有人签署的授权说明',
  acceptance:'权威来源、责任人和机构账套可独立核实且权限可撤销',
  failure:'暂停财务对接；不能用 Excel/人工描述代替唯一权威'
 },
 finance_tenant_order_mapping:{
  department:'finance',owner:'财务负责人、合同责任人',
  evidence:'机构、原订单、付款/退款/拒付唯一经济事件及用途映射',
  acceptance:'收款归属、共用付款及退款对象逐笔核实，不影响其他学生',
  failure:'维持资金归属隔离；人工解决付款用途争议'
 },
 finance_readonly_credentials:{
  department:'finance',owner:'财务系统管理员、信息安全负责人',
  evidence:'只读服务身份、授权受众、密钥撤销与最小读取字段证明',
  acceptance:'只能查询，不能创建付款、发起退款、重分配或修改原单',
  failure:'拒绝联调凭证；不得在 GitHub 或日志保存真实密钥'
 },
 finance_reconciliation:{
  department:'finance',owner:'财务负责人、对账人员',
  evidence:'经济事件唯一键、金额守恒、版本水位、退款与拒付对账结果',
  acceptance:'原收/退款流水与分配余额一致，补偿另记，历史不删',
  failure:'将 unknown、迟到、冲突款项保留待查；禁止实际补偿'
 },
 academic_authority_owner:{
  department:'academic',owner:'教务负责人、CRM 系统所有人',
  evidence:'正式 CRM 权威机构负责人和只读查询许可',
  acceptance:'能证明课包/上课事实来自唯一授权来源，不取信页面自报',
  failure:'不得把 CRM 未返回结果解释为未开课'
 },
 academic_tenant_student_mapping:{
  department:'academic',owner:'教务负责人、学生身份复核人',
  evidence:'机构 tenant、唯一学生 ID、package_id 与原订单映射',
  acceptance:'一名学生单独核验，同家庭兄弟姐妹不自动合并权益',
  failure:'暂停权益处理；纠正错绑需重新核对目标学生'
 },
 academic_readonly_credentials:{
  department:'academic',owner:'CRM 系统管理员、信息安全负责人',
  evidence:'独立只读服务账号、授权范围、失效撤销和安全日志',
  acceptance:'不授予发课、消课、修改学生或扣课任何写权限',
  failure:'禁止连接真实教务系统并升级安全负责人'
 },
 academic_attendance_balance:{
  department:'academic',owner:'教务负责人、课包核对人员',
  evidence:'实际排课、已授、已消、剩余课时和 CRM 原版本快照',
  acceptance:'已上课历史不可删，超时 unknown 必须查询权威最终结果',
  failure:'不重复发课、退课或扣课；保留人工待核'
 },
 security_source_trust:{
  department:'security',owner:'独立信息安全负责人',
  evidence:'签名信任锚、颁发者、受众、租户绑定、密钥轮换与撤销说明',
  acceptance:'来自预先审批的真实来源而不是客户端自称 verified',
  failure:'冻结来源并登记签名/身份异常事件'
 },
 security_durable_replay:{
  department:'security',owner:'信息安全负责人、平台运维负责人',
  evidence:'事务性持久幂等账本、并发重放与灾备恢复演练记录',
  acceptance:'同一经济/课包事件不能因并发、重启或重试重复执行',
  failure:'不得以进程内 Map 或哈希当作生产防重放方案'
 },
 security_complete_watermark:{
  department:'security',owner:'信息安全负责人、接口运维负责人',
  evidence:'完整分页/游标/水位、迟到事件、缺页重拉和全量完成证明',
  acceptance:'连续版本并确认源端全量结束、没有遗漏事件',
  failure:'缺页、跳号、回退全部阻断联调验收'
 },
 security_incident_recovery:{
  department:'security',owner:'信息安全负责人、财务/教务值班责任人',
  evidence:'超时、撤销、拒付、结果 unknown 的人工升级与恢复 SOP',
  acceptance:'恢复后独立重新验证版本及业务余额，不凭重复执行试探',
  failure:'继续隔离并升级人工；不可自动认定来源恢复成功'
 },
 security_independent_uat:{
  department:'security',owner:'独立信息安全、财务、教务与销售负责人',
  evidence:'两机构隔离环境的完整 UAT 证据、权限日志及四方签署',
  acceptance:'最小读取、越权拒绝、敏感字段脱敏、无资金/课时写入',
  failure:'保留 Draft、不合并、不部署、不解除 hold_active'
 }
});
const ORDER=Object.keys(UAT_TASKS).sort();
const EXPECT={sales:3,finance:4,academic:4,security:5};
const DISABLED=[
 'real_source_owners_approved','real_source_credentials_granted',
 'production_ledger_replay_ready','real_cross_module_uat_passed',
 'production_integration_allowed','execution_allowed','release_allowed'
];
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function validInt(value){return Number.isSafeInteger(value)&&value>=0;}
function fail(what){throw new TypeError('拒绝不可信的联合验收报告：'+what);}
export function renderJointUatReadinessMarkdown(report){
 if(!report||typeof report!=='object'||Array.isArray(report))
  fail('报告类型错误');
 if(report.report_schema!=='v3.2-32-joint-uat-v1'||
    report.status!=='blocked_real_authority_missing'||
    !UUID.test(report.finance_source_request_id||'')||
    !UUID.test(report.academic_source_request_id||'')||
    report.finance_source_request_id===report.academic_source_request_id||
    report.check_count!==16||!Array.isArray(report.checks)||
    report.checks.length!==16||DISABLED.some(k=>report[k]!==false)||
    !validInt(report.finance_unresolved_incidents)||
    !validInt(report.academic_unresolved_incidents))
  fail('来源引用、状态或执行/隔离标志非法');
 const seen=new Set(),counter={sales:0,finance:0,academic:0,security:0};
 for(const c of report.checks){
  if(!c||typeof c!=='object'||Array.isArray(c)||
   !Object.hasOwn(UAT_TASKS,c.check_code)||seen.has(c.check_code)||
   c.department!==UAT_TASKS[c.check_code].department||
   c.production_verified!==false||!validInt(c.missing_events))
   fail('检查项缺失、重复、篡改或被伪造为已通过');
  seen.add(c.check_code);counter[c.department]++;
 }
 if(ORDER.some(code=>!seen.has(code))||
  Object.keys(EXPECT).some(d=>counter[d]!==EXPECT[d]))
  fail('四部门 16 项检查未完整覆盖');
 const ordered=[...report.checks].sort((x,y)=>ORDER.indexOf(x.check_code)-ORDER.indexOf(y.check_code));
 const digest=createHash('sha256').update(JSON.stringify({
  finance:report.finance_source_request_id,
  academic:report.academic_source_request_id,
  incidentFinance:report.finance_unresolved_incidents,
  incidentAcademic:report.academic_unresolved_incidents,
  checks:ordered.map(c=>[c.check_code,c.missing_events])
 })).digest('hex');
 const rows=ordered.map(c=>{
  const t=UAT_TASKS[c.check_code];
  return '| '+[
   c.check_code,c.department,t.owner,t.evidence,t.acceptance,t.failure,
   String(c.missing_events),'未取得真实授权，阻断'
  ].join(' | ')+' |';
 });
 return [
  '# V3.2-32 联合联调 UAT 待办报告（隔离演练）',
  '',
  '> **此文档不是正式批准记录。** 所有 16 项仍需真实权威来源和独立业务/安全验收。不得用于开启真实连接、修改订单/资金/课时或解除隔离。',
  '',
  '财务来源申请：`'+report.finance_source_request_id+'`；教务来源申请：`'+report.academic_source_request_id+'`。',
  '',
  '来源中断记录：财务 '+report.finance_unresolved_incidents+' 条；教务 '+report.academic_unresolved_incidents+' 条。即使为 0，也不证明来源正常。',
  '',
  '快照指纹（仅比对清单版本，不是电子签名）：`'+digest+'`。',
  '',
  '| 检查编号 | 责任部门 | 负责人角色 | 需提交的证据 | 手工验收标准 | 不通过的处置 | 已登记缺失事件数 | 当前结论 |',
  '|---|---|---|---|---|---|---:|---|',
  ...rows,
  '',
  '## 签署前必须人工核对',
  '',
  '- 销售：逐个学生确权，复核合同主体、SaleEvent 与业绩；原历史不覆盖。',
  '- 财务：确认唯一资金权威、全部退款/拒付与经济事件水位；不得凭人工备注认定到账。',
  '- 教务：确认唯一 CRM 权威、课包/实上/消课余额；unknown 不代表没有执行。',
  '- 信息安全：核查机构、服务身份、信任锚、撤销、持久幂等与遗漏事件。',
  '- 联合验收：分别保存真实负责人签名、必要脱敏证据、失败日志和复验记录。本模拟系统不能接收正式签署。',
  '',
  '**最终状态：真实联调未授权；资金/订单/课时执行未授权；错误学生隔离不得解除。**',
  ''
 ].join('\n');
}
