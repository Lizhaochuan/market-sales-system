-- V3.2-119: disposable PostgreSQL incident-level gap manifest only.
-- This is neither production DDL nor a business release audit.
DO $v119_guard$
BEGIN
 IF current_database()<>'v106_isolated' THEN
  RAISE EXCEPTION 'V119 fixture requires disposable v106_isolated database';
 END IF;
END;
$v119_guard$;

CREATE TABLE v106_test.fixture_incident_gap_manifest_events(
 organization_id uuid NOT NULL,
 incident_id uuid NOT NULL,
 sequence integer NOT NULL CHECK(sequence>0 AND sequence<=128),
 manifest_digest varchar(64) NOT NULL,
 source_snapshot_digest varchar(64) NOT NULL,
 event_payload text NOT NULL,
 event_digest varchar(64) NOT NULL,
 PRIMARY KEY(organization_id,incident_id,sequence),
 UNIQUE(organization_id,incident_id,source_snapshot_digest)
);
CREATE TABLE v106_test.fixture_incident_gap_manifest_heads(
 organization_id uuid NOT NULL,
 incident_id uuid NOT NULL,
 sequence integer NOT NULL CHECK(sequence>0 AND sequence<=128),
 event_digest varchar(64) NOT NULL,
 student_count integer NOT NULL CHECK(student_count>=1 AND student_count<=8),
 source_snapshot_digest varchar(64) NOT NULL,
 hold_active boolean NOT NULL DEFAULT true CHECK(hold_active IS TRUE),
 PRIMARY KEY(organization_id,incident_id)
);
REVOKE ALL ON v106_test.fixture_incident_gap_manifest_events,
 v106_test.fixture_incident_gap_manifest_heads FROM PUBLIC;
GRANT SELECT,INSERT ON v106_test.fixture_incident_gap_manifest_events
 TO v106_writer_a,v106_writer_b;
GRANT SELECT,INSERT,UPDATE(sequence,event_digest,student_count,source_snapshot_digest)
 ON v106_test.fixture_incident_gap_manifest_heads TO v106_writer_a,v106_writer_b;
ALTER TABLE v106_test.fixture_incident_gap_manifest_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE v106_test.fixture_incident_gap_manifest_events FORCE ROW LEVEL SECURITY;
ALTER TABLE v106_test.fixture_incident_gap_manifest_heads ENABLE ROW LEVEL SECURITY;
ALTER TABLE v106_test.fixture_incident_gap_manifest_heads FORCE ROW LEVEL SECURITY;
CREATE POLICY v119_event_a ON v106_test.fixture_incident_gap_manifest_events
 FOR ALL TO v106_writer_a
 USING(organization_id='11111111-1111-4111-8111-111111111111'::uuid)
 WITH CHECK(organization_id='11111111-1111-4111-8111-111111111111'::uuid);
CREATE POLICY v119_event_b ON v106_test.fixture_incident_gap_manifest_events
 FOR ALL TO v106_writer_b
 USING(organization_id='22222222-2222-4222-8222-222222222222'::uuid)
 WITH CHECK(organization_id='22222222-2222-4222-8222-222222222222'::uuid);
CREATE POLICY v119_head_a ON v106_test.fixture_incident_gap_manifest_heads
 FOR ALL TO v106_writer_a
 USING(organization_id='11111111-1111-4111-8111-111111111111'::uuid)
 WITH CHECK(organization_id='11111111-1111-4111-8111-111111111111'::uuid);
CREATE POLICY v119_head_b ON v106_test.fixture_incident_gap_manifest_heads
 FOR ALL TO v106_writer_b
 USING(organization_id='22222222-2222-4222-8222-222222222222'::uuid)
 WITH CHECK(organization_id='22222222-2222-4222-8222-222222222222'::uuid);

CREATE FUNCTION v106_test.v119_monotone_incident_manifest() RETURNS trigger
 LANGUAGE plpgsql AS $fn$
BEGIN
 IF NEW.sequence<=OLD.sequence OR NEW.student_count<OLD.student_count OR
    NEW.hold_active IS DISTINCT FROM TRUE THEN
  RAISE EXCEPTION 'V119 incident manifest rewind or release forbidden'
   USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$fn$;
CREATE TRIGGER v119_incident_manifest_monotone
 BEFORE UPDATE ON v106_test.fixture_incident_gap_manifest_heads
 FOR EACH ROW EXECUTE FUNCTION v106_test.v119_monotone_incident_manifest();
