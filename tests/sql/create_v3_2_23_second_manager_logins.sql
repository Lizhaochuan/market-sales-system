\set ON_ERROR_STOP on
-- V3.2-23 CI ONLY. Second independent manager, different DB principals.
CREATE ROLE ms_write_reviewer_2 LOGIN INHERIT NOSUPERUSER
 NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE ms_write_reviewer_2 PASSWORD :'second_write_password';
GRANT ms_scoped_lowrisk_writer TO ms_write_reviewer_2;
CREATE ROLE ms_read_reviewer_2 LOGIN INHERIT NOSUPERUSER
 NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE ms_read_reviewer_2 PASSWORD :'second_read_password';
GRANT ms_student_assignee_reader TO ms_read_reviewer_2;
INSERT INTO ms.database_principal_staff(principal_name,organization_id,staff_user_id)
VALUES
 ('ms_write_reviewer_2','20000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000014'),
 ('ms_read_reviewer_2','20000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000014');
DO $q$
BEGIN
 IF has_table_privilege('ms_write_reviewer_2','ms.downstream_correction_reconciliation_requests','SELECT')
 OR has_table_privilege('ms_write_reviewer_2','ms.sales_orders','UPDATE')
 OR has_table_privilege('ms_write_reviewer_2','ms.lead_students','UPDATE')
 OR has_table_privilege('ms_read_reviewer_2','ms.sales_orders','SELECT')
 OR NOT has_function_privilege('ms_write_reviewer_2',
  'ms.decide_downstream_reconciliation(uuid,text,text,text,text)','EXECUTE')
 THEN RAISE EXCEPTION 'Second reviewer must remain strictly function-only';
 END IF;
END $q$;
