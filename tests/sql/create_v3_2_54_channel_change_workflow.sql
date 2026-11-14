\set ON_ERROR_STOP on
-- V3.2-54: isolated CI ONLY channel maintenance, not a production migration.
-- All data is fictional. No general SELECT/INSERT/UPDATE on base tables to staff.
BEGIN;

CREATE TABLE ms.isolated_channel_change_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES ms.organizations(id),
 requested_by uuid NOT NULL REFERENCES ms.staff_users(id),
 action text NOT NULL CHECK(action IN ('create','edit','deactivate')),
 channel_id uuid REFERENCES ms.marketing_channels(id),
 proposed_name text,
 proposed_parent_id uuid,
 proposed_type text,
 old_snapshot jsonb,
 evidence_ref text NOT NULL,
 request_reason text NOT NULL,
 request_key text NOT NULL CHECK(request_key ~ '^[a-zA-Z0-9_-]{16,128}$'),
 request_fingerprint text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','applied','rejected')),
 reviewed_by uuid REFERENCES ms.staff_users(id),
 review_key text,
 review_decision text CHECK(review_decision IN ('approved','rejected')),
 review_evidence_ref text,
 review_reason text,
 result_channel_id uuid REFERENCES ms.marketing_channels(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 reviewed_at timestamptz,
 UNIQUE(requested_by,request_key)
);
CREATE UNIQUE INDEX isolated_channel_review_once
 ON ms.isolated_channel_change_requests(reviewed_by,review_key)
 WHERE reviewed_by IS NOT NULL AND review_key IS NOT NULL;
REVOKE ALL ON ms.isolated_channel_change_requests FROM PUBLIC;
REVOKE ALL ON ms.isolated_channel_change_requests FROM ms_scoped_lowrisk_writer;
REVOKE ALL ON ms.isolated_channel_change_requests FROM ms_lowrisk_runtime;

