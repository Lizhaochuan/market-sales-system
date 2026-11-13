// V3.2-09 OPTIONAL local-only scoped read service. Do not publish to Internet.
// Requires separate employee PostgreSQL LOGIN, never the market sales DB owner.
import pg from 'pg';
import {createScopedEmployeeReadApi,assertScopedReadPool}
  from './scoped-employee-read-api.mjs';

if(process.env.MS_STAGE!=='isolated-test')
  throw new Error('Employee scoped read service is isolated-test only');
if(!process.env.DATABASE_URL||
   !process.env.OIDC_ISSUER||!process.env.OIDC_AUDIENCE||
   !process.env.OIDC_JWKS_JSON)
  throw new Error('Restricted DB URL and all trusted external signing parameters required');
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:4});
try{await assertScopedReadPool(pool);}
catch(e){await pool.end();throw e;}
const server=createScopedEmployeeReadApi(pool,{
  externalIdentity:{
    issuer:process.env.OIDC_ISSUER,
    audience:process.env.OIDC_AUDIENCE,
    jwks:JSON.parse(process.env.OIDC_JWKS_JSON)
  }
});
const port=Number(process.env.PORT||3200);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid local port');
server.listen(port,'127.0.0.1',
  ()=>console.log('Scoped employee read-only isolated server listening on loopback '+port));
const shutdown=async()=>{server.close();await pool.end();};
process.once('SIGINT',shutdown);
process.once('SIGTERM',shutdown);
