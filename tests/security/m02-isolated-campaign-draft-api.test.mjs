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
      e=>e.code==='42501','read-only view cannot be written');
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
  assert.equal(broadCalls,0);
 }finally{
  if(app?.listening)await new Promise(ok=>app.close(ok));
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
