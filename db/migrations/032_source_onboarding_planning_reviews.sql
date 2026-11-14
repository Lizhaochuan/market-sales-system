-- V3.2-29: fictional, append-only SOURCE ONBOARDING REQUESTS.
-- Never registers a production trusted key, issues credentials, contacts
-- finance/CRM systems, transfers funds, changes lessons or clears a hold.
BEGIN;

CREATE TABLE ms.cross_module_source_onboarding_requests(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES ms.organizations(id),
 manifest_id uuid NOT NULL REFERENCES ms.cross_module_compensation_manifests(id),
 department text NOT NULL CHECK(department IN ('finance','academic')),
 source_system text NOT NULL CHECK(source_system ~ '^[a-z][a-z0-9_-]{2,63}$'),
 source_tenant text NOT NULL CHECK(source_tenant ~ '^[A-Za-z0-9_-]{2,80}$'),
 purpose_zh text NOT NULL CHECK(length(trim(purpose_zh)) BETWEEN 8 AND 400),
 minimum_data_ref text NOT NULL CHECK(length(trim(minimum_data_ref)) BETWEEN 4 AND 200),
 identity_mapping_ref text NOT NULL CHECK(length(trim(identity_mapping_ref)) BETWEEN 4 AND 200),
 security_controls_ref text NOT NULL CHECK(length(trim(security_controls_ref)) BETWEEN 4 AND 200),
 recovery_plan_ref text NOT NULL CHECK(length(trim(recovery_plan_ref)) BETWEEN 4 AND 200),
 submitted_by uuid NOT NULL REFERENCES ms.staff_users(id),
 request_key text NOT NULL CHECK(request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
 submitted_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(manifest_id,department),
 UNIQUE(submitted_by,request_key)
);

CREATE TABLE ms.cross_module_source_onboarding_reviews(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES ms.organizations(id),
 request_id uuid NOT NULL REFERENCES ms.cross_module_source_onboarding_requests(id),
 review_role text NOT NULL CHECK(review_role IN ('domain_owner','security_owner')),
 decision text NOT NULL CHECK(decision IN ('approved_for_planning','rejected','return_for_revision')),
 reviewed_by uuid NOT NULL REFERENCES ms.staff_users(id),
 evidence_ref text NOT NULL CHECK(length(trim(evidence_ref)) BETWEEN 4 AND 200),
 reason_zh text NOT NULL CHECK(length(trim(reason_zh)) BETWEEN 4 AND 400),
 request_key text NOT NULL CHECK(request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
 reviewed_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(request_id,review_role),
 UNIQUE(request_id,reviewed_by),
 UNIQUE(reviewed_by,request_key)
);
CREATE INDEX ix_source_onboarding_requests_manifest ON ms.cross_module_source_onboarding_requests(manifest_id);
CREATE INDEX ix_source_onboarding_reviews_request ON ms.cross_module_source_onboarding_reviews(request_id);

ALTER TABLE ms.cross_module_source_onboarding_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE ms.cross_module_source_onboarding_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ms.cross_module_source_onboarding_requests,ms.cross_module_source_onboarding_reviews
 FROM PUBLIC,ms_lowrisk_runtime,ms_scoped_lowrisk_writer,
 ms_cross_module_plan_writer,ms_cross_module_plan_reader;
CREATE TRIGGER immutable_source_onboarding_request BEFORE UPDATE OR DELETE
 ON ms.cross_module_source_onboarding_requests FOR EACH ROW EXECUTE FUNCTION ms.reject_access_history_mutation();
CREATE TRIGGER immutable_source_onboarding_review BEFORE UPDATE OR DELETE
 ON ms.cross_module_source_onboarding_reviews FOR EACH ROW EXECUTE FUNCTION ms.reject_access_history_mutation();

-- Shared guard; always locks the original case before a mutation.
CREATE FUNCTION ms.assert_source_onboarding_current(p_manifest uuid,p_org uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ms AS $g$
DECLARE m ms.cross_module_compensation_manifests%ROWTYPE;
 c ms.lead_student_downstream_correction_cases%ROWTYPE;
BEGIN
 SELECT * INTO m FROM ms.cross_module_compensation_manifests
  WHERE id=p_manifest AND organization_id=p_org;
 IF NOT FOUND THEN RAISE EXCEPTION '本机构不存在此补偿清单' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM ms.lead_student_downstream_correction_cases
  WHERE id=m.case_id AND organization_id=p_org FOR UPDATE;
 IF NOT FOUND OR c.status<>'hold_active'
 THEN RAISE EXCEPTION '原错误学生案件必须继续隔离' USING ERRCODE='23514'; END IF;
 PERFORM ms.assert_current_three_party_correction_plan(m.plan_id,p_org,c.id);
 IF NOT EXISTS(SELECT 1 FROM ms.cross_module_compensation_seals s
  WHERE s.manifest_id=m.id)
  OR ms.cross_module_local_correction_fingerprint(c.lead_id,c.student_id)<>m.local_fingerprint
 THEN RAISE EXCEPTION '原三方清单尚未封存或本地事实已经变化'
 USING ERRCODE='23514'; END IF;
 RETURN m.created_by;
END $g$;
REVOKE ALL ON FUNCTION ms.assert_source_onboarding_current(uuid,uuid) FROM PUBLIC;

CREATE FUNCTION ms.request_cross_module_source_onboarding(
 p_manifest uuid,p_department text,p_system text,p_tenant text,
 p_purpose text,p_minimum_ref text,p_identity_ref text,
 p_security_ref text,p_recovery_ref text,p_key text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ms AS $g$
DECLARE actor uuid;org uuid;creator uuid;
 prev ms.cross_module_source_onboarding_requests%ROWTYPE;rid uuid;
BEGIN
 SELECT staff_id,org_id INTO actor,org FROM ms.access_actor();
 IF actor IS NULL THEN RAISE EXCEPTION '没有可信员工身份' USING ERRCODE='42501'; END IF;
 IF p_manifest IS NULL OR p_department NOT IN ('finance','academic')
 OR p_system IS NULL OR p_system !~ '^[a-z][a-z0-9_-]{2,63}$'
 OR p_tenant IS NULL OR p_tenant !~ '^[A-Za-z0-9_-]{2,80}$'
 OR p_purpose IS NULL OR length(trim(p_purpose)) NOT BETWEEN 8 AND 400
 OR p_minimum_ref IS NULL OR length(trim(p_minimum_ref)) NOT BETWEEN 4 AND 200
 OR p_identity_ref IS NULL OR length(trim(p_identity_ref)) NOT BETWEEN 4 AND 200
 OR p_security_ref IS NULL OR length(trim(p_security_ref)) NOT BETWEEN 4 AND 200
 OR p_recovery_ref IS NULL OR length(trim(p_recovery_ref)) NOT BETWEEN 4 AND 200
 OR p_key IS NULL OR p_key !~ '^[A-Za-z0-9_-]{16,128}$'
 THEN RAISE EXCEPTION '来源申请缺少机构映射、最小数据或故障恢复材料'
 USING ERRCODE='23514'; END IF;
 creator:=ms.assert_source_onboarding_current(p_manifest,org);
 IF actor<>creator THEN RAISE EXCEPTION '仅原隔离案件申请人可以提出来源准备申请'
 USING ERRCODE='42501'; END IF;
 SELECT * INTO prev FROM ms.cross_module_source_onboarding_requests
 WHERE submitted_by=actor AND request_key=p_key;
 IF FOUND THEN
  IF prev.manifest_id=p_manifest AND prev.department=p_department
   AND prev.source_system=p_system AND prev.source_tenant=p_tenant
   AND prev.purpose_zh=p_purpose AND prev.minimum_data_ref=p_minimum_ref
   AND prev.identity_mapping_ref=p_identity_ref AND prev.security_controls_ref=p_security_ref
   AND prev.recovery_plan_ref=p_recovery_ref THEN RETURN prev.id; END IF;
  RAISE EXCEPTION '操作编号对应另一份来源登记' USING ERRCODE='23505';
 END IF;
 IF EXISTS(SELECT 1 FROM ms.cross_module_source_onboarding_requests
 WHERE manifest_id=p_manifest AND department=p_department)
 THEN RAISE EXCEPTION '此部门已有不可变来源登记，修订须采用新的三方方案版本'
 USING ERRCODE='23505'; END IF;
 INSERT INTO ms.cross_module_source_onboarding_requests(
  organization_id,manifest_id,department,source_system,source_tenant,
  purpose_zh,minimum_data_ref,identity_mapping_ref,
  security_controls_ref,recovery_plan_ref,submitted_by,request_key)
 VALUES(org,p_manifest,p_department,p_system,p_tenant,p_purpose,p_minimum_ref,
  p_identity_ref,p_security_ref,p_recovery_ref,actor,p_key) RETURNING id INTO rid;
 RETURN rid;
END $g$;

CREATE FUNCTION ms.review_cross_module_source_onboarding(
 p_request uuid,p_role text,p_decision text,p_evidence text,p_reason text,p_key text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ms AS $g$
DECLARE actor uuid;org uuid;creator uuid;
 req ms.cross_module_source_onboarding_requests%ROWTYPE;
 prev ms.cross_module_source_onboarding_reviews%ROWTYPE;rid uuid;
 security_ok boolean;prior_domain_count integer;
BEGIN
 SELECT staff_id,org_id INTO actor,org FROM ms.access_actor();
 IF actor IS NULL THEN RAISE EXCEPTION '没有可信员工身份' USING ERRCODE='42501'; END IF;
 IF p_request IS NULL OR p_role NOT IN ('domain_owner','security_owner')
 OR p_decision NOT IN ('approved_for_planning','rejected','return_for_revision')
 OR p_evidence IS NULL OR length(trim(p_evidence)) NOT BETWEEN 4 AND 200
 OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 4 AND 400
 OR p_key IS NULL OR p_key !~ '^[A-Za-z0-9_-]{16,128}$'
 THEN RAISE EXCEPTION '来源审批材料不完整' USING ERRCODE='23514'; END IF;
 SELECT * INTO req FROM ms.cross_module_source_onboarding_requests
  WHERE id=p_request AND organization_id=org;
 IF NOT FOUND THEN RAISE EXCEPTION '无法审核其他机构来源' USING ERRCODE='42501'; END IF;
 creator:=ms.assert_source_onboarding_current(req.manifest_id,org);
 IF actor=creator THEN RAISE EXCEPTION '来源申请人不得审批自己的申请'
 USING ERRCODE='42501'; END IF;
 IF p_role='domain_owner' THEN
   PERFORM ms.assert_cross_module_department_authority(actor,org,req.department);
 ELSE
   SELECT EXISTS(SELECT 1 FROM ms.staff_users s JOIN ms.user_role_grants g ON g.user_id=s.id
     JOIN ms.role_templates t ON t.id=g.role_id
     WHERE s.id=actor AND s.organization_id=org AND s.status='active'
       AND g.revoked_at IS NULL AND g.valid_from<=now()
       AND t.organization_id=org AND t.role_code='source_security_reviewer')
      INTO security_ok;
   IF NOT security_ok THEN RAISE EXCEPTION '只有本机构独立信息安全审核员可以审核'
   USING ERRCODE='42501'; END IF;
 END IF;
 SELECT * INTO prev FROM ms.cross_module_source_onboarding_reviews
 WHERE reviewed_by=actor AND request_key=p_key;
 IF FOUND THEN
  IF prev.request_id=p_request AND prev.review_role=p_role
   AND prev.decision=p_decision AND prev.evidence_ref=p_evidence
   AND prev.reason_zh=p_reason THEN RETURN prev.id; END IF;
  RAISE EXCEPTION '来源审批防重复编号冲突' USING ERRCODE='23505';
 END IF;
 IF EXISTS(SELECT 1 FROM ms.cross_module_source_onboarding_reviews r
   JOIN ms.cross_module_source_onboarding_requests q ON q.id=r.request_id
   WHERE q.manifest_id=req.manifest_id AND r.decision<>'approved_for_planning')
 THEN RAISE EXCEPTION '该版本已被驳回或退回，必须新建方案版本' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM ms.cross_module_source_onboarding_reviews
   WHERE request_id=p_request AND review_role=p_role)
 THEN RAISE EXCEPTION '该部门或独立安全审核已经签署，不可覆盖' USING ERRCODE='23505'; END IF;
 -- No one can act as a domain approver and security approver within a manifest.
 -- One human also cannot approve BOTH departments as their domain owner.
 IF EXISTS(SELECT 1 FROM ms.cross_module_source_onboarding_reviews r
  JOIN ms.cross_module_source_onboarding_requests q ON q.id=r.request_id
  WHERE q.manifest_id=req.manifest_id AND r.reviewed_by=actor
   AND (r.review_role<>p_role OR p_role='domain_owner'))
 THEN RAISE EXCEPTION '同一人不能跨两个业务部门审批或兼任独立安全审核'
 USING ERRCODE='42501'; END IF;
 IF p_role='security_owner' THEN
  SELECT count(*) INTO prior_domain_count
  FROM ms.cross_module_source_onboarding_reviews r
  JOIN ms.cross_module_source_onboarding_requests q ON q.id=r.request_id
  WHERE q.manifest_id=req.manifest_id AND r.review_role='domain_owner'
   AND r.decision='approved_for_planning';
  IF prior_domain_count<>2 OR NOT EXISTS(
   SELECT 1 FROM ms.cross_module_source_onboarding_reviews
   WHERE request_id=req.id AND review_role='domain_owner'
     AND decision='approved_for_planning')
  THEN RAISE EXCEPTION '财务与教务来源均须先经不同业务负责人通过'
  USING ERRCODE='23514'; END IF;
 END IF;
 INSERT INTO ms.cross_module_source_onboarding_reviews(
  organization_id,request_id,review_role,decision,reviewed_by,
  evidence_ref,reason_zh,request_key)
 VALUES(org,p_request,p_role,p_decision,actor,p_evidence,p_reason,p_key)
 RETURNING id INTO rid;
 RETURN rid;
END $g$;

REVOKE ALL ON FUNCTION
 ms.request_cross_module_source_onboarding(uuid,text,text,text,text,text,text,text,text,text),
 ms.review_cross_module_source_onboarding(uuid,text,text,text,text,text)
 FROM PUBLIC,ms_lowrisk_runtime,ms_scoped_lowrisk_writer,ms_cross_module_plan_reader;
GRANT EXECUTE ON FUNCTION
 ms.request_cross_module_source_onboarding(uuid,text,text,text,text,text,text,text,text,text),
 ms.review_cross_module_source_onboarding(uuid,text,text,text,text,text)
 TO ms_cross_module_plan_writer;

-- This function is READ ONLY and still permanently denies connectivity and
-- economic or academic execution, even after all fictional planning signatures.
CREATE FUNCTION ms.cross_module_source_onboarding_readiness(p_manifest uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,ms AS $g$
DECLARE actor uuid;org uuid;m ms.cross_module_compensation_manifests%ROWTYPE;
 c ms.lead_student_downstream_correction_cases%ROWTYPE;
 domain_count integer;security_count integer;request_count integer;
 has_rejected boolean;latest boolean;fingerprint_ok boolean;
 can_view boolean;underlying jsonb;
BEGIN
 SELECT staff_id,org_id INTO actor,org FROM ms.access_actor();
 IF actor IS NULL THEN RAISE EXCEPTION '没有可验证的本机构员工' USING ERRCODE='42501'; END IF;
 SELECT * INTO m FROM ms.cross_module_compensation_manifests
  WHERE id=p_manifest AND organization_id=org;
 IF NOT FOUND THEN RAISE EXCEPTION '本机构无此来源准备清单' USING ERRCODE='42501'; END IF;
 can_view:=actor=m.created_by OR EXISTS(
  SELECT 1 FROM ms.staff_users s JOIN ms.user_role_grants g ON g.user_id=s.id
  JOIN ms.role_templates t ON t.id=g.role_id
  WHERE s.id=actor AND s.organization_id=org AND s.status='active'
  AND t.organization_id=org AND g.revoked_at IS NULL AND g.valid_from<=now()
  AND t.role_code IN('sales_manager','finance_correction_reviewer',
   'academic_correction_reviewer','source_security_reviewer'));
 IF NOT can_view THEN RAISE EXCEPTION '无权读取该机构来源准备结果'
 USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM ms.lead_student_downstream_correction_cases
  WHERE id=m.case_id AND organization_id=org;
 SELECT count(*) INTO request_count FROM ms.cross_module_source_onboarding_requests
 WHERE manifest_id=m.id;
 SELECT count(*) INTO domain_count FROM ms.cross_module_source_onboarding_reviews r
 JOIN ms.cross_module_source_onboarding_requests q ON q.id=r.request_id
 WHERE q.manifest_id=m.id AND r.review_role='domain_owner' AND r.decision='approved_for_planning';
 SELECT count(*) INTO security_count FROM ms.cross_module_source_onboarding_reviews r
 JOIN ms.cross_module_source_onboarding_requests q ON q.id=r.request_id
 WHERE q.manifest_id=m.id AND r.review_role='security_owner' AND r.decision='approved_for_planning';
 SELECT EXISTS(SELECT 1 FROM ms.cross_module_source_onboarding_reviews r
  JOIN ms.cross_module_source_onboarding_requests q ON q.id=r.request_id
  WHERE q.manifest_id=m.id AND r.decision<>'approved_for_planning') INTO has_rejected;
 SELECT m.plan_version=max(p.version_no) INTO latest FROM ms.cross_module_correction_plans p
 WHERE p.case_id=m.case_id;
 fingerprint_ok:=c.status='hold_active' AND
  ms.cross_module_local_correction_fingerprint(c.lead_id,c.student_id)=m.local_fingerprint;
 RETURN jsonb_build_object(
  'planning_requests',request_count,'domain_planning_approvals',domain_count,
  'independent_security_planning_approvals',security_count,
  'any_rejection_or_revision',has_rejected,
  'local_scope_current',fingerprint_ok,'latest_plan',COALESCE(latest,false),
  'planning_paperwork_complete',request_count=2 AND domain_count=2 AND
    security_count=2 AND NOT has_rejected AND fingerprint_ok AND COALESCE(latest,false),
  'official_source_registered',false,'official_credentials_installed',false,
  'production_readonly_connection_allowed',false,
  'finance_source_authenticated',false,'crm_source_authenticated',false,
  'execution_allowed',false,'release_allowed',false,
  'state_zh','只完成虚构来源准入审批准备，真实只读接口与纠错执行均不开放',
  'blockers_zh',jsonb_build_array(
   '没有真实财务及 CRM 来源身份、机构映射与审批确认',
   '没有独立安全团队批准的生产密钥保管及撤销机制',
   '尚无真实来源水位、持久防重放和失效恢复验收',
   '禁止实际收付款、课时、订单修改和解除隔离'));
END $g$;
REVOKE ALL ON FUNCTION ms.cross_module_source_onboarding_readiness(uuid)
 FROM PUBLIC,ms_lowrisk_runtime,ms_scoped_lowrisk_writer;
GRANT EXECUTE ON FUNCTION ms.cross_module_source_onboarding_readiness(uuid)
 TO ms_cross_module_plan_reader;
-- No production source registration or credential ingestion exists here.
COMMIT;
