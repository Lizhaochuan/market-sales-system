-- V3.2-10: restricted read projections for migrating existing sales GET APIs.
-- No financial, raw personal contact or employee roster access.
-- Isolated fictional PostgreSQL 16 only, after migrations 001..013.
BEGIN;

CREATE VIEW ms.scoped_legacy_student_details
WITH (security_barrier=true) AS
SELECT s.student_id,s.display_name,
       CASE WHEN raw.owner_user_id=ms.current_scoped_staff_id()
         THEN raw.owner_user_id ELSE NULL::uuid END AS owner_user_id
FROM ms.student_directory_assigned s
JOIN ms.students raw ON raw.id=s.student_id
WHERE s.organization_id=ms.current_scoped_organization_id();

CREATE VIEW ms.scoped_legacy_lead_details
WITH (security_barrier=true) AS
SELECT l.lead_id,raw.contact_id
FROM ms.scoped_leads_directory l
JOIN ms.leads raw ON raw.id=l.lead_id
WHERE raw.owner_user_id=ms.current_scoped_staff_id()
  AND raw.organization_id=ms.current_scoped_organization_id();

CREATE VIEW ms.scoped_legacy_lead_student_links
WITH (security_barrier=true) AS
SELECT ls.lead_id,ls.student_id
FROM ms.lead_students ls
JOIN ms.scoped_legacy_lead_details l ON l.lead_id=ls.lead_id
JOIN ms.student_directory_assigned s ON s.student_id=ls.student_id
WHERE s.organization_id=ms.current_scoped_organization_id();

CREATE VIEW ms.scoped_legacy_opportunity_details
WITH (security_barrier=true) AS
SELECT o.opportunity_id,o.student_id,
       ms.current_scoped_staff_id() AS owner_user_id,
       o.stage,o.lifecycle_state
FROM ms.scoped_opportunities_directory o
WHERE ms.current_scoped_staff_id() IS NOT NULL;

REVOKE ALL ON
  ms.scoped_legacy_student_details,
  ms.scoped_legacy_lead_details,
  ms.scoped_legacy_lead_student_links,
  ms.scoped_legacy_opportunity_details FROM PUBLIC;

GRANT SELECT ON
  ms.scoped_legacy_student_details,
  ms.scoped_legacy_lead_details,
  ms.scoped_legacy_lead_student_links,
  ms.scoped_legacy_opportunity_details TO ms_student_assignee_reader;

-- Important: all four views use view-owner access to raw tables, but
-- readers receive ONLY SELECT on the restricted views, never raw grants.
COMMIT;
