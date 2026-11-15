-- V3.2-118: disposable gap-scan audit only. No production 039 migration.
DO $v118_guard$
BEGIN
 IF current_database()<>'v106_isolated' THEN
  RAISE EXCEPTION 'V118 gap scan may run only against disposable v106_isolated';
 END IF;
END;
$v118_guard$;

CREATE TABLE v106_test.fixture_hold_gap_scan_events (
 organization_id uuid NOT NULL,
 incident_id uuid NOT NULL,
 student_id uuid NOT NULL,
 sequence bigint NOT NULL CHECK(sequence>0 AND sequence<=128),
 snapshot_digest varchar(64) NOT NULL,
 event_payload text NOT NULL,
 event_digest varchar(64) NOT NULL,
 PRIMARY KEY(organization_id,incident_id,student_id,sequence),
 UNIQUE(organization_id,incident_id,student_id,snapshot_digest)
);
CREATE TABLE v106_test.fixture_hold_gap_scan_heads (
 organization_id uuid NOT NULL,
 incident_id uuid NOT NULL,
 student_id uuid NOT NULL,
 sequence bigint NOT NULL CHECK(sequence>0 AND sequence<=128),
 event_digest varchar(64) NOT NULL,
 checked_through bigint NOT NULL CHECK(checked_through>=1 AND checked_through<=64),
 hold_head_digest varchar(64) NOT NULL,
 outbox_prefix bigint NOT NULL CHECK(outbox_prefix>=0 AND outbox_prefix<=checked_through),
 negative_receipt_prefix bigint NOT NULL CHECK(
  negative_receipt_prefix>=0 AND negative_receipt_prefix<=outbox_prefix),
 hold_active boolean NOT NULL DEFAULT true CHECK(hold_active IS TRUE),
 PRIMARY KEY(organization_id,incident_id,student_id)
);
REVOKE ALL ON v106_test.fixture_hold_gap_scan_events,
 v106_test.fixture_hold_gap_scan_heads FROM PUBLIC;
GRANT SELECT,INSERT ON v106_test.fixture_hold_gap_scan_events
 TO v106_writer_a,v106_writer_b;
GRANT SELECT,INSERT,
 UPDATE(sequence,event_digest,checked_through,hold_head_digest,
  outbox_prefix,negative_receipt_prefix)
 ON v106_test.fixture_hold_gap_scan_heads TO v106_writer_a,v106_writer_b;
ALTER TABLE v106_test.fixture_hold_gap_scan_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE v106_test.fixture_hold_gap_scan_events FORCE ROW LEVEL SECURITY;
ALTER TABLE v106_test.fixture_hold_gap_scan_heads ENABLE ROW LEVEL SECURITY;
ALTER TABLE v106_test.fixture_hold_gap_scan_heads FORCE ROW LEVEL SECURITY;
CREATE POLICY v118_events_a ON v106_test.fixture_hold_gap_scan_events FOR ALL TO v106_writer_a
 USING(organization_id='11111111-1111-4111-8111-111111111111'::uuid)
 WITH CHECK(organization_id='11111111-1111-4111-8111-111111111111'::uuid);
CREATE POLICY v118_events_b ON v106_test.fixture_hold_gap_scan_events FOR ALL TO v106_writer_b
 USING(organization_id='22222222-2222-4222-8222-222222222222'::uuid)
 WITH CHECK(organization_id='22222222-2222-4222-8222-222222222222'::uuid);
CREATE POLICY v118_heads_a ON v106_test.fixture_hold_gap_scan_heads FOR ALL TO v106_writer_a
 USING(organization_id='11111111-1111-4111-8111-111111111111'::uuid)
 WITH CHECK(organization_id='11111111-1111-4111-8111-111111111111'::uuid);
CREATE POLICY v118_heads_b ON v106_test.fixture_hold_gap_scan_heads FOR ALL TO v106_writer_b
 USING(organization_id='22222222-2222-4222-8222-222222222222'::uuid)
 WITH CHECK(organization_id='22222222-2222-4222-8222-222222222222'::uuid);
