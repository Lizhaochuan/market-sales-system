import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash,createHmac,randomBytes,randomUUID,generateKeyPairSync,sign,createPublicKey} from 'node:crypto';
import {encodeFixtureReceiptProof} from '../../src/cross-module-fixture-receipt-proof.mjs';
import {createFixtureLeaseGate,encodeFixtureLease} from '../../src/cross-module-fixture-authority-lease.mjs';
import {createFixtureRecoveryGate,encodeFixtureRecoveryRequest,encodeFixtureRecoveryApproval} from '../../src/cross-module-fixture-dual-approval-anchor.mjs';
import {createFixtureRecoveryIssuance} from '../helpers/v3-2-121-fixture-recovery-issuance.mjs';
import {signFixtureAuditAnchor,verifyFixtureAuditAnchor,verifyFixtureActiveAuditAnchor,inspectFixtureArchivedAuditAnchor,issueFixtureVerifiedAnchorTicket,inspectFixtureStoredAdmission} from '../helpers/v3-2-121-fixture-external-audit-anchor.mjs';
import pg from 'pg';
import {createIsolatedPostgresRevocationNotices} from '../helpers/v3-2-121-m02-postgres-revocation-notices.mjs';
import {createIsolatedRevocationNoticeService} from '../../src/cross-module-revocation-notice-contract.mjs';
import {REQUIRED_IAM_ROLES,REQUIRED_DENIAL_CASES,signFixtureExt001Envelope,fingerprintFixtureExt001ForIntake,verifyFixtureExt001BytesAndFingerprint,issueFixtureExt001VerifiedProvenance,encodeFixtureExt001SourceAuthorization} from '../../src/cross-module-v121-iam-evidence.mjs';
import {signFixtureExt001SourceManifest,issueFixtureExt001FromTwoSources} from '../../src/cross-module-v121-iam-source-version.mjs';
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
 await admin.query("CREATE ROLE v106_state_reader LOGIN PASSWORD 'test_only_state_reader'");
 await admin.query('CREATE SCHEMA v106_test');
 await admin.query('GRANT USAGE ON SCHEMA v106_test TO v106_writer_a,v106_writer_b,v106_audit_reader,v106_key_issuer,v106_security_event_writer,v106_closeout_writer,v106_state_reader');
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
 await closeoutWriter.query(sql,[a,remediation,auditReviewer,'AUDIT','ACCEPTED_FOR_REVIEW',remediationDigest]); // Exact retry is idempotent.
 await assert.rejects(closeoutWriter.query(sql,[a,remediation,auditReviewer,'AUDIT','REJECTED',remediationDigest]),/V121_UAT_REVIEW_IDEMPOTENCY_CONFLICT/);
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

test('transaction rollback, lost connection and concurrent exact retries cannot half-commit remediation or review',async()=>{
 const event='00000000-0000-4000-8000-0000000000e9';
 const failure='00000000-0000-4000-8000-0000000000c1';
 const remediation='00000000-0000-4000-8000-0000000000c2';
 const originalReviewer='00000000-0000-4000-8000-0000000000c3';
 const remediator='00000000-0000-4000-8000-0000000000c4';
 const securityReviewer='00000000-0000-4000-8000-0000000000c5';
 const auditReviewer='00000000-0000-4000-8000-0000000000c6';
 const evidence=createHash('sha256').update('recovery-transport-interruption-evidence').digest('hex');
 const note=createHash('sha256').update('recovery-transport-interruption-note').digest('hex');
 const altered=createHash('sha256').update('conflicting-retry-payload').digest('hex');
 await admin.query('INSERT INTO v106_test.fixture_uat_failures(organization_id,incident_id,event_id,failure_id,evidence_kind,failed_evidence_digest,failed_by,failure_reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
  [a,incident,event,failure,'FINANCIAL_IMPACT_RECONCILED',evidence,originalReviewer,'REVIEW_REJECTED']);
 const submit='SELECT v106_test.fixture_submit_uat_remediation($1::uuid,$2::uuid,$3::uuid,$4::integer,$5::char(64),$6::uuid,$7::char(64)) AS status';
 const args=[a,failure,remediation,1,evidence,remediator,note];
 await assert.rejects(issuerWriter.query(submit,args),/permission denied/);
 // Successful statement inside a failed transaction must leave no durable row.
 const tx=await closeoutWriter.connect();
 try{
  await tx.query('BEGIN');
  assert.equal((await tx.query(submit,args)).rows[0].status,'RECORDED');
  await tx.query('ROLLBACK');
 }finally{tx.release();}
 assert.equal((await admin.query('SELECT count(*)::int AS n FROM v106_test.fixture_uat_remediations WHERE organization_id=$1 AND remediation_id=$2',[a,remediation])).rows[0].n,0);
 // Simulate a process/network disconnect after the statement, before COMMIT.
 const killed=new pg.Client({host,database:'v106_isolated',user:'v106_closeout_writer',password:'test_only_closeout'});
 killed.on('error',()=>{}); // Connection termination is intentional in this fixture.
 await killed.connect();
 try{
  await killed.query('BEGIN');
  assert.equal((await killed.query(submit,args)).rows[0].status,'RECORDED');
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM v106_test.fixture_uat_remediations WHERE organization_id=$1 AND remediation_id=$2',[a,remediation])).rows[0].n,0);
  const terminated=await admin.query('SELECT pg_terminate_backend($1::integer) AS stopped',[killed.processID]);
  assert.equal(terminated.rows[0].stopped,true);
 }finally{await killed.end().catch(()=>{});}
 assert.equal((await admin.query('SELECT count(*)::int AS n FROM v106_test.fixture_uat_remediations WHERE organization_id=$1 AND remediation_id=$2',[a,remediation])).rows[0].n,0);
 // A retry with the same id and payload can safely race with another retry.
 const results=await Promise.all([closeoutWriter.query(submit,args),closeoutWriter.query(submit,args)]);
 assert.deepEqual(results.map(x=>x.rows[0].status).sort(),['ALREADY_RECORDED','RECORDED']);
 assert.equal((await admin.query('SELECT count(*)::int AS n FROM v106_test.fixture_uat_remediations WHERE organization_id=$1 AND failure_id=$2',[a,failure])).rows[0].n,1);
 await assert.rejects(closeoutWriter.query(submit,[...args.slice(0,4),altered,remediator,note]),/V121_REMEDIATION_IDEMPOTENCY_CONFLICT/);
 assert.equal((await closeoutWriter.query(submit,args)).rows[0].status,'ALREADY_RECORDED');
 const review='SELECT v106_test.fixture_record_uat_remediation_review($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::char(64))';
 const security=[a,remediation,securityReviewer,'SECURITY','ACCEPTED_FOR_REVIEW',evidence];
 const audit=[a,remediation,auditReviewer,'AUDIT','ACCEPTED_FOR_REVIEW',evidence];
 const reviewTx=await closeoutWriter.connect();
 try{
  await reviewTx.query('BEGIN');
  await reviewTx.query(review,security);
  await reviewTx.query('ROLLBACK');
 }finally{reviewTx.release();}
 assert.equal((await admin.query('SELECT count(*)::int AS n FROM v106_test.fixture_uat_remediation_reviews WHERE organization_id=$1 AND remediation_id=$2',[a,remediation])).rows[0].n,0);
 const reviewers=await Promise.all([closeoutWriter.query(review,security),closeoutWriter.query(review,security)]);
 assert.equal(reviewers.length,2);
 await closeoutWriter.query(review,audit);
 await closeoutWriter.query(review,audit);
 await assert.rejects(closeoutWriter.query(review,[...security.slice(0,4),'REJECTED',evidence]),/V121_UAT_REVIEW_IDEMPOTENCY_CONFLICT/);
 const rows=(await admin.query('SELECT reviewer_domain,decision,hold_active,release_eligible FROM v106_test.fixture_uat_remediation_reviews WHERE organization_id=$1 AND remediation_id=$2 ORDER BY reviewer_domain',[a,remediation])).rows;
 assert.deepEqual(rows.map(x=>[x.reviewer_domain,x.decision,x.hold_active,x.release_eligible]),[
  ['AUDIT','ACCEPTED_FOR_REVIEW',true,false],['SECURITY','ACCEPTED_FOR_REVIEW',true,false]]);
 await assert.rejects(admin.query('UPDATE v106_test.fixture_recovery_emergency_stops SET issuance_blocked=false WHERE organization_id=$1 AND incident_id=$2',[a,incident]),/V121_SECURITY_ALERT_UNRESOLVED/);
 const holds=(await admin.query('SELECT module_name,hold_active,release_eligible FROM v106_test.fixture_cross_module_holds WHERE organization_id=$1 AND incident_id=$2 ORDER BY module_name',[a,incident])).rows;
 assert.deepEqual(holds.map(x=>[x.module_name,x.hold_active,x.release_eligible]),[
  ['ACADEMIC',true,false],['FINANCE',true,false],['SALES',true,false]]);
});

test('fresh processes rebuild identical committed UAT state and detect corrupted historical versions',async()=>{
 const failure='00000000-0000-4000-8000-0000000000b1';
 const sql='SELECT * FROM v106_test.fixture_rebuild_uat_state($1::uuid,$2::uuid)';
 const openReader=async()=>{
  const client=new pg.Client({host,database:'v106_isolated',user:'v106_state_reader',password:'test_only_state_reader'});
  await client.connect();
  return client;
 };
 const first=await openReader();
 let baseline;
 try{
  baseline=(await first.query(sql,[a,failure])).rows[0];
  assert.deepEqual([baseline.version_count,baseline.latest_version,baseline.latest_accepted_reviews,baseline.history_complete,
   baseline.reviews_consistent,baseline.domains_held,baseline.emergency_stop_active,baseline.status,
   baseline.hold_active,baseline.release_eligible],[5,5,0,true,true,3,true,'REBUILT_STILL_HOLD',true,false]);
  await assert.rejects(first.query('SELECT * FROM v106_test.fixture_uat_remediations'),/permission denied/);
  await assert.rejects(first.query('UPDATE v106_test.fixture_recovery_emergency_stops SET issuance_blocked=false'),/permission denied/);
  await assert.rejects(first.query(sql,[b,failure]),/V121_REBUILD_ROLE_SCOPE_DENIED/);
 }finally{await first.end();}
 const second=await openReader();
 try{
  const rebuilt=(await second.query(sql,[a,failure])).rows[0];
  assert.deepEqual(rebuilt,baseline);
  await assert.rejects(second.query(sql,[a,'00000000-0000-4000-8000-0000000000ee']),/V121_REBUILD_FAILURE_UNKNOWN/);
 }finally{await second.end();}
 await assert.rejects(closeoutWriter.query(sql,[a,failure]),/permission denied/);
 // CI superuser simulates storage damage; audit data stays untouched outside fixture.
 const versionRow='00000000-0000-4000-8000-0000000000b4';
 await admin.query('ALTER TABLE v106_test.fixture_uat_remediations DISABLE TRIGGER fixture_uat_remediations_immutable');
 try{
  await admin.query('UPDATE v106_test.fixture_uat_remediations SET remediation_version=7 WHERE organization_id=$1 AND remediation_id=$2',[a,versionRow]);
  const damagedReader=await openReader();
  try{
   const damaged=(await damagedReader.query(sql,[a,failure])).rows[0];
   assert.equal(damaged.history_complete,false);
   assert.equal(damaged.status,'HISTORY_INCOMPLETE');
   assert.equal(damaged.release_eligible,false);
  }finally{await damagedReader.end();}
 }finally{
  await admin.query('UPDATE v106_test.fixture_uat_remediations SET remediation_version=3 WHERE organization_id=$1 AND remediation_id=$2',[a,versionRow]);
  await admin.query('ALTER TABLE v106_test.fixture_uat_remediations ENABLE TRIGGER fixture_uat_remediations_immutable');
 }
 const reviewRemediation='00000000-0000-4000-8000-0000000000b4';
 const original=(await admin.query("SELECT review_evidence_digest FROM v106_test.fixture_uat_remediation_reviews WHERE organization_id=$1 AND remediation_id=$2 AND reviewer_domain='SECURITY'",[a,reviewRemediation])).rows[0].review_evidence_digest;
 await admin.query('ALTER TABLE v106_test.fixture_uat_remediation_reviews DISABLE TRIGGER fixture_uat_remediation_reviews_immutable');
 try{
  await admin.query("UPDATE v106_test.fixture_uat_remediation_reviews SET review_evidence_digest=$3 WHERE organization_id=$1 AND remediation_id=$2 AND reviewer_domain='SECURITY'",[a,reviewRemediation,'e'.repeat(64)]);
  const reader=await openReader();
  try{
   const damaged=(await reader.query(sql,[a,failure])).rows[0];
   assert.equal(damaged.reviews_consistent,false);
   assert.equal(damaged.status,'REVIEW_INTEGRITY_INVALID');
   assert.equal(damaged.release_eligible,false);
  }finally{await reader.end();}
 }finally{
  await admin.query("UPDATE v106_test.fixture_uat_remediation_reviews SET review_evidence_digest=$3 WHERE organization_id=$1 AND remediation_id=$2 AND reviewer_domain='SECURITY'",[a,reviewRemediation,original]);
  await admin.query('ALTER TABLE v106_test.fixture_uat_remediation_reviews ENABLE TRIGGER fixture_uat_remediation_reviews_immutable');
 }
 await admin.query('ALTER TABLE v106_test.fixture_cross_module_holds DISABLE TRIGGER fixture_hold_immutable');
 try{
  await admin.query("DELETE FROM v106_test.fixture_cross_module_holds WHERE organization_id=$1 AND incident_id=$2 AND module_name='ACADEMIC'",[a,incident]);
  const reader=await openReader();
  try{
   const damaged=(await reader.query(sql,[a,failure])).rows[0];
   assert.equal(damaged.domains_held,2);
   assert.equal(damaged.status,'CROSS_MODULE_HOLD_INCOMPLETE');
  }finally{await reader.end();}
 }finally{
  await admin.query("INSERT INTO v106_test.fixture_cross_module_holds(organization_id,incident_id,module_name) VALUES($1,$2,'ACADEMIC')",[a,incident]);
  await admin.query('ALTER TABLE v106_test.fixture_cross_module_holds ENABLE TRIGGER fixture_hold_immutable');
 }
 const finalReader=await openReader();
 try{
  const restored=(await finalReader.query(sql,[a,failure])).rows[0];
  assert.deepEqual(restored,baseline);
  assert.equal(restored.hold_active,true);
  assert.equal(restored.release_eligible,false);
 }finally{await finalReader.end();}
});


