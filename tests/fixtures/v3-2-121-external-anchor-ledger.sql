-- CI-only second PostgreSQL database, separate from v106_isolated.
-- This is NOT independent WORM storage; postgres superuser controls both DBs.
CREATE SCHEMA v121_anchor;
REVOKE ALL ON SCHEMA v121_anchor FROM PUBLIC;
GRANT USAGE ON SCHEMA v121_anchor TO v121_anchor_reader,v121_anchor_writer,v121_anchor_attester;

CREATE FUNCTION v121_anchor.no_change() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 RAISE EXCEPTION 'V121_ANCHOR_LEDGER_IMMUTABLE';
END;
$$;

CREATE TABLE v121_anchor.signers (
 organization_id uuid NOT NULL,
 signer_id uuid NOT NULL,
 key_version integer NOT NULL CHECK(key_version>0),
 public_key_der bytea NOT NULL CHECK(octet_length(public_key_der)>24),
 PRIMARY KEY(organization_id,signer_id),
 UNIQUE(organization_id,key_version)
);
CREATE TRIGGER signer_immutable BEFORE UPDATE OR DELETE ON v121_anchor.signers
FOR EACH ROW EXECUTE FUNCTION v121_anchor.no_change();
REVOKE ALL ON v121_anchor.signers FROM PUBLIC;
GRANT SELECT ON v121_anchor.signers TO v121_anchor_reader;

CREATE TABLE v121_anchor.key_events (
 organization_id uuid NOT NULL,
 signer_id uuid NOT NULL,
 event_sequence integer NOT NULL CHECK(event_sequence>0),
 event_kind text NOT NULL CHECK(event_kind IN ('REGISTERED','RETIRED','REVOKED')),
 event_reason_digest char(64) NOT NULL CHECK(event_reason_digest ~ '^[a-f0-9]{64}$'),
 PRIMARY KEY(organization_id,signer_id,event_sequence),
 FOREIGN KEY(organization_id,signer_id)
 REFERENCES v121_anchor.signers(organization_id,signer_id)
);
CREATE FUNCTION v121_anchor.key_event_gate() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,v121_anchor AS $$
DECLARE seq integer;
DECLARE old_state text;
BEGIN
 -- A transaction-wide snapshot can observe a pre-revocation key after waiting.
 -- Fail closed: lifecycle transitions require READ COMMITTED visibility.
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'V121_ANCHOR_ISOLATION_UNSAFE';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(
  'v121-anchor-key|'||NEW.organization_id::text||'|'||NEW.signer_id::text,0));
 SELECT event_sequence,event_kind INTO seq,old_state
 FROM v121_anchor.key_events
 WHERE organization_id=NEW.organization_id AND signer_id=NEW.signer_id
 ORDER BY event_sequence DESC LIMIT 1;
 IF NEW.event_sequence<>COALESCE(seq,0)+1 OR
    (seq IS NULL AND NEW.event_kind<>'REGISTERED') OR
    (old_state='REGISTERED' AND NEW.event_kind NOT IN ('RETIRED','REVOKED')) OR
    (old_state='RETIRED' AND NEW.event_kind<>'REVOKED') OR
    old_state='REVOKED' THEN
  RAISE EXCEPTION 'V121_ANCHOR_KEY_TRANSITION_INVALID';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER key_event_before_insert BEFORE INSERT ON v121_anchor.key_events
FOR EACH ROW EXECUTE FUNCTION v121_anchor.key_event_gate();
CREATE TRIGGER key_event_immutable BEFORE UPDATE OR DELETE ON v121_anchor.key_events
FOR EACH ROW EXECUTE FUNCTION v121_anchor.no_change();
REVOKE ALL ON v121_anchor.key_events FROM PUBLIC;
GRANT SELECT ON v121_anchor.key_events TO v121_anchor_reader;


