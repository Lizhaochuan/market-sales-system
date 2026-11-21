BEGIN;
DO $$
BEGIN
 IF current_database() NOT IN ('ms_test','ms_workspace_test') THEN
  RAISE EXCEPTION 'Mobile task projection requires an isolated test database';
 END IF;
END $$;
CREATE VIEW ms.scoped_mobile_tasks WITH (security_barrier=true) AS
SELECT r.id,r.lead_id,r.kind,r.state,r.body->>'title' AS title,
       r.body->>'due_at' AS due_at
FROM ms_workspace.records r
JOIN ms.leads l ON l.id=r.lead_id AND l.organization_id=r.organization_id
JOIN ms_workspace.lead_workflow w ON w.lead_id=l.id AND w.organization_id=l.organization_id
WHERE r.organization_id=ms.current_scoped_organization_id()
 AND r.owner_user_id=ms.current_scoped_staff_id()
 AND l.owner_user_id=r.owner_user_id
 AND w.terminal_state='open' AND NOT w.do_not_contact
 AND r.kind IN ('tasks','appointments')
 AND r.state IN ('open','pending','confirmed','rescheduled','in_progress')
 AND r.body->>'due_at' IS NOT NULL;
REVOKE ALL ON ms.scoped_mobile_tasks FROM PUBLIC;
GRANT SELECT ON ms.scoped_mobile_tasks TO ms_student_assignee_reader;
INSERT INTO ms_workspace.schema_versions(version) VALUES(42);
COMMIT;
