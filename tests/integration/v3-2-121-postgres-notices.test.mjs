import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {encodeFixtureReceiptProof} from '../../src/cross-module-fixture-receipt-proof.mjs';
import {createFixtureLeaseGate,encodeFixtureLease} from '../../src/cross-module-fixture-authority-lease.mjs';
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
const keyPair=generateKeyPairSync('ed25519');
const fixtureLeaseKeys=generateKeyPairSync('ed25519');
const fixtureSigner='00000000-0000-4000-8000-000000000081';
function makeFixtureLease(notice_id,authority_epoch=4,revocation_watermark=2,lease_sequence=1){
 const lease={organization_id:a,incident_id:incident,signer_id:fixtureSigner,notice_id,
  authority_epoch,revocation_watermark,lease_sequence,issued_at_ms:100,expires_at_ms:200};
 return {lease,signature_b64:sign(null,encodeFixtureLease(lease),fixtureLeaseKeys.privateKey).toString('base64')};
}
function fixtureGate({revocation_watermark=2,lease_sequence=1,active=true}={}){
 return createFixtureLeaseGate({publicKey:fixtureLeaseKeys.publicKey,clock:()=>150,
  loadAuthority:async()=>({active,authority_epoch:4,revocation_watermark,lease_sequence})});
}

let input,ledger,service;
const proofAuthority=async()=>({authority_epoch:4,revocation_watermark:2,active:true});
function signedReceipt(value){
 if(!['NEGATIVE_RECEIPT','COPY_NOT_RETRACTABLE'].includes(value.receipt_state))return ledger.appendNegativeReceipt({...value,proof:null});
 const statement={organization_id:value.organization_id,incident_id:value.incident_id,notice_id:value.notice_id,receipt_sequence:value.receipt_sequence,receipt_state:value.receipt_state,signer_id:'00000000-0000-4000-8000-000000000081',authority_epoch:4,revocation_watermark:2,issued_at_ms:100,expires_at_ms:500};
 const signature_b64=sign(null,encodeFixtureReceiptProof(statement),keyPair.privateKey).toString('base64');
 return ledger.appendNegativeReceipt({...value,proof:{statement,signature_b64},lease:makeFixtureLease(value.notice_id)});
}

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
 const m={scope:{organization_id:a,incident_id:incident},sequence:1,previous_event_digest:'0'.repeat(64),status:'FIXTURE_EXPORT'};
 const md=hash(m);
 const r={scope:{organization_id:a,incident_id:incident},sequence:1,previous_event_digest:'0'.repeat(64),target_manifest_sequence:1,
  target_manifest_digest:md,revocation_recorded:true,classification:'REVOKED_SOURCE_CHANGED_AFTER_EXPORT'};
 const rd=hash(r);
 await admin.query('INSERT INTO v106_test.fixture_incident_gap_manifest_events VALUES($1,$2,1,$3,$4)',[a,incident,JSON.stringify(m),md]);
 await admin.query('INSERT INTO v106_test.fixture_incident_gap_manifest_heads VALUES($1,$2,1,$3,true)',[a,incident,md]);
 await admin.query('INSERT INTO v106_test.fixture_manifest_revocation_events VALUES($1,$2,1,$3,$4)',[a,incident,JSON.stringify(r),rd]);
 await admin.query('INSERT INTO v106_test.fixture_manifest_revocation_heads VALUES($1,$2,1,$3,true)',[a,incident,rd]);
 await admin.query('INSERT INTO v106_test.fixture_revocation_recipients VALUES($1,$2,$3),($1,$2,$4)',[a,incident,recipient,extra]);
 input={organization_id:a,incident_id:incident,recipient_id:recipient,export_version:1,manifest_digest:md,revocation_event_digest:rd,epoch:1};
 ledger=createIsolatedPostgresRevocationNotices({leaseGate:fixtureGate(),pool:writer,receiptPublicKey:keyPair.publicKey,receiptClock:()=>150,receiptProofAuthority:proofAuthority});
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

