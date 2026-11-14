-- V3.2-33: strictly scoped, read-only UAT preview choices.
-- This does not add a production approval, API write, or real external source.
BEGIN;
CREATE ROLE ms_uat_preview_reader NOLOGIN;
GRANT ms_integration_gap_reader TO ms_uat_preview_reader;
GRANT USAGE ON SCHEMA ms TO ms_uat_preview_reader;
GRANT EXECUTE ON FUNCTION ms.scoped_employee_identity_valid(text,text)
 TO ms_uat_preview_reader;

CREATE VIEW ms.scoped_uat_preview_choices WITH(security_barrier=true) AS
 SELECT s.source_request_id,s.department,s.required_gate_count,
 s.recorded_missing_events,s.status_zh,
 FALSE AS production_integration_allowed,
 FALSE AS execution_allowed,
 FALSE AS release_allowed
 FROM ms.scoped_integration_readiness_summary s
 WHERE ms.current_scoped_staff_id() IS NOT NULL
   AND ms.current_scoped_organization_id() IS NOT NULL;
REVOKE ALL ON ms.scoped_uat_preview_choices FROM PUBLIC;
GRANT SELECT ON ms.scoped_uat_preview_choices TO ms_uat_preview_reader;
-- No SELECT on base tables, no INSERT/UPDATE/DELETE, no credential lookup,
-- no execution/hold-release function, no new source authorization.
COMMIT;
