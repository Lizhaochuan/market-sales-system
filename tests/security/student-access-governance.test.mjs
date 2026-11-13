import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createSign,randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';
import {createStudentAccessApi,assertStudentAccessOperatorPool} from '../../src/student-access-api.mjs';

const org='20000000-0000-4000-8000-000000000001';
const foreign='20000000-0000-4000-8000-000000000002';
const A='20000000-0000-4000-8000-000000000011';
const B='20000000-0000-4000-8000-000000000012';
const M='20000000-0000-4000-8000-000000000013';
const M2='20000000-0000-4000-8000-000000000014';
const issuer='https://fictional-access-governance.example.invalid';
const audience='access-governance-isolated-test';
const key=()=>randomBytes(22).toString('hex');
const start=s=>new Promise(ok=>s.listen(0,'127.0.0.1',ok));
const stop=s=>new Promise(ok=>s.close(ok));
const sleep=ms=>new Promise(ok=>setTimeout(ok,ms));

test('V3.2-11: student access approval, temporary grants, expiry, revocation, and independent owner transfer',async t=>{
  process.env.MS_STAGE='isolated-test';
  const owner=new pg.Pool({connectionString:process.env.DATABASE_URL,max:6});
  const accessA=new pg.Pool({connectionString:process.env.DATABASE_URL_ACCESS_A,max:4});
  const accessB=new pg.Pool({connectionString:process.env.DATABASE_URL_ACCESS_B,max:4});
  const accessM=new pg.Pool({connectionString:process.env.DATABASE_URL_ACCESS_MANAGER,max:4});
  const readA=new pg.Pool({connectionString:process.env.DATABASE_URL_ASSIGNEE_A,max:3});
  const readB=new pg.Pool({connectionString:process.env.DATABASE_URL_ASSIGNEE_B,max:3});
  const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  const jwk={...publicKey.export({format:'jwk'}),alg:'RS256',kid:'access-governance-2026',use:'sig'};
  const externalIdentity={issuer,audience,jwks:{keys:[jwk]}};
  const subjectA='access-a-'+randomUUID(),subjectB='access-b-'+randomUUID(),
    subjectM='access-manager-'+randomUUID();
  const sign=(subject)=>{
    const now=Math.floor(Date.now()/1000);
    const header=Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT',kid:jwk.kid})).toString('base64url');
    const payload=Buffer.from(JSON.stringify({
      iss:issuer,aud:audience,sub:subject,iat:now,exp:now+900,
      org_id:foreign,role:'super_admin'
    })).toString('base64url');
    return header+'.'+payload+'.'+createSign('RSA-SHA256').update(header+'.'+payload)
      .sign(privateKey).toString('base64url');
  };
  const tokens={A:sign(subjectA),B:sign(subjectB),M:sign(subjectM)};
  const apps={
    A:createStudentAccessApi(accessA,{externalIdentity}),
    B:createStudentAccessApi(accessB,{externalIdentity}),
    M:createStudentAccessApi(accessM,{externalIdentity})
  };
  let studentA,sibling,studentB,contact,opp,lead,shareId;
  async function putIdentity(target,subject,requester,reviewer){
    const q=await owner.query(
      "INSERT INTO ms.identity_change_requests(organization_id,action,target_staff_id,"+
      "issuer,subject,requested_by,request_evidence_ref,request_reason_zh) "+
      "VALUES($1,'bind',$2,$3,$4,$5,'虚构身份证明','独立核对员工身份') RETURNING id",
      [org,target,issuer,subject,requester]);
    await owner.query(
      "INSERT INTO ms.identity_change_decisions(request_id,reviewer_user_id,decision,"+
      "review_evidence_ref,reason_zh) "+
      "VALUES($1,$2,'approved','独立复核凭据','身份核对通过')",
      [q.rows[0].id,reviewer]);
    await owner.query(
      "UPDATE ms.identity_change_requests SET status='approved',decided_by=$2,"+
      "decided_at=now() WHERE id=$1",[q.rows[0].id,reviewer]);
    await owner.query(
      "INSERT INTO ms.staff_identity_bindings(staff_user_id,issuer,subject,bound_by,approval_request_id) "+
      "VALUES($1,$2,$3,$4,$5)",
      [target,issuer,subject,reviewer,q.rows[0].id]);
  }
  async function call(who,method,path,body,idem=key(),jwt=tokens[who]){
    const r=await fetch('http://127.0.0.1:'+apps[who].address().port+path,{
      method,headers:{
        ...(jwt?{Authorization:'Bearer '+jwt}:{}),
        ...(body!==undefined?{'Content-Type':'application/json','Idempotency-Key':idem}:{})
      },...(body!==undefined?{body:JSON.stringify(body)}:{})
    });
    return {status:r.status,...await r.json()};
  }
  const share=expires=>({
    action:'share',student_id:studentA,target_staff_id:B,
    expires_at:expires,evidence_ref:'模拟授权审核材料',
    reason_zh:'学生负责人请求短期共享'
  });
  const transfer=()=>({
    action:'transfer',student_id:studentA,target_staff_id:B,
    evidence_ref:'模拟负责人变更资料',
    reason_zh:'学生由销售A正式转交销售B'
  });
  const decide=async(id,decision,idem=key())=>
    call('M','POST','/api/v1/student-access/requests/'+id+'/decision',
      {decision,evidence_ref:'虚构独立复核记录',reason_zh:'独立主管核查授权范围'},idem);
  const visibility=async(pool)=>(
    await pool.query('SELECT student_id FROM ms.student_directory_assigned')).rows.map(x=>x.student_id);
  try{
    await t.test('operator DB roles have EXECUTE only, no raw student, family, audit or financial read',async()=>{
      for(const pool of [accessA,accessB,accessM]){
        const check=await assertStudentAccessOperatorPool(pool);
        assert.equal(check.restricted,true);
        await assert.rejects(pool.query('SELECT * FROM ms.students'),e=>e.code==='42501');
        await assert.rejects(pool.query('SELECT * FROM ms.data_scope_grants'),e=>e.code==='42501');
        await assert.rejects(pool.query('SELECT * FROM ms.student_access_requests'),e=>e.code==='42501');
        await assert.rejects(pool.query('SELECT * FROM ms.sales_orders'),e=>e.code==='42501');
        await assert.rejects(pool.query("UPDATE ms.students SET owner_user_id=$1 WHERE false",[B]),
          e=>e.code==='42501');
      }
    });
    const rows=await owner.query(
      "INSERT INTO ms.students(organization_id,display_name,grade_label,owner_user_id) "+
      "VALUES($1,$2,'儿童私密信息A',$3),"+
      "($1,$4,'同家长另一孩子私密信息',$3),"+
      "($1,$5,'销售B学生私密信息',$6) RETURNING id",
      [org,'学生A-'+randomUUID(),A,'真实兄弟姐妹候选-'+randomUUID(),
        '学生B-'+randomUUID(),B]);
    [studentA,sibling,studentB]=rows.rows.map(x=>x.id);
    const c=await owner.query(
      "INSERT INTO ms.contacts(organization_id,display_name,created_by) "+
      "VALUES($1,'虚构共享家长',$2) RETURNING id",[org,A]);
    contact=c.rows[0].id;
    await owner.query(
      "INSERT INTO ms.student_contacts(student_id,contact_id,relation_type) "+
      "VALUES($1,$3,'母亲'),($2,$3,'母亲')",[studentA,sibling,contact]);
    const o=await owner.query(
      "INSERT INTO ms.opportunities(student_id,owner_user_id,stage,predicted_amount_cents) "+
      "VALUES($1,$2,'trial',57000) RETURNING id",[studentA,A]);
    opp=o.rows[0].id;
    const l=await owner.query(
      "INSERT INTO ms.leads(organization_id,contact_id,owner_user_id,lead_state) "+
      "VALUES($1,$2,$3,'working') RETURNING id",[org,contact,A]);
    lead=l.rows[0].id;
    await Promise.all(Object.values(apps).map(start));

    await t.test('valid RSA without approved identity cannot create a sharing request',async()=>{
      const denied=await call('A','POST','/api/v1/student-access/requests',
        share(new Date(Date.now()+20000).toISOString()));
      assert.equal(denied.status,403);
      assert.equal((await owner.query(
        "SELECT COUNT(*)::int AS n FROM ms.student_access_requests WHERE student_id=$1",
        [studentA])).rows[0].n,0);
    });
    await putIdentity(A,subjectA,M,M2);
    await putIdentity(B,subjectB,M,M2);
    await putIdentity(M,subjectM,A,M2);

    await t.test('owner creates pending share; same idempotency key replays but changed content conflicts',async()=>{
      const expiry=new Date(Date.now()+15000).toISOString();
      const body=share(expiry),k=key();
      const first=await call('A','POST','/api/v1/student-access/requests',body,k);
      assert.equal(first.status,200);
      assert.equal(first.data.status_zh,'待独立审批');
      shareId=first.data.request_id;
      const replay=await call('A','POST','/api/v1/student-access/requests',body,k);
      assert.equal(replay.status,200);
      assert.equal(replay.data.request_id,shareId);
      const altered=await call('A','POST','/api/v1/student-access/requests',
        {...body,reason_zh:'这次修改了申请原因'},k);
      assert.equal(altered.status,409);
      assert.ok(!(await visibility(readB)).includes(studentA));
      assert.ok(!(await visibility(readB)).includes(sibling));
      const list=await call('M','GET','/api/v1/student-access/requests');
      assert.equal(list.status,200);
      const item=list.data.items.find(x=>x.request_id===shareId);
      assert.equal(item.status_zh,'待独立审批');
      assert.ok(!JSON.stringify(item).includes('模拟授权审核材料'));
      assert.ok(!JSON.stringify(item).includes('儿童私密信息'));
    });

    await t.test('requester cannot approve, manager approval makes B see only student A',async()=>{
      const self=await call('A','POST','/api/v1/student-access/requests/'+shareId+'/decision',
        {decision:'approved',evidence_ref:'模拟审核记录',reason_zh:'申请人不能自批'});
      assert.equal(self.status,403);
      const approved=await decide(shareId,'approved');
      assert.equal(approved.status,200);assert.equal(approved.data.status_zh,'已批准');
      const view=await visibility(readB);
      assert.ok(view.includes(studentA));
      assert.ok(view.includes(studentB));
      assert.ok(!view.includes(sibling),'same parent must not open sibling');
      const grants=await call('A','GET','/api/v1/student-access/grants');
      assert.equal(grants.status,200);
      const g=grants.data.items.find(x=>x.student_name&&x.status_zh==='有效');
      assert.ok(g?.grant_id);
      shareId=g.grant_id;
      const noFamily=await owner.query(
        'SELECT COUNT(*)::int AS n FROM ms.family_memberships '+
        'WHERE student_id=ANY($1::uuid[]) AND revoked_at IS NULL',
        [[studentA,sibling]]);
      assert.equal(noFamily.rows[0].n,0,
        'sharing one of these children must not create a family membership for either');
    });

    await t.test('authorized owner or grantee can revoke one share, but not sibling/financial rights',async()=>{
      const r=await call('B','POST','/api/v1/student-access/grants/'+shareId+'/revoke',
        {reason_zh:'被授权员工取消自身查看权限'});
      assert.equal(r.status,200);
      assert.equal(r.data.status_zh,'已撤销');
      assert.ok(!(await visibility(readB)).includes(studentA));
      assert.ok(!(await visibility(readB)).includes(sibling));
      const data=await owner.query(
        "SELECT COUNT(*)::int AS n FROM ms.student_access_revocations WHERE grant_id=$1",[shareId]);
      assert.equal(data.rows[0].n,1);
    });

    await t.test('independent approval for a short-lived second share, expiry removes visibility without cron',async()=>{
      const expiry=new Date(Date.now()+2700).toISOString();
      const created=await call('A','POST','/api/v1/student-access/requests',share(expiry));
      assert.equal(created.status,200);
      const approved=await decide(created.data.request_id,'approved');
      assert.equal(approved.status,200);
      assert.ok((await visibility(readB)).includes(studentA));
      await sleep(2850);
      assert.ok(!(await visibility(readB)).includes(studentA));
      const all=await call('A','GET','/api/v1/student-access/grants');
      assert.ok(all.data.items.some(x=>x.status_zh==='已到期'));
    });

    await t.test('owner change is high risk, remains pending and cannot be approved after manager role revoked',async()=>{
      const proposed=await call('A','POST','/api/v1/student-access/requests',transfer());
      assert.equal(proposed.status,200);
      const id=proposed.data.request_id;
      const original=await owner.query('SELECT owner_user_id,version FROM ms.students WHERE id=$1',[studentA]);
      assert.equal(original.rows[0].owner_user_id,A);
      await owner.query("UPDATE ms.user_role_grants SET revoked_at=now() WHERE user_id=$1",[M]);
      const forbidden=await decide(id,'approved');
      assert.equal(forbidden.status,403);
      const unchanged=await owner.query('SELECT owner_user_id FROM ms.students WHERE id=$1',[studentA]);
      assert.equal(unchanged.rows[0].owner_user_id,A);
      await owner.query('UPDATE ms.user_role_grants SET revoked_at=NULL WHERE user_id=$1',[M]);
      const approved=await decide(id,'approved');
      assert.equal(approved.status,200);
      const after=await owner.query('SELECT owner_user_id,version FROM ms.students WHERE id=$1',[studentA]);
      assert.equal(after.rows[0].owner_user_id,B);
      assert.equal(Number(after.rows[0].version),Number(original.rows[0].version)+1);
      const changed=await owner.query(
        'SELECT previous_owner_id,new_owner_id FROM ms.student_owner_changes WHERE student_id=$1',[studentA]);
      assert.equal(changed.rows[0].previous_owner_id,A);
      assert.equal(changed.rows[0].new_owner_id,B);
      assert.ok((await visibility(readB)).includes(studentA));
      assert.ok(!(await visibility(readA)).includes(studentA));
      assert.ok((await visibility(readA)).includes(sibling));
    });

    await t.test('student transfer preserves lead, opportunity, parent relationship and any money status',async()=>{
      const money=await owner.query(
        'SELECT owner_user_id,predicted_amount_cents FROM ms.opportunities WHERE id=$1',[opp]);
      assert.equal(money.rows[0].owner_user_id,A);
      assert.equal(Number(money.rows[0].predicted_amount_cents),57000);
      const leadOwner=await owner.query('SELECT owner_user_id FROM ms.leads WHERE id=$1',[lead]);
      assert.equal(leadOwner.rows[0].owner_user_id,A);
      const rel=await owner.query(
        'SELECT student_id FROM ms.student_contacts WHERE contact_id=$1',[contact]);
      assert.equal(rel.rowCount,2);
      assert.ok(rel.rows.some(x=>x.student_id===sibling));
    });

    await t.test('requester, non-owner and cross-organization attempts are denied',async()=>{
      const wrong=await call('A','POST','/api/v1/student-access/requests',
        {action:'transfer',student_id:sibling,target_staff_id:
          '20000000-0000-4000-8000-000000000021',
          evidence_ref:'虚构跨机构材料',reason_zh:'不能转交其他机构'});
      assert.equal(wrong.status,422);
      const nonowner=await call('A','POST','/api/v1/student-access/requests',transfer());
      assert.equal(nonowner.status,403);
      const bad=await call('B','POST','/api/v1/student-access/requests',
        {action:'share',student_id:studentA,target_staff_id:B,
          expires_at:new Date(Date.now()+5000).toISOString(),
          evidence_ref:'自分享材料',reason_zh:'禁止给本人共享'});
      assert.equal(bad.status,422);
    });

    await t.test('immutable decisions and owner change history resist admin UPDATE and DELETE',async()=>{
      await assert.rejects(owner.query(
        "UPDATE ms.student_access_decisions SET reason_zh='篡改' WHERE true"),e=>e.code==='23514');
      await assert.rejects(owner.query(
        "DELETE FROM ms.student_owner_changes WHERE student_id=$1",[studentA]),e=>e.code==='23514');
      const events=await owner.query(
        "SELECT reason_zh FROM ms.audit_events WHERE target_id=$1 "+
        "AND event_name LIKE 'STUDENT_%' ORDER BY happened_at",[studentA]);
      assert.ok(events.rowCount>=4);
      assert.ok(events.rows.every(x=>typeof x.reason_zh==='string'&&x.reason_zh.length>2));
    });

    await t.test('revoked external identity immediately denies current access actions',async()=>{
      await owner.query("UPDATE ms.staff_identity_bindings SET revoked_at=now() "+
        "WHERE issuer=$1 AND subject=$2 AND revoked_at IS NULL",[issuer,subjectA]);
      assert.equal((await call('A','GET','/api/v1/student-access/requests')).status,403);
      assert.equal((await call('A','POST','/api/v1/student-access/requests',transfer())).status,403);
      assert.equal((await call('M','GET','/api/v1/student-access/requests')).status,200);
    });
  }finally{
    await Promise.allSettled(Object.values(apps).filter(s=>s.listening).map(stop));
    await Promise.all([owner.end(),accessA.end(),accessB.end(),accessM.end(),readA.end(),readB.end()]);
  }
});