test('manifest history gap fails closed, even when head still exists',async()=>{
 const row=await admin.query('SELECT event_payload,event_digest FROM v106_test.fixture_incident_gap_manifest_events WHERE organization_id=$1 AND incident_id=$2 AND sequence=1',[a,incident]);
 await admin.query('DELETE FROM v106_test.fixture_incident_gap_manifest_events WHERE organization_id=$1 AND incident_id=$2 AND sequence=1',[a,incident]);
 try{
  const r=await service.enqueue({...input,epoch:5});
  assert.equal(r.notice_accepted,false);
  assert.equal(r.reason_code,'NOTICE_MANIFEST_HISTORY_INVALID');
 }finally{
  await admin.query('INSERT INTO v106_test.fixture_incident_gap_manifest_events VALUES($1,$2,1,$3,$4)',[a,incident,row.rows[0].event_payload,row.rows[0].event_digest]);
 }
});
test('revocation history corruption fails closed',async()=>{
 const row=await admin.query('SELECT event_payload,event_digest FROM v106_test.fixture_manifest_revocation_events WHERE organization_id=$1 AND incident_id=$2 AND sequence=1',[a,incident]);
 await admin.query('UPDATE v106_test.fixture_manifest_revocation_events SET event_payload=$3 WHERE organization_id=$1 AND incident_id=$2 AND sequence=1',[a,incident,'{}']);
 try{
  const r=await service.enqueue({...input,epoch:6});
  assert.equal(r.notice_accepted,false);
  assert.equal(r.reason_code,'NOTICE_REVOCATION_HISTORY_INVALID');
 }finally{
  await admin.query('UPDATE v106_test.fixture_manifest_revocation_events SET event_payload=$3,event_digest=$4 WHERE organization_id=$1 AND incident_id=$2 AND sequence=1',[a,incident,row.rows[0].event_payload,row.rows[0].event_digest]);
 }
});
test('concurrent identical notice uses one persisted event',async()=>{
 const batch=await Promise.all(Array.from({length:8},()=>service.enqueue({...input,epoch:7})));
 assert.ok(batch.every(x=>x.notice_accepted===true),JSON.stringify(batch));
 const count=await writer.query('SELECT count(*)::int AS n FROM v106_test.fixture_revocation_notices WHERE organization_id=$1 AND incident_id=$2 AND epoch=7',[a,incident]);
 assert.equal(count.rows[0].n,1);
});

