// Runs only against GitHub Actions' disposable PostgreSQL service.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
if(process.env.V106_ISOLATED_PG!=='YES_TEST_ONLY')
 throw new Error('Refuse PostgreSQL setup outside V106 disposable CI');
const {Pool}=pg;
const pool=new Pool({host:'127.0.0.1',port:5432,database:'v106_isolated',
 user:'postgres',password:'ephemeral-v106-admin-only',
 connectionTimeoutMillis:3000,max:1});
try{
 const who=await pool.query('SELECT current_database() AS db,current_user AS role_name');
 if(who.rows[0]?.db!=='v106_isolated'||who.rows[0]?.role_name!=='postgres')
  throw new Error('Unexpected database identity; refusing fixture DDL');
 const sql=readFileSync(fileURLToPath(new URL('../tests/fixtures/v3-2-106-m02-isolated-postgres.sql',import.meta.url)),'utf8');
 await pool.query(sql);
 process.stdout.write('V106 disposable PostgreSQL fixture initialized; business tables remain protected.\n');
}finally{await pool.end();}
