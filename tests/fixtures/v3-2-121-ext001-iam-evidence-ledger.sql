-- EXT-001: CI-only second-database IAM evidence receipt simulation.
-- No real production evidence or ability to lift quarantine is stored here.
GRANT USAGE ON SCHEMA v121_anchor TO
 v121_iam_intake_writer,v121_iam_intake_reader,v121_iam_revoker,v121_iam_provenance_attester;


-- Independent fixture provenance: only the separate byte-verifying attester
-- can create this immutable receipt prerequisite. No source bytes stored.
CREATE TABLE v121_anchor.fixture_iam_provenance_proofs(
 organization_id uuid NOT NULL,
 gap_id text NOT NULL CHECK(gap_id='EXT-001'),
 revision_no integer NOT NULL CHECK(revision_no>0),
 revision_id uuid NOT NULL,
 receipt_id uuid NOT NULL,
 envelope_digest char(64) NOT NULL CHECK(envelope_digest ~ '^[a-f0-9]{64}$'),
 evidence_e1_digest char(64) NOT NULL CHECK(evidence_e1_digest ~ '^[a-f0-9]{64}$'),
 evidence_e2_digest char(64) NOT NULL CHECK(evidence_e2_digest ~ '^[a-f0-9]{64}$'),
 issuer_id uuid NOT NULL,
 reviewer_id uuid NOT NULL CHECK(issuer_id<>reviewer_id),
 issuer_signature_digest char(64) NOT NULL CHECK(issuer_signature_digest ~ '^[a-f0-9]{64}$'),
 reviewer_signature_digest char(64) NOT NULL CHECK(reviewer_signature_digest ~ '^[a-f0-9]{64}$'),
 expires_at timestamptz NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organization_id,gap_id,revision_no),
 UNIQUE(organization_id,revision_id),
 UNIQUE(organization_id,receipt_id),
 CHECK(evidence_e1_digest<>evidence_e2_digest),
 CHECK(issuer_signature_digest<>reviewer_signature_digest),
 CHECK(expires_at>recorded_at)
);
CREATE TRIGGER fixture_iam_provenance_immutable
 BEFORE UPDATE OR DELETE ON v121_anchor.fixture_iam_provenance_proofs
 FOR EACH ROW EXECUTE FUNCTION v121_anchor.no_change();
REVOKE ALL ON v121_anchor.fixture_iam_provenance_proofs FROM PUBLIC;

