\set ON_ERROR_STOP on
-- V3.2-64 CI-only sales-side follow-up evidence for MANUALLY ESCALATED incidents.
-- No finance-signature, budget, payment, activity launch, or hold-release operation.
BEGIN;
CREATE TABLE ms.isolated_campaign_finance_escalation_followups(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES ms.organizations(id),
 incident_id uuid NOT NULL REFERENCES ms.isolated_campaign_finance_incidents(id),
 recorded_by uuid NOT NULL REFERENCES ms.staff_users(id),
 responsibility_boundary text NOT NULL CHECK(
  responsibility_boundary IN ('sales_reporter','independent_sales_reviewer')),
 note_type text NOT NULL CHECK(
  note_type IN ('sales_evidence_addendum','external_finance_requirements_pending')),
 evidence_ref text NOT NULL CHECK(length(trim(evidence_ref)) BETWEEN 2 AND 200),
 reason_zh text NOT NULL CHECK(length(trim(reason_zh)) BETWEEN 2 AND 400),
 request_key text NOT NULL CHECK(request_key ~ '^[a-zA-Z0-9_-]{16,128}$'),
 request_fingerprint text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(recorded_by,request_key)
);
REVOKE ALL ON ms.isolated_campaign_finance_escalation_followups FROM PUBLIC;
REVOKE ALL ON ms.isolated_campaign_finance_escalation_followups FROM ms_scoped_lowrisk_writer;

CREATE VIEW ms.scoped_isolated_campaign_finance_escalation_followups
WITH (security_barrier=true) AS
SELECT f.id AS followup_id,f.incident_id,i.review_id,f.recorded_by,
 f.responsibility_boundary,f.note_type,f.created_at,
 i.status AS incident_status,
 false AS finance_authorized,false AS execution_allowed,
 'awaiting_external_finance_authority'::text AS external_authority_state
FROM ms.isolated_campaign_finance_escalation_followups f
JOIN ms.scoped_isolated_campaign_finance_incidents i ON i.incident_id=f.incident_id
WHERE f.organization_id=ms.current_scoped_organization_id()
 AND ms.current_scoped_staff_id() IS NOT NULL
 AND i.status='manual_escalated';
REVOKE ALL ON ms.scoped_isolated_campaign_finance_escalation_followups FROM PUBLIC;
GRANT SELECT ON ms.scoped_isolated_campaign_finance_escalation_followups
 TO ms_student_assignee_reader;

