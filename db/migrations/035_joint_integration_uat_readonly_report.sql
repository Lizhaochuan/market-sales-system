-- V3.2-32: joint finance + academic UAT checklist, read-only.
-- Does not change source trust, grant real access, record approval or
-- authorize compensation, payment, academic writes or release.
BEGIN;
CREATE ROLE ms_joint_uat_report_reader NOLOGIN;
GRANT USAGE ON SCHEMA ms TO ms_joint_uat_report_reader;

CREATE FUNCTION ms.readonly_joint_integration_uat_report(
 p_finance_request uuid,p_academic_request uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,ms AS $f$
DECLARE
 actor uuid;org uuid;
 f ms.source_readiness_requests%ROWTYPE;
 a ms.source_readiness_requests%ROWTYPE;
 authorized boolean;
 checklist jsonb;
 total_count integer;
 finance_incidents integer;
 academic_incidents integer;
BEGIN
 SELECT staff_id,org_id INTO actor,org FROM ms.access_actor();
 IF actor IS NULL OR org IS NULL THEN
  RAISE EXCEPTION '尚无绑定机构的有效员工身份' USING ERRCODE='42501';
 END IF;
 -- A cross-domain report is visible only to an independently authorized
 -- source-security reviewer; finance or academic roles alone are insufficient.
 SELECT EXISTS(
  SELECT 1 FROM ms.staff_users s
   JOIN ms.user_role_grants g ON g.user_id=s.id
   JOIN ms.role_templates t ON t.id=g.role_id
  WHERE s.id=actor AND s.organization_id=org AND s.status='active'
   AND t.organization_id=org AND t.role_code='source_security_reviewer'
   AND g.revoked_at IS NULL AND g.valid_from<=now()
 ) INTO authorized;
 IF NOT authorized THEN
  RAISE EXCEPTION '需要本机构独立信息安全角色查看联合验收报告' USING ERRCODE='42501';
 END IF;
 IF p_finance_request IS NULL OR p_academic_request IS NULL OR
  p_finance_request=p_academic_request THEN
  RAISE EXCEPTION '必须分别指定两份不同的财务和教务来源申请'
   USING ERRCODE='23514';
 END IF;
 SELECT * INTO f FROM ms.source_readiness_requests
 WHERE id=p_finance_request AND organization_id=org;
 IF NOT FOUND THEN
  RAISE EXCEPTION '本机构不存在该财务来源申请' USING ERRCODE='42501';
 END IF;
 SELECT * INTO a FROM ms.source_readiness_requests
 WHERE id=p_academic_request AND organization_id=org;
 IF NOT FOUND THEN
  RAISE EXCEPTION '本机构不存在该教务来源申请' USING ERRCODE='42501';
 END IF;
 IF f.department<>'finance' OR a.department<>'academic' THEN
  RAISE EXCEPTION '来源申请部门不匹配，不能自动组合两套账或 CRM'
   USING ERRCODE='23514';
 END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'check_code',c.check_code,
    'department',c.department,
    'label_zh',c.label_zh,
    'required_evidence_zh',c.required_evidence_zh,
    'owner_role_zh',CASE c.department
     WHEN 'sales' THEN '销售与合同责任人'
     WHEN 'finance' THEN '财务与资金权威负责人'
     WHEN 'academic' THEN '教务与 CRM 系统负责人'
     ELSE '独立信息安全负责人' END,
    'production_verified',false,
    'missing_events',
     (SELECT count(*)::integer FROM ms.integration_missing_evidence_events e
      WHERE e.check_code=c.check_code AND e.organization_id=org AND
       e.source_request_id=CASE c.department
        WHEN 'academic' THEN a.id ELSE f.id END)
   ) ORDER BY c.department,c.check_code),'[]'::jsonb),
  count(*)::integer
 INTO checklist,total_count
 FROM ms.integration_required_checks c;
 IF total_count<>16 THEN
  RAISE EXCEPTION '验收检查目录数量不符合已审核基线'
   USING ERRCODE='23514';
 END IF;
 SELECT count(*)::integer INTO finance_incidents
 FROM ms.fixture_source_recovery_incidents i
 WHERE i.source_request_id=f.id AND i.organization_id=org;
 SELECT count(*)::integer INTO academic_incidents
 FROM ms.fixture_source_recovery_incidents i
 WHERE i.source_request_id=a.id AND i.organization_id=org;
 RETURN jsonb_build_object(
   'report_schema','v3.2-32-joint-uat-v1',
   'finance_source_request_id',f.id,
   'academic_source_request_id',a.id,
   'check_count',total_count,
   'checks',checklist,
   'finance_unresolved_incidents',finance_incidents,
   'academic_unresolved_incidents',academic_incidents,
   'real_source_owners_approved',false,
   'real_source_credentials_granted',false,
   'production_ledger_replay_ready',false,
   'real_cross_module_uat_passed',false,
   'production_integration_allowed',false,
   'execution_allowed',false,
   'release_allowed',false,
   'status','blocked_real_authority_missing',
   'disclaimer_zh',
   '此报告仅汇总虚构来源的真实准入缺口；即使缺失登记数为零，也不代表真实授权或联调完成'
 );
END $f$;

REVOKE ALL ON FUNCTION ms.readonly_joint_integration_uat_report(uuid,uuid)
 FROM PUBLIC,ms_lowrisk_runtime,ms_scoped_lowrisk_writer,
 ms_source_readiness_writer,ms_source_readiness_reader,
 ms_fixture_recovery_writer,ms_cross_module_plan_writer,
 ms_cross_module_plan_reader,ms_integration_gap_writer,
 ms_integration_gap_reader;
GRANT EXECUTE ON FUNCTION ms.readonly_joint_integration_uat_report(uuid,uuid)
 TO ms_joint_uat_report_reader;
-- No approval write, durable external source, execution, or release path.
COMMIT;
