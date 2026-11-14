-- V3.2-17: CANDIDATE REVIEW ONLY, no INSERT/UPDATE on ms.leads.
-- Disposable fictional PostgreSQL16 AFTER migration 020. Do not deploy.
BEGIN;
CREATE TABLE ms.consultation_lead_candidates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES ms.organizations(id),
 source_event_id uuid NOT NULL UNIQUE REFERENCES ms.contact_events(id),
 contact_id uuid NOT NULL REFERENCES ms.contacts(id),
 requested_by uuid NOT NULL REFERENCES ms.staff_users(id),
 evidence_ref text NOT NULL CHECK (length(trim(evidence_ref)) BETWEEN 2 AND 200),
 reason_zh text NOT NULL CHECK (length(trim(reason_zh)) BETWEEN 2 AND 400),
 request_key text NOT NULL CHECK(length(request_key) BETWEEN 16 AND 128),
 status text NOT NULL DEFAULT 'pending'
   CHECK(status IN ('pending','reviewed_eligible','rejected')),
 reviewed_by uuid REFERENCES ms.staff_users(id),
 reviewed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(requested_by,request_key),
 CHECK ((status='pending' AND reviewed_by IS NULL AND reviewed_at IS NULL)
    OR (status<>'pending' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
);
CREATE TABLE ms.consultation_lead_candidate_decisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 candidate_id uuid NOT NULL UNIQUE REFERENCES ms.consultation_lead_candidates(id),
 reviewer_id uuid NOT NULL REFERENCES ms.staff_users(id),
 decision text NOT NULL CHECK(decision IN ('reviewed_eligible','rejected')),
 evidence_ref text NOT NULL CHECK(length(trim(evidence_ref)) BETWEEN 2 AND 200),
 reason_zh text NOT NULL CHECK(length(trim(reason_zh)) BETWEEN 2 AND 400),
 request_key text NOT NULL CHECK(length(request_key) BETWEEN 16 AND 128),
 decided_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(reviewer_id,request_key)
);
ALTER TABLE ms.consultation_lead_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE ms.consultation_lead_candidate_decisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ms.consultation_lead_candidates,
 ms.consultation_lead_candidate_decisions FROM PUBLIC,ms_lowrisk_runtime;
CREATE TRIGGER immutable_candidate_decisions
 BEFORE UPDATE OR DELETE ON ms.consultation_lead_candidate_decisions
 FOR EACH ROW EXECUTE FUNCTION ms.reject_access_history_mutation();

-- A read-only projection of the applicant's own consulting records. It
-- contains no contact secrets or sibling/student IDs. Same-tenant by SESSION_USER.
CREATE VIEW ms.scoped_consultations_for_candidates
WITH (security_barrier=true) AS
SELECT e.id AS event_id,e.event_type,e.occurred_at,
 c.display_name AS contact_name
FROM ms.contact_events e JOIN ms.contacts c ON c.id=e.contact_id
WHERE e.organization_id=ms.current_scoped_organization_id()
 AND c.organization_id=e.organization_id
 AND e.recorded_by=ms.current_scoped_staff_id()
 AND c.archived_at IS NULL AND NOT c.do_not_contact
 AND NOT EXISTS(SELECT 1 FROM ms.leads l
   WHERE l.organization_id=e.organization_id AND l.contact_id=c.id)
 AND NOT EXISTS(SELECT 1 FROM ms.consultation_lead_candidates x
   WHERE x.source_event_id=e.id)
 AND ( (c.created_by=ms.current_scoped_staff_id()
    AND NOT EXISTS(SELECT 1 FROM ms.contact_custody_assignments a
      WHERE a.contact_id=c.id AND a.revoked_at IS NULL))
   OR EXISTS(SELECT 1 FROM ms.contact_custody_assignments a
      WHERE a.contact_id=c.id AND a.revoked_at IS NULL
        AND a.assignee_id=ms.current_scoped_staff_id()));
CREATE VIEW ms.scoped_consultation_lead_candidates
WITH (security_barrier=true) AS
SELECT x.id AS candidate_id,x.source_event_id,x.status,x.created_at,
 c.display_name AS contact_name,e.event_type,e.occurred_at,
 x.requested_by
FROM ms.consultation_lead_candidates x
JOIN ms.contact_events e ON e.id=x.source_event_id
JOIN ms.contacts c ON c.id=x.contact_id
WHERE x.organization_id=ms.current_scoped_organization_id()
 AND ms.current_scoped_staff_id() IS NOT NULL
 AND (x.requested_by=ms.current_scoped_staff_id()
  OR (x.status='pending' AND EXISTS(
   SELECT 1 FROM ms.user_role_grants g
   JOIN ms.role_templates t ON t.id=g.role_id
   WHERE g.user_id=ms.current_scoped_staff_id()
    AND g.revoked_at IS NULL AND g.valid_from<=now()
    AND t.organization_id=x.organization_id
    AND t.role_code IN ('sales_manager','super_admin'))));