-- The independent fixture verifier signs a scoped one-use database admission
-- after Ed25519 verification; a writer role cannot issue this admission.
-- A separate CI-only security principal records one-way attester quarantine.
-- No role can lift quarantine; historical admissions and checkpoints are kept.
CREATE TABLE v121_anchor.attester_quarantine_events (
 organization_id uuid NOT NULL,
 event_id uuid NOT NULL,
 affected_failure_id uuid,
 event_kind text NOT NULL CHECK(event_kind IN (
  'ATTESTER_SIGNATURE_INVALID','UNEXPECTED_ATTESTATION','ATTESTER_CREDENTIAL_COMPROMISED'
 )),
 evidence_digest char(64) NOT NULL CHECK(evidence_digest ~ '^[a-f0-9]{64}$'),
 recorded_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 PRIMARY KEY(organization_id,event_id)
);
CREATE TRIGGER attester_quarantine_immutable BEFORE UPDATE OR DELETE
 ON v121_anchor.attester_quarantine_events FOR EACH ROW
 EXECUTE FUNCTION v121_anchor.no_change();
REVOKE ALL ON v121_anchor.attester_quarantine_events FROM PUBLIC;
GRANT SELECT ON v121_anchor.attester_quarantine_events TO v121_anchor_reader;

CREATE FUNCTION v121_anchor.report_attester_quarantine(
 p_org uuid,p_event uuid,p_failure uuid,p_kind text,p_evidence char(64))
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,v121_anchor AS $security_report$
BEGIN
 IF session_user<>'v121_anchor_security' OR
    p_org<>'11111111-1111-4111-8111-111111111111'::uuid THEN
  RAISE EXCEPTION 'V121_ANCHOR_SECURITY_ROLE_DENIED';
 END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'V121_ANCHOR_ISOLATION_UNSAFE';
 END IF;
 IF p_event IS NULL OR p_kind NOT IN (
  'ATTESTER_SIGNATURE_INVALID','UNEXPECTED_ATTESTATION',
  'ATTESTER_CREDENTIAL_COMPROMISED') OR
  p_evidence IS NULL OR p_evidence !~ '^[a-f0-9]{64}$' THEN
  RAISE EXCEPTION 'V121_ANCHOR_SECURITY_EVENT_INVALID';
 END IF;
 -- Shared first lock with admission and checkpoint paths. A report linearizes
 -- after already-committing writes or prevents later ones from proceeding.
 PERFORM pg_advisory_xact_lock(hashtextextended(
  'v121-attester-safety|'||p_org::text,0));
 INSERT INTO v121_anchor.attester_quarantine_events(
  organization_id,event_id,affected_failure_id,event_kind,evidence_digest)
 VALUES(p_org,p_event,p_failure,p_kind,p_evidence);
END;
$security_report$;
REVOKE ALL ON FUNCTION v121_anchor.report_attester_quarantine(
 uuid,uuid,uuid,text,char(64)) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION v121_anchor.report_attester_quarantine(
 uuid,uuid,uuid,text,char(64)) TO v121_anchor_security;

CREATE TABLE v121_anchor.verified_admissions (
 admission_id uuid NOT NULL,
 organization_id uuid NOT NULL,
 failure_id uuid NOT NULL,
 snapshot_sequence integer NOT NULL CHECK(snapshot_sequence>0),
 signer_id uuid NOT NULL,
 signed_statement jsonb NOT NULL,
 signature_b64 text NOT NULL CHECK(signature_b64 ~ '^[A-Za-z0-9+/]{86}==$'),
 observed_digest char(64) NOT NULL CHECK(observed_digest ~ '^[a-f0-9]{64}$'),
 issued_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 expires_at timestamptz NOT NULL DEFAULT (statement_timestamp()+interval '60 seconds'),
 CONSTRAINT admission_ttl_bounded CHECK(expires_at>issued_at AND expires_at<=issued_at+interval '60 seconds'),
 PRIMARY KEY(organization_id,admission_id),
 FOREIGN KEY(organization_id,signer_id)
  REFERENCES v121_anchor.signers(organization_id,signer_id)
);
CREATE TRIGGER admission_immutable BEFORE UPDATE OR DELETE
 ON v121_anchor.verified_admissions FOR EACH ROW
 EXECUTE FUNCTION v121_anchor.no_change();
