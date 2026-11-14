-- V3.2-23: two-different-manager downstream reconciliation; release ONLY
-- verified false alarms with zero further commercial/finance exposure.
-- Intentionally impossible to auto-reassign mistaken student, order or money.
-- PostgreSQL16 isolated fictional data only. Apply after 001-026.
BEGIN;
ALTER TABLE ms.lead_student_downstream_correction_cases
 DROP CONSTRAINT lead_student_downstream_correction_cases_status_check;
ALTER TABLE ms.lead_student_downstream_correction_cases
 ADD CONSTRAINT lead_student_downstream_correction_cases_status_check
 CHECK (status IN('pending','hold_active','rejected','released_verified'));
CREATE TABLE ms.downstream_student_reconciliation_findings(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES ms.organizations(id),
 case_id uuid NOT NULL UNIQUE REFERENCES ms.lead_student_downstream_correction_cases(id),
 lead_id uuid NOT NULL REFERENCES ms.leads(id),
 student_id uuid NOT NULL REFERENCES ms.students(id),
 finding text NOT NULL CHECK(finding IN('original_student_confirmed','wrong_student_confirmed')),
 reviewed_by uuid NOT NULL REFERENCES ms.staff_users(id),
 student_evidence_ref text NOT NULL CHECK(length(trim(student_evidence_ref)) BETWEEN 2 AND 200),
 opportunity_evidence_ref text NOT NULL CHECK(length(trim(opportunity_evidence_ref)) BETWEEN 2 AND 200),
 finance_evidence_ref text NOT NULL CHECK(length(trim(finance_evidence_ref)) BETWEEN 2 AND 200),
 reason_zh text NOT NULL CHECK(length(trim(reason_zh)) BETWEEN 2 AND 400),
 request_key text NOT NULL CHECK(request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
 impact_snapshot jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(reviewed_by,request_key)
);
CREATE TABLE ms.downstream_student_reconciliation_resolutions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 finding_id uuid NOT NULL UNIQUE REFERENCES ms.downstream_student_reconciliation_findings(id),
 case_id uuid NOT NULL UNIQUE REFERENCES ms.lead_student_downstream_correction_cases(id),
 resolved_by uuid NOT NULL REFERENCES ms.staff_users(id),
 resolution text NOT NULL CHECK(resolution IN('release_verified','escalate_manual')),
 evidence_ref text NOT NULL CHECK(length(trim(evidence_ref)) BETWEEN 2 AND 200),
 reason_zh text NOT NULL CHECK(length(trim(reason_zh)) BETWEEN 2 AND 400),
 request_key text NOT NULL CHECK(request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
 final_impact_snapshot jsonb NOT NULL,
 resolved_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(resolved_by,request_key)
);
ALTER TABLE ms.downstream_student_reconciliation_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE ms.downstream_student_reconciliation_resolutions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ms.downstream_student_reconciliation_findings,
 ms.downstream_student_reconciliation_resolutions FROM PUBLIC,ms_lowrisk_runtime;
CREATE TRIGGER immutable_downstream_reconciliation_findings BEFORE UPDATE OR DELETE
 ON ms.downstream_student_reconciliation_findings
 FOR EACH ROW EXECUTE FUNCTION ms.reject_access_history_mutation();
CREATE TRIGGER immutable_downstream_reconciliation_resolutions BEFORE UPDATE OR DELETE
 ON ms.downstream_student_reconciliation_resolutions
 FOR EACH ROW EXECUTE FUNCTION ms.reject_access_history_mutation();

CREATE VIEW ms.scoped_downstream_student_reconciliations WITH (security_barrier=true) AS
SELECT c.id AS case_id,c.association_request_id,c.student_id,c.lead_id,
 s.display_name AS student_name,c.status AS case_status,
 f.id AS finding_id,f.finding,f.created_at AS finding_created_at,
 r.resolution,r.resolved_at,
 f.reviewed_by AS first_reviewer_id,c.requested_by
FROM ms.lead_student_downstream_correction_cases c
JOIN ms.students s ON s.id=c.student_id AND s.organization_id=c.organization_id
LEFT JOIN ms.downstream_student_reconciliation_findings f ON f.case_id=c.id
LEFT JOIN ms.downstream_student_reconciliation_resolutions r ON r.case_id=c.id
WHERE c.organization_id=ms.current_scoped_organization_id()
 AND ms.current_scoped_staff_id() IS NOT NULL
 AND (c.requested_by=ms.current_scoped_staff_id()
  OR c.reviewed_by=ms.current_scoped_staff_id()
  OR f.reviewed_by=ms.current_scoped_staff_id()
  OR r.resolved_by=ms.current_scoped_staff_id()
  OR (c.status='hold_active' AND EXISTS(
   SELECT 1 FROM ms.user_role_grants g JOIN ms.role_templates t ON t.id=g.role_id
   WHERE g.user_id=ms.current_scoped_staff_id() AND g.revoked_at IS NULL
   AND g.valid_from<=now() AND t.organization_id=c.organization_id
   AND t.role_code IN('sales_manager','super_admin'))));
REVOKE ALL ON ms.scoped_downstream_student_reconciliations FROM PUBLIC;
GRANT SELECT ON ms.scoped_downstream_student_reconciliations
 TO ms_student_assignee_reader;

-- No freely named reviewer is accepted from the client. A real manager LOGIN
-- must carry an active org-matched grant; different supervisors sign each stage.
CREATE FUNCTION ms.assert_active_reconciliation_manager(p_actor uuid,p_org uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ms AS $f$
BEGIN
 IF p_actor IS NULL OR NOT EXISTS(
  SELECT 1 FROM ms.staff_users u JOIN ms.user_role_grants g ON g.user_id=u.id
   JOIN ms.role_templates t ON t.id=g.role_id
  WHERE u.id=p_actor AND u.status='active' AND u.organization_id=p_org
   AND t.organization_id=p_org AND t.role_code IN('sales_manager','super_admin')
   AND g.revoked_at IS NULL AND g.valid_from<=now()
 ) THEN RAISE EXCEPTION '仅本机构有效独立主管可进行跨模块复核'
 USING ERRCODE='42501'; END IF;
END $f$;
REVOKE ALL ON FUNCTION ms.assert_active_reconciliation_manager(uuid,uuid) FROM PUBLIC;

CREATE FUNCTION ms.attest_downstream_student_reconciliation(
 p_case uuid,p_finding text,p_student_evidence text,
 p_opportunity_evidence text,p_finance_evidence text,
 p_reason text,p_key text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ms AS $f$
DECLARE actor uuid;org uuid;c ms.lead_student_downstream_correction_cases%ROWTYPE;
 l ms.leads%ROWTYPE;f ms.downstream_student_reconciliation_findings%ROWTYPE;
 n jsonb;rid uuid;state text;
BEGIN
 SELECT staff_id,org_id INTO actor,org FROM ms.access_actor();
 IF p_case IS NULL OR p_finding NOT IN('original_student_confirmed','wrong_student_confirmed')
  OR p_key IS NULL OR p_key !~ '^[A-Za-z0-9_-]{16,128}$'
  OR p_student_evidence IS NULL OR length(trim(p_student_evidence)) NOT BETWEEN 2 AND 200
  OR p_opportunity_evidence IS NULL OR length(trim(p_opportunity_evidence)) NOT BETWEEN 2 AND 200
  OR p_finance_evidence IS NULL OR length(trim(p_finance_evidence)) NOT BETWEEN 2 AND 200
  OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 2 AND 400
 THEN RAISE EXCEPTION '逐项核对学生、商机、资金影响的材料不完整'
 USING ERRCODE='23514'; END IF;
 PERFORM ms.assert_active_reconciliation_manager(actor,org);
 SELECT * INTO f FROM ms.downstream_student_reconciliation_findings
 WHERE reviewed_by=actor AND request_key=p_key;
 IF FOUND THEN
  IF f.case_id=p_case AND f.finding=p_finding AND f.student_evidence_ref=p_student_evidence
   AND f.opportunity_evidence_ref=p_opportunity_evidence
   AND f.finance_evidence_ref=p_finance_evidence AND f.reason_zh=p_reason
  THEN RETURN f.id; END IF;
  RAISE EXCEPTION '复核幂等编号用于不同核查' USING ERRCODE='23505'; END IF;
 SELECT * INTO c FROM ms.lead_student_downstream_correction_cases
 WHERE id=p_case AND organization_id=org FOR UPDATE;
 IF NOT FOUND OR c.status<>'hold_active' THEN
  RAISE EXCEPTION '仅允许复核本机构已经批准隔离的案件'
  USING ERRCODE='23514'; END IF;
 IF actor=c.requested_by THEN RAISE EXCEPTION '纠错申请人不得自己核对'
 USING ERRCODE='42501'; END IF;
 SELECT * INTO l FROM ms.leads WHERE id=c.lead_id AND organization_id=org FOR UPDATE;
 IF NOT FOUND OR l.owner_user_id IS DISTINCT FROM c.requested_by THEN
  RAISE EXCEPTION '线索负责人已变化，需重新检查案件'
 USING ERRCODE='23514'; END IF;
 SELECT ls.confirmation_state INTO state FROM ms.lead_students ls
 WHERE ls.lead_id=c.lead_id AND ls.student_id=c.student_id FOR UPDATE;
 IF state NOT IN('pending_review','verified') OR state IS NULL
 THEN RAISE EXCEPTION '原单名学生关联已变化，不能依据旧快照核查'
 USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM ms.opportunities o
 WHERE o.student_id=c.student_id AND o.originating_lead_id=c.lead_id)
 THEN RAISE EXCEPTION '下游商机已变化，请走独立更正核查'
 USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM ms.downstream_student_reconciliation_findings
 WHERE case_id=c.id) THEN RAISE EXCEPTION '本案件已有独立核对结论'
 USING ERRCODE='23505'; END IF;
 n:=ms.student_downstream_impact_counts(c.lead_id,c.student_id);
 INSERT INTO ms.downstream_student_reconciliation_findings(
 organization_id,case_id,lead_id,student_id,finding,reviewed_by,
 student_evidence_ref,opportunity_evidence_ref,finance_evidence_ref,
 reason_zh,request_key,impact_snapshot)
 VALUES(org,c.id,c.lead_id,c.student_id,p_finding,actor,
 p_student_evidence,p_opportunity_evidence,p_finance_evidence,p_reason,p_key,n)
 RETURNING id INTO rid;
 INSERT INTO ms.audit_events(organization_id,actor_user_id,target_type,target_id,
 event_name,reason_zh,after_business_json)
 VALUES(org,actor,'lead',c.lead_id,'DOWNSTREAM_RECONCILIATION_ATTESTED',
 '一名独立主管已记录学生、商机与资金影响核对结论；隔离仍有效',
 jsonb_build_object('结论',CASE WHEN p_finding='original_student_confirmed'
 THEN '原学生关联被核实为正确，待第二主管复核' ELSE '确认错误学生，必须继续隔离并转人工跨模块处置' END,
 '资金及订单','未修改'));
 RETURN rid;
END $f$;

CREATE FUNCTION ms.resolve_downstream_student_reconciliation(
 p_finding uuid,p_resolution text,p_evidence text,p_reason text,p_key text
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ms AS $f$
DECLARE actor uuid;org uuid;f ms.downstream_student_reconciliation_findings%ROWTYPE;
 c ms.lead_student_downstream_correction_cases%ROWTYPE;
 existing ms.downstream_student_reconciliation_resolutions%ROWTYPE;
 n jsonb;state text;result_text text;
BEGIN
 SELECT staff_id,org_id INTO actor,org FROM ms.access_actor();
 IF p_finding IS NULL OR p_resolution NOT IN('release_verified','escalate_manual')
 OR p_key IS NULL OR p_key !~ '^[A-Za-z0-9_-]{16,128}$'
 OR p_evidence IS NULL OR length(trim(p_evidence)) NOT BETWEEN 2 AND 200
 OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 2 AND 400
 THEN RAISE EXCEPTION '二次独立处置材料不完整' USING ERRCODE='23514'; END IF;
 PERFORM ms.assert_active_reconciliation_manager(actor,org);
 SELECT * INTO existing FROM ms.downstream_student_reconciliation_resolutions
 WHERE resolved_by=actor AND request_key=p_key;
 IF FOUND THEN
  IF existing.finding_id=p_finding AND existing.resolution=p_resolution
   AND existing.evidence_ref=p_evidence AND existing.reason_zh=p_reason
  THEN RETURN CASE WHEN p_resolution='release_verified'
    THEN '两位独立主管已确认原学生关联正确且无资金订单影响，销售隔离解除'
    ELSE '确认错误或存在下游影响，保留销售隔离，转人工跨模块纠错' END; END IF;
  RAISE EXCEPTION '处置编号冲突' USING ERRCODE='23505'; END IF;
 SELECT * INTO f FROM ms.downstream_student_reconciliation_findings
 WHERE id=p_finding AND organization_id=org;
 IF NOT FOUND THEN RAISE EXCEPTION '本机构无此核对记录' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM ms.lead_student_downstream_correction_cases
 WHERE id=f.case_id AND organization_id=org FOR UPDATE;
 IF NOT FOUND OR c.status<>'hold_active' THEN
  RAISE EXCEPTION '案件不再处于已确认隔离状态' USING ERRCODE='23514'; END IF;
 IF actor IN(c.requested_by,f.reviewed_by,c.reviewed_by) THEN
  RAISE EXCEPTION '二次处置必须由未参与此前申请和审批的另一位主管完成'
  USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM ms.leads l WHERE l.id=c.lead_id AND l.organization_id=org
  AND l.owner_user_id=c.requested_by FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '线索负责人已变化' USING ERRCODE='23514'; END IF;
 SELECT ls.confirmation_state INTO state FROM ms.lead_students ls
 WHERE ls.lead_id=c.lead_id AND ls.student_id=c.student_id FOR UPDATE;
 n:=ms.student_downstream_impact_counts(c.lead_id,c.student_id);
 IF p_resolution='release_verified' THEN
  IF f.finding<>'original_student_confirmed' OR state<>'verified' THEN
   RAISE EXCEPTION '原学生关联尚未核实正确，绝不能解除隔离'
   USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM ms.opportunities o
   WHERE o.originating_lead_id=c.lead_id AND o.student_id=c.student_id
     AND o.lifecycle_state NOT IN('open','paused'))
  THEN RAISE EXCEPTION '商机存在不可直接恢复的既有阶段'
   USING ERRCODE='23514'; END IF;
  IF (n->>'opportunities')::integer<1 OR
     (n->>'quotes')::integer<>0 OR (n->>'orders')::integer<>0 OR
     (n->>'allocations')::integer<>0 OR (n->>'refund_allocations')::integer<>0 OR
     (n->>'trials')::integer<>0 OR (n->>'sale_events')::integer<>0 OR
     (n->>'entitlements')::integer<>0
  THEN RAISE EXCEPTION '存在报价、订单、试课、收退款或权益历史，必须继续隔离并转人工跨模块核查'
   USING ERRCODE='23514'; END IF;
  IF n<>f.impact_snapshot THEN
   RAISE EXCEPTION '下游影响与首次独立核对的快照不一致，不能直接解除隔离'
   USING ERRCODE='23514'; END IF;
 ELSE
  -- Explicitly escalate; the hold stays active even if the original
  -- association is mistaken and financial facts are unresolved.
  NULL;
 END IF;
 INSERT INTO ms.downstream_student_reconciliation_resolutions(
  finding_id,case_id,resolved_by,resolution,evidence_ref,reason_zh,request_key,
  final_impact_snapshot)
 VALUES(f.id,c.id,actor,p_resolution,p_evidence,p_reason,p_key,n);
 IF p_resolution='release_verified' THEN
  UPDATE ms.lead_student_downstream_correction_cases
    SET status='released_verified' WHERE id=c.id;
 END IF;
 result_text:=CASE WHEN p_resolution='release_verified'
  THEN '两位独立主管已确认原学生关联正确且无资金订单影响，销售隔离解除'
  ELSE '确认错误或存在下游影响，保留销售隔离，转人工跨模块纠错' END;
 INSERT INTO ms.audit_events(
  organization_id,actor_user_id,target_type,target_id,event_name,reason_zh,after_business_json)
 VALUES(org,actor,'lead',c.lead_id,'DOWNSTREAM_RECONCILIATION_RESOLVED',
  '第二位独立主管审查当前影响与证据；正式销售归因和财务历史不变',
  jsonb_build_object('处理结果',result_text,'财务改写','无',
   '实际学生改绑','无','第二主管与第一主管','不同员工'));
 RETURN result_text;
END $f$;
REVOKE ALL ON FUNCTION
 ms.attest_downstream_student_reconciliation(uuid,text,text,text,text,text,text),
 ms.resolve_downstream_student_reconciliation(uuid,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
 ms.attest_downstream_student_reconciliation(uuid,text,text,text,text,text,text),
 ms.resolve_downstream_student_reconciliation(uuid,text,text,text,text)
 TO ms_scoped_lowrisk_writer;
COMMIT;
