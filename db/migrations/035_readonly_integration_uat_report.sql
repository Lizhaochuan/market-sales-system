-- V3.2-32: strictly read-only, scoped UAT report envelope.
-- No new grants to original tables, credentials, external sources or executors.
BEGIN;
CREATE FUNCTION ms.readonly_integration_uat_report(p_request uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,ms AS $f$
DECLARE source_gate jsonb; department text; checks jsonb;
BEGIN
 -- V3.2-31 gate resolves SESSION_USER, same-organization authorization,
 -- and DENIES any unknown / other-tenant source request.
 source_gate:=ms.readonly_integration_hard_gate(p_request);
 department:=source_gate->>'department';
 IF department NOT IN('finance','academic') OR
    source_gate->>'status'<>'blocked_real_authority_missing' OR
    source_gate->'production_integration_allowed'<>'false'::jsonb OR
    source_gate->'execution_allowed'<>'false'::jsonb OR
    source_gate->'release_allowed'<>'false'::jsonb
 THEN RAISE EXCEPTION '真实联调准入仍必须保持拒绝' USING ERRCODE='23514'; END IF;
 -- No evidence counts can be converted to "accepted" by this report.
 SELECT COALESCE(jsonb_agg(jsonb_build_object(
   'check_code',x.item->>'check_code',
   'responsible_department',x.item->>'department',
   'required_evidence_zh',x.item->>'required_evidence_zh',
   'label_zh',x.item->>'label_zh',
   'missing_events',(x.item->>'missing_events')::integer,
   'uat_status','blocked_real_approval_missing',
   'real_evidence_verified',false,
   'real_owner_signed',false,
   'ready_for_production',false
 ) ORDER BY x.item->>'department',x.item->>'check_code'),
 '[]'::jsonb) INTO checks
 FROM jsonb_array_elements(source_gate->'checks') AS x(item);
 RETURN jsonb_build_object(
   'schema_version','v3.2-32-readonly-uat-v1',
   'source_request_id',source_gate->'source_request_id',
   'department',department,
   'required_gate_count',source_gate->'required_gate_count',
   'recorded_missing_events',source_gate->'recorded_missing_events',
   'tasks',checks,
   'technical_ci_is_business_approval',false,
   'fixture_approvals_are_real',false,
   'real_finance_source_connected',false,
   'real_crm_source_connected',false,
   'production_integration_allowed',false,
   'execution_allowed',false,
   'release_allowed',false,
   'summary_zh','本报告仅列出未来联调的验收要求和当前缺口；不存在已验证的真实业务授权。',
   'next_action_zh','请分别向销售、财务、教务及安全责任人收集经授权的真实材料，保持隔离，不得执行。');
END $f$;

REVOKE ALL ON FUNCTION ms.readonly_integration_uat_report(uuid) FROM
 PUBLIC,ms_lowrisk_runtime,ms_scoped_lowrisk_writer,
 ms_cross_module_plan_writer,ms_cross_module_plan_reader,
 ms_source_readiness_writer,ms_source_readiness_reader,
 ms_fixture_recovery_writer,ms_integration_gap_writer;
GRANT EXECUTE ON FUNCTION ms.readonly_integration_uat_report(uuid)
 TO ms_integration_gap_reader;
-- No UPDATE, DELETE, API transport, task dispatch, approval mutation, 
-- external authentication, actual compensation or hold release.
COMMIT;
