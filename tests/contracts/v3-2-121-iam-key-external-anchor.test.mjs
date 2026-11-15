import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync} from 'node:crypto';
import {
 rebuildFixtureIamKeyEvents,signFixtureIamKeyExternalAnchor,
 verifyFixtureIamKeyExternalAnchor,fingerprintFixtureIamKeyAnchor
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
