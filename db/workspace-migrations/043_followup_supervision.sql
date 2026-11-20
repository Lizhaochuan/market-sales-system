-- A follow-up request is satisfied by a recorded result on its own task version.
BEGIN;
DO $$ BEGIN
 IF current_database() NOT IN ('ms_test','ms_workspace_test') THEN
  RAISE EXCEPTION 'Follow-up supervision requires an isolated database';
 END IF;
END $$;

CREATE TABLE ms_workspace.followup_supervision (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES ms.organizations(id),
 lead_id uuid NOT NULL REFERENCES ms.leads(id),
 task_id uuid NOT NULL,
 task_version integer NOT NULL,
 issued_by uuid NOT NULL REFERENCES ms.staff_users(id),
 reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 1000),
 due_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK (due_at>created_at),
 UNIQUE (task_id,task_version),
 FOREIGN KEY (task_id,task_version) REFERENCES ms_workspace.history(record_id,version)
);
CREATE INDEX followup_supervision_lead ON ms_workspace.followup_supervision(organization_id,lead_id);
CREATE TRIGGER immutable_followup_supervision
 BEFORE UPDATE OR DELETE OR TRUNCATE ON ms_workspace.followup_supervision
 FOR EACH STATEMENT EXECUTE FUNCTION ms_workspace.immutable_history();

CREATE VIEW ms_workspace.followup_supervision_status AS
 SELECT a.*,h.version AS resolved_version,h.body->'completion'->>'result' AS resolution_state,h.recorded_at AS resolved_at
 FROM ms_workspace.followup_supervision a
 LEFT JOIN LATERAL (
  SELECT h.version,h.body,h.recorded_at FROM ms_workspace.history h
  WHERE h.record_id=a.task_id AND h.version>a.task_version AND h.state='completed'
   AND EXISTS (
    SELECT 1 FROM ms.audit_events e
    WHERE e.organization_id=a.organization_id AND e.target_type='lead' AND e.target_id=a.lead_id
     AND e.event_name='V34_COMMUNICATION'
     AND e.after_business_json->>'completed_task_id'=a.task_id::text
     AND e.after_business_json->'completed_task_version'=to_jsonb(h.version)
   )
  ORDER BY h.version LIMIT 1
 ) h ON true;

REVOKE ALL ON ms_workspace.followup_supervision,ms_workspace.followup_supervision_status FROM PUBLIC;
INSERT INTO ms_workspace.schema_versions(version) VALUES(38);
COMMIT;
