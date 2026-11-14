import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import pg from 'pg';
import {buildBlockedUatTasks,renderBlockedUatMarkdown}
 from '../../src/integration-uat-blocker-report.mjs';
const key=()=>randomBytes(20).toString('hex');
const pool=name=>new pg.Pool({connectionString:process.env[name],max:2});
const one=async(p,sql,args)=>(await p.query(sql,args)).rows[0].result;
const deny=(p,sql,args,code)=>assert.rejects(p.query(sql,args),
 error=>error.code===code,'Expected '+code+' for '+sql);
const request='SELECT ms.propose_fixture_source_readiness($1,$2,$3,$4,$5,$6) AS result';
const report='SELECT ms.readonly_integration_uat_report($1) AS result';
const gap='SELECT ms.record_integration_missing_evidence($1,$2,$3,$4,$5,$6) AS result';

test('V3.2-32 PostgreSQL scoped UAT report requires real DB LOGIN and never authorizes',async t=>{
 const root=pool('DATABASE_URL'),fin=pool('DATABASE_URL_PLAN_FINANCE'),
 acad=pool('DATABASE_URL_PLAN_ACADEMIC'),security=pool('DATABASE_URL_SOURCE_SECURITY'),
 other=pool('DATABASE_URL_PLAN_B'),low=pool('DATABASE_URL_WRITE_A'),
 requester=pool('DATABASE_URL_PLAN_A');
 const all=[root,fin,acad,security,other,low,requester];
 try{
  await t.test('new function scoped to existing role: other staff cannot query',async()=>{
   await deny(low,report,[null],'42501');
   await deny(requester,report,[null],'42501');
   for(const p of [fin,acad,security,other]){
    await deny(p,'SELECT * FROM ms.integration_required_checks',[],'42501');
    await deny(p,'UPDATE ms.sales_orders SET student_id=student_id WHERE FALSE',[],'42501');
    await deny(p,'UPDATE ms.payment_allocations SET id=id WHERE FALSE',[],'42501');
    await deny(p,'UPDATE ms.crm_entitlement_links SET id=id WHERE FALSE',[],'42501');
   }
  });
  const f=await one(fin,request,['finance','fictional_uat_finance_test',
   'fictional_org_a','财务来源联调前纸面验收清单演练','虚构财务 UAT 清单引用',key()]);
  const a=await one(acad,request,['academic','fictional_uat_academic_test',
   'fictional_org_a','教务来源联调前纸面验收清单演练','虚构教务 UAT 清单引用',key()]);
  await t.test('finance and academic each receive 12 applicable blocked UAT steps',async()=>{
   for(const [client,id,domain] of [[fin,f,'finance'],[acad,a,'academic']]){
    const raw=await one(client,report,[id]);
    assert.equal(raw.schema_version,'v3.2-32-readonly-uat-v1');
    assert.equal(raw.department,domain);
    assert.equal(raw.required_gate_count,12);
    assert.equal(raw.tasks.length,12);
    assert.ok(raw.tasks.every(item=>item.uat_status==='blocked_real_approval_missing'));
    assert.ok(raw.tasks.every(item=>item.real_evidence_verified===false));
    assert.ok(raw.tasks.every(item=>item.real_owner_signed===false));
    assert.equal(raw.production_integration_allowed,false);
    assert.equal(raw.execution_allowed,false);
    assert.equal(raw.release_allowed,false);
    const tasks=buildBlockedUatTasks(raw);
    assert.equal(tasks.total,12);
    assert.match(renderBlockedUatMarkdown(raw),/禁止解除学生错误关联隔离/);
   }
   await deny(other,report,[f],'42501');
   await deny(other,report,[a],'42501');
  });
  await t.test('recorded missing evidence is a blocker, never interpreted as accepted',async()=>{
   const k=[f,'finance_reconciliation','reconciliation_unverified',
    '虚构收退款与拒付核验依据','真实财务权威水位和金额守恒仍未知',key()];
   const id=await one(fin,gap,k);
   assert.ok(id);
   const raw=await one(fin,report,[f]);
   assert.equal(raw.recorded_missing_events,1);
   const target=raw.tasks.find(x=>x.check_code==='finance_reconciliation');
   assert.equal(target.missing_events,1);
   assert.equal(target.real_evidence_verified,false);
   assert.equal(raw.production_integration_allowed,false);
   assert.equal(raw.execution_allowed,false);
   assert.equal(raw.release_allowed,false);
   const out=renderBlockedUatMarkdown(raw);
   assert.match(out,/未获|缺失|缺少/);
   assert.match(out,/已登记缺失事件：\*\* 1 条/);
   await deny(root,'DELETE FROM ms.integration_missing_evidence_events WHERE id=$1',[id],'23514');
  });
  await t.test('same institution may inspect checklist but cannot use it to approve or modify historic cases',async()=>{
   const x=await one(security,report,[f]);
   assert.equal(x.tasks.length,12);
   assert.equal(x.production_integration_allowed,false);
   assert.equal(x.release_allowed,false);
   const clone={...x,execution_allowed:true};
   assert.throws(()=>buildBlockedUatTasks(clone),TypeError);
   await deny(root,
    "UPDATE ms.integration_required_checks SET production_verified=true WHERE check_code='security_source_trust'",
    [],'23514');
   const count=(await root.query(
    'SELECT count(*)::int AS n FROM ms.integration_required_checks')).rows[0].n;
   assert.equal(count,16);
  });
 }finally{await Promise.all(all.map(p=>p.end()));}
});
