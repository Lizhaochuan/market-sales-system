-- V3.2-109 disposable PostgreSQL lease fixture. NOT a production migration.
DO $lease_guard$
BEGIN
 IF current_database()<>'v106_isolated' THEN
  RAISE EXCEPTION 'V109 lease fixture requires disposable v106_isolated';
 END IF;
END;
$lease_guard$;
CREATE TABLE v106_test.causal_leases (
 organization_id uuid NOT NULL,
 incident_id uuid NOT NULL,
 lease_payload text NOT NULL,
 lease_digest varchar(64) NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organization_id,incident_id)
);
REVOKE ALL ON v106_test.causal_leases FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON v106_test.causal_leases TO v106_writer_a,v106_writer_b;
ALTER TABLE v106_test.causal_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE v106_test.causal_leases FORCE ROW LEVEL SECURITY;
CREATE POLICY v109_lease_a ON v106_test.causal_leases
 FOR ALL TO v106_writer_a
 USING (organization_id='11111111-1111-4111-8111-111111111111'::uuid)
 WITH CHECK (organization_id='11111111-1111-4111-8111-111111111111'::uuid);
CREATE POLICY v109_lease_b ON v106_test.causal_leases
 FOR ALL TO v106_writer_b
 USING (organization_id='22222222-2222-4222-8222-222222222222'::uuid)
 WITH CHECK (organization_id='22222222-2222-4222-8222-222222222222'::uuid);
