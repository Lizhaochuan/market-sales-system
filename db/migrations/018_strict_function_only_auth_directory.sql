-- V3.2-15: strict HTTP identity resolution uses one dedicated function-only
-- database LOGIN. Never query staff, roles, identity subjects or evidence
-- using the broad business database principal in strict mode.
-- Disposable fictional PostgreSQL 16 ONLY. Apply after 001..017.
BEGIN;

CREATE ROLE ms_strict_auth_directory_reader NOLOGIN;
GRANT USAGE ON SCHEMA ms TO ms_strict_auth_directory_reader;

CREATE FUNCTION ms.resolve_strict_verified_staff(
  p_issuer text,p_subject text
) RETURNS TABLE(
  staff_id uuid,
  organization_id uuid,
  display_name text,
  role_codes text[]
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,ms
AS $strict_staff$
  SELECT s.id,s.organization_id,s.display_name,
     ARRAY(
       SELECT DISTINCT rt.role_code
       FROM ms.user_role_grants rg
       JOIN ms.role_templates rt ON rt.id=rg.role_id
       WHERE rg.user_id=s.id AND rt.organization_id=s.organization_id
         AND rg.revoked_at IS NULL AND rg.valid_from<=now()
       ORDER BY rt.role_code
     )::text[]
  FROM ms.staff_identity_bindings b
  JOIN ms.staff_users s ON s.id=b.staff_user_id
  JOIN ms.organizations o ON o.id=s.organization_id
  JOIN ms.identity_change_requests q ON q.id=b.approval_request_id
  JOIN ms.identity_change_decisions d ON d.request_id=q.id
  WHERE b.issuer=p_issuer AND b.subject=p_subject
    AND p_issuer IS NOT NULL AND p_subject IS NOT NULL
    AND b.revoked_at IS NULL
    AND s.status='active' AND o.status='active'
    AND q.action='bind' AND q.status='approved'
    AND q.organization_id=s.organization_id
    AND q.target_staff_id=s.id
    AND q.issuer=b.issuer AND q.subject=b.subject
    AND q.decided_by=d.reviewer_user_id AND d.decision='approved'
    AND q.requested_by<>q.decided_by
    AND q.target_staff_id<>q.decided_by
  LIMIT 2
$strict_staff$;

-- No public EXECUTE, no schema modification and no raw base-table SELECT.
REVOKE ALL ON FUNCTION ms.resolve_strict_verified_staff(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ms.resolve_strict_verified_staff(text,text)
  TO ms_strict_auth_directory_reader;

-- An approved staff name is a workplace label, not a public employee directory:
-- this function MUST be called only after RS256 trusted signature validation.
-- No issuer/subject, underlying role grant, phone or proof column is returned.
COMMIT;
