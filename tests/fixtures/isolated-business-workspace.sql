-- Opt-in disposable demo storage, NOT a migration or production permission grant.
DO $$ BEGIN
 IF current_database() NOT IN ('ms_test','ms_workspace_test') THEN
  RAISE EXCEPTION 'Isolated workspace fixture requires a disposable test database';
 END IF;
END $$;
CREATE SCHEMA ms_workspace;
REVOKE ALL ON SCHEMA ms_workspace FROM PUBLIC;
CREATE TABLE ms_workspace.records (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES ms.organizations(id),
 owner_user_id uuid NOT NULL REFERENCES ms.staff_users(id),
 kind text NOT NULL CHECK(kind IN ('tasks','trials','quotes','order-intents','expense-plans','automation-rules')),
 student_id uuid REFERENCES ms.students(id),
 opportunity_id uuid REFERENCES ms.opportunities(id),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 state text NOT NULL,
 body jsonb NOT NULL,
 dedupe_key text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,owner_user_id,dedupe_key)
);
CREATE INDEX records_owner_kind ON ms_workspace.records(organization_id,owner_user_id,kind);
CREATE TABLE ms_workspace.history (
 record_id uuid NOT NULL REFERENCES ms_workspace.records(id),
 version integer NOT NULL,
 actor_user_id uuid NOT NULL REFERENCES ms.staff_users(id),
 state text NOT NULL,
 body jsonb NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(record_id,version)
);
CREATE FUNCTION ms_workspace.immutable_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Workspace history is append only'; END $$;
CREATE TRIGGER immutable_history BEFORE UPDATE OR DELETE ON ms_workspace.history
FOR EACH ROW EXECUTE FUNCTION ms_workspace.immutable_history();
REVOKE ALL ON ALL TABLES IN SCHEMA ms_workspace FROM PUBLIC;
