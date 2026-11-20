import {readFile} from 'node:fs/promises';

function requireCondition(condition, message){
 if(!condition)throw new Error(message);
}
const hasText=value=>typeof value==='string'&&value.trim().length>0;
const cents=value=>Number.isSafeInteger(value);
const dateKey=value=>{
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const date=new Date(value+'T00:00:00Z');
 return !Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===value;
};
const shanghai=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'});
function recordedDay(value,label){
 requireCondition(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  &&dateKey(value.slice(0,10))&&Number.isFinite(Date.parse(value)),label+' 须为带时区的有效时间');
 return shanghai.format(new Date(value));
}
function entries(value,label,{empty=false}={}){
 requireCondition(Array.isArray(value)&&(empty||value.length>0),label+' 须为有效记录数组');
 return value.entries();
}
function unique(set,key,label){
 requireCondition(hasText(key)&&!set.has(key),label+' 缺少唯一编号或编号重复');
 set.add(key);
}

const costPeriod=value=>typeof value==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(value);
const taxBasis=value=>['inclusive','exclusive'].includes(value);
const costKey=(period,channel,tax)=>JSON.stringify([period,channel,tax]);
function validateChannelCosts(sample,includeSummary){
 const ids=new Set(),grouped=new Map();
 for(const [index,raw] of entries(sample.costs,'costs')){
  const row=raw??{},label='费用第 '+(index+1)+' 条';
  unique(ids,row.expense_id,label);
  requireCondition(row.status==='finance_confirmed'&&hasText(row.confirmation_ref),label+' 缺少财务确认凭证');
  requireCondition(row.currency==='CNY'&&cents(row.amount_cents)&&row.amount_cents!==0,label+' 须提供非零人民币分金额');
  requireCondition(costPeriod(row.period),label+' 归属月须为 YYYY-MM');
  requireCondition(taxBasis(row.tax_basis),label+' 缺少含税口径');
  const channels=new Set();
  let total=0n;
  for(const [i,rawPart] of entries(row.allocations,label+'分摊')){
   const part=rawPart??{},partLabel=label+'分摊第 '+(i+1)+' 条';
   unique(channels,part.channel_id,partLabel);
   requireCondition(cents(part.amount_cents)&&Math.sign(part.amount_cents)===Math.sign(row.amount_cents),partLabel+' 金额方向与原记录不一致');
   total+=BigInt(part.amount_cents);
   const key=costKey(row.period,part.channel_id,row.tax_basis);
   grouped.set(key,(grouped.get(key)??0n)+BigInt(part.amount_cents));
  }
  requireCondition(total===BigInt(row.amount_cents),label+' 分摊合计与费用金额不一致');
 }
 const report={kind:'channel_costs',records:ids.size};
 if(sample.control_totals!==undefined){
  const seen=new Set();
  for(const [index,raw] of entries(sample.control_totals,'control_totals')){
   const control=raw??{},label='控制数第 '+(index+1)+' 条';
   requireCondition(costPeriod(control.period)&&hasText(control.channel_id)&&taxBasis(control.tax_basis)
    &&cents(control.amount_cents)&&hasText(control.statement_ref),label+' 缺少渠道、归属月、含税口径、金额或对账凭证');
   const key=costKey(control.period,control.channel_id,control.tax_basis);
   unique(seen,key,label);
   requireCondition(grouped.has(key),label+' 未找到对应分摊记录');
   requireCondition(grouped.get(key)===BigInt(control.amount_cents),label+' 与渠道费用汇总不一致');
  }
  requireCondition(seen.size===grouped.size,'渠道费用汇总存在缺少控制数的分组');
  report.reconciled_groups=seen.size;
 }
 if(includeSummary){
  report.summary=[...grouped.keys()].sort().map(key=>{
   const [period,channel_id,tax_basis]=JSON.parse(key);
   return {period,channel_id,tax_basis,amount_cents:String(grouped.get(key))};
  });
 }
 return report;
}
function validateLedger(sample,requestedDate){
 const {from,through}=sample.coverage??{};
 requireCondition(dateKey(from)&&dateKey(through)&&from<=through,'coverage 须声明有效且连续的上海日期范围');
 const inCoverage=day=>dateKey(day)&&day>=from&&day<=through;
 if(requestedDate!==undefined)requireCondition(inCoverage(requestedDate),'查询日期超出声明的账本覆盖范围');
 const opening=new Map(),ids=new Set(),events=[];
 const balance=(raw,label)=>{
  const row=raw??{};
  requireCondition(hasText(row.order_id)&&cents(row.receivable_cents)&&cents(row.net_allocated_cents),label+' 缺少订单编号、应收或净分配分金额');
  return row;
 };
 for(const [index,raw] of entries(sample.opening,'opening',{empty:true})){
  const label='期初第 '+(index+1)+' 条',row=balance(raw,label);
  requireCondition(!opening.has(row.order_id),label+' 订单编号重复');
  opening.set(row.order_id,{receivable:BigInt(row.receivable_cents),allocated:BigInt(row.net_allocated_cents)});
 }
 for(const [index,raw] of entries(sample.events,'events',{empty:true})){
  const row=raw??{},label='账本变动第 '+(index+1)+' 条';
  unique(ids,row.event_id,label);
  requireCondition(hasText(row.order_id)&&hasText(row.evidence_ref),label+' 缺少订单编号或凭证');
  requireCondition(cents(row.receivable_delta_cents)&&cents(row.allocation_delta_cents)
   &&(row.receivable_delta_cents!==0||row.allocation_delta_cents!==0),label+' 须提供应收与净分配变动额，至少一项非零');
  const effective=recordedDay(row.effective_at,label+'生效时间');
  const recorded=recordedDay(row.recorded_at,label+'记录时间');
  const visibleOn=effective>recorded?effective:recorded;
  requireCondition(inCoverage(visibleOn),label+' 可见日期超出覆盖范围或已包含在期初');
  events.push({...row,visibleOn});
 }
 const at=(orderId,day)=>{
  const starting=opening.get(orderId);
  let receivable=starting?.receivable??0n,allocated=starting?.allocated??0n;
  for(const event of events){
   if(event.order_id!==orderId||event.visibleOn>day)continue;
   receivable+=BigInt(event.receivable_delta_cents);
   allocated+=BigInt(event.allocation_delta_cents);
  }
  return {receivable,allocated};
 };
 const checks=new Set();
 for(const [index,raw] of entries(sample.checkpoints,'checkpoints')){
  const label='对账点第 '+(index+1)+' 条',row=balance(raw,label);
  requireCondition(inCoverage(row.date)&&cents(row.balance_cents)&&hasText(row.statement_ref),label+' 缺少有效日期、账单凭证或余额');
  unique(checks,JSON.stringify([row.order_id,row.date]),label);
  requireCondition(opening.has(row.order_id)||events.some(event=>event.order_id===row.order_id&&event.visibleOn<=row.date),label+' 缺少该订单在对账日期前的证据');
  const actual=at(row.order_id,row.date);
  requireCondition(actual.receivable===BigInt(row.receivable_cents)&&actual.allocated===BigInt(row.net_allocated_cents)
   &&actual.receivable-actual.allocated===BigInt(row.balance_cents),label+' 无法与期初和账本变动对平');
 }
 const report={kind:'historical_ledger',events:events.length,checkpoints:checks.size,coverage:{from,through}};
 if(requestedDate===undefined)return report;
 const orders=new Set(opening.keys());
 for(const event of events){
  if(event.visibleOn<=requestedDate)orders.add(event.order_id);
 }
 let receivable=0n,allocated=0n;
 for(const orderId of orders){
  const current=at(orderId,requestedDate);
  receivable+=current.receivable;
  allocated+=current.allocated;
 }
 return {...report,snapshot:{
  date:requestedDate,orders:orders.size,receivable_cents:String(receivable),net_allocated_cents:String(allocated),
  balance_cents:String(receivable-allocated),
 }};
}

