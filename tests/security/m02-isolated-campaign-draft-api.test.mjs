import test from 'node:test';
import assert from 'node:assert/strict';
import {createSign,generateKeyPairSync,randomUUID} from 'node:crypto';
import pg from 'pg';
import {createApp} from '../../src/app.mjs';

const ORG='20000000-0000-4000-8000-000000000001';
const OTHER='20000000-0000-4000-8000-000000000002';
const A='20000000-0000-4000-8000-000000000011';
const B='20000000-0000-4000-8000-000000000012';
const M='20000000-0000-4000-8000-000000000013';
const M2='20000000-0000-4000-8000-000000000014';
const issuer='https://fictional-m02-campaign-drafts.example.invalid';
const audience='fictional-campaign-draft-tests';

test('V3.2-57 strict campaign drafts validate owner, channels, dates, planned budget and immutable finance isolation',async()=>{
 process.env.MS_STAGE='isolated-test';
 const owner=new pg.Pool({connectionString:process.env.DATABASE_URL,max:4});
 const dir=new pg.Pool({connectionString:process.env.DATABASE_URL_AUTH_DIRECTORY,max:2});
 const aRead=new pg.Pool({connectionString:process.env.DATABASE_URL_ASSIGNEE_A,max:2});
 const bRead=new pg.Pool({connectionString:process.env.DATABASE_URL_ASSIGNEE_B,max:2});
 const mRead=new pg.Pool({connectionString:process.env.DATABASE_URL_ASSIGNEE_MANAGER,max:2});
 const aWrite=new pg.Pool({connectionString:process.env.DATABASE_URL_WRITE_A,max:2});
 const mWrite=new pg.Pool({connectionString:process.env.DATABASE_URL_WRITE_MANAGER,max:2});
 const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
 const jwk={...publicKey.export({format:'jwk'}),kid:'m02-'+randomUUID(),alg:'RS256',use:'sig'};
 const subjects=new Map([[A,'campaign-a-'+randomUUID()],[M,'campaign-m-'+randomUUID()]]);
 const sign=staff=>{
  const now=Math.floor(Date.now()/1000);
  const h=Buffer.from(JSON.stringify({typ:'JWT',alg:'RS256',kid:jwk.kid})).toString('base64url');
  const p=Buffer.from(JSON.stringify({iss:issuer,sub:subjects.get(staff),
   aud:audience,iat:now,exp:now+900,org_id:OTHER,staff_id:M2,role:'super_admin'})).toString('base64url');
  return h+'.'+p+'.'+createSign('RSA-SHA256').update(h+'.'+p).sign(privateKey).toString('base64url');
 };
 const channels={ok:randomUUID(),parent:randomUUID(),inactiveChild:randomUUID(),foreign:randomUUID()};
 const prefix='隔离活动-'+randomUUID();
 const key=()=>('m02_'+randomUUID().replaceAll('-',''));
 const payload=(name=prefix+'-正常')=>({
  name,starts_at:'2027-03-01T00:00:00.000Z',ends_at:'2027-03-30T00:00:00.000Z',
  budget_cents:125000,channel_ids:[channels.ok]
 });
 let app,broadCalls=0,ownCampaign,managerCampaign,reviewId;
 const incidentIds=[];
 const get=async(staff)=>{
  const r=await fetch('http://127.0.0.1:'+app.address().port+
   '/api/v1/marketing-campaigns/drafts',{headers:{Authorization:'Bearer '+sign(staff)}});
  return {status:r.status,...await r.json()};
 };
 const post=async(staff,body,idempotency=key())=>{
  const r=await fetch('http://127.0.0.1:'+app.address().port+
   '/api/v1/marketing-campaigns/drafts',{
   method:'POST',headers:{Authorization:'Bearer '+sign(staff),
    'Content-Type':'application/json','Idempotency-Key':idempotency},
   body:JSON.stringify(body)});
  return {status:r.status,...await r.json()};
 };
 const reviews=async staff=>{
  const r=await fetch('http://127.0.0.1:'+app.address().port+
    '/api/v1/marketing-campaigns/sales-reviews',
    {headers:{Authorization:'Bearer '+sign(staff)}});
  return {status:r.status,...await r.json()};
 };
 const handoffs=async staff=>{
  const r=await fetch('http://127.0.0.1:'+app.address().port+
    '/api/v1/marketing-campaigns/finance-handoffs',
    {headers:{Authorization:'Bearer '+sign(staff)}});
  return {status:r.status,...await r.json()};
 };
 const incidents=async staff=>{
  const r=await fetch('http://127.0.0.1:'+app.address().port+
   '/api/v1/marketing-campaigns/finance-incidents',
   {headers:{Authorization:'Bearer '+sign(staff)}});
  return {status:r.status,...await r.json()};
 };
 const auditHistory=async staff=>{
  const r=await fetch('http://127.0.0.1:'+app.address().port+
   '/api/v1/marketing-campaigns/finance-incidents/audit-history',
   {headers:{Authorization:'Bearer '+sign(staff)}});
  return {status:r.status,...await r.json()};
 };
 const acceptancePrerequisites=async staff=>{
  const r=await fetch('http://127.0.0.1:'+app.address().port+
    '/api/v1/marketing-campaigns/finance-incidents/acceptance-prerequisites',
    {headers:{Authorization:'Bearer '+sign(staff)}});
  return {status:r.status,...await r.json()};
 };
 const evidenceGates=async staff=>{
  const r=await fetch('http://127.0.0.1:'+app.address().port+
   '/api/v1/marketing-campaigns/finance-incidents/evidence-gates',
   {headers:{Authorization:'Bearer '+sign(staff)}});
  return {status:r.status,...await r.json()};
 };
 const followups=async staff=>{
  const r=await fetch('http://127.0.0.1:'+app.address().port+
   '/api/v1/marketing-campaigns/finance-incidents/follow-ups',
   {headers:{Authorization:'Bearer '+sign(staff)}});
  return {status:r.status,...await r.json()};
 };
 const appendFollowup=async(staff,id,type='sales_evidence_addendum',requestKey=key())=>{
  const r=await fetch('http://127.0.0.1:'+app.address().port+
   '/api/v1/marketing-campaigns/finance-incidents/'+id+'/follow-ups',{
   method:'POST',headers:{Authorization:'Bearer '+sign(staff),
    'Content-Type':'application/json','Idempotency-Key':requestKey},
   body:JSON.stringify({note_type:type,evidence_ref:'虚构升级后补充材料索引',
    reason_zh:'销售侧人工核查追加信息，不能代表财务签收或资金审批'})});
  return {status:r.status,...await r.json()};
 };
 const reportIncident=async(staff,id,kind,requestKey=key(),reason='虚构资料需独立复核')=>{
  const r=await fetch('http://127.0.0.1:'+app.address().port+
   '/api/v1/marketing-campaigns/finance-handoffs/'+id+'/incidents',{
   method:'POST',headers:{Authorization:'Bearer '+sign(staff),
    'Content-Type':'application/json','Idempotency-Key':requestKey},
   body:JSON.stringify({issue_kind:kind,evidence_ref:'虚构交接资料索引',reason_zh:reason})});
  return {status:r.status,...await r.json()};
 };
 const triageIncident=async(staff,id,action,requestKey=key())=>{
  const r=await fetch('http://127.0.0.1:'+app.address().port+
   '/api/v1/marketing-campaigns/finance-incidents/'+id+'/decision',{
   method:'POST',headers:{Authorization:'Bearer '+sign(staff),
    'Content-Type':'application/json','Idempotency-Key':requestKey},
   body:JSON.stringify({action,evidence_ref:'虚构独立复核依据',reason_zh:'销售侧异常分流而非财务批准'})});
  return {status:r.status,...await r.json()};
 };
 const submitSales=async(staff,id,version,requestKey=key())=>{
  const r=await fetch('http://127.0.0.1:'+app.address().port+
    '/api/v1/marketing-campaigns/drafts/'+id+'/sales-review-requests',{
    method:'POST',headers:{Authorization:'Bearer '+sign(staff),
      'Content-Type':'application/json','Idempotency-Key':requestKey},
    body:JSON.stringify({expected_version:version,evidence_ref:'模拟活动方案索引',
      reason_zh:'等待独立销售主管核实活动计划'})});
  return {status:r.status,...await r.json()};
 };
 const decideSales=async(staff,id,decision='approved',reviewKey=key())=>{
  const r=await fetch('http://127.0.0.1:'+app.address().port+
    '/api/v1/marketing-campaigns/sales-reviews/'+id+'/decision',{
    method:'POST',headers:{Authorization:'Bearer '+sign(staff),
      'Content-Type':'application/json','Idempotency-Key':reviewKey},
    body:JSON.stringify({decision,evidence_ref:'独立销售主管核验材料',
      reason_zh:'业务审核与财务拨付许可独立隔离'})});
  return {status:r.status,...await r.json()};
 };
 const revise=async(staff,id,body,idempotency=key())=>{
  const r=await fetch('http://127.0.0.1:'+app.address().port+
    '/api/v1/marketing-campaigns/drafts/'+id+'/revisions',{
    method:'POST',headers:{Authorization:'Bearer '+sign(staff),
     'Content-Type':'application/json','Idempotency-Key':idempotency},
    body:JSON.stringify(body)});
  return {status:r.status,...await r.json()};
 };
 const bind=async(staff,requester,reviewer)=>{
  const r=await owner.query(
   "INSERT INTO ms.identity_change_requests(organization_id,action,target_staff_id,"+
   "issuer,subject,requested_by,request_evidence_ref,request_reason_zh) "+
   "VALUES($1,'bind',$2,$3,$4,$5,'虚构身份资料','仅测试员工授权') RETURNING id",
   [ORG,staff,issuer,subjects.get(staff),requester]);
  await owner.query(
   "INSERT INTO ms.identity_change_decisions(request_id,reviewer_user_id,decision,review_evidence_ref,reason_zh) "+
   "VALUES($1,$2,'approved','独立核验','模拟验证')",[r.rows[0].id,reviewer]);
  await owner.query(
   "UPDATE ms.identity_change_requests SET status='approved',decided_by=$2,decided_at=now() WHERE id=$1",
   [r.rows[0].id,reviewer]);
  await owner.query(
   "INSERT INTO ms.staff_identity_bindings(staff_user_id,issuer,subject,bound_by,approval_request_id) "+
   "VALUES($1,$2,$3,$4,$5)",
   [staff,issuer,subjects.get(staff),reviewer,r.rows[0].id]);
 };
 try{
  await owner.query(
   "INSERT INTO ms.marketing_channels(id,organization_id,parent_id,name,status) VALUES"+
   "($1,$5,NULL,$6,'active'),($2,$5,NULL,$7,'inactive'),"+
   "($3,$5,$2,$8,'active'),($4,$9,NULL,$10,'active')",
   [channels.ok,channels.parent,channels.inactiveChild,channels.foreign,
    ORG,prefix+'-好渠道',prefix+'-停用父渠道',prefix+'-继承停用渠道',OTHER,prefix+'-别家渠道']);
  await bind(A,M,M2);
  await bind(M,A,M2);
  app=createApp({connect(){broadCalls++;throw Error('broad tenant DB must not run');}},{
   secret:'fictional-test-only-strong-token-secret-9c92789dc3b9',
   externalIdentity:{issuer,audience,jwks:{keys:[jwk]}},strictStaffMode:true,
   identityDirectoryPool:dir,
   scopedReadPools:new Map([[A,aRead],[B,bRead],[M,mRead]]),
   scopedWritePools:new Map([[A,aWrite],[M,mWrite]])
  });
  await new Promise(ok=>app.listen(0,'127.0.0.1',ok));
  const keyA=key();
  const draft=await post(A,payload(),keyA);
  assert.equal(draft.status,200,JSON.stringify(draft));
  assert.equal(draft.data.status,'draft');
  assert.equal(draft.data.owner_user_id,A);
  ownCampaign=draft.data.campaign_id;
  assert.equal((await post(A,payload(),keyA)).data.campaign_id,ownCampaign);
  assert.equal((await post(A,{...payload(),budget_cents:2},keyA)).status,409);
  const row=(await owner.query('SELECT organization_id,name,owner_user_id,status,budget_cents FROM ms.marketing_campaigns WHERE id=$1',[ownCampaign])).rows[0];
  assert.equal(row.organization_id,ORG);assert.equal(row.owner_user_id,A);
  assert.equal(row.status,'draft');assert.equal(Number(row.budget_cents),125000);
  const cc=await owner.query('SELECT channel_id FROM ms.campaign_channels WHERE campaign_id=$1',[ownCampaign]);
  assert.deepEqual(cc.rows.map(x=>x.channel_id),[channels.ok]);
  const ownRead=await get(A);
  assert.equal(ownRead.status,200);
  assert.ok(ownRead.data.items.some(x=>x.campaign_id===ownCampaign));
  assert.equal((await get(M)).status,200);
  assert.ok((await get(M)).data.items.some(x=>x.campaign_id===ownCampaign),
   'approved institution manager can see employee-owned drafts');

  for(const [why,input] of [
   ['foreign channel',{...payload(prefix+'-foreign'),channel_ids:[channels.foreign]}],
   ['inactive parent',{...payload(prefix+'-inherited'),channel_ids:[channels.inactiveChild]}],
   ['directly inactive',{...payload(prefix+'-inactive'),channel_ids:[channels.parent]}],
   ['duplicate channels',{...payload(prefix+'-repeat'),channel_ids:[channels.ok,channels.ok]}],
   ['missing channels',{...payload(prefix+'-empty'),channel_ids:[]}],
   ['negative budget',{...payload(prefix+'-negative'),budget_cents:-1}],
   ['budget overspend',{...payload(prefix+'-huge'),budget_cents:100000000001}],
   ['reversed dates',{...payload(prefix+'-dates'),ends_at:'2027-02-01T00:00:00.000Z'}],
   ['unknown field',{...payload(prefix+'-faked'),owner_user_id:M,status:'active'}]
  ]){
   const r=await post(A,input);
   assert.equal(r.status,422,why+': '+JSON.stringify(r));
  }
  const manager=await post(M,{...payload(prefix+'-主管'),budget_cents:0});
  assert.equal(manager.status,200,JSON.stringify(manager));
  managerCampaign=manager.data.campaign_id;
  assert.equal(manager.data.owner_user_id,M,'cannot impersonate another campaign owner');
  assert.ok(!(await get(A)).data.items.some(x=>x.campaign_id===managerCampaign));
  assert.ok((await get(M)).data.items.some(x=>x.campaign_id===managerCampaign));

  // V3.2-58: revision is own-draft only, version checked, and never activates.
  const newBody={...payload(prefix+'-修改版'),expected_version:1,budget_cents:99500};
  assert.equal((await get(A)).data.items.find(x=>x.campaign_id===ownCampaign).version,1);
  const revisionKey=key();
  const revised=await revise(A,ownCampaign,newBody,revisionKey);
  assert.equal(revised.status,200,JSON.stringify(revised));
  assert.equal(revised.data.version,2);
  assert.equal(revised.data.status,'draft');
  const same=await revise(A,ownCampaign,newBody,revisionKey);
  assert.equal(same.status,200);
  assert.equal(same.data.version,2);
  assert.equal(same.data.already_exists,true);
  assert.equal((await revise(A,ownCampaign,{...newBody,budget_cents:22},revisionKey)).status,409);
  const stale=await revise(A,ownCampaign,{...newBody,name:prefix+'-旧版本再写'});
  assert.equal(stale.status,409,'stale version must not overwrite approved current draft');
  assert.equal((await revise(M,ownCampaign,{...newBody,expected_version:2})).status,403,
   'same organization manager cannot edit employee-owned draft');
  for(const [reason,change] of [
   ['wrong institution',{channel_ids:[channels.foreign]}],
   ['inactive parent',{channel_ids:[channels.inactiveChild]}],
   ['inactive channel',{channel_ids:[channels.parent]}],
   ['negative planned budget',{budget_cents:-1}],
   ['invalid dates',{ends_at:'2027-02-20T00:00:00Z'}],
   ['unsupported status',{status:'active'}]
  ]){
   const outcome=await revise(A,ownCampaign,{
    ...newBody,expected_version:2,...change
   });
   assert.equal(outcome.status,422,reason+': '+JSON.stringify(outcome));
  }
  const v2=(await get(A)).data.items.find(x=>x.campaign_id===ownCampaign);
  assert.equal(v2.version,2);
  assert.equal(v2.name,newBody.name);
  assert.equal(Number(v2.budget_cents),99500);
  const saved=await owner.query(
   'SELECT name,status,budget_cents,owner_user_id FROM ms.marketing_campaigns WHERE id=$1',
   [ownCampaign]);
  assert.equal(saved.rows[0].name,newBody.name);
  assert.equal(saved.rows[0].status,'draft');
  assert.equal(saved.rows[0].owner_user_id,A);
  assert.equal(Number(saved.rows[0].budget_cents),99500);
  const history=await owner.query(
   "SELECT event_name,before_business_json,after_business_json FROM ms.audit_events "+
   "WHERE target_type='marketing_campaign' AND target_id=$1 ORDER BY happened_at",[ownCampaign]);
  assert.equal(history.rows.filter(x=>x.event_name==='CAMPAIGN_DRAFT_CREATED').length,1);
  const revisionEvents=history.rows.filter(x=>x.event_name==='CAMPAIGN_DRAFT_REVISED');
  assert.equal(revisionEvents.length,1);
  assert.equal(revisionEvents[0].before_business_json.version,1);
  assert.equal(revisionEvents[0].after_business_json.version,2);
  assert.equal(Number(revisionEvents[0].before_business_json.budget_cents),125000);
  assert.equal(Number(revisionEvents[0].after_business_json.budget_cents),99500);

  // V3.2-59: sales and finance are different authority boundaries.
  const salesKey=key();
  const pending=await submitSales(A,ownCampaign,2,salesKey);
  assert.equal(pending.status,200,JSON.stringify(pending));
  assert.equal(pending.data.status,'pending_sales');
  reviewId=pending.data.review_id;
  assert.equal((await submitSales(A,ownCampaign,2,salesKey)).data.review_id,reviewId);
  assert.equal((await submitSales(A,ownCampaign,2)).status,409,'one live review per campaign');
  assert.equal((await submitSales(A,ownCampaign,1)).status,409,'stale draft version denied');
  assert.equal((await decideSales(A,reviewId)).status,403,'requester cannot approve own budget proposal');
  assert.equal((await revise(A,ownCampaign,{...newBody,expected_version:2,
    name:prefix+'-attempt-during-review'})).status,409,
    'pending sales review freezes the exact draft version');
  const ownQueue=await reviews(A);
  assert.equal(ownQueue.status,200);
  assert.equal(ownQueue.data.items.find(x=>x.review_id===reviewId).can_sales_review,false);
  const managerQueue=await reviews(M);
  assert.equal(managerQueue.status,200);
  assert.equal(managerQueue.data.items.find(x=>x.review_id===reviewId).can_sales_review,true);
  assert.equal((await reportIncident(A,reviewId,'supporting_materials_gap')).status,403,
    'pending sales review cannot enter finance exception workflow');
  const beforeFinance=await handoffs(A);
  assert.equal(beforeFinance.status,200);
  assert.equal(beforeFinance.data.items.some(x=>x.review_id===reviewId),false,
    'pending sales review is never sent to finance preparation');
  const decisionKey=key();
  const approved=await decideSales(M,reviewId,'approved',decisionKey);
  assert.equal(approved.status,200,JSON.stringify(approved));
  assert.equal(approved.data.status,'sales_approved_pending_finance');
  assert.equal(approved.data.finance_authorized,false);
  for(const staff of [A,M]){
   const handoff=await handoffs(staff);
   assert.equal(handoff.status,200,JSON.stringify(handoff));
   const item=handoff.data.items.find(x=>x.review_id===reviewId);
   assert.ok(item,'only owner or actual approver sees the sales handoff');
   assert.equal(item.campaign_version,2);
   assert.equal(item.campaign_name,newBody.name);
   assert.equal(Number(item.planned_budget_cents),99500);
   assert.equal(item.channel_count,1);
   assert.equal(item.handoff_status,'awaiting_external_finance_authority');
   assert.equal(item.readiness_status,'ready_for_external_manual_check');
   assert.equal(item.campaign_status,'draft');
   assert.equal(item.finance_authorized,false);
   assert.equal(item.execution_allowed,false);
   for(const sensitive of ['evidence_ref','request_reason','review_reason','campaign_snapshot',
    'organization_id','review_key','request_key']){
    assert.equal(Object.hasOwn(item,sensitive),false,sensitive+' should not leak');
   }
  }
  assert.equal((await handoffs(B)).status,401,'unbound employee cannot enumerate finance handoffs');
  // V3.2-62: sales-side exception reporting, independent triage, and ongoing finance hold.
  assert.equal((await auditHistory(A)).status,200);
  assert.equal((await auditHistory(A)).data.items.filter(x=>x.review_id===reviewId).length,0,
    'there is no fabricated incident audit entry before reporting');
  const firstIncidentKey=key();
  const first=await reportIncident(A,reviewId,'supporting_materials_gap',firstIncidentKey);
  assert.equal(first.status,200,JSON.stringify(first));
  assert.equal(first.data.status,'open');
  assert.equal(first.data.finance_authorized,false);
  const incident1=first.data.incident_id;incidentIds.push(incident1);
  let audit=(await auditHistory(A));
  assert.equal(audit.status,200,JSON.stringify(audit));
  let eventRows=audit.data.items.filter(x=>x.incident_id===incident1);
  assert.equal(eventRows.length,1,'first reporting creates exactly one audit event');
  assert.equal(eventRows[0].event_name,'CAMPAIGN_FINANCE_HANDOFF_ISSUE_REPORTED');
  assert.equal(eventRows[0].event_status,'open');
  assert.equal(eventRows[0].current_incident_status,'open');
  assert.equal(eventRows[0].finance_authorized,false);
  assert.equal(eventRows[0].execution_allowed,false);
  for(const key of ['before_business_json','after_business_json','evidence_ref',
   'report_reason','review_reason','reason_zh','request_key','organization_id']){
    assert.equal(Object.hasOwn(eventRows[0],key),false,
     'incident audit must hide sensitive field '+key);
  }
  assert.equal((await auditHistory(B)).status,401,'unbound employee cannot read incident audit');
  assert.equal((await reportIncident(A,reviewId,'supporting_materials_gap',firstIncidentKey)).data.incident_id,incident1);
  assert.equal((await auditHistory(A)).data.items.filter(x=>x.incident_id===incident1).length,1,
    'idempotent report must not append another event');
  assert.equal((await reportIncident(A,reviewId,'integrity_mismatch',firstIncidentKey)).status,409);
  assert.equal((await reportIncident(A,reviewId,'supporting_materials_gap')).status,409,
    'at most one active incident per handoff');
  let listing=await incidents(A);
  assert.equal(listing.status,200,JSON.stringify(listing));
  let listed=listing.data.items.find(x=>x.incident_id===incident1);
  assert.equal(listed.can_triage,false);
  assert.equal(listed.issue_kind,'supporting_materials_gap');
  assert.equal(Object.hasOwn(listed,'evidence_ref'),false);
  assert.equal(Object.hasOwn(listed,'report_reason'),false);
  assert.equal((await handoffs(A)).data.items.find(x=>x.review_id===reviewId).readiness_status,
    'blocked_active_incident');
  listing=await incidents(M);
  assert.equal(listing.status,200);
  assert.equal(listing.data.items.find(x=>x.incident_id===incident1).can_triage,true);
  assert.equal((await incidents(B)).status,401);
  assert.equal((await triageIncident(A,incident1,'close_for_recheck')).status,403);
  const closeKey=key();
  const closure=await triageIncident(M,incident1,'close_for_recheck',closeKey);
  assert.equal(closure.status,200,JSON.stringify(closure));
  assert.equal(closure.data.status,'closed_for_recheck');
  assert.equal(closure.data.finance_authorized,false);
  assert.equal((await triageIncident(M,incident1,'close_for_recheck',closeKey)).data.status,
    'closed_for_recheck');
  audit=(await auditHistory(M));
  assert.equal(audit.status,200,JSON.stringify(audit));
  eventRows=audit.data.items.filter(x=>x.incident_id===incident1);
  assert.equal(eventRows.length,2,'report + independent recheck decision are append-only');
  assert.deepEqual(eventRows.map(x=>x.event_status).sort(),['closed_for_recheck','open'].sort());
  assert.ok(eventRows.every(x=>x.current_incident_status==='closed_for_recheck'),
    'current status does not rewrite historical event status');
  assert.ok(eventRows.every(x=>x.finance_authorized===false&&x.execution_allowed===false));
  assert.equal((await auditHistory(A)).data.items.filter(x=>x.incident_id===incident1).length,2,
    'the original reporter can read minimal independent review history');
  assert.equal((await triageIncident(M,incident1,'escalate_manual')).status,409);
  assert.equal((await handoffs(A)).data.items.find(x=>x.review_id===reviewId).readiness_status,
    'ready_for_external_manual_check','incident closure only resumes technical readiness');
  await owner.query('UPDATE ms.marketing_campaigns SET budget_cents=budget_cents+1 WHERE id=$1',[ownCampaign]);
  assert.equal((await handoffs(A)).data.items.find(x=>x.review_id===reviewId).readiness_status,
    'blocked_snapshot_mismatch');
  const bad=await reportIncident(A,reviewId,'integrity_mismatch');
  assert.equal(bad.status,200,JSON.stringify(bad));
  const incident2=bad.data.incident_id;incidentIds.push(incident2);
  assert.equal((await triageIncident(M,incident2,'close_for_recheck')).status,422,
    'snapshot mismatch may never be dismissed for recheck');
  const escalated=await triageIncident(M,incident2,'escalate_manual');
  assert.equal(escalated.status,200,JSON.stringify(escalated));
  assert.equal(escalated.data.status,'manual_escalated');
  audit=(await auditHistory(A));
  assert.equal(audit.status,200,JSON.stringify(audit));
  eventRows=audit.data.items.filter(x=>x.incident_id===incident2);
  assert.equal(eventRows.length,2);
  assert.deepEqual(eventRows.map(x=>x.event_status).sort(),['manual_escalated','open'].sort());
  assert.ok(eventRows.every(x=>x.current_incident_status==='manual_escalated'));
  assert.ok(eventRows.every(x=>x.finance_authorized===false&&x.execution_allowed===false));
  await owner.query('UPDATE ms.marketing_campaigns SET budget_cents=99500 WHERE id=$1',[ownCampaign]);
  assert.equal((await handoffs(A)).data.items.find(x=>x.review_id===reviewId).readiness_status,
    'blocked_active_incident','manual escalation remains blocked even after snapshot restored');
  assert.equal((await reportIncident(A,reviewId,'supporting_materials_gap')).status,409,
    'escalated incident cannot be silently superseded');
  assert.equal((await auditHistory(A)).data.items.filter(x=>x.incident_id===incident2).length,2,
    'escalated history persists even after restoring matching campaign plan');
  for(const pool of [aRead,bRead,mRead]){
    await assert.rejects(pool.query('SELECT * FROM ms.audit_events'),e=>e.code==='42501');
    await assert.rejects(pool.query("UPDATE ms.audit_events SET event_name=event_name WHERE FALSE"),
      e=>e.code==='42501');
    await assert.rejects(pool.query('DELETE FROM ms.audit_events WHERE FALSE'),
      e=>e.code==='42501');
  }
  // V3.2-66: trustworthy finance and academic attestations are absent, regardless of sales readiness.
  let prerequisites=await acceptancePrerequisites(A);
  assert.equal(prerequisites.status,200,JSON.stringify(prerequisites));
  assert.equal(prerequisites.data.items.some(x=>x.incident_id===incident1),false,
    'closed incident must not enter three-party release prerequisites');
  assert.equal((await acceptancePrerequisites(B)).status,401,
    'unbound employee cannot read future authority requirements');
  const verifyNoRelease=(x,salesComplete)=>{
    assert.ok(x,'expected a scoped escalated incident prerequisite');
    assert.equal(x.incident_status,'manual_escalated');
    assert.equal(x.sales_packet_complete,salesComplete);
    assert.equal(x.prerequisite_status,salesComplete
      ?'blocked_trusted_finance_identity_missing':'blocked_sales_packet_incomplete');
    for(const key of ['finance_principal_verified','finance_signed_receipt_verified',
      'finance_budget_decision_verified','academic_principal_verified',
      'academic_student_impact_reconciled','academic_signed_attestation_verified',
      'cross_module_evidence_reconciled','three_party_acceptance_verified',
      'compensation_history_verified','release_eligible','finance_authorized',
      'execution_allowed','activity_publish_allowed'])
      assert.equal(x[key],false,'untrusted acceptance or release field '+key);
    assert.equal(x.hold_active,true);
    for(const secret of ['organization_id','evidence_ref','reason_zh','request_key',
      'before_business_json','after_business_json','principal_id','signed_receipt_id'])
      assert.equal(Object.hasOwn(x,secret),false,'untrusted credential or history leaked: '+secret);
  };
  verifyNoRelease(prerequisites.data.items.find(x=>x.incident_id===incident2),false);
  // V3.2-65: server-side completeness is a scoped derived gate, never approval.
  let gateResponse=await evidenceGates(A);
  assert.equal(gateResponse.status,200,JSON.stringify(gateResponse));
  assert.equal(gateResponse.data.items.find(x=>x.incident_id===incident1),undefined,
   'a closed supporting-materials incident cannot enter escalated evidence gates');
  assert.equal((await evidenceGates(B)).status,401);
  let gate=gateResponse.data.items.find(x=>x.incident_id===incident2);
  assert.equal(gate.sales_packet_status,'blocked_missing_reporter_evidence');
  assert.equal(gate.sales_packet_complete,false);
  const requireHardHold=g=>{
    assert.equal(g.incident_status,'manual_escalated');
    assert.equal(g.finance_acceptance_verified,false);
    assert.equal(g.academic_acceptance_verified,false);
    assert.equal(g.cross_department_accepted,false);
    assert.equal(g.hold_active,true);
    assert.equal(g.finance_authorized,false);
    assert.equal(g.execution_allowed,false);
    for(const secret of ['evidence_ref','reason_zh','review_reason','request_key',
      'organization_id','report_reason','review_evidence_ref','after_business_json'])
      assert.equal(Object.hasOwn(g,secret),false,'evidence gate leaked '+secret);
  };
  requireHardHold(gate);
  // V3.2-64: only the reporter and actual independent sales reviewer may append.
  assert.equal((await appendFollowup(A,incident1)).status,403,
    'closed recheck may not be used for escalation follow-up');
  assert.equal((await followups(A)).status,200);
  assert.equal((await followups(A)).data.items.filter(x=>x.incident_id===incident2).length,0);
  assert.equal((await followups(B)).status,401);
  const addendumKey=key();
  const addendum=await appendFollowup(A,incident2,'sales_evidence_addendum',addendumKey);
  assert.equal(addendum.status,200,JSON.stringify(addendum));
  assert.equal(addendum.data.incident_status,'manual_escalated');
  assert.equal(addendum.data.responsibility_boundary,'sales_reporter');
  assert.equal(addendum.data.finance_authorized,false);
  assert.equal(addendum.data.execution_allowed,false);
  gateResponse=await evidenceGates(A);
  gate=gateResponse.data.items.find(x=>x.incident_id===incident2);
  assert.equal(gate.sales_packet_status,'blocked_missing_independent_sales_evidence');
  assert.equal(gate.reporter_evidence_present,true);
  assert.equal(gate.independent_sales_review_present,false);
  requireHardHold(gate);
  const original=addendum.data.followup_id;
  assert.equal((await appendFollowup(A,incident2,'sales_evidence_addendum',addendumKey)).data.followup_id,
    original,'idempotent replay must not append extra note or audit');
  assert.equal((await appendFollowup(A,incident2,'external_finance_requirements_pending',addendumKey)).status,409);
  const reviewerEvidence=await appendFollowup(M,incident2,'sales_evidence_addendum');
  assert.equal(reviewerEvidence.status,200,JSON.stringify(reviewerEvidence));
  assert.equal(reviewerEvidence.data.responsibility_boundary,'independent_sales_reviewer');
  gateResponse=await evidenceGates(M);
  gate=gateResponse.data.items.find(x=>x.incident_id===incident2);
  assert.equal(gate.sales_packet_status,'blocked_missing_finance_requirements_note');
  assert.equal(gate.reporter_evidence_present,true);
  assert.equal(gate.independent_sales_review_present,true);
  assert.equal(gate.finance_requirements_documented,false);
  requireHardHold(gate);
  const independent=await appendFollowup(M,incident2,'external_finance_requirements_pending');
  assert.equal(independent.status,200,JSON.stringify(independent));
  assert.equal(independent.data.responsibility_boundary,'independent_sales_reviewer');
  assert.equal(independent.data.finance_authorized,false);
  assert.equal(independent.data.execution_allowed,false);
  for(const who of [A,M]){
    const packet=await evidenceGates(who);
    assert.equal(packet.status,200,JSON.stringify(packet));
    const ready=packet.data.items.find(x=>x.incident_id===incident2);
    assert.equal(ready.sales_packet_status,'sales_packet_collected_external_acceptance_pending');
    assert.equal(ready.reporter_evidence_present,true);
    assert.equal(ready.independent_sales_review_present,true);
    assert.equal(ready.finance_requirements_documented,true);
    assert.equal(ready.sales_packet_complete,true);
    requireHardHold(ready);
  }
  for(const who of [A,M]){
    prerequisites=await acceptancePrerequisites(who);
    assert.equal(prerequisites.status,200,JSON.stringify(prerequisites));
    verifyNoRelease(prerequisites.data.items.find(x=>x.incident_id===incident2),true);
  }
  const unauthorizedRelease=await fetch(
    'http://127.0.0.1:'+app.address().port+
    '/api/v1/marketing-campaigns/finance-incidents/acceptance-prerequisites',{
      method:'POST',headers:{Authorization:'Bearer '+sign(A),
        'Content-Type':'application/json','Idempotency-Key':key()},
      body:JSON.stringify({finance_authorized:true,release_eligible:true,
        three_party_acceptance_verified:true})
    });
  assert.equal(unauthorizedRelease.status,404,
    'there is no writable fake cross-department approval endpoint');
  for(const pool of [aRead,bRead,mRead,aWrite,mWrite]){
    await assert.rejects(
      pool.query("UPDATE ms.scoped_isolated_campaign_cross_module_acceptance_prerequisites SET release_eligible=true WHERE FALSE"),
      e=>['42501','55000','0A000'].includes(e.code),
      'readonly derived acceptance view cannot be edited by any employee');
  }
  for(const who of [A,M]){
    const notes=await followups(who);
    assert.equal(notes.status,200,JSON.stringify(notes));
    const items=notes.data.items.filter(x=>x.incident_id===incident2);
    assert.equal(items.length,3,'three evidence notes from two distinct responsibility parties');
    assert.deepEqual(items.map(x=>x.responsibility_boundary).sort(),
      ['independent_sales_reviewer','independent_sales_reviewer','sales_reporter'].sort());
    for(const x of items){
      assert.equal(x.incident_status,'manual_escalated');
      assert.equal(x.external_authority_state,'awaiting_external_finance_authority');
      assert.equal(x.finance_authorized,false);
      assert.equal(x.execution_allowed,false);
      for(const secret of ['evidence_ref','reason_zh','request_key',
       'request_fingerprint','organization_id','after_business_json']){
        assert.equal(Object.hasOwn(x,secret),false,'follow-up view must hide '+secret);
      }
    }
  }
  let followupEvents=(await auditHistory(A)).data.items.filter(x=>x.incident_id===incident2);
  assert.equal(followupEvents.length,5,'each addendum creates one append-only audit event');
  assert.equal(followupEvents.filter(x=>
    x.event_name==='CAMPAIGN_FINANCE_ESCALATION_FOLLOWUP_RECORDED').length,3);
  assert.ok(followupEvents.every(x=>x.current_incident_status==='manual_escalated'&&
    x.finance_authorized===false&&x.execution_allowed===false));
  assert.equal((await handoffs(A)).data.items.find(x=>x.review_id===reviewId).readiness_status,
    'blocked_active_incident','evidence append does not release finance hold');
  const ownership=(await owner.query(
    "SELECT status FROM ms.isolated_campaign_finance_incidents WHERE id=$1",[incident2])).rows[0];
  assert.equal(ownership.status,'manual_escalated');
  for(const pool of [aRead,bRead,mRead,aWrite,mWrite]){
    await assert.rejects(pool.query('SELECT * FROM ms.isolated_campaign_finance_escalation_followups'),
      e=>e.code==='42501');
    await assert.rejects(pool.query("UPDATE ms.isolated_campaign_finance_escalation_followups SET note_type=note_type WHERE FALSE"),
      e=>e.code==='42501');
  }
  const eventNames=(await owner.query(
    "SELECT event_name FROM ms.audit_events WHERE target_type='marketing_campaign_finance_incident' AND target_id=ANY($1::uuid[])",
    [incidentIds])).rows.map(x=>x.event_name).sort();
  assert.deepEqual(eventNames,
   ['CAMPAIGN_FINANCE_HANDOFF_ISSUE_REPORTED','CAMPAIGN_FINANCE_HANDOFF_ISSUE_REPORTED',
    'CAMPAIGN_FINANCE_ISSUE_ESCALATED','CAMPAIGN_FINANCE_ISSUE_RECHECK_REQUESTED',
    'CAMPAIGN_FINANCE_ESCALATION_FOLLOWUP_RECORDED',
    'CAMPAIGN_FINANCE_ESCALATION_FOLLOWUP_RECORDED',
    'CAMPAIGN_FINANCE_ESCALATION_FOLLOWUP_RECORDED'].sort());
  for(const pool of [aRead,bRead,mRead,aWrite,mWrite]){
   await assert.rejects(pool.query('SELECT * FROM ms.isolated_campaign_finance_incidents'),
     e=>e.code==='42501');
  }
  assert.equal((await decideSales(M,reviewId,'approved',decisionKey)).data.status,
   'sales_approved_pending_finance');
  assert.equal((await decideSales(M,reviewId,'approved')).status,409);
  assert.equal((await submitSales(A,ownCampaign,2)).status,409);
  assert.equal((await revise(A,ownCampaign,{...newBody,expected_version:2,
   name:prefix+'-attempt-after-sales'})).status,409);
  const finalized=(await owner.query(
   'SELECT name,status,budget_cents,owner_user_id FROM ms.marketing_campaigns WHERE id=$1',
   [ownCampaign])).rows[0];
  assert.equal(finalized.status,'draft','sales approval never publishes a campaign');
  assert.equal(Number(finalized.budget_cents),99500,'sales approval never alters planned budget');
  assert.equal(finalized.owner_user_id,A);
  const salesEvents=await owner.query(
   "SELECT event_name FROM ms.audit_events WHERE target_type='marketing_campaign_sales_review' AND target_id=$1",
   [reviewId]);
  assert.deepEqual(salesEvents.rows.map(x=>x.event_name).sort(),
   ['CAMPAIGN_SALES_APPROVED_FINANCE_HOLD','CAMPAIGN_SALES_REVIEW_REQUESTED']);
  const forbiddenMoney=await owner.query(
   "SELECT count(*)::int AS n FROM ms.marketing_costs WHERE evidence_ref=$1",
   ['模拟活动方案索引']);
  assert.equal(forbiddenMoney.rows[0].n,0,'no marketing cost authorization or ledger entry');
  for(const pool of [aRead,bRead,mRead,aWrite,mWrite]){
   if([aRead,bRead,mRead].includes(pool)){
    await assert.rejects(pool.query('INSERT INTO ms.scoped_isolated_campaign_finance_handoffs(review_id) VALUES($1)',[reviewId]),
      e=>['42501','55000','0A000'].includes(e.code),'read-only view cannot be written');
   }
   await assert.rejects(pool.query('SELECT * FROM ms.isolated_campaign_sales_reviews'),
    e=>e.code==='42501');
   await assert.rejects(pool.query("UPDATE ms.marketing_campaigns SET status='active' WHERE FALSE"),
    e=>e.code==='42501');
  }
  assert.equal(broadCalls,0);
  assert.equal((await owner.query(
   'SELECT count(*)::int n FROM ms.marketing_costs WHERE cost_type=$1',
   [prefix])).rows[0].n,0);
  const events=await owner.query(
   "SELECT event_name FROM ms.audit_events WHERE target_type='marketing_campaign' AND target_id=ANY($1::uuid[])",
   [[ownCampaign,managerCampaign]]);
  assert.equal(events.rows.filter(x=>x.event_name==='CAMPAIGN_DRAFT_CREATED').length,2);
  for(const p of [aRead,bRead,mRead,aWrite,mWrite]){
   await assert.rejects(p.query('SELECT * FROM ms.marketing_campaigns'),e=>e.code==='42501');
   await assert.rejects(p.query('SELECT * FROM ms.campaign_channels'),e=>e.code==='42501');
   await assert.rejects(p.query('SELECT * FROM ms.marketing_costs'),e=>e.code==='42501');
   await assert.rejects(p.query('SELECT * FROM ms.cost_allocations'),e=>e.code==='42501');
  }
  for(const p of [aWrite,mWrite]){
   await assert.rejects(p.query("INSERT INTO ms.marketing_campaigns(organization_id,name,status) VALUES($1,$2,'active')",
    [ORG,prefix+'-unauthorized']),e=>e.code==='42501');
   await assert.rejects(p.query("UPDATE ms.marketing_campaigns SET status='active' WHERE id=$1",[ownCampaign]),e=>e.code==='42501');
  }
  await owner.query('UPDATE ms.staff_identity_bindings SET revoked_at=now() WHERE issuer=$1 AND subject=$2 AND revoked_at IS NULL',
   [issuer,subjects.get(A)]);
  assert.equal((await get(A)).status,403);
  assert.equal((await handoffs(A)).status,403);
  assert.equal((await post(A,payload(prefix+'-revoked'))).status,403);
  assert.equal((await auditHistory(A)).status,403,
    'revoked external signed identity cannot read prior incident audit');
  assert.equal((await followups(A)).status,403,
    'revoked signed identity cannot enumerate escalation follow-ups');
  assert.equal((await evidenceGates(A)).status,403,
    'revoked signed identity cannot enumerate evidence gates');
  assert.equal((await acceptancePrerequisites(A)).status,403,
    'revoked signed identity cannot claim cross-department acceptance');
  assert.equal(broadCalls,0);
 }finally{
  if(app?.listening)await new Promise(ok=>app.close(ok));
  if(incidentIds.length){
   await owner.query("DELETE FROM ms.audit_events WHERE target_type='marketing_campaign_finance_incident' AND target_id=ANY($1::uuid[])",[incidentIds]);
   await owner.query('DELETE FROM ms.isolated_campaign_finance_escalation_followups WHERE incident_id=ANY($1::uuid[])',[incidentIds]);
   await owner.query('DELETE FROM ms.isolated_campaign_finance_incidents WHERE id=ANY($1::uuid[])',[incidentIds]);
  }
  if(reviewId){
   await owner.query("DELETE FROM ms.audit_events WHERE target_type='marketing_campaign_sales_review' AND target_id=$1",[reviewId]);
   await owner.query('DELETE FROM ms.isolated_campaign_sales_reviews WHERE id=$1',[reviewId]);
  }
  for(const id of [ownCampaign,managerCampaign].filter(Boolean)){
   await owner.query("DELETE FROM ms.audit_events WHERE target_type='marketing_campaign' AND target_id=$1",[id]);
   await owner.query('DELETE FROM ms.isolated_campaign_draft_revision_receipts WHERE campaign_id=$1',[id]);
   await owner.query('DELETE FROM ms.isolated_campaign_draft_versions WHERE campaign_id=$1',[id]);
   await owner.query('DELETE FROM ms.isolated_campaign_draft_idempotency WHERE campaign_id=$1',[id]);
   await owner.query('DELETE FROM ms.campaign_channels WHERE campaign_id=$1',[id]);
   await owner.query('DELETE FROM ms.marketing_campaigns WHERE id=$1',[id]);
  }
  for(const id of [channels.inactiveChild,channels.parent,channels.ok,channels.foreign]){
   await owner.query('DELETE FROM ms.marketing_channels WHERE id=$1',[id]);
  }
  await Promise.allSettled([owner,dir,aRead,bRead,mRead,aWrite,mWrite].map(p=>p.end()));
 }
});
