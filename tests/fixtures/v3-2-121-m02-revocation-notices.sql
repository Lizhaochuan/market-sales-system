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

-- V121 negative-only receipts: independently appended, never acknowledgements of delivery.
CREATE TABLE v106_test.fixture_revocation_negative_receipts (
 organization_id uuid NOT NULL,
 incident_id uuid NOT NULL,
 notice_id char(64) NOT NULL,
 receipt_sequence integer NOT NULL CHECK(receipt_sequence BETWEEN 1 AND 128),
 receipt_state text NOT NULL CHECK(receipt_state IN ('NEGATIVE_RECEIPT','COPY_NOT_RETRACTABLE')),
 previous_digest char(64) NOT NULL,
 receipt_digest char(64) NOT NULL,
 receipt_payload text NOT NULL,
 hold_active boolean NOT NULL DEFAULT true CHECK(hold_active IS TRUE),
 PRIMARY KEY(organization_id,incident_id,notice_id,receipt_sequence),
 FOREIGN KEY(organization_id,incident_id,notice_id)
  REFERENCES v106_test.fixture_revocation_notices(organization_id,incident_id,notice_id)
);
REVOKE ALL ON v106_test.fixture_revocation_negative_receipts FROM PUBLIC;
-- Ordinary writer roles cannot directly append receipts. Only isolated dedicated receipt role may INSERT.
GRANT SELECT ON v106_test.fixture_revocation_negative_receipts TO v106_writer_a,v106_writer_b;
GRANT INSERT ON v106_test.fixture_revocation_negative_receipts TO v106_receipt_writer_a;
ALTER TABLE v106_test.fixture_revocation_negative_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE v106_test.fixture_revocation_negative_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY v121_rcpt_a ON v106_test.fixture_revocation_negative_receipts
 FOR ALL TO v106_writer_a
 USING(organization_id='11111111-1111-4111-8111-111111111111'::uuid)
 WITH CHECK(organization_id='11111111-1111-4111-8111-111111111111'::uuid);
CREATE POLICY v121_rcpt_b ON v106_test.fixture_revocation_negative_receipts
 FOR ALL TO v106_writer_b
 USING(organization_id='22222222-2222-4222-8222-222222222222'::uuid)
 WITH CHECK(organization_id='22222222-2222-4222-8222-222222222222'::uuid);

-- Disposable persistent monotone signer observations. Not production IAM.
CREATE TABLE v106_test.fixture_signer_watermarks (
 organization_id uuid NOT NULL,
 incident_id uuid NOT NULL,
 signer_id uuid NOT NULL,
 authority_epoch integer NOT NULL CHECK(authority_epoch>0),
 revocation_watermark integer NOT NULL CHECK(revocation_watermark>=0),
 lease_sequence integer NOT NULL DEFAULT 0 CHECK(lease_sequence>=0),
 PRIMARY KEY(organization_id,incident_id,signer_id)
);
CREATE FUNCTION v106_test.fixture_watermark_monotone() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.organization_id<>OLD.organization_id OR
    NEW.incident_id<>OLD.incident_id OR NEW.signer_id<>OLD.signer_id OR
    NEW.authority_epoch<OLD.authority_epoch OR
    NEW.revocation_watermark<OLD.revocation_watermark OR
    NEW.lease_sequence<OLD.lease_sequence THEN
  RAISE EXCEPTION 'V121_WATERMARK_REGRESSION';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER fixture_watermark_no_regression BEFORE UPDATE ON v106_test.fixture_signer_watermarks
FOR EACH ROW EXECUTE FUNCTION v106_test.fixture_watermark_monotone();
REVOKE ALL ON v106_test.fixture_signer_watermarks FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE(authority_epoch,revocation_watermark,lease_sequence)
 ON v106_test.fixture_signer_watermarks TO v106_writer_a,v106_writer_b;
ALTER TABLE v106_test.fixture_signer_watermarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE v106_test.fixture_signer_watermarks FORCE ROW LEVEL SECURITY;
CREATE POLICY v121_wm_a ON v106_test.fixture_signer_watermarks FOR ALL TO v106_writer_a
 USING(organization_id='11111111-1111-4111-8111-111111111111'::uuid)
 WITH CHECK(organization_id='11111111-1111-4111-8111-111111111111'::uuid);
CREATE POLICY v121_wm_b ON v106_test.fixture_signer_watermarks FOR ALL TO v106_writer_b
 USING(organization_id='22222222-2222-4222-8222-222222222222'::uuid)
 WITH CHECK(organization_id='22222222-2222-4222-8222-222222222222'::uuid);
