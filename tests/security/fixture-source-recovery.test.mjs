import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import pg from 'pg';
const key=()=>randomBytes(20).toString('hex');
const pool=n=>new pg.Pool({connectionString:process.env[n],max:2});
const one=async(p,s,a)=>(await p.query(s,a)).rows[0].result;
const deny=(p,s,a,code)=>assert.rejects(p.query(s,a),e=>e.code===code,'Expected '+code+' for '+s);
const request='SELECT ms.propose_fixture_source_readiness($1,$2,$3,$4,$5,$6) AS result';
const report='SELECT ms.report_fixture_source_interruption($1,$2,$3,$4,$5,$6,$7) AS result';
const review='SELECT ms.review_fixture_source_interruption($1,$2,$3,$4,$5,$6) AS result';

test('V3.2-30 immutable interruption, separate reviewer and permanently blocked recovery',async t=>{
 const root=pool('DATABASE_URL'),finance=pool('DATABASE_URL_PLAN_FINANCE'),
 acad=pool('DATABASE_URL_PLAN_ACADEMIC'),dual=pool('DATABASE_URL_PLAN_DUAL'),
 other=pool('DATABASE_URL_PLAN_B'),security=pool('DATABASE_URL_SOURCE_SECURITY'),
 low=pool('DATABASE_URL_WRITE_A');
 const all=[root,finance,acad,dual,other,security,low];
 try{
  await t.test('recovery permissions are function-only, never finance or CRM mutation',async()=>{
   for(const p of [finance,acad,dual,other,security]){
    for(const table of ['ms.fixture_source_recovery_incidents','ms.fixture_source_recovery_reviews']){
      await deny(p,'SELECT * FROM '+table,[],'42501');
      await deny(p,'DELETE FROM '+table+' WHERE FALSE',[],'42501');
    }
    for(const table of ['ms.sales_orders','ms.payment_allocations','ms.crm_entitlement_links'])
      await deny(p,'UPDATE '+table+' SET id=id WHERE FALSE',[],'42501');
   }
   await deny(low,report,[null,'timeout_unknown',null,null,'证据引用',
    '外部来源请求结果未知',key()],'42501');
  });
  const source=await one(finance,request,['finance','fictional_recovery_test',
    'fictional_org_a','模拟异常恢复和缺页核验','虚构恢复申请材料',key()]);
  let incident;
  await t.test('only domain owner reports source timeout with an immutable event',async()=>{
   const args=[source,'timeout_unknown',10,100,'虚构财务超时材料',
    '只记录来源结果未知，绝不能认定未收款或重复退款',key()];
   await deny(acad,report,args,'42501');
   await deny(security,report,args,'42501');
   await deny(other,report,args,'42501');
   await deny(finance,report,[...args.slice(0,1),'all_cleared',...args.slice(2)],'23514');
   incident=await one(finance,report,args);
   assert.equal(await one(finance,report,args),incident);
   await deny(finance,report,[...args.slice(0,5),'改动同键内容',args[6]],'23505');
   await deny(root,'DELETE FROM ms.fixture_source_recovery_incidents WHERE id=$1',[incident],'23514');
   await deny(root,"UPDATE ms.fixture_source_recovery_incidents SET reason_zh='覆盖' WHERE id=$1",[incident],'23514');
  });
  await t.test('security and business review separately, original reporter cannot self-approve',async()=>{
   await deny(finance,review,[incident,'business_confirmation','fixture_checks_only',
    '虚构员工自审材料','不能自审自己的故障',key()],'42501');
   await deny(acad,review,[incident,'business_confirmation','manual_review_required',
    '跨部门凭证材料','教务不能审批财务异常',key()],'42501');
   await deny(dual,review,[incident,'security_investigation','fixture_checks_only',
    '错误权限材料','财务业务审核员不能冒充信息安全审核',key()],'42501');
   const a=await one(dual,review,[incident,'business_confirmation',
    'manual_review_required','虚构财务复核记录','原始财务来源未知需要人工复核',key()]);
   assert.ok(a);
   const securityArgs=[incident,'security_investigation','fixture_checks_only',
    '虚构安全日志引用','仅模拟恢复检查，未证明真实收款或完成补偿',key()];
   const b=await one(security,review,securityArgs);
   assert.equal(await one(security,review,securityArgs),b);
   await deny(security,review,[incident,'fixture_replay_checked','fixture_checks_only',
    '虚构二次恢复引用','同人不能跨步骤重复署名',key()],'23505');
   const state=(await finance.query(
     'SELECT * FROM ms.scoped_fixture_source_recovery WHERE incident_id=$1',[incident])).rows[0];
   assert.equal(state.review_count,2);
   assert.equal(state.status_zh,'继续隔离、人工复核');
   assert.equal(state.production_source_restored,false);
   assert.equal(state.true_external_reconciliation,false);
   assert.equal(state.execution_allowed,false);
   assert.equal(state.release_allowed,false);
   assert.equal((await other.query(
     'SELECT * FROM ms.scoped_fixture_source_recovery WHERE incident_id=$1',[incident])).rowCount,0);
   await deny(root,'DELETE FROM ms.fixture_source_recovery_reviews WHERE incident_id=$1',[incident],'23514');
  });
  await t.test('source gaps and rollback are independent immutable incidents, never success',async()=>{
   for(const kind of ['missing_page','sequence_gap','watermark_rollback',
     'signature_invalid','source_revoked','tenant_mismatch','duplicate_conflict']){
    const id=await one(finance,report,[source,kind,13,101,
     '虚构故障记录'+kind,'仅用于安全人工检查，不修改来源或业务历史',key()]);
    assert.ok(id);
   }
   const n=(await root.query(
     'SELECT count(*)::int AS n FROM ms.fixture_source_recovery_incidents WHERE source_request_id=$1',
     [source])).rows[0].n;
   assert.equal(n,8);
   const unchanged=(await root.query(
     'SELECT COUNT(*)::int AS n FROM ms.fixture_source_recovery_reviews WHERE incident_id=$1',
     [incident])).rows[0].n;
   assert.equal(unchanged,2);
  });
 }finally{await Promise.all(all.map(p=>p.end()));}
});
