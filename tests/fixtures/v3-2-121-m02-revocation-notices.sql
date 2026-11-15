-- V3.2-121: disposable-only notice records. Never a production migration.
DO $guard$ BEGIN
 IF current_database() <> 'v106_isolated' THEN
  RAISE EXCEPTION 'V121 only runs in v106_isolated';
 END IF;
END $guard$;
CREATE TABLE v106_test.fixture_revocation_recipients (
 organization_id uuid NOT NULL,
 incident_id uuid NOT NULL,
 recipient_id uuid NOT NULL,
 PRIMARY KEY(organization_id,incident_id,recipient_id)
);
CREATE TABLE v106_test.fixture_revocation_notices (
 organization_id uuid NOT NULL,
 incident_id uuid NOT NULL,
 notice_id char(64) NOT NULL,
 recipient_id uuid NOT NULL,
 export_version integer NOT NULL CHECK(export_version BETWEEN 1 AND 128),
 epoch integer NOT NULL CHECK(epoch BETWEEN 1 AND 2147483647),
 manifest_digest char(64) NOT NULL,
 revocation_event_digest char(64) NOT NULL,
 event_digest char(64) NOT NULL,
 event_payload text NOT NULL,
 state text NOT NULL DEFAULT 'QUEUED' CHECK(state='QUEUED'),
 hold_active boolean NOT NULL DEFAULT true CHECK(hold_active IS TRUE),
 PRIMARY KEY(organization_id,incident_id,notice_id),
 UNIQUE(organization_id,incident_id,recipient_id,export_version,epoch)
);
REVOKE ALL ON v106_test.fixture_revocation_recipients,v106_test.fixture_revocation_notices FROM PUBLIC;
GRANT SELECT ON v106_test.fixture_revocation_recipients TO v106_writer_a,v106_writer_b;
GRANT SELECT,INSERT ON v106_test.fixture_revocation_notices TO v106_writer_a,v106_writer_b;
ALTER TABLE v106_test.fixture_revocation_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE v106_test.fixture_revocation_recipients FORCE ROW LEVEL SECURITY;
ALTER TABLE v106_test.fixture_revocation_notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE v106_test.fixture_revocation_notices FORCE ROW LEVEL SECURITY;
CREATE POLICY v121_rec_a ON v106_test.fixture_revocation_recipients
 FOR SELECT TO v106_writer_a USING(organization_id='11111111-1111-4111-8111-111111111111'::uuid);
CREATE POLICY v121_rec_b ON v106_test.fixture_revocation_recipients
 FOR SELECT TO v106_writer_b USING(organization_id='22222222-2222-4222-8222-222222222222'::uuid);
CREATE POLICY v121_not_a ON v106_test.fixture_revocation_notices
 FOR ALL TO v106_writer_a
 USING(organization_id='11111111-1111-4111-8111-111111111111'::uuid)
 WITH CHECK(organization_id='11111111-1111-4111-8111-111111111111'::uuid);
CREATE POLICY v121_not_b ON v106_test.fixture_revocation_notices
 FOR ALL TO v106_writer_b
 USING(organization_id='22222222-2222-4222-8222-222222222222'::uuid)
 WITH CHECK(organization_id='22222222-2222-4222-8222-222222222222'::uuid);
-- Registry entries must be populated by the disposable fixture owner, never by writer clients.
-- No UPDATE or DELETE grants: notice/event payload, digest and HOLD remain immutable.
