\set ON_ERROR_STOP on
INSERT INTO ms.role_templates(id,organization_id,role_code,label_zh)
VALUES('30000000-0000-4000-8000-000000000040',
 '20000000-0000-4000-8000-000000000001',
 'source_security_reviewer','虚构来源信息安全审查员');
INSERT INTO ms.staff_users(id,organization_id,display_name,external_identity_ref)
VALUES('30000000-0000-4000-8000-000000000040',
 '20000000-0000-4000-8000-000000000001',
 '虚构独立安全审核员','demo:source-security-reviewer');
INSERT INTO ms.user_role_grants(user_id,role_id)
VALUES('30000000-0000-4000-8000-000000000040',
 '30000000-0000-4000-8000-000000000040');
CREATE ROLE ms_fixture_source_security LOGIN INHERIT NOSUPERUSER
 NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE ms_fixture_source_security PASSWORD :'security_password';
GRANT ms_source_readiness_writer,ms_source_readiness_reader
 TO ms_fixture_source_security;
GRANT ms_source_readiness_writer,ms_source_readiness_reader
 TO ms_plan_finance_reviewer,ms_plan_academic_reviewer,
 ms_plan_dual_reviewer,ms_plan_finance_b;
INSERT INTO ms.database_principal_staff(principal_name,organization_id,staff_user_id)
VALUES('ms_fixture_source_security',
 '20000000-0000-4000-8000-000000000001',
 '30000000-0000-4000-8000-000000000040');
DO $guard$
DECLARE principal text;
BEGIN
 FOREACH principal IN ARRAY ARRAY[
  'ms_fixture_source_security','ms_plan_finance_reviewer',
  'ms_plan_academic_reviewer','ms_plan_dual_reviewer','ms_plan_finance_b']
 LOOP
  IF has_table_privilege(principal,'ms.source_readiness_requests','INSERT')
   OR has_table_privilege(principal,'ms.source_readiness_requests','SELECT')
   OR has_table_privilege(principal,'ms.source_readiness_reviews','UPDATE')
   OR has_table_privilege(principal,'ms.payment_allocations','UPDATE')
   OR has_table_privilege(principal,'ms.sales_orders','UPDATE')
   OR has_table_privilege(principal,'ms.crm_entitlement_links','UPDATE')
   OR NOT has_function_privilege(principal,
    'ms.review_fixture_source_readiness(uuid,text,text,text,text,text)','EXECUTE')
  THEN RAISE EXCEPTION 'Only function-scoped fixture review is allowed for %',principal;
  END IF;
 END LOOP;
END $guard$;
