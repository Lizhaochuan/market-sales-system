\set ON_ERROR_STOP on
-- V3.2-25: isolated fictional identities and dedicated non-owner function-only DB logins.
-- Three departments are different people; a dual-role manager exists to test anti-impersonation.
INSERT INTO ms.staff_users(id,organization_id,display_name,external_identity_ref)
VALUES
 ('30000000-0000-4000-8000-000000000015','20000000-0000-4000-8000-000000000001','虚构财务审核员','demo:finance-correction'),
 ('30000000-0000-4000-8000-000000000016','20000000-0000-4000-8000-000000000001','虚构教务审核员','demo:academic-correction');
INSERT INTO ms.role_templates(id,organization_id,role_code,label_zh)
VALUES
 ('20000000-0000-4000-8000-000000000032','20000000-0000-4000-8000-000000000001','finance_correction_reviewer','财务纠错方案审核员'),
 ('20000000-0000-4000-8000-000000000033','20000000-0000-4000-8000-000000000001','academic_correction_reviewer','教务纠错方案审核员'),
 ('20000000-0000-4000-8000-000000000034','20000000-0000-4000-8000-000000000002','finance_correction_reviewer','B机构财务纠错方案审核员');
INSERT INTO ms.user_role_grants(user_id,role_id)
VALUES
 ('30000000-0000-4000-8000-000000000015','20000000-0000-4000-8000-000000000032'),
 ('30000000-0000-4000-8000-000000000016','20000000-0000-4000-8000-000000000033'),
 ('20000000-0000-4000-8000-000000000014','20000000-0000-4000-8000-000000000032'),
 ('20000000-0000-4000-8000-000000000021','20000000-0000-4000-8000-000000000034');

CREATE ROLE ms_plan_requester_a LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE ms_plan_requester_a PASSWORD :'plan_password_a';
CREATE ROLE ms_plan_sales_reviewer LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE ms_plan_sales_reviewer PASSWORD :'plan_password_sales';
CREATE ROLE ms_plan_finance_reviewer LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE ms_plan_finance_reviewer PASSWORD :'plan_password_finance';
CREATE ROLE ms_plan_academic_reviewer LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE ms_plan_academic_reviewer PASSWORD :'plan_password_academic';
CREATE ROLE ms_plan_dual_reviewer LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE ms_plan_dual_reviewer PASSWORD :'plan_password_dual';
CREATE ROLE ms_plan_finance_b LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE ms_plan_finance_b PASSWORD :'plan_password_b';

GRANT ms_cross_module_plan_writer,ms_cross_module_plan_reader TO
 ms_plan_requester_a,ms_plan_sales_reviewer,ms_plan_finance_reviewer,
 ms_plan_academic_reviewer,ms_plan_dual_reviewer,ms_plan_finance_b;
INSERT INTO ms.database_principal_staff(principal_name,organization_id,staff_user_id)
VALUES
 ('ms_plan_requester_a','20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000011'),
 ('ms_plan_sales_reviewer','20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000013'),
 ('ms_plan_finance_reviewer','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000015'),
 ('ms_plan_academic_reviewer','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000016'),
 ('ms_plan_dual_reviewer','20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000014'),
 ('ms_plan_finance_b','20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000021');

DO $assert$
DECLARE principal text;
BEGIN
 FOREACH principal IN ARRAY ARRAY[
  'ms_plan_requester_a','ms_plan_sales_reviewer','ms_plan_finance_reviewer',
  'ms_plan_academic_reviewer','ms_plan_dual_reviewer','ms_plan_finance_b']
 LOOP
  IF has_table_privilege(principal,'ms.cross_module_correction_plans','SELECT')
   OR has_table_privilege(principal,'ms.cross_module_correction_plans','UPDATE')
   OR has_table_privilege(principal,'ms.cross_module_correction_signoffs','INSERT')
   OR has_table_privilege(principal,'ms.sales_orders','UPDATE')
   OR has_table_privilege(principal,'ms.payment_allocations','SELECT')
   OR has_table_privilege(principal,'ms.payment_allocations','UPDATE')
   OR has_table_privilege(principal,'ms.lead_students','UPDATE')
   OR NOT has_function_privilege(principal,
    'ms.sign_cross_module_student_correction(uuid,text,text,text,text,text)','EXECUTE')
  THEN RAISE EXCEPTION 'Plan reviewer role is not function-only: %',principal; END IF;
 END LOOP;
END $assert$;
