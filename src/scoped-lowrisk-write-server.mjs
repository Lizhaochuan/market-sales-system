// V3.2-12 optional isolated staff-owned student/contact write service.
// Separate function-only DB LOGIN; never run with owner or org-wide runtime.
import pg from 'pg';
import {createScopedLowriskWriteApi,assertScopedLowriskWriter}
  from './scoped-lowrisk-write-api.mjs';

if(process.env.MS_STAGE!=='isolated-test')
  throw new Error('Scoped low-risk service is isolated-test only');
if(!process.env.DATABASE_URL||!process.env.OIDC_ISSUER||
  !process.env.OIDC_AUDIENCE||!process.env.OIDC_JWKS_JSON)
  throw new Error('Staff DB URL and public identity issuer/audience/JWKS required');
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:4});
try{await assertScopedLowriskWriter(pool);}
catch(e){await pool.end();throw e;}
const port=Number(process.env.PORT||3400);
if(!Number.isInteger(port)||port<1024||port>65535)
  throw new Error('Invalid local port');
const server=createScopedLowriskWriteApi(pool,{
  externalIdentity:{
    issuer:process.env.OIDC_ISSUER,
    audience:process.env.OIDC_AUDIENCE,
    jwks:JSON.parse(process.env.OIDC_JWKS_JSON)
  }
});
server.listen(port,'127.0.0.1',()=>
  console.log('Isolated function-only low-risk writer on loopback '+port));
const shutdown=async()=>{server.close();await pool.end();};
process.once('SIGINT',shutdown);
process.once('SIGTERM',shutdown);
