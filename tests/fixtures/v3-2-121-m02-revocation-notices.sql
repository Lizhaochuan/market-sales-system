-- V3.2-121: disposable-only notice records. Never a production migration.
DO $guard$ BEGIN
 IF current_database() <> 'v106_isolated' THEN
  RAISE EXCEPTION 'V121 only runs in v106_isolated';
 END IF;
END $guard$;
CREATE TABLE v106_test.fixture_revocation_recipients (
 organization_id uuid NOT NULL,
 incident_id uuid NOT NULL,
 recipient_id uuid NOT NULL,
 PRIMARY KEY(organization_id,incident_id,recipient_id)
);
CREATE TABLE v106_test.fixture_revocation_notices (
 organization_id uuid NOT NULL,
 incident_id uuid NOT NULL,
 notice_id char(64) NOT NULL,
 recipient_id uuid NOT NULL,
 export_version integer NOT NULL CHECK(export_version BETWEEN 1 AND 128),
 epoch integer NOT NULL CHECK(epoch BETWEEN 1 AND 2147483647),
 manifest_digest char(64) NOT NULL,
 revocation_event_digest char(64) NOT NULL,
 event_digest char(64) NOT NULL,
 event_payload text NOT NULL,
 state text NOT NULL DEFAULT 'QUEUED' CHECK(state='QUEUED'),
 hold_active boolean NOT NULL DEFAULT true CHECK(hold_active IS TRUE),
 PRIMARY KEY(organization_id,incident_id,notice_id),
 UNIQUE(organization_id,incident_id,recipient_id,export_version,epoch)
);
REVOKE ALL ON v106_test.fixture_revocation_recipients,v106_test.fixture_revocation_notices FROM PUBLIC;
GRANT SELECT ON v106_test.fixture_revocation_recipients TO v106_writer_a,v106_writer_b;
GRANT SELECT,INSERT ON v106_test.fixture_revocation_notices TO v106_writer_a,v106_writer_b;
ALTER TABLE v106_test.fixture_revocation_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE v106_test.fixture_revocation_recipients FORCE ROW LEVEL SECURITY;
ALTER TABLE v106_test.fixture_revocation_notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE v106_test.fixture_revocation_notices FORCE ROW LEVEL SECURITY;
CREATE POLICY v121_rec_a ON v106_test.fixture_revocation_recipients
 FOR SELECT TO v106_writer_a USING(organization_id='11111111-1111-4111-8111-111111111111'::uuid);
CREATE POLICY v121_rec_b ON v106_test.fixture_revocation_recipients
 FOR SELECT TO v106_writer_b USING(organization_id='22222222-2222-4222-8222-222222222222'::uuid);
CREATE POLICY v121_not_a ON v106_test.fixture_revocation_notices
 FOR ALL TO v106_writer_a
 USING(organization_id='11111111-1111-4111-8111-111111111111'::uuid)
 WITH CHECK(organization_id='11111111-1111-4111-8111-111111111111'::uuid);
CREATE POLICY v121_not_b ON v106_test.fixture_revocation_notices
 FOR ALL TO v106_writer_b
 USING(organization_id='22222222-2222-4222-8222-222222222222'::uuid)
 WITH CHECK(organization_id='22222222-2222-4222-8222-222222222222'::uuid);
-- Registry entries must be populated by the disposable fixture owner, never by writer clients.
-- No UPDATE or DELETE grants: notice/event payload, digest and HOLD remain immutable.

