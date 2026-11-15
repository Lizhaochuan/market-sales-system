// V3.2-115 fixture setup: only a disposable CI PostgreSQL 16 database.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
if(process.env.V106_ISOLATED_PG!=='YES_TEST_ONLY')
 throw Error('V115 SQL fixture refuses non-test environments');
const pool=new pg.Pool({host:'127.0.0.1',port:5432,database:'v106_isolated',
 user:'postgres',password:'ephemeral-v106-admin-only',
 max:1,connectionTimeoutMillis:3000});
try{
 const id=await pool.query('SELECT current_database() AS db,current_user AS actor');
 if(id.rows[0]?.db!=='v106_isolated'||id.rows[0]?.actor!=='postgres')
  throw Error('Unexpected V115 database or administrator');
 const sql=readFileSync(fileURLToPath(
  new URL('../tests/fixtures/v3-2-115-m02-review-hold.sql',import.meta.url)),'utf8');
 await pool.query(sql);
 process.stdout.write('V115 permanent test-only HOLD ledger initialized.\n');
}finally{await pool.end();}
