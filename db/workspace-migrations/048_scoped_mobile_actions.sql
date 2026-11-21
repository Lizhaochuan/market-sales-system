BEGIN;
DO $$
BEGIN
 IF current_database() NOT IN ('ms_test','ms_workspace_test') THEN
  RAISE EXCEPTION 'Mobile actions require an isolated test database';
 END IF;
END $$;

CREATE TABLE ms_workspace.mobile_action_receipts(
 staff_id uuid NOT NULL, request_key text NOT NULL, payload_hash bytea NOT NULL,
 PRIMARY KEY(staff_id,request_key)
);
REVOKE ALL ON ms_workspace.mobile_action_receipts FROM PUBLIC;

CREATE FUNCTION ms.apply_scoped_mobile_action(
 operation text, target uuid, body jsonb, request_key text, issuer text, subject text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
 actor uuid; org uuid; roles text[]; lead ms.leads; workflow ms_workspace.lead_workflow;
 task ms_workspace.records; request ms.audit_events; replacement uuid;
 payload_hash bytea; previous_hash bytea; previous jsonb; notes text; due timestamptz; facts jsonb;
 event_prefix text; campus text; restricted boolean;
BEGIN
 SELECT staff_id,org_id INTO actor,org FROM ms.access_actor();
 IF actor IS NULL OR ms.scoped_employee_identity_valid(issuer,subject) IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'Unauthorized employee' USING ERRCODE='42501';
 END IF;
 SELECT coalesce(array_agg(r.role_code),ARRAY[]::text[]) INTO roles
 FROM ms.user_role_grants g JOIN ms.role_templates r ON r.id=g.role_id
 WHERE g.user_id=actor AND g.revoked_at IS NULL AND r.organization_id=org;
 IF NOT ('super_admin'=ANY(roles) OR
        (roles && ARRAY['sales_staff','sales_consultant','sales_manager']
         AND NOT roles && ARRAY['marketing','marketing_staff','marketing_manager','finance_verifier']))
    OR operation IN ('qualification','campus') AND NOT roles && ARRAY['sales_manager','super_admin'] THEN
  RAISE EXCEPTION 'Unauthorized role' USING ERRCODE='42501';
 END IF;
 IF target IS NULL OR request_key IS NULL OR request_key !~ '^[A-Za-z0-9_-]{16,128}$'
    OR jsonb_typeof(body) IS DISTINCT FROM 'object' THEN
  RAISE EXCEPTION 'Invalid input' USING ERRCODE='23514';
 END IF;
 payload_hash:=sha256(convert_to(jsonb_build_array(operation,target,body)::text,'UTF8'));
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||':mobile:'||request_key,0));
 IF operation='followup' THEN
  SELECT l.* INTO lead FROM ms_workspace.records r JOIN ms.leads l ON r.lead_id=l.id
  WHERE r.id=target AND r.organization_id=org AND l.organization_id=org AND l.owner_user_id=actor FOR UPDATE OF l;
 ELSIF operation IN ('qualification','campus') THEN
  event_prefix:=CASE operation WHEN 'qualification' THEN 'V34_LEAD_QUALIFICATION' ELSE 'V34_CAMPUS_TRANSFER' END;
  SELECT * INTO request FROM ms.audit_events WHERE id=target AND organization_id=org
   AND target_type='lead' AND event_name=event_prefix||'_REQUESTED';
  SELECT * INTO lead FROM ms.leads WHERE id=request.target_id AND organization_id=org FOR UPDATE;
 END IF;
 IF lead.id IS NULL OR EXISTS(SELECT 1 FROM ms_workspace.lead_directory d WHERE d.lead_id=lead.id AND d.department='market') THEN
  RAISE EXCEPTION 'Unauthorized lead' USING ERRCODE='42501';
 END IF;
 SELECT e.after_business_json->>'campus_code' INTO campus FROM ms.audit_events e
 WHERE e.organization_id=org AND e.target_type='lead' AND e.target_id=lead.id
 AND e.event_name='V34_SERVICE_CAMPUS_EFFECTIVE' AND e.happened_at<=statement_timestamp()
 AND (e.after_business_json->>'effective_at')::timestamptz<=statement_timestamp()
 ORDER BY (e.after_business_json->>'effective_at')::timestamptz DESC,e.happened_at DESC,e.id DESC LIMIT 1;
 restricted:=NOT 'super_admin'=ANY(roles) AND 'sales_manager'=ANY(roles)
  AND EXISTS(SELECT 1 FROM ms_workspace.service_campuses c WHERE c.organization_id=org);
 IF restricted AND NOT EXISTS(SELECT 1 FROM ms_workspace.service_campus_grants g
  WHERE g.organization_id=org AND g.staff_id=actor AND g.revoked_at IS NULL AND g.campus_code=coalesce(campus,'@unassigned')) THEN
  RAISE EXCEPTION 'Unauthorized campus' USING ERRCODE='42501';
 END IF;
 SELECT r.payload_hash INTO previous_hash FROM ms_workspace.mobile_action_receipts r
 WHERE r.staff_id=actor AND r.request_key=$4;
 IF FOUND THEN
  IF previous_hash=payload_hash THEN RETURN '{"saved":true}'::jsonb; END IF;
  RAISE EXCEPTION 'Reused key' USING ERRCODE='23505';
 END IF;

 IF operation='followup' THEN
  SELECT * INTO workflow FROM ms_workspace.lead_workflow WHERE lead_id=lead.id AND organization_id=org FOR UPDATE;
  SELECT * INTO task FROM ms_workspace.records WHERE id=target AND owner_user_id=actor AND kind='tasks' FOR UPDATE;
  IF workflow.terminal_state IS DISTINCT FROM 'open' OR workflow.do_not_contact
   OR workflow.primary_activity_id IS DISTINCT FROM target OR task.state IS NULL
   OR task.state NOT IN ('open','pending','in_progress')
   OR task.body->>'method' IS DISTINCT FROM 'phone'
   OR body->'expected_version' IS DISTINCT FROM to_jsonb(workflow.version) THEN
   RAISE EXCEPTION 'Task changed' USING ERRCODE='P0001';
  END IF;
  notes:=trim(body->>'notes');
  IF body-ARRAY['expected_version','result','notes','title','due_at'] <> '{}'::jsonb
   OR coalesce(body->>'result','') NOT IN ('communicated','failed')
   OR jsonb_typeof(body->'notes') IS DISTINCT FROM 'string' OR length(notes) NOT BETWEEN 1 AND 1000
   OR jsonb_typeof(body->'title') IS DISTINCT FROM 'string' OR length(trim(body->>'title')) NOT BETWEEN 1 AND 300
   OR coalesce(body->>'due_at','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,3})?(Z|[+-][0-9]{2}:[0-9]{2})$'
   THEN RAISE EXCEPTION 'Invalid follow-up' USING ERRCODE='23514'; END IF;
  due:=(body->>'due_at')::timestamptz;
  SELECT jsonb_agg(student_id) INTO facts FROM ms.lead_students WHERE lead_id=lead.id;
  IF jsonb_array_length(facts)>1 THEN
   RAISE EXCEPTION 'Student selection required in full workbench' USING ERRCODE='23514';
  END IF;
  INSERT INTO ms_workspace.records(organization_id,owner_user_id,lead_id,kind,state,body)
  VALUES(org,actor,lead.id,'tasks','open',jsonb_build_object('v34',true,'title',trim(body->>'title'),
    'action','call','method','phone','due_at',due,'assignee_user_id',actor)) RETURNING id INTO replacement;
  UPDATE ms_workspace.records SET state='completed',version=version+1,updated_at=now(),
   body=task.body||jsonb_build_object('completion',jsonb_build_object('method','phone','result',$3->>'result','notes',notes),
     'completed_by',actor,'completed_at',now())
   WHERE id=target RETURNING * INTO task;
  INSERT INTO ms_workspace.history(record_id,version,actor_user_id,state,body)
   SELECT id,version,actor,state,r.body FROM ms_workspace.records r WHERE id IN (target,replacement);
  UPDATE ms_workspace.lead_workflow SET primary_activity_id=replacement,version=version+1,updated_at=now()
   WHERE lead_id=lead.id RETURNING * INTO workflow;
  -- Validate the complete chain while still inside the function's trusted role.
  SET CONSTRAINTS ms_workspace.valid_open_chain, ms_workspace.retained_open_chain IMMEDIATE;
  INSERT INTO ms.audit_events(organization_id,actor_user_id,target_type,target_id,event_name,after_business_json,reason_zh)
  VALUES(org,actor,'lead',lead.id,'V34_COMMUNICATION',
   jsonb_build_object('method','phone','category','online','result',body->>'result','notes',notes,
    'failure_reason',CASE WHEN body->>'result'='failed' THEN '其他' END,'student_ids',coalesce(facts,'[]'::jsonb),
    'stage',workflow.stage,'primary_activity_id',replacement,'completed_task_id',target,
    'completed_task_version',task.version),'员工移动工作台'),
  (org,actor,'lead',lead.id,'V34_FOLLOWUP_COMPLETED',jsonb_build_object('stage',workflow.stage,
   'terminal_state',workflow.terminal_state,'primary_activity_id',replacement,'workflow_version',workflow.version),'员工移动工作台');
 ELSE
  IF request.actor_user_id=actor THEN RAISE EXCEPTION 'Independent review required' USING ERRCODE='42501'; END IF;
  IF body-ARRAY['approved','evidence'] <> '{}'::jsonb OR jsonb_typeof(body->'approved') IS DISTINCT FROM 'boolean'
   OR jsonb_typeof(body->'evidence') IS DISTINCT FROM 'string' OR length(trim(body->>'evidence')) NOT BETWEEN 1 AND 500
   THEN RAISE EXCEPTION 'Invalid decision' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM ms.audit_events e WHERE e.organization_id=org AND e.target_type='lead' AND e.target_id=lead.id
    AND e.event_name=event_prefix||'_DECIDED' AND e.after_business_json->>'request_id'=target::text)
   OR operation='campus' AND (campus IS DISTINCT FROM request.after_business_json->>'from_campus')
   THEN RAISE EXCEPTION 'Request changed' USING ERRCODE='P0001'; END IF;
  IF (body->>'approved')::boolean THEN
   facts:=request.after_business_json;
   IF operation='qualification' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(org::text||':qualification',0));
    IF facts->>'verdict'='duplicate' THEN
     RAISE EXCEPTION 'Duplicate review requires the full workbench' USING ERRCODE='23514';
    END IF;
    SELECT e.after_business_json INTO previous FROM ms.audit_events e WHERE e.organization_id=org
     AND e.target_type='lead' AND e.target_id=lead.id AND e.event_name='V34_LEAD_QUALIFICATION_EFFECTIVE'
     ORDER BY e.happened_at DESC,(e.after_business_json->>'sequence')::int DESC NULLS LAST,e.id DESC LIMIT 1;
    facts:=facts||jsonb_build_object('sequence',coalesce((previous->>'sequence')::int,0)+1,'previous',coalesce(previous->>'verdict','pending'));
   ELSE
    IF NOT EXISTS(SELECT 1 FROM ms_workspace.service_campuses c WHERE c.organization_id=org
        AND c.active AND c.code=facts->>'campus_code')
     OR restricted AND NOT EXISTS(SELECT 1 FROM ms_workspace.service_campus_grants g WHERE g.organization_id=org
        AND g.staff_id=actor AND g.revoked_at IS NULL AND g.campus_code=facts->>'campus_code')
     THEN RAISE EXCEPTION 'Unauthorized destination campus' USING ERRCODE='42501'; END IF;
    facts:=facts||jsonb_build_object('effective_at',clock_timestamp());
   END IF;
   INSERT INTO ms.audit_events(organization_id,actor_user_id,target_type,target_id,event_name,after_business_json,reason_zh,happened_at)
    VALUES(org,actor,'lead',lead.id,CASE operation WHEN 'qualification' THEN event_prefix||'_EFFECTIVE'
     ELSE 'V34_SERVICE_CAMPUS_EFFECTIVE' END,facts||jsonb_build_object('request_id',target),'员工移动工作台',clock_timestamp());
  END IF;
  INSERT INTO ms.audit_events(organization_id,actor_user_id,target_type,target_id,event_name,after_business_json,reason_zh,happened_at)
   VALUES(org,actor,'lead',lead.id,event_prefix||'_DECIDED',
    jsonb_build_object('request_id',target,'approved',body->'approved','evidence',trim(body->>'evidence')),'员工移动工作台',clock_timestamp());
 END IF;
 INSERT INTO ms_workspace.mobile_action_receipts VALUES(actor,request_key,payload_hash);
 RETURN '{"saved":true}'::jsonb;
