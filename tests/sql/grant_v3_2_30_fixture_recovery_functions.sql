\set ON_ERROR_STOP on
-- CI only: grant two limited recovery functions, not source credentials or external writes.
GRANT ms_fixture_recovery_writer TO ms_plan_finance_reviewer,
 ms_plan_academic_reviewer,ms_plan_dual_reviewer,ms_plan_finance_b,
 ms_fixture_source_security;
DO $guard$
DECLARE name text;
BEGIN
 FOREACH name IN ARRAY ARRAY[
 'ms_plan_finance_reviewer','ms_plan_academic_reviewer',
 'ms_plan_dual_reviewer','ms_plan_finance_b','ms_fixture_source_security']
 LOOP
 IF has_table_privilege(name,'ms.fixture_source_recovery_incidents','SELECT')
 OR has_table_privilege(name,'ms.fixture_source_recovery_reviews','INSERT')
 OR has_table_privilege(name,'ms.payment_allocations','UPDATE')
 OR has_table_privilege(name,'ms.sales_orders','UPDATE')
 OR has_table_privilege(name,'ms.crm_entitlement_links','UPDATE')
 OR NOT has_function_privilege(name,
  'ms.review_fixture_source_interruption(uuid,text,text,text,text,text)','EXECUTE')
 THEN RAISE EXCEPTION 'Recovery function-only grant violated for %',name;END IF;
 END LOOP;
END $guard$;
