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
 organization_id uuid NOT NULL,
 attestation_version integer NOT NULL CHECK(attestation_version>=1),
 approval_key bytea NOT NULL CHECK(octet_length(approval_key)=32),
 active boolean NOT NULL DEFAULT false,
 PRIMARY KEY(organization_id,attestation_version)
);
REVOKE ALL ON v106_test.fixture_recovery_approval_attestation FROM PUBLIC;
CREATE UNIQUE INDEX fixture_one_active_recovery_approval_key
 ON v106_test.fixture_recovery_approval_attestation(organization_id) WHERE active IS TRUE;
CREATE FUNCTION v106_test.fixture_approval_key_no_reactivation() RETURNS trigger
LANGUAGE plpgsql AS $approval_immutable$
BEGIN
 IF NEW.organization_id<>OLD.organization_id OR
    NEW.attestation_version<>OLD.attestation_version OR
    NEW.approval_key<>OLD.approval_key OR
    (OLD.active IS FALSE AND NEW.active IS TRUE) THEN
  RAISE EXCEPTION 'V121_APPROVAL_KEY_IMMUTABLE';
 END IF;
 RETURN NEW;
END;
$approval_immutable$;
CREATE TRIGGER fixture_approval_key_immutable BEFORE UPDATE
 ON v106_test.fixture_recovery_approval_attestation FOR EACH ROW
 EXECUTE FUNCTION v106_test.fixture_approval_key_no_reactivation();
-- Disposable test-only clock. A real trusted service must use its own DB time.
CREATE TABLE v106_test.fixture_recovery_clock (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton IS TRUE),
 now_ms bigint NOT NULL CHECK(now_ms>=1)
);
INSERT INTO v106_test.fixture_recovery_clock(singleton,now_ms) VALUES(true,150);
REVOKE ALL ON v106_test.fixture_recovery_clock FROM PUBLIC;

-- Manual incident stop: administrator-owned fixture control, no business role can toggle.
CREATE TABLE v106_test.fixture_recovery_emergency_stops (
 organization_id uuid NOT NULL,
 incident_id uuid NOT NULL,
 issuance_blocked boolean NOT NULL DEFAULT true,
 PRIMARY KEY(organization_id,incident_id)
);
REVOKE ALL ON v106_test.fixture_recovery_emergency_stops FROM PUBLIC;

-- Isolated automatic incident reaction to explicit approval-key retirement.
-- Does NOT infer a compromise; revocation is an observable, admin-controlled signal.
CREATE TABLE v106_test.fixture_recovery_security_signals (
 organization_id uuid NOT NULL,
 incident_id uuid NOT NULL,
 attestation_version integer NOT NULL,
 signal_kind text NOT NULL CHECK(signal_kind='APPROVAL_KEY_REVOKED'),
 observed_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 PRIMARY KEY(organization_id,incident_id,attestation_version,signal_kind)
);
REVOKE ALL ON v106_test.fixture_recovery_security_signals FROM PUBLIC;
CREATE FUNCTION v106_test.fixture_stop_on_approval_key_retirement() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,v106_test AS $automatic_stop$
BEGIN
 IF OLD.active IS TRUE AND NEW.active IS FALSE THEN
  UPDATE v106_test.fixture_recovery_emergency_stops
   SET issuance_blocked=true
  WHERE organization_id=NEW.organization_id;
  INSERT INTO v106_test.fixture_recovery_security_signals
   (organization_id,incident_id,attestation_version,signal_kind)
  SELECT organization_id,incident_id,NEW.attestation_version,'APPROVAL_KEY_REVOKED'
  FROM v106_test.fixture_recovery_emergency_stops
  WHERE organization_id=NEW.organization_id
  ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END;
$automatic_stop$;
CREATE TRIGGER fixture_approval_key_automatic_stop AFTER UPDATE
 ON v106_test.fixture_recovery_approval_attestation FOR EACH ROW
 EXECUTE FUNCTION v106_test.fixture_stop_on_approval_key_retirement();
CREATE FUNCTION v106_test.fixture_security_signal_immutable() RETURNS trigger
LANGUAGE plpgsql AS $signal_immutable$
BEGIN
 RAISE EXCEPTION 'V121_SECURITY_SIGNAL_IMMUTABLE';
END;
$signal_immutable$;
CREATE TRIGGER fixture_security_signal_guard BEFORE UPDATE OR DELETE
 ON v106_test.fixture_recovery_security_signals FOR EACH ROW
 EXECUTE FUNCTION v106_test.fixture_security_signal_immutable();

