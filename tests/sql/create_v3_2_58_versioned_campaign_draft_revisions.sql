\set ON_ERROR_STOP on
-- V3.2-58 disposable CI ONLY: own-draft revisions, optimistic version check.
-- No campaign activation, approved spending, attribution, or production migration.
BEGIN;
CREATE TABLE ms.isolated_campaign_draft_versions (
 campaign_id uuid PRIMARY KEY REFERENCES ms.marketing_campaigns(id),
 version integer NOT NULL DEFAULT 1 CHECK (version BETWEEN 1 AND 2147483646),
 revised_at timestamptz,
 revised_by uuid REFERENCES ms.staff_users(id)
);
CREATE TABLE ms.isolated_campaign_draft_revision_receipts (
 requested_by uuid NOT NULL REFERENCES ms.staff_users(id),
 request_key text NOT NULL CHECK(request_key ~ '^[a-zA-Z0-9_-]{16,128}$'),
 fingerprint text NOT NULL,
 campaign_id uuid NOT NULL REFERENCES ms.marketing_campaigns(id),
 resulting_version integer NOT NULL CHECK(resulting_version>=2),
 PRIMARY KEY(requested_by,request_key)
);
REVOKE ALL ON ms.isolated_campaign_draft_versions FROM PUBLIC;
REVOKE ALL ON ms.isolated_campaign_draft_versions FROM ms_scoped_lowrisk_writer;
REVOKE ALL ON ms.isolated_campaign_draft_revision_receipts FROM PUBLIC;
REVOKE ALL ON ms.isolated_campaign_draft_revision_receipts FROM ms_scoped_lowrisk_writer;
CREATE OR REPLACE VIEW ms.scoped_isolated_campaign_drafts WITH (security_barrier=true) AS
SELECT c.id AS campaign_id,c.name,c.starts_at,c.ends_at,
 c.owner_user_id,c.budget_cents,c.status,
 ARRAY(SELECT cc.channel_id FROM ms.campaign_channels cc
  WHERE cc.campaign_id=c.id ORDER BY cc.channel_id) AS channel_ids,
 COALESCE(v.version,1) AS version
FROM ms.marketing_campaigns c
LEFT JOIN ms.isolated_campaign_draft_versions v ON v.campaign_id=c.id
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

