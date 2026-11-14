import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createSign,randomUUID} from 'node:crypto';
import pg from 'pg';
import {assertUatPreviewPool,createUatPreviewApi} from '../../src/uat-preview-api.mjs';

const issuer='https://fictional-uat-preview.example.invalid';
const audience='isolated-uat-preview';
const financeA='30000000-0000-4000-8000-000000000015';
const manager='20000000-0000-4000-8000-000000000014';
const requester='20000000-0000-4000-8000-000000000011';
const orgA='20000000-0000-4000-8000-000000000001';
const idKey=()=>randomUUID().replaceAll('-','');
const open=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const close=server=>new Promise(resolve=>server.close(resolve));
const q=(pool,s,a)=>(pool.query(s,a)).then(r=>r.rows[0]);

test('V3.2-33 real DB LOGIN, signed identity and server-validated UAT export',async t=>{
 process.env.MS_STAGE='isolated-test';
 const owner=new pg.Pool({connectionString:process.env.DATABASE_URL,max:3});
 const A=new pg.Pool({connectionString:process.env.DATABASE_URL_UAT_PREVIEW_A,max:2});
 const B=new pg.Pool({connectionString:process.env.DATABASE_URL_UAT_PREVIEW_B,max:2});
 const fin=new pg.Pool({connectionString:process.env.DATABASE_URL_PLAN_FINANCE,max:2});
 const finB=new pg.Pool({connectionString:process.env.DATABASE_URL_PLAN_B,max:2});
 const keys=generateKeyPairSync('rsa',{modulusLength:2048});
 const jwk={...keys.publicKey.export({format:'jwk'}),kid:'uat-isolated-2026',alg:'RS256',use:'sig'};
 const externalIdentity={issuer,audience,jwks:{keys:[jwk]}};
 const subject='uat-preview-'+randomUUID();
 const jwt=(sub=subject,otherClaims={})=>{
  const now=Math.floor(Date.now()/1000);
  const h=Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT',kid:jwk.kid})).toString('base64url');
  const p=Buffer.from(JSON.stringify({iss:issuer,sub,aud:audience,iat:now,exp:now+900,
   org_id:'malicious-claimed-org',role:'superadmin',...otherClaims})).toString('base64url');
  return h+'.'+p+'.'+createSign('RSA-SHA256').update(h+'.'+p)
   .sign(keys.privateKey).toString('base64url');
 };
 let server;
 try{
  await t.test('dedicated login has read-only access and no raw business or write privilege',async()=>{
   await assertUatPreviewPool(A);
   await assertUatPreviewPool(B);
   for(const pool of [A,B]){
    for(const tb of ['ms.integration_missing_evidence_events',
      'ms.source_readiness_requests','ms.sales_orders',
      'ms.payment_allocations','ms.crm_entitlement_links']){
     await assert.rejects(pool.query('SELECT * FROM '+tb),{code:'42501'});
     await assert.rejects(pool.query('UPDATE '+tb+' SET id=id WHERE FALSE'),{code:'42501'});
    }
    await assert.rejects(pool.query(
     'SELECT ms.record_integration_missing_evidence($1,$2,$3,$4,$5,$6)',
     [null,'finance_authority_owner','owner_not_confirmed','虚构证据','安全阻断测试',idKey()]),
     {code:'42501'});
   }
  });
  const sourceA=(await q(fin,
   'SELECT ms.propose_fixture_source_readiness($1,$2,$3,$4,$5,$6) AS id',
   ['finance','fictional_uat_ui_a','fictional_org_a',
    '虚构来源 UAT 只读页面检查','虚构文件引用 A',idKey()])).id;
  const sourceB=(await q(finB,
   'SELECT ms.propose_fixture_source_readiness($1,$2,$3,$4,$5,$6) AS id',
   ['finance','fictional_uat_ui_b','fictional_org_b',
    '虚构来源 UAT 双机构隔离','虚构文件引用 B',idKey()])).id;
  await t.test('A sees only A; B sees only B, including direct report calls',async()=>{
   const a=(await A.query('SELECT source_request_id FROM ms.scoped_uat_preview_choices')).rows;
   const b=(await B.query('SELECT source_request_id FROM ms.scoped_uat_preview_choices')).rows;
   assert.ok(a.some(x=>x.source_request_id===sourceA));
   assert.ok(b.some(x=>x.source_request_id===sourceB));
   assert.ok(!a.some(x=>x.source_request_id===sourceB));
   assert.ok(!b.some(x=>x.source_request_id===sourceA));
   await assert.rejects(A.query('SELECT ms.readonly_integration_uat_report($1)',[sourceB]),
    {code:'42501'});
   await assert.rejects(B.query('SELECT ms.readonly_integration_uat_report($1)',[sourceA]),
    {code:'42501'});
  });
  // Simulate two independent, owner-only setup approvals of a fictional token.
  const approval=await q(owner,
   "INSERT INTO ms.identity_change_requests(organization_id,action,target_staff_id,"+
   "issuer,subject,requested_by,request_evidence_ref,request_reason_zh) "+
   "VALUES($1,'bind',$2,$3,$4,$5,'虚构 UAT 员工申请','独立核验测试员工') RETURNING id",
   [orgA,financeA,issuer,subject,requester]);
  await owner.query(
   "INSERT INTO ms.identity_change_decisions(request_id,reviewer_user_id,decision,"+
   "review_evidence_ref,reason_zh) VALUES($1,$2,'approved','虚构独立员工审核','UAT 页面测试独立身份')",
   [approval.id,manager]);
  await owner.query(
   "UPDATE ms.identity_change_requests SET status='approved',decided_by=$2,decided_at=now() WHERE id=$1",
   [approval.id,manager]);
  await owner.query(
   'INSERT INTO ms.staff_identity_bindings(staff_user_id,issuer,subject,bound_by,approval_request_id) '+
   'VALUES($1,$2,$3,$4,$5)',
   [financeA,issuer,subject,manager,approval.id]);
  server=createUatPreviewApi(A,{externalIdentity});
  await open(server);
  const base='http://127.0.0.1:'+server.address().port;
  const get=(path,token)=>fetch(base+path,{
   headers:token?{Authorization:'Bearer '+token}:{}
  });
  await t.test('no bearer, wrong signature and wrong approved user denied',async()=>{
   const missing=await get('/api/v1/uat-preview/requests');
   assert.equal(missing.status,401);
   const unbound=await get('/api/v1/uat-preview/requests',jwt('unknown-'+randomUUID()));
   assert.equal(unbound.status,403);
   const fake=await get('/api/v1/uat-preview/requests',jwt().slice(0,-6)+'ABCDEF');
   assert.equal(fake.status,401);
   const write=await fetch(base+'/api/v1/uat-preview/reports/'+sourceA,{method:'POST',
    headers:{Authorization:'Bearer '+jwt()}});
   assert.equal(write.status,405);
   const qs=await get('/api/v1/uat-preview/requests?token=secret',jwt());
   assert.equal(qs.status,404);
  });
  await t.test('authorized list/detail/export return only blocked and safe results',async()=>{
   const list=await get('/api/v1/uat-preview/requests',jwt());
   assert.equal(list.status,200);
   assert.equal(list.headers.get('cache-control'),'no-store, max-age=0');
   const payload=(await list.json()).data.items;
   assert.ok(payload.some(x=>x.request_id===sourceA));
   assert.ok(!payload.some(x=>x.request_id===sourceB));
   const detail=await get('/api/v1/uat-preview/reports/'+sourceA,jwt());
   assert.equal(detail.status,200);
   const report=(await detail.json()).data.report;
   assert.equal(report.total,12);
   assert.equal(report.release_allowed,false);
   assert.equal(report.execution_allowed,false);
   assert.equal(report.production_integration_allowed,false);
   assert.ok(report.tasks.every(x=>x.status.includes('禁止联调')));
   const exported=await get('/api/v1/uat-preview/reports/'+sourceA+'/markdown',jwt());
   assert.equal(exported.status,200);
   assert.match(exported.headers.get('content-disposition'),/attachment/);
   const md=await exported.text();
   assert.match(md,/禁止真实联调/);
   assert.match(md,/合同|课时|财务/);
   assert.doesNotMatch(md,/银行卡号|身份证号|AUTH_HMAC_SECRET/);
   const seq=(await fin.query(
    'SELECT ms.record_fixture_uat_evidence($1,$2,$3,$4,$5,$6,$7) AS result',
    [sourceA,'finance_reconciliation','fixture_added','fictional_api_history01',
     null,'fixture_received',idKey()])).rows[0].result;
   assert.equal(seq,1);
   const historyRes=await get('/api/v1/uat-preview/reports/'+sourceA+'/history',jwt());
   assert.equal(historyRes.status,200);
   const history=(await historyRes.json()).data.history;
   assert.equal(history.current,1);
   assert.equal(history.added,1);
   assert.equal(history.activeAfter,1);
   assert.equal(history.execution_allowed,false);
   const comparison=await get('/api/v1/uat-preview/reports/'+sourceA+'/diff/0/1',jwt());
   assert.equal(comparison.status,200);
   const diffReport=(await comparison.json()).data.history;
   assert.equal(diffReport.events.length,1);
   assert.equal(diffReport.events[0].fixtureRef,'fictional_api_history01');
   const historyExport=await get(
    '/api/v1/uat-preview/reports/'+sourceA+'/diff/0/1/markdown',jwt());
   assert.equal(historyExport.status,200);
   const historyMd=await historyExport.text();
   assert.match(historyMd,/禁止解除学生错误关联隔离/);
   assert.match(historyMd,/fictional_api_history01/);
   assert.doesNotMatch(historyMd,/staff_identity_bindings|AUTH_HMAC_SECRET/);
   const unknownVersion=await get('/api/v1/uat-preview/reports/'+sourceA+'/diff/0/9',jwt());
   assert.equal(unknownVersion.status,422);
   const historyCross=await get('/api/v1/uat-preview/reports/'+sourceB+'/history',jwt());
   assert.equal(historyCross.status,403);
   const exportCross=await get(
    '/api/v1/uat-preview/reports/'+sourceB+'/diff/0/0/markdown',jwt());
   assert.equal(exportCross.status,403);
   const cross=await get('/api/v1/uat-preview/reports/'+sourceB,jwt());
   assert.equal(cross.status,403);
   const crossDownload=await get('/api/v1/uat-preview/reports/'+sourceB+'/markdown',jwt());
   assert.equal(crossDownload.status,403);
  });
  await t.test('signed identity revocation invalidates next request and export',async()=>{
   await owner.query('UPDATE ms.staff_identity_bindings SET revoked_at=now() WHERE issuer=$1 AND subject=$2',
    [issuer,subject]);
   const denied=await get('/api/v1/uat-preview/reports/'+sourceA+'/markdown',jwt());
   assert.equal(denied.status,403);
   const list=await get('/api/v1/uat-preview/requests',jwt());
   assert.equal(list.status,403);
   const deniedHistory=await get('/api/v1/uat-preview/reports/'+sourceA+'/history',jwt());
   assert.equal(deniedHistory.status,403);
   const deniedExport=await get('/api/v1/uat-preview/reports/'+sourceA+'/diff/0/1/markdown',jwt());
   assert.equal(deniedExport.status,403);
  });
 }finally{
  if(server?.listening)await close(server);
  await Promise.all([owner.end(),A.end(),B.end(),fin.end(),finB.end()]);
 }
});
