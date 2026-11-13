-- CI ONLY: disposable view-only logins, two mapped fictional orgs.
-- Requires migration 011 and the fictional A/B organizations.
\set ON_ERROR_STOP on
CREATE ROLE ms_directory_reader_a LOGIN INHERIT NOSUPERUSER NOCREATEDB
  NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE ms_directory_reader_b LOGIN INHERIT NOSUPERUSER NOCREATEDB
  NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE ms_directory_reader_a PASSWORD :'reader_password_a';
ALTER ROLE ms_directory_reader_b PASSWORD :'reader_password_b';
GRANT ms_student_directory_reader TO ms_directory_reader_a;
GRANT ms_student_directory_reader TO ms_directory_reader_b;
INSERT INTO ms.database_principal_tenants(principal_name,organization_id)
VALUES
('ms_directory_reader_a','20000000-0000-4000-8000-000000000001'),
('ms_directory_reader_b','20000000-0000-4000-8000-000000000002');

DO $check$
BEGIN
  IF pg_has_role('ms_directory_reader_a','ms_lowrisk_runtime','member')
    OR pg_has_role('ms_directory_reader_b','ms_lowrisk_runtime','member')
    OR has_table_privilege('ms_directory_reader_a','ms.students','SELECT')
    OR has_table_privilege('ms_directory_reader_b','ms.students','SELECT') THEN
    RAISE EXCEPTION 'Directory-only role must not inherit base-table access';
  END IF;
END $check$;
