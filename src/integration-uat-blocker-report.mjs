// V3.2-32: pure, in-memory, non-executable UAT blocker report renderer.
// Caller must supply the result of the DB SESSION_USER-scoped SQL report.
// Rendering must NEVER grant integration permission or claim evidence accepted.
export const UAT_CHECKS=Object.freeze({
 sales_contract_party:{
  owner:'销售负责人＋合同签约责任人',
  verify:'核对正确学生独立身份、合同签约主体与更正法律依据；保留原合同',
  reject:'学生仅凭同姓名/同家庭推定；缺签约方授权或原合同丢失'
 },
 sales_attribution_policy:{
  owner:'销售经理＋业绩政策责任人',
  verify:'保留原 SaleEvent 和佣金历史，书面确认追加补偿归因口径',
  reject:'直接覆盖原业绩/成交归因或缺少历史差异说明'
 },
 sales_release_responsibility:{
  owner:'销售负责人＋财务＋教务独立终验人',
  verify:'R01—R10 逐项真实证据齐备，跨模块二次确认且隔离释放另行授权',
  reject:'仅三方拟议方案通过就解除 hold_active'
 },
 finance_authority_owner:{
  owner:'财务负责人＋支付来源系统所有人',
  verify:'确认唯一财务账务权威、负责人、用途与只读数据责任边界',
  reject:'员工自报银行/第三方支付来源，无正式所有人授权'
 },
 finance_tenant_order_mapping:{
  owner:'财务对账负责人＋机构账套管理员',
  verify:'核对机构账套、原始交易、退款、拒付与具体订单款项用途，识别跨子女共付款',
  reject:'跨机构/兄弟姐妹款项混用；同一经济事件重复计入'
 },
 finance_readonly_credentials:{
  owner:'财务系统管理员＋信息安全负责人',
  verify:'最小只读服务身份获正式审批并可审计、撤销，明确禁止退款/资金写入',
  reject:'使用个人账号、共享 token、生产私钥入 Git 或具备支付写权限'
 },
 finance_reconciliation:{
  owner:'财务主管＋独立对账人',
  verify:'权威来源版本、水位、收退款/拒付、分配与金额守恒均独立核对',
  reject:'结果 unknown 当作未到账，未闭环冲正或金额无法守恒'
 },
 academic_authority_owner:{
  owner:'教务负责人＋CRM 系统所有人',
  verify:'确认 CRM 学生身份、课包/排课/实授/消课唯一权威与负责人',
  reject:'以销售系统缓存或监护联系人资料代替 CRM 权威'
 },
 academic_tenant_student_mapping:{
  owner:'教务系统管理员＋学生档案责任人',
  verify:'机构 tenant、正确学生 ID 与课包 ID 一对一核对；家庭仅按需关联',
  reject:'只凭同家庭/同姓名转课，无法确证学生与包唯一关系'
 },
 academic_readonly_credentials:{
  owner:'CRM 权限管理员＋信息安全负责人',
  verify:'只读服务账号、可撤销授权、最小数据域并禁止发课/扣课操作',
  reject:'只读账号包含课包编辑、发课、退课、消课能力'
 },
 academic_attendance_balance:{
  owner:'教务主管＋课程履约记录管理员',
  verify:'已上课历史、剩余权益、退课记录和源版本完整对齐',
  reject:'unknown 当未上课；删除历史消课或在未判定时重复开包'
 },
 security_source_trust:{
  owner:'信息安全负责人',
  verify:'系统可信签发者、受众/租户绑定、证书轮换与撤销证明',
  reject:'使用虚构测试签名或客户端自报证书认定为真实来源'
 },
 security_durable_replay:{
  owner:'信息安全＋数据平台负责人',
  verify:'事务性持久重放账本、源事件幂等、并发重启/灾备演练',
  reject:'仅进程内 Map、丢事件或不同载荷相同序号'
 },
 security_complete_watermark:{
  owner:'数据平台负责人＋财务/CRM 所有人',
  verify:'分页连续、游标完成、事件序号、水位及迟到事件结算验收',
  reject:'缺页、序号跳跃、旧水位或没有全量完成信号'
 },
 security_incident_recovery:{
  owner:'安全事件负责人＋业务复核人',
  verify:'模拟签名撤销、超时未知、来源故障与人工升级后仍禁止执行',
  reject:'超时自动重试资金/发课写操作或把故障恢复当业务完成'
 },
 security_independent_uat:{
  owner:'销售＋财务＋教务＋安全独立验收',
  verify:'两机构端到端只读权限/拒绝写入/证据链和负责人书面签字',
  reject:'CI 绿灯或虚构签名测试代替真实独立验收'
 }
});
const REQUIREMENTS=Object.freeze({
 finance:Object.freeze(Object.keys(UAT_CHECKS).filter(x=>x.startsWith('sales_')||
  x.startsWith('finance_')||x.startsWith('security_'))),
 academic:Object.freeze(Object.keys(UAT_CHECKS).filter(x=>x.startsWith('sales_')||
  x.startsWith('academic_')||x.startsWith('security_')))
});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function integer(v){return Number.isSafeInteger(v)&&v>=0;}
function cleanText(v){return typeof v==='string'&&v.length>0&&v.length<=500;}
function md(v){return String(v).replaceAll('\\','\\\\').replaceAll('|','\\|')
 .replaceAll('\n',' ').replaceAll('\r',' ').replaceAll('<','&lt;')
 .replaceAll('>','&gt;').trim();}
