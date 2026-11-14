\set ON_ERROR_STOP on
-- Only fictional domain reviewers may append fixture evidence changes.
GRANT ms_fixture_uat_evidence_writer TO
 ms_plan_sales_reviewer,ms_plan_finance_reviewer,
 ms_plan_academic_reviewer,ms_plan_dual_reviewer,
 ms_plan_finance_b,ms_fixture_source_security;
DO $guard$
DECLARE principal text;
BEGIN
 FOREACH principal IN ARRAY ARRAY['ms_uat_preview_a','ms_uat_preview_b']
 LOOP
  IF has_table_privilege(principal,'ms.fixture_uat_evidence_events','SELECT')
   OR has_table_privilege(principal,'ms.fixture_uat_evidence_events','INSERT')
   OR has_table_privilege(principal,'ms.fixture_uat_evidence_events','UPDATE')
   OR has_function_privilege(principal,
    'ms.record_fixture_uat_evidence(uuid,text,text,text,integer,text,text)','EXECUTE')
   OR NOT has_function_privilege(principal,
    'ms.readonly_fixture_uat_diff(uuid,integer,integer)','EXECUTE')
   OR has_table_privilege(principal,'ms.sales_orders','UPDATE')
   OR has_table_privilege(principal,'ms.payment_allocations','UPDATE')
   OR has_table_privilege(principal,'ms.crm_entitlement_links','UPDATE')
  THEN RAISE EXCEPTION 'V3.2-34 preview LOGIN must remain purely read-only %',principal;
  END IF;
 END LOOP;
 FOREACH principal IN ARRAY ARRAY[
 'ms_plan_sales_reviewer','ms_plan_finance_reviewer','ms_plan_academic_reviewer',
 'ms_plan_dual_reviewer','ms_plan_finance_b','ms_fixture_source_security']
 LOOP
  IF has_table_privilege(principal,'ms.fixture_uat_evidence_events','SELECT')
   OR has_table_privilege(principal,'ms.fixture_uat_evidence_events','UPDATE')
   OR NOT has_function_privilege(principal,
    'ms.record_fixture_uat_evidence(uuid,text,text,text,integer,text,text)','EXECUTE')
   OR has_table_privilege(principal,'ms.sales_orders','UPDATE')
   OR has_table_privilege(principal,'ms.payment_allocations','UPDATE')
  THEN RAISE EXCEPTION 'V3.2-34 reviewer may only append via function %',principal;
  END IF;
 END LOOP;
END $guard$;
