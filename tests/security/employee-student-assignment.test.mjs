import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';

const org='20000000-0000-4000-8000-000000000001';
const orgB='20000000-0000-4000-8000-000000000002';
const staffA='20000000-0000-4000-8000-000000000011';
const staffB='20000000-0000-4000-8000-000000000012';
const staffOther='20000000-0000-4000-8000-000000000021';

test('V3.2-08: two employees in one org have distinct SQL-level scoped student directory',async t=>{
  const owner=new pg.Pool({connectionString:process.env.DATABASE_URL,max:3});
  const a=new pg.Pool({connectionString:process.env.DATABASE_URL_ASSIGNEE_A,max:3});
  const b=new pg.Pool({connectionString:process.env.DATABASE_URL_ASSIGNEE_B,max:3});
  let grantId;
  const labelA='销售A专属学生-'+randomUUID();
  const labelB='销售B专属学生-'+randomUUID();
  const labelOther='外机构学生-'+randomUUID();
  try{
    const s=await owner.query(
      "INSERT INTO ms.students(organization_id,display_name,grade_label,owner_user_id) "+
      "VALUES($1,$2,'仅A可查的敏感年级',$3),"+
      "($1,$4,'仅B可查的敏感年级',$5),"+
      "($6,$7,'跨机构年级',$8) RETURNING id,display_name",
      [org,labelA,staffA,labelB,staffB,orgB,labelOther,staffOther]);
    const studentA=s.rows.find(x=>x.display_name===labelA).id;

    await t.test('employee logins have no raw student table, contact, grade, audit or finance access',async()=>{
      for(const [pool,expected] of [[a,'ms_assignee_reader_a'],[b,'ms_assignee_reader_b']]){
        const r=await pool.query(
          "SELECT current_user AS login, "+
          "has_table_privilege(current_user,'ms.student_directory_assigned','SELECT') AS scoped_view,"+
          "has_table_privilege(current_user,'ms.students','SELECT') AS raw_students,"+
          "has_table_privilege(current_user,'ms.staff_users','SELECT') AS staff_directory,"+
          "has_table_privilege(current_user,'ms.data_scope_grants','SELECT') AS raw_grants,"+
          "has_table_privilege(current_user,'ms.contacts','SELECT') AS contacts,"+
          "has_table_privilege(current_user,'ms.audit_events','SELECT') AS audit,"+
          "has_table_privilege(current_user,'ms.sales_orders','SELECT') AS finance");
        const x=r.rows[0];assert.equal(x.login,expected);
        assert.equal(x.scoped_view,true);
        for(const k of ['raw_students','staff_directory','raw_grants','contacts','audit','finance'])
          assert.equal(x[k],false,k+' must not be granted to '+expected);
      }
    });
    await t.test('each employee sees only own assigned student, never colleague/foreign org',async()=>{
      const aRows=(await a.query('SELECT * FROM ms.student_directory_assigned')).rows;
      const bRows=(await b.query('SELECT * FROM ms.student_directory_assigned')).rows;
      assert.ok(aRows.some(x=>x.display_name===labelA));
      assert.ok(!aRows.some(x=>x.display_name===labelB||x.display_name===labelOther));
      assert.ok(bRows.some(x=>x.display_name===labelB));
      assert.ok(!bRows.some(x=>x.display_name===labelA||x.display_name===labelOther));
      assert.deepEqual(Object.keys(aRows.find(x=>x.display_name===labelA)).sort(),
        ['display_name','organization_id','student_id']);
      assert.equal(aRows.find(x=>x.display_name===labelA).organization_id,org);
      assert.ok(!JSON.stringify(aRows).includes('敏感年级'));
    });
    await t.test('manager-authorized explicit specific student grant becomes visible to colleague immediately',async()=>{
      const q=await owner.query(
        "INSERT INTO ms.data_scope_grants(user_id,resource_type,scope_type,scope_ref,granted_by) "+
        "VALUES($1,'student','specific',$2,$3) RETURNING id",
        [staffB,studentA,staffA]);
      grantId=q.rows[0].id;
      const visible=(await b.query('SELECT student_id FROM ms.student_directory_assigned')).rows;
      assert.ok(visible.some(x=>x.student_id===studentA));
      const ownerRows=(await a.query('SELECT student_id FROM ms.student_directory_assigned')).rows;
      assert.ok(ownerRows.some(x=>x.student_id===studentA));
    });
    await t.test('revoking explicit grant immediately removes shared student without changing base owner',async()=>{
      await owner.query('UPDATE ms.data_scope_grants SET revoked_at=now() WHERE id=$1',[grantId]);
      const visible=(await b.query('SELECT student_id FROM ms.student_directory_assigned')).rows;
      assert.ok(!visible.some(x=>x.student_id===studentA));
      const ownerRows=(await a.query('SELECT student_id FROM ms.student_directory_assigned')).rows;
      assert.ok(ownerRows.some(x=>x.student_id===studentA));
    });
    await t.test('old role and org GUC spoofing cannot switch employee identity',async()=>{
      await assert.rejects(b.query('SET ROLE ms_student_assignee_reader'),e=>e.code==='42501');
      await assert.rejects(a.query('SELECT grade_label FROM ms.students'),e=>e.code==='42501');
      await assert.rejects(a.query('SELECT * FROM ms.database_principal_staff'),e=>e.code==='42501');
      const c=await b.connect();
      try{
        await c.query('BEGIN');
        await c.query("SELECT set_config('ms.tenant_org',$1,true)",[orgB]);
        await c.query("SELECT set_config('ms.staff_id',$1,true)",[staffA]);
        const rows=await c.query('SELECT display_name FROM ms.student_directory_assigned');
        assert.ok(rows.rows.some(x=>x.display_name===labelB));
        assert.ok(!rows.rows.some(x=>x.display_name===labelA||x.display_name===labelOther));
      }finally{
        await c.query('ROLLBACK');c.release();
      }
    });
  }finally{
    if(grantId)await owner.query("UPDATE ms.data_scope_grants SET revoked_at=now() WHERE id=$1",[grantId]);
    await Promise.all([owner.end(),a.end(),b.end()]);
  }
});