-- SECURITY DEFINER fixture-only issuance gateway.
-- MAC is signed by disposable verifier after JS signature checks; DB checks MAC independently.
CREATE FUNCTION v106_test.fixture_issue_recovery_key(
 p_organization uuid,p_incident uuid,p_request uuid,p_digest char(64),
 p_version integer,p_revocation_digest char(64),
 p_audit_id uuid,p_security_id uuid,p_key bytea,p_approval_mac text,
 p_attestation_version integer,p_issued_at_ms bigint,p_expires_at_ms bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,v106_test AS $issue_gateway$
DECLARE predecessor record;
DECLARE audit_event record;
DECLARE latest integer;
DECLARE approval_secret bytea;
DECLARE approval_envelope text;
DECLARE fixture_now_ms bigint;
BEGIN
 IF session_user <> 'v106_key_issuer' OR
    p_organization <> '11111111-1111-4111-8111-111111111111'::uuid THEN
  RAISE EXCEPTION 'V121_ISSUER_ROLE_SCOPE_DENIED';
 END IF;
 IF p_version IS NULL OR p_version<2 OR
    p_digest IS NULL OR p_digest !~ '^[a-f0-9]{64}$' OR
    p_revocation_digest IS NULL OR p_revocation_digest !~ '^[a-f0-9]{64}$' OR
    p_audit_id IS NULL OR p_security_id IS NULL OR
    p_audit_id=p_security_id OR p_key IS NULL OR octet_length(p_key)<>32 THEN
  RAISE EXCEPTION 'V121_ISSUANCE_ENVELOPE_INVALID';
 END IF;
 IF NOT EXISTS (
  SELECT 1 FROM v106_test.fixture_recovery_emergency_stops
  WHERE organization_id=p_organization AND incident_id=p_incident
    AND issuance_blocked IS FALSE
 ) THEN
  RAISE EXCEPTION 'V121_ISSUANCE_EMERGENCY_STOP';
 END IF;
 -- Require the complete three-domain HOLD state before any attempted recovery.
 IF (SELECT count(*) FROM v106_test.fixture_cross_module_holds
     WHERE organization_id=p_organization AND incident_id=p_incident
       AND module_name IN ('SALES','FINANCE','ACADEMIC')
       AND hold_active IS TRUE AND release_eligible IS FALSE)<>3 THEN
  RAISE EXCEPTION 'V121_CROSS_MODULE_HOLD_INCOMPLETE';
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
 IF p_attestation_version IS NULL OR p_attestation_version<1 THEN
  RAISE EXCEPTION 'V121_APPROVAL_VERSION_INVALID';
 END IF;
 SELECT clock.now_ms INTO fixture_now_ms FROM v106_test.fixture_recovery_clock clock WHERE clock.singleton=true;
 IF fixture_now_ms IS NULL OR p_issued_at_ms IS NULL OR p_expires_at_ms IS NULL OR
   p_issued_at_ms<1 OR p_expires_at_ms<=p_issued_at_ms OR
   p_expires_at_ms-p_issued_at_ms>30000 OR
   fixture_now_ms<p_issued_at_ms OR fixture_now_ms>=p_expires_at_ms THEN
  RAISE EXCEPTION 'V121_RECOVERY_ATTESTATION_EXPIRED';
 END IF;
 SELECT approval_key INTO approval_secret
 FROM v106_test.fixture_recovery_approval_attestation
 WHERE organization_id=p_organization AND attestation_version=p_attestation_version
  AND active IS TRUE;
 approval_envelope:='v121-recovery-attestation-v2|'||
  p_attestation_version::text||'|'||p_issued_at_ms::text||'|'||p_expires_at_ms::text||'|'||
  p_organization::text||'|'||p_incident::text||'|'||p_request::text||'|'||
  trim(p_digest)||'|'||p_version::text||'|'||trim(p_revocation_digest)||'|'||
  p_audit_id::text||'|'||p_security_id::text||'|'||
  encode(sha256(p_key),'hex');
 IF approval_secret IS NULL OR p_approval_mac IS NULL OR
    p_approval_mac !~ '^[a-f0-9]{64}$' OR
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
 uuid,uuid,uuid,char(64),integer,char(64),uuid,uuid,bytea,text,integer,bigint,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION v106_test.fixture_issue_recovery_key(
 uuid,uuid,uuid,char(64),integer,char(64),uuid,uuid,bytea,text,integer,bigint,bigint) TO v106_key_issuer;

-- Explicit three-domain HOLD projection in disposable CI, not the real business modules.
-- No issuance/receipt gateway has a release path. DML guard prevents accidental releases.
CREATE TABLE v106_test.fixture_cross_module_holds (
 organization_id uuid NOT NULL,
 incident_id uuid NOT NULL,
 module_name text NOT NULL CHECK(module_name IN ('SALES','FINANCE','ACADEMIC')),
 hold_active boolean NOT NULL DEFAULT true CHECK(hold_active IS TRUE),
 release_eligible boolean NOT NULL DEFAULT false CHECK(release_eligible IS FALSE),
 release_reason text NOT NULL DEFAULT 'V121_UNVERIFIED_RECOVERY',
 PRIMARY KEY(organization_id,incident_id,module_name)
);
REVOKE ALL ON v106_test.fixture_cross_module_holds FROM PUBLIC;
CREATE FUNCTION v106_test.fixture_hold_no_mutation() RETURNS trigger
LANGUAGE plpgsql AS $cross_module_hold_guard$
BEGIN
 RAISE EXCEPTION 'V121_CROSS_MODULE_HOLD_IMMUTABLE';
END;
$cross_module_hold_guard$;
CREATE TRIGGER fixture_hold_immutable BEFORE UPDATE OR DELETE
 ON v106_test.fixture_cross_module_holds FOR EACH ROW
 EXECUTE FUNCTION v106_test.fixture_hold_no_mutation();

-- CI-only authenticated external-event inbox; no network integration or real SIEM.
CREATE TABLE v106_test.fixture_external_security_keys (
 organization_id uuid PRIMARY KEY,
 event_key bytea NOT NULL CHECK(octet_length(event_key)=32)
);
REVOKE ALL ON v106_test.fixture_external_security_keys FROM PUBLIC;
CREATE TABLE v106_test.fixture_external_security_events (
 organization_id uuid NOT NULL,
 incident_id uuid NOT NULL,
 event_id uuid NOT NULL,
 source text NOT NULL CHECK(source='FIXTURE_INDEPENDENT_MONITOR'),
 event_kind text NOT NULL CHECK(event_kind IN
 ('SIGNER_COMPROMISE','APPROVAL_ANOMALY','AUDIT_INTEGRITY_MISMATCH')),
 issued_at_ms bigint NOT NULL,
 event_digest char(64) NOT NULL,
 received_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 PRIMARY KEY(organization_id,event_id)
);
REVOKE ALL ON v106_test.fixture_external_security_events FROM PUBLIC;
CREATE TRIGGER fixture_external_event_immutable BEFORE UPDATE OR DELETE
 ON v106_test.fixture_external_security_events FOR EACH ROW
 EXECUTE FUNCTION v106_test.fixture_security_signal_immutable();

-- Once an independent alert is accepted, direct administrative unstop is blocked.
-- No production resolution workflow exists in this fixture; all three modules remain HOLD.
CREATE FUNCTION v106_test.fixture_prevent_uncleared_security_alert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,v106_test AS $alert_latch$
BEGIN
 IF OLD.issuance_blocked IS TRUE AND NEW.issuance_blocked IS FALSE AND
    EXISTS (SELECT 1 FROM v106_test.fixture_external_security_events
     WHERE organization_id=NEW.organization_id AND incident_id=NEW.incident_id) THEN
  RAISE EXCEPTION 'V121_SECURITY_ALERT_UNRESOLVED';
 END IF;
 RETURN NEW;
END;
$alert_latch$;
CREATE TRIGGER fixture_unresolved_security_alert BEFORE UPDATE
 ON v106_test.fixture_recovery_emergency_stops FOR EACH ROW
 EXECUTE FUNCTION v106_test.fixture_prevent_uncleared_security_alert();

CREATE FUNCTION v106_test.fixture_accept_external_security_event(
 p_organization uuid,p_incident uuid,p_event_id uuid,p_source text,
 p_kind text,p_issued_at_ms bigint,p_mac text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,v106_test AS $external_gate$
DECLARE secret bytea;
DECLARE fixture_now_ms bigint;
DECLARE envelope text;
BEGIN
 IF session_user<>'v106_security_event_writer' OR
    p_organization<>'11111111-1111-4111-8111-111111111111'::uuid THEN
  RAISE EXCEPTION 'V121_SECURITY_EVENT_ROLE_SCOPE';
 END IF;
 IF p_source IS DISTINCT FROM 'FIXTURE_INDEPENDENT_MONITOR' OR
    p_kind IS NULL OR p_kind NOT IN
    ('SIGNER_COMPROMISE','APPROVAL_ANOMALY','AUDIT_INTEGRITY_MISMATCH') THEN
  RAISE EXCEPTION 'V121_SECURITY_EVENT_KIND_INVALID';
 END IF;
 SELECT c.now_ms INTO fixture_now_ms
 FROM v106_test.fixture_recovery_clock c WHERE c.singleton=true;
 IF fixture_now_ms IS NULL OR p_issued_at_ms IS NULL OR
    p_issued_at_ms<fixture_now_ms-30000 OR p_issued_at_ms>fixture_now_ms+1000 THEN
  RAISE EXCEPTION 'V121_SECURITY_EVENT_EXPIRED';
 END IF;
 SELECT event_key INTO secret FROM v106_test.fixture_external_security_keys
 WHERE organization_id=p_organization;
 envelope:='v121-security-event-v1|'||p_organization::text||'|'||
  p_incident::text||'|'||p_event_id::text||'|'||p_source||'|'||
  p_kind||'|'||p_issued_at_ms::text;
 IF secret IS NULL OR p_mac IS NULL OR p_mac !~ '^[a-f0-9]{64}$' OR
  p_mac<>encode(public.hmac(convert_to(envelope,'UTF8'),secret,'sha256'),'hex') THEN
  RAISE EXCEPTION 'V121_SECURITY_EVENT_AUTH_REJECTED';
 END IF;
 -- Only registered incidents may be stopped; never silently accept an unknown scope.
 IF NOT EXISTS(SELECT 1 FROM v106_test.fixture_recovery_emergency_stops
  WHERE organization_id=p_organization AND incident_id=p_incident) THEN
  RAISE EXCEPTION 'V121_SECURITY_EVENT_UNKNOWN_INCIDENT';
 END IF;
 INSERT INTO v106_test.fixture_external_security_events
  (organization_id,incident_id,event_id,source,event_kind,issued_at_ms,event_digest)
 VALUES(p_organization,p_incident,p_event_id,p_source,p_kind,p_issued_at_ms,
  encode(sha256(convert_to(envelope,'UTF8')),'hex'));
 UPDATE v106_test.fixture_recovery_emergency_stops
  SET issuance_blocked=true
 WHERE organization_id=p_organization AND incident_id=p_incident;
END;
$external_gate$;
REVOKE ALL ON FUNCTION v106_test.fixture_accept_external_security_event(
 uuid,uuid,uuid,text,text,bigint,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION v106_test.fixture_accept_external_security_event(
 uuid,uuid,uuid,text,text,bigint,text) TO v106_security_event_writer;

-- Fixture-only two-role incident closeout review. Acceptance is NOT incident resolution.
CREATE TABLE v106_test.fixture_closeout_review_keys (
 organization_id uuid NOT NULL,
 reviewer_role text NOT NULL CHECK(reviewer_role IN ('SECURITY_REVIEW','AUDIT_REVIEW')),
 review_key bytea NOT NULL CHECK(octet_length(review_key)=32),
 PRIMARY KEY(organization_id,reviewer_role)
);
REVOKE ALL ON v106_test.fixture_closeout_review_keys FROM PUBLIC;
CREATE TABLE v106_test.fixture_closeout_reviews (
 organization_id uuid NOT NULL,
 incident_id uuid NOT NULL,
 event_id uuid NOT NULL,
 review_id uuid NOT NULL,
 event_digest char(64) NOT NULL,
 evidence_digest char(64) NOT NULL,
 security_reviewer uuid NOT NULL,
 audit_reviewer uuid NOT NULL,
 reviewed_at_ms bigint NOT NULL,
 review_status text NOT NULL DEFAULT 'REVIEWED_STILL_HOLD'
  CHECK(review_status='REVIEWED_STILL_HOLD'),
 hold_active boolean NOT NULL DEFAULT true CHECK(hold_active IS TRUE),
 release_eligible boolean NOT NULL DEFAULT false CHECK(release_eligible IS FALSE),
 PRIMARY KEY(organization_id,review_id),
 UNIQUE(organization_id,event_id),
 CHECK(security_reviewer<>audit_reviewer),
 FOREIGN KEY(organization_id,event_id)
  REFERENCES v106_test.fixture_external_security_events(organization_id,event_id)
);
REVOKE ALL ON v106_test.fixture_closeout_reviews FROM PUBLIC;
CREATE TRIGGER fixture_closeout_review_immutable BEFORE UPDATE OR DELETE
 ON v106_test.fixture_closeout_reviews FOR EACH ROW
 EXECUTE FUNCTION v106_test.fixture_security_signal_immutable();
CREATE FUNCTION v106_test.fixture_append_closeout_review(
 p_org uuid,p_incident uuid,p_event uuid,p_review uuid,
 p_event_digest char(64),p_evidence_digest char(64),
 p_security_reviewer uuid,p_audit_reviewer uuid,p_reviewed_ms bigint,
 p_security_mac text,p_audit_mac text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,v106_test AS $closeout_gate$
DECLARE actual_digest char(64);
DECLARE security_key bytea;
DECLARE audit_key bytea;
DECLARE envelope text;
DECLARE fixture_now_ms bigint;
BEGIN
 IF session_user <> 'v106_closeout_writer' OR
   p_org<>'11111111-1111-4111-8111-111111111111'::uuid THEN
  RAISE EXCEPTION 'V121_CLOSEOUT_ROLE_SCOPE';
 END IF;
 IF p_event IS NULL OR p_review IS NULL OR
    p_security_reviewer IS NULL OR p_audit_reviewer IS NULL OR
    p_security_reviewer=p_audit_reviewer OR
    p_event_digest IS NULL OR p_event_digest !~ '^[a-f0-9]{64}$' OR
    p_evidence_digest IS NULL OR p_evidence_digest !~ '^[a-f0-9]{64}$' OR
    p_evidence_digest=repeat('0',64) THEN
  RAISE EXCEPTION 'V121_CLOSEOUT_ENVELOPE_INVALID';
 END IF;
 SELECT ev.event_digest INTO actual_digest
 FROM v106_test.fixture_external_security_events ev
 WHERE ev.organization_id=p_org AND ev.incident_id=p_incident
  AND ev.event_id=p_event;
 IF actual_digest IS NULL OR actual_digest<>p_event_digest THEN
  RAISE EXCEPTION 'V121_CLOSEOUT_ALERT_UNVERIFIED';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM v106_test.fixture_recovery_emergency_stops st
   WHERE st.organization_id=p_org AND st.incident_id=p_incident
    AND st.issuance_blocked IS TRUE) THEN
  RAISE EXCEPTION 'V121_CLOSEOUT_HOLD_REQUIRED';
 END IF;
 IF (SELECT count(*) FROM v106_test.fixture_cross_module_holds h
   WHERE h.organization_id=p_org AND h.incident_id=p_incident
    AND h.module_name IN ('SALES','FINANCE','ACADEMIC')
    AND h.hold_active IS TRUE AND h.release_eligible IS FALSE)<>3 THEN
  RAISE EXCEPTION 'V121_CLOSEOUT_CROSS_MODULE_INCOMPLETE';
 END IF;
 SELECT c.now_ms INTO fixture_now_ms FROM v106_test.fixture_recovery_clock c
 WHERE c.singleton=true;
 IF fixture_now_ms IS NULL OR p_reviewed_ms IS NULL OR
    p_reviewed_ms>fixture_now_ms+1000 OR p_reviewed_ms<fixture_now_ms-30000 THEN
  RAISE EXCEPTION 'V121_CLOSEOUT_TIME_INVALID';
 END IF;
 SELECT review_key INTO security_key FROM v106_test.fixture_closeout_review_keys
 WHERE organization_id=p_org AND reviewer_role='SECURITY_REVIEW';
 SELECT review_key INTO audit_key FROM v106_test.fixture_closeout_review_keys
 WHERE organization_id=p_org AND reviewer_role='AUDIT_REVIEW';
 envelope:='v121-closeout-review-v1|'||p_org::text||'|'||p_incident::text||
   '|'||p_event::text||'|'||p_review::text||'|'||trim(p_event_digest)||
   '|'||trim(p_evidence_digest)||'|'||p_security_reviewer::text||
   '|'||p_audit_reviewer::text||'|'||p_reviewed_ms::text;
 IF security_key IS NULL OR audit_key IS NULL OR
    p_security_mac IS NULL OR p_audit_mac IS NULL OR
    p_security_mac !~ '^[a-f0-9]{64}$' OR p_audit_mac !~ '^[a-f0-9]{64}$' OR
    p_security_mac<>encode(public.hmac(convert_to('SECURITY_REVIEW|'||envelope,'UTF8'),security_key,'sha256'),'hex') OR
    p_audit_mac<>encode(public.hmac(convert_to('AUDIT_REVIEW|'||envelope,'UTF8'),audit_key,'sha256'),'hex') THEN
  RAISE EXCEPTION 'V121_CLOSEOUT_TWO_ROLE_SIGNATURE_REJECTED';
 END IF;
 INSERT INTO v106_test.fixture_closeout_reviews
 (organization_id,incident_id,event_id,review_id,event_digest,evidence_digest,
  security_reviewer,audit_reviewer,reviewed_at_ms)
 VALUES(p_org,p_incident,p_event,p_review,p_event_digest,p_evidence_digest,
        p_security_reviewer,p_audit_reviewer,p_reviewed_ms);
 -- Intentionally NO mutation to emergency stops or domain HOLDs.
END;
$closeout_gate$;
REVOKE ALL ON FUNCTION v106_test.fixture_append_closeout_review(
 uuid,uuid,uuid,uuid,char(64),char(64),uuid,uuid,bigint,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION v106_test.fixture_append_closeout_review(
 uuid,uuid,uuid,uuid,char(64),char(64),uuid,uuid,bigint,text,text)
 TO v106_closeout_writer;

-- UAT preparation evidence: append-only simulated checklist, not a release authorization.
CREATE TABLE v106_test.fixture_closeout_uat_evidence (
 organization_id uuid NOT NULL,
 incident_id uuid NOT NULL,
 event_id uuid NOT NULL,
 evidence_kind text NOT NULL CHECK(evidence_kind IN (
  'SOURCE_EVENT_AUTHENTICATED','AUDIT_CHAIN_RECONCILED',
  'REVOCATION_EFFECTS_RECONCILED','FINANCIAL_IMPACT_RECONCILED',
  'ACADEMIC_FULFILLMENT_RECONCILED')),
 evidence_digest char(64) NOT NULL CHECK(evidence_digest ~ '^[a-f0-9]{64}$' AND evidence_digest <> repeat('0',64)),
 responsible_domain text NOT NULL CHECK(responsible_domain IN ('SECURITY','AUDIT','SALES','FINANCE','ACADEMIC')),
 checked_by uuid NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 PRIMARY KEY(organization_id,event_id,evidence_kind),
 FOREIGN KEY(organization_id,event_id)
  REFERENCES v106_test.fixture_external_security_events(organization_id,event_id)
);
REVOKE ALL ON v106_test.fixture_closeout_uat_evidence FROM PUBLIC;
CREATE TRIGGER fixture_closeout_uat_evidence_immutable BEFORE UPDATE OR DELETE
 ON v106_test.fixture_closeout_uat_evidence FOR EACH ROW
 EXECUTE FUNCTION v106_test.fixture_security_signal_immutable();
-- A read-only diagnostic summary explicitly never authorizes release.
CREATE VIEW v106_test.fixture_closeout_uat_readiness AS
SELECT ev.organization_id,ev.incident_id,ev.event_id,
 (SELECT count(*)::integer FROM v106_test.fixture_closeout_uat_evidence e
   WHERE e.organization_id=ev.organization_id AND e.incident_id=ev.incident_id
     AND e.event_id=ev.event_id
     AND ((e.evidence_kind='SOURCE_EVENT_AUTHENTICATED' AND e.responsible_domain='SECURITY') OR
          (e.evidence_kind='AUDIT_CHAIN_RECONCILED' AND e.responsible_domain='AUDIT') OR
          (e.evidence_kind='REVOCATION_EFFECTS_RECONCILED' AND e.responsible_domain='SALES') OR
          (e.evidence_kind='FINANCIAL_IMPACT_RECONCILED' AND e.responsible_domain='FINANCE') OR
          (e.evidence_kind='ACADEMIC_FULFILLMENT_RECONCILED' AND e.responsible_domain='ACADEMIC'))
  ) AS evidence_count,
 (SELECT count(DISTINCT e.checked_by)::integer
  FROM v106_test.fixture_closeout_uat_evidence e
  WHERE e.organization_id=ev.organization_id AND e.incident_id=ev.incident_id
    AND e.event_id=ev.event_id) AS independent_reviewers,
 (SELECT count(*)::integer FROM v106_test.fixture_cross_module_holds h
  WHERE h.organization_id=ev.organization_id AND h.incident_id=ev.incident_id
   AND h.module_name IN ('SALES','FINANCE','ACADEMIC')
   AND h.hold_active IS TRUE AND h.release_eligible IS FALSE) AS held_domains,
 EXISTS(SELECT 1 FROM v106_test.fixture_recovery_emergency_stops st
  WHERE st.organization_id=ev.organization_id AND st.incident_id=ev.incident_id
   AND st.issuance_blocked IS TRUE) AS emergency_stop_active,
 EXISTS(SELECT 1 FROM v106_test.fixture_closeout_reviews rev
  WHERE rev.organization_id=ev.organization_id AND rev.incident_id=ev.incident_id
   AND rev.event_id=ev.event_id AND rev.review_status='REVIEWED_STILL_HOLD') AS dual_review_recorded,
 false::boolean AS release_eligible,
 true::boolean AS hold_active
FROM v106_test.fixture_external_security_events ev;
REVOKE ALL ON v106_test.fixture_closeout_uat_readiness FROM PUBLIC;

-- Append-only UAT failure / remediation / independent re-review, all CI-only.
-- A re-review never mutates the original failed check or permits release.
CREATE TABLE v106_test.fixture_uat_failures (
 organization_id uuid NOT NULL,
 incident_id uuid NOT NULL,
 event_id uuid NOT NULL,
 failure_id uuid NOT NULL,
 evidence_kind text NOT NULL,
 failed_evidence_digest char(64) NOT NULL CHECK(failed_evidence_digest ~ '^[a-f0-9]{64}$'),
 failed_by uuid NOT NULL,
 failure_reason text NOT NULL CHECK(failure_reason IN
  ('MISSING_EVIDENCE','WRONG_OWNER','CONFLICTING_EVIDENCE','REVIEW_REJECTED')),
 PRIMARY KEY(organization_id,failure_id),
 FOREIGN KEY(organization_id,event_id)
  REFERENCES v106_test.fixture_external_security_events(organization_id,event_id)
);
REVOKE ALL ON v106_test.fixture_uat_failures FROM PUBLIC;
CREATE TRIGGER fixture_uat_failures_immutable BEFORE UPDATE OR DELETE
 ON v106_test.fixture_uat_failures FOR EACH ROW
 EXECUTE FUNCTION v106_test.fixture_security_signal_immutable();

CREATE TABLE v106_test.fixture_uat_remediations (
 organization_id uuid NOT NULL,
 failure_id uuid NOT NULL,
 remediation_id uuid NOT NULL,
 remediation_version integer NOT NULL DEFAULT 1 CHECK(remediation_version>=1),
 new_evidence_digest char(64) NOT NULL CHECK(
  new_evidence_digest ~ '^[a-f0-9]{64}$' AND new_evidence_digest <> repeat('0',64)),
 remediated_by uuid NOT NULL,
 remediation_note_digest char(64) NOT NULL CHECK(remediation_note_digest ~ '^[a-f0-9]{64}$'),
 PRIMARY KEY(organization_id,remediation_id),
 UNIQUE(organization_id,failure_id,remediation_id),
 UNIQUE(organization_id,failure_id,remediation_version),
 FOREIGN KEY(organization_id,failure_id)
  REFERENCES v106_test.fixture_uat_failures(organization_id,failure_id)
);
REVOKE ALL ON v106_test.fixture_uat_remediations FROM PUBLIC;
-- Serialize attempts per incident failure to disallow version gaps and digest reuse.
CREATE FUNCTION v106_test.fixture_require_next_remediation_version() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,v106_test AS $version_gate$
DECLARE previous_version integer;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(
  NEW.organization_id::text||'|'||NEW.failure_id::text,0));
 SELECT COALESCE(MAX(remediation_version),0) INTO previous_version
 FROM v106_test.fixture_uat_remediations
 WHERE organization_id=NEW.organization_id AND failure_id=NEW.failure_id;
 IF NEW.remediation_version<>previous_version+1 THEN
  RAISE EXCEPTION 'V121_UAT_REMEDIATION_VERSION_NOT_NEXT';
 END IF;
 IF EXISTS(SELECT 1 FROM v106_test.fixture_uat_remediations
  WHERE organization_id=NEW.organization_id AND failure_id=NEW.failure_id
   AND new_evidence_digest=NEW.new_evidence_digest) THEN
  RAISE EXCEPTION 'V121_UAT_REMEDIATION_DIGEST_REUSED';
 END IF;
 RETURN NEW;
END;
$version_gate$;
CREATE TRIGGER fixture_uat_remediation_version_before_insert BEFORE INSERT
 ON v106_test.fixture_uat_remediations FOR EACH ROW
 EXECUTE FUNCTION v106_test.fixture_require_next_remediation_version();
CREATE TRIGGER fixture_uat_remediations_immutable BEFORE UPDATE OR DELETE
 ON v106_test.fixture_uat_remediations FOR EACH ROW
 EXECUTE FUNCTION v106_test.fixture_security_signal_immutable();

-- Scoped, retry-safe fixture admission. The natural idempotency key is remediation_id.
-- Returning ALREADY_RECORDED implies an exact match on the CURRENT version only.
CREATE FUNCTION v106_test.fixture_submit_uat_remediation(
 p_org uuid,p_failure uuid,p_remediation uuid,p_version integer,
 p_digest char(64),p_actor uuid,p_note char(64))
RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,v106_test AS $retry_remediation$
DECLARE existing record;
DECLARE incident_scope uuid;
DECLARE current_version integer;
BEGIN
 IF session_user<>'v106_closeout_writer' OR
    p_org<>'11111111-1111-4111-8111-111111111111'::uuid THEN
  RAISE EXCEPTION 'V121_REMEDIATION_ROLE_DENIED';
 END IF;
 IF p_failure IS NULL OR p_remediation IS NULL OR p_actor IS NULL OR
    p_version IS NULL OR p_version<1 OR
    p_digest IS NULL OR p_digest !~ '^[a-f0-9]{64}$' OR
    p_digest=repeat('0',64) OR
    p_note IS NULL OR p_note !~ '^[a-f0-9]{64}$' THEN
  RAISE EXCEPTION 'V121_REMEDIATION_INPUT_INVALID';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(
  p_org::text||'|'||p_failure::text,0));
 SELECT incident_id INTO incident_scope FROM v106_test.fixture_uat_failures
 WHERE organization_id=p_org AND failure_id=p_failure;
 IF incident_scope IS NULL THEN
  RAISE EXCEPTION 'V121_REMEDIATION_FAILURE_MISSING';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM v106_test.fixture_recovery_emergency_stops
  WHERE organization_id=p_org AND incident_id=incident_scope
   AND issuance_blocked IS TRUE) THEN
  RAISE EXCEPTION 'V121_REMEDIATION_HOLD_REQUIRED';
 END IF;
 SELECT COALESCE(MAX(remediation_version),0) INTO current_version
 FROM v106_test.fixture_uat_remediations
 WHERE organization_id=p_org AND failure_id=p_failure;
 SELECT * INTO existing FROM v106_test.fixture_uat_remediations
 WHERE organization_id=p_org AND remediation_id=p_remediation;
 IF FOUND THEN
  IF existing.failure_id<>p_failure OR existing.remediation_version<>p_version OR
     existing.new_evidence_digest<>p_digest OR existing.remediated_by<>p_actor OR
     existing.remediation_note_digest<>p_note THEN
   RAISE EXCEPTION 'V121_REMEDIATION_IDEMPOTENCY_CONFLICT';
  END IF;
  IF existing.remediation_version<>current_version THEN
   RAISE EXCEPTION 'V121_UAT_REMEDIATION_SUPERSEDED';
  END IF;
  RETURN 'ALREADY_RECORDED';
 END IF;
 IF p_version<>current_version+1 THEN
  RAISE EXCEPTION 'V121_UAT_REMEDIATION_VERSION_NOT_NEXT';
 END IF;
 INSERT INTO v106_test.fixture_uat_remediations
  (organization_id,failure_id,remediation_id,remediation_version,
   new_evidence_digest,remediated_by,remediation_note_digest)
 VALUES(p_org,p_failure,p_remediation,p_version,p_digest,p_actor,p_note);
 RETURN 'RECORDED';
END;
$retry_remediation$;
REVOKE ALL ON FUNCTION v106_test.fixture_submit_uat_remediation(
 uuid,uuid,uuid,integer,char(64),uuid,char(64)) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION v106_test.fixture_submit_uat_remediation(
 uuid,uuid,uuid,integer,char(64),uuid,char(64)) TO v106_closeout_writer;

CREATE TABLE v106_test.fixture_uat_remediation_reviews (
 organization_id uuid NOT NULL,
 remediation_id uuid NOT NULL,
 reviewer_id uuid NOT NULL,
 reviewer_domain text NOT NULL CHECK(reviewer_domain IN ('SECURITY','AUDIT')),
 decision text NOT NULL CHECK(decision IN ('ACCEPTED_FOR_REVIEW','REJECTED')),
 review_evidence_digest char(64) NOT NULL CHECK(review_evidence_digest ~ '^[a-f0-9]{64}$'),
 hold_active boolean NOT NULL DEFAULT true CHECK(hold_active IS TRUE),
 release_eligible boolean NOT NULL DEFAULT false CHECK(release_eligible IS FALSE),
 PRIMARY KEY(organization_id,remediation_id,reviewer_domain),
 FOREIGN KEY(organization_id,remediation_id)
  REFERENCES v106_test.fixture_uat_remediations(organization_id,remediation_id)
);
REVOKE ALL ON v106_test.fixture_uat_remediation_reviews FROM PUBLIC;
CREATE TRIGGER fixture_uat_remediation_reviews_immutable BEFORE UPDATE OR DELETE
 ON v106_test.fixture_uat_remediation_reviews FOR EACH ROW
 EXECUTE FUNCTION v106_test.fixture_security_signal_immutable();

CREATE FUNCTION v106_test.fixture_record_uat_remediation_review(
 p_org uuid,p_remediation uuid,p_reviewer uuid,p_domain text,
 p_decision text,p_digest char(64))
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,v106_test AS $remediation_review$
DECLARE owner_id uuid;
DECLARE original_reviewer uuid;
DECLARE other_reviewer uuid;
DECLARE i uuid;
DECLARE failure_for_lock uuid;
DECLARE recorded_review record;
BEGIN
 IF session_user<>'v106_closeout_writer' OR
   p_org<>'11111111-1111-4111-8111-111111111111'::uuid THEN
  RAISE EXCEPTION 'V121_UAT_REVIEW_ROLE_DENIED';
 END IF;
 IF p_domain IS NULL OR p_domain NOT IN ('SECURITY','AUDIT') OR
   p_decision IS NULL OR p_decision NOT IN ('ACCEPTED_FOR_REVIEW','REJECTED') OR
   p_digest IS NULL OR p_digest !~ '^[a-f0-9]{64}$' OR
   p_reviewer IS NULL THEN
  RAISE EXCEPTION 'V121_UAT_REVIEW_INVALID';
 END IF;
 -- Serialize a review with any competing new remediation for the same failure.
 -- Pre-read only resolves the lock scope; repeat authoritative checks after acquiring it.
 SELECT failure_id INTO failure_for_lock
 FROM v106_test.fixture_uat_remediations
 WHERE organization_id=p_org AND remediation_id=p_remediation;
 IF failure_for_lock IS NULL THEN
  RAISE EXCEPTION 'V121_UAT_REMEDIATION_NOT_FOUND';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(
  p_org::text||'|'||failure_for_lock::text,0));
 SELECT r.remediated_by,f.failed_by,f.incident_id
 INTO owner_id,original_reviewer,i
 FROM v106_test.fixture_uat_remediations r
 JOIN v106_test.fixture_uat_failures f ON
  f.organization_id=r.organization_id AND f.failure_id=r.failure_id
 WHERE r.organization_id=p_org AND r.remediation_id=p_remediation;
 IF owner_id IS NULL THEN
  RAISE EXCEPTION 'V121_UAT_REMEDIATION_NOT_FOUND';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM v106_test.fixture_uat_remediations r
  WHERE r.organization_id=p_org AND r.remediation_id=p_remediation
   AND r.remediation_version=(SELECT MAX(latest.remediation_version)
    FROM v106_test.fixture_uat_remediations latest
    WHERE latest.organization_id=r.organization_id AND latest.failure_id=r.failure_id)) THEN
  RAISE EXCEPTION 'V121_UAT_REMEDIATION_SUPERSEDED';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM v106_test.fixture_uat_remediations r
  WHERE r.organization_id=p_org AND r.remediation_id=p_remediation
   AND r.new_evidence_digest=p_digest) THEN
  RAISE EXCEPTION 'V121_UAT_REVIEW_EVIDENCE_MISMATCH';
 END IF;
 IF NOT EXISTS(
  SELECT 1 FROM v106_test.fixture_recovery_emergency_stops
  WHERE organization_id=p_org AND incident_id=i AND issuance_blocked IS TRUE
 ) THEN RAISE EXCEPTION 'V121_UAT_REVIEW_HOLD_REQUIRED'; END IF;
 SELECT * INTO recorded_review FROM v106_test.fixture_uat_remediation_reviews
 WHERE organization_id=p_org AND remediation_id=p_remediation
  AND reviewer_domain=p_domain;
 IF FOUND THEN
  IF recorded_review.reviewer_id=p_reviewer AND
     recorded_review.decision=p_decision AND
     recorded_review.review_evidence_digest=p_digest THEN
   RETURN; -- Exact replay, no second append or changed authority.
  END IF;
  RAISE EXCEPTION 'V121_UAT_REVIEW_IDEMPOTENCY_CONFLICT';
 END IF;
 IF p_reviewer=owner_id OR p_reviewer=original_reviewer OR EXISTS(
  SELECT 1 FROM v106_test.fixture_uat_remediation_reviews
  WHERE organization_id=p_org AND remediation_id=p_remediation
    AND reviewer_id=p_reviewer) THEN
  RAISE EXCEPTION 'V121_UAT_REVIEWER_NOT_INDEPENDENT';
 END IF;
 INSERT INTO v106_test.fixture_uat_remediation_reviews
 (organization_id,remediation_id,reviewer_id,reviewer_domain,decision,review_evidence_digest)
 VALUES(p_org,p_remediation,p_reviewer,p_domain,p_decision,p_digest);
