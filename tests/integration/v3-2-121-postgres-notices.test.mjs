import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import pg from 'pg';
import {createIsolatedPostgresRevocationNotices} from '../helpers/v3-2-121-m02-postgres-revocation-notices.mjs';
import {createIsolatedRevocationNoticeService} from '../../src/cross-module-revocation-notice-contract.mjs';
const hash=o=>createHash('sha256').update(JSON.stringify(o)).digest('hex');
const a='11111111-1111-4111-8111-111111111111';
const b='22222222-2222-4222-8222-222222222222';
const incident='00000000-0000-4000-8000-000000000002';
const recipient='00000000-0000-4000-8000-000000000003';
const extra='00000000-0000-4000-8000-000000000004';
const host=process.env.PGHOST||'127.0.0.1';
const admin=new pg.Pool({host,database:'v106_isolated',user:'postgres',password:'postgres'});
const writer=new pg.Pool({host,database:'v106_isolated',user:'v106_writer_a',password:'test_only_a'});
let input,ledger,service;
test.before(async()=>{
 await admin.query("CREATE ROLE v106_writer_a LOGIN PASSWORD 'test_only_a'");
 await admin.query("CREATE ROLE v106_writer_b LOGIN PASSWORD 'test_only_b'");
 await admin.query('CREATE SCHEMA v106_test');
 await admin.query('GRANT USAGE ON SCHEMA v106_test TO v106_writer_a,v106_writer_b');
 await admin.query(`CREATE TABLE v106_test.fixture_incident_gap_manifest_heads(
 organization_id uuid,incident_id uuid,sequence integer,event_digest text,hold_active boolean,
 PRIMARY KEY(organization_id,incident_id))`);
 await admin.query(`CREATE TABLE v106_test.fixture_incident_gap_manifest_events(
 organization_id uuid,incident_id uuid,sequence integer,event_payload text,event_digest text,
 PRIMARY KEY(organization_id,incident_id,sequence))`);
 await admin.query(`CREATE TABLE v106_test.fixture_manifest_revocation_heads(
 organization_id uuid,incident_id uuid,sequence integer,event_digest text,hold_active boolean,
 PRIMARY KEY(organization_id,incident_id))`);
 await admin.query(`CREATE TABLE v106_test.fixture_manifest_revocation_events(
 organization_id uuid,incident_id uuid,sequence integer,event_payload text,event_digest text,
 PRIMARY KEY(organization_id,incident_id,sequence))`);
 for(const name of ['fixture_incident_gap_manifest_heads','fixture_incident_gap_manifest_events','fixture_manifest_revocation_heads','fixture_manifest_revocation_events']){
  await admin.query(`GRANT SELECT ON v106_test.${name} TO v106_writer_a,v106_writer_b`);
  await admin.query(`ALTER TABLE v106_test.${name} ENABLE ROW LEVEL SECURITY`);
  await admin.query(`ALTER TABLE v106_test.${name} FORCE ROW LEVEL SECURITY`);
  await admin.query(`CREATE POLICY ${name}_a ON v106_test.${name} FOR SELECT TO v106_writer_a USING(organization_id='${a}'::uuid)`);
  await admin.query(`CREATE POLICY ${name}_b ON v106_test.${name} FOR SELECT TO v106_writer_b USING(organization_id='${b}'::uuid)`);
 }
 await admin.query(await readFile(new URL('../fixtures/v3-2-121-m02-revocation-notices.sql',import.meta.url),'utf8'));
 const m={scope:{organization_id:a,incident_id:incident},sequence:1,status:'FIXTURE_EXPORT'};
 const md=hash(m);
 const r={scope:{organization_id:a,incident_id:incident},target_manifest_sequence:1,
  target_manifest_digest:md,revocation_recorded:true,classification:'REVOKED_SOURCE_CHANGED_AFTER_EXPORT'};
 const rd=hash(r);
 await admin.query('INSERT INTO v106_test.fixture_incident_gap_manifest_events VALUES($1,$2,1,$3,$4)',[a,incident,JSON.stringify(m),md]);
 await admin.query('INSERT INTO v106_test.fixture_incident_gap_manifest_heads VALUES($1,$2,1,$3,true)',[a,incident,md]);
 await admin.query('INSERT INTO v106_test.fixture_manifest_revocation_events VALUES($1,$2,1,$3,$4)',[a,incident,JSON.stringify(r),rd]);
 await admin.query('INSERT INTO v106_test.fixture_manifest_revocation_heads VALUES($1,$2,1,$3,true)',[a,incident,rd]);
 await admin.query('INSERT INTO v106_test.fixture_revocation_recipients VALUES($1,$2,$3),($1,$2,$4)',[a,incident,recipient,extra]);
 input={organization_id:a,incident_id:incident,recipient_id:recipient,export_version:1,manifest_digest:md,revocation_event_digest:rd,epoch:1};
 ledger=createIsolatedPostgresRevocationNotices({pool:writer});
 service=createIsolatedRevocationNoticeService({ledger,clock:()=>100});
});
test.after(async()=>{await writer.end();await admin.end();});
test('SQL source binding and durable enqueue + replay',async()=>{
 const first=await service.enqueue(input);
 assert.equal(first.notice_accepted,true,JSON.stringify(first));
 const next=await service.enqueue(input);
 assert.equal(next.notice_accepted,true,JSON.stringify(next));
 const row=await writer.query('SELECT count(*)::int AS n FROM v106_test.fixture_revocation_notices');
 assert.equal(row.rows[0].n,1);
 assert.equal(first.release_eligible,false);
});
test('full fixture recipient coverage still holds',async()=>{
 const r=await service.report(Object.fromEntries(['organization_id','incident_id','export_version','manifest_digest','revocation_event_digest'].map(k=>[k,input[k]])));
 assert.equal(r.recipient_count,2,JSON.stringify(r));
 assert.equal(r.unconfirmed_count,2);
 assert.equal(r.hold_active,true);
});
test('unknown recipient cannot queue',async()=>{
 const r=await service.enqueue({...input,recipient_id:'00000000-0000-4000-8000-000000000099'});
 assert.equal(r.notice_accepted,false);
 assert.equal(r.reason_code,'NOTICE_RECIPIENT_NOT_REGISTERED');
});
test('writer cannot modify or delete append-only evidence',async()=>{
 await assert.rejects(writer.query('UPDATE v106_test.fixture_revocation_notices SET state=\'QUEUED\''),/permission denied/);
 await assert.rejects(writer.query('DELETE FROM v106_test.fixture_revocation_notices'),/permission denied/);
});
test('RLS denies cross-tenant read and insert',async()=>{
 const count=await writer.query('SELECT count(*)::int AS n FROM v106_test.fixture_revocation_recipients WHERE organization_id=$1',[b]);
 assert.equal(count.rows[0].n,0);
 await assert.rejects(writer.query('INSERT INTO v106_test.fixture_revocation_notices (organization_id,incident_id,notice_id,recipient_id,export_version,epoch,manifest_digest,revocation_event_digest,event_digest,event_payload) VALUES($1,$2,$3,$4,1,1,$5,$6,$7,$8)',[b,incident,'a'.repeat(64),recipient,input.manifest_digest,input.revocation_event_digest,'a'.repeat(64),'{}']),/row-level security/);
});
test('forged source prevents write',async()=>{
 const r=await service.enqueue({...input,manifest_digest:'f'.repeat(64),epoch:2});
 assert.equal(r.notice_accepted,false);
});