REVOKE ALL ON ms.scoped_consultations_for_candidates,
 ms.scoped_consultation_lead_candidates FROM PUBLIC;
GRANT SELECT ON ms.scoped_consultations_for_candidates,
 ms.scoped_consultation_lead_candidates TO ms_student_assignee_reader;

CREATE FUNCTION ms.request_consultation_lead_candidate(
 p_event uuid,p_evidence text,p_reason text,p_key text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ms AS $candidate$
DECLARE actor_id uuid; org uuid; old ms.consultation_lead_candidates%ROWTYPE;
 e ms.contact_events%ROWTYPE;c ms.contacts%ROWTYPE; custodian uuid;new_id uuid;
BEGIN
 SELECT staff_id,org_id INTO actor_id,org FROM ms.access_actor();
 IF actor_id IS NULL THEN RAISE EXCEPTION '员工身份无效' USING ERRCODE='42501'; END IF;
 IF p_event IS NULL OR p_key IS NULL OR p_key !~ '^[a-zA-Z0-9_-]{16,128}$'
  OR p_evidence IS NULL OR length(trim(p_evidence)) NOT BETWEEN 2 AND 200
  OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 2 AND 400
 THEN RAISE EXCEPTION '候选申请信息不完整' USING ERRCODE='23514'; END IF;
 SELECT * INTO old FROM ms.consultation_lead_candidates
 WHERE requested_by=actor_id AND request_key=p_key;
 IF FOUND THEN
   IF old.source_event_id=p_event AND old.evidence_ref=p_evidence
    AND old.reason_zh=p_reason THEN RETURN old.id; END IF;
   RAISE EXCEPTION '操作编号已用于其他候选申请' USING ERRCODE='23505';
 END IF;
 SELECT * INTO e FROM ms.contact_events WHERE id=p_event AND organization_id=org;
 IF NOT FOUND OR e.recorded_by IS DISTINCT FROM actor_id
 THEN RAISE EXCEPTION '只能提交本人记录的本机构实际咨询'
   USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM ms.contacts
 WHERE id=e.contact_id AND organization_id=org AND archived_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '联系人不属于本机构或已失效'
    USING ERRCODE='42501'; END IF;
 IF c.do_not_contact THEN RAISE EXCEPTION '联系人拒绝主动联系，禁止转线索候选'
    USING ERRCODE='23514'; END IF;
 SELECT COALESCE((SELECT a.assignee_id FROM ms.contact_custody_assignments a
   WHERE a.contact_id=c.id AND a.revoked_at IS NULL),c.created_by) INTO custodian;
 IF custodian IS DISTINCT FROM actor_id THEN
  RAISE EXCEPTION '当前联系人管理权不属于咨询记录人' USING ERRCODE='42501'; END IF;
 IF EXISTS (SELECT 1 FROM ms.leads l
   WHERE l.organization_id=org AND (l.source_event_id=e.id OR l.contact_id=c.id))
 THEN RAISE EXCEPTION '已有该咨询或联系人的销售线索，须先核查重复'
   USING ERRCODE='23505'; END IF;
 IF EXISTS (SELECT 1 FROM ms.consultation_lead_candidates
   WHERE source_event_id=e.id)
 THEN RAISE EXCEPTION '该咨询已经有候选申请，不能重复登记'
   USING ERRCODE='23505'; END IF;
 INSERT INTO ms.consultation_lead_candidates
  (organization_id,source_event_id,contact_id,requested_by,
    evidence_ref,reason_zh,request_key)
 VALUES(org,e.id,c.id,actor_id,p_evidence,p_reason,p_key)
 RETURNING id INTO new_id;
 INSERT INTO ms.audit_events
  (organization_id,actor_user_id,target_type,target_id,event_name,reason_zh,after_business_json)
 VALUES(org,actor_id,'contact_event',e.id,'LEAD_CANDIDATE_REQUESTED',
   '本人实际咨询已提交待独立审核的线索候选；没有创建正式线索',
   jsonb_build_object('咨询方式',e.event_type,'审核状态','待独立审核','正式线索','未创建'));
 RETURN new_id;
END $candidate$;
CREATE FUNCTION ms.decide_consultation_lead_candidate(
 p_candidate uuid,p_decision text,p_evidence text,p_reason text,p_key text
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ms AS $decision$
DECLARE reviewer uuid;org uuid;r ms.consultation_lead_candidates%ROWTYPE;
 e ms.contact_events%ROWTYPE;c ms.contacts%ROWTYPE;custodian uuid;
 prior ms.consultation_lead_candidate_decisions%ROWTYPE;
BEGIN
 SELECT staff_id,org_id INTO reviewer,org FROM ms.access_actor();
 IF reviewer IS NULL THEN RAISE EXCEPTION '审核身份无效' USING ERRCODE='42501'; END IF;
 IF p_candidate IS NULL OR p_decision NOT IN ('reviewed_eligible','rejected')
  OR p_key IS NULL OR p_key !~ '^[a-zA-Z0-9_-]{16,128}$'
  OR p_evidence IS NULL OR length(trim(p_evidence)) NOT BETWEEN 2 AND 200
  OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 2 AND 400
 THEN RAISE EXCEPTION '独立审核材料不完整' USING ERRCODE='23514'; END IF;
 SELECT * INTO prior FROM ms.consultation_lead_candidate_decisions
 WHERE reviewer_id=reviewer AND request_key=p_key;
 IF FOUND THEN
  IF prior.candidate_id=p_candidate AND prior.decision=p_decision
   AND prior.evidence_ref=p_evidence AND prior.reason_zh=p_reason
  THEN RETURN CASE WHEN p_decision='reviewed_eligible'
   THEN '已审核符合候选条件，未创建正式线索' ELSE '已驳回候选' END; END IF;
  RAISE EXCEPTION '审核编号与先前操作不一致' USING ERRCODE='23505';
 END IF;
 SELECT * INTO r FROM ms.consultation_lead_candidates
 WHERE id=p_candidate AND organization_id=org FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '无权审核此项候选' USING ERRCODE='42501'; END IF;
 IF r.status<>'pending' THEN RAISE EXCEPTION '该候选已审核，不得重复操作'
   USING ERRCODE='23505'; END IF;
 IF reviewer=r.requested_by THEN RAISE EXCEPTION '申请人不得自己审批'
   USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM ms.user_role_grants g
   JOIN ms.role_templates t ON t.id=g.role_id
   WHERE g.user_id=reviewer AND g.revoked_at IS NULL
   AND g.valid_from<=now() AND t.organization_id=org
   AND t.role_code IN ('sales_manager','super_admin'))
 THEN RAISE EXCEPTION '必须由本机构有效独立主管审批'
   USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM ms.contacts
 WHERE id=r.contact_id AND organization_id=org AND archived_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '联系人已失效' USING ERRCODE='23514'; END IF;
 SELECT * INTO e FROM ms.contact_events
 WHERE id=r.source_event_id AND organization_id=org AND contact_id=c.id;
 IF NOT FOUND OR e.recorded_by IS DISTINCT FROM r.requested_by
 THEN RAISE EXCEPTION '历史咨询及原记录人核验失败' USING ERRCODE='23514'; END IF;
 IF p_decision='reviewed_eligible' THEN
  IF c.do_not_contact THEN RAISE EXCEPTION '联系人已拒绝主动联系'
    USING ERRCODE='23514'; END IF;
  SELECT COALESCE((SELECT a.assignee_id FROM ms.contact_custody_assignments a
    WHERE a.contact_id=c.id AND a.revoked_at IS NULL),c.created_by) INTO custodian;
  IF custodian IS DISTINCT FROM r.requested_by THEN
    RAISE EXCEPTION '当前管理权与申请时已不同，不能通过'
    USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM ms.leads l WHERE l.organization_id=org
   AND (l.source_event_id=r.source_event_id OR l.contact_id=r.contact_id))
  THEN RAISE EXCEPTION '已有关联销售线索，拒绝重复归因'
    USING ERRCODE='23505'; END IF;
 END IF;
 INSERT INTO ms.consultation_lead_candidate_decisions
  (candidate_id,reviewer_id,decision,evidence_ref,reason_zh,request_key)
 VALUES(r.id,reviewer,p_decision,p_evidence,p_reason,p_key);
 UPDATE ms.consultation_lead_candidates
 SET status=p_decision,reviewed_by=reviewer,reviewed_at=now()
 WHERE id=r.id;
 INSERT INTO ms.audit_events
  (organization_id,actor_user_id,target_type,target_id,event_name,reason_zh,after_business_json)
 VALUES(org,reviewer,'contact_event',r.source_event_id,'LEAD_CANDIDATE_REVIEWED',
 '候选已独立审核，不生成正式线索、不授予学生或销售归因权限',
 jsonb_build_object('结果',CASE WHEN p_decision='reviewed_eligible'
  THEN '通过候选核查（非正式线索）' ELSE '驳回候选' END,
  '正式线索','未创建'));
 RETURN CASE WHEN p_decision='reviewed_eligible'
  THEN '已审核符合候选条件，未创建正式线索' ELSE '已驳回候选' END;
END $decision$;
REVOKE ALL ON FUNCTION
 ms.request_consultation_lead_candidate(uuid,text,text,text),
 ms.decide_consultation_lead_candidate(uuid,text,text,text,text)
 FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
 ms.request_consultation_lead_candidate(uuid,text,text,text),
 ms.decide_consultation_lead_candidate(uuid,text,text,text,text)
 TO ms_scoped_lowrisk_writer;
-- The dedicated employee LOGINs never receive ms.leads base-table grants.
COMMIT;
