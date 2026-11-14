\set ON_ERROR_STOP on
-- V3.2-70: CI-only read-only snapshot freeze readiness gate.
-- Source revision, authenticated SHA-256, persistent nonce and external signatures
-- are NOT available at runtime; fixture-only cryptography MUST NOT claim approval.
BEGIN;
CREATE VIEW ms.scoped_isolated_campaign_compensation_packet_freeze_gates
WITH (security_barrier=true) AS
SELECT c.incident_id,c.review_id,c.incident_status,c.issue_kind,
 c.failure_classification,c.sales_packet_complete,
 CASE WHEN NOT c.sales_packet_complete
      THEN 'blocked_sales_packet_incomplete'
      ELSE 'blocked_independent_sales_review_and_freeze_missing'
 END::text AS freeze_block_reason,
 'fixture_only_not_available_in_runtime'::text AS freeze_registry_status,
 NULL::bigint AS frozen_source_revision,
 NULL::integer AS freeze_version,
 NULL::text AS evidence_sha256,
 false AS evidence_packet_frozen,
 false AS independent_sales_case_approved,
 false AS trusted_source_revision_verified,
 false AS canonical_digest_verified,
 false AS persistent_idempotency_registry_verified,
 false AS revision_compare_and_swap_verified,
 false AS evidence_immutability_verified,
 false AS external_signature_verified,
 false AS financial_receipt_verified,
 false AS academic_receipt_verified,
 false AS historical_originals_integrity_verified,
 true AS preserve_original_orders_required,
 true AS preserve_original_payments_required,
 true AS preserve_original_sale_events_required,
 true AS preserve_original_lessons_required,
 false AS original_records_mutable,
 false AS packet_handoff_allowed,
 false AS compensation_write_allowed,
 true AS hold_active,
 false AS release_eligible,
 false AS finance_authorized,
 false AS execution_allowed,
 false AS activity_publish_allowed
FROM ms.scoped_isolated_campaign_compensation_evidence_approval_gates c
WHERE c.incident_status='manual_escalated'
  AND ms.current_scoped_staff_id() IS NOT NULL;
REVOKE ALL ON ms.scoped_isolated_campaign_compensation_packet_freeze_gates FROM PUBLIC;
GRANT SELECT ON ms.scoped_isolated_campaign_compensation_packet_freeze_gates
 TO ms_student_assignee_reader;
DO $guards$
DECLARE account text;
BEGIN
 FOREACH account IN ARRAY ARRAY[
  'ms_assignee_reader_a','ms_assignee_reader_b',
  'ms_assignee_reader_manager','ms_assignee_reader_manager_2'
 ] LOOP
  IF NOT has_table_privilege(account,
    'ms.scoped_isolated_campaign_compensation_packet_freeze_gates','SELECT')
   OR has_table_privilege(account,'ms.audit_events','SELECT')
   OR has_table_privilege(account,'ms.marketing_costs','SELECT')
   OR has_table_privilege(account,'ms.isolated_campaign_finance_incidents','SELECT')
  THEN RAISE EXCEPTION 'Packet freeze reader boundary violated: %',account; END IF;
 END LOOP;
 FOREACH account IN ARRAY ARRAY[
  'ms_write_a','ms_write_b','ms_write_manager','ms_write_manager_2'
 ] LOOP
  IF has_table_privilege(account,
    'ms.scoped_isolated_campaign_compensation_packet_freeze_gates','SELECT')
   OR has_table_privilege(account,'ms.marketing_costs','INSERT')
   OR has_table_privilege(account,'ms.isolated_campaign_finance_incidents','UPDATE')
  THEN RAISE EXCEPTION 'Packet freeze writer has excess privileges: %',account; END IF;
 END LOOP;
END $guards$;
COMMIT;
