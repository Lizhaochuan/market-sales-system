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

test('V3.2-26 append-only compensation scope, external UNKNOWN, permanently blocked preflight',async t=>{
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
  await t.test('all specialized logins are function-only and cannot write existing orders, funds, CRM or history',async()=>{
   for(const p of [planA,sales,finance,academic,dual,financeB,independent]){
    for(const tb of ['ms.cross_module_compensation_manifests',
      'ms.cross_module_compensation_scope','ms.cross_module_compensation_items',
      'ms.cross_module_compensation_seals','ms.cross_module_external_evidence_notes',
      'ms.cross_module_execution_preflight_blocks','ms.sales_orders',
      'ms.payment_allocations','ms.crm_entitlement_links']){
      await deny(p,'SELECT * FROM '+tb,[],'42501');
    }
    await deny(p,'UPDATE ms.sales_orders SET payment_state=payment_state WHERE FALSE',[],'42501');
    await deny(p,'DELETE FROM ms.crm_entitlement_links WHERE FALSE',[],'42501');
   }
  });
  const c=await newWrongStudentCase();
  let plan,man,sealed;
  await t.test('cannot open compensation inventory without three current approvals',async()=>{
   const draft=await one(planA,propose,[c.caseId,c.target,
     '虚构目标学生依据','销售原订单待复核','财务源待复核','教务源待复核',
     '未审核方案不得进入补偿清单',key()]);
   await deny(planA,manifest,[draft,'未批准的清单','虚构依据',key()],'23514');
   for(const [pdb,dept] of [[sales,'sales'],[finance,'finance'],[academic,'academic']])
    await one(pdb,sign,[draft,dept,'approved',dept+'虚构跨模块确认',
       '仅批准本版本拟议方案',key()]);
   plan=draft;
  });
  await t.test('original proposer creates scoped immutable inventory; unknown finance/CRM still requires department reviews',async()=>{
   const data=[plan,'订单、资金、试课和权益拟议清单','虚构清单证据引用',key()];
   await deny(finance,manifest,data,'42501');
   await deny(financeB,manifest,data,'42501');
   await deny(a,manifest,data,'42501');
   man=await one(planA,manifest,data);
   assert.equal(await one(planA,manifest,data),man);
   await deny(planA,manifest,[plan,data[1],'不同虚构引用',data[3]],'23505');
   const rows=await listScopes(man);
   assert.ok(rows.some(x=>x.record_type==='opportunity'));
   assert.ok(rows.some(x=>x.record_type==='order'));
   assert.ok(rows.some(x=>x.department==='finance'&&x.record_type==='no_linked_record'));
   assert.ok(rows.some(x=>x.department==='academic'&&x.record_type==='no_linked_record'));
   assert.ok(rows.every(x=>!x.item_recorded));
   assert.equal((await financeB.query('SELECT * FROM ms.scoped_cross_module_compensation_status WHERE manifest_id=$1',[man])).rowCount,0);
   assert.equal((await financeB.query('SELECT * FROM ms.scoped_cross_module_compensation_scope WHERE manifest_id=$1',[man])).rowCount,0);
   const view=(await planA.query('SELECT * FROM ms.scoped_cross_module_compensation_status WHERE manifest_id=$1',[man])).rows[0];
   assert.equal(view.execution_allowed,false);
   assert.equal(view.release_allowed,false);
   assert.equal(view.external_finance_verified,false);
   assert.equal(view.external_academic_verified,false);
   assert.equal(view.scope_count,rows.length);
   await deny(planA,seal,[man,'未逐项登记不得封存',key()],'23514');
  });
  await t.test('all local scope rows require one proposed action; wrong department and alien scope are rejected',async()=>{
   const rows=await listScopes(man);
   await deny(finance,item,[man,rows[0].scope_id,'retain_and_review','禁止财务代申请','不能代填',key()],'42501');
   await deny(financeB,item,[man,rows[0].scope_id,'retain_and_review','跨机构引用','拒绝',key()],'42501');
   const salesRow=rows.find(x=>x.department==='sales'&&x.record_type==='order');
   await deny(planA,item,[man,salesRow.scope_id,'finance_refund_review','不允许错误领域','错部门动作',key()],'23514');
   await fillItems(man,rows);
   const filled=await listScopes(man);
   assert.ok(filled.every(x=>x.item_recorded));
   await deny(planA,item,[man,salesRow.scope_id,'sales_contract_review','不同依据','第二个动作',key()],'23505');
   assert.equal((await root.query(
    'SELECT count(*)::int AS n FROM ms.cross_module_compensation_items WHERE manifest_id=$1',[man])).rows[0].n,rows.length);
  });
  await t.test('seal only after complete coverage; duplicate remains idempotent; source histories untouched',async()=>{
   const args=[man,'全部本地来源仅拟议，外部权威未核实',key()];
   sealed=await one(planA,seal,args);
   assert.equal(await one(planA,seal,args),sealed);
   await deny(planA,seal,[man,'封存第二次',key()],'23505');
   const row=(await planA.query('SELECT * FROM ms.scoped_cross_module_compensation_status WHERE manifest_id=$1',[man])).rows[0];
   assert.equal(row.local_scope_sealed,true);assert.equal(row.item_count,row.scope_count);
   await deny(root,"UPDATE ms.cross_module_compensation_items SET reason_zh='变更' WHERE manifest_id=$1",[man],'23514');
   await deny(root,'DELETE FROM ms.cross_module_compensation_scope WHERE manifest_id=$1',[man],'23514');
   await deny(root,'DELETE FROM ms.cross_module_compensation_seals WHERE manifest_id=$1',[man],'23514');
  });
  await t.test('only finance/academic log external notes as UNKNOWN or manual reference; never authenticated source confirmation',async()=>{
   const f=[man,'finance','manual_reference_only','虚构财务人工引用',
      '来源版本尚未接通','尚未连接财务权威，不能证实资金调整',key()];
   await deny(sales,note,f,'42501');
   await deny(academic,note,f,'42501');
   await deny(financeB,note,f,'42501');
   const fid=await one(finance,note,f);
   assert.equal(await one(finance,note,f),fid);
   await deny(independent,preflight,[man,'只有一方外部记录时拒绝',key()],'23514');
   const e=[man,'academic','result_unknown','虚构 CRM 人工引用',
     '未取得真正权威版本','CRM 课时请求结果未知不能重复开课',key()];
   await one(academic,note,e);
   await deny(finance,note,[man,'academic','result_unknown','跨部门引用','不适用版本','禁止重签',key()],'42501');
   const row=(await planA.query('SELECT * FROM ms.scoped_cross_module_compensation_status WHERE manifest_id=$1',[man])).rows[0];
   assert.equal(row.finance_manual_note,true);assert.equal(row.academic_manual_note,true);
   assert.equal(row.external_finance_verified,false);
   assert.equal(row.external_academic_verified,false);
  });
  await t.test('preflight is always blocked, by third independent supervisor only; no release or external write',async()=>{
   await deny(sales,preflight,[man,'此前方案审核人不允许独立终审',key()],'42501');
   await deny(dual,preflight,[man,'此前第二主管不允许终审',key()],'42501');
   await deny(finance,preflight,[man,'非销售终审人',key()],'42501');
   const args=[man,'已核对本地清单，外部权威来源没有接通，绝不授权执行',key()];
   const x=await one(independent,preflight,args);
   assert.equal(await one(independent,preflight,args),x);
   const blocked=(await root.query('SELECT * FROM ms.cross_module_execution_preflight_blocks WHERE id=$1',[x])).rows[0];
   assert.equal(blocked.status,'blocked_external_authority');
   assert.equal(blocked.execution_allowed,false);
   assert.equal(blocked.release_allowed,false);
   assert.equal(blocked.external_finance_verified,false);
   assert.equal(blocked.external_academic_verified,false);
   const s=(await planA.query('SELECT * FROM ms.scoped_cross_module_compensation_status WHERE manifest_id=$1',[man])).rows[0];
   assert.equal(s.blocked_preflight_recorded,true);
   assert.equal(s.execution_allowed,false);
   assert.equal(s.release_allowed,false);
   assert.equal((await root.query('SELECT status FROM ms.lead_student_downstream_correction_cases WHERE id=$1',[c.caseId])).rows[0].status,'hold_active');
   assert.equal((await root.query('SELECT student_id FROM ms.sales_orders WHERE id=$1',[c.order])).rows[0].student_id,c.wrong);
   assert.equal((await root.query('SELECT student_id FROM ms.opportunities WHERE id=$1',[c.opportunity])).rows[0].student_id,c.wrong);
   await deny(root,'DELETE FROM ms.cross_module_external_evidence_notes WHERE manifest_id=$1',[man],'23514');
   await deny(root,'DELETE FROM ms.cross_module_execution_preflight_blocks WHERE manifest_id=$1',[man],'23514');
  });
  await t.test('late financial allocation makes local fingerprint stale; cannot seal or claim another authorization',async()=>{
   const later=await newWrongStudentCase();
   const lp=await readyPlan(later);
   const lm=await one(planA,manifest,[lp,'迟到资金事实检测清单','虚构清单关联证据',key()]);
   const rows=await listScopes(lm);await fillItems(lm,rows);
   const receipt=(await root.query(
      "INSERT INTO ms.payment_receipt_projections(authority_system,external_payment_id,amount_cents) VALUES('fictional-ci',$1,2000) RETURNING id",
       ['fictional-late-'+randomUUID()])).rows[0].id;
   await root.query('INSERT INTO ms.payment_allocations(receipt_id,order_id,allocated_cents) VALUES($1,$2,600)',
      [receipt,later.order]);
   await deny(planA,seal,[lm,'源已经变化必须暂停',key()],'23514');
   assert.equal((await root.query('SELECT count(*)::int AS n FROM ms.cross_module_compensation_seals WHERE manifest_id=$1',[lm])).rows[0].n,0);
   assert.equal((await root.query('SELECT status FROM ms.lead_student_downstream_correction_cases WHERE id=$1',[later.caseId])).rows[0].status,'hold_active');
   const p2=await one(planA,propose,[later.caseId,later.target,'虚构新版本核验依据',
      '晚到资金影响重新确认','应重新核实权威资金','应重新核实 CRM 权益',
      '资金影响变化后必须重新走三部门版本审查',key()]);
   assert.ok(p2);
   await deny(planA,seal,[lm,'旧版已失效不能封存',key()],'23514');
   await deny(independent,preflight,[lm,'不能根据失效旧版本预审',key()],'23514');
  });
 } finally {await Promise.all(all.map(p=>p.end()));}
});
