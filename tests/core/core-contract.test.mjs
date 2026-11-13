import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const spec=JSON.parse(readFileSync(new URL('../../api/openapi/core-implemented.v3.2.json',import.meta.url),'utf8'));
test('V3.2 core OpenAPI explicitly isolated and only 14 working low-risk paths',()=>{
  assert.equal(spec.openapi,'3.1.0');
  assert.equal(spec['x-production-ready'],false);
  assert.equal(spec['x-stage'],'isolated-test-only');
  assert.equal(spec.servers[0].url,'http://127.0.0.1:3100');
  const expected=[
    'GET /api/v1/health','POST /api/v1/students','GET /api/v1/students/{studentId}',
    'POST /api/v1/contacts','POST /api/v1/contact-events',
    'POST /api/v1/students/{studentId}/contacts','POST /api/v1/leads',
    'GET /api/v1/leads/{leadId}','POST /api/v1/leads/{leadId}/students',
    'POST /api/v1/opportunities','GET /api/v1/opportunities/{opportunityId}',
    'POST /api/v1/interactions','POST /api/v1/family-groups','GET /api/v1/audit'
  ];
  const actual=[];
  for(const [path,verbs] of Object.entries(spec.paths)){
    for(const [verb,op] of Object.entries(verbs)){
      actual.push(verb.toUpperCase()+' '+path);
      assert.equal(op['x-implementation-status'],'implemented-isolated-test-only');
      if(verb.toLowerCase()==='post') {
        assert.ok(op.parameters.some(p=>p.in==='header'&&p.name==='Idempotency-Key'),path);
        assert.ok(op.requestBody,path);
      }
      for(const m of path.matchAll(/\{([^}]+)\}/g)) {
        assert.ok(op.parameters.some(p=>p.in==='path'&&p.name===m[1]),path);
      }
      if(path!=='/api/v1/health')assert.ok(op.security?.[0]?.staffBearer,path);
    }
  }
  assert.deepEqual(actual.sort(),expected.sort());
  assert.ok(!actual.some(x=>/payment|orders|sale_events|entitlements|\/trials|refunds|\/integration\//.test(x)));
});
