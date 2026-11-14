-- V3.2-18: conversion readiness and attribution disputes ONLY.
-- Deliberately no statement or EXECUTE privilege that can INSERT ms.leads.
-- Disposable fictional PostgreSQL 16, after 021, never production.
BEGIN;
CREATE TABLE ms.lead_conversion_readiness (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES ms.organizations(id),
 candidate_id uuid NOT NULL UNIQUE REFERENCES ms.consultation_lead_candidates(id),
 contact_id uuid NOT NULL REFERENCES ms.contacts(id),
 requested_by uuid NOT NULL REFERENCES ms.staff_users(id),
 evidence_ref text NOT NULL CHECK(length(trim(evidence_ref)) BETWEEN 2 AND 200),
 reason_zh text NOT NULL CHECK(length(trim(reason_zh)) BETWEEN 2 AND 400),
 request_key text NOT NULL CHECK(length(request_key) BETWEEN 16 AND 128),
 status text NOT NULL DEFAULT 'pending'
   CHECK(status IN ('pending','cleared','rejected','revoked')),
 reviewed_by uuid REFERENCES ms.staff_users(id),
 reviewed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(requested_by,request_key),
 CHECK ((status='pending' AND reviewed_by IS NULL AND reviewed_at IS NULL)
    OR (status<>'pending' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
);
CREATE TABLE ms.lead_attribution_disputes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES ms.organizations(id),
 candidate_id uuid NOT NULL REFERENCES ms.consultation_lead_candidates(id),
 contact_id uuid NOT NULL REFERENCES ms.contacts(id),
 claimed_event_id uuid NOT NULL REFERENCES ms.contact_events(id),
 claimant_id uuid NOT NULL REFERENCES ms.staff_users(id),
 evidence_ref text NOT NULL CHECK(length(trim(evidence_ref)) BETWEEN 2 AND 200),
 reason_zh text NOT NULL CHECK(length(trim(reason_zh)) BETWEEN 2 AND 400),
 request_key text NOT NULL CHECK(length(request_key) BETWEEN 16 AND 128),
 status text NOT NULL DEFAULT 'pending'
   CHECK(status IN ('pending','upheld','rejected')),
 reviewed_by uuid REFERENCES ms.staff_users(id),
 reviewed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(candidate_id,claimed_event_id),
 UNIQUE(claimant_id,request_key),
 CHECK ((status='pending' AND reviewed_by IS NULL AND reviewed_at IS NULL)
    OR (status<>'pending' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
);
CREATE TABLE ms.lead_attribution_dispute_decisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 dispute_id uuid NOT NULL UNIQUE REFERENCES ms.lead_attribution_disputes(id),
 reviewer_id uuid NOT NULL REFERENCES ms.staff_users(id),
 decision text NOT NULL CHECK(decision IN ('upheld','rejected')),
 evidence_ref text NOT NULL CHECK(length(trim(evidence_ref)) BETWEEN 2 AND 200),
 reason_zh text NOT NULL CHECK(length(trim(reason_zh)) BETWEEN 2 AND 400),
 request_key text NOT NULL CHECK(length(request_key) BETWEEN 16 AND 128),
 decided_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(reviewer_id,request_key)
);
CREATE TABLE ms.lead_conversion_readiness_decisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 review_id uuid NOT NULL REFERENCES ms.lead_conversion_readiness(id),
 reviewer_id uuid NOT NULL REFERENCES ms.staff_users(id),
 decision text NOT NULL CHECK(decision IN ('cleared','rejected','revoked')),
 evidence_ref text NOT NULL CHECK(length(trim(evidence_ref)) BETWEEN 2 AND 200),
 reason_zh text NOT NULL CHECK(length(trim(reason_zh)) BETWEEN 2 AND 400),
 request_key text NOT NULL CHECK(length(request_key) BETWEEN 16 AND 128),
 decided_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(review_id,decision),
 UNIQUE(reviewer_id,request_key)
);
ALTER TABLE ms.lead_conversion_readiness ENABLE ROW LEVEL SECURITY;
ALTER TABLE ms.lead_attribution_disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE ms.lead_attribution_dispute_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ms.lead_conversion_readiness_decisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ms.lead_conversion_readiness,ms.lead_attribution_disputes,
 ms.lead_attribution_dispute_decisions,ms.lead_conversion_readiness_decisions
 FROM PUBLIC,ms_lowrisk_runtime;
CREATE TRIGGER immutable_lead_attribution_decision
 BEFORE UPDATE OR DELETE ON ms.lead_attribution_dispute_decisions
 FOR EACH ROW EXECUTE FUNCTION ms.reject_access_history_mutation();
CREATE TRIGGER immutable_lead_readiness_decision
 BEFORE UPDATE OR DELETE ON ms.lead_conversion_readiness_decisions
 FOR EACH ROW EXECUTE FUNCTION ms.reject_access_history_mutation();

-- Exactly one named event is the unit of evidence, never one family or sibling group.
-- Other employees can DISCOVER only the candidate ID if their own consultation
-- refers to the same contact; they cannot read the candidate evidence.
CREATE VIEW ms.scoped_attribution_disputable_candidates
WITH (security_barrier=true) AS
SELECT DISTINCT x.id AS candidate_id,c.display_name AS contact_name,
 e.id AS own_event_id,e.event_type AS own_event_type
FROM ms.consultation_lead_candidates x
JOIN ms.contacts c ON c.id=x.contact_id AND c.organization_id=x.organization_id
JOIN ms.contact_events e ON e.contact_id=x.contact_id
 AND e.organization_id=x.organization_id
 AND e.recorded_by=ms.current_scoped_staff_id()
WHERE x.organization_id=ms.current_scoped_organization_id()
 AND x.status='reviewed_eligible'
 AND x.requested_by<>ms.current_scoped_staff_id()
 AND NOT EXISTS(SELECT 1 FROM ms.lead_attribution_disputes d
  WHERE d.candidate_id=x.id AND d.claimed_event_id=e.id);

-- Eligibility is a *dynamic* current check, not a grant to create a lead.
CREATE VIEW ms.scoped_conversion_readiness
WITH (security_barrier=true) AS
SELECT r.id AS review_id,r.candidate_id,r.status,r.created_at,
 c.display_name AS contact_name,
 CASE WHEN r.status='cleared' AND (
    c.archived_at IS NOT NULL OR c.do_not_contact
    OR COALESCE((SELECT a.assignee_id FROM ms.contact_custody_assignments a
       WHERE a.contact_id=c.id AND a.revoked_at IS NULL),c.created_by)<>r.requested_by
    OR EXISTS(SELECT 1 FROM ms.leads l
       WHERE l.organization_id=r.organization_id AND l.contact_id=c.id)
    OR EXISTS(SELECT 1 FROM ms.contact_events e
       WHERE e.organization_id=r.organization_id AND e.contact_id=c.id
        AND e.recorded_by<>r.requested_by
        AND NOT EXISTS(SELECT 1 FROM ms.lead_attribution_disputes d
         WHERE d.candidate_id=r.candidate_id AND d.claimed_event_id=e.id
          AND d.status='rejected'))
 ) THEN '已失效，必须重新审核'
 WHEN r.status='cleared' THEN '转换预审已通过（未创建线索）'
 WHEN r.status='pending' THEN '等待独立主管预审'
 WHEN r.status='rejected' THEN '转换预审已驳回'
 ELSE '转换预审已撤销' END AS effective_status
FROM ms.lead_conversion_readiness r
JOIN ms.contacts c ON c.id=r.contact_id AND c.organization_id=r.organization_id
WHERE r.organization_id=ms.current_scoped_organization_id()
 AND ms.current_scoped_staff_id() IS NOT NULL
 AND (r.requested_by=ms.current_scoped_staff_id()
 OR r.reviewed_by=ms.current_scoped_staff_id()
 OR (r.status='pending' AND EXISTS(
  SELECT 1 FROM ms.user_role_grants g
  JOIN ms.role_templates t ON t.id=g.role_id
  WHERE g.user_id=ms.current_scoped_staff_id() AND g.revoked_at IS NULL
   AND g.valid_from<=now() AND t.organization_id=r.organization_id
   AND t.role_code IN ('sales_manager','super_admin'))));
CREATE VIEW ms.scoped_lead_attribution_disputes
WITH (security_barrier=true) AS
SELECT d.id AS dispute_id,d.candidate_id,d.claimed_event_id,
 d.status,d.created_at,c.display_name AS contact_name,
 d.claimant_id
FROM ms.lead_attribution_disputes d
JOIN ms.contacts c ON c.id=d.contact_id AND c.organization_id=d.organization_id
JOIN ms.consultation_lead_candidates x ON x.id=d.candidate_id
WHERE d.organization_id=ms.current_scoped_organization_id()
 AND ms.current_scoped_staff_id() IS NOT NULL
 AND (d.claimant_id=ms.current_scoped_staff_id()
  OR x.requested_by=ms.current_scoped_staff_id()
  OR d.reviewed_by=ms.current_scoped_staff_id()
  OR (d.status='pending' AND EXISTS(
   SELECT 1 FROM ms.user_role_grants g JOIN ms.role_templates t ON t.id=g.role_id
   WHERE g.user_id=ms.current_scoped_staff_id() AND g.revoked_at IS NULL
    AND g.valid_from<=now() AND t.organization_id=d.organization_id
    AND t.role_code IN ('sales_manager','super_admin'))));
REVOKE ALL ON ms.scoped_attribution_disputable_candidates,
 ms.scoped_conversion_readiness,ms.scoped_lead_attribution_disputes FROM PUBLIC;
GRANT SELECT ON ms.scoped_attribution_disputable_candidates,
 ms.scoped_conversion_readiness,ms.scoped_lead_attribution_disputes
 TO ms_student_assignee_reader;

CREATE FUNCTION ms.submit_lead_conversion_preflight(
 p_candidate uuid,p_evidence text,p_reason text,p_key text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ms AS $f$
DECLARE actor uuid;org uuid;x ms.consultation_lead_candidates%ROWTYPE;
 c ms.contacts%ROWTYPE;old ms.lead_conversion_readiness%ROWTYPE;new_id uuid;
BEGIN
 SELECT staff_id,org_id INTO actor,org FROM ms.access_actor();
 IF actor IS NULL THEN RAISE EXCEPTION '员工身份未授权' USING ERRCODE='42501'; END IF;
 IF p_candidate IS NULL OR p_key IS NULL OR p_key !~ '^[a-zA-Z0-9_-]{16,128}$'
 OR p_evidence IS NULL OR length(trim(p_evidence)) NOT BETWEEN 2 AND 200
 OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 2 AND 400
 THEN RAISE EXCEPTION '预审申请不完整' USING ERRCODE='23514'; END IF;
 SELECT * INTO old FROM ms.lead_conversion_readiness
 WHERE requested_by=actor AND request_key=p_key;
 IF FOUND THEN
  IF old.candidate_id=p_candidate AND old.evidence_ref=p_evidence
   AND old.reason_zh=p_reason THEN RETURN old.id; END IF;
  RAISE EXCEPTION '防重复编号冲突' USING ERRCODE='23505'; END IF;
 SELECT * INTO x FROM ms.consultation_lead_candidates
 WHERE id=p_candidate AND organization_id=org;
 IF NOT FOUND OR x.requested_by IS DISTINCT FROM actor
 THEN RAISE EXCEPTION '不能提交其他员工的候选预审' USING ERRCODE='42501'; END IF;
 IF x.status<>'reviewed_eligible' THEN RAISE EXCEPTION '候选尚未通过独立核查'
  USING ERRCODE='23514'; END IF;
 SELECT * INTO c FROM ms.contacts
 WHERE id=x.contact_id AND organization_id=org AND archived_at IS NULL FOR UPDATE;
 IF NOT FOUND OR c.do_not_contact THEN
  RAISE EXCEPTION '联系人已失效或拒绝联系' USING ERRCODE='23514'; END IF;
 IF COALESCE((SELECT a.assignee_id FROM ms.contact_custody_assignments a
 WHERE a.contact_id=c.id AND a.revoked_at IS NULL),c.created_by)<>actor
 THEN RAISE EXCEPTION '当前联系人管理权已转交' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM ms.leads l
 WHERE l.organization_id=org AND l.contact_id=c.id)
 THEN RAISE EXCEPTION '已经存在正式线索，拒绝重复转换' USING ERRCODE='23505'; END IF;
 IF EXISTS(SELECT 1 FROM ms.lead_conversion_readiness
 WHERE candidate_id=x.id)
 THEN RAISE EXCEPTION '该候选已有预审，禁止重复归因' USING ERRCODE='23505'; END IF;
 INSERT INTO ms.lead_conversion_readiness(
 organization_id,candidate_id,contact_id,requested_by,evidence_ref,reason_zh,request_key)
 VALUES(org,x.id,x.contact_id,actor,p_evidence,p_reason,p_key) RETURNING id INTO new_id;
 INSERT INTO ms.audit_events(
 organization_id,actor_user_id,target_type,target_id,event_name,reason_zh,after_business_json)
 VALUES(org,actor,'contact_event',x.source_event_id,'LEAD_CONVERSION_PREFLIGHT_SUBMITTED',
  '提交正式线索转换预审，不生成正式线索或业绩归因',
  jsonb_build_object('状态','待独立审批','正式线索','未创建'));
 RETURN new_id;
END $f$;

CREATE FUNCTION ms.submit_lead_attribution_dispute(
 p_candidate uuid,p_own_event uuid,p_evidence text,p_reason text,p_key text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ms AS $f$
DECLARE actor uuid;org uuid;x ms.consultation_lead_candidates%ROWTYPE;
 e ms.contact_events%ROWTYPE;c ms.contacts%ROWTYPE;
 old ms.lead_attribution_disputes%ROWTYPE;new_id uuid;
BEGIN
 SELECT staff_id,org_id INTO actor,org FROM ms.access_actor();
 IF actor IS NULL THEN RAISE EXCEPTION '员工身份未授权' USING ERRCODE='42501'; END IF;
 IF p_candidate IS NULL OR p_own_event IS NULL OR p_key IS NULL
 OR p_key !~ '^[a-zA-Z0-9_-]{16,128}$'
 OR p_evidence IS NULL OR length(trim(p_evidence)) NOT BETWEEN 2 AND 200
 OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 2 AND 400
 THEN RAISE EXCEPTION '归因争议材料不完整' USING ERRCODE='23514'; END IF;
 SELECT * INTO old FROM ms.lead_attribution_disputes
 WHERE claimant_id=actor AND request_key=p_key;
 IF FOUND THEN
  IF old.candidate_id=p_candidate AND old.claimed_event_id=p_own_event
    AND old.evidence_ref=p_evidence AND old.reason_zh=p_reason
  THEN RETURN old.id; END IF;
  RAISE EXCEPTION '争议防重复编号冲突' USING ERRCODE='23505'; END IF;
 SELECT * INTO x FROM ms.consultation_lead_candidates
 WHERE id=p_candidate AND organization_id=org AND status='reviewed_eligible';
 IF NOT FOUND OR x.requested_by=actor THEN
  RAISE EXCEPTION '申请人不得对自己的候选提出跨员工归因争议'
  USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM ms.contacts WHERE id=x.contact_id
 AND organization_id=org FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '联系人不属于本机构' USING ERRCODE='42501'; END IF;
 SELECT * INTO e FROM ms.contact_events
 WHERE id=p_own_event AND organization_id=org
  AND contact_id=x.contact_id AND recorded_by=actor;
 IF NOT FOUND THEN RAISE EXCEPTION '只允许引用本人真实登记的同一联系人咨询'
   USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM ms.lead_attribution_disputes
  WHERE candidate_id=x.id AND claimed_event_id=e.id)
 THEN RAISE EXCEPTION '该实际咨询已有归因争议'
  USING ERRCODE='23505'; END IF;
 INSERT INTO ms.lead_attribution_disputes
 (organization_id,candidate_id,contact_id,claimed_event_id,claimant_id,
 evidence_ref,reason_zh,request_key)
 VALUES(org,x.id,c.id,e.id,actor,p_evidence,p_reason,p_key) RETURNING id INTO new_id;
 INSERT INTO ms.audit_events(
 organization_id,actor_user_id,target_type,target_id,event_name,reason_zh,after_business_json)
 VALUES(org,actor,'contact_event',e.id,'LEAD_ATTRIBUTION_DISPUTE_SUBMITTED',
 '跨员工真实咨询归因争议已登记，不移动原事件或线索归属',
 jsonb_build_object('状态','待独立主管审核','正式归因','未变更'));
 RETURN new_id;
END $f$;

CREATE FUNCTION ms.decide_lead_attribution_dispute(
 p_dispute uuid,p_decision text,p_evidence text,p_reason text,p_key text
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ms AS $f$
DECLARE actor uuid;org uuid;d ms.lead_attribution_disputes%ROWTYPE;
 x ms.consultation_lead_candidates%ROWTYPE;
 old ms.lead_attribution_dispute_decisions%ROWTYPE;
BEGIN
 SELECT staff_id,org_id INTO actor,org FROM ms.access_actor();
 IF actor IS NULL THEN RAISE EXCEPTION '审核人身份无效' USING ERRCODE='42501'; END IF;
 IF p_dispute IS NULL OR p_decision NOT IN ('upheld','rejected')
 OR p_key IS NULL OR p_key !~ '^[a-zA-Z0-9_-]{16,128}$'
 OR p_evidence IS NULL OR length(trim(p_evidence)) NOT BETWEEN 2 AND 200
 OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 2 AND 400
 THEN RAISE EXCEPTION '争议裁决材料不完整' USING ERRCODE='23514'; END IF;
 SELECT * INTO old FROM ms.lead_attribution_dispute_decisions
 WHERE reviewer_id=actor AND request_key=p_key;
 IF FOUND THEN
  IF old.dispute_id=p_dispute AND old.decision=p_decision
   AND old.evidence_ref=p_evidence AND old.reason_zh=p_reason
  THEN RETURN CASE WHEN p_decision='upheld'
   THEN '已支持争议，阻止原归因预审' ELSE '已驳回争议，原归因待独立预审' END; END IF;
  RAISE EXCEPTION '裁决防重复编号冲突' USING ERRCODE='23505'; END IF;
 SELECT * INTO d FROM ms.lead_attribution_disputes
 WHERE id=p_dispute AND organization_id=org FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '不存在有权审核的争议' USING ERRCODE='42501'; END IF;
 IF d.status<>'pending' THEN RAISE EXCEPTION '争议已结束' USING ERRCODE='23505'; END IF;
 SELECT * INTO x FROM ms.consultation_lead_candidates WHERE id=d.candidate_id;
 IF actor IN (d.claimant_id,x.requested_by)
 THEN RAISE EXCEPTION '争议双方不得自批' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM ms.user_role_grants g
 JOIN ms.role_templates t ON t.id=g.role_id
 WHERE g.user_id=actor AND g.revoked_at IS NULL AND g.valid_from<=now()
 AND t.organization_id=org AND t.role_code IN ('sales_manager','super_admin'))
 THEN RAISE EXCEPTION '仅本机构有效独立主管可裁决'
 USING ERRCODE='42501'; END IF;
 INSERT INTO ms.lead_attribution_dispute_decisions
 (dispute_id,reviewer_id,decision,evidence_ref,reason_zh,request_key)
 VALUES(d.id,actor,p_decision,p_evidence,p_reason,p_key);
 UPDATE ms.lead_attribution_disputes SET
 status=p_decision,reviewed_by=actor,reviewed_at=now() WHERE id=d.id;
 INSERT INTO ms.audit_events(
 organization_id,actor_user_id,target_type,target_id,event_name,reason_zh,after_business_json)
 VALUES(org,actor,'contact_event',d.claimed_event_id,'LEAD_ATTRIBUTION_DISPUTE_DECIDED',
 '跨员工归因争议已独立裁决，历史咨询记录人保持不变',
 jsonb_build_object('结果',CASE WHEN p_decision='upheld'
 THEN '支持异议，禁止原申请归因通过' ELSE '异议证据不足，原归因待预审' END));
 RETURN CASE WHEN p_decision='upheld'
 THEN '已支持争议，阻止原归因预审' ELSE '已驳回争议，原归因待独立预审' END;
END $f$;

CREATE FUNCTION ms.decide_lead_conversion_preflight(
 p_review uuid,p_decision text,p_evidence text,p_reason text,p_key text
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ms AS $f$
DECLARE actor uuid;org uuid;r ms.lead_conversion_readiness%ROWTYPE;
 x ms.consultation_lead_candidates%ROWTYPE;c ms.contacts%ROWTYPE;
 old ms.lead_conversion_readiness_decisions%ROWTYPE;
BEGIN
 SELECT staff_id,org_id INTO actor,org FROM ms.access_actor();
 IF actor IS NULL THEN RAISE EXCEPTION '主管身份无效' USING ERRCODE='42501'; END IF;
 IF p_review IS NULL OR p_decision NOT IN ('cleared','rejected')
 OR p_key IS NULL OR p_key !~ '^[a-zA-Z0-9_-]{16,128}$'
 OR p_evidence IS NULL OR length(trim(p_evidence)) NOT BETWEEN 2 AND 200
 OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 2 AND 400
 THEN RAISE EXCEPTION '预审决定不完整' USING ERRCODE='23514'; END IF;
 SELECT * INTO old FROM ms.lead_conversion_readiness_decisions
 WHERE reviewer_id=actor AND request_key=p_key;
 IF FOUND THEN
  IF old.review_id=p_review AND old.decision=p_decision
   AND old.evidence_ref=p_evidence AND old.reason_zh=p_reason
  THEN RETURN CASE WHEN p_decision='cleared'
   THEN '已通过转换预审，但没有创建正式线索' ELSE '已驳回转换预审' END; END IF;
  RAISE EXCEPTION '预审防重复编号冲突' USING ERRCODE='23505'; END IF;
 SELECT * INTO r FROM ms.lead_conversion_readiness
 WHERE id=p_review AND organization_id=org FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '没有该本机构预审' USING ERRCODE='42501'; END IF;
 IF r.status<>'pending' THEN RAISE EXCEPTION '预审已经结束'
   USING ERRCODE='23505'; END IF;
 IF actor=r.requested_by THEN RAISE EXCEPTION '申请人不得审核自己'
   USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM ms.user_role_grants g
 JOIN ms.role_templates t ON t.id=g.role_id
 WHERE g.user_id=actor AND g.revoked_at IS NULL AND g.valid_from<=now()
 AND t.organization_id=org AND t.role_code IN ('sales_manager','super_admin'))
 THEN RAISE EXCEPTION '只有有效的本机构独立主管可以审核'
   USING ERRCODE='42501'; END IF;
 SELECT * INTO x FROM ms.consultation_lead_candidates
 WHERE id=r.candidate_id AND organization_id=org AND status='reviewed_eligible';
 IF NOT FOUND OR x.requested_by IS DISTINCT FROM r.requested_by
 THEN RAISE EXCEPTION '候选资格已失效' USING ERRCODE='23514'; END IF;
 SELECT * INTO c FROM ms.contacts WHERE id=r.contact_id
 AND organization_id=org FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '该联系人不属于本机构'
   USING ERRCODE='42501'; END IF;
 IF p_decision='cleared' THEN
  IF c.archived_at IS NOT NULL OR c.do_not_contact THEN
    RAISE EXCEPTION '客户已拒联或归档，禁止通过预审' USING ERRCODE='23514'; END IF;
  IF COALESCE((SELECT a.assignee_id FROM ms.contact_custody_assignments a
    WHERE a.contact_id=c.id AND a.revoked_at IS NULL),c.created_by)<>r.requested_by
  THEN RAISE EXCEPTION '当前联系人管理权已经变动' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM ms.leads l WHERE l.organization_id=org
   AND l.contact_id=c.id)
  THEN RAISE EXCEPTION '已有正式线索，不可重复通过' USING ERRCODE='23505'; END IF;
  IF EXISTS(SELECT 1 FROM ms.contact_events e
   WHERE e.organization_id=org AND e.contact_id=c.id
   AND e.recorded_by<>r.requested_by
   AND NOT EXISTS(SELECT 1 FROM ms.lead_attribution_disputes d
    WHERE d.candidate_id=r.candidate_id AND d.claimed_event_id=e.id
    AND d.status='rejected'))
  THEN RAISE EXCEPTION '还有跨员工咨询归因未独立核清或异议获支持'
    USING ERRCODE='23514'; END IF;
 END IF;
 INSERT INTO ms.lead_conversion_readiness_decisions
 (review_id,reviewer_id,decision,evidence_ref,reason_zh,request_key)
 VALUES(r.id,actor,p_decision,p_evidence,p_reason,p_key);
 UPDATE ms.lead_conversion_readiness SET
 status=p_decision,reviewed_by=actor,reviewed_at=now() WHERE id=r.id;
 INSERT INTO ms.audit_events(
 organization_id,actor_user_id,target_type,target_id,event_name,reason_zh,after_business_json)
 VALUES(org,actor,'contact_event',x.source_event_id,'LEAD_CONVERSION_PREFLIGHT_DECIDED',
 '转换前条件审核完毕，未创建正式线索或修改销售归因',
 jsonb_build_object('结果',CASE WHEN p_decision='cleared'
 THEN '条件通过，正式转换仍关闭' ELSE '预审驳回' END));
 RETURN CASE WHEN p_decision='cleared'
 THEN '已通过转换预审，但没有创建正式线索' ELSE '已驳回转换预审' END;
