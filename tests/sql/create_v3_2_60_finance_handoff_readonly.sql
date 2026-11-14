\set ON_ERROR_STOP on
-- V3.2-60: CI-only read-only preparation view. No finance identity, decisions or expenses.
BEGIN;
CREATE VIEW ms.scoped_isolated_campaign_finance_handoffs WITH (security_barrier=true) AS
SELECT q.id AS review_id, q.campaign_id, q.campaign_version,
 q.requested_by, q.reviewed_by AS sales_approved_by,
 q.created_at AS submitted_at, q.reviewed_at AS sales_approved_at,
 q.campaign_snapshot->>'name' AS campaign_name,
 (q.campaign_snapshot->>'budget_cents')::bigint AS planned_budget_cents,
 jsonb_array_length(q.campaign_snapshot->'channel_ids') AS channel_count,
 'awaiting_external_finance_authority'::text AS handoff_status,
 false AS finance_authorized, false AS execution_allowed,
 'draft'::text AS campaign_status
FROM ms.isolated_campaign_sales_reviews q
WHERE q.status='sales_approved_pending_finance'
 AND q.organization_id=ms.current_scoped_organization_id()
 AND ms.current_scoped_staff_id() IS NOT NULL
 AND (q.requested_by=ms.current_scoped_staff_id()
      OR q.reviewed_by=ms.current_scoped_staff_id());
REVOKE ALL ON ms.scoped_isolated_campaign_finance_handoffs FROM PUBLIC;
GRANT SELECT ON ms.scoped_isolated_campaign_finance_handoffs TO ms_student_assignee_reader;
DO $guards$
DECLARE n text;
BEGIN
 FOREACH n IN ARRAY ARRAY['ms_assignee_reader_a','ms_assignee_reader_b',
  'ms_assignee_reader_manager','ms_assignee_reader_manager_2'] LOOP
  IF NOT has_table_privilege(n,'ms.scoped_isolated_campaign_finance_handoffs','SELECT')
   OR has_table_privilege(n,'ms.isolated_campaign_sales_reviews','SELECT')
   OR has_table_privilege(n,'ms.marketing_costs','SELECT')
   OR has_table_privilege(n,'ms.cost_allocations','SELECT')
  THEN RAISE EXCEPTION 'Finance handoff privileges invalid for %',n; END IF;
 END LOOP;
 FOREACH n IN ARRAY ARRAY['ms_write_a','ms_write_b','ms_write_manager','ms_write_manager_2'] LOOP
  IF has_table_privilege(n,'ms.scoped_isolated_campaign_finance_handoffs','SELECT')
   OR has_table_privilege(n,'ms.marketing_costs','INSERT')
   OR has_table_privilege(n,'ms.cost_allocations','INSERT')
  THEN RAISE EXCEPTION 'Finance handoff accidentally grants write privileges to %',n; END IF;
 END LOOP;
END $guards$;
COMMIT;