REVOKE ALL ON v121_anchor.verified_admissions FROM PUBLIC;
GRANT SELECT ON v121_anchor.verified_admissions TO v121_anchor_reader;

CREATE FUNCTION v121_anchor.attest_verified_checkpoint(
 p_ticket uuid,p_org uuid,p_failure uuid,p_seq integer,p_signer uuid,
 p_statement jsonb,p_signature text,p_digest char(64))
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,v121_anchor AS $admission$
DECLARE
 latest_state text;
 last_seq integer;
BEGIN
 IF session_user<>'v121_anchor_attester' OR
    p_org<>'11111111-1111-4111-8111-111111111111'::uuid THEN
  RAISE EXCEPTION 'V121_ANCHOR_ATTESTER_ROLE_DENIED';
 END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'V121_ANCHOR_ISOLATION_UNSAFE';
 END IF;
 IF p_ticket IS NULL OR p_failure IS NULL OR p_signer IS NULL OR
    p_seq IS NULL OR p_seq<1 OR p_statement IS NULL OR
    p_signature IS NULL OR p_signature !~ '^[A-Za-z0-9+/]{86}==$' OR
    p_digest IS NULL OR p_digest !~ '^[a-f0-9]{64}$' THEN
  RAISE EXCEPTION 'V121_ANCHOR_ADMISSION_INVALID';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(
  'v121-attester-safety|'||p_org::text,0));
 IF EXISTS(SELECT 1 FROM v121_anchor.attester_quarantine_events e
  WHERE e.organization_id=p_org AND
   (e.affected_failure_id IS NULL OR e.affected_failure_id=p_failure)) THEN
  RAISE EXCEPTION 'V121_ATTESTER_QUARANTINED';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(
  'v121-checkpoint|'||p_org::text||'|'||p_failure::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended(
  'v121-anchor-key|'||p_org::text||'|'||p_signer::text,0));
 SELECT event_kind INTO latest_state FROM v121_anchor.key_events
 WHERE organization_id=p_org AND signer_id=p_signer
 ORDER BY event_sequence DESC LIMIT 1;
 IF latest_state IS DISTINCT FROM 'REGISTERED' THEN
  RAISE EXCEPTION 'V121_ANCHOR_KEY_NOT_ACTIVE';
 END IF;
 IF p_statement->>'organization_id' IS DISTINCT FROM p_org::text OR
    p_statement->>'failure_id' IS DISTINCT FROM p_failure::text OR
    p_statement->>'snapshot_sequence' IS DISTINCT FROM p_seq::text OR
    p_statement->>'signer_id' IS DISTINCT FROM p_signer::text OR
    p_statement->>'observed_digest' IS DISTINCT FROM trim(p_digest) THEN
  RAISE EXCEPTION 'V121_ANCHOR_ADMISSION_SCOPE_INVALID';
 END IF;
 SELECT MAX(snapshot_sequence) INTO last_seq FROM v121_anchor.checkpoints
 WHERE organization_id=p_org AND failure_id=p_failure;
 IF last_seq IS NOT NULL AND p_seq<>last_seq+1 THEN
  RAISE EXCEPTION 'V121_ANCHOR_CHECKPOINT_ROLLBACK';
 END IF;
 -- One active, unconsumed admission per signer+snapshot. Retain immutable
 -- expired records; a fresh attestation can be issued after expiration.
 IF EXISTS(
  SELECT 1 FROM v121_anchor.verified_admissions x
  WHERE x.organization_id=p_org AND x.failure_id=p_failure
    AND x.snapshot_sequence=p_seq AND x.signer_id=p_signer
    AND x.issued_at<=clock_timestamp() AND x.expires_at>clock_timestamp()
    AND NOT EXISTS(
     SELECT 1 FROM v121_anchor.checkpoints c
     WHERE c.organization_id=x.organization_id AND c.admission_id=x.admission_id)
 ) THEN
  RAISE EXCEPTION 'V121_ANCHOR_ADMISSION_DUPLICATE_ACTIVE';
 END IF;
 INSERT INTO v121_anchor.verified_admissions
  (admission_id,organization_id,failure_id,snapshot_sequence,signer_id,
   signed_statement,signature_b64,observed_digest)
 VALUES(p_ticket,p_org,p_failure,p_seq,p_signer,p_statement,p_signature,p_digest);
