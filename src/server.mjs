// V3.2-01: isolated-test-only process. NEVER expose on the public Internet.
import pg from 'pg';
import { createApp } from './app.mjs';
import { assertRestrictedRuntime } from './runtime-preflight.mjs';

if(process.env.MS_STAGE!=='isolated-test'){
  throw new Error('This backend is test-only. Production identity provider and tenant authorization are not ready.');
}
const secret=process.env.AUTH_HMAC_SECRET;
if(!secret||secret.length<32)throw new Error('Set a strong isolated-test-only AUTH_HMAC_SECRET');
if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL required');
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:8});
// A strict opt-in for isolated role rehearsals: reject owner, BYPASSRLS,
// finance-capable and schema-owner credentials BEFORE starting HTTP service.
if(process.env.MS_REQUIRE_RESTRICTED_DB==='1')
  await assertRestrictedRuntime(pool);
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
const server=createApp(pool,{
  secret,issuer:process.env.AUTH_ISSUER||'market-sales-test-issuer',
  devLoginSecret:process.env.DEV_LOGIN_SECRET,externalIdentity
});
const port=Number(process.env.PORT||3100);
server.listen(port,'127.0.0.1',()=>{console.log('Market-sales isolated backend listening on loopback '+port);});
const shutdown=async()=>{server.close();await pool.end();};
process.on('SIGINT',shutdown);
process.on('SIGTERM',shutdown);
