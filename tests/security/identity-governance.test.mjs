import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createSign,randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';
import {createApp} from '../../src/app.mjs';

const secret='fictional-test-only-strong-token-secret-9c92789dc3b9';
const demoPass='fictional-strong-ui-demo-passphrase-0001';
const issuer='https://mock-identity-v4.example.invalid';
const audience='market-sales-governance';
const staff='20000000-0000-4000-8000-000000000011';
const manager='20000000-0000-4000-8000-000000000013';
const reviewer='20000000-0000-4000-8000-000000000014';
const org='20000000-0000-4000-8000-000000000001';
const key=()=>randomBytes(16).toString('hex');
test('V3.2-04 identity binding governance, revocation and role isolation',async t=>{
  process.env.MS_STAGE='isolated-test';
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:9});
  const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  const jwk={...publicKey.export({format:'jwk'}),kid:'governance-signing-key',alg:'RS256',use:'sig'};
  const app=createApp(pool,{secret,issuer:'market-sales-test-issuer',devLoginSecret:demoPass,
    externalIdentity:{issuer,audience,jwks:{keys:[jwk]}}});
  await new Promise(ok=>app.listen(0,'127.0.0.1',ok));
  const base='http://127.0.0.1:'+app.address().port;
  const call=async(method,path,token,body,k=key())=>{
    const r=await fetch(base+path,{method,headers:{
      ...(token?{Authorization:'Bearer '+token}:{}),
      ...(body?{'Content-Type':'application/json','Idempotency-Key':k}:{})
    },...(body?{body:JSON.stringify(body)}:{})});
    return {status:r.status,...await r.json()};
  };
  const post=(path,token,body,k)=>call('POST',path,token,body,k);
  const get=(path,token)=>call('GET',path,token);
  const demo=async code=>{
    const r=await post('/api/v1/dev/login',null,{account_code:code,passphrase:demoPass});
    assert.equal(r.status,200);return r.data.token;
  };
  const managerToken=await demo('supervisor');
  const reviewerToken=await demo('supervisor-2');
  const employeeToken=await demo('sales-a');
  const externalToken=(subject)=>{
    const now=Math.floor(Date.now()/1000);
    const head=Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT',kid:'governance-signing-key'})).toString('base64url');
    const body=Buffer.from(JSON.stringify({iss:issuer,aud:audience,sub:subject,iat:now,exp:now+1200})).toString('base64url');
    return head+'.'+body+'.'+createSign('RSA-SHA256').update(head+'.'+body).sign(privateKey).toString('base64url');
  };
  const subject='fictional-approved-sales-staff-'+randomUUID();
  const jwt=externalToken(subject);
  const bindBody={action:'bind',target_staff_id:staff,issuer,subject,
    request_evidence_ref:'模拟入职资料编号',request_reason_zh:'演示新销售身份绑定'};
  let requestId,bindingId;
  try{
    await t.test('only manager can read queue; no external subject is returned',async()=>{
      assert.equal((await get('/api/v1/identity/staff',employeeToken)).status,403);
      assert.equal((await get('/api/v1/identity/change-requests',employeeToken)).status,403);
      assert.equal((await get('/api/v1/identity/bindings',employeeToken)).status,403);
      assert.equal((await get('/api/v1/identity/staff',managerToken)).status,200);
      const me=await get('/api/v1/me',employeeToken);
      assert.equal(me.data.capabilities.manage_identity_requests,false);
      const ext=await get('/api/v1/me',jwt);
      assert.equal(ext.status,403,'Unapproved external subject must not get staff access');
    });
    await t.test('bind request cannot target self or another organization',async()=>{
      const self=await post('/api/v1/identity/change-requests',managerToken,{...bindBody,target_staff_id:manager});
      assert.equal(self.status,403);
      const other=await post('/api/v1/identity/change-requests',managerToken,{...bindBody,target_staff_id:randomUUID()});
      assert.equal(other.status,404);
      const bogusIssuer=await post('/api/v1/identity/change-requests',managerToken,{...bindBody,issuer:'http://untrusted.invalid'});
      assert.equal(bogusIssuer.status,422);
    });
    await t.test('manager A requests binding; requester and target cannot approve it',async()=>{
      const k=key();
      const created=await post('/api/v1/identity/change-requests',managerToken,bindBody,k);
      assert.equal(created.status,200);requestId=created.data.request_id;
      assert.equal(created.data.status,'pending');
      const replay=await post('/api/v1/identity/change-requests',managerToken,bindBody,k);
      assert.equal(replay.data.request_id,requestId);
      assert.equal((await post('/api/v1/identity/change-requests/'+requestId+'/decision',
        managerToken,{decision:'approved',review_evidence_ref:'a',reason_zh:'自己审批'})).status,403);
      assert.equal((await post('/api/v1/identity/change-requests/'+requestId+'/decision',
        employeeToken,{decision:'approved',review_evidence_ref:'b',reason_zh:'无权审批'})).status,403);
      await assert.rejects(pool.query(
        "UPDATE ms.identity_change_requests SET status='approved',decided_by=$2,decided_at=now() WHERE id=$1",
        [requestId,reviewer]),e=>e.code==='23514');
      const q=await get('/api/v1/identity/change-requests',reviewerToken);
      const item=q.data.items.find(v=>v.request_id===requestId);
      assert.ok(item);assert.equal(item.subject,undefined);
    });
    await t.test('another manager approves; external JWT works only after binding',async()=>{
      const k=key();
      const decision={decision:'approved',review_evidence_ref:'独立复核资料',reason_zh:'第二主管复核有效身份'};
      const ok=await post('/api/v1/identity/change-requests/'+requestId+'/decision',reviewerToken,decision,k);
      assert.equal(ok.status,200);
      assert.equal(ok.data.status,'approved');
      assert.equal((await post('/api/v1/identity/change-requests/'+requestId+'/decision',reviewerToken,decision,k)).status,200);
      assert.equal((await post('/api/v1/identity/change-requests/'+requestId+'/decision',reviewerToken,decision)).status,409);
      const bound=await pool.query('SELECT id,approval_request_id FROM ms.staff_identity_bindings WHERE issuer=$1 AND subject=$2 AND revoked_at IS NULL',[issuer,subject]);
      assert.equal(bound.rowCount,1);assert.equal(bound.rows[0].approval_request_id,requestId);
      bindingId=bound.rows[0].id;
      assert.equal((await get('/api/v1/me',jwt)).data.staff_id,staff);
      const list=await get('/api/v1/identity/bindings',managerToken);
      assert.ok(list.data.items.some(x=>x.binding_id===bindingId));
      assert.ok(!JSON.stringify(list.data.items).includes(subject));
    });
    await t.test('DB blocks changing reviewer facts and repeating finalized request',async()=>{
      await assert.rejects(pool.query("DELETE FROM ms.identity_change_decisions WHERE request_id=$1",[requestId]),e=>e.code==='23514');
      await assert.rejects(pool.query("UPDATE ms.identity_change_decisions SET reason_zh='伪造' WHERE request_id=$1",[requestId]),e=>e.code==='23514');
      await assert.rejects(pool.query("UPDATE ms.identity_change_requests SET request_reason_zh='伪造理由' WHERE id=$1",[requestId]),e=>e.code==='23514');
    });
    await t.test('revocation itself requires a new independent approval',async()=>{
      const revReq=await post('/api/v1/identity/change-requests',managerToken,{
        action:'revoke',existing_binding_id:bindingId,
        request_evidence_ref:'模拟离职流程编号',request_reason_zh:'正式撤销外部身份'
      });
      assert.equal(revReq.status,200);
      assert.equal((await get('/api/v1/me',jwt)).status,200,'Pending revocation does not silently revoke access');
      assert.equal((await post('/api/v1/identity/change-requests/'+revReq.data.request_id+'/decision',
        managerToken,{decision:'approved',review_evidence_ref:'c',reason_zh:'自己审批'})).status,403);
      const approved=await post('/api/v1/identity/change-requests/'+revReq.data.request_id+'/decision',
        reviewerToken,{decision:'approved',review_evidence_ref:'复核离职信息',reason_zh:'确认应立即撤销外部身份'});
      assert.equal(approved.status,200);
      assert.equal((await get('/api/v1/me',jwt)).status,403,'Signed external token must lose access after revocation');
      const db=await pool.query('SELECT revocation_request_id,revoked_at FROM ms.staff_identity_bindings WHERE id=$1',[bindingId]);
      assert.equal(db.rows[0].revocation_request_id,revReq.data.request_id);
      assert.ok(db.rows[0].revoked_at);
    });
    await t.test('audit records only Chinese business facts, not external subject',async()=>{
      const r=await get('/api/v1/audit?object_type=identity_change&object_id='+requestId,managerToken);
      assert.equal(r.status,200);
      const text=JSON.stringify(r.data.items);
      assert.ok(text.includes('独立主管批准'));
      assert.ok(!text.includes(subject));
      assert.equal((await get('/api/v1/audit?object_type=identity_change&object_id='+requestId,employeeToken)).status,403);
    });
    await t.test('reject request leaves identity unbound',async()=>{
      const subject2='fictional-rejected-'+randomUUID();
      const created=await post('/api/v1/identity/change-requests',managerToken,{
        ...bindBody,subject:subject2,request_evidence_ref:'待否决的测试申请'
      });
      assert.equal(created.status,200);
      const rejected=await post('/api/v1/identity/change-requests/'+created.data.request_id+'/decision',
        reviewerToken,{decision:'rejected',review_evidence_ref:'无法核实',reason_zh:'材料与目标员工不符'});
      assert.equal(rejected.status,200);assert.equal(rejected.data.status,'rejected');
      const count=await pool.query('SELECT count(*)::int AS n FROM ms.staff_identity_bindings WHERE issuer=$1 AND subject=$2',[issuer,subject2]);
      assert.equal(count.rows[0].n,0);
    });
    await t.test('live role revocation immediately blocks manager-only API',async()=>{
      await pool.query("UPDATE ms.user_role_grants SET revoked_at=now() WHERE user_id=$1",[reviewer]);
      assert.equal((await get('/api/v1/identity/change-requests',reviewerToken)).status,403);
      await pool.query("UPDATE ms.staff_users SET status='disabled' WHERE id=$1",[staff]);
      assert.equal((await get('/api/v1/me',employeeToken)).status,403);
    });
  } finally {
    await new Promise(ok=>app.close(ok));
    await pool.end();
  }
});