-- V121 negative-only receipts: independently appended, never acknowledgements of delivery.
CREATE TABLE v106_test.fixture_revocation_negative_receipts (
 organization_id uuid NOT NULL,
 incident_id uuid NOT NULL,
 notice_id char(64) NOT NULL,
 receipt_sequence integer NOT NULL CHECK(receipt_sequence BETWEEN 1 AND 128),
 receipt_state text NOT NULL CHECK(receipt_state IN ('NEGATIVE_RECEIPT','COPY_NOT_RETRACTABLE')),
 previous_digest char(64) NOT NULL,
 receipt_digest char(64) NOT NULL,
 receipt_payload text NOT NULL,
 hold_active boolean NOT NULL DEFAULT true CHECK(hold_active IS TRUE),
 PRIMARY KEY(organization_id,incident_id,notice_id,receipt_sequence),
 FOREIGN KEY(organization_id,incident_id,notice_id)
  REFERENCES v106_test.fixture_revocation_notices(organization_id,incident_id,notice_id)
);
REVOKE ALL ON v106_test.fixture_revocation_negative_receipts FROM PUBLIC;
-- Ordinary writer roles cannot directly append receipts. Only isolated dedicated receipt role may INSERT.
GRANT SELECT ON v106_test.fixture_revocation_negative_receipts TO v106_writer_a,v106_writer_b;
-- Receipt role receives EXECUTE on a constrained function below, no direct table INSERT.
ALTER TABLE v106_test.fixture_revocation_negative_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE v106_test.fixture_revocation_negative_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY v121_rcpt_a ON v106_test.fixture_revocation_negative_receipts
 FOR ALL TO v106_writer_a
 USING(organization_id='11111111-1111-4111-8111-111111111111'::uuid)
 WITH CHECK(organization_id='11111111-1111-4111-8111-111111111111'::uuid);
CREATE POLICY v121_rcpt_b ON v106_test.fixture_revocation_negative_receipts
 FOR ALL TO v106_writer_b
 USING(organization_id='22222222-2222-4222-8222-222222222222'::uuid)
 WITH CHECK(organization_id='22222222-2222-4222-8222-222222222222'::uuid);

-- Disposable persistent monotone signer observations. Not production IAM.
CREATE TABLE v106_test.fixture_signer_watermarks (
 organization_id uuid NOT NULL,
 incident_id uuid NOT NULL,
 signer_id uuid NOT NULL,
 authority_epoch integer NOT NULL CHECK(authority_epoch>0),
 revocation_watermark integer NOT NULL CHECK(revocation_watermark>=0),
 lease_sequence integer NOT NULL DEFAULT 0 CHECK(lease_sequence>=0),
 PRIMARY KEY(organization_id,incident_id,signer_id)
);
CREATE FUNCTION v106_test.fixture_watermark_monotone() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.organization_id<>OLD.organization_id OR
    NEW.incident_id<>OLD.incident_id OR NEW.signer_id<>OLD.signer_id OR
    NEW.authority_epoch<OLD.authority_epoch OR
    NEW.revocation_watermark<OLD.revocation_watermark OR
    NEW.lease_sequence<OLD.lease_sequence THEN
  RAISE EXCEPTION 'V121_WATERMARK_REGRESSION';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER fixture_watermark_no_regression BEFORE UPDATE ON v106_test.fixture_signer_watermarks
FOR EACH ROW EXECUTE FUNCTION v106_test.fixture_watermark_monotone();
REVOKE ALL ON v106_test.fixture_signer_watermarks FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE(authority_epoch,revocation_watermark,lease_sequence)
 ON v106_test.fixture_signer_watermarks TO v106_writer_a,v106_writer_b;
ALTER TABLE v106_test.fixture_signer_watermarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE v106_test.fixture_signer_watermarks FORCE ROW LEVEL SECURITY;
CREATE POLICY v121_wm_a ON v106_test.fixture_signer_watermarks FOR ALL TO v106_writer_a
 USING(organization_id='11111111-1111-4111-8111-111111111111'::uuid)
 WITH CHECK(organization_id='11111111-1111-4111-8111-111111111111'::uuid);
CREATE POLICY v121_wm_b ON v106_test.fixture_signer_watermarks FOR ALL TO v106_writer_b
 USING(organization_id='22222222-2222-4222-8222-222222222222'::uuid)
 WITH CHECK(organization_id='22222222-2222-4222-8222-222222222222'::uuid);

