import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';

const A='20000000-0000-4000-8000-000000000011';
const key=()=>randomBytes(20).toString('hex');
const pool=name=>new pg.Pool({connectionString:process.env[name],max:3});
const one=async(p,sql,args)=>(await p.query(sql,args)).rows[0].result;
const deny=(p,sql,args,code)=>assert.rejects(p.query(sql,args),
 e=>e.code===code,'Expected '+code+' for '+sql);
const propose='SELECT ms.propose_cross_module_student_correction($1,$2,$3,$4,$5,$6,$7,$8) AS result';
const sign='SELECT ms.sign_cross_module_student_correction($1,$2,$3,$4,$5,$6) AS result';
const manifest='SELECT ms.propose_cross_module_compensation_manifest($1,$2,$3,$4) AS result';
const item='SELECT ms.propose_cross_module_compensation_item($1,$2,$3,$4,$5,$6) AS result';
const seal='SELECT ms.seal_cross_module_compensation_manifest($1,$2,$3) AS result';
const note='SELECT ms.note_cross_module_external_evidence($1,$2,$3,$4,$5,$6,$7) AS result';
const preflight='SELECT ms.record_cross_module_blocked_preflight($1,$2,$3) AS result';
const candidate='SELECT ms.record_cross_module_untrusted_source_candidate('+
 '$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) AS result';
const gate='SELECT ms.cross_module_readonly_authority_gate($1) AS result';
const trustGate='SELECT ms.cross_module_readonly_source_trust_gate($1) AS result';