END;
$admission$;
REVOKE ALL ON FUNCTION v121_anchor.attest_verified_checkpoint(
 uuid,uuid,uuid,integer,uuid,jsonb,text,char(64)) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION v121_anchor.attest_verified_checkpoint(
 uuid,uuid,uuid,integer,uuid,jsonb,text,char(64)) TO v121_anchor_attester;

CREATE TABLE v121_anchor.checkpoints (
 organization_id uuid NOT NULL,
 failure_id uuid NOT NULL,
 snapshot_sequence integer NOT NULL CHECK(snapshot_sequence>0),
 signer_id uuid NOT NULL,
 signed_statement jsonb NOT NULL,
 signature_b64 text NOT NULL CHECK(signature_b64 ~ '^[A-Za-z0-9+/]{86}==$'),
 observed_digest char(64) NOT NULL CHECK(observed_digest ~ '^[a-f0-9]{64}$'),
 admission_id uuid NOT NULL,
 PRIMARY KEY(organization_id,failure_id,snapshot_sequence),
 UNIQUE(organization_id,admission_id),
 FOREIGN KEY(organization_id,admission_id)
 REFERENCES v121_anchor.verified_admissions(organization_id,admission_id),
 FOREIGN KEY(organization_id,signer_id)
 REFERENCES v121_anchor.signers(organization_id,signer_id)
);
CREATE FUNCTION v121_anchor.checkpoint_gate() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,v121_anchor AS $$
DECLARE seq integer;
DECLARE latest_state text;
DECLARE admitted record;
BEGIN
 -- Snapshot-isolation readers may reuse a pre-revocation state after lock wait.
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'V121_ANCHOR_ISOLATION_UNSAFE';
 END IF;
 -- Global order: checkpoint scope, then signing-key scope; key lifecycle
 -- changes acquire only the signing-key scope. This prevents a write from
 -- passing an earlier key-status read after a concurrent retirement/revocation.
 PERFORM pg_advisory_xact_lock(hashtextextended(
  'v121-attester-safety|'||NEW.organization_id::text,0));
 IF EXISTS(SELECT 1 FROM v121_anchor.attester_quarantine_events e
  WHERE e.organization_id=NEW.organization_id AND
   (e.affected_failure_id IS NULL OR e.affected_failure_id=NEW.failure_id)) THEN
  RAISE EXCEPTION 'V121_ATTESTER_QUARANTINED';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(
  'v121-checkpoint|'||NEW.organization_id::text||'|'||NEW.failure_id::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended(
  'v121-anchor-key|'||NEW.organization_id::text||'|'||NEW.signer_id::text,0));
 SELECT MAX(snapshot_sequence) INTO seq FROM v121_anchor.checkpoints
 WHERE organization_id=NEW.organization_id AND failure_id=NEW.failure_id;
 -- First anchor can refer to an existing business snapshot with sequence > 1.
 IF (seq IS NOT NULL AND NEW.snapshot_sequence<>seq+1) OR
    (seq IS NULL AND NEW.snapshot_sequence<1) THEN
  RAISE EXCEPTION 'V121_ANCHOR_CHECKPOINT_ROLLBACK';
 END IF;
 SELECT event_kind INTO latest_state FROM v121_anchor.key_events
 WHERE organization_id=NEW.organization_id AND signer_id=NEW.signer_id
 ORDER BY event_sequence DESC LIMIT 1;
 IF latest_state IS DISTINCT FROM 'REGISTERED' THEN
  RAISE EXCEPTION 'V121_ANCHOR_KEY_NOT_ACTIVE';
 END IF;
 SELECT * INTO admitted FROM v121_anchor.verified_admissions
 WHERE organization_id=NEW.organization_id AND admission_id=NEW.admission_id;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'V121_ANCHOR_ADMISSION_MISSING';
 END IF;
 IF admitted.issued_at>clock_timestamp() OR admitted.expires_at<=clock_timestamp() THEN
  RAISE EXCEPTION 'V121_ANCHOR_ADMISSION_EXPIRED';
 END IF;
 IF admitted.failure_id IS DISTINCT FROM NEW.failure_id OR
    admitted.snapshot_sequence IS DISTINCT FROM NEW.snapshot_sequence OR
    admitted.signer_id IS DISTINCT FROM NEW.signer_id OR
    admitted.signed_statement IS DISTINCT FROM NEW.signed_statement OR
    admitted.signature_b64 IS DISTINCT FROM NEW.signature_b64 OR
    admitted.observed_digest IS DISTINCT FROM NEW.observed_digest THEN
  RAISE EXCEPTION 'V121_ANCHOR_ADMISSION_MISMATCH';
 END IF;
 IF NEW.signed_statement->>'organization_id' IS DISTINCT FROM NEW.organization_id::text OR
    NEW.signed_statement->>'failure_id' IS DISTINCT FROM NEW.failure_id::text OR
    NEW.signed_statement->>'snapshot_sequence' IS DISTINCT FROM NEW.snapshot_sequence::text OR
    NEW.signed_statement->>'signer_id' IS DISTINCT FROM NEW.signer_id::text OR
    NEW.signed_statement->>'observed_digest' IS DISTINCT FROM trim(NEW.observed_digest) THEN
  RAISE EXCEPTION 'V121_ANCHOR_CHECKPOINT_SCOPE_INVALID';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER checkpoint_before_insert BEFORE INSERT ON v121_anchor.checkpoints
