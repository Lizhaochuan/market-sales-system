-- V3.2-08: isolated approved identity routing and per-employee student projection.
-- Applies only to disposable fictional databases after 001-011 migrations.
BEGIN;

-- An API gateway may resolve ONLY an already approved, active binding. It
-- cannot read staff tables, external subject lists, finance or raw audit.
CREATE ROLE ms_approved_route_reader NOLOGIN;
GRANT USAGE ON SCHEMA ms TO ms_approved_route_reader;

CREATE FUNCTION ms.approved_identity_tenant(p_issuer text,p_subject text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, ms
AS $approved_route$
  SELECT s.organization_id
  FROM ms.staff_identity_bindings b
  JOIN ms.staff_users s ON s.id=b.staff_user_id
  JOIN ms.organizations o ON o.id=s.organization_id
  JOIN ms.identity_change_requests q ON q.id=b.approval_request_id
  JOIN ms.identity_change_decisions d ON d.request_id=q.id
  WHERE b.issuer=p_issuer AND b.subject=p_subject AND b.revoked_at IS NULL
    AND s.status='active' AND o.status='active'
    AND q.status='approved' AND q.action='bind'
    AND q.organization_id=s.organization_id
    AND q.target_staff_id=s.id AND q.issuer=b.issuer AND q.subject=b.subject
    AND q.decided_by=d.reviewer_user_id AND d.decision='approved'
    AND q.requested_by<>q.decided_by AND q.target_staff_id<>q.decided_by
  LIMIT 1
$approved_route$;
REVOKE ALL ON FUNCTION ms.approved_identity_tenant(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ms.approved_identity_tenant(text,text)
  TO ms_approved_route_reader;

-- An employee's DB login is separately bound by an administrator to one
-- specific active staff member and its organization. There is no writable
-- session GUC for staff or organization; no application/employee edit grants.
CREATE TABLE ms.database_principal_staff (
  principal_name NAME PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES ms.organizations(id),
  staff_user_id UUID NOT NULL REFERENCES ms.staff_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
REVOKE ALL ON ms.database_principal_staff FROM PUBLIC;
REVOKE ALL ON ms.database_principal_staff FROM ms_lowrisk_runtime;

CREATE VIEW ms.student_directory_assigned
WITH (security_barrier=true) AS
SELECT s.id AS student_id,s.display_name,s.organization_id
FROM ms.students s
JOIN ms.database_principal_staff principal
  ON principal.principal_name=session_user::name
  AND principal.organization_id=s.organization_id
JOIN ms.staff_users staff
  ON staff.id=principal.staff_user_id AND staff.organization_id=principal.organization_id
WHERE staff.status='active' AND s.archived_at IS NULL
  AND (
    s.owner_user_id=staff.id
    OR EXISTS (
      SELECT 1 FROM ms.data_scope_grants g
      WHERE g.user_id=staff.id
        AND g.resource_type='student'
        AND g.scope_type='specific'
        AND g.scope_ref=s.id
        AND g.revoked_at IS NULL
    )
  );

REVOKE ALL ON ms.student_directory_assigned FROM PUBLIC;
CREATE ROLE ms_student_assignee_reader NOLOGIN;
GRANT USAGE ON SCHEMA ms TO ms_student_assignee_reader;
GRANT SELECT ON ms.student_directory_assigned TO ms_student_assignee_reader;
-- No privileges on the raw students, contacts, staff, roles, mapping,
-- finance or audit tables are granted to this role.
COMMIT;
