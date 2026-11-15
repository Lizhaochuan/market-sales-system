import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash,createHmac,randomBytes,generateKeyPairSync,sign} from 'node:crypto';
import {encodeFixtureReceiptProof} from '../../src/cross-module-fixture-receipt-proof.mjs';
import {createFixtureLeaseGate,encodeFixtureLease} from '../../src/cross-module-fixture-authority-lease.mjs';
import {createFixtureRecoveryGate,encodeFixtureRecoveryRequest,encodeFixtureRecoveryApproval} from '../../src/cross-module-fixture-dual-approval-anchor.mjs';
import {createFixtureRecoveryIssuance} from '../helpers/v3-2-121-fixture-recovery-issuance.mjs';
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
const receiptWriter=new pg.Pool({host,database:'v106_isolated',user:'v106_receipt_writer_a',password:'test_only_receipt_a'});
const issuerWriter=new pg.Pool({host,database:'v106_isolated',user:'v106_key_issuer',password:'test_only_key_issuer'});
const securityEventWriter=new pg.Pool({host,database:'v106_isolated',user:'v106_security_event_writer',password:'test_only_security_events'});
const closeoutWriter=new pg.Pool({host,database:'v106_isolated',user:'v106_closeout_writer',password:'test_only_closeout'});
const auditReader=new pg.Pool({host,database:'v106_isolated',user:'v106_audit_reader',password:'test_only_auditor'});
const receiptAttestationKey=randomBytes(32);
const approvalAttestationKey=randomBytes(32);
const securityEventKey=randomBytes(32);
const closeoutSecurityKey=randomBytes(32);
const closeoutAuditKey=randomBytes(32);
const hmacReceipt=value=>createHmac('sha256',receiptAttestationKey).update(value).digest('hex');
const keyPair=generateKeyPairSync('ed25519');
const fixtureLeaseKeys=generateKeyPairSync('ed25519');
const fixtureSigner='00000000-0000-4000-8000-000000000081';
function makeFixtureLease(notice_id,authority_epoch=4,revocation_watermark=2,lease_sequence=1,organization_id=a){
 const lease={organization_id,incident_id:incident,signer_id:fixtureSigner,notice_id,
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
 return ledger.appendNegativeReceipt({...value,proof:{statement,signature_b64},lease:makeFixtureLease(value.notice_id,4,2,1,value.organization_id)});
}

test.before(async()=>{
 await admin.query("CREATE ROLE v106_writer_a LOGIN PASSWORD 'test_only_a'");
 await admin.query("CREATE ROLE v106_writer_b LOGIN PASSWORD 'test_only_b'");
 await admin.query("CREATE ROLE v106_receipt_writer_a LOGIN INHERIT PASSWORD 'test_only_receipt_a'");
 await admin.query('GRANT v106_writer_a TO v106_receipt_writer_a');
 await admin.query("CREATE ROLE v106_audit_reader LOGIN PASSWORD 'test_only_auditor'");
 await admin.query("CREATE ROLE v106_key_issuer LOGIN PASSWORD 'test_only_key_issuer'");
 await admin.query("CREATE ROLE v106_security_event_writer LOGIN PASSWORD 'test_only_security_events'");
 await admin.query("CREATE ROLE v106_closeout_writer LOGIN PASSWORD 'test_only_closeout'");
 await admin.query('CREATE SCHEMA v106_test');
 await admin.query('GRANT USAGE ON SCHEMA v106_test TO v106_writer_a,v106_writer_b,v106_audit_reader,v106_key_issuer,v106_security_event_writer,v106_closeout_writer');
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
 await admin.query('INSERT INTO v106_test.fixture_receipt_attestation_secrets(organization_id,key_version,attestation_key,active) VALUES($1,1,$2,true)',[a,receiptAttestationKey]);
 await admin.query('INSERT INTO v106_test.fixture_recovery_approval_attestation(organization_id,attestation_version,approval_key,active) VALUES($1,1,$2,true)',[a,approvalAttestationKey]);
 await admin.query('INSERT INTO v106_test.fixture_recovery_emergency_stops(organization_id,incident_id,issuance_blocked) VALUES($1,$2,false)',[a,incident]);
 await admin.query('INSERT INTO v106_test.fixture_external_security_keys(organization_id,event_key) VALUES($1,$2)',[a,securityEventKey]);
 await admin.query('INSERT INTO v106_test.fixture_closeout_review_keys(organization_id,reviewer_role,review_key) VALUES($1,$2,$3),($1,$4,$5)',[a,'SECURITY_REVIEW',closeoutSecurityKey,'AUDIT_REVIEW',closeoutAuditKey]);
 await admin.query('INSERT INTO v106_test.fixture_cross_module_holds(organization_id,incident_id,module_name) SELECT $1,$2,unnest($3::text[])',[a,incident,['SALES','FINANCE','ACADEMIC']]);
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
 ledger=createIsolatedPostgresRevocationNotices({receiptAttestationKey,receiptPool:receiptWriter,leaseGate:fixtureGate(),pool:writer,receiptPublicKey:keyPair.publicKey,receiptClock:()=>150,receiptProofAuthority:proofAuthority});
 service=createIsolatedRevocationNoticeService({ledger,clock:()=>100});
});
test.after(async()=>{await closeoutWriter.end();await securityEventWriter.end();await issuerWriter.end();await auditReader.end();await receiptWriter.end();await writer.end();await admin.end();});
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
 await assert.rejects(receiptWriter.query('INSERT INTO v106_test.fixture_revocation_negative_receipts (organization_id,incident_id,notice_id,receipt_sequence,receipt_state,previous_digest,receipt_digest,receipt_payload) VALUES($1,$2,$3,1,$4,$5,$6,$7)',[b,incident,q.notice_id,'NEGATIVE_RECEIPT','0'.repeat(64),'a'.repeat(64),'{}']),/permission denied/);
});
test('coverage snapshot contains consistent recipient set and receipt states',async()=>{
 const scope=Object.fromEntries(['organization_id','incident_id','export_version','manifest_digest','revocation_event_digest'].map(k=>[k,input[k]]));
 const snap=await ledger.captureCoverageSnapshot(scope);
 assert.equal(snap.heads.revoked,true);
 assert.deepEqual(snap.recipients,[recipient,extra]);
 assert.equal(snap.notices.find(n=>n.epoch===20).state,'COPY_NOT_RETRACTABLE');
 assert.equal((await service.report(scope)).hold_active,true);
});
test('definer admission rollback leaves no partial receipt',async()=>{
 const q=await service.enqueue({...input,epoch:24});
 const value=fixtureSignedInput(q);
 const payload={organization_id:a,incident_id:incident,notice_id:q.notice_id,
  receipt_sequence:1,receipt_state:'NEGATIVE_RECEIPT',previous_digest:'0'.repeat(64),
  proof:value.proof,lease:value.lease};
 const json=JSON.stringify(payload),digest=hash(payload);
 const params=[a,incident,q.notice_id,1,'NEGATIVE_RECEIPT','0'.repeat(64),digest,json,hmacReceipt(json),1];
 const sql='SELECT v106_test.fixture_append_negative_receipt($1::uuid,$2::uuid,$3::char(64),$4::integer,$5::text,$6::char(64),$7::char(64),$8::text,$9::text,$10::integer)';
 const client=await receiptWriter.connect();
 try{
  await client.query('BEGIN');
  await client.query(sql,params);
  await assert.rejects(client.query(sql,params));
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
 const invalid= createIsolatedPostgresRevocationNotices({receiptAttestationKey,receiptPool:receiptWriter,leaseGate:fixtureGate(),pool:writer,receiptPublicKey:keyPair.publicKey,receiptClock:()=>150,receiptProofAuthority:async()=>({authority_epoch:4,revocation_watermark:3,active:false})});
 const statement={organization_id:a,incident_id:incident,notice_id:q.notice_id,receipt_sequence:1,receipt_state:'NEGATIVE_RECEIPT',signer_id:'00000000-0000-4000-8000-000000000081',authority_epoch:4,revocation_watermark:2,issued_at_ms:100,expires_at_ms:500};
 const signature_b64=sign(null,encodeFixtureReceiptProof(statement),keyPair.privateKey).toString('base64');
 await assert.rejects(invalid.appendNegativeReceipt({...data,proof:{statement,signature_b64},lease:makeFixtureLease(q.notice_id)}),{code:'FIXTURE_RECEIPT_AUTHORITY_STALE'});
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
 const adapter=createIsolatedPostgresRevocationNotices({receiptAttestationKey,receiptPool:receiptWriter,leaseGate:fixtureGate(),pool:writer,
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
 const adapter=createIsolatedPostgresRevocationNotices({receiptAttestationKey,receiptPool:receiptWriter,leaseGate:fixtureGate(),pool:writer,
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
 const adapter=createIsolatedPostgresRevocationNotices({receiptAttestationKey,receiptPool:receiptWriter,leaseGate:fixtureGate(),pool:writer,
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
 const higher=createIsolatedPostgresRevocationNotices({receiptAttestationKey,receiptPool:receiptWriter,leaseGate:fixtureGate({revocation_watermark:3}),pool:writer,
  receiptPublicKey:keyPair.publicKey,receiptClock:()=>150,
  receiptProofAuthority:async()=>({authority_epoch:4,revocation_watermark:3,active:true})});
 const first=await higher.appendNegativeReceipt({...value,proof,lease:makeFixtureLease(value.notice_id,4,3)});
 assert.equal(first.hold_active,true);
 const row=await writer.query('SELECT revocation_watermark FROM v106_test.fixture_signer_watermarks WHERE organization_id=$1 AND incident_id=$2 AND signer_id=$3',[a,incident,elevated.signer_id]);
 assert.equal(row.rows[0].revocation_watermark,3);
 const q2=await service.enqueue({...input,epoch:52});
 const old=fixtureSignedInput(q2);
 const restarted=createIsolatedPostgresRevocationNotices({receiptAttestationKey,receiptPool:receiptWriter,leaseGate:fixtureGate(),pool:writer,
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

test('receipt adapter refuses absent lease verifier even with signed proof',async()=>{
 assert.throws(()=>createIsolatedPostgresRevocationNotices({receiptAttestationKey,receiptPool:receiptWriter,pool:writer,
  receiptPublicKey:keyPair.publicKey,receiptClock:()=>150,
  receiptProofAuthority:proofAuthority}),/LEASE_GATE_REQUIRED/);
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
 const adapter=()=>createIsolatedPostgresRevocationNotices({receiptAttestationKey,receiptPool:receiptWriter,pool:writer,
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

function issuedFixtureReceipt(notice_id,signer_id,sequence,issued_at_ms=100,expires_at_ms=200){
 const statement={organization_id:a,incident_id:incident,notice_id,receipt_sequence:1,
  receipt_state:'NEGATIVE_RECEIPT',signer_id,authority_epoch:4,revocation_watermark:2,
  issued_at_ms:100,expires_at_ms:500};
 const proof={statement,signature_b64:sign(null,encodeFixtureReceiptProof(statement),keyPair.privateKey).toString('base64')};
 const lease={organization_id:a,incident_id:incident,signer_id,notice_id,
  authority_epoch:4,revocation_watermark:2,lease_sequence:sequence,issued_at_ms,expires_at_ms};
 return {organization_id:a,incident_id:incident,notice_id,receipt_sequence:1,
  receipt_state:'NEGATIVE_RECEIPT',proof,
  lease:{lease,signature_b64:sign(null,encodeFixtureLease(lease),fixtureLeaseKeys.privateKey).toString('base64')}};
}
function isolatedLeaseWriter(sequence,now=150,options={}){
 return createIsolatedPostgresRevocationNotices({receiptAttestationKey,receiptPool:receiptWriter,pool:writer,receiptPublicKey:keyPair.publicKey,
  receiptClock:()=>now,receiptProofAuthority:async()=>({active:true,authority_epoch:4,revocation_watermark:2}),
  leaseGate:createFixtureLeaseGate({publicKey:fixtureLeaseKeys.publicKey,clock:()=>now,
   loadAuthority:async()=>({active:true,authority_epoch:4,revocation_watermark:2,lease_sequence:sequence})}),
  ...options});
}
test('concurrent independent adapters fence competing lease sequences on shared SQL row',async()=>{
 const signer='00000000-0000-4000-8000-000000000083';
 const qLow=await service.enqueue({...input,epoch:71});
 const qHigh=await service.enqueue({...input,epoch:72});
 const low=issuedFixtureReceipt(qLow.notice_id,signer,4);
 const high=issuedFixtureReceipt(qHigh.notice_id,signer,5);
 const settled=await Promise.allSettled([
  isolatedLeaseWriter(4).appendNegativeReceipt(low),
  isolatedLeaseWriter(5).appendNegativeReceipt(high)
 ]);
 assert.equal(settled[1].status,'fulfilled',JSON.stringify(settled.map(x=>x.reason?.code)));
 if(settled[0].status==='rejected'){
  assert.ok(['NOTICE_SIGNER_WATERMARK_REGRESSION','40001','40P01'].includes(settled[0].reason?.code),
   String(settled[0].reason?.code));
 }else assert.equal(settled[0].value.hold_active,true);
 const marker=await writer.query('SELECT lease_sequence FROM v106_test.fixture_signer_watermarks WHERE organization_id=$1 AND incident_id=$2 AND signer_id=$3',[a,incident,signer]);
 assert.equal(marker.rows[0].lease_sequence,5);
 const old=await service.enqueue({...input,epoch:73});
 await assert.rejects(isolatedLeaseWriter(4).appendNegativeReceipt(issuedFixtureReceipt(old.notice_id,signer,4)),
  {code:'NOTICE_SIGNER_WATERMARK_REGRESSION'});
 const counts=await writer.query('SELECT count(*)::int AS n FROM v106_test.fixture_revocation_negative_receipts WHERE notice_id=$1',[old.notice_id]);
 assert.equal(counts.rows[0].n,0);
});
test('expired lease cannot be revived; fresh higher sequence restores isolated writes',async()=>{
 const signer='00000000-0000-4000-8000-000000000084';
 const expiredNotice=await service.enqueue({...input,epoch:74});
 const expired=issuedFixtureReceipt(expiredNotice.notice_id,signer,6);
 await assert.rejects(isolatedLeaseWriter(6,200).appendNegativeReceipt(expired),{code:'LEASE_EXPIRED'});
 const freshNotice=await service.enqueue({...input,epoch:75});
 const fresh=issuedFixtureReceipt(freshNotice.notice_id,signer,7,201,240);
 const result=await isolatedLeaseWriter(7,210).appendNegativeReceipt(fresh);
 assert.equal(result.hold_active,true);
 const row=await writer.query('SELECT lease_sequence FROM v106_test.fixture_signer_watermarks WHERE organization_id=$1 AND incident_id=$2 AND signer_id=$3',[a,incident,signer]);
 assert.equal(row.rows[0].lease_sequence,7);
 await assert.rejects(isolatedLeaseWriter(6,210).appendNegativeReceipt(expired),{code:'LEASE_EXPIRED'});
 const count=await writer.query('SELECT count(*)::int AS n FROM v106_test.fixture_revocation_negative_receipts WHERE notice_id=$1',[expiredNotice.notice_id]);
 assert.equal(count.rows[0].n,0);
});
test('pre-commit fault rolls back both receipt and signer lease sequence',async()=>{
 const signer='00000000-0000-4000-8000-000000000085';
 const notice=await service.enqueue({...input,epoch:76});
 const value=issuedFixtureReceipt(notice.notice_id,signer,8);
 const faulty=isolatedLeaseWriter(8,150,{beforeReceiptCommit:async()=>{throw Error('fixture commit outage');}});
 await assert.rejects(faulty.appendNegativeReceipt(value),/fixture commit outage/);
 const marker=await writer.query('SELECT count(*)::int AS n FROM v106_test.fixture_signer_watermarks WHERE organization_id=$1 AND incident_id=$2 AND signer_id=$3',[a,incident,signer]);
 assert.equal(marker.rows[0].n,0);
 const receipts=await writer.query('SELECT count(*)::int AS n FROM v106_test.fixture_revocation_negative_receipts WHERE notice_id=$1',[notice.notice_id]);
 assert.equal(receipts.rows[0].n,0);
 const result=await isolatedLeaseWriter(8).appendNegativeReceipt(value);
 assert.equal(result.hold_active,true);
});

test('ordinary writer role cannot INSERT signed receipt evidence directly',async()=>{
 const q=await service.enqueue({...input,epoch:81});
 await assert.rejects(writer.query('INSERT INTO v106_test.fixture_revocation_negative_receipts (organization_id,incident_id,notice_id,receipt_sequence,receipt_state,previous_digest,receipt_digest,receipt_payload) VALUES($1,$2,$3,1,$4,$5,$6,$7)',
  [a,incident,q.notice_id,'NEGATIVE_RECEIPT','0'.repeat(64),'a'.repeat(64),'{}']),/permission denied/);
 const r=await writer.query('SELECT count(*)::int AS n FROM v106_test.fixture_revocation_negative_receipts WHERE notice_id=$1',[q.notice_id]);
 assert.equal(r.rows[0].n,0);
});
test('receipt adapter cannot accept ordinary writer as privileged receipt connection',async()=>{
 const q=await service.enqueue({...input,epoch:82});
 const incorrectlyWired=createIsolatedPostgresRevocationNotices({receiptAttestationKey,receiptPool:writer,pool:writer,
  leaseGate:fixtureGate(),receiptPublicKey:keyPair.publicKey,receiptClock:()=>150,
  receiptProofAuthority:proofAuthority});
 await assert.rejects(incorrectlyWired.appendNegativeReceipt(fixtureSignedInput(q)),{code:'NOTICE_SQL_CONTEXT_UNTRUSTED'});
});

test('dedicated receipt role cannot INSERT table directly',async()=>{
 const q=await service.enqueue({...input,epoch:83});
 await assert.rejects(receiptWriter.query('INSERT INTO v106_test.fixture_revocation_negative_receipts (organization_id,incident_id,notice_id,receipt_sequence,receipt_state,previous_digest,receipt_digest,receipt_payload) VALUES($1,$2,$3,1,$4,$5,$6,$7)',
  [a,incident,q.notice_id,'NEGATIVE_RECEIPT','0'.repeat(64),'a'.repeat(64),'{}']),/permission denied/);
 const row=await writer.query('SELECT count(*)::int AS n FROM v106_test.fixture_revocation_negative_receipts WHERE notice_id=$1',[q.notice_id]);
 assert.equal(row.rows[0].n,0);
});
test('definer receipt gate rejects mismatched digest and unsigned envelope',async()=>{
 const q=await service.enqueue({...input,epoch:84});
 const sql='SELECT v106_test.fixture_append_negative_receipt($1::uuid,$2::uuid,$3::char(64),$4::integer,$5::text,$6::char(64),$7::char(64),$8::text,$9::text,$10::integer)';
 const params=[a,incident,q.notice_id,1,'NEGATIVE_RECEIPT','0'.repeat(64),'a'.repeat(64),'{}',hmacReceipt('{}'),1];
 await assert.rejects(receiptWriter.query(sql,params),/V121_RECEIPT_GATE_INVALID/);
 const forged={organization_id:a,incident_id:incident,notice_id:q.notice_id,
  receipt_sequence:1,receipt_state:'NEGATIVE_RECEIPT',previous_digest:'0'.repeat(64)};
 await assert.rejects(receiptWriter.query(sql,[...params.slice(0,6),hash(forged),JSON.stringify(forged),hmacReceipt(JSON.stringify(forged)),1]),/V121_RECEIPT_GATE_ENVELOPE/);
 const after=await writer.query('SELECT count(*)::int AS n FROM v106_test.fixture_revocation_negative_receipts WHERE notice_id=$1',[q.notice_id]);
 assert.equal(after.rows[0].n,0);
});

test('receipt role cannot read attestation secret or forge structurally complete receipt',async()=>{
 const q=await service.enqueue({...input,epoch:85});
 await assert.rejects(receiptWriter.query('SELECT attestation_key FROM v106_test.fixture_receipt_attestation_secrets'),/permission denied/);
 const value=fixtureSignedInput(q);
 const payload={organization_id:a,incident_id:incident,notice_id:q.notice_id,
  receipt_sequence:1,receipt_state:'NEGATIVE_RECEIPT',previous_digest:'0'.repeat(64),
  proof:value.proof,lease:value.lease};
 const raw=JSON.stringify(payload);
 const sql='SELECT v106_test.fixture_append_negative_receipt($1::uuid,$2::uuid,$3::char(64),$4::integer,$5::text,$6::char(64),$7::char(64),$8::text,$9::text,$10::integer)';
 const params=[a,incident,q.notice_id,1,'NEGATIVE_RECEIPT','0'.repeat(64),hash(payload),raw,'0'.repeat(64),1];
 await assert.rejects(receiptWriter.query(sql,params),/V121_RECEIPT_ATTESTATION_REJECTED/);
 const count=await writer.query('SELECT count(*)::int AS n FROM v106_test.fixture_revocation_negative_receipts WHERE notice_id=$1',[q.notice_id]);
 assert.equal(count.rows[0].n,0);
});
test('wrong MAC fails without storing receipt or signer watermark',async()=>{
 const q=await service.enqueue({...input,epoch:86});
 const receipt=issuedFixtureReceipt(q.notice_id,'00000000-0000-4000-8000-000000000086',9);
 const p={organization_id:a,incident_id:incident,notice_id:q.notice_id,receipt_sequence:1,
  receipt_state:'NEGATIVE_RECEIPT',previous_digest:'0'.repeat(64),proof:receipt.proof,lease:receipt.lease};
 const raw=JSON.stringify(p);
 const sql='SELECT v106_test.fixture_append_negative_receipt($1::uuid,$2::uuid,$3::char(64),$4::integer,$5::text,$6::char(64),$7::char(64),$8::text,$9::text,$10::integer)';
 await assert.rejects(receiptWriter.query(sql,[a,incident,q.notice_id,1,'NEGATIVE_RECEIPT','0'.repeat(64),hash(p),raw,'f'.repeat(64),1]),/V121_RECEIPT_ATTESTATION_REJECTED/);
 const row=await writer.query('SELECT count(*)::int AS n FROM v106_test.fixture_revocation_negative_receipts WHERE notice_id=$1',[q.notice_id]);
 assert.equal(row.rows[0].n,0);
});

test('HMAC key rotation revokes old version and permits explicit new version',async()=>{
 const oldKey=receiptAttestationKey;
 const newKey=randomBytes(32);
 const q=await service.enqueue({...input,epoch:90});
 const event=issuedFixtureReceipt(q.notice_id,'00000000-0000-4000-8000-000000000090',4);
 const payload={organization_id:a,incident_id:incident,notice_id:q.notice_id,
  receipt_sequence:1,receipt_state:'NEGATIVE_RECEIPT',previous_digest:'0'.repeat(64),
  proof:event.proof,lease:event.lease};
 const raw=JSON.stringify(payload);
 const digest=hash(payload);
 const oldMac=createHmac('sha256',oldKey).update(raw).digest('hex');
 const newMac=createHmac('sha256',newKey).update(raw).digest('hex');
 const sql='SELECT v106_test.fixture_append_negative_receipt($1::uuid,$2::uuid,$3::char(64),$4::integer,$5::text,$6::char(64),$7::char(64),$8::text,$9::text,$10::integer)';
 const base=[a,incident,q.notice_id,1,'NEGATIVE_RECEIPT','0'.repeat(64),digest,raw];
 await admin.query('UPDATE v106_test.fixture_receipt_attestation_secrets SET active=false WHERE organization_id=$1 AND key_version=1',[a]);
 await admin.query('INSERT INTO v106_test.fixture_receipt_attestation_secrets(organization_id,key_version,attestation_key,active) VALUES($1,2,$2,true)',[a,newKey]);
  await assert.rejects(receiptWriter.query(sql,[...base,oldMac,1]),/V121_RECEIPT_ATTESTATION_REJECTED/);
  await assert.rejects(receiptWriter.query(sql,[...base,oldMac,2]),/V121_RECEIPT_ATTESTATION_REJECTED/);
  const q2=await service.enqueue({...input,epoch:91});
  const stale=createIsolatedPostgresRevocationNotices({
   receiptAttestationKey:oldKey,receiptAttestationVersion:1,
   receiptPool:receiptWriter,pool:writer,receiptPublicKey:keyPair.publicKey,
   receiptClock:()=>150,receiptProofAuthority:async()=>({active:true,authority_epoch:4,revocation_watermark:2}),
   leaseGate:createFixtureLeaseGate({publicKey:fixtureLeaseKeys.publicKey,clock:()=>150,
    loadAuthority:async()=>({active:true,authority_epoch:4,revocation_watermark:2,lease_sequence:5})})
  });
  await assert.rejects(stale.appendNegativeReceipt(issuedFixtureReceipt(q2.notice_id,'00000000-0000-4000-8000-000000000091',5)),
   /V121_RECEIPT_ATTESTATION_REJECTED/);
  const refreshed=createIsolatedPostgresRevocationNotices({
   receiptAttestationKey:newKey,receiptAttestationVersion:2,
   receiptPool:receiptWriter,pool:writer,receiptPublicKey:keyPair.publicKey,
   receiptClock:()=>150,receiptProofAuthority:async()=>({active:true,authority_epoch:4,revocation_watermark:2}),
   leaseGate:createFixtureLeaseGate({publicKey:fixtureLeaseKeys.publicKey,clock:()=>150,
    loadAuthority:async()=>({active:true,authority_epoch:4,revocation_watermark:2,lease_sequence:5})})
  });
  const after=await refreshed.appendNegativeReceipt(issuedFixtureReceipt(q2.notice_id,'00000000-0000-4000-8000-000000000091',5));
  assert.equal(after.hold_active,true);
  assert.equal(after.duplicate,false);
  const r=await writer.query('SELECT count(*)::int AS n FROM v106_test.fixture_revocation_negative_receipts WHERE notice_id=$1',[q.notice_id]);
  assert.equal(r.rows[0].n,0);
  await assert.rejects(admin.query('UPDATE v106_test.fixture_receipt_attestation_secrets SET active=true WHERE organization_id=$1 AND key_version=1',[a]),/V121_ATTESTATION_KEY_IMMUTABLE/);
  await assert.rejects(admin.query('INSERT INTO v106_test.fixture_receipt_attestation_secrets(organization_id,key_version,attestation_key,active) VALUES($1,3,$2,true)',[a,randomBytes(32)]),/duplicate key/);
});
test('invalid key versions and unauthorized secret updates are rejected',async()=>{
 const q=await service.enqueue({...input,epoch:92});
 const event=issuedFixtureReceipt(q.notice_id,'00000000-0000-4000-8000-000000000092',6);
 const payload={organization_id:a,incident_id:incident,notice_id:q.notice_id,
  receipt_sequence:1,receipt_state:'NEGATIVE_RECEIPT',previous_digest:'0'.repeat(64),
  proof:event.proof,lease:event.lease};
 const raw=JSON.stringify(payload);
 const sql='SELECT v106_test.fixture_append_negative_receipt($1::uuid,$2::uuid,$3::char(64),$4::integer,$5::text,$6::char(64),$7::char(64),$8::text,$9::text,$10::integer)';
 const base=[a,incident,q.notice_id,1,'NEGATIVE_RECEIPT','0'.repeat(64),hash(payload),raw,hmacReceipt(raw)];
 await assert.rejects(receiptWriter.query(sql,[...base,0]),/V121_RECEIPT_KEY_VERSION_INVALID/);
 await assert.rejects(receiptWriter.query(sql,[...base,99]),/V121_RECEIPT_KEY_AUDIT_UNVERIFIED/);
 await assert.rejects(receiptWriter.query('UPDATE v106_test.fixture_receipt_attestation_secrets SET active=true'),/permission denied/);
 assert.equal((await writer.query('SELECT count(*)::int AS n FROM v106_test.fixture_revocation_negative_receipts WHERE notice_id=$1',[q.notice_id])).rows[0].n,0);
});

test('simulated secret compromise revokes v2 and restores only with new v3 key',async()=>{
 const old=await admin.query('SELECT attestation_key FROM v106_test.fixture_receipt_attestation_secrets WHERE organization_id=$1 AND key_version=2 AND active=true',[a]);
 assert.equal(old.rowCount,1);
 const oldKey=old.rows[0].attestation_key;
 const nextKey=randomBytes(32);
 const notice=await service.enqueue({...input,epoch:93});
 const value=issuedFixtureReceipt(notice.notice_id,'00000000-0000-4000-8000-000000000093',6);
 const make=(key,version)=>createIsolatedPostgresRevocationNotices({
  receiptAttestationKey:key,receiptAttestationVersion:version,
  receiptPool:receiptWriter,pool:writer,receiptPublicKey:keyPair.publicKey,receiptClock:()=>150,
  receiptProofAuthority:async()=>({active:true,authority_epoch:4,revocation_watermark:2}),
  leaseGate:createFixtureLeaseGate({publicKey:fixtureLeaseKeys.publicKey,clock:()=>150,
   loadAuthority:async()=>({active:true,authority_epoch:4,revocation_watermark:2,lease_sequence:6})})
 });
 await admin.query('UPDATE v106_test.fixture_receipt_attestation_secrets SET active=false WHERE organization_id=$1 AND key_version=2',[a]);
 await assert.rejects(make(oldKey,2).appendNegativeReceipt(value),/V121_RECEIPT_ATTESTATION_REJECTED/);
 const before=await writer.query('SELECT count(*)::int AS n FROM v106_test.fixture_revocation_negative_receipts WHERE notice_id=$1',[notice.notice_id]);
 assert.equal(before.rows[0].n,0);
 // Issuance is a simulated incident-owner action, not a production approval.
 await admin.query('INSERT INTO v106_test.fixture_receipt_attestation_secrets(organization_id,key_version,attestation_key,active) VALUES($1,3,$2,true)',[a,nextKey]);
 const result=await make(nextKey,3).appendNegativeReceipt(value);
 assert.equal(result.hold_active,true);
 assert.equal(result.duplicate,false);
 await assert.rejects(admin.query('UPDATE v106_test.fixture_receipt_attestation_secrets SET active=true WHERE organization_id=$1 AND key_version=2',[a]),/V121_ATTESTATION_KEY_IMMUTABLE/);
});
test('fixture key events are auditable, secret-free and append-only',async()=>{
 const events=await admin.query('SELECT key_version,event_kind,actor,event_digest FROM v106_test.fixture_receipt_key_audit WHERE organization_id=$1 ORDER BY event_id',[a]);
 assert.deepEqual(events.rows.map(x=>[x.key_version,x.event_kind]),[
  [1,'KEY_ISSUED'],[1,'KEY_REVOKED'],[2,'KEY_ISSUED'],[2,'KEY_REVOKED'],[3,'KEY_ISSUED']]);
 for(const e of events.rows){
  const meta=[a,e.key_version,e.event_kind,e.actor].join('|');
  assert.equal(e.event_digest,createHash('sha256').update(meta).digest('hex'));
  assert.ok(['postgres'].includes(e.actor));
 }
 await assert.rejects(writer.query('SELECT * FROM v106_test.fixture_receipt_key_audit'),/permission denied/);
 await assert.rejects(receiptWriter.query('DELETE FROM v106_test.fixture_receipt_key_audit'),/permission denied/);
 await assert.rejects(admin.query('UPDATE v106_test.fixture_receipt_key_audit SET actor=\'changed\' WHERE organization_id=$1',[a]),/V121_KEY_AUDIT_APPEND_ONLY/);
 await assert.rejects(admin.query('DELETE FROM v106_test.fixture_receipt_key_audit WHERE organization_id=$1',[a]),/V121_KEY_AUDIT_APPEND_ONLY/);
 assert.equal((await admin.query('SELECT count(*)::int AS n FROM v106_test.fixture_receipt_key_audit WHERE organization_id=$1',[a])).rows[0].n,5);
});

test('independent audit reader sees metadata but no key or mutation privileges',async()=>{
 const rows=await auditReader.query('SELECT organization_id,key_version,event_kind,actor,event_digest FROM v106_test.fixture_receipt_key_audit WHERE organization_id=$1 ORDER BY event_id',[a]);
 assert.equal(rows.rowCount,5);
 assert.ok(rows.rows.every(r=>r.event_digest.length===64));
 await assert.rejects(auditReader.query('SELECT * FROM v106_test.fixture_receipt_attestation_secrets'),/permission denied/);
 await assert.rejects(auditReader.query('INSERT INTO v106_test.fixture_receipt_key_audit(organization_id,key_version,event_kind,actor,event_digest) VALUES($1,5,\'KEY_ISSUED\',\'forged\',$2)',[a,'0'.repeat(64)]),/permission denied/);
 await assert.rejects(auditReader.query('DELETE FROM v106_test.fixture_receipt_key_audit'),/permission denied/);
 await assert.rejects(auditReader.query('SELECT * FROM v106_test.fixture_revocation_negative_receipts'),/permission denied/);
});
test('corrupt active key issuance audit fails closed without changing HOLD receipts',async()=>{
 const version=3;
 const stored=await admin.query('SELECT event_digest FROM v106_test.fixture_receipt_key_audit WHERE organization_id=$1 AND key_version=$2 AND event_kind=$3',[a,version,'KEY_ISSUED']);
 assert.equal(stored.rowCount,1);
 const key=await admin.query('SELECT attestation_key FROM v106_test.fixture_receipt_attestation_secrets WHERE organization_id=$1 AND key_version=3 AND active=true',[a]);
 assert.equal(key.rowCount,1);
 const q=await service.enqueue({...input,epoch:94});
 const signer='00000000-0000-4000-8000-000000000094';
 const receipt=issuedFixtureReceipt(q.notice_id,signer,7);
 const adapter=createIsolatedPostgresRevocationNotices({receiptAttestationKey:key.rows[0].attestation_key,
  receiptAttestationVersion:3,receiptPool:receiptWriter,pool:writer,receiptPublicKey:keyPair.publicKey,
  receiptClock:()=>150,receiptProofAuthority:async()=>({active:true,authority_epoch:4,revocation_watermark:2}),
  leaseGate:createFixtureLeaseGate({publicKey:fixtureLeaseKeys.publicKey,clock:()=>150,
   loadAuthority:async()=>({active:true,authority_epoch:4,revocation_watermark:2,lease_sequence:7})})});
 // Simulate privileged database tampering without granting the app such privilege.
 await admin.query('ALTER TABLE v106_test.fixture_receipt_key_audit DISABLE TRIGGER fixture_key_audit_immutable');
 try{
  await admin.query('UPDATE v106_test.fixture_receipt_key_audit SET event_digest=$4 WHERE organization_id=$1 AND key_version=$2 AND event_kind=$3',[a,version,'KEY_ISSUED','0'.repeat(64)]);
 }finally{
  await admin.query('ALTER TABLE v106_test.fixture_receipt_key_audit ENABLE TRIGGER fixture_key_audit_immutable');
 }
 try{
  await assert.rejects(adapter.appendNegativeReceipt(receipt),/V121_RECEIPT_KEY_AUDIT_UNVERIFIED/);
  const count=await writer.query('SELECT count(*)::int AS n FROM v106_test.fixture_revocation_negative_receipts WHERE notice_id=$1',[q.notice_id]);
  assert.equal(count.rows[0].n,0);
  const marker=await writer.query('SELECT count(*)::int AS n FROM v106_test.fixture_signer_watermarks WHERE organization_id=$1 AND incident_id=$2 AND signer_id=$3',[a,incident,signer]);
  assert.equal(marker.rows[0].n,0);
 }finally{
  await admin.query('ALTER TABLE v106_test.fixture_receipt_key_audit DISABLE TRIGGER fixture_key_audit_immutable');
  try{await admin.query('UPDATE v106_test.fixture_receipt_key_audit SET event_digest=$4 WHERE organization_id=$1 AND key_version=$2 AND event_kind=$3',[a,version,'KEY_ISSUED',stored.rows[0].event_digest]);}
  finally{await admin.query('ALTER TABLE v106_test.fixture_receipt_key_audit ENABLE TRIGGER fixture_key_audit_immutable');}
 }
 const result=await adapter.appendNegativeReceipt(receipt);
 assert.equal(result.hold_active,true);
});

const recoveryApproverIds={
 AUDIT_REVIEW:'00000000-0000-4000-8000-0000000000d1',
 SECURITY_REVIEW:'00000000-0000-4000-8000-0000000000e2'
};
const recoveryApproverKeys=Object.fromEntries(Object.keys(recoveryApproverIds).map(x=>[x,generateKeyPairSync('ed25519')]));
async function recoveryInputs(version,id){
 const event=await admin.query('SELECT event_digest FROM v106_test.fixture_receipt_key_audit WHERE organization_id=$1 AND key_version=$2 AND event_kind=$3',[a,version-1,'KEY_REVOKED']);
 assert.equal(event.rowCount,1);
 const request={organization_id:a,incident_id:incident,
  request_id:id,key_version:version,audit_digest:event.rows[0].event_digest,
  issued_at_ms:100,expires_at_ms:200};
 const d=createHash('sha256').update(encodeFixtureRecoveryRequest(request)).digest('hex');
 const approvals=Object.keys(recoveryApproverIds).map(role=>{
  const basic={approver_id:recoveryApproverIds[role],role,request_digest:d};
  return {...basic,signature_b64:sign(null,encodeFixtureRecoveryApproval(basic),recoveryApproverKeys[role].privateKey).toString('base64')};
 });
 return {request,approvals};
}
function freshRecoveryIssuer({fault,anchorOk=true,approvalKey=approvalAttestationKey,approvalVersion=1}={}){
 const gate=createFixtureRecoveryGate({
  approverKeys:Object.fromEntries(Object.keys(recoveryApproverIds).map(role=>[role,
   {approver_id:recoveryApproverIds[role],publicKey:recoveryApproverKeys[role].publicKey}])),
  clock:()=>150,
  readAudit:async r=>{
   const event=await admin.query('SELECT event_kind,key_version,event_digest FROM v106_test.fixture_receipt_key_audit WHERE organization_id=$1 AND key_version=$2 AND event_kind=$3',[r.organization_id,r.key_version-1,'KEY_REVOKED']);
   return event.rowCount===1?{organization_id:r.organization_id,...event.rows[0]}:null;
  },
  readAnchor:async e=>({request_digest:e.request_digest,audit_digest:e.audit_digest,
   anchored:anchorOk,source:'FIXTURE_SEPARATE_ARCHIVE'})
 });
 return createFixtureRecoveryIssuance({issuerPool:issuerWriter,recoveryGate:gate,approvalAttestationKey:approvalKey,approvalAttestationVersion:approvalVersion,
  beforeKeyInsert:fault|| (async()=>{})});
}
test('two-person recovery issuance and durable replay fencing across adapter instances',async()=>{
 await admin.query('UPDATE v106_test.fixture_receipt_attestation_secrets SET active=false WHERE organization_id=$1 AND key_version=3',[a]);
 const input4=await recoveryInputs(4,'00000000-0000-4000-8000-0000000000f4');
 const key4=randomBytes(32);
 await assert.rejects(freshRecoveryIssuer().issue({...input4,approvals:input4.approvals.slice(0,1),attestationKey:key4}),
  {code:'RECOVERY_TWO_PERSON_REQUIRED'});
 await assert.rejects(freshRecoveryIssuer({anchorOk:false}).issue({...input4,attestationKey:key4}),
  {code:'RECOVERY_ANCHOR_UNVERIFIED'});
 assert.equal((await admin.query('SELECT count(*)::int AS n FROM v106_test.fixture_recovery_consumptions WHERE key_version=4')).rows[0].n,0);
 // Simulate privileged corruption of one domain HOLD projection; SQL admission must fail closed.
 await admin.query('ALTER TABLE v106_test.fixture_cross_module_holds DISABLE TRIGGER fixture_hold_immutable');
 try{
  await admin.query("DELETE FROM v106_test.fixture_cross_module_holds WHERE organization_id=$1 AND incident_id=$2 AND module_name='FINANCE'",[a,incident]);
 }finally{
  await admin.query('ALTER TABLE v106_test.fixture_cross_module_holds ENABLE TRIGGER fixture_hold_immutable');
 }
 try{
  await assert.rejects(freshRecoveryIssuer().issue({...input4,attestationKey:key4}),{code:'V121_CROSS_MODULE_HOLD_INCOMPLETE'});
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM v106_test.fixture_recovery_consumptions WHERE key_version=4')).rows[0].n,0);
 }finally{
  await admin.query("INSERT INTO v106_test.fixture_cross_module_holds(organization_id,incident_id,module_name) VALUES($1,$2,'FINANCE')",[a,incident]);
 }
 const good=await freshRecoveryIssuer().issue({...input4,attestationKey:key4});
 assert.equal(good.fixture_key_issued,true);
 assert.equal(good.hold_active,true);
 assert.equal(good.release_eligible,false);
 const rows=await admin.query('SELECT count(*)::int AS n FROM v106_test.fixture_recovery_consumptions WHERE organization_id=$1 AND request_id=$2',[a,input4.request.request_id]);
 assert.equal(rows.rows[0].n,1);
 await assert.rejects(freshRecoveryIssuer().issue({...input4,attestationKey:randomBytes(32)}),
  {code:'RECOVERY_ALREADY_CONSUMED'});
 await assert.rejects(receiptWriter.query('INSERT INTO v106_test.fixture_recovery_consumptions(organization_id,incident_id,request_id,request_digest,key_version,revocation_audit_digest,approver_audit_id,approver_security_id,anchor_source) VALUES($1,$2,$3,$4,4,$5,$6,$7,$8)',[
  a,incident,'00000000-0000-4000-8000-0000000000ee','a'.repeat(64),input4.request.audit_digest,
  recoveryApproverIds.AUDIT_REVIEW,recoveryApproverIds.SECURITY_REVIEW,'FIXTURE_SEPARATE_ARCHIVE']),/permission denied/);
});
test('two independent issuance instances cannot both consume one recovery approval',async()=>{
 await admin.query('UPDATE v106_test.fixture_receipt_attestation_secrets SET active=false WHERE organization_id=$1 AND key_version=4',[a]);
 const input5=await recoveryInputs(5,'00000000-0000-4000-8000-0000000000f5');
 const outcomes=await Promise.allSettled([
  freshRecoveryIssuer().issue({...input5,attestationKey:randomBytes(32)}),
  freshRecoveryIssuer().issue({...input5,attestationKey:randomBytes(32)})
 ]);
 assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(outcomes.filter(x=>x.status==='rejected').length,1);
 assert.ok(['23505','40001','RECOVERY_ALREADY_CONSUMED','RECOVERY_VERSION_NOT_NEXT'].includes(outcomes.find(x=>x.status==='rejected').reason.code));
 assert.equal((await admin.query('SELECT count(*)::int AS n FROM v106_test.fixture_recovery_consumptions WHERE key_version=5')).rows[0].n,1);
 assert.equal((await admin.query('SELECT count(*)::int AS n FROM v106_test.fixture_receipt_attestation_secrets WHERE key_version=5 AND active=true')).rows[0].n,1);
});
test('recovery fault rolls back durable approval consumption and key issuance together',async()=>{
 await admin.query('UPDATE v106_test.fixture_receipt_attestation_secrets SET active=false WHERE organization_id=$1 AND key_version=5',[a]);
 const input6=await recoveryInputs(6,'00000000-0000-4000-8000-0000000000f6');
 const key6=randomBytes(32);
 await assert.rejects(freshRecoveryIssuer({fault:async()=>{throw Error('simulated key provisioning outage');}})
  .issue({...input6,attestationKey:key6}),/simulated key provisioning outage/);
 assert.equal((await admin.query('SELECT count(*)::int AS n FROM v106_test.fixture_recovery_consumptions WHERE key_version=6')).rows[0].n,0);
 assert.equal((await admin.query('SELECT count(*)::int AS n FROM v106_test.fixture_receipt_attestation_secrets WHERE key_version=6')).rows[0].n,0);
 const retry=await freshRecoveryIssuer().issue({...input6,attestationKey:key6});
 assert.equal(retry.hold_active,true);
 assert.equal((await admin.query('SELECT count(*)::int AS n FROM v106_test.fixture_recovery_consumptions WHERE key_version=6')).rows[0].n,1);
 await assert.rejects(admin.query('DELETE FROM v106_test.fixture_recovery_consumptions WHERE key_version=6'),/V121_RECOVERY_CONSUMPTION_IMMUTABLE/);
});

test('scoped key issuer has no direct DML and cannot impersonate admin or bypass verifier',async()=>{
 await assert.rejects(issuerWriter.query('SELECT * FROM v106_test.fixture_receipt_attestation_secrets'),/permission denied/);
 await assert.rejects(issuerWriter.query('SELECT * FROM v106_test.fixture_recovery_consumptions'),/permission denied/);
 await assert.rejects(issuerWriter.query('UPDATE v106_test.fixture_receipt_attestation_secrets SET active=true'),/permission denied/);
 await assert.rejects(issuerWriter.query('INSERT INTO v106_test.fixture_receipt_attestation_secrets(organization_id,key_version,attestation_key,active) VALUES($1,7,$2,true)',[a,randomBytes(32)]),/permission denied/);
 await assert.rejects(issuerWriter.query('DELETE FROM v106_test.fixture_recovery_consumptions'),/permission denied/);
 assert.equal((await admin.query('SELECT count(*)::int AS n FROM v106_test.fixture_receipt_attestation_secrets WHERE key_version=7')).rows[0].n,0);
});
test('ordinary receipt role cannot execute scoped issuance gateway',async()=>{
 await assert.rejects(receiptWriter.query('SELECT v106_test.fixture_issue_recovery_key($1::uuid,$2::uuid,$3::uuid,$4::char(64),$5::integer,$6::char(64),$7::uuid,$8::uuid,$9::bytea,$10::text,$11::integer,$12::bigint,$13::bigint)',
  [a,incident,'00000000-0000-4000-8000-0000000000f8','a'.repeat(64),7,'b'.repeat(64),
   recoveryApproverIds.AUDIT_REVIEW,recoveryApproverIds.SECURITY_REVIEW,randomBytes(32),'0'.repeat(64),1,100,200]),/permission denied/);
});

test('issuer direct SQL gateway call without valid independent approval attestation fails closed',async()=>{
 await admin.query('UPDATE v106_test.fixture_receipt_attestation_secrets SET active=false WHERE organization_id=$1 AND key_version=6',[a]);
 const {request,approvals}=await recoveryInputs(7,'00000000-0000-4000-8000-0000000000a7');
 const requestDigest=createHash('sha256').update(encodeFixtureRecoveryRequest(request)).digest('hex');
 const auditId=approvals.find(x=>x.role==='AUDIT_REVIEW').approver_id;
 const securityId=approvals.find(x=>x.role==='SECURITY_REVIEW').approver_id;
 const sql='SELECT v106_test.fixture_issue_recovery_key($1::uuid,$2::uuid,$3::uuid,$4::char(64),$5::integer,$6::char(64),$7::uuid,$8::uuid,$9::bytea,$10::text,$11::integer,$12::bigint,$13::bigint)';
 const key=randomBytes(32);
 const params=[a,incident,request.request_id,requestDigest,7,request.audit_digest,auditId,securityId,key,'0'.repeat(64),1,100,200];
 await assert.rejects(issuerWriter.query(sql,params),/V121_RECOVERY_APPROVAL_ATTESTATION_REJECTED/);
 const genuineEnvelope=['v121-recovery-attestation-v2',1,100,200,a,incident,request.request_id,requestDigest,7,request.audit_digest,auditId,securityId,
  createHash('sha256').update(key).digest('hex')].join('|');
 const genuineMac=createHmac('sha256',approvalAttestationKey).update(genuineEnvelope).digest('hex');
 await assert.rejects(issuerWriter.query(sql,[...params.slice(0,8),randomBytes(32),genuineMac,1,100,200]),/V121_RECOVERY_APPROVAL_ATTESTATION_REJECTED/);
 await assert.rejects(issuerWriter.query(sql,[...params.slice(0,4),8,...params.slice(5,9),genuineMac,1,100,200]),/RECOVERY_PREVIOUS_KEY_NOT_REVOKED|V121_RECOVERY_APPROVAL_ATTESTATION_REJECTED/);
 assert.equal((await admin.query('SELECT count(*)::int AS n FROM v106_test.fixture_recovery_consumptions WHERE key_version=7')).rows[0].n,0);
 assert.equal((await admin.query('SELECT count(*)::int AS n FROM v106_test.fixture_receipt_attestation_secrets WHERE key_version=7')).rows[0].n,0);
 const good=await freshRecoveryIssuer().issue({request,approvals,attestationKey:key});
 assert.equal(good.hold_active,true);
 assert.equal((await admin.query('SELECT count(*)::int AS n FROM v106_test.fixture_recovery_consumptions WHERE key_version=7')).rows[0].n,1);
});
test('issuer and auditor cannot extract approval secret, keeping role separation',async()=>{
 await assert.rejects(issuerWriter.query('SELECT approval_key FROM v106_test.fixture_recovery_approval_attestation'),/permission denied/);
 await assert.rejects(auditReader.query('SELECT approval_key FROM v106_test.fixture_recovery_approval_attestation'),/permission denied/);
 await assert.rejects(receiptWriter.query('UPDATE v106_test.fixture_recovery_approval_attestation SET approval_key=$1',[randomBytes(32)]),/permission denied/);
});

test('SQL rejects expired approval window and retired attestation version, then rotated key recovers',async()=>{
 await admin.query('UPDATE v106_test.fixture_receipt_attestation_secrets SET active=false WHERE organization_id=$1 AND key_version=7',[a]);
 const input8=await recoveryInputs(8,'00000000-0000-4000-8000-0000000000a8');
 const key8=randomBytes(32);
 // JS time is valid (150), but DB fixture clock is separately set to expiry.
 await admin.query('UPDATE v106_test.fixture_recovery_clock SET now_ms=200 WHERE singleton=true');
 try{
  await assert.rejects(freshRecoveryIssuer().issue({...input8,attestationKey:key8}),{code:'V121_RECOVERY_ATTESTATION_EXPIRED'});
 }finally{
  await admin.query('UPDATE v106_test.fixture_recovery_clock SET now_ms=150 WHERE singleton=true');
 }
 assert.equal((await admin.query('SELECT count(*)::int AS n FROM v106_test.fixture_receipt_attestation_secrets WHERE key_version=8')).rows[0].n,0);
 await admin.query('UPDATE v106_test.fixture_recovery_approval_attestation SET active=false WHERE organization_id=$1 AND attestation_version=1',[a]);
 const emergency=(await admin.query('SELECT issuance_blocked FROM v106_test.fixture_recovery_emergency_stops WHERE organization_id=$1 AND incident_id=$2',[a,incident])).rows[0];
 assert.equal(emergency.issuance_blocked,true);
 await assert.rejects(freshRecoveryIssuer().issue({...input8,attestationKey:key8}),{code:'V121_ISSUANCE_EMERGENCY_STOP'});
 // Fixture administrator explicitly clears the independent stop for the planned rotation.
 await admin.query('UPDATE v106_test.fixture_recovery_emergency_stops SET issuance_blocked=false WHERE organization_id=$1 AND incident_id=$2',[a,incident]);
 await assert.rejects(freshRecoveryIssuer().issue({...input8,attestationKey:key8}),{code:'V121_RECOVERY_APPROVAL_ATTESTATION_REJECTED'});
 const rotatedApprovalKey=randomBytes(32);
 await admin.query('INSERT INTO v106_test.fixture_recovery_approval_attestation(organization_id,attestation_version,approval_key,active) VALUES($1,2,$2,true)',[a,rotatedApprovalKey]);
 await assert.rejects(freshRecoveryIssuer().issue({...input8,attestationKey:key8}),{code:'V121_RECOVERY_APPROVAL_ATTESTATION_REJECTED'});
 await assert.rejects(admin.query('UPDATE v106_test.fixture_recovery_approval_attestation SET active=true WHERE organization_id=$1 AND attestation_version=1',[a]),/V121_APPROVAL_KEY_IMMUTABLE/);
 await assert.rejects(admin.query('INSERT INTO v106_test.fixture_recovery_approval_attestation(organization_id,attestation_version,approval_key,active) VALUES($1,3,$2,true)',[a,randomBytes(32)]),/duplicate key/);
 const ok=await freshRecoveryIssuer({approvalKey:rotatedApprovalKey,approvalVersion:2}).issue({...input8,attestationKey:key8});
 assert.equal(ok.hold_active,true);
 assert.equal(ok.release_eligible,false);
 assert.equal((await admin.query('SELECT count(*)::int AS n FROM v106_test.fixture_recovery_consumptions WHERE key_version=8')).rows[0].n,1);
});
test('issuer cannot manipulate approval key rotation or the isolated DB clock',async()=>{
 await assert.rejects(issuerWriter.query('SELECT * FROM v106_test.fixture_recovery_approval_attestation'),/permission denied/);
 await assert.rejects(issuerWriter.query('UPDATE v106_test.fixture_recovery_approval_attestation SET active=true'),/permission denied/);
 await assert.rejects(issuerWriter.query('SELECT * FROM v106_test.fixture_recovery_clock'),/permission denied/);
 await assert.rejects(issuerWriter.query('UPDATE v106_test.fixture_recovery_clock SET now_ms=150'),/permission denied/);
});

test('compromised approval signer cannot bypass independent incident stop; sales finance and academic remain HOLD',async()=>{
 const approvals=await admin.query('SELECT approval_key FROM v106_test.fixture_recovery_approval_attestation WHERE organization_id=$1 AND attestation_version=2 AND active=true',[a]);
 assert.equal(approvals.rowCount,1);
 const approvalKey=approvals.rows[0].approval_key;
 await admin.query('UPDATE v106_test.fixture_receipt_attestation_secrets SET active=false WHERE organization_id=$1 AND key_version=8',[a]);
 const request=await recoveryInputs(9,'00000000-0000-4000-8000-0000000000a9');
 const requestDigest=createHash('sha256').update(encodeFixtureRecoveryRequest(request.request)).digest('hex');
 const auditId=request.approvals.find(x=>x.role==='AUDIT_REVIEW').approver_id;
 const securityId=request.approvals.find(x=>x.role==='SECURITY_REVIEW').approver_id;
 const key=randomBytes(32);
 const envelope=['v121-recovery-attestation-v2',2,100,200,a,incident,request.request.request_id,requestDigest,
  9,request.request.audit_digest,auditId,securityId,createHash('sha256').update(key).digest('hex')].join('|');
 const mac=createHmac('sha256',approvalKey).update(envelope).digest('hex');
 const sql='SELECT v106_test.fixture_issue_recovery_key($1::uuid,$2::uuid,$3::uuid,$4::char(64),$5::integer,$6::char(64),$7::uuid,$8::uuid,$9::bytea,$10::text,$11::integer,$12::bigint,$13::bigint)';
 const args=[a,incident,request.request.request_id,requestDigest,9,request.request.audit_digest,auditId,securityId,key,mac,2,100,200];
 // Independently activated by incident owner; issuance role cannot disable the stop.
 await admin.query('UPDATE v106_test.fixture_recovery_emergency_stops SET issuance_blocked=true WHERE organization_id=$1 AND incident_id=$2',[a,incident]);
 await assert.rejects(issuerWriter.query(sql,args),/V121_ISSUANCE_EMERGENCY_STOP/);
 await assert.rejects(freshRecoveryIssuer({approvalKey,approvalVersion:2}).issue({
  ...request,attestationKey:key}),{code:'V121_ISSUANCE_EMERGENCY_STOP'});
 await assert.rejects(issuerWriter.query('UPDATE v106_test.fixture_recovery_emergency_stops SET issuance_blocked=false'),/permission denied/);
 await assert.rejects(receiptWriter.query('UPDATE v106_test.fixture_recovery_emergency_stops SET issuance_blocked=false'),/permission denied/);
 const rows=await admin.query('SELECT module_name,hold_active,release_eligible FROM v106_test.fixture_cross_module_holds WHERE organization_id=$1 AND incident_id=$2 ORDER BY module_name',[a,incident]);
 assert.deepEqual(rows.rows.map(r=>[r.module_name,r.hold_active,r.release_eligible]),[
  ['ACADEMIC',true,false],['FINANCE',true,false],['SALES',true,false]]);
 await assert.rejects(admin.query('UPDATE v106_test.fixture_cross_module_holds SET hold_active=false WHERE organization_id=$1 AND incident_id=$2',[a,incident]),/V121_CROSS_MODULE_HOLD_IMMUTABLE|check constraint/);
 await assert.rejects(issuerWriter.query('SELECT * FROM v106_test.fixture_cross_module_holds'),/permission denied/);
 assert.equal((await admin.query('SELECT count(*)::int AS n FROM v106_test.fixture_recovery_consumptions WHERE key_version=9')).rows[0].n,0);
 assert.equal((await admin.query('SELECT count(*)::int AS n FROM v106_test.fixture_receipt_attestation_secrets WHERE key_version=9')).rows[0].n,0);
});
test('missing independent incident stop record fails closed despite otherwise valid recovery',async()=>{
 await admin.query('DELETE FROM v106_test.fixture_recovery_emergency_stops WHERE organization_id=$1 AND incident_id=$2',[a,incident]);
 const req=await recoveryInputs(9,'00000000-0000-4000-8000-0000000000b9');
 const approval=await admin.query('SELECT approval_key FROM v106_test.fixture_recovery_approval_attestation WHERE organization_id=$1 AND attestation_version=2',[a]);
 try{
  await assert.rejects(freshRecoveryIssuer({approvalKey:approval.rows[0].approval_key,approvalVersion:2})
   .issue({...req,attestationKey:randomBytes(32)}),{code:'V121_ISSUANCE_EMERGENCY_STOP'});
 }finally{
  await admin.query('INSERT INTO v106_test.fixture_recovery_emergency_stops(organization_id,incident_id,issuance_blocked) VALUES($1,$2,true)',[a,incident]);
 }
 assert.equal((await admin.query('SELECT count(*)::int AS n FROM v106_test.fixture_recovery_consumptions WHERE key_version=9')).rows[0].n,0);
});

test('approval-key revocation automatically trips emergency stop and immutable signal',async()=>{
 // This test is last: no later step is allowed to assume recovered issuance.
 await admin.query('UPDATE v106_test.fixture_recovery_emergency_stops SET issuance_blocked=false WHERE organization_id=$1 AND incident_id=$2',[a,incident]);
 const before=await admin.query('SELECT issuance_blocked FROM v106_test.fixture_recovery_emergency_stops WHERE organization_id=$1 AND incident_id=$2',[a,incident]);
 assert.equal(before.rows[0].issuance_blocked,false);
 await admin.query('UPDATE v106_test.fixture_recovery_approval_attestation SET active=false WHERE organization_id=$1 AND attestation_version=2',[a]);
 const stop=await admin.query('SELECT issuance_blocked FROM v106_test.fixture_recovery_emergency_stops WHERE organization_id=$1 AND incident_id=$2',[a,incident]);
 assert.equal(stop.rows[0].issuance_blocked,true);
 const signals=await admin.query('SELECT attestation_version,signal_kind FROM v106_test.fixture_recovery_security_signals WHERE organization_id=$1 AND incident_id=$2 ORDER BY attestation_version',[a,incident]);
 assert.deepEqual(signals.rows.map(x=>[x.attestation_version,x.signal_kind]),[
  [1,'APPROVAL_KEY_REVOKED'],[2,'APPROVAL_KEY_REVOKED']]);
 await assert.rejects(issuerWriter.query('SELECT * FROM v106_test.fixture_recovery_security_signals'),/permission denied/);
 await assert.rejects(admin.query('DELETE FROM v106_test.fixture_recovery_security_signals WHERE organization_id=$1',[a]),/V121_SECURITY_SIGNAL_IMMUTABLE/);
 const rows=await admin.query('SELECT module_name,hold_active,release_eligible FROM v106_test.fixture_cross_module_holds WHERE organization_id=$1 AND incident_id=$2 ORDER BY module_name',[a,incident]);
 assert.deepEqual(rows.rows.map(x=>[x.module_name,x.hold_active,x.release_eligible]),[
  ['ACADEMIC',true,false],['FINANCE',true,false],['SALES',true,false]]);
 assert.equal((await admin.query('SELECT count(*)::int AS n FROM v106_test.fixture_receipt_attestation_secrets WHERE key_version=9')).rows[0].n,0);
});

test('independently authenticated security event atomically blocks issuance and stays immutable',async()=>{
 const source='FIXTURE_INDEPENDENT_MONITOR';
 const kind='SIGNER_COMPROMISE';
 const eventId='00000000-0000-4000-8000-0000000000e9';
 const timestamp=150;
 const sql='SELECT v106_test.fixture_accept_external_security_event($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::bigint,$7::text)';
 const args=[a,incident,eventId,source,kind,timestamp];
 const mac=parts=>createHmac('sha256',securityEventKey).update(
  ['v121-security-event-v1',...parts].join('|')).digest('hex');
 const valid=mac(args);
 await admin.query('UPDATE v106_test.fixture_recovery_emergency_stops SET issuance_blocked=false WHERE organization_id=$1 AND incident_id=$2',[a,incident]);
 await assert.rejects(securityEventWriter.query(sql,[...args,'0'.repeat(64)]),/V121_SECURITY_EVENT_AUTH_REJECTED/);
 await assert.rejects(securityEventWriter.query(sql,[...args.slice(0,4),'APPROVAL_ANOMALY',timestamp,valid]),/V121_SECURITY_EVENT_AUTH_REJECTED/);
 await assert.rejects(securityEventWriter.query(sql,[...args.slice(0,5),-30000,valid]),/V121_SECURITY_EVENT_EXPIRED/);
 assert.equal((await admin.query('SELECT issuance_blocked FROM v106_test.fixture_recovery_emergency_stops WHERE organization_id=$1 AND incident_id=$2',[a,incident])).rows[0].issuance_blocked,false);
 assert.equal((await admin.query('SELECT count(*)::int AS n FROM v106_test.fixture_external_security_events WHERE organization_id=$1',[a])).rows[0].n,0);
 await securityEventWriter.query(sql,[...args,valid]);
 assert.equal((await admin.query('SELECT issuance_blocked FROM v106_test.fixture_recovery_emergency_stops WHERE organization_id=$1 AND incident_id=$2',[a,incident])).rows[0].issuance_blocked,true);
 await assert.rejects(securityEventWriter.query(sql,[...args,valid]),/duplicate key/);
 const rows=await admin.query('SELECT event_kind,event_digest FROM v106_test.fixture_external_security_events WHERE organization_id=$1 AND event_id=$2',[a,eventId]);
 assert.equal(rows.rows[0].event_kind,kind);
 assert.equal(rows.rows[0].event_digest,createHash('sha256').update(['v121-security-event-v1',...args].join('|')).digest('hex'));
 await assert.rejects(securityEventWriter.query('SELECT * FROM v106_test.fixture_external_security_keys'),/permission denied/);
 await assert.rejects(securityEventWriter.query('UPDATE v106_test.fixture_recovery_emergency_stops SET issuance_blocked=false'),/permission denied/);
 await assert.rejects(issuerWriter.query(sql,[...args,valid]),/permission denied/);
 await assert.rejects(admin.query('DELETE FROM v106_test.fixture_external_security_events WHERE event_id=$1',[eventId]),/V121_SECURITY_SIGNAL_IMMUTABLE/);
 const approvals=await recoveryInputs(9,'00000000-0000-4000-8000-0000000000f9');
 const old=await admin.query('SELECT approval_key FROM v106_test.fixture_recovery_approval_attestation WHERE organization_id=$1 AND attestation_version=2',[a]);
 await assert.rejects(freshRecoveryIssuer({approvalKey:old.rows[0].approval_key,approvalVersion:2})
  .issue({...approvals,attestationKey:randomBytes(32)}),{code:'V121_ISSUANCE_EMERGENCY_STOP'});
 await assert.rejects(
  admin.query('UPDATE v106_test.fixture_recovery_emergency_stops SET issuance_blocked=false WHERE organization_id=$1 AND incident_id=$2',[a,incident]),
  /V121_SECURITY_ALERT_UNRESOLVED/);
 assert.equal((await admin.query('SELECT issuance_blocked FROM v106_test.fixture_recovery_emergency_stops WHERE organization_id=$1 AND incident_id=$2',[a,incident])).rows[0].issuance_blocked,true);
 const holds=await admin.query('SELECT module_name,hold_active,release_eligible FROM v106_test.fixture_cross_module_holds WHERE organization_id=$1 AND incident_id=$2 ORDER BY module_name',[a,incident]);
 assert.deepEqual(holds.rows.map(r=>[r.module_name,r.hold_active,r.release_eligible]),[
  ['ACADEMIC',true,false],['FINANCE',true,false],['SALES',true,false]]);
});

test('dual-role closeout review proves evidence only and cannot clear security or domain HOLD',async()=>{
 const event='00000000-0000-4000-8000-0000000000e9';
 const review='00000000-0000-4000-8000-0000000000c9';
 const digest=(await admin.query('SELECT event_digest FROM v106_test.fixture_external_security_events WHERE organization_id=$1 AND event_id=$2',[a,event])).rows[0].event_digest;
 const evidence=createHash('sha256').update('fixture-independent-investigation-evidence').digest('hex');
 const securityReviewer='00000000-0000-4000-8000-0000000000d1';
 const auditReviewer='00000000-0000-4000-8000-0000000000e2';
 const basic=[a,incident,event,review,digest,evidence,securityReviewer,auditReviewer,150];
 const message=['v121-closeout-review-v1',...basic].join('|');
 const securityMac=createHmac('sha256',closeoutSecurityKey).update('SECURITY_REVIEW|'+message).digest('hex');
 const auditMac=createHmac('sha256',closeoutAuditKey).update('AUDIT_REVIEW|'+message).digest('hex');
 const sql='SELECT v106_test.fixture_append_closeout_review($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::char(64),$6::char(64),$7::uuid,$8::uuid,$9::bigint,$10::text,$11::text)';
 await assert.rejects(closeoutWriter.query(sql,[...basic,securityMac,'0'.repeat(64)]),/V121_CLOSEOUT_TWO_ROLE_SIGNATURE_REJECTED/);
 await assert.rejects(closeoutWriter.query(sql,[...basic.slice(0,5),'f'.repeat(64),...basic.slice(6),securityMac,auditMac]),/V121_CLOSEOUT_TWO_ROLE_SIGNATURE_REJECTED/);
 await assert.rejects(closeoutWriter.query(sql,[...basic.slice(0,7),securityReviewer,150,securityMac,auditMac]),/V121_CLOSEOUT_ENVELOPE_INVALID/);
 await assert.rejects(closeoutWriter.query(sql,[...basic.slice(0,4),'f'.repeat(64),...basic.slice(5),securityMac,auditMac]),/V121_CLOSEOUT_ALERT_UNVERIFIED/);
 await assert.rejects(issuerWriter.query(sql,[...basic,securityMac,auditMac]),/permission denied/);
 await closeoutWriter.query(sql,[...basic,securityMac,auditMac]);
 const row=await admin.query('SELECT review_status,hold_active,release_eligible FROM v106_test.fixture_closeout_reviews WHERE organization_id=$1 AND review_id=$2',[a,review]);
 assert.deepEqual([row.rows[0].review_status,row.rows[0].hold_active,row.rows[0].release_eligible],['REVIEWED_STILL_HOLD',true,false]);
 await assert.rejects(closeoutWriter.query(sql,[...basic,securityMac,auditMac]),/duplicate key/);
 await assert.rejects(closeoutWriter.query('SELECT review_key FROM v106_test.fixture_closeout_review_keys'),/permission denied/);
 await assert.rejects(closeoutWriter.query('UPDATE v106_test.fixture_recovery_emergency_stops SET issuance_blocked=false'),/permission denied/);
 await assert.rejects(admin.query('DELETE FROM v106_test.fixture_closeout_reviews WHERE review_id=$1',[review]),/V121_SECURITY_SIGNAL_IMMUTABLE/);
 await assert.rejects(admin.query('UPDATE v106_test.fixture_recovery_emergency_stops SET issuance_blocked=false WHERE organization_id=$1 AND incident_id=$2',[a,incident]),/V121_SECURITY_ALERT_UNRESOLVED/);
 const holds=await admin.query('SELECT module_name,hold_active,release_eligible FROM v106_test.fixture_cross_module_holds WHERE organization_id=$1 AND incident_id=$2 ORDER BY module_name',[a,incident]);
 assert.deepEqual(holds.rows.map(r=>[r.module_name,r.hold_active,r.release_eligible]),[['ACADEMIC',true,false],['FINANCE',true,false],['SALES',true,false]]);
 assert.equal((await admin.query('SELECT count(*)::int AS n FROM v106_test.fixture_receipt_attestation_secrets WHERE key_version=9')).rows[0].n,0);
});

test('UAT closeout evidence checklist detects gaps, ownership mistakes and preserves HOLD',async()=>{
 const event='00000000-0000-4000-8000-0000000000e9';
 const query=()=>admin.query('SELECT * FROM v106_test.fixture_closeout_uat_readiness WHERE organization_id=$1 AND event_id=$2',[a,event]);
 const before=(await query()).rows[0];
 assert.equal(before.evidence_count,0);
 assert.equal(before.held_domains,3);
 assert.equal(before.dual_review_recorded,true);
 assert.equal(before.emergency_stop_active,true);
 assert.equal(before.release_eligible,false);
 const kinds=[
  ['SOURCE_EVENT_AUTHENTICATED','SECURITY','00000000-0000-4000-8000-000000000011'],
  ['AUDIT_CHAIN_RECONCILED','AUDIT','00000000-0000-4000-8000-000000000012'],
  ['REVOCATION_EFFECTS_RECONCILED','SALES','00000000-0000-4000-8000-000000000013'],
  ['FINANCIAL_IMPACT_RECONCILED','FINANCE','00000000-0000-4000-8000-000000000014'],
  ['ACADEMIC_FULFILLMENT_RECONCILED','ACADEMIC','00000000-0000-4000-8000-000000000015']
 ];
 const sql='INSERT INTO v106_test.fixture_closeout_uat_evidence(organization_id,incident_id,event_id,evidence_kind,evidence_digest,responsible_domain,checked_by) VALUES($1,$2,$3,$4,$5,$6,$7)';
 for(const [i,row] of kinds.entries()){
  const [kind,domain,reviewer]=row;
  const digest=createHash('sha256').update('fixture-uat-evidence-'+kind).digest('hex');
  await admin.query(sql,[a,incident,event,kind,digest,i===1?'SECURITY':domain,reviewer]);
 }
 let read=(await query()).rows[0];
 assert.equal(read.evidence_count,4);
 assert.equal(read.independent_reviewers,5);
 assert.equal(read.release_eligible,false);
 // The original mistaken responsible domain is append-only. Simulate privileged fixture
 // correction only to show that authoritative evidence checks remain fail-closed.
 await admin.query('ALTER TABLE v106_test.fixture_closeout_uat_evidence DISABLE TRIGGER fixture_closeout_uat_evidence_immutable');
 try{
  await admin.query("UPDATE v106_test.fixture_closeout_uat_evidence SET responsible_domain='AUDIT' WHERE organization_id=$1 AND event_id=$2 AND evidence_kind='AUDIT_CHAIN_RECONCILED'",[a,event]);
 }finally{
  await admin.query('ALTER TABLE v106_test.fixture_closeout_uat_evidence ENABLE TRIGGER fixture_closeout_uat_evidence_immutable');
 }
 read=(await query()).rows[0];
 assert.equal(read.evidence_count,5);
 assert.equal(read.independent_reviewers,5);
 assert.equal(read.held_domains,3);
 assert.equal(read.emergency_stop_active,true);
 assert.equal(read.dual_review_recorded,true);
 assert.equal(read.hold_active,true);
 assert.equal(read.release_eligible,false);
 await assert.rejects(admin.query('DELETE FROM v106_test.fixture_closeout_uat_evidence WHERE organization_id=$1 AND event_id=$2',[a,event]),/V121_SECURITY_SIGNAL_IMMUTABLE/);
 await assert.rejects(admin.query(sql,[a,incident,event,kinds[0][0],'a'.repeat(64),kinds[0][1],kinds[0][2]]),/duplicate key/);
 await assert.rejects(issuerWriter.query('SELECT * FROM v106_test.fixture_closeout_uat_readiness'),/permission denied/);
 await assert.rejects(admin.query('UPDATE v106_test.fixture_recovery_emergency_stops SET issuance_blocked=false WHERE organization_id=$1 AND incident_id=$2',[a,incident]),/V121_SECURITY_ALERT_UNRESOLVED/);
});

test('UAT failed evidence persists across remediation and two independent re-reviews without release',async()=>{
 const event='00000000-0000-4000-8000-0000000000e9';
 const failure='00000000-0000-4000-8000-0000000000b1';
 const remediation='00000000-0000-4000-8000-0000000000b2';
 const originalReviewer='00000000-0000-4000-8000-000000000015';
 const remediator='00000000-0000-4000-8000-000000000016';
 const securityReviewer='00000000-0000-4000-8000-000000000017';
 const auditReviewer='00000000-0000-4000-8000-000000000018';
 const originalDigest=createHash('sha256').update('fixture-original-failed-finance-reconciliation').digest('hex');
 const remediationDigest=createHash('sha256').update('fixture-correction-finance-reconciliation').digest('hex');
 const noteDigest=createHash('sha256').update('fixture-remediation-note').digest('hex');
 await admin.query('INSERT INTO v106_test.fixture_uat_failures(organization_id,incident_id,event_id,failure_id,evidence_kind,failed_evidence_digest,failed_by,failure_reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
  [a,incident,event,failure,'FINANCIAL_IMPACT_RECONCILED',originalDigest,originalReviewer,'CONFLICTING_EVIDENCE']);
 await admin.query('INSERT INTO v106_test.fixture_uat_remediations(organization_id,failure_id,remediation_id,new_evidence_digest,remediated_by,remediation_note_digest) VALUES($1,$2,$3,$4,$5,$6)',
  [a,failure,remediation,remediationDigest,remediator,noteDigest]);
 const sql='SELECT v106_test.fixture_record_uat_remediation_review($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::char(64))';
 await assert.rejects(closeoutWriter.query(sql,[a,remediation,remediator,'SECURITY','ACCEPTED_FOR_REVIEW',remediationDigest]),/V121_UAT_REVIEWER_NOT_INDEPENDENT/);
 await assert.rejects(closeoutWriter.query(sql,[a,remediation,originalReviewer,'SECURITY','ACCEPTED_FOR_REVIEW',remediationDigest]),/V121_UAT_REVIEWER_NOT_INDEPENDENT/);
 await assert.rejects(issuerWriter.query(sql,[a,remediation,securityReviewer,'SECURITY','ACCEPTED_FOR_REVIEW',remediationDigest]),/permission denied/);
 await closeoutWriter.query(sql,[a,remediation,securityReviewer,'SECURITY','ACCEPTED_FOR_REVIEW',remediationDigest]);
 await assert.rejects(closeoutWriter.query(sql,[a,remediation,securityReviewer,'AUDIT','ACCEPTED_FOR_REVIEW',remediationDigest]),/V121_UAT_REVIEWER_NOT_INDEPENDENT/);
 await closeoutWriter.query(sql,[a,remediation,auditReviewer,'AUDIT','ACCEPTED_FOR_REVIEW',remediationDigest]);
 await assert.rejects(closeoutWriter.query(sql,[a,remediation,auditReviewer,'AUDIT','ACCEPTED_FOR_REVIEW',remediationDigest]),/V121_UAT_REVIEWER_NOT_INDEPENDENT|duplicate key/);
 const diagnostics=(await admin.query('SELECT attempts,accepted_review_roles,original_failure_retained,hold_active,release_eligible FROM v106_test.fixture_uat_remediation_diagnostics WHERE organization_id=$1 AND failure_id=$2',[a,failure])).rows[0];
 assert.deepEqual([diagnostics.attempts,diagnostics.accepted_review_roles,
  diagnostics.original_failure_retained,diagnostics.hold_active,diagnostics.release_eligible],[1,2,true,true,false]);
 const old=(await admin.query('SELECT failed_evidence_digest,failure_reason FROM v106_test.fixture_uat_failures WHERE organization_id=$1 AND failure_id=$2',[a,failure])).rows[0];
 assert.equal(old.failed_evidence_digest,originalDigest);
 assert.equal(old.failure_reason,'CONFLICTING_EVIDENCE');
 await assert.rejects(admin.query('UPDATE v106_test.fixture_uat_failures SET failed_evidence_digest=$1 WHERE failure_id=$2',[remediationDigest,failure]),/V121_SECURITY_SIGNAL_IMMUTABLE/);
 await assert.rejects(admin.query('DELETE FROM v106_test.fixture_uat_remediations WHERE remediation_id=$1',[remediation]),/V121_SECURITY_SIGNAL_IMMUTABLE/);
 await assert.rejects(admin.query('DELETE FROM v106_test.fixture_uat_remediation_reviews WHERE remediation_id=$1',[remediation]),/V121_SECURITY_SIGNAL_IMMUTABLE/);
 await assert.rejects(closeoutWriter.query('UPDATE v106_test.fixture_recovery_emergency_stops SET issuance_blocked=false'),/permission denied/);
 const stop=(await admin.query('SELECT issuance_blocked FROM v106_test.fixture_recovery_emergency_stops WHERE organization_id=$1 AND incident_id=$2',[a,incident])).rows[0];
 assert.equal(stop.issuance_blocked,true);
 const holds=(await admin.query('SELECT module_name,hold_active,release_eligible FROM v106_test.fixture_cross_module_holds WHERE organization_id=$1 AND incident_id=$2 ORDER BY module_name',[a,incident])).rows;
 assert.deepEqual(holds.map(x=>[x.module_name,x.hold_active,x.release_eligible]),[['ACADEMIC',true,false],['FINANCE',true,false],['SALES',true,false]]);
});

test('new remediation versions invalidate old review eligibility without overwriting history',async()=>{
 const failure='00000000-0000-4000-8000-0000000000b1';
 const first='00000000-0000-4000-8000-0000000000b2';
 const second='00000000-0000-4000-8000-0000000000b3';
 const third='00000000-0000-4000-8000-0000000000b4';
 const v2Digest=createHash('sha256').update('fixture-finance-corrected-v2').digest('hex');
 const v3Digest=createHash('sha256').update('fixture-finance-corrected-v3').digest('hex');
 const note=createHash('sha256').update('fixture-versioned-remediation-note').digest('hex');
 const remediator='00000000-0000-4000-8000-000000000016';
 const insert='INSERT INTO v106_test.fixture_uat_remediations(organization_id,failure_id,remediation_id,remediation_version,new_evidence_digest,remediated_by,remediation_note_digest) VALUES($1,$2,$3,$4,$5,$6,$7)';
 const review='SELECT v106_test.fixture_record_uat_remediation_review($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::char(64))';
 const diagnostics=async()=>(await admin.query('SELECT attempts,latest_version,latest_remediation_id,accepted_review_roles,hold_active,release_eligible FROM v106_test.fixture_uat_remediation_diagnostics WHERE organization_id=$1 AND failure_id=$2',[a,failure])).rows[0];
 assert.deepEqual([ (await diagnostics()).attempts,(await diagnostics()).accepted_review_roles],[1,2]);
 await assert.rejects(admin.query(insert,[a,failure,second,3,v2Digest,remediator,note]),/V121_UAT_REMEDIATION_VERSION_NOT_NEXT/);
 await admin.query(insert,[a,failure,second,2,v2Digest,remediator,note]);
 let row=await diagnostics();
 assert.deepEqual([row.attempts,row.latest_version,row.latest_remediation_id,row.accepted_review_roles,row.hold_active,row.release_eligible],
  [2,2,second,0,true,false]);
 await assert.rejects(closeoutWriter.query(review,[a,first,'00000000-0000-4000-8000-000000000019','SECURITY','ACCEPTED_FOR_REVIEW',v2Digest]),/V121_UAT_REMEDIATION_SUPERSEDED/);
 await assert.rejects(closeoutWriter.query(review,[a,second,'00000000-0000-4000-8000-000000000019','SECURITY','ACCEPTED_FOR_REVIEW',v3Digest]),/V121_UAT_REVIEW_EVIDENCE_MISMATCH/);
 await closeoutWriter.query(review,[a,second,'00000000-0000-4000-8000-000000000019','SECURITY','REJECTED',v2Digest]);
 assert.equal((await diagnostics()).accepted_review_roles,0);
 await closeoutWriter.query(review,[a,second,'00000000-0000-4000-8000-00000000001a','AUDIT','ACCEPTED_FOR_REVIEW',v2Digest]);
 assert.equal((await diagnostics()).accepted_review_roles,1);
 await assert.rejects(admin.query(insert,[a,failure,third,3,v2Digest,remediator,note]),/V121_UAT_REMEDIATION_DIGEST_REUSED/);
 await admin.query(insert,[a,failure,third,3,v3Digest,remediator,note]);
 row=await diagnostics();
 assert.deepEqual([row.attempts,row.latest_version,row.latest_remediation_id,row.accepted_review_roles],[3,3,third,0]);
 await assert.rejects(closeoutWriter.query(review,[a,second,'00000000-0000-4000-8000-00000000001b','AUDIT','ACCEPTED_FOR_REVIEW',v2Digest]),/V121_UAT_REMEDIATION_SUPERSEDED/);
 await closeoutWriter.query(review,[a,third,'00000000-0000-4000-8000-00000000001b','SECURITY','ACCEPTED_FOR_REVIEW',v3Digest]);
 await closeoutWriter.query(review,[a,third,'00000000-0000-4000-8000-00000000001c','AUDIT','ACCEPTED_FOR_REVIEW',v3Digest]);
 row=await diagnostics();
 assert.deepEqual([row.attempts,row.latest_version,row.accepted_review_roles,row.hold_active,row.release_eligible],[3,3,2,true,false]);
 const historical=(await admin.query('SELECT remediation_id,remediation_version,new_evidence_digest FROM v106_test.fixture_uat_remediations WHERE organization_id=$1 AND failure_id=$2 ORDER BY remediation_version',[a,failure])).rows;
 assert.equal(historical.length,3);
 assert.deepEqual(historical.map(x=>x.remediation_version),[1,2,3]);
 assert.equal(historical[1].new_evidence_digest,v2Digest);
 await assert.rejects(admin.query('UPDATE v106_test.fixture_uat_remediations SET remediation_version=5 WHERE organization_id=$1 AND remediation_id=$2',[a,first]),/V121_SECURITY_SIGNAL_IMMUTABLE/);
 const status=(await admin.query('SELECT issuance_blocked FROM v106_test.fixture_recovery_emergency_stops WHERE organization_id=$1 AND incident_id=$2',[a,incident])).rows[0];
 assert.equal(status.issuance_blocked,true);
 assert.equal((await admin.query('SELECT count(*)::int AS n FROM v106_test.fixture_receipt_attestation_secrets WHERE key_version=9')).rows[0].n,0);
});

test('concurrent remediation candidates serialize to one next version and keep old reviews stale',async()=>{
 const failure='00000000-0000-4000-8000-0000000000b1';
 const fourthA='00000000-0000-4000-8000-0000000000b5';
 const fourthB='00000000-0000-4000-8000-0000000000b6';
 const digestA=createHash('sha256').update('fixture-concurrent-v4-a').digest('hex');
 const digestB=createHash('sha256').update('fixture-concurrent-v4-b').digest('hex');
 const note=createHash('sha256').update('fixture-concurrent-note').digest('hex');
 const originalRemediator='00000000-0000-4000-8000-000000000016';
 const sql='INSERT INTO v106_test.fixture_uat_remediations(organization_id,failure_id,remediation_id,remediation_version,new_evidence_digest,remediated_by,remediation_note_digest) VALUES($1,$2,$3,$4,$5,$6,$7)';
 const outcomes=await Promise.allSettled([
  admin.query(sql,[a,failure,fourthA,4,digestA,originalRemediator,note]),
  admin.query(sql,[a,failure,fourthB,4,digestB,originalRemediator,note])
 ]);
 assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(outcomes.filter(x=>x.status==='rejected').length,1);
 assert.match(String(outcomes.find(x=>x.status==='rejected').reason.message),/V121_UAT_REMEDIATION_VERSION_NOT_NEXT|duplicate key/);
 const latest=(await admin.query('SELECT remediation_id,new_evidence_digest FROM v106_test.fixture_uat_remediations WHERE organization_id=$1 AND failure_id=$2 AND remediation_version=4',[a,failure])).rows;
 assert.equal(latest.length,1);
 const winner=latest[0];
 const losing=winner.remediation_id===fourthA?fourthB:fourthA;
 const rejectedDigest=winner.remediation_id===fourthA?digestB:digestA;
 const view=async()=>(await admin.query('SELECT attempts,latest_version,latest_remediation_id,accepted_review_roles,hold_active,release_eligible FROM v106_test.fixture_uat_remediation_diagnostics WHERE organization_id=$1 AND failure_id=$2',[a,failure])).rows[0];
 let result=await view();
 assert.deepEqual([result.attempts,result.latest_version,result.latest_remediation_id,result.accepted_review_roles],[4,4,winner.remediation_id,0]);
 const review='SELECT v106_test.fixture_record_uat_remediation_review($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::char(64))';
 await assert.rejects(closeoutWriter.query(review,[a,'00000000-0000-4000-8000-0000000000b4','00000000-0000-4000-8000-000000000021','SECURITY','ACCEPTED_FOR_REVIEW',createHash('sha256').update('fixture-finance-corrected-v3').digest('hex')]),/V121_UAT_REMEDIATION_SUPERSEDED/);
 await assert.rejects(closeoutWriter.query(review,[a,losing,'00000000-0000-4000-8000-000000000021','SECURITY','ACCEPTED_FOR_REVIEW',rejectedDigest]),/V121_UAT_REMEDIATION_NOT_FOUND/);
 await closeoutWriter.query(review,[a,winner.remediation_id,'00000000-0000-4000-8000-000000000021','SECURITY','ACCEPTED_FOR_REVIEW',winner.new_evidence_digest]);
 result=await view();
 assert.equal(result.accepted_review_roles,1);
 // A simultaneous v5 insertion and additional v4 review must never grant v5 v4's approval.
 const fifth='00000000-0000-4000-8000-0000000000b7';
 const fifthDigest=createHash('sha256').update('fixture-concurrent-v5').digest('hex');
 const race=await Promise.allSettled([
  admin.query(sql,[a,failure,fifth,5,fifthDigest,originalRemediator,note]),
  closeoutWriter.query(review,[a,winner.remediation_id,'00000000-0000-4000-8000-000000000022','AUDIT','ACCEPTED_FOR_REVIEW',winner.new_evidence_digest])
 ]);
 assert.equal(race[0].status,'fulfilled');
 if(race[1].status==='rejected')
  assert.match(String(race[1].reason.message),/V121_UAT_REMEDIATION_SUPERSEDED/);
 result=await view();
 assert.deepEqual([result.attempts,result.latest_version,result.latest_remediation_id,result.accepted_review_roles,result.hold_active,result.release_eligible],[5,5,fifth,0,true,false]);
 const historical=(await admin.query('SELECT remediation_version,remediation_id FROM v106_test.fixture_uat_remediations WHERE organization_id=$1 AND failure_id=$2 ORDER BY remediation_version',[a,failure])).rows;
 assert.deepEqual(historical.map(x=>x.remediation_version),[1,2,3,4,5]);
 const stop=(await admin.query('SELECT issuance_blocked FROM v106_test.fixture_recovery_emergency_stops WHERE organization_id=$1 AND incident_id=$2',[a,incident])).rows[0];
 assert.equal(stop.issuance_blocked,true);
});
