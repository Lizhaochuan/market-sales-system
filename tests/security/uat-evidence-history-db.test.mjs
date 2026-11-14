import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import pg from 'pg';
import {verifyBlockedFixtureHistory,renderBlockedFixtureHistoryMarkdown}
 from '../../src/uat-evidence-history.mjs';
import {assertUatPreviewPool} from '../../src/uat-preview-api.mjs';
const key=()=>randomBytes(20).toString('hex');
const pool=name=>new pg.Pool({connectionString:process.env[name],max:2});
const q=async(p,sql,args)=>(await p.query(sql,args)).rows[0].result;
const deny=(p,sql,args,code)=>assert.rejects(p.query(sql,args),
 e=>e.code===code,'Expected '+code+' for '+sql);
const propose='SELECT ms.propose_fixture_source_readiness($1,$2,$3,$4,$5,$6) AS result';
const add='SELECT ms.record_fixture_uat_evidence($1,$2,$3,$4,$5,$6,$7) AS result';
const diff='SELECT ms.readonly_fixture_uat_diff($1,$2,$3) AS result';

test('V3.2-34 real DB LOGIN: fictional append-only evidence and tenant-safe revisions',async t=>{
 const root=pool('DATABASE_URL'),finance=pool('DATABASE_URL_PLAN_FINANCE'),
 academic=pool('DATABASE_URL_PLAN_ACADEMIC'),sales=pool('DATABASE_URL_PLAN_SALES'),
 security=pool('DATABASE_URL_SOURCE_SECURITY'),other=pool('DATABASE_URL_PLAN_B'),
 viewerA=pool('DATABASE_URL_UAT_PREVIEW_A'),viewerB=pool('DATABASE_URL_UAT_PREVIEW_B'),
 low=pool('DATABASE_URL_WRITE_A');
 const all=[root,finance,academic,sales,security,other,viewerA,viewerB,low];
 try{
  await t.test('separate viewer LOGIN has no raw evidence read or business write permissions',async()=>{
   await assertUatPreviewPool(viewerA);
   await assertUatPreviewPool(viewerB);
   for(const p of [viewerA,viewerB]){
    await deny(p,'SELECT * FROM ms.fixture_uat_evidence_events',[],'42501');
    await deny(p,'UPDATE ms.fixture_uat_evidence_events SET id=id WHERE FALSE',[],'42501');
    await deny(p,add,[null,'finance_reconciliation','fixture_added',
     'fictional_invalid_ref',null,'fixture_received',key()],'42501');
    await deny(p,'UPDATE ms.payment_allocations SET id=id WHERE FALSE',[],'42501');
    await deny(p,'UPDATE ms.crm_entitlement_links SET id=id WHERE FALSE',[],'42501');
   }
   for(const p of [finance,academic,sales,security,other]){
    await deny(p,'SELECT * FROM ms.fixture_uat_evidence_events',[],'42501');
    await deny(p,'DELETE FROM ms.fixture_uat_evidence_events WHERE FALSE',[],'42501');
   }
   await deny(low,add,[null,'finance_reconciliation','fixture_added',
    'fictional_invalid_ref',null,'fixture_received',key()],'42501');
  });
  const sourceA=await q(finance,propose,['finance','fictional_diff_finance',
   'fictional_org_a','虚构对账证据差异演练','虚构验收报告材料',key()]);
  const sourceB=await q(other,propose,['finance','fictional_diff_other',
   'fictional_org_b','虚构另机构财务材料','虚构 B 机构材料',key()]);
  const ref='fictional_evidence_alpha01';
  let seq1,seq2,seq3;
  await t.test('only matching department may append fictional evidence',async()=>{
   const args=[sourceA,'finance_reconciliation','fixture_added',
    ref,null,'fixture_received',key()];
   await deny(academic,add,args,'42501');
   await deny(sales,add,args,'42501');
   await deny(security,add,args,'42501');
   await deny(other,add,args,'42501');
   await deny(finance,add,[sourceA,'finance_reconciliation','fixture_added',
    'real_receipt_bank_1234',null,'fixture_received',key()],'23514');
   await deny(finance,add,[sourceA,'finance_reconciliation','approved',
    ref,null,'fixture_received',key()],'23514');
   seq1=await q(finance,add,args);
   assert.equal(seq1,1);
   assert.equal(await q(finance,add,args),seq1);
   await deny(finance,add,[...args.slice(0,3),
    'fictional_evidence_different',...args.slice(4)],'23505');
   await deny(finance,add,[sourceA,'finance_reconciliation','fixture_added',
    ref,null,'fixture_received',key()],'23505');
   const p=verifyBlockedFixtureHistory(await q(viewerA,diff,[sourceA,0,null]));
   assert.equal(p.events.length,1);
   assert.equal(p.added,1);
   assert.equal(p.activeAfter,1);
   assert.equal(p.execution_allowed,false);
   await deny(viewerB,diff,[sourceA,0,null],'42501');
   await deny(viewerA,diff,[sourceB,0,null],'42501');
  });
  await t.test('withdrawal must match a live added reference and never delete history',async()=>{
   await deny(finance,add,[sourceA,'finance_reconciliation','fixture_withdrawn',
    ref,99,'fixture_revoked',key()],'23514');
   await deny(finance,add,[sourceA,'finance_reconciliation','fixture_withdrawn',
    'fictional_other_reference',1,'fixture_revoked',key()],'23514');
   seq2=await q(finance,add,[sourceA,'finance_reconciliation','fixture_withdrawn',
    ref,seq1,'fixture_revoked',key()]);
   assert.equal(seq2,2);
   await deny(finance,add,[sourceA,'finance_reconciliation','fixture_withdrawn',
    ref,seq1,'fixture_revoked',key()],'23514');
   const before=verifyBlockedFixtureHistory(await q(viewerA,diff,[sourceA,0,1]));
   const after=verifyBlockedFixtureHistory(await q(viewerA,diff,[sourceA,1,2]));
   assert.equal(before.activeAfter,1);
   assert.equal(after.activeBefore,1);
   assert.equal(after.activeAfter,0);
   assert.equal(after.withdrawn,1);
   assert.equal(after.events[0].parentSequence,1);
   assert.equal(after.release_allowed,false);
   const old=await q(viewerA,diff,[sourceA,0,1]);
   assert.equal(old.current_sequence,2);
   assert.equal(old.to_sequence,1);
   assert.equal(old.events.length,1);
   await deny(root,
    "UPDATE ms.fixture_uat_evidence_events SET event_kind='fixture_added' WHERE source_request_id=$1",
    [sourceA],'23514');
   await deny(root,
    'DELETE FROM ms.fixture_uat_evidence_events WHERE source_request_id=$1',
    [sourceA],'23514');
  });
  await t.test('re-adding a withdrawn fictional ref creates new history, never overwrites',async()=>{
   seq3=await q(finance,add,[sourceA,'finance_reconciliation','fixture_added',
    ref,null,'fixture_received',key()]);
   assert.equal(seq3,3);
   const full=await q(viewerA,diff,[sourceA,0,null]);
   const verified=verifyBlockedFixtureHistory(full);
   assert.equal(verified.current,3);
   assert.equal(verified.events.length,3);
   assert.equal(verified.added,2);
   assert.equal(verified.withdrawn,1);
   assert.equal(verified.activeAfter,1);
   const md=renderBlockedFixtureHistoryMarkdown(full);
   assert.match(md,/0 → 3/);
   assert.match(md,/禁止真实联调/);
   assert.match(md,/禁止解除学生错误关联隔离/);
   await deny(viewerA,diff,[sourceA,0,4],'23514');
   await deny(viewerA,diff,[sourceA,2,1],'23514');
   await deny(viewerA,diff,[sourceA,-1,0],'23514');
  });
  await t.test('security and sales may append only their assigned checks, never approve',async()=>{
   const s=await q(security,add,[sourceA,'security_source_trust',
    'fixture_added','fictional_security_review01',null,'fixture_received',key()]);
   assert.equal(s,4);
   const a=await q(sales,add,[sourceA,'sales_contract_party',
    'fixture_added','fictional_contract_sample',null,'fixture_received',key()]);
   assert.equal(a,5);
   await deny(security,add,[sourceA,'finance_reconciliation','fixture_added',
    'fictional_wrong_dept',null,'fixture_received',key()],'42501');
   await deny(finance,add,[sourceA,'academic_attendance_balance','fixture_added',
    'fictional_wrong_area',null,'fixture_received',key()],'23514');
   const all=await q(viewerA,diff,[sourceA,0,null]);
   const checked=verifyBlockedFixtureHistory(all);
   assert.equal(checked.current,5);
   assert.equal(checked.activeAfter,3);
   assert.equal(checked.production_integration_allowed,false);
  });
 }finally{await Promise.all(all.map(x=>x.end()));}
});
