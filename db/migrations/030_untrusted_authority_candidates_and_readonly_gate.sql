-- V3.2-27: external finance/CRM READ-ONLY RESPONSE CANDIDATE contract.
-- A well-formed candidate is NEVER authenticated authority, never an execution
-- receipt, and never permission to change money, an order, CRM or a hold.
-- Apply after 001..029 only in disposable fictional PostgreSQL16.
BEGIN;

CREATE TABLE ms.cross_module_untrusted_source_candidates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES ms.organizations(id),
 manifest_id uuid NOT NULL REFERENCES ms.cross_module_compensation_manifests(id),
 scope_id uuid NOT NULL REFERENCES ms.cross_module_compensation_scope(id),
 department text NOT NULL CHECK(department IN('finance','academic')),
 source_kind text NOT NULL CHECK(source_kind IN(
  'finance_receipt','finance_allocation','finance_refund','finance_dispute',
  'crm_entitlement','crm_attendance','crm_schedule')),
 source_system text NOT NULL CHECK(source_system ~ '^[a-z][a-z0-9_-]{2,63}$'),
 source_tenant text NOT NULL CHECK(source_tenant ~ '^[A-Za-z0-9_-]{2,80}$'),
 source_object_ref text NOT NULL CHECK(source_object_ref ~ '^[A-Za-z0-9_:\.\/-]{6,160}$'),
 source_revision text NOT NULL CHECK(source_revision ~ '^[A-Za-z0-9_:\.\/-]{2,120}$'),
 candidate_sha256 text NOT NULL CHECK(candidate_sha256 ~ '^[a-f0-9]{64}$'),
 reported_status text NOT NULL CHECK(reported_status IN(
  'source_not_connected','unverified_response','result_unknown','disputed')),
 observed_at timestamptz NOT NULL,
 received_by uuid NOT NULL REFERENCES ms.staff_users(id),
 request_key text NOT NULL CHECK(request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
 recorded_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(received_by,request_key),
 UNIQUE(manifest_id,department,source_system,source_tenant,
        source_object_ref,source_revision)
);
CREATE INDEX ix_cross_module_candidate_manifest
 ON ms.cross_module_untrusted_source_candidates(manifest_id,department);
ALTER TABLE ms.cross_module_untrusted_source_candidates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ms.cross_module_untrusted_source_candidates
 FROM PUBLIC,ms_lowrisk_runtime,ms_scoped_lowrisk_writer,
 ms_cross_module_plan_writer,ms_cross_module_plan_reader;
CREATE TRIGGER immutable_untrusted_source_candidate BEFORE UPDATE OR DELETE
 ON ms.cross_module_untrusted_source_candidates
 FOR EACH ROW EXECUTE FUNCTION ms.reject_access_history_mutation();

