\set ON_ERROR_STOP on
-- V3.2-68. CI-only compensation candidate classification and responsibility matrix.
-- No external source has provided academic/financial status; do not assert it was verified.
BEGIN;
CREATE VIEW ms.scoped_isolated_campaign_compensation_responsibility_matrix
WITH (security_barrier=true) AS
SELECT t.incident_id,t.review_id,t.incident_status,t.sales_packet_complete,
 i.issue_kind,
 CASE
   WHEN i.issue_kind='integrity_mismatch' THEN 'snapshot_integrity_conflict'
   WHEN NOT t.sales_packet_complete THEN 'sales_evidence_gap'
   ELSE 'external_authority_or_reconciliation_unknown'
 END::text AS failure_classification,
 CASE
   WHEN i.issue_kind='integrity_mismatch' THEN 'independent_sales_snapshot_review_required'
   WHEN NOT t.sales_packet_complete THEN 'sales_evidence_addenda_required'
   ELSE 'external_finance_academic_reconciliation_required'
 END::text AS proposed_next_step,
 'sales:original_reporter_and_independent_reviewer'::text AS sales_responsibility,
 'finance:trusted_independent_receipt_and_payment_reconciliation_required'::text
   AS finance_responsibility,
 'academic:trusted_student_and_lesson_reconciliation_required'::text
   AS academic_responsibility,
 'candidate_only_no_execution_authority'::text AS compensation_candidate_state,
 false AS downstream_student_impact_assessed,
 false AS actual_order_reconciliation_verified,
 false AS actual_payment_reconciliation_verified,
 false AS actual_sale_event_reconciliation_verified,
 false AS actual_lesson_reconciliation_verified,
 false AS historical_compensation_chain_verified,
 false AS independent_sales_case_accepted,
 false AS independent_finance_case_accepted,
 false AS independent_academic_case_accepted,
 false AS all_original_records_integrity_verified,
 true AS preserve_original_orders_required,
 true AS preserve_original_payments_required,
 true AS preserve_original_sale_events_required,
 true AS preserve_original_lessons_required,
 false AS original_records_mutable,
 false AS compensation_write_allowed,
 true AS hold_active,
 false AS release_eligible,
 false AS finance_authorized,
 false AS execution_allowed,
 false AS activity_publish_allowed
FROM ms.scoped_isolated_campaign_cross_module_trust_failure_gates t
JOIN ms.scoped_isolated_campaign_finance_incidents i
 ON i.incident_id=t.incident_id AND i.review_id=t.review_id
WHERE t.incident_status='manual_escalated'
 AND ms.current_scoped_staff_id() IS NOT NULL;
REVOKE ALL ON ms.scoped_isolated_campaign_compensation_responsibility_matrix FROM PUBLIC;
GRANT SELECT ON ms.scoped_isolated_campaign_compensation_responsibility_matrix
 TO ms_student_assignee_reader;
DO $guards$
DECLARE role_name text;
BEGIN
 FOREACH role_name IN ARRAY ARRAY[
  'ms_assignee_reader_a','ms_assignee_reader_b',
  'ms_assignee_reader_manager','ms_assignee_reader_manager_2'
 ] LOOP
  IF NOT has_table_privilege(role_name,
   'ms.scoped_isolated_campaign_compensation_responsibility_matrix','SELECT')
   OR has_table_privilege(role_name,'ms.audit_events','SELECT')
   OR has_table_privilege(role_name,'ms.marketing_costs','SELECT')
   OR has_table_privilege(role_name,'ms.isolated_campaign_finance_incidents','SELECT')
  THEN RAISE EXCEPTION 'Compensation matrix reader boundary violated: %',role_name; END IF;
 END LOOP;
 FOREACH role_name IN ARRAY ARRAY[
  'ms_write_a','ms_write_b','ms_write_manager','ms_write_manager_2'
 ] LOOP
  IF has_table_privilege(role_name,
   'ms.scoped_isolated_campaign_compensation_responsibility_matrix','SELECT')
   OR has_table_privilege(role_name,'ms.marketing_costs','INSERT')
   OR has_table_privilege(role_name,'ms.isolated_campaign_finance_incidents','UPDATE')
  THEN RAISE EXCEPTION 'Compensation matrix has excessive privileges: %',role_name; END IF;
 END LOOP;
END $guards$;
COMMIT;
