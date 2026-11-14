-- V3.2-26: frozen proposal-only compensation scope and simulated external
-- evidence notes. NEVER grants actual execution or cross-system authority.
-- PostgreSQL16 disposable fictional environment; after migrations 001..028.
BEGIN;

-- Exhaustive linked-record inventory at the LOCAL database snapshot only.
-- It cannot prove external finance source or CRM teacher delivery state.
CREATE FUNCTION ms.cross_module_local_correction_scope(p_lead uuid,p_student uuid)
RETURNS TABLE(department text,record_type text,record_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,ms AS $f$
 SELECT DISTINCT x.department,x.record_type,x.record_id FROM (
 SELECT 'sales'::text AS department,'opportunity'::text AS record_type,o.id AS record_id
 FROM ms.opportunities o WHERE o.originating_lead_id=p_lead AND o.student_id=p_student
 UNION ALL SELECT 'sales','quote',q.id FROM ms.quotes q JOIN ms.opportunities o
 ON o.id=q.opportunity_id WHERE o.originating_lead_id=p_lead AND o.student_id=p_student
 UNION ALL SELECT 'sales','quote_item',qi.id FROM ms.quote_items qi
 JOIN ms.quotes q ON q.id=qi.quote_id JOIN ms.opportunities o ON o.id=q.opportunity_id
 WHERE o.originating_lead_id=p_lead AND o.student_id=p_student
 UNION ALL SELECT 'sales','discount_approval',d.id FROM ms.discount_approvals d
 JOIN ms.quotes q ON q.id=d.quote_id JOIN ms.opportunities o ON o.id=q.opportunity_id
 WHERE o.originating_lead_id=p_lead AND o.student_id=p_student
 UNION ALL SELECT 'sales','order',so.id FROM ms.sales_orders so JOIN ms.opportunities o
 ON o.id=so.opportunity_id WHERE o.originating_lead_id=p_lead AND o.student_id=p_student
 UNION ALL SELECT 'sales','order_item',si.id FROM ms.sales_order_items si
 JOIN ms.sales_orders so ON so.id=si.order_id JOIN ms.opportunities o ON o.id=so.opportunity_id
 WHERE o.originating_lead_id=p_lead AND o.student_id=p_student
 UNION ALL SELECT 'sales','sale_event',se.id FROM ms.sale_events se
 JOIN ms.sales_orders so ON so.id=se.order_id JOIN ms.opportunities o ON o.id=so.opportunity_id
 WHERE o.originating_lead_id=p_lead AND o.student_id=p_student
 UNION ALL SELECT 'sales','sales_credit',sc.id FROM ms.sales_credits sc
 JOIN ms.sale_events se ON se.id=sc.sale_event_id
 JOIN ms.sales_orders so ON so.id=se.order_id JOIN ms.opportunities o ON o.id=so.opportunity_id
 WHERE o.originating_lead_id=p_lead AND o.student_id=p_student
 UNION ALL SELECT 'sales','sales_credit_version',sv.id FROM ms.sales_credit_versions sv
 JOIN ms.sale_events se ON se.id=sv.sale_event_id
 JOIN ms.sales_orders so ON so.id=se.order_id JOIN ms.opportunities o ON o.id=so.opportunity_id
 WHERE o.originating_lead_id=p_lead AND o.student_id=p_student
 UNION ALL SELECT 'finance','payment_allocation',pa.id FROM ms.payment_allocations pa
 JOIN ms.sales_orders so ON so.id=pa.order_id JOIN ms.opportunities o ON o.id=so.opportunity_id
 WHERE o.originating_lead_id=p_lead AND o.student_id=p_student
 UNION ALL SELECT 'finance','payment_receipt',r.id FROM ms.payment_receipt_projections r
 JOIN ms.payment_allocations pa ON pa.receipt_id=r.id
 JOIN ms.sales_orders so ON so.id=pa.order_id JOIN ms.opportunities o ON o.id=so.opportunity_id
 WHERE o.originating_lead_id=p_lead AND o.student_id=p_student
 UNION ALL SELECT 'finance','payment_allocation_history',h.id FROM ms.payment_allocation_history h
 JOIN ms.sales_orders so ON so.id=h.order_id JOIN ms.opportunities o ON o.id=so.opportunity_id
 WHERE o.originating_lead_id=p_lead AND o.student_id=p_student
 UNION ALL SELECT 'finance','refund_allocation',ra.id FROM ms.refund_allocations ra
 JOIN ms.sales_orders so ON so.id=ra.order_id JOIN ms.opportunities o ON o.id=so.opportunity_id
 WHERE o.originating_lead_id=p_lead AND o.student_id=p_student
 UNION ALL SELECT 'finance','refund_projection',rp.id FROM ms.refund_projections rp
 JOIN ms.refund_allocations ra ON ra.refund_id=rp.id
 JOIN ms.sales_orders so ON so.id=ra.order_id JOIN ms.opportunities o ON o.id=so.opportunity_id
 WHERE o.originating_lead_id=p_lead AND o.student_id=p_student
 UNION ALL SELECT 'finance','refund_allocation_history',rh.id FROM ms.refund_allocation_history rh
 JOIN ms.sales_orders so ON so.id=rh.order_id JOIN ms.opportunities o ON o.id=so.opportunity_id
 WHERE o.originating_lead_id=p_lead AND o.student_id=p_student
 UNION ALL SELECT 'finance','finance_economic_event',fe.id FROM ms.finance_economic_events fe
 JOIN ms.payment_allocations pa ON pa.receipt_id=fe.original_receipt_id
 JOIN ms.sales_orders so ON so.id=pa.order_id JOIN ms.opportunities o ON o.id=so.opportunity_id
 WHERE o.originating_lead_id=p_lead AND o.student_id=p_student
 UNION ALL SELECT 'academic','trial_booking',tb.id FROM ms.trial_bookings tb
 JOIN ms.opportunities o ON o.id=tb.opportunity_id
 WHERE o.originating_lead_id=p_lead AND o.student_id=p_student
 UNION ALL SELECT 'academic','trial_feedback',tf.id FROM ms.trial_feedbacks tf
 JOIN ms.trial_bookings tb ON tb.id=tf.trial_booking_id
 JOIN ms.opportunities o ON o.id=tb.opportunity_id
 WHERE o.originating_lead_id=p_lead AND o.student_id=p_student
 UNION ALL SELECT 'academic','entitlement_link',e.id FROM ms.crm_entitlement_links e
 JOIN ms.sales_order_items si ON si.id=e.order_item_id
 JOIN ms.sales_orders so ON so.id=si.order_id JOIN ms.opportunities o ON o.id=so.opportunity_id
 WHERE o.originating_lead_id=p_lead AND o.student_id=p_student
 ) x
$f$;
REVOKE ALL ON FUNCTION ms.cross_module_local_correction_scope(uuid,uuid) FROM PUBLIC;

CREATE FUNCTION ms.cross_module_local_correction_fingerprint(p_lead uuid,p_student uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,ms AS $f$
 SELECT encode(sha256(convert_to(jsonb_build_object(
   'counts',ms.student_downstream_impact_counts(p_lead,p_student),
   'source_ids',(SELECT COALESCE(jsonb_agg(
      jsonb_build_object('d',s.department,'t',s.record_type,'id',s.record_id)
      ORDER BY s.department,s.record_type,s.record_id),'[]'::jsonb)
      FROM ms.cross_module_local_correction_scope(p_lead,p_student) s),
   'order_versions',(SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id',so.id,'version',so.version,'student',so.student_id,'amount',so.amount_due_cents,
      'order_state',so.order_state,'payment_state',so.payment_state,
      'fulfillment_state',so.crm_fulfillment_state) ORDER BY so.id),'[]'::jsonb)
      FROM ms.sales_orders so JOIN ms.opportunities o ON o.id=so.opportunity_id
      WHERE o.originating_lead_id=p_lead AND o.student_id=p_student),
   'payment_versions',(SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id',pa.id,'state',pa.allocation_state,'amount',pa.allocated_cents,
      'source_state',r.verification_state,'source_version',r.source_version,
      'source_revision',r.source_revision) ORDER BY pa.id),'[]'::jsonb)
      FROM ms.payment_allocations pa JOIN ms.payment_receipt_projections r ON r.id=pa.receipt_id
      JOIN ms.sales_orders so ON so.id=pa.order_id
      JOIN ms.opportunities o ON o.id=so.opportunity_id
      WHERE o.originating_lead_id=p_lead AND o.student_id=p_student),
   'refund_versions',(SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id',ra.id,'state',ra.allocation_state,'amount',ra.allocated_cents,
      'source_state',rp.verification_state,'source_revision',rp.source_revision) ORDER BY ra.id),'[]'::jsonb)
      FROM ms.refund_allocations ra JOIN ms.refund_projections rp ON rp.id=ra.refund_id
      JOIN ms.sales_orders so ON so.id=ra.order_id JOIN ms.opportunities o ON o.id=so.opportunity_id
      WHERE o.originating_lead_id=p_lead AND o.student_id=p_student),
   'crm_states',(SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id',e.id,'state',e.fulfillment_state,'source_version',e.source_version,
      'package_id',e.external_package_id) ORDER BY e.id),'[]'::jsonb)
      FROM ms.crm_entitlement_links e JOIN ms.sales_order_items si ON si.id=e.order_item_id
      JOIN ms.sales_orders so ON so.id=si.order_id JOIN ms.opportunities o ON o.id=so.opportunity_id
      WHERE o.originating_lead_id=p_lead AND o.student_id=p_student)
 )::text,'UTF8')),'hex')
