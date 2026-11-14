\set ON_ERROR_STOP on
-- V3.2-26 CI-only third independent sales reviewer for the BLOCKED
-- local preflight. Never grants real finance/CRM or hold-release authority.
INSERT INTO ms.staff_users(id,organization_id,display_name,external_identity_ref)
VALUES('30000000-0000-4000-8000-000000000017',
 '20000000-0000-4000-8000-000000000001',
 '虚构第三独立主管（仅登记禁止执行的预审）','demo:cross-module-third-reviewer');
INSERT INTO ms.user_role_grants(user_id,role_id)
VALUES('30000000-0000-4000-8000-000000000017',
 '20000000-0000-4000-8000-000000000031');

CREATE ROLE ms_plan_preflight_independent LOGIN INHERIT NOSUPERUSER
 NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE ms_plan_preflight_independent PASSWORD :'preflight_password';
GRANT ms_cross_module_plan_writer,ms_cross_module_plan_reader TO ms_plan_preflight_independent;
INSERT INTO ms.database_principal_staff(principal_name,organization_id,staff_user_id)
VALUES('ms_plan_preflight_independent',
 '20000000-0000-4000-8000-000000000001',
 '30000000-0000-4000-8000-000000000017');

DO $guard$
BEGIN
 IF has_table_privilege('ms_plan_preflight_independent','ms.cross_module_compensation_manifests','SELECT')
 OR has_table_privilege('ms_plan_preflight_independent','ms.cross_module_execution_preflight_blocks','INSERT')
 OR has_table_privilege('ms_plan_preflight_independent','ms.sales_orders','UPDATE')
 OR has_table_privilege('ms_plan_preflight_independent','ms.payment_allocations','UPDATE')
 OR has_table_privilege('ms_plan_preflight_independent','ms.crm_entitlement_links','UPDATE')
 OR NOT has_function_privilege('ms_plan_preflight_independent',
  'ms.record_cross_module_blocked_preflight(uuid,text,text)','EXECUTE')
 THEN RAISE EXCEPTION 'Third reviewer must remain strictly function-only and cannot execute corrections';
 END IF;
END $guard$;
