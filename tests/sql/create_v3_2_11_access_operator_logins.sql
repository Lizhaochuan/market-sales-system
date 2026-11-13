-- CI ONLY: separate staff-bound LOGINs for isolated student access functions.
-- No raw student, family, contact, finance or audit table privileges.
\set ON_ERROR_STOP on
CREATE ROLE ms_access_a LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS;
CREATE ROLE ms_access_b LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS;
CREATE ROLE ms_access_manager LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS;
ALTER ROLE ms_access_a PASSWORD :'pass_a';
ALTER ROLE ms_access_b PASSWORD :'pass_b';
ALTER ROLE ms_access_manager PASSWORD :'pass_m';
GRANT ms_student_access_operator TO ms_access_a,ms_access_b,ms_access_manager;
INSERT INTO ms.database_principal_staff(principal_name,organization_id,staff_user_id)
VALUES
('ms_access_a','20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000011'),
('ms_access_b','20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000012'),
('ms_access_manager','20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000013');
DO $verify$
DECLARE role_name text;
BEGIN
 FOREACH role_name IN ARRAY ARRAY['ms_access_a','ms_access_b','ms_access_manager']
 LOOP
   IF has_table_privilege(role_name,'ms.students','SELECT')
     OR has_table_privilege(role_name,'ms.data_scope_grants','SELECT')
     OR has_table_privilege(role_name,'ms.student_access_requests','SELECT')
     OR has_table_privilege(role_name,'ms.sales_orders','SELECT')
     OR has_schema_privilege(role_name,'ms','CREATE')
     OR NOT has_function_privilege(role_name,
       'ms.request_student_access(text,uuid,uuid,timestamptz,text,text,text)','EXECUTE')
   THEN RAISE EXCEPTION 'Access operator unexpectedly elevated: %',role_name;
   END IF;
 END LOOP;
END $verify$;