-- Client-supplied source identifiers and a digest are *claims*, never trusted
-- service signatures or proof of settlement, enrollment or lesson completion.
CREATE FUNCTION ms.record_cross_module_untrusted_source_candidate(
 p_manifest uuid,p_scope uuid,p_department text,p_kind text,
 p_source_system text,p_source_tenant text,p_source_ref text,
 p_source_revision text,p_sha256 text,p_reported_status text,
 p_observed_at timestamptz,p_key text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ms AS $f$
DECLARE actor uuid;org uuid;m ms.cross_module_compensation_manifests%ROWTYPE;
 c ms.lead_student_downstream_correction_cases%ROWTYPE;
 sc ms.cross_module_compensation_scope%ROWTYPE;
 old ms.cross_module_untrusted_source_candidates%ROWTYPE;rid uuid;
BEGIN
 SELECT staff_id,org_id INTO actor,org FROM ms.access_actor();
 IF actor IS NULL THEN RAISE EXCEPTION '没有可信的本机构员工身份' USING ERRCODE='42501'; END IF;
 IF p_manifest IS NULL OR p_scope IS NULL
  OR p_department NOT IN('finance','academic')
  OR p_kind NOT IN('finance_receipt','finance_allocation','finance_refund',
       'finance_dispute','crm_entitlement','crm_attendance','crm_schedule')
  OR (p_department='finance' AND p_kind NOT LIKE 'finance_%')
  OR (p_department='academic' AND p_kind NOT LIKE 'crm_%')
  OR p_source_system IS NULL OR p_source_system !~ '^[a-z][a-z0-9_-]{2,63}$'
  OR p_source_tenant IS NULL OR p_source_tenant !~ '^[A-Za-z0-9_-]{2,80}$'
  OR p_source_ref IS NULL OR p_source_ref !~ '^[A-Za-z0-9_:\.\/-]{6,160}$'
  OR p_source_revision IS NULL OR p_source_revision !~ '^[A-Za-z0-9_:\.\/-]{2,120}$'
  OR p_sha256 IS NULL OR p_sha256 !~ '^[a-f0-9]{64}$'
  OR p_reported_status NOT IN(
       'source_not_connected','unverified_response','result_unknown','disputed')
  OR p_observed_at IS NULL OR p_observed_at>now()+interval '5 minutes'
  OR p_observed_at<now()-interval '365 days'
  OR p_key IS NULL OR p_key !~ '^[A-Za-z0-9_-]{16,128}$'
 THEN RAISE EXCEPTION '只接受合法格式的未验证财务或 CRM 候选记录'
 USING ERRCODE='23514'; END IF;
 PERFORM ms.assert_cross_module_department_authority(actor,org,p_department);
 SELECT * INTO m FROM ms.cross_module_compensation_manifests
 WHERE id=p_manifest AND organization_id=org;
 IF NOT FOUND THEN RAISE EXCEPTION '没有本机构该补偿清单' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM ms.lead_student_downstream_correction_cases
 WHERE id=m.case_id AND organization_id=org FOR UPDATE;
 IF NOT FOUND OR c.status<>'hold_active' OR actor=m.created_by
 THEN RAISE EXCEPTION '当前隔离状态或人员独立性不满足' USING ERRCODE='42501'; END IF;
 SELECT * INTO old FROM ms.cross_module_untrusted_source_candidates
 WHERE received_by=actor AND request_key=p_key;
 IF FOUND THEN
  IF old.manifest_id=p_manifest AND old.scope_id=p_scope
   AND old.department=p_department AND old.source_kind=p_kind
   AND old.source_system=p_source_system AND old.source_tenant=p_source_tenant
   AND old.source_object_ref=p_source_ref
   AND old.source_revision=p_source_revision AND old.candidate_sha256=p_sha256
   AND old.reported_status=p_reported_status
   AND old.observed_at=p_observed_at THEN RETURN old.id; END IF;
  RAISE EXCEPTION '来源记录防重复编号已用于不同内容' USING ERRCODE='23505';
 END IF;
 PERFORM ms.assert_current_three_party_correction_plan(m.plan_id,org,c.id);
 IF NOT EXISTS(SELECT 1 FROM ms.cross_module_compensation_seals z
    WHERE z.manifest_id=m.id) OR
    ms.cross_module_local_correction_fingerprint(c.lead_id,c.student_id)<>m.local_fingerprint
 THEN RAISE EXCEPTION '清单未封存或本地关联事实已变化，拒绝使用旧方案'
 USING ERRCODE='23514'; END IF;
 SELECT * INTO sc FROM ms.cross_module_compensation_scope
 WHERE id=p_scope AND manifest_id=m.id AND organization_id=org
   AND department=p_department;
 IF NOT FOUND THEN RAISE EXCEPTION '候选来源不属于本机构对应部门的清查对象'
 USING ERRCODE='42501'; END IF;
 IF (p_kind='finance_allocation' AND sc.record_type NOT IN(
    'payment_allocation','payment_receipt','no_linked_record'))
 OR (p_kind='finance_receipt' AND sc.record_type NOT IN(
    'payment_receipt','payment_allocation','no_linked_record'))
 OR (p_kind='finance_refund' AND sc.record_type NOT IN(
    'refund_allocation','refund_projection','no_linked_record'))
 OR (p_kind='finance_dispute' AND sc.record_type NOT IN(
    'finance_economic_event','payment_receipt','no_linked_record'))
 OR (p_kind='crm_entitlement' AND sc.record_type NOT IN(
    'entitlement_link','no_linked_record'))
 OR (p_kind IN('crm_attendance','crm_schedule') AND sc.record_type NOT IN(
    'trial_booking','trial_feedback','entitlement_link','no_linked_record'))
 THEN RAISE EXCEPTION '外部候选类别与本地待核对象不一致'
 USING ERRCODE='23514'; END IF;
 -- Do not treat SHA-256, purported source revision, or manual reference as proof.
 INSERT INTO ms.cross_module_untrusted_source_candidates(
  organization_id,manifest_id,scope_id,department,source_kind,
  source_system,source_tenant,source_object_ref,source_revision,
  candidate_sha256,reported_status,observed_at,received_by,request_key)
 VALUES(org,m.id,sc.id,p_department,p_kind,
  p_source_system,p_source_tenant,p_source_ref,p_source_revision,
  p_sha256,p_reported_status,p_observed_at,actor,p_key)
 RETURNING id INTO rid;
 INSERT INTO ms.audit_events(organization_id,actor_user_id,target_type,target_id,
   event_name,reason_zh,after_business_json)
 VALUES(org,actor,'lead',c.lead_id,'UNTRUSTED_EXTERNAL_CANDIDATE_RECORDED',
  '仅登记了格式合格的外部来源候选；其真实性、资金或课时结果均未验证',
  jsonb_build_object('部门',CASE p_department WHEN 'finance' THEN '财务' ELSE '教务' END,
   '结论','来源候选未认证','是否允许实际纠错','否'));
 RETURN rid;
END $f$;

REVOKE ALL ON FUNCTION ms.record_cross_module_untrusted_source_candidate(
 uuid,uuid,text,text,text,text,text,text,text,text,timestamptz,text)
 FROM PUBLIC,ms_lowrisk_runtime,ms_scoped_lowrisk_writer,ms_cross_module_plan_reader;
GRANT EXECUTE ON FUNCTION ms.record_cross_module_untrusted_source_candidate(
 uuid,uuid,text,text,text,text,text,text,text,text,timestamptz,text)
 TO ms_cross_module_plan_writer;

-- Every answer is an explicit denial. Missing proof stays UNKNOWN, not false
-- evidence of no payment/lesson. Immutable blocked 029 preflight is unaffected.
CREATE FUNCTION ms.cross_module_readonly_authority_gate(p_manifest uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,ms AS $f$
DECLARE actor uuid;org uuid;m ms.cross_module_compensation_manifests%ROWTYPE;
 c ms.lead_student_downstream_correction_cases%ROWTYPE;
 approved_count int;latest int;scope_count int;item_count int;
 sealed boolean;finance_note boolean;academic_note boolean;
 local_current boolean;candidate_count int;authorized boolean;
 gate_reasons text[]:=ARRAY[]::text[];
BEGIN
 SELECT staff_id,org_id INTO actor,org FROM ms.access_actor();
 IF actor IS NULL THEN RAISE EXCEPTION '未授权访问跨部门隔离预审' USING ERRCODE='42501'; END IF;
 SELECT * INTO m FROM ms.cross_module_compensation_manifests
 WHERE id=p_manifest AND organization_id=org;
 IF NOT FOUND THEN RAISE EXCEPTION '本机构无此预审清单' USING ERRCODE='42501'; END IF;
 authorized:=(m.created_by=actor OR EXISTS(
  SELECT 1 FROM ms.user_role_grants g JOIN ms.role_templates t ON t.id=g.role_id
  WHERE g.user_id=actor AND t.organization_id=org AND g.revoked_at IS NULL
   AND g.valid_from<=now() AND t.role_code IN(
     'sales_manager','finance_correction_reviewer','academic_correction_reviewer')));
 IF NOT authorized THEN RAISE EXCEPTION '没有该清单的最小只读权限'
 USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM ms.lead_student_downstream_correction_cases
 WHERE id=m.case_id AND organization_id=org;
 SELECT count(*) INTO approved_count FROM ms.cross_module_correction_signoffs s
 WHERE s.plan_id=m.plan_id AND s.decision='approved';
 SELECT max(p.version_no) INTO latest FROM ms.cross_module_correction_plans p
 WHERE p.case_id=m.case_id;
 SELECT count(*) INTO scope_count FROM ms.cross_module_compensation_scope s
 WHERE s.manifest_id=m.id;
 SELECT count(*) INTO item_count FROM ms.cross_module_compensation_items i
 WHERE i.manifest_id=m.id;
 SELECT EXISTS(SELECT 1 FROM ms.cross_module_compensation_seals s
  WHERE s.manifest_id=m.id) INTO sealed;
 SELECT EXISTS(SELECT 1 FROM ms.cross_module_external_evidence_notes n
  WHERE n.manifest_id=m.id AND n.department='finance') INTO finance_note;
 SELECT EXISTS(SELECT 1 FROM ms.cross_module_external_evidence_notes n
  WHERE n.manifest_id=m.id AND n.department='academic') INTO academic_note;
 SELECT count(*) INTO candidate_count FROM ms.cross_module_untrusted_source_candidates k
 WHERE k.manifest_id=m.id;
 local_current:=(c.status='hold_active' AND
    ms.cross_module_local_correction_fingerprint(c.lead_id,c.student_id)=m.local_fingerprint);
 IF c.status<>'hold_active' THEN gate_reasons:=array_append(gate_reasons,'原隔离状态不再匹配'); END IF;
 IF latest<>m.plan_version THEN gate_reasons:=array_append(gate_reasons,'方案已有新版本，旧版本不再有效'); END IF;
 IF approved_count<>3 THEN gate_reasons:=array_append(gate_reasons,'三方审批未齐备'); END IF;
 IF NOT sealed THEN gate_reasons:=array_append(gate_reasons,'补偿清单尚未封存'); END IF;
 IF item_count<>scope_count THEN gate_reasons:=array_append(gate_reasons,'未逐项覆盖全部本地业务对象'); END IF;
 IF NOT finance_note THEN gate_reasons:=array_append(gate_reasons,'财务人工参考尚未登记'); END IF;
 IF NOT academic_note THEN gate_reasons:=array_append(gate_reasons,'教务人工参考尚未登记'); END IF;
 IF NOT local_current THEN gate_reasons:=array_append(gate_reasons,'本地业务事实或来源版本已经变化'); END IF;
 gate_reasons:=array_append(gate_reasons,'财务权威签名、完整账务核对与真实执行结果尚未验证');
 gate_reasons:=array_append(gate_reasons,'CRM 权威身份、已上课程及剩余权益回执尚未验证');
 gate_reasons:=array_append(gate_reasons,'本期没有正式执行授权、补偿执行及解除隔离功能');
 RETURN jsonb_build_object(
   'manifest_id',m.id,
   'status','blocked_external_authority',
   'source_candidates_untrusted',candidate_count,
   'local_scope_count',scope_count,'proposed_item_count',item_count,
   'local_snapshot_current',local_current,
   'three_party_plan_approved',approved_count=3 AND latest=m.plan_version,
   'finance_source_authenticated',false,
   'academic_source_authenticated',false,
   'execution_allowed',false,'release_allowed',false,
   'blockers_zh',to_jsonb(gate_reasons));
END $f$;

REVOKE ALL ON FUNCTION ms.cross_module_readonly_authority_gate(uuid)
 FROM PUBLIC,ms_lowrisk_runtime,ms_scoped_lowrisk_writer;
GRANT EXECUTE ON FUNCTION ms.cross_module_readonly_authority_gate(uuid)
 TO ms_cross_module_plan_reader;

CREATE VIEW ms.scoped_cross_module_authority_candidate_counts
WITH (security_barrier=true) AS
SELECT m.id AS manifest_id,m.case_id,
 (SELECT count(*)::integer FROM ms.cross_module_untrusted_source_candidates k
  WHERE k.manifest_id=m.id AND k.department='finance') AS finance_unverified_candidates,
 (SELECT count(*)::integer FROM ms.cross_module_untrusted_source_candidates k
  WHERE k.manifest_id=m.id AND k.department='academic') AS academic_unverified_candidates,
 FALSE AS finance_authenticated,FALSE AS academic_authenticated,
 FALSE AS execution_allowed,FALSE AS release_allowed
FROM ms.cross_module_compensation_manifests m
WHERE m.organization_id=ms.current_scoped_organization_id()
 AND ms.current_scoped_staff_id() IS NOT NULL
 AND (m.created_by=ms.current_scoped_staff_id() OR EXISTS(
  SELECT 1 FROM ms.user_role_grants g JOIN ms.role_templates t ON t.id=g.role_id
  WHERE g.user_id=ms.current_scoped_staff_id() AND t.organization_id=m.organization_id
    AND g.revoked_at IS NULL AND g.valid_from<=now() AND
    t.role_code IN('sales_manager','finance_correction_reviewer','academic_correction_reviewer')));
REVOKE ALL ON ms.scoped_cross_module_authority_candidate_counts FROM PUBLIC;
GRANT SELECT ON ms.scoped_cross_module_authority_candidate_counts TO ms_cross_module_plan_reader;
-- DELIBERATELY NO authenticated-source ingestion, compensation executor, or release.
COMMIT;
