-- Additive opt-in V3.4 migration. Run only AFTER the isolated workspace fixture.
BEGIN;
DO $$ BEGIN
 IF current_database() NOT IN ('ms_test','ms_workspace_test') THEN RAISE EXCEPTION 'V3.4 requires isolated database'; END IF;
END $$;
CREATE TABLE IF NOT EXISTS ms_workspace.schema_versions(version integer PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE ms_workspace.records DROP CONSTRAINT records_kind_check;
ALTER TABLE ms_workspace.records ADD CONSTRAINT records_kind_check CHECK(kind IN ('tasks','trials','quotes','order-intents','expense-plans','automation-rules','appointments','enrollments','payments','refunds','corrections','discounts','workflow-drafts','course-catalog'));
ALTER TABLE ms_workspace.records ADD COLUMN lead_id uuid REFERENCES ms.leads(id);
CREATE INDEX workspace_lead_records ON ms_workspace.records(lead_id,kind,state);
CREATE UNIQUE INDEX one_local_payment_reference ON ms_workspace.records(organization_id,(body->>'receipt_ref')) WHERE kind='payments';
CREATE UNIQUE INDEX one_local_refund_reference ON ms_workspace.records(organization_id,(body->>'refund_ref')) WHERE kind='refunds';
CREATE UNIQUE INDEX one_local_course_name ON ms_workspace.records(organization_id,lower(body->>'course_label')) WHERE kind='course-catalog';
CREATE TABLE ms_workspace.lead_workflow(
 lead_id uuid PRIMARY KEY REFERENCES ms.leads(id),organization_id uuid NOT NULL REFERENCES ms.organizations(id),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),stage text NOT NULL DEFAULT 'needs_discovery',
 terminal_state text NOT NULL DEFAULT 'open' CHECK(terminal_state IN('open','won','lost')),
 primary_activity_id uuid REFERENCES ms_workspace.records(id) DEFERRABLE INITIALLY DEFERRED,
 do_not_contact boolean NOT NULL DEFAULT false,contact_info text,pause_reason text,
 updated_at timestamptz NOT NULL DEFAULT now(),CHECK(NOT do_not_contact OR terminal_state<>'open')
);
CREATE FUNCTION ms_workspace.assert_active_chain(lid uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE w ms_workspace.lead_workflow; l ms.leads;
BEGIN
 SELECT * INTO w FROM ms_workspace.lead_workflow WHERE lead_id=lid;
 IF NOT FOUND OR w.terminal_state<>'open' THEN RETURN; END IF;
 SELECT * INTO l FROM ms.leads WHERE id=lid;
 IF w.organization_id<>l.organization_id OR NOT EXISTS(
  SELECT 1 FROM ms_workspace.records r WHERE r.id=w.primary_activity_id AND r.lead_id=lid
   AND r.organization_id=w.organization_id AND r.owner_user_id=l.owner_user_id
   AND r.kind IN('tasks','appointments') AND r.state IN('open','in_progress','confirmed','rescheduled','pending')
   AND r.body->>'due_at' IS NOT NULL AND r.body->>'method' IS NOT NULL
   AND length(r.body->>'action')>0 AND length(r.body->>'title')>0
 ) THEN RAISE EXCEPTION 'Open Lead must have a dated, assigned next action' USING ERRCODE='23514'; END IF;
END $$;
CREATE FUNCTION ms_workspace.guard_active_chain() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='lead_workflow' THEN
  PERFORM ms_workspace.assert_active_chain(COALESCE(NEW.lead_id,OLD.lead_id));
 ELSE
  IF TG_OP<>'INSERT' AND OLD.lead_id IS NOT NULL THEN PERFORM ms_workspace.assert_active_chain(OLD.lead_id); END IF;
  IF TG_OP<>'DELETE' AND NEW.lead_id IS NOT NULL THEN PERFORM ms_workspace.assert_active_chain(NEW.lead_id); END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER valid_open_chain AFTER INSERT OR UPDATE ON ms_workspace.lead_workflow DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ms_workspace.guard_active_chain();
CREATE CONSTRAINT TRIGGER retained_open_chain AFTER INSERT OR UPDATE OR DELETE ON ms_workspace.records DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ms_workspace.guard_active_chain();
REVOKE ALL ON ALL TABLES IN SCHEMA ms_workspace FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ms_workspace FROM PUBLIC;
INSERT INTO ms_workspace.schema_versions(version) VALUES(34);
COMMIT;