END;
$remediation_review$;
REVOKE ALL ON FUNCTION v106_test.fixture_record_uat_remediation_review(
 uuid,uuid,uuid,text,text,char(64)) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION v106_test.fixture_record_uat_remediation_review(
 uuid,uuid,uuid,text,text,char(64)) TO v106_closeout_writer;

-- Diagnostics count ONLY the latest attempt's review decisions; old approvals never carry.
CREATE VIEW v106_test.fixture_uat_remediation_diagnostics AS
SELECT f.organization_id,f.incident_id,f.event_id,f.failure_id,
 (SELECT count(*)::integer FROM v106_test.fixture_uat_remediations r
  WHERE r.organization_id=f.organization_id AND r.failure_id=f.failure_id) AS attempts,
 latest.remediation_version AS latest_version,
 latest.remediation_id AS latest_remediation_id,
 (SELECT count(*)::integer FROM v106_test.fixture_uat_remediation_reviews rv
  WHERE rv.organization_id=f.organization_id
   AND rv.remediation_id=latest.remediation_id
   AND rv.decision='ACCEPTED_FOR_REVIEW') AS accepted_review_roles,
 true::boolean AS original_failure_retained,
 true::boolean AS hold_active,false::boolean AS release_eligible
FROM v106_test.fixture_uat_failures f
LEFT JOIN LATERAL(
 SELECT r.remediation_id,r.remediation_version FROM v106_test.fixture_uat_remediations r
 WHERE r.organization_id=f.organization_id AND r.failure_id=f.failure_id
 ORDER BY r.remediation_version DESC LIMIT 1
) latest ON TRUE;
REVOKE ALL ON v106_test.fixture_uat_remediation_diagnostics FROM PUBLIC;
