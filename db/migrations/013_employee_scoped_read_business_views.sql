-- V3.2-09: isolated employee read-only projections, not a full API migration.
-- 013 requires 001..012 and is safe only in a disposable fictional PG16 DB.
BEGIN;

-- The LOGIN->employee mapping was created in 012 by the migration owner.
-- A scoped read employee cannot SELECT or UPDATE that protected table.
CREATE FUNCTION ms.current_scoped_staff_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, ms
AS $employee$
 SELECT s.id FROM ms.database_principal_staff p
 JOIN ms.staff_users s ON s.id=p.staff_user_id
 JOIN ms.organizations o ON o.id=p.organization_id
 WHERE p.principal_name=session_user::name AND p.organization_id=s.organization_id
   AND s.status='active' AND o.status='active' LIMIT 1
$employee$;
REVOKE ALL ON FUNCTION ms.current_scoped_staff_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ms.current_scoped_staff_id()
  TO ms_student_assignee_reader;

-- Every HTTP read validates the actual signed external identity AGAINST
-- this exact fixed database principal, NOT org_id, role or staff_id claims.
CREATE FUNCTION ms.scoped_employee_identity_valid(p_issuer text,p_subject text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, ms
AS $identity$
 SELECT EXISTS (
   SELECT 1 FROM ms.database_principal_staff p
   JOIN ms.staff_users s ON s.id=p.staff_user_id
     AND s.organization_id=p.organization_id AND s.status='active'
   JOIN ms.organizations o ON o.id=p.organization_id AND o.status='active'
   JOIN ms.staff_identity_bindings b ON b.staff_user_id=s.id
     AND b.issuer=p_issuer AND b.subject=p_subject AND b.revoked_at IS NULL
   JOIN ms.identity_change_requests q ON q.id=b.approval_request_id
     AND q.action='bind' AND q.status='approved'
     AND q.organization_id=p.organization_id AND q.target_staff_id=s.id
     AND q.issuer=b.issuer AND q.subject=b.subject
   JOIN ms.identity_change_decisions d ON d.request_id=q.id
     AND d.decision='approved' AND d.reviewer_user_id=q.decided_by
     AND q.requested_by<>d.reviewer_user_id AND q.target_staff_id<>d.reviewer_user_id
   WHERE p.principal_name=session_user::name
 )
$identity$;
REVOKE ALL ON FUNCTION ms.scoped_employee_identity_valid(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ms.scoped_employee_identity_valid(text,text)
  TO ms_student_assignee_reader;

-- Only non-sensitive fields; do not expose phone, social ID, lead evidence,
-- raw interaction summary, predicted money, internal employee roster, or grade.
CREATE VIEW ms.scoped_contacts_directory
WITH (security_barrier=true) AS
SELECT c.id AS contact_id,c.display_name,c.do_not_contact
FROM ms.contacts c
WHERE c.organization_id=ms.current_database_tenant() AND c.archived_at IS NULL
  AND ms.current_scoped_staff_id() IS NOT NULL
  AND (
    c.created_by=ms.current_scoped_staff_id()
    OR EXISTS (
      SELECT 1 FROM ms.leads l
      WHERE l.contact_id=c.id AND l.organization_id=c.organization_id
        AND l.owner_user_id=ms.current_scoped_staff_id())
    OR EXISTS (
      SELECT 1 FROM ms.student_contacts sc
      JOIN ms.student_directory_assigned sd ON sd.student_id=sc.student_id
      WHERE sc.contact_id=c.id AND sc.valid_to IS NULL
        AND sd.organization_id=c.organization_id)
  );

CREATE VIEW ms.scoped_contact_events_directory
WITH (security_barrier=true) AS
SELECT e.id AS event_id,e.event_type,e.occurred_at
FROM ms.contact_events e
WHERE e.organization_id=ms.current_database_tenant()
  AND ms.current_scoped_staff_id() IS NOT NULL
  AND (
    e.recorded_by=ms.current_scoped_staff_id()
    OR EXISTS (
      SELECT 1 FROM ms.scoped_contacts_directory c WHERE c.contact_id=e.contact_id)
  );

CREATE VIEW ms.scoped_leads_directory
WITH (security_barrier=true) AS
SELECT l.id AS lead_id,l.lead_state,l.created_at
FROM ms.leads l
WHERE l.organization_id=ms.current_database_tenant()
  AND ms.current_scoped_staff_id() IS NOT NULL
  AND l.owner_user_id=ms.current_scoped_staff_id();

CREATE VIEW ms.scoped_opportunities_directory
WITH (security_barrier=true) AS
SELECT o.id AS opportunity_id,o.student_id,o.stage,o.lifecycle_state
FROM ms.opportunities o
JOIN ms.student_directory_assigned s ON s.student_id=o.student_id
WHERE s.organization_id=ms.current_database_tenant()
  AND ms.current_scoped_staff_id() IS NOT NULL
  AND o.owner_user_id=ms.current_scoped_staff_id();

REVOKE ALL ON
 ms.scoped_contacts_directory,ms.scoped_contact_events_directory,
 ms.scoped_leads_directory,ms.scoped_opportunities_directory
 FROM PUBLIC;
GRANT SELECT ON
 ms.scoped_contacts_directory,ms.scoped_contact_events_directory,
 ms.scoped_leads_directory,ms.scoped_opportunities_directory
 TO ms_student_assignee_reader;
-- NO new grants on any base table, write operation or financial tables.
COMMIT;
