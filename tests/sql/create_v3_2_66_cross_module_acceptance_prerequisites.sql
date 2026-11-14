\set ON_ERROR_STOP on
-- V3.2-66: only read-only, scoped prerequisites for future three-party acceptance.
-- The external finance/academic principal, signed receipt and release process do not exist.
BEGIN;
CREATE VIEW ms.scoped_isolated_campaign_cross_module_acceptance_prerequisites
WITH (security_barrier=true) AS
SELECT e.incident_id,e.review_id,e.incident_status,e.sales_packet_complete,
 CASE
  WHEN NOT e.sales_packet_complete THEN 'blocked_sales_packet_incomplete'
  ELSE 'blocked_trusted_finance_identity_missing'
 END::text AS prerequisite_status,
 false AS finance_principal_verified,
 false AS finance_signed_receipt_verified,
 false AS finance_budget_decision_verified,
 false AS academic_principal_verified,
 false AS academic_student_impact_reconciled,
 false AS academic_signed_attestation_verified,
 false AS cross_module_evidence_reconciled,
 false AS three_party_acceptance_verified,
 false AS compensation_history_verified,
 true AS hold_active,
 false AS release_eligible,
 false AS finance_authorized,
 false AS execution_allowed,
 false AS activity_publish_allowed
FROM ms.scoped_isolated_campaign_escalation_evidence_gates e
WHERE e.incident_status='manual_escalated'
 AND ms.current_scoped_staff_id() IS NOT NULL;
REVOKE ALL ON ms.scoped_isolated_campaign_cross_module_acceptance_prerequisites FROM PUBLIC;
GRANT SELECT ON ms.scoped_isolated_campaign_cross_module_acceptance_prerequisites
 TO ms_student_assignee_reader;
DO $guards$
DECLARE principal text;
BEGIN
 FOREACH principal IN ARRAY ARRAY[
  'ms_assignee_reader_a','ms_assignee_reader_b',
  'ms_assignee_reader_manager','ms_assignee_reader_manager_2'
 ] LOOP
  IF NOT has_table_privilege(principal,
    'ms.scoped_isolated_campaign_cross_module_acceptance_prerequisites','SELECT')
   OR has_table_privilege(principal,'ms.isolated_campaign_finance_incidents','SELECT')
   OR has_table_privilege(principal,'ms.isolated_campaign_finance_escalation_followups','SELECT')
   OR has_table_privilege(principal,'ms.audit_events','SELECT')
   OR has_table_privilege(principal,'ms.marketing_costs','SELECT')
  THEN RAISE EXCEPTION 'Cross-module prerequisites readonly role invalid: %',principal; END IF;
 END LOOP;
 FOREACH principal IN ARRAY ARRAY[
  'ms_write_a','ms_write_b','ms_write_manager','ms_write_manager_2'
 ] LOOP
  IF has_table_privilege(principal,
    'ms.scoped_isolated_campaign_cross_module_acceptance_prerequisites','SELECT')
   OR has_table_privilege(principal,'ms.marketing_costs','INSERT')
   OR has_table_privilege(principal,'ms.isolated_campaign_finance_incidents','UPDATE')
  THEN RAISE EXCEPTION 'Cross-module prerequisites cannot grant execution: %',principal; END IF;
 END LOOP;
END $guards$;
COMMIT;
