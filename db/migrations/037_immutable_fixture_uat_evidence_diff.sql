-- V3.2-34: fictional UAT evidence references only; never real evidence approval.
-- Every change is immutable, tenant-scoped and permanently NON-EXECUTABLE.
BEGIN;
CREATE ROLE ms_fixture_uat_evidence_writer NOLOGIN;
GRANT USAGE ON SCHEMA ms TO ms_fixture_uat_evidence_writer;

CREATE TABLE ms.fixture_uat_evidence_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES ms.organizations(id),
 source_request_id uuid NOT NULL REFERENCES ms.source_readiness_requests(id),
 request_sequence integer NOT NULL CHECK(request_sequence>0),
 check_code text NOT NULL REFERENCES ms.integration_required_checks(check_code),
 event_kind text NOT NULL CHECK(event_kind IN('fixture_added','fixture_withdrawn')),
 fixture_ref text NOT NULL CHECK(fixture_ref ~ '^fictional_[a-z0-9_-]{8,64}$'),
 parent_sequence integer CHECK(parent_sequence IS NULL OR parent_sequence>0),
 reason_code text NOT NULL CHECK(reason_code IN(
  'fixture_received','fixture_outdated','fixture_revoked','fixture_replaced')),
 recorded_by uuid NOT NULL REFERENCES ms.staff_users(id),
 request_key text NOT NULL CHECK(request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(source_request_id,request_sequence),UNIQUE(recorded_by,request_key),
 CHECK((event_kind='fixture_added' AND parent_sequence IS NULL AND reason_code='fixture_received')
    OR(event_kind='fixture_withdrawn' AND parent_sequence IS NOT NULL
       AND reason_code IN('fixture_outdated','fixture_revoked','fixture_replaced')))
);
CREATE UNIQUE INDEX fixture_uat_single_withdrawal
 ON ms.fixture_uat_evidence_events(source_request_id,parent_sequence)
 WHERE event_kind='fixture_withdrawn';
ALTER TABLE ms.fixture_uat_evidence_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ms.fixture_uat_evidence_events FROM PUBLIC,
 ms_lowrisk_runtime,ms_scoped_lowrisk_writer,ms_cross_module_plan_writer,
 ms_source_readiness_writer,ms_source_readiness_reader,
 ms_fixture_recovery_writer,ms_integration_gap_writer,
 ms_integration_gap_reader,ms_uat_preview_reader;
CREATE TRIGGER immutable_fixture_uat_events BEFORE UPDATE OR DELETE
 ON ms.fixture_uat_evidence_events FOR EACH ROW
 EXECUTE FUNCTION ms.reject_access_history_mutation();

