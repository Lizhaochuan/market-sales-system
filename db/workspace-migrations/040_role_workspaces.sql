-- Opt-in isolated role workspaces; existing Lead IDs and sales histories remain.
BEGIN;
DO $$ BEGIN IF current_database() NOT IN ('ms_test','ms_workspace_test') THEN RAISE EXCEPTION 'Isolated database required'; END IF; END $$;
CREATE TABLE ms_workspace.lead_directory(
 lead_id uuid PRIMARY KEY REFERENCES ms.leads(id),organization_id uuid NOT NULL REFERENCES ms.organizations(id),
 phone text CHECK(phone IS NULL OR phone ~ '^\+?[0-9]{7,15}$'),
 department text NOT NULL CHECK(department IN('market','sales')),
 market_owner_id uuid REFERENCES ms.staff_users(id),marketing_notes text,
 handed_to uuid REFERENCES ms.staff_users(id),handed_at timestamptz,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX directory_phone ON ms_workspace.lead_directory(organization_id,phone) WHERE phone IS NOT NULL;
-- Existing managed customers stay with sales. Unstructured contact text is NOT guessed.
INSERT INTO ms_workspace.lead_directory(lead_id,organization_id,phone,department)
 SELECT lead_id,organization_id,CASE WHEN regexp_replace(contact_info,'[\s()-]','','g') ~ '^\+?[0-9]{7,15}$' THEN regexp_replace(contact_info,'[\s()-]','','g') END,'sales' FROM ms_workspace.lead_workflow;
REVOKE ALL ON ms_workspace.lead_directory FROM PUBLIC;
INSERT INTO ms_workspace.schema_versions(version) VALUES(35);
COMMIT;
