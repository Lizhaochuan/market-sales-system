-- V3.2-06: bind tenant identity to PostgreSQL SESSION_USER, not a client-settable GUC.
-- Tested only in disposable fictional database; do not apply to actual CRM.
BEGIN;
CREATE TABLE ms.database_principal_tenants (
  principal_name NAME PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES ms.organizations(id),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
REVOKE ALL ON ms.database_principal_tenants FROM PUBLIC;
REVOKE ALL ON ms.database_principal_tenants FROM ms_lowrisk_runtime;

-- SECURITY DEFINER sees a protected mapping, while SESSION_USER remains the
-- ORIGINAL LOGIN even inside SET ROLE and SECURITY DEFINER functions.
-- Runtime cannot edit the mapping or impersonate another LOGIN.
CREATE FUNCTION ms.current_database_tenant() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, ms
AS $tenant_lookup$
  SELECT m.organization_id
  FROM ms.database_principal_tenants AS m
  WHERE m.principal_name = session_user::name
$tenant_lookup$;
REVOKE ALL ON FUNCTION ms.current_database_tenant() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ms.current_database_tenant() TO ms_lowrisk_runtime;

-- Replace the 009 custom-GUC policies. ALL 24 tables granted to the low-risk
-- runtime now have an explicit tenant-filtered policy including dependent rows.
-- A missing mapping returns NULL and denies all rows.
ALTER TABLE ms.organizations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organizations_isolated_tenant ON ms.organizations;
CREATE POLICY organizations_principal_tenant ON ms.organizations
  FOR ALL TO ms_lowrisk_runtime
  USING (id = ms.current_database_tenant())
  WITH CHECK (id = ms.current_database_tenant());

ALTER TABLE ms.staff_users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS staff_users_isolated_tenant ON ms.staff_users;
CREATE POLICY staff_users_principal_tenant ON ms.staff_users
  FOR ALL TO ms_lowrisk_runtime
  USING (organization_id = ms.current_database_tenant())
  WITH CHECK (organization_id = ms.current_database_tenant());

ALTER TABLE ms.role_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS role_templates_isolated_tenant ON ms.role_templates;
CREATE POLICY role_templates_principal_tenant ON ms.role_templates
  FOR ALL TO ms_lowrisk_runtime
  USING (organization_id = ms.current_database_tenant())
  WITH CHECK (organization_id = ms.current_database_tenant());

ALTER TABLE ms.user_role_grants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_role_grants_isolated_tenant ON ms.user_role_grants;
CREATE POLICY user_role_grants_principal_tenant ON ms.user_role_grants
  FOR ALL TO ms_lowrisk_runtime
  USING (EXISTS (SELECT 1 FROM ms.staff_users s WHERE s.id = user_id AND s.organization_id = ms.current_database_tenant()) AND EXISTS (SELECT 1 FROM ms.role_templates r WHERE r.id=role_id AND r.organization_id=ms.current_database_tenant()))
  WITH CHECK (EXISTS (SELECT 1 FROM ms.staff_users s WHERE s.id = user_id AND s.organization_id = ms.current_database_tenant()) AND EXISTS (SELECT 1 FROM ms.role_templates r WHERE r.id=role_id AND r.organization_id=ms.current_database_tenant()));

ALTER TABLE ms.data_scope_grants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS data_scope_grants_isolated_tenant ON ms.data_scope_grants;
CREATE POLICY data_scope_grants_principal_tenant ON ms.data_scope_grants
  FOR ALL TO ms_lowrisk_runtime
  USING (EXISTS (SELECT 1 FROM ms.staff_users s WHERE s.id = user_id AND s.organization_id = ms.current_database_tenant()) AND (resource_type<>'student' OR scope_ref IS NULL OR EXISTS (SELECT 1 FROM ms.students s WHERE s.id=scope_ref AND s.organization_id=ms.current_database_tenant())))
  WITH CHECK (EXISTS (SELECT 1 FROM ms.staff_users s WHERE s.id = user_id AND s.organization_id = ms.current_database_tenant()) AND (resource_type<>'student' OR scope_ref IS NULL OR EXISTS (SELECT 1 FROM ms.students s WHERE s.id=scope_ref AND s.organization_id=ms.current_database_tenant())));

ALTER TABLE ms.field_policies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS field_policies_isolated_tenant ON ms.field_policies;
CREATE POLICY field_policies_principal_tenant ON ms.field_policies
  FOR ALL TO ms_lowrisk_runtime
  USING (organization_id = ms.current_database_tenant())
  WITH CHECK (organization_id = ms.current_database_tenant());

ALTER TABLE ms.marketing_channels ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS marketing_channels_isolated_tenant ON ms.marketing_channels;
CREATE POLICY marketing_channels_principal_tenant ON ms.marketing_channels
  FOR ALL TO ms_lowrisk_runtime
  USING (organization_id = ms.current_database_tenant())
  WITH CHECK (organization_id = ms.current_database_tenant());

ALTER TABLE ms.students ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS students_isolated_tenant ON ms.students;
CREATE POLICY students_principal_tenant ON ms.students
  FOR ALL TO ms_lowrisk_runtime
  USING (organization_id = ms.current_database_tenant() AND (owner_user_id IS NULL OR EXISTS (SELECT 1 FROM ms.staff_users u WHERE u.id=owner_user_id AND u.organization_id=ms.current_database_tenant())))
  WITH CHECK (organization_id = ms.current_database_tenant() AND (owner_user_id IS NULL OR EXISTS (SELECT 1 FROM ms.staff_users u WHERE u.id=owner_user_id AND u.organization_id=ms.current_database_tenant())));

ALTER TABLE ms.contacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contacts_isolated_tenant ON ms.contacts;
CREATE POLICY contacts_principal_tenant ON ms.contacts
  FOR ALL TO ms_lowrisk_runtime
  USING (organization_id = ms.current_database_tenant())
  WITH CHECK (organization_id = ms.current_database_tenant());

ALTER TABLE ms.student_contacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS student_contacts_isolated_tenant ON ms.student_contacts;
CREATE POLICY student_contacts_principal_tenant ON ms.student_contacts
  FOR ALL TO ms_lowrisk_runtime
  USING (EXISTS (SELECT 1 FROM ms.students s WHERE s.id = student_id AND s.organization_id = ms.current_database_tenant()) AND EXISTS (SELECT 1 FROM ms.contacts c WHERE c.id = contact_id AND c.organization_id = ms.current_database_tenant()))
  WITH CHECK (EXISTS (SELECT 1 FROM ms.students s WHERE s.id = student_id AND s.organization_id = ms.current_database_tenant()) AND EXISTS (SELECT 1 FROM ms.contacts c WHERE c.id = contact_id AND c.organization_id = ms.current_database_tenant()));

ALTER TABLE ms.contact_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contact_events_isolated_tenant ON ms.contact_events;
CREATE POLICY contact_events_principal_tenant ON ms.contact_events
  FOR ALL TO ms_lowrisk_runtime
  USING (organization_id = ms.current_database_tenant() AND (contact_id IS NULL OR EXISTS (SELECT 1 FROM ms.contacts c WHERE c.id = contact_id AND c.organization_id = ms.current_database_tenant())))
  WITH CHECK (organization_id = ms.current_database_tenant() AND (contact_id IS NULL OR EXISTS (SELECT 1 FROM ms.contacts c WHERE c.id = contact_id AND c.organization_id = ms.current_database_tenant())));

ALTER TABLE ms.leads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS leads_isolated_tenant ON ms.leads;
CREATE POLICY leads_principal_tenant ON ms.leads
  FOR ALL TO ms_lowrisk_runtime
  USING (organization_id = ms.current_database_tenant() AND (contact_id IS NULL OR EXISTS (SELECT 1 FROM ms.contacts c WHERE c.id = contact_id AND c.organization_id = ms.current_database_tenant())) AND (source_event_id IS NULL OR EXISTS (SELECT 1 FROM ms.contact_events e WHERE e.id=source_event_id AND e.organization_id=ms.current_database_tenant())))
  WITH CHECK (organization_id = ms.current_database_tenant() AND (contact_id IS NULL OR EXISTS (SELECT 1 FROM ms.contacts c WHERE c.id = contact_id AND c.organization_id = ms.current_database_tenant())) AND (source_event_id IS NULL OR EXISTS (SELECT 1 FROM ms.contact_events e WHERE e.id=source_event_id AND e.organization_id=ms.current_database_tenant())));

ALTER TABLE ms.lead_students ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lead_students_isolated_tenant ON ms.lead_students;
CREATE POLICY lead_students_principal_tenant ON ms.lead_students
  FOR ALL TO ms_lowrisk_runtime
  USING (EXISTS (SELECT 1 FROM ms.leads l WHERE l.id = lead_id AND l.organization_id = ms.current_database_tenant()) AND EXISTS (SELECT 1 FROM ms.students s WHERE s.id = student_id AND s.organization_id = ms.current_database_tenant()))
  WITH CHECK (EXISTS (SELECT 1 FROM ms.leads l WHERE l.id = lead_id AND l.organization_id = ms.current_database_tenant()) AND EXISTS (SELECT 1 FROM ms.students s WHERE s.id = student_id AND s.organization_id = ms.current_database_tenant()));

ALTER TABLE ms.opportunities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS opportunities_isolated_tenant ON ms.opportunities;
CREATE POLICY opportunities_principal_tenant ON ms.opportunities
  FOR ALL TO ms_lowrisk_runtime
  USING (EXISTS (SELECT 1 FROM ms.students s WHERE s.id = student_id AND s.organization_id = ms.current_database_tenant()) AND EXISTS (SELECT 1 FROM ms.staff_users u WHERE u.id=owner_user_id AND u.organization_id=ms.current_database_tenant()))
  WITH CHECK (EXISTS (SELECT 1 FROM ms.students s WHERE s.id = student_id AND s.organization_id = ms.current_database_tenant()) AND EXISTS (SELECT 1 FROM ms.staff_users u WHERE u.id=owner_user_id AND u.organization_id=ms.current_database_tenant()));

ALTER TABLE ms.interactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS interactions_isolated_tenant ON ms.interactions;
CREATE POLICY interactions_principal_tenant ON ms.interactions
  FOR ALL TO ms_lowrisk_runtime
  USING (organization_id = ms.current_database_tenant() AND EXISTS (SELECT 1 FROM ms.staff_users u WHERE u.id=recorded_by AND u.organization_id=ms.current_database_tenant()) AND (contact_id IS NULL OR EXISTS (SELECT 1 FROM ms.contacts c WHERE c.id = contact_id AND c.organization_id = ms.current_database_tenant())))
  WITH CHECK (organization_id = ms.current_database_tenant() AND EXISTS (SELECT 1 FROM ms.staff_users u WHERE u.id=recorded_by AND u.organization_id=ms.current_database_tenant()) AND (contact_id IS NULL OR EXISTS (SELECT 1 FROM ms.contacts c WHERE c.id = contact_id AND c.organization_id = ms.current_database_tenant())));

ALTER TABLE ms.interaction_subjects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS interaction_subjects_isolated_tenant ON ms.interaction_subjects;
CREATE POLICY interaction_subjects_principal_tenant ON ms.interaction_subjects
  FOR ALL TO ms_lowrisk_runtime
  USING (EXISTS (SELECT 1 FROM ms.interactions i WHERE i.id=interaction_id AND i.organization_id=ms.current_database_tenant()) AND (student_id IS NULL OR EXISTS (SELECT 1 FROM ms.students s WHERE s.id = student_id AND s.organization_id = ms.current_database_tenant())) AND (lead_id IS NULL OR EXISTS (SELECT 1 FROM ms.leads l WHERE l.id = lead_id AND l.organization_id = ms.current_database_tenant())) AND (opportunity_id IS NULL OR EXISTS (SELECT 1 FROM ms.opportunities o JOIN ms.students s ON s.id=o.student_id WHERE o.id=opportunity_id AND s.organization_id=ms.current_database_tenant())))
  WITH CHECK (EXISTS (SELECT 1 FROM ms.interactions i WHERE i.id=interaction_id AND i.organization_id=ms.current_database_tenant()) AND (student_id IS NULL OR EXISTS (SELECT 1 FROM ms.students s WHERE s.id = student_id AND s.organization_id = ms.current_database_tenant())) AND (lead_id IS NULL OR EXISTS (SELECT 1 FROM ms.leads l WHERE l.id = lead_id AND l.organization_id = ms.current_database_tenant())) AND (opportunity_id IS NULL OR EXISTS (SELECT 1 FROM ms.opportunities o JOIN ms.students s ON s.id=o.student_id WHERE o.id=opportunity_id AND s.organization_id=ms.current_database_tenant())));

ALTER TABLE ms.family_groups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS family_groups_isolated_tenant ON ms.family_groups;
CREATE POLICY family_groups_principal_tenant ON ms.family_groups
  FOR ALL TO ms_lowrisk_runtime
  USING (organization_id = ms.current_database_tenant())
  WITH CHECK (organization_id = ms.current_database_tenant());

ALTER TABLE ms.family_memberships ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS family_memberships_isolated_tenant ON ms.family_memberships;
CREATE POLICY family_memberships_principal_tenant ON ms.family_memberships
  FOR ALL TO ms_lowrisk_runtime
  USING (EXISTS (SELECT 1 FROM ms.family_groups f WHERE f.id = family_group_id AND f.organization_id = ms.current_database_tenant()) AND EXISTS (SELECT 1 FROM ms.students s WHERE s.id = student_id AND s.organization_id = ms.current_database_tenant()))
  WITH CHECK (EXISTS (SELECT 1 FROM ms.family_groups f WHERE f.id = family_group_id AND f.organization_id = ms.current_database_tenant()) AND EXISTS (SELECT 1 FROM ms.students s WHERE s.id = student_id AND s.organization_id = ms.current_database_tenant()));

ALTER TABLE ms.family_review_decisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS family_review_decisions_isolated_tenant ON ms.family_review_decisions;
CREATE POLICY family_review_decisions_principal_tenant ON ms.family_review_decisions
  FOR ALL TO ms_lowrisk_runtime
  USING (EXISTS (SELECT 1 FROM ms.family_groups f WHERE f.id = family_group_id AND f.organization_id = ms.current_database_tenant()))
  WITH CHECK (EXISTS (SELECT 1 FROM ms.family_groups f WHERE f.id = family_group_id AND f.organization_id = ms.current_database_tenant()));

ALTER TABLE ms.staff_identity_bindings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS staff_identity_bindings_isolated_tenant ON ms.staff_identity_bindings;
CREATE POLICY staff_identity_bindings_principal_tenant ON ms.staff_identity_bindings
  FOR ALL TO ms_lowrisk_runtime
  USING (EXISTS (SELECT 1 FROM ms.staff_users s WHERE s.id=staff_user_id AND s.organization_id=ms.current_database_tenant()))
  WITH CHECK (EXISTS (SELECT 1 FROM ms.staff_users s WHERE s.id=staff_user_id AND s.organization_id=ms.current_database_tenant()));

ALTER TABLE ms.identity_change_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS identity_change_requests_isolated_tenant ON ms.identity_change_requests;
CREATE POLICY identity_change_requests_principal_tenant ON ms.identity_change_requests
  FOR ALL TO ms_lowrisk_runtime
  USING (organization_id = ms.current_database_tenant() AND EXISTS (SELECT 1 FROM ms.staff_users s WHERE s.id=target_staff_id AND s.organization_id=ms.current_database_tenant()))
  WITH CHECK (organization_id = ms.current_database_tenant() AND EXISTS (SELECT 1 FROM ms.staff_users s WHERE s.id=target_staff_id AND s.organization_id=ms.current_database_tenant()));

ALTER TABLE ms.identity_change_decisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS identity_change_decisions_isolated_tenant ON ms.identity_change_decisions;
CREATE POLICY identity_change_decisions_principal_tenant ON ms.identity_change_decisions
  FOR ALL TO ms_lowrisk_runtime
  USING (EXISTS (SELECT 1 FROM ms.identity_change_requests q WHERE q.id=request_id AND q.organization_id=ms.current_database_tenant()))
  WITH CHECK (EXISTS (SELECT 1 FROM ms.identity_change_requests q WHERE q.id=request_id AND q.organization_id=ms.current_database_tenant()));

ALTER TABLE ms.audit_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_events_isolated_tenant ON ms.audit_events;
CREATE POLICY audit_events_principal_tenant ON ms.audit_events
  FOR ALL TO ms_lowrisk_runtime
  USING (organization_id = ms.current_database_tenant())
  WITH CHECK (organization_id = ms.current_database_tenant());

ALTER TABLE ms.api_write_receipts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS api_write_receipts_isolated_tenant ON ms.api_write_receipts;
CREATE POLICY api_write_receipts_principal_tenant ON ms.api_write_receipts
  FOR ALL TO ms_lowrisk_runtime
  USING (organization_id = ms.current_database_tenant())
  WITH CHECK (organization_id = ms.current_database_tenant());

-- No app function or RLS policy calls current_setting('ms.tenant_org').
-- PostgreSQL administrators own this mapping; service accounts cannot change it.
COMMIT;
