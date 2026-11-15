// V3.2-119 isolated SQL schema setup. NEVER production migration 039.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
if(process.env.V106_ISOLATED_PG!=='YES_TEST_ONLY')
 throw Error('V119 SQL schema setup requires disposable CI');
const pool=new pg.Pool({host:'127.0.0.1',port:5432,database:'v106_isolated',
 user:'postgres',password:'ephemeral-v106-admin-only',
 max:1,connectionTimeoutMillis:3000});
try{
 const r=await pool.query('SELECT current_database() AS db,current_user AS actor');
 if(r.rows[0]?.db!=='v106_isolated'||r.rows[0]?.actor!=='postgres')
  throw Error('Refusing V119 setup outside disposable admin account');
 const sql=readFileSync(fileURLToPath(new URL(
  '../tests/fixtures/v3-2-119-m02-incident-gap-manifest.sql',import.meta.url)),
  'utf8');
 await pool.query(sql);
 process.stdout.write('V119 disposable incident-level manifest audit ready.\n');
}finally{await pool.end();}
