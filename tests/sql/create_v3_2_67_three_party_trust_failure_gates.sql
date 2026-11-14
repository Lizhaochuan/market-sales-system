\set ON_ERROR_STOP on
-- V3.2-67 CI-only external trust failure and compensation boundary projection.
-- This is not a verifier, signature acceptance, compensation execution or hold release.
BEGIN;
CREATE VIEW ms.scoped_isolated_campaign_cross_module_trust_failure_gates
WITH (security_barrier=true) AS
SELECT p.incident_id,p.review_id,p.incident_status,p.sales_packet_complete,
 CASE
  WHEN NOT p.sales_packet_complete THEN 'blocked_sales_packet_incomplete'
  ELSE 'blocked_external_finance_trust_chain_unavailable'
 END::text AS trust_failure_code,
 'reject_preserve_originals_escalate_manually'::text AS failure_disposition,
 'append_only_compensation_requires_independent_authority'::text AS compensation_boundary,
 false AS external_signature_verified,
 false AS signature_key_current_verified,
 false AS signer_role_separation_verified,
 false AS signed_digest_bound_to_snapshot,
 false AS receipt_freshness_verified,
 false AS signer_revocation_checked,
 false AS replay_nonce_registry_checked,
 false AS finance_signed_receipt_verified,
 false AS academic_signed_attestation_verified,
 false AS external_reconciliation_verified,
 false AS compensation_write_allowed,
 false AS original_records_mutable,
 false AS three_party_acceptance_verified,
 true AS hold_active,
 false AS release_eligible,
 false AS finance_authorized,
 false AS execution_allowed,
 false AS activity_publish_allowed
FROM ms.scoped_isolated_campaign_cross_module_acceptance_prerequisites p
WHERE p.incident_status='manual_escalated'
 AND ms.current_scoped_staff_id() IS NOT NULL;
REVOKE ALL ON ms.scoped_isolated_campaign_cross_module_trust_failure_gates FROM PUBLIC;
GRANT SELECT ON ms.scoped_isolated_campaign_cross_module_trust_failure_gates TO ms_student_assignee_reader;
DO $guards$
DECLARE who text;
BEGIN
 FOREACH who IN ARRAY ARRAY[
  'ms_assignee_reader_a','ms_assignee_reader_b',
  'ms_assignee_reader_manager','ms_assignee_reader_manager_2'
 ] LOOP
  IF NOT has_table_privilege(who,'ms.scoped_isolated_campaign_cross_module_trust_failure_gates','SELECT')
   OR has_table_privilege(who,'ms.audit_events','SELECT')
   OR has_table_privilege(who,'ms.marketing_costs','SELECT')
   OR has_table_privilege(who,'ms.isolated_campaign_finance_escalation_followups','SELECT')
  THEN RAISE EXCEPTION 'Three-party trust-failure read scope violation: %',who; END IF;
 END LOOP;
 FOREACH who IN ARRAY ARRAY[
  'ms_write_a','ms_write_b','ms_write_manager','ms_write_manager_2'
 ] LOOP
  IF has_table_privilege(who,'ms.scoped_isolated_campaign_cross_module_trust_failure_gates','SELECT')
   OR has_table_privilege(who,'ms.marketing_costs','INSERT')
   OR has_table_privilege(who,'ms.isolated_campaign_finance_incidents','UPDATE')
  THEN RAISE EXCEPTION 'Three-party trust-failure write scope violation: %',who; END IF;
 END LOOP;
END $guards$;
COMMIT;
