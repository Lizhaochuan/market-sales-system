\set ON_ERROR_STOP on
-- V3.2-29 one fictional information security reviewer, strictly FUNCTION ONLY.
INSERT INTO ms.staff_users(id,organization_id,display_name,external_identity_ref)
VALUES('30000000-0000-4000-8000-000000000018',
 '20000000-0000-4000-8000-000000000001',
 '虚构独立信息安全审核员','demo:source-security-reviewer');

INSERT INTO ms.role_templates(id,organization_id,role_code,label_zh)
VALUES('30000000-0000-4000-8000-000000000038',
 '20000000-0000-4000-8000-000000000001',
 'source_security_reviewer','外部权威来源准备独立安全审核员');

INSERT INTO ms.user_role_grants(user_id,role_id)
VALUES('30000000-0000-4000-8000-000000000018',
 '30000000-0000-4000-8000-000000000038');

CREATE ROLE ms_source_security_reviewer LOGIN INHERIT NOSUPERUSER
 NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE ms_source_security_reviewer PASSWORD :'source_security_password';
GRANT ms_cross_module_plan_writer,ms_cross_module_plan_reader TO ms_source_security_reviewer;
INSERT INTO ms.database_principal_staff(principal_name,organization_id,staff_user_id)
VALUES('ms_source_security_reviewer',
 '20000000-0000-4000-8000-000000000001',
 '30000000-0000-4000-8000-000000000018');

DO $verify$
BEGIN
 IF has_table_privilege('ms_source_security_reviewer','ms.cross_module_source_onboarding_requests','SELECT')
 OR has_table_privilege('ms_source_security_reviewer','ms.cross_module_source_onboarding_reviews','INSERT')
 OR has_table_privilege('ms_source_security_reviewer','ms.sales_orders','UPDATE')
 OR has_table_privilege('ms_source_security_reviewer','ms.payment_allocations','UPDATE')
 OR has_table_privilege('ms_source_security_reviewer','ms.crm_entitlement_links','UPDATE')
 OR NOT has_function_privilege('ms_source_security_reviewer',
  'ms.review_cross_module_source_onboarding(uuid,text,text,text,text,text)','EXECUTE')
 THEN RAISE EXCEPTION 'Security reviewer must remain function-only without business write rights';
 END IF;
END $verify$;
