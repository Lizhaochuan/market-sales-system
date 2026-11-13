\set ON_ERROR_STOP on
-- CI-only supervisor database LOGIN: same function-only writer role as A/B.
-- Manager status is resolved and rechecked from protected staff role grants.
CREATE ROLE ms_write_manager LOGIN INHERIT NOSUPERUSER NOCREATEDB
 NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE ms_write_manager PASSWORD :'manager_write_password';
GRANT ms_scoped_lowrisk_writer TO ms_write_manager;
INSERT INTO ms.database_principal_staff(principal_name,organization_id,staff_user_id)
VALUES('ms_write_manager','20000000-0000-4000-8000-000000000001',
 '20000000-0000-4000-8000-000000000013');
DO $test$
BEGIN
 IF has_table_privilege('ms_write_manager','ms.contacts','SELECT')
 OR has_table_privilege('ms_write_manager','ms.contacts','UPDATE')
 OR has_table_privilege('ms_write_manager','ms.contact_custody_requests','SELECT')
 OR has_table_privilege('ms_write_manager','ms.contact_custody_assignments','UPDATE')
 OR has_table_privilege('ms_write_manager','ms.sales_orders','SELECT')
 OR has_schema_privilege('ms_write_manager','ms','CREATE')
 OR NOT has_function_privilege('ms_write_manager',
   'ms.decide_scoped_contact_custody(uuid,text,text,text,text)','EXECUTE')
 THEN RAISE EXCEPTION 'Supervisor must not get unrestricted custody or customer table grants';
 END IF;
 RAISE NOTICE 'PASS: manager reviewer uses function-only employee DB account, no contact/table/audit bypass';
END $test$;
