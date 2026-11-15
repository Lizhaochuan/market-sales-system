-- V3.2-115 disposable CI-only hold ledger. This is NOT a production migration.
DO $only_disposable$
BEGIN
 IF current_database()<>'v106_isolated' THEN
  RAISE EXCEPTION 'V115 hold fixtures require disposable v106_isolated only';
 END IF;
END;
$only_disposable$;
CREATE TABLE v106_test.fixture_review_hold_events(
 organization_id uuid NOT NULL,
 incident_id uuid NOT NULL,
 student_id uuid NOT NULL,
 sequence bigint NOT NULL CHECK(sequence>0 AND sequence<=64),
 cause_digest char(64) NOT NULL,
 event_payload text NOT NULL,
 event_digest char(64) NOT NULL,
 PRIMARY KEY(organization_id,incident_id,student_id,sequence),
 UNIQUE(organization_id,incident_id,student_id,cause_digest)
);
CREATE TABLE v106_test.fixture_review_hold_heads(
 organization_id uuid NOT NULL,
 incident_id uuid NOT NULL,
 student_id uuid NOT NULL,
 sequence bigint NOT NULL CHECK(sequence>0 AND sequence<=64),
 event_digest char(64) NOT NULL,
 hold_active boolean NOT NULL DEFAULT true CHECK(hold_active IS TRUE),
 PRIMARY KEY(organization_id,incident_id,student_id)
);
REVOKE ALL ON v106_test.fixture_review_hold_events,v106_test.fixture_review_hold_heads FROM PUBLIC;
GRANT SELECT,INSERT ON v106_test.fixture_review_hold_events TO v106_writer_a,v106_writer_b;
GRANT SELECT,INSERT,UPDATE(sequence,event_digest) ON v106_test.fixture_review_hold_heads TO v106_writer_a,v106_writer_b;
ALTER TABLE v106_test.fixture_review_hold_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE v106_test.fixture_review_hold_events FORCE ROW LEVEL SECURITY;
ALTER TABLE v106_test.fixture_review_hold_heads ENABLE ROW LEVEL SECURITY;
ALTER TABLE v106_test.fixture_review_hold_heads FORCE ROW LEVEL SECURITY;
CREATE POLICY v115_events_a ON v106_test.fixture_review_hold_events FOR ALL TO v106_writer_a
 USING(organization_id='11111111-1111-4111-8111-111111111111'::uuid)
 WITH CHECK(organization_id='11111111-1111-4111-8111-111111111111'::uuid);
CREATE POLICY v115_events_b ON v106_test.fixture_review_hold_events FOR ALL TO v106_writer_b
 USING(organization_id='22222222-2222-4222-8222-222222222222'::uuid)
 WITH CHECK(organization_id='22222222-2222-4222-8222-222222222222'::uuid);
CREATE POLICY v115_heads_a ON v106_test.fixture_review_hold_heads FOR ALL TO v106_writer_a
 USING(organization_id='11111111-1111-4111-8111-111111111111'::uuid)
 WITH CHECK(organization_id='11111111-1111-4111-8111-111111111111'::uuid);
CREATE POLICY v115_heads_b ON v106_test.fixture_review_hold_heads FOR ALL TO v106_writer_b
 USING(organization_id='22222222-2222-4222-8222-222222222222'::uuid)
 WITH CHECK(organization_id='22222222-2222-4222-8222-222222222222'::uuid);
