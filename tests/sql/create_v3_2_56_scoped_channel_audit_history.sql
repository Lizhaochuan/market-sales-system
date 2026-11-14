\set ON_ERROR_STOP on
-- V3.2-56 disposable CI only: least-privilege channel event chronology.
-- 001-038 unchanged. No raw audit JSON, evidence, or finance exposure.
BEGIN;
CREATE OR REPLACE VIEW ms.scoped_isolated_channel_change_requests
WITH (security_barrier=true) AS
SELECT q.id AS request_id,q.action,q.channel_id,
 q.proposed_name,q.proposed_parent_id,q.proposed_type,
 q.status,q.created_at,q.requested_by,
 (q.status='pending' AND q.requested_by<>ms.current_scoped_staff_id()
  AND EXISTS(
   SELECT 1 FROM ms.user_role_grants g JOIN ms.role_templates t ON t.id=g.role_id
   WHERE g.user_id=ms.current_scoped_staff_id()
    AND t.organization_id=q.organization_id AND t.role_code='sales_manager'
    AND g.revoked_at IS NULL AND g.valid_from<=now())) AS can_review
FROM ms.isolated_channel_change_requests q
WHERE q.organization_id=ms.current_scoped_organization_id()
 AND ms.current_scoped_staff_id() IS NOT NULL
 AND (
  q.requested_by=ms.current_scoped_staff_id()
  OR q.reviewed_by=ms.current_scoped_staff_id()
  OR (q.status='pending' AND EXISTS(
   SELECT 1 FROM ms.user_role_grants g JOIN ms.role_templates t ON t.id=g.role_id
   WHERE g.user_id=ms.current_scoped_staff_id()
    AND t.organization_id=q.organization_id AND t.role_code='sales_manager'
    AND g.revoked_at IS NULL AND g.valid_from<=now()))
 );

CREATE VIEW ms.scoped_isolated_channel_audit_history
WITH (security_barrier=true) AS
SELECT a.id AS audit_id,a.target_id AS request_id,
 a.event_name,a.actor_user_id,a.happened_at,
 q.action,q.status,q.requested_by
FROM ms.audit_events a
JOIN ms.scoped_isolated_channel_change_requests q ON q.request_id=a.target_id
WHERE a.target_type='marketing_channel_request'
 AND a.event_name IN
 ('CHANNEL_CHANGE_REQUESTED','CHANNEL_CHANGE_APPLIED','CHANNEL_CHANGE_REJECTED')
 AND a.organization_id=ms.current_scoped_organization_id()
 AND ms.current_scoped_staff_id() IS NOT NULL;
REVOKE ALL ON ms.scoped_isolated_channel_audit_history FROM PUBLIC;
GRANT SELECT ON ms.scoped_isolated_channel_audit_history TO ms_student_assignee_reader;
DO $guard$
DECLARE login_name text;
BEGIN
 FOREACH login_name IN ARRAY ARRAY[
  'ms_assignee_reader_a','ms_assignee_reader_b',
  'ms_assignee_reader_manager','ms_assignee_reader_manager_2'
 ] LOOP
  IF NOT has_table_privilege(login_name,'ms.scoped_isolated_channel_audit_history','SELECT')
   OR has_table_privilege(login_name,'ms.audit_events','SELECT')
   OR has_table_privilege(login_name,'ms.audit_events','UPDATE')
   OR has_table_privilege(login_name,'ms.audit_events','DELETE')
   OR has_table_privilege(login_name,'ms.isolated_channel_change_requests','SELECT')
   OR has_table_privilege(login_name,'ms.marketing_channels','SELECT')
   OR has_table_privilege(login_name,'ms.sales_orders','SELECT')
   OR has_table_privilege(login_name,'ms.payment_allocations','SELECT') THEN
   RAISE EXCEPTION 'V3.2-56 audit projection must not broaden base table grants for %',login_name;
  END IF;
 END LOOP;
END $guard$;
COMMIT;
