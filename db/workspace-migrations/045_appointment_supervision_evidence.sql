-- A version copied during ownership transfer is not a new appointment outcome.
BEGIN;
DO $$ BEGIN
 IF current_database() NOT IN ('ms_test','ms_workspace_test') THEN
  RAISE EXCEPTION 'Appointment supervision requires an isolated database';
 END IF;
END $$;

CREATE OR REPLACE VIEW ms_workspace.appointment_supervision_status AS
 SELECT a.*,h.version AS resolved_version,h.state AS resolution_state,h.recorded_at AS resolved_at
 FROM ms_workspace.appointment_supervision a
 LEFT JOIN LATERAL (
  SELECT h.version,h.state,h.recorded_at
  FROM ms_workspace.history h
  JOIN ms_workspace.history prior ON prior.record_id=h.record_id AND prior.version=h.version-1
  WHERE h.record_id=a.appointment_id AND h.version>a.appointment_version
   AND (
    (h.state IN ('completed','no_show','cancelled') AND h.state<>prior.state)
    OR (h.state='rescheduled' AND h.body->>'due_at' IS DISTINCT FROM prior.body->>'due_at')
   )
  ORDER BY h.version LIMIT 1
 ) h ON true;

INSERT INTO ms_workspace.schema_versions(version) VALUES(40);
COMMIT;
