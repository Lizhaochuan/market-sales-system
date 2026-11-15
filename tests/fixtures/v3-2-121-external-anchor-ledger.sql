-- CI-only second PostgreSQL database, separate from v106_isolated.
-- This is NOT independent WORM storage; postgres superuser controls both DBs.
CREATE SCHEMA v121_anchor;
REVOKE ALL ON SCHEMA v121_anchor FROM PUBLIC;
GRANT USAGE ON SCHEMA v121_anchor TO v121_anchor_reader,v121_anchor_writer,v121_anchor_attester,v121_anchor_security,v121_anchor_investigator,v121_anchor_security_reviewer,v121_anchor_audit_reviewer,v121_anchor_evidence_checker;

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
ALTER TABLE v121_anchor.attester_quarantine_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY quarantine_tenant_select ON v121_anchor.attester_quarantine_events
 FOR SELECT TO v121_anchor_reader
 USING (organization_id='11111111-1111-4111-8111-111111111111'::uuid);

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


-- A quarantine investigation is evidence, not permission to lift the stop.
-- Case versions and independent reviews are append-only and always fail closed.
CREATE TABLE v121_anchor.quarantine_assessments (
 organization_id uuid NOT NULL,
 event_id uuid NOT NULL,
 assessment_id uuid NOT NULL,
 assessment_version integer NOT NULL CHECK(assessment_version>0),
 investigator_id uuid NOT NULL,
 finding text NOT NULL CHECK(finding IN ('FALSE_POSITIVE_CANDIDATE','CONFIRMED_COMPROMISE','INCONCLUSIVE')),
 evidence_digest char(64) NOT NULL CHECK(evidence_digest ~ '^[a-f0-9]{64}$'),
 PRIMARY KEY(organization_id,assessment_id),
 UNIQUE(organization_id,event_id,assessment_version),
 FOREIGN KEY(organization_id,event_id)
 REFERENCES v121_anchor.attester_quarantine_events(organization_id,event_id)
);
CREATE TRIGGER assessments_immutable BEFORE UPDATE OR DELETE ON v121_anchor.quarantine_assessments
FOR EACH ROW EXECUTE FUNCTION v121_anchor.no_change();
REVOKE ALL ON v121_anchor.quarantine_assessments FROM PUBLIC;
GRANT SELECT ON v121_anchor.quarantine_assessments TO v121_anchor_reader;
ALTER TABLE v121_anchor.quarantine_assessments ENABLE ROW LEVEL SECURITY;
CREATE POLICY assessment_tenant_select ON v121_anchor.quarantine_assessments
 FOR SELECT TO v121_anchor_reader
 USING (organization_id='11111111-1111-4111-8111-111111111111'::uuid);

CREATE FUNCTION v121_anchor.record_quarantine_assessment(
 p_org uuid,p_event uuid,p_assessment uuid,p_version integer,
 p_investigator uuid,p_finding text,p_digest char(64))
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,v121_anchor AS $assessment$
DECLARE previous_version integer;
BEGIN
 IF session_user<>'v121_anchor_investigator' OR
   p_org<>'11111111-1111-4111-8111-111111111111'::uuid THEN
  RAISE EXCEPTION 'V121_QUARANTINE_INVESTIGATOR_DENIED';
 END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'V121_ANCHOR_ISOLATION_UNSAFE';
 END IF;
 IF p_event IS NULL OR p_assessment IS NULL OR p_investigator IS NULL OR
    p_version IS NULL OR p_version<1 OR
    p_finding IS NULL OR p_finding NOT IN (
       'FALSE_POSITIVE_CANDIDATE','CONFIRMED_COMPROMISE','INCONCLUSIVE') OR
    p_digest IS NULL OR p_digest !~ '^[a-f0-9]{64}$' THEN
  RAISE EXCEPTION 'V121_QUARANTINE_ASSESSMENT_INVALID';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(
  'v121-quarantine-review|'||p_org::text||'|'||p_event::text,0));
 IF NOT EXISTS(SELECT 1 FROM v121_anchor.attester_quarantine_events e
  WHERE e.organization_id=p_org AND e.event_id=p_event) THEN
  RAISE EXCEPTION 'V121_QUARANTINE_EVENT_UNKNOWN';
 END IF;
 SELECT COALESCE(MAX(assessment_version),0) INTO previous_version
 FROM v121_anchor.quarantine_assessments
 WHERE organization_id=p_org AND event_id=p_event;
 IF p_version<>previous_version+1 THEN
  RAISE EXCEPTION 'V121_QUARANTINE_VERSION_NOT_NEXT';
 END IF;
 INSERT INTO v121_anchor.quarantine_assessments(
  organization_id,event_id,assessment_id,assessment_version,
  investigator_id,finding,evidence_digest)
 VALUES(p_org,p_event,p_assessment,p_version,p_investigator,p_finding,p_digest);
