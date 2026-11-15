import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync} from 'node:crypto';
import {
 rebuildFixtureIamKeyEvents,signFixtureIamKeyExternalAnchor,
 verifyFixtureIamKeyExternalAnchor,fingerprintFixtureIamKeyAnchor,
 inspectFixtureArchivedIamKeyAnchor,appendFixtureIamKeyCheckpoint
} from '../helpers/v3-2-121-fixture-iam-key-external-anchor.mjs';

const org='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
const signer='00000000-0000-4000-8000-0000000000d7';
const signing=generateKeyPairSync('ed25519');
const sha=x=>createHash('sha256').update(x).digest('hex');
const ZERO='0'.repeat(64);
const fail=(f,code)=>assert.throws(f,{code});
function history(){
 const kinds=[
  [1,'ACTIVATED'],[1,'REVOKED'],
  [2,'ACTIVATED'],[2,'REVOKED'],
  [3,'ACTIVATED'],[3,'REVOKED']
 ];
 const entries=[];let previous=ZERO;
 for(const [i,[version,type]] of kinds.entries()){
  const at=new Date(1700000000000+i*1000);
  const key_digest=sha('fixture-key-'+version);
  const digest=sha([
   'v121-ext001-source-key-event-v1',org,i+1,version,type,
   key_digest,previous,at.getTime()
  ].join('|'));
  entries.push({
   organization_id:org,event_index:i+1,key_version:version,event_type:type,
   key_digest,previous_event_digest:previous,event_digest:digest,recorded_at:at
  });
  previous=digest;
 }
 return entries;
}
function full(rows=history(),previousAnchor=null,issuedAtMs=1700000020000){
 const anchor=signFixtureIamKeyExternalAnchor({
  rows,organizationId:org,signerId:signer,privateKey:signing.privateKey,
  issuedAtMs,previousAnchor
 });
 const args={rows,organizationId:org,anchor,
  publicKeys:new Map([[signer,signing.publicKey]]),
  keyStates:new Map([[signer,'ACTIVE']]),
  nowMs:issuedAtMs+100,minimumEventCount:1,previousAnchor};
 return {anchor,args};
}
test('independent signed checkpoint verifies six source-key events and remains HOLD',()=>{
 const {anchor,args}=full();
 const result=verifyFixtureIamKeyExternalAnchor(args);
 assert.equal(result.verdict,'EXTERNAL_FIXTURE_KEY_AUDIT_MATCH_STILL_HOLD');
 assert.equal(result.event_count,6);
 assert.equal(result.checkpoint_digest,fingerprintFixtureIamKeyAnchor(anchor));
 assert.equal(result.hold_active,true);
 assert.equal(result.release_eligible,false);
 assert.equal(result.release_authorized,false);
});

function serviceFixture(){
 let head=null;
 const archived=[];
 const states=new Map([[signer,'ACTIVE']]);
 const publicKeys=new Map([[signer,signing.publicKey]]);
 const calls={sign:0,write:0};
 const store={
  read:async()=>structuredClone(head),
  compareAndAppend:async({expectedCheckpointDigest,checkpoint})=>{
   calls.write++;
   const actual=head?fingerprintFixtureIamKeyAnchor(head.anchor):ZERO;
   if(expectedCheckpointDigest!==actual)return false;
   head=structuredClone(checkpoint);archived.push(structuredClone(checkpoint));
   return true;
  }
 };
 const args={rows:history().slice(0,4),organizationId:org,signerId:signer,
  expectedCheckpointDigest:ZERO,store,clock:()=>1700000020000,
  readTrust:async()=>({publicKeys,keyStates:states}),
  signCheckpoint:async input=>{
   calls.sign++;
   return signFixtureIamKeyExternalAnchor({...input,privateKey:signing.privateKey});
  }
 };
 return {args,store,states,publicKeys,calls,archived,get head(){return head;}};
}

