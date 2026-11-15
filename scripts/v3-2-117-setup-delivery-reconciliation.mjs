// Disposable V3.2-117 PostgreSQL schema setup; never a production migration.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
if(process.env.V106_ISOLATED_PG!=='YES_TEST_ONLY')
 throw Error('V117 SQL fixture prohibited outside disposable CI database');
const pool=new pg.Pool({host:'127.0.0.1',port:5432,database:'v106_isolated',
 user:'postgres',password:'ephemeral-v106-admin-only',
 connectionTimeoutMillis:3000,max:1});
try{
 const r=await pool.query('SELECT current_database() AS db,current_user AS actor');
 if(r.rows[0]?.db!=='v106_isolated'||r.rows[0]?.actor!=='postgres')
  throw Error('Refuse V117 SQL setup on unknown database or user');
 const sql=readFileSync(fileURLToPath(new URL(
  '../tests/fixtures/v3-2-117-m02-delivery-reconciliation.sql',import.meta.url)),'utf8');
 await pool.query(sql);
 process.stdout.write('V117 disposable negative-only reconciliation audit initialized.\n');
}finally{await pool.end();}
