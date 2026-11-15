-- CI-only second PostgreSQL database, separate from v106_isolated.
-- This is NOT independent WORM storage; postgres superuser controls both DBs.
CREATE SCHEMA v121_anchor;
REVOKE ALL ON SCHEMA v121_anchor FROM PUBLIC;
GRANT USAGE ON SCHEMA v121_anchor TO v121_anchor_reader,v121_anchor_writer;

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

CREATE TABLE v121_anchor.checkpoints (
 organization_id uuid NOT NULL,
 failure_id uuid NOT NULL,
 snapshot_sequence integer NOT NULL CHECK(snapshot_sequence>0),
 signer_id uuid NOT NULL,
 signed_statement jsonb NOT NULL,
 signature_b64 text NOT NULL CHECK(signature_b64 ~ '^[A-Za-z0-9+/]{86}==$'),
 observed_digest char(64) NOT NULL CHECK(observed_digest ~ '^[a-f0-9]{64}$'),
 PRIMARY KEY(organization_id,failure_id,snapshot_sequence),
 FOREIGN KEY(organization_id,signer_id)
 REFERENCES v121_anchor.signers(organization_id,signer_id)
);
CREATE FUNCTION v121_anchor.checkpoint_gate() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,v121_anchor AS $$
DECLARE seq integer;
DECLARE latest_state text;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(
  'v121-checkpoint|'||NEW.organization_id::text||'|'||NEW.failure_id::text,0));
 SELECT MAX(snapshot_sequence) INTO seq FROM v121_anchor.checkpoints
 WHERE organization_id=NEW.organization_id AND failure_id=NEW.failure_id;
 -- First anchor can refer to an existing business snapshot with sequence > 1.
 IF NEW.snapshot_sequence<=COALESCE(seq,0) THEN
  RAISE EXCEPTION 'V121_ANCHOR_CHECKPOINT_ROLLBACK';
 END IF;
 SELECT event_kind INTO latest_state FROM v121_anchor.key_events
 WHERE organization_id=NEW.organization_id AND signer_id=NEW.signer_id
 ORDER BY event_sequence DESC LIMIT 1;
 IF latest_state IS DISTINCT FROM 'REGISTERED' THEN
  RAISE EXCEPTION 'V121_ANCHOR_KEY_NOT_ACTIVE';
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
 p_statement jsonb,p_signature text,p_digest char(64))
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,v121_anchor AS $$
BEGIN
 IF session_user<>'v121_anchor_writer' OR
    p_org<>'11111111-1111-4111-8111-111111111111'::uuid THEN
  RAISE EXCEPTION 'V121_ANCHOR_WRITER_SCOPE_DENIED';
 END IF;
 INSERT INTO v121_anchor.checkpoints
  (organization_id,failure_id,snapshot_sequence,signer_id,
   signed_statement,signature_b64,observed_digest)
 VALUES(p_org,p_failure,p_seq,p_signer,p_statement,p_signature,p_digest);
END;
$$;
REVOKE ALL ON FUNCTION v121_anchor.append_checkpoint(
 uuid,uuid,integer,uuid,jsonb,text,char(64)) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION v121_anchor.append_checkpoint(
 uuid,uuid,integer,uuid,jsonb,text,char(64)) TO v121_anchor_writer;
