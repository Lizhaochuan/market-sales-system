import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';

const orgA='20000000-0000-4000-8000-000000000001';
const orgB='20000000-0000-4000-8000-000000000002';
const staffA='20000000-0000-4000-8000-000000000011';
const staffB='20000000-0000-4000-8000-000000000021';

test('V3.2-07: separate directory-only DB login has a protected column projection',async t=>{
  const owner=new pg.Pool({connectionString:process.env.DATABASE_URL,max:3});
  const a=new pg.Pool({connectionString:process.env.DATABASE_URL_DIRECTORY_A,max:3});
  const b=new pg.Pool({connectionString:process.env.DATABASE_URL_DIRECTORY_B,max:3});
  const nameA='私有年级虚构学生A-'+randomUUID();
  const nameB='私有年级虚构学生B-'+randomUUID();
  try{
    await owner.query(
      "INSERT INTO ms.students(organization_id,display_name,grade_label,owner_user_id) "+
      "VALUES($1,$2,'A机构私密年级',$3),($4,$5,'B机构私密年级',$6)",
      [orgA,nameA,staffA,orgB,nameB,staffB]);
    await t.test('view-only readers inherit no base table or finance rights',async()=>{
      for(const [pool,expected] of [[a,'ms_directory_reader_a'],[b,'ms_directory_reader_b']]){
        const r=await pool.query(
          "SELECT current_user AS role, "+
          "has_table_privilege(current_user,'ms.student_directory_public','SELECT') AS view_ok,"+
          "has_table_privilege(current_user,'ms.students','SELECT') AS table_ok,"+
          "has_table_privilege(current_user,'ms.staff_users','SELECT') AS staff_ok,"+
          "has_table_privilege(current_user,'ms.sales_orders','SELECT') AS finance_ok");
        assert.equal(r.rows[0].role,expected);
        assert.equal(r.rows[0].view_ok,true);
        assert.equal(r.rows[0].table_ok,false);
        assert.equal(r.rows[0].staff_ok,false);
        assert.equal(r.rows[0].finance_ok,false);
      }
    });
    await t.test('direct view SELECT is fixed to the authenticated database LOGIN tenant',async()=>{
      const qa=await a.query('SELECT * FROM ms.student_directory_public');
      const qb=await b.query('SELECT * FROM ms.student_directory_public');
      assert.ok(qa.rows.some(x=>x.display_name===nameA));
      assert.ok(!qa.rows.some(x=>x.display_name===nameB));
      assert.ok(qb.rows.some(x=>x.display_name===nameB));
      assert.ok(!qb.rows.some(x=>x.display_name===nameA));
      assert.deepEqual(Object.keys(qa.rows.find(x=>x.display_name===nameA)).sort(),
        ['display_name','organization_id','student_id']);
      assert.equal(qa.rows.find(x=>x.display_name===nameA).organization_id,orgA);
      assert.equal(qb.rows.find(x=>x.display_name===nameB).organization_id,orgB);
      assert.ok(!JSON.stringify(qa.rows).includes('私密年级'));
    });
    await t.test('reader cannot query base grade, contacts or change students',async()=>{
      await assert.rejects(a.query('SELECT grade_label FROM ms.students'),e=>e.code==='42501');
      await assert.rejects(b.query('SELECT * FROM ms.contacts'),e=>e.code==='42501');
      await assert.rejects(a.query('UPDATE ms.students SET display_name=display_name WHERE false'),e=>e.code==='42501');
      await assert.rejects(a.query('SELECT grade_label FROM ms.student_directory_public'),e=>e.code==='42703');
      await assert.rejects(a.query('SET ROLE ms_lowrisk_runtime'),e=>e.code==='42501');
    });
    await t.test('legacy organization parameter cannot spoof a view-only tenant',async()=>{
      const c=await b.connect();
      try{
        await c.query('BEGIN');
        await c.query("SELECT set_config('ms.tenant_org',$1,true)",[orgA]);
        const result=await c.query('SELECT display_name FROM ms.student_directory_public');
        assert.ok(result.rows.some(x=>x.display_name===nameB));
        assert.ok(!result.rows.some(x=>x.display_name===nameA));
      }finally{
        await c.query('ROLLBACK');c.release();
      }
    });
  }finally{await Promise.all([owner.end(),a.end(),b.end()]);}
});