$f$;
REVOKE ALL ON FUNCTION ms.cross_module_local_correction_fingerprint(uuid,uuid) FROM PUBLIC;

CREATE TABLE ms.cross_module_compensation_manifests(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES ms.organizations(id),
 case_id uuid NOT NULL REFERENCES ms.lead_student_downstream_correction_cases(id),
 plan_id uuid NOT NULL UNIQUE REFERENCES ms.cross_module_correction_plans(id),
 plan_version integer NOT NULL CHECK(plan_version>0),
 created_by uuid NOT NULL REFERENCES ms.staff_users(id),
 local_fingerprint text NOT NULL CHECK(local_fingerprint ~ '^[a-f0-9]{64}$'),
 impact_counts jsonb NOT NULL,
 description_zh text NOT NULL CHECK(length(trim(description_zh)) BETWEEN 2 AND 400),
 evidence_ref text NOT NULL CHECK(length(trim(evidence_ref)) BETWEEN 2 AND 200),
 request_key text NOT NULL CHECK(request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(created_by,request_key)
);
CREATE TABLE ms.cross_module_compensation_scope(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES ms.organizations(id),
 manifest_id uuid NOT NULL REFERENCES ms.cross_module_compensation_manifests(id),
 department text NOT NULL CHECK(department IN('sales','finance','academic')),
 record_type text NOT NULL,
 source_record_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(manifest_id,department,record_type,source_record_id)
);
CREATE TABLE ms.cross_module_compensation_items(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES ms.organizations(id),
 manifest_id uuid NOT NULL REFERENCES ms.cross_module_compensation_manifests(id),
 scope_id uuid NOT NULL UNIQUE REFERENCES ms.cross_module_compensation_scope(id),
 proposed_by uuid NOT NULL REFERENCES ms.staff_users(id),
 proposed_action text NOT NULL CHECK(proposed_action IN(
  'retain_and_review','sales_contract_review','sales_credit_review',
  'finance_allocation_review','finance_refund_review',
  'academic_entitlement_review','academic_attendance_review','no_local_fact_review')),
 evidence_ref text NOT NULL CHECK(length(trim(evidence_ref)) BETWEEN 2 AND 200),
 reason_zh text NOT NULL CHECK(length(trim(reason_zh)) BETWEEN 2 AND 400),
 request_key text NOT NULL CHECK(request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(proposed_by,request_key)
);
CREATE TABLE ms.cross_module_compensation_seals(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES ms.organizations(id),
 manifest_id uuid NOT NULL UNIQUE REFERENCES ms.cross_module_compensation_manifests(id),
 sealed_by uuid NOT NULL REFERENCES ms.staff_users(id),
 local_fingerprint text NOT NULL,
 coverage_count integer NOT NULL CHECK(coverage_count>=3),
 reason_zh text NOT NULL CHECK(length(trim(reason_zh)) BETWEEN 2 AND 400),
 request_key text NOT NULL CHECK(request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
 sealed_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(sealed_by,request_key)
);
-- These are MANUAL REFERENCES, not authenticated finance/CRM receipts.
-- No value can denote that real money moved or tuition hours were changed.
CREATE TABLE ms.cross_module_external_evidence_notes(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES ms.organizations(id),
 manifest_id uuid NOT NULL REFERENCES ms.cross_module_compensation_manifests(id),
 department text NOT NULL CHECK(department IN('finance','academic')),
 note_kind text NOT NULL CHECK(note_kind IN(
   'source_not_connected','manual_reference_only','result_unknown')),
 noted_by uuid NOT NULL REFERENCES ms.staff_users(id),
 evidence_ref text NOT NULL CHECK(length(trim(evidence_ref)) BETWEEN 2 AND 200),
 source_revision_ref text NOT NULL CHECK(length(trim(source_revision_ref)) BETWEEN 2 AND 200),
 reason_zh text NOT NULL CHECK(length(trim(reason_zh)) BETWEEN 2 AND 400),
 request_key text NOT NULL CHECK(request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
 noted_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(manifest_id,department),
 UNIQUE(manifest_id,noted_by),
 UNIQUE(noted_by,request_key)
);
CREATE TABLE ms.cross_module_execution_preflight_blocks(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES ms.organizations(id),
 manifest_id uuid NOT NULL UNIQUE REFERENCES ms.cross_module_compensation_manifests(id),
 checked_by uuid NOT NULL REFERENCES ms.staff_users(id),
 local_fingerprint text NOT NULL,
 status text NOT NULL DEFAULT 'blocked_external_authority'
    CHECK(status='blocked_external_authority'),
 external_finance_verified boolean NOT NULL DEFAULT false CHECK(NOT external_finance_verified),
 external_academic_verified boolean NOT NULL DEFAULT false CHECK(NOT external_academic_verified),
 execution_allowed boolean NOT NULL DEFAULT false CHECK(NOT execution_allowed),
 release_allowed boolean NOT NULL DEFAULT false CHECK(NOT release_allowed),
 reason_zh text NOT NULL CHECK(length(trim(reason_zh)) BETWEEN 2 AND 400),
 request_key text NOT NULL CHECK(request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
 checked_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(checked_by,request_key)
);
ALTER TABLE ms.cross_module_compensation_manifests ENABLE ROW LEVEL SECURITY;
ALTER TABLE ms.cross_module_compensation_scope ENABLE ROW LEVEL SECURITY;
ALTER TABLE ms.cross_module_compensation_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE ms.cross_module_compensation_seals ENABLE ROW LEVEL SECURITY;
ALTER TABLE ms.cross_module_external_evidence_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE ms.cross_module_execution_preflight_blocks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON
 ms.cross_module_compensation_manifests,ms.cross_module_compensation_scope,
 ms.cross_module_compensation_items,ms.cross_module_compensation_seals,
 ms.cross_module_external_evidence_notes,ms.cross_module_execution_preflight_blocks
 FROM PUBLIC,ms_lowrisk_runtime,ms_scoped_lowrisk_writer,
 ms_cross_module_plan_writer,ms_cross_module_plan_reader;
CREATE TRIGGER immutable_compensation_manifest BEFORE UPDATE OR DELETE
 ON ms.cross_module_compensation_manifests FOR EACH ROW EXECUTE FUNCTION ms.reject_access_history_mutation();
CREATE TRIGGER immutable_compensation_scope BEFORE UPDATE OR DELETE
 ON ms.cross_module_compensation_scope FOR EACH ROW EXECUTE FUNCTION ms.reject_access_history_mutation();
CREATE TRIGGER immutable_compensation_item BEFORE UPDATE OR DELETE
 ON ms.cross_module_compensation_items FOR EACH ROW EXECUTE FUNCTION ms.reject_access_history_mutation();
CREATE TRIGGER immutable_compensation_seal BEFORE UPDATE OR DELETE
 ON ms.cross_module_compensation_seals FOR EACH ROW EXECUTE FUNCTION ms.reject_access_history_mutation();
CREATE TRIGGER immutable_external_evidence_note BEFORE UPDATE OR DELETE
 ON ms.cross_module_external_evidence_notes FOR EACH ROW EXECUTE FUNCTION ms.reject_access_history_mutation();
CREATE TRIGGER immutable_execution_preflight_block BEFORE UPDATE OR DELETE
 ON ms.cross_module_execution_preflight_blocks FOR EACH ROW EXECUTE FUNCTION ms.reject_access_history_mutation();

-- All plan signers must STILL be qualified, distinct, same current plan
-- version and independently approved. No client can assign a role.
CREATE FUNCTION ms.assert_current_three_party_correction_plan(
 p_plan uuid,p_org uuid,p_case uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ms AS $f$
DECLARE p ms.cross_module_correction_plans%ROWTYPE;
 c ms.lead_student_downstream_correction_cases%ROWTYPE;
 signer RECORD;
 BEGIN
 SELECT * INTO p FROM ms.cross_module_correction_plans
 WHERE id=p_plan AND organization_id=p_org AND case_id=p_case;
 SELECT * INTO c FROM ms.lead_student_downstream_correction_cases
 WHERE id=p_case AND organization_id=p_org;
 IF NOT FOUND OR c.status<>'hold_active' OR p.id IS NULL
  OR p.version_no<>(SELECT max(q.version_no) FROM ms.cross_module_correction_plans q WHERE q.case_id=p_case)
  OR p.original_student_id<>c.student_id OR
  (SELECT count(*) FROM ms.cross_module_correction_signoffs s WHERE s.plan_id=p.id AND s.decision='approved')<>3
  OR EXISTS(SELECT 1 FROM ms.cross_module_correction_signoffs s WHERE s.plan_id=p.id AND s.decision<>'approved')
  OR (SELECT count(DISTINCT s.signed_by) FROM ms.cross_module_correction_signoffs s WHERE s.plan_id=p.id)<>3
 THEN RAISE EXCEPTION '三方最新版本未全数有效批准或原隔离已变化'
 USING ERRCODE='23514'; END IF;
 FOR signer IN SELECT s.signed_by,s.department FROM ms.cross_module_correction_signoffs s
  WHERE s.plan_id=p.id LOOP
  PERFORM ms.assert_cross_module_department_authority(signer.signed_by,p_org,signer.department);
 END LOOP;
END $f$;
REVOKE ALL ON FUNCTION ms.assert_current_three_party_correction_plan(uuid,uuid,uuid) FROM PUBLIC;

CREATE FUNCTION ms.propose_cross_module_compensation_manifest(
 p_plan uuid,p_description text,p_evidence text,p_key text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ms AS $f$
DECLARE actor uuid;org uuid;p ms.cross_module_correction_plans%ROWTYPE;
 c ms.lead_student_downstream_correction_cases%ROWTYPE;
 old ms.cross_module_compensation_manifests%ROWTYPE;
 mid uuid;v_count integer;
BEGIN
 SELECT staff_id,org_id INTO actor,org FROM ms.access_actor();
 IF actor IS NULL THEN RAISE EXCEPTION '身份未获许可' USING ERRCODE='42501'; END IF;
 IF p_plan IS NULL OR p_description IS NULL OR length(trim(p_description)) NOT BETWEEN 2 AND 400
  OR p_evidence IS NULL OR length(trim(p_evidence)) NOT BETWEEN 2 AND 200
  OR p_key IS NULL OR p_key !~ '^[A-Za-z0-9_-]{16,128}$'
 THEN RAISE EXCEPTION '补偿清单申请材料不全' USING ERRCODE='23514'; END IF;
 SELECT * INTO p FROM ms.cross_module_correction_plans
 WHERE id=p_plan AND organization_id=org;
 IF NOT FOUND THEN RAISE EXCEPTION '本机构无此方案' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM ms.lead_student_downstream_correction_cases
 WHERE id=p.case_id AND organization_id=org FOR UPDATE;
 IF NOT FOUND OR c.status<>'hold_active' OR p.proposed_by<>actor OR c.requested_by<>actor
 THEN RAISE EXCEPTION '只有原申请人可登记本机构隔离纠错清单' USING ERRCODE='42501'; END IF;
 SELECT * INTO old FROM ms.cross_module_compensation_manifests
 WHERE created_by=actor AND request_key=p_key;
 IF FOUND THEN
  IF old.plan_id=p_plan AND old.description_zh=p_description AND old.evidence_ref=p_evidence
  THEN RETURN old.id; END IF;
  RAISE EXCEPTION '补偿清单防重复编号冲突' USING ERRCODE='23505'; END IF;
 PERFORM ms.assert_current_three_party_correction_plan(p.id,org,c.id);
 IF EXISTS(SELECT 1 FROM ms.cross_module_compensation_manifests WHERE plan_id=p.id)
 THEN RAISE EXCEPTION '同版本方案已有不可变补偿清单，需要新的方案版本'
 USING ERRCODE='23505'; END IF;
 IF ms.student_downstream_impact_counts(c.lead_id,c.student_id)<>p.impact_snapshot
 THEN RAISE EXCEPTION '下游事实新增或变化，需重新提交三方方案'
 USING ERRCODE='23514'; END IF;
 INSERT INTO ms.cross_module_compensation_manifests(
  organization_id,case_id,plan_id,plan_version,created_by,
  local_fingerprint,impact_counts,description_zh,evidence_ref,request_key)
 VALUES(org,c.id,p.id,p.version_no,actor,
  ms.cross_module_local_correction_fingerprint(c.lead_id,c.student_id),
  ms.student_downstream_impact_counts(c.lead_id,c.student_id),
  p_description,p_evidence,p_key) RETURNING id INTO mid;
 INSERT INTO ms.cross_module_compensation_scope(
  organization_id,manifest_id,department,record_type,source_record_id)
 SELECT org,mid,z.department,z.record_type,z.record_id
 FROM ms.cross_module_local_correction_scope(c.lead_id,c.student_id) z;
 -- Even no linked finance or CRM record must receive explicit departmental
 -- NO-LOCAL-FACT review; lack of link is NOT verified nonexistence externally.
 INSERT INTO ms.cross_module_compensation_scope(
  organization_id,manifest_id,department,record_type,source_record_id)
 SELECT org,mid,d.department,'no_linked_record',c.id
 FROM (VALUES('sales'),('finance'),('academic')) d(department)
 WHERE NOT EXISTS(SELECT 1 FROM ms.cross_module_compensation_scope s
  WHERE s.manifest_id=mid AND s.department=d.department);
 SELECT count(*) INTO v_count FROM ms.cross_module_compensation_scope WHERE manifest_id=mid;
 INSERT INTO ms.audit_events(organization_id,actor_user_id,target_type,target_id,
  event_name,reason_zh,after_business_json)
 VALUES(org,actor,'lead',c.lead_id,'CROSS_MODULE_COMPENSATION_MANIFEST_PROPOSED',
  '已按本地关联事实形成补偿拟议清单；外部资金与课时权威尚未核实',
  jsonb_build_object('待复核对象数量',v_count,'纠错执行','未授权','隔离','继续'));
 RETURN mid;
END $f$;

CREATE FUNCTION ms.propose_cross_module_compensation_item(
 p_manifest uuid,p_scope uuid,p_action text,p_evidence text,p_reason text,p_key text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ms AS $f$
DECLARE actor uuid;org uuid;m ms.cross_module_compensation_manifests%ROWTYPE;
 c ms.lead_student_downstream_correction_cases%ROWTYPE;
 sc ms.cross_module_compensation_scope%ROWTYPE;
 old ms.cross_module_compensation_items%ROWTYPE;rid uuid;
BEGIN
 SELECT staff_id,org_id INTO actor,org FROM ms.access_actor();
 IF actor IS NULL THEN RAISE EXCEPTION '员工身份失效' USING ERRCODE='42501'; END IF;
 IF p_manifest IS NULL OR p_scope IS NULL OR
 p_action NOT IN('retain_and_review','sales_contract_review','sales_credit_review',
   'finance_allocation_review','finance_refund_review',
   'academic_entitlement_review','academic_attendance_review','no_local_fact_review')
 OR p_evidence IS NULL OR length(trim(p_evidence)) NOT BETWEEN 2 AND 200
 OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 2 AND 400
 OR p_key IS NULL OR p_key !~ '^[A-Za-z0-9_-]{16,128}$'
 THEN RAISE EXCEPTION '补偿拟议动作资料不完整' USING ERRCODE='23514'; END IF;
 SELECT * INTO m FROM ms.cross_module_compensation_manifests
 WHERE id=p_manifest AND organization_id=org;
 IF NOT FOUND THEN RAISE EXCEPTION '本机构不存在该清单' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM ms.lead_student_downstream_correction_cases
 WHERE id=m.case_id AND organization_id=org FOR UPDATE;
 IF c.status<>'hold_active' OR actor<>m.created_by THEN
 RAISE EXCEPTION '只有原申请人可对仍隔离的清单提出明细' USING ERRCODE='42501'; END IF;
 SELECT * INTO old FROM ms.cross_module_compensation_items WHERE
 proposed_by=actor AND request_key=p_key;
 IF FOUND THEN
  IF old.manifest_id=p_manifest AND old.scope_id=p_scope AND old.proposed_action=p_action
    AND old.evidence_ref=p_evidence AND old.reason_zh=p_reason
  THEN RETURN old.id; END IF;
  RAISE EXCEPTION '补偿明细操作编号冲突' USING ERRCODE='23505'; END IF;
 PERFORM ms.assert_current_three_party_correction_plan(m.plan_id,org,c.id);
 IF EXISTS(SELECT 1 FROM ms.cross_module_compensation_seals s WHERE s.manifest_id=m.id)
 THEN RAISE EXCEPTION '清单已封存，不得增补；需新版本方案'
 USING ERRCODE='23514'; END IF;
 SELECT * INTO sc FROM ms.cross_module_compensation_scope
 WHERE id=p_scope AND manifest_id=m.id AND organization_id=org;
 IF NOT FOUND THEN RAISE EXCEPTION '明细不是当前清单的已清查业务对象'
 USING ERRCODE='42501'; END IF;
 IF (sc.record_type='no_linked_record' AND p_action<>'no_local_fact_review')
 OR (sc.record_type<>'no_linked_record' AND p_action='no_local_fact_review')
 OR (sc.department='sales' AND p_action NOT IN(
    'retain_and_review','sales_contract_review','sales_credit_review','no_local_fact_review'))
 OR (sc.department='finance' AND p_action NOT IN(
    'retain_and_review','finance_allocation_review','finance_refund_review','no_local_fact_review'))
 OR (sc.department='academic' AND p_action NOT IN(
    'retain_and_review','academic_entitlement_review','academic_attendance_review','no_local_fact_review'))
 THEN RAISE EXCEPTION '该部门不得拟议此种补偿动作'
 USING ERRCODE='23514'; END IF;
 INSERT INTO ms.cross_module_compensation_items(
  organization_id,manifest_id,scope_id,proposed_by,proposed_action,evidence_ref,reason_zh,request_key)
 VALUES(org,m.id,sc.id,actor,p_action,p_evidence,p_reason,p_key)
 RETURNING id INTO rid;
 RETURN rid;
END $f$;

CREATE FUNCTION ms.seal_cross_module_compensation_manifest(
 p_manifest uuid,p_reason text,p_key text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ms AS $f$
DECLARE actor uuid;org uuid;m ms.cross_module_compensation_manifests%ROWTYPE;
 c ms.lead_student_downstream_correction_cases%ROWTYPE;
 old ms.cross_module_compensation_seals%ROWTYPE;rid uuid;scope_total integer;item_total integer;
BEGIN
 SELECT staff_id,org_id INTO actor,org FROM ms.access_actor();
 IF actor IS NULL THEN RAISE EXCEPTION '员工账号不可用' USING ERRCODE='42501'; END IF;
 IF p_manifest IS NULL OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 2 AND 400
 OR p_key IS NULL OR p_key !~ '^[A-Za-z0-9_-]{16,128}$'
 THEN RAISE EXCEPTION '清单封存材料不完整' USING ERRCODE='23514'; END IF;
 SELECT * INTO m FROM ms.cross_module_compensation_manifests
 WHERE id=p_manifest AND organization_id=org;
 IF NOT FOUND THEN RAISE EXCEPTION '本机构不存在该清单' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM ms.lead_student_downstream_correction_cases
 WHERE id=m.case_id AND organization_id=org FOR UPDATE;
 IF actor<>m.created_by OR c.status<>'hold_active'
 THEN RAISE EXCEPTION '清单封存仅允许原申请人且必须仍在隔离'
 USING ERRCODE='42501'; END IF;
 SELECT * INTO old FROM ms.cross_module_compensation_seals
 WHERE sealed_by=actor AND request_key=p_key;
 IF FOUND THEN
  IF old.manifest_id=p_manifest AND old.reason_zh=p_reason THEN RETURN old.id; END IF;
  RAISE EXCEPTION '封存编号对应另一项操作' USING ERRCODE='23505'; END IF;
 PERFORM ms.assert_current_three_party_correction_plan(m.plan_id,org,c.id);
 IF EXISTS(SELECT 1 FROM ms.cross_module_compensation_seals s WHERE s.manifest_id=m.id)
 THEN RAISE EXCEPTION '清单已封存，不允许重复封存' USING ERRCODE='23505'; END IF;
 SELECT count(*) INTO scope_total FROM ms.cross_module_compensation_scope WHERE manifest_id=m.id;
 SELECT count(*) INTO item_total FROM ms.cross_module_compensation_items WHERE manifest_id=m.id;
 IF scope_total<3 OR item_total<>scope_total
 OR ms.cross_module_local_correction_fingerprint(c.lead_id,c.student_id)<>m.local_fingerprint
 THEN RAISE EXCEPTION '补偿范围尚未全部逐项覆盖，或下游事实已经变化'
 USING ERRCODE='23514'; END IF;
 INSERT INTO ms.cross_module_compensation_seals(organization_id,manifest_id,sealed_by,
 local_fingerprint,coverage_count,reason_zh,request_key)
 VALUES(org,m.id,actor,m.local_fingerprint,item_total,p_reason,p_key) RETURNING id INTO rid;
 INSERT INTO ms.audit_events(organization_id,actor_user_id,target_type,target_id,
 event_name,reason_zh,after_business_json)
 VALUES(org,actor,'lead',c.lead_id,'CROSS_MODULE_COMPENSATION_MANIFEST_SEALED',
  '本地补偿拟议对象已逐项登记并封存；不代表权威对账通过或授权实际纠错',
  jsonb_build_object('逐项覆盖数量',item_total,'执行授权','尚无','资金和课时','未改动'));
 RETURN rid;
END $f$;

CREATE FUNCTION ms.note_cross_module_external_evidence(
 p_manifest uuid,p_department text,p_kind text,p_evidence text,
 p_revision text,p_reason text,p_key text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ms AS $f$
DECLARE actor uuid;org uuid;m ms.cross_module_compensation_manifests%ROWTYPE;
 c ms.lead_student_downstream_correction_cases%ROWTYPE;
 old ms.cross_module_external_evidence_notes%ROWTYPE;rid uuid;
BEGIN
 SELECT staff_id,org_id INTO actor,org FROM ms.access_actor();
 IF actor IS NULL THEN RAISE EXCEPTION '员工身份无效' USING ERRCODE='42501'; END IF;
 IF p_manifest IS NULL OR p_department NOT IN('finance','academic')
 OR p_kind NOT IN('source_not_connected','manual_reference_only','result_unknown')
 OR p_evidence IS NULL OR length(trim(p_evidence)) NOT BETWEEN 2 AND 200
 OR p_revision IS NULL OR length(trim(p_revision)) NOT BETWEEN 2 AND 200
 OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 2 AND 400
 OR p_key IS NULL OR p_key !~ '^[A-Za-z0-9_-]{16,128}$'
 THEN RAISE EXCEPTION '外部来源人工记录资料不完整' USING ERRCODE='23514'; END IF;
 PERFORM ms.assert_cross_module_department_authority(actor,org,p_department);
 SELECT * INTO m FROM ms.cross_module_compensation_manifests
 WHERE id=p_manifest AND organization_id=org;
 IF NOT FOUND THEN RAISE EXCEPTION '本机构没有该补偿清单' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM ms.lead_student_downstream_correction_cases
 WHERE id=m.case_id AND organization_id=org FOR UPDATE;
 IF c.status<>'hold_active' OR actor=m.created_by
 THEN RAISE EXCEPTION '隔离状态或审核人身份不符合要求' USING ERRCODE='42501'; END IF;
 SELECT * INTO old FROM ms.cross_module_external_evidence_notes
 WHERE noted_by=actor AND request_key=p_key;
 IF FOUND THEN
  IF old.manifest_id=p_manifest AND old.department=p_department AND old.note_kind=p_kind
   AND old.evidence_ref=p_evidence AND old.source_revision_ref=p_revision
   AND old.reason_zh=p_reason THEN RETURN old.id; END IF;
  RAISE EXCEPTION '人工证据备注编号冲突' USING ERRCODE='23505'; END IF;
 PERFORM ms.assert_current_three_party_correction_plan(m.plan_id,org,c.id);
 IF NOT EXISTS(SELECT 1 FROM ms.cross_module_compensation_seals s
 WHERE s.manifest_id=m.id) THEN
  RAISE EXCEPTION '补偿对象清单尚未封存' USING ERRCODE='23514'; END IF;
 IF ms.cross_module_local_correction_fingerprint(c.lead_id,c.student_id)<>m.local_fingerprint
 THEN RAISE EXCEPTION '本地影响范围发生变化，必须重新核对'
 USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM ms.cross_module_external_evidence_notes n
 WHERE n.manifest_id=m.id AND (n.department=p_department OR n.noted_by=actor))
 THEN RAISE EXCEPTION '每部门一次独立人工记录，不可兼任' USING ERRCODE='23505'; END IF;
 INSERT INTO ms.cross_module_external_evidence_notes(
  organization_id,manifest_id,department,note_kind,noted_by,
  evidence_ref,source_revision_ref,reason_zh,request_key)
 VALUES(org,m.id,p_department,p_kind,actor,p_evidence,p_revision,p_reason,p_key)
 RETURNING id INTO rid;
 INSERT INTO ms.audit_events(organization_id,actor_user_id,target_type,target_id,
  event_name,reason_zh,after_business_json)
 VALUES(org,actor,'lead',c.lead_id,'CROSS_MODULE_EXTERNAL_REFERENCE_RECORDED',
  '部门登记了外部来源的人工参考或未知结果；不属于已验证的资金和课时回执',
  jsonb_build_object('部门',CASE WHEN p_department='finance' THEN '财务' ELSE '教务' END,
   '来源状态','尚无经验证的权威执行回执','执行','未发生'));
 RETURN rid;
END $f$;

-- Only a fresh independent sales manager records the permanently BLOCKED
-- preflight. It cannot grant rights, dispatch, create orders, move funds,
-- alter CRM hours or change case hold status.
CREATE FUNCTION ms.record_cross_module_blocked_preflight(
 p_manifest uuid,p_reason text,p_key text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ms AS $f$
DECLARE actor uuid;org uuid;m ms.cross_module_compensation_manifests%ROWTYPE;
 c ms.lead_student_downstream_correction_cases%ROWTYPE;
 old ms.cross_module_execution_preflight_blocks%ROWTYPE;
 plan_sales_reviewer uuid;rid uuid;
BEGIN
 SELECT staff_id,org_id INTO actor,org FROM ms.access_actor();
 IF actor IS NULL THEN RAISE EXCEPTION '员工身份无效' USING ERRCODE='42501'; END IF;
 IF p_manifest IS NULL OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 2 AND 400
 OR p_key IS NULL OR p_key !~ '^[A-Za-z0-9_-]{16,128}$'
 THEN RAISE EXCEPTION '隔离预审说明不完整' USING ERRCODE='23514'; END IF;
 PERFORM ms.assert_cross_module_department_authority(actor,org,'sales');
 SELECT * INTO m FROM ms.cross_module_compensation_manifests
 WHERE id=p_manifest AND organization_id=org;
 IF NOT FOUND THEN RAISE EXCEPTION '本机构不存在此补偿清单' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM ms.lead_student_downstream_correction_cases
 WHERE id=m.case_id AND organization_id=org FOR UPDATE;
 IF c.status<>'hold_active' OR actor=m.created_by
 THEN RAISE EXCEPTION '纠错隔离或独立复核条件不满足'
 USING ERRCODE='42501'; END IF;
 SELECT signed_by INTO plan_sales_reviewer FROM ms.cross_module_correction_signoffs
 WHERE plan_id=m.plan_id AND department='sales';
 IF actor=plan_sales_reviewer OR actor=c.reviewed_by OR actor IN(
  SELECT reviewed_by FROM ms.downstream_student_reconciliation_findings
  WHERE case_id=c.id)
 THEN RAISE EXCEPTION '最终隔离预审必须由未参加前序销售复核的独立主管记录'
 USING ERRCODE='42501'; END IF;
 SELECT * INTO old FROM ms.cross_module_execution_preflight_blocks
 WHERE checked_by=actor AND request_key=p_key;
 IF FOUND THEN
  IF old.manifest_id=p_manifest AND old.reason_zh=p_reason THEN RETURN old.id; END IF;
  RAISE EXCEPTION '预审编号冲突' USING ERRCODE='23505'; END IF;
 PERFORM ms.assert_current_three_party_correction_plan(m.plan_id,org,c.id);
 IF NOT EXISTS(SELECT 1 FROM ms.cross_module_compensation_seals s WHERE s.manifest_id=m.id)
 OR (SELECT count(*) FROM ms.cross_module_external_evidence_notes n
  WHERE n.manifest_id=m.id)<>2
 OR ms.cross_module_local_correction_fingerprint(c.lead_id,c.student_id)<>m.local_fingerprint
 THEN RAISE EXCEPTION '尚未完整封存、缺部门人工记录或本地影响发生变化'
 USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM ms.cross_module_execution_preflight_blocks b WHERE b.manifest_id=m.id)
 THEN RAISE EXCEPTION '已留存该版本不可变受阻预审结论' USING ERRCODE='23505'; END IF;
 INSERT INTO ms.cross_module_execution_preflight_blocks(
  organization_id,manifest_id,checked_by,local_fingerprint,reason_zh,request_key)
 VALUES(org,m.id,actor,m.local_fingerprint,p_reason,p_key) RETURNING id INTO rid;
 INSERT INTO ms.audit_events(organization_id,actor_user_id,target_type,target_id,
  event_name,reason_zh,after_business_json)
 VALUES(org,actor,'lead',c.lead_id,'CROSS_MODULE_EXECUTION_PREFLIGHT_BLOCKED',
  '已完成本地方案清单核对；财务和教务真实来源未接入，实际纠错执行与隔离解除继续禁止',
  jsonb_build_object('预审','本地核查完毕但外部权威未验证',
   '执行授权','不允许','解除隔离','不允许'));
 RETURN rid;
END $f$;

REVOKE ALL ON FUNCTION
 ms.propose_cross_module_compensation_manifest(uuid,text,text,text),
 ms.propose_cross_module_compensation_item(uuid,uuid,text,text,text,text),
 ms.seal_cross_module_compensation_manifest(uuid,text,text),
 ms.note_cross_module_external_evidence(uuid,text,text,text,text,text,text),
 ms.record_cross_module_blocked_preflight(uuid,text,text)
 FROM PUBLIC,ms_lowrisk_runtime,ms_scoped_lowrisk_writer;
GRANT EXECUTE ON FUNCTION
 ms.propose_cross_module_compensation_manifest(uuid,text,text,text),
 ms.propose_cross_module_compensation_item(uuid,uuid,text,text,text,text),
 ms.seal_cross_module_compensation_manifest(uuid,text,text),
 ms.note_cross_module_external_evidence(uuid,text,text,text,text,text,text),
 ms.record_cross_module_blocked_preflight(uuid,text,text)
 TO ms_cross_module_plan_writer;

CREATE VIEW ms.scoped_cross_module_compensation_status
WITH (security_barrier=true) AS
SELECT m.id AS manifest_id,m.case_id,m.plan_id,m.plan_version,
 c.status AS case_status,m.created_at,
 (SELECT count(*)::integer FROM ms.cross_module_compensation_scope s
   WHERE s.manifest_id=m.id) AS scope_count,
 (SELECT count(*)::integer FROM ms.cross_module_compensation_items i
   WHERE i.manifest_id=m.id) AS item_count,
 EXISTS(SELECT 1 FROM ms.cross_module_compensation_seals s
   WHERE s.manifest_id=m.id) AS local_scope_sealed,
 EXISTS(SELECT 1 FROM ms.cross_module_external_evidence_notes n
   WHERE n.manifest_id=m.id AND n.department='finance') AS finance_manual_note,
 EXISTS(SELECT 1 FROM ms.cross_module_external_evidence_notes n
   WHERE n.manifest_id=m.id AND n.department='academic') AS academic_manual_note,
 EXISTS(SELECT 1 FROM ms.cross_module_execution_preflight_blocks p
   WHERE p.manifest_id=m.id) AS blocked_preflight_recorded,
 FALSE AS external_finance_verified,FALSE AS external_academic_verified,
 FALSE AS execution_allowed,FALSE AS release_allowed
FROM ms.cross_module_compensation_manifests m
JOIN ms.lead_student_downstream_correction_cases c ON c.id=m.case_id
WHERE m.organization_id=ms.current_scoped_organization_id()
AND ms.current_scoped_staff_id() IS NOT NULL
AND (m.created_by=ms.current_scoped_staff_id()
 OR EXISTS(SELECT 1 FROM ms.user_role_grants g JOIN ms.role_templates t ON t.id=g.role_id
  WHERE g.user_id=ms.current_scoped_staff_id()
  AND t.organization_id=m.organization_id AND
   t.role_code IN('sales_manager','finance_correction_reviewer','academic_correction_reviewer')
  AND g.revoked_at IS NULL AND g.valid_from<=now()));
REVOKE ALL ON ms.scoped_cross_module_compensation_status FROM PUBLIC;
GRANT SELECT ON ms.scoped_cross_module_compensation_status TO ms_cross_module_plan_reader;
-- NO real execution authorization function exists in migration 029.
COMMIT;
