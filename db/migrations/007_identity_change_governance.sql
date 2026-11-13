-- V3.2-04: isolated identity binding approval/revocation requests.
-- Never apply to an existing production CRM. Migration 007 depends on 001-006.
BEGIN;
CREATE TABLE ms.identity_change_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES ms.organizations(id),
  action TEXT NOT NULL CHECK (action IN ('bind','revoke')),
  target_staff_id UUID NOT NULL REFERENCES ms.staff_users(id),
  issuer TEXT NOT NULL CHECK (length(issuer) BETWEEN 9 AND 255 AND issuer LIKE 'https://%'),
  subject TEXT NOT NULL CHECK (length(trim(subject)) BETWEEN 1 AND 255),
  existing_binding_id UUID REFERENCES ms.staff_identity_bindings(id),
  requested_by UUID NOT NULL REFERENCES ms.staff_users(id),
  request_evidence_ref TEXT NOT NULL CHECK (length(trim(request_evidence_ref)) BETWEEN 1 AND 200),
  request_reason_zh TEXT NOT NULL CHECK (length(trim(request_reason_zh)) BETWEEN 1 AND 400),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  decided_by UUID REFERENCES ms.staff_users(id),
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((action='bind' AND existing_binding_id IS NULL)
      OR (action='revoke' AND existing_binding_id IS NOT NULL)),
  CHECK ((status='pending' AND decided_by IS NULL AND decided_at IS NULL)
      OR (status<>'pending' AND decided_by IS NOT NULL AND decided_at IS NOT NULL)),
  CHECK (decided_by IS NULL OR (decided_by<>requested_by AND decided_by<>target_staff_id))
);
CREATE UNIQUE INDEX uq_pending_external_identity_bind
  ON ms.identity_change_requests(issuer,subject)
  WHERE status='pending' AND action='bind';
CREATE UNIQUE INDEX uq_pending_external_identity_revoke
  ON ms.identity_change_requests(existing_binding_id)
  WHERE status='pending' AND action='revoke';
CREATE INDEX ix_identity_requests_org_created
  ON ms.identity_change_requests(organization_id,created_at DESC);

CREATE TABLE ms.identity_change_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL UNIQUE REFERENCES ms.identity_change_requests(id),
  reviewer_user_id UUID NOT NULL REFERENCES ms.staff_users(id),
  decision TEXT NOT NULL CHECK (decision IN ('approved','rejected')),
  review_evidence_ref TEXT NOT NULL CHECK (length(trim(review_evidence_ref)) BETWEEN 1 AND 200),
  reason_zh TEXT NOT NULL CHECK (length(trim(reason_zh)) BETWEEN 1 AND 400),
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE FUNCTION ms.guard_identity_change_decision() RETURNS trigger
LANGUAGE plpgsql AS $identity_decision$
DECLARE q ms.identity_change_requests%ROWTYPE;
BEGIN
  SELECT * INTO q FROM ms.identity_change_requests WHERE id=NEW.request_id FOR UPDATE;
  IF NOT FOUND OR q.status<>'pending' THEN
    RAISE EXCEPTION '身份变更申请不存在或已经决定' USING ERRCODE='23514';
  END IF;
  IF NEW.reviewer_user_id=q.requested_by OR NEW.reviewer_user_id=q.target_staff_id THEN
    RAISE EXCEPTION '申请人或绑定目标本人不得审批' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM ms.staff_users s
    JOIN ms.user_role_grants g ON g.user_id=s.id
    JOIN ms.role_templates r ON r.id=g.role_id
    WHERE s.id=NEW.reviewer_user_id AND s.organization_id=q.organization_id
      AND s.status='active' AND g.revoked_at IS NULL AND g.valid_from<=now()
      AND r.organization_id=q.organization_id
      AND r.role_code IN ('sales_manager','super_admin')
  ) THEN
    RAISE EXCEPTION '身份变更仅可由本机构有效独立主管审核'
      USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM ms.staff_users s
    WHERE s.id=q.target_staff_id AND s.organization_id=q.organization_id AND s.status='active'
  ) THEN
    RAISE EXCEPTION '绑定目标员工必须为本机构有效员工' USING ERRCODE='23514';
  END IF;
  IF q.action='revoke' AND NOT EXISTS (
    SELECT 1 FROM ms.staff_identity_bindings b
    WHERE b.id=q.existing_binding_id AND b.staff_user_id=q.target_staff_id
      AND b.issuer=q.issuer AND b.subject=q.subject AND b.revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION '待撤销身份关联已经改变，需要重新申请' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $identity_decision$;
CREATE TRIGGER trg_identity_change_decision
  BEFORE INSERT ON ms.identity_change_decisions
  FOR EACH ROW EXECUTE FUNCTION ms.guard_identity_change_decision();

CREATE FUNCTION ms.guard_identity_request_transition() RETURNS trigger
LANGUAGE plpgsql AS $identity_request$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION '身份审批申请不能删除' USING ERRCODE='23514';
  END IF;
  IF OLD.status<>'pending' OR NEW.status NOT IN ('approved','rejected') OR
     NEW.action IS DISTINCT FROM OLD.action OR
     NEW.organization_id IS DISTINCT FROM OLD.organization_id OR
     NEW.target_staff_id IS DISTINCT FROM OLD.target_staff_id OR
     NEW.issuer IS DISTINCT FROM OLD.issuer OR
     NEW.subject IS DISTINCT FROM OLD.subject OR
     NEW.existing_binding_id IS DISTINCT FROM OLD.existing_binding_id OR
     NEW.requested_by IS DISTINCT FROM OLD.requested_by OR
     NEW.request_evidence_ref IS DISTINCT FROM OLD.request_evidence_ref OR
     NEW.request_reason_zh IS DISTINCT FROM OLD.request_reason_zh OR
     NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION '申请详情不可修改，只允许一次合法审核决定'
      USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM ms.identity_change_decisions d WHERE d.request_id=NEW.id
      AND d.reviewer_user_id=NEW.decided_by
      AND d.decision=NEW.status
  ) THEN
    RAISE EXCEPTION '身份变更状态不能跳过独立审核' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $identity_request$;
CREATE TRIGGER trg_identity_request_transition
  BEFORE UPDATE OR DELETE ON ms.identity_change_requests
  FOR EACH ROW EXECUTE FUNCTION ms.guard_identity_request_transition();

CREATE FUNCTION ms.guard_identity_decision_immutable() RETURNS trigger
LANGUAGE plpgsql AS $identity_immutable$
BEGIN
  RAISE EXCEPTION '身份变更审核历史不能修改或删除' USING ERRCODE='23514';
END $identity_immutable$;
CREATE TRIGGER trg_identity_decision_no_mutation
  BEFORE UPDATE OR DELETE ON ms.identity_change_decisions
  FOR EACH ROW EXECUTE FUNCTION ms.guard_identity_decision_immutable();
COMMIT;
