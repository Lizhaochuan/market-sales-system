// V3.2-13 isolated trusted server startup: one PostgreSQL LOGIN per employee.
// URLs are supplied by a local operator, never by browser, JWT or user data.
// Failure in ANY pool aborts startup. The main org-identity/legacy pool is
// separate and cannot be used as fallback for migrated POST/GET routes.
import pg from 'pg';
import {assertScopedReadPool} from './scoped-employee-read-api.mjs';
import {assertScopedLowriskWriter} from './scoped-lowrisk-write-api.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function parseUrls(value,label){
  let urls;
  try{urls=JSON.parse(value);}catch{throw Error(label+' must be JSON array');}
  if(!Array.isArray(urls)||!urls.length||urls.length>25||
    urls.some(x=>typeof x!=='string'||!/^postgres(ql)?:\/\//.test(x)||
      x.length>4096))
    throw Error(label+' must contain 1-25 restricted PostgreSQL URLs');
  return urls;
}
export async function initializeStrictStaffPools({
  readUrlsJson,writeUrlsJson,Pool=pg.Pool
}={}){
  if(process.env.MS_STAGE!=='isolated-test')
    throw Error('Strict employee pool registry is isolated-test only');
  const created=[],reads=new Map(),writes=new Map(),readOrgs=new Map(),writeOrgs=new Map();
  try{
    for(const [group,name,json,preflight,store,orgs] of [
      ['read','MS_STAFF_READ_URLS_JSON',readUrlsJson,assertScopedReadPool,reads,readOrgs],
      ['write','MS_STAFF_WRITE_URLS_JSON',writeUrlsJson,assertScopedLowriskWriter,writes,writeOrgs]
    ]){
      for(const connectionString of parseUrls(json,name)){
        const pool=new Pool({connectionString,max:3});
        created.push(pool);
        await preflight(pool); // no raw table access, no superuser or BYPASSRLS
        const r=await pool.query(
          'SELECT ms.current_scoped_staff_id() AS staff_id,'+
          'ms.current_scoped_organization_id() AS org_id');
        const {staff_id,org_id}=r.rows[0]||{};
        if(!UUID.test(staff_id||'')||!UUID.test(org_id||'')||store.has(staff_id))
          throw Error('Duplicate or invalid employee mapping in '+group+' pool');
        store.set(staff_id,pool);orgs.set(staff_id,org_id);
      }
    }
    // No employee may have a write-only main-page identity: the read views
    // must also use their separate read-only LOGIN, not org-wide fallback.
    if(reads.size!==writes.size)
      throw Error('Strict employee read/write pool memberships must match');
    for(const [staff,org] of readOrgs){
      if(!writes.has(staff)||writeOrgs.get(staff)!==org)
        throw Error('Strict employee role and organization pair mismatch');
    }
    return {
      scopedReadPools:reads,scopedWritePools:writes,
      async close(){await Promise.allSettled(created.map(p=>p.end()));}
    };
  }catch(error){
    await Promise.allSettled(created.map(p=>p.end()));
    throw error;
  }
}