-- The function checks channel ancestry and the actual PostgreSQL-bound org.
CREATE FUNCTION ms.assert_isolated_channel_parent(
 p_org uuid,p_target uuid,p_parent uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ms
AS $check_parent$
DECLARE v_state text; v_loop boolean; v_foreign boolean; v_depth integer;
BEGIN
 IF p_parent IS NULL THEN RETURN; END IF;
 IF p_parent=p_target THEN
  RAISE EXCEPTION '不能设置自身为父渠道' USING ERRCODE='23514';
 END IF;
 SELECT status INTO v_state FROM ms.marketing_channels
 WHERE id=p_parent AND organization_id=p_org;
 IF v_state IS DISTINCT FROM 'active' THEN
  RAISE EXCEPTION '父渠道必须属于本机构且正常使用' USING ERRCODE='23514';
 END IF;
 WITH RECURSIVE ancestors(id,parent_id,organization_id,depth) AS (
  SELECT id,parent_id,organization_id,1 FROM ms.marketing_channels WHERE id=p_parent
  UNION ALL
  SELECT c.id,c.parent_id,c.organization_id,a.depth+1
  FROM ancestors a JOIN ms.marketing_channels c ON c.id=a.parent_id
  WHERE a.depth<17
 ) SELECT coalesce(bool_or(id=p_target),false),coalesce(max(depth),0),
   coalesce(bool_or(organization_id IS DISTINCT FROM p_org),false)
 INTO v_loop,v_depth,v_foreign FROM ancestors;
 IF v_loop OR v_foreign OR v_depth>16 THEN
  RAISE EXCEPTION '渠道层级循环或过深' USING ERRCODE='23514';
 END IF;
END $check_parent$;
REVOKE ALL ON FUNCTION ms.assert_isolated_channel_parent(uuid,uuid,uuid) FROM PUBLIC;

CREATE FUNCTION ms.request_isolated_channel_change(
 p_action text,p_channel uuid,p_name text,p_parent uuid,p_type text,
 p_evidence text,p_reason text,p_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ms
AS $request$
DECLARE
 actor uuid; org uuid; old ms.marketing_channels%ROWTYPE;
 old_json jsonb; fingerprint text; existing ms.isolated_channel_change_requests%ROWTYPE;
 new_id uuid;
BEGIN
 SELECT ms.current_scoped_staff_id(),ms.current_scoped_organization_id()
 INTO actor,org;
 IF actor IS NULL OR org IS NULL THEN
  RAISE EXCEPTION '无有效员工账号' USING ERRCODE='42501';
 END IF;
 IF p_action IS NULL OR p_action NOT IN ('create','edit','deactivate')
 OR p_key IS NULL OR p_key !~ '^[a-zA-Z0-9_-]{16,128}$'
 OR p_evidence IS NULL OR length(trim(p_evidence)) NOT BETWEEN 2 AND 200
 OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 2 AND 400 THEN
  RAISE EXCEPTION '渠道维护申请参数不正确' USING ERRCODE='23514';
 END IF;
 IF (p_action='create' AND p_channel IS NOT NULL)
 OR (p_action<>'create' AND p_channel IS NULL)
 OR (p_action='deactivate' AND
   (p_name IS NOT NULL OR p_parent IS NOT NULL OR p_type IS NOT NULL))
 OR (p_action IN ('create','edit') AND
   (p_name IS NULL OR length(trim(p_name)) NOT BETWEEN 1 AND 100
    OR p_type IS NULL OR length(trim(p_type)) NOT BETWEEN 1 AND 60)) THEN
  RAISE EXCEPTION '渠道名称、类型或目标无效' USING ERRCODE='23514';
 END IF;
 fingerprint:=encode(sha256(convert_to(
  jsonb_build_object('action',p_action,'channel_id',p_channel,
   'name',p_name,'parent_id',p_parent,'type',p_type,
   'evidence',p_evidence,'reason',p_reason)::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_key,0));
 SELECT * INTO existing FROM ms.isolated_channel_change_requests
 WHERE requested_by=actor AND request_key=p_key;
 IF FOUND THEN
  IF existing.request_fingerprint<>fingerprint THEN
   RAISE EXCEPTION '防重复编号对应不同业务内容' USING ERRCODE='23505';
  END IF;
  RETURN jsonb_build_object('request_id',existing.id,'status',existing.status,
    'action',existing.action,'channel_id',existing.result_channel_id);
 END IF;

 -- Record a snapshot at submission. The independent reviewer rejects stale edits.
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':channel_catalog',0));
 IF p_action<>'create' THEN
  SELECT * INTO old FROM ms.marketing_channels
  WHERE id=p_channel AND organization_id=org FOR UPDATE;
  IF NOT FOUND OR old.status<>'active' THEN
   RAISE EXCEPTION '只能申请维护当前机构的有效渠道' USING ERRCODE='23514';
  END IF;
  old_json:=jsonb_build_object('name',old.name,'parent',old.parent_id,
    'type',old.channel_type,'status',old.status);
 ELSE
  old_json:=NULL;
 END IF;
 IF p_action IN ('create','edit') THEN
  PERFORM ms.assert_isolated_channel_parent(org,p_channel,p_parent);
  IF EXISTS(SELECT 1 FROM ms.marketing_channels c WHERE c.organization_id=org
   AND lower(trim(c.name))=lower(trim(p_name))
   AND (p_channel IS NULL OR c.id<>p_channel)) THEN
   RAISE EXCEPTION '当前机构已有同名渠道' USING ERRCODE='23514';
  END IF;
 END IF;
 INSERT INTO ms.isolated_channel_change_requests(
  organization_id,requested_by,action,channel_id,proposed_name,proposed_parent_id,
  proposed_type,old_snapshot,evidence_ref,request_reason,request_key,request_fingerprint)
 VALUES(org,actor,p_action,p_channel,
  CASE WHEN p_name IS NULL THEN NULL ELSE trim(p_name) END,p_parent,
  CASE WHEN p_type IS NULL THEN NULL ELSE trim(p_type) END,
  old_json,trim(p_evidence),trim(p_reason),p_key,fingerprint)
 RETURNING id INTO new_id;
 INSERT INTO ms.audit_events(organization_id,actor_user_id,target_type,target_id,
  event_name,before_business_json,after_business_json,reason_zh)
 VALUES(org,actor,'marketing_channel_request',new_id,
  'CHANNEL_CHANGE_REQUESTED',coalesce(old_json,'{}'::jsonb),
  jsonb_build_object('action',p_action,'target',p_channel,'name',p_name,
   'parent',p_parent,'type',p_type,'status','pending'),
  '渠道维护待独立审批：'||trim(p_reason));
 RETURN jsonb_build_object('request_id',new_id,'status','pending',
  'action',p_action,'channel_id',p_channel);
END $request$;
REVOKE ALL ON FUNCTION ms.request_isolated_channel_change(
 text,uuid,text,uuid,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ms.request_isolated_channel_change(
 text,uuid,text,uuid,text,text,text,text) TO ms_scoped_lowrisk_writer;

CREATE FUNCTION ms.review_isolated_channel_change(
 p_request uuid,p_decision text,p_evidence text,p_reason text,p_key text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ms
AS $review$
DECLARE
 actor uuid; org uuid;
 job ms.isolated_channel_change_requests%ROWTYPE;
 old ms.marketing_channels%ROWTYPE;
 current_snapshot jsonb;
 new_id uuid;
BEGIN
 SELECT ms.current_scoped_staff_id(),ms.current_scoped_organization_id()
 INTO actor,org;
 IF actor IS NULL OR org IS NULL THEN
  RAISE EXCEPTION '无有效员工账号' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(
  SELECT 1 FROM ms.user_role_grants g
  JOIN ms.role_templates r ON r.id=g.role_id
  WHERE g.user_id=actor AND r.organization_id=org AND r.role_code='sales_manager'
   AND g.revoked_at IS NULL AND g.valid_from<=now()) THEN
  RAISE EXCEPTION '仅本机构当前销售主管可复核渠道维护' USING ERRCODE='42501';
 END IF;
 IF p_decision IS NULL OR p_decision NOT IN ('approved','rejected')
 OR p_key IS NULL OR p_key !~ '^[a-zA-Z0-9_-]{16,128}$'
 OR p_evidence IS NULL OR length(trim(p_evidence)) NOT BETWEEN 2 AND 200
 OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 2 AND 400 THEN
  RAISE EXCEPTION '渠道审批字段不符合要求' USING ERRCODE='23514';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':channel_catalog',0));
 SELECT * INTO job FROM ms.isolated_channel_change_requests
 WHERE id=p_request AND organization_id=org FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '无法访问该渠道维护申请' USING ERRCODE='42501'; END IF;
 IF job.requested_by=actor THEN
  RAISE EXCEPTION '申请人不能自行审批渠道变更' USING ERRCODE='42501';
 END IF;
 IF job.status<>'pending' THEN
  IF job.reviewed_by=actor AND job.review_key=p_key
    AND job.review_decision=p_decision
    AND job.review_evidence_ref=trim(p_evidence)
    AND job.review_reason=trim(p_reason) THEN
   RETURN jsonb_build_object('request_id',job.id,'status',job.status,
    'channel_id',job.result_channel_id,'action',job.action);
  END IF;
  RAISE EXCEPTION '渠道维护请求已复核，不可重复执行' USING ERRCODE='23505';
 END IF;
 IF EXISTS (SELECT 1 FROM ms.isolated_channel_change_requests q
    WHERE q.reviewed_by=actor AND q.review_key=p_key) THEN
  RAISE EXCEPTION '审批防重复编号已经使用' USING ERRCODE='23505';
 END IF;
 new_id:=job.channel_id;
 IF p_decision='approved' THEN
  IF job.action IN ('edit','deactivate') THEN
   SELECT * INTO old FROM ms.marketing_channels
    WHERE id=job.channel_id AND organization_id=org FOR UPDATE;
   IF NOT FOUND OR old.status<>'active' THEN
    RAISE EXCEPTION '被申请渠道已不存在或已停用' USING ERRCODE='23514';
   END IF;
   current_snapshot:=jsonb_build_object('name',old.name,'parent',old.parent_id,
    'type',old.channel_type,'status',old.status);
   IF current_snapshot IS DISTINCT FROM job.old_snapshot THEN
    RAISE EXCEPTION '渠道已被其他变更更新，旧申请必须重审' USING ERRCODE='23514';
   END IF;
  END IF;
  IF job.action IN ('create','edit') THEN
   PERFORM ms.assert_isolated_channel_parent(org,job.channel_id,job.proposed_parent_id);
   IF EXISTS(SELECT 1 FROM ms.marketing_channels c WHERE c.organization_id=org
    AND lower(trim(c.name))=lower(trim(job.proposed_name))
    AND (job.channel_id IS NULL OR c.id<>job.channel_id)) THEN
    RAISE EXCEPTION '审批时渠道名称已被使用' USING ERRCODE='23514';
   END IF;
  END IF;
  IF job.action='create' THEN
   INSERT INTO ms.marketing_channels(organization_id,name,parent_id,channel_type,status)
    VALUES(org,job.proposed_name,job.proposed_parent_id,job.proposed_type,'active')
    RETURNING id INTO new_id;
  ELSIF job.action='edit' THEN
   UPDATE ms.marketing_channels SET name=job.proposed_name,
    parent_id=job.proposed_parent_id,channel_type=job.proposed_type
    WHERE id=new_id AND organization_id=org;
  ELSIF job.action='deactivate' THEN
   -- Preserve all historical references. Do not delete or reparent descendants.
   UPDATE ms.marketing_channels SET status='inactive'
    WHERE id=new_id AND organization_id=org;
  END IF;
 END IF;
 UPDATE ms.isolated_channel_change_requests SET
  status=CASE WHEN p_decision='approved' THEN 'applied' ELSE 'rejected' END,
  reviewed_by=actor,review_key=p_key,review_decision=p_decision,
  review_evidence_ref=trim(p_evidence),review_reason=trim(p_reason),
  reviewed_at=now(),
  result_channel_id=CASE WHEN p_decision='approved' THEN new_id ELSE NULL END
 WHERE id=job.id;
 INSERT INTO ms.audit_events(organization_id,actor_user_id,target_type,target_id,
  event_name,before_business_json,after_business_json,reason_zh)
 VALUES(org,actor,'marketing_channel_request',job.id,
  CASE WHEN p_decision='approved' THEN 'CHANNEL_CHANGE_APPLIED' ELSE 'CHANNEL_CHANGE_REJECTED' END,
  coalesce(job.old_snapshot,'{}'::jsonb),
  jsonb_build_object('action',job.action,'decision',p_decision,
   'channel_id',CASE WHEN p_decision='approved' THEN new_id ELSE NULL END,
   'requested_by',job.requested_by),
  '独立主管审核渠道变更：'||trim(p_reason));
 RETURN jsonb_build_object('request_id',job.id,
  'status',CASE WHEN p_decision='approved' THEN 'applied' ELSE 'rejected' END,
  'channel_id',CASE WHEN p_decision='approved' THEN new_id ELSE NULL END,
  'action',job.action);
END $review$;
REVOKE ALL ON FUNCTION ms.review_isolated_channel_change(
 uuid,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ms.review_isolated_channel_change(
 uuid,text,text,text,text) TO ms_scoped_lowrisk_writer;

DO $role_guard$
DECLARE login_name text;
BEGIN
 FOREACH login_name IN ARRAY ARRAY[
  'ms_write_a','ms_write_b','ms_write_manager','ms_write_manager_2'
 ] LOOP
  IF has_table_privilege(login_name,'ms.marketing_channels','SELECT')
   OR has_table_privilege(login_name,'ms.marketing_channels','INSERT')
   OR has_table_privilege(login_name,'ms.marketing_channels','UPDATE')
   OR has_table_privilege(login_name,'ms.isolated_channel_change_requests','SELECT')
   OR has_table_privilege(login_name,'ms.audit_events','UPDATE')
   OR has_table_privilege(login_name,'ms.sales_orders','SELECT')
   OR NOT has_function_privilege(login_name,
     'ms.request_isolated_channel_change(text,uuid,text,uuid,text,text,text,text)','EXECUTE')
   OR NOT has_function_privilege(login_name,
     'ms.review_isolated_channel_change(uuid,text,text,text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'Channel maintenance principal cannot gain base-table or finance access: %',login_name;
  END IF;
 END LOOP;
END $role_guard$;
COMMIT;
