\set ON_ERROR_STOP on
-- V3.2-63 CI-only: scoped immutable incident event chronology, NO finance grant.
BEGIN;
CREATE VIEW ms.scoped_isolated_campaign_finance_incident_audit_history
WITH (security_barrier=true) AS
SELECT a.id AS audit_id,a.target_id AS incident_id,
 i.review_id,i.issue_kind,a.event_name,a.actor_user_id,a.happened_at,
 CASE a.event_name
  WHEN 'CAMPAIGN_FINANCE_HANDOFF_ISSUE_REPORTED' THEN 'open'
  WHEN 'CAMPAIGN_FINANCE_ISSUE_ESCALATED' THEN 'manual_escalated'
  WHEN 'CAMPAIGN_FINANCE_ISSUE_RECHECK_REQUESTED' THEN 'closed_for_recheck'
 END::text AS event_status,
 i.status AS current_incident_status,
 false AS finance_authorized,false AS execution_allowed
FROM ms.audit_events a
JOIN ms.scoped_isolated_campaign_finance_incidents i ON i.incident_id=a.target_id
WHERE a.target_type='marketing_campaign_finance_incident'
 AND a.event_name IN (
  'CAMPAIGN_FINANCE_HANDOFF_ISSUE_REPORTED',
  'CAMPAIGN_FINANCE_ISSUE_ESCALATED',
  'CAMPAIGN_FINANCE_ISSUE_RECHECK_REQUESTED')
 AND a.organization_id=ms.current_scoped_organization_id()
 AND ms.current_scoped_staff_id() IS NOT NULL;
REVOKE ALL ON ms.scoped_isolated_campaign_finance_incident_audit_history FROM PUBLIC;
GRANT SELECT ON ms.scoped_isolated_campaign_finance_incident_audit_history
 TO ms_student_assignee_reader;
DO $guards$
DECLARE login_name text;
BEGIN
 FOREACH login_name IN ARRAY ARRAY[
  'ms_assignee_reader_a','ms_assignee_reader_b',
  'ms_assignee_reader_manager','ms_assignee_reader_manager_2'
 ] LOOP
  IF NOT has_table_privilege(login_name,'ms.scoped_isolated_campaign_finance_incident_audit_history','SELECT')
   OR has_table_privilege(login_name,'ms.audit_events','SELECT')
   OR has_table_privilege(login_name,'ms.audit_events','UPDATE')
   OR has_table_privilege(login_name,'ms.audit_events','DELETE')
   OR has_table_privilege(login_name,'ms.isolated_campaign_finance_incidents','SELECT')
   OR has_table_privilege(login_name,'ms.marketing_costs','SELECT')
   OR has_table_privilege(login_name,'ms.sales_orders','SELECT')
  THEN RAISE EXCEPTION 'Incident audit scope invalid for %',login_name; END IF;
 END LOOP;
END $guards$;
COMMIT;
