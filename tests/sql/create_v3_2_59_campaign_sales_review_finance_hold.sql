\set ON_ERROR_STOP on
-- V3.2-59: CI-only, no real budget approval or spending.
-- Sales review is a distinct step. Finance remains UNAUTHORIZED / NOT IMPLEMENTED.
BEGIN;
CREATE TABLE ms.isolated_campaign_sales_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES ms.organizations(id),
 campaign_id uuid NOT NULL REFERENCES ms.marketing_campaigns(id),
 requested_by uuid NOT NULL REFERENCES ms.staff_users(id),
 campaign_version integer NOT NULL CHECK(campaign_version>0),
 campaign_snapshot jsonb NOT NULL,
 evidence_ref text NOT NULL,
 request_reason text NOT NULL,
 request_key text NOT NULL CHECK(request_key ~ '^[a-zA-Z0-9_-]{16,128}$'),
 request_fingerprint text NOT NULL,
 status text NOT NULL DEFAULT 'pending_sales'
  CHECK(status IN ('pending_sales','sales_rejected','sales_approved_pending_finance')),
 reviewed_by uuid REFERENCES ms.staff_users(id),
 review_decision text CHECK(review_decision IN ('approved','rejected')),
 review_evidence_ref text,
 review_reason text,
 review_key text,
 created_at timestamptz NOT NULL DEFAULT now(),
 reviewed_at timestamptz,
 CHECK (reviewed_by IS NULL OR reviewed_by<>requested_by),
 UNIQUE(requested_by,request_key)
);
CREATE UNIQUE INDEX isolated_campaign_one_active_review ON ms.isolated_campaign_sales_reviews(campaign_id)
 WHERE status IN ('pending_sales','sales_approved_pending_finance');
CREATE UNIQUE INDEX isolated_campaign_review_unique_key ON ms.isolated_campaign_sales_reviews(reviewed_by,review_key)
 WHERE reviewed_by IS NOT NULL AND review_key IS NOT NULL;
REVOKE ALL ON ms.isolated_campaign_sales_reviews FROM PUBLIC;
REVOKE ALL ON ms.isolated_campaign_sales_reviews FROM ms_scoped_lowrisk_writer;

CREATE VIEW ms.scoped_isolated_campaign_sales_reviews WITH (security_barrier=true) AS
SELECT q.id AS review_id,q.campaign_id,q.campaign_version,q.requested_by,q.status,
 q.created_at,q.reviewed_at,q.reviewed_by,
 (q.status='pending_sales' AND q.requested_by<>ms.current_scoped_staff_id() AND EXISTS(
  SELECT 1 FROM ms.user_role_grants g JOIN ms.role_templates r ON r.id=g.role_id
  WHERE g.user_id=ms.current_scoped_staff_id() AND r.organization_id=q.organization_id
   AND r.role_code='sales_manager' AND g.revoked_at IS NULL AND g.valid_from<=now()
 )) AS can_sales_review
FROM ms.isolated_campaign_sales_reviews q
WHERE q.organization_id=ms.current_scoped_organization_id()
 AND ms.current_scoped_staff_id() IS NOT NULL
 AND (q.requested_by=ms.current_scoped_staff_id()
   OR q.reviewed_by=ms.current_scoped_staff_id()
   OR (q.status='pending_sales' AND EXISTS(
    SELECT 1 FROM ms.user_role_grants g JOIN ms.role_templates r ON r.id=g.role_id
    WHERE g.user_id=ms.current_scoped_staff_id() AND r.organization_id=q.organization_id
      AND r.role_code='sales_manager' AND g.revoked_at IS NULL AND g.valid_from<=now()
   ))
 );
REVOKE ALL ON ms.scoped_isolated_campaign_sales_reviews FROM PUBLIC;
GRANT SELECT ON ms.scoped_isolated_campaign_sales_reviews TO ms_student_assignee_reader;

