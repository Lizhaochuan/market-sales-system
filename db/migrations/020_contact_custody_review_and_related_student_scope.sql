-- V3.2-16: isolated, fictional PostgreSQL 16 only. Apply after 019.
-- A custody rollback affects CURRENT CONTACT MANAGEMENT ONLY.
-- Never changes contact creator, historical events, students, family, leads or money.
BEGIN;

CREATE TABLE ms.contact_custody_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES ms.organizations(id),
 contact_id uuid NOT NULL REFERENCES ms.contacts(id),
 assignment_id uuid NOT NULL REFERENCES ms.contact_custody_assignments(id),
 kind text NOT NULL CHECK(kind IN ('withdrawal','dispute')),
 requested_by uuid NOT NULL REFERENCES ms.staff_users(id),
 request_reason_zh text NOT NULL CHECK(length(trim(request_reason_zh)) BETWEEN 2 AND 400),
 request_evidence_ref text NOT NULL CHECK(length(trim(request_evidence_ref)) BETWEEN 1 AND 200),
 request_key text NOT NULL CHECK(length(request_key) BETWEEN 16 AND 128),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','upheld','reversed','rejected')),
 reviewed_by uuid REFERENCES ms.staff_users(id),
 reviewed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(requested_by,request_key),
 CHECK((status='pending' AND reviewed_by IS NULL AND reviewed_at IS NULL)
 OR (status<>'pending' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
);
CREATE UNIQUE INDEX uq_custody_pending_review
 ON ms.contact_custody_reviews(contact_id) WHERE status='pending';
CREATE TABLE ms.contact_custody_review_decisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 review_id uuid NOT NULL UNIQUE REFERENCES ms.contact_custody_reviews(id),
 reviewer_id uuid NOT NULL REFERENCES ms.staff_users(id),
 result text NOT NULL CHECK(result IN ('upheld','reversed','rejected')),
 evidence_ref text NOT NULL CHECK(length(trim(evidence_ref)) BETWEEN 1 AND 200),
 reason_zh text NOT NULL CHECK(length(trim(reason_zh)) BETWEEN 2 AND 400),
 decision_key text NOT NULL CHECK(length(decision_key) BETWEEN 16 AND 128),
 decided_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(reviewer_id,decision_key)
);
CREATE TRIGGER immutable_contact_custody_review_decision
 BEFORE UPDATE OR DELETE ON ms.contact_custody_review_decisions
 FOR EACH ROW EXECUTE FUNCTION ms.reject_access_history_mutation();
ALTER TABLE ms.contact_custody_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE ms.contact_custody_review_decisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ms.contact_custody_reviews,ms.contact_custody_review_decisions
 FROM PUBLIC,ms_lowrisk_runtime;

-- Store a restoration chain, without mutating old approval decisions.
ALTER TABLE ms.contact_custody_assignments
 DROP CONSTRAINT contact_custody_assignments_approval_request_id_key;
ALTER TABLE ms.contact_custody_assignments
 ADD COLUMN prior_custodian_id uuid REFERENCES ms.staff_users(id),
 ADD COLUMN review_id uuid UNIQUE REFERENCES ms.contact_custody_reviews(id);
UPDATE ms.contact_custody_assignments a SET prior_custodian_id=COALESCE(
 (SELECT prev.assignee_id FROM ms.contact_custody_assignments prev
  WHERE prev.contact_id=a.contact_id AND prev.granted_at<a.granted_at
  ORDER BY prev.granted_at DESC,prev.id DESC LIMIT 1),
 (SELECT c.created_by FROM ms.contacts c WHERE c.id=a.contact_id))
 WHERE prior_custodian_id IS NULL;
CREATE UNIQUE INDEX uq_original_custody_approval
 ON ms.contact_custody_assignments(approval_request_id) WHERE review_id IS NULL;

-- Future approval from 019 is captured even if the old function inserts
-- without the new field. Locking of the contact row serializes transfers.
CREATE FUNCTION ms.capture_custody_prior() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ms AS $f$
BEGIN
 IF NEW.prior_custodian_id IS NULL THEN
   SELECT COALESCE(
     (SELECT a.assignee_id FROM ms.contact_custody_assignments a
      WHERE a.contact_id=NEW.contact_id AND a.id<>NEW.id
      ORDER BY a.granted_at DESC,a.id DESC LIMIT 1),
     c.created_by) INTO NEW.prior_custodian_id
   FROM ms.contacts c WHERE c.id=NEW.contact_id;
 END IF;
 RETURN NEW;