test('snapshot verification compares restart rebuild to immutable baselines and fails closed on stale or drifted state',async()=>{
 const failure='00000000-0000-4000-8000-0000000000b1';
 const newest='00000000-0000-4000-8000-0000000000b7';
 const next='00000000-0000-4000-8000-0000000000b8';
 const reader=new pg.Client({host,database:'v106_isolated',user:'v106_state_reader',password:'test_only_state_reader'});
 await reader.connect();
 const observe=async()=>(await reader.query('SELECT * FROM v106_test.fixture_observe_uat_snapshot($1::uuid,$2::uuid)',[a,failure])).rows[0];
 const verify=async()=>(await reader.query('SELECT * FROM v106_test.fixture_verify_uat_snapshot($1::uuid,$2::uuid)',[a,failure])).rows[0];
 const snapshotSql='INSERT INTO v106_test.fixture_uat_state_snapshots(organization_id,failure_id,snapshot_sequence,remediation_version,accepted_review_roles,observed_digest) VALUES($1,$2,$3,$4,$5,$6)';
 const recordSnapshot=async seq=>{
  const observed=await observe();
  assert.equal(observed.rebuild_status,'REBUILT_STILL_HOLD');
  await admin.query(snapshotSql,[a,failure,seq,observed.remediation_version,observed.accepted_review_roles,observed.observed_digest]);
  return observed;
 };
 try{
  const absent=await verify();
  assert.equal(absent.verdict,'SNAPSHOT_MISSING');
  assert.equal(absent.snapshot_matches,false);
  assert.equal(absent.release_eligible,false);
  const initial=await recordSnapshot(1);
  assert.equal(initial.remediation_version,5);
  let verified=await verify();
  assert.deepEqual([verified.snapshot_sequence,verified.snapshot_matches,verified.verdict,verified.hold_active,verified.release_eligible],
   [1,true,'SNAPSHOT_MATCH_STILL_HOLD',true,false]);
  await assert.rejects(admin.query(snapshotSql,[a,failure,3,initial.remediation_version,initial.accepted_review_roles,initial.observed_digest]),/V121_SNAPSHOT_SEQUENCE_NOT_NEXT/);
  await assert.rejects(admin.query('UPDATE v106_test.fixture_uat_state_snapshots SET observed_digest=$1 WHERE organization_id=$2 AND failure_id=$3',['a'.repeat(64),a,failure]),/V121_SECURITY_SIGNAL_IMMUTABLE/);
  await assert.rejects(reader.query('SELECT * FROM v106_test.fixture_uat_state_snapshots'),/permission denied/);
  await assert.rejects(closeoutWriter.query('SELECT * FROM v106_test.fixture_verify_uat_snapshot($1::uuid,$2::uuid)',[a,failure]),/permission denied/);
  await assert.rejects(reader.query('SELECT * FROM v106_test.fixture_verify_uat_snapshot($1::uuid,$2::uuid)',[b,failure]),/V121_SNAPSHOT_READER_SCOPE_DENIED/);
  // Historical versions unchanged, but adding an accepted current review changes the fingerprint.
  const newestEvidence=(await admin.query('SELECT new_evidence_digest FROM v106_test.fixture_uat_remediations WHERE organization_id=$1 AND remediation_id=$2',[a,newest])).rows[0].new_evidence_digest;
  await closeoutWriter.query('SELECT v106_test.fixture_record_uat_remediation_review($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::char(64))',
   [a,newest,'00000000-0000-4000-8000-0000000000d7','SECURITY','ACCEPTED_FOR_REVIEW',newestEvidence]);
  verified=await verify();
  assert.equal(verified.verdict,'SNAPSHOT_MISMATCH');
  assert.equal(verified.snapshot_matches,false);
  await recordSnapshot(2);
  assert.equal((await verify()).verdict,'SNAPSHOT_MATCH_STILL_HOLD');
  // An additional committed remediation makes the last snapshot obsolete.
  const nextEvidence=createHash('sha256').update('fixture-snapshot-version-6-evidence').digest('hex');
  const note=createHash('sha256').update('fixture-snapshot-version-6-note').digest('hex');
  const submit='SELECT v106_test.fixture_submit_uat_remediation($1::uuid,$2::uuid,$3::uuid,$4::integer,$5::char(64),$6::uuid,$7::char(64)) AS status';
  assert.equal((await closeoutWriter.query(submit,[a,failure,next,6,nextEvidence,'00000000-0000-4000-8000-000000000016',note])).rows[0].status,'RECORDED');
  verified=await verify();
  assert.deepEqual([verified.saved_version,verified.current_version,verified.verdict,verified.snapshot_matches],[5,6,'SNAPSHOT_STALE',false]);
  const refreshed=await recordSnapshot(3);
  assert.equal(refreshed.remediation_version,6);
  assert.equal((await verify()).verdict,'SNAPSHOT_MATCH_STILL_HOLD');
  // Simulate privileged alteration to a historical note. The snapshot fingerprint
  // detects it even though the prior rebuild's version count remains valid.
  await admin.query('ALTER TABLE v106_test.fixture_uat_remediations DISABLE TRIGGER fixture_uat_remediations_immutable');
  try{
   await admin.query('UPDATE v106_test.fixture_uat_remediations SET remediation_note_digest=$3 WHERE organization_id=$1 AND remediation_id=$2',[a,next,'f'.repeat(64)]);
   const changed=await verify();
   assert.equal(changed.verdict,'SNAPSHOT_MISMATCH');
   assert.equal(changed.snapshot_matches,false);
   assert.equal(changed.release_eligible,false);
  }finally{
   await admin.query('UPDATE v106_test.fixture_uat_remediations SET remediation_note_digest=$3 WHERE organization_id=$1 AND remediation_id=$2',[a,next,note]);
   await admin.query('ALTER TABLE v106_test.fixture_uat_remediations ENABLE TRIGGER fixture_uat_remediations_immutable');
  }
  const final=await verify();
  assert.equal(final.verdict,'SNAPSHOT_MATCH_STILL_HOLD');
  assert.equal(final.release_eligible,false);
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM v106_test.fixture_uat_state_snapshots WHERE organization_id=$1 AND failure_id=$2',[a,failure])).rows[0].n,3);
  await assert.rejects(admin.query('DELETE FROM v106_test.fixture_uat_state_snapshots WHERE organization_id=$1 AND failure_id=$2',[a,failure]),/V121_SECURITY_SIGNAL_IMMUTABLE/);
  await assert.rejects(admin.query('UPDATE v106_test.fixture_recovery_emergency_stops SET issuance_blocked=false WHERE organization_id=$1 AND incident_id=$2',[a,incident]),/V121_SECURITY_ALERT_UNRESOLVED/);
  const holds=(await admin.query('SELECT module_name,hold_active,release_eligible FROM v106_test.fixture_cross_module_holds WHERE organization_id=$1 AND incident_id=$2 ORDER BY module_name',[a,incident])).rows;
  assert.deepEqual(holds.map(x=>[x.module_name,x.hold_active,x.release_eligible]),[
   ['ACADEMIC',true,false],['FINANCE',true,false],['SALES',true,false]]);
 }finally{await reader.end();}
});