CREATE FUNCTION ms.revise_isolated_campaign_draft(
 p_campaign uuid,p_expected integer,p_name text,
 p_starts timestamptz,p_ends timestamptz,
 p_budget bigint,p_channels uuid[],p_key text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ms
AS $revise$
DECLARE
 actor uuid;org uuid;campaign ms.marketing_campaigns%ROWTYPE;
 current_version integer; next_version integer; previous ms.isolated_campaign_draft_revision_receipts%ROWTYPE;
 fingerprint text; old_channels uuid[]; ch uuid; parent uuid;
 ancestor_status text; depth integer; n integer;
BEGIN
 SELECT ms.current_scoped_staff_id(),ms.current_scoped_organization_id() INTO actor,org;
 IF actor IS NULL OR org IS NULL OR NOT EXISTS(
  SELECT 1 FROM ms.staff_users s
   WHERE s.id=actor AND s.organization_id=org AND s.status='active'
 ) THEN RAISE EXCEPTION '当前员工身份不允许修改活动' USING ERRCODE='42501'; END IF;
 IF p_campaign IS NULL OR p_expected IS NULL OR p_expected NOT BETWEEN 1 AND 2147483645
    OR p_name IS NULL OR length(trim(p_name)) NOT BETWEEN 2 AND 100
    OR p_name ~ '[[:cntrl:]]'
    OR p_budget IS NULL OR p_budget<0 OR p_budget>100000000000
    OR p_key IS NULL OR p_key !~ '^[a-zA-Z0-9_-]{16,128}$'
    OR (p_starts IS NOT NULL AND p_ends IS NOT NULL AND p_ends<p_starts)
    OR p_channels IS NULL OR array_ndims(p_channels) IS DISTINCT FROM 1 THEN
   RAISE EXCEPTION '活动草稿修改字段无效' USING ERRCODE='23514';
 END IF;
 n:=cardinality(p_channels);
 IF n NOT BETWEEN 1 AND 20 OR EXISTS(
  SELECT 1 FROM unnest(p_channels) x WHERE x IS NULL
 ) OR (SELECT count(DISTINCT x) FROM unnest(p_channels) x)<>n THEN
  RAISE EXCEPTION '草稿渠道数量和唯一性无效' USING ERRCODE='23514';
 END IF;
 fingerprint:=encode(sha256(convert_to(jsonb_build_object(
  'campaign',p_campaign,'expected',p_expected,'name',trim(p_name),
  'start',p_starts,'end',p_ends,'budget',p_budget,
  'channels',(SELECT jsonb_agg(x ORDER BY x) FROM unnest(p_channels) x))::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||':campaign_revision:'||p_key,0));
 SELECT * INTO previous FROM ms.isolated_campaign_draft_revision_receipts
  WHERE requested_by=actor AND request_key=p_key;
 IF FOUND THEN
  IF previous.fingerprint<>fingerprint THEN
   RAISE EXCEPTION '重复编号对应不同修改' USING ERRCODE='23505';
  END IF;
  RETURN jsonb_build_object('campaign_id',previous.campaign_id,'version',
   previous.resulting_version,'status','draft','already_exists',true);
 END IF;
 -- The same row lock serializes simultaneous edits for this exact campaign.
 SELECT * INTO campaign FROM ms.marketing_campaigns
  WHERE id=p_campaign AND organization_id=org FOR UPDATE;
 IF NOT FOUND OR campaign.owner_user_id IS DISTINCT FROM actor THEN
  RAISE EXCEPTION '只有原负责人可修改本机构草稿' USING ERRCODE='42501';
 END IF;
 IF campaign.status<>'draft' THEN
  RAISE EXCEPTION '非草稿活动不能修改' USING ERRCODE='23514';
 END IF;
 SELECT COALESCE(v.version,1) INTO current_version FROM
  (SELECT 1 AS version) d LEFT JOIN ms.isolated_campaign_draft_versions v
   ON v.campaign_id=p_campaign;
 IF current_version<>p_expected THEN
  RAISE EXCEPTION '草稿版本已变化，请刷新后再修改' USING ERRCODE='23505';
 END IF;
 next_version:=current_version+1;
 -- Lock active channel ancestors against concurrent SQL status edits.
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':channel_catalog',0));
 FOREACH ch IN ARRAY p_channels LOOP
  SELECT c.parent_id,c.status INTO parent,ancestor_status
    FROM ms.marketing_channels c
   WHERE c.id=ch AND c.organization_id=org FOR SHARE;
  IF NOT FOUND OR ancestor_status<>'active' THEN
   RAISE EXCEPTION '不能关联跨机构或停用渠道' USING ERRCODE='23514';
  END IF;
  depth:=0;
  WHILE parent IS NOT NULL LOOP
   depth:=depth+1;
   IF depth>16 OR parent=ch THEN
    RAISE EXCEPTION '渠道层级循环或超过16层' USING ERRCODE='23514';
   END IF;
   SELECT c.parent_id,c.status INTO parent,ancestor_status FROM ms.marketing_channels c
    WHERE c.id=parent AND c.organization_id=org FOR SHARE;
   IF NOT FOUND OR ancestor_status<>'active' THEN
    RAISE EXCEPTION '不能关联跨机构或继承停用的渠道' USING ERRCODE='23514';
   END IF;
  END LOOP;
 END LOOP;
 SELECT ARRAY(SELECT cc.channel_id FROM ms.campaign_channels cc
  WHERE cc.campaign_id=p_campaign ORDER BY cc.channel_id) INTO old_channels;
 UPDATE ms.marketing_campaigns
  SET name=trim(p_name),starts_at=p_starts,ends_at=p_ends,budget_cents=p_budget
  WHERE id=p_campaign AND organization_id=org AND owner_user_id=actor AND status='draft';
 DELETE FROM ms.campaign_channels WHERE campaign_id=p_campaign;
 INSERT INTO ms.campaign_channels(campaign_id,channel_id)
  SELECT p_campaign,x FROM unnest(p_channels) x;
 INSERT INTO ms.isolated_campaign_draft_versions(campaign_id,version,revised_at,revised_by)
 VALUES(p_campaign,next_version,now(),actor)
 ON CONFLICT(campaign_id) DO UPDATE
  SET version=EXCLUDED.version,revised_at=EXCLUDED.revised_at,revised_by=EXCLUDED.revised_by;
 INSERT INTO ms.isolated_campaign_draft_revision_receipts(
  requested_by,request_key,fingerprint,campaign_id,resulting_version)
 VALUES(actor,p_key,fingerprint,p_campaign,next_version);
 INSERT INTO ms.audit_events(organization_id,actor_user_id,target_type,target_id,
  event_name,before_business_json,after_business_json,reason_zh)
 VALUES(org,actor,'marketing_campaign',p_campaign,'CAMPAIGN_DRAFT_REVISED',
  jsonb_build_object('version',current_version,'name',campaign.name,
    'starts_at',campaign.starts_at,'ends_at',campaign.ends_at,
    'budget_cents',campaign.budget_cents,'channel_ids',old_channels),
  jsonb_build_object('version',next_version,'name',trim(p_name),
    'starts_at',p_starts,'ends_at',p_ends,'budget_cents',p_budget,
    'channel_ids',(SELECT jsonb_agg(x ORDER BY x) FROM unnest(p_channels) x)),
  '仅修改本人虚构市场活动草稿，不代表预算获批、已投放或可费用核销');
 RETURN jsonb_build_object('campaign_id',p_campaign,'version',next_version,
  'status','draft','already_exists',false);
