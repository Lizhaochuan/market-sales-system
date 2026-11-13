import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read=path=>JSON.parse(readFileSync(new URL('../../'+path,import.meta.url),'utf8'));
test('V3.2-03 actual independent implemented interface contracts remain isolated and safe',()=>{
  const contracts=[
    read('api/openapi/core-implemented.v3.2.json'),
    read('api/openapi/admin-ui-implemented.v3.2.json'),
    read('api/openapi/security-approvals-implemented.v3.2.json')
  ];
  const counts=contracts.map(c=>Object.values(c.paths).reduce((sum,methods)=>sum+Object.keys(methods).length,0));
  assert.deepEqual(counts,[14,7,2]);
  const ids=new Set();
  for(const c of contracts){
    assert.equal(c.openapi,'3.1.0');
    assert.equal(c['x-production-ready'],false);
    assert.equal(c.servers[0].url,'http://127.0.0.1:3100');
    for(const [path,methods] of Object.entries(c.paths)){
      for(const [method,op] of Object.entries(methods)){
        assert.ok(!ids.has(op.operationId),'Duplicate operationId '+op.operationId);
        ids.add(op.operationId);
        for(const m of path.matchAll(/\{(\w+)\}/g)){
          assert.ok(op.parameters?.some(x=>x.name===m[1]&&x.in==='path'),
            'Missing path parameter '+path);
        }
        if(method==='post'&&path!=='/api/v1/dev/login'){
          assert.ok(op.parameters?.some(x=>x.name==='Idempotency-Key'&&x.in==='header'));
        }
        assert.ok(!/\/payment|\/refund|\/entitlement|\/sales-order|\/trials/.test(path),
          'Financial or CRM operation must not be implemented');
      }
    }
  }
  assert.ok(contracts[2].paths['/api/v1/me'].get.security[0].staffBearer);
  assert.ok(contracts[2].paths['/api/v1/family-groups/{familyId}/decision'].post.security[0].staffBearer);
});
