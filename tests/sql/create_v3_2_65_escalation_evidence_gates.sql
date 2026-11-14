\set ON_ERROR_STOP on
-- V3.2-65 CI-only: evidence completeness is NOT any department's approval.
BEGIN;
CREATE VIEW ms.scoped_isolated_campaign_escalation_evidence_gates
WITH (security_barrier=true) AS
SELECT i.incident_id,i.review_id,i.status AS incident_status,
 COALESCE(e.reporter_addendum,false) AS reporter_evidence_present,
 COALESCE(e.reviewer_addendum,false) AS independent_sales_review_present,
 COALESCE(e.finance_requirements_note,false) AS finance_requirements_documented,
 (COALESCE(e.reporter_addendum,false)
  AND COALESCE(e.reviewer_addendum,false)
  AND COALESCE(e.finance_requirements_note,false)) AS sales_packet_complete,
 CASE
  WHEN NOT COALESCE(e.reporter_addendum,false)
    THEN 'blocked_missing_reporter_evidence'
  WHEN NOT COALESCE(e.reviewer_addendum,false)
    THEN 'blocked_missing_independent_sales_evidence'
  WHEN NOT COALESCE(e.finance_requirements_note,false)
    THEN 'blocked_missing_finance_requirements_note'
  ELSE 'sales_packet_collected_external_acceptance_pending'
 END::text AS sales_packet_status,
 false AS finance_acceptance_verified,
 false AS academic_acceptance_verified,
 false AS cross_department_accepted,
 true AS hold_active,
 false AS finance_authorized,false AS execution_allowed
FROM ms.scoped_isolated_campaign_finance_incidents i
LEFT JOIN LATERAL (
 SELECT
  bool_or(f.recorded_by=i.reported_by AND
   f.responsibility_boundary='sales_reporter' AND
   f.note_type='sales_evidence_addendum') AS reporter_addendum,
  bool_or(f.recorded_by=i.reviewed_by AND
   i.reviewed_by<>i.reported_by AND
   f.responsibility_boundary='independent_sales_reviewer' AND
   f.note_type='sales_evidence_addendum') AS reviewer_addendum,
  bool_or(f.recorded_by=i.reviewed_by AND
   i.reviewed_by<>i.reported_by AND
   f.responsibility_boundary='independent_sales_reviewer' AND
   f.note_type='external_finance_requirements_pending') AS finance_requirements_note
 FROM ms.isolated_campaign_finance_escalation_followups f
 WHERE f.incident_id=i.incident_id
  AND f.organization_id=ms.current_scoped_organization_id()
) e ON true
WHERE i.status='manual_escalated'
 AND ms.current_scoped_staff_id() IS NOT NULL;
REVOKE ALL ON ms.scoped_isolated_campaign_escalation_evidence_gates FROM PUBLIC;
GRANT SELECT ON ms.scoped_isolated_campaign_escalation_evidence_gates
 TO ms_student_assignee_reader;
DO $guards$
DECLARE login_name text;
BEGIN
 FOREACH login_name IN ARRAY ARRAY[
  'ms_assignee_reader_a','ms_assignee_reader_b',
  'ms_assignee_reader_manager','ms_assignee_reader_manager_2'
 ] LOOP
  IF NOT has_table_privilege(login_name,
   'ms.scoped_isolated_campaign_escalation_evidence_gates','SELECT')
   OR has_table_privilege(login_name,
    'ms.isolated_campaign_finance_escalation_followups','SELECT')
   OR has_table_privilege(login_name,'ms.audit_events','SELECT')
   OR has_table_privilege(login_name,'ms.marketing_costs','SELECT')
  THEN RAISE EXCEPTION 'Evidence gate read scope invalid: %',login_name; END IF;
 END LOOP;
 FOREACH login_name IN ARRAY ARRAY[
  'ms_write_a','ms_write_b','ms_write_manager','ms_write_manager_2'
 ] LOOP
  IF has_table_privilege(login_name,
   'ms.scoped_isolated_campaign_escalation_evidence_gates','SELECT')
   OR has_table_privilege(login_name,
    'ms.isolated_campaign_finance_escalation_followups','INSERT')
   OR has_table_privilege(login_name,'ms.marketing_costs','INSERT')
  THEN RAISE EXCEPTION 'Evidence gate accidentally grants write access: %',login_name; END IF;
 END LOOP;
END $guards$;
COMMIT;
