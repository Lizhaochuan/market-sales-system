\set ON_ERROR_STOP on
-- Restricted CI-only source-security reviewer may read the combined
-- finance + academic requirements, not any raw child, money or CRM tables.
GRANT ms_joint_uat_report_reader TO ms_fixture_source_security;
DO $guard$
BEGIN
 IF has_table_privilege('ms_fixture_source_security',
     'ms.integration_required_checks','SELECT')
 OR has_table_privilege('ms_fixture_source_security',
     'ms.integration_missing_evidence_events','SELECT')
 OR has_table_privilege('ms_fixture_source_security',
     'ms.sales_orders','UPDATE')
 OR has_table_privilege('ms_fixture_source_security',
     'ms.payment_allocations','UPDATE')
 OR has_table_privilege('ms_fixture_source_security',
     'ms.crm_entitlement_links','UPDATE')
 OR NOT has_function_privilege('ms_fixture_source_security',
     'ms.readonly_joint_integration_uat_report(uuid,uuid)','EXECUTE')
 OR has_function_privilege('ms_plan_finance_reviewer',
     'ms.readonly_joint_integration_uat_report(uuid,uuid)','EXECUTE')
 OR has_function_privilege('ms_plan_academic_reviewer',
     'ms.readonly_joint_integration_uat_report(uuid,uuid)','EXECUTE')
 OR has_function_privilege('ms_plan_finance_b',
     'ms.readonly_joint_integration_uat_report(uuid,uuid)','EXECUTE')
 THEN RAISE EXCEPTION 'Joint UAT report must remain security-only and strictly read-only';
 END IF;
END $guard$;
