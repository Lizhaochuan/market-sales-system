-- Record observable student and lead-link state from this migration onward.
BEGIN;
DO $$ BEGIN
 IF current_database() NOT IN ('ms_test','ms_workspace_test') THEN
  RAISE EXCEPTION 'Student link history requires an isolated database';
 END IF;
END $$;

-- Prevent a concurrent write from falling between the baseline and trigger installation.
LOCK TABLE ms.students, ms.lead_students IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE ms_workspace.student_archive_history (
 event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 organization_id uuid NOT NULL,
 student_id uuid NOT NULL,
 active boolean NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX student_archive_history_lookup ON ms_workspace.student_archive_history
 (organization_id,student_id,recorded_at DESC,event_id DESC);

CREATE TABLE ms_workspace.lead_student_history (
 event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 lead_id uuid NOT NULL,
 student_id uuid NOT NULL,
 linked boolean NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX lead_student_history_lookup ON ms_workspace.lead_student_history
 (lead_id,student_id,recorded_at DESC,event_id DESC);

INSERT INTO ms_workspace.schema_versions(version,applied_at) VALUES(36,clock_timestamp());
INSERT INTO ms_workspace.student_archive_history(organization_id,student_id,active,recorded_at)
 SELECT organization_id,id,archived_at IS NULL,v.applied_at
 FROM ms.students CROSS JOIN ms_workspace.schema_versions v WHERE v.version=36;
INSERT INTO ms_workspace.lead_student_history(lead_id,student_id,linked,recorded_at)
 SELECT lead_id,student_id,confirmation_state<>'withdrawn',v.applied_at
 FROM ms.lead_students CROSS JOIN ms_workspace.schema_versions v WHERE v.version=36;

CREATE FUNCTION ms_workspace.capture_student_archive() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' OR (TG_OP='UPDATE' AND (OLD.id,OLD.organization_id)<>(NEW.id,NEW.organization_id)) THEN
  INSERT INTO ms_workspace.student_archive_history(organization_id,student_id,active)
   VALUES(OLD.organization_id,OLD.id,false);
 END IF;
 IF TG_OP='INSERT' OR (TG_OP='UPDATE' AND
   (OLD.id,OLD.organization_id,OLD.archived_at IS NULL) IS DISTINCT FROM
   (NEW.id,NEW.organization_id,NEW.archived_at IS NULL)) THEN
  INSERT INTO ms_workspace.student_archive_history(organization_id,student_id,active)
   VALUES(NEW.organization_id,NEW.id,NEW.archived_at IS NULL);
 END IF;
 RETURN NULL;
END $$;

CREATE FUNCTION ms_workspace.capture_lead_student_link() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' OR (TG_OP='UPDATE' AND (OLD.lead_id,OLD.student_id)<>(NEW.lead_id,NEW.student_id)) THEN
  INSERT INTO ms_workspace.lead_student_history(lead_id,student_id,linked)
   VALUES(OLD.lead_id,OLD.student_id,false);
 END IF;
 IF TG_OP='INSERT' OR (TG_OP='UPDATE' AND
   (OLD.lead_id,OLD.student_id,OLD.confirmation_state<>'withdrawn') IS DISTINCT FROM
   (NEW.lead_id,NEW.student_id,NEW.confirmation_state<>'withdrawn')) THEN
  INSERT INTO ms_workspace.lead_student_history(lead_id,student_id,linked)
   VALUES(NEW.lead_id,NEW.student_id,NEW.confirmation_state<>'withdrawn');
 END IF;
 RETURN NULL;
END $$;

CREATE TRIGGER student_archive_history_capture
 AFTER INSERT OR DELETE OR UPDATE OF id,organization_id,archived_at ON ms.students
 FOR EACH ROW EXECUTE FUNCTION ms_workspace.capture_student_archive();
CREATE TRIGGER lead_student_history_capture
 AFTER INSERT OR DELETE OR UPDATE OF lead_id,student_id,confirmation_state ON ms.lead_students
 FOR EACH ROW EXECUTE FUNCTION ms_workspace.capture_lead_student_link();
CREATE TRIGGER immutable_student_archive_history
 BEFORE UPDATE OR DELETE OR TRUNCATE ON ms_workspace.student_archive_history
 FOR EACH STATEMENT EXECUTE FUNCTION ms_workspace.immutable_history();
CREATE TRIGGER immutable_lead_student_history
 BEFORE UPDATE OR DELETE OR TRUNCATE ON ms_workspace.lead_student_history
 FOR EACH STATEMENT EXECUTE FUNCTION ms_workspace.immutable_history();
REVOKE ALL ON ms_workspace.student_archive_history,ms_workspace.lead_student_history FROM PUBLIC;
REVOKE ALL ON FUNCTION ms_workspace.capture_student_archive(),ms_workspace.capture_lead_student_link() FROM PUBLIC;
COMMIT;
