-- Internal requests for a lead without a primary workflow. Resolution is audited
-- in the same transaction that repairs the lead's activity chain.
BEGIN;
DO $$ BEGIN
 IF current_database() NOT IN ('ms_test','ms_workspace_test') THEN
  RAISE EXCEPTION 'Arrangement supervision requires an isolated database';
 END IF;
END $$;

CREATE TABLE ms_workspace.arrangement_supervision (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES ms.organizations(id),
 lead_id uuid NOT NULL REFERENCES ms.leads(id),
 issued_by uuid NOT NULL REFERENCES ms.staff_users(id),
 reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 1000),
 due_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK (due_at>created_at)
);
CREATE INDEX arrangement_supervision_lead ON ms_workspace.arrangement_supervision(organization_id,lead_id);
CREATE TRIGGER immutable_arrangement_supervision
 BEFORE UPDATE OR DELETE OR TRUNCATE ON ms_workspace.arrangement_supervision
 FOR EACH STATEMENT EXECUTE FUNCTION ms_workspace.immutable_history();

CREATE VIEW ms_workspace.arrangement_supervision_status AS
 SELECT a.*,e.id AS evidence_event_id,e.activity_id,e.recorded_at AS resolved_at
 FROM ms_workspace.arrangement_supervision a
 LEFT JOIN LATERAL (
  SELECT e.id,r.id AS activity_id,e.happened_at AS recorded_at
  FROM ms.audit_events e
  JOIN ms_workspace.records r ON r.lead_id=e.target_id AND r.organization_id=e.organization_id
   AND r.id::text=e.after_business_json->>'primary_activity_id' AND r.kind IN ('tasks','appointments')
  WHERE e.organization_id=a.organization_id AND e.target_type='lead' AND e.target_id=a.lead_id
   AND e.event_name='V34_ARRANGEMENT_REPAIRED'
   AND e.after_business_json->>'arrangement_supervision_id'=a.id::text
   AND e.after_business_json->>'terminal_state'='open'
  ORDER BY e.happened_at,e.id LIMIT 1
 ) e ON true;

REVOKE ALL ON ms_workspace.arrangement_supervision,ms_workspace.arrangement_supervision_status FROM PUBLIC;
INSERT INTO ms_workspace.schema_versions(version) VALUES(39);
COMMIT;
