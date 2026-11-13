-- V3.2-04 isolation-only runtime privilege design.
-- Test in a NEW fictional PostgreSQL database; it does NOT configure
-- real production service users, passwords, RLS or cross-tenant DB policies.
BEGIN;
CREATE ROLE ms_lowrisk_runtime NOLOGIN;
GRANT USAGE ON SCHEMA ms TO ms_lowrisk_runtime;
GRANT SELECT ON
  ms.organizations,ms.staff_users,ms.role_templates,ms.user_role_grants,
  ms.data_scope_grants,ms.field_policies,ms.students,ms.contacts,
  ms.student_contacts,ms.contact_events,ms.marketing_channels,
  ms.leads,ms.lead_students,ms.opportunities,ms.interactions,
  ms.interaction_subjects,ms.family_groups,ms.family_memberships,
  ms.family_review_decisions,ms.staff_identity_bindings,
  ms.identity_change_requests,ms.identity_change_decisions,
  ms.audit_events,ms.api_write_receipts
TO ms_lowrisk_runtime;

GRANT INSERT ON
  ms.students,ms.contacts,ms.student_contacts,ms.contact_events,
  ms.leads,ms.lead_students,ms.opportunities,ms.interactions,
  ms.interaction_subjects,ms.family_groups,ms.family_memberships,
  ms.family_review_decisions,ms.audit_events,ms.api_write_receipts,
  ms.identity_change_requests,ms.identity_change_decisions
TO ms_lowrisk_runtime;
GRANT UPDATE(response_json) ON ms.api_write_receipts TO ms_lowrisk_runtime;
GRANT UPDATE(verification_state,verified_by,verified_at)
  ON ms.family_groups TO ms_lowrisk_runtime;
GRANT UPDATE(verified_by,verified_at)
  ON ms.family_memberships TO ms_lowrisk_runtime;
GRANT UPDATE(status,decided_by,decided_at)
  ON ms.identity_change_requests TO ms_lowrisk_runtime;

-- Approval-gated changes to the external identity binding table only.
ALTER TABLE ms.staff_identity_bindings
  ADD COLUMN approval_request_id UUID REFERENCES ms.identity_change_requests(id),
  ADD COLUMN revocation_request_id UUID REFERENCES ms.identity_change_requests(id);
GRANT INSERT(staff_user_id,issuer,subject,bound_by,approval_request_id)
  ON ms.staff_identity_bindings TO ms_lowrisk_runtime;
GRANT UPDATE(revoked_at,revocation_request_id)
  ON ms.staff_identity_bindings TO ms_lowrisk_runtime;

CREATE FUNCTION ms.guard_identity_binding_change() RETURNS trigger
LANGUAGE plpgsql AS $binding_gate$
DECLARE request_id UUID;
BEGIN
  -- Privileged migration owner retains legacy test-fixture import, but
  -- a dedicated runtime role cannot create or revoke without a decision.
  IF TG_OP='INSERT' THEN
    request_id:=NEW.approval_request_id;
    IF current_user='ms_lowrisk_runtime' AND request_id IS NULL THEN
      RAISE EXCEPTION '业务账户不得绕过身份绑定审批'
        USING ERRCODE='23514';
    END IF;
    IF request_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM ms.identity_change_requests q
      JOIN ms.identity_change_decisions d ON d.request_id=q.id
      WHERE q.id=request_id AND q.action='bind'
        AND d.decision='approved'
        AND q.target_staff_id=NEW.staff_user_id
        AND q.issuer=NEW.issuer AND q.subject=NEW.subject
    ) THEN
      RAISE EXCEPTION '身份绑定缺少匹配的已批准审核决定'
        USING ERRCODE='23514';
    END IF;
  ELSIF TG_OP='UPDATE' THEN
    IF NEW.staff_user_id IS DISTINCT FROM OLD.staff_user_id OR
       NEW.issuer IS DISTINCT FROM OLD.issuer OR
       NEW.subject IS DISTINCT FROM OLD.subject OR
       NEW.bound_by IS DISTINCT FROM OLD.bound_by OR
       NEW.approval_request_id IS DISTINCT FROM OLD.approval_request_id OR
       NEW.created_at IS DISTINCT FROM OLD.created_at OR
       OLD.revoked_at IS NOT NULL THEN
      RAISE EXCEPTION '已经创建的身份绑定不得改写或重新激活'
        USING ERRCODE='23514';
    END IF;
    IF OLD.revoked_at IS DISTINCT FROM NEW.revoked_at THEN
      request_id:=NEW.revocation_request_id;
      IF current_user='ms_lowrisk_runtime' AND request_id IS NULL THEN
        RAISE EXCEPTION '业务账户不得跳过身份撤销审批'
          USING ERRCODE='23514';
      END IF;
      IF request_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM ms.identity_change_requests q
        JOIN ms.identity_change_decisions d ON d.request_id=q.id
        WHERE q.id=request_id AND q.action='revoke'
          AND q.existing_binding_id=OLD.id AND q.target_staff_id=OLD.staff_user_id
          AND q.issuer=OLD.issuer AND q.subject=OLD.subject
          AND d.decision='approved'
      ) THEN
        RAISE EXCEPTION '外部身份撤销缺少匹配的独立审核'
          USING ERRCODE='23514';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $binding_gate$;
CREATE TRIGGER trg_identity_binding_approved_only
  BEFORE INSERT OR UPDATE ON ms.staff_identity_bindings
  FOR EACH ROW EXECUTE FUNCTION ms.guard_identity_binding_change();

-- This is an explicit deny-by-omission model:
-- NO grants on finance receipts, orders, refunds, SaleEvents or CRM entitlements.
-- NO UPDATE/DELETE on audit_events or the immutable reviewer decisions.
-- NO CREATE or DDL rights in the ms schema.
-- NO UPDATE on staff_users, role grants or staff role templates.
-- The database owner retains elevated powers; production deployment must
-- use a separate migration principal and a nonowner LOGIN granted this role.
COMMIT;
