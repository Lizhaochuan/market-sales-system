// V3.2-08: read-only routing directory backed by approved employee binding.
// A dedicated PostgreSQL LOGIN can execute exactly the tenant lookup function.
// No raw employee, subject list, role, finance or audit table privileges.
export async function assertApprovedRouteReader(pool){
  if(process.env.MS_STAGE!=='isolated-test')
    throw new Error('Approved identity directory is isolated-test only');
  const r=await pool.query(
    "SELECT current_user AS login,session_user AS principal,rolsuper,rolbypassrls,"+
    "has_function_privilege(current_user,'ms.approved_identity_tenant(text,text)','EXECUTE') AS route_ok,"+
    "has_table_privilege(current_user,'ms.staff_identity_bindings','SELECT') AS raw_bindings,"+
    "has_table_privilege(current_user,'ms.staff_users','SELECT') AS raw_staff,"+
    "has_table_privilege(current_user,'ms.identity_change_decisions','SELECT') AS raw_decisions,"+
    "has_table_privilege(current_user,'ms.sales_orders','SELECT') AS finance "+
    "FROM pg_roles WHERE rolname=current_user");
  const x=r.rows[0];
  if(!x||x.login!==x.principal||x.rolsuper||x.rolbypassrls||
    !x.route_ok||x.raw_bindings||x.raw_staff||x.raw_decisions||x.finance)
    throw new Error('Route directory requires separate lookup-only nonowner LOGIN');
  return {login:x.login,approved_lookup:true};
}
export function createApprovedIdentityDirectory(pool){
  if(process.env.MS_STAGE!=='isolated-test'||!pool||typeof pool.query!=='function')
    throw new Error('Approved identity route requires isolated read-only directory pool');
  return async (issuer,subject)=>{
    if(typeof issuer!=='string'||typeof subject!=='string'||
      issuer.length>255||subject.length>255||!issuer.startsWith('https://'))
      return null;
    const r=await pool.query(
      'SELECT ms.approved_identity_tenant($1,$2) AS organization_id',
      [issuer,subject]);
    return r.rows[0]?.organization_id||null;
  };
}