CREATE FUNCTION v121_anchor.fixture_attest_iam_provenance(
 p_org uuid,p_revision integer,p_revision_id uuid,p_receipt uuid,
 p_envelope_digest char(64),p_e1 char(64),p_e2 char(64),p_issuer uuid,
 p_reviewer uuid,p_issuer_sig char(64),p_reviewer_sig char(64),
 p_expires timestamptz
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,v121_anchor AS $iam_attest$
DECLARE existing record;
DECLARE latest integer;
BEGIN
 -- Postgres fixture administrator may seed historical legacy proofs for
 -- regression only; the attester login cannot invoke this helper directly.
 IF session_user NOT IN ('v121_iam_provenance_attester','postgres') OR
    p_org<>'11111111-1111-4111-8111-111111111111'::uuid THEN
  RAISE EXCEPTION 'V121_IAM_PROVENANCE_ROLE_DENIED';
 END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'V121_IAM_ISOLATION_UNSAFE';
 END IF;
 IF p_revision IS NULL OR p_revision<1 OR
    p_revision_id IS NULL OR p_receipt IS NULL OR
    p_issuer IS NULL OR p_reviewer IS NULL OR p_issuer=p_reviewer OR
    p_envelope_digest IS NULL OR trim(p_envelope_digest) !~ '^[a-f0-9]{64}$' OR
    p_e1 IS NULL OR trim(p_e1) !~ '^[a-f0-9]{64}$' OR
    p_e2 IS NULL OR trim(p_e2) !~ '^[a-f0-9]{64}$' OR p_e1=p_e2 OR
    p_issuer_sig IS NULL OR trim(p_issuer_sig) !~ '^[a-f0-9]{64}$' OR
    p_reviewer_sig IS NULL OR trim(p_reviewer_sig) !~ '^[a-f0-9]{64}$' OR
    p_issuer_sig=p_reviewer_sig OR p_expires IS NULL THEN
  RAISE EXCEPTION 'V121_IAM_PROVENANCE_INVALID';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(
  'v121-iam-evidence|'||p_org::text||'|EXT-001',0));
 SELECT MAX(revision_no) INTO latest FROM v121_anchor.fixture_iam_evidence_receipts
 WHERE organization_id=p_org AND gap_id='EXT-001';
 SELECT * INTO existing FROM v121_anchor.fixture_iam_provenance_proofs
 WHERE organization_id=p_org AND gap_id='EXT-001' AND revision_no=p_revision;
 IF FOUND THEN
  IF existing.revision_id<>p_revision_id OR existing.receipt_id<>p_receipt OR
     existing.envelope_digest<>p_envelope_digest OR
     existing.evidence_e1_digest<>p_e1 OR existing.evidence_e2_digest<>p_e2 OR
     existing.issuer_id<>p_issuer OR existing.reviewer_id<>p_reviewer OR
     existing.issuer_signature_digest<>p_issuer_sig OR
     existing.reviewer_signature_digest<>p_reviewer_sig OR
     existing.expires_at<>p_expires THEN
   RAISE EXCEPTION 'V121_IAM_PROVENANCE_CONFLICT';
  END IF;
  IF existing.expires_at<=clock_timestamp() OR
     p_revision<>COALESCE(latest,0)+1 THEN
   RAISE EXCEPTION 'V121_IAM_PROVENANCE_NOT_CURRENT';
  END IF;
  RETURN 'EXACT_PROVENANCE_RETRY_STILL_HOLD';
 END IF;
 IF p_revision<>COALESCE(latest,0)+1 THEN
  RAISE EXCEPTION 'V121_IAM_PROVENANCE_REVISION_INVALID';
 END IF;
 IF p_expires<=clock_timestamp() OR p_expires>clock_timestamp()+interval '1 hour' THEN
  RAISE EXCEPTION 'V121_IAM_PROVENANCE_EXPIRED';
 END IF;
 INSERT INTO v121_anchor.fixture_iam_provenance_proofs(
  organization_id,gap_id,revision_no,revision_id,receipt_id,
  envelope_digest,evidence_e1_digest,evidence_e2_digest,
  issuer_id,reviewer_id,issuer_signature_digest,reviewer_signature_digest,expires_at)
 VALUES(p_org,'EXT-001',p_revision,p_revision_id,p_receipt,
  p_envelope_digest,p_e1,p_e2,p_issuer,p_reviewer,p_issuer_sig,p_reviewer_sig,p_expires);
 RETURN 'ATTESTED_SYNTHETIC_STILL_HOLD';
END;
$iam_attest$;
REVOKE ALL ON FUNCTION v121_anchor.fixture_attest_iam_provenance(
 uuid,integer,uuid,uuid,char(64),char(64),char(64),uuid,uuid,char(64),char(64),timestamptz)
 FROM PUBLIC;
-- Intentionally no EXECUTE grant for v121_iam_provenance_attester:
-- source-aware SECURITY DEFINER can call this internal helper as owner;
-- the attester session itself cannot bypass a verified source MAC.
-- Only the test-only postgres owner seeds the pre-cutover legacy history.

