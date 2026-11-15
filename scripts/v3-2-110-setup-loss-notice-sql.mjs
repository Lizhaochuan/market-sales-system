// V3.2-110: disposable SQL setup, never production DDL.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
if(process.env.V106_ISOLATED_PG!=='YES_TEST_ONLY')
 throw Error('V110 SQL setup requires the disposable CI environment');
const pool=new pg.Pool({host:'127.0.0.1',port:5432,database:'v106_isolated',
 user:'postgres',password:'ephemeral-v106-admin-only',
 max:1,connectionTimeoutMillis:3000});
try{
 const r=await pool.query('SELECT current_database() AS db,current_user AS role');
 if(r.rows[0]?.db!=='v106_isolated'||r.rows[0]?.role!=='postgres')
  throw Error('Refusing V110 SQL setup on unknown database or role');
 const sql=readFileSync(fileURLToPath(
  new URL('../tests/fixtures/v3-2-110-m02-loss-notice-sql.sql',import.meta.url)),'utf8');
 await pool.query(sql);
 process.stdout.write('V110 temporary notification head and immutable event ledger ready.\n');
}finally{await pool.end();}
