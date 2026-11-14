import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';

const A='20000000-0000-4000-8000-000000000011';
const B='20000000-0000-4000-8000-000000000012';
const M='20000000-0000-4000-8000-000000000013';
const org='20000000-0000-4000-8000-000000000001';
const key=()=>randomBytes(20).toString('hex');
const db=(name)=>new pg.Pool({connectionString:process.env[name],max:2});
async function fn(pool,sql,args){return (await pool.query(sql,args)).rows[0].result;}
test('V3.2-16 staff-only custody withdrawal, evidence review, immediate DB projection and student granularity',async t=>{
  const admin=db('DATABASE_URL'),wa=db('DATABASE_URL_WRITE_A'),
    wb=db('DATABASE_URL_WRITE_B'),wm=db('DATABASE_URL_WRITE_MANAGER'),
    ra=db('DATABASE_URL_ASSIGNEE_A'),rb=db('DATABASE_URL_ASSIGNEE_B');
  let cid,sid,rid,assignment,review;
  try{
    await t.test('raw custody, student and money remain denied to actual employee LOGINs',async()=>{
      for(const p of [wa,wb,wm,ra,rb]){
        for(const sql of ['SELECT * FROM ms.contact_custody_review_decisions',
          'SELECT * FROM ms.contact_custody_reviews',
          'SELECT * FROM ms.students','SELECT * FROM ms.sales_orders']){
          await assert.rejects(p.query(sql),e=>e.code==='42501',sql);
        }
      }
    });
    await t.test('A creates own fictional contact/student and unverified relation stays invisible to B',async()=>{
      const c=await fn(wa,'SELECT ms.create_scoped_contact($1,$2,$3) AS result',
        ['测试撤回联系人-'+randomUUID(),false,key()]);
      const s=await fn(wa,'SELECT ms.create_scoped_student($1,$2,$3,$4) AS result',
        ['测试学生-'+randomUUID(),'五年级',null,key()]);
      cid=c.contact_id;sid=s.student_id;
      const rel=await fn(wa,
        'SELECT ms.link_scoped_student_contact($1,$2,$3,$4) AS result',
        [sid,cid,'母亲',key()]);
      assert.equal(rel.verification_state,'unverified');
      assert.equal((await rb.query('SELECT * FROM ms.scoped_related_student_basic WHERE student_id=$1',[sid])).rowCount,0);
      assert.equal((await rb.query('SELECT * FROM ms.scoped_legacy_student_details WHERE student_id=$1',[sid])).rowCount,0);
    });
    await t.test('A requests custody and independent M approves B; B gets only current contact',async()=>{
      rid=await fn(wa,
        'SELECT ms.request_scoped_contact_custody($1,$2,$3,$4,$5) AS result',
        [cid,B,'测试授权证据','双方同意交接',key()]);
      assert.equal(await fn(wm,
        'SELECT ms.decide_scoped_contact_custody($1,$2,$3,$4,$5) AS result',
        [rid,'approved','主管已核查','核实本次交接',key()]),'已批准');
      const as=await admin.query(
        'SELECT id,assignee_id,prior_custodian_id FROM ms.contact_custody_assignments WHERE contact_id=$1 AND revoked_at IS NULL',
        [cid]);
      assert.equal(as.rowCount,1);assignment=as.rows[0].id;
      assert.equal(as.rows[0].assignee_id,B);
      assert.equal(as.rows[0].prior_custodian_id,A);
      assert.equal((await rb.query('SELECT * FROM ms.scoped_contacts_directory WHERE contact_id=$1',[cid])).rowCount,1);
      assert.equal((await rb.query('SELECT * FROM ms.scoped_related_student_basic WHERE student_id=$1',[sid])).rowCount,0);
    });
    await t.test('only parties may request withdrawal; B or A cannot self-approve; independent M reverses',async()=>{
      const args=[assignment,'withdrawal','虚构争议材料','希望撤回管理权',key()];
      const forbidden=await admin.query('SELECT id FROM ms.contact_custody_review_decisions LIMIT 1');
      assert.ok(forbidden);
      review=await fn(wb,'SELECT ms.request_custody_review($1,$2,$3,$4,$5) AS result',args);
      assert.equal(await fn(wb,'SELECT ms.request_custody_review($1,$2,$3,$4,$5) AS result',args),review);
      await assert.rejects(wb.query(
        'SELECT ms.decide_custody_review($1,$2,$3,$4,$5)',
        [review,'reversed','本人意见','自己批准撤回',key()]),e=>e.code==='42501');
      await assert.rejects(wa.query(
        'SELECT ms.decide_custody_review($1,$2,$3,$4,$5)',
        [review,'reversed','本人意见','自己批准撤回',key()]),e=>e.code==='42501');
      assert.equal(await fn(wm,
        'SELECT ms.decide_custody_review($1,$2,$3,$4,$5) AS result',
        [review,'reversed','虚构复核证明','独立主管核准撤回',key()]),'已撤回');
      const rows=await admin.query(
        'SELECT assignee_id,review_id FROM ms.contact_custody_assignments WHERE contact_id=$1 AND revoked_at IS NULL',[cid]);
      assert.equal(rows.rowCount,1);
      assert.equal(rows.rows[0].assignee_id,A);
      assert.equal(rows.rows[0].review_id,review);
      assert.equal((await rb.query('SELECT * FROM ms.scoped_contacts_directory WHERE contact_id=$1',[cid])).rowCount,0);
      assert.equal((await ra.query('SELECT * FROM ms.scoped_contacts_directory WHERE contact_id=$1',[cid])).rowCount,1);
      await assert.rejects(wb.query(
        'SELECT ms.create_scoped_contact_consultation($1,$2,$3,$4)',
        [cid,'线上咨询',new Date(Date.now()-60000),key()]),e=>e.code==='42501');
      await assert.rejects(admin.query(
        "UPDATE ms.contact_custody_review_decisions SET reason_zh='篡改' WHERE review_id=$1",[review]),
        e=>e.code==='23514');
    });
    await t.test('verified relation gives ONLY minimal student fields to current custodian',async()=>{
      await admin.query("UPDATE ms.student_contacts SET verification_state='verified',verified_at=now() WHERE student_id=$1 AND contact_id=$2",[sid,cid]);
      const cols=(await ra.query('SELECT * FROM ms.scoped_related_student_basic WHERE student_id=$1',[sid])).rows;
      assert.equal(cols.length,1);
      assert.deepEqual(Object.keys(cols[0]).sort(),['contact_relation','student_id','student_name']);
      assert.equal((await rb.query('SELECT * FROM ms.scoped_related_student_basic WHERE student_id=$1',[sid])).rowCount,0);
      assert.equal((await admin.query('SELECT owner_user_id FROM ms.students WHERE id=$1',[sid])).rows[0].owner_user_id,A);
    });
    await t.test('fresh dispute preserves custody if independent manager upholds',async()=>{
      const live=(await admin.query('SELECT id FROM ms.contact_custody_assignments WHERE contact_id=$1 AND revoked_at IS NULL',[cid])).rows[0].id;
      const d=await fn(wa,'SELECT ms.request_custody_review($1,$2,$3,$4,$5) AS result',
        [live,'dispute','虚构争议证明','争议提交复核',key()]);
      assert.equal(await fn(wm,'SELECT ms.decide_custody_review($1,$2,$3,$4,$5) AS result',
        [d,'upheld','独立调查材料','当前管理权继续有效',key()]),'已完成复核');
      assert.equal((await admin.query('SELECT COUNT(*)::int AS n FROM ms.contact_custody_assignments WHERE contact_id=$1 AND revoked_at IS NULL',[cid])).rows[0].n,1);
    });
  }finally{await Promise.all([admin,wa,wb,wm,ra,rb].map(p=>p.end()));}
});