END;
$assessment$;
REVOKE ALL ON FUNCTION v121_anchor.record_quarantine_assessment(
 uuid,uuid,uuid,integer,uuid,text,char(64)) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION v121_anchor.record_quarantine_assessment(
 uuid,uuid,uuid,integer,uuid,text,char(64)) TO v121_anchor_investigator;

CREATE TABLE v121_anchor.quarantine_assessment_reviews (
 organization_id uuid NOT NULL,
 assessment_id uuid NOT NULL,
 review_domain text NOT NULL CHECK(review_domain IN ('SECURITY','AUDIT')),
 reviewer_id uuid NOT NULL,
 decision text NOT NULL CHECK(decision IN ('AGREED','DISAGREED')),
 reviewed_digest char(64) NOT NULL CHECK(reviewed_digest ~ '^[a-f0-9]{64}$'),
 hold_active boolean NOT NULL DEFAULT true CHECK(hold_active IS TRUE),
 release_eligible boolean NOT NULL DEFAULT false CHECK(release_eligible IS FALSE),
 PRIMARY KEY(organization_id,assessment_id,review_domain),
 FOREIGN KEY(organization_id,assessment_id)
 REFERENCES v121_anchor.quarantine_assessments(organization_id,assessment_id)
);
CREATE TRIGGER assessment_reviews_immutable BEFORE UPDATE OR DELETE ON v121_anchor.quarantine_assessment_reviews
FOR EACH ROW EXECUTE FUNCTION v121_anchor.no_change();
REVOKE ALL ON v121_anchor.quarantine_assessment_reviews FROM PUBLIC;
GRANT SELECT ON v121_anchor.quarantine_assessment_reviews TO v121_anchor_reader;
ALTER TABLE v121_anchor.quarantine_assessment_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY review_tenant_select ON v121_anchor.quarantine_assessment_reviews
 FOR SELECT TO v121_anchor_reader
 USING (organization_id='11111111-1111-4111-8111-111111111111'::uuid);

CREATE FUNCTION v121_anchor.record_quarantine_review(
 p_org uuid,p_assessment uuid,p_reviewer uuid,p_domain text,p_decision text,p_digest char(64))
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,v121_anchor AS $review$
DECLARE target record;
DECLARE previous_actor uuid;
BEGIN
 IF p_org<>'11111111-1111-4111-8111-111111111111'::uuid OR
    (session_user='v121_anchor_security_reviewer' AND p_domain IS DISTINCT FROM 'SECURITY') OR
    (session_user='v121_anchor_audit_reviewer' AND p_domain IS DISTINCT FROM 'AUDIT') OR
    session_user NOT IN ('v121_anchor_security_reviewer','v121_anchor_audit_reviewer') THEN
  RAISE EXCEPTION 'V121_QUARANTINE_REVIEW_ROLE_DENIED';
 END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'V121_ANCHOR_ISOLATION_UNSAFE';
 END IF;
 IF p_assessment IS NULL OR p_reviewer IS NULL OR
    p_decision IS NULL OR p_decision NOT IN ('AGREED','DISAGREED') OR
    p_digest IS NULL OR p_digest !~ '^[a-f0-9]{64}$' THEN
  RAISE EXCEPTION 'V121_QUARANTINE_REVIEW_INVALID';
 END IF;
 SELECT q.event_id INTO target FROM v121_anchor.quarantine_assessments q
 WHERE q.organization_id=p_org AND q.assessment_id=p_assessment;
 IF target.event_id IS NULL THEN
  RAISE EXCEPTION 'V121_QUARANTINE_ASSESSMENT_UNKNOWN';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(
  'v121-quarantine-review|'||p_org::text||'|'||target.event_id::text,0));
 SELECT * INTO target FROM v121_anchor.quarantine_assessments q
 WHERE q.organization_id=p_org AND q.assessment_id=p_assessment;
 IF target.assessment_version IS DISTINCT FROM (
  SELECT MAX(q.assessment_version) FROM v121_anchor.quarantine_assessments q
  WHERE q.organization_id=p_org AND q.event_id=target.event_id) THEN
  RAISE EXCEPTION 'V121_QUARANTINE_ASSESSMENT_SUPERSEDED';
 END IF;
 IF target.evidence_digest<>p_digest THEN
  RAISE EXCEPTION 'V121_QUARANTINE_REVIEW_EVIDENCE_MISMATCH';
 END IF;
 IF p_reviewer=target.investigator_id OR EXISTS(
  SELECT 1 FROM v121_anchor.quarantine_assessment_reviews r
  WHERE r.organization_id=p_org AND r.assessment_id=p_assessment AND r.reviewer_id=p_reviewer) THEN
  RAISE EXCEPTION 'V121_QUARANTINE_REVIEW_NOT_INDEPENDENT';
 END IF;
 INSERT INTO v121_anchor.quarantine_assessment_reviews(
  organization_id,assessment_id,review_domain,reviewer_id,decision,reviewed_digest)
 VALUES(p_org,p_assessment,p_domain,p_reviewer,p_decision,p_digest);