FOR EACH ROW EXECUTE FUNCTION v121_anchor.checkpoint_gate();
CREATE TRIGGER checkpoint_immutable BEFORE UPDATE OR DELETE ON v121_anchor.checkpoints
FOR EACH ROW EXECUTE FUNCTION v121_anchor.no_change();
REVOKE ALL ON v121_anchor.checkpoints FROM PUBLIC;
GRANT SELECT ON v121_anchor.checkpoints TO v121_anchor_reader;

-- Writer has no direct table DML, no access to registry or event controls.
CREATE FUNCTION v121_anchor.append_checkpoint(
 p_org uuid,p_failure uuid,p_seq integer,p_signer uuid,
 p_statement jsonb,p_signature text,p_digest char(64),p_ticket uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,v121_anchor AS $$
BEGIN
 IF session_user<>'v121_anchor_writer' OR
    p_org<>'11111111-1111-4111-8111-111111111111'::uuid THEN
  RAISE EXCEPTION 'V121_ANCHOR_WRITER_SCOPE_DENIED';
 END IF;
 INSERT INTO v121_anchor.checkpoints
  (organization_id,failure_id,snapshot_sequence,signer_id,
   signed_statement,signature_b64,observed_digest,admission_id)
 VALUES(p_org,p_failure,p_seq,p_signer,p_statement,p_signature,p_digest,p_ticket);
END;
$$;
REVOKE ALL ON FUNCTION v121_anchor.append_checkpoint(
 uuid,uuid,integer,uuid,jsonb,text,char(64),uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION v121_anchor.append_checkpoint(
 uuid,uuid,integer,uuid,jsonb,text,char(64),uuid) TO v121_anchor_writer;