test('revoked expired checkpoints retain forensic signature/content inspection without authority',()=>{
 const first=full(history().slice(0,4)).anchor;
 const {args}=full(history(),first,1700000021000);
 args.keyStates.set(signer,'REVOKED');
 const result=inspectFixtureArchivedIamKeyAnchor({...args,nowMs:1700001000000});
 assert.equal(result.verdict,'HISTORICAL_FIXTURE_KEY_AUDIT_ONLY');
 for(const field of ['release_eligible','release_authorized','current_authority',
  'pre_revocation_issuance_proven','production_evidence_collected'])
  assert.equal(result[field],false);
 assert.equal(result.hold_active,true);
 fail(()=>verifyFixtureIamKeyExternalAnchor(args),'V121_KEY_ANCHOR_SIGNER_UNTRUSTED');
 fail(()=>inspectFixtureArchivedIamKeyAnchor({...args,publicKeys:new Map()}),
  'V121_KEY_ANCHOR_SIGNER_UNTRUSTED');
 fail(()=>inspectFixtureArchivedIamKeyAnchor({...args,keyStates:new Map()}),
  'V121_KEY_ANCHOR_SIGNER_UNTRUSTED');
 const forged=structuredClone(args.anchor);
 forged.statement.head_event_digest='a'.repeat(64);
 fail(()=>inspectFixtureArchivedIamKeyAnchor({...args,anchor:forged}),
  'V121_KEY_ANCHOR_SIGNATURE_INVALID');
 fail(()=>inspectFixtureArchivedIamKeyAnchor({...args,rows:history().slice(0,4)}),
  'V121_KEY_ANCHOR_CONTENT_MISMATCH');
 fail(()=>inspectFixtureArchivedIamKeyAnchor({...args,organizationId:other}),
  'V121_KEY_ANCHOR_SCOPE_INVALID');
 fail(()=>inspectFixtureArchivedIamKeyAnchor({...args,minimumEventCount:7}),
  'V121_KEY_ANCHOR_ROLLBACK');
});

test('persisted compare-and-append advances 4 to 6 events; stale caller pin cannot write',async()=>{
 const f=serviceFixture();
 const first=await appendFixtureIamKeyCheckpoint(f.args);
 assert.equal(first.event_count,4);
 assert.equal(first.hold_active,true);
 assert.equal(first.release_eligible,false);
 const next=await appendFixtureIamKeyCheckpoint({...f.args,rows:history(),
  expectedCheckpointDigest:first.checkpoint_digest});
 assert.equal(next.event_count,6);
 assert.equal(f.archived.length,2);
 await assert.rejects(appendFixtureIamKeyCheckpoint(f.args),
  {code:'V121_KEY_ANCHOR_HEAD_CONFLICT'});
 assert.equal(f.calls.write,2);
});

test('read failure, lost checkpoint and malformed storage fail before signing',async()=>{
 for(const read of [async()=>{throw Error('offline');},async()=>undefined,
  async()=>({anchor:null})]){
  const f=serviceFixture();f.store.read=read;
  await assert.rejects(appendFixtureIamKeyCheckpoint(f.args),
   error=>['V121_KEY_ANCHOR_STORE_UNAVAILABLE','V121_KEY_ANCHOR_STORE_INVALID'].includes(error.code));
  assert.equal(f.calls.sign,0);assert.equal(f.calls.write,0);
 }
 const f=serviceFixture();
 await assert.rejects(appendFixtureIamKeyCheckpoint({...f.args,
  expectedCheckpointDigest:'f'.repeat(64)}),{code:'V121_KEY_ANCHOR_HEAD_CONFLICT'});
 assert.equal(f.calls.sign,0);
});

test('signer rejection and hung signer time out without writing a checkpoint',async()=>{
 for(const signCheckpoint of [async()=>{throw Error('offline');},()=>new Promise(()=>{})]){
  const f=serviceFixture();
  await assert.rejects(appendFixtureIamKeyCheckpoint({...f.args,signCheckpoint,timeoutMs:10}),
   {code:'V121_KEY_ANCHOR_SIGNER_UNAVAILABLE'});
  assert.equal(f.calls.write,0);assert.equal(f.head,null);
 }
});

