-- V3.2-110 disposable CI PostgreSQL only. No production migration.
DO $fixture_guard$
BEGIN
 IF current_database()<>'v106_isolated' THEN
  RAISE EXCEPTION 'V110 requires the disposable v106_isolated database';
 END IF;
END;
$fixture_guard$;

CREATE TABLE v106_test.lease_notice_heads (
 organization_id uuid NOT NULL,
 incident_id uuid NOT NULL,
 notification_sequence bigint NOT NULL CHECK(notification_sequence>0),
 notification_digest varchar(64) NOT NULL,
 PRIMARY KEY(organization_id,incident_id)
);
CREATE TABLE v106_test.lease_notice_events (
 organization_id uuid NOT NULL,
 incident_id uuid NOT NULL,
 notification_sequence bigint NOT NULL CHECK(notification_sequence>0),
 notification_payload text NOT NULL,
 notification_digest varchar(64) NOT NULL,
 PRIMARY KEY(organization_id,incident_id,notification_sequence)
);
REVOKE ALL ON v106_test.lease_notice_heads,v106_test.lease_notice_events FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON v106_test.lease_notice_heads TO v106_writer_a,v106_writer_b;
GRANT SELECT,INSERT ON v106_test.lease_notice_events TO v106_writer_a,v106_writer_b;

ALTER TABLE v106_test.lease_notice_heads ENABLE ROW LEVEL SECURITY;
ALTER TABLE v106_test.lease_notice_heads FORCE ROW LEVEL SECURITY;
ALTER TABLE v106_test.lease_notice_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE v106_test.lease_notice_events FORCE ROW LEVEL SECURITY;
CREATE POLICY v110_heads_a ON v106_test.lease_notice_heads
 FOR ALL TO v106_writer_a
 USING(organization_id='11111111-1111-4111-8111-111111111111'::uuid)
 WITH CHECK(organization_id='11111111-1111-4111-8111-111111111111'::uuid);
CREATE POLICY v110_heads_b ON v106_test.lease_notice_heads
 FOR ALL TO v106_writer_b
 USING(organization_id='22222222-2222-4222-8222-222222222222'::uuid)
 WITH CHECK(organization_id='22222222-2222-4222-8222-222222222222'::uuid);
CREATE POLICY v110_events_a ON v106_test.lease_notice_events
 FOR ALL TO v106_writer_a
 USING(organization_id='11111111-1111-4111-8111-111111111111'::uuid)
 WITH CHECK(organization_id='11111111-1111-4111-8111-111111111111'::uuid);
CREATE POLICY v110_events_b ON v106_test.lease_notice_events
 FOR ALL TO v106_writer_b
 USING(organization_id='22222222-2222-4222-8222-222222222222'::uuid)
 WITH CHECK(organization_id='22222222-2222-4222-8222-222222222222'::uuid);
