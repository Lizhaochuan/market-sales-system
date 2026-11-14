-- V3.2-19: final-approved actual lead creation, disposable fictional PostgreSQL 16 ONLY.
-- Prerequisite 001-022. The ONLY new lead writer is the security-definer
-- execute function; no direct ms.leads table grant is given to employee LOGINs.
BEGIN;
CREATE TABLE ms.lead_conversion_authorizations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES ms.organizations(id),
 readiness_id uuid NOT NULL UNIQUE REFERENCES ms.lead_conversion_readiness(id),
 candidate_id uuid NOT NULL REFERENCES ms.consultation_lead_candidates(id),
 contact_id uuid NOT NULL REFERENCES ms.contacts(id),
 requested_by uuid NOT NULL REFERENCES ms.staff_users(id),
 evidence_ref text NOT NULL CHECK(length(trim(evidence_ref)) BETWEEN 2 AND 200),
 reason_zh text NOT NULL CHECK(length(trim(reason_zh)) BETWEEN 2 AND 400),
 request_key text NOT NULL CHECK(length(request_key) BETWEEN 16 AND 128),
 status text NOT NULL DEFAULT 'pending'
   CHECK(status IN ('pending','approved','rejected','executed')),
 reviewed_by uuid REFERENCES ms.staff_users(id),
 reviewed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(requested_by,request_key),
 CHECK ((status='pending' AND reviewed_by IS NULL AND reviewed_at IS NULL)
 OR (status<>'pending' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
);
CREATE TABLE ms.lead_conversion_authorization_decisions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 authorization_id uuid NOT NULL UNIQUE REFERENCES ms.lead_conversion_authorizations(id),
 reviewer_id uuid NOT NULL REFERENCES ms.staff_users(id),
 decision text NOT NULL CHECK(decision IN('approved','rejected')),
 evidence_ref text NOT NULL CHECK(length(trim(evidence_ref)) BETWEEN 2 AND 200),
 reason_zh text NOT NULL CHECK(length(trim(reason_zh)) BETWEEN 2 AND 400),
 request_key text NOT NULL CHECK(length(request_key) BETWEEN 16 AND 128),
 decided_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(reviewer_id,request_key)
);
CREATE TABLE ms.lead_conversion_executions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES ms.organizations(id),
 authorization_id uuid NOT NULL UNIQUE REFERENCES ms.lead_conversion_authorizations(id),
 contact_id uuid NOT NULL REFERENCES ms.contacts(id),
 source_event_id uuid NOT NULL UNIQUE REFERENCES ms.contact_events(id),
 lead_id uuid NOT NULL UNIQUE REFERENCES ms.leads(id),
 executed_by uuid NOT NULL REFERENCES ms.staff_users(id),
 request_key text NOT NULL CHECK(length(request_key) BETWEEN 16 AND 128),
 executed_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,contact_id),
 UNIQUE(executed_by,request_key)
);
ALTER TABLE ms.lead_conversion_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ms.lead_conversion_authorization_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ms.lead_conversion_executions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ms.lead_conversion_authorizations,
 ms.lead_conversion_authorization_decisions,ms.lead_conversion_executions
 FROM PUBLIC,ms_lowrisk_runtime;
CREATE TRIGGER immutable_conversion_final_decision
 BEFORE UPDATE OR DELETE ON ms.lead_conversion_authorization_decisions
 FOR EACH ROW EXECUTE FUNCTION ms.reject_access_history_mutation();
CREATE TRIGGER immutable_conversion_execution
 BEFORE UPDATE OR DELETE ON ms.lead_conversion_executions
 FOR EACH ROW EXECUTE FUNCTION ms.reject_access_history_mutation();

-- Existing V3.2-18 preflight approval may be withdrawn before conversion,
-- but it cannot retroactively "delete" an already-created lead.
CREATE FUNCTION ms.prevent_completed_conversion_preflight_revocation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ms AS $f$
BEGIN
 IF OLD.status='cleared' AND NEW.status='revoked'
 AND EXISTS(SELECT 1 FROM ms.lead_conversion_executions ex
   JOIN ms.lead_conversion_authorizations a ON a.id=ex.authorization_id
   WHERE a.readiness_id=OLD.id)
 THEN RAISE EXCEPTION '正式线索已创建，禁止将撤销预审误当成线索回滚'
   USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $f$;
