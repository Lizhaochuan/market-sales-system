\set ON_ERROR_STOP on
-- V3.2-55 CI-only minimal read projection for channel maintenance requests.
-- Never import real CRM or finance data. This is not migration 039.
BEGIN;
CREATE VIEW ms.scoped_isolated_channel_change_requests
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
  OR (q.status='pending' AND EXISTS (
   SELECT 1 FROM ms.user_role_grants g JOIN ms.role_templates t ON t.id=g.role_id
   WHERE g.user_id=ms.current_scoped_staff_id()
    AND t.organization_id=q.organization_id AND t.role_code='sales_manager'
    AND g.revoked_at IS NULL AND g.valid_from<=now()))
 );
REVOKE ALL ON ms.scoped_isolated_channel_change_requests FROM PUBLIC;
GRANT SELECT ON ms.scoped_isolated_channel_change_requests TO ms_student_assignee_reader;

DO $guard$
DECLARE login_name text;
BEGIN
 FOREACH login_name IN ARRAY ARRAY[
 'ms_assignee_reader_a','ms_assignee_reader_b',
 'ms_assignee_reader_manager','ms_assignee_reader_manager_2'
 ] LOOP
  IF NOT has_table_privilege(login_name,'ms.scoped_isolated_channel_change_requests','SELECT')
   OR has_table_privilege(login_name,'ms.isolated_channel_change_requests','SELECT')
   OR has_table_privilege(login_name,'ms.marketing_channels','SELECT')
   OR has_table_privilege(login_name,'ms.sales_orders','SELECT')
   OR has_table_privilege(login_name,'ms.payment_allocations','SELECT')
   OR has_table_privilege(login_name,'ms.audit_events','UPDATE') THEN
   RAISE EXCEPTION 'V3.2-55 channel review account must not gain raw business or finance access: %',login_name;
  END IF;
 END LOOP;
END $guard$;
COMMIT;