test('negative-only receipts persist in order and never release',async()=>{
 const queued=await service.enqueue({...input,epoch:20});
 assert.equal(queued.notice_accepted,true);
 const base={organization_id:a,incident_id:incident,notice_id:queued.notice_id};
 const first=await signedReceipt({...base,receipt_sequence:1,receipt_state:'NEGATIVE_RECEIPT'});
 assert.equal(first.duplicate,false);
 assert.equal(first.hold_active,true);
 const again=await signedReceipt({...base,receipt_sequence:1,receipt_state:'NEGATIVE_RECEIPT'});
 assert.equal(again.duplicate,true);
 const second=await signedReceipt({...base,receipt_sequence:2,receipt_state:'COPY_NOT_RETRACTABLE'});
 assert.equal(second.hold_active,true);
 const report=await service.report(Object.fromEntries(['organization_id','incident_id','export_version','manifest_digest','revocation_event_digest'].map(k=>[k,input[k]])));
 assert.equal(report.hold_active,true);
 assert.equal(report.release_eligible,false);
 assert.equal(report.recipients.find(x=>x.recipient_id===recipient).state,'COPY_NOT_RETRACTABLE');
});
test('receipt cannot skip sequence, use positive ack or rewrite history',async()=>{
 const q=await service.enqueue({...input,epoch:21});
 const base={organization_id:a,incident_id:incident,notice_id:q.notice_id};
 await assert.rejects(signedReceipt({...base,receipt_sequence:2,receipt_state:'NEGATIVE_RECEIPT'}),{code:'NOTICE_RECEIPT_OUT_OF_ORDER'});
 await assert.rejects(signedReceipt({...base,receipt_sequence:1,receipt_state:'FIXTURE_ACKNOWLEDGED'}),{code:'NOTICE_RECEIPT_INPUT_INVALID'});
 await signedReceipt({...base,receipt_sequence:1,receipt_state:'NEGATIVE_RECEIPT'});
 await assert.rejects(signedReceipt({...base,receipt_sequence:1,receipt_state:'COPY_NOT_RETRACTABLE'}),{code:'NOTICE_RECEIPT_REPLAY_CONFLICT'});
 await assert.rejects(writer.query("UPDATE v106_test.fixture_revocation_negative_receipts SET receipt_state='COPY_NOT_RETRACTABLE'"),/permission denied/);
 await assert.rejects(writer.query('DELETE FROM v106_test.fixture_revocation_negative_receipts'),/permission denied/);
});
test('receipt cross-tenant write and unknown notice fail closed',async()=>{
 const q=await service.enqueue({...input,epoch:22});
 await assert.rejects(signedReceipt({organization_id:b,incident_id:incident,notice_id:q.notice_id,receipt_sequence:1,receipt_state:'NEGATIVE_RECEIPT'}),{code:'NOTICE_RECEIPT_TARGET_ABSENT'});
 await assert.rejects(writer.query('INSERT INTO v106_test.fixture_revocation_negative_receipts (organization_id,incident_id,notice_id,receipt_sequence,receipt_state,previous_digest,receipt_digest,receipt_payload) VALUES($1,$2,$3,1,$4,$5,$6,$7)',[b,incident,q.notice_id,'NEGATIVE_RECEIPT','0'.repeat(64),'a'.repeat(64),'{}']),/row-level security/);
});
test('coverage snapshot contains consistent recipient set and receipt states',async()=>{
 const scope=Object.fromEntries(['organization_id','incident_id','export_version','manifest_digest','revocation_event_digest'].map(k=>[k,input[k]]));
 const snap=await ledger.captureCoverageSnapshot(scope);
 assert.equal(snap.heads.revoked,true);
 assert.deepEqual(snap.recipients,[recipient,extra]);
 assert.equal(snap.notices.find(n=>n.epoch===20).state,'COPY_NOT_RETRACTABLE');
 assert.equal((await service.report(scope)).hold_active,true);
});
test('failed SQL insert rolls back with no partial negative receipt',async()=>{
 const q=await service.enqueue({...input,epoch:24});
 const before=await writer.query('SELECT count(*)::int AS n FROM v106_test.fixture_revocation_negative_receipts WHERE notice_id=$1',[q.notice_id]);
 assert.equal(before.rows[0].n,0);
 const client=await writer.connect();
 try{
  await client.query('BEGIN');
  await client.query('INSERT INTO v106_test.fixture_revocation_negative_receipts(organization_id,incident_id,notice_id,receipt_sequence,receipt_state,previous_digest,receipt_digest,receipt_payload) VALUES($1,$2,$3,1,$4,$5,$6,$7)',[a,incident,q.notice_id,'NEGATIVE_RECEIPT','0'.repeat(64),'a'.repeat(64),'{}']);
  await assert.rejects(client.query('INSERT INTO v106_test.fixture_revocation_negative_receipts(organization_id,incident_id,notice_id,receipt_sequence,receipt_state,previous_digest,receipt_digest,receipt_payload) VALUES($1,$2,$3,1,$4,$5,$6,$7)',[a,incident,q.notice_id,'NEGATIVE_RECEIPT','0'.repeat(64),'a'.repeat(64),'{}']));
  await client.query('ROLLBACK');
 }finally{client.release();}
 const after=await writer.query('SELECT count(*)::int AS n FROM v106_test.fixture_revocation_negative_receipts WHERE notice_id=$1',[q.notice_id]);
 assert.equal(after.rows[0].n,0);
 assert.equal((await signedReceipt({organization_id:a,incident_id:incident,notice_id:q.notice_id,receipt_sequence:1,receipt_state:'NEGATIVE_RECEIPT'})).hold_active,true);
});
test('receipt integrity failure prevents coverage report',async()=>{
 const q=await service.enqueue({...input,epoch:23});
 const base={organization_id:a,incident_id:incident,notice_id:q.notice_id};
 await signedReceipt({...base,receipt_sequence:1,receipt_state:'NEGATIVE_RECEIPT'});
 await admin.query('UPDATE v106_test.fixture_revocation_negative_receipts SET receipt_payload=$4 WHERE organization_id=$1 AND incident_id=$2 AND notice_id=$3',[a,incident,q.notice_id,'{}']);
 const report=await service.report(Object.fromEntries(['organization_id','incident_id','export_version','manifest_digest','revocation_event_digest'].map(k=>[k,input[k]])));
 assert.equal(report.reason_code,'NOTICE_DEPENDENCY_UNAVAILABLE');
 assert.equal(report.hold_active,true);
});

