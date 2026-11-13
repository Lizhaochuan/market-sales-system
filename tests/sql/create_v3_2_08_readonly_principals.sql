-- CI ONLY, after migration 012, with disposable fictional DB accounts.
\set ON_ERROR_STOP on
CREATE ROLE ms_approved_route_login LOGIN INHERIT NOSUPERUSER NOCREATEDB
  NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE ms_approved_route_login PASSWORD :'route_password';
GRANT ms_approved_route_reader TO ms_approved_route_login;

CREATE ROLE ms_assignee_reader_a LOGIN INHERIT NOSUPERUSER NOCREATEDB
  NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE ms_assignee_reader_b LOGIN INHERIT NOSUPERUSER NOCREATEDB
  NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE ms_assignee_reader_a PASSWORD :'assignee_password_a';
ALTER ROLE ms_assignee_reader_b PASSWORD :'assignee_password_b';
GRANT ms_student_assignee_reader TO ms_assignee_reader_a;
GRANT ms_student_assignee_reader TO ms_assignee_reader_b;

INSERT INTO ms.database_principal_staff(principal_name,organization_id,staff_user_id)
VALUES
('ms_assignee_reader_a','20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000011'),
('ms_assignee_reader_b','20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000012');

DO $permission_check$
BEGIN
  IF has_table_privilege('ms_approved_route_login','ms.staff_identity_bindings','SELECT')
  OR has_table_privilege('ms_approved_route_login','ms.staff_users','SELECT')
  OR NOT has_function_privilege('ms_approved_route_login','ms.approved_identity_tenant(text,text)','EXECUTE')
  OR has_table_privilege('ms_assignee_reader_a','ms.students','SELECT')
  OR has_table_privilege('ms_assignee_reader_b','ms.students','SELECT')
  OR has_table_privilege('ms_assignee_reader_a','ms.database_principal_staff','SELECT')
  OR pg_has_role('ms_assignee_reader_b','ms_lowrisk_runtime','member') THEN
    RAISE EXCEPTION 'Isolated identity lookup and per-assignee roles must remain strictly scoped';
  END IF;
END $permission_check$;
