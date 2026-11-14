-- V3.2-35: one-way freeze of FICTIONAL UAT reference history.
-- Lock ordering: both append and freeze lock the same source request row,
-- preventing a new insert after a committed freeze or an ambiguous watermark.
BEGIN;
CREATE ROLE ms_fixture_uat_freeze_writer NOLOGIN;
GRANT USAGE ON SCHEMA ms TO ms_fixture_uat_freeze_writer;

CREATE TABLE ms.fixture_uat_source_freezes(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES ms.organizations(id),
 source_request_id uuid NOT NULL UNIQUE REFERENCES ms.source_readiness_requests(id),
 frozen_at_sequence integer NOT NULL CHECK(frozen_at_sequence>=0),
 freeze_reason text NOT NULL CHECK(freeze_reason IN(
  'fixture_security_lock','fixture_staff_revoked','fixture_integrity_review')),
 evidence_ref text NOT NULL CHECK(evidence_ref ~ '^fictional_[a-z0-9_-]{8,64}$'),
 frozen_by uuid NOT NULL REFERENCES ms.staff_users(id),
 request_key text NOT NULL CHECK(request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(frozen_by,request_key)
);
ALTER TABLE ms.fixture_uat_source_freezes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ms.fixture_uat_source_freezes FROM PUBLIC,
 ms_lowrisk_runtime,ms_scoped_lowrisk_writer,ms_cross_module_plan_writer,
 ms_cross_module_plan_reader,ms_source_readiness_reader,
 ms_source_readiness_writer,ms_fixture_recovery_writer,
 ms_integration_gap_reader,ms_integration_gap_writer,
 ms_fixture_uat_evidence_writer,ms_uat_preview_reader;
CREATE TRIGGER immutable_fixture_source_freeze
 BEFORE UPDATE OR DELETE ON ms.fixture_uat_source_freezes
 FOR EACH ROW EXECUTE FUNCTION ms.reject_access_history_mutation();

-- Defense in depth: an insert by any path must serialize with freeze and
-- preserve source/organization binding and contiguous revision numbering.
CREATE FUNCTION ms.guard_fixture_uat_append_freeze()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ms AS $f$
DECLARE req_org uuid;expected_sequence integer;
BEGIN
 SELECT organization_id INTO req_org
 FROM ms.source_readiness_requests WHERE id=NEW.source_request_id FOR UPDATE;
 IF req_org IS NULL OR req_org<>NEW.organization_id
 THEN RAISE EXCEPTION '虚构历史来源与机构不匹配' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM ms.fixture_uat_source_freezes
   WHERE source_request_id=NEW.source_request_id)
 THEN RAISE EXCEPTION '来源虚构历史已冻结，禁止新增或撤销'
 USING ERRCODE='55000'; END IF;
 SELECT COALESCE(max(request_sequence),0)+1 INTO expected_sequence
 FROM ms.fixture_uat_evidence_events WHERE source_request_id=NEW.source_request_id;
 IF NEW.request_sequence<>expected_sequence THEN
  RAISE EXCEPTION '虚构历史版本必须连续且不可回退' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION ms.guard_fixture_uat_append_freeze() FROM PUBLIC;
CREATE TRIGGER fixture_evidence_freeze_guard
 BEFORE INSERT ON ms.fixture_uat_evidence_events
 FOR EACH ROW EXECUTE FUNCTION ms.guard_fixture_uat_append_freeze();

