// V3.2-34: verify a DB-scoped, fictional-only UAT evidence history.
// This is not legal/financial/academic evidence authentication.
import {UAT_CHECKS} from './integration-uat-blocker-report.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIXTURE=/^fictional_[a-z0-9_-]{8,64}$/;
const UTC=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const ADDED='fixture_added',WITHDRAWN='fixture_withdrawn';
const REASONS=Object.freeze({
 fixture_received:'虚构测试材料引用新增',
 fixture_outdated:'虚构材料已过期',
 fixture_revoked:'虚构材料已撤销',
 fixture_replaced:'虚构材料被替换'
});
const ACTIONS=Object.freeze({
 [ADDED]:'新增虚构引用',[WITHDRAWN]:'撤销虚构引用'
});
const integer=x=>Number.isSafeInteger(x)&&x>=0;
const deny=()=>{throw new TypeError('Only DB-scoped, permanently blocked fictional UAT history is accepted');};
function safe(value){
 return String(value).replaceAll('\\','\\\\').replaceAll('|','\\|')
  .replaceAll('<','&lt;').replaceAll('>','&gt;')
  .replaceAll('\r',' ').replaceAll('\n',' ').trim();
}
export function verifyBlockedFixtureHistory(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||
  raw.schema_version!=='v3.2-34-fixture-uat-audit-v1'||
  !UUID.test(raw.source_request_id||'')||
  !['finance','academic'].includes(raw.department)||
  !integer(raw.from_sequence)||!integer(raw.to_sequence)||
  !integer(raw.current_sequence)||raw.from_sequence>raw.to_sequence||
  raw.to_sequence>raw.current_sequence||
  !integer(raw.changed_event_count)||raw.changed_event_count>200||
  !integer(raw.added_count)||!integer(raw.withdrawn_count)||
  !integer(raw.active_before)||!integer(raw.active_after)||
  raw.real_evidence_verified!==false||
  raw.production_integration_allowed!==false||
  raw.execution_allowed!==false||raw.release_allowed!==false||
  !Array.isArray(raw.events)||raw.events.length!==raw.changed_event_count||
  raw.events.length!==raw.to_sequence-raw.from_sequence||
  raw.added_count+raw.withdrawn_count!==raw.events.length||
  raw.active_after!==raw.active_before+raw.added_count-raw.withdrawn_count)
  deny();
 const seenAdded=new Map(),seenWithdrawn=new Set();
 let added=0,withdrawn=0;
 const history=raw.events.map((event,index)=>{
  const seq=raw.from_sequence+index+1;
  if(!event||typeof event!=='object'||Array.isArray(event)||
   event.sequence!==seq||!Object.hasOwn(UAT_CHECKS,event.check_code)||
   !(event.check_code.startsWith('sales_')||
     event.check_code.startsWith(raw.department+'_')||
     event.check_code.startsWith('security_'))||
   !Object.hasOwn(ACTIONS,event.event_kind)||
   !Object.hasOwn(REASONS,event.reason_code)||
   !FIXTURE.test(event.fixture_ref||'')||
   typeof event.created_at!=='string'||!UTC.test(event.created_at)||
   !Number.isFinite(Date.parse(event.created_at)))
   deny();
  if(event.event_kind===ADDED){
   if(event.parent_sequence!==null||event.reason_code!=='fixture_received')deny();
   seenAdded.set(seq,{check:event.check_code,ref:event.fixture_ref});
   added++;
  }else{
   if(!Number.isSafeInteger(event.parent_sequence)||
    event.parent_sequence<=0||event.parent_sequence>=seq||
    event.reason_code==='fixture_received'||
    seenWithdrawn.has(event.parent_sequence))deny();
   // When diff starts after zero, a withdrawal may refer to an earlier
   // acknowledged event. It must still be checked by immutable DB records.
   const parent=seenAdded.get(event.parent_sequence);
   if(parent&&(parent.check!==event.check_code||
    parent.ref!==event.fixture_ref))deny();
   if(raw.from_sequence===0&&!parent)deny();
   seenWithdrawn.add(event.parent_sequence);withdrawn++;
  }
  return Object.freeze({
   sequence:seq,check:event.check_code,
   label:event.check_code,kind:event.event_kind,
   action:ACTIONS[event.event_kind],fixtureRef:event.fixture_ref,
   parentSequence:event.parent_sequence,
   reason:REASONS[event.reason_code],observedAt:event.created_at
  });
 });
 if(added!==raw.added_count||withdrawn!==raw.withdrawn_count)deny();
 return Object.freeze({
  requestId:raw.source_request_id,department:raw.department,
  from:raw.from_sequence,to:raw.to_sequence,current:raw.current_sequence,
  added,withdrawn,activeBefore:raw.active_before,activeAfter:raw.active_after,
  events:Object.freeze(history),status:'仍未取得真实权威证据',
  production_integration_allowed:false,execution_allowed:false,release_allowed:false
 });
}
export function renderBlockedFixtureHistoryMarkdown(raw){
 const h=verifyBlockedFixtureHistory(raw);
 const lines=[
  '# V3.2-34 虚构 UAT 证据历史与差异预览',
  '',
  '> 本文件只记录虚构测试引用的历史变化，不包含正式合同、资金、CRM 课时、私人身份或真正审批。',
  '',
  '**来源申请：** `'+h.requestId+'`',
  '**领域：** '+(h.department==='finance'?'财务':'教务 / CRM'),
  '**历史版本：** '+h.from+' → '+h.to+'（当前 '+h.current+'）',
  '**新增：** '+h.added+'；**撤销：** '+h.withdrawn+
    '；**有效虚构引用：** '+h.activeBefore+' → '+h.activeAfter,
  '',
  '## 差异事件（只追加且不可篡改）',
  '',
  '| 版本 | UAT 检查 | 动作 | 虚构引用编号 | 对应新增版本 | 测试原因 | 记录时间（UTC） |',
  '|---:|---|---|---|---:|---|---|'
 ];
 for(const e of h.events){
  lines.push('| '+e.sequence+' | `'+safe(e.check)+'` | '+safe(e.action)+
   ' | `'+safe(e.fixtureRef)+'` | '+
   (e.parentSequence===null?'—':e.parentSequence)+' | '+safe(e.reason)+
   ' | '+safe(e.observedAt)+' |');
 }
 lines.push('',
  '## 固定安全结论',
  '',
  '- 以上新增和撤销**只反映虚构测试材料引用**，不能证明真实收款、退款、订单或课包事实。',
  '- 任意证据撤销或签名身份撤销后，下次在线查看或导出必须重新校验身份与机构权限。',
  '- 即使虚构引用数量增加，所有联调关口仍是未获真实授权；真实资金/订单/课时记录不修改。',
  '- **禁止真实联调、禁止执行补偿、禁止解除学生错误关联隔离。**',
  '');
 return lines.join('\n');
}