-- Private CI-only verifier key, unavailable to the SQL attester role.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE v121_anchor.fixture_iam_source_auth_keys(
 organization_id uuid NOT NULL,
 key_version integer NOT NULL CHECK(key_version>0),
 auth_key bytea NOT NULL CHECK(octet_length(auth_key)=32),
 active boolean NOT NULL DEFAULT true,
 PRIMARY KEY(organization_id,key_version)
);
REVOKE ALL ON v121_anchor.fixture_iam_source_auth_keys FROM PUBLIC;
CREATE UNIQUE INDEX fixture_iam_source_one_active_key
 ON v121_anchor.fixture_iam_source_auth_keys(organization_id)
 WHERE active IS TRUE;
CREATE FUNCTION v121_anchor.fixture_iam_source_key_rotation_guard()
RETURNS trigger LANGUAGE plpgsql AS $iam_key_guard$
BEGIN
 IF TG_OP='DELETE' OR
    (TG_OP='UPDATE' AND (
      NEW.organization_id<>OLD.organization_id OR
      NEW.key_version<>OLD.key_version OR
      NEW.auth_key<>OLD.auth_key OR
      (OLD.active=false AND NEW.active=true))) THEN
  RAISE EXCEPTION 'V121_IAM_SOURCE_KEY_IMMUTABLE';
 END IF;
 RETURN NEW;
END;
$iam_key_guard$;
CREATE TRIGGER fixture_iam_source_keys_immutable
 BEFORE UPDATE OR DELETE ON v121_anchor.fixture_iam_source_auth_keys
 FOR EACH ROW EXECUTE FUNCTION v121_anchor.fixture_iam_source_key_rotation_guard();
REVOKE ALL ON FUNCTION v121_anchor.fixture_iam_source_key_rotation_guard() FROM PUBLIC;

-- CI-only binding of exact signed source witness and object-version proof.
-- Content and signatures are hashed; no evidence bytes or secrets stored.
CREATE TABLE v121_anchor.fixture_iam_source_bindings(
 organization_id uuid NOT NULL,
 gap_id text NOT NULL CHECK(gap_id='EXT-001'),
 revision_no integer NOT NULL CHECK(revision_no>0),
 source_binding_digest char(64) NOT NULL
  CHECK(source_binding_digest ~ '^[a-f0-9]{64}$'),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organization_id,gap_id,revision_no),
 FOREIGN KEY(organization_id,gap_id,revision_no)
 REFERENCES v121_anchor.fixture_iam_provenance_proofs(
  organization_id,gap_id,revision_no)
);
CREATE TRIGGER fixture_iam_source_binding_immutable
 BEFORE UPDATE OR DELETE ON v121_anchor.fixture_iam_source_bindings
 FOR EACH ROW EXECUTE FUNCTION v121_anchor.no_change();
REVOKE ALL ON v121_anchor.fixture_iam_source_bindings FROM PUBLIC;