CREATE FUNCTION ms.freeze_fixture_uat_source(
 p_request uuid,p_reason text,p_evidence text,p_key text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ms AS $f$
DECLARE actor uuid;org uuid;req ms.source_readiness_requests%ROWTYPE;
 existing ms.fixture_uat_source_freezes%ROWTYPE;
 frozen_version integer;freeze_id uuid;
BEGIN
 SELECT staff_id,org_id INTO actor,org FROM ms.access_actor();
 IF actor IS NULL THEN RAISE EXCEPTION '当前员工无权冻结虚构审计'
 USING ERRCODE='42501'; END IF;
 IF p_request IS NULL OR p_reason NOT IN(
  'fixture_security_lock','fixture_staff_revoked','fixture_integrity_review')
  OR p_evidence IS NULL OR p_evidence !~ '^fictional_[a-z0-9_-]{8,64}$'
  OR p_key IS NULL OR p_key !~ '^[A-Za-z0-9_-]{16,128}$'
 THEN RAISE EXCEPTION '仅接收受限虚构审计冻结申请'
 USING ERRCODE='23514'; END IF;
 PERFORM ms.assert_fixture_source_recovery_security(actor,org);
 SELECT * INTO req FROM ms.source_readiness_requests
 WHERE id=p_request AND organization_id=org FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '本机构不存在该虚构来源'
 USING ERRCODE='42501'; END IF;
 IF actor=req.requester_id THEN
  RAISE EXCEPTION '来源申请人不可自行冻结审批历史'
  USING ERRCODE='42501'; END IF;
 SELECT * INTO existing FROM ms.fixture_uat_source_freezes
 WHERE source_request_id=p_request;
 IF FOUND THEN
  IF existing.frozen_by=actor AND existing.request_key=p_key AND
     existing.freeze_reason=p_reason AND existing.evidence_ref=p_evidence
  THEN RETURN existing.id; END IF;
  RAISE EXCEPTION '历史已冻结，不能重新签署或覆盖' USING ERRCODE='23505';
 END IF;
 IF EXISTS(SELECT 1 FROM ms.fixture_uat_source_freezes
  WHERE frozen_by=actor AND request_key=p_key)
 THEN RAISE EXCEPTION '冻结操作编号已经用于其他来源' USING ERRCODE='23505'; END IF;
 SELECT COALESCE(max(request_sequence),0) INTO frozen_version
 FROM ms.fixture_uat_evidence_events WHERE source_request_id=p_request;
 INSERT INTO ms.fixture_uat_source_freezes(
  organization_id,source_request_id,frozen_at_sequence,freeze_reason,
  evidence_ref,frozen_by,request_key)
 VALUES(org,p_request,frozen_version,p_reason,p_evidence,actor,p_key)
 RETURNING id INTO freeze_id;
 RETURN freeze_id;
END $f$;
REVOKE ALL ON FUNCTION ms.freeze_fixture_uat_source(uuid,text,text,text)
 FROM PUBLIC,ms_lowrisk_runtime,ms_scoped_lowrisk_writer,
 ms_fixture_uat_evidence_writer,ms_uat_preview_reader,
 ms_integration_gap_writer,ms_integration_gap_reader,
 ms_fixture_recovery_writer,ms_source_readiness_reader,
 ms_source_readiness_writer,ms_cross_module_plan_reader,
 ms_cross_module_plan_writer;
GRANT EXECUTE ON FUNCTION ms.freeze_fixture_uat_source(uuid,text,text,text)
 TO ms_fixture_uat_freeze_writer;

CREATE FUNCTION ms.readonly_fixture_uat_freeze_state(p_request uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,ms AS $f$
DECLARE gate jsonb;f ms.fixture_uat_source_freezes%ROWTYPE;last_seq integer;
BEGIN
 -- Re-use the original scoped employee/tenant permission checks.
 gate:=ms.readonly_integration_uat_report(p_request);
 IF gate->'production_integration_allowed'<>'false'::jsonb OR
  gate->'execution_allowed'<>'false'::jsonb OR
  gate->'release_allowed'<>'false'::jsonb THEN
  RAISE EXCEPTION '真实联调和纠错仍处于阻断' USING ERRCODE='23514'; END IF;
 SELECT COALESCE(max(request_sequence),0) INTO last_seq
 FROM ms.fixture_uat_evidence_events WHERE source_request_id=p_request;
 SELECT * INTO f FROM ms.fixture_uat_source_freezes WHERE source_request_id=p_request;
 IF FOUND AND f.frozen_at_sequence<>last_seq THEN
  RAISE EXCEPTION '虚构历史冻结版本不一致，阻断读取'
  USING ERRCODE='55000'; END IF;
 RETURN jsonb_build_object(
  'source_request_id',p_request,
  'current_sequence',last_seq,'is_frozen',f.id IS NOT NULL,
  'frozen_at_sequence',CASE WHEN f.id IS NOT NULL THEN f.frozen_at_sequence ELSE NULL END,
  'freeze_reason',CASE WHEN f.id IS NOT NULL THEN f.freeze_reason ELSE NULL END,
  'real_evidence_verified',false,'production_integration_allowed',false,
  'execution_allowed',false,'release_allowed',false);
END $f$;
REVOKE ALL ON FUNCTION ms.readonly_fixture_uat_freeze_state(uuid)
 FROM PUBLIC,ms_lowrisk_runtime,ms_scoped_lowrisk_writer,
 ms_fixture_uat_evidence_writer,ms_fixture_uat_freeze_writer,
 ms_integration_gap_writer,ms_integration_gap_reader,
 ms_source_readiness_reader,ms_source_readiness_writer,
 ms_fixture_recovery_writer,ms_cross_module_plan_reader,
 ms_cross_module_plan_writer;
GRANT EXECUTE ON FUNCTION ms.readonly_fixture_uat_freeze_state(uuid)
 TO ms_uat_preview_reader;

-- Expected current version is checked IN THE SAME DATABASE STATEMENT as
-- the event snapshot, rather than the earlier browser GET. No stale export.
CREATE FUNCTION ms.readonly_fixture_uat_diff_guarded(
 p_request uuid,p_from integer,p_to integer,p_expected integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,ms AS $f$
DECLARE snapshot jsonb;freeze_state jsonb;actual integer;
BEGIN
 IF p_expected IS NULL OR p_expected<0 THEN
  RAISE EXCEPTION '导出必须指定当前版本' USING ERRCODE='23514'; END IF;
 snapshot:=ms.readonly_fixture_uat_diff(p_request,p_from,p_to);
 actual:=(snapshot->>'current_sequence')::integer;
 IF actual<>p_expected THEN
  RAISE EXCEPTION '历史水位已变化，必须重新读取并核对差异'
  USING ERRCODE='55000'; END IF;
 freeze_state:=ms.readonly_fixture_uat_freeze_state(p_request);
 IF (freeze_state->>'current_sequence')::integer<>actual THEN
  RAISE EXCEPTION '审计快照水位不一致' USING ERRCODE='55000'; END IF;
 RETURN snapshot || jsonb_build_object(
  'is_frozen',freeze_state->'is_frozen',
  'frozen_at_sequence',freeze_state->'frozen_at_sequence');
END $f$;
REVOKE ALL ON FUNCTION ms.readonly_fixture_uat_diff_guarded(
 uuid,integer,integer,integer)
 FROM PUBLIC,ms_lowrisk_runtime,ms_scoped_lowrisk_writer,
 ms_fixture_uat_evidence_writer,ms_fixture_uat_freeze_writer,
 ms_integration_gap_writer,ms_integration_gap_reader,
 ms_source_readiness_writer,ms_source_readiness_reader,
 ms_fixture_recovery_writer,ms_cross_module_plan_reader,
 ms_cross_module_plan_writer;
GRANT EXECUTE ON FUNCTION ms.readonly_fixture_uat_diff_guarded(
 uuid,integer,integer,integer) TO ms_uat_preview_reader;
COMMIT;
