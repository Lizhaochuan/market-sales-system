// V3.2-11 optional isolated-only function-only student access service.
import pg from 'pg';
import {createStudentAccessApi,assertStudentAccessOperatorPool}
  from './student-access-api.mjs';

if(process.env.MS_STAGE!=='isolated-test')
  throw new Error('Student access governance service is isolated-test only');
if(!process.env.DATABASE_URL||
   !process.env.OIDC_ISSUER||!process.env.OIDC_AUDIENCE||
   !process.env.OIDC_JWKS_JSON)
  throw new Error('Restricted staff DB and signing issuer/audience/JWKS required');
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:4});
try{await assertStudentAccessOperatorPool(pool);}
catch(e){await pool.end();throw e;}
const port=Number(process.env.PORT||3300);
if(!Number.isInteger(port)||port<1024||port>65535)
  throw new Error('Invalid local port');
const app=createStudentAccessApi(pool,{
  externalIdentity:{
    issuer:process.env.OIDC_ISSUER,
    audience:process.env.OIDC_AUDIENCE,
    jwks:JSON.parse(process.env.OIDC_JWKS_JSON)
  }
});
app.listen(port,'127.0.0.1',()=>{
  console.log('Isolated student access approval service on loopback '+port);
});
const shutdown=async()=>{app.close();await pool.end();};
process.once('SIGINT',shutdown);
process.once('SIGTERM',shutdown);
