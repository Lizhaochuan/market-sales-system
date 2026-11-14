\set ON_ERROR_STOP on
-- CI-only additional independent supervisor, same fictional institution;
-- never a privileged owner and never read-only manager table bypass.
CREATE ROLE ms_assignee_reader_manager_2 LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE ms_assignee_reader_manager_2 PASSWORD :'read_m2_password';
GRANT ms_student_assignee_reader TO ms_assignee_reader_manager_2;
INSERT INTO ms.database_principal_staff(principal_name,organization_id,staff_user_id)
VALUES('ms_assignee_reader_manager_2','20000000-0000-4000-8000-000000000001',
 '20000000-0000-4000-8000-000000000014');
CREATE ROLE ms_write_manager_2 LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE ms_write_manager_2 PASSWORD :'write_m2_password';
GRANT ms_scoped_lowrisk_writer TO ms_write_manager_2;
INSERT INTO ms.database_principal_staff(principal_name,organization_id,staff_user_id)
VALUES('ms_write_manager_2','20000000-0000-4000-8000-000000000001',
 '20000000-0000-4000-8000-000000000014');
DO $guard$
BEGIN
 IF has_table_privilege('ms_write_manager_2','ms.sales_orders','SELECT')
  OR has_table_privilege('ms_write_manager_2','ms.sales_orders','UPDATE')
  OR has_table_privilege('ms_write_manager_2','ms.leads','UPDATE')
  OR has_table_privilege('ms_write_manager_2','ms.downstream_student_reconciliation_findings','SELECT')
  OR has_table_privilege('ms_assignee_reader_manager_2','ms.downstream_student_reconciliation_findings','SELECT')
  OR NOT has_function_privilege('ms_write_manager_2',
   'ms.resolve_downstream_student_reconciliation(uuid,text,text,text,text)','EXECUTE')
 THEN RAISE EXCEPTION 'Additional supervisor must remain strictly function-only';
 END IF;
END $guard$;
