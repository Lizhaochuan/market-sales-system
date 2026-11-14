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
const issuer='https://fictional-m01-channel-maintenance.example.invalid';
const audience='fictional-m01-maintenance';

test('V3.2-54: strict employee requests and separate manager reviews create, edit and deactivate only fictional channels',async()=>{
 process.env.MS_STAGE='isolated-test';
 const owner=new pg.Pool({connectionString:process.env.DATABASE_URL,max:5});
 const dir=new pg.Pool({connectionString:process.env.DATABASE_URL_AUTH_DIRECTORY,max:3});
 const readers=new Map([
  [A,new pg.Pool({connectionString:process.env.DATABASE_URL_ASSIGNEE_A,max:2})],
  [B,new pg.Pool({connectionString:process.env.DATABASE_URL_ASSIGNEE_B,max:2})],
  [M,new pg.Pool({connectionString:process.env.DATABASE_URL_ASSIGNEE_MANAGER,max:2})],
  [M2,new pg.Pool({connectionString:process.env.DATABASE_URL_ASSIGNEE_MANAGER_2,max:2})]
 ]);
 const writers=new Map([
  [A,new pg.Pool({connectionString:process.env.DATABASE_URL_WRITE_A,max:2})],
  [B,new pg.Pool({connectionString:process.env.DATABASE_URL_WRITE_B,max:2})],
  [M,new pg.Pool({connectionString:process.env.DATABASE_URL_WRITE_MANAGER,max:2})],
  [M2,new pg.Pool({connectionString:process.env.DATABASE_URL_WRITE_MANAGER_2,max:2})]
 ]);
 const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
 const jwk={...publicKey.export({format:'jwk'}),kid:'m01-write-'+randomUUID(),alg:'RS256',use:'sig'};
 const ext={issuer,audience,jwks:{keys:[jwk]}};
 const subjects=new Map([[A,'m01-a-'+randomUUID()],[B,'m01-b-'+randomUUID()],
  [M,'m01-m-'+randomUUID()],[M2,'m01-m2-'+randomUUID()]]);
 const token=staff=>{
  const now=Math.floor(Date.now()/1000);
  const h=Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT',kid:jwk.kid})).toString('base64url');
  const p=Buffer.from(JSON.stringify({iss:issuer,sub:subjects.get(staff),
   aud:audience,iat:now,exp:now+900,org_id:OTHER,role:'super_admin',staff_id:B})).toString('base64url');
  return h+'.'+p+'.'+createSign('RSA-SHA256').update(h+'.'+p)
   .sign(privateKey).toString('base64url');
 };
 const key=()=>('m01_'+randomUUID().replaceAll('-',''));
 const base=name=>({action:'create',name,channel_type:'referral',
  parent_id:null,evidence_ref:'虚构渠道材料编号',
  reason_zh:'申请维护本机构虚构获客渠道'});
 let app,broadCalls=0;
 const request=async(staff,path,body,idempotencyKey=key())=>{
  const response=await fetch('http://127.0.0.1:'+app.address().port+path,{
   method:'POST',headers:{Authorization:'Bearer '+token(staff),
    'Content-Type':'application/json','Idempotency-Key':idempotencyKey},
   body:JSON.stringify(body)});
  return {status:response.status,...await response.json()};
 };
 const get=async(staff)=>{
  const response=await fetch('http://127.0.0.1:'+app.address().port+
   '/api/v1/marketing-channels',{headers:{Authorization:'Bearer '+token(staff)}});
  return {status:response.status,...await response.json()};
 };
 const approveIdentity=async(staff,requester,reviewer)=>{
  const q=await owner.query(
   "INSERT INTO ms.identity_change_requests(organization_id,action,target_staff_id,"+
   "issuer,subject,requested_by,request_evidence_ref,request_reason_zh) "+
   "VALUES($1,'bind',$2,$3,$4,$5,'虚构身份材料','独立员工核实') RETURNING id",
   [ORG,staff,issuer,subjects.get(staff),requester]);
  await owner.query(
   "INSERT INTO ms.identity_change_decisions(request_id,reviewer_user_id,decision,"+
   "review_evidence_ref,reason_zh) VALUES($1,$2,'approved','独立主管材料','仅模拟身份')",
   [q.rows[0].id,reviewer]);
  await owner.query(
   "UPDATE ms.identity_change_requests SET status='approved',decided_by=$2,"+
   "decided_at=now() WHERE id=$1",[q.rows[0].id,reviewer]);
  await owner.query("INSERT INTO ms.staff_identity_bindings(staff_user_id,issuer,subject,"+
   "bound_by,approval_request_id) VALUES($1,$2,$3,$4,$5)",
   [staff,issuer,subjects.get(staff),reviewer,q.rows[0].id]);
 };
 const proposal='/api/v1/marketing-channels/change-requests';
 const review=id=>proposal+'/'+id+'/decision';
 const reviewBody=(decision='approved')=>({
  decision,evidence_ref:'独立审批凭据',
  reason_zh:'已复核虚构渠道申请和当前机构状态'});
 const prefix='隔离渠道申请-'+randomUUID();
 try{
  await approveIdentity(A,M,M2);
  await approveIdentity(B,M,M2);
  await approveIdentity(M,A,M2);
  await approveIdentity(M2,A,M);
  const foreign=await owner.query(
   'INSERT INTO ms.marketing_channels(organization_id,name,status) VALUES($1,$2,$3) RETURNING id',
   [OTHER,prefix+'-另一机构','active']);
  app=createApp({connect(){broadCalls++;throw Error('broad DB fallback forbidden');}},
   {secret:'fictional-test-only-strong-token-secret-9c92789dc3b9',
    externalIdentity:ext,strictStaffMode:true,identityDirectoryPool:dir,
    scopedReadPools:readers,scopedWritePools:writers});
  await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));

  const requested=base(prefix+'-新增');
  const requestKey=key();
  const pending=await request(A,proposal,requested,requestKey);
  assert.equal(pending.status,200);
  assert.equal(pending.data.status,'pending');
  assert.equal(pending.data.action,'create');
  const again=await request(A,proposal,requested,requestKey);
  assert.equal(again.status,200);
  assert.equal(again.data.request_id,pending.data.request_id);
  assert.equal((await request(A,proposal,{...requested,name:prefix+'-冲突'},requestKey)).status,409);
  assert.equal((await owner.query(
   'SELECT count(*)::int AS n FROM ms.marketing_channels WHERE name=$1',
   [requested.name])).rows[0].n,0,'pending request must not create a channel');
  assert.equal((await request(A,review(pending.data.request_id),reviewBody())).status,403,
   'ordinary employee cannot approve');
  const wrong=await request(M,review(pending.data.request_id),
   reviewBody('approved'),key());
  assert.equal(wrong.status,200,wrong.code);
  assert.equal(wrong.data.status,'applied');
  const channel=wrong.data.channel_id;
  assert.ok(channel);
  const ownList=await get(A);
  assert.equal(ownList.status,200);
  assert.ok(ownList.data.channels.some(x=>x.channel_id===channel));
  assert.ok(!ownList.data.channels.some(x=>x.channel_id===foreign.rows[0].id));
  const persisted=await owner.query(
   'SELECT name,status,organization_id FROM ms.marketing_channels WHERE id=$1',[channel]);
  assert.equal(persisted.rows[0].name,requested.name);
  assert.equal(persisted.rows[0].status,'active');
  assert.equal(persisted.rows[0].organization_id,ORG);

  // Rejection does not change the channel tree.
  const rejected=await request(B,proposal,base(prefix+'-驳回'));
  assert.equal(rejected.status,200);
  const decision=await request(M,review(rejected.data.request_id),reviewBody('rejected'));
  assert.equal(decision.status,200);
  assert.equal(decision.data.status,'rejected');
  assert.equal((await owner.query(
   'SELECT count(*)::int AS n FROM ms.marketing_channels WHERE name=$1',
   [prefix+'-驳回'])).rows[0].n,0);

  // Managers cannot approve their own requests, even if JWT claims say admin.
  const managerOwn=await request(M,proposal,base(prefix+'-主管申请'));
  assert.equal(managerOwn.status,200);
  assert.equal((await request(M,review(managerOwn.data.request_id),reviewBody())).status,403);
  const secondReviewer=await request(M2,review(managerOwn.data.request_id),reviewBody());
  assert.equal(secondReviewer.status,200);
  assert.equal(secondReviewer.data.status,'applied');

  // Reject cross-org parent, cross-org target, and self-parent before approval.
  assert.equal((await request(A,proposal,{
   ...base(prefix+'-错误上级'),parent_id:foreign.rows[0].id})).status,422);
  assert.equal((await request(A,proposal,{
   action:'edit',channel_id:foreign.rows[0].id,name:prefix+'-越权',
   parent_id:null,channel_type:'online',evidence_ref:'虚构材料编号',
   reason_zh:'应拒绝跨机构修改'})).status,422);
  assert.equal((await request(A,proposal,{
   action:'edit',channel_id:channel,name:prefix+'-自环',
   parent_id:channel,channel_type:'web',evidence_ref:'虚构材料编号',
   reason_zh:'不允许自环'})).status,422);

  // A stale edit may not overwrite a previously reviewed change.
  const editParams={action:'edit',channel_id:channel,name:prefix+'-改名',
   parent_id:null,channel_type:'web',evidence_ref:'虚构材料编号',
   reason_zh:'修正渠道名称'};
  const edit=await request(A,proposal,editParams);
  assert.equal(edit.status,200);
  const oldEdit=await request(B,proposal,{...editParams,name:prefix+'-旧快照'});
  assert.equal(oldEdit.status,200);
  const appliedEdit=await request(M,review(edit.data.request_id),reviewBody());
  assert.equal(appliedEdit.status,200);
  assert.equal(appliedEdit.data.status,'applied');
  const stale=await request(M,review(oldEdit.data.request_id),reviewBody());
  assert.equal(stale.status,422,'stale snapshot must be rejected');

  // Deactivation requires separate review; originals and audit remain intact.
  const deact=await request(B,proposal,{
   action:'deactivate',channel_id:channel,evidence_ref:'虚构停用材料',
   reason_zh:'停用不再运营的渠道'});
  assert.equal(deact.status,200);
  assert.equal((await owner.query('SELECT status FROM ms.marketing_channels WHERE id=$1',
   [channel])).rows[0].status,'active');
  const off=await request(M,review(deact.data.request_id),reviewBody());
  assert.equal(off.status,200);
  assert.equal(off.data.status,'applied');
  assert.equal((await owner.query('SELECT status FROM ms.marketing_channels WHERE id=$1',
   [channel])).rows[0].status,'inactive');
  const repeatReview=await request(M,review(deact.data.request_id),reviewBody(),'m01_repeat_different_key_78911');
  assert.equal(repeatReview.status,409,'separate review cannot re-apply');
  const records=await owner.query("SELECT event_name,actor_user_id FROM ms.audit_events "+
   "WHERE target_id=ANY($1::uuid[]) AND target_type='marketing_channel_request'",
   [[pending.data.request_id,edit.data.request_id,deact.data.request_id,
     rejected.data.request_id,managerOwn.data.request_id]]);
  assert.ok(records.rows.filter(x=>x.event_name==='CHANNEL_CHANGE_REQUESTED').length>=5);
  assert.ok(records.rows.filter(x=>x.event_name==='CHANNEL_CHANGE_APPLIED').length>=4);
  assert.ok(records.rows.some(x=>x.event_name==='CHANNEL_CHANGE_REJECTED'));
  assert.equal((await owner.query(
   'SELECT count(*)::int AS n FROM ms.isolated_channel_change_requests WHERE status=$1 AND organization_id=$2',
   ['pending',ORG])).rows[0].n>=1,true,'stale request stays pending for manual re-evaluation');

  // A revoked employee binding immediately prevents later requests.
  await owner.query('UPDATE ms.staff_identity_bindings SET revoked_at=now() '+
   'WHERE issuer=$1 AND subject=$2 AND revoked_at IS NULL',[issuer,subjects.get(A)]);
  assert.equal((await request(A,proposal,base(prefix+'-撤销后'))).status,403);
  assert.equal(broadCalls,0);
  for(const pool of [...writers.values()]){
   await assert.rejects(pool.query('SELECT * FROM ms.marketing_channels'),e=>e.code==='42501');
   await assert.rejects(pool.query('SELECT * FROM ms.isolated_channel_change_requests'),e=>e.code==='42501');
   await assert.rejects(pool.query('SELECT * FROM ms.sales_orders'),e=>e.code==='42501');
   await assert.rejects(pool.query('UPDATE ms.marketing_channels SET status=$1 WHERE FALSE',
    ['active']),e=>e.code==='42501');
  }
 }finally{
  if(app?.listening)await new Promise(ok=>app.close(ok));
  await Promise.allSettled([owner,dir,...readers.values(),...writers.values()]
   .map(p=>p.end()));
 }
});