END $f$;

-- A revoked clearance preserves its original decision immutable.
CREATE FUNCTION ms.revoke_lead_conversion_clearance(
 p_review uuid,p_evidence text,p_reason text,p_key text
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ms AS $f$
DECLARE actor uuid;org uuid;r ms.lead_conversion_readiness%ROWTYPE;
 x ms.consultation_lead_candidates%ROWTYPE;
 old ms.lead_conversion_readiness_decisions%ROWTYPE;
BEGIN
 SELECT staff_id,org_id INTO actor,org FROM ms.access_actor();
 IF actor IS NULL THEN RAISE EXCEPTION '主管身份无效' USING ERRCODE='42501'; END IF;
 IF p_review IS NULL OR p_key IS NULL OR p_key !~ '^[a-zA-Z0-9_-]{16,128}$'
 OR p_evidence IS NULL OR length(trim(p_evidence)) NOT BETWEEN 2 AND 200
 OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 2 AND 400
 THEN RAISE EXCEPTION '撤销理由或材料缺失' USING ERRCODE='23514'; END IF;
 SELECT * INTO old FROM ms.lead_conversion_readiness_decisions
 WHERE reviewer_id=actor AND request_key=p_key;
 IF FOUND THEN
  IF old.review_id=p_review AND old.decision='revoked'
   AND old.evidence_ref=p_evidence AND old.reason_zh=p_reason
  THEN RETURN '转换预审许可已撤销'; END IF;
  RAISE EXCEPTION '撤销防重复编号冲突' USING ERRCODE='23505'; END IF;
 SELECT * INTO r FROM ms.lead_conversion_readiness
 WHERE id=p_review AND organization_id=org FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '不存在当前机构的预审'
   USING ERRCODE='42501'; END IF;
 IF r.status<>'cleared' THEN RAISE EXCEPTION '仅可撤销已通过的预审'
   USING ERRCODE='23514'; END IF;
 IF actor=r.requested_by THEN RAISE EXCEPTION '原申请人不得自撤销审批结果'
   USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM ms.user_role_grants g JOIN ms.role_templates t
  ON t.id=g.role_id WHERE g.user_id=actor AND g.revoked_at IS NULL
  AND g.valid_from<=now() AND t.organization_id=org
  AND t.role_code IN ('sales_manager','super_admin'))
 THEN RAISE EXCEPTION '仅本机构有效主管可以撤销预审许可'
 USING ERRCODE='42501'; END IF;
 SELECT * INTO x FROM ms.consultation_lead_candidates WHERE id=r.candidate_id;
 INSERT INTO ms.lead_conversion_readiness_decisions(
  review_id,reviewer_id,decision,evidence_ref,reason_zh,request_key)
 VALUES(r.id,actor,'revoked',p_evidence,p_reason,p_key);
 UPDATE ms.lead_conversion_readiness SET status='revoked'
 WHERE id=r.id;
 INSERT INTO ms.audit_events(
 organization_id,actor_user_id,target_type,target_id,event_name,reason_zh,after_business_json)
 VALUES(org,actor,'contact_event',x.source_event_id,'LEAD_CONVERSION_CLEARANCE_REVOKED',
 '撤销原转换预审许可；原审批证据继续不可篡改，仍未生成正式线索',
 jsonb_build_object('原状态','预审通过','新状态','预审撤销'));
 RETURN '转换预审许可已撤销';
END $f$;
REVOKE ALL ON FUNCTION
 ms.submit_lead_conversion_preflight(uuid,text,text,text),
 ms.submit_lead_attribution_dispute(uuid,uuid,text,text,text),
 ms.decide_lead_attribution_dispute(uuid,text,text,text,text),
 ms.decide_lead_conversion_preflight(uuid,text,text,text,text),
 ms.revoke_lead_conversion_clearance(uuid,text,text,text)
 FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
 ms.submit_lead_conversion_preflight(uuid,text,text,text),
 ms.submit_lead_attribution_dispute(uuid,uuid,text,text,text),
 ms.decide_lead_attribution_dispute(uuid,text,text,text,text),
 ms.decide_lead_conversion_preflight(uuid,text,text,text,text),
 ms.revoke_lead_conversion_clearance(uuid,text,text,text)
 TO ms_scoped_lowrisk_writer;
COMMIT;
