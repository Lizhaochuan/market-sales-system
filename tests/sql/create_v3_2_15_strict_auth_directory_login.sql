-- V3.2-15 fictional CI only, after migration 018; NOT an IdP secret.
\set ON_ERROR_STOP on
CREATE ROLE ms_strict_auth_login LOGIN INHERIT NOSUPERUSER NOCREATEDB
 NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE ms_strict_auth_login PASSWORD :'directory_password';
GRANT ms_strict_auth_directory_reader TO ms_strict_auth_login;

DO $test$
DECLARE name text:='ms_strict_auth_login';
BEGIN
 IF NOT has_function_privilege(name,
   'ms.resolve_strict_verified_staff(text,text)','EXECUTE')
 OR has_schema_privilege(name,'ms','CREATE')
 OR has_table_privilege(name,'ms.staff_users','SELECT')
 OR has_table_privilege(name,'ms.role_templates','SELECT')
 OR has_table_privilege(name,'ms.user_role_grants','SELECT')
 OR has_table_privilege(name,'ms.staff_identity_bindings','SELECT')
 OR has_table_privilege(name,'ms.identity_change_requests','SELECT')
 OR has_table_privilege(name,'ms.identity_change_decisions','SELECT')
 OR has_table_privilege(name,'ms.students','SELECT')
 OR has_table_privilege(name,'ms.contacts','SELECT')
 OR has_table_privilege(name,'ms.audit_events','UPDATE')
 OR has_table_privilege(name,'ms.sales_orders','SELECT')
 OR has_function_privilege(name,
   'ms.create_scoped_student(text,text,text,text)','EXECUTE')
 THEN RAISE EXCEPTION 'Auth directory must have EXECUTE only and never raw tables or writes';
 END IF;
 RAISE NOTICE 'PASS: identity directory has function-only read access, no raw identity, customer, role, audit, finance or write privileges';
END $test$;
