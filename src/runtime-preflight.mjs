// Isolated-test startup gate. This does not certify production IAM/RLS completeness.
// Prevents accidental use of DB owner/superuser credentials when opted in.
export async function assertRestrictedRuntime(pool){
  const result=await pool.query(
    "SELECT current_user AS role_name,r.rolsuper,r.rolbypassrls,r.rolcreatedb,r.rolcreaterole,"+
    "pg_has_role(current_user,'ms_lowrisk_runtime','member') AS member,"+
    "has_schema_privilege(current_user,'ms','CREATE') AS can_ddl,"+
    "has_table_privilege(current_user,'ms.sales_orders','SELECT') AS can_finance,"+
    "c.relrowsecurity AS students_rls,"+
    "(c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)) AS owns_students "+
    "FROM pg_roles r CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "+
    "WHERE r.rolname=current_user AND n.nspname='ms' AND c.relname='students'");
  const row=result.rows[0];
  if(!row||row.rolsuper||row.rolbypassrls||row.rolcreatedb||row.rolcreaterole||
    !row.member||row.can_ddl||row.can_finance||!row.students_rls||row.owns_students)
    throw new Error('Isolated runtime refuses owner/elevated DB credentials or missing tenant RLS');
  return {role:row.role_name,isolated:true};
}
