\set ON_ERROR_STOP on
-- V3.2-62: CI-only sales-side handoff incident ledger, not finance authorization.
BEGIN;
CREATE TABLE ms.isolated_campaign_finance_incidents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES ms.organizations(id),
 review_id uuid NOT NULL REFERENCES ms.isolated_campaign_sales_reviews(id),
 campaign_id uuid NOT NULL REFERENCES ms.marketing_campaigns(id),
 reported_by uuid NOT NULL REFERENCES ms.staff_users(id),
 issue_kind text NOT NULL CHECK(issue_kind IN ('integrity_mismatch','supporting_materials_gap')),
 observed_readiness text NOT NULL,
 evidence_ref text NOT NULL,
 report_reason text NOT NULL,
 request_key text NOT NULL CHECK(request_key ~ '^[a-zA-Z0-9_-]{16,128}$'),
 request_fingerprint text NOT NULL,
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','manual_escalated','closed_for_recheck')),
 reviewed_by uuid REFERENCES ms.staff_users(id),
 review_action text CHECK(review_action IN ('escalate_manual','close_for_recheck')),
 review_evidence_ref text,
 review_reason text,
 review_key text,
 created_at timestamptz NOT NULL DEFAULT now(),
 reviewed_at timestamptz,
 CHECK(reviewed_by IS NULL OR reviewed_by<>reported_by),
 UNIQUE(reported_by,request_key)
);
CREATE UNIQUE INDEX isolated_finance_incident_one_live
 ON ms.isolated_campaign_finance_incidents(review_id)
 WHERE status IN ('open','manual_escalated');
CREATE UNIQUE INDEX isolated_finance_incident_review_key
 ON ms.isolated_campaign_finance_incidents(reviewed_by,review_key)
 WHERE reviewed_by IS NOT NULL AND review_key IS NOT NULL;
REVOKE ALL ON ms.isolated_campaign_finance_incidents FROM PUBLIC;
REVOKE ALL ON ms.isolated_campaign_finance_incidents FROM ms_scoped_lowrisk_writer;
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
  WHEN EXISTS(SELECT 1 FROM ms.isolated_campaign_finance_incidents i WHERE i.review_id=q.id AND i.status IN ('open','manual_escalated')) THEN 'blocked_active_incident'
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

CREATE VIEW ms.scoped_isolated_campaign_finance_incidents WITH (security_barrier=true) AS
SELECT i.id AS incident_id,i.review_id,i.campaign_id,i.reported_by,
 i.issue_kind,i.observed_readiness,i.status,i.created_at,i.reviewed_at,i.reviewed_by,
 (i.status='open' AND i.reported_by<>ms.current_scoped_staff_id() AND EXISTS(
  SELECT 1 FROM ms.user_role_grants g JOIN ms.role_templates r ON r.id=g.role_id
  WHERE g.user_id=ms.current_scoped_staff_id() AND r.organization_id=i.organization_id
   AND r.role_code='sales_manager' AND g.revoked_at IS NULL AND g.valid_from<=now()
 )) AS can_triage
FROM ms.isolated_campaign_finance_incidents i
JOIN ms.isolated_campaign_sales_reviews q ON q.id=i.review_id AND q.organization_id=i.organization_id
WHERE i.organization_id=ms.current_scoped_organization_id()
 AND ms.current_scoped_staff_id() IS NOT NULL
 AND (i.reported_by=ms.current_scoped_staff_id() OR q.requested_by=ms.current_scoped_staff_id()
  OR q.reviewed_by=ms.current_scoped_staff_id() OR i.reviewed_by=ms.current_scoped_staff_id()
  OR (i.status='open' AND EXISTS(
   SELECT 1 FROM ms.user_role_grants g JOIN ms.role_templates r ON r.id=g.role_id
   WHERE g.user_id=ms.current_scoped_staff_id() AND r.organization_id=i.organization_id
    AND r.role_code='sales_manager' AND g.revoked_at IS NULL AND g.valid_from<=now()
  )));
REVOKE ALL ON ms.scoped_isolated_campaign_finance_incidents FROM PUBLIC;
GRANT SELECT ON ms.scoped_isolated_campaign_finance_incidents TO ms_student_assignee_reader;

