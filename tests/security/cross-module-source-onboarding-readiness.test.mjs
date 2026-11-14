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
const submit='SELECT ms.request_cross_module_source_onboarding($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS result';
const review='SELECT ms.review_cross_module_source_onboarding($1,$2,$3,$4,$5,$6) AS result';
const readiness='SELECT ms.cross_module_source_onboarding_readiness($1) AS result';

test('V3.2-29 immutable source onboarding proposals cannot authorize production connections',async t=>{
 const root=pool('DATABASE_URL'),a=pool('DATABASE_URL_WRITE_A'),
  m=pool('DATABASE_URL_WRITE_MANAGER'),m2=pool('DATABASE_URL_WRITE_MANAGER_2'),
  planA=pool('DATABASE_URL_PLAN_A'),sales=pool('DATABASE_URL_PLAN_SALES'),
  finance=pool('DATABASE_URL_PLAN_FINANCE'),academic=pool('DATABASE_URL_PLAN_ACADEMIC'),
  dual=pool('DATABASE_URL_PLAN_DUAL'),financeB=pool('DATABASE_URL_PLAN_B'),
  independent=pool('DATABASE_URL_PLAN_PREFLIGHT'),
  security=pool('DATABASE_URL_SOURCE_SECURITY');
 const all=[root,a,m,m2,planA,sales,finance,academic,dual,financeB,independent,security];
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


 const submitArgs=(id,dept)=>[id,dept,
  dept==='finance'?'fictional_finance':'fictional_crm','fictional_org_a',
  '仅申请虚构来源只读对接准备，不允许连接真实账户',
  'data-minimum-plan-01','tenant-student-mapping-01',
  'security-control-checklist-01','unknown-failure-recovery-01',key()];
 const decideArgs=(id,role,decision='approved_for_planning')=>[
  id,role,decision,'fictional-source-approval-evidence-01',
  '仅表示该部门已核对准备材料，不能授予真实来源权限',key()
 ];
 try{
  await t.test('security identity cannot read tables or modify business rows',async()=>{
   for(const p of [security,finance,academic,planA,financeB]){
    for(const table of ['ms.cross_module_source_onboarding_requests',
       'ms.cross_module_source_onboarding_reviews','ms.sales_orders',
       'ms.payment_allocations','ms.crm_entitlement_links']){
      await deny(p,'SELECT * FROM '+table,[],'42501');
    }
    for(const table of ['ms.sales_orders','ms.payment_allocations',
       'ms.crm_entitlement_links']){
      await deny(p,'UPDATE '+table+' SET id=id WHERE FALSE',[],'42501');
    }
   }
   await deny(a,submit,Array(10).fill(null),'42501');
  });
  const c=await newWrongStudentCase();
  const p=await readyPlan(c);
  const mid=await one(planA,manifest,[p,
   '虚构来源登记需逐项确认原业务范围','fictional-source-manifest-evidence',key()]);
  const rows=await listScopes(mid);
  await t.test('source registration rejects unsealed and unverifiable dossier',async()=>{
   const before=await one(planA,readiness,[mid]);
   assert.equal(before.planning_paperwork_complete,false);
   assert.equal(before.production_readonly_connection_allowed,false);
   await deny(planA,submit,submitArgs(mid,'finance'),'23514');
  });
  await fillItems(mid,rows);
  await one(planA,seal,[mid,'虚构来源范围已全部记录但未取得权威回执',key()]);
  let fReq,aReq;
  await t.test('only applicant may submit two separate immutable department dossiers',async()=>{
   const f=submitArgs(mid,'finance');
   await deny(finance,submit,f,'42501');
   await deny(security,submit,f,'42501');
   await deny(financeB,submit,f,'42501');
   fReq=await one(planA,submit,f);
   assert.equal(await one(planA,submit,f),fReq);
   await deny(planA,submit,[...f.slice(0,4),'不同用途说明无法复用旧防重编号',...f.slice(5)],'23505');
   await deny(planA,submit,submitArgs(mid,'finance'),'23505');
   aReq=await one(planA,submit,submitArgs(mid,'academic'));
   assert.notEqual(aReq,fReq);
   const q=await one(planA,readiness,[mid]);
   assert.equal(q.planning_requests,2);
   assert.equal(q.domain_planning_approvals,0);
   assert.equal(q.production_readonly_connection_allowed,false);
   assert.equal(q.execution_allowed,false);
   assert.equal(q.release_allowed,false);
   await deny(financeB,readiness,[mid],'42501');
   await deny(root,"UPDATE ms.cross_module_source_onboarding_requests SET source_tenant='fictional_org_b' WHERE id=$1",[fReq],'23514');
  });
  await t.test('financial reviewer cannot act as academic or independent security',async()=>{
   await deny(planA,review,decideArgs(fReq,'domain_owner'),'42501');
   await deny(finance,review,decideArgs(aReq,'domain_owner'),'42501');
   await deny(academic,review,decideArgs(fReq,'domain_owner'),'42501');
   await deny(finance,review,decideArgs(fReq,'security_owner'),'42501');
   await deny(sales,review,decideArgs(fReq,'security_owner'),'42501');
   await deny(security,review,decideArgs(fReq,'domain_owner'),'42501');
   await deny(security,review,decideArgs(fReq,'security_owner'),'23514');
  });
  await t.test('separate financial and academic approvals; security after both',async()=>{
   const fa=decideArgs(fReq,'domain_owner');
   const fid=await one(finance,review,fa);
   assert.equal(await one(finance,review,fa),fid);
   await deny(finance,review,[...fa.slice(0,4),'改变审核理由',fa[5]],'23505');
   await deny(academic,review,decideArgs(aReq,'security_owner'),'42501');
   await deny(security,review,decideArgs(aReq,'security_owner'),'23514');
   const aid=await one(academic,review,decideArgs(aReq,'domain_owner'));
   assert.ok(aid);
   const sF=decideArgs(fReq,'security_owner');
   const sid=await one(security,review,sF);
   assert.equal(await one(security,review,sF),sid);
   const aS=await one(security,review,decideArgs(aReq,'security_owner'));
   assert.ok(aS);
   const q=await one(security,readiness,[mid]);
   assert.equal(q.planning_requests,2);
   assert.equal(q.domain_planning_approvals,2);
   assert.equal(q.independent_security_planning_approvals,2);
   assert.equal(q.planning_paperwork_complete,true);
   assert.equal(q.upstream_three_party_roles_current,true);
   for(const field of ['official_source_registered',
    'official_credentials_installed','production_readonly_connection_allowed',
    'finance_source_authenticated','crm_source_authenticated',
    'execution_allowed','release_allowed'])assert.equal(q[field],false,field);
   assert.equal(q.blockers_zh.length,4);
   await deny(root,"DELETE FROM ms.cross_module_source_onboarding_reviews WHERE request_id=$1",[fReq],'23514');
   assert.equal((await root.query('SELECT status FROM ms.lead_student_downstream_correction_cases WHERE id=$1',[c.caseId])).rows[0].status,'hold_active');
   assert.equal((await root.query('SELECT student_id FROM ms.sales_orders WHERE id=$1',[c.order])).rows[0].student_id,c.wrong);
  });
  await t.test('revoked source security role invalidates all prior planning approvals',async()=>{
   await root.query(
    "UPDATE ms.user_role_grants SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL",
    ['30000000-0000-4000-8000-000000000018']);
   const q=await one(planA,readiness,[mid]);
   assert.equal(q.domain_planning_approvals,2);
   assert.equal(q.independent_security_planning_approvals,2);
   assert.equal(q.valid_current_role_approvals,2);
   assert.equal(q.upstream_three_party_roles_current,true);
   assert.equal(q.planning_paperwork_complete,false);
   assert.equal(q.production_readonly_connection_allowed,false);
   assert.equal(q.execution_allowed,false);
   assert.equal(q.release_allowed,false);
   await deny(security,readiness,[mid],'42501');
  });
  await t.test('late finance event and new plan version revoke readiness, not recorded history',async()=>{
   const receipt=(await root.query(
    "INSERT INTO ms.payment_receipt_projections(authority_system,external_payment_id,amount_cents) VALUES('fictional-ci',$1,3400) RETURNING id",
    ['late-source-'+randomUUID()])).rows[0].id;
   await root.query('INSERT INTO ms.payment_allocations(receipt_id,order_id,allocated_cents) VALUES($1,$2,300)',[receipt,c.order]);
   const stale=await one(planA,readiness,[mid]);
   assert.equal(stale.local_scope_current,false);
   assert.equal(stale.planning_paperwork_complete,false);
   assert.equal(stale.release_allowed,false);
   await deny(planA,submit,submitArgs(mid,'academic'),'23514');
   await one(planA,propose,[c.caseId,c.target,'独立目标学生核验新版本',
      '订单存在晚到资金必须重新核对','来源申报需重新确认',
      'CRM 需要重新核实课程权益','新版本不得沿用旧来源准备签署',key()]);
   const old=await one(planA,readiness,[mid]);
   assert.equal(old.latest_plan,false);
   assert.equal(old.planning_paperwork_complete,false);
   assert.equal(old.execution_allowed,false);
  });
 } finally {await Promise.all(all.map(p=>p.end()));}
});
