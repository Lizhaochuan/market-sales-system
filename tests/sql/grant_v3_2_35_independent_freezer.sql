\set ON_ERROR_STOP on
-- Freeze is an independent security responsibility, not an evidence-review
-- or UAT-preview capability. No production financial/CRM grants are added.
GRANT ms_fixture_uat_freeze_writer TO ms_fixture_source_security;
DO $guard$
DECLARE role_name text;
BEGIN
 FOREACH role_name IN ARRAY ARRAY['ms_uat_preview_a','ms_uat_preview_b',
 'ms_plan_sales_reviewer','ms_plan_finance_reviewer',
 'ms_plan_academic_reviewer','ms_plan_dual_reviewer','ms_plan_finance_b']
 LOOP
  IF has_function_privilege(role_name,
    'ms.freeze_fixture_uat_source(uuid,text,text,text)','EXECUTE')
  OR has_table_privilege(role_name,'ms.fixture_uat_source_freezes','SELECT')
  OR has_table_privilege(role_name,'ms.fixture_uat_source_freezes','INSERT')
  OR has_table_privilege(role_name,'ms.fixture_uat_source_freezes','UPDATE')
  OR has_table_privilege(role_name,'ms.sales_orders','UPDATE')
  OR has_table_privilege(role_name,'ms.payment_allocations','UPDATE')
  OR has_table_privilege(role_name,'ms.crm_entitlement_links','UPDATE')
  THEN RAISE EXCEPTION 'Only independent security can freeze, not %',role_name;
  END IF;
 END LOOP;
 IF NOT has_function_privilege('ms_fixture_source_security',
   'ms.freeze_fixture_uat_source(uuid,text,text,text)','EXECUTE')
 OR has_table_privilege('ms_fixture_source_security',
   'ms.fixture_uat_source_freezes','UPDATE')
 THEN RAISE EXCEPTION 'Security LOGIN may only freeze through guarded function'; END IF;
END $guard$;
