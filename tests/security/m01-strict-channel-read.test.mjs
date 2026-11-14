import test from 'node:test';
import assert from 'node:assert/strict';
import {createSign,generateKeyPairSync,randomUUID} from 'node:crypto';
import pg from 'pg';
import {createApp} from '../../src/app.mjs';

const org='20000000-0000-4000-8000-000000000001';
const foreignOrg='20000000-0000-4000-8000-000000000002';
const staffA='20000000-0000-4000-8000-000000000011';
const staffB='20000000-0000-4000-8000-000000000012';
const mgr='20000000-0000-4000-8000-000000000013';
const mgr2='20000000-0000-4000-8000-000000000014';
const issuer='https://fictional-m01-strict-channel.example.invalid';
const audience='m01-strict-channel-isolated';
const secret='fictional-test-only-strong-token-secret-9c92789dc3b9';

test('V3.2-53 strict employee JWT and nonowner PostgreSQL view enforce institutional M01 channels',async()=>{
 process.env.MS_STAGE='isolated-test';
 const admin=new pg.Pool({connectionString:process.env.DATABASE_URL,max:4});
 const directory=new pg.Pool({connectionString:process.env.DATABASE_URL_AUTH_DIRECTORY,max:2});
 const a=new pg.Pool({connectionString:process.env.DATABASE_URL_ASSIGNEE_A,max:2});
 const b=new pg.Pool({connectionString:process.env.DATABASE_URL_ASSIGNEE_B,max:2});
 const channelA=randomUUID(),childA=randomUUID(),channelForeign=randomUUID();
 const subjectA='m01-strict-a-'+randomUUID(),subjectB='m01-strict-b-'+randomUUID();
 const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
 const jwk={...publicKey.export({format:'jwk'}),kid:'m01-strict-'+randomUUID(),alg:'RS256',use:'sig'};
 const externalIdentity={issuer,audience,jwks:{keys:[jwk]}};
 const sign=(sub,extra={})=>{
  const now=Math.floor(Date.now()/1000);
  const h=Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT',kid:jwk.kid})).toString('base64url');
  const p=Buffer.from(JSON.stringify({iss:issuer,sub,aud:audience,
   iat:now,exp:now+900,...extra})).toString('base64url');
  return h+'.'+p+'.'+createSign('RSA-SHA256').update(h+'.'+p)
   .sign(privateKey).toString('base64url');
 };
 const signedA=sign(subjectA,{org_id:foreignOrg,role:'super_admin',staff_id:staffB});
 const signedB=sign(subjectB,{org_id:foreignOrg,role:'super_admin',staff_id:staffA});
 let broadCalls=0,app;
 const pools=new Map([[staffA,a],[staffB,b]]);
 const send=async(token)=>{
  const res=await fetch('http://127.0.0.1:'+app.address().port+
   '/api/v1/marketing-channels',{headers:token?{Authorization:'Bearer '+token}:{}});
  return {status:res.status,...await res.json()};
 };
 const approve=async(staff,sub)=>{
  const q=await admin.query(
   "INSERT INTO ms.identity_change_requests(organization_id,action,target_staff_id,"+
   "issuer,subject,requested_by,request_evidence_ref,request_reason_zh) "+
   "VALUES($1,'bind',$2,$3,$4,$5,'虚构员工身份核验','本机隔离审查') RETURNING id",
   [org,staff,issuer,sub,mgr]);
  await admin.query("INSERT INTO ms.identity_change_decisions(request_id,reviewer_user_id,"+
   "decision,review_evidence_ref,reason_zh) VALUES($1,$2,'approved','独立核查','仅虚构身份')",
   [q.rows[0].id,mgr2]);
  await admin.query("UPDATE ms.identity_change_requests SET status='approved',"+
   "decided_by=$2,decided_at=now() WHERE id=$1",[q.rows[0].id,mgr2]);
  await admin.query("INSERT INTO ms.staff_identity_bindings(staff_user_id,issuer,"+
   "subject,bound_by,approval_request_id) VALUES($1,$2,$3,$4,$5)",
   [staff,issuer,sub,mgr2,q.rows[0].id]);
 };
 try{
  await admin.query(
   'INSERT INTO ms.marketing_channels(id,organization_id,parent_id,name,channel_type,status) VALUES'+
   '($1,$2,NULL,$3,$4,$5),($6,$2,$1,$7,$4,$5),($8,$9,NULL,$10,$4,$5)',
   [channelA,org,'员工受限渠道甲','web','active',childA,'员工受限子渠道',channelForeign,
    foreignOrg,'另一机构不可见渠道']);
  assert.equal((await a.query('SELECT count(*)::int AS n FROM ms.scoped_marketing_channel_catalog')).rows[0].n>=2,true);
  assert.equal((await b.query('SELECT count(*)::int AS n FROM ms.scoped_marketing_channel_catalog')).rows[0].n>=2,true);
  for(const p of [a,b]){
   const restricted=await p.query('SELECT id FROM ms.scoped_marketing_channel_catalog WHERE id=$1',[channelForeign]);
   assert.equal(restricted.rowCount,0,'no other-organization channels via staff LOGIN');
   await assert.rejects(p.query('SELECT * FROM ms.marketing_channels'),e=>e.code==='42501');
   await assert.rejects(p.query("UPDATE ms.marketing_channels SET status='active' WHERE FALSE"),e=>e.code==='42501');
   await assert.rejects(p.query('SELECT * FROM ms.sales_orders'),e=>e.code==='42501');
   await assert.rejects(p.query('SELECT * FROM ms.payment_allocations'),e=>e.code==='42501');
  }
  app=createApp({connect(){broadCalls++;throw Error('broad tenant DB must never be used');}},
   {secret,externalIdentity,strictStaffMode:true,identityDirectoryPool:directory,
    scopedReadPools:pools,scopedWritePools:new Map()});
  await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
  assert.equal((await send()).status,403,'strict mode requires external signed identity');
  assert.equal((await send(signedA)).status,403,'unapproved identity cannot see a channel');
  await approve(staffA,subjectA);await approve(staffB,subjectB);
  const home=await send(signedA);
  assert.equal(home.status,200,home.code);
  assert.equal(home.data.schema_version,'m01-isolated-channel-catalog-v1');
  assert.equal(home.data.production_integration_allowed,false);
  assert.ok(home.data.channels.some(x=>x.channel_id===channelA));
  assert.ok(home.data.channels.some(x=>x.channel_id===childA));
  assert.ok(!home.data.channels.some(x=>x.channel_id===channelForeign));
  assert.doesNotMatch(JSON.stringify(home),/另一机构不可见渠道/);
  const colleague=await send(signedB);
  assert.equal(colleague.status,200);
  assert.ok(colleague.data.channels.some(x=>x.channel_id===channelA),
   'organization public channels visible to independently authenticated staff');
  assert.ok(!colleague.data.channels.some(x=>x.channel_id===channelForeign));
  assert.equal(broadCalls,0);
  pools.set(staffA,b);
  try{assert.equal((await send(signedA)).status,403,'mismatched per-employee DB LOGIN');}
  finally{pools.set(staffA,a);}
  pools.delete(staffA);
  try{assert.equal((await send(signedA)).status,403,'missing employee pool cannot fallback');}
  finally{pools.set(staffA,a);}
  assert.equal((await send(signedB)).status,200);
  // Misconfigured foreign-parent reference is forbidden by the catalog builder,
  // even if a raw DB FK permits it. Never return partial tenant data.
  await admin.query('UPDATE ms.marketing_channels SET parent_id=$1 WHERE id=$2',
   [channelForeign,childA]);
  const corrupted=await send(signedA);
  assert.equal(corrupted.status,500);
  assert.equal(corrupted.code,'INTERNAL_ERROR');
  assert.equal(corrupted.data,undefined);
  assert.doesNotMatch(JSON.stringify(corrupted),/另一机构不可见渠道/);
  await admin.query('UPDATE ms.marketing_channels SET parent_id=$1 WHERE id=$2',[channelA,childA]);
  await admin.query('UPDATE ms.staff_identity_bindings SET revoked_at=now() WHERE issuer=$1 AND subject=$2 AND revoked_at IS NULL',
   [issuer,subjectA]);
  assert.equal((await send(signedA)).status,403,'revoked staff binding must block all channel results');
  assert.equal((await send(signedB)).status,200);
  assert.equal(broadCalls,0);
 }finally{
  if(app?.listening)await new Promise(resolve=>app.close(resolve));
  await Promise.allSettled([admin,directory,a,b].map(p=>p.end()));
 }
});
