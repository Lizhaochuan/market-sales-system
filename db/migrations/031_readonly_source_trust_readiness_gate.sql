-- V3.2-28: independent READ-ONLY production-readiness denial.
-- Migration deliberately adds no external key, trusted source, network
-- connection, payment/CRM write, executor, hold-release or workflow dispatch.
-- The JavaScript Ed25519 verifier is ISOLATED FIXTURE-ONLY, not linked here.
BEGIN;
CREATE FUNCTION ms.cross_module_readonly_source_trust_gate(p_manifest uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,ms AS $gate$
DECLARE existing_gate jsonb;
BEGIN
 -- Existing V3.2-27 function enforces authenticated local DB principal,
 -- organization membership, minimum role, plan, scope and source validity.
 existing_gate:=ms.cross_module_readonly_authority_gate(p_manifest);
 RETURN existing_gate || jsonb_build_object(
  'readonly_fixture_signature_test_available',true,
  'production_finance_source_bound',false,
  'production_crm_source_bound',false,
  'production_source_signatures_authenticated',false,
  'production_source_tenant_verified',false,
  'production_durable_replay_ledger_ready',false,
  'production_complete_watermark_verified',false,
  'production_finance_reconciled',false,
  'production_crm_reconciled',false,
  'production_compensation_authorized',false,
  'execution_allowed',false,
  'release_allowed',false,
  'additional_blockers_zh',jsonb_build_array(
    '虚构签名测试不等于机构财务或 CRM 的真实身份认证',
    '尚无经批准的双机构来源映射、权威密钥、持久防重放账本及完整数据水位',
    '未完成真实资金及已上课时对账，不允许执行补偿或解除隔离'
  )
 );
END $gate$;
REVOKE ALL ON FUNCTION ms.cross_module_readonly_source_trust_gate(uuid)
 FROM PUBLIC,ms_lowrisk_runtime,ms_scoped_lowrisk_writer,ms_cross_module_plan_writer;
GRANT EXECUTE ON FUNCTION ms.cross_module_readonly_source_trust_gate(uuid)
 TO ms_cross_module_plan_reader;
COMMIT;