CREATE FUNCTION ms.append_isolated_campaign_finance_escalation_followup(
 p_incident uuid,p_note_type text,p_evidence text,p_reason text,p_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ms
AS $append$
DECLARE actor uuid;org uuid;incident ms.isolated_campaign_finance_incidents%ROWTYPE;
 prior ms.isolated_campaign_finance_escalation_followups%ROWTYPE;
 boundary_role text;fp text;new_id uuid;
BEGIN
 SELECT ms.current_scoped_staff_id(),ms.current_scoped_organization_id() INTO actor,org;
 IF actor IS NULL OR org IS NULL OR NOT EXISTS(
  SELECT 1 FROM ms.staff_users s
   WHERE s.id=actor AND s.organization_id=org AND s.status='active')
 THEN RAISE EXCEPTION '未核实的销售侧员工不得补充交接材料' USING ERRCODE='42501'; END IF;
 IF p_incident IS NULL OR p_note_type IS NULL OR
  p_note_type NOT IN ('sales_evidence_addendum','external_finance_requirements_pending')
  OR p_evidence IS NULL OR length(trim(p_evidence)) NOT BETWEEN 2 AND 200
  OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 2 AND 400
  OR p_key IS NULL OR p_key !~ '^[a-zA-Z0-9_-]{16,128}$'
 THEN RAISE EXCEPTION '补充材料不符合要求' USING ERRCODE='23514'; END IF;
 fp:=encode(sha256(convert_to(jsonb_build_object(
  'incident',p_incident,'type',p_note_type,'evidence',trim(p_evidence),
  'reason',trim(p_reason))::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended(
  actor::text||':finance_escalation_followup:'||p_key,0));
 SELECT * INTO prior FROM ms.isolated_campaign_finance_escalation_followups
 WHERE recorded_by=actor AND request_key=p_key;
 IF FOUND THEN
  IF prior.request_fingerprint<>fp THEN
   RAISE EXCEPTION '补充材料防重复编号被复用' USING ERRCODE='23505';
  END IF;
  RETURN jsonb_build_object('followup_id',prior.id,'incident_id',prior.incident_id,
    'incident_status','manual_escalated','finance_authorized',false,
    'execution_allowed',false);
 END IF;
 SELECT * INTO incident FROM ms.isolated_campaign_finance_incidents
  WHERE id=p_incident AND organization_id=org FOR SHARE;
 IF NOT FOUND OR incident.status<>'manual_escalated'
   OR (actor IS DISTINCT FROM incident.reported_by
    AND actor IS DISTINCT FROM incident.reviewed_by)
   OR NOT EXISTS(SELECT 1 FROM ms.isolated_campaign_sales_reviews q
    WHERE q.id=incident.review_id AND q.organization_id=org
      AND q.status='sales_approved_pending_finance')
 THEN RAISE EXCEPTION '仅已人工升级异常的原登记人和独立销售复核人可补充材料'
   USING ERRCODE='42501'; END IF;
 boundary_role:=CASE WHEN actor=incident.reported_by
  THEN 'sales_reporter' ELSE 'independent_sales_reviewer' END;
 IF boundary_role='independent_sales_reviewer' AND NOT EXISTS(
  SELECT 1 FROM ms.user_role_grants g
   JOIN ms.role_templates r ON r.id=g.role_id
  WHERE g.user_id=actor AND r.organization_id=org
    AND r.role_code='sales_manager'
    AND g.revoked_at IS NULL AND g.valid_from<=now())
 THEN RAISE EXCEPTION '销售独立复核资格已失效' USING ERRCODE='42501'; END IF;
 INSERT INTO ms.isolated_campaign_finance_escalation_followups(
  organization_id,incident_id,recorded_by,responsibility_boundary,note_type,
  evidence_ref,reason_zh,request_key,request_fingerprint)
 VALUES(org,p_incident,actor,boundary_role,p_note_type,
  trim(p_evidence),trim(p_reason),p_key,fp)
 RETURNING id INTO new_id;
 INSERT INTO ms.audit_events(organization_id,actor_user_id,target_type,target_id,
  event_name,before_business_json,after_business_json,reason_zh)
 VALUES(org,actor,'marketing_campaign_finance_incident',p_incident,
  'CAMPAIGN_FINANCE_ESCALATION_FOLLOWUP_RECORDED','{}'::jsonb,
  jsonb_build_object('followup_id',new_id,'note_type',p_note_type,
   'responsibility_boundary',boundary_role,'status','manual_escalated',
   'finance_authorized',false,'execution_allowed',false),
   '销售侧人工升级异常追加材料：不等于真实财务签收或批准');
 RETURN jsonb_build_object('followup_id',new_id,'incident_id',p_incident,
  'responsibility_boundary',boundary_role,'incident_status','manual_escalated',
  'finance_authorized',false,'execution_allowed',false);
END $append$;
REVOKE ALL ON FUNCTION ms.append_isolated_campaign_finance_escalation_followup(
 uuid,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ms.append_isolated_campaign_finance_escalation_followup(
 uuid,text,text,text,text) TO ms_scoped_lowrisk_writer;

-- Extend prior V3.2-63 immutable chronology without changing existing columns.
CREATE OR REPLACE VIEW ms.scoped_isolated_campaign_finance_incident_audit_history
WITH (security_barrier=true) AS
SELECT a.id AS audit_id,a.target_id AS incident_id,
 i.review_id,i.issue_kind,a.event_name,a.actor_user_id,a.happened_at,
 CASE a.event_name
  WHEN 'CAMPAIGN_FINANCE_HANDOFF_ISSUE_REPORTED' THEN 'open'
  WHEN 'CAMPAIGN_FINANCE_ISSUE_ESCALATED' THEN 'manual_escalated'
  WHEN 'CAMPAIGN_FINANCE_ISSUE_RECHECK_REQUESTED' THEN 'closed_for_recheck'
  WHEN 'CAMPAIGN_FINANCE_ESCALATION_FOLLOWUP_RECORDED' THEN 'manual_escalated'
 END::text AS event_status,
 i.status AS current_incident_status,
 false AS finance_authorized,false AS execution_allowed
FROM ms.audit_events a
JOIN ms.scoped_isolated_campaign_finance_incidents i ON i.incident_id=a.target_id
WHERE a.target_type='marketing_campaign_finance_incident'
 AND a.event_name IN (
  'CAMPAIGN_FINANCE_HANDOFF_ISSUE_REPORTED',
  'CAMPAIGN_FINANCE_ISSUE_ESCALATED',
  'CAMPAIGN_FINANCE_ISSUE_RECHECK_REQUESTED',
  'CAMPAIGN_FINANCE_ESCALATION_FOLLOWUP_RECORDED')
 AND a.organization_id=ms.current_scoped_organization_id()
 AND ms.current_scoped_staff_id() IS NOT NULL;
REVOKE ALL ON ms.scoped_isolated_campaign_finance_incident_audit_history FROM PUBLIC;
GRANT SELECT ON ms.scoped_isolated_campaign_finance_incident_audit_history
 TO ms_student_assignee_reader;

DO $guards$
DECLARE who text;
BEGIN
 FOREACH who IN ARRAY ARRAY[
  'ms_assignee_reader_a','ms_assignee_reader_b',
  'ms_assignee_reader_manager','ms_assignee_reader_manager_2'
 ] LOOP
  IF NOT has_table_privilege(who,'ms.scoped_isolated_campaign_finance_escalation_followups','SELECT')
    OR has_table_privilege(who,'ms.isolated_campaign_finance_escalation_followups','SELECT')
    OR has_table_privilege(who,'ms.audit_events','SELECT')
    OR has_table_privilege(who,'ms.marketing_costs','SELECT')
   THEN RAISE EXCEPTION 'Escalation follow-up read privilege invalid: %',who; END IF;
 END LOOP;
 FOREACH who IN ARRAY ARRAY[
  'ms_write_a','ms_write_b','ms_write_manager','ms_write_manager_2'
 ] LOOP
  IF has_table_privilege(who,'ms.isolated_campaign_finance_escalation_followups','INSERT')
   OR has_table_privilege(who,'ms.isolated_campaign_finance_escalation_followups','UPDATE')
   OR has_table_privilege(who,'ms.marketing_costs','INSERT')
   OR NOT has_function_privilege(who,
     'ms.append_isolated_campaign_finance_escalation_followup(uuid,text,text,text,text)',
     'EXECUTE')
  THEN RAISE EXCEPTION 'Escalation follow-up write privilege invalid: %',who; END IF;
 END LOOP;
END $guards$;
COMMIT;
