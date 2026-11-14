\set ON_ERROR_STOP on
-- V3.2-57 disposable CI ONLY. Campaigns remain DRAFT and spend is prohibited.
-- This file is NOT numbered migration 039 and must not be used in production.
BEGIN;
CREATE TABLE ms.isolated_campaign_draft_idempotency (
 organization_id uuid NOT NULL REFERENCES ms.organizations(id),
 requested_by uuid NOT NULL REFERENCES ms.staff_users(id),
 request_key text NOT NULL CHECK(request_key ~ '^[a-zA-Z0-9_-]{16,128}$'),
 fingerprint text NOT NULL,
 campaign_id uuid NOT NULL REFERENCES ms.marketing_campaigns(id),
 PRIMARY KEY(requested_by,request_key)
);
REVOKE ALL ON ms.isolated_campaign_draft_idempotency FROM PUBLIC;
REVOKE ALL ON ms.isolated_campaign_draft_idempotency FROM ms_scoped_lowrisk_writer;
CREATE VIEW ms.scoped_isolated_campaign_drafts WITH (security_barrier=true) AS
SELECT c.id AS campaign_id,c.name,c.starts_at,c.ends_at,
 c.owner_user_id,c.budget_cents,c.status,
 ARRAY(SELECT cc.channel_id FROM ms.campaign_channels cc
  WHERE cc.campaign_id=c.id ORDER BY cc.channel_id) AS channel_ids
FROM ms.marketing_campaigns c
WHERE c.organization_id=ms.current_scoped_organization_id()
  AND ms.current_scoped_staff_id() IS NOT NULL
  AND c.status='draft'
  AND (c.owner_user_id=ms.current_scoped_staff_id() OR EXISTS(
   SELECT 1 FROM ms.user_role_grants g JOIN ms.role_templates r ON r.id=g.role_id
   WHERE g.user_id=ms.current_scoped_staff_id()
     AND r.organization_id=c.organization_id
     AND r.role_code='sales_manager'
     AND g.revoked_at IS NULL AND g.valid_from<=now()));
REVOKE ALL ON ms.scoped_isolated_campaign_drafts FROM PUBLIC;
GRANT SELECT ON ms.scoped_isolated_campaign_drafts TO ms_student_assignee_reader;

