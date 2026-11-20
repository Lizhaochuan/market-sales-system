-- Isolated supervisor requests and their evidence from existing appointment history.
BEGIN;
DO $$ BEGIN
 IF current_database() NOT IN ('ms_test','ms_workspace_test') THEN
  RAISE EXCEPTION 'Appointment supervision requires an isolated database';
 END IF;
END $$;

CREATE TABLE ms_workspace.appointment_supervision (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES ms.organizations(id),
 lead_id uuid NOT NULL REFERENCES ms.leads(id),
 appointment_id uuid NOT NULL,
 appointment_version integer NOT NULL,
 issued_by uuid NOT NULL REFERENCES ms.staff_users(id),
 reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 1000),
 due_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK (due_at>created_at),
 UNIQUE (appointment_id,appointment_version),
 FOREIGN KEY (appointment_id,appointment_version) REFERENCES ms_workspace.history(record_id,version)
);
CREATE INDEX appointment_supervision_lead ON ms_workspace.appointment_supervision(organization_id,lead_id);
CREATE TRIGGER immutable_appointment_supervision
 BEFORE UPDATE OR DELETE OR TRUNCATE ON ms_workspace.appointment_supervision
 FOR EACH STATEMENT EXECUTE FUNCTION ms_workspace.immutable_history();

CREATE VIEW ms_workspace.appointment_supervision_status AS
 SELECT a.*,h.version AS resolved_version,h.state AS resolution_state,h.recorded_at AS resolved_at
 FROM ms_workspace.appointment_supervision a
 LEFT JOIN LATERAL (
  SELECT version,state,recorded_at FROM ms_workspace.history
  WHERE record_id=a.appointment_id AND version>a.appointment_version
   AND state IN ('completed','no_show','cancelled','rescheduled')
  ORDER BY version LIMIT 1
 ) h ON true;

REVOKE ALL ON ms_workspace.appointment_supervision,ms_workspace.appointment_supervision_status FROM PUBLIC;
INSERT INTO ms_workspace.schema_versions(version) VALUES(37);
COMMIT;
