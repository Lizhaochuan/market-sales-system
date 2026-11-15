// V3.2-113 isolated assignment table creation. Not production DDL.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
if(process.env.V106_ISOLATED_PG!=='YES_TEST_ONLY')
 throw Error('Refusing V113 reviewer schema setup outside disposable CI DB');
const pool=new pg.Pool({host:'127.0.0.1',port:5432,database:'v106_isolated',
 user:'postgres',password:'ephemeral-v106-admin-only',
 max:1,connectionTimeoutMillis:3000});
try{
 const r=await pool.query('SELECT current_database() AS db,current_user AS actor');
 if(r.rows[0]?.db!=='v106_isolated'||r.rows[0]?.actor!=='postgres')
  throw Error('Unrecognized V113 database or user');
 const sql=readFileSync(fileURLToPath(
  new URL('../tests/fixtures/v3-2-113-m02-reviewer-assignment.sql',import.meta.url)),'utf8');
 await pool.query(sql);
 process.stdout.write('V113 disposable reviewer assignment audit table created.\n');
}finally{await pool.end();}
