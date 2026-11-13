import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';
import {createApp} from '../../src/app.mjs';

const staffA='20000000-0000-4000-8000-000000000011';
const staffB='20000000-0000-4000-8000-000000000012';
const org='20000000-0000-4000-8000-000000000001';
const secret='fictional-test-only-strong-token-secret-9c92789dc3b9';
const passphrase='fictional-strong-ui-demo-passphrase-0001';
test('V3.2-04 field-level projection: delegated visibility does not expose student grade',async()=>{
  process.env.MS_STAGE='isolated-test';
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:5});
  const app=createApp(pool,{secret,issuer:'market-sales-test-issuer',devLoginSecret:passphrase});
  await new Promise(ok=>app.listen(0,'127.0.0.1',ok));
  const url='http://127.0.0.1:'+app.address().port;
  let grantId;
  try{
    const login=async account=>{
      const r=await fetch(url+'/api/v1/dev/login',{method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({account_code:account,passphrase})});
      assert.equal(r.status,200);
      return (await r.json()).data.token;
    };
    const a=await login('sales-a'),b=await login('sales-b');
    const name='虚构跨销售字段权限学生-'+randomUUID();
    const inserted=await fetch(url+'/api/v1/students',{method:'POST',
      headers:{Authorization:'Bearer '+a,'Content-Type':'application/json',
        'Idempotency-Key':randomBytes(18).toString('hex')},
      body:JSON.stringify({display_name:name,grade_label:'私有六年级'})});
    assert.equal(inserted.status,200);
    const student=(await inserted.json()).data.student_id;
    const prior=await fetch(url+'/api/v1/students',{headers:{Authorization:'Bearer '+b}});
    assert.equal(prior.status,200);
    assert.equal((await prior.json()).data.items.some(x=>x.student_id===student),false);
    const g=await pool.query(
      "INSERT INTO ms.data_scope_grants(user_id,resource_type,scope_type,scope_ref,granted_by) "+
      "VALUES($1,'student','specific',$2,$3) RETURNING id",
      [staffB,student,staffA]);
    grantId=g.rows[0].id;
    const owner=await fetch(url+'/api/v1/students',{headers:{Authorization:'Bearer '+a}});
    const ownerRow=(await owner.json()).data.items.find(x=>x.student_id===student);
    assert.equal(ownerRow.grade_label,'私有六年级');
    const scoped=await fetch(url+'/api/v1/students',{headers:{Authorization:'Bearer '+b}});
    const scopedRow=(await scoped.json()).data.items.find(x=>x.student_id===student);
    assert.equal(scopedRow.display_name,name);
    assert.equal(scopedRow.grade_label,'已隐藏');
    assert.ok(!JSON.stringify(scopedRow).includes('私有六年级'));
    await pool.query('UPDATE ms.data_scope_grants SET revoked_at=now() WHERE id=$1',[grantId]);
    const after=await fetch(url+'/api/v1/students',{headers:{Authorization:'Bearer '+b}});
    assert.equal((await after.json()).data.items.some(x=>x.student_id===student),false);
  }finally{
    if(grantId)await pool.query('UPDATE ms.data_scope_grants SET revoked_at=now() WHERE id=$1',[grantId]);
    await new Promise(ok=>app.close(ok));await pool.end();
  }
});
