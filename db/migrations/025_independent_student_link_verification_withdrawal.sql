-- V3.2-21: independently reviewed single-student lead link verification and error withdrawal.
-- Disposable fictional PostgreSQL 16 ONLY, after migrations 001-024. Never production CRM.
BEGIN;
CREATE TABLE ms.lead_student_link_review_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES ms.organizations(id),
 association_request_id uuid NOT NULL REFERENCES ms.lead_student_association_requests(id),
 lead_id uuid NOT NULL REFERENCES ms.leads(id),
 student_id uuid NOT NULL REFERENCES ms.students(id),
 requested_by uuid NOT NULL REFERENCES ms.staff_users(id),
 action text NOT NULL CHECK (action IN ('verify','withdraw')),
 basis_kind text,
 evidence_ref text NOT NULL CHECK (length(trim(evidence_ref)) BETWEEN 2 AND 200),
 confirmation_ref text,
 reason_zh text NOT NULL CHECK (length(trim(reason_zh)) BETWEEN 2 AND 400),
 request_key text NOT NULL CHECK (request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
 reviewed_by uuid REFERENCES ms.staff_users(id),
 reviewed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(requested_by,request_key),
 CHECK ((action='verify'
     AND basis_kind IN ('student_consultation','independent_student_confirmation')
     AND confirmation_ref IS NOT NULL
     AND length(trim(confirmation_ref)) BETWEEN 2 AND 200)
    OR (action='withdraw' AND basis_kind IS NULL AND confirmation_ref IS NULL)),
 CHECK ((status='pending' AND reviewed_by IS NULL AND reviewed_at IS NULL)
  OR (status<>'pending' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
);
CREATE UNIQUE INDEX uq_one_pending_student_link_review
 ON ms.lead_student_link_review_requests(association_request_id) WHERE status='pending';
CREATE UNIQUE INDEX uq_one_approved_student_link_action
 ON ms.lead_student_link_review_requests(association_request_id,action) WHERE status='approved';
CREATE TABLE ms.lead_student_link_review_decisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 request_id uuid NOT NULL UNIQUE REFERENCES ms.lead_student_link_review_requests(id),
 reviewer_id uuid NOT NULL REFERENCES ms.staff_users(id),
 decision text NOT NULL CHECK(decision IN('approved','rejected')),
 evidence_ref text NOT NULL CHECK(length(trim(evidence_ref)) BETWEEN 2 AND 200),
 reason_zh text NOT NULL CHECK(length(trim(reason_zh)) BETWEEN 2 AND 400),
 request_key text NOT NULL CHECK (request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
 decided_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(reviewer_id,request_key)
);
CREATE TABLE ms.lead_student_link_review_effects (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 request_id uuid NOT NULL UNIQUE REFERENCES ms.lead_student_link_review_requests(id),
 lead_id uuid NOT NULL REFERENCES ms.leads(id),
 student_id uuid NOT NULL REFERENCES ms.students(id),
 action text NOT NULL CHECK(action IN('verify','withdraw')),
 applied_by uuid NOT NULL REFERENCES ms.staff_users(id),
 prior_state text NOT NULL CHECK(prior_state IN('pending_review','verified')),
 new_state text NOT NULL CHECK(new_state IN('verified','withdrawn')),
 applied_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((action='verify' AND prior_state='pending_review' AND new_state='verified')
  OR (action='withdraw' AND new_state='withdrawn'))
);
ALTER TABLE ms.lead_student_link_review_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE ms.lead_student_link_review_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ms.lead_student_link_review_effects ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ms.lead_student_link_review_requests,ms.lead_student_link_review_decisions,
 ms.lead_student_link_review_effects FROM PUBLIC,ms_lowrisk_runtime;
CREATE TRIGGER immutable_student_link_review_decisions BEFORE UPDATE OR DELETE
 ON ms.lead_student_link_review_decisions
 FOR EACH ROW EXECUTE FUNCTION ms.reject_access_history_mutation();
CREATE TRIGGER immutable_student_link_review_effects BEFORE UPDATE OR DELETE
 ON ms.lead_student_link_review_effects
 FOR EACH ROW EXECUTE FUNCTION ms.reject_access_history_mutation();

-- Only minimal UI columns; verification references remain internal to the
-- approved DB functions, not discoverable in another employee's directory.
CREATE VIEW ms.scoped_lead_student_link_review_requests
 WITH (security_barrier=true) AS
SELECT r.id AS review_id,r.association_request_id,r.lead_id,r.student_id,
 s.display_name AS student_name,r.action,r.status,r.created_at,r.requested_by,
 ls.confirmation_state AS current_state
FROM ms.lead_student_link_review_requests r
JOIN ms.students s ON s.id=r.student_id AND s.organization_id=r.organization_id
JOIN ms.lead_students ls ON ls.lead_id=r.lead_id AND ls.student_id=r.student_id
WHERE r.organization_id=ms.current_scoped_organization_id()
 AND ms.current_scoped_staff_id() IS NOT NULL
 AND (r.requested_by=ms.current_scoped_staff_id()
   OR r.reviewed_by=ms.current_scoped_staff_id()
   OR (r.status='pending' AND EXISTS(
    SELECT 1 FROM ms.user_role_grants g JOIN ms.role_templates t ON t.id=g.role_id
    WHERE g.user_id=ms.current_scoped_staff_id() AND g.revoked_at IS NULL
     AND g.valid_from<=now() AND t.organization_id=r.organization_id
     AND t.role_code IN ('sales_manager','super_admin'))));
CREATE VIEW ms.scoped_lead_student_link_current
 WITH (security_barrier=true) AS
SELECT q.id AS association_request_id,q.lead_id,q.student_id,
 s.display_name AS student_name,ls.confirmation_state AS current_state
FROM ms.lead_student_association_requests q
JOIN ms.students s ON s.id=q.student_id AND s.organization_id=q.organization_id
JOIN ms.leads l ON l.id=q.lead_id AND l.organization_id=q.organization_id
JOIN ms.lead_students ls ON ls.lead_id=q.lead_id AND ls.student_id=q.student_id
WHERE q.organization_id=ms.current_scoped_organization_id()
 AND q.status='approved_pending'
 AND ms.current_scoped_staff_id() IS NOT NULL
 AND l.owner_user_id=ms.current_scoped_staff_id()
 AND EXISTS(SELECT 1 FROM ms.lead_conversion_executions ex
  WHERE ex.lead_id=q.lead_id AND ex.organization_id=q.organization_id
    AND ex.executed_by=ms.current_scoped_staff_id());
REVOKE ALL ON ms.scoped_lead_student_link_review_requests,
 ms.scoped_lead_student_link_current FROM PUBLIC;
GRANT SELECT ON ms.scoped_lead_student_link_review_requests,
 ms.scoped_lead_student_link_current TO ms_student_assignee_reader;

CREATE FUNCTION ms.request_lead_student_link_review(
 p_association uuid,p_action text,p_basis text,
 p_evidence text,p_confirmation text,p_reason text,p_key text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ms AS $f$
DECLARE actor uuid;org uuid;q ms.lead_student_association_requests%ROWTYPE;
 l ms.leads%ROWTYPE;stu ms.students%ROWTYPE;
 old ms.lead_student_link_review_requests%ROWTYPE;
 state text;new_id uuid;
BEGIN
 SELECT staff_id,org_id INTO actor,org FROM ms.access_actor();
 IF actor IS NULL THEN RAISE EXCEPTION '员工身份无效' USING ERRCODE='42501'; END IF;
 IF p_association IS NULL OR p_action NOT IN ('verify','withdraw')
 OR p_key IS NULL OR p_key !~ '^[A-Za-z0-9_-]{16,128}$'
 OR p_evidence IS NULL OR length(trim(p_evidence)) NOT BETWEEN 2 AND 200
 OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 2 AND 400
 OR (p_action='verify' AND
   (p_basis NOT IN ('student_consultation','independent_student_confirmation')
    OR p_basis IS NULL OR p_confirmation IS NULL
    OR length(trim(p_confirmation)) NOT BETWEEN 2 AND 200))
 OR (p_action='withdraw' AND (p_basis IS NOT NULL OR p_confirmation IS NOT NULL))
 THEN RAISE EXCEPTION '学生关联核实或撤回材料不完整' USING ERRCODE='23514'; END IF;
 SELECT * INTO old FROM ms.lead_student_link_review_requests
 WHERE requested_by=actor AND request_key=p_key;
 IF FOUND THEN
  IF old.association_request_id=p_association AND old.action=p_action
  AND old.basis_kind IS NOT DISTINCT FROM p_basis
  AND old.evidence_ref=p_evidence
  AND old.confirmation_ref IS NOT DISTINCT FROM p_confirmation
  AND old.reason_zh=p_reason THEN RETURN old.id; END IF;
  RAISE EXCEPTION '本次操作编号已用于不同内容' USING ERRCODE='23505'; END IF;
 SELECT * INTO q FROM ms.lead_student_association_requests
 WHERE id=p_association AND organization_id=org AND status='approved_pending';
 IF NOT FOUND OR q.requested_by IS DISTINCT FROM actor THEN
  RAISE EXCEPTION '只能处理本人独立审批通过的单名学生关联'
  USING ERRCODE='42501'; END IF;
 SELECT * INTO l FROM ms.leads WHERE id=q.lead_id
 AND organization_id=org AND owner_user_id=actor FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '当前线索归属已发生变化'
 USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM ms.lead_conversion_executions ex
 WHERE ex.lead_id=l.id AND ex.organization_id=org AND ex.executed_by=actor)
 THEN RAISE EXCEPTION '没有独立转换的真实线索来源' USING ERRCODE='42501'; END IF;
 SELECT * INTO stu FROM ms.students WHERE id=q.student_id
 AND organization_id=org FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '指定学生已失效' USING ERRCODE='23514'; END IF;
 SELECT ls.confirmation_state INTO state FROM ms.lead_students ls
 WHERE ls.lead_id=q.lead_id AND ls.student_id=q.student_id FOR UPDATE;
 IF state IS NULL THEN RAISE EXCEPTION '学生关联不存在' USING ERRCODE='23514'; END IF;
 IF p_action='verify' THEN
  IF state<>'pending_review' OR stu.owner_user_id IS DISTINCT FROM actor
   OR stu.archived_at IS NOT NULL
   OR l.lead_state IN('invalid','closed','converted')
  THEN RAISE EXCEPTION '未确认关联资格失效，不能核实' USING ERRCODE='23514'; END IF;
 ELSE
  IF state NOT IN('pending_review','verified') THEN
   RAISE EXCEPTION '该学生关联已撤回或不允许再次撤回'
   USING ERRCODE='23514'; END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM ms.lead_student_link_review_requests
   WHERE association_request_id=q.id AND status='pending')
 THEN RAISE EXCEPTION '该学生已有待审核实或撤回'
 USING ERRCODE='23505'; END IF;
 IF EXISTS(SELECT 1 FROM ms.lead_student_link_review_requests
   WHERE association_request_id=q.id AND action=p_action AND status='approved')
 THEN RAISE EXCEPTION '该操作已有已批准历史'
 USING ERRCODE='23505'; END IF;
 INSERT INTO ms.lead_student_link_review_requests(
  organization_id,association_request_id,lead_id,student_id,
  requested_by,action,basis_kind,evidence_ref,confirmation_ref,reason_zh,request_key)
 VALUES(org,q.id,l.id,stu.id,actor,p_action,p_basis,p_evidence,p_confirmation,p_reason,p_key)
 RETURNING id INTO new_id;
 INSERT INTO ms.audit_events(
  organization_id,actor_user_id,target_type,target_id,event_name,reason_zh,after_business_json)
 VALUES(org,actor,'lead',l.id,'LEAD_STUDENT_LINK_REVIEW_REQUESTED',
  '指定单名学生关系核实或错误撤回已申请，尚未改变核实状态',
  jsonb_build_object('操作',CASE WHEN p_action='verify' THEN '申请人工核实关联' ELSE '申请撤回错误关联' END,
  '状态','等待独立主管审核','家庭关系','未推断'));
 RETURN new_id;
END $f$;

CREATE FUNCTION ms.decide_lead_student_link_review(
 p_review uuid,p_decision text,p_evidence text,p_reason text,p_key text
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ms AS $f$
DECLARE reviewer uuid;org uuid;r ms.lead_student_link_review_requests%ROWTYPE;
 q ms.lead_student_association_requests%ROWTYPE;
 l ms.leads%ROWTYPE;stu ms.students%ROWTYPE;
 old ms.lead_student_link_review_decisions%ROWTYPE;state text;
 result_text text;
BEGIN
 SELECT staff_id,org_id INTO reviewer,org FROM ms.access_actor();
 IF reviewer IS NULL THEN RAISE EXCEPTION '主管身份无效' USING ERRCODE='42501'; END IF;
 IF p_review IS NULL OR p_decision NOT IN('approved','rejected')
 OR p_key IS NULL OR p_key !~ '^[A-Za-z0-9_-]{16,128}$'
 OR p_evidence IS NULL OR length(trim(p_evidence)) NOT BETWEEN 2 AND 200
 OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 2 AND 400
 THEN RAISE EXCEPTION '主管独立审核材料不完整' USING ERRCODE='23514'; END IF;
 SELECT * INTO old FROM ms.lead_student_link_review_decisions
 WHERE reviewer_id=reviewer AND request_key=p_key;
 IF FOUND THEN
  IF old.request_id=p_review AND old.decision=p_decision
   AND old.evidence_ref=p_evidence AND old.reason_zh=p_reason THEN
   SELECT action INTO result_text FROM ms.lead_student_link_review_requests
    WHERE id=p_review AND organization_id=org;
   RETURN CASE WHEN p_decision='rejected' THEN '独立审核已驳回，关联未改变'
    WHEN result_text='verify' THEN '已核实这一名学生的销售线索关联，未核实监护关系'
    ELSE '错误学生关联已撤回，原审批及线索历史保留' END;
  END IF;
  RAISE EXCEPTION '主管审核编号已经用于其他决定' USING ERRCODE='23505'; END IF;
 SELECT * INTO r FROM ms.lead_student_link_review_requests
 WHERE id=p_review AND organization_id=org FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '本机构不存在这项独立核实申请' USING ERRCODE='42501'; END IF;
 IF r.status<>'pending' THEN RAISE EXCEPTION '该学生关联核实/撤回已处理'
 USING ERRCODE='23505'; END IF;
 IF reviewer=r.requested_by THEN RAISE EXCEPTION '关联申请人不得审核自己'
 USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM ms.user_role_grants g
  JOIN ms.role_templates t ON t.id=g.role_id
  JOIN ms.staff_users s ON s.id=g.user_id
  WHERE g.user_id=reviewer AND g.revoked_at IS NULL AND g.valid_from<=now()
   AND t.organization_id=org AND s.status='active' AND s.organization_id=org
   AND t.role_code IN('sales_manager','super_admin'))
 THEN RAISE EXCEPTION '仅本机构有效独立主管可审核'
 USING ERRCODE='42501'; END IF;
 SELECT * INTO q FROM ms.lead_student_association_requests
 WHERE id=r.association_request_id AND organization_id=org
  AND lead_id=r.lead_id AND student_id=r.student_id
  AND requested_by=r.requested_by AND status='approved_pending';
 IF NOT FOUND THEN RAISE EXCEPTION '原单学生待核实审批链不完整'
 USING ERRCODE='23514'; END IF;
 IF p_decision='approved' THEN
  SELECT * INTO l FROM ms.leads WHERE id=r.lead_id AND organization_id=org FOR UPDATE;
  SELECT * INTO stu FROM ms.students WHERE id=r.student_id AND organization_id=org FOR UPDATE;
  IF l.id IS NULL OR stu.id IS NULL OR l.owner_user_id IS DISTINCT FROM r.requested_by
  THEN RAISE EXCEPTION '关联当前负责人或机构已变化' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM ms.lead_conversion_executions ex
   WHERE ex.lead_id=l.id AND ex.organization_id=org
    AND ex.executed_by=r.requested_by)
  THEN RAISE EXCEPTION '线索创建历史未通过独立转换'
  USING ERRCODE='23514'; END IF;
  SELECT confirmation_state INTO state FROM ms.lead_students
    WHERE lead_id=r.lead_id AND student_id=r.student_id FOR UPDATE;
  IF state IS NULL THEN RAISE EXCEPTION '单名学生关联已失效'
    USING ERRCODE='23514'; END IF;
  IF r.action='verify' THEN
   IF state<>'pending_review' OR l.lead_state IN('invalid','closed','converted')
    OR stu.archived_at IS NOT NULL OR stu.owner_user_id IS DISTINCT FROM r.requested_by
   THEN RAISE EXCEPTION '指定学生关联不再符合人工核实条件'
    USING ERRCODE='23514'; END IF;
   -- This is ONLY a commercial lead-to-student link, not guardian identity verification.
   UPDATE ms.lead_students SET confirmation_state='verified',confirmed_by=reviewer
    WHERE lead_id=r.lead_id AND student_id=r.student_id;
  ELSE
   IF state NOT IN('pending_review','verified') THEN
    RAISE EXCEPTION '此关联已被撤回' USING ERRCODE='23514'; END IF;
   -- Withdrawal is not a rollback of the original lead, nor a deletion.
   IF EXISTS(SELECT 1 FROM ms.opportunities o
     WHERE o.originating_lead_id=r.lead_id AND o.student_id=r.student_id)
   THEN RAISE EXCEPTION '已有此学生的下游销售商机，必须单独纠正跨模块业务'
     USING ERRCODE='23514'; END IF;
   UPDATE ms.lead_students SET confirmation_state='withdrawn'
    WHERE lead_id=r.lead_id AND student_id=r.student_id;
  END IF;
  INSERT INTO ms.lead_student_link_review_effects(
    request_id,lead_id,student_id,action,applied_by,prior_state,new_state)
  VALUES(r.id,r.lead_id,r.student_id,r.action,reviewer,state,
    CASE WHEN r.action='verify' THEN 'verified' ELSE 'withdrawn' END);
 END IF;
 INSERT INTO ms.lead_student_link_review_decisions(
  request_id,reviewer_id,decision,evidence_ref,reason_zh,request_key)
 VALUES(r.id,reviewer,p_decision,p_evidence,p_reason,p_key);
 UPDATE ms.lead_student_link_review_requests
 SET status=p_decision,reviewed_by=reviewer,reviewed_at=now() WHERE id=r.id;
 result_text:= CASE WHEN p_decision='rejected' THEN '独立审核已驳回，关联未改变'
  WHEN r.action='verify' THEN '已核实这一名学生的销售线索关联，未核实监护关系'
  ELSE '错误学生关联已撤回，原审批及线索历史保留' END;
 INSERT INTO ms.audit_events(
  organization_id,actor_user_id,target_type,target_id,event_name,reason_zh,after_business_json)
 VALUES(org,reviewer,'lead',r.lead_id,'LEAD_STUDENT_LINK_REVIEW_DECIDED',
  '独立主管按单名学生核实或撤回关联；不更改家庭、原咨询、合同或财务',
  jsonb_build_object('结论',result_text,'仅指定学生',stu.display_name,
    '监护关系','未因此确认','原始记录','保留'));
 RETURN result_text;
END $f$;

REVOKE ALL ON FUNCTION
 ms.request_lead_student_link_review(uuid,text,text,text,text,text,text),
 ms.decide_lead_student_link_review(uuid,text,text,text,text)
 FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
 ms.request_lead_student_link_review(uuid,text,text,text,text,text,text),
 ms.decide_lead_student_link_review(uuid,text,text,text,text)
 TO ms_scoped_lowrisk_writer;
COMMIT;