END;
$review$;
REVOKE ALL ON FUNCTION v121_anchor.record_quarantine_review(
 uuid,uuid,uuid,text,text,char(64)) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION v121_anchor.record_quarantine_review(
 uuid,uuid,uuid,text,text,char(64)) TO v121_anchor_security_reviewer,v121_anchor_audit_reviewer;

CREATE VIEW v121_anchor.quarantine_review_diagnostics AS
SELECT e.organization_id,e.event_id,e.affected_failure_id,e.event_kind,
 latest.assessment_id AS latest_assessment_id,
 latest.assessment_version AS latest_version,latest.finding AS latest_finding,
 (SELECT count(*)::integer FROM v121_anchor.quarantine_assessment_reviews rv
  WHERE rv.organization_id=e.organization_id AND rv.assessment_id=latest.assessment_id
    AND rv.decision='AGREED') AS latest_agreed_reviews,
 true::boolean AS quarantine_active,true::boolean AS hold_active,
 false::boolean AS release_eligible,'QUARANTINE_RETAINED'::text AS status
FROM v121_anchor.attester_quarantine_events e
LEFT JOIN LATERAL(
 SELECT q.assessment_id,q.assessment_version,q.finding
 FROM v121_anchor.quarantine_assessments q
 WHERE q.organization_id=e.organization_id AND q.event_id=e.event_id
 ORDER BY q.assessment_version DESC LIMIT 1
) latest ON TRUE
WHERE e.organization_id='11111111-1111-4111-8111-111111111111'::uuid;
REVOKE ALL ON v121_anchor.quarantine_review_diagnostics FROM PUBLIC;
GRANT SELECT ON v121_anchor.quarantine_review_diagnostics TO v121_anchor_reader;


-- CI-only evidence chain. This attestation links the original quarantine
-- incident, its latest investigation, and two distinct matching reviews.
-- A valid chain is only a diagnostic: it never changes quarantine state.
CREATE TABLE v121_anchor.quarantine_evidence_chains (
 organization_id uuid NOT NULL,
 event_id uuid NOT NULL,
 assessment_id uuid NOT NULL,
 chain_digest char(64) NOT NULL CHECK(chain_digest ~ '^[a-f0-9]{64}$'),
 checker_id uuid NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 hold_active boolean NOT NULL DEFAULT true CHECK(hold_active IS TRUE),
 release_eligible boolean NOT NULL DEFAULT false CHECK(release_eligible IS FALSE),
 PRIMARY KEY(organization_id,assessment_id),
 FOREIGN KEY(organization_id,event_id)
  REFERENCES v121_anchor.attester_quarantine_events(organization_id,event_id),
 FOREIGN KEY(organization_id,assessment_id)
  REFERENCES v121_anchor.quarantine_assessments(organization_id,assessment_id)
);
CREATE TRIGGER evidence_chain_immutable BEFORE UPDATE OR DELETE ON v121_anchor.quarantine_evidence_chains
 FOR EACH ROW EXECUTE FUNCTION v121_anchor.no_change();
