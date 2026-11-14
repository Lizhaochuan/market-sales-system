-- V3.2-20: student-first tentative lead links + audited invalidation/note correction.
-- PG16 disposable fictional database only. After 001-023. Not production CRM.
BEGIN;
CREATE TABLE ms.lead_student_association_requests(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES ms.organizations(id),
 lead_id uuid NOT NULL REFERENCES ms.leads(id),
 student_id uuid NOT NULL REFERENCES ms.students(id),
 requested_by uuid NOT NULL REFERENCES ms.staff_users(id),
 evidence_ref text NOT NULL CHECK(length(trim(evidence_ref)) BETWEEN 2 AND 200),
 reason_zh text NOT NULL CHECK(length(trim(reason_zh)) BETWEEN 2 AND 400),
 request_key text NOT NULL CHECK(request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved_pending','rejected')),
 reviewed_by uuid REFERENCES ms.staff_users(id),
 reviewed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(lead_id,student_id),UNIQUE(requested_by,request_key),
 CHECK ((status='pending' AND reviewed_by IS NULL AND reviewed_at IS NULL)
   OR(status<>'pending' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
);
CREATE TABLE ms.lead_student_association_decisions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 request_id uuid NOT NULL UNIQUE REFERENCES ms.lead_student_association_requests(id),
 reviewer_id uuid NOT NULL REFERENCES ms.staff_users(id),
 decision text NOT NULL CHECK(decision IN('approved_pending','rejected')),
 evidence_ref text NOT NULL CHECK(length(trim(evidence_ref)) BETWEEN 2 AND 200),
 reason_zh text NOT NULL CHECK(length(trim(reason_zh)) BETWEEN 2 AND 400),
 request_key text NOT NULL CHECK(request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
 decided_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(reviewer_id,request_key)
);
CREATE TABLE ms.lead_adjustment_requests(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES ms.organizations(id),
 lead_id uuid NOT NULL REFERENCES ms.leads(id),
 requested_by uuid NOT NULL REFERENCES ms.staff_users(id),
 action text NOT NULL CHECK(action IN('invalidate','correct_note')),
 proposed_note text CHECK(proposed_note IS NULL OR length(trim(proposed_note)) BETWEEN 2 AND 200),
 evidence_ref text NOT NULL CHECK(length(trim(evidence_ref)) BETWEEN 2 AND 200),
 reason_zh text NOT NULL CHECK(length(trim(reason_zh)) BETWEEN 2 AND 400),
 request_key text NOT NULL CHECK(request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','approved','rejected')),
 reviewed_by uuid REFERENCES ms.staff_users(id),
 reviewed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(requested_by,request_key),
 CHECK ((action='correct_note' AND proposed_note IS NOT NULL) OR
        (action='invalidate' AND proposed_note IS NULL)),
 CHECK ((status='pending' AND reviewed_by IS NULL AND reviewed_at IS NULL)
   OR(status<>'pending' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
);
CREATE UNIQUE INDEX uq_pending_lead_adjustment ON ms.lead_adjustment_requests(lead_id)
 WHERE status='pending';
CREATE TABLE ms.lead_adjustment_decisions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 request_id uuid NOT NULL UNIQUE REFERENCES ms.lead_adjustment_requests(id),
 reviewer_id uuid NOT NULL REFERENCES ms.staff_users(id),
 decision text NOT NULL CHECK(decision IN('approved','rejected')),
 evidence_ref text NOT NULL CHECK(length(trim(evidence_ref)) BETWEEN 2 AND 200),
 reason_zh text NOT NULL CHECK(length(trim(reason_zh)) BETWEEN 2 AND 400),
 request_key text NOT NULL CHECK(request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
 decided_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(reviewer_id,request_key)
);
CREATE TABLE ms.lead_adjustment_effects(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 request_id uuid NOT NULL UNIQUE REFERENCES ms.lead_adjustment_requests(id),
 lead_id uuid NOT NULL REFERENCES ms.leads(id),
 action text NOT NULL CHECK(action IN('invalidate','correct_note')),
 corrected_note text,
 applied_by uuid NOT NULL REFERENCES ms.staff_users(id),
 applied_at timestamptz NOT NULL DEFAULT now(),
 CHECK((action='correct_note' AND corrected_note IS NOT NULL) OR
       (action='invalidate' AND corrected_note IS NULL))
);
ALTER TABLE ms.lead_student_association_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE ms.lead_student_association_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ms.lead_adjustment_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE ms.lead_adjustment_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ms.lead_adjustment_effects ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ms.lead_student_association_requests,
 ms.lead_student_association_decisions,ms.lead_adjustment_requests,
 ms.lead_adjustment_decisions,ms.lead_adjustment_effects
 FROM PUBLIC,ms_lowrisk_runtime;
CREATE TRIGGER immutable_association_decisions
 BEFORE UPDATE OR DELETE ON ms.lead_student_association_decisions
 FOR EACH ROW EXECUTE FUNCTION ms.reject_access_history_mutation();
CREATE TRIGGER immutable_adjustment_decisions
 BEFORE UPDATE OR DELETE ON ms.lead_adjustment_decisions
 FOR EACH ROW EXECUTE FUNCTION ms.reject_access_history_mutation();
CREATE TRIGGER immutable_lead_adjustment_effects
 BEFORE UPDATE OR DELETE ON ms.lead_adjustment_effects
 FOR EACH ROW EXECUTE FUNCTION ms.reject_access_history_mutation();

CREATE VIEW ms.scoped_lead_student_associations WITH (security_barrier=true) AS
SELECT q.id AS request_id,q.lead_id,q.student_id,
 s.display_name AS student_name,q.status,q.created_at,
 q.requested_by
FROM ms.lead_student_association_requests q
JOIN ms.students s ON s.id=q.student_id AND s.organization_id=q.organization_id
WHERE q.organization_id=ms.current_scoped_organization_id()
 AND ms.current_scoped_staff_id() IS NOT NULL
 AND (q.requested_by=ms.current_scoped_staff_id()
   OR q.reviewed_by=ms.current_scoped_staff_id()
   OR (q.status='pending' AND EXISTS(
     SELECT 1 FROM ms.user_role_grants g JOIN ms.role_templates t ON t.id=g.role_id
     WHERE g.user_id=ms.current_scoped_staff_id()
      AND g.revoked_at IS NULL AND g.valid_from<=now()
      AND t.organization_id=q.organization_id
      AND t.role_code IN('sales_manager','super_admin'))));
CREATE VIEW ms.scoped_lead_adjustment_requests WITH (security_barrier=true) AS
SELECT q.id AS request_id,q.lead_id,q.action,q.status,q.created_at,
 CASE WHEN q.action='invalidate' THEN '申请作废线索'
 ELSE '申请更正业务说明' END AS action_name,
 q.requested_by
FROM ms.lead_adjustment_requests q
WHERE q.organization_id=ms.current_scoped_organization_id()
 AND ms.current_scoped_staff_id() IS NOT NULL
 AND (q.requested_by=ms.current_scoped_staff_id()
   OR q.reviewed_by=ms.current_scoped_staff_id()
   OR (q.status='pending' AND EXISTS(
     SELECT 1 FROM ms.user_role_grants g JOIN ms.role_templates t ON t.id=g.role_id
     WHERE g.user_id=ms.current_scoped_staff_id()
      AND g.revoked_at IS NULL AND g.valid_from<=now()
      AND t.organization_id=q.organization_id
      AND t.role_code IN('sales_manager','super_admin'))));
CREATE VIEW ms.scoped_lead_correction_notes WITH (security_barrier=true) AS
SELECT e.lead_id,e.corrected_note,e.applied_at
FROM ms.lead_adjustment_effects e JOIN ms.leads l ON l.id=e.lead_id
WHERE e.action='correct_note' AND l.organization_id=ms.current_scoped_organization_id()
 AND l.owner_user_id=ms.current_scoped_staff_id()
 AND NOT EXISTS(SELECT 1 FROM ms.lead_adjustment_effects later
 WHERE later.lead_id=e.lead_id AND later.action='correct_note'
 AND (later.applied_at>e.applied_at OR
   (later.applied_at=e.applied_at AND later.id>e.id)));
REVOKE ALL ON ms.scoped_lead_student_associations,
 ms.scoped_lead_adjustment_requests,ms.scoped_lead_correction_notes FROM PUBLIC;
GRANT SELECT ON ms.scoped_lead_student_associations,
 ms.scoped_lead_adjustment_requests,ms.scoped_lead_correction_notes
 TO ms_student_assignee_reader;

-- The helper locks lead and checks the ORIGINAL V3.2-19 execution provenance.
-- A historical legacy lead is not eligible for the new employee-only workflow.
CREATE FUNCTION ms.assert_lead_change_owner(p_lead uuid,p_actor uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ms AS $f$
DECLARE org uuid;l ms.leads%ROWTYPE;
BEGIN
 SELECT org_id INTO org FROM ms.access_actor() WHERE staff_id=p_actor;
 IF org IS NULL THEN RAISE EXCEPTION '员工身份无效' USING ERRCODE='42501'; END IF;
 SELECT * INTO l FROM ms.leads
 WHERE id=p_lead AND organization_id=org AND owner_user_id=p_actor FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '只能操作自己当前负责的正式线索'
 USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM ms.lead_conversion_executions ex
 WHERE ex.lead_id=l.id AND ex.organization_id=org AND ex.executed_by=p_actor)
 THEN RAISE EXCEPTION '旧线索尚未完成独立迁移，不得执行新调整'
 USING ERRCODE='42501'; END IF;
 IF l.lead_state IN('invalid','closed','converted') THEN
  RAISE EXCEPTION '线索已作废、关闭或转化，不可新增业务变更'
  USING ERRCODE='23514'; END IF;
 RETURN org;
END $f$;
REVOKE ALL ON FUNCTION ms.assert_lead_change_owner(uuid,uuid) FROM PUBLIC;

CREATE FUNCTION ms.request_lead_student_association(
 p_lead uuid,p_student uuid,p_evidence text,p_reason text,p_key text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ms AS $f$
DECLARE actor uuid;org uuid;old ms.lead_student_association_requests%ROWTYPE;
 student_name text;request_id uuid;
BEGIN
 SELECT staff_id,org_id INTO actor,org FROM ms.access_actor();
 IF actor IS NULL THEN RAISE EXCEPTION '员工身份无效' USING ERRCODE='42501'; END IF;
 IF p_lead IS NULL OR p_student IS NULL OR p_key IS NULL
 OR p_key !~ '^[A-Za-z0-9_-]{16,128}$'
 OR p_evidence IS NULL OR length(trim(p_evidence)) NOT BETWEEN 2 AND 200
 OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 2 AND 400
 THEN RAISE EXCEPTION '待核实学生关联材料不完整' USING ERRCODE='23514'; END IF;
 SELECT * INTO old FROM ms.lead_student_association_requests
 WHERE requested_by=actor AND request_key=p_key;
 IF FOUND THEN
  IF old.lead_id=p_lead AND old.student_id=p_student
  AND old.evidence_ref=p_evidence AND old.reason_zh=p_reason
  THEN RETURN old.id; END IF;
  RAISE EXCEPTION '防重复编号已用于其他关联' USING ERRCODE='23505'; END IF;
 PERFORM ms.assert_lead_change_owner(p_lead,actor);
 SELECT display_name INTO student_name FROM ms.students
 WHERE id=p_student AND organization_id=org
 AND owner_user_id=actor AND archived_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '只能关联本人实际负责的指定学生'
 USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM ms.lead_students
 WHERE lead_id=p_lead AND student_id=p_student)
 OR EXISTS(SELECT 1 FROM ms.lead_student_association_requests
 WHERE lead_id=p_lead AND student_id=p_student)
 THEN RAISE EXCEPTION '此线索与指定学生已有关联或审核申请'
 USING ERRCODE='23505'; END IF;
 INSERT INTO ms.lead_student_association_requests(
 organization_id,lead_id,student_id,requested_by,evidence_ref,reason_zh,request_key)
 VALUES(org,p_lead,p_student,actor,p_evidence,p_reason,p_key)
 RETURNING id INTO request_id;
 INSERT INTO ms.audit_events(
 organization_id,actor_user_id,target_type,target_id,event_name,reason_zh,after_business_json)
 VALUES(org,actor,'lead',p_lead,'LEAD_STUDENT_LINK_PROPOSED',
 '提交与单名学生的待核实关联，不建立家庭关系或确认监护关系',
 jsonb_build_object('学生',student_name,'状态','待独立审核',
  '学生确认状态','未确认'));
 RETURN request_id;
END $f$;

CREATE FUNCTION ms.decide_lead_student_association(
 p_request uuid,p_decision text,p_evidence text,p_reason text,p_key text
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ms AS $f$
DECLARE reviewer uuid;org uuid;q ms.lead_student_association_requests%ROWTYPE;
 old ms.lead_student_association_decisions%ROWTYPE;s ms.students%ROWTYPE;
 l ms.leads%ROWTYPE;
BEGIN
 SELECT staff_id,org_id INTO reviewer,org FROM ms.access_actor();
 IF reviewer IS NULL THEN RAISE EXCEPTION '主管身份无效' USING ERRCODE='42501'; END IF;
 IF p_request IS NULL OR p_decision NOT IN('approved_pending','rejected')
 OR p_key IS NULL OR p_key !~ '^[A-Za-z0-9_-]{16,128}$'
 OR p_evidence IS NULL OR length(trim(p_evidence)) NOT BETWEEN 2 AND 200
 OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 2 AND 400
 THEN RAISE EXCEPTION '学生关联审核资料不完整'
 USING ERRCODE='23514'; END IF;
 SELECT * INTO old FROM ms.lead_student_association_decisions
 WHERE reviewer_id=reviewer AND request_key=p_key;
 IF FOUND THEN
  IF old.request_id=p_request AND old.decision=p_decision
  AND old.evidence_ref=p_evidence AND old.reason_zh=p_reason
  THEN RETURN CASE WHEN p_decision='approved_pending'
   THEN '已登记单名学生的待核实关联，不代表关系已确认'
   ELSE '学生关联申请已驳回' END; END IF;
  RAISE EXCEPTION '审核编号已用于其他决定' USING ERRCODE='23505'; END IF;
 SELECT * INTO q FROM ms.lead_student_association_requests
 WHERE id=p_request AND organization_id=org FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '本机构无此学生关联申请'
 USING ERRCODE='42501'; END IF;
 IF q.status<>'pending' THEN RAISE EXCEPTION '学生关联已审核' USING ERRCODE='23505'; END IF;
 IF reviewer=q.requested_by THEN RAISE EXCEPTION '申请人不能审核本人关联'
 USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM ms.user_role_grants g
 JOIN ms.role_templates t ON t.id=g.role_id
 JOIN ms.staff_users u ON u.id=g.user_id
 WHERE g.user_id=reviewer AND g.revoked_at IS NULL AND g.valid_from<=now()
 AND u.status='active' AND u.organization_id=org
 AND t.organization_id=org AND t.role_code IN('sales_manager','super_admin'))
 THEN RAISE EXCEPTION '仅本机构有效独立主管可复核'
 USING ERRCODE='42501'; END IF;
 SELECT * INTO l FROM ms.leads WHERE id=q.lead_id
 AND organization_id=org FOR UPDATE;
 SELECT * INTO s FROM ms.students WHERE id=q.student_id
 AND organization_id=org FOR UPDATE;
 IF NOT FOUND OR l.id IS NULL THEN RAISE EXCEPTION '线索或学生已失效'
 USING ERRCODE='23514'; END IF;
 IF p_decision='approved_pending' THEN
  IF l.owner_user_id<>q.requested_by OR
   l.lead_state IN('invalid','closed','converted') OR
   s.owner_user_id<>q.requested_by OR s.archived_at IS NOT NULL
  THEN RAISE EXCEPTION '学生或线索归属发生变化，必须重新核实'
  USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM ms.lead_conversion_executions e
  WHERE e.lead_id=l.id AND e.organization_id=org
  AND e.executed_by=q.requested_by)
  THEN RAISE EXCEPTION '没有有效的独立线索执行记录'
  USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM ms.lead_students
  WHERE lead_id=l.id AND student_id=s.id)
  THEN RAISE EXCEPTION '单名学生已经关联' USING ERRCODE='23505'; END IF;
  INSERT INTO ms.lead_students(lead_id,student_id,confirmation_state,confirmed_by)
  VALUES(l.id,s.id,'pending_review',NULL);
 END IF;
 INSERT INTO ms.lead_student_association_decisions(
 request_id,reviewer_id,decision,evidence_ref,reason_zh,request_key)
 VALUES(q.id,reviewer,p_decision,p_evidence,p_reason,p_key);
 UPDATE ms.lead_student_association_requests
 SET status=p_decision,reviewed_by=reviewer,reviewed_at=now() WHERE id=q.id;
 INSERT INTO ms.audit_events(
 organization_id,actor_user_id,target_type,target_id,event_name,reason_zh,after_business_json)
 VALUES(org,reviewer,'lead',q.lead_id,'LEAD_STUDENT_LINK_REVIEWED',
 '独立审核单名学生待核实关联，不授予任何新学生或家庭权限',
 jsonb_build_object('审核结果',CASE WHEN p_decision='approved_pending'
 THEN '待核实关联已登记' ELSE '已驳回' END,
 '关系已确认','否'));
 RETURN CASE WHEN p_decision='approved_pending'
 THEN '已登记单名学生的待核实关联，不代表关系已确认'
 ELSE '学生关联申请已驳回' END;
END $f$;

CREATE FUNCTION ms.request_lead_adjustment(
 p_lead uuid,p_action text,p_note text,p_evidence text,p_reason text,p_key text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ms AS $f$
DECLARE actor uuid;org uuid;old ms.lead_adjustment_requests%ROWTYPE;new_id uuid;
BEGIN
 SELECT staff_id,org_id INTO actor,org FROM ms.access_actor();
 IF actor IS NULL THEN RAISE EXCEPTION '员工身份无效' USING ERRCODE='42501'; END IF;
 IF p_lead IS NULL OR p_action NOT IN('invalidate','correct_note')
 OR p_key IS NULL OR p_key !~ '^[A-Za-z0-9_-]{16,128}$'
 OR p_evidence IS NULL OR length(trim(p_evidence)) NOT BETWEEN 2 AND 200
 OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 2 AND 400
 OR (p_action='correct_note' AND (p_note IS NULL OR length(trim(p_note)) NOT BETWEEN 2 AND 200))
 OR (p_action='invalidate' AND p_note IS NOT NULL)
 THEN RAISE EXCEPTION '线索作废或说明更正材料无效'
 USING ERRCODE='23514'; END IF;
 SELECT * INTO old FROM ms.lead_adjustment_requests
 WHERE requested_by=actor AND request_key=p_key;
 IF FOUND THEN
  IF old.lead_id=p_lead AND old.action=p_action
  AND old.proposed_note IS NOT DISTINCT FROM p_note
  AND old.evidence_ref=p_evidence AND old.reason_zh=p_reason
  THEN RETURN old.id; END IF;
  RAISE EXCEPTION '防重复编号已被占用' USING ERRCODE='23505'; END IF;
 PERFORM ms.assert_lead_change_owner(p_lead,actor);
 IF EXISTS(SELECT 1 FROM ms.lead_adjustment_requests
 WHERE lead_id=p_lead AND status='pending')
 THEN RAISE EXCEPTION '当前线索已有待审核的更正或作废'
 USING ERRCODE='23505'; END IF;
 INSERT INTO ms.lead_adjustment_requests(
 organization_id,lead_id,requested_by,action,proposed_note,
 evidence_ref,reason_zh,request_key)
 VALUES(org,p_lead,actor,p_action,p_note,p_evidence,p_reason,p_key)
 RETURNING id INTO new_id;
 INSERT INTO ms.audit_events(
 organization_id,actor_user_id,target_type,target_id,event_name,reason_zh,after_business_json)
 VALUES(org,actor,'lead',p_lead,'LEAD_ADJUSTMENT_REQUESTED',
 '线索更正/作废已申请，原线索内容仍未变化',
 jsonb_build_object('操作',CASE WHEN p_action='invalidate'
 THEN '申请作废' ELSE '申请更正业务说明' END,'状态','待主管审核'));
 RETURN new_id;
END $f$;

CREATE FUNCTION ms.decide_lead_adjustment(
 p_request uuid,p_decision text,p_evidence text,p_reason text,p_key text
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ms AS $f$
DECLARE reviewer uuid;org uuid;q ms.lead_adjustment_requests%ROWTYPE;
 old ms.lead_adjustment_decisions%ROWTYPE;l ms.leads%ROWTYPE;
BEGIN
 SELECT staff_id,org_id INTO reviewer,org FROM ms.access_actor();
 IF reviewer IS NULL THEN RAISE EXCEPTION '审核身份无效' USING ERRCODE='42501'; END IF;
 IF p_request IS NULL OR p_decision NOT IN('approved','rejected')
 OR p_key IS NULL OR p_key !~ '^[A-Za-z0-9_-]{16,128}$'
 OR p_evidence IS NULL OR length(trim(p_evidence)) NOT BETWEEN 2 AND 200
 OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 2 AND 400
 THEN RAISE EXCEPTION '线索调整审批资料不完整'
 USING ERRCODE='23514'; END IF;
 SELECT * INTO old FROM ms.lead_adjustment_decisions
 WHERE reviewer_id=reviewer AND request_key=p_key;
 IF FOUND THEN
  IF old.request_id=p_request AND old.decision=p_decision
  AND old.evidence_ref=p_evidence AND old.reason_zh=p_reason
  THEN RETURN CASE WHEN p_decision='rejected' THEN '调整申请已驳回'
   ELSE '线索调整已独立审批并留存审计' END; END IF;
  RAISE EXCEPTION '审核幂等编号冲突' USING ERRCODE='23505'; END IF;
 SELECT * INTO q FROM ms.lead_adjustment_requests
 WHERE id=p_request AND organization_id=org FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '无权审核该线索调整' USING ERRCODE='42501'; END IF;
 IF q.status<>'pending' THEN RAISE EXCEPTION '调整申请已被审核'
 USING ERRCODE='23505'; END IF;
 IF reviewer=q.requested_by THEN RAISE EXCEPTION '调整申请人不得自批'
 USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM ms.user_role_grants g
 JOIN ms.role_templates t ON t.id=g.role_id
 JOIN ms.staff_users u ON u.id=g.user_id
 WHERE g.user_id=reviewer AND g.revoked_at IS NULL AND g.valid_from<=now()
 AND u.status='active' AND u.organization_id=org AND
 t.organization_id=org AND t.role_code IN('sales_manager','super_admin'))
 THEN RAISE EXCEPTION '需要本机构有效独立主管审批' USING ERRCODE='42501'; END IF;
 SELECT * INTO l FROM ms.leads WHERE id=q.lead_id AND organization_id=org FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '线索已经失效' USING ERRCODE='23514'; END IF;
 IF p_decision='approved' THEN
  IF l.owner_user_id<>q.requested_by OR
    l.lead_state IN('invalid','closed','converted')
  THEN RAISE EXCEPTION '线索当前负责人或状态已变化'
   USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM ms.lead_conversion_executions ex
   WHERE ex.lead_id=l.id AND ex.organization_id=org
    AND ex.executed_by=q.requested_by)
  THEN RAISE EXCEPTION '非当前独立转换线索不可调整'
   USING ERRCODE='23514'; END IF;
  IF q.action='invalidate' THEN
   IF EXISTS(SELECT 1 FROM ms.opportunities o WHERE o.originating_lead_id=l.id)
   THEN RAISE EXCEPTION '线索已产生商机或下游业务，不能直接作废'
   USING ERRCODE='23514'; END IF;
   UPDATE ms.leads SET lead_state='invalid' WHERE id=l.id;
  END IF;
  INSERT INTO ms.lead_adjustment_effects(
   request_id,lead_id,action,corrected_note,applied_by)
  VALUES(q.id,l.id,q.action,q.proposed_note,reviewer);
 END IF;
 INSERT INTO ms.lead_adjustment_decisions(
 request_id,reviewer_id,decision,evidence_ref,reason_zh,request_key)
 VALUES(q.id,reviewer,p_decision,p_evidence,p_reason,p_key);
 UPDATE ms.lead_adjustment_requests
 SET status=p_decision,reviewed_by=reviewer,reviewed_at=now()
 WHERE id=q.id;
 INSERT INTO ms.audit_events(
 organization_id,actor_user_id,target_type,target_id,event_name,reason_zh,after_business_json)
 VALUES(org,reviewer,'lead',q.lead_id,'LEAD_ADJUSTMENT_REVIEWED',
 '独立主管审批线索作废或业务说明更正，原始咨询及财务归属保持不变',
 jsonb_build_object('审核结果',CASE WHEN p_decision='approved' THEN '通过' ELSE '驳回' END,
 '业务操作',CASE WHEN q.action='invalidate' THEN '线索作废' ELSE '更正说明追加留存' END));
 RETURN CASE WHEN p_decision='rejected' THEN '调整申请已驳回'
 ELSE '线索调整已独立审批并留存审计' END;
END $f$;
REVOKE ALL ON FUNCTION
 ms.request_lead_student_association(uuid,uuid,text,text,text),
 ms.decide_lead_student_association(uuid,text,text,text,text),
 ms.request_lead_adjustment(uuid,text,text,text,text,text),
 ms.decide_lead_adjustment(uuid,text,text,text,text)
 FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
 ms.request_lead_student_association(uuid,uuid,text,text,text),
 ms.decide_lead_student_association(uuid,text,text,text,text),
 ms.request_lead_adjustment(uuid,text,text,text,text,text),
 ms.decide_lead_adjustment(uuid,text,text,text,text)
 TO ms_scoped_lowrisk_writer;
COMMIT;