CREATE FUNCTION ms.report_isolated_campaign_finance_incident(
 p_review uuid,p_kind text,p_evidence text,p_reason text,p_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ms
AS $report$
DECLARE actor uuid;org uuid;h record;prior ms.isolated_campaign_finance_incidents%ROWTYPE;fp text;new_id uuid;
BEGIN
 SELECT ms.current_scoped_staff_id(),ms.current_scoped_organization_id() INTO actor,org;
 IF actor IS NULL OR org IS NULL OR NOT EXISTS(
  SELECT 1 FROM ms.staff_users s WHERE s.id=actor AND s.organization_id=org AND s.status='active')
 THEN RAISE EXCEPTION '未核实异常报告人' USING ERRCODE='42501'; END IF;
 IF p_review IS NULL OR p_kind IS NULL OR p_kind NOT IN ('integrity_mismatch','supporting_materials_gap')
 OR p_evidence IS NULL OR length(trim(p_evidence)) NOT BETWEEN 2 AND 200
 OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 2 AND 400
 OR p_key IS NULL OR p_key !~ '^[a-zA-Z0-9_-]{16,128}$'
 THEN RAISE EXCEPTION '交接异常登记字段不完整' USING ERRCODE='23514'; END IF;
 fp:=encode(sha256(convert_to(jsonb_build_object('review',p_review,'kind',p_kind,
  'evidence',trim(p_evidence),'reason',trim(p_reason))::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||':finance_incident:'||p_key,0));
 SELECT * INTO prior FROM ms.isolated_campaign_finance_incidents WHERE reported_by=actor AND request_key=p_key;
 IF FOUND THEN
  IF prior.request_fingerprint<>fp THEN RAISE EXCEPTION '同编号对应不同异常' USING ERRCODE='23505'; END IF;
  RETURN jsonb_build_object('incident_id',prior.id,'status',prior.status,'finance_authorized',false);
 END IF;
 SELECT hq.review_id,hq.campaign_id,hq.readiness_status INTO h
 FROM ms.scoped_isolated_campaign_finance_handoffs hq WHERE hq.review_id=p_review;
 IF NOT FOUND THEN RAISE EXCEPTION '无权登记此交接异常' USING ERRCODE='42501'; END IF;
 IF p_kind='integrity_mismatch' AND h.readiness_status='ready_for_external_manual_check'
 THEN RAISE EXCEPTION '快照一致，不允许虚报差异' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM ms.isolated_campaign_finance_incidents
  WHERE review_id=p_review AND status IN ('open','manual_escalated'))
 THEN RAISE EXCEPTION '存在未处理交接异常' USING ERRCODE='23505'; END IF;
 INSERT INTO ms.isolated_campaign_finance_incidents(
  organization_id,review_id,campaign_id,reported_by,issue_kind,observed_readiness,
  evidence_ref,report_reason,request_key,request_fingerprint)
 VALUES(org,p_review,h.campaign_id,actor,p_kind,h.readiness_status,
  trim(p_evidence),trim(p_reason),p_key,fp) RETURNING id INTO new_id;
 INSERT INTO ms.audit_events(organization_id,actor_user_id,target_type,target_id,event_name,
  before_business_json,after_business_json,reason_zh)
 VALUES(org,actor,'marketing_campaign_finance_incident',new_id,
  'CAMPAIGN_FINANCE_HANDOFF_ISSUE_REPORTED','{}'::jsonb,
  jsonb_build_object('review_id',p_review,'status','open','issue_kind',p_kind,
   'finance_authorized',false),'销售侧交接异常登记，未获财务批准');
 RETURN jsonb_build_object('incident_id',new_id,'status','open',
  'review_id',p_review,'finance_authorized',false);
END $report$;
REVOKE ALL ON FUNCTION ms.report_isolated_campaign_finance_incident(uuid,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ms.report_isolated_campaign_finance_incident(uuid,text,text,text,text)
 TO ms_scoped_lowrisk_writer;

CREATE FUNCTION ms.triage_isolated_campaign_finance_incident(
 p_incident uuid,p_action text,p_evidence text,p_reason text,p_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ms
AS $triage$
DECLARE actor uuid;org uuid;i ms.isolated_campaign_finance_incidents%ROWTYPE;
 q ms.isolated_campaign_sales_reviews%ROWTYPE;c ms.marketing_campaigns%ROWTYPE;
 current_version integer;channels uuid[];snapshot jsonb;after_status text;
BEGIN
 SELECT ms.current_scoped_staff_id(),ms.current_scoped_organization_id() INTO actor,org;
 IF actor IS NULL OR org IS NULL OR NOT EXISTS(
  SELECT 1 FROM ms.staff_users s WHERE s.id=actor AND s.organization_id=org AND s.status='active')
 OR NOT EXISTS(SELECT 1 FROM ms.user_role_grants g JOIN ms.role_templates r ON r.id=g.role_id
  WHERE g.user_id=actor AND r.organization_id=org AND r.role_code='sales_manager'
  AND g.revoked_at IS NULL AND g.valid_from<=now())
 THEN RAISE EXCEPTION '仅有效独立销售主管可复核' USING ERRCODE='42501'; END IF;
 IF p_incident IS NULL OR p_action IS NULL OR p_action NOT IN ('escalate_manual','close_for_recheck')
 OR p_evidence IS NULL OR length(trim(p_evidence)) NOT BETWEEN 2 AND 200
 OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 2 AND 400
 OR p_key IS NULL OR p_key !~ '^[a-zA-Z0-9_-]{16,128}$'
 THEN RAISE EXCEPTION '复核材料缺失' USING ERRCODE='23514'; END IF;
 SELECT * INTO i FROM ms.isolated_campaign_finance_incidents
  WHERE id=p_incident AND organization_id=org FOR UPDATE;
 IF NOT FOUND OR i.reported_by=actor THEN
  RAISE EXCEPTION '禁止自批或跨机构复核' USING ERRCODE='42501'; END IF;
 IF i.status<>'open' THEN
  IF i.reviewed_by=actor AND i.review_key=p_key AND i.review_action=p_action
   AND i.review_evidence_ref=trim(p_evidence) AND i.review_reason=trim(p_reason)
  THEN RETURN jsonb_build_object('incident_id',i.id,'status',i.status,'finance_authorized',false); END IF;
  RAISE EXCEPTION '异常已处理' USING ERRCODE='23505';
 END IF;
 IF EXISTS(SELECT 1 FROM ms.isolated_campaign_finance_incidents t
  WHERE t.reviewed_by=actor AND t.review_key=p_key)
 THEN RAISE EXCEPTION '审批编号已使用' USING ERRCODE='23505'; END IF;
 IF p_action='close_for_recheck' THEN
  IF i.issue_kind<>'supporting_materials_gap'
  THEN RAISE EXCEPTION '快照异常必须人工升级' USING ERRCODE='23514'; END IF;
  SELECT * INTO q FROM ms.isolated_campaign_sales_reviews WHERE id=i.review_id
   AND organization_id=org AND status='sales_approved_pending_finance';
  SELECT * INTO c FROM ms.marketing_campaigns WHERE id=i.campaign_id
   AND organization_id=org FOR SHARE;
  SELECT COALESCE(v.version,1) INTO current_version
   FROM (SELECT 1) d LEFT JOIN ms.isolated_campaign_draft_versions v ON v.campaign_id=i.campaign_id;
  SELECT array_agg(channel_id ORDER BY channel_id) INTO channels
   FROM ms.campaign_channels WHERE campaign_id=i.campaign_id;
  snapshot:=jsonb_build_object('version',current_version,'name',c.name,
   'starts_at',c.starts_at,'ends_at',c.ends_at,'budget_cents',c.budget_cents,
   'owner',c.owner_user_id,'channel_ids',channels,'status',c.status);
  IF q.id IS NULL OR c.id IS NULL OR c.status<>'draft'
    OR q.campaign_snapshot IS DISTINCT FROM snapshot
  THEN RAISE EXCEPTION '快照不一致，不得关闭异常' USING ERRCODE='23514'; END IF;
 END IF;
 after_status:=CASE WHEN p_action='escalate_manual' THEN 'manual_escalated' ELSE 'closed_for_recheck' END;
 UPDATE ms.isolated_campaign_finance_incidents
 SET status=after_status,reviewed_by=actor,review_action=p_action,
  review_evidence_ref=trim(p_evidence),review_reason=trim(p_reason),
  review_key=p_key,reviewed_at=now() WHERE id=i.id;
 INSERT INTO ms.audit_events(organization_id,actor_user_id,target_type,target_id,event_name,
  before_business_json,after_business_json,reason_zh)
 VALUES(org,actor,'marketing_campaign_finance_incident',i.id,
  CASE WHEN p_action='escalate_manual' THEN 'CAMPAIGN_FINANCE_ISSUE_ESCALATED'
   ELSE 'CAMPAIGN_FINANCE_ISSUE_RECHECK_REQUESTED' END,
  jsonb_build_object('status','open','issue_kind',i.issue_kind),
  jsonb_build_object('status',after_status,'finance_authorized',false,'execution_allowed',false),
  '销售侧资料异常分流，不代表财务批准');
 RETURN jsonb_build_object('incident_id',i.id,'status',after_status,
  'finance_authorized',false,'execution_allowed',false);
END $triage$;
REVOKE ALL ON FUNCTION ms.triage_isolated_campaign_finance_incident(uuid,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ms.triage_isolated_campaign_finance_incident(uuid,text,text,text,text)
 TO ms_scoped_lowrisk_writer;
COMMIT;
