import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import pg from 'pg';

const key=()=>randomBytes(20).toString('hex');
const pool=name=>new pg.Pool({connectionString:process.env[name],max:2});
const one=async(p,sql,args)=>(await p.query(sql,args)).rows[0].result;
const deny=(p,sql,args,code)=>assert.rejects(p.query(sql,args),
 error=>error.code===code,'Expected '+code+' for '+sql);
const propose='SELECT ms.propose_fixture_source_readiness($1,$2,$3,$4,$5,$6) AS result';
const review='SELECT ms.review_fixture_source_readiness($1,$2,$3,$4,$5,$6) AS result';

test('V3.2-29 restricted fictional-only registration and business/security approval',async t=>{
 const root=pool('DATABASE_URL'),fin=pool('DATABASE_URL_PLAN_FINANCE'),
  acad=pool('DATABASE_URL_PLAN_ACADEMIC'),
  dual=pool('DATABASE_URL_PLAN_DUAL'),
  other=pool('DATABASE_URL_PLAN_B'),
  security=pool('DATABASE_URL_SOURCE_SECURITY'),
  low=pool('DATABASE_URL_WRITE_A');
 const all=[root,fin,acad,dual,other,security,low];
 try{
  await t.test('all reviewers are function-only, without source table or funds access',async()=>{
   for(const p of [fin,acad,dual,other,security]){
    for(const tb of ['ms.source_readiness_requests','ms.source_readiness_reviews',
      'ms.payment_allocations','ms.crm_entitlement_links']){
      await deny(p,'SELECT * FROM '+tb,[],'42501');
      await deny(p,'UPDATE '+tb+' SET id=id WHERE FALSE',[],'42501');
    }
   }
   await deny(low,propose,['finance','fictional_bank_test','fictional_org_a',
    '只读模拟来源准备','虚构凭证引用',key()],'42501');
  });
  await t.test('financial reviewer can propose only fictitious source bound to own tenant',async()=>{
   const args=['finance','fictional_finance_test','fictional_org_a',
    '只准备虚构来源只读合同','虚构来源登记材料引用',key()];
   await deny(acad,propose,args,'42501');
   await deny(fin,propose,['finance','https://bank.example','fictional_org_a',
    args[3],args[4],key()],'23514');
   await deny(fin,propose,['finance','fictional_finance_test',
    'real_tenant_a',args[3],args[4],key()],'23514');
   const rid=await one(fin,propose,args);
   assert.equal(await one(fin,propose,args),rid);
   await deny(fin,propose,[...args.slice(0,3),'不同的登记范围',args[4],args[5]],'23505');
   await deny(other,review,[rid,'business','fixture_ready','虚构批准依据',
    '仅模拟审批，不授权对接',key()],'42501');
   await deny(fin,review,[rid,'business','fixture_ready','虚构自签',
    '不能自己审批来源',key()],'42501');
   await deny(security,review,[rid,'business','fixture_ready','虚构业务批准',
    '安全部门不能代替财务',key()],'42501');
   const b=await one(dual,review,[rid,'business','fixture_ready',
    '虚构财务业务核查材料','仅虚构来源方案已核查，未授权真实接口',key()]);
   assert.ok(b);
   const req=await one(security,review,[rid,'security','fixture_ready',
    '虚构安全措施核查','仅虚构测试条件已满足，真实来源尚未审批',key()]);
   assert.ok(req);
   const row=(await fin.query(
    'SELECT * FROM ms.scoped_fixture_source_readiness WHERE request_id=$1',[rid])).rows[0];
   assert.equal(row.fixture_review_count,2);
   assert.equal(row.fictional_fixture_reviewed,true);
   assert.equal(row.production_source_approved,false);
   assert.equal(row.credentials_approved,false);
   assert.equal(row.real_readonly_connection_enabled,false);
   assert.equal(row.execution_allowed,false);
   assert.equal(row.release_allowed,false);
   assert.equal((await other.query(
    'SELECT * FROM ms.scoped_fixture_source_readiness WHERE request_id=$1',[rid])).rowCount,0);
   await deny(root,'DELETE FROM ms.source_readiness_reviews WHERE request_id=$1',[rid],'23514');
   await deny(root,"UPDATE ms.source_readiness_requests SET scope_zh='覆盖原始记录' WHERE id=$1",[rid],'23514');
   await deny(security,review,[rid,'business','fixture_ready','虚构绕过',
     '不能第二次跨角色重复签字',key()],'42501');
  });
  await t.test('security cannot self-approve, rejected request cannot later be promoted',async()=>{
   const args=['academic','fictional_crm_test','fictional_org_a',
     '虚构课程来源只读准备','虚构教务请求材料',key()];
   const rid=await one(acad,propose,args);
   await deny(acad,review,[rid,'business','fixture_ready','自审材料',
    '申请人禁止自审',key()],'42501');
   await deny(dual,review,[rid,'business','fixture_ready','错误部门材料',
    '销售不是教务审核',key()],'42501');
   const rejected=await one(security,review,[rid,'security','return_for_revision',
     '虚构证据不足材料','来源租户映射和只读权限证明不全',key()]);
   assert.ok(rejected);
   await deny(fin,review,[rid,'business','fixture_ready','越权审批',
    '错误部门不能补签',key()],'42501');
   const row=(await acad.query('SELECT * FROM ms.scoped_fixture_source_readiness WHERE request_id=$1',
     [rid])).rows[0];
   assert.equal(row.returned_or_rejected,true);
   assert.equal(row.production_source_approved,false);
  });
 }finally{await Promise.all(all.map(x=>x.end()));}
});
