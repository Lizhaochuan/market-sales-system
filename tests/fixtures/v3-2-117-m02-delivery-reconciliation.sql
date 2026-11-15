-- V3.2-117 disposable CI-only delivery-reconciliation audit. NOT a migration.
DO $guard$
BEGIN
 IF current_database()<>'v106_isolated' THEN
  RAISE EXCEPTION 'Refusing V117 reconciliation outside disposable v106_isolated';
 END IF;
END;
$guard$;

CREATE TABLE v106_test.fixture_delivery_reconciliation_events(
 organization_id uuid NOT NULL,
 incident_id uuid NOT NULL,
 student_id uuid NOT NULL,
 sequence bigint NOT NULL CHECK(sequence>0 AND sequence<=128),
 hold_sequence bigint NOT NULL CHECK(hold_sequence>0 AND hold_sequence<=64),
 cause_digest varchar(64) NOT NULL,
 event_payload text NOT NULL,
 event_digest varchar(64) NOT NULL,
 PRIMARY KEY(organization_id,incident_id,student_id,sequence),
 UNIQUE(organization_id,incident_id,student_id,cause_digest)
);
CREATE TABLE v106_test.fixture_delivery_reconciliation_heads(
 organization_id uuid NOT NULL,
 incident_id uuid NOT NULL,
 student_id uuid NOT NULL,
 sequence bigint NOT NULL CHECK(sequence>0 AND sequence<=128),
 event_digest varchar(64) NOT NULL,
 hold_active boolean NOT NULL DEFAULT true CHECK(hold_active IS TRUE),
 PRIMARY KEY(organization_id,incident_id,student_id)
);
REVOKE ALL ON v106_test.fixture_delivery_reconciliation_events,
 v106_test.fixture_delivery_reconciliation_heads FROM PUBLIC;
GRANT SELECT,INSERT ON v106_test.fixture_delivery_reconciliation_events
 TO v106_writer_a,v106_writer_b;
GRANT SELECT,INSERT,UPDATE(sequence,event_digest)
 ON v106_test.fixture_delivery_reconciliation_heads TO v106_writer_a,v106_writer_b;
ALTER TABLE v106_test.fixture_delivery_reconciliation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE v106_test.fixture_delivery_reconciliation_events FORCE ROW LEVEL SECURITY;
ALTER TABLE v106_test.fixture_delivery_reconciliation_heads ENABLE ROW LEVEL SECURITY;
ALTER TABLE v106_test.fixture_delivery_reconciliation_heads FORCE ROW LEVEL SECURITY;
CREATE POLICY v117_events_a ON v106_test.fixture_delivery_reconciliation_events
 FOR ALL TO v106_writer_a
 USING(organization_id='11111111-1111-4111-8111-111111111111'::uuid)
 WITH CHECK(organization_id='11111111-1111-4111-8111-111111111111'::uuid);
CREATE POLICY v117_events_b ON v106_test.fixture_delivery_reconciliation_events
 FOR ALL TO v106_writer_b
 USING(organization_id='22222222-2222-4222-8222-222222222222'::uuid)
 WITH CHECK(organization_id='22222222-2222-4222-8222-222222222222'::uuid);
CREATE POLICY v117_heads_a ON v106_test.fixture_delivery_reconciliation_heads
 FOR ALL TO v106_writer_a
 USING(organization_id='11111111-1111-4111-8111-111111111111'::uuid)
 WITH CHECK(organization_id='11111111-1111-4111-8111-111111111111'::uuid);
CREATE POLICY v117_heads_b ON v106_test.fixture_delivery_reconciliation_heads
 FOR ALL TO v106_writer_b
 USING(organization_id='22222222-2222-4222-8222-222222222222'::uuid)
 WITH CHECK(organization_id='22222222-2222-4222-8222-222222222222'::uuid);