END $$;
REVOKE ALL ON FUNCTION ms.apply_scoped_mobile_action(text,uuid,jsonb,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ms.apply_scoped_mobile_action(text,uuid,jsonb,text,text,text) TO ms_scoped_lowrisk_writer;
CREATE VIEW ms.scoped_mobile_followup_tasks WITH (security_barrier=true) AS
SELECT t.id,w.version AS expected_version
FROM ms.scoped_mobile_tasks t JOIN ms_workspace.lead_workflow w ON w.lead_id=t.lead_id
WHERE t.kind='tasks' AND w.primary_activity_id=t.id
 AND EXISTS(SELECT 1 FROM ms_workspace.records r WHERE r.id=t.id AND r.body->>'method'='phone')
 AND NOT EXISTS(SELECT 1 FROM ms_workspace.lead_directory d WHERE d.lead_id=t.lead_id AND d.department='market')
 AND (SELECT count(*) FROM ms.lead_students ls WHERE ls.lead_id=t.lead_id)<=1;

CREATE VIEW ms.scoped_mobile_approvals WITH (security_barrier=true) AS
SELECT e.id,e.happened_at,e.after_business_json->>'evidence' AS evidence,
 CASE e.event_name WHEN 'V34_LEAD_QUALIFICATION_REQUESTED' THEN 'qualification' ELSE 'campus' END AS operation,
 e.after_business_json->>'verdict' AS verdict,e.after_business_json->>'reason' AS reason,
 e.after_business_json->>'from_campus' AS from_campus,e.after_business_json->>'campus_code' AS campus_code
FROM ms.audit_events e
JOIN ms.leads l ON l.id=e.target_id AND l.organization_id=e.organization_id
WHERE e.target_type='lead' AND e.organization_id=ms.current_scoped_organization_id()
 AND e.actor_user_id<>ms.current_scoped_staff_id()
 AND (e.event_name='V34_CAMPUS_TRANSFER_REQUESTED'
  OR e.event_name='V34_LEAD_QUALIFICATION_REQUESTED' AND e.after_business_json->>'verdict'<>'duplicate')
 AND NOT EXISTS(SELECT 1 FROM ms_workspace.lead_directory d WHERE d.lead_id=l.id AND d.department='market')
 AND NOT EXISTS(SELECT 1 FROM ms.audit_events d WHERE d.organization_id=e.organization_id AND d.target_type='lead'
   AND d.target_id=e.target_id AND d.event_name=replace(e.event_name,'_REQUESTED','_DECIDED')
   AND d.after_business_json->>'request_id'=e.id::text)
 AND EXISTS(SELECT 1 FROM ms.user_role_grants g JOIN ms.role_templates r ON r.id=g.role_id
  WHERE g.user_id=ms.current_scoped_staff_id() AND g.revoked_at IS NULL AND r.organization_id=e.organization_id
  AND (r.role_code='super_admin' OR r.role_code='sales_manager' AND (
    NOT EXISTS(SELECT 1 FROM ms_workspace.service_campuses c WHERE c.organization_id=e.organization_id)
    OR EXISTS(SELECT 1 FROM ms_workspace.service_campus_grants cg WHERE cg.organization_id=e.organization_id
     AND cg.staff_id=g.user_id AND cg.revoked_at IS NULL AND cg.campus_code=coalesce(
       (SELECT a.after_business_json->>'campus_code' FROM ms.audit_events a
        WHERE a.organization_id=e.organization_id AND a.target_type='lead' AND a.target_id=e.target_id
         AND a.event_name='V34_SERVICE_CAMPUS_EFFECTIVE' AND a.happened_at<=statement_timestamp()
         AND (a.after_business_json->>'effective_at')::timestamptz<=statement_timestamp()
        ORDER BY (a.after_business_json->>'effective_at')::timestamptz DESC,a.happened_at DESC,a.id DESC LIMIT 1),
       '@unassigned')))));
REVOKE ALL ON ms.scoped_mobile_followup_tasks,ms.scoped_mobile_approvals FROM PUBLIC;
GRANT SELECT ON ms.scoped_mobile_followup_tasks,ms.scoped_mobile_approvals TO ms_student_assignee_reader;
INSERT INTO ms_workspace.schema_versions(version) VALUES(43);
COMMIT;
