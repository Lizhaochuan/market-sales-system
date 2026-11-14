-- V3.2-25: restricted three-party correction PLAN approvals only.
-- NOT an order correction, finance adjustment, CRM fulfilment or release command.
-- Disposable fictional PostgreSQL 16; apply strictly after 001..027.
BEGIN;

CREATE ROLE ms_cross_module_plan_writer NOLOGIN;
CREATE ROLE ms_cross_module_plan_reader NOLOGIN;
GRANT USAGE ON SCHEMA ms TO ms_cross_module_plan_writer,ms_cross_module_plan_reader;

CREATE TABLE ms.cross_module_correction_plans(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES ms.organizations(id),
 case_id uuid NOT NULL REFERENCES ms.lead_student_downstream_correction_cases(id),
 version_no integer NOT NULL CHECK(version_no>0),
 original_student_id uuid NOT NULL REFERENCES ms.students(id),
 target_student_id uuid NOT NULL REFERENCES ms.students(id),
 proposed_by uuid NOT NULL REFERENCES ms.staff_users(id),
 student_evidence_ref text NOT NULL CHECK(length(trim(student_evidence_ref)) BETWEEN 2 AND 200),
 sales_scope_ref text NOT NULL CHECK(length(trim(sales_scope_ref)) BETWEEN 2 AND 200),
 finance_scope_ref text NOT NULL CHECK(length(trim(finance_scope_ref)) BETWEEN 2 AND 200),
 academic_scope_ref text NOT NULL CHECK(length(trim(academic_scope_ref)) BETWEEN 2 AND 200),
 reason_zh text NOT NULL CHECK(length(trim(reason_zh)) BETWEEN 2 AND 400),
 request_key text NOT NULL CHECK(request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
 impact_snapshot jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT cross_module_distinct_students CHECK(original_student_id<>target_student_id),
 UNIQUE(case_id,version_no),
 UNIQUE(proposed_by,request_key)
);

CREATE TABLE ms.cross_module_correction_signoffs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES ms.organizations(id),
 plan_id uuid NOT NULL REFERENCES ms.cross_module_correction_plans(id),
 plan_version integer NOT NULL CHECK(plan_version>0),
 department text NOT NULL CHECK(department IN('sales','finance','academic')),
 decision text NOT NULL CHECK(decision IN('approved','rejected','return_for_revision')),
 signed_by uuid NOT NULL REFERENCES ms.staff_users(id),
 evidence_ref text NOT NULL CHECK(length(trim(evidence_ref)) BETWEEN 2 AND 200),
 reason_zh text NOT NULL CHECK(length(trim(reason_zh)) BETWEEN 2 AND 400),
 request_key text NOT NULL CHECK(request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
 signed_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(plan_id,department),
 UNIQUE(signed_by,request_key),
 UNIQUE(plan_id,signed_by)
);
CREATE INDEX ix_cross_module_plans_case_version ON ms.cross_module_correction_plans(case_id,version_no DESC);
CREATE INDEX ix_cross_module_signoffs_plan ON ms.cross_module_correction_signoffs(plan_id);

ALTER TABLE ms.cross_module_correction_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE ms.cross_module_correction_signoffs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ms.cross_module_correction_plans,ms.cross_module_correction_signoffs
 FROM PUBLIC,ms_lowrisk_runtime,ms_scoped_lowrisk_writer;
CREATE TRIGGER immutable_cross_module_correction_plans
 BEFORE UPDATE OR DELETE ON ms.cross_module_correction_plans
 FOR EACH ROW EXECUTE FUNCTION ms.reject_access_history_mutation();
CREATE TRIGGER immutable_cross_module_correction_signoffs
 BEFORE UPDATE OR DELETE ON ms.cross_module_correction_signoffs
 FOR EACH ROW EXECUTE FUNCTION ms.reject_access_history_mutation();

-- No client-supplied actor, institution or authority. Department signers
-- must have an active, organization-local role (never broad super_admin).
CREATE FUNCTION ms.assert_cross_module_department_authority(
 p_actor uuid,p_org uuid,p_department text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ms AS $f$
DECLARE required_role text;
BEGIN
 required_role:=CASE p_department
  WHEN 'sales' THEN 'sales_manager'
  WHEN 'finance' THEN 'finance_correction_reviewer'
  WHEN 'academic' THEN 'academic_correction_reviewer'
  ELSE NULL END;
 IF required_role IS NULL OR p_actor IS NULL OR NOT EXISTS(
  SELECT 1 FROM ms.staff_users s
  JOIN ms.user_role_grants g ON g.user_id=s.id
  JOIN ms.role_templates t ON t.id=g.role_id
  WHERE s.id=p_actor AND s.organization_id=p_org AND s.status='active'
   AND t.organization_id=p_org AND t.role_code=required_role
   AND g.revoked_at IS NULL AND g.valid_from<=now()
 ) THEN RAISE EXCEPTION '当前员工无本机构该部门纠错审批权'
 USING ERRCODE='42501'; END IF;
END $f$;
REVOKE ALL ON FUNCTION ms.assert_cross_module_department_authority(uuid,uuid,text)
 FROM PUBLIC,ms_lowrisk_runtime,ms_scoped_lowrisk_writer;

-- Only original applicant may propose a corrected target student. This is
-- evidence of a suggested plan, NOT authority to change any business row.
CREATE FUNCTION ms.propose_cross_module_student_correction(
 p_case uuid,p_target_student uuid,p_student_evidence text,
 p_sales_scope text,p_finance_scope text,p_academic_scope text,
 p_reason text,p_key text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ms AS $f$
DECLARE actor uuid;org uuid;c ms.lead_student_downstream_correction_cases%ROWTYPE;
 old_plan ms.cross_module_correction_plans%ROWTYPE;
 new_id uuid;next_version integer;snapshot jsonb;
BEGIN
 SELECT staff_id,org_id INTO actor,org FROM ms.access_actor();
 IF actor IS NULL THEN RAISE EXCEPTION '提交员工身份无效' USING ERRCODE='42501'; END IF;
 IF p_case IS NULL OR p_target_student IS NULL OR
  p_key IS NULL OR p_key !~ '^[A-Za-z0-9_-]{16,128}$' OR
  p_student_evidence IS NULL OR length(trim(p_student_evidence)) NOT BETWEEN 2 AND 200 OR
  p_sales_scope IS NULL OR length(trim(p_sales_scope)) NOT BETWEEN 2 AND 200 OR
  p_finance_scope IS NULL OR length(trim(p_finance_scope)) NOT BETWEEN 2 AND 200 OR
  p_academic_scope IS NULL OR length(trim(p_academic_scope)) NOT BETWEEN 2 AND 200 OR
  p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 2 AND 400
 THEN RAISE EXCEPTION '三方纠错方案资料不完整' USING ERRCODE='23514'; END IF;
 SELECT * INTO c FROM ms.lead_student_downstream_correction_cases
 WHERE id=p_case AND organization_id=org FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '本机构无此隔离案件' USING ERRCODE='42501'; END IF;
 IF c.status<>'hold_active' OR c.requested_by<>actor OR NOT EXISTS(
   SELECT 1 FROM ms.leads l WHERE l.id=c.lead_id
     AND l.organization_id=org AND l.owner_user_id=actor)
 THEN RAISE EXCEPTION '只有原申请人可对有效隔离案件提出新方案'
 USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(
  SELECT 1 FROM ms.downstream_student_reconciliation_findings f
  JOIN ms.downstream_student_reconciliation_resolutions r
   ON r.finding_id=f.id AND r.case_id=c.id
  WHERE f.case_id=c.id AND f.organization_id=org
    AND f.finding='wrong_student_confirmed' AND r.resolution='escalate_manual'
 ) THEN RAISE EXCEPTION '错误关联尚未经双主管确认并转跨部门处理'
 USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM ms.students s
  WHERE s.id=p_target_student AND s.organization_id=org AND s.archived_at IS NULL)
 OR p_target_student=c.student_id
 THEN RAISE EXCEPTION '正确学生候选必须是本机构另一名有效学生'
 USING ERRCODE='23514'; END IF;
 SELECT * INTO old_plan FROM ms.cross_module_correction_plans
 WHERE proposed_by=actor AND request_key=p_key;
 IF FOUND THEN
  IF old_plan.case_id=p_case AND old_plan.target_student_id=p_target_student
   AND old_plan.student_evidence_ref=p_student_evidence
   AND old_plan.sales_scope_ref=p_sales_scope
   AND old_plan.finance_scope_ref=p_finance_scope
   AND old_plan.academic_scope_ref=p_academic_scope
   AND old_plan.reason_zh=p_reason
  THEN RETURN old_plan.id; END IF;
  RAISE EXCEPTION '操作编号已用于另一份纠错方案' USING ERRCODE='23505';
 END IF;
 SELECT COALESCE(max(version_no),0)+1 INTO next_version
 FROM ms.cross_module_correction_plans WHERE case_id=c.id;
 snapshot:=ms.student_downstream_impact_counts(c.lead_id,c.student_id);
 INSERT INTO ms.cross_module_correction_plans(
  organization_id,case_id,version_no,original_student_id,target_student_id,
  proposed_by,student_evidence_ref,sales_scope_ref,finance_scope_ref,
  academic_scope_ref,reason_zh,request_key,impact_snapshot)
 VALUES(org,c.id,next_version,c.student_id,p_target_student,actor,p_student_evidence,
  p_sales_scope,p_finance_scope,p_academic_scope,p_reason,p_key,snapshot)
 RETURNING id INTO new_id;
 INSERT INTO ms.audit_events(organization_id,actor_user_id,target_type,target_id,
  event_name,reason_zh,after_business_json)
 VALUES(org,actor,'lead',c.lead_id,'CROSS_MODULE_CORRECTION_PLAN_PROPOSED',
  '错误学生关联已提交新版本三方审核方案；原订单、收款和课时未改变',
  jsonb_build_object('方案版本',next_version,
   '当前阶段','仅提交审核，继续隔离','业务记录修改','无'));
 RETURN new_id;
END $f$;

-- Immutable one decision per department per plan version. A rejected/returned
-- version is not editable; new material requires a new version and three new
-- independent reviews. Approval cannot execute or release anything.
CREATE FUNCTION ms.sign_cross_module_student_correction(
 p_plan uuid,p_department text,p_decision text,
 p_evidence text,p_reason text,p_key text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ms AS $f$
DECLARE actor uuid;org uuid;p ms.cross_module_correction_plans%ROWTYPE;
 c ms.lead_student_downstream_correction_cases%ROWTYPE;
 old_sign ms.cross_module_correction_signoffs%ROWTYPE;
 newest integer;new_id uuid;
BEGIN
 SELECT staff_id,org_id INTO actor,org FROM ms.access_actor();
 IF actor IS NULL THEN RAISE EXCEPTION '审批员工身份无效' USING ERRCODE='42501'; END IF;
 IF p_plan IS NULL OR p_department NOT IN('sales','finance','academic')
 OR p_decision NOT IN('approved','rejected','return_for_revision')
 OR p_key IS NULL OR p_key !~ '^[A-Za-z0-9_-]{16,128}$'
 OR p_evidence IS NULL OR length(trim(p_evidence)) NOT BETWEEN 2 AND 200
 OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 2 AND 400
 THEN RAISE EXCEPTION '三方审批材料不完整' USING ERRCODE='23514'; END IF;
 PERFORM ms.assert_cross_module_department_authority(actor,org,p_department);
 -- A stable case lock serializes approval with revision creation.
 SELECT * INTO p FROM ms.cross_module_correction_plans
 WHERE id=p_plan AND organization_id=org;
 IF NOT FOUND THEN RAISE EXCEPTION '本机构无此纠错方案' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM ms.lead_student_downstream_correction_cases
 WHERE id=p.case_id AND organization_id=org FOR UPDATE;
 IF NOT FOUND OR c.status<>'hold_active' THEN
  RAISE EXCEPTION '只有继续隔离中的方案可进行审核' USING ERRCODE='23514'; END IF;
 IF actor=c.requested_by OR actor=p.proposed_by THEN
  RAISE EXCEPTION '方案申请人不能审核自己的纠错方案'
  USING ERRCODE='42501'; END IF;
 SELECT * INTO old_sign FROM ms.cross_module_correction_signoffs
 WHERE signed_by=actor AND request_key=p_key;
 IF FOUND THEN
  IF old_sign.plan_id=p_plan AND old_sign.department=p_department
   AND old_sign.decision=p_decision AND old_sign.evidence_ref=p_evidence
   AND old_sign.reason_zh=p_reason
  THEN RETURN old_sign.id; END IF;
  RAISE EXCEPTION '审批编号已用于不同审核内容' USING ERRCODE='23505';
 END IF;
 SELECT max(version_no) INTO newest FROM ms.cross_module_correction_plans
 WHERE case_id=c.id;
 IF p.version_no<>newest THEN
  RAISE EXCEPTION '方案已更新，旧版三方审核无效'
  USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM ms.cross_module_correction_signoffs s
  WHERE s.plan_id=p.id AND s.decision<>'approved')
 THEN RAISE EXCEPTION '当前方案已驳回或要求补充材料，请提交新版本'
 USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM ms.cross_module_correction_signoffs s
  WHERE s.plan_id=p.id AND (s.department=p_department OR s.signed_by=actor))
 THEN RAISE EXCEPTION '同一方案部门只能签署一次且同一人不得代签两个部门'
 USING ERRCODE='23505'; END IF;
 INSERT INTO ms.cross_module_correction_signoffs(
  organization_id,plan_id,plan_version,department,decision,signed_by,
  evidence_ref,reason_zh,request_key)
 VALUES(org,p.id,p.version_no,p_department,p_decision,actor,
  p_evidence,p_reason,p_key)
 RETURNING id INTO new_id;
 INSERT INTO ms.audit_events(organization_id,actor_user_id,target_type,target_id,
  event_name,reason_zh,after_business_json)
 VALUES(org,actor,'lead',c.lead_id,'CROSS_MODULE_CORRECTION_DEPARTMENT_SIGNED',
  '独立部门已记录方案审核；不代表订单、收款或教务权益已执行',
  jsonb_build_object('部门',CASE p_department WHEN 'sales' THEN '销售'
   WHEN 'finance' THEN '财务' ELSE '教务' END,
   '审核结果',CASE p_decision WHEN 'approved' THEN '同意方案（尚未执行）'
    WHEN 'rejected' THEN '驳回方案' ELSE '退回补充材料' END,
   '方案版本',p.version_no,'销售隔离','继续保持'));
 RETURN new_id;
END $f$;

REVOKE ALL ON FUNCTION
 ms.propose_cross_module_student_correction(uuid,uuid,text,text,text,text,text,text),
 ms.sign_cross_module_student_correction(uuid,text,text,text,text,text)
 FROM PUBLIC,ms_lowrisk_runtime,ms_scoped_lowrisk_writer;
GRANT EXECUTE ON FUNCTION
 ms.propose_cross_module_student_correction(uuid,uuid,text,text,text,text,text,text),
 ms.sign_cross_module_student_correction(uuid,text,text,text,text,text)
 TO ms_cross_module_plan_writer;

-- Deliberately expose counts and labels only: never raw evidence, bank amounts,
-- child contacts, full order rows, authentication IDs or finance projections.
CREATE VIEW ms.scoped_cross_module_correction_plans
WITH (security_barrier=true) AS
SELECT p.id AS plan_id,p.case_id,p.version_no,p.proposed_by,p.created_at,
 c.status AS case_status,
 (p.version_no=(SELECT max(q.version_no) FROM ms.cross_module_correction_plans q
   WHERE q.case_id=p.case_id)) AS is_latest,
 (SELECT count(*)::integer FROM ms.cross_module_correction_signoffs s
   WHERE s.plan_id=p.id AND s.decision='approved') AS approved_department_count,
 EXISTS(SELECT 1 FROM ms.cross_module_correction_signoffs s
   WHERE s.plan_id=p.id AND s.decision<>'approved') AS has_rejection_or_return,
 (p.version_no=(SELECT max(q.version_no) FROM ms.cross_module_correction_plans q
   WHERE q.case_id=p.case_id)
  AND (SELECT count(*) FROM ms.cross_module_correction_signoffs s
       WHERE s.plan_id=p.id AND s.decision='approved')=3) AS three_party_plan_approved
FROM ms.cross_module_correction_plans p
JOIN ms.lead_student_downstream_correction_cases c ON c.id=p.case_id
WHERE p.organization_id=ms.current_scoped_organization_id()
 AND ms.current_scoped_staff_id() IS NOT NULL
 AND (p.proposed_by=ms.current_scoped_staff_id()
  OR EXISTS(
   SELECT 1 FROM ms.user_role_grants g
   JOIN ms.role_templates t ON t.id=g.role_id
   WHERE g.user_id=ms.current_scoped_staff_id()
    AND t.organization_id=p.organization_id
    AND t.role_code IN('sales_manager',
       'finance_correction_reviewer','academic_correction_reviewer')
    AND g.revoked_at IS NULL AND g.valid_from<=now())
  OR EXISTS(SELECT 1 FROM ms.cross_module_correction_signoffs s
    WHERE s.plan_id=p.id AND s.signed_by=ms.current_scoped_staff_id()));
REVOKE ALL ON ms.scoped_cross_module_correction_plans FROM PUBLIC;
GRANT SELECT ON ms.scoped_cross_module_correction_plans
 TO ms_cross_module_plan_reader;

-- There is NO execute, compensate, reassign, financial adjust, CRM write or
-- hold-release function. V3.2-23 safe release preconditions are untouched.
COMMIT;
