-- V3.2-05 isolated defense in depth: real nonowner app login + scoped rows.
-- Tenant GUC is set only after server-side staff authentication, per transaction.
-- WARNING: custom PostgreSQL GUC is mutable by the DB role itself; this is NOT
-- independently secure against compromised arbitrary SQL. RLS is additional
-- protection for parameterized application routes, not production multitenancy.
BEGIN;
-- Fix 008 to apply approval checks to inherited low-risk runtime LOGIN roles,
-- not only to SET ROLE ms_lowrisk_runtime connections.
CREATE OR REPLACE FUNCTION ms.guard_identity_binding_change() RETURNS trigger
LANGUAGE plpgsql AS $binding_gate$
DECLARE v_request_id UUID;
BEGIN
  -- Privileged migration owner retains legacy test-fixture import, but
  -- a dedicated runtime role cannot create or revoke without a decision.
  IF TG_OP='INSERT' THEN
    v_request_id:=NEW.approval_request_id;
    IF pg_has_role(current_user,'ms_lowrisk_runtime','member') AND v_request_id IS NULL THEN
      RAISE EXCEPTION '业务账户不得绕过身份绑定审批'
        USING ERRCODE='23514';
    END IF;
    IF v_request_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM ms.identity_change_requests q
      JOIN ms.identity_change_decisions d ON d.request_id=q.id
      WHERE q.id=v_request_id AND q.action='bind'
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
      v_request_id:=NEW.revocation_request_id;
      IF pg_has_role(current_user,'ms_lowrisk_runtime','member') AND v_request_id IS NULL THEN
        RAISE EXCEPTION '业务账户不得跳过身份撤销审批'
          USING ERRCODE='23514';
      END IF;
      IF v_request_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM ms.identity_change_requests q
        JOIN ms.identity_change_decisions d ON d.request_id=q.id
        WHERE q.id=v_request_id AND q.action='revoke'
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

-- First wave of directly org-keyed core rows. Tables without org_id and
-- indirect children (family memberships, student_contacts, etc.) still need
-- complete isolation policies before any production deployment.
ALTER TABLE ms.students ENABLE ROW LEVEL SECURITY;
CREATE POLICY students_isolated_tenant ON ms.students
  FOR ALL TO ms_lowrisk_runtime
  USING (organization_id = NULLIF(current_setting('ms.tenant_org', true),'')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('ms.tenant_org', true),'')::uuid);

ALTER TABLE ms.contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY contacts_isolated_tenant ON ms.contacts
  FOR ALL TO ms_lowrisk_runtime
  USING (organization_id = NULLIF(current_setting('ms.tenant_org', true),'')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('ms.tenant_org', true),'')::uuid);

ALTER TABLE ms.contact_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY contact_events_isolated_tenant ON ms.contact_events
  FOR ALL TO ms_lowrisk_runtime
  USING (organization_id = NULLIF(current_setting('ms.tenant_org', true),'')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('ms.tenant_org', true),'')::uuid);

ALTER TABLE ms.leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY leads_isolated_tenant ON ms.leads
  FOR ALL TO ms_lowrisk_runtime
  USING (organization_id = NULLIF(current_setting('ms.tenant_org', true),'')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('ms.tenant_org', true),'')::uuid);

ALTER TABLE ms.family_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY family_groups_isolated_tenant ON ms.family_groups
  FOR ALL TO ms_lowrisk_runtime
  USING (organization_id = NULLIF(current_setting('ms.tenant_org', true),'')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('ms.tenant_org', true),'')::uuid);

ALTER TABLE ms.interactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY interactions_isolated_tenant ON ms.interactions
  FOR ALL TO ms_lowrisk_runtime
  USING (organization_id = NULLIF(current_setting('ms.tenant_org', true),'')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('ms.tenant_org', true),'')::uuid);

ALTER TABLE ms.audit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_events_isolated_tenant ON ms.audit_events
  FOR ALL TO ms_lowrisk_runtime
  USING (organization_id = NULLIF(current_setting('ms.tenant_org', true),'')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('ms.tenant_org', true),'')::uuid);

ALTER TABLE ms.api_write_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY api_write_receipts_isolated_tenant ON ms.api_write_receipts
  FOR ALL TO ms_lowrisk_runtime
  USING (organization_id = NULLIF(current_setting('ms.tenant_org', true),'')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('ms.tenant_org', true),'')::uuid);

ALTER TABLE ms.identity_change_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY identity_change_requests_isolated_tenant ON ms.identity_change_requests
  FOR ALL TO ms_lowrisk_runtime
  USING (organization_id = NULLIF(current_setting('ms.tenant_org', true),'')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('ms.tenant_org', true),'')::uuid);

-- Opportunities have no organization_id, derive tenant through an RLS-scoped
-- student row; no direct path to another tenant's opportunity.
ALTER TABLE ms.opportunities ENABLE ROW LEVEL SECURITY;
CREATE POLICY opportunities_isolated_tenant ON ms.opportunities
  FOR ALL TO ms_lowrisk_runtime
  USING (EXISTS (
    SELECT 1 FROM ms.students s
    WHERE s.id=student_id AND s.organization_id =
      NULLIF(current_setting('ms.tenant_org',true),'')::uuid))
  WITH CHECK (EXISTS (
    SELECT 1 FROM ms.students s
    WHERE s.id=student_id AND s.organization_id =
      NULLIF(current_setting('ms.tenant_org',true),'')::uuid));
COMMIT;