CREATE FUNCTION ms.request_isolated_campaign_sales_review(
 p_campaign uuid,p_version integer,p_evidence text,p_reason text,p_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ms
AS $request$
DECLARE
 actor uuid;org uuid;c ms.marketing_campaigns%ROWTYPE;
 v integer; snapshot jsonb; ch uuid[];
 fingerprint text;prev ms.isolated_campaign_sales_reviews%ROWTYPE;
 new_id uuid;
BEGIN
 SELECT ms.current_scoped_staff_id(),ms.current_scoped_organization_id() INTO actor,org;
 IF actor IS NULL OR org IS NULL OR NOT EXISTS(
  SELECT 1 FROM ms.staff_users s WHERE s.id=actor AND s.organization_id=org AND s.status='active'
 ) THEN RAISE EXCEPTION '未核实活动负责人身份' USING ERRCODE='42501'; END IF;
 IF p_campaign IS NULL OR p_version IS NULL OR p_version<1
 OR p_evidence IS NULL OR length(trim(p_evidence)) NOT BETWEEN 2 AND 200
 OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 2 AND 400
 OR p_key IS NULL OR p_key !~ '^[a-zA-Z0-9_-]{16,128}$' THEN
  RAISE EXCEPTION '活动审核申请缺少字段' USING ERRCODE='23514';
 END IF;
 fingerprint:=encode(sha256(convert_to(jsonb_build_object(
  'campaign',p_campaign,'version',p_version,
  'evidence',trim(p_evidence),'reason',trim(p_reason))::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||':campaign_sales_request:'||p_key,0));
 SELECT * INTO prev FROM ms.isolated_campaign_sales_reviews
  WHERE requested_by=actor AND request_key=p_key;
 IF FOUND THEN
  IF prev.request_fingerprint<>fingerprint THEN
   RAISE EXCEPTION '重复请求编号对应不同业务内容' USING ERRCODE='23505';
  END IF;
  RETURN jsonb_build_object('review_id',prev.id,'status',prev.status,
    'campaign_id',prev.campaign_id,'campaign_version',prev.campaign_version);
 END IF;
 SELECT * INTO c FROM ms.marketing_campaigns WHERE id=p_campaign AND organization_id=org FOR UPDATE;
 IF NOT FOUND OR c.owner_user_id IS DISTINCT FROM actor THEN
  RAISE EXCEPTION '仅当前负责人可以申请本机构草稿审核' USING ERRCODE='42501';
 END IF;
 IF c.status<>'draft' THEN RAISE EXCEPTION '非草稿活动不能申请' USING ERRCODE='23514'; END IF;
 SELECT COALESCE(x.version,1) INTO v
 FROM (SELECT 1) d LEFT JOIN ms.isolated_campaign_draft_versions x ON x.campaign_id=p_campaign;
 IF v<>p_version THEN RAISE EXCEPTION '草稿版本已变化' USING ERRCODE='23505'; END IF;
 IF EXISTS(SELECT 1 FROM ms.isolated_campaign_sales_reviews q
  WHERE q.campaign_id=p_campaign AND q.status IN ('pending_sales','sales_approved_pending_finance'))
 THEN RAISE EXCEPTION '草稿已有待审或财务待确认申请' USING ERRCODE='23505'; END IF;
 SELECT array_agg(channel_id ORDER BY channel_id) INTO ch
 FROM ms.campaign_channels WHERE campaign_id=p_campaign;
 IF ch IS NULL OR cardinality(ch)=0 THEN
  RAISE EXCEPTION '必须保留已核实的渠道关联' USING ERRCODE='23514';
 END IF;
 snapshot:=jsonb_build_object('version',v,'name',c.name,
  'starts_at',c.starts_at,'ends_at',c.ends_at,'budget_cents',c.budget_cents,
  'owner',actor,'channel_ids',ch,'status','draft');
 INSERT INTO ms.isolated_campaign_sales_reviews(organization_id,campaign_id,
  requested_by,campaign_version,campaign_snapshot,evidence_ref,request_reason,request_key,request_fingerprint)
 VALUES(org,p_campaign,actor,v,snapshot,trim(p_evidence),trim(p_reason),p_key,fingerprint)
 RETURNING id INTO new_id;
 INSERT INTO ms.audit_events(organization_id,actor_user_id,target_type,target_id,event_name,
  before_business_json,after_business_json,reason_zh)
 VALUES(org,actor,'marketing_campaign_sales_review',new_id,'CAMPAIGN_SALES_REVIEW_REQUESTED',
  '{}'::jsonb,jsonb_build_object('campaign_id',p_campaign,'version',v,'budget_cents',c.budget_cents),
  '活动草稿提交销售审批；未获财务授权，资金支出为禁止');
 RETURN jsonb_build_object('review_id',new_id,'status','pending_sales',
  'campaign_id',p_campaign,'campaign_version',v);
END $request$;
REVOKE ALL ON FUNCTION ms.request_isolated_campaign_sales_review(uuid,integer,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ms.request_isolated_campaign_sales_review(uuid,integer,text,text,text)
 TO ms_scoped_lowrisk_writer;

CREATE FUNCTION ms.decide_isolated_campaign_sales_review(
 p_review uuid,p_decision text,p_evidence text,p_reason text,p_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ms
AS $decide$
DECLARE
 actor uuid; org uuid; q ms.isolated_campaign_sales_reviews%ROWTYPE;
 c ms.marketing_campaigns%ROWTYPE; v integer; snapshot jsonb; channels uuid[];
 status_after text;
BEGIN
 SELECT ms.current_scoped_staff_id(),ms.current_scoped_organization_id() INTO actor,org;
 IF actor IS NULL OR org IS NULL OR NOT EXISTS(
  SELECT 1 FROM ms.staff_users s WHERE s.id=actor AND s.organization_id=org AND s.status='active'
 ) OR NOT EXISTS(
  SELECT 1 FROM ms.user_role_grants g JOIN ms.role_templates r ON r.id=g.role_id
   WHERE g.user_id=actor AND r.organization_id=org AND r.role_code='sales_manager'
    AND g.revoked_at IS NULL AND g.valid_from<=now()
 ) THEN RAISE EXCEPTION '仅本机构当前有效销售主管可以复核' USING ERRCODE='42501'; END IF;
 IF p_review IS NULL OR p_decision IS NULL OR p_decision NOT IN ('approved','rejected')
  OR p_evidence IS NULL OR length(trim(p_evidence)) NOT BETWEEN 2 AND 200
  OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 2 AND 400
  OR p_key IS NULL OR p_key !~ '^[a-zA-Z0-9_-]{16,128}$' THEN
  RAISE EXCEPTION '独立销售审批字段无效' USING ERRCODE='23514';
 END IF;
 SELECT * INTO q FROM ms.isolated_campaign_sales_reviews
  WHERE id=p_review AND organization_id=org FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '找不到本机构审核请求' USING ERRCODE='42501'; END IF;
 IF q.requested_by=actor THEN
  RAISE EXCEPTION '不能自己审批自己的活动计划' USING ERRCODE='42501';
 END IF;
 IF q.status<>'pending_sales' THEN
  IF q.reviewed_by=actor AND q.review_key=p_key AND q.review_decision=p_decision
   AND q.review_evidence_ref=trim(p_evidence) AND q.review_reason=trim(p_reason)
  THEN
   RETURN jsonb_build_object('review_id',q.id,'status',q.status,
    'campaign_id',q.campaign_id,'campaign_version',q.campaign_version);
  END IF;
  RAISE EXCEPTION '审核请求已处理，不能重复执行' USING ERRCODE='23505';
 END IF;
 IF EXISTS(SELECT 1 FROM ms.isolated_campaign_sales_reviews x
  WHERE x.reviewed_by=actor AND x.review_key=p_key) THEN
  RAISE EXCEPTION '该审批防重复编号已被使用' USING ERRCODE='23505';
 END IF;
 SELECT * INTO c FROM ms.marketing_campaigns
  WHERE id=q.campaign_id AND organization_id=org FOR UPDATE;
 IF NOT FOUND OR c.status<>'draft' THEN
  RAISE EXCEPTION '活动状态改变，不能审批原申请' USING ERRCODE='23514';
 END IF;
 SELECT COALESCE(x.version,1) INTO v FROM (SELECT 1) d
  LEFT JOIN ms.isolated_campaign_draft_versions x ON x.campaign_id=q.campaign_id;
 SELECT array_agg(channel_id ORDER BY channel_id) INTO channels
 FROM ms.campaign_channels WHERE campaign_id=q.campaign_id;
 snapshot:=jsonb_build_object('version',v,'name',c.name,
  'starts_at',c.starts_at,'ends_at',c.ends_at,'budget_cents',c.budget_cents,
  'owner',c.owner_user_id,'channel_ids',channels,'status',c.status);
 IF snapshot IS DISTINCT FROM q.campaign_snapshot OR v<>q.campaign_version THEN
  RAISE EXCEPTION '活动计划已改变，必须重新申请审批' USING ERRCODE='23505';
 END IF;
 status_after:=CASE WHEN p_decision='approved'
  THEN 'sales_approved_pending_finance' ELSE 'sales_rejected' END;
 UPDATE ms.isolated_campaign_sales_reviews
  SET status=status_after,reviewed_by=actor,review_decision=p_decision,
   review_evidence_ref=trim(p_evidence),review_reason=trim(p_reason),
   review_key=p_key,reviewed_at=now() WHERE id=q.id;
 INSERT INTO ms.audit_events(organization_id,actor_user_id,target_type,target_id,event_name,
  before_business_json,after_business_json,reason_zh)
 VALUES(org,actor,'marketing_campaign_sales_review',q.id,
  CASE WHEN p_decision='approved' THEN 'CAMPAIGN_SALES_APPROVED_FINANCE_HOLD'
   ELSE 'CAMPAIGN_SALES_REJECTED' END,
  jsonb_build_object('status',q.status,'campaign_version',v),
  jsonb_build_object('status',status_after,'budget_cents',c.budget_cents,
   'finance_authorized',false,'campaign_status',c.status),
  '仅销售独立审核；财务未授权，严禁发布活动或实际支出');
 RETURN jsonb_build_object('review_id',q.id,'status',status_after,
  'campaign_id',q.campaign_id,'campaign_version',v,'finance_authorized',false);
END $decide$;
REVOKE ALL ON FUNCTION ms.decide_isolated_campaign_sales_review(uuid,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ms.decide_isolated_campaign_sales_review(uuid,text,text,text,text)
 TO ms_scoped_lowrisk_writer;

DO $guards$
DECLARE n text;
BEGIN
 FOREACH n IN ARRAY ARRAY['ms_write_a','ms_write_b','ms_write_manager','ms_write_manager_2'] LOOP
  IF has_table_privilege(n,'ms.isolated_campaign_sales_reviews','SELECT')
   OR has_table_privilege(n,'ms.isolated_campaign_sales_reviews','UPDATE')
   OR has_table_privilege(n,'ms.marketing_campaigns','UPDATE')
   OR has_table_privilege(n,'ms.marketing_costs','INSERT')
   OR has_table_privilege(n,'ms.cost_allocations','INSERT')
   OR NOT has_function_privilege(n,
    'ms.request_isolated_campaign_sales_review(uuid,integer,text,text,text)','EXECUTE')
   OR NOT has_function_privilege(n,
    'ms.decide_isolated_campaign_sales_review(uuid,text,text,text,text)','EXECUTE')
  THEN RAISE EXCEPTION 'Sales review role unexpectedly acquired base-table privileges: %',n;
  END IF;
 END LOOP;
 FOREACH n IN ARRAY ARRAY['ms_assignee_reader_a','ms_assignee_reader_b',
  'ms_assignee_reader_manager','ms_assignee_reader_manager_2'] LOOP
  IF NOT has_table_privilege(n,'ms.scoped_isolated_campaign_sales_reviews','SELECT')
   OR has_table_privilege(n,'ms.isolated_campaign_sales_reviews','SELECT')
   OR has_table_privilege(n,'ms.marketing_costs','SELECT')
   OR has_table_privilege(n,'ms.cost_allocations','SELECT')
  THEN RAISE EXCEPTION 'Sales review read role unexpectedly acquired raw-table privileges: %',n;
  END IF;
 END LOOP;
END $guards$;
COMMIT;