CREATE FUNCTION ms.create_isolated_campaign_draft(
 p_name text,p_starts timestamptz,p_ends timestamptz,
 p_budget bigint,p_channels uuid[],p_key text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ms
AS $create$
DECLARE
 actor uuid; org uuid; n integer; ch uuid; row_id uuid;
 fingerprint text; previous ms.isolated_campaign_draft_idempotency%ROWTYPE;
 ancestor_status text; depth integer; parent uuid;
BEGIN
 SELECT ms.current_scoped_staff_id(),ms.current_scoped_organization_id()
 INTO actor,org;
 IF actor IS NULL OR org IS NULL THEN
   RAISE EXCEPTION '员工与机构身份未核实' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM ms.staff_users s
  WHERE s.id=actor AND s.organization_id=org AND s.status='active') THEN
   RAISE EXCEPTION '员工账号已停用或跨机构' USING ERRCODE='42501';
 END IF;
 IF p_name IS NULL OR length(trim(p_name)) NOT BETWEEN 2 AND 100
    OR p_name ~ '[[:cntrl:]]'
    OR p_budget IS NULL OR p_budget<0 OR p_budget>100000000000
    OR p_key IS NULL OR p_key !~ '^[a-zA-Z0-9_-]{16,128}$'
    OR (p_starts IS NOT NULL AND p_ends IS NOT NULL AND p_ends<p_starts)
    OR p_channels IS NULL
    OR array_ndims(p_channels) IS DISTINCT FROM 1 THEN
   RAISE EXCEPTION '活动草稿字段或计划预算无效' USING ERRCODE='23514';
 END IF;
 n:=cardinality(p_channels);
 IF n NOT BETWEEN 1 AND 20 OR EXISTS(
   SELECT 1 FROM unnest(p_channels) x WHERE x IS NULL
 ) OR (SELECT count(DISTINCT x) FROM unnest(p_channels) x)<>n THEN
   RAISE EXCEPTION '活动渠道数量必须为1到20且不重复' USING ERRCODE='23514';
 END IF;
 fingerprint:=encode(sha256(convert_to(jsonb_build_object(
  'name',trim(p_name),'start',p_starts,'end',p_ends,'budget',p_budget,
  'channels',(SELECT jsonb_agg(x ORDER BY x) FROM unnest(p_channels) x))::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||':campaign:'||p_key,0));
 SELECT * INTO previous FROM ms.isolated_campaign_draft_idempotency
 WHERE requested_by=actor AND request_key=p_key;
 IF FOUND THEN
  IF previous.fingerprint<>fingerprint THEN
   RAISE EXCEPTION '重复请求编号对应不同活动草稿' USING ERRCODE='23505';
  END IF;
  RETURN jsonb_build_object('campaign_id',previous.campaign_id,
   'status','draft','already_exists',true);
 END IF;
 -- Serialize against CI channel deactivate/rename reviews on the same institution.
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':channel_catalog',0));
 FOREACH ch IN ARRAY p_channels LOOP
  SELECT parent_id,status INTO parent,ancestor_status FROM ms.marketing_channels
  WHERE id=ch AND organization_id=org FOR SHARE;
  IF NOT FOUND OR ancestor_status<>'active' THEN
   RAISE EXCEPTION '渠道不存在、跨机构或已停用' USING ERRCODE='23514';
  END IF;
  depth:=0;
  WHILE parent IS NOT NULL LOOP
   depth:=depth+1;
   IF depth>16 OR parent=ch THEN
    RAISE EXCEPTION '渠道祖先关系循环或超过16层' USING ERRCODE='23514';
   END IF;
   SELECT c.parent_id,c.status INTO parent,ancestor_status
   FROM ms.marketing_channels c WHERE c.id=parent AND c.organization_id=org FOR SHARE;
   IF NOT FOUND OR ancestor_status<>'active' THEN
    RAISE EXCEPTION '活动不能关联跨机构或继承停用的渠道' USING ERRCODE='23514';
   END IF;
  END LOOP;
 END LOOP;
 INSERT INTO ms.marketing_campaigns(organization_id,name,starts_at,ends_at,
  owner_user_id,budget_cents,status)
 VALUES(org,trim(p_name),p_starts,p_ends,actor,p_budget,'draft')
 RETURNING id INTO row_id;
 INSERT INTO ms.campaign_channels(campaign_id,channel_id)
 SELECT row_id,x FROM unnest(p_channels) x;
 INSERT INTO ms.isolated_campaign_draft_idempotency(
  organization_id,requested_by,request_key,fingerprint,campaign_id)
 VALUES(org,actor,p_key,fingerprint,row_id);
 INSERT INTO ms.audit_events(organization_id,actor_user_id,target_type,
  target_id,event_name,before_business_json,after_business_json,reason_zh)
 VALUES(org,actor,'marketing_campaign',row_id,'CAMPAIGN_DRAFT_CREATED','{}'::jsonb,
  jsonb_build_object('status','draft','owner_user_id',actor,
   'budget_cents',p_budget,'channel_count',n),
  '仅建立本机构虚构市场活动草稿；预算未审批，禁止支出及归因');
 RETURN jsonb_build_object('campaign_id',row_id,'status','draft',
  'owner_user_id',actor,'already_exists',false);
END $create$;
REVOKE ALL ON FUNCTION ms.create_isolated_campaign_draft(
 text,timestamptz,timestamptz,bigint,uuid[],text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ms.create_isolated_campaign_draft(
 text,timestamptz,timestamptz,bigint,uuid[],text) TO ms_scoped_lowrisk_writer;
DO $deny$
DECLARE n text;
BEGIN
 FOREACH n IN ARRAY ARRAY[
 'ms_write_a','ms_write_b','ms_write_manager','ms_write_manager_2'
 ] LOOP
  IF has_table_privilege(n,'ms.marketing_campaigns','SELECT')
   OR has_table_privilege(n,'ms.marketing_campaigns','INSERT')
   OR has_table_privilege(n,'ms.campaign_channels','INSERT')
   OR has_table_privilege(n,'ms.marketing_costs','INSERT')
   OR has_table_privilege(n,'ms.cost_allocations','INSERT')
   OR has_table_privilege(n,'ms.isolated_campaign_draft_idempotency','SELECT')
   OR NOT has_function_privilege(n,
    'ms.create_isolated_campaign_draft(text,timestamptz,timestamptz,bigint,uuid[],text)','EXECUTE')
   THEN RAISE EXCEPTION 'Campaign creator privilege escalation: %',n;
  END IF;
 END LOOP;
 FOREACH n IN ARRAY ARRAY[
 'ms_assignee_reader_a','ms_assignee_reader_b',
 'ms_assignee_reader_manager','ms_assignee_reader_manager_2'
 ] LOOP
  IF NOT has_table_privilege(n,'ms.scoped_isolated_campaign_drafts','SELECT')
   OR has_table_privilege(n,'ms.marketing_campaigns','SELECT')
   OR has_table_privilege(n,'ms.campaign_channels','SELECT')
   OR has_table_privilege(n,'ms.marketing_costs','SELECT')
   OR has_table_privilege(n,'ms.cost_allocations','SELECT')
   THEN RAISE EXCEPTION 'Campaign reader base-table privilege escalation: %',n;
  END IF;
 END LOOP;
END $deny$;
COMMIT;
