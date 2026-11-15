-- V3.2-113 disposable CI-only reviewer-assignment metadata. Not production DDL.
DO $reviewer_guard$
BEGIN
 IF current_database()<>'v106_isolated' THEN
  RAISE EXCEPTION 'V113 assignment fixture may only use v106_isolated';
 END IF;
END;
$reviewer_guard$;

CREATE TABLE v106_test.fixture_reviewer_assignments (
 organization_id uuid NOT NULL,
 incident_id uuid NOT NULL,
 student_id uuid NOT NULL,
 reviewer_id text NOT NULL,
 assignment_payload text NOT NULL,
 assignment_digest varchar(64) NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY (organization_id,incident_id,student_id)
);
REVOKE ALL ON v106_test.fixture_reviewer_assignments FROM PUBLIC;
GRANT SELECT,INSERT ON v106_test.fixture_reviewer_assignments TO v106_writer_a,v106_writer_b;
ALTER TABLE v106_test.fixture_reviewer_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE v106_test.fixture_reviewer_assignments FORCE ROW LEVEL SECURITY;
CREATE POLICY v113_a ON v106_test.fixture_reviewer_assignments
 FOR ALL TO v106_writer_a
 USING(organization_id='11111111-1111-4111-8111-111111111111'::uuid)
 WITH CHECK(organization_id='11111111-1111-4111-8111-111111111111'::uuid);
CREATE POLICY v113_b ON v106_test.fixture_reviewer_assignments
 FOR ALL TO v106_writer_b
 USING(organization_id='22222222-2222-4222-8222-222222222222'::uuid)
 WITH CHECK(organization_id='22222222-2222-4222-8222-222222222222'::uuid);