-- Test-only MAC admission gate, not an independent Ed25519 or IAM verifier.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE v106_test.fixture_receipt_attestation_secrets (
 organization_id uuid NOT NULL,
 key_version integer NOT NULL CHECK(key_version BETWEEN 1 AND 2147483647),
 attestation_key bytea NOT NULL CHECK(octet_length(attestation_key)=32),
 active boolean NOT NULL DEFAULT false,
 PRIMARY KEY(organization_id,key_version)
);
REVOKE ALL ON v106_test.fixture_receipt_attestation_secrets FROM PUBLIC;
CREATE UNIQUE INDEX fixture_attestation_one_active ON v106_test.fixture_receipt_attestation_secrets(organization_id) WHERE active IS TRUE;
CREATE FUNCTION v106_test.fixture_attestation_no_reactivation() RETURNS trigger
LANGUAGE plpgsql AS $rotate_gate$
BEGIN
 IF NEW.organization_id<>OLD.organization_id OR
    NEW.key_version<>OLD.key_version OR
    NEW.attestation_key<>OLD.attestation_key OR
    (OLD.active IS FALSE AND NEW.active IS TRUE) THEN
  RAISE EXCEPTION 'V121_ATTESTATION_KEY_IMMUTABLE';
 END IF;
 RETURN NEW;
END;
$rotate_gate$;
CREATE TRIGGER fixture_attestation_immutable BEFORE UPDATE ON v106_test.fixture_receipt_attestation_secrets
FOR EACH ROW EXECUTE FUNCTION v106_test.fixture_attestation_no_reactivation();


-- Fixture-only metadata audit. Does not store keys, MACs, or full receipts.
CREATE TABLE v106_test.fixture_receipt_key_audit (
 event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 organization_id uuid NOT NULL,
 key_version integer NOT NULL,
 event_kind text NOT NULL CHECK(event_kind IN ('KEY_ISSUED','KEY_REVOKED')),
 actor text NOT NULL,
 event_digest char(64) NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 UNIQUE(organization_id,key_version,event_kind)
);
REVOKE ALL ON v106_test.fixture_receipt_key_audit FROM PUBLIC;
GRANT SELECT ON v106_test.fixture_receipt_key_audit TO v106_audit_reader;
-- Deliberately grant no secret-table read, key modification, or receipt mutation to auditor.
CREATE FUNCTION v106_test.fixture_audit_key_transition() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,v106_test AS $audit_transition$
DECLARE kind text;
DECLARE metadata text;
BEGIN
 IF TG_OP='INSERT' THEN
  kind:='KEY_ISSUED';
 ELSIF TG_OP='UPDATE' AND OLD.active IS TRUE AND NEW.active IS FALSE THEN
  kind:='KEY_REVOKED';
 ELSE
  RETURN NEW;
 END IF;
 metadata:=NEW.organization_id::text||'|'||NEW.key_version::text||'|'||kind||'|'||session_user;
 INSERT INTO v106_test.fixture_receipt_key_audit
 (organization_id,key_version,event_kind,actor,event_digest)
 VALUES(NEW.organization_id,NEW.key_version,kind,session_user,
        encode(sha256(convert_to(metadata,'UTF8')),'hex'));
 RETURN NEW;
END;
$audit_transition$;
CREATE TRIGGER fixture_key_audit_events AFTER INSERT OR UPDATE
 ON v106_test.fixture_receipt_attestation_secrets FOR EACH ROW
 EXECUTE FUNCTION v106_test.fixture_audit_key_transition();
CREATE FUNCTION v106_test.fixture_key_audit_no_mutation() RETURNS trigger
LANGUAGE plpgsql AS $audit_immutable$
BEGIN
 RAISE EXCEPTION 'V121_KEY_AUDIT_APPEND_ONLY';
END;
$audit_immutable$;
CREATE TRIGGER fixture_key_audit_immutable BEFORE UPDATE OR DELETE
 ON v106_test.fixture_receipt_key_audit FOR EACH ROW
 EXECUTE FUNCTION v106_test.fixture_key_audit_no_mutation();

