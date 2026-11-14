\set ON_ERROR_STOP on
-- V3.2-69: isolated, read-only evidence checklist and sequential approval gates.
-- Sales evidence collection never equals independent case approval or external finance/academic verification.
BEGIN;
CREATE VIEW ms.scoped_isolated_campaign_compensation_evidence_approval_gates
WITH (security_barrier=true) AS
SELECT c.incident_id,c.review_id,c.incident_status,c.issue_kind,
 c.failure_classification,c.sales_packet_complete,
 c.preserve_original_orders_required,
 c.preserve_original_payments_required,
 c.preserve_original_sale_events_required,
 c.preserve_original_lessons_required,
 false AS sales_original_snapshot_verified,
 false AS sales_independent_case_approved,
 false AS finance_original_order_evidence_verified,
 false AS finance_original_payment_evidence_verified,
 false AS finance_independent_decision_signed,
 false AS academic_student_identity_verified,
 false AS academic_original_lesson_evidence_verified,
 false AS academic_independent_decision_signed,
 false AS compensation_history_chain_verified,
 false AS external_replay_and_revocation_verified,
 false AS all_source_record_hashes_verified,
 false AS joint_three_party_approval_verified,
 CASE
  WHEN NOT c.sales_packet_complete THEN 'blocked_sales_evidence_missing'
  ELSE 'blocked_independent_sales_case_authority_missing'
 END::text AS first_blocking_gate,
 '01_sales_independent_case_review'::text AS stage_1_sales,
 '02_finance_originals_and_signed_decision'::text AS stage_2_finance,
 '03_academic_student_lesson_signed_decision'::text AS stage_3_academic,
 '04_joint_evidence_and_history_reconciliation'::text AS stage_4_joint,
 'proposal_only_no_compensation_or_release'::text AS checklist_state,
 false AS original_records_mutable,
 false AS compensation_write_allowed,
 true AS hold_active,
 false AS release_eligible,
 false AS finance_authorized,
 false AS execution_allowed,
 false AS activity_publish_allowed
FROM ms.scoped_isolated_campaign_compensation_responsibility_matrix c
WHERE c.incident_status='manual_escalated'
 AND ms.current_scoped_staff_id() IS NOT NULL;
REVOKE ALL ON ms.scoped_isolated_campaign_compensation_evidence_approval_gates FROM PUBLIC;
GRANT SELECT ON ms.scoped_isolated_campaign_compensation_evidence_approval_gates
 TO ms_student_assignee_reader;
DO $guards$
DECLARE role_name text;
BEGIN
 FOREACH role_name IN ARRAY ARRAY[
 'ms_assignee_reader_a','ms_assignee_reader_b',
 'ms_assignee_reader_manager','ms_assignee_reader_manager_2'
 ] LOOP
  IF NOT has_table_privilege(role_name,
    'ms.scoped_isolated_campaign_compensation_evidence_approval_gates','SELECT')
   OR has_table_privilege(role_name,'ms.audit_events','SELECT')
   OR has_table_privilege(role_name,'ms.marketing_costs','SELECT')
   OR has_table_privilege(role_name,'ms.isolated_campaign_finance_incidents','SELECT')
  THEN RAISE EXCEPTION 'Compensation checklist reader boundary invalid: %',role_name; END IF;
 END LOOP;
 FOREACH role_name IN ARRAY ARRAY[
 'ms_write_a','ms_write_b','ms_write_manager','ms_write_manager_2'
 ] LOOP
  IF has_table_privilege(role_name,
    'ms.scoped_isolated_campaign_compensation_evidence_approval_gates','SELECT')
   OR has_table_privilege(role_name,'ms.marketing_costs','INSERT')
   OR has_table_privilege(role_name,'ms.isolated_campaign_finance_incidents','UPDATE')
  THEN RAISE EXCEPTION 'Compensation checklist writer unexpectedly privileged: %',role_name; END IF;
 END LOOP;
END $guards$;
COMMIT;