function fail(){throw new TypeError('V3.2-32 UAT report must remain blocked and DB-scoped');}
export function buildBlockedUatTasks(source){
 if(!source||typeof source!=='object'||Array.isArray(source)||
  source.schema_version!=='v3.2-32-readonly-uat-v1'||
  !Object.hasOwn(REQUIREMENTS,source.department)||
  !UUID.test(source.source_request_id||'')||
  source.technical_ci_is_business_approval!==false||
  source.fixture_approvals_are_real!==false||
  source.production_integration_allowed!==false||
  source.execution_allowed!==false||source.release_allowed!==false||
  source.real_finance_source_connected!==false||source.real_crm_source_connected!==false||
  !integer(source.required_gate_count)||!integer(source.recorded_missing_events)||
  !Array.isArray(source.tasks))fail();
 const expected=new Set(REQUIREMENTS[source.department]);
 if(source.required_gate_count!==expected.size||
   source.tasks.length!==expected.size)fail();
 const seen=new Set();
 const tasks=source.tasks.map(item=>{
  if(!item||typeof item!=='object'||Array.isArray(item)||
   !expected.has(item.check_code)||seen.has(item.check_code)||
   !UAT_CHECKS[item.check_code]||
   item.responsible_department!==item.check_code.split('_')[0]||
   item.uat_status!=='blocked_real_approval_missing'||
   item.real_evidence_verified!==false||item.real_owner_signed!==false||
   item.ready_for_production!==false||
   !cleanText(item.label_zh)||!cleanText(item.required_evidence_zh)||
   !integer(item.missing_events))fail();
  seen.add(item.check_code);
  return Object.freeze({
   code:item.check_code,department:item.responsible_department,
   label:item.label_zh,evidence:item.required_evidence_zh,
   missing_events:item.missing_events,
   owner:UAT_CHECKS[item.check_code].owner,
   test:UAT_CHECKS[item.check_code].verify,
   reject:UAT_CHECKS[item.check_code].reject,
   status:'待真实业务证据／禁止联调'
  });
 });
 if(tasks.reduce((sum,t)=>sum+t.missing_events,0)!==
    source.recorded_missing_events)fail();
 tasks.sort((a,b)=>a.department.localeCompare(b.department)||a.code.localeCompare(b.code));
 return Object.freeze({
  requestId:source.source_request_id,domain:source.department,
  total:tasks.length,reportedGaps:source.recorded_missing_events,
  tasks:Object.freeze(tasks),
  status:'blocked_real_authority_missing',
  production_integration_allowed:false,execution_allowed:false,release_allowed:false
 });
}

export function renderBlockedUatMarkdown(source){
 const report=buildBlockedUatTasks(source);
 const title=report.domain==='finance'?'财务':'教务 / CRM';
 const lines=[
  '# V3.2-32 跨部门真实联调前 UAT 待办报告',
  '',
  '> 仅隔离测试生成；不得用作真实来源授权或补偿执行指令。',
  '',
  '**申请编号：** `'+report.requestId+'`',
  '**领域：** '+title,
  '**准入状态：** 真实授权尚未取得，继续阻断',
  '**必须核对：** '+report.total+' 项；**已登记缺失事件：** '+report.reportedGaps+' 条。',
  '',
  '## 负责人、证据、验收动作与拒绝条件',
  '',
  '| 检查代码与任务 | 负责人 | 应提供的材料 | 验收动作 | 必须拒绝的情况 | 当前状态 |',
  '|---|---|---|---|---|---|'
 ];
 for(const task of report.tasks){
  lines.push('| `'+task.code+'` '+md(task.label)+' | '+md(task.owner)+
    ' | '+md(task.evidence)+' | '+md(task.test)+
    ' | '+md(task.reject)+' | '+task.status+' |');
 }
 lines.push('',
  '## 四方最终 UAT 操作顺序','',
  '1. 销售：核对正确学生独立身份、合同、业绩历史，任何原订单保持原样。',
  '2. 财务：由真实权威负责人核对收退款及金额守恒，拒绝未知款项被当作零。',
  '3. 教务：由 CRM 所有人核对课包、实上与剩余权益，拒绝重复发课。',
  '4. 信息安全：核对真实来源身份、租户隔离、持久防重放、完整水位与撤销能力。',
  '5. 独立验收：四方分别留存权限、拒绝写入、来源异常与恢复证据；未通过不得签署。',
  '',
  '## 未通过与恢复','',
  '- 任一条件缺失、来源超时或外部结果未知：保持隔离，升级人工复核；不得改账或改课。',
  '- 补充材料需由真正业务负责人和信息安全负责人独立验证；不能在本报告中直接勾选通过。',
  '- CI、模拟 Ed25519 签名、双人虚构审批均不得替代真实接口、合同或执行验收。',
  '',
  '**固定结论：禁止真实联调；禁止资金／订单／课时执行；禁止解除学生错误关联隔离。**',
  '');
 return lines.join('\n');
}