CREATE FUNCTION v106_test.fixture_append_negative_receipt(
 p_organization uuid,p_incident uuid,p_notice char(64),p_sequence integer,
 p_state text,p_previous char(64),p_digest char(64),p_payload text,p_attestation text,p_key_version integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,v106_test AS $receipt_gate$
DECLARE item jsonb;
DECLARE secret bytea;
DECLARE audit_count integer;
BEGIN
 IF session_user <> 'v106_receipt_writer_a' OR
    p_organization <> '11111111-1111-4111-8111-111111111111'::uuid THEN
  RAISE EXCEPTION 'V121_RECEIPT_GATE_ROLE_SCOPE';
 END IF;
 IF p_state NOT IN ('NEGATIVE_RECEIPT','COPY_NOT_RETRACTABLE') OR
    p_sequence NOT BETWEEN 1 AND 128 OR
    p_digest <> encode(sha256(convert_to(p_payload,'UTF8')),'hex') THEN
  RAISE EXCEPTION 'V121_RECEIPT_GATE_INVALID';
 END IF;
 BEGIN
  item:=p_payload::jsonb;
 EXCEPTION WHEN others THEN
  RAISE EXCEPTION 'V121_RECEIPT_GATE_INVALID_JSON';
 END;
 IF jsonb_typeof(item) <> 'object' OR
    item->>'organization_id' <> p_organization::text OR
    item->>'incident_id' <> p_incident::text OR
    item->>'notice_id' <> trim(p_notice) OR
    item->>'receipt_sequence' <> p_sequence::text OR
    item->>'receipt_state' <> p_state OR
    item->>'previous_digest' <> trim(p_previous) OR
    item#>>'{proof,signature_b64}' IS NULL OR
    item#>>'{proof,statement,signer_id}' IS NULL OR
    item#>>'{lease,signature_b64}' IS NULL OR
    item#>>'{lease,lease,signer_id}' <> item#>>'{proof,statement,signer_id}' OR
    item#>>'{lease,lease,notice_id}' <> trim(p_notice) THEN
  RAISE EXCEPTION 'V121_RECEIPT_GATE_ENVELOPE';
 END IF;
 IF p_key_version IS NULL OR p_key_version<1 THEN
  RAISE EXCEPTION 'V121_RECEIPT_KEY_VERSION_INVALID';
 END IF;
 SELECT attestation_key INTO secret FROM v106_test.fixture_receipt_attestation_secrets
 WHERE organization_id=p_organization AND key_version=p_key_version AND active IS TRUE;
 SELECT count(*) INTO audit_count
 FROM v106_test.fixture_receipt_key_audit aud
 WHERE aud.organization_id=p_organization AND aud.key_version=p_key_version
  AND aud.event_kind='KEY_ISSUED'
  AND aud.event_digest=encode(sha256(convert_to(
   aud.organization_id::text||'|'||aud.key_version::text||'|'||aud.event_kind||'|'||aud.actor,'UTF8')),'hex');
 IF audit_count<>1 THEN
  RAISE EXCEPTION 'V121_RECEIPT_KEY_AUDIT_UNVERIFIED';
 END IF;
 IF secret IS NULL OR p_attestation IS NULL OR
    p_attestation !~ '^[a-f0-9]{64}$' OR
    p_attestation <> encode(public.hmac(convert_to(p_payload,'UTF8'),secret,'sha256'),'hex') THEN
  RAISE EXCEPTION 'V121_RECEIPT_ATTESTATION_REJECTED';
 END IF;
 INSERT INTO v106_test.fixture_revocation_negative_receipts
 (organization_id,incident_id,notice_id,receipt_sequence,receipt_state,
  previous_digest,receipt_digest,receipt_payload)
 VALUES(p_organization,p_incident,p_notice,p_sequence,p_state,
        p_previous,p_digest,p_payload);
END;
$receipt_gate$;
REVOKE ALL ON FUNCTION v106_test.fixture_append_negative_receipt(
 uuid,uuid,char(64),integer,text,char(64),char(64),text,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION v106_test.fixture_append_negative_receipt(
 uuid,uuid,char(64),integer,text,char(64),char(64),text,text,integer) TO v106_receipt_writer_a;

-- Durable fixture consumption: unique requests and one recovery for each new key version.
-- Only fixture DB owner writes; no receipt, auditor or ordinary writer role gets INSERT.
CREATE TABLE v106_test.fixture_recovery_consumptions (
 organization_id uuid NOT NULL,
 incident_id uuid NOT NULL,
 request_id uuid NOT NULL,
 request_digest char(64) NOT NULL,
 key_version integer NOT NULL CHECK(key_version>=2),
 revocation_audit_digest char(64) NOT NULL,
 approver_audit_id uuid NOT NULL,
 approver_security_id uuid NOT NULL,
 anchor_source text NOT NULL CHECK(anchor_source='FIXTURE_SEPARATE_ARCHIVE'),
 hold_active boolean NOT NULL DEFAULT true CHECK(hold_active IS TRUE),
 consumed_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 PRIMARY KEY(organization_id,request_id),
 UNIQUE(organization_id,key_version),
 CHECK(approver_audit_id<>approver_security_id)
);
REVOKE ALL ON v106_test.fixture_recovery_consumptions FROM PUBLIC;
CREATE FUNCTION v106_test.fixture_recovery_no_mutation() RETURNS trigger
LANGUAGE plpgsql AS $recovery_immutable$
BEGIN
 RAISE EXCEPTION 'V121_RECOVERY_CONSUMPTION_IMMUTABLE';
END;
$recovery_immutable$;
CREATE TRIGGER fixture_recovery_immutable BEFORE UPDATE OR DELETE
 ON v106_test.fixture_recovery_consumptions FOR EACH ROW
 EXECUTE FUNCTION v106_test.fixture_recovery_no_mutation();

-- Separate fixture secret held by the test approval verifier, not the issuer role.
CREATE TABLE v106_test.fixture_recovery_approval_attestation (
 organization_id uuid PRIMARY KEY,
 approval_key bytea NOT NULL CHECK(octet_length(approval_key)=32)
);
REVOKE ALL ON v106_test.fixture_recovery_approval_attestation FROM PUBLIC;

-- SECURITY DEFINER fixture-only issuance gateway. The executing role has no table DML.
-- Ed25519 fixture approvals are checked in JS, NOT independently in PostgreSQL.
CREATE FUNCTION v106_test.fixture_issue_recovery_key(
 p_organization uuid,p_incident uuid,p_request uuid,p_digest char(64),
 p_version integer,p_revocation_digest char(64),
 p_audit_id uuid,p_security_id uuid,p_key bytea,p_approval_mac text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,v106_test AS $issue_gateway$
DECLARE predecessor record;
DECLARE audit_event record;
DECLARE latest integer;
DECLARE approval_secret bytea;
DECLARE approval_envelope text;
BEGIN
 IF session_user <> 'v106_key_issuer' OR
    p_organization <> '11111111-1111-4111-8111-111111111111'::uuid THEN
  RAISE EXCEPTION 'V121_ISSUER_ROLE_SCOPE_DENIED';
 END IF;
 IF p_version IS NULL OR p_version<2 OR
    p_digest IS NULL OR p_digest !~ '^[a-f0-9]{64}$' OR
    p_revocation_digest IS NULL OR p_revocation_digest !~ '^[a-f0-9]{64}$' OR
    p_audit_id=p_security_id OR p_key IS NULL OR octet_length(p_key)<>32 THEN
  RAISE EXCEPTION 'V121_ISSUANCE_ENVELOPE_INVALID';
 END IF;
 SELECT key_version,active INTO predecessor
 FROM v106_test.fixture_receipt_attestation_secrets
 WHERE organization_id=p_organization AND key_version=p_version-1 FOR UPDATE;
 IF NOT FOUND OR predecessor.active IS DISTINCT FROM false THEN
  RAISE EXCEPTION 'RECOVERY_PREVIOUS_KEY_NOT_REVOKED';
 END IF;
 SELECT event_digest,actor,event_kind,key_version INTO audit_event
 FROM v106_test.fixture_receipt_key_audit
 WHERE organization_id=p_organization AND key_version=p_version-1
  AND event_kind='KEY_REVOKED';
 IF NOT FOUND OR audit_event.event_digest<>p_revocation_digest THEN
  RAISE EXCEPTION 'RECOVERY_AUDIT_CHANGED';
 END IF;
 IF audit_event.event_digest<>encode(sha256(convert_to(
  p_organization::text||'|'||audit_event.key_version::text||'|'||
  audit_event.event_kind||'|'||audit_event.actor,'UTF8')),'hex') THEN
  RAISE EXCEPTION 'RECOVERY_AUDIT_TAMPERED';
 END IF;
 SELECT approval_key INTO approval_secret
 FROM v106_test.fixture_recovery_approval_attestation
 WHERE organization_id=p_organization;
 approval_envelope:='v121-recovery-attestation-v1|'||
  p_organization::text||'|'||p_incident::text||'|'||p_request::text||'|'||
  trim(p_digest)||'|'||p_version::text||'|'||trim(p_revocation_digest)||'|'||
  p_audit_id::text||'|'||p_security_id::text||'|'||
  encode(sha256(p_key),'hex');
 IF approval_secret IS NULL OR p_approval_mac IS NULL OR
    p_approval_mac !~ '^[a-f0-9]{64}
  WHERE organization_id=p_organization AND request_id=p_request) THEN
  RAISE EXCEPTION 'RECOVERY_ALREADY_CONSUMED';
 END IF;
 SELECT COALESCE(MAX(key_version),0) INTO latest
 FROM v106_test.fixture_receipt_attestation_secrets
 WHERE organization_id=p_organization;
 IF latest<>p_version-1 THEN RAISE EXCEPTION 'RECOVERY_VERSION_NOT_NEXT'; END IF;
 INSERT INTO v106_test.fixture_recovery_consumptions
 (organization_id,incident_id,request_id,request_digest,key_version,
  revocation_audit_digest,approver_audit_id,approver_security_id,anchor_source)
 VALUES(p_organization,p_incident,p_request,p_digest,p_version,p_revocation_digest,
        p_audit_id,p_security_id,'FIXTURE_SEPARATE_ARCHIVE');
 INSERT INTO v106_test.fixture_receipt_attestation_secrets
 (organization_id,key_version,attestation_key,active)
 VALUES(p_organization,p_version,p_key,true);
END;
$issue_gateway$;
REVOKE ALL ON FUNCTION v106_test.fixture_issue_recovery_key(
 uuid,uuid,uuid,char(64),integer,char(64),uuid,uuid,bytea,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION v106_test.fixture_issue_recovery_key(
 uuid,uuid,uuid,char(64),integer,char(64),uuid,uuid,bytea,text) TO v106_key_issuer;
 OR
    p_approval_mac <> encode(public.hmac(convert_to(approval_envelope,'UTF8'),
                                    approval_secret,'sha256'),'hex') THEN
  RAISE EXCEPTION 'V121_RECOVERY_APPROVAL_ATTESTATION_REJECTED';
 END IF;
 IF EXISTS (SELECT 1 FROM v106_test.fixture_recovery_consumptions
  WHERE organization_id=p_organization AND request_id=p_request) THEN
  RAISE EXCEPTION 'RECOVERY_ALREADY_CONSUMED';
 END IF;
 SELECT COALESCE(MAX(key_version),0) INTO latest
 FROM v106_test.fixture_receipt_attestation_secrets
 WHERE organization_id=p_organization;
 IF latest<>p_version-1 THEN RAISE EXCEPTION 'RECOVERY_VERSION_NOT_NEXT'; END IF;
 INSERT INTO v106_test.fixture_recovery_consumptions
 (organization_id,incident_id,request_id,request_digest,key_version,
  revocation_audit_digest,approver_audit_id,approver_security_id,anchor_source)
 VALUES(p_organization,p_incident,p_request,p_digest,p_version,p_revocation_digest,
        p_audit_id,p_security_id,'FIXTURE_SEPARATE_ARCHIVE');
 INSERT INTO v106_test.fixture_receipt_attestation_secrets
 (organization_id,key_version,attestation_key,active)
 VALUES(p_organization,p_version,p_key,true);
END;
$issue_gateway$;
REVOKE ALL ON FUNCTION v106_test.fixture_issue_recovery_key(
 uuid,uuid,uuid,char(64),integer,char(64),uuid,uuid,bytea,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION v106_test.fixture_issue_recovery_key(
 uuid,uuid,uuid,char(64),integer,char(64),uuid,uuid,bytea,text) TO v106_key_issuer;
