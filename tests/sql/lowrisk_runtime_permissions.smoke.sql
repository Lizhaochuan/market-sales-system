-- V3.2-04 simulated runtime privilege checks.
-- Apply after migrations 001-008 AND fictional_ui_demo_seed.sql.
-- All changes rollback; testing role is NOLOGIN and not production configuration.
BEGIN;
SET LOCAL ROLE ms_lowrisk_runtime;
DO $check$
BEGIN
  IF current_user <> 'ms_lowrisk_runtime' THEN
    RAISE EXCEPTION 'FAIL: not executing as the restricted role';
  END IF;
  PERFORM count(*) FROM ms.students;
  PERFORM count(*) FROM ms.identity_change_requests;

  BEGIN
    PERFORM count(*) FROM ms.sales_orders;
    RAISE EXCEPTION 'FAIL: runtime role can read sales orders';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  BEGIN
    PERFORM count(*) FROM ms.payment_receipt_projections;
    RAISE EXCEPTION 'FAIL: runtime role can read finance payments';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  BEGIN
    PERFORM count(*) FROM ms.refund_projections;
    RAISE EXCEPTION 'FAIL: runtime role can read finance refunds';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  BEGIN
    PERFORM count(*) FROM ms.crm_entitlement_links;
    RAISE EXCEPTION 'FAIL: runtime role can read CRM class entitlements';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  BEGIN
    UPDATE ms.staff_users SET status='disabled' WHERE false;
    RAISE EXCEPTION 'FAIL: runtime role can disable employees directly';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  BEGIN
    UPDATE ms.user_role_grants SET revoked_at=now() WHERE false;
    RAISE EXCEPTION 'FAIL: runtime role can edit employee roles';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  BEGIN
    UPDATE ms.audit_events SET reason_zh='篡改' WHERE false;
    RAISE EXCEPTION 'FAIL: runtime role can alter audit history';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  BEGIN
    DELETE FROM ms.identity_change_decisions WHERE false;
    RAISE EXCEPTION 'FAIL: runtime role can remove identity approval history';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  BEGIN
    INSERT INTO ms.staff_identity_bindings(staff_user_id,issuer,subject,bound_by)
    VALUES('20000000-0000-4000-8000-000000000011',
      'https://fictional-runtime-check.invalid','unapproved-staff-identity',
      '20000000-0000-4000-8000-000000000013');
    RAISE EXCEPTION 'FAIL: unrestricted direct identity binding';
  EXCEPTION WHEN check_violation THEN NULL; END;

  BEGIN
    EXECUTE 'CREATE TABLE ms.unauthorized_runtime_ddl(id integer)';
    RAISE EXCEPTION 'FAIL: runtime role can create schema objects';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  RAISE NOTICE 'PASS: least-privilege isolated runtime denied finance, identity bypass, role edits, audit rewrites and DDL';
END $check$;
ROLLBACK;