REVOKE ALL ON v121_anchor.quarantine_evidence_chains FROM PUBLIC;
GRANT SELECT ON v121_anchor.quarantine_evidence_chains TO v121_anchor_reader;
ALTER TABLE v121_anchor.quarantine_evidence_chains ENABLE ROW LEVEL SECURITY;
CREATE POLICY evidence_chain_tenant_select ON v121_anchor.quarantine_evidence_chains
 FOR SELECT TO v121_anchor_reader
 USING (organization_id='11111111-1111-4111-8111-111111111111'::uuid);

-- Produce the same canonical hash for verification and initial attestation.
-- A missing source event, absent/wrong-domain review or conflicting identities
-- returns NULL, and no one can attest NULL as a complete chain.
CREATE FUNCTION v121_anchor.quarantine_expected_chain(
 p_org uuid,p_event uuid,p_assessment uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,v121_anchor AS $expected_chain$
DECLARE event_record record;
DECLARE assessment_record record;
DECLARE security_review record;
DECLARE audit_review record;
DECLARE canonical text;
BEGIN
 IF session_user NOT IN ('v121_anchor_reader','v121_anchor_evidence_checker','postgres') OR
   p_org<>'11111111-1111-4111-8111-111111111111'::uuid THEN
  RAISE EXCEPTION 'V121_QUARANTINE_CHAIN_SCOPE_DENIED';
 END IF;
 SELECT * INTO event_record FROM v121_anchor.attester_quarantine_events
 WHERE organization_id=p_org AND event_id=p_event;
 SELECT * INTO assessment_record FROM v121_anchor.quarantine_assessments
 WHERE organization_id=p_org AND event_id=p_event AND assessment_id=p_assessment;
 SELECT * INTO security_review FROM v121_anchor.quarantine_assessment_reviews
 WHERE organization_id=p_org AND assessment_id=p_assessment AND review_domain='SECURITY';
 SELECT * INTO audit_review FROM v121_anchor.quarantine_assessment_reviews
 WHERE organization_id=p_org AND assessment_id=p_assessment AND review_domain='AUDIT';
 IF event_record.event_id IS NULL OR assessment_record.assessment_id IS NULL OR
   security_review.assessment_id IS NULL OR audit_review.assessment_id IS NULL OR
   security_review.decision<>'AGREED' OR audit_review.decision<>'AGREED' OR
   security_review.reviewed_digest<>assessment_record.evidence_digest OR
   audit_review.reviewed_digest<>assessment_record.evidence_digest OR
   security_review.reviewer_id=audit_review.reviewer_id OR
   security_review.reviewer_id=assessment_record.investigator_id OR
   audit_review.reviewer_id=assessment_record.investigator_id THEN
  RETURN NULL;
 END IF;
 canonical:='v121-quarantine-evidence-v1|'||
  p_org::text||'|'||p_event::text||'|'||event_record.event_kind||'|'||
  COALESCE(event_record.affected_failure_id::text,'ORG_WIDE')||'|'||
  trim(event_record.evidence_digest)||'|'||
  assessment_record.assessment_id::text||'|'||
  assessment_record.assessment_version::text||'|'||
  assessment_record.investigator_id::text||'|'||
  assessment_record.finding||'|'||trim(assessment_record.evidence_digest)||'|'||
  security_review.review_domain||'|'||security_review.reviewer_id::text||'|'||
  security_review.decision||'|'||trim(security_review.reviewed_digest)||'|'||
  audit_review.review_domain||'|'||audit_review.reviewer_id::text||'|'||
  audit_review.decision||'|'||trim(audit_review.reviewed_digest);
 RETURN encode(sha256(convert_to(canonical,'UTF8')),'hex');
END;
$expected_chain$;
REVOKE ALL ON FUNCTION v121_anchor.quarantine_expected_chain(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION v121_anchor.quarantine_expected_chain(uuid,uuid,uuid)
 TO v121_anchor_reader,v121_anchor_evidence_checker;

CREATE FUNCTION v121_anchor.attest_quarantine_evidence(
 p_org uuid,p_event uuid,p_assessment uuid,p_checker uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,v121_anchor AS $attest_chain$
DECLARE latest uuid;
DECLARE expected text;
BEGIN
 IF session_user<>'v121_anchor_evidence_checker' OR
   p_org<>'11111111-1111-4111-8111-111111111111'::uuid THEN
  RAISE EXCEPTION 'V121_QUARANTINE_CHAIN_CHECKER_DENIED';
 END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'V121_ANCHOR_ISOLATION_UNSAFE';
 END IF;
 IF p_checker IS NULL OR p_assessment IS NULL OR p_event IS NULL THEN
  RAISE EXCEPTION 'V121_QUARANTINE_CHAIN_INPUT_INVALID';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(
  'v121-quarantine-review|'||p_org::text||'|'||p_event::text,0));
 SELECT q.assessment_id INTO latest FROM v121_anchor.quarantine_assessments q
 WHERE q.organization_id=p_org AND q.event_id=p_event
 ORDER BY q.assessment_version DESC LIMIT 1;
 IF latest IS DISTINCT FROM p_assessment THEN
  RAISE EXCEPTION 'V121_QUARANTINE_CHAIN_SUPERSEDED';
 END IF;
 expected:=v121_anchor.quarantine_expected_chain(p_org,p_event,p_assessment);
 IF expected IS NULL THEN
  RAISE EXCEPTION 'V121_QUARANTINE_CHAIN_INCOMPLETE';
 END IF;
 INSERT INTO v121_anchor.quarantine_evidence_chains(
  organization_id,event_id,assessment_id,chain_digest,checker_id)
 VALUES(p_org,p_event,p_assessment,expected,p_checker);
END;
$attest_chain$;
REVOKE ALL ON FUNCTION v121_anchor.attest_quarantine_evidence(
 uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION v121_anchor.attest_quarantine_evidence(
 uuid,uuid,uuid,uuid) TO v121_anchor_evidence_checker;

-- Recompute from source on each read; stale, tampered or absent chains remain HOLD.
CREATE FUNCTION v121_anchor.quarantine_chain_diagnostics(p_org uuid,p_event uuid)
RETURNS TABLE(
 latest_assessment uuid,latest_version integer,linked_reviews integer,
 chain_expected text,chain_recorded text,chain_status text,
 quarantine_active boolean,hold_active boolean,release_eligible boolean
) LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,v121_anchor AS $chain_diag$
DECLARE latest record;
DECLARE stored record;
BEGIN
 IF session_user NOT IN ('v121_anchor_reader','postgres') OR
   p_org<>'11111111-1111-4111-8111-111111111111'::uuid THEN
  RAISE EXCEPTION 'V121_QUARANTINE_CHAIN_SCOPE_DENIED';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM v121_anchor.attester_quarantine_events e
   WHERE e.organization_id=p_org AND e.event_id=p_event) THEN
  RAISE EXCEPTION 'V121_QUARANTINE_CHAIN_EVENT_UNKNOWN';
 END IF;
 SELECT * INTO latest FROM v121_anchor.quarantine_assessments q
 WHERE q.organization_id=p_org AND q.event_id=p_event
 ORDER BY q.assessment_version DESC LIMIT 1;
 latest_assessment:=latest.assessment_id;
 latest_version:=latest.assessment_version;
 SELECT count(*)::integer INTO linked_reviews
 FROM v121_anchor.quarantine_assessment_reviews r
 WHERE r.organization_id=p_org AND r.assessment_id=latest_assessment;
 IF latest_assessment IS NULL THEN
  chain_status:='INVESTIGATION_MISSING';
 ELSE
  chain_expected:=v121_anchor.quarantine_expected_chain(p_org,p_event,latest_assessment);
  SELECT * INTO stored FROM v121_anchor.quarantine_evidence_chains c
  WHERE c.organization_id=p_org AND c.assessment_id=latest_assessment
    AND c.event_id=p_event;
  chain_recorded:=trim(stored.chain_digest);
  IF chain_expected IS NULL THEN
   chain_status:='EVIDENCE_INCOMPLETE_OR_CONFLICTING';
  ELSIF stored.assessment_id IS NULL THEN
   chain_status:='EVIDENCE_ATTESTATION_MISSING';
  ELSIF chain_recorded<>chain_expected THEN
   chain_status:='EVIDENCE_CHAIN_MISMATCH';
  ELSE
   chain_status:='EVIDENCE_LINKED_STILL_HOLD';
  END IF;
 END IF;
 quarantine_active:=true;
 hold_active:=true;
 release_eligible:=false;
 RETURN NEXT;
END;
$chain_diag$;
REVOKE ALL ON FUNCTION v121_anchor.quarantine_chain_diagnostics(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION v121_anchor.quarantine_chain_diagnostics(uuid,uuid)
 TO v121_anchor_reader;

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
