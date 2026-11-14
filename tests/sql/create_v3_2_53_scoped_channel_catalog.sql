\set ON_ERROR_STOP on
-- V3.2-53 CI-ONLY scoped M01 projection. NOT a numbered production migration.
-- Execute only inside the disposable PostgreSQL 16 GitHub test database,
-- after migrations 001..038 and employee test-login provisioning.
BEGIN;
CREATE VIEW ms.scoped_marketing_channel_catalog
WITH (security_barrier=true) AS
SELECT ch.id,ch.organization_id,ch.parent_id,ch.name,ch.channel_type,ch.status
FROM ms.marketing_channels AS ch
WHERE ch.organization_id=ms.current_scoped_organization_id()
  AND ms.current_scoped_staff_id() IS NOT NULL;
REVOKE ALL ON ms.scoped_marketing_channel_catalog FROM PUBLIC;
GRANT SELECT ON ms.scoped_marketing_channel_catalog TO ms_student_assignee_reader;
COMMIT;

DO $privileges$
DECLARE login_name text;
BEGIN
 FOREACH login_name IN ARRAY ARRAY[
 'ms_assignee_reader_a','ms_assignee_reader_b','ms_assignee_reader_manager'
 ] LOOP
  IF NOT has_table_privilege(login_name,'ms.scoped_marketing_channel_catalog','SELECT')
   OR has_table_privilege(login_name,'ms.marketing_channels','SELECT')
   OR has_table_privilege(login_name,'ms.marketing_channels','INSERT')
   OR has_table_privilege(login_name,'ms.marketing_channels','UPDATE')
   OR has_table_privilege(login_name,'ms.marketing_channels','DELETE')
   OR has_table_privilege(login_name,'ms.database_principal_staff','SELECT')
   OR has_table_privilege(login_name,'ms.students','SELECT')
   OR has_table_privilege(login_name,'ms.sales_orders','SELECT')
   OR has_table_privilege(login_name,'ms.payment_allocations','SELECT')
   OR has_table_privilege(login_name,'ms.crm_entitlement_links','SELECT')
   OR NOT has_function_privilege(login_name,
    'ms.scoped_employee_identity_valid(text,text)','EXECUTE')
  THEN
   RAISE EXCEPTION 'M01 isolated channel view must not broaden principal %',login_name;
  END IF;
 END LOOP;
END $privileges$;
