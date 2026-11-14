import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import pg from 'pg';

const key=()=>randomBytes(20).toString('hex');
const pool=name=>new pg.Pool({connectionString:process.env[name],max:3});
const result=async(p,sql,args)=>(await p.query(sql,args)).rows[0].result;
const denied=(p,sql,args,code)=>assert.rejects(p.query(sql,args),
 e=>e.code===code,'Expected '+code+' for '+sql);
const request='SELECT ms.propose_fixture_source_readiness($1,$2,$3,$4,$5,$6) AS result';
const append='SELECT ms.record_fixture_uat_evidence($1,$2,$3,$4,$5,$6,$7) AS result';
const freeze='SELECT ms.freeze_fixture_uat_source($1,$2,$3,$4) AS result';
const state='SELECT ms.readonly_fixture_uat_freeze_state($1) AS result';
const guarded='SELECT ms.readonly_fixture_uat_diff_guarded($1,$2,$3,$4) AS result';
const diff='SELECT ms.readonly_fixture_uat_diff($1,$2,$3) AS result';
const makeSource=(client,suffix)=>result(client,request,[
 'finance','fictional_frozen_'+suffix,'fictional_org_a',
 '只供隔离虚构历史冻结验证','虚构审计登记引用',key()]);
const event=(source,ref,operation='fixture_added',parent=null,reason='fixture_received')=>
 [source,'finance_reconciliation',operation,ref,parent,reason,key()];

