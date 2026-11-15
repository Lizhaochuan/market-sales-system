-- V3.2-114 disposable reviewer lifecycle ledger ONLY. Never a production migration.
DO $v114_guard$
BEGIN
 IF current_database()<>'v106_isolated' THEN
  RAISE EXCEPTION 'Refusing V114 reviewer lifecycle fixture outside disposable CI database';
 END IF;
END;
$v114_guard$;
CREATE TABLE v106_test.fixture_reviewer_lifecycle_events (
 organization_id uuid NOT NULL,
 incident_id uuid NOT NULL,
 student_id uuid NOT NULL,
 sequence bigint NOT NULL CHECK(sequence>0),
 action_id uuid NOT NULL,
 event_payload text NOT NULL,
 event_digest varchar(64) NOT NULL,
 PRIMARY KEY(organization_id,incident_id,student_id,sequence),
 UNIQUE(organization_id,incident_id,student_id,action_id)
);
CREATE TABLE v106_test.fixture_reviewer_lifecycle_heads (
 organization_id uuid NOT NULL,
 incident_id uuid NOT NULL,
 student_id uuid NOT NULL,
 sequence bigint NOT NULL CHECK(sequence>0),
 event_digest varchar(64) NOT NULL,
 PRIMARY KEY(organization_id,incident_id,student_id)
);
REVOKE ALL ON v106_test.fixture_reviewer_lifecycle_events,
 v106_test.fixture_reviewer_lifecycle_heads FROM PUBLIC;
GRANT SELECT,INSERT ON v106_test.fixture_reviewer_lifecycle_events TO v106_writer_a,v106_writer_b;
GRANT SELECT,INSERT,UPDATE ON v106_test.fixture_reviewer_lifecycle_heads TO v106_writer_a,v106_writer_b;
ALTER TABLE v106_test.fixture_reviewer_lifecycle_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE v106_test.fixture_reviewer_lifecycle_events FORCE ROW LEVEL SECURITY;
ALTER TABLE v106_test.fixture_reviewer_lifecycle_heads ENABLE ROW LEVEL SECURITY;
ALTER TABLE v106_test.fixture_reviewer_lifecycle_heads FORCE ROW LEVEL SECURITY;
CREATE POLICY v114_events_a ON v106_test.fixture_reviewer_lifecycle_events
 FOR ALL TO v106_writer_a
 USING (organization_id='11111111-1111-4111-8111-111111111111'::uuid)
 WITH CHECK (organization_id='11111111-1111-4111-8111-111111111111'::uuid);
CREATE POLICY v114_events_b ON v106_test.fixture_reviewer_lifecycle_events
 FOR ALL TO v106_writer_b
 USING (organization_id='22222222-2222-4222-8222-222222222222'::uuid)
 WITH CHECK (organization_id='22222222-2222-4222-8222-222222222222'::uuid);
CREATE POLICY v114_heads_a ON v106_test.fixture_reviewer_lifecycle_heads
 FOR ALL TO v106_writer_a
 USING (organization_id='11111111-1111-4111-8111-111111111111'::uuid)
 WITH CHECK (organization_id='11111111-1111-4111-8111-111111111111'::uuid);
CREATE POLICY v114_heads_b ON v106_test.fixture_reviewer_lifecycle_heads
 FOR ALL TO v106_writer_b
 USING (organization_id='22222222-2222-4222-8222-222222222222'::uuid)
 WITH CHECK (organization_id='22222222-2222-4222-8222-222222222222'::uuid);
