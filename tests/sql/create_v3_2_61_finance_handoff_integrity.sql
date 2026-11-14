\set ON_ERROR_STOP on
-- V3.2-61 CI-only finance handoff integrity. Readiness is NOT finance approval.
BEGIN;
CREATE OR REPLACE VIEW ms.scoped_isolated_campaign_finance_handoffs
 WITH (security_barrier=true) AS
SELECT q.id AS review_id,q.campaign_id,q.campaign_version,
 q.requested_by,q.reviewed_by AS sales_approved_by,
 q.created_at AS submitted_at,q.reviewed_at AS sales_approved_at,
 q.campaign_snapshot->>'name' AS campaign_name,
 (q.campaign_snapshot->>'budget_cents')::bigint AS planned_budget_cents,
 jsonb_array_length(q.campaign_snapshot->'channel_ids') AS channel_count,
 'awaiting_external_finance_authority'::text AS handoff_status,
 false AS finance_authorized,false AS execution_allowed,
 'draft'::text AS campaign_status,
 CASE
  WHEN c.id IS NULL THEN 'blocked_missing_campaign'
  WHEN c.status IS DISTINCT FROM 'draft' THEN 'blocked_campaign_not_draft'
  WHEN q.campaign_version IS DISTINCT FROM COALESCE(v.version,1)
   OR q.campaign_snapshot IS DISTINCT FROM jsonb_build_object(
    'version',COALESCE(v.version,1),'name',c.name,'starts_at',c.starts_at,
    'ends_at',c.ends_at,'budget_cents',c.budget_cents,'owner',c.owner_user_id,
    'channel_ids',ch.channel_ids,'status',c.status)
   THEN 'blocked_snapshot_mismatch'
  ELSE 'ready_for_external_manual_check'
 END::text AS readiness_status
FROM ms.isolated_campaign_sales_reviews q
LEFT JOIN ms.marketing_campaigns c
 ON c.id=q.campaign_id AND c.organization_id=q.organization_id
LEFT JOIN ms.isolated_campaign_draft_versions v ON v.campaign_id=q.campaign_id
LEFT JOIN LATERAL (
 SELECT array_agg(channel_id ORDER BY channel_id) AS channel_ids
 FROM ms.campaign_channels WHERE campaign_id=q.campaign_id
) ch ON true
WHERE q.status='sales_approved_pending_finance'
 AND q.organization_id=ms.current_scoped_organization_id()
 AND ms.current_scoped_staff_id() IS NOT NULL
 AND (q.requested_by=ms.current_scoped_staff_id()
  OR q.reviewed_by=ms.current_scoped_staff_id());
REVOKE ALL ON ms.scoped_isolated_campaign_finance_handoffs FROM PUBLIC;
GRANT SELECT ON ms.scoped_isolated_campaign_finance_handoffs TO ms_student_assignee_reader;
COMMIT;
