-- CI ONLY: a read-only PostgreSQL LOGIN mapped to the fictional A-institution supervisor.
-- It has the SAME scoped rights as a salesperson, not unrestricted manager views.
-- Execute after migration 014 and the fictional staff seed.
\set ON_ERROR_STOP on
CREATE ROLE ms_assignee_reader_manager LOGIN INHERIT NOSUPERUSER
  NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE ms_assignee_reader_manager PASSWORD :'manager_password';
GRANT ms_student_assignee_reader TO ms_assignee_reader_manager;
INSERT INTO ms.database_principal_staff(principal_name,organization_id,staff_user_id)
VALUES ('ms_assignee_reader_manager',
        '20000000-0000-4000-8000-000000000001',
        '20000000-0000-4000-8000-000000000013');

DO $check$
BEGIN
  IF has_table_privilege('ms_assignee_reader_manager','ms.students','SELECT')
    OR has_table_privilege('ms_assignee_reader_manager','ms.staff_users','SELECT')
    OR has_table_privilege('ms_assignee_reader_manager','ms.sales_orders','SELECT')
    OR has_table_privilege('ms_assignee_reader_manager','ms.data_scope_grants','SELECT')
    OR NOT has_table_privilege('ms_assignee_reader_manager','ms.scoped_legacy_student_details','SELECT')
  THEN
    RAISE EXCEPTION 'Supervisor scoped read account must not inherit broad manager base-table rights';
  END IF;
END $check$;
