import pg from 'pg';import {readFile} from 'node:fs/promises';
if(process.env.MS_STAGE!=='isolated-test')throw Error('Isolated stage required');
const u=new URL(process.env.DATABASE_URL);if(!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||!['/ms_test','/ms_workspace_test'].includes(u.pathname))throw Error('Local isolated database required');
const c=new pg.Client({connectionString:u.toString()});await c.connect();
try{
 const exists=(await c.query("SELECT to_regclass('ms_workspace.schema_versions') AS v")).rows[0].v;
 if(!exists||!(await c.query('SELECT 1 FROM ms_workspace.schema_versions WHERE version=34')).rowCount)await c.query(await readFile(new URL('../db/workspace-migrations/039_v34_sales_loop.sql',import.meta.url),'utf8'));
 if(process.env.MS_ENABLE_ROLE_WORKSPACES==='1'&&!(await c.query('SELECT 1 FROM ms_workspace.schema_versions WHERE version=35')).rowCount)await c.query(await readFile(new URL('../db/workspace-migrations/040_role_workspaces.sql',import.meta.url),'utf8'));
 if(process.env.MS_ENABLE_ROLE_WORKSPACES==='1'&&process.env.MS_V34_DEMO_SEED==='1')await c.query(await readFile(new URL('../tests/fixtures/role-workspaces-demo.sql',import.meta.url),'utf8'));
 if(process.env.MS_V34_DEMO_SEED==='1')await c.query(await readFile(new URL('../tests/fixtures/v34-demo-finance.sql',import.meta.url),'utf8'));
 if(!(await c.query('SELECT 1 FROM ms_workspace.schema_versions WHERE version=36')).rowCount)await c.query(await readFile(new URL('../db/workspace-migrations/041_historical_student_links.sql',import.meta.url),'utf8'));
 console.log('V3.4 additive workspace migration ready; old records unchanged; HOLD remains.');
}finally{await c.end();}
