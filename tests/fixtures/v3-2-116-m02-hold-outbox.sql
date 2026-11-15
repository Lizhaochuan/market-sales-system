-- V3.2-116: ephemeral PostgreSQL outbox and negative receipt only.
-- DO NOT install as a production migration or connect external business services.
DO $isolated$
BEGIN
 IF current_database()<>'v106_isolated' THEN
  RAISE EXCEPTION 'V116 outbox requires disposable v106_isolated';
 END IF;
END;
$isolated$;

CREATE TABLE v106_test.fixture_hold_outbox (
 organization_id uuid NOT NULL,
 incident_id uuid NOT NULL,
 student_id uuid NOT NULL,
 hold_sequence bigint NOT NULL CHECK(hold_sequence>0 AND hold_sequence<=64),
 hold_event_digest varchar(64) NOT NULL,
 message_digest varchar(64) NOT NULL,
 payload text NOT NULL,
 payload_digest varchar(64) NOT NULL,
 PRIMARY KEY(organization_id,incident_id,student_id,hold_sequence),
 UNIQUE(organization_id,incident_id,student_id,hold_event_digest)
);
CREATE TABLE v106_test.fixture_hold_outbox_negative_receipts (
 organization_id uuid NOT NULL,
 incident_id uuid NOT NULL,
 student_id uuid NOT NULL,
 hold_sequence bigint NOT NULL CHECK(hold_sequence>0 AND hold_sequence<=64),
 message_digest varchar(64) NOT NULL,
 receipt_digest varchar(64) NOT NULL,
 payload text NOT NULL,
 PRIMARY KEY(organization_id,incident_id,student_id,hold_sequence),
 FOREIGN KEY(organization_id,incident_id,student_id,hold_sequence)
  REFERENCES v106_test.fixture_hold_outbox
  (organization_id,incident_id,student_id,hold_sequence)
);
REVOKE ALL ON v106_test.fixture_hold_outbox,
 v106_test.fixture_hold_outbox_negative_receipts FROM PUBLIC;
GRANT SELECT,INSERT ON v106_test.fixture_hold_outbox,
 v106_test.fixture_hold_outbox_negative_receipts TO v106_writer_a,v106_writer_b;
ALTER TABLE v106_test.fixture_hold_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE v106_test.fixture_hold_outbox FORCE ROW LEVEL SECURITY;
ALTER TABLE v106_test.fixture_hold_outbox_negative_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE v106_test.fixture_hold_outbox_negative_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY v116_outbox_a ON v106_test.fixture_hold_outbox
 FOR ALL TO v106_writer_a
 USING(organization_id='11111111-1111-4111-8111-111111111111'::uuid)
 WITH CHECK(organization_id='11111111-1111-4111-8111-111111111111'::uuid);
CREATE POLICY v116_outbox_b ON v106_test.fixture_hold_outbox
 FOR ALL TO v106_writer_b
 USING(organization_id='22222222-2222-4222-8222-222222222222'::uuid)
 WITH CHECK(organization_id='22222222-2222-4222-8222-222222222222'::uuid);
CREATE POLICY v116_receipts_a ON v106_test.fixture_hold_outbox_negative_receipts
 FOR ALL TO v106_writer_a
 USING(organization_id='11111111-1111-4111-8111-111111111111'::uuid)
 WITH CHECK(organization_id='11111111-1111-4111-8111-111111111111'::uuid);
CREATE POLICY v116_receipts_b ON v106_test.fixture_hold_outbox_negative_receipts
 FOR ALL TO v106_writer_b
 USING(organization_id='22222222-2222-4222-8222-222222222222'::uuid)
 WITH CHECK(organization_id='22222222-2222-4222-8222-222222222222'::uuid);