CREATE FUNCTION ms.record_fixture_uat_evidence(
 p_request uuid,p_check text,p_kind text,p_ref text,
 p_parent integer,p_reason text,p_key text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ms AS $function$
DECLARE actor uuid;org uuid;req ms.source_readiness_requests%ROWTYPE;
 checkrow ms.integration_required_checks%ROWTYPE;
 old ms.fixture_uat_evidence_events%ROWTYPE;
 parent ms.fixture_uat_evidence_events%ROWTYPE;new_seq integer;
BEGIN
 SELECT staff_id,org_id INTO actor,org FROM ms.access_actor();
 IF actor IS NULL THEN RAISE EXCEPTION '必须具备机构员工身份' USING ERRCODE='42501'; END IF;
 IF p_request IS NULL OR p_check IS NULL OR p_kind NOT IN('fixture_added','fixture_withdrawn')
  OR p_ref IS NULL OR p_ref !~ '^fictional_[a-z0-9_-]{8,64}$'
  OR p_reason NOT IN('fixture_received','fixture_outdated','fixture_revoked','fixture_replaced')
  OR p_key IS NULL OR p_key !~ '^[A-Za-z0-9_-]{16,128}$'
  OR(p_kind='fixture_added' AND (p_parent IS NOT NULL OR p_reason<>'fixture_received'))
  OR(p_kind='fixture_withdrawn' AND (p_parent IS NULL OR p_parent<1
   OR p_reason NOT IN('fixture_outdated','fixture_revoked','fixture_replaced')))
 THEN RAISE EXCEPTION '仅允许虚构证据添加或撤销，不接受真实材料与通过状态'
 USING ERRCODE='23514'; END IF;
 -- Lock this one request to serialize revision allocation/replay checks.
 SELECT * INTO req FROM ms.source_readiness_requests
 WHERE id=p_request AND organization_id=org FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '不存在本机构来源申请' USING ERRCODE='42501'; END IF;
 SELECT * INTO checkrow FROM ms.integration_required_checks WHERE check_code=p_check;
 IF NOT FOUND OR (checkrow.department<>req.department
  AND checkrow.department NOT IN('sales','security'))
 THEN RAISE EXCEPTION '此来源不适用该证据责任领域' USING ERRCODE='23514'; END IF;
 PERFORM ms.assert_integration_gate_department(actor,org,checkrow.department);

 SELECT * INTO old FROM ms.fixture_uat_evidence_events
 WHERE recorded_by=actor AND request_key=p_key;
 IF FOUND THEN
  IF old.source_request_id=p_request AND old.check_code=p_check
   AND old.event_kind=p_kind AND old.fixture_ref=p_ref
   AND old.parent_sequence IS NOT DISTINCT FROM p_parent
   AND old.reason_code=p_reason THEN RETURN old.request_sequence; END IF;
  RAISE EXCEPTION '同一操作编号内容冲突' USING ERRCODE='23505';
 END IF;
 IF p_kind='fixture_withdrawn' THEN
  SELECT * INTO parent FROM ms.fixture_uat_evidence_events
  WHERE source_request_id=p_request AND request_sequence=p_parent
   AND check_code=p_check AND fixture_ref=p_ref AND event_kind='fixture_added';
  IF NOT FOUND OR EXISTS(
   SELECT 1 FROM ms.fixture_uat_evidence_events
   WHERE source_request_id=p_request AND parent_sequence=p_parent
    AND event_kind='fixture_withdrawn')
  THEN RAISE EXCEPTION '只能撤销同一来源中尚未撤销的虚构证据'
   USING ERRCODE='23514'; END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM ms.fixture_uat_evidence_events e
   WHERE e.source_request_id=p_request AND e.check_code=p_check
    AND e.fixture_ref=p_ref AND e.event_kind='fixture_added'
    AND NOT EXISTS(SELECT 1 FROM ms.fixture_uat_evidence_events w
      WHERE w.source_request_id=p_request AND w.event_kind='fixture_withdrawn'
       AND w.parent_sequence=e.request_sequence))
  THEN RAISE EXCEPTION '虚构证据仍有效，不能重复新增' USING ERRCODE='23505'; END IF;
 END IF;
 SELECT COALESCE(max(request_sequence),0)+1 INTO new_seq
 FROM ms.fixture_uat_evidence_events WHERE source_request_id=p_request;
 INSERT INTO ms.fixture_uat_evidence_events(
  organization_id,source_request_id,request_sequence,check_code,
  event_kind,fixture_ref,parent_sequence,reason_code,recorded_by,request_key)
 VALUES(org,p_request,new_seq,p_check,p_kind,p_ref,p_parent,p_reason,actor,p_key);
 RETURN new_seq;
END $function$;
REVOKE ALL ON FUNCTION ms.record_fixture_uat_evidence(
 uuid,text,text,text,integer,text,text)
 FROM PUBLIC,ms_lowrisk_runtime,ms_scoped_lowrisk_writer,
 ms_source_readiness_writer,ms_source_readiness_reader,
 ms_fixture_recovery_writer,ms_integration_gap_writer,
 ms_integration_gap_reader,ms_uat_preview_reader;
GRANT EXECUTE ON FUNCTION ms.record_fixture_uat_evidence(
 uuid,text,text,text,integer,text,text) TO ms_fixture_uat_evidence_writer;