try{
 const [file,option,date,...extra]=process.argv.slice(2);
 const summary=option==='--summary';
 requireCondition(file&&!extra.length&&(!option||(summary&&!date)||(option==='--date'&&date)),
  '用法：node scripts/validate-boss-finance-sample.mjs <脱敏样本.json> [--summary | --date YYYY-MM-DD]');
 let sample;
 try{sample=JSON.parse(await readFile(file,'utf8'));}catch{throw new Error('无法读取有效的 JSON 样本');}
 requireCondition(sample&&hasText(sample.organization_ref)&&hasText(sample.source_ref),'须提供脱敏机构编号和账表或接口标识');
 requireCondition(['channel_costs','historical_ledger'].includes(sample.kind),'kind 须为 channel_costs 或 historical_ledger');
 if(summary)requireCondition(sample.kind==='channel_costs','仅渠道费用接受 --summary');
 if(option==='--date')requireCondition(sample.kind==='historical_ledger','仅历史账本接受查询日期');
 const report=sample.kind==='channel_costs'?validateChannelCosts(sample,summary):validateLedger(sample,date);
 process.stdout.write(JSON.stringify({valid:true,validation_scope:'sample_only',...report})+'\n');
}catch(error){
 process.stderr.write('样本校验失败：'+error.message+'\n');
 process.exitCode=1;
}
