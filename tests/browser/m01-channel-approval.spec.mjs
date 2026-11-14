import {test,expect} from '@playwright/test';
import {createSign,generateKeyPairSync,randomUUID} from 'node:crypto';
import pg from 'pg';
import {createApp} from '../../src/app.mjs';

const org='20000000-0000-4000-8000-000000000001';
const A='20000000-0000-4000-8000-000000000011';
const M='20000000-0000-4000-8000-000000000013';
const M2='20000000-0000-4000-8000-000000000014';
const issuer='https://fictional-m01-browser-approval.example.invalid';
const audience='m01-browser-approved-channel-maintenance';
const signingSecret='fictional-test-only-strong-token-secret-9c92789dc3b9';

test('M01 Chinese strict workbench: employee request, independent manager approval, channel history and logout',async({browser},testInfo)=>{
 test.setTimeout(120000);
 process.env.MS_STAGE='isolated-test';
 const admin=new pg.Pool({connectionString:process.env.DATABASE_URL,max:4});
 const directory=new pg.Pool({connectionString:process.env.DATABASE_URL_AUTH_DIRECTORY,max:2});
 const readA=new pg.Pool({connectionString:process.env.DATABASE_URL_ASSIGNEE_A,max:2});
 const readM=new pg.Pool({connectionString:process.env.DATABASE_URL_ASSIGNEE_MANAGER,max:2});
 const writeA=new pg.Pool({connectionString:process.env.DATABASE_URL_WRITE_A,max:2});
 const writeM=new pg.Pool({connectionString:process.env.DATABASE_URL_WRITE_MANAGER,max:2});
 const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
 const jwk={...publicKey.export({format:'jwk'}),kid:'m01-channels-'+randomUUID(),alg:'RS256',use:'sig'};
 const subjects=new Map([[A,'m01-browser-a-'+randomUUID()],[M,'m01-browser-manager-'+randomUUID()]]);
 const identity={issuer,audience,jwks:{keys:[jwk]}};
 const sign=staff=>{
  const now=Math.floor(Date.now()/1000);
  const h=Buffer.from(JSON.stringify({typ:'JWT',alg:'RS256',kid:jwk.kid})).toString('base64url');
  const payload=Buffer.from(JSON.stringify({iss:issuer,aud:audience,
   sub:subjects.get(staff),iat:now,exp:now+900,
   role:'super_admin',staff_id:M2,
   org_id:'20000000-0000-4000-8000-000000000002'})).toString('base64url');
  return h+'.'+payload+'.'+createSign('RSA-SHA256').update(h+'.'+payload)
   .sign(privateKey).toString('base64url');
 };
 async function approved(target,reviewer){
  const q=await admin.query(
   "INSERT INTO ms.identity_change_requests(organization_id,action,target_staff_id,"+
   "issuer,subject,requested_by,request_evidence_ref,request_reason_zh) "+
   "VALUES($1,'bind',$2,$3,$4,$5,'本机员工测试资料','独立主管核验') RETURNING id",
   [org,target,issuer,subjects.get(target),target===M?A:reviewer]);
  await admin.query(
   "INSERT INTO ms.identity_change_decisions(request_id,reviewer_user_id,decision,"+
   "review_evidence_ref,reason_zh) VALUES($1,$2,'approved','独立核实凭据','虚构员工核验')",
   [q.rows[0].id,M2]);
  await admin.query(
   "UPDATE ms.identity_change_requests SET status='approved',decided_by=$2,decided_at=now() WHERE id=$1",
   [q.rows[0].id,M2]);
  await admin.query(
   "INSERT INTO ms.staff_identity_bindings(staff_user_id,issuer,subject,bound_by,approval_request_id) "+
   "VALUES($1,$2,$3,$4,$5)",
   [target,issuer,subjects.get(target),M2,q.rows[0].id]);
 }
 let app,staffPage,managerPage,createdId,campaignId,salesReviewId,financeIncidentId,escalationIncidentId;
 const name='隔离界面渠道-'+randomUUID();
 const changedName=name+'-改名';
 const login=async(staff)=>{
  const page=await browser.newPage();
  await page.goto('http://127.0.0.1:'+app.address().port+'/');
  await page.locator('#external-login-form input[name="signed_token"]').fill(sign(staff));
  await page.getByRole('button',{name:'验证员工身份并进入'}).click();
  await expect(page.locator('#page-title')).toHaveText('工作概览');
  await page.getByRole('button',{name:'获客渠道'}).click();
  await expect(page.locator('#channel-maintenance-workbench')).toBeVisible();
  await expect(page.locator('#channel-request-form')).toBeVisible();
  await expect(page.locator('#channel-requests-status')).toContainText('只显示本人');
  return page;
 };
 const reviewRequest=async(page,matchName)=>{
  await page.getByRole('button',{name:'刷新数据'}).click();
  const select=page.locator('#channel-review-choice');
  const opt=select.locator('option').filter({hasText:matchName}).first();
  await expect(opt).toBeAttached();
  const value=await opt.getAttribute('value');
  await select.selectOption(value);
  await page.locator('#channel-review-form select[name="decision"]').selectOption('approved');
  await page.locator('#channel-review-form input[name="evidence_ref"]').fill('独立虚构审批凭据');
  await page.locator('#channel-review-form textarea[name="reason_zh"]').fill('已复核当前机构渠道状态，批准执行');
  await page.locator('#channel-review-form button[type="submit"]').click();
  await expect(page.locator('#toast')).toContainText('独立主管已批准');
 };
 try{
  await approved(A,M);
  await approved(M,M2);
  app=createApp({connect(){throw Error('strict UI may not use the broad database connection');}},{
   secret:signingSecret,externalIdentity:identity,strictStaffMode:true,
   identityDirectoryPool:directory,
   scopedReadPools:new Map([[A,readA],[M,readM]]),
   scopedWritePools:new Map([[A,writeA],[M,writeM]])
  });
  await new Promise(ok=>app.listen(0,'127.0.0.1',ok));
  staffPage=await login(A);
  await expect(staffPage.locator('#channel-review-card')).toBeHidden();
  await staffPage.locator('#channel-request-form input[name="name"]').fill(name);
  await staffPage.locator('#channel-request-form input[name="channel_type"]').fill('online');
  await staffPage.locator('#channel-request-form input[name="evidence_ref"]').fill('虚构渠道调研编号');
  await staffPage.locator('#channel-request-form textarea[name="reason_zh"]').fill('申请创建虚构渠道');
  await staffPage.getByRole('button',{name:'提交渠道维护申请'}).click();
  await expect(staffPage.locator('#toast')).toContainText('尚未修改渠道');
  await expect(staffPage.locator('#channel-requests-list')).toContainText(name);
  await expect(staffPage.locator('#channel-audit-list')).toContainText('提交渠道变更申请');
  await expect(staffPage.locator('#channel-audit-list')).not.toContainText('审计原文');
  {
   const count=await admin.query('SELECT count(*)::int n FROM ms.marketing_channels WHERE name=$1',[name]);
   expect(count.rows[0].n).toBe(0);
  }
  managerPage=await login(M);
  await expect(managerPage.locator('#channel-review-card')).toBeVisible();
  await expect(managerPage.locator('#channel-requests-list')).toContainText(name);
  await expect(managerPage.locator('#channel-audit-list')).toContainText('提交渠道变更申请');
  await reviewRequest(managerPage,name);
  await staffPage.getByRole('button',{name:'刷新数据'}).click();
  await expect(staffPage.locator('#channels-list')).toContainText(name);
  await expect(staffPage.locator('#channel-requests-list')).toContainText('审批通过');
  await expect(staffPage.locator('#channel-audit-list')).toContainText('独立主管批准并执行');
  await managerPage.getByRole('button',{name:'刷新数据'}).click();
  await expect(managerPage.locator('#channel-audit-list')).toContainText('独立主管批准并执行');
  createdId=(await admin.query('SELECT id FROM ms.marketing_channels WHERE name=$1',[name])).rows[0]?.id;
  expect(createdId).toBeTruthy();

  // M02: plan a fictional marketing campaign; draft budget is NOT an approved expense.
  await staffPage.getByRole('button',{name:'市场活动'}).click();
  await expect(staffPage.locator('#campaign-workbench')).toBeVisible();
  await staffPage.locator('#campaign-draft-form input[name="name"]').fill(name+'-活动');
  await staffPage.locator('#campaign-draft-form input[name="budget_yuan"]').fill('1250.50');
  await staffPage.locator('#campaign-channel-choice').selectOption([createdId]);
  await staffPage.getByRole('button',{name:'保存市场活动草稿'}).click();
  await expect(staffPage.locator('#toast')).toContainText('预算未审批');
  await expect(staffPage.locator('#campaigns-list')).toContainText(name+'-活动');
  await expect(staffPage.locator('#campaigns-list')).toContainText('草稿');
  campaignId=(await admin.query('SELECT id FROM ms.marketing_campaigns WHERE name=$1',
    [name+'-活动'])).rows[0]?.id;
  expect(campaignId).toBeTruthy();
  const campaign=await admin.query('SELECT owner_user_id,status,budget_cents FROM ms.marketing_campaigns WHERE id=$1',
    [campaignId]);
  expect(campaign.rows[0].owner_user_id).toBe(A);
  expect(campaign.rows[0].status).toBe('draft');
  expect(Number(campaign.rows[0].budget_cents)).toBe(125050);
  await managerPage.getByRole('button',{name:'市场活动'}).click();
  // Manager signed in before the employee saved this draft; fetch fresh scope.
  await managerPage.getByRole('button',{name:'刷新数据'}).click();
  await expect(managerPage.locator('#campaigns-list')).toContainText(name+'-活动');
  // M02 versioned owner-only revision from the real Chinese form.
  await expect(staffPage.locator('#campaign-revise-panel')).toBeVisible();
  await staffPage.locator('#campaign-revise-choice').selectOption(campaignId);
  await expect(staffPage.locator('#campaign-revise-version')).toContainText('版本 1');
  await staffPage.locator('#campaign-revise-form input[name="name"]').fill(name+'-活动修订');
  await staffPage.locator('#campaign-revise-form input[name="budget_yuan"]').fill('905.75');
  await staffPage.getByRole('button',{name:'保存草稿修改'}).click();
  await expect(staffPage.locator('#toast')).toContainText('版本 2');
  await expect(staffPage.locator('#campaigns-list')).toContainText(name+'-活动修订');
  await expect(staffPage.locator('#campaigns-list')).toContainText('v2');
  const revisedCampaign=await admin.query(
    'SELECT name,status,budget_cents,owner_user_id FROM ms.marketing_campaigns WHERE id=$1',
    [campaignId]);
  expect(revisedCampaign.rows[0].name).toBe(name+'-活动修订');
  expect(revisedCampaign.rows[0].status).toBe('draft');
  expect(Number(revisedCampaign.rows[0].budget_cents)).toBe(90575);
  expect(revisedCampaign.rows[0].owner_user_id).toBe(A);
  await managerPage.getByRole('button',{name:'刷新数据'}).click();
  await expect(managerPage.locator('#campaigns-list')).toContainText(name+'-活动修订');
  await expect(managerPage.locator('#campaigns-list')).toContainText('v2');
  await expect(managerPage.locator('#campaign-revise-panel')).toBeHidden();
  // Manager can edit only their own drafts; employee A's draft is absent.
  await expect(managerPage.locator('#campaign-revise-choice option[value="'+campaignId+'"]')).toHaveCount(0);

  // V3.2-59: sales manager approves the frozen v2 proposal, not the budget.
  await expect(staffPage.locator('#campaign-sales-request-panel')).toBeVisible();
  await staffPage.locator('#campaign-sales-request-choice').selectOption(campaignId);
  await staffPage.locator('#campaign-sales-request-form input[name="evidence_ref"]')
    .fill('虚构市场活动方案索引');
  await staffPage.locator('#campaign-sales-request-form textarea[name="reason_zh"]')
    .fill('将本人最新版本活动草稿交给独立销售主管审核');
  await staffPage.getByRole('button',{name:'提交活动销售审核'}).click();
  await expect(staffPage.locator('#toast')).toContainText('预算和支出均未获批准');
  await expect(staffPage.locator('#campaign-sales-list')).toContainText('等待销售主管');
  await expect(staffPage.locator('#campaign-revise-panel')).toBeHidden();
  salesReviewId=(await admin.query(
   'SELECT id FROM ms.isolated_campaign_sales_reviews WHERE campaign_id=$1',
   [campaignId])).rows[0]?.id;
  expect(salesReviewId).toBeTruthy();
  await managerPage.getByRole('button',{name:'刷新数据'}).click();
  await expect(managerPage.locator('#campaign-sales-review-panel')).toBeVisible();
  await managerPage.locator('#campaign-sales-review-choice').selectOption(salesReviewId);
  await managerPage.locator('#campaign-sales-review-form select[name="decision"]')
    .selectOption('approved');
  await managerPage.locator('#campaign-sales-review-form input[name="evidence_ref"]')
    .fill('虚构销售经理审核依据');
  await managerPage.locator('#campaign-sales-review-form textarea[name="reason_zh"]')
    .fill('销售认可方案但财务预算仍需单独确认');
  await managerPage.getByRole('button',{name:'保存销售审核结论'}).click();
  await expect(managerPage.locator('#toast')).toContainText('财务尚未确认');
  await expect(managerPage.locator('#campaign-sales-list')).toContainText('等待财务确认');
  await staffPage.getByRole('button',{name:'刷新数据'}).click();
  await expect(staffPage.locator('#campaign-sales-list')).toContainText('等待财务确认');
  await expect(staffPage.locator('#campaign-revise-panel')).toBeHidden();
  expect((await admin.query('SELECT status FROM ms.marketing_campaigns WHERE id=$1',
    [campaignId])).rows[0].status).toBe('draft');
  expect((await admin.query('SELECT status FROM ms.isolated_campaign_sales_reviews WHERE id=$1',
    [salesReviewId])).rows[0].status).toBe('sales_approved_pending_finance');

  // V3.2-62: report supporting-materials gap, independently triage, no financial release.
  await expect(staffPage.locator('#campaign-finance-list')).toContainText('资料一致');
  await expect(staffPage.locator('#campaign-incident-report-panel')).toBeVisible();
  await staffPage.locator('#campaign-incident-report-choice').selectOption(salesReviewId);
  await staffPage.locator('#campaign-incident-report-form select[name="issue_kind"]')
    .selectOption('supporting_materials_gap');
  await staffPage.locator('#campaign-incident-report-form input[name="evidence_ref"]')
    .fill('模拟营销计划附件缺失');
  await staffPage.locator('#campaign-incident-report-form textarea[name="reason_zh"]')
    .fill('需要补齐虚构附件并独立复核');
  await staffPage.getByRole('button',{name:'登记销售侧交接异常'}).click();
  await expect(staffPage.locator('#toast')).toContainText('活动及预算仍未获授权');
  await expect(staffPage.locator('#campaign-incident-list')).toContainText('待独立复核');
  await expect(staffPage.locator('#campaign-incident-history-list')).toContainText('资料异常登记');
  await expect(staffPage.locator('#campaign-incident-history-list')).toContainText('未获财务或支出许可');
  await expect(staffPage.locator('#campaign-finance-list')).toContainText('交接资料存在异常');
  financeIncidentId=(await admin.query(
   "SELECT id FROM ms.isolated_campaign_finance_incidents WHERE review_id=$1 AND status='open'",
   [salesReviewId])).rows[0]?.id;
  expect(financeIncidentId).toBeTruthy();
  await managerPage.getByRole('button',{name:'刷新数据'}).click();
  await expect(managerPage.locator('#campaign-incident-triage-panel')).toBeVisible();
  await managerPage.locator('#campaign-incident-triage-choice').selectOption(financeIncidentId);
  await managerPage.locator('#campaign-incident-triage-form select[name="action"]')
    .selectOption('close_for_recheck');
  await managerPage.locator('#campaign-incident-triage-form input[name="evidence_ref"]')
    .fill('虚构附件补正复核索引');
  await managerPage.locator('#campaign-incident-triage-form textarea[name="reason_zh"]')
    .fill('仅销售侧资料核对，不开放预算付款');
  await managerPage.getByRole('button',{name:'保存独立销售侧处理'}).click();
  await expect(managerPage.locator('#toast')).toContainText('没有财务审批或支出权限');
  await expect(managerPage.locator('#campaign-incident-history-list'))
    .toContainText('独立销售主管要求再次核查');
  expect((await admin.query('SELECT status FROM ms.isolated_campaign_finance_incidents WHERE id=$1',
    [financeIncidentId])).rows[0].status).toBe('closed_for_recheck');
  await staffPage.getByRole('button',{name:'刷新数据'}).click();
  await expect(staffPage.locator('#campaign-finance-list')).toContainText('资料一致');
  await expect(staffPage.locator('#campaign-incident-history-list'))
    .toContainText('独立销售主管要求再次核查');
  // Audit endpoint failure must clear stale history and close every incident mutation.
  await staffPage.route('**/api/v1/marketing-campaigns/finance-incidents/audit-history',
    route=>route.fulfill({status:500,contentType:'application/json',
      body:JSON.stringify({code:'INTERNAL_ERROR',message:'模拟审计读取故障'})}));
  await staffPage.getByRole('button',{name:'刷新数据'}).click();
  await expect(staffPage.locator('#campaign-incident-history-list')).toBeEmpty();
  await expect(staffPage.locator('#campaign-incident-report-panel')).toBeHidden();
  await expect(staffPage.locator('#campaign-incident-triage-panel')).toBeHidden();
  await staffPage.unroute('**/api/v1/marketing-campaigns/finance-incidents/audit-history');
  await staffPage.getByRole('button',{name:'刷新数据'}).click();
  await expect(staffPage.locator('#campaign-incident-history-list'))
    .toContainText('独立销售主管要求再次核查');
  expect((await admin.query('SELECT status FROM ms.marketing_campaigns WHERE id=$1',
    [campaignId])).rows[0].status).toBe('draft');

  // V3.2-64: a second incident is explicitly escalated and receives sales-only evidence.
  await staffPage.locator('#campaign-incident-report-choice').selectOption(salesReviewId);
  await staffPage.locator('#campaign-incident-report-form select[name="issue_kind"]')
    .selectOption('supporting_materials_gap');
  await staffPage.locator('#campaign-incident-report-form input[name="evidence_ref"]')
    .fill('虚构第二次交接佐证缺口');
  await staffPage.locator('#campaign-incident-report-form textarea[name="reason_zh"]')
    .fill('这次改为人工升级后继续补正');
  await staffPage.getByRole('button',{name:'登记销售侧交接异常'}).click();
  await expect(staffPage.locator('#toast')).toContainText('活动及预算仍未获授权');
  escalationIncidentId=(await admin.query(
    "SELECT id FROM ms.isolated_campaign_finance_incidents WHERE review_id=$1 AND status='open'",
    [salesReviewId])).rows[0]?.id;
  expect(escalationIncidentId).toBeTruthy();
  await managerPage.getByRole('button',{name:'刷新数据'}).click();
  await expect(managerPage.locator('#campaign-incident-triage-panel')).toBeVisible();
  await managerPage.locator('#campaign-incident-triage-choice').selectOption(escalationIncidentId);
  await managerPage.locator('#campaign-incident-triage-form select[name="action"]')
    .selectOption('escalate_manual');
  await managerPage.locator('#campaign-incident-triage-form input[name="evidence_ref"]')
    .fill('虚构人工升级复核材料');
  await managerPage.locator('#campaign-incident-triage-form textarea[name="reason_zh"]')
    .fill('必须等待真实外部权威，此处不能放行');
  await managerPage.getByRole('button',{name:'保存独立销售侧处理'}).click();
  await expect(managerPage.locator('#toast')).toContainText('没有财务审批或支出权限');
  await staffPage.getByRole('button',{name:'刷新数据'}).click();
  await expect(staffPage.locator('#campaign-escalation-followup-panel')).toBeVisible();
  await staffPage.locator('#campaign-escalation-choice').selectOption(escalationIncidentId);
  await staffPage.locator('#campaign-escalation-followup-form select[name="note_type"]')
    .selectOption('external_finance_requirements_pending');
  await staffPage.locator('#campaign-escalation-followup-form input[name="evidence_ref"]')
    .fill('模拟外部财务审核仍未接入');
  await staffPage.locator('#campaign-escalation-followup-form textarea[name="reason_zh"]')
    .fill('销售侧仅补充材料索引，不代表财务部门签收或资金授权');
  await expect(staffPage.locator('#campaign-evidence-list')).toContainText('缺少原报告人补充佐证');
  await expect(staffPage.locator('#campaign-evidence-list')).toContainText('财务未签收');
  await staffPage.getByRole('button',{name:'追加销售侧核查资料'}).click();
  await expect(staffPage.locator('#toast')).toContainText('人工升级阻断保持');
  await expect(staffPage.locator('#campaign-escalation-list')).toContainText('外部财务核查事项待确认');
  await expect(staffPage.locator('#campaign-evidence-list')).toContainText('缺少原报告人补充佐证');
  await expect(staffPage.locator('#campaign-evidence-list')).toContainText('跨部门未通过');
  await expect(staffPage.locator('#campaign-incident-history-list')).toContainText('人工升级后销售侧补充材料');
  await expect(staffPage.locator('#campaign-finance-list')).toContainText('交接资料存在异常');
  expect((await admin.query('SELECT status FROM ms.isolated_campaign_finance_incidents WHERE id=$1',
    [escalationIncidentId])).rows[0].status).toBe('manual_escalated');
  expect((await admin.query("SELECT status FROM ms.marketing_campaigns WHERE id=$1",
    [campaignId])).rows[0].status).toBe('draft');
  // The addendum read route must clear stale metadata and disable writes on failure.
  await staffPage.route('**/api/v1/marketing-campaigns/finance-incidents/follow-ups',
    route=>route.fulfill({status:500,contentType:'application/json',
      body:JSON.stringify({code:'INTERNAL_ERROR',message:'模拟补充资料读取故障'})}));
  await staffPage.getByRole('button',{name:'刷新数据'}).click();
  await expect(staffPage.locator('#campaign-escalation-list')).toBeEmpty();
  await expect(staffPage.locator('#campaign-escalation-followup-panel')).toBeHidden();
  await staffPage.unroute('**/api/v1/marketing-campaigns/finance-incidents/follow-ups');
  await staffPage.getByRole('button',{name:'刷新数据'}).click();
  await expect(staffPage.locator('#campaign-escalation-list')).toContainText('外部财务核查事项待确认');

  await staffPage.route('**/api/v1/marketing-campaigns/finance-incidents/evidence-gates',
    route=>route.fulfill({status:500,contentType:'application/json',
      body:JSON.stringify({code:'INTERNAL_ERROR',message:'模拟跨部门准入核验读取失败'})}));
  await staffPage.getByRole('button',{name:'刷新数据'}).click();
  await expect(staffPage.locator('#campaign-evidence-list')).toBeEmpty();
  await expect(staffPage.locator('#campaign-escalation-followup-panel')).toBeHidden();
  await staffPage.unroute('**/api/v1/marketing-campaigns/finance-incidents/evidence-gates');
  await staffPage.getByRole('button',{name:'刷新数据'}).click();
  await expect(staffPage.locator('#campaign-evidence-list')).toContainText('跨部门未通过');

  await staffPage.route('**/api/v1/marketing-campaigns/drafts',r=>r.fulfill({
    status:500,contentType:'application/json',
    body:JSON.stringify({code:'INTERNAL_ERROR',message:'隔离活动读取故障'})
  }));
  await staffPage.getByRole('button',{name:'刷新数据'}).click();
  await expect(staffPage.locator('#campaigns-list')).toBeEmpty();
  await expect(staffPage.locator('#campaign-sales-list')).toBeEmpty();
  await expect(staffPage.locator('#campaign-sales-review-choice')).toBeEmpty();
  await expect(staffPage.locator('#campaign-create-panel')).toBeHidden();
  await staffPage.unroute('**/api/v1/marketing-campaigns/drafts');
  await staffPage.getByRole('button',{name:'刷新数据'}).click();
  await expect(staffPage.locator('#campaigns-list')).toContainText(name+'-活动');
  await staffPage.getByRole('button',{name:'获客渠道'}).click();
  await managerPage.getByRole('button',{name:'获客渠道'}).click();

  // Same user cannot self-approve; no direct SQL write or unsafe HTML injection.
  await staffPage.locator('#channel-request-form select[name="action"]').selectOption('edit');
  await staffPage.locator('#channel-target-choice').selectOption(createdId);
  await staffPage.locator('#channel-request-form input[name="name"]').fill(changedName);
  await staffPage.locator('#channel-request-form input[name="channel_type"]').fill('referral');
  await staffPage.locator('#channel-request-form input[name="evidence_ref"]').fill('虚构更名依据');
  await staffPage.locator('#channel-request-form textarea[name="reason_zh"]').fill('申请独立审批修改渠道名称');
  await staffPage.getByRole('button',{name:'提交渠道维护申请'}).click();
  await expect(staffPage.locator('#toast')).toContainText('等待独立主管');
  expect((await admin.query('SELECT name FROM ms.marketing_channels WHERE id=$1',[createdId]))
   .rows[0].name).toBe(name);
  await reviewRequest(managerPage,changedName);
  await staffPage.getByRole('button',{name:'刷新数据'}).click();
  await expect(staffPage.locator('#channels-list')).toContainText(changedName);
  await staffPage.locator('#channel-request-form select[name="action"]').selectOption('deactivate');
  await staffPage.locator('#channel-target-choice').selectOption(createdId);
  await staffPage.locator('#channel-request-form input[name="evidence_ref"]').fill('模拟停用记录');
  await staffPage.locator('#channel-request-form textarea[name="reason_zh"]').fill('虚构渠道停用审批');
  await staffPage.getByRole('button',{name:'提交渠道维护申请'}).click();
  await expect(staffPage.locator('#toast')).toContainText('尚未修改渠道');
  expect((await admin.query('SELECT status FROM ms.marketing_channels WHERE id=$1',[createdId]))
   .rows[0].status).toBe('active');
  await reviewRequest(managerPage,changedName);
  expect((await admin.query('SELECT status FROM ms.marketing_channels WHERE id=$1',[createdId]))
   .rows[0].status).toBe('inactive');
  await staffPage.getByRole('button',{name:'刷新数据'}).click();
  await expect(staffPage.locator('#channels-list')).toContainText('本渠道已停用');
  // Audit failure must discard previously rendered events, hide both write
  // actions and never recycle old authorization until a healthy refresh.
  await staffPage.route('**/api/v1/marketing-channels/change-requests/audit-history',
   route=>route.fulfill({status:500,contentType:'application/json',
    body:JSON.stringify({code:'INTERNAL_ERROR',message:'虚构审计投影故障'})}));
  await staffPage.getByRole('button',{name:'刷新数据'}).click();
  await expect(staffPage.locator('#channel-audit-list')).toBeEmpty();
  await expect(staffPage.locator('#campaigns-list')).toContainText(name+'-活动');
  await expect(staffPage.locator('#channel-audit-status')).toContainText('已清空旧记录');
  await expect(staffPage.locator('#channel-request-card')).toBeHidden();
  await staffPage.unroute('**/api/v1/marketing-channels/change-requests/audit-history');
  await staffPage.getByRole('button',{name:'刷新数据'}).click();
  await expect(staffPage.locator('#channel-audit-list')).toContainText('独立主管批准并执行');
  await expect(staffPage.locator('#channel-request-card')).toBeVisible();

  await testInfo.attach('m01-approval-workbench',{
   body:await staffPage.screenshot({fullPage:true}),contentType:'image/png'});
  await staffPage.getByRole('button',{name:'退出演示账号'}).click();
  await expect(staffPage.locator('#workspace')).toBeHidden();
  await expect(staffPage.locator('#channel-requests-list')).toBeEmpty();
  await expect(staffPage.locator('#channel-audit-list')).toBeEmpty();
  await expect(staffPage.locator('#campaigns-list')).toBeEmpty();
  await expect(staffPage.locator('#campaign-incident-list')).toBeEmpty();
  await expect(staffPage.locator('#campaign-incident-history-list')).toBeEmpty();
  await expect(staffPage.locator('#campaign-escalation-list')).toBeEmpty();
  await expect(staffPage.locator('#campaign-evidence-list')).toBeEmpty();
  await expect(staffPage.locator('#channel-review-choice')).toBeEmpty();
  expect(await staffPage.evaluate(()=>localStorage.length)).toBe(0);
 }finally{
  await Promise.allSettled([staffPage,managerPage].filter(Boolean).map(x=>x.close()));
  if(app?.listening)await new Promise(ok=>app.close(ok));
  // Release only temporary CI fixture records in FK-safe order.
  for(const id of [financeIncidentId,escalationIncidentId].filter(Boolean)){
   await admin.query("DELETE FROM ms.audit_events WHERE target_type='marketing_campaign_finance_incident' AND target_id=$1",[id]);
   await admin.query('DELETE FROM ms.isolated_campaign_finance_escalation_followups WHERE incident_id=$1',[id]);
   await admin.query('DELETE FROM ms.isolated_campaign_finance_incidents WHERE id=$1',[id]);
  }
  if(salesReviewId){
   await admin.query("DELETE FROM ms.audit_events WHERE target_type='marketing_campaign_sales_review' AND target_id=$1",[salesReviewId]);
   await admin.query('DELETE FROM ms.isolated_campaign_sales_reviews WHERE id=$1',[salesReviewId]);
  }
  if(campaignId){
   await admin.query("DELETE FROM ms.audit_events WHERE target_type='marketing_campaign' AND target_id=$1",[campaignId]);
   await admin.query('DELETE FROM ms.isolated_campaign_draft_revision_receipts WHERE campaign_id=$1',[campaignId]);
   await admin.query('DELETE FROM ms.isolated_campaign_draft_versions WHERE campaign_id=$1',[campaignId]);
   await admin.query('DELETE FROM ms.isolated_campaign_draft_idempotency WHERE campaign_id=$1',[campaignId]);
   await admin.query('DELETE FROM ms.campaign_channels WHERE campaign_id=$1',[campaignId]);
   await admin.query('DELETE FROM ms.marketing_campaigns WHERE id=$1',[campaignId]);
  }
  if(createdId){
   await admin.query('DELETE FROM ms.isolated_channel_change_requests WHERE channel_id=$1 OR result_channel_id=$1',[createdId]);
   await admin.query('DELETE FROM ms.marketing_channels WHERE id=$1',[createdId]);
  }
  await Promise.allSettled([admin,directory,readA,readM,writeA,writeM].map(x=>x.end()));
 }
});