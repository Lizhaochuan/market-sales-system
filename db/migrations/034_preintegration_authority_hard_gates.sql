-- V3.2-31: pre-integration HARD GATES, not production approval.
-- This is a fictional, append-only registry for evidence that remains missing.
-- No function in this migration can authenticate real sources or release holds.
BEGIN;
CREATE ROLE ms_integration_gap_writer NOLOGIN;
CREATE ROLE ms_integration_gap_reader NOLOGIN;
GRANT USAGE ON SCHEMA ms TO ms_integration_gap_writer,ms_integration_gap_reader;
GRANT EXECUTE ON FUNCTION ms.current_scoped_staff_id(),
 ms.current_scoped_organization_id() TO ms_integration_gap_reader;

CREATE TABLE ms.integration_required_checks(
 check_code text PRIMARY KEY,
 department text NOT NULL CHECK(department IN('sales','finance','academic','security')),
 label_zh text NOT NULL,
 required_evidence_zh text NOT NULL,
 production_verified boolean NOT NULL DEFAULT false CHECK(NOT production_verified)
);
INSERT INTO ms.integration_required_checks(check_code,department,label_zh,required_evidence_zh)
VALUES
 ('sales_contract_party','sales','合同与学生实际签约主体','合法合同签约方、正确学生单独确权和调整依据'),
 ('sales_attribution_policy','sales','销售业绩和历史调整政策','旧订单及成交历史只追加补偿口径、佣金审核'),
 ('sales_release_responsibility','sales','跨模块验收和解除隔离责任','销售财务教务独立终验与 R01—R10 证据'),
 ('finance_authority_owner','finance','资金唯一权威来源','真实财务系统责任人及账套授权'),
 ('finance_tenant_order_mapping','finance','机构账套与订单款项用途','机构、收款、退款、拒付与订单用途明确映射'),
 ('finance_readonly_credentials','finance','最小只读接口授权','由财务正式签发并可撤销的服务访问范围'),
 ('finance_reconciliation','finance','金额守恒和退款对账','来源完整版本水位、经济事件去重和余额守恒'),
 ('academic_authority_owner','academic','CRM 权威责任人与权限','真实教务/CRM 系统所有人授权'),
 ('academic_tenant_student_mapping','academic','CRM 学生及课包唯一映射','机构 tenant、正确学生 ID 和 package_id 明确匹配'),
 ('academic_readonly_credentials','academic','教务最小只读接口授权','独立服务身份，不含发课/改课/消课写权限'),
 ('academic_attendance_balance','academic','实上和剩余课时权威核对','已授课程留痕、权益余额、unknown 结果及课程版本'),
 ('security_source_trust','security','权威来源身份与签名信任','独立信任锚、受众、签发者、密钥轮换及撤销'),
 ('security_durable_replay','security','持久可靠的幂等和防重放','事务性持久账本、多副本和灾备恢复'),
 ('security_complete_watermark','security','完整分页与权威水位','页码、事件水位、迟到事件及全量完成信号'),
 ('security_incident_recovery','security','来源异常人工升级与隔离','中断、拒付、超时未知、签名撤销和灾备处置'),
 ('security_independent_uat','security','跨机构真实权限及独立验收','财务教务安全三方在批准环境的只读实测证据');
CREATE TRIGGER immutable_integration_checks BEFORE UPDATE OR DELETE
 ON ms.integration_required_checks FOR EACH ROW
 EXECUTE FUNCTION ms.reject_access_history_mutation();

CREATE TABLE ms.integration_missing_evidence_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES ms.organizations(id),
 source_request_id uuid NOT NULL REFERENCES ms.source_readiness_requests(id),
 check_code text NOT NULL REFERENCES ms.integration_required_checks(check_code),
 gap_kind text NOT NULL CHECK(gap_kind IN(
  'owner_not_confirmed','policy_not_approved','source_unavailable',
  'mapping_unverified','credentials_missing','trust_not_verified',
  'watermark_unknown','reconciliation_unverified','uat_not_run',
  'recovery_not_approved')),
 reported_by uuid NOT NULL REFERENCES ms.staff_users(id),
 evidence_ref text NOT NULL CHECK(length(trim(evidence_ref)) BETWEEN 4 AND 160),
 reason_zh text NOT NULL CHECK(length(trim(reason_zh)) BETWEEN 4 AND 400),
 request_key text NOT NULL CHECK(request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
 reported_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(reported_by,request_key)
);
ALTER TABLE ms.integration_required_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE ms.integration_missing_evidence_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ms.integration_required_checks,ms.integration_missing_evidence_events
 FROM PUBLIC,ms_lowrisk_runtime,ms_scoped_lowrisk_writer,
 ms_source_readiness_writer,ms_source_readiness_reader,
 ms_fixture_recovery_writer,ms_cross_module_plan_writer,ms_cross_module_plan_reader;