test('V3.2-27 unverified source contracts cannot grant execution or unlock quarantine',async t=>{
 const root=pool('DATABASE_URL'),a=pool('DATABASE_URL_WRITE_A'),
  m=pool('DATABASE_URL_WRITE_MANAGER'),m2=pool('DATABASE_URL_WRITE_MANAGER_2'),
  planA=pool('DATABASE_URL_PLAN_A'),sales=pool('DATABASE_URL_PLAN_SALES'),
  finance=pool('DATABASE_URL_PLAN_FINANCE'),academic=pool('DATABASE_URL_PLAN_ACADEMIC'),
  dual=pool('DATABASE_URL_PLAN_DUAL'),financeB=pool('DATABASE_URL_PLAN_B'),
  independent=pool('DATABASE_URL_PLAN_PREFLIGHT');
 const all=[root,a,m,m2,planA,sales,finance,academic,dual,financeB,independent];
 async function newWrongStudentCase(){
  const contact=(await one(a,'SELECT ms.create_scoped_contact($1,$2,$3) AS result',
   ['虚构纠错联系人-'+randomUUID(),false,key()])).contact_id;
  const event=(await one(a,'SELECT ms.create_scoped_contact_consultation($1,$2,$3,$4) AS result',
   [contact,'微信咨询',new Date(Date.now()-100000),key()])).event_id;
  const candidate=await one(a,'SELECT ms.request_consultation_lead_candidate($1,$2,$3,$4) AS result',
   [event,'虚构业务来源材料','交由主管核实候选线索',key()]);
  await one(m,'SELECT ms.decide_consultation_lead_candidate($1,$2,$3,$4,$5) AS result',
   [candidate,'reviewed_eligible','虚构候选证据','符合业务候选标准',key()]);
  const preflight=await one(a,'SELECT ms.submit_lead_conversion_preflight($1,$2,$3,$4) AS result',
   [candidate,'虚构转换证据','申请转换核查',key()]);
  await one(m,'SELECT ms.decide_lead_conversion_preflight($1,$2,$3,$4,$5) AS result',
   [preflight,'cleared','虚构预审证据','允许进入最后复核',key()]);
  const authorization=await one(a,'SELECT ms.request_final_lead_conversion($1,$2,$3,$4) AS result',
   [preflight,'虚构独立转换申请','提交正式线索转换',key()]);
  await one(m,'SELECT ms.decide_final_lead_conversion($1,$2,$3,$4,$5) AS result',
   [authorization,'approved','虚构主管批准','正式线索审核通过',key()]);
  const lead=(await one(a,'SELECT ms.execute_final_lead_conversion($1,$2) AS result',
   [authorization,key()])).lead_id;
  const wrong=(await one(a,'SELECT ms.create_scoped_student($1,$2,$3,$4) AS result',
   ['虚构原错误学生-'+randomUUID(),null,null,key()])).student_id;
  const target=(await one(a,'SELECT ms.create_scoped_student($1,$2,$3,$4) AS result',
   ['虚构正确候选学生-'+randomUUID(),null,null,key()])).student_id;
  const association=await one(a,
   'SELECT ms.request_lead_student_association($1,$2,$3,$4,$5) AS result',
   [lead,wrong,'虚构原学生关联凭据','等待学生关联复核',key()]);
  await one(m,'SELECT ms.decide_lead_student_association($1,$2,$3,$4,$5) AS result',
   [association,'approved_pending','虚构学生关联批准','批准待核实状态',key()]);
  const opportunity=(await root.query(
   "INSERT INTO ms.opportunities(student_id,owner_user_id,originating_lead_id,stage) VALUES($1,$2,$3,'new') RETURNING id",
   [wrong,A,lead])).rows[0].id;
  const order=(await root.query(
   'INSERT INTO ms.sales_orders(student_id,opportunity_id,amount_due_cents) VALUES($1,$2,3000) RETURNING id',
   [wrong,opportunity])).rows[0].id;
  const caseId=await one(a,'SELECT ms.request_downstream_student_correction($1,$2,$3,$4) AS result',
   [association,'虚构错误学生来源材料','发现错绑且已经存在订单',key()]);
  await one(m,'SELECT ms.decide_downstream_student_correction($1,$2,$3,$4,$5) AS result',
   [caseId,'hold_active','虚构隔离核查凭据','确认保持销售推进隔离',key()]);
  const finding=await one(m,
   'SELECT ms.attest_downstream_student_reconciliation($1,$2,$3,$4,$5,$6,$7) AS result',
   [caseId,'wrong_student_confirmed','虚构学生错误核对证据',
    '虚构商机与订单核对证据','虚构资金影响清单','确认错绑学生，保持隔离',key()]);
  await one(m2,'SELECT ms.resolve_downstream_student_reconciliation($1,$2,$3,$4,$5) AS result',
   [finding,'escalate_manual','虚构二次独立复核','确认错误应转跨部门处理',key()]);
  return {lead,wrong,target,opportunity,order,caseId,finding};
 }

 async function readyPlan(c){
  const p=await one(planA,propose,[c.caseId,c.target,
   '虚构独立目标学生核实材料','订单和销售归因待纠错',
   '资金仍等待财务权威确认','学员权益仍等待 CRM 权威确认',
   '提出本机构单学生三方方案而非更改历史',key()]);
  for(const [pdb,dept] of [[sales,'sales'],[finance,'finance'],[academic,'academic']])
   await one(pdb,sign,[p,dept,'approved',dept+'虚构方案审批凭据',
    '只批准拟议方案，实际执行尚不允许',key()]);
  return p;
 }
 function proposedAction(sc){
  if(sc.record_type==='no_linked_record')return 'no_local_fact_review';
  if(sc.department==='sales'&&sc.record_type==='order')return 'sales_contract_review';
  if(sc.department==='finance')return 'finance_allocation_review';
  if(sc.department==='academic')return 'academic_entitlement_review';
  return 'retain_and_review';
 }
 async function listScopes(id){
  return (await planA.query(
   'SELECT scope_id,department,record_type,item_recorded FROM ms.scoped_cross_module_compensation_scope WHERE manifest_id=$1 ORDER BY department,record_type',
   [id])).rows;
 }
 async function fillItems(id,rows){
  for(const sc of rows){
   await one(planA,item,[id,sc.scope_id,proposedAction(sc),
    '虚构原业务引用：'+sc.record_type,'逐项登记拟议补偿；绝不执行或删除原始历史',key()]);
  }
 }

 try{
  await t.test('all existing and newer logins have no original finance or CRM update privileges',async()=>{
   for(const p of [planA,sales,finance,academic,dual,financeB,independent]){
    await deny(p,'SELECT * FROM ms.cross_module_untrusted_source_candidates',[],'42501');
    for(const tb of ['ms.sales_orders','ms.payment_allocations',
      'ms.crm_entitlement_links','ms.cross_module_compensation_manifests']){
     await deny(p,'UPDATE '+tb+' SET id=id WHERE FALSE',[],'42501');
    }
   }
   await deny(a,gate,[randomUUID()],'42501');
   await deny(a,candidate,Array(12).fill(null),'42501');
  });
  const c=await newWrongStudentCase();
  const p=await readyPlan(c);
  const mid=await one(planA,manifest,[p,
   '虚构跨模块来源候选调查清单','虚构清单证据参考',key()]);
  const scopes=await listScopes(mid);
  const finScope=scopes.find(x=>x.department==='finance');
  const acaScope=scopes.find(x=>x.department==='academic');
  assert.ok(finScope&&acaScope);
  const reportAt=new Date(Date.now()-10000);
  const financeArgs=[mid,finScope.scope_id,'finance','finance_receipt',
   'fictional_finance','fictional_org_a','receipt:fictional-001',
   'v1','a'.repeat(64),'unverified_response',reportAt,key()];
  const crmArgs=[mid,acaScope.scope_id,'academic','crm_entitlement',
   'fictional_crm','fictional_org_a','package:fictional-001',
   'v1','b'.repeat(64),'result_unknown',reportAt,key()];

  await t.test('no recording before local inventory is sealed and complete',async()=>{
   await deny(finance,candidate,financeArgs,'23514');
   const initialTrust=await one(planA,trustGate,[mid]);
   assert.equal(initialTrust.execution_allowed,false);
   assert.equal(initialTrust.release_allowed,false);
   assert.equal(initialTrust.production_finance_source_bound,false);
   assert.equal(initialTrust.production_crm_source_bound,false);
   assert.equal(initialTrust.production_durable_replay_ledger_ready,false);
   assert.equal(initialTrust.readonly_fixture_signature_test_available,true);
   await deny(financeB,trustGate,[mid],'42501');
   const initial=await one(planA,gate,[mid]);
   assert.equal(initial.execution_allowed,false);
   assert.equal(initial.release_allowed,false);
   assert.equal(initial.source_candidates_untrusted,0);
   assert.ok(initial.blockers_zh.some(x=>x.includes('封存')));
  });
  await fillItems(mid,scopes);
  await one(planA,seal,[mid,'本地关联对象全部已列出，权威状态未知',key()]);
  await t.test('candidate role, tenant, scope type, status and source format fail closed',async()=>{
   await deny(financeB,candidate,financeArgs,'42501');
   await deny(sales,candidate,financeArgs,'42501');
   await deny(academic,candidate,financeArgs,'42501');
   await deny(finance,candidate,[...financeArgs.slice(0,2),'academic',...financeArgs.slice(3)],'23514');
   await deny(finance,candidate,[...financeArgs.slice(0,3),'crm_entitlement',...financeArgs.slice(4)],'23514');
   await deny(finance,candidate,[...financeArgs.slice(0,9),'verified',...financeArgs.slice(10)],'23514');
   await deny(finance,candidate,[...financeArgs.slice(0,6),'../../invalid',...financeArgs.slice(7)],'23514');
   await deny(finance,candidate,[...financeArgs.slice(0,1),acaScope.scope_id,...financeArgs.slice(2)],'42501');
  });
  await t.test('finance and CRM candidates are append-only and idempotent but never trusted',async()=>{
   const f=await one(finance,candidate,financeArgs);
   assert.equal(await one(finance,candidate,financeArgs),f);
   await deny(finance,candidate,[...financeArgs.slice(0,8),'c'.repeat(64),...financeArgs.slice(9)],'23505');
   await deny(finance,candidate,[...financeArgs.slice(0,11),key()],'23505');
   const aId=await one(academic,candidate,crmArgs);
   assert.notEqual(aId,f);
   await deny(root,"UPDATE ms.cross_module_untrusted_source_candidates SET reported_status='disputed' WHERE id=$1",[f],'23514');
   await deny(root,'DELETE FROM ms.cross_module_untrusted_source_candidates WHERE id=$1',[aId],'23514');
   const raw=(await root.query('SELECT department,reported_status FROM ms.cross_module_untrusted_source_candidates WHERE manifest_id=$1 ORDER BY department',[mid])).rows;
   assert.deepEqual(raw.map(x=>x.department),['academic','finance']);
   assert.deepEqual(raw.map(x=>x.reported_status),['result_unknown','unverified_response']);
   const counts=(await finance.query(
    'SELECT * FROM ms.scoped_cross_module_authority_candidate_counts WHERE manifest_id=$1',[mid])).rows[0];
   assert.equal(counts.finance_unverified_candidates,1);
   assert.equal(counts.academic_unverified_candidates,1);
   assert.equal(counts.execution_allowed,false);
   assert.equal((await financeB.query(
    'SELECT * FROM ms.scoped_cross_module_authority_candidate_counts WHERE manifest_id=$1',[mid])).rowCount,0);
   const result=await one(finance,gate,[mid]);
   assert.equal(result.source_candidates_untrusted,2);
   assert.equal(result.finance_source_authenticated,false);
   assert.equal(result.academic_source_authenticated,false);
   assert.equal(result.execution_allowed,false);
   assert.equal(result.release_allowed,false);
   assert.ok(result.blockers_zh.some(x=>x.includes('财务权威')));
   await deny(financeB,gate,[mid],'42501');
  });
  await t.test('even after both manual references and third-party blocked preflight no executor exists',async()=>{
   await one(finance,note,[mid,'finance','manual_reference_only',
    '虚构人工财务参考单','source-not-authenticated',
    '来源只用于提醒核对不代表已收款或转移资金',key()]);
   await one(academic,note,[mid,'academic','result_unknown',
    '虚构教务人工参考单','source-not-authenticated',
    'CRM 请求的真实结果仍未知不得再次发课',key()]);
   const blocked=await one(independent,preflight,[mid,
    '双部门来源未建立权威签名与终局回执，禁止实际补偿和解除隔离',key()]);
   assert.ok(blocked);
   const result=await one(independent,gate,[mid]);
   assert.equal(result.local_snapshot_current,true);
   assert.equal(result.three_party_plan_approved,true);
   assert.equal(result.execution_allowed,false);
   assert.equal(result.release_allowed,false);
   const trust=await one(independent,trustGate,[mid]);
   assert.equal(trust.production_source_signatures_authenticated,false);
   assert.equal(trust.production_complete_watermark_verified,false);
   assert.equal(trust.production_finance_reconciled,false);
   assert.equal(trust.production_crm_reconciled,false);
   assert.equal(trust.production_compensation_authorized,false);
   assert.equal(trust.execution_allowed,false);
   assert.equal(trust.release_allowed,false);
   assert.equal(trust.additional_blockers_zh.length,3);
   assert.equal((await root.query('SELECT student_id FROM ms.sales_orders WHERE id=$1',[c.order])).rows[0].student_id,c.wrong);
   assert.equal((await root.query('SELECT status FROM ms.lead_student_downstream_correction_cases WHERE id=$1',[c.caseId])).rows[0].status,'hold_active');
  });
  await t.test('late finance activity and newer correction plan invalidate old source candidates',async()=>{
   const receipt=(await root.query(
    "INSERT INTO ms.payment_receipt_projections(authority_system,external_payment_id,amount_cents) VALUES('fictional-ci',$1,2500) RETURNING id",
    ['late-'+randomUUID()])).rows[0].id;
   await root.query('INSERT INTO ms.payment_allocations(receipt_id,order_id,allocated_cents) VALUES($1,$2,500)',[receipt,c.order]);
   const stale=await one(planA,gate,[mid]);
   assert.equal(stale.local_snapshot_current,false);
   assert.equal(stale.execution_allowed,false);
   assert.ok(stale.blockers_zh.some(x=>x.includes('变化')));
   await deny(finance,candidate,[...financeArgs.slice(0,7),'v2',...financeArgs.slice(8,11),key()],'23514');
   await one(planA,propose,[c.caseId,c.target,'虚构更新后目标学生核验',
     '有迟到付款需要重新核实销售','资金已变更必须重走财务评审',
     '教务需重新核实剩余课时','更新纠错方案版本拒绝沿用旧审批',key()]);
   const newer=await one(planA,gate,[mid]);
   assert.equal(newer.three_party_plan_approved,false);
   assert.equal(newer.release_allowed,false);
   assert.ok(newer.blockers_zh.some(x=>x.includes('新版本')));
  });
 }finally{await Promise.all(all.map(p=>p.end()));}
});
