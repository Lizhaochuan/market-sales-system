-- V3.2-30 isolated source interruption and recovery review ONLY.
-- No data fetch, credential, external job, finance/CRM writes or release.
BEGIN;
CREATE TABLE ms.fixture_source_recovery_incidents(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES ms.organizations(id),
 source_request_id uuid NOT NULL REFERENCES ms.source_readiness_requests(id),
 incident_kind text NOT NULL CHECK(incident_kind IN(
  'timeout_unknown','missing_page','sequence_gap','watermark_rollback',
  'signature_invalid','source_revoked','tenant_mismatch','duplicate_conflict')),
 observed_sequence bigint CHECK(observed_sequence IS NULL OR observed_sequence>=0),
 observed_watermark bigint CHECK(observed_watermark IS NULL OR observed_watermark>=0),
 evidence_ref text NOT NULL CHECK(length(trim(evidence_ref)) BETWEEN 4 AND 160),
 reason_zh text NOT NULL CHECK(length(trim(reason_zh)) BETWEEN 4 AND 400),
 reported_by uuid NOT NULL REFERENCES ms.staff_users(id),
 request_key text NOT NULL CHECK(request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
 reported_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(reported_by,request_key)
);
CREATE TABLE ms.fixture_source_recovery_reviews(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES ms.organizations(id),
 incident_id uuid NOT NULL REFERENCES ms.fixture_source_recovery_incidents(id),
 review_kind text NOT NULL CHECK(review_kind IN(
  'security_investigation','business_confirmation','fixture_replay_checked')),
 review_result text NOT NULL CHECK(review_result IN(
  'manual_review_required','source_still_unknown','fixture_checks_only',
  'rejected_recovery')),
 reviewed_by uuid NOT NULL REFERENCES ms.staff_users(id),
 evidence_ref text NOT NULL CHECK(length(trim(evidence_ref)) BETWEEN 4 AND 160),
 reason_zh text NOT NULL CHECK(length(trim(reason_zh)) BETWEEN 4 AND 400),
 request_key text NOT NULL CHECK(request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
 reviewed_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(incident_id,review_kind),UNIQUE(incident_id,reviewed_by),
 UNIQUE(reviewed_by,request_key)
);
ALTER TABLE ms.fixture_source_recovery_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE ms.fixture_source_recovery_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ms.fixture_source_recovery_incidents,ms.fixture_source_recovery_reviews
 FROM PUBLIC,ms_lowrisk_runtime,ms_scoped_lowrisk_writer,ms_source_readiness_writer,
 ms_source_readiness_reader,ms_cross_module_plan_writer,ms_cross_module_plan_reader;
CREATE TRIGGER immutable_fixture_recovery_incident BEFORE UPDATE OR DELETE
 ON ms.fixture_source_recovery_incidents FOR EACH ROW EXECUTE FUNCTION ms.reject_access_history_mutation();
CREATE TRIGGER immutable_fixture_recovery_review BEFORE UPDATE OR DELETE
 ON ms.fixture_source_recovery_reviews FOR EACH ROW EXECUTE FUNCTION ms.reject_access_history_mutation();

CREATE FUNCTION ms.assert_fixture_source_recovery_security(p_actor uuid,p_org uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ms AS $f$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM ms.staff_users s
 JOIN ms.user_role_grants g ON g.user_id=s.id
 JOIN ms.role_templates t ON t.id=g.role_id
 WHERE s.id=p_actor AND s.status='active' AND s.organization_id=p_org
 AND t.organization_id=p_org AND t.role_code='source_security_reviewer'
 AND g.revoked_at IS NULL AND g.valid_from<=now())
 THEN RAISE EXCEPTION '无本机构安全复核权限' USING ERRCODE='42501'; END IF;
END $f$;
REVOKE ALL ON FUNCTION ms.assert_fixture_source_recovery_security(uuid,uuid) FROM PUBLIC;

CREATE FUNCTION ms.report_fixture_source_interruption(
 p_request uuid,p_kind text,p_sequence bigint,p_watermark bigint,
 p_evidence text,p_reason text,p_key text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ms AS $f$
DECLARE actor uuid;org uuid;req ms.source_readiness_requests%ROWTYPE;
 old ms.fixture_source_recovery_incidents%ROWTYPE;rid uuid;
BEGIN
 SELECT staff_id,org_id INTO actor,org FROM ms.access_actor();
 IF actor IS NULL THEN RAISE EXCEPTION '无有效员工账号' USING ERRCODE='42501'; END IF;
 IF p_kind NOT IN('timeout_unknown','missing_page','sequence_gap',
  'watermark_rollback','signature_invalid','source_revoked',
  'tenant_mismatch','duplicate_conflict')
 OR p_sequence<0 OR p_watermark<0 OR
 p_evidence IS NULL OR length(trim(p_evidence)) NOT BETWEEN 4 AND 160 OR
 p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 4 AND 400 OR
 p_key IS NULL OR p_key !~ '^[A-Za-z0-9_-]{16,128}$'
 THEN RAISE EXCEPTION '隔离来源故障报告无效' USING ERRCODE='23514'; END IF;
 SELECT * INTO req FROM ms.source_readiness_requests
 WHERE id=p_request AND organization_id=org FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION '本机构不存在该来源登记申请' USING ERRCODE='42501'; END IF;
 PERFORM ms.assert_cross_module_department_authority(actor,org,req.department);
 SELECT * INTO old FROM ms.fixture_source_recovery_incidents
 WHERE reported_by=actor AND request_key=p_key;
 IF FOUND THEN
  IF old.source_request_id=p_request AND old.incident_kind=p_kind
   AND old.observed_sequence IS NOT DISTINCT FROM p_sequence
   AND old.observed_watermark IS NOT DISTINCT FROM p_watermark
   AND old.evidence_ref=p_evidence AND old.reason_zh=p_reason
  THEN RETURN old.id; END IF;
  RAISE EXCEPTION '故障报告编号冲突' USING ERRCODE='23505';
 END IF;
 INSERT INTO ms.fixture_source_recovery_incidents(
  organization_id,source_request_id,incident_kind,observed_sequence,
  observed_watermark,evidence_ref,reason_zh,reported_by,request_key)
 VALUES(org,req.id,p_kind,p_sequence,p_watermark,p_evidence,p_reason,actor,p_key)
 RETURNING id INTO rid;
 RETURN rid;
END $f$;

CREATE FUNCTION ms.review_fixture_source_interruption(
 p_incident uuid,p_kind text,p_result text,p_evidence text,
 p_reason text,p_key text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ms AS $f$
DECLARE actor uuid;org uuid;incident ms.fixture_source_recovery_incidents%ROWTYPE;
 req ms.source_readiness_requests%ROWTYPE;
 old ms.fixture_source_recovery_reviews%ROWTYPE;rid uuid;
BEGIN
 SELECT staff_id,org_id INTO actor,org FROM ms.access_actor();
 IF actor IS NULL THEN RAISE EXCEPTION '无有效员工账号' USING ERRCODE='42501'; END IF;
 IF p_kind NOT IN('security_investigation','business_confirmation','fixture_replay_checked')
 OR p_result NOT IN('manual_review_required','source_still_unknown',
  'fixture_checks_only','rejected_recovery')
 OR p_evidence IS NULL OR length(trim(p_evidence)) NOT BETWEEN 4 AND 160 OR
 p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 4 AND 400 OR
 p_key IS NULL OR p_key !~ '^[A-Za-z0-9_-]{16,128}$'
 THEN RAISE EXCEPTION '故障复核材料不完整' USING ERRCODE='23514'; END IF;
 SELECT * INTO incident FROM ms.fixture_source_recovery_incidents
 WHERE id=p_incident AND organization_id=org;
 IF NOT FOUND THEN RAISE EXCEPTION '本机构不存在此故障' USING ERRCODE='42501'; END IF;
 SELECT * INTO req FROM ms.source_readiness_requests
 WHERE id=incident.source_request_id AND organization_id=org FOR SHARE;
 IF NOT FOUND OR actor=incident.reported_by
 THEN RAISE EXCEPTION '故障报告人不能复核自己的故障' USING ERRCODE='42501'; END IF;
 IF p_kind='business_confirmation' THEN
  PERFORM ms.assert_cross_module_department_authority(actor,org,req.department);
 ELSE
  PERFORM ms.assert_fixture_source_recovery_security(actor,org);
 END IF;
 SELECT * INTO old FROM ms.fixture_source_recovery_reviews
 WHERE reviewed_by=actor AND request_key=p_key;
 IF FOUND THEN
  IF old.incident_id=p_incident AND old.review_kind=p_kind
   AND old.review_result=p_result AND old.evidence_ref=p_evidence
   AND old.reason_zh=p_reason THEN RETURN old.id; END IF;
  RAISE EXCEPTION '复核编号内容冲突' USING ERRCODE='23505';
 END IF;
 IF EXISTS(SELECT 1 FROM ms.fixture_source_recovery_reviews v
 WHERE v.incident_id=incident.id AND (v.review_kind=p_kind OR v.reviewed_by=actor))
 THEN RAISE EXCEPTION '同一复核类别只能签署一次且不能兼任'
 USING ERRCODE='23505'; END IF;
 INSERT INTO ms.fixture_source_recovery_reviews(
  organization_id,incident_id,review_kind,review_result,reviewed_by,
  evidence_ref,reason_zh,request_key)
 VALUES(org,incident.id,p_kind,p_result,actor,p_evidence,p_reason,p_key)
 RETURNING id INTO rid;
 RETURN rid;
END $f$;

REVOKE ALL ON FUNCTION ms.report_fixture_source_interruption(
 uuid,text,bigint,bigint,text,text,text),
 ms.review_fixture_source_interruption(uuid,text,text,text,text,text)
 FROM PUBLIC,ms_lowrisk_runtime,ms_scoped_lowrisk_writer,
 ms_source_readiness_reader,ms_source_readiness_writer;
GRANT EXECUTE ON FUNCTION ms.report_fixture_source_interruption(
 uuid,text,bigint,bigint,text,text,text),
 ms.review_fixture_source_interruption(uuid,text,text,text,text,text)
 TO ms_cross_module_plan_writer;

CREATE VIEW ms.scoped_fixture_source_recovery WITH(security_barrier=true) AS
SELECT i.id AS incident_id,i.source_request_id,i.incident_kind,i.reported_at,
 (SELECT count(*)::integer FROM ms.fixture_source_recovery_reviews v
  WHERE v.incident_id=i.id) AS review_count,
 '继续隔离、人工复核'::text AS status_zh,
 FALSE AS production_source_restored,FALSE AS true_external_reconciliation,
 FALSE AS execution_allowed,FALSE AS release_allowed
FROM ms.fixture_source_recovery_incidents i
JOIN ms.source_readiness_requests r ON r.id=i.source_request_id
WHERE i.organization_id=ms.current_scoped_organization_id()
 AND ms.current_scoped_staff_id() IS NOT NULL AND
 (i.reported_by=ms.current_scoped_staff_id() OR EXISTS(
 SELECT 1 FROM ms.staff_users s JOIN ms.user_role_grants g ON g.user_id=s.id
 JOIN ms.role_templates t ON t.id=g.role_id
 WHERE s.id=ms.current_scoped_staff_id() AND s.organization_id=i.organization_id
 AND s.status='active' AND t.organization_id=i.organization_id
 AND t.role_code IN('source_security_reviewer',
  'finance_correction_reviewer','academic_correction_reviewer')
 AND g.revoked_at IS NULL AND g.valid_from<=now()));
REVOKE ALL ON ms.scoped_fixture_source_recovery FROM PUBLIC;
GRANT SELECT ON ms.scoped_fixture_source_recovery TO ms_source_readiness_reader;
-- No real recovery completion, no source authentication, no external polling,
-- no durable message ledger and no hold-release command.
COMMIT;