test('trust outage and revocation during signing block persistence',async()=>{
 const unavailable=serviceFixture();
 await assert.rejects(appendFixtureIamKeyCheckpoint({...unavailable.args,
  readTrust:async()=>{throw Error('registry offline');}}),
 {code:'V121_KEY_ANCHOR_TRUST_UNAVAILABLE'});
 assert.equal(unavailable.calls.sign,0);
 const f=serviceFixture();
 await assert.rejects(appendFixtureIamKeyCheckpoint({...f.args,signCheckpoint:async input=>{
  const signed=await f.args.signCheckpoint(input);f.states.set(signer,'REVOKED');return signed;
 }}),{code:'V121_KEY_ANCHOR_SIGNER_UNTRUSTED'});
 assert.equal(f.calls.write,0);
});

test('write failures, CAS conflict and acknowledgement loss cannot return success',async()=>{
 for(const mode of ['reject','conflict','write-then-reject','hang']){
  const f=serviceFixture(),append=f.store.compareAndAppend;
  f.store.compareAndAppend=async input=>{
   if(mode==='conflict')return false;
   if(mode==='write-then-reject')await append(input);
   if(mode==='hang')return new Promise(()=>{});
   throw Error('write failed or acknowledgement lost');
  };
  await assert.rejects(appendFixtureIamKeyCheckpoint({...f.args,timeoutMs:10}),
   {code:mode==='conflict'?'V121_KEY_ANCHOR_HEAD_CONFLICT':
    'V121_KEY_ANCHOR_STORE_WRITE_UNCONFIRMED'});
  assert.equal(f.archived.length,mode==='write-then-reject'?1:0);
 }
});

test('missing or unavailable readback never turns acknowledged write into success',async()=>{
 for(const mode of ['missing','unavailable','wrong-prefix']){
  const f=serviceFixture(),read=f.store.read;
  let reads=0;
  f.store.read=async()=>{
   if(++reads===1)return read();
   if(mode==='unavailable')throw Error('offline after write');
   if(mode==='wrong-prefix')return {anchor:f.head.anchor,previousAnchor:f.head.anchor};
   return null;
  };
  await assert.rejects(appendFixtureIamKeyCheckpoint(f.args),
   {code:mode==='unavailable'?'V121_KEY_ANCHOR_STORE_UNAVAILABLE':
    'V121_KEY_ANCHOR_STORE_READBACK_MISMATCH'});
  assert.equal(f.archived.length,1);
 }
});

test('post-write signer revocation preserves forensic checkpoint and rejects current operation',async()=>{
 const f=serviceFixture(),append=f.store.compareAndAppend;
 f.store.compareAndAppend=async input=>{
  const written=await append(input);f.states.set(signer,'REVOKED');return written;
 };
 await assert.rejects(appendFixtureIamKeyCheckpoint(f.args),
  {code:'V121_KEY_ANCHOR_SIGNER_UNTRUSTED'});
 assert.equal(f.archived.length,1);
 const result=inspectFixtureArchivedIamKeyAnchor({rows:f.args.rows,
  ...f.head,organizationId:org,publicKeys:f.publicKeys,keyStates:f.states});
 assert.equal(result.verdict,'HISTORICAL_FIXTURE_KEY_AUDIT_ONLY');
});

test('new active signer may extend revoked historical signer; revoked signer cannot append',async()=>{
 const f=serviceFixture();
 const first=await appendFixtureIamKeyCheckpoint(f.args);
 f.states.set(signer,'REVOKED');
 const newSigner='00000000-0000-4000-8000-0000000000d8';
 const keys=generateKeyPairSync('ed25519');
 f.publicKeys.set(newSigner,keys.publicKey);f.states.set(newSigner,'ACTIVE');
 const next={...f.args,rows:history(),expectedCheckpointDigest:first.checkpoint_digest};
 await assert.rejects(appendFixtureIamKeyCheckpoint(next),
  {code:'V121_KEY_ANCHOR_SIGNER_UNTRUSTED'});
 const result=await appendFixtureIamKeyCheckpoint({...next,signerId:newSigner,
  signCheckpoint:async input=>signFixtureIamKeyExternalAnchor({...input,privateKey:keys.privateKey})});
 assert.equal(result.event_count,6);assert.equal(result.release_authorized,false);
});