CREATE TRIGGER conversion_preflight_revocation_guard
 BEFORE UPDATE OF status ON ms.lead_conversion_readiness
 FOR EACH ROW EXECUTE FUNCTION ms.prevent_completed_conversion_preflight_revocation();
REVOKE ALL ON FUNCTION ms.prevent_completed_conversion_preflight_revocation() FROM PUBLIC;

-- This helper intentionally acquires the current preflight & contact row locks.
-- Original consultation attribution is separate from lead operator ownership.
-- A manager decision never creates a lead. Actual conversion checks again.
CREATE FUNCTION ms.assert_final_conversion_eligible(p_readiness uuid,p_actor uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ms AS $f$
DECLARE r ms.lead_conversion_readiness%ROWTYPE;
 x ms.consultation_lead_candidates%ROWTYPE;
 e ms.contact_events%ROWTYPE;c ms.contacts%ROWTYPE;org uuid;
BEGIN
 SELECT organization_id INTO org FROM ms.staff_users
 WHERE id=p_actor AND status='active';
 IF org IS NULL THEN RAISE EXCEPTION '原申请人已失去员工资格'
  USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM ms.lead_conversion_readiness
 WHERE id=p_readiness AND organization_id=org AND requested_by=p_actor
 FOR UPDATE;
 IF NOT FOUND OR r.status<>'cleared' THEN
  RAISE EXCEPTION '转换预审未通过或已撤销' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM ms.lead_conversion_readiness_decisions d
  WHERE d.review_id=r.id AND d.decision='cleared'
    AND d.reviewer_id<>p_actor)
 THEN RAISE EXCEPTION '缺少独立主管预审记录'
  USING ERRCODE='23514'; END IF;
 SELECT * INTO x FROM ms.consultation_lead_candidates
 WHERE id=r.candidate_id AND organization_id=org
  AND contact_id=r.contact_id AND requested_by=p_actor
  AND status='reviewed_eligible';
 IF NOT FOUND THEN RAISE EXCEPTION '候选尚未审核通过或关联已失效'
  USING ERRCODE='23514'; END IF;
 SELECT * INTO c FROM ms.contacts
 WHERE id=r.contact_id AND organization_id=org FOR UPDATE;
 IF NOT FOUND OR c.archived_at IS NOT NULL OR c.do_not_contact
 THEN RAISE EXCEPTION '联系人已拒绝联系或失效'
  USING ERRCODE='23514'; END IF;
 IF COALESCE((SELECT a.assignee_id FROM ms.contact_custody_assignments a
    WHERE a.contact_id=c.id AND a.organization_id=org
     AND a.revoked_at IS NULL),c.created_by) IS DISTINCT FROM p_actor
 THEN RAISE EXCEPTION '当前联系人管理权已转交'
  USING ERRCODE='23514'; END IF;
 SELECT * INTO e FROM ms.contact_events
 WHERE id=x.source_event_id AND contact_id=c.id
  AND organization_id=org AND recorded_by=p_actor;
 IF NOT FOUND THEN RAISE EXCEPTION '原始真实咨询及归属不一致'
  USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM ms.leads l
  WHERE l.organization_id=org AND
   (l.contact_id=c.id OR l.source_event_id=e.id))
 THEN RAISE EXCEPTION '存在同联系人或同咨询正式线索，拒绝重复转换'
  USING ERRCODE='23505'; END IF;
 IF EXISTS(SELECT 1 FROM ms.lead_conversion_executions ex
  WHERE ex.organization_id=org AND
   (ex.contact_id=c.id OR ex.source_event_id=e.id))
 THEN RAISE EXCEPTION '本联系人或咨询已经转换成功'
  USING ERRCODE='23505'; END IF;
 IF EXISTS(SELECT 1 FROM ms.contact_events other
 WHERE other.organization_id=org AND other.contact_id=c.id
  AND other.recorded_by IS DISTINCT FROM p_actor
  AND NOT EXISTS(SELECT 1 FROM ms.lead_attribution_disputes d
   WHERE d.candidate_id=x.id AND d.claimed_event_id=other.id
    AND d.status='rejected'))
 THEN RAISE EXCEPTION '跨员工咨询存在未裁决或已成立的归因异议'
  USING ERRCODE='23514'; END IF;
