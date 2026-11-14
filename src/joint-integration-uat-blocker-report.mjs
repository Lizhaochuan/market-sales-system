// V3.2-50: finance + academic blocked-UAT composition (fictional only).
// Existing 035 domain-level DB functions remain the sole sources of data.
// No production authority, source registration, financial/lesson writes or hold release.
import {buildBlockedUatTasks,UAT_CHECKS} from './integration-uat-blocker-report.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const expected=Object.keys(UAT_CHECKS).sort();
function invalid(){throw new TypeError('Joint UAT must use two valid, blocked and independently scoped fixture reports');}
const safe=v=>String(v).replaceAll('\\','\\\\').replaceAll('|','\\|')
 .replaceAll('\n',' ').replaceAll('\r',' ').replaceAll('<','&lt;')
 .replaceAll('>','&gt;').trim();

export function buildBlockedJointUatReport(financeRaw,academicRaw){
 const f=buildBlockedUatTasks(financeRaw),a=buildBlockedUatTasks(academicRaw);
 if(f.domain!=='finance'||a.domain!=='academic'||f.requestId===a.requestId||
    !UUID.test(f.requestId)||!UUID.test(a.requestId)||f.total!==12||a.total!==12)invalid();
 const items=new Map();
 for(const [domain,report] of [['finance',f],['academic',a]]){
  for(const t of report.tasks){
   const current=items.get(t.code);
   if(current){
    // Common sales and security checks are one checklist line but TWO
    // independently observed source-gap counts; never silently drop evidence.
    if(current.department!==t.department||current.label!==t.label||
      current.evidence!==t.evidence||current.owner!==t.owner||
      current.test!==t.test||current.reject!==t.reject||
      !['sales','security'].includes(t.department))invalid();
    if(current.sources[domain]!==null)invalid();
    current.sources[domain]=t.missing_events;
    current.missing_events+=t.missing_events;
   }else{
    items.set(t.code,{
     code:t.code,department:t.department,label:t.label,evidence:t.evidence,
     owner:t.owner,test:t.test,reject:t.reject,status:'待真实业务证据／禁止联调',
     sources:{finance:domain==='finance'?t.missing_events:null,
      academic:domain==='academic'?t.missing_events:null},
     missing_events:t.missing_events
    });
   }
  }
 }
 if(items.size!==16||expected.some(code=>!items.has(code))||
    [...items.values()].some(item=>
     (['sales','security'].includes(item.department)
      ?item.sources.finance===null||item.sources.academic===null
      :item.sources[item.department]===null)||
     (item.department==='finance'&&item.sources.academic!==null)||
     (item.department==='academic'&&item.sources.finance!==null)))invalid();
 const tasks=[...items.values()].sort((x,y)=>x.code.localeCompare(y.code))
  .map(item=>Object.freeze({...item,sources:Object.freeze(item.sources)}));
 const gapCount=tasks.reduce((n,t)=>n+t.missing_events,0);
 if(gapCount!==f.reportedGaps+a.reportedGaps)invalid();
 return Object.freeze({
  schema_version:'v3.2-50-joint-blocked-uat-v1',
  finance_request_id:f.requestId,academic_request_id:a.requestId,
  check_count:tasks.length,finance_check_count:f.total,academic_check_count:a.total,
  recorded_missing_events:gapCount,
  tasks:Object.freeze(tasks),status:'blocked_real_authority_missing',
  fixture_sources_only:true,real_finance_source_connected:false,
  real_crm_source_connected:false,real_owner_approval_complete:false,
  technical_ci_is_business_approval:false,
  production_integration_allowed:false,execution_allowed:false,release_allowed:false
 });
}

// A test-only facade. The same SECURITY REVIEWER DB LOGIN queries both
// independent 035 reports, whose SECURITY DEFINER scopes are bound to
// SESSION_USER; if either request is foreign, the whole operation fails.
export async function loadBlockedJointUatReport(pool,financeRequestId,academicRequestId){
 if(process.env.MS_STAGE!=='isolated-test'||!pool?.connect||
    !UUID.test(financeRequestId||'')||!UUID.test(academicRequestId||'')||
    financeRequestId===academicRequestId)invalid();
 const client=await pool.connect();
 try{
  const check=(await client.query(
   "SELECT session_user AS login,current_user AS principal,"+
   "(SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS superuser,"+
   "(SELECT rolbypassrls FROM pg_roles WHERE rolname=current_user) AS bypassrls,"+
   "ms.current_scoped_organization_id() AS org,"+
   "has_table_privilege(current_user,'ms.payment_allocations','SELECT') AS raw_finance,"+
   "has_table_privilege(current_user,'ms.crm_entitlement_links','SELECT') AS raw_crm"
  )).rows[0];
  if(!check||check.login!=='ms_fixture_source_security'||
     check.principal!==check.login||check.superuser||check.bypassrls||
     check.raw_finance||check.raw_crm||!UUID.test(check.org||''))invalid();
  const query='SELECT ms.readonly_integration_uat_report($1) AS result';
  const fin=(await client.query(query,[financeRequestId])).rows[0]?.result;
  const academic=(await client.query(query,[academicRequestId])).rows[0]?.result;
  return buildBlockedJointUatReport(fin,academic);
 }finally{client.release();}
}

export function renderBlockedJointUatMarkdown(report){
 if(!report||report.schema_version!=='v3.2-50-joint-blocked-uat-v1'||
    report.check_count!==16||report.status!=='blocked_real_authority_missing'||
    report.fixture_sources_only!==true||report.production_integration_allowed!==false||
    report.execution_allowed!==false||report.release_allowed!==false||
    report.real_owner_approval_complete!==false||
    !Array.isArray(report.tasks)||report.tasks.length!==16||
    !UUID.test(report.finance_request_id||'')||
    !UUID.test(report.academic_request_id||''))invalid();
 const lines=[
  '# V3.2-50｜财务＋教务联合真实准入待办（虚构只读）','',
  '> 本文件来自同机构虚构来源的隔离安全账号；不是审批、授权或执行通知。','',
  '**财务来源：** `'+report.finance_request_id+'`',
  '**教务来源：** `'+report.academic_request_id+'`',
  '**统一检查项目：** 16 项（财务 12 / 教务 12；销售＋安全共用项目合并展示）',
  '**按各来源独立计数的缺失事件：** '+report.recorded_missing_events,
  '**状态：** 真实权威缺失，全部禁止联调和纠错释放','',
  '| 检查代码 | 责任部门 | 检查名称 | 所需材料 | 财务源缺失 | 教务源缺失 | 当前状态 |',
  '|---|---|---|---|---:|---:|---|'
 ];
 for(const t of report.tasks){
  if(!expected.includes(t.code)||t.status!=='待真实业务证据／禁止联调'||
    !t.sources||!Number.isSafeInteger(t.missing_events)||t.missing_events<0)invalid();
  lines.push('| `'+safe(t.code)+'` | '+safe(t.department)+' | '+
   safe(t.label)+' | '+safe(t.evidence)+' | '+
   (t.sources.finance===null?'—':t.sources.finance)+' | '+
   (t.sources.academic===null?'—':t.sources.academic)+' | '+safe(t.status)+' |');
 }
 lines.push('','**固定结论：禁止真实联调、禁止资金及课时写入、禁止解除错误学生关联的 hold_active。**','');
 return lines.join('\n');
}
