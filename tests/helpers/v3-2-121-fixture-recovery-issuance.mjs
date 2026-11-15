// V121 CI-only fixture recovery issuance. Not authorized for production key management.
import {createHash,createHmac} from 'node:crypto';
import {encodeFixtureRecoveryRequest} from '../../src/cross-module-fixture-dual-approval-anchor.mjs';
const fail=code=>{const e=new Error(code);e.code=code;throw e;};
export function createFixtureRecoveryIssuance({issuerPool,recoveryGate,approvalAttestationKey,beforeKeyInsert=async()=>{}}={}){
 if(process.env.V106_ISOLATED_PG!=='YES_TEST_ONLY'||!issuerPool?.connect||
  typeof recoveryGate?.verifyRecovery!=='function'||typeof beforeKeyInsert!=='function'||
  !Buffer.isBuffer(approvalAttestationKey)||approvalAttestationKey.length!==32)
  throw TypeError('V121_ISOLATED_RECOVERY_TRUST_REQUIRED');
 async function issue({request,approvals,attestationKey}={}){
  if(!Buffer.isBuffer(attestationKey)||attestationKey.length!==32)
   fail('RECOVERY_KEY_INVALID');
  // Simulated two-person and archive verification precedes SQL mutation.
  const grant=await recoveryGate.verifyRecovery({request,approvals});
  if(grant.fixture_recovery_verified!==true||grant.hold_active!==true||
   grant.release_eligible!==false||grant.external_anchor_verified!==false)
   fail('RECOVERY_FIXTURE_GRANT_INVALID');
  const requestDigest=createHash('sha256').update(encodeFixtureRecoveryRequest(request)).digest('hex');
  if(grant.recovery_request_digest!==requestDigest)fail('RECOVERY_FIXTURE_GRANT_INVALID');
  const auditId=approvals.find(a=>a.role==='AUDIT_REVIEW').approver_id;
  const securityId=approvals.find(a=>a.role==='SECURITY_REVIEW').approver_id;
  const envelope=['v121-recovery-attestation-v1',request.organization_id,request.incident_id,
   request.request_id,requestDigest,request.key_version,request.audit_digest,
   auditId,securityId,createHash('sha256').update(attestationKey).digest('hex')].join('|');
  const approvalMac=createHmac('sha256',approvalAttestationKey).update(envelope).digest('hex');
  const c=await issuerPool.connect();
  let started=false;
  try{
   const role=await c.query('SELECT current_database() AS db,session_user AS actor');
   if(role.rows[0]?.db!=='v106_isolated'||role.rows[0]?.actor!=='v106_key_issuer')
    fail('RECOVERY_ISSUER_CONTEXT_REQUIRED');
   await c.query('BEGIN ISOLATION LEVEL SERIALIZABLE');started=true;
   await c.query('SELECT v106_test.fixture_issue_recovery_key($1::uuid,$2::uuid,$3::uuid,$4::char(64),$5::integer,$6::char(64),$7::uuid,$8::uuid,$9::bytea,$10::text)',
    [request.organization_id,request.incident_id,request.request_id,requestDigest,
     request.key_version,request.audit_digest,auditId,securityId,attestationKey,approvalMac]);
   // Failure injection happens after the atomic SQL gateway call but before COMMIT.
   await beforeKeyInsert({request_digest:requestDigest});
   await c.query('COMMIT');started=false;
   return Object.freeze({fixture_key_issued:true,request_digest:requestDigest,
    hold_active:true,release_eligible:false,external_anchor_verified:false,
    real_person_approval:false,merge_authorized:false,deploy_authorized:false});
  }catch(e){
   if(started)await c.query('ROLLBACK').catch(()=>{});
   // PostgreSQL RAISE EXCEPTION uses P0001; preserve the declared fixture reason.
   if(e.code==='P0001'&&[
    'RECOVERY_ALREADY_CONSUMED','RECOVERY_PREVIOUS_KEY_NOT_REVOKED',
    'RECOVERY_AUDIT_CHANGED','RECOVERY_AUDIT_TAMPERED','RECOVERY_VERSION_NOT_NEXT',
    'V121_ISSUER_ROLE_SCOPE_DENIED','V121_ISSUANCE_ENVELOPE_INVALID',
    'V121_RECOVERY_APPROVAL_ATTESTATION_REJECTED'
   ].includes(e.message)) e.code=e.message;
   throw e;
  }finally{c.release();}
 }
 return Object.freeze({issue});
}