END $f$;
CREATE TRIGGER custody_prior_capture BEFORE INSERT
 ON ms.contact_custody_assignments
 FOR EACH ROW EXECUTE FUNCTION ms.capture_custody_prior();

-- Submit a withdrawal or independent dispute. The applicant gets no power
-- to change custody; reviewers never receive contact/customer read grants.
CREATE FUNCTION ms.request_custody_review(
 p_assignment uuid,p_kind text,p_evidence text,p_reason text,p_key text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ms AS $f$
DECLARE actor uuid;org uuid;a ms.contact_custody_assignments%ROWTYPE;
 c ms.contacts%ROWTYPE;contact_ref uuid; prior_request ms.contact_custody_requests%ROWTYPE;
 old ms.contact_custody_reviews%ROWTYPE;new_id uuid;
BEGIN
 SELECT staff_id,org_id INTO actor,org FROM ms.access_actor();
 IF actor IS NULL THEN RAISE EXCEPTION '员工身份无效' USING ERRCODE='42501'; END IF;
 IF p_kind IS NULL OR p_kind NOT IN ('withdrawal','dispute')
  OR p_key IS NULL OR p_key !~ '^[a-zA-Z0-9_-]{16,128}$'
  OR p_evidence IS NULL OR length(trim(p_evidence)) NOT BETWEEN 1 AND 200
  OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 2 AND 400
 THEN RAISE EXCEPTION '撤回或复核申请不完整' USING ERRCODE='23514'; END IF;
 SELECT * INTO old FROM ms.contact_custody_reviews
 WHERE requested_by=actor AND request_key=p_key;
 IF FOUND THEN
   IF old.assignment_id=p_assignment AND old.kind=p_kind
     AND old.request_evidence_ref=p_evidence AND old.request_reason_zh=p_reason
   THEN RETURN old.id; END IF;
   RAISE EXCEPTION '防重复编号发生冲突' USING ERRCODE='23505';
 END IF;
 -- The contact lock serializes against subsequent custody approvals.
 SELECT x.contact_id INTO contact_ref
 FROM ms.contact_custody_assignments x WHERE x.id=p_assignment;
 IF contact_ref IS NULL THEN RAISE EXCEPTION '无权复核该项交接'
   USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM ms.contacts
 WHERE id=contact_ref AND organization_id=org AND archived_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '联系人不在当前机构'
   USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM ms.contact_custody_assignments
 WHERE id=p_assignment AND organization_id=org AND contact_id=c.id
   AND revoked_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION '只能复核当前仍然有效的管理权'
   USING ERRCODE='23514'; END IF;
 SELECT * INTO prior_request FROM ms.contact_custody_requests
 WHERE id=a.approval_request_id AND organization_id=org AND status='approved';
 IF NOT FOUND THEN RAISE EXCEPTION '没有合法的已批准交接' USING ERRCODE='42501'; END IF;
 IF p_kind='withdrawal' AND actor NOT IN (a.assignee_id,prior_request.requested_by)
 THEN RAISE EXCEPTION '仅原交接申请人或现任管理人可申请撤回'
   USING ERRCODE='42501'; END IF;
 IF p_kind='dispute' AND actor NOT IN
    (a.assignee_id,prior_request.requested_by,c.created_by)
 THEN RAISE EXCEPTION '没有该交接争议的当事人身份'
   USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM ms.contact_custody_requests
   WHERE contact_id=c.id AND status='pending')
 OR EXISTS(SELECT 1 FROM ms.contact_custody_reviews
   WHERE contact_id=c.id AND status='pending')
 THEN RAISE EXCEPTION '已有未决交接或复核，须先完成'
   USING ERRCODE='23505'; END IF;
 INSERT INTO ms.contact_custody_reviews
 (organization_id,contact_id,assignment_id,kind,requested_by,
  request_evidence_ref,request_reason_zh,request_key)
 VALUES(org,c.id,p_assignment,p_kind,actor,p_evidence,p_reason,p_key)
 RETURNING id INTO new_id;
 INSERT INTO ms.audit_events
 (organization_id,actor_user_id,target_type,target_id,event_name,reason_zh,after_business_json)
 VALUES(org,actor,'contact',c.id,'CONTACT_CUSTODY_REVIEW_REQUESTED',
 '已登记交接撤回或争议申请；现有权限尚未改变',
 jsonb_build_object('申请类别',CASE WHEN p_kind='withdrawal' THEN '撤回' ELSE '争议复核' END,'状态','待独立复核'));
 RETURN new_id;
END $f$;