-- Records source binding and primary provenance in one SQL statement.
-- Synthetic role scope is enforced, but PostgreSQL does not verify Ed25519.
CREATE FUNCTION v121_anchor.fixture_attest_iam_source_provenance(
 p_org uuid,p_revision integer,p_revision_id uuid,p_receipt uuid,
 p_envelope_digest char(64),p_e1 char(64),p_e2 char(64),p_issuer uuid,
 p_reviewer uuid,p_issuer_sig char(64),p_reviewer_sig char(64),
 p_expires timestamptz,p_source_digest char(64),
 p_key_version integer,p_source_mac char(64)
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,v121_anchor AS $iam_source$
DECLARE prior text;
DECLARE old_digest char(64);
DECLARE secret bytea;
DECLARE signed_material text;
BEGIN
 IF session_user<>'v121_iam_provenance_attester' OR
    p_org<>'11111111-1111-4111-8111-111111111111'::uuid THEN
  RAISE EXCEPTION 'V121_IAM_SOURCE_ATTESTER_ROLE_DENIED';
 END IF;
 IF p_source_digest IS NULL OR
    trim(p_source_digest) !~ '^[a-f0-9]{64}$' THEN
  RAISE EXCEPTION 'V121_IAM_SOURCE_BINDING_INVALID';
 END IF;
 IF p_key_version IS NULL OR p_key_version<1 OR
    p_source_mac IS NULL OR trim(p_source_mac) !~ '^[a-f0-9]{64}$' THEN
  RAISE EXCEPTION 'V121_IAM_SOURCE_AUTH_DENIED';
 END IF;
 SELECT auth_key INTO secret FROM v121_anchor.fixture_iam_source_auth_keys
 WHERE organization_id=p_org AND key_version=p_key_version AND active=true;
 signed_material:=concat_ws('|',
  'v121-ext001-source-auth-v1',p_key_version::text,p_org::text,p_revision::text,
  p_revision_id::text,p_receipt::text,trim(p_envelope_digest),trim(p_e1),
  trim(p_e2),p_issuer::text,p_reviewer::text,trim(p_issuer_sig),
  trim(p_reviewer_sig),
  (round(extract(epoch from p_expires)*1000)::bigint)::text,
  trim(p_source_digest));
 IF secret IS NULL OR trim(p_source_mac) <>
    encode(public.hmac(convert_to(signed_material,'UTF8'),secret,'sha256'),'hex') THEN
  RAISE EXCEPTION 'V121_IAM_SOURCE_AUTH_DENIED';
 END IF;
 prior:=v121_anchor.fixture_attest_iam_provenance(
  p_org,p_revision,p_revision_id,p_receipt,p_envelope_digest,p_e1,p_e2,
  p_issuer,p_reviewer,p_issuer_sig,p_reviewer_sig,p_expires);
 SELECT source_binding_digest INTO old_digest
 FROM v121_anchor.fixture_iam_source_bindings
 WHERE organization_id=p_org AND gap_id='EXT-001' AND revision_no=p_revision;
 IF FOUND THEN
  IF old_digest<>p_source_digest THEN
   RAISE EXCEPTION 'V121_IAM_SOURCE_BINDING_CONFLICT';
  END IF;
  RETURN 'EXACT_SOURCE_PROVENANCE_RETRY_STILL_HOLD';
 END IF;
 IF prior<>'ATTESTED_SYNTHETIC_STILL_HOLD' THEN
  RAISE EXCEPTION 'V121_IAM_SOURCE_BINDING_RETROACTIVE_DENIED';
 END IF;
 INSERT INTO v121_anchor.fixture_iam_source_bindings(
  organization_id,gap_id,revision_no,source_binding_digest)
 VALUES(p_org,'EXT-001',p_revision,p_source_digest);
 RETURN 'ATTESTED_SOURCE_PROVENANCE_STILL_HOLD';
END;
$iam_source$;
REVOKE ALL ON FUNCTION v121_anchor.fixture_attest_iam_source_provenance(
 uuid,integer,uuid,uuid,char(64),char(64),char(64),uuid,uuid,char(64),
 char(64),timestamptz,char(64),integer,char(64)) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION v121_anchor.fixture_attest_iam_source_provenance(
 uuid,integer,uuid,uuid,char(64),char(64),char(64),uuid,uuid,char(64),
 char(64),timestamptz,char(64),integer,char(64)) TO v121_iam_provenance_attester;

CREATE TABLE v121_anchor.fixture_iam_evidence_receipts(
 organization_id uuid NOT NULL,
 gap_id text NOT NULL CHECK(gap_id='EXT-001'),
 revision_no integer NOT NULL CHECK(revision_no>0),
 receipt_id uuid NOT NULL,
 envelope_digest char(64) NOT NULL CHECK(envelope_digest ~ '^[0-9a-f]{64}$'),
 evidence_e1_digest char(64) NOT NULL CHECK(evidence_e1_digest ~ '^[0-9a-f]{64}$'),
 evidence_e2_digest char(64) NOT NULL CHECK(evidence_e2_digest ~ '^[0-9a-f]{64}$'),
 issuer_id uuid NOT NULL,
 reviewer_id uuid NOT NULL CHECK(reviewer_id<>issuer_id),
 expires_at timestamptz NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organization_id,gap_id,revision_no),
 UNIQUE(organization_id,receipt_id),
 CHECK(evidence_e1_digest<>evidence_e2_digest),
 CHECK(expires_at>recorded_at)
);
CREATE TRIGGER fixture_iam_receipts_immutable
 BEFORE UPDATE OR DELETE ON v121_anchor.fixture_iam_evidence_receipts
 FOR EACH ROW EXECUTE FUNCTION v121_anchor.no_change();
