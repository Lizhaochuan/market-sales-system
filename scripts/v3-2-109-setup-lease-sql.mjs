// CI-only lease SQL setup. Refuse all non-disposable database names.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
if(process.env.V106_ISOLATED_PG!=='YES_TEST_ONLY')
 throw Error('V109 lease SQL setup requires disposable CI database guard');
const pool=new pg.Pool({
 host:'127.0.0.1',port:5432,database:'v106_isolated',
 user:'postgres',password:'ephemeral-v106-admin-only',
 max:1,connectionTimeoutMillis:3000
});
try{
 const result=await pool.query('SELECT current_database() AS db,current_user AS role');
 if(result.rows[0]?.db!=='v106_isolated'||result.rows[0]?.role!=='postgres')
  throw Error('Refusing lease DDL on unknown database or role');
 const sql=readFileSync(fileURLToPath(
  new URL('../tests/fixtures/v3-2-109-m02-lease-ledger.sql',import.meta.url)),
  'utf8');
 await pool.query(sql);
 process.stdout.write('V109 disposable tenant-isolated lease table initialized.\n');
}finally{await pool.end();}
