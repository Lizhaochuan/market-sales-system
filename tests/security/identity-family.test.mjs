import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign, randomUUID, randomBytes } from 'node:crypto';
import pg from 'pg';
import { createApp } from '../../src/app.mjs';

const secret='fictional-test-only-strong-token-secret-9c92789dc3b9';
const demoPass='fictional-strong-ui-demo-passphrase-0001';
const issuer='https://mock-identity.example.invalid';
const audience='market-sales-service';
const staffA='20000000-0000-4000-8000-000000000011';
const staffM='20000000-0000-4000-8000-000000000013';
const staffM2='20000000-0000-4000-8000-000000000014';
const org='20000000-0000-4000-8000-000000000001';
const requestKey=()=>randomBytes(18).toString('hex');
function sign(payload,key,kid='test-rs256'){
  const h=Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT',kid})).toString('base64url');
  const p=Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig=createSign('RSA-SHA256').update(h+'.'+p).sign(key).toString('base64url');
  return h+'.'+p+'.'+sig;
}
test('V3.2-03 external OIDC verification and two-person family approval on real PG',async t=>{
  process.env.MS_STAGE='isolated-test';
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:10});
  const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  const jwk={...publicKey.export({format:'jwk'}),kid:'test-rs256',alg:'RS256',use:'sig'};
  const app=createApp(pool,{
    secret,issuer:'market-sales-test-issuer',devLoginSecret:demoPass,
    externalIdentity:{issuer,audience,jwks:{keys:[jwk]}}
  });
  await new Promise(ok=>app.listen(0,'127.0.0.1',ok));
  const base='http://127.0.0.1:'+app.address().port;
  const call=async(method,path,token,body,key=requestKey())=>{
    const r=await fetch(base+path,{method,headers:{
      ...(token?{Authorization:'Bearer '+token}:{}),
      ...(body?{'Content-Type':'application/json','Idempotency-Key':key}:{})
    },...(body?{body:JSON.stringify(body)}:{})});
    return {status:r.status,...await r.json()};
  };
  const post=(path,token,body,key)=>call('POST',path,token,body,key);
  const get=(path,token)=>call('GET',path,token);
  const demo=async account=>{
    const r=await post('/api/v1/dev/login',{unused:true},{account_code:account,passphrase:demoPass});
    // /dev/login ignores Authorization; this route uses JSON password only.
    assert.equal(r.status,200);
    return r.data.token;
  };
  const manager=await demo('supervisor');
  const reviewer=await demo('supervisor-2');
  const sales=await demo('sales-a');
  const now=Math.floor(Date.now()/1000);
  const claims=(subject,extra={})=>({
    iss:issuer,aud:audience,sub:subject,iat:now,exp:now+1200,...extra
  });
  const oidcStaff='external-staff-A-only';
  let student1,student2,pendingId;
  try{
    await t.test('trusted external RS256 token resolves only prebound active staff',async()=>{
      await pool.query('INSERT INTO ms.staff_identity_bindings(staff_user_id,issuer,subject,bound_by) VALUES($1,$2,$3,$4)',
        [staffA,issuer,oidcStaff,staffM]);
      const token=sign(claims(oidcStaff),privateKey);
      const profile=await get('/api/v1/me',token);
      assert.equal(profile.status,200);
      assert.equal(profile.data.staff_id,staffA);
      assert.equal(profile.data.capabilities.propose_family_review,false);
      const managerProfile=await get('/api/v1/me',manager);
      assert.equal(managerProfile.status,200);
      assert.equal(managerProfile.data.capabilities.propose_family_review,true);
      const second=await get('/api/v1/me',reviewer);
      assert.equal(second.data.staff_id,staffM2);
      assert.equal(second.data.capabilities.decide_other_person_family_review,true);
    });
    await t.test('unsigned, wrong key, wrong issuer/audience, expired and unbound identity denied',async()=>{
      assert.equal((await get('/api/v1/me',sign(claims('unbound-person'),privateKey))).status,403);
      assert.equal((await get('/api/v1/me',sign(claims(oidcStaff,{aud:'wrong-audience'}),privateKey))).status,401);
      assert.equal((await get('/api/v1/me',sign(claims(oidcStaff,{iss:'https://other.example.invalid'}),privateKey))).status,401);
      assert.equal((await get('/api/v1/me',sign(claims(oidcStaff,{iat:now-1800,exp:now-1}),privateKey))).status,401);
      const bad=sign(claims(oidcStaff),privateKey).split('.');
      bad[2]=randomBytes(256).toString('base64url');
      assert.equal((await get('/api/v1/me',bad.join('.'))).status,401);
      const algNone=Buffer.from(JSON.stringify({alg:'none',kid:'test-rs256'})).toString('base64url');
      assert.equal((await get('/api/v1/me',algNone+'.'+Buffer.from(JSON.stringify(claims(oidcStaff))).toString('base64url')+'.')).status,401);
    });
    await t.test('only a supervisor can create a pending family review for two same-org students',async()=>{
      const a=await post('/api/v1/students',manager,{display_name:'批准场景虚构学生甲'});
      const b=await post('/api/v1/students',manager,{display_name:'批准场景虚构学生乙'});
      assert.equal(a.status,200);assert.equal(b.status,200);
      student1=a.data.student_id;student2=b.data.student_id;
      const denied=await post('/api/v1/family-groups',sales,{
        display_name:'普通销售不得申请',student_ids:[student1,student2],
        verification_evidence_ref:'测试'
      });
      assert.equal(denied.status,403);
      const requested=await post('/api/v1/family-groups',manager,{
        display_name:'浏览器虚构待审核家庭',student_ids:[student1,student2],
        verification_evidence_ref:'申请人提交的模拟材料编号'
      });
      assert.equal(requested.status,200);
      assert.equal(requested.data.verification_state,'pending');
      pendingId=requested.data.family_group_id;
      const r=await pool.query('SELECT requested_by,verified_by FROM ms.family_groups WHERE id=$1',[pendingId]);
      assert.equal(r.rows[0].requested_by,staffM);
      assert.equal(r.rows[0].verified_by,null);
    });
    await t.test('requester cannot self-approve; raw DB status update cannot bypass decision',async()=>{
      const payload={decision:'approved',review_evidence_ref:'独立核实编号',reason_zh:'模拟审核确认'};
      const self=await post('/api/v1/family-groups/'+pendingId+'/decision',manager,payload);
      assert.equal(self.status,403);
      assert.equal(self.code,'SELF_APPROVAL_FORBIDDEN');
      assert.equal((await post('/api/v1/family-groups/'+pendingId+'/decision',sales,payload)).status,403);
      await assert.rejects(
        pool.query("UPDATE ms.family_groups SET verification_state='verified',verified_by=$2,verified_at=now() WHERE id=$1",
          [pendingId,staffM2]),
        e=>e.code==='23514'
      );
      await assert.rejects(
        pool.query("INSERT INTO ms.family_review_decisions(family_group_id,reviewer_user_id,decision,review_evidence_ref,reason_zh) VALUES($1,$2,'approved','x','x')",
          [pendingId,staffM]),
        e=>e.code==='23514'
      );
    });
    await t.test('second supervisor can approve once; replay and history immutable',async()=>{
      const k=requestKey();
      const payload={decision:'approved',review_evidence_ref:'独立实地证据模拟-001',reason_zh:'两位学生的关系已由第二位主管核对模拟资料'};
      const result=await post('/api/v1/family-groups/'+pendingId+'/decision',reviewer,payload,k);
      assert.equal(result.status,200);
      assert.equal(result.data.verification_state,'verified');
      const replay=await post('/api/v1/family-groups/'+pendingId+'/decision',reviewer,payload,k);
      assert.equal(replay.status,200);
      const again=await post('/api/v1/family-groups/'+pendingId+'/decision',reviewer,payload);
      assert.equal(again.status,409);
      const table=await pool.query("SELECT g.verification_state,g.verified_by,count(m.student_id)::int AS students "+
        "FROM ms.family_groups g JOIN ms.family_memberships m ON m.family_group_id=g.id "+
        "WHERE g.id=$1 GROUP BY g.id",[pendingId]);
      assert.equal(table.rows[0].verification_state,'verified');
      assert.equal(table.rows[0].verified_by,staffM2);
      assert.equal(table.rows[0].students,2);
      const dec=await pool.query("SELECT id,reviewer_user_id FROM ms.family_review_decisions WHERE family_group_id=$1",[pendingId]);
      assert.equal(dec.rowCount,1);
      assert.equal(dec.rows[0].reviewer_user_id,staffM2);
      await assert.rejects(pool.query("DELETE FROM ms.family_review_decisions WHERE id=$1",[dec.rows[0].id]),e=>e.code==='23514');
      await assert.rejects(pool.query("UPDATE ms.family_review_decisions SET reason_zh='伪造内容' WHERE id=$1",[dec.rows[0].id]),e=>e.code==='23514');
    });
    await t.test('audited family approval reads as Chinese business facts, isolated from sales staff',async()=>{
      const audit=await get('/api/v1/audit?object_type=family&object_id='+pendingId,reviewer);
      assert.equal(audit.status,200);
      const body=JSON.stringify(audit.data.items);
      assert.ok(body.includes('独立主管核实批准'));
      assert.ok(body.includes('模拟第二主管'));
      assert.ok(body.includes('变更')===false||body.includes('关系状态'));
      assert.ok(!body.includes('before_business_json'));
      assert.equal((await get('/api/v1/audit?object_type=family&object_id='+pendingId,sales)).status,403);
      const list=await get('/api/v1/family-groups',reviewer);
      assert.equal(list.status,200);
      assert.ok(list.data.items.some(x=>x.family_group_id===pendingId&&x.requested_by_name==='模拟销售主管'&&x.verified_by_name==='模拟第二主管'));
    });
    await t.test('rejecting a different pending family leaves membership unverified',async()=>{
      const r=await post('/api/v1/family-groups',manager,{
        display_name:'应驳回的虚构家庭',student_ids:[student1,student2],
        verification_evidence_ref:'错误或不充分的虚构申请材料'
      });
      assert.equal(r.status,200);
      const rejected=await post('/api/v1/family-groups/'+r.data.family_group_id+'/decision',reviewer,{
        decision:'rejected',review_evidence_ref:'复核后材料不一致',reason_zh:'证据不足，暂不确认家庭关系'
      });
      assert.equal(rejected.status,200);assert.equal(rejected.data.verification_state,'rejected');
      const member=await pool.query("SELECT count(*)::int AS n FROM ms.family_memberships WHERE family_group_id=$1 AND verified_at IS NOT NULL",[r.data.family_group_id]);
      assert.equal(member.rows[0].n,0);
    });
    await t.test('revoking external mapping immediately removes authenticated access',async()=>{
      const token=sign(claims(oidcStaff),privateKey);
      await pool.query('UPDATE ms.staff_identity_bindings SET revoked_at=now() WHERE issuer=$1 AND subject=$2',[issuer,oidcStaff]);
      assert.equal((await get('/api/v1/me',token)).status,403);
    });
  }finally{
    await new Promise(resolve=>app.close(resolve));
    await pool.end();
  }
});
