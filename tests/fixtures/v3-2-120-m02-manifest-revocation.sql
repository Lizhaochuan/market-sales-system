-- V3.2-120: disposable SQL-only export revocation observation audit.
-- No production migration and no business permission changes.
DO $v120_guard$
BEGIN
 IF current_database()<>'v106_isolated' THEN
  RAISE EXCEPTION 'V120 requires disposable v106_isolated database';
 END IF;
END;
$v120_guard$;
CREATE TABLE v106_test.fixture_manifest_revocation_events(
 organization_id uuid NOT NULL,
 incident_id uuid NOT NULL,
 sequence integer NOT NULL CHECK(sequence>0 AND sequence<=128),
 target_manifest_sequence integer NOT NULL CHECK(target_manifest_sequence>0 AND target_manifest_sequence<=128),
 cause_digest varchar(64) NOT NULL,
 event_payload text NOT NULL,
 event_digest varchar(64) NOT NULL,
 PRIMARY KEY(organization_id,incident_id,sequence),
 UNIQUE(organization_id,incident_id,target_manifest_sequence,cause_digest)
);
CREATE TABLE v106_test.fixture_manifest_revocation_heads(
 organization_id uuid NOT NULL,
 incident_id uuid NOT NULL,
 sequence integer NOT NULL CHECK(sequence>0 AND sequence<=128),
 event_digest varchar(64) NOT NULL,
 revoked_export_count integer NOT NULL CHECK(revoked_export_count>=0 AND revoked_export_count<=128),
 hold_active boolean NOT NULL DEFAULT true CHECK(hold_active IS TRUE),
 PRIMARY KEY(organization_id,incident_id)
);
REVOKE ALL ON v106_test.fixture_manifest_revocation_events,
 v106_test.fixture_manifest_revocation_heads FROM PUBLIC;
GRANT SELECT,INSERT ON v106_test.fixture_manifest_revocation_events
 TO v106_writer_a,v106_writer_b;
GRANT SELECT,INSERT,UPDATE(sequence,event_digest,revoked_export_count)
 ON v106_test.fixture_manifest_revocation_heads TO v106_writer_a,v106_writer_b;
ALTER TABLE v106_test.fixture_manifest_revocation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE v106_test.fixture_manifest_revocation_events FORCE ROW LEVEL SECURITY;
ALTER TABLE v106_test.fixture_manifest_revocation_heads ENABLE ROW LEVEL SECURITY;
ALTER TABLE v106_test.fixture_manifest_revocation_heads FORCE ROW LEVEL SECURITY;
CREATE POLICY v120_events_a ON v106_test.fixture_manifest_revocation_events FOR ALL TO v106_writer_a
 USING(organization_id='11111111-1111-4111-8111-111111111111'::uuid)
 WITH CHECK(organization_id='11111111-1111-4111-8111-111111111111'::uuid);
CREATE POLICY v120_events_b ON v106_test.fixture_manifest_revocation_events FOR ALL TO v106_writer_b
 USING(organization_id='22222222-2222-4222-8222-222222222222'::uuid)
 WITH CHECK(organization_id='22222222-2222-4222-8222-222222222222'::uuid);
CREATE POLICY v120_heads_a ON v106_test.fixture_manifest_revocation_heads FOR ALL TO v106_writer_a
 USING(organization_id='11111111-1111-4111-8111-111111111111'::uuid)
 WITH CHECK(organization_id='11111111-1111-4111-8111-111111111111'::uuid);
CREATE POLICY v120_heads_b ON v106_test.fixture_manifest_revocation_heads FOR ALL TO v106_writer_b
 USING(organization_id='22222222-2222-4222-8222-222222222222'::uuid)
 WITH CHECK(organization_id='22222222-2222-4222-8222-222222222222'::uuid);

CREATE FUNCTION v106_test.v120_manifest_revocation_monotone() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
 IF NEW.sequence<=OLD.sequence OR
    NEW.revoked_export_count<OLD.revoked_export_count OR
    NEW.hold_active IS DISTINCT FROM TRUE THEN
  RAISE EXCEPTION 'V120 manifest revocation audit regression or release forbidden'
   USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$fn$;
CREATE TRIGGER v120_revocation_head_monotone
 BEFORE UPDATE ON v106_test.fixture_manifest_revocation_heads
 FOR EACH ROW EXECUTE FUNCTION v106_test.v120_manifest_revocation_monotone();