test('unsigned receipt is blocked before SQL insert',async()=>{
 const q=await service.enqueue({...input,epoch:31});
 const params={organization_id:a,incident_id:incident,notice_id:q.notice_id,receipt_sequence:1,receipt_state:'NEGATIVE_RECEIPT'};
 await assert.rejects(ledger.appendNegativeReceipt(params),{code:'NOTICE_RECEIPT_INPUT_INVALID'});
 const r=await writer.query('SELECT count(*)::int AS n FROM v106_test.fixture_revocation_negative_receipts WHERE notice_id=$1',[q.notice_id]);
 assert.equal(r.rows[0].n,0);
});
test('invalid signer snapshot blocks both initial receipt and replay',async()=>{
 const q=await service.enqueue({...input,epoch:32});
 const data={organization_id:a,incident_id:incident,notice_id:q.notice_id,receipt_sequence:1,receipt_state:'NEGATIVE_RECEIPT'};
 const signed=signedReceipt(data);
 assert.equal((await signed).hold_active,true);
 const invalid= createIsolatedPostgresRevocationNotices({leaseGate:fixtureGate(),pool:writer,receiptPublicKey:keyPair.publicKey,receiptClock:()=>150,receiptProofAuthority:async()=>({authority_epoch:4,revocation_watermark:3,active:false})});
 const statement={organization_id:a,incident_id:incident,notice_id:q.notice_id,receipt_sequence:1,receipt_state:'NEGATIVE_RECEIPT',signer_id:'00000000-0000-4000-8000-000000000081',authority_epoch:4,revocation_watermark:2,issued_at_ms:100,expires_at_ms:500};
 const signature_b64=sign(null,encodeFixtureReceiptProof(statement),keyPair.privateKey).toString('base64');
 await assert.rejects(invalid.appendNegativeReceipt({...data,proof:{statement,signature_b64}}),{code:'FIXTURE_RECEIPT_AUTHORITY_STALE'});
});