CREATE FUNCTION ms.decide_custody_review(
 p_review uuid,p_result text,p_evidence text,p_reason text,p_key text
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ms AS $f$
DECLARE actor uuid;org uuid;r ms.contact_custody_reviews%ROWTYPE;
 a ms.contact_custody_assignments%ROWTYPE;
 prior_request ms.contact_custody_requests%ROWTYPE;
 existing ms.contact_custody_review_decisions%ROWTYPE;
 current_contact uuid;restored uuid;
BEGIN
 SELECT staff_id,org_id INTO actor,org FROM ms.access_actor();
 IF actor IS NULL THEN RAISE EXCEPTION '审核身份无效' USING ERRCODE='42501'; END IF;
 IF p_result IS NULL OR p_result NOT IN ('upheld','reversed','rejected')
  OR p_key IS NULL OR p_key !~ '^[a-zA-Z0-9_-]{16,128}$'
  OR p_evidence IS NULL OR length(trim(p_evidence)) NOT BETWEEN 1 AND 200
  OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 2 AND 400
 THEN RAISE EXCEPTION '复核决定缺少必要材料' USING ERRCODE='23514'; END IF;
 SELECT * INTO existing FROM ms.contact_custody_review_decisions
 WHERE reviewer_id=actor AND decision_key=p_key;
 IF FOUND THEN
  IF existing.review_id=p_review AND existing.result=p_result
   AND existing.evidence_ref=p_evidence AND existing.reason_zh=p_reason
  THEN RETURN CASE WHEN p_result='reversed' THEN '已撤回' ELSE '已完成复核' END; END IF;
  RAISE EXCEPTION '重复审批编号冲突' USING ERRCODE='23505';
 END IF;
 SELECT * INTO r FROM ms.contact_custody_reviews
 WHERE id=p_review AND organization_id=org FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '没有权限查看该复核申请'
   USING ERRCODE='42501'; END IF;
 IF r.status<>'pending' THEN RAISE EXCEPTION '复核已经结束'
   USING ERRCODE='23505'; END IF;
 SELECT * INTO prior_request FROM ms.contact_custody_requests
 WHERE id=(SELECT approval_request_id FROM ms.contact_custody_assignments
   WHERE id=r.assignment_id);
 -- Independent reviewer may not be the creator, applicant, original sender,
 -- receiving employee or prior owner; valid organization manager only.
 IF actor IN (r.requested_by,prior_request.requested_by,
              prior_request.target_staff_id)
 OR EXISTS(SELECT 1 FROM ms.contact_custody_assignments x
      WHERE x.id=r.assignment_id AND x.prior_custodian_id=actor)
 THEN RAISE EXCEPTION '当事人不得审核自己的争议'
   USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM ms.user_role_grants g
  JOIN ms.role_templates t ON t.id=g.role_id
  WHERE g.user_id=actor AND g.revoked_at IS NULL AND g.valid_from<=now()
    AND t.organization_id=org AND t.role_code IN ('sales_manager','super_admin'))
 THEN RAISE EXCEPTION '必须由有效独立主管复核'
   USING ERRCODE='42501'; END IF;
 SELECT id INTO current_contact FROM ms.contacts
 WHERE id=r.contact_id AND organization_id=org AND archived_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '联系人已经失效' USING ERRCODE='23514'; END IF;
 SELECT * INTO a FROM ms.contact_custody_assignments
 WHERE id=r.assignment_id AND contact_id=r.contact_id AND organization_id=org
 AND revoked_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '当前管理权已变化，不能应用旧复核决定'
   USING ERRCODE='23514'; END IF;
 IF p_result='reversed' THEN
   restored:=a.prior_custodian_id;
   IF restored IS NULL OR restored=a.assignee_id
    OR NOT EXISTS(SELECT 1 FROM ms.staff_users
      WHERE id=restored AND organization_id=org AND status='active')
   THEN RAISE EXCEPTION '前任管理人已失效，不可自动恢复'
     USING ERRCODE='23514'; END IF;
   UPDATE ms.contact_custody_assignments SET revoked_at=now()
    WHERE id=a.id AND revoked_at IS NULL;
   -- Reversal is a NEW auditable assignment, not a rewrite of old history.
   INSERT INTO ms.contact_custody_assignments
    (organization_id,contact_id,assignee_id,approval_request_id,prior_custodian_id,review_id)
   VALUES(org,r.contact_id,restored,a.approval_request_id,a.assignee_id,r.id);
 END IF;
 INSERT INTO ms.contact_custody_review_decisions
 (review_id,reviewer_id,result,evidence_ref,reason_zh,decision_key)
 VALUES(r.id,actor,p_result,p_evidence,p_reason,p_key);
 UPDATE ms.contact_custody_reviews
 SET status=p_result,reviewed_by=actor,reviewed_at=now() WHERE id=r.id;
 INSERT INTO ms.audit_events
 (organization_id,actor_user_id,target_type,target_id,event_name,reason_zh,after_business_json)
 VALUES(org,actor,'contact',r.contact_id,'CONTACT_CUSTODY_REVIEW_DECIDED',
 '独立复核决定生效；没有转移学生或历史咨询',
 jsonb_build_object('复核结果',CASE p_result WHEN 'reversed' THEN '撤回并恢复前任管理人'
 WHEN 'upheld' THEN '维持现管理权' ELSE '驳回复核' END));
 RETURN CASE WHEN p_result='reversed' THEN '已撤回' ELSE '已完成复核' END;
