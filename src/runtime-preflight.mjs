// V3.2-06 isolated-only DB runtime gate. Production authentication remains disabled.
// A PostgreSQL SESSION_USER is mapped to ONE tenant by an admin-owned protected
// table, not by a client-settable custom GUC or user-supplied JWT claim.
const protectedTables=[
  'organizations','staff_users','role_templates','user_role_grants','data_scope_grants',
  'field_policies','marketing_channels','students','contacts','student_contacts',
  'contact_events','leads','lead_students','opportunities','interactions',
  'interaction_subjects','family_groups','family_memberships','family_review_decisions',
  'staff_identity_bindings','identity_change_requests','identity_change_decisions',
  'audit_events','api_write_receipts'
];

export async function assertRestrictedRuntime(pool) {
  const result=await pool.query(
    "SELECT current_user AS role_name,session_user AS session_name,"+
    "r.rolsuper,r.rolbypassrls,r.rolcreatedb,r.rolcreaterole,r.rolinherit,"+
    "pg_has_role(current_user,'ms_lowrisk_runtime','member') AS member,"+
    "has_schema_privilege(current_user,'ms','CREATE') AS can_ddl,"+
    "has_table_privilege(current_user,'ms.sales_orders','SELECT') AS can_finance,"+
    "has_table_privilege(current_user,'ms.database_principal_tenants','SELECT') AS can_read_mapping,"+
    "has_table_privilege(current_user,'ms.database_principal_tenants','UPDATE') AS can_change_mapping,"+
    "ms.current_database_tenant() AS tenant_id "+
    "FROM pg_roles r WHERE r.rolname=current_user"
  );
  const row=result.rows[0];
  if(!row||row.role_name!==row.session_name||
     row.rolsuper||row.rolbypassrls||row.rolcreatedb||row.rolcreaterole||
     !row.rolinherit||!row.member||row.can_ddl||row.can_finance||
     row.can_read_mapping||row.can_change_mapping||!row.tenant_id)
    throw new Error('Isolated runtime refuses DB owner/elevated or unmapped tenant LOGIN');

  const flags=await pool.query(
    "SELECT c.relname,c.relrowsecurity FROM pg_class c "+
    "JOIN pg_namespace n ON n.oid=c.relnamespace "+
    "WHERE n.nspname='ms' AND c.relname=ANY($1::text[])",
    [protectedTables]);
  if(flags.rowCount!==protectedTables.length||
     flags.rows.some(r=>r.relrowsecurity!==true))
    throw new Error('Isolated runtime refuses missing tenant RLS table coverage');

  return {role:row.role_name,tenant_id:row.tenant_id,isolated:true,
    protected_table_count:flags.rowCount};
}
