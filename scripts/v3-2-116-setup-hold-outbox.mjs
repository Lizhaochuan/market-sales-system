// Disposable PostgreSQL schema installer for V3.2-116 only.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
if(process.env.V106_ISOLATED_PG!=='YES_TEST_ONLY')
 throw Error('V116 cannot initialize a non-test SQL schema');
const pool=new pg.Pool({host:'127.0.0.1',port:5432,database:'v106_isolated',
 user:'postgres',password:'ephemeral-v106-admin-only',
 connectionTimeoutMillis:3000,max:1});
try{
 const id=await pool.query('SELECT current_database() AS db,current_user AS actor');
 if(id.rows[0]?.db!=='v106_isolated'||id.rows[0]?.actor!=='postgres')
  throw Error('V116 SQL setup prohibited outside disposable test administrator');
 const sql=readFileSync(fileURLToPath(
  new URL('../tests/fixtures/v3-2-116-m02-hold-outbox.sql',import.meta.url)),'utf8');
 await pool.query(sql);
 process.stdout.write('V116 disposable negative-only outbox and receipt tables ready.\n');
}finally{await pool.end();}
