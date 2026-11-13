-- V3.2-07 isolated read-only column projection.
-- This is one separate lower-privilege pattern, NOT migration of all API reads.
-- The broader ms_lowrisk_runtime principal remains a production P0 blocker.
BEGIN;
CREATE VIEW ms.student_directory_public
  WITH (security_barrier=true) AS
SELECT s.id AS student_id, s.display_name, s.organization_id
FROM ms.students AS s
WHERE s.organization_id=ms.current_database_tenant()
  AND s.archived_at IS NULL;

REVOKE ALL ON ms.student_directory_public FROM PUBLIC;
CREATE ROLE ms_student_directory_reader NOLOGIN;
GRANT USAGE ON SCHEMA ms TO ms_student_directory_reader;
GRANT EXECUTE ON FUNCTION ms.current_database_tenant()
  TO ms_student_directory_reader;
GRANT SELECT ON ms.student_directory_public
  TO ms_student_directory_reader;
-- Deliberately NO SELECT on students/contacts/staff_users/financial tables.
-- This reader must NOT inherit ms_lowrisk_runtime or unrestricted table rights.
COMMIT;