END $f$;
REVOKE ALL ON FUNCTION ms.assert_final_conversion_eligible(uuid,uuid) FROM PUBLIC;

CREATE VIEW ms.scoped_final_lead_conversion_requests
WITH (security_barrier=true) AS
SELECT a.id AS authorization_id,a.readiness_id,a.candidate_id,
 a.status,a.created_at,c.display_name AS contact_name,
 ex.lead_id,ex.executed_at,a.requested_by
FROM ms.lead_conversion_authorizations a
JOIN ms.contacts c ON c.id=a.contact_id AND c.organization_id=a.organization_id
LEFT JOIN ms.lead_conversion_executions ex ON ex.authorization_id=a.id
WHERE a.organization_id=ms.current_scoped_organization_id()
 AND ms.current_scoped_staff_id() IS NOT NULL
 AND (a.requested_by=ms.current_scoped_staff_id()
  OR a.reviewed_by=ms.current_scoped_staff_id()
  OR (a.status='pending' AND EXISTS(
   SELECT 1 FROM ms.user_role_grants g JOIN ms.role_templates t
     ON t.id=g.role_id
   WHERE g.user_id=ms.current_scoped_staff_id()
    AND g.revoked_at IS NULL AND g.valid_from<=now()
    AND t.organization_id=a.organization_id
    AND t.role_code IN('sales_manager','super_admin'))));
REVOKE ALL ON ms.scoped_final_lead_conversion_requests FROM PUBLIC;
GRANT SELECT ON ms.scoped_final_lead_conversion_requests TO ms_student_assignee_reader;