function fixtureSignedInput(q){
 const statement={organization_id:a,incident_id:incident,notice_id:q.notice_id,
  receipt_sequence:1,receipt_state:'NEGATIVE_RECEIPT',
  signer_id:'00000000-0000-4000-8000-000000000081',
  authority_epoch:4,revocation_watermark:2,issued_at_ms:100,expires_at_ms:500};
 const signature_b64=sign(null,encodeFixtureReceiptProof(statement),keyPair.privateKey).toString('base64');
 return {organization_id:a,incident_id:incident,notice_id:q.notice_id,
  receipt_sequence:1,receipt_state:'NEGATIVE_RECEIPT',proof:{statement,signature_b64},lease:makeFixtureLease(q.notice_id)};
}
test('revocation between insert and SQL commit rolls back receipt',async()=>{
 const q=await service.enqueue({...input,epoch:40});
 let active=true;
 const adapter=createIsolatedPostgresRevocationNotices({leaseGate:fixtureGate(),pool:writer,
  receiptPublicKey:keyPair.publicKey,receiptClock:()=>150,
  receiptProofAuthority:async()=>({authority_epoch:4,revocation_watermark:2,active}),
  beforeReceiptCommit:async()=>{active=false;}});
 await assert.rejects(adapter.appendNegativeReceipt(fixtureSignedInput(q)),{code:'FIXTURE_RECEIPT_AUTHORITY_STALE'});
 const count=await writer.query('SELECT count(*)::int AS n FROM v106_test.fixture_revocation_negative_receipts WHERE notice_id=$1',[q.notice_id]);
 assert.equal(count.rows[0].n,0);
});
test('revocation immediately after commit returns denial but retains immutable evidence',async()=>{
 const q=await service.enqueue({...input,epoch:41});
 let active=true;
 const adapter=createIsolatedPostgresRevocationNotices({leaseGate:fixtureGate(),pool:writer,
  receiptPublicKey:keyPair.publicKey,receiptClock:()=>150,
  receiptProofAuthority:async()=>({authority_epoch:4,revocation_watermark:2,active}),
  afterReceiptCommit:async()=>{active=false;}});
 await assert.rejects(adapter.appendNegativeReceipt(fixtureSignedInput(q)),{code:'FIXTURE_RECEIPT_AUTHORITY_STALE'});
 const count=await writer.query('SELECT count(*)::int AS n FROM v106_test.fixture_revocation_negative_receipts WHERE notice_id=$1',[q.notice_id]);
 assert.equal(count.rows[0].n,1);
 const report=await adapter.captureCoverageSnapshot(Object.fromEntries(['organization_id','incident_id','export_version','manifest_digest','revocation_event_digest'].map(k=>[k,input[k]]))).then(()=>null,e=>e);
 assert.equal(report?.code,'NOTICE_RECEIPT_PROOF_RECHECK_FAILED');
});
test('authority unavailable at commit checkpoint is denied without persisted receipt',async()=>{
 const q=await service.enqueue({...input,epoch:42});
 let available=true;
 const adapter=createIsolatedPostgresRevocationNotices({leaseGate:fixtureGate(),pool:writer,
  receiptPublicKey:keyPair.publicKey,receiptClock:()=>150,
  receiptProofAuthority:async()=>{
   if(!available)throw Error('fixture authority unavailable');
   return {authority_epoch:4,revocation_watermark:2,active:true};
  },
  beforeReceiptCommit:async()=>{available=false;}});
 await assert.rejects(adapter.appendNegativeReceipt(fixtureSignedInput(q)),/fixture authority unavailable/);
 const count=await writer.query('SELECT count(*)::int AS n FROM v106_test.fixture_revocation_negative_receipts WHERE notice_id=$1',[q.notice_id]);
 assert.equal(count.rows[0].n,0);
});

test('durable signer watermark blocks old signed proof after adapter restart',async()=>{
 const q=await service.enqueue({...input,epoch:51});
 const value=fixtureSignedInput(q);
 const elevated={...value.proof.statement,revocation_watermark:3};
 const proof={statement:elevated,signature_b64:sign(null,encodeFixtureReceiptProof(elevated),keyPair.privateKey).toString('base64')};
 const higher=createIsolatedPostgresRevocationNotices({leaseGate:fixtureGate(),pool:writer,
  receiptPublicKey:keyPair.publicKey,receiptClock:()=>150,
  receiptProofAuthority:async()=>({authority_epoch:4,revocation_watermark:3,active:true})});
 const first=await higher.appendNegativeReceipt({...value,proof});
 assert.equal(first.hold_active,true);
 const row=await writer.query('SELECT revocation_watermark FROM v106_test.fixture_signer_watermarks WHERE organization_id=$1 AND incident_id=$2 AND signer_id=$3',[a,incident,elevated.signer_id]);
 assert.equal(row.rows[0].revocation_watermark,3);
 const q2=await service.enqueue({...input,epoch:52});
 const old=fixtureSignedInput(q2);
 const restarted=createIsolatedPostgresRevocationNotices({leaseGate:fixtureGate(),pool:writer,
  receiptPublicKey:keyPair.publicKey,receiptClock:()=>150,
  receiptProofAuthority:async()=>({authority_epoch:4,revocation_watermark:2,active:true})});
 await assert.rejects(restarted.appendNegativeReceipt(old),{code:'NOTICE_SIGNER_WATERMARK_REGRESSION'});
 const count=await writer.query('SELECT count(*)::int AS n FROM v106_test.fixture_revocation_negative_receipts WHERE notice_id=$1',[q2.notice_id]);
 assert.equal(count.rows[0].n,0);
});
test('SQL trigger prevents direct watermark regression and tenant deletion',async()=>{
 await assert.rejects(writer.query('UPDATE v106_test.fixture_signer_watermarks SET revocation_watermark=1 WHERE organization_id=$1',[a]),/V121_WATERMARK_REGRESSION/);
 await assert.rejects(writer.query('DELETE FROM v106_test.fixture_signer_watermarks'),/permission denied/);
 const other=await writer.query('SELECT count(*)::int AS n FROM v106_test.fixture_signer_watermarks WHERE organization_id=$1',[b]);
 assert.equal(other.rows[0].n,0);
});

