-- V3.2-29: append-only, fictional source registration readiness only.
-- Never stores production keys, endpoints, credentials, or authenticated sources.
BEGIN;
CREATE ROLE ms_source_readiness_writer NOLOGIN;
CREATE ROLE ms_source_readiness_reader NOLOGIN;
GRANT USAGE ON SCHEMA ms TO ms_source_readiness_writer,ms_source_readiness_reader;
GRANT EXECUTE ON FUNCTION ms.current_scoped_staff_id(),ms.current_scoped_organization_id()
 TO ms_source_readiness_reader;

CREATE TABLE ms.source_readiness_requests(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES ms.organizations(id),
 department text NOT NULL CHECK(department IN('finance','academic')),
 source_alias text NOT NULL CHECK(source_alias ~ '^fictional_[a-z0-9_-]{4,50}$'),
 source_tenant_alias text NOT NULL CHECK(source_tenant_alias ~ '^fictional_[a-z0-9_-]{4,50}$'),
 scope_zh text NOT NULL CHECK(length(trim(scope_zh)) BETWEEN 4 AND 400),
 requester_id uuid NOT NULL REFERENCES ms.staff_users(id),
 evidence_ref text NOT NULL CHECK(length(trim(evidence_ref)) BETWEEN 4 AND 160),
 request_key text NOT NULL CHECK(request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(requester_id,request_key)
);
CREATE TABLE ms.source_readiness_reviews(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES ms.organizations(id),
 request_id uuid NOT NULL REFERENCES ms.source_readiness_requests(id),
 review_department text NOT NULL CHECK(review_department IN('business','security')),
 reviewer_id uuid NOT NULL REFERENCES ms.staff_users(id),
 decision text NOT NULL CHECK(decision IN('fixture_ready','return_for_revision','rejected')),
 evidence_ref text NOT NULL CHECK(length(trim(evidence_ref)) BETWEEN 4 AND 160),
 reason_zh text NOT NULL CHECK(length(trim(reason_zh)) BETWEEN 4 AND 400),
 request_key text NOT NULL CHECK(request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
 reviewed_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(request_id,review_department),UNIQUE(request_id,reviewer_id),
 UNIQUE(reviewer_id,request_key)
);
ALTER TABLE ms.source_readiness_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE ms.source_readiness_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ms.source_readiness_requests,ms.source_readiness_reviews FROM PUBLIC,
 ms_lowrisk_runtime,ms_scoped_lowrisk_writer,ms_cross_module_plan_writer,
 ms_cross_module_plan_reader;
CREATE TRIGGER immutable_source_request BEFORE UPDATE OR DELETE ON ms.source_readiness_requests
 FOR EACH ROW EXECUTE FUNCTION ms.reject_access_history_mutation();
CREATE TRIGGER immutable_source_review BEFORE UPDATE OR DELETE ON ms.source_readiness_reviews
 FOR EACH ROW EXECUTE FUNCTION ms.reject_access_history_mutation();

CREATE FUNCTION ms.propose_fixture_source_readiness(
 p_department text,p_alias text,p_tenant text,p_scope text,p_evidence text,p_key text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ms AS $f$
DECLARE actor uuid;org uuid;old ms.source_readiness_requests%ROWTYPE;new_id uuid;
BEGIN
 SELECT staff_id,org_id INTO actor,org FROM ms.access_actor();
 IF actor IS NULL THEN RAISE EXCEPTION '员工身份无效' USING ERRCODE='42501'; END IF;
 IF p_department NOT IN('finance','academic') OR p_alias IS NULL OR
 p_alias !~ '^fictional_[a-z0-9_-]{4,50}$' OR p_tenant IS NULL OR
 p_tenant !~ '^fictional_[a-z0-9_-]{4,50}$' OR
 p_scope IS NULL OR length(trim(p_scope)) NOT BETWEEN 4 AND 400 OR
 p_evidence IS NULL OR length(trim(p_evidence)) NOT BETWEEN 4 AND 160 OR
 p_key IS NULL OR p_key !~ '^[A-Za-z0-9_-]{16,128}$'
 THEN RAISE EXCEPTION '仅允许隔离虚构来源申请，不得登记真实接口或凭证' USING ERRCODE='23514'; END IF;
 PERFORM ms.assert_cross_module_department_authority(actor,org,p_department);
 SELECT * INTO old FROM ms.source_readiness_requests WHERE requester_id=actor AND request_key=p_key;
 IF FOUND THEN
  IF old.department=p_department AND old.source_alias=p_alias AND
   old.source_tenant_alias=p_tenant AND old.scope_zh=p_scope AND old.evidence_ref=p_evidence
  THEN RETURN old.id; END IF;
  RAISE EXCEPTION '申请编号与原有申请内容冲突' USING ERRCODE='23505';
 END IF;
 INSERT INTO ms.source_readiness_requests(organization_id,department,source_alias,
  source_tenant_alias,scope_zh,requester_id,evidence_ref,request_key)
 VALUES(org,p_department,p_alias,p_tenant,p_scope,actor,p_evidence,p_key)
 RETURNING id INTO new_id;
 RETURN new_id;
END $f$;

CREATE FUNCTION ms.review_fixture_source_readiness(
 p_request uuid,p_review_department text,p_decision text,
 p_evidence text,p_reason text,p_key text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ms AS $f$
DECLARE actor uuid;org uuid;req ms.source_readiness_requests%ROWTYPE;
 old ms.source_readiness_reviews%ROWTYPE;new_id uuid;role_ok boolean;
BEGIN
 SELECT staff_id,org_id INTO actor,org FROM ms.access_actor();
 IF actor IS NULL THEN RAISE EXCEPTION '员工身份无效' USING ERRCODE='42501'; END IF;
 IF p_review_department NOT IN('business','security') OR
  p_decision NOT IN('fixture_ready','return_for_revision','rejected') OR
  p_evidence IS NULL OR length(trim(p_evidence)) NOT BETWEEN 4 AND 160 OR
  p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 4 AND 400 OR
  p_key IS NULL OR p_key !~ '^[A-Za-z0-9_-]{16,128}$'
 THEN RAISE EXCEPTION '审核材料不完整' USING ERRCODE='23514'; END IF;
 SELECT * INTO req FROM ms.source_readiness_requests
  WHERE id=p_request AND organization_id=org FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION '本机构没有此来源申请' USING ERRCODE='42501'; END IF;
 IF actor=req.requester_id THEN RAISE EXCEPTION '来源申请人不能自己审批'
 USING ERRCODE='42501'; END IF;
 IF p_review_department='business' THEN
  PERFORM ms.assert_cross_module_department_authority(actor,org,req.department);
 ELSE
  SELECT EXISTS(
   SELECT 1 FROM ms.staff_users s JOIN ms.user_role_grants g ON g.user_id=s.id
   JOIN ms.role_templates t ON t.id=g.role_id
   WHERE s.id=actor AND s.organization_id=org AND s.status='active'
    AND t.organization_id=org AND t.role_code='source_security_reviewer'
    AND g.revoked_at IS NULL AND g.valid_from<=now()) INTO role_ok;
  IF NOT role_ok THEN RAISE EXCEPTION '没有独立信息安全审核权限'
   USING ERRCODE='42501'; END IF;
 END IF;
 SELECT * INTO old FROM ms.source_readiness_reviews
 WHERE reviewer_id=actor AND request_key=p_key;
 IF FOUND THEN
  IF old.request_id=p_request AND old.review_department=p_review_department
   AND old.decision=p_decision AND old.evidence_ref=p_evidence
   AND old.reason_zh=p_reason THEN RETURN old.id; END IF;
  RAISE EXCEPTION '审核编号被重复使用' USING ERRCODE='23505';
 END IF;
 IF EXISTS(SELECT 1 FROM ms.source_readiness_reviews
  WHERE request_id=req.id AND (review_department=p_review_department OR reviewer_id=actor))
 THEN RAISE EXCEPTION '审核部门不得重复签署，同一人不能兼任两部门'
 USING ERRCODE='23505'; END IF;
 IF EXISTS(SELECT 1 FROM ms.source_readiness_reviews
  WHERE request_id=req.id AND decision<>'fixture_ready')
 THEN RAISE EXCEPTION '本次申请已退回或拒绝，不可继续审批'
 USING ERRCODE='23514'; END IF;
 INSERT INTO ms.source_readiness_reviews(
  organization_id,request_id,review_department,reviewer_id,
  decision,evidence_ref,reason_zh,request_key)
 VALUES(org,req.id,p_review_department,actor,p_decision,p_evidence,p_reason,p_key)
 RETURNING id INTO new_id;
 RETURN new_id;
END $f$;

REVOKE ALL ON FUNCTION ms.propose_fixture_source_readiness(text,text,text,text,text,text),
 ms.review_fixture_source_readiness(uuid,text,text,text,text,text)
 FROM PUBLIC,ms_lowrisk_runtime,ms_scoped_lowrisk_writer,ms_cross_module_plan_reader;
GRANT EXECUTE ON FUNCTION ms.propose_fixture_source_readiness(text,text,text,text,text,text),
 ms.review_fixture_source_readiness(uuid,text,text,text,text,text)
 TO ms_source_readiness_writer;

CREATE VIEW ms.scoped_fixture_source_readiness WITH(security_barrier=true) AS
 SELECT r.id AS request_id,r.department,r.source_alias,r.created_at,
  (SELECT count(*)::integer FROM ms.source_readiness_reviews v
   WHERE v.request_id=r.id AND v.decision='fixture_ready') AS fixture_review_count,
  EXISTS(SELECT 1 FROM ms.source_readiness_reviews v WHERE v.request_id=r.id
   AND v.decision<>'fixture_ready') AS returned_or_rejected,
  (SELECT count(*) FROM ms.source_readiness_reviews v WHERE v.request_id=r.id
   AND v.decision='fixture_ready')=2 AS fictional_fixture_reviewed,
  FALSE AS production_source_approved,FALSE AS credentials_approved,
  FALSE AS real_readonly_connection_enabled,
  FALSE AS execution_allowed,FALSE AS release_allowed
 FROM ms.source_readiness_requests r
 WHERE r.organization_id=ms.current_scoped_organization_id()
 AND ms.current_scoped_staff_id() IS NOT NULL AND (
 r.requester_id=ms.current_scoped_staff_id() OR
 EXISTS(SELECT 1 FROM ms.staff_users s JOIN ms.user_role_grants g ON g.user_id=s.id
 JOIN ms.role_templates t ON t.id=g.role_id
 WHERE s.id=ms.current_scoped_staff_id() AND s.organization_id=r.organization_id
  AND s.status='active' AND t.organization_id=r.organization_id AND
  t.role_code IN('finance_correction_reviewer','academic_correction_reviewer',
                'source_security_reviewer')
  AND g.revoked_at IS NULL AND g.valid_from<=now()));
REVOKE ALL ON ms.scoped_fixture_source_readiness FROM PUBLIC;
GRANT SELECT ON ms.scoped_fixture_source_readiness TO ms_source_readiness_reader;
-- Deliberate absence: no live trust root, source authorization, credentials,
-- HTTP endpoint, compensation execution, financial mutation, or hold release.
COMMIT;