REVOKE ALL ON v121_anchor.fixture_iam_evidence_receipts FROM PUBLIC;

CREATE TABLE v121_anchor.fixture_iam_evidence_revocations(
 organization_id uuid NOT NULL,
 gap_id text NOT NULL CHECK(gap_id='EXT-001'),
 revision_no integer NOT NULL,
 event_id uuid NOT NULL,
 reason_digest char(64) NOT NULL CHECK(reason_digest ~ '^[0-9a-f]{64}$'),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organization_id,gap_id,revision_no),
 UNIQUE(organization_id,event_id),
 FOREIGN KEY(organization_id,gap_id,revision_no)
 REFERENCES v121_anchor.fixture_iam_evidence_receipts(
  organization_id,gap_id,revision_no)
);
CREATE TRIGGER fixture_iam_revocations_immutable
 BEFORE UPDATE OR DELETE ON v121_anchor.fixture_iam_evidence_revocations
 FOR EACH ROW EXECUTE FUNCTION v121_anchor.no_change();
REVOKE ALL ON v121_anchor.fixture_iam_evidence_revocations FROM PUBLIC;

-- Writer cannot amend, delete or read direct receipts. All operations run
-- under READ COMMITTED to avoid stale MVCC reads after taking the revision lock.
CREATE FUNCTION v121_anchor.fixture_register_iam_evidence(
 p_org uuid,p_revision integer,p_receipt uuid,p_envelope_digest char(64),
 p_e1 char(64),p_e2 char(64),p_issuer uuid,p_reviewer uuid,p_expires timestamptz
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,v121_anchor AS $iam_register$
DECLARE existing record;
DECLARE latest integer;
DECLARE is_revoked boolean;
BEGIN
 IF session_user<>'v121_iam_intake_writer' OR
    p_org<>'11111111-1111-4111-8111-111111111111'::uuid THEN
  RAISE EXCEPTION 'V121_IAM_WRITER_SCOPE_DENIED';
 END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'V121_IAM_ISOLATION_UNSAFE';
 END IF;
 IF p_revision IS NULL OR p_revision<1 OR p_receipt IS NULL OR
    p_issuer IS NULL OR p_reviewer IS NULL OR p_issuer=p_reviewer OR
    p_envelope_digest IS NULL OR trim(p_envelope_digest) !~ '^[0-9a-f]{64}$' OR
    p_e1 IS NULL OR trim(p_e1) !~ '^[0-9a-f]{64}$' OR
    p_e2 IS NULL OR trim(p_e2) !~ '^[0-9a-f]{64}$' OR
    p_e1=p_e2 OR p_expires IS NULL THEN
  RAISE EXCEPTION 'V121_IAM_RECEIPT_INVALID';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(
  'v121-iam-evidence|'||p_org::text||'|EXT-001',0));
 SELECT MAX(revision_no) INTO latest
 FROM v121_anchor.fixture_iam_evidence_receipts
 WHERE organization_id=p_org AND gap_id='EXT-001';
 SELECT * INTO existing FROM v121_anchor.fixture_iam_evidence_receipts
 WHERE organization_id=p_org AND gap_id='EXT-001' AND revision_no=p_revision;
 IF FOUND THEN
  IF existing.receipt_id<>p_receipt OR
     existing.envelope_digest<>p_envelope_digest OR
     existing.evidence_e1_digest<>p_e1 OR
     existing.evidence_e2_digest<>p_e2 OR
     existing.issuer_id<>p_issuer OR existing.reviewer_id<>p_reviewer OR
     existing.expires_at<>p_expires THEN
   RAISE EXCEPTION 'V121_IAM_REVISION_CONFLICT';
  END IF;
  IF p_revision<>latest THEN
   RAISE EXCEPTION 'V121_IAM_REVISION_SUPERSEDED';
  END IF;
  SELECT EXISTS(SELECT 1 FROM v121_anchor.fixture_iam_evidence_revocations
   WHERE organization_id=p_org AND gap_id='EXT-001' AND revision_no=p_revision)
  INTO is_revoked;
  IF is_revoked THEN
   RAISE EXCEPTION 'V121_IAM_REVISION_REVOKED';
  END IF;
  IF existing.expires_at<=clock_timestamp() THEN
   RAISE EXCEPTION 'V121_IAM_REVISION_EXPIRED';
  END IF;
  RETURN 'EXACT_RETRY_SYNTHETIC_STILL_HOLD';
 END IF;
 IF p_revision<>COALESCE(latest,0)+1 THEN
  RAISE EXCEPTION 'V121_IAM_REVISION_NOT_NEXT';
 END IF;
 IF p_expires<=clock_timestamp() OR
    p_expires>clock_timestamp()+interval '1 hour' THEN
  RAISE EXCEPTION 'V121_IAM_RECEIPT_EXPIRY_INVALID';
 END IF;
 IF NOT EXISTS(
  SELECT 1 FROM v121_anchor.fixture_iam_provenance_proofs v
  WHERE v.organization_id=p_org AND v.gap_id='EXT-001' AND
   v.revision_no=p_revision AND v.receipt_id=p_receipt AND
   v.envelope_digest=p_envelope_digest AND v.evidence_e1_digest=p_e1 AND
   v.evidence_e2_digest=p_e2 AND v.issuer_id=p_issuer AND
   v.reviewer_id=p_reviewer AND v.expires_at=p_expires
 ) THEN
  RAISE EXCEPTION 'V121_IAM_PROVENANCE_MISSING_OR_MISMATCH';
 END IF;
 INSERT INTO v121_anchor.fixture_iam_evidence_receipts(
  organization_id,gap_id,revision_no,receipt_id,envelope_digest,
  evidence_e1_digest,evidence_e2_digest,issuer_id,reviewer_id,expires_at)
 VALUES(p_org,'EXT-001',p_revision,p_receipt,p_envelope_digest,
  p_e1,p_e2,p_issuer,p_reviewer,p_expires);
 RETURN 'REGISTERED_SYNTHETIC_STILL_HOLD';
