import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createIsolatedRecoveryReconfirmation} from '../../src/cross-module-recovery-reconfirmation.mjs';
const org='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
const incident='33333333-3333-4333-8333-333333333333';
const domains=['market_sales','finance','academic'];
const make=()=>({organization_id:org,incident_id:incident,generation:1,
 sources:domains.map(domain=>({domain,source_epoch:1,source_revision:1,
  revocation_sequence:0,revocation_digest:'a'.repeat(64),
  evidence_digest:'b'.repeat(64),hold_active:true,availability:'online'}))});
const digest=s=>{
 const sources=s.sources.map(({domain,source_epoch,source_revision,revocation_sequence,
  revocation_digest,evidence_digest})=>({domain,source_epoch,source_revision,
  revocation_sequence,revocation_digest,evidence_digest}));
 sources.sort((a,b)=>domains.indexOf(a.domain)-domains.indexOf(b.domain));
 return createHash('sha256').update(JSON.stringify({generation:s.generation,sources})).digest('hex');
};
function setup(){
 let snapshot=make();const roles=new Map([['staffSales',{role:'sales_evidence_check',active:true}],
 ['staffAudit',{role:'independent_safety_check',active:true}]]);
 const registry=createIsolatedRecoveryReconfirmation({
  getFixtureSnapshot:()=>snapshot,
  getFixtureReviewer:(_,id)=>roles.has(id)?{reviewer_id:id,...roles.get(id),fixture_only:true}:null});
 const request=(stage,reviewer_id,idempotency_key,source_digest=digest(snapshot))=>({
  organization_id:org,incident_id:incident,stage,reviewer_id,source_digest,idempotency_key});
 const check=()=>registry.check({organization_id:org,incident_id:incident,source_digest:digest(snapshot)});
 return {registry,request,check,get snapshot(){return snapshot;},setSnapshot:x=>{snapshot=x;},roles};
}
function blocked(x,reason){
 if(reason)assert.equal(x.reason_code,reason);
 for(const k of ['finance_authorized','academic_authorized','handoff_allowed',
  'compensation_write_allowed','release_eligible'])assert.equal(x[k],false,k);
 assert.equal(x.hold_active,true);assert.equal(Object.isFrozen(x),true);
}
test('V3.2-75 independent two-person review remains a non-authorizing fixture',()=>{
 const f=setup();blocked(f.check(),'INDEPENDENT_RECONFIRMATION_INCOMPLETE');
 const sales=f.registry.reconfirm(f.request('sales_evidence_check','staffSales','recovery-sales-key-0001'));
 assert.strictEqual(f.registry.reconfirm(f.request('sales_evidence_check','staffSales','recovery-sales-key-0001')),sales);
 blocked(f.check(),'INDEPENDENT_RECONFIRMATION_INCOMPLETE');
 assert.throws(()=>f.registry.reconfirm(f.request('sales_evidence_check','staffSales','recovery-sales-key-0002')),{code:'REVIEW_STAGE_ALREADY_RECORDED'});
 const safety=f.registry.reconfirm(f.request('independent_safety_check','staffAudit','recovery-audit-key-0001'));
 assert.equal(safety.sequence,2);
 const result=f.check();blocked(result,'BLOCKED_REAL_EXTERNAL_REVIEW_AND_HANDOFF_MISSING');
 assert.equal(result.fixture_reconfirmation_complete,true);
 assert.equal(f.registry.audit({organization_id:org,incident_id:incident}).length,2);
});
test('V3.2-75 rejects self approval, wrong order, revoked reviewer and nonce conflicts',()=>{
 const f=setup();
 assert.throws(()=>f.registry.reconfirm(f.request('independent_safety_check','staffAudit','recovery-audit-key-0001')),{code:'SALES_EVIDENCE_CHECK_REQUIRED'});
 assert.throws(()=>f.registry.reconfirm(f.request('sales_evidence_check','staffAudit','recovery-sales-key-0001')),{code:'INDEPENDENT_REVIEWER_NOT_VERIFIED'});
 f.registry.reconfirm(f.request('sales_evidence_check','staffSales','recovery-sales-key-0001'));
 assert.throws(()=>f.registry.reconfirm(f.request('independent_safety_check','staffSales','recovery-audit-key-0001')),{code:'INDEPENDENT_REVIEWER_NOT_VERIFIED'});
 assert.throws(()=>f.registry.reconfirm(f.request('independent_safety_check','staffAudit','recovery-sales-key-0001')),{code:'RECONFIRMATION_NONCE_CONFLICT'});
 f.registry.reconfirm(f.request('independent_safety_check','staffAudit','recovery-audit-key-0001'));
 f.roles.get('staffAudit').active=false;
 blocked(f.check(),'REVIEWER_REVOKED_OR_UNAVAILABLE');
});
test('V3.2-75 stale epoch, revocation or missing domain invalidates old review',()=>{
 const f=setup();const old=digest(f.snapshot);
 f.registry.reconfirm(f.request('sales_evidence_check','staffSales','recovery-sales-key-0001'));
 f.registry.reconfirm(f.request('independent_safety_check','staffAudit','recovery-audit-key-0001'));
 f.snapshot.sources[1].revocation_sequence=1;
 blocked(f.registry.check({organization_id:org,incident_id:incident,source_digest:old}),
  'EVIDENCE_CHANGED_RECONFIRMATION_REQUIRED');
 blocked(f.check(),'INDEPENDENT_RECONFIRMATION_INCOMPLETE');
 assert.throws(()=>f.registry.reconfirm(f.request('sales_evidence_check','staffSales','recovery-second-key-0001',old)),{code:'EVIDENCE_RECONFIRMATION_STALE'});
 f.snapshot.sources[1].availability='offline';
 blocked(f.check(),'FIXTURE_SOURCE_UNAVAILABLE_OR_INVALID');
 f.snapshot.sources[1].availability='online';f.snapshot.sources.pop();
 blocked(f.check(),'FIXTURE_SOURCE_UNAVAILABLE_OR_INVALID');
});
test('V3.2-75 cross-tenant, forged claims and response replay never unlock handoff',()=>{
 const f=setup();const req=f.request('sales_evidence_check','staffSales','recovery-sales-key-0001');
 assert.throws(()=>f.registry.reconfirm({...req,organization_id:other}),{code:'FIXTURE_SOURCE_INVALID_OR_OFFLINE'});
 assert.throws(()=>f.registry.reconfirm({...req,finance_authorized:true}),{code:'INVALID_RECONFIRMATION_REQUEST'});
 assert.throws(()=>f.registry.reconfirm({...req,source_digest:'f'.repeat(64)}),{code:'EVIDENCE_RECONFIRMATION_STALE'});
 const first=f.registry.reconfirm(req);assert.equal(first.handoff_allowed,false);
 blocked(f.registry.check({organization_id:other,incident_id:incident,source_digest:digest(f.snapshot)}),
  'FIXTURE_SOURCE_UNAVAILABLE_OR_INVALID');
});
