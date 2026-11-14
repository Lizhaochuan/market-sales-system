\set ON_ERROR_STOP on
-- CI-only function-scoped inspection / missing-evidence reporting grants.
-- No production source role, business update or release power is added.
GRANT ms_integration_gap_writer,ms_integration_gap_reader TO
 ms_plan_sales_reviewer,ms_plan_finance_reviewer,ms_plan_academic_reviewer,
 ms_plan_dual_reviewer,ms_plan_finance_b,ms_fixture_source_security;

DO $guard$
DECLARE principal text;
BEGIN
 FOREACH principal IN ARRAY ARRAY[
  'ms_plan_sales_reviewer','ms_plan_finance_reviewer','ms_plan_academic_reviewer',
  'ms_plan_dual_reviewer','ms_plan_finance_b','ms_fixture_source_security']
 LOOP
  IF has_table_privilege(principal,'ms.integration_required_checks','SELECT')
   OR has_table_privilege(principal,'ms.integration_missing_evidence_events','SELECT')
   OR has_table_privilege(principal,'ms.integration_missing_evidence_events','INSERT')
   OR has_table_privilege(principal,'ms.integration_missing_evidence_events','UPDATE')
   OR has_table_privilege(principal,'ms.sales_orders','UPDATE')
   OR has_table_privilege(principal,'ms.payment_allocations','UPDATE')
   OR has_table_privilege(principal,'ms.crm_entitlement_links','UPDATE')
   OR NOT has_function_privilege(principal,
    'ms.record_integration_missing_evidence(uuid,text,text,text,text,text)','EXECUTE')
   OR NOT has_function_privilege(principal,
    'ms.readonly_integration_hard_gate(uuid)','EXECUTE')
  THEN RAISE EXCEPTION 'V3.2-31 gate reviewer must be function-only: %',principal;
  END IF;
 END LOOP;
END $guard$;
