-- V3.2-22: Downstream-dependent wrong-student link quarantine.
-- Disposable PG16, fictional data only. No downstream reassignment or financial mutation.
BEGIN;

CREATE TABLE ms.lead_student_downstream_correction_cases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES ms.organizations(id),
 association_request_id uuid NOT NULL REFERENCES ms.lead_student_association_requests(id),
 lead_id uuid NOT NULL REFERENCES ms.leads(id),
 student_id uuid NOT NULL REFERENCES ms.students(id),
 requested_by uuid NOT NULL REFERENCES ms.staff_users(id),
 evidence_ref text NOT NULL CHECK(length(trim(evidence_ref)) BETWEEN 2 AND 200),
 reason_zh text NOT NULL CHECK(length(trim(reason_zh)) BETWEEN 2 AND 400),
 request_key text NOT NULL CHECK(request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
 opportunity_count integer NOT NULL CHECK(opportunity_count > 0),
 quote_count integer NOT NULL CHECK(quote_count >= 0),
 order_count integer NOT NULL CHECK(order_count >= 0),
 allocation_count integer NOT NULL CHECK(allocation_count >= 0),
 refund_allocation_count integer NOT NULL CHECK(refund_allocation_count >= 0),
 trial_count integer NOT NULL CHECK(trial_count >= 0),
 sale_event_count integer NOT NULL CHECK(sale_event_count >= 0),
 entitlement_count integer NOT NULL CHECK(entitlement_count >= 0),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','hold_active','rejected')),
 reviewed_by uuid REFERENCES ms.staff_users(id),
 reviewed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(requested_by,request_key),
 CHECK((status='pending' AND reviewed_by IS NULL AND reviewed_at IS NULL)
   OR(status<>'pending' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
);
CREATE UNIQUE INDEX uq_live_downstream_student_case
 ON ms.lead_student_downstream_correction_cases(association_request_id)
 WHERE status IN('pending','hold_active');
CREATE TABLE ms.lead_student_downstream_correction_decisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 case_id uuid NOT NULL UNIQUE REFERENCES ms.lead_student_downstream_correction_cases(id),
 reviewer_id uuid NOT NULL REFERENCES ms.staff_users(id),
 decision text NOT NULL CHECK(decision IN('hold_active','rejected')),
 evidence_ref text NOT NULL CHECK(length(trim(evidence_ref)) BETWEEN 2 AND 200),
 reason_zh text NOT NULL CHECK(length(trim(reason_zh)) BETWEEN 2 AND 400),
 request_key text NOT NULL CHECK(request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
 decided_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(reviewer_id,request_key)
);
ALTER TABLE ms.lead_student_downstream_correction_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE ms.lead_student_downstream_correction_decisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ms.lead_student_downstream_correction_cases,
 ms.lead_student_downstream_correction_decisions FROM PUBLIC,ms_lowrisk_runtime;
CREATE TRIGGER immutable_downstream_case_decision BEFORE UPDATE OR DELETE
 ON ms.lead_student_downstream_correction_decisions
 FOR EACH ROW EXECUTE FUNCTION ms.reject_access_history_mutation();

-- Original student/lead association is not edited; case snapshot contains
-- COUNTS only, not personal details or sensitive amounts.
CREATE VIEW ms.scoped_downstream_student_correction_eligible WITH (security_barrier=true) AS
SELECT q.id AS association_request_id,q.lead_id,q.student_id,
 s.display_name AS student_name,ls.confirmation_state AS current_state,
 (SELECT count(*)::integer FROM ms.opportunities o
  WHERE o.originating_lead_id=q.lead_id AND o.student_id=q.student_id)
 AS opportunity_count
FROM ms.lead_student_association_requests q
JOIN ms.leads l ON l.id=q.lead_id AND l.organization_id=q.organization_id
JOIN ms.students s ON s.id=q.student_id AND s.organization_id=q.organization_id
JOIN ms.lead_students ls ON ls.lead_id=q.lead_id AND ls.student_id=q.student_id
WHERE q.organization_id=ms.current_scoped_organization_id()
 AND q.status='approved_pending'
 AND q.requested_by=ms.current_scoped_staff_id()
 AND l.owner_user_id=ms.current_scoped_staff_id()
 AND EXISTS(SELECT 1 FROM ms.lead_conversion_executions e
  WHERE e.lead_id=l.id AND e.executed_by=ms.current_scoped_staff_id()
    AND e.organization_id=q.organization_id)
 AND ls.confirmation_state IN('pending_review','verified')
 AND EXISTS(SELECT 1 FROM ms.opportunities o
  WHERE o.originating_lead_id=q.lead_id AND o.student_id=q.student_id)
 AND NOT EXISTS(SELECT 1 FROM ms.lead_student_downstream_correction_cases c
   WHERE c.association_request_id=q.id AND c.status IN('pending','hold_active'));

CREATE VIEW ms.scoped_downstream_student_correction_cases WITH (security_barrier=true) AS
SELECT c.id AS case_id,c.association_request_id,c.lead_id,c.student_id,
 s.display_name AS student_name,c.status,c.created_at,c.requested_by,
 c.opportunity_count,c.quote_count,c.order_count,c.allocation_count,
 c.refund_allocation_count,c.trial_count,c.sale_event_count,c.entitlement_count
FROM ms.lead_student_downstream_correction_cases c
JOIN ms.students s ON s.id=c.student_id AND s.organization_id=c.organization_id
WHERE c.organization_id=ms.current_scoped_organization_id()
 AND ms.current_scoped_staff_id() IS NOT NULL
 AND (c.requested_by=ms.current_scoped_staff_id()
  OR c.reviewed_by=ms.current_scoped_staff_id()
  OR (c.status='pending' AND EXISTS(
   SELECT 1 FROM ms.user_role_grants g JOIN ms.role_templates t ON t.id=g.role_id
   WHERE g.user_id=ms.current_scoped_staff_id()
    AND g.revoked_at IS NULL AND g.valid_from<=now()
    AND t.organization_id=c.organization_id
    AND t.role_code IN('sales_manager','super_admin'))));
REVOKE ALL ON ms.scoped_downstream_student_correction_eligible,
 ms.scoped_downstream_student_correction_cases FROM PUBLIC;
GRANT SELECT ON ms.scoped_downstream_student_correction_eligible,
 ms.scoped_downstream_student_correction_cases TO ms_student_assignee_reader;

CREATE FUNCTION ms.student_downstream_impact_counts(p_lead uuid,p_student uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,ms AS $f$
 SELECT jsonb_build_object(
 'opportunities',(SELECT count(*)::integer FROM ms.opportunities o
   WHERE o.originating_lead_id=p_lead AND o.student_id=p_student),
 'quotes',(SELECT count(*)::integer FROM ms.quotes q JOIN ms.opportunities o
   ON o.id=q.opportunity_id WHERE o.originating_lead_id=p_lead AND o.student_id=p_student),
 'orders',(SELECT count(*)::integer FROM ms.sales_orders so JOIN ms.opportunities o
   ON o.id=so.opportunity_id WHERE o.originating_lead_id=p_lead AND o.student_id=p_student),
 'allocations',(SELECT count(*)::integer FROM ms.payment_allocations x
   JOIN ms.sales_orders so ON so.id=x.order_id JOIN ms.opportunities o ON o.id=so.opportunity_id
   WHERE o.originating_lead_id=p_lead AND o.student_id=p_student),
 'refund_allocations',(SELECT count(*)::integer FROM ms.refund_allocations x
   JOIN ms.sales_orders so ON so.id=x.order_id JOIN ms.opportunities o ON o.id=so.opportunity_id
   WHERE o.originating_lead_id=p_lead AND o.student_id=p_student),
 'trials',(SELECT count(*)::integer FROM ms.trial_bookings t JOIN ms.opportunities o
   ON o.id=t.opportunity_id WHERE o.originating_lead_id=p_lead AND o.student_id=p_student),
 'sale_events',(SELECT count(*)::integer FROM ms.sale_events se
   JOIN ms.sales_orders so ON so.id=se.order_id JOIN ms.opportunities o ON o.id=so.opportunity_id
   WHERE o.originating_lead_id=p_lead AND o.student_id=p_student),
 'entitlements',(SELECT count(*)::integer FROM ms.crm_entitlement_links ce
   JOIN ms.sales_order_items si ON si.id=ce.order_item_id
   JOIN ms.sales_orders so ON so.id=si.order_id
   JOIN ms.opportunities o ON o.id=so.opportunity_id
   WHERE o.originating_lead_id=p_lead AND o.student_id=p_student));
$f$;
REVOKE ALL ON FUNCTION ms.student_downstream_impact_counts(uuid,uuid) FROM PUBLIC;

-- Never rely on a cached browser value or an HTTP-submitted org/employee.
-- Lock the original lead; no other employee may report this student as theirs.
CREATE FUNCTION ms.request_downstream_student_correction(
 p_association uuid,p_evidence text,p_reason text,p_key text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ms AS $f$
DECLARE actor uuid;org uuid;q ms.lead_student_association_requests%ROWTYPE;
 l ms.leads%ROWTYPE;st text;old ms.lead_student_downstream_correction_cases%ROWTYPE;
 n jsonb;cid uuid;
BEGIN
 SELECT staff_id,org_id INTO actor,org FROM ms.access_actor();
 IF actor IS NULL THEN RAISE EXCEPTION '员工身份无效' USING ERRCODE='42501'; END IF;
 IF p_association IS NULL OR p_key IS NULL OR p_key !~ '^[A-Za-z0-9_-]{16,128}$'
 OR p_evidence IS NULL OR length(trim(p_evidence)) NOT BETWEEN 2 AND 200
 OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 2 AND 400
 THEN RAISE EXCEPTION '下游商机纠错核查材料不完整' USING ERRCODE='23514'; END IF;
 SELECT * INTO old FROM ms.lead_student_downstream_correction_cases
 WHERE requested_by=actor AND request_key=p_key;
 IF FOUND THEN
  IF old.association_request_id=p_association AND old.evidence_ref=p_evidence
   AND old.reason_zh=p_reason THEN RETURN old.id; END IF;
  RAISE EXCEPTION '重复操作编号对应不同材料' USING ERRCODE='23505'; END IF;
 SELECT * INTO q FROM ms.lead_student_association_requests
 WHERE id=p_association AND organization_id=org AND requested_by=actor
  AND status='approved_pending';
 IF NOT FOUND THEN RAISE EXCEPTION '只能核查自己已获准的单名学生关联'
 USING ERRCODE='42501'; END IF;
 SELECT * INTO l FROM ms.leads WHERE id=q.lead_id
  AND organization_id=org AND owner_user_id=actor FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM ms.lead_conversion_executions ex
 WHERE ex.lead_id=q.lead_id AND ex.organization_id=org AND ex.executed_by=actor)
 THEN RAISE EXCEPTION '当前线索不属于本人或无独立转换证明'
 USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM ms.students s WHERE s.id=q.student_id
  AND s.organization_id=org)
 THEN RAISE EXCEPTION '指定学生不存在于本机构' USING ERRCODE='23514'; END IF;
 SELECT confirmation_state INTO st FROM ms.lead_students
 WHERE lead_id=q.lead_id AND student_id=q.student_id FOR UPDATE;
 IF st NOT IN('pending_review','verified') OR st IS NULL THEN
  RAISE EXCEPTION '该关联已失效或撤回' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM ms.lead_student_downstream_correction_cases c
 WHERE c.association_request_id=q.id AND c.status IN('pending','hold_active'))
 THEN RAISE EXCEPTION '已有待处理的下游影响纠错案件' USING ERRCODE='23505'; END IF;
 n:=ms.student_downstream_impact_counts(q.lead_id,q.student_id);
 IF (n->>'opportunities')::integer<1 THEN
  RAISE EXCEPTION '此学生尚无下游商机，请使用普通错误关联撤回'
  USING ERRCODE='23514'; END IF;
 INSERT INTO ms.lead_student_downstream_correction_cases(
 organization_id,association_request_id,lead_id,student_id,requested_by,
 evidence_ref,reason_zh,request_key,
 opportunity_count,quote_count,order_count,allocation_count,
 refund_allocation_count,trial_count,sale_event_count,entitlement_count)
 VALUES(org,q.id,q.lead_id,q.student_id,actor,p_evidence,p_reason,p_key,
 (n->>'opportunities')::integer,(n->>'quotes')::integer,(n->>'orders')::integer,
 (n->>'allocations')::integer,(n->>'refund_allocations')::integer,
 (n->>'trials')::integer,(n->>'sale_events')::integer,(n->>'entitlements')::integer)
 RETURNING id INTO cid;
 INSERT INTO ms.audit_events(organization_id,actor_user_id,target_type,target_id,
 event_name,reason_zh,after_business_json)
 VALUES(org,actor,'lead',q.lead_id,'STUDENT_DOWNSTREAM_CORRECTION_CASE_OPENED',
  '指定学生存在下游商机，已进入纠错保护待审，不变更商机、学生或财务',
  jsonb_build_object('审核状态','待主管独立核查',
    '影响范围','仅指定学生与该线索产生的下游商机',
    '原关联','保持不变','销售推进保护','已生效'));
 RETURN cid;
END $f$;

CREATE FUNCTION ms.decide_downstream_student_correction(
 p_case uuid,p_decision text,p_evidence text,p_reason text,p_key text
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ms AS $f$
DECLARE reviewer uuid;org uuid;c ms.lead_student_downstream_correction_cases%ROWTYPE;
 old ms.lead_student_downstream_correction_decisions%ROWTYPE;
 output text;lead_owner uuid;
BEGIN
 SELECT staff_id,org_id INTO reviewer,org FROM ms.access_actor();
 IF reviewer IS NULL THEN RAISE EXCEPTION '主管身份无效' USING ERRCODE='42501'; END IF;
 IF p_case IS NULL OR p_decision NOT IN('hold_active','rejected')
 OR p_key IS NULL OR p_key !~ '^[A-Za-z0-9_-]{16,128}$'
 OR p_evidence IS NULL OR length(trim(p_evidence)) NOT BETWEEN 2 AND 200
 OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 2 AND 400
 THEN RAISE EXCEPTION '下游纠错独立核查资料不完整' USING ERRCODE='23514'; END IF;
 SELECT * INTO old FROM ms.lead_student_downstream_correction_decisions
 WHERE reviewer_id=reviewer AND request_key=p_key;
 IF FOUND THEN
  IF old.case_id=p_case AND old.decision=p_decision
   AND old.evidence_ref=p_evidence AND old.reason_zh=p_reason
  THEN RETURN CASE WHEN p_decision='hold_active'
    THEN '已确认跨模块保护，错误学生关联尚未撤回'
    ELSE '已驳回此纠错保护申请，原业务记录未改变' END; END IF;
  RAISE EXCEPTION '主管决定操作编号冲突' USING ERRCODE='23505'; END IF;
 SELECT * INTO c FROM ms.lead_student_downstream_correction_cases
 WHERE id=p_case AND organization_id=org FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '本机构无此纠错案件' USING ERRCODE='42501'; END IF;
 IF c.status<>'pending' THEN RAISE EXCEPTION '该案件已完成独立复核'
 USING ERRCODE='23505'; END IF;
 IF c.requested_by=reviewer THEN RAISE EXCEPTION '申请人不得自行审批'
 USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM ms.user_role_grants g
  JOIN ms.role_templates t ON t.id=g.role_id
  JOIN ms.staff_users s ON s.id=g.user_id
  WHERE g.user_id=reviewer AND g.revoked_at IS NULL AND g.valid_from<=now()
   AND t.organization_id=org AND s.status='active' AND s.organization_id=org
   AND t.role_code IN('sales_manager','super_admin'))
 THEN RAISE EXCEPTION '缺少本机构独立主管复核资格'
 USING ERRCODE='42501'; END IF;
 SELECT owner_user_id INTO lead_owner FROM ms.leads
 WHERE id=c.lead_id AND organization_id=org FOR UPDATE;
 IF NOT FOUND OR lead_owner IS DISTINCT FROM c.requested_by THEN
  RAISE EXCEPTION '当前线索负责人已变更，不可直接批准'
  USING ERRCODE='23514'; END IF;
 IF p_decision='hold_active' THEN
  IF NOT EXISTS(SELECT 1 FROM ms.opportunities
    WHERE originating_lead_id=c.lead_id AND student_id=c.student_id)
  THEN RAISE EXCEPTION '下游商机已变化，需重新核查影响范围'
    USING ERRCODE='23514'; END IF;
 END IF;
 INSERT INTO ms.lead_student_downstream_correction_decisions(
  case_id,reviewer_id,decision,evidence_ref,reason_zh,request_key)
 VALUES(c.id,reviewer,p_decision,p_evidence,p_reason,p_key);
 UPDATE ms.lead_student_downstream_correction_cases
 SET status=p_decision,reviewed_by=reviewer,reviewed_at=now() WHERE id=c.id;
 output:=CASE WHEN p_decision='hold_active'
  THEN '已确认跨模块保护，错误学生关联尚未撤回'
  ELSE '已驳回此纠错保护申请，原业务记录未改变' END;
 INSERT INTO ms.audit_events(organization_id,actor_user_id,target_type,target_id,
 event_name,reason_zh,after_business_json)
 VALUES(org,reviewer,'lead',c.lead_id,'STUDENT_DOWNSTREAM_CORRECTION_REVIEWED',
  '主管确认或驳回下游销售保护；原商机、订单、财务与学生关联均未自动更改',
  jsonb_build_object('结果',output,
   '资金与合同','未触碰','错误关联','仍需后续跨模块纠错流程'));
 RETURN output;
END $f$;

-- Serialize sales workflow changes against case creation using a lead KEY SHARE
-- lock. A request holds the same lead FOR UPDATE until the hold row is committed.
CREATE FUNCTION ms.student_downstream_pair_on_hold(p_lead uuid,p_student uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ms AS $f$
BEGIN
 IF p_lead IS NULL OR p_student IS NULL THEN RETURN false; END IF;
 PERFORM 1 FROM ms.leads WHERE id=p_lead FOR KEY SHARE;
 RETURN EXISTS(SELECT 1 FROM ms.lead_student_downstream_correction_cases c
  WHERE c.lead_id=p_lead AND c.student_id=p_student
    AND c.status IN('pending','hold_active'));
END $f$;
REVOKE ALL ON FUNCTION ms.student_downstream_pair_on_hold(uuid,uuid) FROM PUBLIC;

-- Guard only sales progression, not authoritative payment/refund receipt ingestion.
-- Guard direct opportunity, quote, line item, discount, order and trial writes.
-- Existing financial projections, payment state and teacher attendance are NOT
-- silently discarded; later reconciliation must account for these records.
CREATE FUNCTION ms.guard_downstream_student_correction_hold()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ms AS $f$
DECLARE src jsonb; opportunity_id uuid;lead_id uuid;student_id uuid;
 quote_id uuid;order_id uuid;trial_id uuid;n integer;
BEGIN
 FOR n IN 1..2 LOOP
  IF n=1 THEN
   IF TG_OP='INSERT' THEN CONTINUE; END IF;
   src:=to_jsonb(OLD);
  ELSE
   IF TG_OP='DELETE' THEN CONTINUE; END IF;
   src:=to_jsonb(NEW);
  END IF;
  lead_id:=NULL;student_id:=NULL;opportunity_id:=NULL;
  IF TG_TABLE_NAME='opportunities' THEN
   lead_id:=NULLIF(src->>'originating_lead_id','')::uuid;
   student_id:=NULLIF(src->>'student_id','')::uuid;
  ELSE
   IF TG_TABLE_NAME IN('quotes','sales_orders','trial_bookings','sales_tasks') THEN
    opportunity_id:=NULLIF(src->>'opportunity_id','')::uuid;
   ELSIF TG_TABLE_NAME IN('quote_items','discount_approvals') THEN
    quote_id:=NULLIF(src->>'quote_id','')::uuid;
    SELECT opportunity_id INTO opportunity_id FROM ms.quotes WHERE id=quote_id;
   ELSIF TG_TABLE_NAME='sales_order_items' THEN
    order_id:=NULLIF(src->>'order_id','')::uuid;
    SELECT opportunity_id INTO opportunity_id FROM ms.sales_orders WHERE id=order_id;
   END IF;
   IF opportunity_id IS NOT NULL THEN
    SELECT originating_lead_id,student_id INTO lead_id,student_id
    FROM ms.opportunities WHERE id=opportunity_id;
   END IF;
  END IF;
  IF ms.student_downstream_pair_on_hold(lead_id,student_id) THEN
   RAISE EXCEPTION '该学生关联的下游商机已进入纠错保护，禁止继续销售推进；财务原始记录保持'
    USING ERRCODE='23514';
  END IF;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION ms.guard_downstream_student_correction_hold() FROM PUBLIC;
CREATE TRIGGER student_correction_guard_opportunities
 BEFORE INSERT OR UPDATE OR DELETE ON ms.opportunities
 FOR EACH ROW EXECUTE FUNCTION ms.guard_downstream_student_correction_hold();
CREATE TRIGGER student_correction_guard_quotes
 BEFORE INSERT OR UPDATE OR DELETE ON ms.quotes
 FOR EACH ROW EXECUTE FUNCTION ms.guard_downstream_student_correction_hold();
CREATE TRIGGER student_correction_guard_quote_items
 BEFORE INSERT OR UPDATE OR DELETE ON ms.quote_items
 FOR EACH ROW EXECUTE FUNCTION ms.guard_downstream_student_correction_hold();
CREATE TRIGGER student_correction_guard_discounts
 BEFORE INSERT OR UPDATE OR DELETE ON ms.discount_approvals
 FOR EACH ROW EXECUTE FUNCTION ms.guard_downstream_student_correction_hold();
CREATE TRIGGER student_correction_guard_sales_orders
 BEFORE INSERT OR DELETE OR UPDATE OF student_id,opportunity_id,order_state,
  amount_due_cents,crm_fulfillment_state,quote_id,quote_version ON ms.sales_orders
 FOR EACH ROW EXECUTE FUNCTION ms.guard_downstream_student_correction_hold();
CREATE TRIGGER student_correction_guard_order_items
 BEFORE INSERT OR UPDATE OR DELETE ON ms.sales_order_items
 FOR EACH ROW EXECUTE FUNCTION ms.guard_downstream_student_correction_hold();
CREATE TRIGGER student_correction_guard_trial_bookings
 BEFORE INSERT OR DELETE OR UPDATE OF opportunity_id,student_id,booking_state,
  requested_slot_at,confirmed_slot_at ON ms.trial_bookings
 FOR EACH ROW EXECUTE FUNCTION ms.guard_downstream_student_correction_hold();
CREATE TRIGGER student_correction_guard_sales_tasks
 BEFORE INSERT OR DELETE OR UPDATE OF opportunity_id,student_id,task_state
 ON ms.sales_tasks FOR EACH ROW EXECUTE FUNCTION ms.guard_downstream_student_correction_hold();

REVOKE ALL ON FUNCTION
 ms.request_downstream_student_correction(uuid,text,text,text),
 ms.decide_downstream_student_correction(uuid,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
 ms.request_downstream_student_correction(uuid,text,text,text),
 ms.decide_downstream_student_correction(uuid,text,text,text,text) TO ms_scoped_lowrisk_writer;

COMMIT;
