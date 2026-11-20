import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const script=fileURLToPath(new URL('../../scripts/validate-boss-finance-sample.mjs',import.meta.url));
async function run(t,sample,args=[]){
 const folder=await mkdtemp(join(tmpdir(),'boss-finance-test-'));
 t.after(()=>rm(folder,{recursive:true,force:true}));
 const path=join(folder,'sample.json');
 await writeFile(path,JSON.stringify(sample));
 return spawnSync(process.execPath,[script,path,...args],{encoding:'utf8'});
}
const source={organization_ref:'org-fixture',source_ref:'financial-sample'};
const cost={
 expense_id:'expense-fixture',status:'finance_confirmed',confirmation_ref:'approval-fixture',
 currency:'CNY',amount_cents:900,period:'2024-07',tax_basis:'inclusive',
 allocations:[{channel_id:'source-a',amount_cents:600},{channel_id:'source-b',amount_cents:300}],
};
const opening={order_id:'order-fixture',receivable_cents:10000,net_allocated_cents:3000};
const ledger={
 ...source,kind:'historical_ledger',coverage:{from:'2024-07-01',through:'2024-07-04'},opening:[opening],
 events:[
  {event_id:'refund-fixture',order_id:opening.order_id,evidence_ref:'voucher-fixture',
   effective_at:'2024-07-01T15:30:00Z',recorded_at:'2024-07-01T16:00:01Z',receivable_delta_cents:0,allocation_delta_cents:-1000},
  {event_id:'correction-fixture',order_id:opening.order_id,evidence_ref:'correction-source',
   effective_at:'2024-07-03T09:00:00+08:00',recorded_at:'2024-07-02T12:00:00+08:00',receivable_delta_cents:-2000,allocation_delta_cents:0},
 ],
 checkpoints:[{...opening,date:'2024-07-04',statement_ref:'statement-fixture',
  receivable_cents:8000,net_allocated_cents:2000,balance_cents:6000}],
};

test('channel cost sample requires confirmed and fully allocated costs',async t=>{
 const sample={...source,kind:'channel_costs',costs:[cost]};
 const good=await run(t,sample);
 assert.equal(good.status,0,good.stderr);
 assert.deepEqual(JSON.parse(good.stdout),{valid:true,validation_scope:'sample_only',kind:'channel_costs',records:1});
 const pending=await run(t,{...sample,costs:[{...cost,status:'pending'}]});
 assert.equal(pending.status,1);
 assert.match(pending.stderr,/缺少财务确认凭证/);
 assert.ok(!pending.stderr.includes(cost.expense_id));
 const wrong=await run(t,{...sample,costs:[{...cost,amount_cents:999}]});
 assert.equal(wrong.status,1);
 assert.match(wrong.stderr,/分摊合计与费用金额不一致/);
});

test('channel costs reconcile credits and keep months and tax bases separate',async t=>{
 const credit={...cost,expense_id:'credit-fixture',amount_cents:-100,allocations:[{channel_id:'source-a',amount_cents:-100}]};
 const exclusive={...cost,expense_id:'exclusive-fixture',amount_cents:80,tax_basis:'exclusive',allocations:[{channel_id:'source-a',amount_cents:80}]};
 const nextMonth={...exclusive,expense_id:'next-fixture',period:'2024-08'};
 const controls=[
  {channel_id:'source-a',amount_cents:500,tax_basis:'inclusive',period:'2024-07'},
  {channel_id:'source-a',amount_cents:80,tax_basis:'exclusive',period:'2024-07'},
  {channel_id:'source-b',amount_cents:300,tax_basis:'inclusive',period:'2024-07'},
  {channel_id:'source-a',amount_cents:80,tax_basis:'exclusive',period:'2024-08'},
 ].map(row=>({...row,statement_ref:'statement-fixture'}));
 const sample={...source,kind:'channel_costs',costs:[cost,credit,exclusive,nextMonth],control_totals:controls};
 const good=await run(t,sample,['--summary']);
 assert.equal(good.status,0,good.stderr);
 const report=JSON.parse(good.stdout);
 assert.equal(report.reconciled_groups,4);
 assert.deepEqual(report.summary.map(({period,channel_id,tax_basis,amount_cents})=>[period,channel_id,tax_basis,amount_cents]),[
  ['2024-07','source-a','exclusive','80'],['2024-07','source-a','inclusive','500'],
  ['2024-07','source-b','inclusive','300'],['2024-08','source-a','exclusive','80'],
 ]);
 const partial=await run(t,{...sample,control_totals:controls.slice(0,3)});
 assert.equal(partial.status,1);
 assert.match(partial.stderr,/缺少控制数/);
 const wrong=await run(t,{...sample,control_totals:[...controls.slice(0,3),{...controls[3],amount_cents:81}]});
 assert.equal(wrong.status,1);
 assert.match(wrong.stderr,/与渠道费用汇总不一致/);
 const check=await run(t,sample);
 assert.equal(check.status,0,check.stderr);
 assert.equal(JSON.parse(check.stdout).summary,undefined);
 assert.ok(!check.stdout.includes('source-a'));
});

test('historical sample replays Shanghai day-end with evidence and reconciles against a statement',async t=>{
 const before=await run(t,ledger,['--date','2024-07-01']);
 assert.equal(before.status,0,before.stderr);
 assert.equal(JSON.parse(before.stdout).snapshot.balance_cents,'7000');
 const refund=await run(t,ledger,['--date','2024-07-02']);
 assert.equal(refund.status,0,refund.stderr);
 assert.equal(JSON.parse(refund.stdout).snapshot.balance_cents,'8000');
 const correction=await run(t,ledger,['--date','2024-07-03']);
 assert.equal(correction.status,0,correction.stderr);
 assert.equal(JSON.parse(correction.stdout).snapshot.balance_cents,'6000');
 const invalid=await run(t,ledger,['--date','2024-07-05']);
 assert.equal(invalid.status,1);
 assert.match(invalid.stderr,/查询日期超出/);
 const wrong=await run(t,{...ledger,checkpoints:[{...ledger.checkpoints[0],balance_cents:6100}]});
 assert.equal(wrong.status,1);
 assert.match(wrong.stderr,/无法.*对平/);
});
