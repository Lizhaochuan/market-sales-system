// V3.2-01: isolated-test-only process. NEVER expose on the public Internet.
import pg from 'pg';
import { createApp } from './app.mjs';
import { assertRestrictedRuntime } from './runtime-preflight.mjs';
import { initializeStrictStaffPools } from './strict-staff-pools.mjs';
import { assertStrictIdentityDirectory } from './strict-auth-directory.mjs';

if(process.env.MS_STAGE!=='isolated-test'){
  throw new Error('This backend is test-only. Production identity provider and tenant authorization are not ready.');
}
const secret=process.env.AUTH_HMAC_SECRET;
if(!secret||secret.length<32)throw new Error('Set a strong isolated-test-only AUTH_HMAC_SECRET');
const strictStaffMode=process.env.MS_STRICT_STAFF_MODE==='1';
const workspaceEnabled=process.env.MS_ENABLE_ISOLATED_WORKSPACE==='1';
if(workspaceEnabled&&strictStaffMode)
 throw new Error('Use separate disposable demo and strict employee services; planning workspace cannot bypass strict mode');
if(!strictStaffMode&&!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL required for the legacy isolated demonstration');
// Strict mode never constructs a connection to the old broader business DB.
const pool=strictStaffMode?
  {connect(){throw new Error('Strict employee mode forbids legacy DB connections');}}:
  new pg.Pool({connectionString:process.env.DATABASE_URL,max:8});
if(!strictStaffMode&&process.env.MS_REQUIRE_RESTRICTED_DB==='1')
  await assertRestrictedRuntime(pool);
if(workspaceEnabled){
 const check=await pool.query("SELECT current_database() AS db,to_regclass('ms_workspace.history') AS fixture");
 if(!['ms_test','ms_workspace_test'].includes(check.rows[0]?.db)||!check.rows[0]?.fixture){
  await pool.end();throw new Error('Planning workspace requires the dedicated disposable test database and fixture');
 }
}
// This adapter verifies external OIDC access-token signatures, but is not a
// production identity deployment. Configuration must be supplied as one unit.
const oidcVars=['OIDC_ISSUER','OIDC_AUDIENCE','OIDC_JWKS_JSON'];
const supplied=oidcVars.filter(key=>process.env[key]);
if(supplied.length>0&&supplied.length!==oidcVars.length)
  throw new Error('External OIDC verification requires issuer, audience and trusted public JWKS together');
const externalIdentity=supplied.length===3?{
  issuer:process.env.OIDC_ISSUER,
  audience:process.env.OIDC_AUDIENCE,
  jwks:JSON.parse(process.env.OIDC_JWKS_JSON)
}:undefined;
// Optional local-only strict rehearsal. Never honor employee pool URLs from
// requests, untrusted claims, browser input or the legacy organization JWT.
if(strictStaffMode&&!externalIdentity)
  throw new Error('Strict employee mode requires external RS256 issuer, audience and pinned public JWKS');
if(strictStaffMode&&(!process.env.MS_STAFF_READ_URLS_JSON||
  !process.env.MS_STAFF_WRITE_URLS_JSON))
  throw new Error('Strict mode requires both per-employee read and write database pools');
let strictPools,identityDirectoryPool;
if(strictStaffMode){
  if(!process.env.DATABASE_URL_AUTH_DIRECTORY)
    throw new Error('Strict employee mode requires function-only identity directory LOGIN');
  identityDirectoryPool=new pg.Pool({
    connectionString:process.env.DATABASE_URL_AUTH_DIRECTORY,max:4
  });
  try{
    await assertStrictIdentityDirectory(identityDirectoryPool);
    strictPools=await initializeStrictStaffPools({
      readUrlsJson:process.env.MS_STAFF_READ_URLS_JSON,
      writeUrlsJson:process.env.MS_STAFF_WRITE_URLS_JSON
    });
  }catch(e){
    await identityDirectoryPool.end();
    throw e;
  }
}
const server=createApp(pool,{
  workspaceEnabled,
  secret,issuer:process.env.AUTH_ISSUER||'market-sales-test-issuer',
  devLoginSecret:strictStaffMode?undefined:process.env.DEV_LOGIN_SECRET,
  externalIdentity,
  strictStaffMode,
  identityDirectoryPool,
  ...(strictPools?{
    scopedReadPools:strictPools.scopedReadPools,
    scopedWritePools:strictPools.scopedWritePools
  }:{})
});
const port=Number(process.env.PORT||3100);
server.listen(port,'127.0.0.1',()=>{console.log('Market-sales isolated backend listening on loopback '+port);});
const shutdown=async()=>{server.close();if(!strictStaffMode)await pool.end();if(strictPools)await strictPools.close();if(identityDirectoryPool)await identityDirectoryPool.end();};
process.on('SIGINT',shutdown);
process.on('SIGTERM',shutdown);