CREATE FUNCTION ms.readonly_fixture_uat_diff(
 p_request uuid,p_from integer,p_to integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,ms AS $function$
DECLARE gate jsonb;current_sequence integer;end_sequence integer;
 observed_count integer;before_active integer;after_active integer;
 adds integer;withdraws integer;changes jsonb;
BEGIN
 -- Same protected SESSION_USER and tenant/read rights as V3.2-32 report.
 gate:=ms.readonly_integration_uat_report(p_request);
 IF gate->'production_integration_allowed'<>'false'::jsonb OR
    gate->'execution_allowed'<>'false'::jsonb OR
    gate->'release_allowed'<>'false'::jsonb
 THEN RAISE EXCEPTION '真实联调仍必须处于阻断状态' USING ERRCODE='23514'; END IF;
 SELECT COALESCE(max(request_sequence),0) INTO current_sequence
 FROM ms.fixture_uat_evidence_events WHERE source_request_id=p_request;
 end_sequence:=COALESCE(p_to,current_sequence);
 IF p_from IS NULL OR p_from<0 OR p_from>end_sequence OR
    end_sequence>current_sequence
 THEN RAISE EXCEPTION '快照版本不合法或高于当前可用历史' USING ERRCODE='23514'; END IF;
 SELECT count(*)::integer,
  count(*) FILTER(WHERE event_kind='fixture_added')::integer,
  count(*) FILTER(WHERE event_kind='fixture_withdrawn')::integer
 INTO observed_count,adds,withdraws FROM ms.fixture_uat_evidence_events
 WHERE source_request_id=p_request
 AND request_sequence>p_from AND request_sequence<=end_sequence;
 IF observed_count>200 THEN RAISE EXCEPTION '历史窗口超过安全上限，请缩小版本范围'
 USING ERRCODE='23514'; END IF;
 SELECT count(*) INTO before_active FROM ms.fixture_uat_evidence_events e
 WHERE e.source_request_id=p_request AND e.event_kind='fixture_added'
  AND e.request_sequence<=p_from AND NOT EXISTS(
   SELECT 1 FROM ms.fixture_uat_evidence_events w
   WHERE w.source_request_id=p_request AND w.event_kind='fixture_withdrawn'
     AND w.parent_sequence=e.request_sequence AND w.request_sequence<=p_from);
 SELECT count(*) INTO after_active FROM ms.fixture_uat_evidence_events e
 WHERE e.source_request_id=p_request AND e.event_kind='fixture_added'
  AND e.request_sequence<=end_sequence AND NOT EXISTS(
   SELECT 1 FROM ms.fixture_uat_evidence_events w
   WHERE w.source_request_id=p_request AND w.event_kind='fixture_withdrawn'
     AND w.parent_sequence=e.request_sequence AND w.request_sequence<=end_sequence);
 SELECT COALESCE(jsonb_agg(jsonb_build_object(
   'sequence',e.request_sequence,'check_code',e.check_code,
   'event_kind',e.event_kind,'fixture_ref',e.fixture_ref,
   'parent_sequence',e.parent_sequence,'reason_code',e.reason_code,
   'created_at',to_char(e.created_at AT TIME ZONE 'UTC',
     'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
   ORDER BY e.request_sequence),'[]'::jsonb) INTO changes
 FROM ms.fixture_uat_evidence_events e WHERE e.source_request_id=p_request
  AND e.request_sequence>p_from AND e.request_sequence<=end_sequence;
 RETURN jsonb_build_object(
  'schema_version','v3.2-34-fixture-uat-audit-v1',
  'source_request_id',p_request,'department',gate->'department',
  'from_sequence',p_from,'to_sequence',end_sequence,
  'current_sequence',current_sequence,
  'changed_event_count',observed_count,'added_count',adds,
  'withdrawn_count',withdraws,'active_before',before_active,
  'active_after',after_active,'events',changes,
  'real_evidence_verified',false,'production_integration_allowed',false,
  'execution_allowed',false,'release_allowed',false,
  'conclusion_zh','仅虚构引用的新增和撤销差异；原订单、资金、课时与隔离状态没有改变。');
END $function$;
REVOKE ALL ON FUNCTION ms.readonly_fixture_uat_diff(uuid,integer,integer)
 FROM PUBLIC,ms_lowrisk_runtime,ms_scoped_lowrisk_writer,
 ms_cross_module_plan_writer,ms_cross_module_plan_reader,
 ms_fixture_uat_evidence_writer,ms_integration_gap_writer,
 ms_integration_gap_reader,ms_fixture_recovery_writer,
 ms_source_readiness_writer,ms_source_readiness_reader;
GRANT EXECUTE ON FUNCTION ms.readonly_fixture_uat_diff(uuid,integer,integer)
 TO ms_uat_preview_reader;
-- No release or business write is introduced.
COMMIT;
