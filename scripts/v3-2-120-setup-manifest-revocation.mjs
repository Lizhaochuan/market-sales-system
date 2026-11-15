// Disposable V3.2-120 revocation SQL setup, no production migrations.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
if(process.env.V106_ISOLATED_PG!=='YES_TEST_ONLY')
 throw Error('V120 schema setup requires explicit disposable CI guard');
const pool=new pg.Pool({host:'127.0.0.1',port:5432,database:'v106_isolated',
 user:'postgres',password:'ephemeral-v106-admin-only',
 max:1,connectionTimeoutMillis:3000});
try{
 const id=await pool.query('SELECT current_database() AS db,current_user AS actor');
 if(id.rows[0]?.db!=='v106_isolated'||id.rows[0]?.actor!=='postgres')
  throw Error('V120 prohibited outside temporary test admin');
 const sql=readFileSync(fileURLToPath(new URL(
  '../tests/fixtures/v3-2-120-m02-manifest-revocation.sql',import.meta.url)),'utf8');
 await pool.query(sql);
 process.stdout.write('V120 disposable irreversible export revocation tables ready.\n');
}finally{await pool.end();}
