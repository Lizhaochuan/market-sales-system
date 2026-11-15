// V3.2-114 CI-only schema setup for disposable PostgreSQL 16.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
if(process.env.V106_ISOLATED_PG!=='YES_TEST_ONLY')
 throw Error('Refusing V114 lifecycle SQL setup outside disposable CI');
const pool=new pg.Pool({host:'127.0.0.1',port:5432,database:'v106_isolated',
 user:'postgres',password:'ephemeral-v106-admin-only',
 connectionTimeoutMillis:3000,max:1});
try{
 const r=await pool.query('SELECT current_database() AS db,current_user AS actor');
 if(r.rows[0]?.db!=='v106_isolated'||r.rows[0]?.actor!=='postgres')
  throw Error('V114 setup refuses unknown database or role');
 const sql=readFileSync(fileURLToPath(
  new URL('../tests/fixtures/v3-2-114-m02-reviewer-lifecycle.sql',import.meta.url)),'utf8');
 await pool.query(sql);
 process.stdout.write('V114 disposable reviewer recusal audit schema initialized.\n');
}finally{await pool.end();}