END $revise$;
REVOKE ALL ON FUNCTION ms.revise_isolated_campaign_draft(
 uuid,integer,text,timestamptz,timestamptz,bigint,uuid[],text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ms.revise_isolated_campaign_draft(
 uuid,integer,text,timestamptz,timestamptz,bigint,uuid[],text) TO ms_scoped_lowrisk_writer;
DO $guard$
DECLARE n text;
BEGIN
 FOREACH n IN ARRAY ARRAY['ms_write_a','ms_write_b','ms_write_manager','ms_write_manager_2'] LOOP
  IF has_table_privilege(n,'ms.marketing_campaigns','UPDATE')
   OR has_table_privilege(n,'ms.campaign_channels','DELETE')
   OR has_table_privilege(n,'ms.marketing_costs','INSERT')
   OR has_table_privilege(n,'ms.isolated_campaign_draft_versions','UPDATE')
   OR has_table_privilege(n,'ms.isolated_campaign_draft_revision_receipts','SELECT')
   OR NOT has_function_privilege(n,
    'ms.revise_isolated_campaign_draft(uuid,integer,text,timestamptz,timestamptz,bigint,uuid[],text)','EXECUTE')
   THEN RAISE EXCEPTION 'Campaign revision direct-table privilege leak: %',n;
  END IF;
 END LOOP;
 FOREACH n IN ARRAY ARRAY[
  'ms_assignee_reader_a','ms_assignee_reader_b',
  'ms_assignee_reader_manager','ms_assignee_reader_manager_2'
 ] LOOP
  IF has_table_privilege(n,'ms.isolated_campaign_draft_versions','SELECT')
   OR has_table_privilege(n,'ms.isolated_campaign_draft_revision_receipts','SELECT')
   OR has_table_privilege(n,'ms.marketing_campaigns','UPDATE')
   OR NOT has_table_privilege(n,'ms.scoped_isolated_campaign_drafts','SELECT')
   THEN RAISE EXCEPTION 'Campaign revision read projection permission leak: %',n;
  END IF;
 END LOOP;
END $guard$;
COMMIT;