test('V3.2-35 one-way freeze, revoked roles, large windows, concurrent commit ordering',async t=>{
 const root=pool('DATABASE_URL'),finance=pool('DATABASE_URL_PLAN_FINANCE'),
 security=pool('DATABASE_URL_SOURCE_SECURITY'),other=pool('DATABASE_URL_PLAN_B'),
 academic=pool('DATABASE_URL_PLAN_ACADEMIC'),
 viewerA=pool('DATABASE_URL_UAT_PREVIEW_A'),
 viewerB=pool('DATABASE_URL_UAT_PREVIEW_B');
 const all=[root,finance,security,other,academic,viewerA,viewerB];
 try{
  await t.test('strictly separate read, business append and security freeze',async()=>{
   for(const p of [finance,academic,other,viewerA,viewerB]){
    await denied(p,freeze,[null,'fixture_security_lock',
     'fictional_test_freeze',key()],'42501');
   }
   for(const p of [viewerA,viewerB]){
    await denied(p,'SELECT * FROM ms.fixture_uat_source_freezes',[],'42501');
    await denied(p,'DELETE FROM ms.fixture_uat_source_freezes WHERE FALSE',[],'42501');
    await denied(p,append,[null,'finance_reconciliation','fixture_added',
     'fictional_test_reference',null,'fixture_received',key()],'42501');
   }
   for(const tb of ['ms.sales_orders','ms.payment_allocations','ms.crm_entitlement_links'])
    await denied(security,'UPDATE '+tb+' SET id=id WHERE FALSE',[],'42501');
  });
  const id=await makeSource(finance,'first');
  await t.test('atomic version precondition rejects stale audit export',async()=>{
   await denied(viewerA,guarded,[id,0,0,null],'23514');
   assert.equal(await result(finance,append,event(id,'fictional_first_ref01')),1);
   const first=await result(viewerA,guarded,[id,0,1,1]);
   assert.equal(first.current_sequence,1);
   assert.equal(first.is_frozen,false);
   assert.equal(await result(finance,append,event(id,'fictional_second_ref')),2);
   await denied(viewerA,guarded,[id,0,1,1],'55000');
   const second=await result(viewerA,guarded,[id,0,1,2]);
   assert.equal(second.current_sequence,2);
   assert.equal(second.to_sequence,1);
   assert.equal(second.release_allowed,false);
   await denied(viewerB,guarded,[id,0,1,2],'42501');
  });
  await t.test('independent security freezes history forever at exact revision',async()=>{
   const args=[id,'fixture_integrity_review','fictional_frozen_reason01',key()];
   await denied(finance,freeze,args,'42501');
   await denied(other,freeze,args,'42501');
   const frozen=await result(security,freeze,args);
   assert.ok(frozen);
   assert.equal(await result(security,freeze,args),frozen);
   await denied(security,freeze,[id,'fixture_staff_revoked',
    'fictional_other_evidence',key()],'23505');
   const head=await result(viewerA,state,[id]);
   assert.equal(head.is_frozen,true);
   assert.equal(head.frozen_at_sequence,2);
   assert.equal(head.current_sequence,2);
   assert.equal(head.production_integration_allowed,false);
   assert.equal(head.release_allowed,false);
   await denied(viewerB,state,[id],'42501');
   await denied(finance,append,event(id,'fictional_after_freeze')),'55000');
   await denied(finance,append,[id,'finance_reconciliation','fixture_withdrawn',
    'fictional_first_ref01',1,'fixture_revoked',key()],'55000');
   const snap=await result(viewerA,guarded,[id,0,2,2]);
   assert.equal(snap.is_frozen,true);
   assert.equal(snap.frozen_at_sequence,2);
   await denied(root,'DELETE FROM ms.fixture_uat_source_freezes WHERE source_request_id=$1',
    [id],'23514');
   await denied(root,"UPDATE ms.fixture_uat_source_freezes SET freeze_reason='fixture_staff_revoked' WHERE source_request_id=$1",
    [id],'23514');
  });
  await t.test('revoked security reviewer role immediately denies new freezes',async()=>{
   const spare=await makeSource(finance,'revoked');
   const securityStaff='30000000-0000-4000-8000-000000000040';
   const securityRole='30000000-0000-4000-8000-000000000040';
   const args=[spare,'fixture_staff_revoked','fictional_revocation_log',key()];
   await root.query('UPDATE ms.user_role_grants SET revoked_at=now() WHERE user_id=$1 AND role_id=$2',
    [securityStaff,securityRole]);
   try{
    await denied(security,freeze,args,'42501');
   }finally{
    await root.query('UPDATE ms.user_role_grants SET revoked_at=NULL WHERE user_id=$1 AND role_id=$2',
     [securityStaff,securityRole]);
   }
   assert.equal((await result(viewerA,state,[spare])).is_frozen,false);
   const resumed=await result(security,freeze,args);
   assert.ok(resumed);
  });
  await t.test('concurrent writers and security freeze serialize through source row lock',async()=>{
   const concurrencySource=await makeSource(finance,'race');
   const tasks=Array.from({length:9},(_,i)=>result(finance,append,
    event(concurrencySource,'fictional_concurrent_'+String(i).padStart(6,'0'))));
   tasks.push(result(security,freeze,[concurrencySource,
    'fixture_security_lock','fictional_concurrent_freeze',key()]));
   const outcomes=await Promise.allSettled(tasks);
   const frozen=outcomes.at(-1);
   assert.equal(frozen.status,'fulfilled');
   for(const item of outcomes.slice(0,-1)){
    if(item.status==='rejected')assert.equal(item.reason.code,'55000');
    else assert.ok(Number.isSafeInteger(item.value)&&item.value>=1);
   }
   const current=await result(viewerA,state,[concurrencySource]);
   assert.equal(current.is_frozen,true);
   assert.equal(current.current_sequence,current.frozen_at_sequence);
   const details=await result(viewerA,diff,[concurrencySource,0,null]);
   assert.equal(details.events.length,current.current_sequence);
   assert.deepEqual(details.events.map(x=>x.sequence),
    Array.from({length:current.current_sequence},(_,i)=>i+1));
   await denied(finance,append,event(concurrencySource,'fictional_after_race')),'55000');
  });
  await t.test('overlarge history window fails, smaller explicit immutable windows still work',async()=>{
   const big=await makeSource(finance,'large');
   for(let i=0;i<205;i++){
    const seq=await result(finance,append,event(big,'fictional_page_'+String(i).padStart(6,'0')));
    assert.equal(seq,i+1);
   }
   await denied(viewerA,diff,[big,0,205],'23514');
   await denied(viewerA,guarded,[big,0,205,205],'23514');
   const first=await result(viewerA,guarded,[big,0,100,205]);
   const last=await result(viewerA,guarded,[big,105,205,205]);
   assert.equal(first.events.length,100);
   assert.equal(last.events.length,100);
   assert.equal(last.current_sequence,205);
   assert.equal(last.active_before,105);
   assert.equal(last.active_after,205);
   await denied(viewerB,guarded,[big,105,205,205],'42501');
   const frozenId=await result(security,freeze,[big,'fixture_security_lock',
    'fictional_large_freeze',key()]);
   assert.ok(frozenId);
   const after=await result(viewerA,state,[big]);
   assert.equal(after.frozen_at_sequence,205);
   assert.equal(after.current_sequence,205);
  });
 }finally{await Promise.all(all.map(x=>x.end()));}
});
