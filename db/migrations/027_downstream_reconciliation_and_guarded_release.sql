-- V3.2-23: Double-independent review of downstream student correction.
-- Limited release ONLY when original student association was a false alarm AND
-- no quote, order, payment, refund, trial, sales recognition or fulfillment links.
-- A true mistake stays quarantined until authoritative cross-module tooling exists.
-- Disposable fictional PostgreSQL 16 only. Never run on the live CRM.
BEGIN;

ALTER TABLE ms.lead_student_downstream_correction_cases
 DROP CONSTRAINT lead_student_downstream_correction_cases_status_check;
ALTER TABLE ms.lead_student_downstream_correction_cases
 ADD CONSTRAINT lead_student_downstream_correction_cases_status_check
 CHECK(status IN('pending','hold_active','rejected','released'));
-- A resolved false alarm is no longer a live hold. A confirmed error remains hold_active.

CREATE TABLE ms.downstream_correction_reconciliation_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES ms.organizations(id),
 case_id uuid NOT NULL REFERENCES ms.lead_student_downstream_correction_cases(id),
 requested_by uuid NOT NULL REFERENCES ms.staff_users(id),
 resolution text NOT NULL CHECK(resolution IN('original_student_valid','external_action_required')),
 scope_snapshot jsonb NOT NULL CHECK(jsonb_typeof(scope_snapshot)='object'),
 evidence_ref text NOT NULL CHECK(length(trim(evidence_ref)) BETWEEN 2 AND 200),
 independent_basis_ref text NOT NULL CHECK(length(trim(independent_basis_ref)) BETWEEN 2 AND 200),
 reason_zh text NOT NULL CHECK(length(trim(reason_zh)) BETWEEN 2 AND 400),
 request_key text NOT NULL CHECK(request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
 status text NOT NULL DEFAULT 'pending'
  CHECK(status IN('pending','released','external_action_required','rejected')),
 reviewed_by uuid REFERENCES ms.staff_users(id),
 reviewed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(requested_by,request_key),
 CHECK((status='pending' AND reviewed_by IS NULL AND reviewed_at IS NULL)
  OR (status<>'pending' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
);
CREATE UNIQUE INDEX uq_active_downstream_reconciliation
 ON ms.downstream_correction_reconciliation_requests(case_id)
 WHERE status IN('pending','released','external_action_required');

CREATE TABLE ms.downstream_correction_reconciliation_decisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 request_id uuid NOT NULL UNIQUE REFERENCES ms.downstream_correction_reconciliation_requests(id),
 reviewer_id uuid NOT NULL REFERENCES ms.staff_users(id),
 decision text NOT NULL CHECK(decision IN('approved','rejected')),
 evidence_ref text NOT NULL CHECK(length(trim(evidence_ref)) BETWEEN 2 AND 200),
 reason_zh text NOT NULL CHECK(length(trim(reason_zh)) BETWEEN 2 AND 400),
 request_key text NOT NULL CHECK(request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
 decided_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(reviewer_id,request_key)
);
CREATE TABLE ms.downstream_correction_reconciliation_effects (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 request_id uuid NOT NULL UNIQUE REFERENCES ms.downstream_correction_reconciliation_requests(id),
 case_id uuid NOT NULL REFERENCES ms.lead_student_downstream_correction_cases(id),
 effect text NOT NULL CHECK(effect IN('release_false_alarm','external_handoff_hold_retained')),
 applied_by uuid NOT NULL REFERENCES ms.staff_users(id),
 scope_snapshot jsonb NOT NULL CHECK(jsonb_typeof(scope_snapshot)='object'),
 applied_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE ms.downstream_correction_reconciliation_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE ms.downstream_correction_reconciliation_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ms.downstream_correction_reconciliation_effects ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ms.downstream_correction_reconciliation_requests,
 ms.downstream_correction_reconciliation_decisions,
 ms.downstream_correction_reconciliation_effects
 FROM PUBLIC,ms_lowrisk_runtime;
CREATE TRIGGER immutable_reconciliation_decisions BEFORE UPDATE OR DELETE
 ON ms.downstream_correction_reconciliation_decisions
 FOR EACH ROW EXECUTE FUNCTION ms.reject_access_history_mutation();
CREATE TRIGGER immutable_reconciliation_effects BEFORE UPDATE OR DELETE
 ON ms.downstream_correction_reconciliation_effects
 FOR EACH ROW EXECUTE FUNCTION ms.reject_access_history_mutation();

CREATE VIEW ms.scoped_downstream_reconciliation_requests
 WITH (security_barrier=true) AS
 SELECT r.id AS reconciliation_id,r.case_id,r.resolution,r.status,
 r.requested_by,r.created_at,c.lead_id,c.student_id,
 s.display_name AS student_name,
 c.opportunity_count,c.quote_count,c.order_count,c.allocation_count,
 c.refund_allocation_count,c.trial_count,c.sale_event_count,c.entitlement_count
 FROM ms.downstream_correction_reconciliation_requests r
 JOIN ms.lead_student_downstream_correction_cases c ON c.id=r.case_id
  AND c.organization_id=r.organization_id
 JOIN ms.students s ON s.id=c.student_id AND s.organization_id=r.organization_id
 WHERE r.organization_id=ms.current_scoped_organization_id()
 AND ms.current_scoped_staff_id() IS NOT NULL AND
 (r.requested_by=ms.current_scoped_staff_id()
  OR r.reviewed_by=ms.current_scoped_staff_id()
  OR (r.status='pending' AND EXISTS(
   SELECT 1 FROM ms.user_role_grants g JOIN ms.role_templates t ON t.id=g.role_id
   WHERE g.user_id=ms.current_scoped_staff_id()
    AND g.revoked_at IS NULL AND g.valid_from<=now()
    AND t.organization_id=r.organization_id
    AND t.role_code IN('sales_manager','super_admin'))));

CREATE VIEW ms.scoped_downstream_reconciliation_eligible
 WITH (security_barrier=true) AS
 SELECT c.id AS case_id,c.lead_id,c.student_id,
 s.display_name AS student_name,c.opportunity_count,c.quote_count,
 c.order_count,c.allocation_count,c.refund_allocation_count,
 c.trial_count,c.sale_event_count,c.entitlement_count
 FROM ms.lead_student_downstream_correction_cases c
 JOIN ms.students s ON s.id=c.student_id AND s.organization_id=c.organization_id
 JOIN ms.leads l ON l.id=c.lead_id AND l.organization_id=c.organization_id
 WHERE c.organization_id=ms.current_scoped_organization_id()
  AND c.status='hold_active' AND c.requested_by=ms.current_scoped_staff_id()
  AND l.owner_user_id=ms.current_scoped_staff_id()
  AND NOT EXISTS(SELECT 1 FROM ms.downstream_correction_reconciliation_requests r
   WHERE r.case_id=c.id AND r.status IN('pending','released','external_action_required'));
REVOKE ALL ON ms.scoped_downstream_reconciliation_requests,
 ms.scoped_downstream_reconciliation_eligible FROM PUBLIC;
GRANT SELECT ON ms.scoped_downstream_reconciliation_requests,
 ms.scoped_downstream_reconciliation_eligible TO ms_student_assignee_reader;

CREATE FUNCTION ms.request_downstream_reconciliation(
 p_case uuid,p_resolution text,p_evidence text,
 p_basis text,p_reason text,p_key text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ms AS $f$
DECLARE actor uuid;org uuid;c ms.lead_student_downstream_correction_cases%ROWTYPE;
 lead_owner uuid;ls_state text;
 old ms.downstream_correction_reconciliation_requests%ROWTYPE;
 n jsonb; rid uuid;
BEGIN
 SELECT staff_id,org_id INTO actor,org FROM ms.access_actor();
 IF actor IS NULL THEN RAISE EXCEPTION '员工身份无效' USING ERRCODE='42501'; END IF;
 IF p_case IS NULL OR p_resolution IS NULL
 OR p_resolution NOT IN('original_student_valid','external_action_required')
 OR p_key IS NULL OR p_key !~ '^[A-Za-z0-9_-]{16,128}$'
 OR p_evidence IS NULL OR length(trim(p_evidence)) NOT BETWEEN 2 AND 200
 OR p_basis IS NULL OR length(trim(p_basis)) NOT BETWEEN 2 AND 200
 OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 2 AND 400
 THEN RAISE EXCEPTION '跨模块核实材料不完整' USING ERRCODE='23514'; END IF;
 SELECT * INTO old FROM ms.downstream_correction_reconciliation_requests
 WHERE requested_by=actor AND request_key=p_key;
 IF FOUND THEN
  IF old.case_id=p_case AND old.resolution=p_resolution
  AND old.evidence_ref=p_evidence AND old.independent_basis_ref=p_basis
  AND old.reason_zh=p_reason THEN RETURN old.id; END IF;
  RAISE EXCEPTION '防重编号已用于其他核查材料' USING ERRCODE='23505'; END IF;
 SELECT * INTO c FROM ms.lead_student_downstream_correction_cases
 WHERE id=p_case AND organization_id=org AND requested_by=actor FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '仅原员工可提出本机构下游核实'
 USING ERRCODE='42501'; END IF;
 IF c.status<>'hold_active' OR c.reviewed_by IS NULL THEN
  RAISE EXCEPTION '必须先完成第一名独立主管的隔离批准'
  USING ERRCODE='23514'; END IF;
 SELECT l.owner_user_id INTO lead_owner FROM ms.leads l
 WHERE l.id=c.lead_id AND l.organization_id=org FOR UPDATE;
 IF lead_owner IS DISTINCT FROM actor THEN RAISE EXCEPTION '线索负责人已变化'
 USING ERRCODE='42501'; END IF;
 SELECT ls.confirmation_state INTO ls_state FROM ms.lead_students ls
 WHERE ls.lead_id=c.lead_id AND ls.student_id=c.student_id FOR UPDATE;
 IF ls_state NOT IN('pending_review','verified') OR ls_state IS NULL THEN
  RAISE EXCEPTION '学生销售关联状态已变化，需要重新核实'
  USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM ms.downstream_correction_reconciliation_requests r
 WHERE r.case_id=c.id AND r.status IN('pending','released','external_action_required'))
 THEN RAISE EXCEPTION '已有待审核的跨模块核实或处置历史'
 USING ERRCODE='23505'; END IF;
 n:=ms.student_downstream_impact_counts(c.lead_id,c.student_id);
 IF (n->>'opportunities')::integer<1 THEN
  RAISE EXCEPTION '当前已无原始商机，须重新核对案件' USING ERRCODE='23514'; END IF;
 INSERT INTO ms.downstream_correction_reconciliation_requests(
  organization_id,case_id,requested_by,resolution,scope_snapshot,
  evidence_ref,independent_basis_ref,reason_zh,request_key)
 VALUES(org,c.id,actor,p_resolution,n,p_evidence,p_basis,p_reason,p_key)
 RETURNING id INTO rid;
 INSERT INTO ms.audit_events(organization_id,actor_user_id,target_type,target_id,
 event_name,reason_zh,after_business_json)
 VALUES(org,actor,'lead',c.lead_id,'DOWNSTREAM_RECONCILIATION_REQUESTED',
  '已提交第二名独立主管的下游核查；销售隔离保持，不修改学生或财务',
  jsonb_build_object('方向',CASE WHEN p_resolution='original_student_valid'
    THEN '申请核实原学生关联属误报' ELSE '确认错误，交由跨部门处理' END,
    '仍在保护','是'));
 RETURN rid;
END $f$;

CREATE FUNCTION ms.decide_downstream_reconciliation(
 p_review uuid,p_decision text,p_evidence text,p_reason text,p_key text
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ms AS $f$
DECLARE actor uuid;org uuid;r ms.downstream_correction_reconciliation_requests%ROWTYPE;
 old ms.downstream_correction_reconciliation_decisions%ROWTYPE;
 c ms.lead_student_downstream_correction_cases%ROWTYPE;
 n jsonb;ls_state text;owner_id uuid;status_text text;
BEGIN
 SELECT staff_id,org_id INTO actor,org FROM ms.access_actor();
 IF actor IS NULL THEN RAISE EXCEPTION '复核主管身份无效' USING ERRCODE='42501'; END IF;
 IF p_review IS NULL OR p_decision NOT IN('approved','rejected')
 OR p_key IS NULL OR p_key !~ '^[A-Za-z0-9_-]{16,128}$'
 OR p_evidence IS NULL OR length(trim(p_evidence)) NOT BETWEEN 2 AND 200
 OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 2 AND 400
 THEN RAISE EXCEPTION '跨模块独立复核材料不完整' USING ERRCODE='23514'; END IF;
 SELECT * INTO old FROM ms.downstream_correction_reconciliation_decisions
 WHERE reviewer_id=actor AND request_key=p_key;
 IF FOUND THEN
  IF old.request_id=p_review AND old.decision=p_decision
   AND old.evidence_ref=p_evidence AND old.reason_zh=p_reason THEN
   SELECT status INTO status_text FROM ms.downstream_correction_reconciliation_requests
    WHERE id=p_review AND organization_id=org;
   RETURN CASE status_text
     WHEN 'released' THEN '误报已独立复核且无下游负担，销售隔离已解除'
     WHEN 'external_action_required' THEN '已进入跨部门人工纠错，销售隔离继续保持'
     ELSE '本次复核已驳回，销售隔离继续保持' END;
  END IF;
  RAISE EXCEPTION '主管复核编号对应不同决定' USING ERRCODE='23505'; END IF;
 SELECT * INTO r FROM ms.downstream_correction_reconciliation_requests
 WHERE id=p_review AND organization_id=org FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '本机构无此复核申请' USING ERRCODE='42501'; END IF;
 IF r.status<>'pending' THEN RAISE EXCEPTION '本次复核已经处理' USING ERRCODE='23505'; END IF;
 SELECT * INTO c FROM ms.lead_student_downstream_correction_cases
 WHERE id=r.case_id AND organization_id=org FOR UPDATE;
 IF NOT FOUND OR c.status<>'hold_active' THEN
  RAISE EXCEPTION '当前隔离已变化，不可执行复核决定'
  USING ERRCODE='23514'; END IF;
 IF actor IN(c.requested_by,c.reviewed_by) THEN
  RAISE EXCEPTION '原员工及第一位主管均不能担任第二位独立复核人'
  USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM ms.user_role_grants g
 JOIN ms.role_templates t ON t.id=g.role_id
 JOIN ms.staff_users u ON u.id=g.user_id
 WHERE g.user_id=actor AND g.revoked_at IS NULL AND g.valid_from<=now()
 AND t.organization_id=org AND u.organization_id=org AND u.status='active'
 AND t.role_code IN('sales_manager','super_admin'))
 THEN RAISE EXCEPTION '必须由同机构另一名有效主管独立复核'
  USING ERRCODE='42501'; END IF;
 IF p_decision='approved' THEN
  SELECT l.owner_user_id INTO owner_id FROM ms.leads l
  WHERE l.id=c.lead_id AND l.organization_id=org FOR UPDATE;
  IF owner_id IS DISTINCT FROM c.requested_by THEN
   RAISE EXCEPTION '正式线索归属已变化，必须重新核查'
   USING ERRCODE='23514'; END IF;
  SELECT ls.confirmation_state INTO ls_state FROM ms.lead_students ls
  WHERE ls.lead_id=c.lead_id AND ls.student_id=c.student_id FOR UPDATE;
  IF ls_state NOT IN('pending_review','verified') OR ls_state IS NULL THEN
   RAISE EXCEPTION '指定单学生关联状态已变化，拒绝解除隔离'
   USING ERRCODE='23514'; END IF;
  n:=ms.student_downstream_impact_counts(c.lead_id,c.student_id);
  IF n IS DISTINCT FROM r.scope_snapshot THEN
   RAISE EXCEPTION '下游业务数量在申请后发生变化，需要重新核算'
   USING ERRCODE='23514'; END IF;
  IF r.resolution='original_student_valid' THEN
   IF (n->>'opportunities')::integer<1 OR
    (n->>'quotes')::integer>0 OR
    (n->>'orders')::integer>0 OR
    (n->>'allocations')::integer>0 OR
    (n->>'refund_allocations')::integer>0 OR
    (n->>'trials')::integer>0 OR
    (n->>'sale_events')::integer>0 OR
    (n->>'entitlements')::integer>0
   THEN RAISE EXCEPTION '已有报价、订单、试课、资金或履约负担，不能以误报直接解除隔离'
    USING ERRCODE='23514'; END IF;
   UPDATE ms.lead_student_downstream_correction_cases
    SET status='released' WHERE id=c.id;
   status_text:='误报已独立复核且无下游负担，销售隔离已解除';
  ELSE
   status_text:='已进入跨部门人工纠错，销售隔离继续保持';
  END IF;
  INSERT INTO ms.downstream_correction_reconciliation_effects(
   request_id,case_id,effect,applied_by,scope_snapshot)
  VALUES(r.id,c.id,CASE WHEN r.resolution='original_student_valid'
   THEN 'release_false_alarm' ELSE 'external_handoff_hold_retained' END,actor,n);
 END IF;
 INSERT INTO ms.downstream_correction_reconciliation_decisions(
 request_id,reviewer_id,decision,evidence_ref,reason_zh,request_key)
 VALUES(r.id,actor,p_decision,p_evidence,p_reason,p_key);
 UPDATE ms.downstream_correction_reconciliation_requests
 SET status=CASE WHEN p_decision='rejected' THEN 'rejected'
 WHEN r.resolution='original_student_valid' THEN 'released'
 ELSE 'external_action_required' END,
 reviewed_by=actor,reviewed_at=now() WHERE id=r.id;
 IF p_decision='rejected' THEN
  status_text:='本次复核已驳回，销售隔离继续保持';
 END IF;
 INSERT INTO ms.audit_events(organization_id,actor_user_id,target_type,target_id,
 event_name,reason_zh,after_business_json)
 VALUES(org,actor,'lead',c.lead_id,'DOWNSTREAM_RECONCILIATION_REVIEWED',
 '第二名独立主管复核；错误学生的商机及财务不能自动转移',
 jsonb_build_object('结果',status_text,
  '原始学生关联','保留','订单合同','未改写','历史审计','保留'));
 RETURN status_text;
END $f$;
REVOKE ALL ON FUNCTION
 ms.request_downstream_reconciliation(uuid,text,text,text,text,text),
 ms.decide_downstream_reconciliation(uuid,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
 ms.request_downstream_reconciliation(uuid,text,text,text,text,text),
 ms.decide_downstream_reconciliation(uuid,text,text,text,text)
 TO ms_scoped_lowrisk_writer;
COMMIT;
