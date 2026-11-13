import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read=path=>JSON.parse(readFileSync(new URL('../../'+path,import.meta.url),'utf8'));
const spec=read('api/openapi/admin-ui-implemented.v3.2.json');
test('V3.2-02 isolated UI contract has 7 implemented routes, never production finance',()=>{
  assert.equal(spec.openapi,'3.1.0');
  assert.equal(spec['x-production-ready'],false);
  assert.equal(spec['x-stage'],'isolated-test-only');
  assert.equal(spec.servers[0].url,'http://127.0.0.1:3100');
  const names=[
    '/api/v1/dev/login','/api/v1/students','/api/v1/contacts',
    '/api/v1/contact-events','/api/v1/leads','/api/v1/opportunities',
    '/api/v1/family-groups'
  ];
  assert.deepEqual(Object.keys(spec.paths).sort(),names.sort());
  assert.equal(Object.values(spec.paths).reduce((n,v)=>n+Object.keys(v).length,0),7);
  assert.ok(spec.paths['/api/v1/dev/login'].post.security.length===0);
  for(const [path,methods] of Object.entries(spec.paths)){
    for(const [method,endpoint]of Object.entries(methods)){
      assert.equal(endpoint['x-implementation-status'],'isolated-test-only');
      if(path!=='/api/v1/dev/login'){
        assert.equal(method,'get');
        assert.ok(endpoint.security?.[0]?.staffBearer);
      }
      assert.ok(endpoint.responses['200']);
    }
    assert.ok(!/\/payments|\/orders|\/refunds|\/sales|\/entitlements|\/trials/.test(path));
  }
});
