-- Isolated directory and grants. Workflow decisions remain in append-only lead audit.
BEGIN;
DO $$ BEGIN
 IF current_database() NOT IN ('ms_test','ms_workspace_test') THEN
  RAISE EXCEPTION 'Service campus directory requires an isolated database';
 END IF;
END $$;

CREATE TABLE ms_workspace.service_campuses (
 organization_id uuid NOT NULL REFERENCES ms.organizations(id),
 code text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{0,39}$'),
 display_name text NOT NULL CHECK (length(trim(display_name))>0),
 active boolean NOT NULL DEFAULT true,
 PRIMARY KEY(organization_id,code)
);
CREATE TABLE ms_workspace.service_campus_grants (
 organization_id uuid NOT NULL REFERENCES ms.organizations(id),
 staff_id uuid NOT NULL REFERENCES ms.staff_users(id),
 campus_code text NOT NULL,
 revoked_at timestamptz,
 PRIMARY KEY(organization_id,staff_id,campus_code),
 CHECK (campus_code='@unassigned' OR campus_code ~ '^[A-Z0-9][A-Z0-9_-]{0,39}$')
);
REVOKE ALL ON ms_workspace.service_campuses,ms_workspace.service_campus_grants FROM PUBLIC;
INSERT INTO ms_workspace.schema_versions(version) VALUES(41);
COMMIT;
