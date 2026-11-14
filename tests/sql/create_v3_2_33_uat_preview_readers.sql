\set ON_ERROR_STOP on
-- Dedicated simulated viewer LOGINs; separate from all proposal/writer LOGINs.
CREATE ROLE ms_uat_preview_a LOGIN INHERIT NOSUPERUSER
 NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE ms_uat_preview_a PASSWORD :'preview_password_a';
CREATE ROLE ms_uat_preview_b LOGIN INHERIT NOSUPERUSER
 NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE ms_uat_preview_b PASSWORD :'preview_password_b';
GRANT ms_uat_preview_reader TO ms_uat_preview_a,ms_uat_preview_b;
INSERT INTO ms.database_principal_staff(principal_name,organization_id,staff_user_id)
VALUES
 ('ms_uat_preview_a','20000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000015'),
 ('ms_uat_preview_b','20000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000021');

DO $guard$
DECLARE principal text;
BEGIN
 FOREACH principal IN ARRAY ARRAY['ms_uat_preview_a','ms_uat_preview_b']
 LOOP
  IF has_table_privilege(principal,'ms.source_readiness_requests','SELECT')
   OR has_table_privilege(principal,'ms.integration_missing_evidence_events','SELECT')
   OR has_table_privilege(principal,'ms.sales_orders','SELECT')
   OR has_table_privilege(principal,'ms.payment_allocations','SELECT')
   OR has_table_privilege(principal,'ms.crm_entitlement_links','SELECT')
   OR has_table_privilege(principal,'ms.sales_orders','UPDATE')
   OR has_table_privilege(principal,'ms.integration_missing_evidence_events','INSERT')
   OR has_function_privilege(principal,
     'ms.record_integration_missing_evidence(uuid,text,text,text,text,text)','EXECUTE')
   OR has_function_privilege(principal,
     'ms.propose_fixture_source_readiness(text,text,text,text,text,text)','EXECUTE')
   OR NOT has_function_privilege(principal,
     'ms.readonly_integration_uat_report(uuid)','EXECUTE')
   OR NOT has_function_privilege(principal,
     'ms.scoped_employee_identity_valid(text,text)','EXECUTE')
   OR NOT has_table_privilege(principal,'ms.scoped_uat_preview_choices','SELECT')
  THEN RAISE EXCEPTION 'V3.2-33 viewer requires function-only access: %',principal;
  END IF;
 END LOOP;
END $guard$;