CREATE TRIGGER immutable_integration_missing_evidence BEFORE UPDATE OR DELETE
 ON ms.integration_missing_evidence_events FOR EACH ROW
 EXECUTE FUNCTION ms.reject_access_history_mutation();

-- Department identity is resolved solely from the protected DB principal.
CREATE FUNCTION ms.assert_integration_gate_department(
 p_actor uuid,p_org uuid,p_department text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ms AS $f$
BEGIN
 IF p_department='security' THEN
  PERFORM ms.assert_fixture_source_recovery_security(p_actor,p_org);
 ELSIF p_department IN('sales','finance','academic') THEN
  PERFORM ms.assert_cross_module_department_authority(p_actor,p_org,p_department);
 ELSE
  RAISE EXCEPTION '非法责任部门' USING ERRCODE='23514';
 END IF;
END $f$;
REVOKE ALL ON FUNCTION ms.assert_integration_gate_department(uuid,uuid,text) FROM PUBLIC;

CREATE FUNCTION ms.record_integration_missing_evidence(
 p_request uuid,p_check text,p_gap text,p_evidence text,
 p_reason text,p_key text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ms AS $f$
DECLARE actor uuid;org uuid;req ms.source_readiness_requests%ROWTYPE;
 ch ms.integration_required_checks%ROWTYPE;
 old ms.integration_missing_evidence_events%ROWTYPE;rid uuid;
BEGIN
 SELECT staff_id,org_id INTO actor,org FROM ms.access_actor();
 IF actor IS NULL THEN RAISE EXCEPTION '本机构员工身份不存在' USING ERRCODE='42501'; END IF;
 IF p_request IS NULL OR p_check IS NULL OR
 p_gap NOT IN('owner_not_confirmed','policy_not_approved',
  'source_unavailable','mapping_unverified','credentials_missing',
  'trust_not_verified','watermark_unknown','reconciliation_unverified',
  'uat_not_run','recovery_not_approved') OR
 p_evidence IS NULL OR length(trim(p_evidence)) NOT BETWEEN 4 AND 160 OR
 p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 4 AND 400 OR
 p_key IS NULL OR p_key !~ '^[A-Za-z0-9_-]{16,128}$'
 THEN RAISE EXCEPTION '缺失证据的登记材料不完整' USING ERRCODE='23514'; END IF;
 SELECT * INTO req FROM ms.source_readiness_requests
 WHERE id=p_request AND organization_id=org FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION '本机构无此虚构来源申请' USING ERRCODE='42501'; END IF;
 SELECT * INTO ch FROM ms.integration_required_checks WHERE check_code=p_check;
 IF NOT FOUND OR (ch.department<>req.department
  AND ch.department NOT IN('sales','security'))
 THEN RAISE EXCEPTION '不属于该来源应核查的责任关口' USING ERRCODE='23514'; END IF;
 PERFORM ms.assert_integration_gate_department(actor,org,ch.department);
 SELECT * INTO old FROM ms.integration_missing_evidence_events
 WHERE reported_by=actor AND request_key=p_key;
 IF FOUND THEN
  IF old.source_request_id=p_request AND old.check_code=p_check AND
   old.gap_kind=p_gap AND old.evidence_ref=p_evidence AND old.reason_zh=p_reason
  THEN RETURN old.id; END IF;
  RAISE EXCEPTION '登记编号已关联不同缺失事项' USING ERRCODE='23505';
 END IF;
 INSERT INTO ms.integration_missing_evidence_events(
  organization_id,source_request_id,check_code,gap_kind,reported_by,
  evidence_ref,reason_zh,request_key)
 VALUES(org,req.id,ch.check_code,p_gap,actor,p_evidence,p_reason,p_key)
 RETURNING id INTO rid;
 RETURN rid;
END $f$;

REVOKE ALL ON FUNCTION ms.record_integration_missing_evidence(
 uuid,text,text,text,text,text)
 FROM PUBLIC,ms_lowrisk_runtime,ms_scoped_lowrisk_writer,
 ms_source_readiness_writer,ms_source_readiness_reader,
 ms_fixture_recovery_writer,ms_cross_module_plan_writer,ms_cross_module_plan_reader;
GRANT EXECUTE ON FUNCTION ms.record_integration_missing_evidence(
 uuid,text,text,text,text,text) TO ms_integration_gap_writer;

CREATE FUNCTION ms.readonly_integration_hard_gate(p_request uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,ms AS $f$
DECLARE actor uuid;org uuid;req ms.source_readiness_requests%ROWTYPE;
 allowed boolean; gate_items jsonb; all_count integer;event_count integer;
BEGIN
 SELECT staff_id,org_id INTO actor,org FROM ms.access_actor();
 IF actor IS NULL THEN RAISE EXCEPTION '没有已绑定的员工身份' USING ERRCODE='42501'; END IF;
 SELECT * INTO req FROM ms.source_readiness_requests
 WHERE id=p_request AND organization_id=org;
 IF NOT FOUND THEN RAISE EXCEPTION '本机构不存在对应来源申请' USING ERRCODE='42501'; END IF;
 SELECT EXISTS(SELECT 1 FROM ms.staff_users s
 JOIN ms.user_role_grants g ON g.user_id=s.id
 JOIN ms.role_templates t ON t.id=g.role_id
 WHERE s.id=actor AND s.organization_id=org AND s.status='active'
 AND t.organization_id=org AND g.revoked_at IS NULL AND g.valid_from<=now()
 AND t.role_code IN('sales_manager','finance_correction_reviewer',
 'academic_correction_reviewer','source_security_reviewer')) INTO allowed;
 IF NOT allowed AND req.requester_id<>actor THEN
  RAISE EXCEPTION '当前员工无权查看来源准入清单' USING ERRCODE='42501'; END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object(
   'check_code',c.check_code,'department',c.department,
   'label_zh',c.label_zh,'required_evidence_zh',c.required_evidence_zh,
   'production_verified',false,
   'missing_events',(SELECT count(*)::integer
    FROM ms.integration_missing_evidence_events e
    WHERE e.source_request_id=req.id AND e.check_code=c.check_code))
    ORDER BY c.department,c.check_code),'[]'::jsonb),
  count(*)::integer INTO gate_items,all_count
 FROM ms.integration_required_checks c
 WHERE c.department=req.department OR c.department IN('sales','security');
 SELECT count(*) INTO event_count FROM ms.integration_missing_evidence_events e
 WHERE e.source_request_id=req.id;
 RETURN jsonb_build_object(
  'source_request_id',req.id,'department',req.department,
  'required_gate_count',all_count,'recorded_missing_events',event_count,
  'checks',gate_items,'real_owner_confirmed',false,
  'real_contract_approved',false,'production_source_authenticated',false,
  'production_tenant_mapping_verified',false,
  'finance_readonly_credentials_granted',false,
  'academic_readonly_credentials_granted',false,
  'production_integration_allowed',false,'execution_allowed',false,
  'release_allowed',false,'status','blocked_real_authority_missing',
  'explanation_zh','已列出正式联调前必须取得的独立证据；虚构来源审批与技术 CI 不能替代真实业务和信息安全授权');
END $f$;
REVOKE ALL ON FUNCTION ms.readonly_integration_hard_gate(uuid)
 FROM PUBLIC,ms_lowrisk_runtime,ms_scoped_lowrisk_writer,
 ms_source_readiness_writer,ms_source_readiness_reader,
 ms_fixture_recovery_writer,ms_cross_module_plan_writer,ms_cross_module_plan_reader,
 ms_integration_gap_writer;
GRANT EXECUTE ON FUNCTION ms.readonly_integration_hard_gate(uuid)
 TO ms_integration_gap_reader;

CREATE VIEW ms.scoped_integration_readiness_summary
WITH (security_barrier=true) AS
SELECT r.id AS source_request_id,r.department,
 (SELECT count(*)::integer FROM ms.integration_required_checks c
   WHERE c.department=r.department OR c.department IN('sales','security'))
   AS required_gate_count,
 (SELECT count(*)::integer FROM ms.integration_missing_evidence_events e
   WHERE e.source_request_id=r.id) AS recorded_missing_events,
 '真实来源准入仍被阻断'::text AS status_zh,
 FALSE AS real_source_approved,FALSE AS production_integration_allowed,
 FALSE AS execution_allowed,FALSE AS release_allowed
FROM ms.source_readiness_requests r
WHERE r.organization_id=ms.current_scoped_organization_id()
 AND ms.current_scoped_staff_id() IS NOT NULL
 AND (r.requester_id=ms.current_scoped_staff_id()
 OR EXISTS(SELECT 1 FROM ms.staff_users s
 JOIN ms.user_role_grants g ON g.user_id=s.id
 JOIN ms.role_templates t ON t.id=g.role_id
 WHERE s.id=ms.current_scoped_staff_id() AND s.organization_id=r.organization_id
  AND s.status='active' AND t.organization_id=r.organization_id
  AND g.revoked_at IS NULL AND g.valid_from<=now() AND
  t.role_code IN('sales_manager','finance_correction_reviewer',
  'academic_correction_reviewer','source_security_reviewer')));
REVOKE ALL ON ms.scoped_integration_readiness_summary FROM PUBLIC;
GRANT SELECT ON ms.scoped_integration_readiness_summary TO ms_integration_gap_reader;
-- There are deliberately no trusted real source registrations, service keys,
-- approval-to-green transitions, live read connectors, financial/CRM writes,
-- compensation commands, or release functions.
COMMIT;