test('leased SQL receipt commits durable sequence and blocks replay after adapter restart',async()=>{
 const leaseKeys=generateKeyPairSync('ed25519');
 const signerId='00000000-0000-4000-8000-000000000082';
 let currentSequence=1;
 let now=150;
 const build=(notice_id,sequence)=>{
  const statement={organization_id:a,incident_id:incident,notice_id,
   receipt_sequence:1,receipt_state:'NEGATIVE_RECEIPT',signer_id:signerId,
   authority_epoch:4,revocation_watermark:2,issued_at_ms:100,expires_at_ms:500};
  const proof={statement,signature_b64:sign(null,encodeFixtureReceiptProof(statement),keyPair.privateKey).toString('base64')};
  const lease={organization_id:a,incident_id:incident,signer_id:signerId,notice_id,
   authority_epoch:4,revocation_watermark:2,lease_sequence:sequence,
   issued_at_ms:100,expires_at_ms:200};
  return {organization_id:a,incident_id:incident,notice_id,receipt_sequence:1,
   receipt_state:'NEGATIVE_RECEIPT',proof,
   lease:{lease,signature_b64:sign(null,encodeFixtureLease(lease),leaseKeys.privateKey).toString('base64')}};
 };
 const adapter=()=>createIsolatedPostgresRevocationNotices({pool:writer,
  receiptPublicKey:keyPair.publicKey,receiptClock:()=>now,
  receiptProofAuthority:async()=>({authority_epoch:4,revocation_watermark:2,active:true}),
  leaseGate:createFixtureLeaseGate({publicKey:leaseKeys.publicKey,clock:()=>now,
   loadAuthority:async()=>({active:true,authority_epoch:4,revocation_watermark:2,lease_sequence:currentSequence})})});
 const q1=await service.enqueue({...input,epoch:61});
 const first=build(q1.notice_id,1);
 const noLease={...first};delete noLease.lease;
 await assert.rejects(adapter().appendNegativeReceipt(noLease),{code:'NOTICE_RECEIPT_INPUT_INVALID'});
 assert.equal((await adapter().appendNegativeReceipt(first)).hold_active,true);
 let row=await writer.query('SELECT lease_sequence FROM v106_test.fixture_signer_watermarks WHERE organization_id=$1 AND incident_id=$2 AND signer_id=$3',[a,incident,signerId]);
 assert.equal(row.rows[0].lease_sequence,1);
 currentSequence=2;
 const q2=await service.enqueue({...input,epoch:62});
 assert.equal((await adapter().appendNegativeReceipt(build(q2.notice_id,2))).hold_active,true);
 row=await writer.query('SELECT lease_sequence FROM v106_test.fixture_signer_watermarks WHERE organization_id=$1 AND incident_id=$2 AND signer_id=$3',[a,incident,signerId]);
 assert.equal(row.rows[0].lease_sequence,2);
 const q3=await service.enqueue({...input,epoch:63});
 currentSequence=1;
 await assert.rejects(adapter().appendNegativeReceipt(build(q3.notice_id,1)),{code:'NOTICE_SIGNER_WATERMARK_REGRESSION'});
 const count=await writer.query('SELECT count(*)::int AS n FROM v106_test.fixture_revocation_negative_receipts WHERE notice_id=$1',[q3.notice_id]);
 assert.equal(count.rows[0].n,0);
 currentSequence=3;
 const q4=await service.enqueue({...input,epoch:64});
 now=200;
 await assert.rejects(adapter().appendNegativeReceipt(build(q4.notice_id,3)),{code:'LEASE_EXPIRED'});
 const total=await writer.query('SELECT count(*)::int AS n FROM v106_test.fixture_revocation_negative_receipts WHERE notice_id=$1',[q4.notice_id]);
 assert.equal(total.rows[0].n,0);
});