test('concurrent writers share an atomic head check; only one append succeeds',async()=>{
 const f=serviceFixture();
 const results=await Promise.allSettled([
  appendFixtureIamKeyCheckpoint(f.args),appendFixtureIamKeyCheckpoint(f.args)
 ]);
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
 const rejected=results.find(x=>x.status==='rejected');
 assert.equal(rejected.reason.code,'V121_KEY_ANCHOR_HEAD_CONFLICT');
 assert.equal(f.archived.length,1);
});

test('hung storage and trust registry are bounded; expiry during persistence fails closed',async()=>{
 for(const dependency of ['read','trust']){
  const f=serviceFixture();
  const never=()=>new Promise(()=>{});
  if(dependency==='read')f.store.read=never;
  const args={...f.args,timeoutMs:10};
  if(dependency==='trust')args.readTrust=never;
  await assert.rejects(appendFixtureIamKeyCheckpoint(args),
   {code:dependency==='read'?'V121_KEY_ANCHOR_STORE_UNAVAILABLE':
    'V121_KEY_ANCHOR_TRUST_UNAVAILABLE'});
  assert.equal(f.calls.sign,0);assert.equal(f.calls.write,0);
 }
 const f=serviceFixture(),append=f.store.compareAndAppend;
 let now=f.args.clock();
 f.store.compareAndAppend=async input=>{
  const written=await append(input);now+=60_000;return written;
 };
 await assert.rejects(appendFixtureIamKeyCheckpoint({...f.args,clock:()=>now}),
  {code:'V121_KEY_ANCHOR_EXPIRED'});
 assert.equal(f.archived.length,1);
});

