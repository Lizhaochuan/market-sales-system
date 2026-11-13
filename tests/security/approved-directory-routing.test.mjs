import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createSign,randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';
import {createApp} from '../../src/app.mjs';
import {createIsolatedIdentityGateway} from '../../src/isolated-identity-gateway.mjs';
import {assertApprovedRouteReader,createApprovedIdentityDirectory} from '../../src/approved-identity-directory.mjs';

const orgA='20000000-0000-4000-8000-000000000001';
const orgB='20000000-0000-4000-8000-000000000002';
const issuer='https://fictional-approval-directory.example.invalid';
const audience='market-sales-approved-route-test';
const secret='fictional-test-only-strong-token-secret-9c92789dc3b9';
const key=()=>randomBytes(20).toString('hex');
const listen=s=>new Promise(r=>s.listen(0,'127.0.0.1',r));
const close=s=>new Promise(r=>s.close(r));
const origin=s=>'http://127.0.0.1:'+s.address().port;

test('V3.2-08: only independently approved LIVE identity bindings can route',async t=>{
  process.env.MS_STAGE='isolated-test';
  const owner=new pg.Pool({connectionString:process.env.DATABASE_URL,max:5});
  const poolA=new pg.Pool({connectionString:process.env.DATABASE_URL_RESTRICTED,max:4});
  const poolB=new pg.Pool({connectionString:process.env.DATABASE_URL_RESTRICTED_B,max:4});
  const directoryPool=new pg.Pool({connectionString:process.env.DATABASE_URL_ROUTE_DIRECTORY,max:4});
  const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  const jwk={...publicKey.export({format:'jwk'}),kid:'approval-route-key',alg:'RS256',use:'sig'};
  const externalIdentity={issuer,audience,jwks:{keys:[jwk]}};
  const token=(subject,extra={})=>{
    const now=Math.floor(Date.now()/1000);
    const head=Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT',kid:jwk.kid})).toString('base64url');
    const payload=Buffer.from(JSON.stringify({
      iss:issuer,aud:audience,sub:subject,iat:now,exp:now+900,...extra
    })).toString('base64url');
    return head+'.'+payload+'.'+createSign('RSA-SHA256').update(head+'.'+payload)
      .sign(privateKey).toString('base64url');
  };
  const ids={};
  async function createStaff(org,label){
    const r=await owner.query(
      "INSERT INTO ms.staff_users(organization_id,display_name,status) "+
      "VALUES($1,$2,'active') RETURNING id",[org,label+'-'+randomUUID()]);
    return r.rows[0].id;
  }
  async function managerRole(org,staff){
    await owner.query(
      "INSERT INTO ms.role_templates(organization_id,role_code,label_zh) "+
      "VALUES($1,'sales_manager','演示审批主管') ON CONFLICT(organization_id,role_code) DO NOTHING",[org]);
    const role=await owner.query(
      "SELECT id FROM ms.role_templates WHERE organization_id=$1 AND role_code='sales_manager'",[org]);
    await owner.query("INSERT INTO ms.user_role_grants(user_id,role_id) VALUES($1,$2)",[staff,role.rows[0].id]);
  }
  async function requestIdentity(org,target,subject,requester,action='bind',bindingId=null){
    const r=await owner.query(
      "INSERT INTO ms.identity_change_requests(organization_id,action,target_staff_id,"+
      "issuer,subject,existing_binding_id,requested_by,request_evidence_ref,request_reason_zh) "+
      "VALUES($1,$2,$3,$4,$5,$6,$7,'虚构申请凭据','演示人工审核申请') RETURNING id",
      [org,action,target,issuer,subject,bindingId,requester]);
    return r.rows[0].id;
  }
  async function approve(requestId,reviewer,action,target,subject,bindingId=null){
    await owner.query(
      "INSERT INTO ms.identity_change_decisions(request_id,reviewer_user_id,decision,"+
      "review_evidence_ref,reason_zh) VALUES($1,$2,'approved','独立审核模拟凭据','第二主管独立核对资料')",
      [requestId,reviewer]);
    await owner.query(
      "UPDATE ms.identity_change_requests SET status='approved',decided_by=$2,decided_at=now() WHERE id=$1",
      [requestId,reviewer]);
    if(action==='bind'){
      const r=await owner.query(
        "INSERT INTO ms.staff_identity_bindings(staff_user_id,issuer,subject,bound_by,approval_request_id) "+
        "VALUES($1,$2,$3,$4,$5) RETURNING id",
        [target,issuer,subject,reviewer,requestId]);
      return r.rows[0].id;
    }
    await owner.query(
      "UPDATE ms.staff_identity_bindings SET revoked_at=now(),revocation_request_id=$2 WHERE id=$1",
      [bindingId,requestId]);
    return bindingId;
  }
  const appA=createApp(poolA,{secret,issuer:'market-sales-test-issuer',externalIdentity});
  const appB=createApp(poolB,{secret,issuer:'market-sales-test-issuer',externalIdentity});
  let gateway;
  try{
    const staffA=await createStaff(orgA,'动态路由A员工');
    const staffB=await createStaff(orgB,'动态路由B员工');
    const applicantA=await createStaff(orgA,'A申请主管');
    const reviewerA=await createStaff(orgA,'A独立主管');
    const applicantB=await createStaff(orgB,'B申请主管');
    const reviewerB=await createStaff(orgB,'B独立主管');
    for(const [org,staff] of [
      [orgA,applicantA],[orgA,reviewerA],[orgB,applicantB],[orgB,reviewerB]
    ])await managerRole(org,staff);
    const subjectA='approved-a-'+randomUUID();
    const subjectB='approved-b-'+randomUUID();
    const unapproved='legacy-no-approval-'+randomUUID();
    ids.a={staff:staffA,applicant:applicantA,reviewer:reviewerA,subject:subjectA};
    ids.b={staff:staffB,applicant:applicantB,reviewer:reviewerB,subject:subjectB};

    await t.test('route lookup login is nonowner with EXECUTE only, no raw subjects/staff reads',async()=>{
      const result=await assertApprovedRouteReader(directoryPool);
      assert.equal(result.login,'ms_approved_route_login');
      await assert.rejects(
        directoryPool.query('SELECT subject FROM ms.staff_identity_bindings'),
        e=>e.code==='42501');
      await assert.rejects(
        directoryPool.query('SELECT * FROM ms.identity_change_decisions'),
        e=>e.code==='42501');
    });

    await Promise.all([listen(appA),listen(appB)]);
    const resolveTenant=createApprovedIdentityDirectory(directoryPool);
    gateway=createIsolatedIdentityGateway({
      externalIdentity,resolveTenant,
      tenantUpstreams:[{tenantId:orgA,upstream:origin(appA)},{tenantId:orgB,upstream:origin(appB)}]
    });
    await listen(gateway);
    const call=async(jwt,method='/api/v1/me',body)=>{
      const response=await fetch(origin(gateway)+method,{
        method:body===undefined?'GET':'POST',
        headers:{Authorization:'Bearer '+jwt,
          ...(body===undefined?{}:{'Content-Type':'application/json','Idempotency-Key':key()})},
        ...(body===undefined?{}:{body:JSON.stringify(body)})
      });
      return {status:response.status,...await response.json()};
    };

    const pendingA=await requestIdentity(orgA,staffA,subjectA,applicantA);
    const pendingB=await requestIdentity(orgB,staffB,subjectB,applicantB);
    await owner.query(
      "INSERT INTO ms.staff_identity_bindings(staff_user_id,issuer,subject,bound_by) VALUES($1,$2,$3,$4)",
      [staffA,issuer,unapproved,reviewerA]);

    await t.test('unapproved/pending/legacy direct bindings do not route',async()=>{
      assert.equal(await resolveTenant(issuer,subjectA),null);
      assert.equal(await resolveTenant(issuer,unapproved),null);
      assert.equal((await call(token(subjectA))).status,403);
      assert.equal((await call(token(unapproved))).status,403);
      assert.equal((await call(token('nonexistent-'+randomUUID()))).status,403);
      assert.equal((await call(token(subjectB))).status,403);
    });

    const bindingA=await approve(pendingA,reviewerA,'bind',staffA,subjectA);
    const bindingB=await approve(pendingB,reviewerB,'bind',staffB,subjectB);
    await t.test('live approvals activate without gateway restart or changed static subject map',async()=>{
      assert.equal(await resolveTenant(issuer,subjectA),orgA);
      assert.equal(await resolveTenant(issuer,subjectB),orgB);
      const a=await call(token(subjectA,{org_id:orgB,role:'super_admin'}));
      const b=await call(token(subjectB,{org_id:orgA,role:'super_admin'}));
      assert.equal(a.status,200);assert.equal(b.status,200);
      assert.equal(a.data.staff_id,staffA);assert.equal(a.data.organization_id,orgA);
      assert.equal(b.data.staff_id,staffB);assert.equal(b.data.organization_id,orgB);
      assert.equal(a.data.capabilities.manage_identity_requests,false);
    });

    await t.test('approved routes preserve hard tenant boundary and do not leak cross-org student rows',async()=>{
      const a=await call(token(subjectA),'/api/v1/students',{display_name:'目录审批A学生-'+randomUUID()});
      const b=await call(token(subjectB),'/api/v1/students',{display_name:'目录审批B学生-'+randomUUID()});
      assert.equal(a.status,200);assert.equal(b.status,200);
      const listA=await call(token(subjectA),'/api/v1/students?org_id='+orgB);
      const listB=await call(token(subjectB),'/api/v1/students?org_id='+orgA);
      assert.ok(listA.data.items.some(x=>x.student_id===a.data.student_id));
      assert.ok(!listA.data.items.some(x=>x.student_id===b.data.student_id));
      assert.ok(listB.data.items.some(x=>x.student_id===b.data.student_id));
      assert.ok(!listB.data.items.some(x=>x.student_id===a.data.student_id));
    });

    const revokeRequest=await requestIdentity(orgA,staffA,subjectA,applicantA,'revoke',bindingA);
    await t.test('pending revocation preserves existing access until independently approved',async()=>{
      assert.equal((await call(token(subjectA))).status,200);
      assert.equal(await resolveTenant(issuer,subjectA),orgA);
    });

    await approve(revokeRequest,reviewerA,'revoke',staffA,subjectA,bindingA);
    await t.test('approved revocation removes gateway route immediately, without cache refresh',async()=>{
      assert.equal(await resolveTenant(issuer,subjectA),null);
      assert.equal((await call(token(subjectA))).status,403);
      assert.equal((await call(token(subjectB))).status,200);
    });

    await t.test('employee disable also removes live routing',async()=>{
      await owner.query("UPDATE ms.staff_users SET status='disabled' WHERE id=$1",[staffB]);
      assert.equal(await resolveTenant(issuer,subjectB),null);
      assert.equal((await call(token(subjectB))).status,403);
    });

    await t.test('static and database modes cannot be combined, untrusted URL is rejected',async()=>{
      assert.throws(()=>createIsolatedIdentityGateway({
        externalIdentity,resolveTenant,tenantUpstreams:[
          {tenantId:orgA,upstream:'https://remote.example.invalid'}
        ]}));
      assert.throws(()=>createIsolatedIdentityGateway({
        externalIdentity,resolveTenant,
        tenantUpstreams:[{tenantId:orgA,upstream:origin(appA)}],
        registrations:[{issuer,subject:subjectA,upstream:origin(appA)}]
      }));
      assert.equal((await call(token(subjectA,{aud:'wrong'})).status),401);
    });
  }finally{
    await Promise.allSettled([gateway,appA,appB].filter(x=>x?.listening).map(close));
    await Promise.all([owner.end(),poolA.end(),poolB.end(),directoryPool.end()]);
  }
});
