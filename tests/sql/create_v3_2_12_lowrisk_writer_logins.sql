-- CI ONLY, after 016. Fictional A/B function-only low-risk writer LOGINs.
\set ON_ERROR_STOP on
CREATE ROLE ms_write_a LOGIN INHERIT NOSUPERUSER NOCREATEDB
  NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE ms_write_b LOGIN INHERIT NOSUPERUSER NOCREATEDB
  NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE ms_write_a PASSWORD :'write_password_a';
ALTER ROLE ms_write_b PASSWORD :'write_password_b';
GRANT ms_scoped_lowrisk_writer TO ms_write_a,ms_write_b;
INSERT INTO ms.database_principal_staff(
  principal_name,organization_id,staff_user_id)
VALUES
('ms_write_a','20000000-0000-4000-8000-000000000001',
 '20000000-0000-4000-8000-000000000011'),
('ms_write_b','20000000-0000-4000-8000-000000000001',
 '20000000-0000-4000-8000-000000000012');
DO $check$
DECLARE p text;
BEGIN
 FOREACH p IN ARRAY ARRAY['ms_write_a','ms_write_b'] LOOP
   IF has_table_privilege(p,'ms.students','SELECT')
      OR has_table_privilege(p,'ms.students','INSERT')
      OR has_table_privilege(p,'ms.contacts','SELECT')
      OR has_table_privilege(p,'ms.contacts','INSERT')
      OR has_table_privilege(p,'ms.student_access_requests','SELECT')
      OR has_table_privilege(p,'ms.sales_orders','SELECT')
      OR has_table_privilege(p,'ms.audit_events','UPDATE')
      OR has_schema_privilege(p,'ms','CREATE')
      OR NOT has_function_privilege(p,
        'ms.create_scoped_student(text,text,text,text)','EXECUTE')
      OR NOT has_function_privilege(p,
        'ms.create_scoped_contact(text,boolean,text)','EXECUTE')
      OR NOT has_function_privilege(p,
        'ms.link_scoped_student_contact(uuid,uuid,text,text)','EXECUTE')
      OR NOT has_function_privilege(p,
        'ms.create_scoped_contact_consultation(uuid,text,timestamptz,text)','EXECUTE')
      OR NOT has_function_privilege(p,
        'ms.request_scoped_contact_custody(uuid,uuid,text,text,text)','EXECUTE')
      OR NOT has_function_privilege(p,
        'ms.decide_scoped_contact_custody(uuid,text,text,text,text)','EXECUTE')
   THEN RAISE EXCEPTION 'Low-risk writer must retain function-only privileges: %',p;
   END IF;
 END LOOP;
END $check$;
