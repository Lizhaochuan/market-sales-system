import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import pg from 'pg';
import {createApp} from '../../src/app.mjs';
import {buildIsolatedChannelCatalog} from '../../src/marketing-channel-catalog.mjs';
const secret='fictional-test-only-strong-token-secret-9c92789dc3b9';
const issuer='market-sales-test-issuer';
const jwt=(staff,org)=>{
 const now=Math.floor(Date.now()/1000);
 const head=Buffer.from(JSON.stringify({typ:'JWT',alg:'HS256'})).toString('base64url');
 const payload=Buffer.from(JSON.stringify({iss:issuer,aud:'market-sales-isolated',
  sub:staff,org_id:org,iat:now,exp:now+900})).toString('base64url');
 return head+'.'+payload+'.'+createHmac('sha256',secret).update(head+'.'+payload).digest('base64url');
};
function ch(id,org,parent=null,status='active',name='虚构渠道',type='web'){
 return {id,organization_id:org,parent_id:parent,name,channel_type:type,status};
}
test('M01 catalog rejects tenant mixing, cycles, broken ancestry and malformed data',()=>{
 const a=randomUUID(),b=randomUUID(),root=randomUUID(),child=randomUUID();
 const ownInactive=randomUUID();
 const tree=buildIsolatedChannelCatalog([
  ch(child,a,root,'active','父渠道停用的子渠道'),
  ch(ownInactive,a,null,'inactive','直接停用的渠道'),
  ch(root,a,null,'inactive','主渠道')
 ],a);
 assert.equal(tree.count,3);assert.equal(tree.root_count,2);
 assert.equal(tree.effective_active_count,0);
 assert.equal(tree.channels.find(x=>x.channel_id===child).effective_status,'inactive_inherited');
 assert.equal(tree.channels.find(x=>x.channel_id===ownInactive).effective_status,'inactive');
 assert.equal(tree.channels.find(x=>x.channel_id===child).depth,1);
 assert.equal(tree.production_integration_allowed,false);
 assert.equal(tree.cross_student_family_inference_allowed,false);
 assert.ok(Object.isFrozen(tree.channels));
 for(const invalid of [
  [ch(root,a),ch(child,b,root)],
  [ch(root,a,child),ch(child,a,root)],
  [ch(child,a,randomUUID())],
  [ch(root,a),ch(root,a)],
  [ch(root,a,null,'approved')],
  [ch(root,a,null,'active',' ')],
  [ch(root,a,root)]
 ])assert.throws(()=>buildIsolatedChannelCatalog(invalid,a),TypeError);
 assert.throws(()=>buildIsolatedChannelCatalog([], 'wrong-org'),TypeError);
 assert.throws(()=>buildIsolatedChannelCatalog(
  Array.from({length:201},()=>ch(randomUUID(),a)),a),TypeError);
 const empty=buildIsolatedChannelCatalog([],a);
 assert.equal(empty.count,0);assert.equal(empty.effective_active_count,0);
});
test('M01 isolated PostgreSQL HTTP catalog returns only verified own-institution channels',async()=>{
 process.env.MS_STAGE='isolated-test';
 const db=new pg.Pool({connectionString:process.env.DATABASE_URL,max:4});
 const orgA=randomUUID(),orgB=randomUUID(),staffA=randomUUID(),staffB=randomUUID();
 const channelRoot=randomUUID(),channelChild=randomUUID(),channelB=randomUUID();
 let server;
 try{
  await db.query('INSERT INTO ms.organizations(id,name) VALUES($1,$2),($3,$4)',
   [orgA,'虚构 M01 校区甲',orgB,'虚构 M01 校区乙']);
  await db.query('INSERT INTO ms.staff_users(id,organization_id,display_name) VALUES($1,$2,$3),($4,$5,$6)',
   [staffA,orgA,'虚构渠道查看员工A',staffB,orgB,'虚构渠道查看员工B']);
  for(const item of [
   ch(channelRoot,orgA,null,'active','本机构主渠道','online'),
   ch(channelChild,orgA,channelRoot,'inactive','已停用子渠道','referral'),
   ch(channelB,orgB,null,'active','另一机构渠道','online')
  ])await db.query(
   'INSERT INTO ms.marketing_channels(id,organization_id,parent_id,name,channel_type,status) '+
   'VALUES($1,$2,$3,$4,$5,$6)',
   [item.id,item.organization_id,item.parent_id,item.name,item.channel_type,item.status]);
  server=createApp(db,{secret,issuer});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const get=async(token)=>{
   const response=await fetch(base+'/api/v1/marketing-channels',{
    headers:token?{Authorization:'Bearer '+token}:{}
   });
   return {status:response.status,body:await response.json()};
  };
  const missing=await get();
  assert.equal(missing.status,401);
  const wrongOrg=await get(jwt(staffA,orgB));
  assert.equal(wrongOrg.status,403);
  const own=await get(jwt(staffA,orgA));
  assert.equal(own.status,200);
  assert.equal(own.body.data.schema_version,'m01-isolated-channel-catalog-v1');
  assert.equal(own.body.data.count,2);
  assert.deepEqual(new Set(own.body.data.channels.map(x=>x.channel_id)),
   new Set([channelRoot,channelChild]));
  assert.doesNotMatch(JSON.stringify(own.body),new RegExp(channelB,'i'));
  assert.equal(own.body.data.effective_active_count,1);
  const other=await get(jwt(staffB,orgB));
  assert.equal(other.status,200);
  assert.equal(other.body.data.count,1);
  assert.equal(other.body.data.channels[0].channel_id,channelB);
  assert.doesNotMatch(JSON.stringify(other.body),new RegExp(channelRoot,'i'));
  // The legacy DB schema permits cross-org parent FK. Fail closed rather
  // than presenting an incomplete or seemingly authorized channel tree.
  await db.query('UPDATE ms.marketing_channels SET parent_id=$1 WHERE id=$2',
   [channelB,channelChild]);
  const invalidParent=await get(jwt(staffA,orgA));
  assert.equal(invalidParent.status,500);
  assert.equal(invalidParent.body.code,'INTERNAL_ERROR');
  assert.doesNotMatch(JSON.stringify(invalidParent.body),new RegExp(channelB,'i'));
  await db.query('UPDATE ms.marketing_channels SET parent_id=$1 WHERE id=$2',
   [channelRoot,channelChild]);
  // A same-tenant cycle also fails closed, without exposing the source rows.
  await db.query('UPDATE ms.marketing_channels SET parent_id=$1 WHERE id=$2',
   [channelChild,channelRoot]);
  const cycle=await get(jwt(staffA,orgA));
  assert.equal(cycle.status,500);
  assert.equal(cycle.body.code,'INTERNAL_ERROR');
  assert.equal(cycle.body.data,undefined);
 }finally{
  if(server)await new Promise(resolve=>server.close(resolve));
  await db.end();
 }
});