test('bad signer output is rejected before write and changed readback is rejected after write',async()=>{
 const f=serviceFixture();
 await assert.rejects(appendFixtureIamKeyCheckpoint({...f.args,
  signCheckpoint:async input=>{
   const anchor=structuredClone(await f.args.signCheckpoint(input));
   anchor.statement.head_event_digest='f'.repeat(64);return anchor;
  }}),{code:'V121_KEY_ANCHOR_SIGNATURE_INVALID'});
 assert.equal(f.calls.write,0);
 const g=serviceFixture(),read=g.store.read;
 let reads=0;
 g.store.read=async()=>{
  const value=await read();
  if(++reads===2)value.anchor.statement.head_event_digest='f'.repeat(64);
  return value;
 };
 await assert.rejects(appendFixtureIamKeyCheckpoint(g.args),
  {code:'V121_KEY_ANCHOR_STORE_READBACK_MISMATCH'});
 assert.equal(g.archived.length,1);
});
test('database owner can rehash a local event chain but cannot match pinned external signature',()=>{
 const {args}=full();
 const corrupted=structuredClone(args.rows);
 corrupted[0].recorded_at=new Date(corrupted[0].recorded_at.getTime()+100);
 let previous=ZERO;
 for(const row of corrupted){
  row.previous_event_digest=previous;
  row.event_digest=sha([
   'v121-ext001-source-key-event-v1',org,row.event_index,row.key_version,
   row.event_type,row.key_digest,previous,row.recorded_at.getTime()
  ].join('|'));
  previous=row.event_digest;
 }
 assert.equal(rebuildFixtureIamKeyEvents(corrupted,org).event_count,6);
 fail(()=>verifyFixtureIamKeyExternalAnchor({...args,rows:corrupted}),
  'V121_KEY_ANCHOR_CONTENT_MISMATCH');
});
test('stale, truncated, foreign tenant and unanchored suffix cannot be accepted',()=>{
 const {args}=full();
 fail(()=>verifyFixtureIamKeyExternalAnchor({...args,rows:args.rows.slice(0,4)}),
  'V121_KEY_ANCHOR_CONTENT_MISMATCH');
 fail(()=>verifyFixtureIamKeyExternalAnchor({...args,minimumEventCount:7}),
  'V121_KEY_ANCHOR_ROLLBACK');
 fail(()=>verifyFixtureIamKeyExternalAnchor({...args,organizationId:other}),
  'V121_KEY_ANCHOR_SCOPE_INVALID');
 const later=structuredClone(args.rows);
 const prev=later.at(-1).event_digest;
 const key_digest=sha('fixture-key-4');
 const timestamp=new Date(1700000007000);
 later.push({organization_id:org,event_index:7,key_version:4,event_type:'ACTIVATED',
  key_digest,previous_event_digest:prev,recorded_at:timestamp,
  event_digest:sha(['v121-ext001-source-key-event-v1',org,7,4,
   'ACTIVATED',key_digest,prev,timestamp.getTime()].join('|'))});
 fail(()=>verifyFixtureIamKeyExternalAnchor({...args,rows:later}),
  'V121_KEY_ANCHOR_CONTENT_MISMATCH');
});
test('signature, signer state, expiry and previous checkpoint cannot be bypassed',()=>{
 const {args}=full();
 const forged=structuredClone(args.anchor);
 forged.statement.head_event_digest='f'.repeat(64);
 fail(()=>verifyFixtureIamKeyExternalAnchor({...args,anchor:forged}),
  'V121_KEY_ANCHOR_SIGNATURE_INVALID');
 fail(()=>verifyFixtureIamKeyExternalAnchor({...args,
  keyStates:new Map([[signer,'REVOKED']])}),
 'V121_KEY_ANCHOR_SIGNER_UNTRUSTED');
 fail(()=>verifyFixtureIamKeyExternalAnchor({...args,nowMs:1700000080000}),
  'V121_KEY_ANCHOR_EXPIRED');
 const prefix=args.rows.slice(0,4);
 const first=full(prefix).anchor;
 const second=full(args.rows,first,1700000021000);
 assert.equal(verifyFixtureIamKeyExternalAnchor(second.args).event_count,6);
 fail(()=>verifyFixtureIamKeyExternalAnchor({...second.args,previousAnchor:null}),
  'V121_KEY_ANCHOR_PREVIOUS_MISMATCH');
 fail(()=>signFixtureIamKeyExternalAnchor({
  rows:prefix,organizationId:org,signerId:signer,
  privateKey:signing.privateKey,issuedAtMs:1700000021000,
  previousAnchor:second.anchor
 }), 'V121_KEY_ANCHOR_ROLLBACK');
});
test('lifecycle validates active version and blocks tampered sequence even before signing',()=>{
 const rows=history();
 rows[3].event_type='ACTIVATED';
 fail(()=>rebuildFixtureIamKeyEvents(rows,org),
  'V121_KEY_ANCHOR_LIFECYCLE_INVALID');
 const otherRows=history();
 otherRows[2].organization_id=other;
 fail(()=>rebuildFixtureIamKeyEvents(otherRows,org),
  'V121_KEY_ANCHOR_HISTORY_INVALID');
});

test('a replacement hash chain cannot extend a previously pinned checkpoint',()=>{
 const valid=history();
 const first=full(valid.slice(0,4)).anchor;
 const rewritten=structuredClone(valid);
 rewritten[0].recorded_at=new Date(rewritten[0].recorded_at.getTime()+50);
 let previous=ZERO;
 for(const e of rewritten){
  e.previous_event_digest=previous;
  e.event_digest=sha([
   'v121-ext001-source-key-event-v1',org,e.event_index,e.key_version,
   e.event_type,e.key_digest,previous,e.recorded_at.getTime()
  ].join('|'));
  previous=e.event_digest;
 }
 assert.equal(rebuildFixtureIamKeyEvents(rewritten,org).event_count,6);
 fail(()=>signFixtureIamKeyExternalAnchor({
  rows:rewritten,organizationId:org,signerId:signer,
  privateKey:signing.privateKey,issuedAtMs:1700000021000,previousAnchor:first
 }),'V121_KEY_ANCHOR_PREVIOUS_MISMATCH');
 const validNext=full(valid,first,1700000021000);
 fail(()=>verifyFixtureIamKeyExternalAnchor({
  ...validNext.args,rows:rewritten
 }),'V121_KEY_ANCHOR_PREVIOUS_MISMATCH');
});

