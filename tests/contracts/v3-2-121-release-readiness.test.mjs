import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {validateFixtureV121Readiness,evaluateFixtureV121Readiness}
 from '../../src/cross-module-v121-release-readiness.mjs';

const manifestUrl=new URL('../../docs/market-sales/v3-2-121-release-readiness.json',import.meta.url);
const load=()=>JSON.parse(readFileSync(manifestUrl,'utf8'));
const change=fn=>{
 const doc=load();
 fn(doc);
 return doc;
};
const rejected=doc=>assert.throws(()=>validateFixtureV121Readiness(doc),
 {code:'V121_READINESS_CONTRACT_INVALID'});

test('final acceptance inventory names its evidence, missing external gates and unsigned domain approvals',()=>{
 const manifest=load();
 assert.equal(validateFixtureV121Readiness(manifest),true);
 assert.equal(manifest.ci_controls.length,7);
 assert.equal(manifest.production_gaps.length,10);
 assert.equal(manifest.manual_signoffs.length,6);
 for(const item of manifest.ci_controls)
  for(const evidence of item.evidence)
   assert.equal(existsSync(new URL('../../'+evidence,import.meta.url)),true,
    'Missing CI evidence path: '+evidence);
 assert.ok(manifest.production_gaps.some(g=>g.requirement.includes('WORM')));
 assert.ok(manifest.production_gaps.some(g=>g.owner_domain==='FINANCE'));
 assert.ok(manifest.production_gaps.some(g=>g.owner_domain==='ACADEMIC'));
 assert.ok(manifest.production_gaps.some(g=>g.owner_domain==='SALES'));
 assert.equal(manifest.release_authorization_implemented,false);
});

test('even a perfectly green CI cannot merge, deploy, issue keys or lift the quarantine',()=>{
 const manifest=load();
 for(const ciPassed of [false,true]){
  const result=evaluateFixtureV121Readiness(manifest,{ciPassed});
  assert.equal(result.decision,'HOLD_NOT_PRODUCTION_READY');
  assert.equal(result.ci_status,ciPassed?'CI_TESTS_PASSED_ONLY':'CI_NOT_VERIFIED');
  assert.equal(result.release_authorized,false);
  assert.equal(result.merge_allowed,false);
  assert.equal(result.deploy_allowed,false);
  assert.equal(result.quarantine_active,true);
  assert.equal(result.hold_active,true);
  assert.equal(result.release_eligible,false);
  assert.equal(result.ci_tested_controls,7);
  assert.equal(result.unverified_external_gates.length,10);
  assert.deepEqual(result.missing_independent_signoffs,[
   'SECURITY','AUDIT','SALES','FINANCE','ACADEMIC','OPERATIONS'
  ]);
  assert.ok(Object.isFrozen(result));
 }
 assert.throws(()=>evaluateFixtureV121Readiness(manifest,{ciPassed:'success'}),
  {code:'V121_READINESS_CONTRACT_INVALID'});
});

test('tampered release flags, simulated approvals and overwritten external gates fail closed',()=>{
 rejected(change(x=>{x.production_release_status='READY';}));
 rejected(change(x=>{x.release_authorization_implemented=true;}));
 rejected(change(x=>{x.hold_active=false;}));
 rejected(change(x=>{x.release_eligible=true;}));
 rejected(change(x=>{x.forbidden_actions=x.forbidden_actions.filter(v=>v!=='PRODUCTION_DEPLOY');}));
 rejected(change(x=>{x.allowed_actions.push('PRODUCTION_DEPLOY');}));
 rejected(change(x=>{x.manual_signoffs[0].status='SIGNED';}));
 rejected(change(x=>{x.production_gaps[0].status='VERIFIED';}));
 rejected(change(x=>{x.ci_controls[0].status='PRODUCTION_APPROVED';}));
 rejected(change(x=>{x.production_gaps.splice(2,1);}));
 rejected(change(x=>{x.manual_signoffs[5].domain='AUDIT';}));
 rejected(change(x=>{x.ci_controls[0].evidence=['../../fake-proof'];}));
 rejected(change(x=>{x.explicit_non_evidence=[];}));
 rejected(change(x=>{x.draft_pr=130;}));
});

test('CI result alone is not production evidence and there is no release token in the return shape',()=>{
 const r=evaluateFixtureV121Readiness(load(),{ciPassed:true});
 assert.equal('release_token' in r,false);
 assert.equal('approvals_granted' in r,false);
 assert.equal('release_action' in r,false);
 assert.ok(r.unverified_external_gates.every(x=>x.startsWith('EXT-')));
});
