// Contract-only tests. No HTTP, no payment processor, no CRM, no real database.
// Passing these tests means the drafts are internally parseable, NOT production-ready.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = p => readFileSync(new URL('../../' + p, import.meta.url),'utf8');
const parse = p => JSON.parse(read(p));
const crm = parse('api/openapi/crm-integration.v1.json');
const sales = parse('api/openapi/market-sales.v1.json');
const machine = parse('spec/transaction-state-machines.v1.json');

const refs=(doc)=>{
  const out=[];const walk=(v)=>{
    if(Array.isArray(v)){v.forEach(walk);return;}
    if(v&&typeof v==='object'){for(const [key,val] of Object.entries(v)){
      if(key==='$ref')out.push(val);
      walk(val);
    }}
  };walk(doc);return out;
};
const countOps=o=>Object.values(o.paths).reduce((n,r)=>n+Object.keys(r).length,0);

test('OpenAPI 3.1 files are parseable; 10 CRM / 18 sales endpoints',()=>{
  assert.equal(crm.openapi,'3.1.0');
  assert.equal(sales.openapi,'3.1.0');
  assert.equal(countOps(crm),10);
  assert.equal(countOps(sales),18);
  assert.equal(crm['x-contract-status'],'proposed-unimplemented');
  assert.equal(sales['x-contract-status'],'proposed-unimplemented');
});

for (const [name,doc] of [['CRM',crm],['Market sales',sales]]) {
  test(name+' all paths, parameters, internal refs and security schemes resolve',()=>{
    const operationIds=new Set();
    for(const [route,methods] of Object.entries(doc.paths)){
      for(const [verb,op] of Object.entries(methods)){
        assert.ok(['get','post','patch','delete'].includes(verb),verb);
        assert.ok(op.operationId,route);
        assert.ok(!operationIds.has(op.operationId),op.operationId);
        operationIds.add(op.operationId);
        for(const m of route.matchAll(/\{([^}]+)\}/g)){
          assert.ok(op.parameters?.some(p=>p.in==='path' && p.name===m[1]),
            'Missing path parameter '+route+':'+m[1]);
        }
        assert.ok(op.responses?.['200'],route);
        assert.ok(op.security?.length,'Security omitted: '+route);
        for(const sec of op.security)for(const [scheme,scopes] of Object.entries(sec)){
          const def=doc.components.securitySchemes[scheme];
          assert.ok(def,'Undefined auth scheme '+scheme);
          if(def.type==='http')assert.deepEqual(scopes,[],
            'HTTP bearer must not advertise OAuth scopes');
        }
        if(verb==='post'){
          assert.ok(op.requestBody,'POST missing requestBody '+route);
          if(!route.endsWith('/lookup') && !route.endsWith('/availability/search')){
            assert.ok(op.parameters?.some(p=>p.in==='header'&&p.name==='Idempotency-Key'),
              'Write missing idempotency header '+route);
          }
        }
      }
    }
    for (const path of refs(doc)){
      assert.ok(path.startsWith('#/components/'),'External ref not allowed in draft '+path);
      const steps=path.slice(2).split('/');
      let current=doc;
      for(const key of steps){assert.ok(current?.[key],path); current=current[key];}
    }
  });
}

test('CRM endpoints never masquerade as existing routes',()=>{
  assert.match(crm.info.description,/DESIGN ONLY|未实现/i);
  assert.ok(crm.servers[0].url.endsWith('.invalid'));
  assert.ok(sales.servers[0].url.endsWith('.invalid'));
  assert.equal(crm['x-owning-system'],'edu-management-system');
  assert.equal(sales['x-owning-system'],'market-sales-system');
  for(const route of Object.keys(crm.paths))assert.ok(route.startsWith('/integration/v1/'));
  for(const route of Object.keys(sales.paths))assert.ok(route.startsWith('/api/v1/'));
});

test('8 state machines; transitions well-defined; 6 non-negotiable invariants',()=>{
  assert.equal(machine.machines.length,8);
  let transitions=0;
  const names=new Set();
  for(const m of machine.machines){
    assert.ok(!names.has(m.name),m.name);names.add(m.name);
    assert.ok(m.states.includes(m.initial),m.name);
    const used=new Set();
    for(const t of m.transitions){
      transitions++;
      assert.ok(m.states.includes(t.from)&&m.states.includes(t.to),m.name);
      assert.ok(t.guards?.length,m.name+' '+t.event);
      const k=t.from+' '+t.event;
      assert.ok(!used.has(k),'Ambiguous state/event '+m.name+'/'+k);
      used.add(k);
    }
  }
  assert.equal(transitions,39);
  assert.deepEqual(machine.core_invariants.map(x=>x.code),[
    'TX-I01','TX-I02','TX-I03','TX-I04','TX-I05','TX-I06'
  ]);
});

test('55 V3.1-01 tables, no missing forward references',()=>{
  const sql=read('db/migrations/001_initial_schema.sql');
  const names=[...sql.matchAll(/CREATE TABLE ms\.([a-z_]+)\s*\(/g)].map(m=>m[1]);
  assert.equal(names.length,55);
  assert.equal(new Set(names).size,55);
  const created=new Set();
  for(const match of sql.matchAll(/CREATE TABLE ms\.([a-z_]+)\s*\(([\s\S]*?)(?=\nCREATE TABLE |\nCOMMIT;)/g)){
    const [all,table]=match;
    for(const r of all.matchAll(/REFERENCES ms\.([a-z_]+)\(/g)){
      assert.ok(created.has(r[1]) || r[1]===table,
        'Missing or forward referenced '+r[1]+' in '+table);
    }
    created.add(table);
  }
});

test('Financial patch explicitly guards identity, amount, audit and unique first sale',()=>{
  const sql=read('db/migrations/002_financial_integrity_draft.sql');
  for(const phrase of [
    'guard_sales_order_identity','guard_payment_allocation','guard_refund_allocation',
    'guard_sale_recognition','payment_allocation_history','refund_allocation_history',
    'uq_one_approved_sales_credit_version','finance_economic_events',
    'trg_guard_receipt_source_revision','trg_guard_quote_identity'
  ])assert.ok(sql.includes(phrase),phrase);
  assert.ok(sql.trim().startsWith('-- MS-DB-002'));
  assert.ok(sql.trim().endsWith('COMMIT;'));
});

test('40 separate acceptance scenarios exist; all explicitly NOT RUN',()=>{
  const sql=read('docs/TRANSACTION_ACCEPTANCE_V3.1-03.md');
  const numbers=[...sql.matchAll(/TX-T(\d{2}) \|/g)].map(m=>Number(m[1]));
  assert.deepEqual(numbers,Array.from({length:40},(_,i)=>i+1));
  assert.ok(sql.includes('NOT RUN'));
});