CREATE FUNCTION ms.request_final_lead_conversion(
 p_readiness uuid,p_evidence text,p_reason text,p_key text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ms AS $f$
DECLARE actor uuid;org uuid;old ms.lead_conversion_authorizations%ROWTYPE;
 r ms.lead_conversion_readiness%ROWTYPE;result_id uuid;
BEGIN
 SELECT staff_id,org_id INTO actor,org FROM ms.access_actor();
 IF actor IS NULL THEN RAISE EXCEPTION '员工身份无效'
  USING ERRCODE='42501'; END IF;
 IF p_readiness IS NULL OR p_key IS NULL
 OR p_key !~ '^[a-zA-Z0-9_-]{16,128}$'
 OR p_evidence IS NULL OR length(trim(p_evidence)) NOT BETWEEN 2 AND 200
 OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 2 AND 400
 THEN RAISE EXCEPTION '正式转换申请缺少材料'
  USING ERRCODE='23514'; END IF;
 SELECT * INTO old FROM ms.lead_conversion_authorizations
 WHERE requested_by=actor AND request_key=p_key;
 IF FOUND THEN
  IF old.readiness_id=p_readiness AND old.evidence_ref=p_evidence
  AND old.reason_zh=p_reason THEN RETURN old.id; END IF;
  RAISE EXCEPTION '防重复编号冲突' USING ERRCODE='23505'; END IF;
 SELECT * INTO r FROM ms.lead_conversion_readiness
 WHERE id=p_readiness AND organization_id=org AND requested_by=actor;
 IF NOT FOUND THEN RAISE EXCEPTION '不可申请其他人的转换预审'
  USING ERRCODE='42501'; END IF;
 PERFORM ms.assert_final_conversion_eligible(p_readiness,actor);
 IF EXISTS(SELECT 1 FROM ms.lead_conversion_authorizations
  WHERE readiness_id=p_readiness)
 THEN RAISE EXCEPTION '本预审已有最终授权申请'
  USING ERRCODE='23505'; END IF;
 INSERT INTO ms.lead_conversion_authorizations(
  organization_id,readiness_id,candidate_id,contact_id,
  requested_by,evidence_ref,reason_zh,request_key)
 VALUES(org,r.id,r.candidate_id,r.contact_id,actor,p_evidence,p_reason,p_key)
 RETURNING id INTO result_id;
 INSERT INTO ms.audit_events(
  organization_id,actor_user_id,target_type,target_id,event_name,reason_zh,after_business_json)
 VALUES(org,actor,'contact',r.contact_id,'LEAD_FINAL_CONVERSION_REQUESTED',
 '正式销售线索转换申请已提交，尚未执行',
 jsonb_build_object('状态','等待最终独立批准','正式线索','尚未生成'));
 RETURN result_id;
END $f$;

CREATE FUNCTION ms.decide_final_lead_conversion(
 p_authorization uuid,p_decision text,p_evidence text,p_reason text,p_key text
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ms AS $f$
DECLARE reviewer uuid;org uuid;old ms.lead_conversion_authorization_decisions%ROWTYPE;
 a ms.lead_conversion_authorizations%ROWTYPE;
BEGIN
 SELECT staff_id,org_id INTO reviewer,org FROM ms.access_actor();
 IF reviewer IS NULL THEN RAISE EXCEPTION '主管身份无效'
  USING ERRCODE='42501'; END IF;
 IF p_authorization IS NULL OR p_decision NOT IN('approved','rejected')
 OR p_key IS NULL OR p_key !~ '^[a-zA-Z0-9_-]{16,128}$'
 OR p_evidence IS NULL OR length(trim(p_evidence)) NOT BETWEEN 2 AND 200
 OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 2 AND 400
 THEN RAISE EXCEPTION '最终审批记录不完整'
  USING ERRCODE='23514'; END IF;
 SELECT * INTO old FROM ms.lead_conversion_authorization_decisions
 WHERE reviewer_id=reviewer AND request_key=p_key;
 IF FOUND THEN
  IF old.authorization_id=p_authorization AND old.decision=p_decision
   AND old.evidence_ref=p_evidence AND old.reason_zh=p_reason
  THEN RETURN CASE WHEN p_decision='approved'
   THEN '已批准最终转换，尚未生成正式线索' ELSE '已拒绝最终转换' END; END IF;
  RAISE EXCEPTION '审核编号重复且内容不一致' USING ERRCODE='23505'; END IF;
 SELECT * INTO a FROM ms.lead_conversion_authorizations
 WHERE id=p_authorization AND organization_id=org FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '当前机构不存在此最终转换申请'
  USING ERRCODE='42501'; END IF;
 IF a.status<>'pending' THEN RAISE EXCEPTION '最终申请已处理'
  USING ERRCODE='23505'; END IF;
 IF reviewer=a.requested_by THEN RAISE EXCEPTION '申请人不得自行最终批准'
  USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM ms.user_role_grants g
  JOIN ms.role_templates t ON t.id=g.role_id
  JOIN ms.staff_users s ON s.id=g.user_id
  WHERE g.user_id=reviewer AND g.revoked_at IS NULL AND g.valid_from<=now()
   AND s.status='active' AND s.organization_id=org
   AND t.organization_id=org AND t.role_code IN('sales_manager','super_admin'))
 THEN RAISE EXCEPTION '缺少本机构独立主管最终批准权限'
  USING ERRCODE='42501'; END IF;
 IF p_decision='approved' THEN
  PERFORM ms.assert_final_conversion_eligible(a.readiness_id,a.requested_by);
 END IF;
 INSERT INTO ms.lead_conversion_authorization_decisions(
  authorization_id,reviewer_id,decision,evidence_ref,reason_zh,request_key)
 VALUES(a.id,reviewer,p_decision,p_evidence,p_reason,p_key);
 UPDATE ms.lead_conversion_authorizations
 SET status=p_decision,reviewed_by=reviewer,reviewed_at=now()
 WHERE id=a.id;
 INSERT INTO ms.audit_events(
  organization_id,actor_user_id,target_type,target_id,event_name,reason_zh,after_business_json)
 VALUES(org,reviewer,'contact',a.contact_id,'LEAD_FINAL_CONVERSION_DECIDED',
 '最终转换审核独立完成；批准与创建仍是两步',
 jsonb_build_object('结果',CASE WHEN p_decision='approved'
 THEN '已批准，待申请员工执行' ELSE '已驳回' END,'正式线索','未生成'));
 RETURN CASE WHEN p_decision='approved'
 THEN '已批准最终转换，尚未生成正式线索' ELSE '已拒绝最终转换' END;
END $f$;

CREATE FUNCTION ms.execute_final_lead_conversion(
 p_authorization uuid,p_key text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ms AS $f$
DECLARE actor uuid;org uuid;a ms.lead_conversion_authorizations%ROWTYPE;
 candidate ms.consultation_lead_candidates%ROWTYPE;
 ex ms.lead_conversion_executions%ROWTYPE;
 new_lead uuid;
BEGIN
 SELECT staff_id,org_id INTO actor,org FROM ms.access_actor();
 IF actor IS NULL THEN RAISE EXCEPTION '员工身份无效'
 USING ERRCODE='42501'; END IF;
 IF p_authorization IS NULL OR p_key IS NULL
 OR p_key !~ '^[a-zA-Z0-9_-]{16,128}$'
 THEN RAISE EXCEPTION '必须提供有效转换授权及幂等编号'
 USING ERRCODE='23514'; END IF;
 SELECT * INTO ex FROM ms.lead_conversion_executions
 WHERE executed_by=actor AND request_key=p_key;
 IF FOUND THEN
  IF ex.authorization_id=p_authorization
  THEN RETURN jsonb_build_object('lead_id',ex.lead_id,'status','已创建正式销售线索'); END IF;
  RAISE EXCEPTION '执行编号已用于其他操作' USING ERRCODE='23505'; END IF;
 SELECT * INTO a FROM ms.lead_conversion_authorizations
 WHERE id=p_authorization AND organization_id=org FOR UPDATE;
 IF NOT FOUND OR a.requested_by IS DISTINCT FROM actor
 THEN RAISE EXCEPTION '不可执行他人的最终转换批准'
 USING ERRCODE='42501'; END IF;
 IF a.status<>'approved' THEN RAISE EXCEPTION '最终批准未生效、被拒绝或已执行'
 USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM ms.lead_conversion_authorization_decisions d
 JOIN ms.user_role_grants g ON g.user_id=d.reviewer_id AND g.revoked_at IS NULL
 JOIN ms.role_templates t ON t.id=g.role_id
 JOIN ms.staff_users u ON u.id=d.reviewer_id
 WHERE d.authorization_id=a.id AND d.decision='approved'
  AND d.reviewer_id<>actor AND u.status='active'
  AND u.organization_id=org AND t.organization_id=org
  AND g.valid_from<=now() AND t.role_code IN('sales_manager','super_admin'))
 THEN RAISE EXCEPTION '最终独立主管批准已失去有效资格'
 USING ERRCODE='42501'; END IF;
 PERFORM ms.assert_final_conversion_eligible(a.readiness_id,actor);
 SELECT * INTO candidate FROM ms.consultation_lead_candidates
 WHERE id=a.candidate_id AND organization_id=org
  AND requested_by=actor AND contact_id=a.contact_id
  AND status='reviewed_eligible';
 IF NOT FOUND THEN RAISE EXCEPTION '最终转换与已核查候选不一致'
 USING ERRCODE='23514'; END IF;
 -- The contact row is locked by the eligibility helper. All steps including
 -- business lead, immutable ledger, state and audit commit atomically.
 INSERT INTO ms.leads(
  organization_id,contact_id,source_event_id,owner_user_id,lead_state)
 VALUES(org,a.contact_id,candidate.source_event_id,actor,'unidentified')
 RETURNING id INTO new_lead;
 INSERT INTO ms.lead_conversion_executions(
  organization_id,authorization_id,contact_id,source_event_id,
  lead_id,executed_by,request_key)
 VALUES(org,a.id,a.contact_id,candidate.source_event_id,new_lead,actor,p_key);
 UPDATE ms.lead_conversion_authorizations
 SET status='executed' WHERE id=a.id;
 INSERT INTO ms.audit_events(
  organization_id,actor_user_id,target_type,target_id,event_name,reason_zh,after_business_json)
 VALUES(org,actor,'lead',new_lead,'LEAD_FINAL_CONVERSION_EXECUTED',
 '经候选、转换预审、最终主管批准后创建一条正式线索；学生与财务未改变',
 jsonb_build_object('正式线索','已创建','原咨询归属','保持','执行人','原申请人',
  '学生关联','未自动创建','收入和课时','未改变'));
 RETURN jsonb_build_object('lead_id',new_lead,'status','已创建正式销售线索');
END $f$;

REVOKE ALL ON FUNCTION
 ms.request_final_lead_conversion(uuid,text,text,text),
 ms.decide_final_lead_conversion(uuid,text,text,text,text),
 ms.execute_final_lead_conversion(uuid,text)
 FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
 ms.request_final_lead_conversion(uuid,text,text,text),
 ms.decide_final_lead_conversion(uuid,text,text,text,text),
 ms.execute_final_lead_conversion(uuid,text)
 TO ms_scoped_lowrisk_writer;
COMMIT;