END $f$;
REVOKE ALL ON FUNCTION ms.request_custody_review(uuid,text,text,text,text),
 ms.decide_custody_review(uuid,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ms.request_custody_review(uuid,text,text,text,text),
 ms.decide_custody_review(uuid,text,text,text,text) TO ms_scoped_lowrisk_writer;

-- Minimal visible review summary. Evidence and private reasons are NOT exported.
CREATE VIEW ms.scoped_contact_custody_active
WITH (security_barrier=true) AS
SELECT a.id AS assignment_id,a.contact_id,c.display_name AS contact_name,
 a.assignee_id,a.granted_at
FROM ms.contact_custody_assignments a
JOIN ms.contacts c ON c.id=a.contact_id
JOIN ms.contact_custody_requests q ON q.id=a.approval_request_id
WHERE a.organization_id=ms.current_scoped_organization_id()
 AND a.revoked_at IS NULL AND ms.current_scoped_staff_id() IS NOT NULL
 AND ms.current_scoped_staff_id() IN (a.assignee_id,q.requested_by,a.prior_custodian_id);
CREATE VIEW ms.scoped_contact_custody_reviews
WITH (security_barrier=true) AS
SELECT r.id AS review_id,r.assignment_id,r.kind,r.status,
 c.display_name AS contact_name,r.created_at
FROM ms.contact_custody_reviews r
JOIN ms.contacts c ON c.id=r.contact_id
WHERE r.organization_id=ms.current_scoped_organization_id()
 AND ms.current_scoped_staff_id() IS NOT NULL
 AND (r.requested_by=ms.current_scoped_staff_id()
  OR EXISTS(SELECT 1 FROM ms.contact_custody_assignments a
   JOIN ms.contact_custody_requests q ON q.id=a.approval_request_id
   WHERE a.id=r.assignment_id
    AND ms.current_scoped_staff_id() IN
      (q.requested_by,q.target_staff_id,a.prior_custodian_id))
  OR EXISTS(SELECT 1 FROM ms.user_role_grants g
   JOIN ms.role_templates t ON t.id=g.role_id
   WHERE g.user_id=ms.current_scoped_staff_id() AND g.revoked_at IS NULL
    AND g.valid_from<=now() AND t.organization_id=r.organization_id
    AND t.role_code IN ('sales_manager','super_admin')));
REVOKE ALL ON ms.scoped_contact_custody_reviews,ms.scoped_contact_custody_active FROM PUBLIC;
GRANT SELECT ON ms.scoped_contact_custody_reviews,ms.scoped_contact_custody_active TO ms_student_assignee_reader;

-- Existing student rows (owned/shared) keep their own grant checks.
-- A *verified* parent link gives a custodian only a MINIMAL read projection,
-- never grades, school, full student details, other siblings or financial data.
-- Unverified links never confer this relation-only read permission.
CREATE VIEW ms.scoped_related_student_basic
WITH (security_barrier=true) AS
SELECT DISTINCT s.id AS student_id,s.display_name AS student_name,
 sc.relation_type AS contact_relation
FROM ms.students s
JOIN ms.student_contacts sc ON sc.student_id=s.id AND sc.valid_to IS NULL
  AND sc.verification_state='verified'
JOIN ms.contacts c ON c.id=sc.contact_id AND c.organization_id=s.organization_id
  AND c.archived_at IS NULL
WHERE s.organization_id=ms.current_scoped_organization_id()
 AND s.archived_at IS NULL AND ms.current_scoped_staff_id() IS NOT NULL
 AND EXISTS(SELECT 1 FROM ms.contact_custody_assignments a
   WHERE a.contact_id=c.id AND a.revoked_at IS NULL
   AND a.assignee_id=ms.current_scoped_staff_id());
REVOKE ALL ON ms.scoped_related_student_basic FROM PUBLIC;
GRANT SELECT ON ms.scoped_related_student_basic TO ms_student_assignee_reader;
COMMIT;
