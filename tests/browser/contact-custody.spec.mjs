import {test,expect} from '@playwright/test';
import pg from 'pg';
import {createSign,generateKeyPairSync,randomUUID} from 'node:crypto';
import {createApp} from '../../src/app.mjs';

const org='20000000-0000-4000-8000-000000000001';
const ids={
 A:'20000000-0000-4000-8000-000000000011',
 B:'20000000-0000-4000-8000-000000000012',
 M:'20000000-0000-4000-8000-000000000013',
 N:'20000000-0000-4000-8000-000000000014'
};
const reviewer='20000000-0000-4000-8000-000000000014';
const issuer='https://fictional-browser-contact-custody.example.invalid';
const audience='isolated-custody-chinese-workbench';
const open=s=>new Promise(ok=>s.listen(0,'127.0.0.1',ok));
const close=s=>new Promise(ok=>s.close(ok));

test('真实 Chromium：A→B 独立交接、B 申请撤回、主管复核、管理权恢复 A',async({browser},testInfo)=>{
 test.setTimeout(210000); // V3.2-23 adds the second independent supervisor; all prior assertions remain.
 process.env.MS_STAGE='isolated-test';
 const owner=new pg.Pool({connectionString:process.env.DATABASE_URL,max:4});
 const directory=new pg.Pool({connectionString:process.env.DATABASE_URL_AUTH_DIRECTORY,max:3});
 const urls={
  readA:process.env.DATABASE_URL_ASSIGNEE_A,readB:process.env.DATABASE_URL_ASSIGNEE_B,
  readM:process.env.DATABASE_URL_ASSIGNEE_MANAGER,
  writeA:process.env.DATABASE_URL_WRITE_A,writeB:process.env.DATABASE_URL_WRITE_B,
  writeM:process.env.DATABASE_URL_WRITE_MANAGER,
  readN:process.env.DATABASE_URL_READ_REVIEWER_2,
  writeN:process.env.DATABASE_URL_WRITE_REVIEWER_2
 };
 const pools=Object.fromEntries(Object.entries(urls)
  .map(([k,v])=>[k,new pg.Pool({connectionString:v,max:3})]));
 const kp=generateKeyPairSync('rsa',{modulusLength:2048});
 const jwk={...kp.publicKey.export({format:'jwk'}),kid:'custody-browser-test',alg:'RS256',use:'sig'};
 const subs={A:'browser-custody-a-'+randomUUID(),
  B:'browser-custody-b-'+randomUUID(),M:'browser-custody-m-'+randomUUID(),N:'browser-custody-n-'+randomUUID()};
 let broadCalls=0;
 const app=createApp({connect(){broadCalls++;throw Error('broad SQL is forbidden');}},{
  secret:'browser-custody-test-secret-strong-enough-for-isolated',
  strictStaffMode:true,identityDirectoryPool:directory,
  externalIdentity:{issuer,audience,jwks:{keys:[jwk]}},
  scopedReadPools:new Map([[ids.A,pools.readA],[ids.B,pools.readB],[ids.M,pools.readM],[ids.N,pools.readN]]),
  scopedWritePools:new Map([[ids.A,pools.writeA],[ids.B,pools.writeB],[ids.M,pools.writeM],[ids.N,pools.writeN]])
 });
 const pages={};
 function sign(who){
  const n=Math.floor(Date.now()/1000);
  const h=Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT',kid:jwk.kid})).toString('base64url');
  const p=Buffer.from(JSON.stringify({iss:issuer,aud:audience,sub:subs[who],iat:n,
   exp:n+900,role:'super_admin',
   org_id:'20000000-0000-4000-8000-000000000002'})).toString('base64url');
  return h+'.'+p+'.'+createSign('RSA-SHA256').update(h+'.'+p)
   .sign(kp.privateKey).toString('base64url');
 }
 async function bind(who){
  const requester=(who==='M'||who==='N')?ids.A:ids.M;
  const independentReviewer=who==='N'?ids.M:reviewer;
  const q=await owner.query(
   "INSERT INTO ms.identity_change_requests(organization_id,action,target_staff_id,"+
   "issuer,subject,requested_by,request_evidence_ref,request_reason_zh) "+
   "VALUES($1,'bind',$2,$3,$4,$5,'虚构员工身份证明','双人审核虚构身份') RETURNING id",
   [org,ids[who],issuer,subs[who],requester]);
  await owner.query(
   "INSERT INTO ms.identity_change_decisions(request_id,reviewer_user_id,decision,"+
   "review_evidence_ref,reason_zh) VALUES($1,$2,'approved','双主管虚构证明','测试独立核实')",
   [q.rows[0].id,independentReviewer]);
  await owner.query(
   "UPDATE ms.identity_change_requests SET status='approved',decided_by=$2,decided_at=now() WHERE id=$1",
   [q.rows[0].id,reviewer]);
  await owner.query(
   "INSERT INTO ms.staff_identity_bindings(staff_user_id,issuer,subject,bound_by,approval_request_id) "+
   "VALUES($1,$2,$3,$4,$5)",[ids[who],issuer,subs[who],reviewer,q.rows[0].id]);
 }
 async function login(who){
  const page=await browser.newPage();
  pages[who]=page;
  await page.goto('http://127.0.0.1:'+app.address().port+'/');
  await page.locator('#external-login-form input[name="signed_token"]').fill(sign(who));
  await page.getByRole('button',{name:'验证员工身份并进入'}).click();
  await expect(page.locator('#workspace')).toBeVisible();
  await page.locator('button[data-view="contacts"]').click();
  await expect(page.locator('#contact-custody-workbench')).toBeVisible();
  expect(await page.evaluate(()=>localStorage.length)).toBe(0);
  return page;
 }
 const name='独立交接联系人的虚构家长-'+randomUUID();
 try{
  await bind('A');await bind('B');await bind('M');await bind('N');
  await open(app);
  const a=await login('A');
  await a.locator('#contact-form input[name="display_name"]').fill(name);
  await a.getByRole('button',{name:'保存联系人'}).click();
  await expect(a.locator('#contacts-list')).toContainText(name);
  const contact=(await owner.query(
   'SELECT id,created_by FROM ms.contacts WHERE display_name=$1',[name])).rows[0];
  expect(contact.created_by).toBe(ids.A);

  const b=await login('B');
  await expect(b.locator('#contacts-list')).not.toContainText(name);
  const body=a.locator('#custody-request-form');
  await body.locator('select[name="contact_id"]').selectOption({label:name});
  await body.locator('select[name="target_staff_id"]').selectOption({
    label:'模拟销售顾问 B'
  });
  await body.locator('textarea[name="reason_zh"]')
   .fill('测试联系人由销售A交给销售B负责，先待独立审核');
  await body.locator('input[name="evidence_ref"]')
   .fill('虚构家长确认转交记录，不含个人证明');
  await body.getByRole('button',{name:'提交联系人交接申请'}).click();
  await expect(a.locator('#custody-requests-list')).toContainText(name);
  await expect(a.locator('#custody-requests-list')).toContainText('待核实');
  await b.getByRole('button',{name:'刷新数据'}).click();
  await expect(b.locator('#contacts-list')).not.toContainText(name);

  const m=await login('M');
  const n=await login('N');
  await expect(m.locator('#custody-decision-card')).toBeVisible();
  await expect(m.locator('#custody-requests-list')).toContainText(name);
  const approvalChoice=m.locator('#custody-decision-form select[name="request_id"]');
  const approvalId=await approvalChoice.locator('option').filter({hasText:name}).first().getAttribute('value');
  expect(approvalId).toBeTruthy();
  await approvalChoice.selectOption(approvalId);
  await m.locator('#custody-decision-form textarea[name="reason_zh"]')
   .fill('独立主管核实当前联系人管理人和接收员工后批准');
  await m.locator('#custody-decision-form input[name="evidence_ref"]')
   .fill('虚构独立审核材料说明');
  await m.getByRole('button',{name:'保存联系人交接审核'}).click();
  await expect.poll(async()=>(
    await owner.query('SELECT assignee_id FROM ms.contact_custody_assignments WHERE contact_id=$1 AND revoked_at IS NULL',[contact.id])
  ).rows[0]?.assignee_id).toBe(ids.B);
  await b.getByRole('button',{name:'刷新数据'}).click();
  await expect(b.locator('#contacts-list')).toContainText(name);
  const rows=await owner.query(
   'SELECT c.created_by,a.assignee_id FROM ms.contacts c '+
   'JOIN ms.contact_custody_assignments a ON a.contact_id=c.id '+
   'WHERE c.id=$1 AND a.revoked_at IS NULL',[contact.id]);
  expect(rows.rowCount).toBe(1);
  expect(rows.rows[0].created_by).toBe(ids.A);
  expect(rows.rows[0].assignee_id).toBe(ids.B);
  expect(broadCalls).toBe(0);
  // V3.2-16: the recipient initiates a withdrawal; M independently reviews.
  const requestReview=b.locator('#custody-review-request-form');
  await requestReview.locator('select[name="assignment_id"]').selectOption({label:name});
  await requestReview.locator('select[name="kind"]').selectOption('withdrawal');
  await requestReview.locator('textarea[name="reason_zh"]')
   .fill('客户要求撤回当前管理权，等待独立审核');
  await requestReview.locator('input[name="evidence_ref"]')
   .fill('虚构客户撤回要求与独立复核依据');
  await requestReview.getByRole('button',{name:'提交撤回或复核申请'}).click();
  await expect(b.locator('#custody-reviews-list')).toContainText(name);
  await m.getByRole('button',{name:'刷新数据'}).click();
  await expect(m.locator('#custody-review-decision-card')).toBeVisible();
  const decideReview=m.locator('#custody-review-decision-form');
  const reviewChoice=decideReview.locator('select[name="review_id"]');
  const reviewId=await reviewChoice.locator('option').filter({hasText:name}).first().getAttribute('value');
  expect(reviewId).toBeTruthy();
  await reviewChoice.selectOption(reviewId);
  await decideReview.locator('select[name="result"]').selectOption('reversed');
  await decideReview.locator('textarea[name="reason_zh"]')
   .fill('独立复核确认管理权需要恢复原任员工');
  await decideReview.locator('input[name="evidence_ref"]')
   .fill('虚构独立复核证据记录');
  await decideReview.getByRole('button',{name:'保存独立复核决定'}).click();
  await expect.poll(async()=>(
    await owner.query('SELECT assignee_id FROM ms.contact_custody_assignments WHERE contact_id=$1 AND revoked_at IS NULL',[contact.id])
  ).rows[0]?.assignee_id).toBe(ids.A);
  await expect.poll(async()=>(
    await pools.readB.query('SELECT COUNT(*)::int AS n FROM ms.scoped_contacts_directory WHERE contact_id=$1',[contact.id])
  ).rows[0]?.n).toBe(0);
  await b.getByRole('button',{name:'刷新数据'}).click();
  await a.getByRole('button',{name:'刷新数据'}).click();
  await expect(b.locator('#contacts-list')).not.toContainText(name);
  await expect(a.locator('#contacts-list')).toContainText(name);
  expect((await owner.query('SELECT assignee_id FROM ms.contact_custody_assignments WHERE contact_id=$1 AND revoked_at IS NULL',[contact.id])).rows[0].assignee_id).toBe(ids.A);
  // V3.2-17: actual Chromium staff workflow makes a candidate, never a lead.
  const candidateContact='候选测试家长-'+randomUUID();
  await a.locator('button[data-view="contacts"]').click();
  await a.locator('#contact-form input[name="display_name"]').fill(candidateContact);
  await a.getByRole('button',{name:'保存联系人'}).click();
  await expect(a.locator('#contacts-list')).toContainText(candidateContact);
  await a.locator('button[data-view="leads"]').click();
  await a.locator('#event-form select[name="contact_id"]').selectOption({label:candidateContact});
  await a.locator('#event-form select[name="event_type"]').selectOption('电话咨询');
  await a.getByRole('button',{name:'保存本次咨询'}).click();
  await expect(a.locator('#strict-consultation-list')).toContainText('电话咨询');
  const candidateForm=a.locator('#lead-candidate-request-form');
  await expect(candidateForm).toBeVisible();
  const sourceOption=candidateForm.locator('select[name="source_event_id"] option')
    .filter({hasText:candidateContact}).first();
  const eventId=await sourceOption.getAttribute('value');
  expect(eventId).toBeTruthy();
  await candidateForm.locator('select[name="source_event_id"]').selectOption(eventId);
  await candidateForm.locator('textarea[name="reason_zh"]')
    .fill('经确认是真实咨询，申请独立审核转线索候选');
  await candidateForm.locator('input[name="evidence_ref"]')
    .fill('虚构咨询时间及客户意愿核实记录');
  await candidateForm.getByRole('button',{name:'提交线索候选审核'}).click();
  await expect(a.locator('#lead-candidates-list')).toContainText(candidateContact);
  expect((await owner.query('SELECT COUNT(*)::int AS n FROM ms.leads WHERE source_event_id=$1',[eventId])).rows[0].n).toBe(0);
  await m.locator('button[data-view="leads"]').click();
  await m.getByRole('button',{name:'刷新数据'}).click();
  const managerChoice=m.locator('#lead-candidate-decision-form select[name="candidate_id"]');
  const candidateId=await managerChoice.locator('option').filter({hasText:candidateContact})
    .first().getAttribute('value');
  expect(candidateId).toBeTruthy();
  await managerChoice.selectOption(candidateId);
  await m.locator('#lead-candidate-decision-form textarea[name="reason_zh"]')
    .fill('独立审核确认客户未拒绝联系且无重复正式线索');
  await m.locator('#lead-candidate-decision-form input[name="evidence_ref"]')
    .fill('虚构复核材料独立审核');
  await m.getByRole('button',{name:'保存候选独立审核'}).click();
  await expect.poll(async()=>(
    await owner.query('SELECT status FROM ms.consultation_lead_candidates WHERE id=$1',
      [candidateId])
  ).rows[0]?.status).toBe('reviewed_eligible');
  expect((await owner.query('SELECT COUNT(*)::int AS n FROM ms.leads WHERE source_event_id=$1',[eventId])).rows[0].n).toBe(0);
  await a.getByRole('button',{name:'刷新数据'}).click();
  await expect(a.locator('#lead-candidates-list')).toContainText('候选核查通过（未生成线索）');
  // V3.2-18: fictional historic consultation by B creates a genuine
  // cross-employee attribution conflict. Browser resolves it before clearance.
  const candidateContactId=(await owner.query(
    'SELECT id FROM ms.contacts WHERE organization_id=$1 AND display_name=$2',
    [org,candidateContact])).rows[0].id;
  const claimedEvent=(await owner.query(
    "INSERT INTO ms.contact_events(organization_id,contact_id,event_type,occurred_at,recorded_by) "+
    "VALUES($1,$2,'微信咨询',now(),$3) RETURNING id",
    [org,candidateContactId,ids.B])).rows[0].id;
  await b.locator('button[data-view="leads"]').click();
  await b.getByRole('button',{name:'刷新数据'}).click();
  const disputeForm=b.locator('#attribution-dispute-request-form');
  const disputeOption=disputeForm.locator('select[name="choice_key"] option')
    .filter({hasText:candidateContact}).first();
  const choice=await disputeOption.getAttribute('value');
  expect(choice).toBe(candidateId+':'+claimedEvent);
  await disputeForm.locator('select[name="choice_key"]').selectOption(choice);
  await disputeForm.locator('textarea[name="reason_zh"]')
    .fill('该联系人也有销售B曾经发生的真实沟通');
  await disputeForm.locator('input[name="evidence_ref"]')
    .fill('虚构销售B原咨询的核实记录');
  await disputeForm.getByRole('button',{name:'提交归因争议'}).click();
  await expect(b.locator('#attribution-disputes-list')).toContainText('待独立裁决');
  await m.getByRole('button',{name:'刷新数据'}).click();
  const disputeDecision=m.locator('#attribution-dispute-decision-form');
  const disputeChoice=disputeDecision.locator('select[name="dispute_id"] option')
    .filter({hasText:candidateContact}).first();
  const disputedId=await disputeChoice.getAttribute('value');
  expect(disputedId).toBeTruthy();
  await disputeDecision.locator('select[name="dispute_id"]').selectOption(disputedId);
  await disputeDecision.locator('select[name="decision"]').selectOption('rejected');
  await disputeDecision.locator('textarea[name="reason_zh"]')
    .fill('已独立确认争议不影响原咨询来源，预审仍需单独核实');
  await disputeDecision.locator('input[name="evidence_ref"]')
    .fill('虚构双方咨询对照记录');
  await disputeDecision.getByRole('button',{name:'保存独立争议裁决'}).click();
  await expect.poll(async()=>(
    await owner.query('SELECT status FROM ms.lead_attribution_disputes WHERE id=$1',[disputedId])
  ).rows[0]?.status).toBe('rejected');
  await a.getByRole('button',{name:'刷新数据'}).click();
  const readinessForm=a.locator('#conversion-readiness-request-form');
  await readinessForm.locator('select[name="candidate_id"]').selectOption(candidateId);
  await readinessForm.locator('textarea[name="reason_zh"]')
    .fill('候选已核实，申请正式转换条件预审');
  await readinessForm.locator('input[name="evidence_ref"]')
    .fill('虚构咨询和重复线索检查记录');
  await readinessForm.getByRole('button',{name:'提交转换预审申请'}).click();
  await expect(a.locator('#readiness-list')).toContainText('等待独立主管预审');
  await m.getByRole('button',{name:'刷新数据'}).click();
  const readinessDecision=m.locator('#conversion-readiness-decision-form');
  const readinessChoice=readinessDecision.locator('select[name="review_id"] option')
    .filter({hasText:candidateContact}).first();
  const preflightId=await readinessChoice.getAttribute('value');
  expect(preflightId).toBeTruthy();
  await readinessDecision.locator('select[name="review_id"]').selectOption(preflightId);
  await readinessDecision.locator('select[name="decision"]').selectOption('cleared');
  await readinessDecision.locator('textarea[name="reason_zh"]')
    .fill('两方咨询记录已独立核清，未存在相同联系人正式线索');
  await readinessDecision.locator('input[name="evidence_ref"]')
    .fill('虚构主管预审证明');
  await readinessDecision.getByRole('button',{name:'保存独立预审结论'}).click();
  await expect.poll(async()=>(
    await owner.query('SELECT status FROM ms.lead_conversion_readiness WHERE id=$1',[preflightId])
  ).rows[0]?.status).toBe('cleared');
  expect((await owner.query('SELECT COUNT(*)::int AS n FROM ms.leads WHERE contact_id=$1',
    [candidateContactId])).rows[0].n).toBe(0);
  const revocation=m.locator('#conversion-readiness-revoke-form');
  await revocation.locator('select[name="review_id"]').selectOption(preflightId);
  await revocation.locator('textarea[name="reason_zh"]')
    .fill('预审结束后取消此前许可，保留历史审计链');
  await revocation.locator('input[name="evidence_ref"]')
    .fill('虚构主管主动撤销依据');
  await revocation.getByRole('button',{name:'撤销预审并保留不可变决定'}).click();
  await expect.poll(async()=>(
    await owner.query('SELECT status FROM ms.lead_conversion_readiness WHERE id=$1',[preflightId])
  ).rows[0]?.status).toBe('revoked');
  expect((await owner.query('SELECT COUNT(*)::int AS n FROM ms.leads WHERE contact_id=$1',
    [candidateContactId])).rows[0].n).toBe(0);
  // V3.2-19: separate complete human-readable Chromium path ending in ONE lead.
  const finalContact='独立最终转换家长-'+randomUUID();
  await a.locator('button[data-view="contacts"]').click();
  await a.locator('#contact-form input[name="display_name"]').fill(finalContact);
  await a.getByRole('button',{name:'保存联系人'}).click();
  await expect(a.locator('#contacts-list')).toContainText(finalContact);
  const finalContactId=(await owner.query(
    'SELECT id FROM ms.contacts WHERE organization_id=$1 AND display_name=$2',
    [org,finalContact])).rows[0].id;
  await a.locator('button[data-view="leads"]').click();
  await a.locator('#event-form select[name="contact_id"]').selectOption({label:finalContact});
  await a.locator('#event-form select[name="event_type"]').selectOption('到店咨询');
  await a.getByRole('button',{name:'保存本次咨询'}).click();
  await expect(a.locator('#strict-consultation-list')).toContainText('到店咨询');
  const newCandidateForm=a.locator('#lead-candidate-request-form');
  const newEventId=await newCandidateForm.locator('select[name="source_event_id"] option')
    .filter({hasText:finalContact}).first().getAttribute('value');
  expect(newEventId).toBeTruthy();
  await newCandidateForm.locator('select[name="source_event_id"]').selectOption(newEventId);
  await newCandidateForm.locator('textarea[name="reason_zh"]')
    .fill('家长实际到店咨询，申请线索候选独立核查');
  await newCandidateForm.locator('input[name="evidence_ref"]')
    .fill('虚构家长到店咨询时间与意愿证明');
  await newCandidateForm.getByRole('button',{name:'提交线索候选审核'}).click();
  await m.getByRole('button',{name:'刷新数据'}).click();
  const newCandidateDecision=m.locator('#lead-candidate-decision-form');
  const finalCandidateId=await newCandidateDecision.locator('select[name="candidate_id"] option')
    .filter({hasText:finalContact}).first().getAttribute('value');
  expect(finalCandidateId).toBeTruthy();
  await newCandidateDecision.locator('select[name="candidate_id"]').selectOption(finalCandidateId);
  await newCandidateDecision.locator('textarea[name="reason_zh"]')
    .fill('独立核实此次实际到店咨询的候选来源');
  await newCandidateDecision.locator('input[name="evidence_ref"]')
    .fill('虚构候选独立审核记录');
  await newCandidateDecision.getByRole('button',{name:'保存候选独立审核'}).click();
  await expect.poll(async()=>(
    await owner.query('SELECT status FROM ms.consultation_lead_candidates WHERE id=$1',
      [finalCandidateId])
  ).rows[0]?.status).toBe('reviewed_eligible');
  await a.getByRole('button',{name:'刷新数据'}).click();
  const newReadinessForm=a.locator('#conversion-readiness-request-form');
  await newReadinessForm.locator('select[name="candidate_id"]').selectOption(finalCandidateId);
  await newReadinessForm.locator('textarea[name="reason_zh"]')
    .fill('无跨员工异议，提交正式转化前条件核查');
  await newReadinessForm.locator('input[name="evidence_ref"]')
    .fill('虚构真实咨询与去重证明');
  await newReadinessForm.getByRole('button',{name:'提交转换预审申请'}).click();
  await m.getByRole('button',{name:'刷新数据'}).click();
  const newReadinessDecision=m.locator('#conversion-readiness-decision-form');
  const finalReadinessId=await newReadinessDecision.locator('select[name="review_id"] option')
    .filter({hasText:finalContact}).first().getAttribute('value');
  expect(finalReadinessId).toBeTruthy();
  await newReadinessDecision.locator('select[name="review_id"]').selectOption(finalReadinessId);
  await newReadinessDecision.locator('textarea[name="reason_zh"]')
    .fill('独立主管预审确认没有重复线索及未裁决争议');
  await newReadinessDecision.locator('input[name="evidence_ref"]')
    .fill('虚构转换预审核对单');
  await newReadinessDecision.getByRole('button',{name:'保存独立预审结论'}).click();
  await expect.poll(async()=>(
    await owner.query('SELECT status FROM ms.lead_conversion_readiness WHERE id=$1',
      [finalReadinessId])
  ).rows[0]?.status).toBe('cleared');
  await a.getByRole('button',{name:'刷新数据'}).click();
  const finalRequest=a.locator('#final-lead-conversion-request-form');
  await finalRequest.locator('select[name="readiness_id"]').selectOption(finalReadinessId);
  await finalRequest.locator('textarea[name="reason_zh"]')
    .fill('申请最后独立批准，批准后由本人确认创建');
  await finalRequest.locator('input[name="evidence_ref"]')
    .fill('虚构预审通过与原咨询证明');
  await finalRequest.getByRole('button',{name:'提交最终转换审核'}).click();
  await expect(a.locator('#final-lead-conversions-list')).toContainText('等待最终独立审核');
  await m.getByRole('button',{name:'刷新数据'}).click();
  const lastReview=m.locator('#final-lead-conversion-decision-form');
  const finalAuthorizationId=await lastReview.locator('select[name="authorization_id"] option')
    .filter({hasText:finalContact}).first().getAttribute('value');
  expect(finalAuthorizationId).toBeTruthy();
  await lastReview.locator('select[name="authorization_id"]').selectOption(finalAuthorizationId);
  await lastReview.locator('textarea[name="reason_zh"]')
    .fill('独立核实双重前置审核、原申请人及实时归因');
  await lastReview.locator('input[name="evidence_ref"]')
    .fill('虚构最终独立批准材料');
  await lastReview.getByRole('button',{name:'保存最终独立审核'}).click();
  await expect.poll(async()=>(
    await owner.query('SELECT status FROM ms.lead_conversion_authorizations WHERE id=$1',
      [finalAuthorizationId])
  ).rows[0]?.status).toBe('approved');
  expect((await owner.query(
    'SELECT COUNT(*)::int AS n FROM ms.leads WHERE contact_id=$1',[finalContactId]
  )).rows[0].n).toBe(0);
  await a.getByRole('button',{name:'刷新数据'}).click();
  const executionForm=a.locator('#final-lead-conversion-execute-form');
  await executionForm.locator('select[name="authorization_id"]')
    .selectOption(finalAuthorizationId);
  await executionForm.getByRole('button',{name:'确认创建一条正式销售线索'}).click();
  await expect.poll(async()=>(
    await owner.query('SELECT status FROM ms.lead_conversion_authorizations WHERE id=$1',
      [finalAuthorizationId])
  ).rows[0]?.status).toBe('executed');
  const finalLeads=await owner.query(
    'SELECT id,source_event_id,owner_user_id FROM ms.leads WHERE contact_id=$1',
    [finalContactId]);
  expect(finalLeads.rowCount).toBe(1);
  expect(finalLeads.rows[0].source_event_id).toBe(newEventId);
  expect(finalLeads.rows[0].owner_user_id).toBe(ids.A);
  expect((await owner.query('SELECT COUNT(*)::int AS n FROM ms.lead_students WHERE lead_id=$1',
    [finalLeads.rows[0].id])).rows[0].n).toBe(0);
  await expect(a.locator('#final-lead-conversions-list'))
    .toContainText('已创建一条正式销售线索');
  // V3.2-20: one named student only; guardian/family/sibling never inferred.
  const linkedStudentName='单学生虚构关联-'+randomUUID();
  const unlinkedSiblingName='未自动关联的另一学生-'+randomUUID();
  await a.locator('button[data-view="students"]').click();
  await a.locator('#student-form input[name="display_name"]').fill(linkedStudentName);
  await a.getByRole('button',{name:'保存学生档案'}).click();
  await expect(a.locator('#students-list')).toContainText(linkedStudentName);
  await a.locator('#student-form input[name="display_name"]').fill(unlinkedSiblingName);
  await a.getByRole('button',{name:'保存学生档案'}).click();
  await expect(a.locator('#students-list')).toContainText(unlinkedSiblingName);
  const namedStudentId=(await owner.query('SELECT id FROM ms.students WHERE display_name=$1 AND organization_id=$2',
    [linkedStudentName,org])).rows[0].id;
  const siblingStudentId=(await owner.query('SELECT id FROM ms.students WHERE display_name=$1 AND organization_id=$2',
    [unlinkedSiblingName,org])).rows[0].id;
  await a.locator('button[data-view="leads"]').click();
  await expect(a.locator('#lead-governance-workbench')).toBeVisible();
  const linkForm=a.locator('#lead-student-link-request-form');
  await linkForm.locator('select[name="lead_id"]').selectOption(finalLeads.rows[0].id);
  await linkForm.locator('select[name="student_id"]').selectOption(namedStudentId);
  await linkForm.locator('textarea[name="reason_zh"]')
    .fill('该次线索可能涉及单名学生，仍需单独核实');
  await linkForm.locator('input[name="evidence_ref"]')
    .fill('虚构指定学生来源核验材料');
  await linkForm.getByRole('button',{name:'提交单学生待核实关联'}).click();
  await expect(a.locator('#lead-student-associations-list'))
    .toContainText('待主管审核');
  await m.locator('button[data-view="leads"]').click();
  await m.getByRole('button',{name:'刷新数据'}).click();
  const decideLink=m.locator('#lead-student-link-decision-form');
  const linkRequestId=await decideLink.locator('select[name="request_id"] option')
    .filter({hasText:linkedStudentName}).first().getAttribute('value');
  expect(linkRequestId).toBeTruthy();
  await decideLink.locator('select[name="request_id"]').selectOption(linkRequestId);
  await decideLink.locator('textarea[name="reason_zh"]')
    .fill('只同意登记该单名学生的待核实关系，没有确认监护身份');
  await decideLink.locator('input[name="evidence_ref"]')
    .fill('虚构独立单学生待核实检查');
  await decideLink.getByRole('button',{name:'保存单学生关联审核'}).click();
  await expect.poll(async()=>(
    await owner.query('SELECT status FROM ms.lead_student_association_requests WHERE id=$1',
      [linkRequestId])
  ).rows[0]?.status).toBe('approved_pending');
  expect((await owner.query(
    'SELECT confirmation_state FROM ms.lead_students WHERE lead_id=$1 AND student_id=$2',
    [finalLeads.rows[0].id,namedStudentId]
  )).rows[0].confirmation_state).toBe('pending_review');
  // V3.2-21: explicit human verification of this ONE student, then wrong-link withdrawal.
  await a.getByRole('button',{name:'刷新数据'}).click();
  await expect(a.locator('#student-link-verification-workbench')).toBeVisible();
  const linkVerification=a.locator('#student-link-verification-request-form');
  await linkVerification.locator('select[name="action"]').selectOption('verify');
  await linkVerification.locator('select[name="verify_association"]').selectOption(linkRequestId);
  await linkVerification.locator('select[name="basis_kind"]').selectOption('student_consultation');
  await linkVerification.locator('input[name="confirmation_ref"]')
    .fill('虚构单名学生明确咨询证据编号');
  await linkVerification.locator('input[name="evidence_ref"]')
    .fill('虚构指定学生真实关联核实依据');
  await linkVerification.locator('textarea[name="reason_zh"]')
    .fill('独立核实本次线索确实对应指定的这一名学生');
  await linkVerification.getByRole('button',{name:'提交单学生核实／撤回申请'}).click();
  await expect(a.locator('#student-link-reviews-list')).toContainText('等待独立主管审核');
  await m.getByRole('button',{name:'刷新数据'}).click();
  const independentVerification=m.locator('#student-link-verification-decision-form');
  const verifyChoice=await independentVerification.locator('select[name="review_id"] option')
    .filter({hasText:linkedStudentName}).first().getAttribute('value');
  expect(verifyChoice).toBeTruthy();
  await independentVerification.locator('select[name="review_id"]').selectOption(verifyChoice);
  await independentVerification.locator('select[name="decision"]').selectOption('approved');
  await independentVerification.locator('textarea[name="reason_zh"]')
    .fill('只对这名学生和对应咨询进行独立人工复核');
  await independentVerification.locator('input[name="evidence_ref"]')
    .fill('虚构主管核实依据，不证明监护关系');
  await independentVerification.getByRole('button',{name:'保存独立核实或撤回结论'}).click();
  await expect.poll(async()=>(
    await owner.query('SELECT confirmation_state FROM ms.lead_students WHERE lead_id=$1 AND student_id=$2',
      [finalLeads.rows[0].id,namedStudentId])
  ).rows[0]?.confirmation_state).toBe('verified');
  expect((await owner.query('SELECT COUNT(*)::int AS n FROM ms.student_contacts WHERE student_id=$1',
    [namedStudentId])).rows[0].n).toBe(0);
  await a.getByRole('button',{name:'刷新数据'}).click();
  await expect(a.locator('#student-link-current-list'))
    .toContainText('已人工确认销售关联');
  await linkVerification.locator('select[name="action"]').selectOption('withdraw');
  await linkVerification.locator('select[name="withdraw_association"]').selectOption(linkRequestId);
  await linkVerification.locator('input[name="evidence_ref"]')
    .fill('虚构客户发现本次学生关联错误的材料');
  await linkVerification.locator('textarea[name="reason_zh"]')
    .fill('指定学生关联错误，必须保留历史并撤回');
  await linkVerification.getByRole('button',{name:'提交单学生核实／撤回申请'}).click();
  await m.getByRole('button',{name:'刷新数据'}).click();
  const withdrawChoice=await independentVerification.locator('select[name="review_id"] option')
    .filter({hasText:linkedStudentName}).first().getAttribute('value');
  expect(withdrawChoice).toBeTruthy();
  await independentVerification.locator('select[name="review_id"]').selectOption(withdrawChoice);
  await independentVerification.locator('textarea[name="reason_zh"]')
    .fill('独立核查后确认错误的学生关联，批准撤回但保留原审批');
  await independentVerification.locator('input[name="evidence_ref"]')
    .fill('虚构主管撤回核对依据');
  await independentVerification.getByRole('button',{name:'保存独立核实或撤回结论'}).click();
  await expect.poll(async()=>(
    await owner.query('SELECT confirmation_state FROM ms.lead_students WHERE lead_id=$1 AND student_id=$2',
      [finalLeads.rows[0].id,namedStudentId])
  ).rows[0]?.confirmation_state).toBe('withdrawn');
  expect((await owner.query('SELECT COUNT(*)::int AS n FROM ms.lead_student_link_review_effects WHERE lead_id=$1',
    [finalLeads.rows[0].id])).rows[0].n).toBe(2);
  expect((await owner.query('SELECT COUNT(*)::int AS n FROM ms.lead_students WHERE lead_id=$1 AND student_id=$2',
    [finalLeads.rows[0].id,siblingStudentId])).rows[0].n).toBe(0);
  await a.getByRole('button',{name:'刷新数据'}).click();
  await expect(a.locator('#student-link-current-list')).toContainText('错误关联已撤回');
  const onlyOne=(await owner.query('SELECT student_id,confirmation_state FROM ms.lead_students WHERE lead_id=$1',
    [finalLeads.rows[0].id])).rows;
  expect(onlyOne).toHaveLength(1);
  expect(onlyOne[0].student_id).toBe(namedStudentId);
  expect(onlyOne[0].confirmation_state).toBe('withdrawn');
  expect((await owner.query('SELECT COUNT(*)::int AS n FROM ms.lead_students WHERE lead_id=$1 AND student_id=$2',
    [finalLeads.rows[0].id,siblingStudentId])).rows[0].n).toBe(0);
  await a.getByRole('button',{name:'刷新数据'}).click();
  const correction=a.locator('#lead-adjustment-request-form');
  await correction.locator('select[name="lead_id"]').selectOption(finalLeads.rows[0].id);
  await correction.locator('select[name="action"]').selectOption('correct_note');
  await correction.locator('textarea[name="proposed_note"]')
    .fill('本次补充说明只针对该名学生的学习咨询');
  await correction.locator('textarea[name="reason_zh"]')
    .fill('历史业务说明需要补充，但原咨询来源不变');
  await correction.locator('input[name="evidence_ref"]')
    .fill('虚构书面补充依据');
  await correction.getByRole('button',{name:'提交线索调整审核'}).click();
  await m.getByRole('button',{name:'刷新数据'}).click();
  const decideAdjustment=m.locator('#lead-adjustment-decision-form');
  let adjustId=await decideAdjustment.locator('select[name="request_id"] option')
    .filter({hasText:'申请更正业务说明'}).first().getAttribute('value');
  expect(adjustId).toBeTruthy();
  await decideAdjustment.locator('select[name="request_id"]').selectOption(adjustId);
  await decideAdjustment.locator('textarea[name="reason_zh"]')
    .fill('独立主管确认仅追加业务说明，不更改来源');
  await decideAdjustment.locator('input[name="evidence_ref"]')
    .fill('虚构更正复核证明');
  await decideAdjustment.getByRole('button',{name:'保存线索调整独立审批'}).click();
  await expect.poll(async()=>(
    await owner.query('SELECT status FROM ms.lead_adjustment_requests WHERE id=$1',[adjustId])
  ).rows[0]?.status).toBe('approved');
  expect((await owner.query(
    'SELECT source_event_id FROM ms.leads WHERE id=$1',[finalLeads.rows[0].id]
  )).rows[0].source_event_id).toBe(newEventId);
  await a.getByRole('button',{name:'刷新数据'}).click();
  await expect(a.locator('#lead-correction-notes-list'))
    .toContainText('本次补充说明只针对该名学生的学习咨询');
  await correction.locator('select[name="lead_id"]').selectOption(finalLeads.rows[0].id);
  await correction.locator('select[name="action"]').selectOption('invalidate');
  await correction.locator('textarea[name="proposed_note"]').fill('');
  await correction.locator('textarea[name="reason_zh"]')
    .fill('测试线索当前无商机，申请作废并保留审计');
  await correction.locator('input[name="evidence_ref"]')
    .fill('虚构不再有效的线索业务记录');
  await correction.getByRole('button',{name:'提交线索调整审核'}).click();
  await m.getByRole('button',{name:'刷新数据'}).click();
  adjustId=await decideAdjustment.locator('select[name="request_id"] option')
    .filter({hasText:'申请作废线索'}).first().getAttribute('value');
  expect(adjustId).toBeTruthy();
  await decideAdjustment.locator('select[name="request_id"]').selectOption(adjustId);
  await decideAdjustment.locator('textarea[name="reason_zh"]')
    .fill('独立主管查验没有下游商机，允许作废但保留历史');
  await decideAdjustment.locator('input[name="evidence_ref"]')
    .fill('虚构无下游商机的核查记录');
  await decideAdjustment.getByRole('button',{name:'保存线索调整独立审批'}).click();
  await expect.poll(async()=>(
    await owner.query('SELECT lead_state FROM ms.leads WHERE id=$1',[finalLeads.rows[0].id])
  ).rows[0]?.lead_state).toBe('invalid');
  expect((await owner.query(
    'SELECT COUNT(*)::int AS n FROM ms.lead_students WHERE lead_id=$1',[finalLeads.rows[0].id]
  )).rows[0].n).toBe(1);
  expect((await owner.query('SELECT count(*)::int AS n FROM ms.lead_conversion_executions WHERE lead_id=$1',
    [finalLeads.rows[0].id])).rows[0].n).toBe(1);
  // V3.2-22: separate fictional downstream-dependent student case.
  // Existing V3.2-21 test remains intact; this scenario never rewrites its lead.
  const fixtureKey=()=>randomUUID();
  const db=async(p,sql,params)=>(await p.query(sql,params)).rows[0].result;
  const downstreamName='已有商机待跨模块纠错的学生-'+randomUUID();
  const downstreamContact=(await db(pools.writeA,
    'SELECT ms.create_scoped_contact($1,$2,$3) AS result',
    ['已有商机纠错联系人-'+randomUUID(),false,fixtureKey()])).contact_id;
  const downstreamEvent=(await db(pools.writeA,
    'SELECT ms.create_scoped_contact_consultation($1,$2,$3,$4) AS result',
    [downstreamContact,'微信咨询',new Date(Date.now()-40000),fixtureKey()])).event_id;
  const downstreamCandidate=await db(pools.writeA,
    'SELECT ms.request_consultation_lead_candidate($1,$2,$3,$4) AS result',
    [downstreamEvent,'虚构原始咨询记录','原咨询需要独立核实',fixtureKey()]);
  await db(pools.writeM,
    'SELECT ms.decide_consultation_lead_candidate($1,$2,$3,$4,$5) AS result',
    [downstreamCandidate,'reviewed_eligible','虚构主管候选依据','确认原咨询的候选资格',fixtureKey()]);
  const downstreamReady=await db(pools.writeA,
    'SELECT ms.submit_lead_conversion_preflight($1,$2,$3,$4) AS result',
    [downstreamCandidate,'虚构预审依据','核查本次真实咨询归因',fixtureKey()]);
  await db(pools.writeM,
    'SELECT ms.decide_lead_conversion_preflight($1,$2,$3,$4,$5) AS result',
    [downstreamReady,'cleared','主管预审材料','独立确认可提交最终审核',fixtureKey()]);
  const downstreamAuthorization=await db(pools.writeA,
    'SELECT ms.request_final_lead_conversion($1,$2,$3,$4) AS result',
    [downstreamReady,'虚构最终审批材料','申请原咨询转成线索',fixtureKey()]);
  await db(pools.writeM,
    'SELECT ms.decide_final_lead_conversion($1,$2,$3,$4,$5) AS result',
    [downstreamAuthorization,'approved','虚构独立主管批准材料','批准但尚未执行转换',fixtureKey()]);
  const downstreamLead=(await db(pools.writeA,
    'SELECT ms.execute_final_lead_conversion($1,$2) AS result',
    [downstreamAuthorization,fixtureKey()])).lead_id;
  const downstreamStudent=(await db(pools.writeA,
    'SELECT ms.create_scoped_student($1,$2,$3,$4) AS result',
    [downstreamName,null,null,fixtureKey()])).student_id;
  const downstreamAssociation=await db(pools.writeA,
    'SELECT ms.request_lead_student_association($1,$2,$3,$4,$5) AS result',
    [downstreamLead,downstreamStudent,'虚构该名学生对应线索材料',
      '学生与线索暂登记为待核实',fixtureKey()]);
  await db(pools.writeM,
    'SELECT ms.decide_lead_student_association($1,$2,$3,$4,$5) AS result',
    [downstreamAssociation,'approved_pending','虚构独立学生核对资料',
      '只允许这一名学生待核实关联',fixtureKey()]);
  const downstreamOpportunity=(await owner.query(
    "INSERT INTO ms.opportunities(student_id,owner_user_id,originating_lead_id) VALUES($1,$2,$3) RETURNING id",
    [downstreamStudent,ids.A,downstreamLead])).rows[0].id;
  const downstreamOrder=(await owner.query(
    'INSERT INTO ms.sales_orders(student_id,opportunity_id,amount_due_cents) VALUES($1,$2,6000) RETURNING id',
    [downstreamStudent,downstreamOpportunity])).rows[0].id;
  await a.locator('button[data-view="leads"]').click();
  await a.getByRole('button',{name:'刷新数据'}).click();
  await expect(a.locator('#downstream-correction-workbench')).toBeVisible();
  const downstreamForm=a.locator('#downstream-correction-request-form');
  await downstreamForm.locator('select[name="association_request_id"]')
    .selectOption(downstreamAssociation);
  await downstreamForm.locator('textarea[name="reason_zh"]')
    .fill('原指定学生关联有争议，但已经创建一条商机和一个虚构订单，需要先保护');
  await downstreamForm.locator('input[name="evidence_ref"]')
    .fill('虚构下游错关联核查证明');
  await downstreamForm.getByRole('button',{name:'登记下游纠错并启动销售隔离'}).click();
  await expect(a.locator('#downstream-correction-cases-list'))
    .toContainText('待核查：已阻止新的销售推进');
  await expect(owner.query("UPDATE ms.opportunities SET stage='qualified' WHERE id=$1",
    [downstreamOpportunity])).rejects.toHaveProperty('code','23514');
  await m.locator('button[data-view="leads"]').click();
  await m.getByRole('button',{name:'刷新数据'}).click();
  const downstreamDecision=m.locator('#downstream-correction-decision-form');
  const downstreamCaseId=await downstreamDecision.locator('select[name="case_id"] option')
    .filter({hasText:downstreamName}).first().getAttribute('value');
  expect(downstreamCaseId).toBeTruthy();
  await downstreamDecision.locator('select[name="case_id"]').selectOption(downstreamCaseId);
  await downstreamDecision.locator('select[name="decision"]').selectOption('hold_active');
  await downstreamDecision.locator('textarea[name="reason_zh"]')
    .fill('独立主管确认下游商机存在，必须继续隔离并另行跨模块复核');
  await downstreamDecision.locator('input[name="evidence_ref"]')
    .fill('虚构独立下游风险复核材料');
  await downstreamDecision.getByRole('button',{name:'保存独立纠错保护决定'}).click();
  await expect.poll(async()=>(await owner.query(
    'SELECT status FROM ms.lead_student_downstream_correction_cases WHERE id=$1',
    [downstreamCaseId])).rows[0]?.status).toBe('hold_active');
  expect((await owner.query(
    'SELECT student_id FROM ms.opportunities WHERE id=$1',[downstreamOpportunity]
  )).rows[0].student_id).toBe(downstreamStudent);
  expect((await owner.query(
    'SELECT student_id FROM ms.sales_orders WHERE id=$1',[downstreamOrder]
  )).rows[0].student_id).toBe(downstreamStudent);
  expect((await owner.query(
    'SELECT confirmation_state FROM ms.lead_students WHERE lead_id=$1 AND student_id=$2',
    [downstreamLead,downstreamStudent]
  )).rows[0].confirmation_state).toBe('pending_review');
  await a.getByRole('button',{name:'刷新数据'}).click();
  await expect(a.locator('#downstream-correction-cases-list'))
    .toContainText('已批准隔离：下游纠错尚未完成');
  // V3.2-23: second distinct manager must review an active downstream hold.
  await expect(a.locator('#downstream-reconciliation-workbench')).toBeVisible();
  const reconciliationRequest=a.locator('#downstream-reconciliation-request-form');
  await reconciliationRequest.locator('select[name="case_id"]')
    .selectOption(downstreamCaseId);
  await reconciliationRequest.locator('select[name="resolution"]')
    .selectOption('external_action_required');
  await reconciliationRequest.locator('input[name="evidence_ref"]')
    .fill('虚构错误学生关联及订单来源证据');
  await reconciliationRequest.locator('input[name="independent_basis_ref"]')
    .fill('虚构订单财务与业绩权威核对材料');
  await reconciliationRequest.locator('textarea[name="reason_zh"]')
    .fill('订单已绑定原学生，确认需要财务教务及销售分别复核，不能自动转换');
  await reconciliationRequest.getByRole('button',{name:'提交第二轮独立核查申请'}).click();
  await expect(a.locator('#downstream-reconciliation-list'))
    .toContainText('等待第二名独立主管审核');
  await n.locator('button[data-view="leads"]').click();
  await n.getByRole('button',{name:'刷新数据'}).click();
  await expect(n.locator('#downstream-reconciliation-decision-card')).toBeVisible();
  const reviewForm=n.locator('#downstream-reconciliation-decision-form');
  const reviewId=await reviewForm.locator('select[name="reconciliation_id"] option')
    .filter({hasText:downstreamName}).first().getAttribute('value');
  expect(reviewId).toBeTruthy();
  await reviewForm.locator('select[name="reconciliation_id"]').selectOption(reviewId);
  await reviewForm.locator('select[name="decision"]').selectOption('approved');
  await reviewForm.locator('input[name="evidence_ref"]')
    .fill('虚构第二主管独立复核未结订单');
  await reviewForm.locator('textarea[name="reason_zh"]')
    .fill('实际错误不能由销售系统改写已存在的订单和收款，维持隔离并交跨模块');
  await reviewForm.getByRole('button',{name:'保存第二轮独立核查决定'}).click();
  await expect.poll(async()=>(await owner.query(
    'SELECT status FROM ms.downstream_correction_reconciliation_requests WHERE id=$1',
    [reviewId])).rows[0]?.status).toBe('external_action_required');
  expect((await owner.query(
    'SELECT status FROM ms.lead_student_downstream_correction_cases WHERE id=$1',
    [downstreamCaseId])).rows[0].status).toBe('hold_active');
  expect((await owner.query(
    'SELECT student_id FROM ms.sales_orders WHERE id=$1',[downstreamOrder]
  )).rows[0].student_id).toBe(downstreamStudent);
  await a.getByRole('button',{name:'刷新数据'}).click();
  await expect(a.locator('#downstream-reconciliation-list'))
    .toContainText('已登记跨部门人工处理，隔离继续保持');
  await testInfo.attach('v3-2-23-independent-second-reviewer-handoff',{
    body:await a.screenshot({fullPage:true}),contentType:'image/png'
  });
  await testInfo.attach('v3-2-22-downstream-hold-business-review',{
    body:await a.screenshot({fullPage:true}),contentType:'image/png'
  });
  await testInfo.attach('v3-2-20-student-lead-governance',{
    body:await a.screenshot({fullPage:true}),contentType:'image/png'
  });
  await testInfo.attach('v3-2-19-final-approved-lead-conversion',{
    body:await a.screenshot({fullPage:true}),contentType:'image/png'
  });
  await m.locator('button[data-view="contacts"]').click();
  await m.setViewportSize({width:390,height:844});
  await expect(m.locator('#custody-decision-card')).toBeVisible();
  const overflow=await m.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await testInfo.attach('chinese-contact-custody-approval',{
   body:await m.screenshot({fullPage:true}),contentType:'image/png'
  });
  const visibleText=await m.locator('#contact-custody-workbench').innerText();
  expect(visibleText).not.toContain('staff_identity_bindings');
  expect(visibleText).not.toContain('SELECT');
  expect(visibleText).not.toContain('虚构独立审核材料说明');
 }finally{
  await Promise.allSettled(Object.values(pages).map(p=>p.close()));
  if(app.listening)await close(app);
  await Promise.all([owner.end(),directory.end(),...Object.values(pools).map(p=>p.end())]);
 }
});
