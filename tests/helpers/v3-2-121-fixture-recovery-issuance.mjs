// V121 CI-only fixture recovery issuance. Not authorized for production key management.
import {createHash} from 'node:crypto';
import {encodeFixtureRecoveryRequest} from '../../src/cross-module-fixture-dual-approval-anchor.mjs';
const fail=code=>{const e=new Error(code);e.code=code;throw e;};
export function createFixtureRecoveryIssuance({adminPool,recoveryGate,beforeKeyInsert=async()=>{}}={}){
 if(process.env.V106_ISOLATED_PG!=='YES_TEST_ONLY'||!adminPool?.connect||
  typeof recoveryGate?.verifyRecovery!=='function'||typeof beforeKeyInsert!=='function')
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
  const c=await adminPool.connect();
  let started=false;
  try{
   const role=await c.query('SELECT current_database() AS db,session_user AS actor');
   if(role.rows[0]?.db!=='v106_isolated'||role.rows[0]?.actor!=='postgres')
    fail('RECOVERY_ADMIN_CONTEXT_REQUIRED');
   await c.query('BEGIN ISOLATION LEVEL SERIALIZABLE');started=true;
   const old=await c.query('SELECT key_version,active FROM v106_test.fixture_receipt_attestation_secrets WHERE organization_id=$1 AND key_version=$2 FOR UPDATE',
    [request.organization_id,request.key_version-1]);
   if(old.rowCount!==1||old.rows[0].active!==false)fail('RECOVERY_PREVIOUS_KEY_NOT_REVOKED');
   const audit=await c.query('SELECT event_digest,actor,event_kind,key_version FROM v106_test.fixture_receipt_key_audit WHERE organization_id=$1 AND key_version=$2 AND event_kind=$3',
    [request.organization_id,request.key_version-1,'KEY_REVOKED']);
   if(audit.rowCount!==1||audit.rows[0].event_digest!==request.audit_digest)
    fail('RECOVERY_AUDIT_CHANGED');
   const e=audit.rows[0];
   const meta=[request.organization_id,e.key_version,e.event_kind,e.actor].join('|');
   if(createHash('sha256').update(meta).digest('hex')!==e.event_digest)
    fail('RECOVERY_AUDIT_TAMPERED');
   const prior=await c.query('SELECT 1 FROM v106_test.fixture_recovery_consumptions WHERE organization_id=$1 AND request_id=$2',
    [request.organization_id,request.request_id]);
   if(prior.rowCount)fail('RECOVERY_ALREADY_CONSUMED');
   const issued=await c.query('SELECT COALESCE(MAX(key_version),0) AS latest FROM v106_test.fixture_receipt_attestation_secrets WHERE organization_id=$1',
    [request.organization_id]);
   if(Number(issued.rows[0].latest)!==request.key_version-1)
    fail('RECOVERY_VERSION_NOT_NEXT');
   await c.query('INSERT INTO v106_test.fixture_recovery_consumptions(organization_id,incident_id,request_id,request_digest,key_version,revocation_audit_digest,approver_audit_id,approver_security_id,anchor_source) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [request.organization_id,request.incident_id,request.request_id,requestDigest,
     request.key_version,request.audit_digest,auditId,securityId,'FIXTURE_SEPARATE_ARCHIVE']);
   await beforeKeyInsert({request_digest:requestDigest});
   await c.query('INSERT INTO v106_test.fixture_receipt_attestation_secrets(organization_id,key_version,attestation_key,active) VALUES($1,$2,$3,true)',
    [request.organization_id,request.key_version,attestationKey]);
   await c.query('COMMIT');started=false;
   return Object.freeze({fixture_key_issued:true,request_digest:requestDigest,
    hold_active:true,release_eligible:false,external_anchor_verified:false,
    real_person_approval:false,merge_authorized:false,deploy_authorized:false});
  }catch(e){
   if(started)await c.query('ROLLBACK').catch(()=>{});
   throw e;
  }finally{c.release();}
 }
 return Object.freeze({issue});
}