END;
$iam_register$;
REVOKE ALL ON FUNCTION v121_anchor.fixture_register_iam_evidence(
 uuid,integer,uuid,char(64),char(64),char(64),uuid,uuid,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION v121_anchor.fixture_register_iam_evidence(
 uuid,integer,uuid,char(64),char(64),char(64),uuid,uuid,timestamptz)
 TO v121_iam_intake_writer;

CREATE FUNCTION v121_anchor.fixture_revoke_iam_evidence(
 p_org uuid,p_revision integer,p_event uuid,p_reason char(64)
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,v121_anchor AS $iam_revoke$
BEGIN
 IF session_user<>'v121_iam_revoker' OR
    p_org<>'11111111-1111-4111-8111-111111111111'::uuid THEN
  RAISE EXCEPTION 'V121_IAM_REVOKER_SCOPE_DENIED';
 END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'V121_IAM_ISOLATION_UNSAFE';
 END IF;
 IF p_revision IS NULL OR p_revision<1 OR p_event IS NULL OR p_reason IS NULL OR
    trim(p_reason) !~ '^[0-9a-f]{64}$' THEN
  RAISE EXCEPTION 'V121_IAM_REVOCATION_INVALID';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(
  'v121-iam-evidence|'||p_org::text||'|EXT-001',0));
 IF NOT EXISTS(
  SELECT 1 FROM v121_anchor.fixture_iam_evidence_receipts
  WHERE organization_id=p_org AND gap_id='EXT-001' AND revision_no=p_revision
 ) THEN
  RAISE EXCEPTION 'V121_IAM_REVISION_UNKNOWN';
 END IF;
 IF EXISTS(
  SELECT 1 FROM v121_anchor.fixture_iam_evidence_revocations
  WHERE organization_id=p_org AND gap_id='EXT-001' AND revision_no=p_revision
 ) THEN
  RAISE EXCEPTION 'V121_IAM_REVISION_ALREADY_REVOKED';
 END IF;
 INSERT INTO v121_anchor.fixture_iam_evidence_revocations(
  organization_id,gap_id,revision_no,event_id,reason_digest)
 VALUES(p_org,'EXT-001',p_revision,p_event,p_reason);
END;
$iam_revoke$;
REVOKE ALL ON FUNCTION v121_anchor.fixture_revoke_iam_evidence(
 uuid,integer,uuid,char(64)) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION v121_anchor.fixture_revoke_iam_evidence(
 uuid,integer,uuid,char(64)) TO v121_iam_revoker;

-- Reader is deliberately not granted direct table access.
-- Even VALID_SYNTHETIC_STILL_HOLD never constitutes production proof.
CREATE FUNCTION v121_anchor.fixture_iam_evidence_status(
 p_org uuid,p_revision integer
) RETURNS TABLE(
 receipt_status text,latest_revision integer,evidence_digest text,
 history_count integer,hold_active boolean,release_eligible boolean
) LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,v121_anchor AS $iam_status$
DECLARE item record;
DECLARE last_revision integer;
BEGIN
 IF session_user<>'v121_iam_intake_reader' OR
    p_org<>'11111111-1111-4111-8111-111111111111'::uuid THEN
  RAISE EXCEPTION 'V121_IAM_READER_SCOPE_DENIED';
 END IF;
 SELECT MAX(revision_no),count(*)::integer INTO last_revision,history_count
 FROM v121_anchor.fixture_iam_evidence_receipts
 WHERE organization_id=p_org AND gap_id='EXT-001';
 latest_revision:=last_revision;
 SELECT * INTO item FROM v121_anchor.fixture_iam_evidence_receipts
 WHERE organization_id=p_org AND gap_id='EXT-001' AND revision_no=p_revision;
 evidence_digest:=CASE WHEN item.receipt_id IS NOT NULL
  THEN trim(item.envelope_digest) ELSE NULL END;
 IF item.receipt_id IS NULL THEN receipt_status:='RECEIPT_NOT_FOUND';
 ELSIF EXISTS(
  SELECT 1 FROM v121_anchor.fixture_iam_evidence_revocations
  WHERE organization_id=p_org AND gap_id='EXT-001' AND revision_no=p_revision
 ) THEN receipt_status:='RECEIPT_REVOKED_STILL_HOLD';
 ELSIF item.revision_no<>last_revision THEN receipt_status:='RECEIPT_SUPERSEDED_STILL_HOLD';
 ELSIF item.expires_at<=clock_timestamp() THEN receipt_status:='RECEIPT_EXPIRED_STILL_HOLD';
 ELSE receipt_status:='VALID_SYNTHETIC_STILL_HOLD';
 END IF;
 hold_active:=true;
 release_eligible:=false;
 RETURN NEXT;
END;
$iam_status$;
REVOKE ALL ON FUNCTION v121_anchor.fixture_iam_evidence_status(uuid,integer)
 FROM PUBLIC;
GRANT EXECUTE ON FUNCTION v121_anchor.fixture_iam_evidence_status(uuid,integer)
 TO v121_iam_intake_reader;
