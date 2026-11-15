-- V3.2-112 disposable CI-only metadata ledger, never a production migration.
DO $intake_guard$
BEGIN
 IF current_database()<>'v106_isolated' THEN
  RAISE EXCEPTION 'V112 intake schema requires disposable v106_isolated';
 END IF;
END;
$intake_guard$;

CREATE TABLE v106_test.evidence_intake_events(
 organization_id uuid NOT NULL,
 incident_id uuid NOT NULL,
 student_id uuid NOT NULL,
 sequence bigint NOT NULL CHECK(sequence>0),
 submission_id uuid NOT NULL,
 event_payload text NOT NULL,
 event_digest varchar(64) NOT NULL,
 PRIMARY KEY(organization_id,incident_id,student_id,sequence),
 UNIQUE(organization_id,incident_id,student_id,submission_id)
);
CREATE TABLE v106_test.evidence_intake_heads(
 organization_id uuid NOT NULL,
 incident_id uuid NOT NULL,
 student_id uuid NOT NULL,
 sequence bigint NOT NULL CHECK(sequence>0),
 event_digest varchar(64) NOT NULL,
 PRIMARY KEY(organization_id,incident_id,student_id)
);
REVOKE ALL ON v106_test.evidence_intake_events,v106_test.evidence_intake_heads FROM PUBLIC;
GRANT SELECT,INSERT ON v106_test.evidence_intake_events TO v106_writer_a,v106_writer_b;
GRANT SELECT,INSERT,UPDATE ON v106_test.evidence_intake_heads TO v106_writer_a,v106_writer_b;
ALTER TABLE v106_test.evidence_intake_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE v106_test.evidence_intake_events FORCE ROW LEVEL SECURITY;
ALTER TABLE v106_test.evidence_intake_heads ENABLE ROW LEVEL SECURITY;
ALTER TABLE v106_test.evidence_intake_heads FORCE ROW LEVEL SECURITY;
CREATE POLICY v112_event_a ON v106_test.evidence_intake_events
 FOR ALL TO v106_writer_a
 USING(organization_id='11111111-1111-4111-8111-111111111111'::uuid)
 WITH CHECK(organization_id='11111111-1111-4111-8111-111111111111'::uuid);
CREATE POLICY v112_event_b ON v106_test.evidence_intake_events
 FOR ALL TO v106_writer_b
 USING(organization_id='22222222-2222-4222-8222-222222222222'::uuid)
 WITH CHECK(organization_id='22222222-2222-4222-8222-222222222222'::uuid);
CREATE POLICY v112_head_a ON v106_test.evidence_intake_heads
 FOR ALL TO v106_writer_a
 USING(organization_id='11111111-1111-4111-8111-111111111111'::uuid)
 WITH CHECK(organization_id='11111111-1111-4111-8111-111111111111'::uuid);
CREATE POLICY v112_head_b ON v106_test.evidence_intake_heads
 FOR ALL TO v106_writer_b
 USING(organization_id='22222222-2222-4222-8222-222222222222'::uuid)
 WITH CHECK(organization_id='22222222-2222-4222-8222-222222222222'::uuid);