test('independently signed audit anchor detects forged proofs, expiry and coordinated history-snapshot rollback',async()=>{
 const failure='00000000-0000-4000-8000-0000000000b1';
 const signedKeyPair=generateKeyPairSync('ed25519');
 const signer='00000000-0000-4000-8000-0000000000a8';
 const publicKeys=new Map([[signer,signedKeyPair.publicKey]]);
 // This is an in-memory stand-in for an independently stored highest checkpoint,
 // not a real WORM system, HSM, or production audit service.
 const trustedExternalCheckpoint={minimumSequence:3};
 const newRemediation='00000000-0000-4000-8000-0000000000b9';
 const newEvidence=createHash('sha256').update('fixture-external-anchor-v7').digest('hex');
 const originalNote=createHash('sha256').update('fixture-external-anchor-note').digest('hex');
 const snapshotSql='INSERT INTO v106_test.fixture_uat_state_snapshots(organization_id,failure_id,snapshot_sequence,remediation_version,accepted_review_roles,observed_digest) VALUES($1,$2,$3,$4,$5,$6)';
 const submit='SELECT v106_test.fixture_submit_uat_remediation($1::uuid,$2::uuid,$3::uuid,$4::integer,$5::char(64),$6::uuid,$7::char(64))';
 const reader=new pg.Client({host,database:'v106_isolated',user:'v106_state_reader',password:'test_only_state_reader'});
 await reader.connect();
 const observe=async()=>(await reader.query('SELECT * FROM v106_test.fixture_observe_uat_snapshot($1::uuid,$2::uuid)',[a,failure])).rows[0];
 const readCurrent=async()=>{
  await reader.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try{
   const rebuild=(await reader.query('SELECT * FROM v106_test.fixture_rebuild_uat_state($1::uuid,$2::uuid)',[a,failure])).rows[0];
   const observed=await observe();
   const verification=(await reader.query('SELECT * FROM v106_test.fixture_verify_uat_snapshot($1::uuid,$2::uuid)',[a,failure])).rows[0];
   await reader.query('COMMIT');
   return {
    organization_id:a,failure_id:failure,incident_id:rebuild.incident_scope,event_id:rebuild.event_scope,
    snapshot_sequence:verification.snapshot_sequence,
    remediation_version:observed.remediation_version,
    accepted_review_roles:observed.accepted_review_roles,
    observed_digest:observed.observed_digest,
    rebuild_status:observed.rebuild_status,
    verdict:verification.verdict,snapshot_matches:verification.snapshot_matches,
    hold_active:verification.hold_active,release_eligible:verification.release_eligible
   };
  }catch(error){await reader.query('ROLLBACK');throw error;}
 };
 const makeSigned=(current)=>signFixtureAuditAnchor({
  organization_id:current.organization_id,failure_id:current.failure_id,
  incident_id:current.incident_id,event_id:current.event_id,
  snapshot_sequence:current.snapshot_sequence,remediation_version:current.remediation_version,
  accepted_review_roles:current.accepted_review_roles,observed_digest:current.observed_digest,
  signer_id:signer,issued_at_ms:100,expires_at_ms:200
 },signedKeyPair.privateKey);
 const verifyProof=(anchor,current,nowMs=150)=>verifyFixtureAuditAnchor({
  anchor,publicKeys,current,nowMs,minimumSequence:trustedExternalCheckpoint.minimumSequence
 });
 try{
  const original=await readCurrent();
  assert.equal(original.snapshot_sequence,3);
  assert.equal(original.verdict,'SNAPSHOT_MATCH_STILL_HOLD');
  const oldAnchor=makeSigned(original);
  assert.deepEqual([verifyProof(oldAnchor,original).status,verifyProof(oldAnchor,original).release_eligible],
   ['ANCHOR_MATCH_STILL_HOLD',false]);
  const forged={...oldAnchor,statement:{...oldAnchor.statement,observed_digest:'f'.repeat(64)}};
  assert.throws(()=>verifyProof(forged,original),{code:'V121_ANCHOR_SIGNATURE_INVALID'});
  const corruptedSignature={...oldAnchor,signature_b64:(oldAnchor.signature_b64[0]==='A'?'B':'A')+oldAnchor.signature_b64.slice(1)};
  assert.throws(()=>verifyProof(corruptedSignature,original),{code:'V121_ANCHOR_SIGNATURE_INVALID'});
  assert.throws(()=>verifyProof(oldAnchor,original,200),{code:'V121_ANCHOR_EXPIRED'});
  // Advance the durable DB snapshot, then independently sign its new state.
  await closeoutWriter.query(submit,[a,failure,newRemediation,7,newEvidence,'00000000-0000-4000-8000-000000000016',originalNote]);
  const nextObservation=await observe();
  assert.equal(nextObservation.remediation_version,7);
  await admin.query(snapshotSql,[a,failure,4,7,nextObservation.accepted_review_roles,nextObservation.observed_digest]);
  const latest=await readCurrent();
  assert.equal(latest.snapshot_sequence,4);
  assert.equal(latest.verdict,'SNAPSHOT_MATCH_STILL_HOLD');
  const latestAnchor=makeSigned(latest);
  trustedExternalCheckpoint.minimumSequence=4;
  assert.equal(verifyProof(latestAnchor,latest).status,'ANCHOR_MATCH_STILL_HOLD');
  assert.throws(()=>verifyProof(oldAnchor,original),{code:'V121_ANCHOR_ROLLBACK_DETECTED'});
  assert.throws(()=>verifyProof(oldAnchor,latest),{code:'V121_ANCHOR_ROLLBACK_DETECTED'});
  // Privileged attacker changes history AND rewrites the matching local snapshot.
  // Local DB verification still says MATCH but separately signed anchor disagrees.
  await admin.query('ALTER TABLE v106_test.fixture_uat_remediations DISABLE TRIGGER fixture_uat_remediations_immutable');
  await admin.query('ALTER TABLE v106_test.fixture_uat_state_snapshots DISABLE TRIGGER fixture_snapshot_immutable');
  try{
   await admin.query('UPDATE v106_test.fixture_uat_remediations SET remediation_note_digest=$3 WHERE organization_id=$1 AND remediation_id=$2',[a,newRemediation,'e'.repeat(64)]);
   const changedObservation=await observe();
   await admin.query('UPDATE v106_test.fixture_uat_state_snapshots SET observed_digest=$4 WHERE organization_id=$1 AND failure_id=$2 AND snapshot_sequence=$3',[a,failure,4,changedObservation.observed_digest]);
   const tampered=await readCurrent();
   assert.equal(tampered.verdict,'SNAPSHOT_MATCH_STILL_HOLD');
   assert.throws(()=>verifyProof(latestAnchor,tampered),{code:'V121_ANCHOR_CONTENT_MISMATCH'});
  }finally{
   await admin.query('UPDATE v106_test.fixture_uat_remediations SET remediation_note_digest=$3 WHERE organization_id=$1 AND remediation_id=$2',[a,newRemediation,originalNote]);
   await admin.query('UPDATE v106_test.fixture_uat_state_snapshots SET observed_digest=$4 WHERE organization_id=$1 AND failure_id=$2 AND snapshot_sequence=$3',[a,failure,4,latest.observed_digest]);
   await admin.query('ALTER TABLE v106_test.fixture_uat_state_snapshots ENABLE TRIGGER fixture_snapshot_immutable');
   await admin.query('ALTER TABLE v106_test.fixture_uat_remediations ENABLE TRIGGER fixture_uat_remediations_immutable');
  }
  assert.equal(verifyProof(latestAnchor,await readCurrent()).status,'ANCHOR_MATCH_STILL_HOLD');
  // Simulated coordinated rollback: drop v7 and snapshot #4, leaving old
  // history and snapshot #3 internally consistent, but below external high-water.
  await admin.query('ALTER TABLE v106_test.fixture_uat_remediations DISABLE TRIGGER fixture_uat_remediations_immutable');
  await admin.query('ALTER TABLE v106_test.fixture_uat_state_snapshots DISABLE TRIGGER fixture_snapshot_immutable');
  try{
   await admin.query('DELETE FROM v106_test.fixture_uat_state_snapshots WHERE organization_id=$1 AND failure_id=$2 AND snapshot_sequence=4',[a,failure]);
   await admin.query('DELETE FROM v106_test.fixture_uat_remediations WHERE organization_id=$1 AND remediation_id=$2',[a,newRemediation]);
   const rolled=await readCurrent();
   assert.equal(rolled.snapshot_sequence,3);
   assert.equal(rolled.verdict,'SNAPSHOT_MATCH_STILL_HOLD');
   assert.throws(()=>verifyProof(oldAnchor,rolled),{code:'V121_ANCHOR_ROLLBACK_DETECTED'});
   assert.throws(()=>verifyProof(latestAnchor,rolled),{code:'V121_ANCHOR_ROLLBACK_DETECTED'});
  }finally{
   await admin.query('INSERT INTO v106_test.fixture_uat_remediations(organization_id,failure_id,remediation_id,remediation_version,new_evidence_digest,remediated_by,remediation_note_digest) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [a,failure,newRemediation,7,newEvidence,'00000000-0000-4000-8000-000000000016',originalNote]);
   await admin.query(snapshotSql,[a,failure,4,7,latest.accepted_review_roles,latest.observed_digest]);
   await admin.query('ALTER TABLE v106_test.fixture_uat_state_snapshots ENABLE TRIGGER fixture_snapshot_immutable');
   await admin.query('ALTER TABLE v106_test.fixture_uat_remediations ENABLE TRIGGER fixture_uat_remediations_immutable');
  }
  const final=await readCurrent();
  assert.equal(verifyProof(latestAnchor,final).status,'ANCHOR_MATCH_STILL_HOLD');
  assert.equal(final.release_eligible,false);
  await assert.rejects(admin.query('UPDATE v106_test.fixture_recovery_emergency_stops SET issuance_blocked=false WHERE organization_id=$1 AND incident_id=$2',[a,incident]),/V121_SECURITY_ALERT_UNRESOLVED/);
  const holds=(await admin.query('SELECT module_name,hold_active,release_eligible FROM v106_test.fixture_cross_module_holds WHERE organization_id=$1 AND incident_id=$2 ORDER BY module_name',[a,incident])).rows;
  assert.deepEqual(holds.map(x=>[x.module_name,x.hold_active,x.release_eligible]),[
   ['ACADEMIC',true,false],['FINANCE',true,false],['SALES',true,false]]);
 }finally{await reader.end();}
});


test('durable separate-database anchor ledger, key rotation, revocation and historical-only verification',async()=>{
 const failure='00000000-0000-4000-8000-0000000000b1';
 const signer1='00000000-0000-4000-8000-0000000000a8';
 const signer2='00000000-0000-4000-8000-0000000000a9';
 const keys1=generateKeyPairSync('ed25519'),keys2=generateKeyPairSync('ed25519');
 let keys=new Map();
 let state=new Map();
 await admin.query("CREATE ROLE v121_anchor_reader LOGIN PASSWORD 'test_only_anchor_reader'");
 await admin.query("CREATE ROLE v121_anchor_writer LOGIN PASSWORD 'test_only_anchor_writer'");
 await admin.query("CREATE ROLE v121_anchor_attester LOGIN PASSWORD 'test_only_anchor_attester'");
 await admin.query("CREATE ROLE v121_anchor_security LOGIN PASSWORD 'test_only_anchor_security'");
 await admin.query("CREATE ROLE v121_anchor_investigator LOGIN PASSWORD 'test_only_quarantine_investigator'");
 await admin.query("CREATE ROLE v121_anchor_security_reviewer LOGIN PASSWORD 'test_only_quarantine_security'");
 await admin.query("CREATE ROLE v121_anchor_audit_reviewer LOGIN PASSWORD 'test_only_quarantine_audit'");
 await admin.query("CREATE ROLE v121_anchor_evidence_checker LOGIN PASSWORD 'test_only_quarantine_evidence'");
 await admin.query("CREATE ROLE v121_iam_intake_writer LOGIN PASSWORD 'test_only_iam_intake_writer'");
 await admin.query("CREATE ROLE v121_iam_intake_reader LOGIN PASSWORD 'test_only_iam_intake_reader'");
 await admin.query("CREATE ROLE v121_iam_revoker LOGIN PASSWORD 'test_only_iam_revoker'");
 await admin.query("CREATE ROLE v121_iam_provenance_attester LOGIN PASSWORD 'test_only_iam_provenance_attester'");
 await admin.query('CREATE DATABASE v121_anchor_isolated');
 await admin.query('REVOKE CONNECT ON DATABASE v121_anchor_isolated FROM PUBLIC');
 await admin.query('GRANT CONNECT ON DATABASE v121_anchor_isolated TO v121_anchor_reader,v121_anchor_writer,v121_anchor_attester,v121_anchor_security,v121_anchor_investigator,v121_anchor_security_reviewer,v121_anchor_audit_reviewer,v121_anchor_evidence_checker,v121_iam_intake_writer,v121_iam_intake_reader,v121_iam_revoker,v121_iam_provenance_attester');
 const ledgerAdmin=new pg.Pool({host,database:'v121_anchor_isolated',user:'postgres',password:'postgres'});
 let anchorReader=new pg.Client({host,database:'v121_anchor_isolated',user:'v121_anchor_reader',password:'test_only_anchor_reader'});
 const anchorWriter=new pg.Client({host,database:'v121_anchor_isolated',user:'v121_anchor_writer',password:'test_only_anchor_writer'});
 const anchorAttester=new pg.Client({host,database:'v121_anchor_isolated',user:'v121_anchor_attester',password:'test_only_anchor_attester'});
 const stateReader=new pg.Client({host,database:'v106_isolated',user:'v106_state_reader',password:'test_only_state_reader'});
 try{
  await ledgerAdmin.query(await readFile(new URL('../fixtures/v3-2-121-external-anchor-ledger.sql',import.meta.url),'utf8'));
  await anchorReader.connect();
  await anchorWriter.connect();
  await anchorAttester.connect();
  await stateReader.connect();
  const readLocal=async()=>{
   await stateReader.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   try{
    const rebuild=(await stateReader.query('SELECT * FROM v106_test.fixture_rebuild_uat_state($1::uuid,$2::uuid)',[a,failure])).rows[0];
    const observed=(await stateReader.query('SELECT * FROM v106_test.fixture_observe_uat_snapshot($1::uuid,$2::uuid)',[a,failure])).rows[0];
    const verdict=(await stateReader.query('SELECT * FROM v106_test.fixture_verify_uat_snapshot($1::uuid,$2::uuid)',[a,failure])).rows[0];
    await stateReader.query('COMMIT');
    return {organization_id:a,failure_id:failure,incident_id:rebuild.incident_scope,
     event_id:rebuild.event_scope,snapshot_sequence:verdict.snapshot_sequence,
     remediation_version:observed.remediation_version,accepted_review_roles:observed.accepted_review_roles,
     observed_digest:observed.observed_digest,rebuild_status:observed.rebuild_status,
     verdict:verdict.verdict,snapshot_matches:verdict.snapshot_matches,
     hold_active:verdict.hold_active,release_eligible:verdict.release_eligible};
   }catch(error){await stateReader.query('ROLLBACK');throw error;}
  };
  const createProof=(current,signer,key)=>signFixtureAuditAnchor({
   organization_id:a,failure_id:failure,incident_id:current.incident_id,event_id:current.event_id,
   snapshot_sequence:current.snapshot_sequence,remediation_version:current.remediation_version,
   accepted_review_roles:current.accepted_review_roles,observed_digest:current.observed_digest,
   signer_id:signer,issued_at_ms:100,expires_at_ms:200
  },key.privateKey);
  const reason=event=>createHash('sha256').update('fixture-external-key-'+event).digest('hex');
  const appendEvent=(signer,seq,kind)=>ledgerAdmin.query(
   'INSERT INTO v121_anchor.key_events(organization_id,signer_id,event_sequence,event_kind,event_reason_digest) VALUES($1,$2,$3,$4,$5)',
   [a,signer,seq,kind,reason(signer+kind)]);
  const register=async(signer,version,pair)=>{
   await ledgerAdmin.query('INSERT INTO v121_anchor.signers(organization_id,signer_id,key_version,public_key_der) VALUES($1,$2,$3,$4)',
    [a,signer,version,pair.publicKey.export({type:'spki',format:'der'})]);
   await appendEvent(signer,1,'REGISTERED');
  };
  const loadPersistentTrust=async()=>{
   const result=await anchorReader.query(
    "SELECT s.signer_id,s.public_key_der,e.event_kind FROM v121_anchor.signers s LEFT JOIN LATERAL (SELECT event_kind FROM v121_anchor.key_events WHERE organization_id=s.organization_id AND signer_id=s.signer_id ORDER BY event_sequence DESC LIMIT 1) e ON TRUE WHERE s.organization_id=$1",
    [a]);
   keys=new Map(result.rows.map(row=>[row.signer_id,createPublicKey({
    key:row.public_key_der,format:'der',type:'spki'
   })]));
   state=new Map(result.rows.map(row=>[row.signer_id,row.event_kind]));
  };
  const readPersisted=async(seq)=>{
   const row=(await anchorReader.query(
    'SELECT signed_statement,signature_b64,snapshot_sequence FROM v121_anchor.checkpoints WHERE organization_id=$1 AND failure_id=$2 AND snapshot_sequence=$3',
    [a,failure,seq])).rows[0];
   return row&&{statement:row.signed_statement,signature_b64:row.signature_b64};
  };
  const persist=async(anchor,current,minimumSequence)=>{
   // This separately credentialed attester proves the Ed25519 verification
   // decision to the database; the writer alone cannot forge the ticket.
   const ticket=await issueFixtureVerifiedAnchorTicket({
    anchor,publicKeys:keys,keyStates:state,current,nowMs:150,minimumSequence,
    attester:anchorAttester
   });
   await anchorWriter.query(
    'SELECT v121_anchor.append_checkpoint($1::uuid,$2::uuid,$3::integer,$4::uuid,$5::jsonb,$6::text,$7::char(64),$8::uuid)',
    [a,failure,anchor.statement.snapshot_sequence,anchor.statement.signer_id,
     anchor.statement,anchor.signature_b64,anchor.statement.observed_digest,ticket]);
  };
  await register(signer1,1,keys1);
  await loadPersistentTrust();
  const first=await readLocal();
  assert.equal(first.snapshot_sequence,4);
  assert.equal(first.verdict,'SNAPSHOT_MATCH_STILL_HOLD');
  const proof1=createProof(first,signer1,keys1);
  await assert.rejects(anchorWriter.query('INSERT INTO v121_anchor.checkpoints(organization_id) VALUES($1)',[a]),/permission denied/);
  await assert.rejects(anchorWriter.query('SELECT * FROM v121_anchor.signers'),/permission denied/);
  await assert.rejects(anchorWriter.query(
   'SELECT v121_anchor.append_checkpoint($1::uuid,$2::uuid,$3::integer,$4::uuid,$5::jsonb,$6::text,$7::char(64),$8::uuid)',
   [a,failure,4,signer1,proof1.statement,proof1.signature_b64,proof1.statement.observed_digest,randomUUID()]
  ),/V121_ANCHOR_ADMISSION_MISSING/);
  await assert.rejects(anchorWriter.query(
   'SELECT v121_anchor.attest_verified_checkpoint($1::uuid,$2::uuid,$3::uuid,$4::integer,$5::uuid,$6::jsonb,$7::text,$8::char(64))',
   [randomUUID(),a,failure,4,signer1,proof1.statement,proof1.signature_b64,proof1.statement.observed_digest]
  ),/permission denied/);
  const altered={...proof1,statement:{...proof1.statement,observed_digest:'e'.repeat(64)}};
  await assert.rejects(persist(altered,first,4),{code:'V121_ANCHOR_SIGNATURE_INVALID'});
  await persist(proof1,first,4);
  await assert.rejects(persist(proof1,first,4),/V121_ANCHOR_CHECKPOINT_ROLLBACK|duplicate key/);
  assert.deepEqual(await readPersisted(4),proof1);
  await anchorReader.end();
  // New client proves proof and public key survived the writer and reader sessions.
  const restartedReader=new pg.Client({host,database:'v121_anchor_isolated',user:'v121_anchor_reader',password:'test_only_anchor_reader'});
  await restartedReader.connect();
  anchorReader=restartedReader;
  {
   const saved=(await restartedReader.query('SELECT signed_statement,signature_b64 FROM v121_anchor.checkpoints WHERE organization_id=$1 AND failure_id=$2 AND snapshot_sequence=4',[a,failure])).rows[0];
   const persistedKey=(await restartedReader.query('SELECT public_key_der FROM v121_anchor.signers WHERE organization_id=$1 AND signer_id=$2',[a,signer1])).rows[0].public_key_der;
   assert.ok(Buffer.from(persistedKey).equals(keys1.publicKey.export({type:'spki',format:'der'})));
   assert.deepEqual({statement:saved.signed_statement,signature_b64:saved.signature_b64},proof1);
   await loadPersistentTrust();
   assert.equal(state.get(signer1),'REGISTERED');
  }
  await register(signer2,2,keys2);
  await appendEvent(signer1,2,'RETIRED');
  await loadPersistentTrust();
  assert.throws(()=>verifyFixtureActiveAuditAnchor({
   anchor:proof1,publicKeys:keys,keyStates:state,current:first,nowMs:150,minimumSequence:4
  }),{code:'V121_ANCHOR_KEY_RETIRED'});
  assert.equal(inspectFixtureArchivedAuditAnchor({anchor:proof1,publicKeys:keys,keyStates:state}).status,'RETIRED_HISTORICAL_ONLY');
  const newEvidence=createHash('sha256').update('fixture-persistent-audit-remediation-v8').digest('hex');
  const note=createHash('sha256').update('fixture-persistent-audit-remediation-note').digest('hex');
  const remediation8='00000000-0000-4000-8000-0000000000ba';
  await closeoutWriter.query(
   'SELECT v106_test.fixture_submit_uat_remediation($1::uuid,$2::uuid,$3::uuid,$4::integer,$5::char(64),$6::uuid,$7::char(64))',
   [a,failure,remediation8,8,newEvidence,'00000000-0000-4000-8000-000000000016',note]);
  const observed=(await stateReader.query('SELECT * FROM v106_test.fixture_observe_uat_snapshot($1::uuid,$2::uuid)',[a,failure])).rows[0];
  await admin.query('INSERT INTO v106_test.fixture_uat_state_snapshots(organization_id,failure_id,snapshot_sequence,remediation_version,accepted_review_roles,observed_digest) VALUES($1,$2,$3,$4,$5,$6)',
   [a,failure,5,8,observed.accepted_review_roles,observed.observed_digest]);
  const latest=await readLocal();
  assert.equal(latest.snapshot_sequence,5);
  assert.equal(latest.verdict,'SNAPSHOT_MATCH_STILL_HOLD');
  const retiredProof=createProof(latest,signer1,keys1);
  await assert.rejects(persist(retiredProof,latest,5),{code:'V121_ANCHOR_KEY_RETIRED'});
  const proof2=createProof(latest,signer2,keys2);
  await persist(proof2,latest,5);
  const seq=(await anchorReader.query('SELECT max(snapshot_sequence)::int AS seq FROM v121_anchor.checkpoints WHERE organization_id=$1 AND failure_id=$2',[a,failure])).rows[0].seq;
  assert.equal(seq,5);
  assert.throws(()=>verifyFixtureActiveAuditAnchor({
   anchor:proof1,publicKeys:keys,keyStates:state,current:first,nowMs:150,minimumSequence:seq
  }),{code:'V121_ANCHOR_KEY_RETIRED'});
  await appendEvent(signer1,3,'REVOKED');
  await loadPersistentTrust();
  assert.equal(inspectFixtureArchivedAuditAnchor({anchor:proof1,publicKeys:keys,keyStates:state}).status,'REVOKED_HISTORICAL_ONLY');
  assert.throws(()=>verifyFixtureActiveAuditAnchor({
   anchor:proof1,publicKeys:keys,keyStates:state,current:first,nowMs:150,minimumSequence:seq
  }),{code:'V121_ANCHOR_KEY_REVOKED'});
  await assert.rejects(appendEvent(signer1,4,'REGISTERED'),/V121_ANCHOR_KEY_TRANSITION_INVALID/);
  await assert.rejects(ledgerAdmin.query('DELETE FROM v121_anchor.key_events WHERE organization_id=$1 AND signer_id=$2',[a,signer1]),/V121_ANCHOR_LEDGER_IMMUTABLE/);
  // An active new key can still verify the newest persisted checkpoint.
  assert.equal(verifyFixtureActiveAuditAnchor({
   anchor:proof2,publicKeys:keys,keyStates:state,current:latest,nowMs:150,minimumSequence:seq
  }).status,'ANCHOR_MATCH_STILL_HOLD');
  // A rollback of business history + local snapshot cannot roll back the second DB ledger.
  await admin.query('ALTER TABLE v106_test.fixture_uat_remediations DISABLE TRIGGER fixture_uat_remediations_immutable');
  await admin.query('ALTER TABLE v106_test.fixture_uat_state_snapshots DISABLE TRIGGER fixture_snapshot_immutable');
  try{
   await admin.query('DELETE FROM v106_test.fixture_uat_state_snapshots WHERE organization_id=$1 AND failure_id=$2 AND snapshot_sequence=5',[a,failure]);
   await admin.query('DELETE FROM v106_test.fixture_uat_remediations WHERE organization_id=$1 AND remediation_id=$2',[a,remediation8]);
   const rollback=await readLocal();
   assert.equal(rollback.verdict,'SNAPSHOT_MATCH_STILL_HOLD');
   assert.equal(rollback.snapshot_sequence,4);
   assert.throws(()=>verifyFixtureActiveAuditAnchor({
    anchor:proof2,publicKeys:keys,keyStates:state,current:rollback,nowMs:150,minimumSequence:seq
   }),{code:'V121_ANCHOR_ROLLBACK_DETECTED'});
  }finally{
   await admin.query('INSERT INTO v106_test.fixture_uat_remediations(organization_id,failure_id,remediation_id,remediation_version,new_evidence_digest,remediated_by,remediation_note_digest) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [a,failure,remediation8,8,newEvidence,'00000000-0000-4000-8000-000000000016',note]);
   await admin.query('INSERT INTO v106_test.fixture_uat_state_snapshots(organization_id,failure_id,snapshot_sequence,remediation_version,accepted_review_roles,observed_digest) VALUES($1,$2,$3,$4,$5,$6)',
    [a,failure,5,8,latest.accepted_review_roles,latest.observed_digest]);
   await admin.query('ALTER TABLE v106_test.fixture_uat_state_snapshots ENABLE TRIGGER fixture_snapshot_immutable');
   await admin.query('ALTER TABLE v106_test.fixture_uat_remediations ENABLE TRIGGER fixture_uat_remediations_immutable');
  }
  assert.equal(verifyFixtureActiveAuditAnchor({
   anchor:proof2,publicKeys:keys,keyStates:state,current:await readLocal(),nowMs:150,minimumSequence:seq
  }).status,'ANCHOR_MATCH_STILL_HOLD');
  await appendEvent(signer2,2,'REVOKED');
  await loadPersistentTrust();
  assert.equal(inspectFixtureArchivedAuditAnchor({anchor:proof2,publicKeys:keys,keyStates:state}).status,'REVOKED_HISTORICAL_ONLY');
  assert.throws(()=>verifyFixtureActiveAuditAnchor({
   anchor:proof2,publicKeys:keys,keyStates:state,current:latest,nowMs:150,minimumSequence:seq
  }),{code:'V121_ANCHOR_KEY_REVOKED'});
  await assert.rejects(anchorWriter.query('SELECT * FROM v121_anchor.checkpoints'),/permission denied/);
  await assert.rejects(ledgerAdmin.query('UPDATE v121_anchor.checkpoints SET observed_digest=$1',[ 'f'.repeat(64)]),/V121_ANCHOR_LEDGER_IMMUTABLE/);
  await assert.rejects(admin.query('UPDATE v106_test.fixture_recovery_emergency_stops SET issuance_blocked=false WHERE organization_id=$1 AND incident_id=$2',[a,incident]),/V121_SECURITY_ALERT_UNRESOLVED/);
  const holds=(await admin.query('SELECT module_name,hold_active,release_eligible FROM v106_test.fixture_cross_module_holds WHERE organization_id=$1 AND incident_id=$2 ORDER BY module_name',[a,incident])).rows;
  assert.deepEqual(holds.map(x=>[x.module_name,x.hold_active,x.release_eligible]),[
   ['ACADEMIC',true,false],['FINANCE',true,false],['SALES',true,false]]);
 }finally{
  await anchorAttester.end().catch(()=>{});
  await anchorWriter.end().catch(()=>{});
  await anchorReader.end().catch(()=>{});
  await stateReader.end().catch(()=>{});
  await ledgerAdmin.end();
 }
});


test('concurrent checkpoint signer competition and key revocation serialize without partial writes',async()=>{
 const failure='00000000-0000-4000-8000-0000000000b1';
 const signer3='00000000-0000-4000-8000-0000000000aa';
 const signer4='00000000-0000-4000-8000-0000000000ab';
 const pair3=generateKeyPairSync('ed25519'),pair4=generateKeyPairSync('ed25519');
 const ledger=new pg.Pool({host,database:'v121_anchor_isolated',user:'postgres',password:'postgres'});
 const writerA=new pg.Client({host,database:'v121_anchor_isolated',user:'v121_anchor_writer',password:'test_only_anchor_writer'});
 const writerB=new pg.Client({host,database:'v121_anchor_isolated',user:'v121_anchor_writer',password:'test_only_anchor_writer'});
 const attester=new pg.Client({host,database:'v121_anchor_isolated',user:'v121_anchor_attester',password:'test_only_anchor_attester'});
 const revoker=new pg.Client({host,database:'v121_anchor_isolated',user:'postgres',password:'postgres'});
 const trustReader=new pg.Client({host,database:'v121_anchor_isolated',user:'v121_anchor_reader',password:'test_only_anchor_reader'});
 const businessReader=new pg.Client({host,database:'v106_isolated',user:'v106_state_reader',password:'test_only_state_reader'});
 const reason=createHash('sha256').update('v121-fixture-race-revocation').digest('hex');
 const append='SELECT v121_anchor.append_checkpoint($1::uuid,$2::uuid,$3::integer,$4::uuid,$5::jsonb,$6::text,$7::char(64),$8::uuid)';
 const revoke='INSERT INTO v121_anchor.key_events(organization_id,signer_id,event_sequence,event_kind,event_reason_digest) VALUES($1,$2,$3,$4,$5)';
 const submit='SELECT v106_test.fixture_submit_uat_remediation($1::uuid,$2::uuid,$3::uuid,$4::integer,$5::char(64),$6::uuid,$7::char(64))';
 const note=createHash('sha256').update('v121-fixture-race-note').digest('hex');
 const remediator='00000000-0000-4000-8000-000000000016';
 try{
  await Promise.all([writerA.connect(),writerB.connect(),attester.connect(),revoker.connect(),trustReader.connect(),businessReader.connect()]);
  const register=async(id,version,pair)=>{
   await ledger.query('INSERT INTO v121_anchor.signers(organization_id,signer_id,key_version,public_key_der) VALUES($1,$2,$3,$4)',[a,id,version,pair.publicKey.export({type:'spki',format:'der'})]);
   await ledger.query(revoke,[a,id,1,'REGISTERED',reason]);
  };
  await register(signer3,3,pair3);
  await register(signer4,4,pair4);
  const trust=async()=>{
   const rows=(await trustReader.query(
    "SELECT s.signer_id,s.public_key_der,e.event_kind FROM v121_anchor.signers s LEFT JOIN LATERAL (SELECT event_kind FROM v121_anchor.key_events WHERE organization_id=s.organization_id AND signer_id=s.signer_id ORDER BY event_sequence DESC LIMIT 1) e ON TRUE WHERE s.organization_id=$1",[a])).rows;
   return {publicKeys:new Map(rows.map(r=>[r.signer_id,createPublicKey({key:r.public_key_der,format:'der',type:'spki'})])),
    keyStates:new Map(rows.map(r=>[r.signer_id,r.event_kind]))};
  };
  const current=async()=>{
   await businessReader.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
   try{
    const rebuild=(await businessReader.query('SELECT * FROM v106_test.fixture_rebuild_uat_state($1::uuid,$2::uuid)',[a,failure])).rows[0];
    const observed=(await businessReader.query('SELECT * FROM v106_test.fixture_observe_uat_snapshot($1::uuid,$2::uuid)',[a,failure])).rows[0];
    const result=(await businessReader.query('SELECT * FROM v106_test.fixture_verify_uat_snapshot($1::uuid,$2::uuid)',[a,failure])).rows[0];
    await businessReader.query('COMMIT');
    return {organization_id:a,failure_id:failure,incident_id:rebuild.incident_scope,event_id:rebuild.event_scope,
     snapshot_sequence:result.snapshot_sequence,remediation_version:observed.remediation_version,
     accepted_review_roles:observed.accepted_review_roles,observed_digest:observed.observed_digest,
     rebuild_status:observed.rebuild_status,verdict:result.verdict,snapshot_matches:result.snapshot_matches,
     hold_active:result.hold_active,release_eligible:result.release_eligible};
   }catch(error){await businessReader.query('ROLLBACK');throw error;}
  };
  const advance=async(version,seq,id)=>{
   const evidence=createHash('sha256').update('v121-concurrent-signer-remediation-'+version).digest('hex');
   await closeoutWriter.query(submit,[a,failure,id,version,evidence,remediator,note]);
   const observed=(await businessReader.query('SELECT * FROM v106_test.fixture_observe_uat_snapshot($1::uuid,$2::uuid)',[a,failure])).rows[0];
   assert.equal(observed.remediation_version,version);
   await admin.query('INSERT INTO v106_test.fixture_uat_state_snapshots(organization_id,failure_id,snapshot_sequence,remediation_version,accepted_review_roles,observed_digest) VALUES($1,$2,$3,$4,$5,$6)',
    [a,failure,seq,version,observed.accepted_review_roles,observed.observed_digest]);
   const result=await current();
   assert.equal(result.snapshot_sequence,seq);
   assert.equal(result.verdict,'SNAPSHOT_MATCH_STILL_HOLD');
   return result;
  };
  const signAnchor=(state,id,pair)=>signFixtureAuditAnchor({
   organization_id:a,failure_id:failure,incident_id:state.incident_id,event_id:state.event_id,
   snapshot_sequence:state.snapshot_sequence,remediation_version:state.remediation_version,
   accepted_review_roles:state.accepted_review_roles,observed_digest:state.observed_digest,
   signer_id:id,issued_at_ms:100,expires_at_ms:200
  },pair.privateKey);
  const proofParams=(proof,ticket)=>[a,failure,proof.statement.snapshot_sequence,proof.statement.signer_id,
   proof.statement,proof.signature_b64,proof.statement.observed_digest,ticket];
  const verifyBefore=async(proof,observed)=>{
   const trusted=await trust();
   return verifyFixtureActiveAuditAnchor({...trusted,anchor:proof,current:observed,
    nowMs:150,minimumSequence:observed.snapshot_sequence});
  };
  const issue=async(proof,observed)=>{
   const trusted=await trust();
   return issueFixtureVerifiedAnchorTicket({
    ...trusted,anchor:proof,current:observed,nowMs:150,
    minimumSequence:observed.snapshot_sequence,attester
   });
  };
  // Two signing keys race the same real snapshot; exactly one append survives.
  const v9=await advance(9,6,'00000000-0000-4000-8000-0000000000bb');
  const proof3=signAnchor(v9,signer3,pair3),proof4=signAnchor(v9,signer4,pair4);
  assert.equal((await verifyBefore(proof3,v9)).release_eligible,false);
  assert.equal((await verifyBefore(proof4,v9)).release_eligible,false);
  await assert.rejects(writerA.query(append,proofParams(proof3,randomUUID())),/V121_ANCHOR_ADMISSION_MISSING/);
  const ticket3=await issue(proof3,v9),ticket4=await issue(proof4,v9);
  const swapped={...proof3,statement:{...proof3.statement,observed_digest:'e'.repeat(64)}};
  await assert.rejects(writerA.query(append,proofParams(swapped,ticket3)),/V121_ANCHOR_ADMISSION_MISMATCH/);
  const outcome=await Promise.allSettled([
   writerA.query(append,proofParams(proof3,ticket3)),
   writerB.query(append,proofParams(proof4,ticket4))
  ]);
  assert.deepEqual(outcome.map(x=>x.status).sort(),['fulfilled','rejected']);
  assert.match(String(outcome.find(x=>x.status==='rejected').reason.message),/V121_ANCHOR_CHECKPOINT_ROLLBACK|duplicate key/);
  const winner=(await trustReader.query('SELECT signer_id FROM v121_anchor.checkpoints WHERE organization_id=$1 AND failure_id=$2 AND snapshot_sequence=6',[a,failure])).rows;
  assert.equal(winner.length,1);
  assert.ok([signer3,signer4].includes(winner[0].signer_id));
  await assert.rejects(writerA.query(revoke,[a,signer3,2,'REVOKED',reason]),/permission denied/);
  await assert.rejects(writerA.query('UPDATE v121_anchor.checkpoints SET observed_digest=$1',['a'.repeat(64)]),/permission denied/);
  // Writer wins the signer lock before revocation: revoker cannot commit until
  // the checkpoint commits or rolls back. Never split an accepted write.
  const v10=await advance(10,7,'00000000-0000-4000-8000-0000000000bc');
  const proof10=signAnchor(v10,signer3,pair3);
  await verifyBefore(proof10,v10);
  const ticket10=await issue(proof10,v10);
  await writerA.query('BEGIN');
  try{
   await writerA.query(append,proofParams(proof10,ticket10));
   await revoker.query('BEGIN');
   await revoker.query("SET LOCAL lock_timeout='200ms'");
   await assert.rejects(revoker.query(revoke,[a,signer3,2,'REVOKED',reason]),/canceling statement due to lock timeout/);
   await revoker.query('ROLLBACK');
   await writerA.query('COMMIT');
  }catch(error){
   await writerA.query('ROLLBACK').catch(()=>{});
   await revoker.query('ROLLBACK').catch(()=>{});
   throw error;
  }
  assert.equal((await trustReader.query('SELECT count(*)::int AS n FROM v121_anchor.checkpoints WHERE organization_id=$1 AND failure_id=$2 AND snapshot_sequence=7',[a,failure])).rows[0].n,1);
  assert.equal((await trust()).keyStates.get(signer3),'REGISTERED');
  // Validate while key is active, but delay consumption until after revocation.
  const v11=await advance(11,8,'00000000-0000-4000-8000-0000000000bd');
  const forbidden=signAnchor(v11,signer3,pair3);
  const staleTicket=await issue(forbidden,v11);
  await revoker.query(revoke,[a,signer3,2,'REVOKED',reason]);
  assert.equal((await trust()).keyStates.get(signer3),'REVOKED');
  // A previously issued admission is not a valid bypass after key revocation.
  await assert.rejects(writerA.query(append,proofParams(forbidden,staleTicket)),/V121_ANCHOR_KEY_NOT_ACTIVE/);
  const revokedTrust=await trust();
  assert.throws(()=>verifyFixtureActiveAuditAnchor({...revokedTrust,anchor:forbidden,current:v11,
   nowMs:150,minimumSequence:8}),{code:'V121_ANCHOR_KEY_REVOKED'});
  // Isolation other than READ COMMITTED is rejected rather than using stale
  // snapshots after blocking on key event locks.
  const finalProof=signAnchor(v11,signer4,pair4);
  const finalTicket=await issue(finalProof,v11);
  await writerA.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  try{
   await assert.rejects(writerA.query(append,proofParams(finalProof,finalTicket)),/V121_ANCHOR_ISOLATION_UNSAFE/);
  }finally{await writerA.query('ROLLBACK');}
  await verifyBefore(finalProof,v11);
  await writerB.query(append,proofParams(finalProof,finalTicket));
  assert.equal((await trustReader.query('SELECT max(snapshot_sequence)::int AS latest FROM v121_anchor.checkpoints WHERE organization_id=$1 AND failure_id=$2',[a,failure])).rows[0].latest,8);
  assert.equal((await trustReader.query('SELECT count(*)::int AS n FROM v121_anchor.checkpoints WHERE organization_id=$1 AND failure_id=$2 AND snapshot_sequence=8',[a,failure])).rows[0].n,1);
  const stopped=(await admin.query('SELECT issuance_blocked FROM v106_test.fixture_recovery_emergency_stops WHERE organization_id=$1 AND incident_id=$2',[a,incident])).rows[0];
  assert.equal(stopped.issuance_blocked,true);
  const holds=(await admin.query('SELECT module_name,hold_active,release_eligible FROM v106_test.fixture_cross_module_holds WHERE organization_id=$1 AND incident_id=$2 ORDER BY module_name',[a,incident])).rows;
  assert.deepEqual(holds.map(x=>[x.module_name,x.hold_active,x.release_eligible]),[
   ['ACADEMIC',true,false],['FINANCE',true,false],['SALES',true,false]]);
 }finally{
  await Promise.allSettled([writerA.end(),writerB.end(),attester.end(),revoker.end(),trustReader.end(),businessReader.end()]);
  await ledger.end();
 }
});


test('attester abuse controls: one active ticket, expiry, service outage and fail-closed replay',async()=>{
 const failure='00000000-0000-4000-8000-0000000000b1';
 const signer='00000000-0000-4000-8000-0000000000ac';
 const remediation12='00000000-0000-4000-8000-0000000000be';
 const kp=generateKeyPairSync('ed25519');
 const ledgerAdmin=new pg.Pool({host,database:'v121_anchor_isolated',user:'postgres',password:'postgres'});
 const businessReader=new pg.Client({host,database:'v106_isolated',user:'v106_state_reader',password:'test_only_state_reader'});
 const writer=new pg.Client({host,database:'v121_anchor_isolated',user:'v121_anchor_writer',password:'test_only_anchor_writer'});
 const attester=new pg.Client({host,database:'v121_anchor_isolated',user:'v121_anchor_attester',password:'test_only_anchor_attester'});
 const reader=new pg.Client({host,database:'v121_anchor_isolated',user:'v121_anchor_reader',password:'test_only_anchor_reader'});
 const admissionSql='SELECT v121_anchor.attest_verified_checkpoint($1::uuid,$2::uuid,$3::uuid,$4::integer,$5::uuid,$6::jsonb,$7::text,$8::char(64))';
 const appendSql='SELECT v121_anchor.append_checkpoint($1::uuid,$2::uuid,$3::integer,$4::uuid,$5::jsonb,$6::text,$7::char(64),$8::uuid)';
 const evidence=createHash('sha256').update('v121-attester-timeout-remediation').digest('hex');
 const note=createHash('sha256').update('v121-attester-timeout-note').digest('hex');
 try{
  await Promise.all([businessReader.connect(),writer.connect(),attester.connect(),reader.connect()]);
  await ledgerAdmin.query(
   'INSERT INTO v121_anchor.signers(organization_id,signer_id,key_version,public_key_der) VALUES($1,$2,$3,$4)',
   [a,signer,5,kp.publicKey.export({type:'spki',format:'der'})]
  );
  await ledgerAdmin.query(
   'INSERT INTO v121_anchor.key_events(organization_id,signer_id,event_sequence,event_kind,event_reason_digest) VALUES($1,$2,$3,$4,$5)',
   [a,signer,1,'REGISTERED',note]
  );
  await closeoutWriter.query(
   'SELECT v106_test.fixture_submit_uat_remediation($1::uuid,$2::uuid,$3::uuid,$4::integer,$5::char(64),$6::uuid,$7::char(64))',
   [a,failure,remediation12,12,evidence,'00000000-0000-4000-8000-000000000016',note]
  );
  const observed=(await businessReader.query('SELECT * FROM v106_test.fixture_observe_uat_snapshot($1::uuid,$2::uuid)',[a,failure])).rows[0];
  await admin.query(
   'INSERT INTO v106_test.fixture_uat_state_snapshots(organization_id,failure_id,snapshot_sequence,remediation_version,accepted_review_roles,observed_digest) VALUES($1,$2,$3,$4,$5,$6)',
   [a,failure,9,12,observed.accepted_review_roles,observed.observed_digest]
  );
  const rebuilt=(await businessReader.query('SELECT * FROM v106_test.fixture_rebuild_uat_state($1::uuid,$2::uuid)',[a,failure])).rows[0];
  const status=(await businessReader.query('SELECT * FROM v106_test.fixture_verify_uat_snapshot($1::uuid,$2::uuid)',[a,failure])).rows[0];
  const current={
   organization_id:a,failure_id:failure,incident_id:rebuilt.incident_scope,event_id:rebuilt.event_scope,
   snapshot_sequence:status.snapshot_sequence,remediation_version:observed.remediation_version,
   accepted_review_roles:observed.accepted_review_roles,observed_digest:observed.observed_digest,
   rebuild_status:observed.rebuild_status,verdict:status.verdict,snapshot_matches:status.snapshot_matches,
   hold_active:status.hold_active,release_eligible:status.release_eligible
  };
  assert.equal(current.snapshot_sequence,9);
  assert.equal(current.verdict,'SNAPSHOT_MATCH_STILL_HOLD');
  const proof=signFixtureAuditAnchor({
   organization_id:a,failure_id:failure,incident_id:rebuilt.incident_scope,event_id:rebuilt.event_scope,
   snapshot_sequence:9,remediation_version:12,accepted_review_roles:observed.accepted_review_roles,
   observed_digest:observed.observed_digest,signer_id:signer,issued_at_ms:100,expires_at_ms:200
  },kp.privateKey);
  const publicKey=(await reader.query(
   'SELECT public_key_der FROM v121_anchor.signers WHERE organization_id=$1 AND signer_id=$2',[a,signer]
  )).rows[0].public_key_der;
  const trusted={publicKeys:new Map([[signer,createPublicKey({key:publicKey,format:'der',type:'spki'})]]),
   keyStates:new Map([[signer,'REGISTERED']])};
  const issue=async(verifyClient=attester,anchor=proof)=>
   issueFixtureVerifiedAnchorTicket({anchor,...trusted,current,nowMs:150,minimumSequence:9,attester:verifyClient});
  const input=ticket=>[a,failure,9,signer,proof.statement,proof.signature_b64,proof.statement.observed_digest,ticket];
  // Failed attester process and forged signatures cannot mint admissions.
  await assert.rejects(issue(null),{code:'V121_ANCHOR_ATTESTER_UNAVAILABLE'});
  await assert.rejects(issue(undefined,{...proof,signature_b64:'A'.repeat(86)+'=='}),{code:'V121_ANCHOR_SIGNATURE_INVALID'});
  assert.equal((await reader.query(
   'SELECT count(*)::int AS n FROM v121_anchor.verified_admissions WHERE organization_id=$1 AND failure_id=$2 AND snapshot_sequence=9',
   [a,failure])).rows[0].n,0);
  await assert.rejects(writer.query(appendSql,input(randomUUID())),/V121_ANCHOR_ADMISSION_MISSING/);
  await assert.rejects(writer.query(admissionSql,
   [randomUUID(),a,failure,9,signer,proof.statement,proof.signature_b64,proof.statement.observed_digest]),/permission denied/);
  await assert.rejects(attester.query(appendSql,input(randomUUID())),/permission denied/);
  await assert.rejects(attester.query('SELECT * FROM v121_anchor.verified_admissions'),/permission denied/);
  await assert.rejects(attester.query(admissionSql,
   [randomUUID(),b,failure,9,signer,proof.statement,proof.signature_b64,proof.statement.observed_digest]),
   /V121_ANCHOR_ATTESTER_ROLE_DENIED/);
  await assert.rejects(attester.query(admissionSql,
   [randomUUID(),a,failure,9,signer,{...proof.statement,observed_digest:'f'.repeat(64)},proof.signature_b64,proof.statement.observed_digest]),
   /V121_ANCHOR_ADMISSION_SCOPE_INVALID/);
  const firstTicket=await issue();
  await assert.rejects(issue(),/V121_ANCHOR_ADMISSION_DUPLICATE_ACTIVE/);
  assert.equal((await reader.query(
   'SELECT count(*)::int AS n FROM v121_anchor.verified_admissions WHERE organization_id=$1 AND failure_id=$2 AND snapshot_sequence=9',
   [a,failure])).rows[0].n,1);
  // CI superuser simulates a ticket whose verified 60-second window elapsed.
  await ledgerAdmin.query('ALTER TABLE v121_anchor.verified_admissions DISABLE TRIGGER admission_immutable');
  try{
   await ledgerAdmin.query(
    "UPDATE v121_anchor.verified_admissions SET issued_at=statement_timestamp()-interval '120 seconds', expires_at=statement_timestamp()-interval '90 seconds' WHERE organization_id=$1 AND admission_id=$2",
    [a,firstTicket]
   );
  }finally{await ledgerAdmin.query('ALTER TABLE v121_anchor.verified_admissions ENABLE TRIGGER admission_immutable');}
  await assert.rejects(writer.query(appendSql,input(firstTicket)),/V121_ANCHOR_ADMISSION_EXPIRED/);
  assert.equal((await reader.query(
   'SELECT count(*)::int AS n FROM v121_anchor.checkpoints WHERE organization_id=$1 AND failure_id=$2 AND snapshot_sequence=9',
   [a,failure])).rows[0].n,0);
  const refreshedTicket=await issue();
  assert.notEqual(refreshedTicket,firstTicket);
  // Ticket is bound to exact statement and signature, not just the signer.
  await assert.rejects(writer.query(appendSql,
   [a,failure,9,signer,{...proof.statement,observed_digest:'e'.repeat(64)},proof.signature_b64,'e'.repeat(64),refreshedTicket]),
   /V121_ANCHOR_ADMISSION_MISMATCH/);
  await writer.query(appendSql,input(refreshedTicket));
  await assert.rejects(writer.query(appendSql,input(refreshedTicket)),/V121_ANCHOR_CHECKPOINT_ROLLBACK|duplicate key/);
  assert.equal((await reader.query(
   'SELECT count(*)::int AS n FROM v121_anchor.checkpoints WHERE organization_id=$1 AND failure_id=$2 AND snapshot_sequence=9',
   [a,failure])).rows[0].n,1);
  assert.equal((await reader.query(
   'SELECT count(*)::int AS n FROM v121_anchor.verified_admissions WHERE organization_id=$1 AND failure_id=$2 AND snapshot_sequence=9',
   [a,failure])).rows[0].n,2);
  const holds=(await admin.query(
   'SELECT module_name,hold_active,release_eligible FROM v106_test.fixture_cross_module_holds WHERE organization_id=$1 AND incident_id=$2 ORDER BY module_name',
   [a,incident])).rows;
  assert.deepEqual(holds.map(x=>[x.module_name,x.hold_active,x.release_eligible]),[
   ['ACADEMIC',true,false],['FINANCE',true,false],['SALES',true,false]]);
 }finally{
  await Promise.allSettled([businessReader.end(),writer.end(),attester.end(),reader.end()]);
  await ledgerAdmin.end();
 }
});


test('independent monitor quarantines compromised attester and invalidates all outstanding tickets without erasing history',async()=>{
 const failure='00000000-0000-4000-8000-0000000000b1';
 const validSigner='00000000-0000-4000-8000-0000000000ad';
 const compromisedSigner='00000000-0000-4000-8000-0000000000ae';
 const validKeys=generateKeyPairSync('ed25519');
 const badKeys=generateKeyPairSync('ed25519');
 const evidence=createHash('sha256').update('v121-attester-quarantine-remediation-v13').digest('hex');
 const note=createHash('sha256').update('v121-attester-quarantine-note').digest('hex');
 const ledger=new pg.Pool({host,database:'v121_anchor_isolated',user:'postgres',password:'postgres'});
 const observer=new pg.Client({host,database:'v121_anchor_isolated',user:'v121_anchor_reader',password:'test_only_anchor_reader'});
 const verifier=new pg.Client({host,database:'v121_anchor_isolated',user:'v121_anchor_attester',password:'test_only_anchor_attester'});
 const writer=new pg.Client({host,database:'v121_anchor_isolated',user:'v121_anchor_writer',password:'test_only_anchor_writer'});
 const security=new pg.Client({host,database:'v121_anchor_isolated',user:'v121_anchor_security',password:'test_only_anchor_security'});
 const stateReader=new pg.Client({host,database:'v106_isolated',user:'v106_state_reader',password:'test_only_state_reader'});
 const issueSql='SELECT v121_anchor.attest_verified_checkpoint($1::uuid,$2::uuid,$3::uuid,$4::integer,$5::uuid,$6::jsonb,$7::text,$8::char(64))';
 const writeSql='SELECT v121_anchor.append_checkpoint($1::uuid,$2::uuid,$3::integer,$4::uuid,$5::jsonb,$6::text,$7::char(64),$8::uuid)';
 const reportSql='SELECT v121_anchor.report_attester_quarantine($1::uuid,$2::uuid,$3::uuid,$4::text,$5::char(64))';
 try{
  await Promise.all([observer.connect(),verifier.connect(),writer.connect(),security.connect(),stateReader.connect()]);
  for(const [signer,version,pair] of [[validSigner,6,validKeys],[compromisedSigner,7,badKeys]]){
   await ledger.query('INSERT INTO v121_anchor.signers(organization_id,signer_id,key_version,public_key_der) VALUES($1,$2,$3,$4)',
    [a,signer,version,pair.publicKey.export({type:'spki',format:'der'})]);
   await ledger.query('INSERT INTO v121_anchor.key_events(organization_id,signer_id,event_sequence,event_kind,event_reason_digest) VALUES($1,$2,1,$3,$4)',
    [a,signer,'REGISTERED',note]);
  }
  await closeoutWriter.query('SELECT v106_test.fixture_submit_uat_remediation($1::uuid,$2::uuid,$3::uuid,$4::integer,$5::char(64),$6::uuid,$7::char(64))',
   [a,failure,'00000000-0000-4000-8000-0000000000bf',13,evidence,'00000000-0000-4000-8000-000000000016',note]);
  const observed=(await stateReader.query('SELECT * FROM v106_test.fixture_observe_uat_snapshot($1::uuid,$2::uuid)',[a,failure])).rows[0];
  assert.equal(observed.remediation_version,13);
  await admin.query('INSERT INTO v106_test.fixture_uat_state_snapshots(organization_id,failure_id,snapshot_sequence,remediation_version,accepted_review_roles,observed_digest) VALUES($1,$2,10,13,$3,$4)',
   [a,failure,observed.accepted_review_roles,observed.observed_digest]);
  const rebuilt=(await stateReader.query('SELECT * FROM v106_test.fixture_rebuild_uat_state($1::uuid,$2::uuid)',[a,failure])).rows[0];
  const status=(await stateReader.query('SELECT * FROM v106_test.fixture_verify_uat_snapshot($1::uuid,$2::uuid)',[a,failure])).rows[0];
  assert.equal(status.verdict,'SNAPSHOT_MATCH_STILL_HOLD');
  const current={
   organization_id:a,failure_id:failure,incident_id:rebuilt.incident_scope,event_id:rebuilt.event_scope,
   snapshot_sequence:10,remediation_version:13,accepted_review_roles:observed.accepted_review_roles,
   observed_digest:observed.observed_digest,rebuild_status:observed.rebuild_status,
   verdict:status.verdict,snapshot_matches:status.snapshot_matches,
   hold_active:status.hold_active,release_eligible:status.release_eligible
  };
  const signedStatement=signer=>({
   organization_id:a,failure_id:failure,incident_id:rebuilt.incident_scope,event_id:rebuilt.event_scope,
   snapshot_sequence:10,remediation_version:13,accepted_review_roles:observed.accepted_review_roles,
   observed_digest:observed.observed_digest,signer_id:signer,issued_at_ms:100,expires_at_ms:200
  });
  const legit=signFixtureAuditAnchor(signedStatement(validSigner),validKeys.privateKey);
  const validTicket=await issueFixtureVerifiedAnchorTicket({
   anchor:legit,publicKeys:new Map([[validSigner,validKeys.publicKey]]),
   keyStates:new Map([[validSigner,'REGISTERED']]),current,nowMs:150,minimumSequence:10,
   attester:verifier
  });
  // An attacker using only the attester credential can record a format-correct
  // but cryptographically forged attestation. The separate monitor must detect it.
  const maliciousTicket=randomUUID();
  const forgedStatement=signedStatement(compromisedSigner);
  const forgedSignature='A'.repeat(86)+'==';
  await verifier.query(issueSql,[maliciousTicket,a,failure,10,compromisedSigner,
   forgedStatement,forgedSignature,forgedStatement.observed_digest]);
  const stored=(await observer.query('SELECT organization_id,failure_id,snapshot_sequence,signer_id,signed_statement,signature_b64,observed_digest FROM v121_anchor.verified_admissions WHERE organization_id=$1 AND admission_id=$2',
   [a,maliciousTicket])).rows[0];
  const key=(await observer.query('SELECT public_key_der FROM v121_anchor.signers WHERE organization_id=$1 AND signer_id=$2',
   [a,compromisedSigner])).rows[0].public_key_der;
  const inspection=inspectFixtureStoredAdmission({
   admission:stored,publicKeys:new Map([[compromisedSigner,createPublicKey({key,format:'der',type:'spki'})]]),
   keyStates:new Map([[compromisedSigner,'REGISTERED']])
  });
  assert.equal(inspection.anomaly,'ATTESTER_SIGNATURE_INVALID');
  assert.equal(inspection.release_eligible,false);
  const before=(await observer.query('SELECT count(*)::int AS n FROM v121_anchor.checkpoints WHERE organization_id=$1 AND failure_id=$2 AND snapshot_sequence=10',[a,failure])).rows[0].n;
  assert.equal(before,0);
  const securityEvent=randomUUID();
  await assert.rejects(writer.query(reportSql,[a,securityEvent,null,inspection.anomaly,inspection.evidence_digest]),/permission denied/);
  await assert.rejects(verifier.query(reportSql,[a,securityEvent,null,inspection.anomaly,inspection.evidence_digest]),/permission denied/);
  // Only the independent security identity can record the one-way, org-wide
  // quarantine. Every pending valid and forged admission then fails closed.
  await security.query(reportSql,[a,securityEvent,null,inspection.anomaly,inspection.evidence_digest]);
  const quarantines=(await observer.query('SELECT event_kind,evidence_digest FROM v121_anchor.attester_quarantine_events WHERE organization_id=$1 AND event_id=$2',[a,securityEvent])).rows;
  assert.equal(quarantines.length,1);
  assert.equal(quarantines[0].event_kind,'ATTESTER_SIGNATURE_INVALID');
  const payload=(anchor,ticket)=>[a,failure,10,anchor.statement.signer_id,anchor.statement,
   anchor.signature_b64,anchor.statement.observed_digest,ticket];
  await assert.rejects(writer.query(writeSql,payload(legit,validTicket)),/V121_ATTESTER_QUARANTINED/);
  await assert.rejects(writer.query(writeSql,
   [a,failure,10,compromisedSigner,forgedStatement,forgedSignature,forgedStatement.observed_digest,maliciousTicket]),
   /V121_ATTESTER_QUARANTINED/);
  await assert.rejects(verifier.query(issueSql,[randomUUID(),a,failure,10,validSigner,
   legit.statement,legit.signature_b64,legit.statement.observed_digest]),/V121_ATTESTER_QUARANTINED/);
  await assert.rejects(security.query('UPDATE v121_anchor.attester_quarantine_events SET event_kind=$1 WHERE event_id=$2',
   ['UNEXPECTED_ATTESTATION',securityEvent]),/permission denied/);
  await assert.rejects(ledger.query('DELETE FROM v121_anchor.attester_quarantine_events WHERE organization_id=$1 AND event_id=$2',[a,securityEvent]),/V121_ANCHOR_LEDGER_IMMUTABLE/);
  assert.equal((await observer.query('SELECT count(*)::int AS n FROM v121_anchor.checkpoints WHERE organization_id=$1 AND failure_id=$2 AND snapshot_sequence=10',
   [a,failure])).rows[0].n,0);
  // Forensic history is append-only even after quarantine and can be examined.
  assert.equal((await observer.query('SELECT count(*)::int AS n FROM v121_anchor.verified_admissions WHERE organization_id=$1 AND failure_id=$2 AND snapshot_sequence=10',
   [a,failure])).rows[0].n,2);
  assert.equal((await observer.query('SELECT max(snapshot_sequence)::int AS seq FROM v121_anchor.checkpoints WHERE organization_id=$1 AND failure_id=$2',[a,failure])).rows[0].seq,9);
  const holds=(await admin.query('SELECT module_name,hold_active,release_eligible FROM v106_test.fixture_cross_module_holds WHERE organization_id=$1 AND incident_id=$2 ORDER BY module_name',[a,incident])).rows;
  assert.deepEqual(holds.map(x=>[x.module_name,x.hold_active,x.release_eligible]),[
   ['ACADEMIC',true,false],['FINANCE',true,false],['SALES',true,false]]);
  assert.equal((await admin.query('SELECT issuance_blocked FROM v106_test.fixture_recovery_emergency_stops WHERE organization_id=$1 AND incident_id=$2',[a,incident])).rows[0].issuance_blocked,true);
 }finally{
  await Promise.allSettled([observer.end(),verifier.end(),writer.end(),security.end(),stateReader.end()]);
  await ledger.end();
 }
});


test('independent false-positive assessment remains quarantined, latest-version reviews only and no cross-org authority',async()=>{
 const ledgerAdmin=new pg.Pool({host,database:'v121_anchor_isolated',user:'postgres',password:'postgres'});
 const reader=new pg.Client({host,database:'v121_anchor_isolated',user:'v121_anchor_reader',password:'test_only_anchor_reader'});
 const investigator=new pg.Client({host,database:'v121_anchor_isolated',user:'v121_anchor_investigator',password:'test_only_quarantine_investigator'});
 const security=new pg.Client({host,database:'v121_anchor_isolated',user:'v121_anchor_security_reviewer',password:'test_only_quarantine_security'});
 const audit=new pg.Client({host,database:'v121_anchor_isolated',user:'v121_anchor_audit_reviewer',password:'test_only_quarantine_audit'});
 const writer=new pg.Client({host,database:'v121_anchor_isolated',user:'v121_anchor_writer',password:'test_only_anchor_writer'});
 const reviewSql='SELECT v121_anchor.record_quarantine_review($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::char(64))';
 const assessmentSql='SELECT v121_anchor.record_quarantine_assessment($1::uuid,$2::uuid,$3::uuid,$4::integer,$5::uuid,$6::text,$7::char(64))';
 const investigatorId='00000000-0000-4000-8000-0000000000d1';
 const securityId='00000000-0000-4000-8000-0000000000d2';
 const auditId='00000000-0000-4000-8000-0000000000d3';
 const assessment1='00000000-0000-4000-8000-0000000000d4';
 const assessment2='00000000-0000-4000-8000-0000000000d5';
 const unknown='00000000-0000-4000-8000-0000000000dd';
 const digest1=createHash('sha256').update('quarantine-unresolved-first-digest').digest('hex');
 const digest2=createHash('sha256').update('quarantine-false-positive-second-digest').digest('hex');
 try{
  await Promise.all([reader.connect(),investigator.connect(),security.connect(),audit.connect(),writer.connect()]);
  const quarantines=(await reader.query('SELECT event_id FROM v121_anchor.attester_quarantine_events WHERE organization_id=$1 ORDER BY recorded_at DESC',[a])).rows;
  assert.equal(quarantines.length,1);
  const event=quarantines[0].event_id;
  const diagnostic=async()=> (await reader.query('SELECT * FROM v121_anchor.quarantine_review_diagnostics WHERE organization_id=$1 AND event_id=$2',[a,event])).rows[0];
  let state=await diagnostic();
  assert.deepEqual([state.latest_assessment_id,state.latest_agreed_reviews,state.quarantine_active,state.hold_active,state.release_eligible],
   [null,0,true,true,false]);
  await assert.rejects(investigator.query(assessmentSql,[b,event,assessment1,1,investigatorId,'INCONCLUSIVE',digest1]),
   /V121_QUARANTINE_INVESTIGATOR_DENIED/);
  await assert.rejects(investigator.query(assessmentSql,[a,unknown,assessment1,1,investigatorId,'INCONCLUSIVE',digest1]),
   /V121_QUARANTINE_EVENT_UNKNOWN/);
  await assert.rejects(writer.query(assessmentSql,[a,event,assessment1,1,investigatorId,'INCONCLUSIVE',digest1]),
   /permission denied/);
  await investigator.query(assessmentSql,[a,event,assessment1,1,investigatorId,'INCONCLUSIVE',digest1]);
  await assert.rejects(investigator.query(assessmentSql,[a,event,assessment1,1,investigatorId,'INCONCLUSIVE',digest1]),
   /V121_QUARANTINE_VERSION_NOT_NEXT/);
  await assert.rejects(security.query(reviewSql,[b,assessment1,securityId,'SECURITY','AGREED',digest1]),
   /V121_QUARANTINE_REVIEW_ROLE_DENIED/);
  await assert.rejects(security.query(reviewSql,[a,assessment1,securityId,'AUDIT','AGREED',digest1]),
   /V121_QUARANTINE_REVIEW_ROLE_DENIED/);
  await assert.rejects(audit.query(reviewSql,[a,assessment1,auditId,'SECURITY','AGREED',digest1]),
   /V121_QUARANTINE_REVIEW_ROLE_DENIED/);
  await assert.rejects(security.query(reviewSql,[a,assessment1,investigatorId,'SECURITY','AGREED',digest1]),
   /V121_QUARANTINE_REVIEW_NOT_INDEPENDENT/);
  await assert.rejects(security.query(reviewSql,[a,assessment1,securityId,'SECURITY','AGREED',digest2]),
   /V121_QUARANTINE_REVIEW_EVIDENCE_MISMATCH/);
  await security.query(reviewSql,[a,assessment1,securityId,'SECURITY','AGREED',digest1]);
  await assert.rejects(audit.query(reviewSql,[a,assessment1,securityId,'AUDIT','AGREED',digest1]),
   /V121_QUARANTINE_REVIEW_NOT_INDEPENDENT/);
  await audit.query(reviewSql,[a,assessment1,auditId,'AUDIT','AGREED',digest1]);
  state=await diagnostic();
  assert.equal(state.latest_agreed_reviews,2);
  assert.equal(state.status,'QUARANTINE_RETAINED');
  const original=(await reader.query('SELECT event_kind,evidence_digest FROM v121_anchor.attester_quarantine_events WHERE organization_id=$1 AND event_id=$2',[a,event])).rows[0];
  await investigator.query(assessmentSql,[a,event,assessment2,2,investigatorId,'FALSE_POSITIVE_CANDIDATE',digest2]);
  state=await diagnostic();
  assert.deepEqual([state.latest_assessment_id,state.latest_version,state.latest_finding,state.latest_agreed_reviews],
   [assessment2,2,'FALSE_POSITIVE_CANDIDATE',0]);
  await assert.rejects(security.query(reviewSql,[a,assessment1,'00000000-0000-4000-8000-0000000000d6','SECURITY','AGREED',digest1]),
   /V121_QUARANTINE_ASSESSMENT_SUPERSEDED/);
  await security.query(reviewSql,[a,assessment2,securityId,'SECURITY','AGREED',digest2]);
  await audit.query(reviewSql,[a,assessment2,auditId,'AUDIT','AGREED',digest2]);
  state=await diagnostic();
  assert.deepEqual([state.latest_agreed_reviews,state.quarantine_active,state.hold_active,state.release_eligible,state.status],
   [2,true,true,false,'QUARANTINE_RETAINED']);
  await assert.rejects(audit.query(reviewSql,[a,assessment2,auditId,'AUDIT','AGREED',digest2]),
   /V121_QUARANTINE_REVIEW_NOT_INDEPENDENT|duplicate key/);
  await assert.rejects(ledgerAdmin.query('UPDATE v121_anchor.attester_quarantine_events SET event_kind=$1 WHERE organization_id=$2 AND event_id=$3',
   ['UNEXPECTED_ATTESTATION',a,event]),/V121_ANCHOR_LEDGER_IMMUTABLE/);
  const preserved=(await reader.query('SELECT event_kind,evidence_digest FROM v121_anchor.attester_quarantine_events WHERE organization_id=$1 AND event_id=$2',[a,event])).rows[0];
  assert.deepEqual(preserved,original);
  const foreignEvent='00000000-0000-4000-8000-0000000000de';
  await ledgerAdmin.query(
   'INSERT INTO v121_anchor.attester_quarantine_events(organization_id,event_id,affected_failure_id,event_kind,evidence_digest) VALUES($1,$2,NULL,$3,$4)',
   [b,foreignEvent,'UNEXPECTED_ATTESTATION',digest2]
  );
  assert.equal((await reader.query('SELECT count(*)::int AS n FROM v121_anchor.attester_quarantine_events WHERE organization_id=$1',[b])).rows[0].n,0);
  assert.equal((await reader.query('SELECT count(*)::int AS n FROM v121_anchor.quarantine_review_diagnostics WHERE organization_id=$1',[b])).rows[0].n,0);
  assert.equal((await reader.query('SELECT count(*)::int AS n FROM v121_anchor.quarantine_assessments WHERE organization_id=$1',[b])).rows[0].n,0);
  assert.equal((await reader.query('SELECT count(*)::int AS n FROM v121_anchor.quarantine_assessment_reviews WHERE organization_id=$1',[b])).rows[0].n,0);

  assert.equal((await reader.query('SELECT count(*)::int AS n FROM v121_anchor.quarantine_assessment_reviews WHERE organization_id=$1 AND assessment_id IN ($2,$3)',[a,assessment1,assessment2])).rows[0].n,4);
  assert.equal((await reader.query('SELECT count(*)::int AS n FROM v121_anchor.quarantine_assessments WHERE organization_id=$1 AND event_id=$2',[a,event])).rows[0].n,2);
  const holds=(await admin.query('SELECT module_name,hold_active,release_eligible FROM v106_test.fixture_cross_module_holds WHERE organization_id=$1 AND incident_id=$2 ORDER BY module_name',[a,incident])).rows;
  assert.deepEqual(holds.map(x=>[x.module_name,x.hold_active,x.release_eligible]),[
   ['ACADEMIC',true,false],['FINANCE',true,false],['SALES',true,false]]);
  const stopped=(await admin.query('SELECT issuance_blocked FROM v106_test.fixture_recovery_emergency_stops WHERE organization_id=$1 AND incident_id=$2',[a,incident])).rows[0];
  assert.equal(stopped.issuance_blocked,true);
 }finally{
  await Promise.allSettled([reader.end(),investigator.end(),security.end(),audit.end(),writer.end()]);
  await ledgerAdmin.end();
 }
});


test('quarantine evidence chain binds original event, latest investigation and two distinct approvals while remaining HOLD',async()=>{
 const reader=new pg.Client({host,database:'v121_anchor_isolated',user:'v121_anchor_reader',password:'test_only_anchor_reader'});
 const checker=new pg.Client({host,database:'v121_anchor_isolated',user:'v121_anchor_evidence_checker',password:'test_only_quarantine_evidence'});
 const investigator=new pg.Client({host,database:'v121_anchor_isolated',user:'v121_anchor_investigator',password:'test_only_quarantine_investigator'});
 const security=new pg.Client({host,database:'v121_anchor_isolated',user:'v121_anchor_security_reviewer',password:'test_only_quarantine_security'});
 const audit=new pg.Client({host,database:'v121_anchor_isolated',user:'v121_anchor_audit_reviewer',password:'test_only_quarantine_audit'});
 const ledger=new pg.Pool({host,database:'v121_anchor_isolated',user:'postgres',password:'postgres'});
 const previous='00000000-0000-4000-8000-0000000000d4';
 const current='00000000-0000-4000-8000-0000000000d5';
 const third='00000000-0000-4000-8000-0000000000d7';
 const investigatorId='00000000-0000-4000-8000-0000000000d1';
 const securityId='00000000-0000-4000-8000-0000000000d2';
 const auditId='00000000-0000-4000-8000-0000000000d3';
 const checkerId='00000000-0000-4000-8000-0000000000d8';
 const digest3=createHash('sha256').update('quarantine-third-version-evidence').digest('hex');
 const attestSql='SELECT v121_anchor.attest_quarantine_evidence($1::uuid,$2::uuid,$3::uuid,$4::uuid)';
 const assessSql='SELECT v121_anchor.record_quarantine_assessment($1::uuid,$2::uuid,$3::uuid,$4::integer,$5::uuid,$6::text,$7::char(64))';
 const reviewSql='SELECT v121_anchor.record_quarantine_review($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::char(64))';
 try{
  await Promise.all([reader.connect(),checker.connect(),investigator.connect(),security.connect(),audit.connect()]);
  const event=(await reader.query('SELECT event_id FROM v121_anchor.attester_quarantine_events WHERE organization_id=$1 ORDER BY recorded_at DESC LIMIT 1',[a])).rows[0].event_id;
  const diagnostics=async()=>(await reader.query('SELECT * FROM v121_anchor.quarantine_chain_diagnostics($1::uuid,$2::uuid)',[a,event])).rows[0];
  let result=await diagnostics();
  assert.deepEqual([result.latest_assessment,result.latest_version,result.linked_reviews,result.chain_status,result.quarantine_active,result.hold_active,result.release_eligible],
   [current,2,2,'EVIDENCE_ATTESTATION_MISSING',true,true,false]);
  await assert.rejects(checker.query(attestSql,[b,event,current,checkerId]),/V121_QUARANTINE_CHAIN_CHECKER_DENIED/);
  await assert.rejects(security.query(attestSql,[a,event,current,checkerId]),/permission denied/);
  await assert.rejects(checker.query(attestSql,[a,event,previous,checkerId]),/V121_QUARANTINE_CHAIN_SUPERSEDED/);
  await assert.rejects(checker.query(attestSql,[a,event,current,investigatorId]),/V121_QUARANTINE_CHECKER_NOT_INDEPENDENT/);
  await assert.rejects(checker.query(attestSql,[a,event,current,securityId]),/V121_QUARANTINE_CHECKER_NOT_INDEPENDENT/);
  await checker.query(attestSql,[a,event,current,checkerId]);
  result=await diagnostics();
  assert.equal(result.chain_status,'EVIDENCE_LINKED_STILL_HOLD');
  assert.match(result.chain_expected,/^[a-f0-9]{64}$/);
  assert.equal(result.chain_expected,result.chain_recorded);
  await assert.rejects(checker.query(attestSql,[a,event,current,checkerId]),/duplicate key/);
  await assert.rejects(ledger.query('DELETE FROM v121_anchor.quarantine_evidence_chains WHERE organization_id=$1 AND assessment_id=$2',[a,current]),
   /V121_ANCHOR_LEDGER_IMMUTABLE/);
  // A forged or altered original incident digest makes the previously anchored
  // investigation chain invalid, even though review digests are unchanged.
  const original=(await reader.query('SELECT evidence_digest FROM v121_anchor.attester_quarantine_events WHERE organization_id=$1 AND event_id=$2',[a,event])).rows[0].evidence_digest;
  await ledger.query('ALTER TABLE v121_anchor.attester_quarantine_events DISABLE TRIGGER attester_quarantine_immutable');
  try{
   await ledger.query('UPDATE v121_anchor.attester_quarantine_events SET evidence_digest=$3 WHERE organization_id=$1 AND event_id=$2',[a,event,'f'.repeat(64)]);
   const changed=await diagnostics();
   assert.equal(changed.chain_status,'EVIDENCE_CHAIN_MISMATCH');
   assert.equal(changed.release_eligible,false);
  }finally{
   await ledger.query('UPDATE v121_anchor.attester_quarantine_events SET evidence_digest=$3 WHERE organization_id=$1 AND event_id=$2',[a,event,original]);
   await ledger.query('ALTER TABLE v121_anchor.attester_quarantine_events ENABLE TRIGGER attester_quarantine_immutable');
  }
  assert.equal((await diagnostics()).chain_status,'EVIDENCE_LINKED_STILL_HOLD');
  await ledger.query('ALTER TABLE v121_anchor.quarantine_assessment_reviews DISABLE TRIGGER assessment_reviews_immutable');
  try{
   await ledger.query("UPDATE v121_anchor.quarantine_assessment_reviews SET decision='DISAGREED' WHERE organization_id=$1 AND assessment_id=$2 AND review_domain='AUDIT'",[a,current]);
   assert.equal((await diagnostics()).chain_status,'EVIDENCE_INCOMPLETE_OR_CONFLICTING');
  }finally{
   await ledger.query("UPDATE v121_anchor.quarantine_assessment_reviews SET decision='AGREED' WHERE organization_id=$1 AND assessment_id=$2 AND review_domain='AUDIT'",[a,current]);
   await ledger.query('ALTER TABLE v121_anchor.quarantine_assessment_reviews ENABLE TRIGGER assessment_reviews_immutable');
  }
  assert.equal((await diagnostics()).chain_status,'EVIDENCE_LINKED_STILL_HOLD');
  // A new investigation immediately invalidates the previous chain, and
  // neither the old chain nor its dual reviews can be carried forward.
  await investigator.query(assessSql,[a,event,third,3,investigatorId,'INCONCLUSIVE',digest3]);
  result=await diagnostics();
  assert.deepEqual([result.latest_assessment,result.latest_version,result.linked_reviews,result.chain_status],
   [third,3,0,'EVIDENCE_INCOMPLETE_OR_CONFLICTING']);
  await assert.rejects(checker.query(attestSql,[a,event,current,checkerId]),/V121_QUARANTINE_CHAIN_SUPERSEDED/);
  await assert.rejects(checker.query(attestSql,[a,event,third,checkerId]),/V121_QUARANTINE_CHAIN_INCOMPLETE/);
  await security.query(reviewSql,[a,third,securityId,'SECURITY','AGREED',digest3]);
  result=await diagnostics();
  assert.equal(result.linked_reviews,1);
  assert.equal(result.chain_status,'EVIDENCE_INCOMPLETE_OR_CONFLICTING');
  await audit.query(reviewSql,[a,third,auditId,'AUDIT','AGREED',digest3]);
  assert.equal((await diagnostics()).chain_status,'EVIDENCE_ATTESTATION_MISSING');
  await checker.query(attestSql,[a,event,third,checkerId]);
  result=await diagnostics();
  assert.equal(result.chain_status,'EVIDENCE_LINKED_STILL_HOLD');
  assert.deepEqual([result.latest_version,result.linked_reviews,result.quarantine_active,result.hold_active,result.release_eligible],[3,2,true,true,false]);
  assert.equal((await reader.query('SELECT count(*)::integer AS n FROM v121_anchor.quarantine_evidence_chains WHERE organization_id=$1',[b])).rows[0].n,0);
  await assert.rejects(reader.query('SELECT * FROM v121_anchor.quarantine_chain_diagnostics($1::uuid,$2::uuid)',[b,event]),
   /V121_QUARANTINE_CHAIN_SCOPE_DENIED/);
  const originalStop=(await admin.query('SELECT issuance_blocked FROM v106_test.fixture_recovery_emergency_stops WHERE organization_id=$1 AND incident_id=$2',[a,incident])).rows[0];
  assert.equal(originalStop.issuance_blocked,true);
  const holds=(await admin.query('SELECT module_name,hold_active,release_eligible FROM v106_test.fixture_cross_module_holds WHERE organization_id=$1 AND incident_id=$2 ORDER BY module_name',[a,incident])).rows;
  assert.deepEqual(holds.map(x=>[x.module_name,x.hold_active,x.release_eligible]),[
   ['ACADEMIC',true,false],['FINANCE',true,false],['SALES',true,false]]);
 }finally{
  await Promise.allSettled([reader.end(),checker.end(),investigator.end(),security.end(),audit.end()]);
  await ledger.end();
 }
});


test('EXT-001 synthetic IAM intake: immutable receipts, exact retry, revocation, expiry, reissue and concurrent version conflicts',async()=>{
 const audit=new pg.Pool({host,database:'v121_anchor_isolated',user:'postgres',password:'postgres'});
 const writerA=new pg.Client({host,database:'v121_anchor_isolated',user:'v121_iam_intake_writer',password:'test_only_iam_intake_writer'});
 const writerB=new pg.Client({host,database:'v121_anchor_isolated',user:'v121_iam_intake_writer',password:'test_only_iam_intake_writer'});
 const readOnly=new pg.Client({host,database:'v121_anchor_isolated',user:'v121_iam_intake_reader',password:'test_only_iam_intake_reader'});
 const revoker=new pg.Client({host,database:'v121_anchor_isolated',user:'v121_iam_revoker',password:'test_only_iam_revoker'});
 const attester=new pg.Client({host,database:'v121_anchor_isolated',user:'v121_iam_provenance_attester',password:'test_only_iam_provenance_attester'});
 const receiptSql='SELECT v121_anchor.fixture_register_iam_evidence($1::uuid,$2::integer,$3::uuid,$4::char(64),$5::char(64),$6::char(64),$7::uuid,$8::uuid,$9::timestamptz) AS verdict';
 const statusSql='SELECT * FROM v121_anchor.fixture_iam_evidence_status($1::uuid,$2::integer)';
 const attestSql='SELECT v121_anchor.fixture_attest_iam_provenance($1::uuid,$2::integer,$3::uuid,$4::uuid,$5::char(64),$6::char(64),$7::char(64),$8::uuid,$9::uuid,$10::char(64),$11::char(64),$12::timestamptz) AS verdict';
 const revokeSql='SELECT v121_anchor.fixture_revoke_iam_evidence($1::uuid,$2::integer,$3::uuid,$4::char(64))';
 const issuerId='00000000-0000-4000-8000-0000000000c1';
 const reviewerId='00000000-0000-4000-8000-0000000000c3';
 const issuerKeyId='00000000-0000-4000-8000-0000000000c2';
 const reviewerKeyId='00000000-0000-4000-8000-0000000000c4';
 const issuerKeys=generateKeyPairSync('ed25519'),reviewerKeys=generateKeyPairSync('ed25519');
 const trustedKeys=new Map([
  [issuerKeyId,{status:'ACTIVE',domain:'SECURITY',principal_id:issuerId,publicKey:issuerKeys.publicKey}],
  [reviewerKeyId,{status:'ACTIVE',domain:'AUDIT',principal_id:reviewerId,publicKey:reviewerKeys.publicKey}]
 ]);
 const now=Date.now();
 const expiresAt=now+1_800_000;
 const make=(revision,label=String(revision))=>{
  const e1Bytes=Buffer.from('fixture-iam-roles-'+label);
  const e2Bytes=Buffer.from('fixture-iam-negatives-'+label);
  const body={
   schema_version:'v3.2-121-ext001-evidence-v1',
   scope:'CI_FIXTURE_ONLY',gap_id:'EXT-001',organization_id:a,
   revision_no:revision,revision_id:randomUUID(),collected_at_ms:now-60_000,valid_until_ms:expiresAt,
   producer:{principal_id:issuerId,key_id:issuerKeyId,domain:'SECURITY'},
   artifacts:[
    {id:'EXT-001-E1',kind:'IAM_ROLE_INVENTORY',
     uri:'fixture://ext001/synthetic/iam-inventory',
     sha256:createHash('sha256').update(e1Bytes).digest('hex'),
     source:'CI_SYNTHETIC',classification:'SYNTHETIC',
     captured_at_ms:now-90_000,expires_at_ms:expiresAt},
    {id:'EXT-001-E2',kind:'RBAC_NEGATIVE_TESTS',
     uri:'fixture://ext001/synthetic/denial-tests',
     sha256:createHash('sha256').update(e2Bytes).digest('hex'),
     source:'CI_SYNTHETIC',classification:'SYNTHETIC',
     captured_at_ms:now-89_000,expires_at_ms:expiresAt}
   ],
   role_inventory:REQUIRED_IAM_ROLES.map(role=>{
    const human=['SALES','FINANCE','ACADEMIC','DEPLOYMENT'].includes(role);
    return {role,principal_class:human?'HUMAN':'SERVICE',
     authentication:human?'MFA':'WORKLOAD_IDENTITY',
     organization_id:a,least_privilege_asserted:true};
   }),
   denial_matrix:REQUIRED_DENIAL_CASES.map(item=>({
    case:item,result:'DENIED_IN_FIXTURE',artifact_id:'EXT-001-E2'
   }))
  };
  const envelope=signFixtureExt001Envelope(body,{
   issuerPrivateKey:issuerKeys.privateKey,reviewerPrivateKey:reviewerKeys.privateKey,
   reviewerId,reviewerKeyId,reviewedAtMs:now-30_000
  });
  const artifactBytes=new Map([['EXT-001-E1',e1Bytes],['EXT-001-E2',e2Bytes]]);
  const fingerprint=verifyFixtureExt001BytesAndFingerprint(envelope,{trustedKeys,nowMs:now,artifactBytes});
  return {envelope,fingerprint,receiptId:randomUUID(),artifactBytes};
 };
 const params=(revision,proof)=>[a,revision,proof.receiptId,
  proof.fingerprint.evidence_digest,proof.fingerprint.evidence_e1_digest,
  proof.fingerprint.evidence_e2_digest,
  proof.fingerprint.issuer_id,proof.fingerprint.reviewer_id,
  new Date(proof.fingerprint.valid_until_ms)];
 const provenanceParams=(revision,proof)=>[a,revision,proof.fingerprint.revision_id,
  proof.receiptId,proof.fingerprint.evidence_digest,proof.fingerprint.evidence_e1_digest,
  proof.fingerprint.evidence_e2_digest,proof.fingerprint.issuer_id,
  proof.fingerprint.reviewer_id,proof.fingerprint.issuer_signature_digest,
  proof.fingerprint.reviewer_signature_digest,new Date(proof.fingerprint.valid_until_ms)];
 const attest=async(revision,proof)=>issueFixtureExt001VerifiedProvenance({
  envelope:proof.envelope,artifactBytes:proof.artifactBytes,trustedKeys,
  nowMs:now,revisionNo:revision,receiptId:proof.receiptId,
  // Historical pre-cutover fixtures only: legacy core is inaccessible
  // to ordinary IAM attester, and admin seeds history in isolation.
  attester:audit
 });
 const status=async revision=>(await readOnly.query(statusSql,[a,revision])).rows[0];
 try{
  await audit.query(await readFile(new URL('../fixtures/v3-2-121-ext001-iam-evidence-ledger.sql',import.meta.url),'utf8'));
  const sourceAuthKey=randomBytes(32);
  await audit.query('INSERT INTO v121_anchor.fixture_iam_source_auth_keys(organization_id,key_version,auth_key,active) VALUES($1,1,$2,true)',[a,sourceAuthKey]);
  await Promise.all([writerA.connect(),writerB.connect(),readOnly.connect(),revoker.connect(),attester.connect()]);
  assert.deepEqual([ (await status(1)).receipt_status,(await status(1)).history_count ],
   ['RECEIPT_NOT_FOUND',0]);
  const p1=make(1);
  await assert.rejects(attester.query(attestSql,provenanceParams(1,p1)),
   /permission denied/);
  await assert.rejects(writerA.query(receiptSql,params(1,p1)),
   /V121_IAM_PROVENANCE_MISSING_OR_MISMATCH/);
  await assert.rejects(writerA.query(attestSql,provenanceParams(1,p1)),/permission denied/);
  await assert.rejects(attester.query(receiptSql,params(1,p1)),/permission denied/);
  assert.equal((await attest(1,p1)).verdict,'ATTESTED_SYNTHETIC_STILL_HOLD');
  assert.equal((await attest(1,p1)).verdict,'EXACT_PROVENANCE_RETRY_STILL_HOLD');
  await assert.rejects(attest(2,p1),{code:'V121_IAM_PROVENANCE_SIGNED_REVISION_MISMATCH'});
  await assert.rejects(attest(1,{...p1,artifactBytes:new Map([
   ['EXT-001-E1',Buffer.from('files changed after review')],
   ['EXT-001-E2',p1.artifactBytes.get('EXT-001-E2')]
  ])}),{code:'V121_IAM_FILE_DIGEST_MISMATCH'});

  assert.equal((await writerA.query(receiptSql,params(1,p1))).rows[0].verdict,
   'REGISTERED_SYNTHETIC_STILL_HOLD');
  assert.equal((await writerB.query(receiptSql,params(1,p1))).rows[0].verdict,
   'EXACT_RETRY_SYNTHETIC_STILL_HOLD');
  assert.equal((await status(1)).receipt_status,'VALID_SYNTHETIC_STILL_HOLD');
  const fakeBody=structuredClone(p1.envelope);
  fakeBody.body.artifacts[0].sha256='f'.repeat(64);
  assert.throws(()=>fingerprintFixtureExt001ForIntake(fakeBody,{trustedKeys,nowMs:now}),
   {code:'V121_IAM_EVIDENCE_REVIEW_INVALID'});
  await assert.rejects(writerA.query(receiptSql,params(1,{...p1,receiptId:randomUUID()})),
   /V121_IAM_REVISION_CONFLICT/);
  await assert.rejects(writerA.query(receiptSql,params(3,make(3))),
   /V121_IAM_REVISION_NOT_NEXT/);
  await assert.rejects(writerA.query(receiptSql,[b,...params(2,make(2)).slice(1)]),
   /V121_IAM_WRITER_SCOPE_DENIED/);
  await assert.rejects(writerA.query('SELECT * FROM v121_anchor.fixture_iam_evidence_receipts'),
   /permission denied/);
  await assert.rejects(readOnly.query(receiptSql,params(2,make(2))),
   /permission denied/);
  await assert.rejects(writerA.query(revokeSql,[a,1,randomUUID(),p1.fingerprint.evidence_digest]),
   /permission denied/);
  const p2=make(2);
  await assert.rejects(writerB.query(receiptSql,params(2,{...p1,receiptId:randomUUID()})),
   /V121_IAM_PROVENANCE_MISSING_OR_MISMATCH/);
  await attest(2,p2);
  assert.equal((await writerA.query(receiptSql,params(2,p2))).rows[0].verdict,
   'REGISTERED_SYNTHETIC_STILL_HOLD');
  assert.equal((await status(1)).receipt_status,'RECEIPT_SUPERSEDED_STILL_HOLD');
  await assert.rejects(writerA.query(receiptSql,params(1,p1)),
   /V121_IAM_REVISION_SUPERSEDED/);
  const reason=createHash('sha256').update('EXT-001 isolated evidence revoked for independent revalidation').digest('hex');
  const revokeEvent=randomUUID();
  await assert.rejects(revoker.query(revokeSql,[b,2,revokeEvent,reason]),
   /V121_IAM_REVOKER_SCOPE_DENIED/);
  await assert.rejects(revoker.query(revokeSql,[a,3,revokeEvent,reason]),
   /V121_IAM_REVISION_UNKNOWN/);
  await revoker.query(revokeSql,[a,2,revokeEvent,reason]);
  assert.equal((await status(2)).receipt_status,'RECEIPT_REVOKED_STILL_HOLD');
  await assert.rejects(writerB.query(receiptSql,params(2,p2)),
   /V121_IAM_REVISION_REVOKED/);
  await assert.rejects(revoker.query(revokeSql,[a,2,randomUUID(),reason]),
   /V121_IAM_REVISION_ALREADY_REVOKED/);
  const p3=make(3);
  const changedBytes=new Map(p3.artifactBytes);
  changedBytes.set('EXT-001-E2',Buffer.from('replaced file bytes'));
  assert.throws(()=>verifyFixtureExt001BytesAndFingerprint(p3.envelope,
   {trustedKeys,nowMs:now,artifactBytes:changedBytes}),{code:'V121_IAM_FILE_DIGEST_MISMATCH'});
  await attest(3,p3);
  assert.equal((await writerA.query(receiptSql,params(3,p3))).rows[0].verdict,
   'REGISTERED_SYNTHETIC_STILL_HOLD');
  await writerA.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  try{
   await assert.rejects(writerA.query(receiptSql,params(4,make(4))),
    /V121_IAM_ISOLATION_UNSAFE/);
  }finally{await writerA.query('ROLLBACK');}
  // Controlled privileged test-only time travel: no real production timestamps
  // or user data are modified. Existing immutable trigger is restored.
  await audit.query('ALTER TABLE v121_anchor.fixture_iam_evidence_receipts DISABLE TRIGGER fixture_iam_receipts_immutable');
  try{
   await audit.query("UPDATE v121_anchor.fixture_iam_evidence_receipts SET recorded_at=clock_timestamp()-interval '3 hours', expires_at=date_trunc('milliseconds',clock_timestamp()-interval '2 hours') WHERE organization_id=$1 AND gap_id='EXT-001' AND revision_no=3",[a]);
  }finally{
   await audit.query('ALTER TABLE v121_anchor.fixture_iam_evidence_receipts ENABLE TRIGGER fixture_iam_receipts_immutable');
  }
  assert.equal((await status(3)).receipt_status,'RECEIPT_EXPIRED_STILL_HOLD');
  const expired=(await audit.query(
   "SELECT expires_at FROM v121_anchor.fixture_iam_evidence_receipts WHERE organization_id=$1 AND gap_id='EXT-001' AND revision_no=3",[a])).rows[0].expires_at;
  const expiredExactRetry=params(3,p3);
  expiredExactRetry[8]=expired;
  await assert.rejects(writerB.query(receiptSql,expiredExactRetry),
   /V121_IAM_REVISION_EXPIRED/);
  await assert.rejects(writerB.query(receiptSql,params(3,p3)),
   /V121_IAM_REVISION_CONFLICT/);
  const p4=make(4);
  await attest(4,p4);
  await writerA.query(receiptSql,params(4,p4));
  assert.equal((await status(3)).receipt_status,'RECEIPT_SUPERSEDED_STILL_HOLD');
  assert.equal((await status(4)).receipt_status,'VALID_SYNTHETIC_STILL_HOLD');
  const p5a=make(5,'5a'),p5b=make(5,'5b');
  await attest(5,p5a);
  await assert.rejects(attest(5,p5b),/V121_IAM_PROVENANCE_CONFLICT/);
  const race=await Promise.allSettled([
   writerA.query(receiptSql,params(5,p5a)),
   writerB.query(receiptSql,params(5,p5b))
  ]);
  assert.deepEqual(race.map(x=>x.status).sort(),['fulfilled','rejected']);
  assert.match(race.find(x=>x.status==='rejected').reason.message,
   /V121_IAM_REVISION_CONFLICT|V121_IAM_PROVENANCE_MISSING_OR_MISMATCH/);
  assert.equal((await status(5)).receipt_status,'VALID_SYNTHETIC_STILL_HOLD');
  assert.equal((await status(5)).history_count,5);
  // The reader is restarted to prove receipt history survives connections.
  await readOnly.end();
  const again=new pg.Client({host,database:'v121_anchor_isolated',user:'v121_iam_intake_reader',password:'test_only_iam_intake_reader'});
  try{
   await again.connect();
   const d=(await again.query(statusSql,[a,5])).rows[0];
   assert.deepEqual([d.receipt_status,d.latest_revision,d.history_count,d.hold_active,d.release_eligible],
    ['VALID_SYNTHETIC_STILL_HOLD',5,5,true,false]);
   await assert.rejects(again.query(statusSql,[b,5]),/V121_IAM_READER_SCOPE_DENIED/);
  }finally{await again.end();}
  // Bind exact E1/E2 object versions and both signatures into a separate
  // immutable SQL source ledger. All data, keys and readers are CI fixtures.
  const p6=make(6);
  const primaryPair=generateKeyPairSync('ed25519');
  const mirrorPair=generateKeyPairSync('ed25519');
  const primaryId='00000000-0000-4000-8000-0000000000d1';
  const mirrorId='00000000-0000-4000-8000-0000000000d2';
  const primaryActor='00000000-0000-4000-8000-0000000000d3';
  const mirrorActor='00000000-0000-4000-8000-0000000000d4';
  const sourceKeys=new Map([
   [primaryId,{status:'ACTIVE',domain:'FIXTURE_PRIMARY_STORE',
    principal_id:primaryActor,publicKey:primaryPair.publicKey}],
   [mirrorId,{status:'ACTIVE',domain:'FIXTURE_AUDIT_MIRROR',
    principal_id:mirrorActor,publicKey:mirrorPair.publicKey}]
  ]);
  const sourceManifest={
   schema_version:'v3.2-121-ext001-source-version-v1',
   scope:'CI_FIXTURE_ONLY',organization_id:a,
   revision_no:6,revision_id:p6.fingerprint.revision_id,
   envelope_digest:p6.fingerprint.evidence_digest,
   recorded_at_ms:now-1000,expires_at_ms:now+900_000,
   objects:p6.envelope.body.artifacts.map((obj,i)=>({
    artifact_id:obj.id,object_ref:obj.uri,
    object_version_id:'fixture-v6-'+(i===0?'inventory':'denials'),
    generation:6,sha256:obj.sha256
   }))
  };
  const sourceProof=signFixtureExt001SourceManifest(sourceManifest,{
   primaryPrivateKey:primaryPair.privateKey,auditPrivateKey:mirrorPair.privateKey,
   primaryKeyId:primaryId,primaryPrincipalId:primaryActor,
   auditKeyId:mirrorId,auditPrincipalId:mirrorActor
  });
  const reader=domain=>async rec=>({
   artifact_id:rec.artifact_id,object_ref:rec.object_ref,
   object_version_id:rec.object_version_id,generation:rec.generation,
   sha256:rec.sha256,
   bytes:Buffer.from(p6.artifactBytes.get(rec.artifact_id)),
   observed_at_ms:Date.now(),is_current:true,
   lock_mode:'FIXTURE_IMMUTABLE',source_domain:domain
  });
  const sourceResult=await issueFixtureExt001FromTwoSources({
   envelope:p6.envelope,trustedKeys,sourceKeys,sourceProof,
   primaryReader:reader('FIXTURE_PRIMARY_STORE'),
   auditReader:reader('FIXTURE_AUDIT_MIRROR'),
   nowMs:now,clock:()=>Date.now(),receiptId:p6.receiptId,attester,
   sourceKeyVersion:1,
   sourceAuthSigner:async payload=>createHmac('sha256',sourceAuthKey).update(payload).digest('hex')
  });
  assert.equal(sourceResult.verdict,'ATTESTED_SOURCE_PROVENANCE_STILL_HOLD');
  assert.equal(sourceResult.source_version_bound_in_fixture,true);
  assert.match(sourceResult.source_binding_digest,/^[a-f0-9]{64}$/);
  assert.equal(sourceResult.hold_active,true);
  const stored=await audit.query(
   'SELECT source_binding_digest FROM v121_anchor.fixture_iam_source_bindings WHERE organization_id=$1 AND revision_no=6',[a]);
  assert.equal(stored.rows.length,1);
  assert.equal(stored.rows[0].source_binding_digest.trim(),sourceResult.source_binding_digest);
  const sourceSql='SELECT v121_anchor.fixture_attest_iam_source_provenance($1::uuid,$2::integer,$3::uuid,$4::uuid,$5::char(64),$6::char(64),$7::char(64),$8::uuid,$9::uuid,$10::char(64),$11::char(64),$12::timestamptz,$13::char(64),$14::integer,$15::char(64)) AS verdict';
  const forged='f'.repeat(64);
  await assert.rejects(attester.query(sourceSql,[...provenanceParams(6,p6),forged,1,'0'.repeat(64)]),
   /V121_IAM_SOURCE_AUTH_DENIED/);
  await assert.rejects(attester.query(sourceSql,[...provenanceParams(6,p6),sourceResult.source_binding_digest,2,'0'.repeat(64)]),
   /V121_IAM_SOURCE_AUTH_DENIED/);
  const forgedMaterial=encodeFixtureExt001SourceAuthorization(
   {...p6.fingerprint,receipt_id:p6.receiptId},forged,1);
  const forgedMac=createHmac('sha256',sourceAuthKey).update(forgedMaterial).digest('hex');
  await assert.rejects(attester.query(sourceSql,[...provenanceParams(6,p6),forged,1,forgedMac]),
   /V121_IAM_SOURCE_BINDING_CONFLICT/);
  await assert.rejects(attester.query('SELECT auth_key FROM v121_anchor.fixture_iam_source_auth_keys'),
   /permission denied/);
  await assert.rejects(attester.query('UPDATE v121_anchor.fixture_iam_source_auth_keys SET active=false'),
   /permission denied/);
  // Retiring the active key invalidates a valid pre-revocation MAC,
  // including a byte-exact retry of an immutable source-binding row.
  const oldMaterial=encodeFixtureExt001SourceAuthorization(
   {...p6.fingerprint,receipt_id:p6.receiptId},sourceResult.source_binding_digest,1);
  const oldMac=createHmac('sha256',sourceAuthKey).update(oldMaterial).digest('hex');
  await audit.query('UPDATE v121_anchor.fixture_iam_source_auth_keys SET active=false WHERE organization_id=$1 AND key_version=1',[a]);
  await assert.rejects(attester.query(sourceSql,[...provenanceParams(6,p6),sourceResult.source_binding_digest,1,oldMac]),
   /V121_IAM_SOURCE_AUTH_DENIED/);
  await assert.rejects(audit.query('UPDATE v121_anchor.fixture_iam_source_auth_keys SET active=true WHERE organization_id=$1 AND key_version=1',[a]),
   /V121_IAM_SOURCE_KEY_IMMUTABLE/);
  await assert.rejects(audit.query('UPDATE v121_anchor.fixture_iam_source_auth_keys SET auth_key=$1 WHERE organization_id=$2 AND key_version=1',[randomBytes(32),a]),
   /V121_IAM_SOURCE_KEY_IMMUTABLE/);
  const nextSourceKey=randomBytes(32);
  await audit.query('INSERT INTO v121_anchor.fixture_iam_source_auth_keys(organization_id,key_version,auth_key,active) VALUES($1,2,$2,true)',[a,nextSourceKey]);
  await assert.rejects(audit.query('INSERT INTO v121_anchor.fixture_iam_source_auth_keys(organization_id,key_version,auth_key,active) VALUES($1,3,$2,true)',[a,randomBytes(32)]),
   /duplicate key/);
  const rotatedMaterial=encodeFixtureExt001SourceAuthorization(
   {...p6.fingerprint,receipt_id:p6.receiptId},sourceResult.source_binding_digest,2);
  const rotatedMac=createHmac('sha256',nextSourceKey).update(rotatedMaterial).digest('hex');
  assert.equal((await attester.query(sourceSql,[...provenanceParams(6,p6),sourceResult.source_binding_digest,2,rotatedMac])).rows[0].verdict,
   'EXACT_SOURCE_PROVENANCE_RETRY_STILL_HOLD');
  await assert.rejects(attester.query(sourceSql,[...provenanceParams(6,p6),sourceResult.source_binding_digest,1,rotatedMac]),
   /V121_IAM_SOURCE_AUTH_DENIED/);
  // The same signer and envelope cannot be replayed as a different tenant.
  // Scope rejection occurs even when the submitted digest/MAC are valid for A.
  const crossTenant=provenanceParams(6,p6);
  crossTenant[0]=b;
  await assert.rejects(attester.query(sourceSql,[...crossTenant,sourceResult.source_binding_digest,2,rotatedMac]),
   /V121_IAM_SOURCE_ATTESTER_ROLE_DENIED/);
  assert.equal((await audit.query('SELECT count(*)::int AS n FROM v121_anchor.fixture_iam_provenance_proofs WHERE organization_id=$1',[b])).rows[0].n,0);

  // PostgreSQL READ COMMITTED must block a verifier on the retiring key row.
  // The retiring transaction wins; after commit, authentication sees inactive.
  const retiring=await audit.connect();
  let retired=false;
  let blockedResult;
  try{
   await retiring.query('BEGIN');
   await retiring.query('UPDATE v121_anchor.fixture_iam_source_auth_keys SET active=false WHERE organization_id=$1 AND key_version=2',[a]);
   blockedResult=attester.query(sourceSql,[...provenanceParams(6,p6),sourceResult.source_binding_digest,2,rotatedMac])
    .then(value=>({value}),error=>({error}));
   let lockObserved=false;
   for(let attempt=0;attempt<60;attempt++){
    const blocked=(await audit.query(
     "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND usename='v121_iam_provenance_attester' AND wait_event_type='Lock' AND query LIKE $1",
     ['%fixture_attest_iam_source_provenance%'])).rows[0].n;
    if(blocked>0){lockObserved=true;break;}
    await audit.query('SELECT pg_sleep(0.01)');
   }
   assert.equal(lockObserved,true,'SQL verifier must wait on concurrent key retirement');
   await retiring.query('COMMIT');
   retired=true;
  }finally{
   if(!retired) await retiring.query('ROLLBACK').catch(()=>{});
   retiring.release();
  }
  const raced=await blockedResult;
  assert.ok(raced.error,'retirement-first source authentication must be rejected');
  assert.match(raced.error.message,/V121_IAM_SOURCE_AUTH_DENIED/);
  assert.equal((await audit.query('SELECT count(*)::int AS n FROM v121_anchor.fixture_iam_source_bindings WHERE organization_id=$1',[a])).rows[0].n,1);

  // A newer key can be admitted, but an earlier MAC is not revived.
  const thirdKey=randomBytes(32);
  await audit.query('INSERT INTO v121_anchor.fixture_iam_source_auth_keys(organization_id,key_version,auth_key,active) VALUES($1,3,$2,true)',[a,thirdKey]);
  const thirdMaterial=encodeFixtureExt001SourceAuthorization(
   {...p6.fingerprint,receipt_id:p6.receiptId},sourceResult.source_binding_digest,3);
  const thirdMac=createHmac('sha256',thirdKey).update(thirdMaterial).digest('hex');
  assert.equal((await attester.query(sourceSql,[...provenanceParams(6,p6),sourceResult.source_binding_digest,3,thirdMac])).rows[0].verdict,
   'EXACT_SOURCE_PROVENANCE_RETRY_STILL_HOLD');
  await assert.rejects(attester.query(sourceSql,[...provenanceParams(6,p6),sourceResult.source_binding_digest,2,rotatedMac]),
   /V121_IAM_SOURCE_AUTH_DENIED/);
  assert.equal((await audit.query('SELECT count(*)::int AS n FROM v121_anchor.fixture_iam_source_bindings WHERE organization_id=$1',[a])).rows[0].n,1);
  await assert.rejects(writerA.query(sourceSql,[...provenanceParams(6,p6),sourceResult.source_binding_digest,1,forgedMac]),
   /permission denied/);
  await assert.rejects(writerA.query('SELECT * FROM v121_anchor.fixture_iam_source_bindings'),
   /permission denied/);
  await assert.rejects(audit.query('UPDATE v121_anchor.fixture_iam_source_bindings SET source_binding_digest=$1 WHERE revision_no=6',['0'.repeat(64)]),
   /V121_ANCHOR_LEDGER_IMMUTABLE/);
  await assert.rejects(audit.query('DELETE FROM v121_anchor.fixture_iam_source_bindings WHERE revision_no=6'),
   /V121_ANCHOR_LEDGER_IMMUTABLE/);
  assert.equal((await writerA.query(receiptSql,params(6,p6))).rows[0].verdict,
   'REGISTERED_SYNTHETIC_STILL_HOLD');
  await assert.rejects(audit.query('UPDATE v121_anchor.fixture_iam_evidence_receipts SET envelope_digest=$1 WHERE organization_id=$2 AND revision_no=1',['a'.repeat(64),a]),
   /V121_ANCHOR_LEDGER_IMMUTABLE/);
  await assert.rejects(audit.query('DELETE FROM v121_anchor.fixture_iam_evidence_revocations WHERE organization_id=$1 AND revision_no=2',[a]),
   /V121_ANCHOR_LEDGER_IMMUTABLE/);
  const count=(await audit.query('SELECT count(*)::int AS n FROM v121_anchor.fixture_iam_evidence_receipts WHERE organization_id=$1',[a])).rows[0].n;
  const revoked=(await audit.query('SELECT count(*)::int AS n FROM v121_anchor.fixture_iam_evidence_revocations WHERE organization_id=$1',[a])).rows[0].n;
  const provenance=(await audit.query('SELECT count(*)::int AS n FROM v121_anchor.fixture_iam_provenance_proofs WHERE organization_id=$1',[a])).rows[0].n;
  assert.deepEqual([count,revoked,provenance],[6,1,6]);
  const holds=(await admin.query('SELECT module_name,hold_active,release_eligible FROM v106_test.fixture_cross_module_holds WHERE organization_id=$1 AND incident_id=$2 ORDER BY module_name',[a,incident])).rows;
  assert.deepEqual(holds.map(x=>[x.module_name,x.hold_active,x.release_eligible]),
   [['ACADEMIC',true,false],['FINANCE',true,false],['SALES',true,false]]);
  assert.equal((await admin.query('SELECT issuance_blocked FROM v106_test.fixture_recovery_emergency_stops WHERE organization_id=$1 AND incident_id=$2',[a,incident])).rows[0].issuance_blocked,true);
 }finally{
  await Promise.allSettled([writerA.end(),writerB.end(),readOnly.end(),revoker.end(),attester.end()]);
  await audit.end();
 }
});
