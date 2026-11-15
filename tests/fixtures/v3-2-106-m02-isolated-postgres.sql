-- V3.2-106 CI-ONLY PostgreSQL fixture, never a production migration.
-- Run only on the disposable GitHub Actions database v106_isolated.
DO $guard$
BEGIN
 IF current_database() <> 'v106_isolated' THEN
  RAISE EXCEPTION 'Refusing V106 fixture outside v106_isolated';
 END IF;
END
$guard$;

CREATE ROLE v106_writer_a LOGIN PASSWORD 'ephemeral-v106-A-only';
CREATE ROLE v106_writer_b LOGIN PASSWORD 'ephemeral-v106-B-only';

CREATE SCHEMA v106_test;
REVOKE ALL ON SCHEMA v106_test FROM PUBLIC;
GRANT USAGE ON SCHEMA v106_test TO v106_writer_a,v106_writer_b;

CREATE TABLE v106_test.checkpoints (
 organization_id uuid NOT NULL,
 incident_id uuid NOT NULL,
 checkpoint_payload text NOT NULL,
 checkpoint_digest varchar(64) NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organization_id,incident_id)
);
CREATE TABLE v106_test.protected_business_fixture (
 organization_id uuid NOT NULL,
 example_payment_amount numeric NOT NULL
);
INSERT INTO v106_test.protected_business_fixture VALUES
 ('11111111-1111-4111-8111-111111111111',100.00);

REVOKE ALL ON ALL TABLES IN SCHEMA v106_test FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON v106_test.checkpoints TO v106_writer_a,v106_writer_b;

ALTER TABLE v106_test.checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE v106_test.checkpoints FORCE ROW LEVEL SECURITY;
CREATE POLICY v106_a ON v106_test.checkpoints
 FOR ALL TO v106_writer_a
 USING (organization_id='11111111-1111-4111-8111-111111111111'::uuid)
 WITH CHECK (organization_id='11111111-1111-4111-8111-111111111111'::uuid);
CREATE POLICY v106_b ON v106_test.checkpoints
 FOR ALL TO v106_writer_b
 USING (organization_id='22222222-2222-4222-8222-222222222222'::uuid)
 WITH CHECK (organization_id='22222222-2222-4222-8222-222222222222'::uuid);
