import pg from 'pg';
import {readFile,readdir} from 'node:fs/promises';
// Explicit setup for an EMPTY, disposable database only. Never recreate/drop schemas.
if(process.env.MS_STAGE!=='isolated-test'||process.env.MS_WORKSPACE_SETUP!=='YES_EMPTY_TEST_DATABASE')
 throw Error('Explicit isolated empty-database setup acknowledgement required');
const url=new URL(process.env.DATABASE_URL);
if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||
 !['/ms_test','/ms_workspace_test'].includes(url.pathname))
 throw Error('Only a loopback disposable test database is allowed');
const c=new pg.Client({connectionString:url.toString()});await c.connect();
try{
 const existing=await c.query("SELECT to_regnamespace('ms') AS existing");
 if(existing.rows[0].existing)throw Error('Database is not empty; use a NEW disposable database');
 const migrations=(await readdir(new URL('../db/migrations/',import.meta.url))).filter(x=>/^\d{3}_.*\.sql$/.test(x)).sort();
 for(const file of migrations)await c.query(await readFile(new URL('../db/migrations/'+file,import.meta.url),'utf8'));
 await c.query(await readFile(new URL('../tests/fixtures/fictional_ui_demo_seed.sql',import.meta.url),'utf8'));
 await c.query(await readFile(new URL('../tests/fixtures/isolated-business-workspace.sql',import.meta.url),'utf8'));
 if(process.env.MS_ENABLE_V34_WORKFLOW==='1'){await c.query(await readFile(new URL('../db/workspace-migrations/039_v34_sales_loop.sql',import.meta.url),'utf8'));await c.query(await readFile(new URL('../tests/fixtures/v34-demo-finance.sql',import.meta.url),'utf8'));}
 if(process.env.MS_ENABLE_ROLE_WORKSPACES==='1'){await c.query(await readFile(new URL('../db/workspace-migrations/040_role_workspaces.sql',import.meta.url),'utf8'));await c.query(await readFile(new URL('../tests/fixtures/role-workspaces-demo.sql',import.meta.url),'utf8'));}
 if(process.env.MS_ENABLE_V34_WORKFLOW==='1')await c.query(await readFile(new URL('../db/workspace-migrations/041_historical_student_links.sql',import.meta.url),'utf8'));
 if(process.env.MS_ENABLE_V34_WORKFLOW==='1')await c.query(await readFile(new URL('../db/workspace-migrations/042_appointment_supervision.sql',import.meta.url),'utf8'));
 if(process.env.MS_ENABLE_V34_WORKFLOW==='1')await c.query(await readFile(new URL('../db/workspace-migrations/043_followup_supervision.sql',import.meta.url),'utf8'));
 if(process.env.MS_ENABLE_V34_WORKFLOW==='1')await c.query(await readFile(new URL('../db/workspace-migrations/044_arrangement_supervision.sql',import.meta.url),'utf8'));
 if(process.env.MS_ENABLE_V34_WORKFLOW==='1')await c.query(await readFile(new URL('../db/workspace-migrations/045_appointment_supervision_evidence.sql',import.meta.url),'utf8'));
 if(process.env.MS_ENABLE_V34_WORKFLOW==='1')await c.query(await readFile(new URL('../db/workspace-migrations/046_service_campus_directory.sql',import.meta.url),'utf8'));
 if(process.env.MS_ENABLE_V34_WORKFLOW==='1')await c.query(await readFile(new URL('../db/workspace-migrations/047_scoped_mobile_tasks.sql',import.meta.url),'utf8'));
 console.log('Disposable isolated workspace initialized; HOLD remains active.');
}finally{await c.end();}
