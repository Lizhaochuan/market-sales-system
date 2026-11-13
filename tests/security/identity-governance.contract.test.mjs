import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>JSON.parse(readFileSync(new URL('../../'+p,import.meta.url),'utf8'));
test('V3.2-04 lists exactly 28 implemented isolated-only operations with no finance/CRM writes',()=>{
  const contracts=[
    read('api/openapi/core-implemented.v3.2.json'),
    read('api/openapi/admin-ui-implemented.v3.2.json'),
    read('api/openapi/security-approvals-implemented.v3.2.json'),
    read('api/openapi/identity-governance-implemented.v3.2.json')
  ];
  const counts=contracts.map(x=>Object.values(x.paths).reduce((n,methods)=>n+Object.keys(methods).length,0));
  assert.deepEqual(counts,[14,7,2,5]);
  const operations=[];
  for(const doc of contracts){
    assert.equal(doc.openapi,'3.1.0');
    assert.equal(doc['x-production-ready'],false);
    assert.equal(doc.servers[0].url,'http://127.0.0.1:3100');
    for(const [path,methods] of Object.entries(doc.paths)){
      for(const [verb,op] of Object.entries(methods)){
        operations.push(op.operationId);
        assert.ok(!/\/orders|\/payments|\/refunds|\/entitlements|\/sales-events/.test(path));
        assert.ok(op.responses?.['200'],path);
        if(verb==='post'&&path!=='/api/v1/dev/login')
          assert.ok(op.parameters?.some(x=>x.in==='header'&&x.name==='Idempotency-Key'));
        if(path.startsWith('/api/v1/identity/')||path==='/api/v1/me')
          assert.ok(op.security?.[0]?.staffBearer,path);
        for(const a of path.matchAll(/\{(\w+)\}/g))
          assert.ok(op.parameters?.some(x=>x.name===a[1]&&x.in==='path'));
      }
    }
  }
  assert.equal(operations.length,28);
  assert.equal(new Set(operations).size,28,'Operation IDs must be unique across separate specs');
  const identity=contracts[3];
  assert.equal(identity['x-real-identity-provider-connected'],false);
  assert.equal(identity['x-identity-subject-returned-to-ui'],false);
  const list=identity.paths['/api/v1/identity/bindings'].get.responses['200'].content['application/json'].schema;
  assert.ok(!JSON.stringify(list).includes('subject'));
  const decision=identity.paths['/api/v1/identity/change-requests/{requestId}/decision'].post;
  assert.ok(decision.requestBody.content['application/json'].schema.required.includes('review_evidence_ref'));
});
