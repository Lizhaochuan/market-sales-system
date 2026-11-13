-- MS-DB-001 / V3.1-01 -- PostgreSQL 16+ proposed initial schema
-- INDEPENDENT market-sales database. NEVER run on the existing CRM's data/db.json.
-- DESIGN CANDIDATE: reviewed SQL syntax and constraints are NOT a substitute for
-- a PostgreSQL migration run, concurrency tests, and business-policy approvals.
-- All currency amounts are INTEGER/BIGINT minor units (CNY fen). Timestamps are UTC.
-- DO NOT apply this proposal directly to production without review and backups.

BEGIN;
CREATE SCHEMA IF NOT EXISTS ms;

-- 01. Organization, staff and authorization
CREATE TABLE ms.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE ms.campuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES ms.organizations(id),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  UNIQUE (organization_id, name)
);
CREATE TABLE ms.staff_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES ms.organizations(id),
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  external_identity_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_staff_external_identity
  ON ms.staff_users(organization_id, external_identity_ref)
  WHERE external_identity_ref IS NOT NULL;
CREATE TABLE ms.role_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES ms.organizations(id),
  role_code TEXT NOT NULL,
  label_zh TEXT NOT NULL,
  permission_set JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (organization_id, role_code)
);
CREATE TABLE ms.user_role_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES ms.staff_users(id),
  role_id UUID NOT NULL REFERENCES ms.role_templates(id),
  granted_by UUID REFERENCES ms.staff_users(id),
  valid_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX uq_active_user_role ON ms.user_role_grants(user_id,role_id) WHERE revoked_at IS NULL;
CREATE TABLE ms.data_scope_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES ms.staff_users(id),
  resource_type TEXT NOT NULL,
  scope_type TEXT NOT NULL,
  scope_ref UUID,
  granted_by UUID REFERENCES ms.staff_users(id),
  revoked_at TIMESTAMPTZ
);
CREATE TABLE ms.field_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES ms.organizations(id),
  resource_type TEXT NOT NULL,
  field_name TEXT NOT NULL,
  visibility_policy TEXT NOT NULL CHECK (visibility_policy IN ('allow','mask','deny')),
  role_id UUID REFERENCES ms.role_templates(id),
  UNIQUE (organization_id,resource_type,field_name,role_id)
);

-- 02. Acquisition sources and campaigns
CREATE TABLE ms.marketing_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES ms.organizations(id),
  name TEXT NOT NULL,
  parent_id UUID REFERENCES ms.marketing_channels(id),
  channel_type TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive'))
);
CREATE TABLE ms.marketing_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES ms.organizations(id),
  name TEXT NOT NULL,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  owner_user_id UUID REFERENCES ms.staff_users(id),
  budget_cents BIGINT CHECK (budget_cents >= 0),
  status TEXT NOT NULL DEFAULT 'draft',
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at >= starts_at)
);
CREATE TABLE ms.campaign_channels (
  campaign_id UUID NOT NULL REFERENCES ms.marketing_campaigns(id),
  channel_id UUID NOT NULL REFERENCES ms.marketing_channels(id),
  PRIMARY KEY (campaign_id,channel_id)
);
CREATE TABLE ms.marketing_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES ms.organizations(id),
  cost_cents BIGINT NOT NULL CHECK (cost_cents > 0),
  currency CHAR(3) NOT NULL DEFAULT 'CNY' CHECK (currency = 'CNY'),
  cost_type TEXT NOT NULL,
  occurred_on DATE NOT NULL,
  evidence_ref TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','void')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE ms.cost_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  marketing_cost_id UUID NOT NULL REFERENCES ms.marketing_costs(id),
  channel_id UUID REFERENCES ms.marketing_channels(id),
  campaign_id UUID REFERENCES ms.marketing_campaigns(id),
  allocated_cents BIGINT NOT NULL CHECK (allocated_cents > 0),
  basis TEXT NOT NULL,
  approved_by UUID REFERENCES ms.staff_users(id),
  reversed_at TIMESTAMPTZ,
  CHECK (channel_id IS NOT NULL OR campaign_id IS NOT NULL)
);
-- Aggregate guard needed: SUM(active allocated_cents) <= approved cost_cents.

-- 03. Student-first identity, shared contacts, optional families
CREATE TABLE ms.students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES ms.organizations(id),
  display_name TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
  grade_label TEXT,
  school_name TEXT,
  owner_user_id UUID REFERENCES ms.staff_users(id),
  lifecycle_state TEXT NOT NULL DEFAULT 'prospect',
  version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by UUID REFERENCES ms.staff_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ
);
CREATE INDEX ix_student_org_owner ON ms.students(organization_id,owner_user_id) WHERE archived_at IS NULL;
CREATE TABLE ms.contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES ms.organizations(id),
  display_name TEXT,
  phone_ciphertext BYTEA,
  phone_lookup_hmac BYTEA,
  wechat_ciphertext BYTEA,
  do_not_contact BOOLEAN NOT NULL DEFAULT false,
  contact_preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ
);
-- Phone HMAC is an exact-match candidate locator only; never treat it as a student or household ID.
CREATE INDEX ix_contact_phone_lookup ON ms.contacts(organization_id,phone_lookup_hmac)
  WHERE phone_lookup_hmac IS NOT NULL AND archived_at IS NULL;
CREATE TABLE ms.student_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES ms.students(id),
  contact_id UUID NOT NULL REFERENCES ms.contacts(id),
  relation_type TEXT NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  verification_state TEXT NOT NULL DEFAULT 'unverified' CHECK (verification_state IN ('unverified','verified','disputed')),
  permission_basis_ref TEXT,
  verified_at TIMESTAMPTZ,
  valid_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_to TIMESTAMPTZ,
  CHECK (valid_to IS NULL OR valid_to > valid_from)
);
CREATE UNIQUE INDEX uq_student_contact_active ON ms.student_contacts(student_id,contact_id)
  WHERE valid_to IS NULL;
CREATE UNIQUE INDEX uq_student_one_primary_contact ON ms.student_contacts(student_id)
  WHERE valid_to IS NULL AND is_primary = true;
CREATE TABLE ms.family_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES ms.organizations(id),
  display_name TEXT NOT NULL,
  verification_state TEXT NOT NULL DEFAULT 'pending' CHECK (verification_state IN ('pending','verified','disputed','revoked')),
  verified_by UUID REFERENCES ms.staff_users(id),
  verified_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE ms.family_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_group_id UUID NOT NULL REFERENCES ms.family_groups(id),
  student_id UUID NOT NULL REFERENCES ms.students(id),
  relationship_basis TEXT NOT NULL,
  verified_by UUID REFERENCES ms.staff_users(id),
  verified_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoke_reason TEXT
);
CREATE UNIQUE INDEX uq_active_family_member ON ms.family_memberships(family_group_id,student_id)
  WHERE revoked_at IS NULL;
-- Service must confirm >=2 distinct verified students before activating a family.
-- Do not automatically assume that a student is restricted to only one household.
CREATE TABLE ms.student_owner_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES ms.students(id),
  old_owner_id UUID REFERENCES ms.staff_users(id),
  new_owner_id UUID REFERENCES ms.staff_users(id),
  approved_by UUID REFERENCES ms.staff_users(id),
  reason TEXT NOT NULL,
  effective_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE ms.crm_identity_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES ms.students(id),
  external_system TEXT NOT NULL,
  external_tenant TEXT NOT NULL DEFAULT 'default',
  external_student_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','rejected','revoked')),
  verification_method TEXT,
  verified_by UUID REFERENCES ms.staff_users(id),
  verified_at TIMESTAMPTZ,
  source_version TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status <> 'active' OR (verification_method IS NOT NULL AND verified_at IS NOT NULL))
);
CREATE UNIQUE INDEX uq_active_external_student ON ms.crm_identity_links(external_system,external_tenant,external_student_id)
  WHERE status = 'active';
CREATE UNIQUE INDEX uq_active_student_per_system ON ms.crm_identity_links(student_id,external_system,external_tenant)
  WHERE status = 'active';

-- 04. Leads, multi-student inquiries and opportunities
CREATE TABLE ms.contact_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES ms.organizations(id),
  contact_id UUID REFERENCES ms.contacts(id),
  channel_id UUID REFERENCES ms.marketing_channels(id),
  campaign_id UUID REFERENCES ms.marketing_campaigns(id),
  event_type TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  source_evidence_ref TEXT,
  original_source_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE ms.contact_event_students (
  event_id UUID NOT NULL REFERENCES ms.contact_events(id),
  student_id UUID NOT NULL REFERENCES ms.students(id),
  association_basis TEXT,
  PRIMARY KEY (event_id,student_id)
);
CREATE TABLE ms.student_acquisitions (
  student_id UUID PRIMARY KEY REFERENCES ms.students(id),
  first_event_id UUID REFERENCES ms.contact_events(id),
  source_channel_id UUID REFERENCES ms.marketing_channels(id),
  source_state TEXT NOT NULL DEFAULT 'unknown' CHECK (source_state IN ('unknown','known','corrected')),
  corrected_reason TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE ms.leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES ms.organizations(id),
  contact_id UUID REFERENCES ms.contacts(id),
  source_event_id UUID REFERENCES ms.contact_events(id),
  owner_user_id UUID REFERENCES ms.staff_users(id),
  lead_state TEXT NOT NULL DEFAULT 'new' CHECK (lead_state IN ('new','unidentified','working','converted','invalid','closed')),
  identified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE ms.lead_students (
  lead_id UUID NOT NULL REFERENCES ms.leads(id),
  student_id UUID NOT NULL REFERENCES ms.students(id),
  confirmation_state TEXT NOT NULL DEFAULT 'pending',
  confirmed_by UUID REFERENCES ms.staff_users(id),
  PRIMARY KEY (lead_id,student_id)
);
CREATE TABLE ms.opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES ms.students(id),
  owner_user_id UUID NOT NULL REFERENCES ms.staff_users(id),
  source_channel_id UUID REFERENCES ms.marketing_channels(id),
  originating_lead_id UUID REFERENCES ms.leads(id),
  stage TEXT NOT NULL DEFAULT 'new',
  lifecycle_state TEXT NOT NULL DEFAULT 'open' CHECK (lifecycle_state IN ('open','paused','won','lost','closed')),
  predicted_amount_cents BIGINT CHECK (predicted_amount_cents >= 0),
  version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_opportunity_student ON ms.opportunities(student_id,lifecycle_state);
CREATE TABLE ms.opportunity_stage_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id UUID NOT NULL REFERENCES ms.opportunities(id),
  from_stage TEXT,
  to_stage TEXT NOT NULL,
  changed_by UUID REFERENCES ms.staff_users(id),
  reason TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE ms.interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES ms.organizations(id),
  recorded_by UUID NOT NULL REFERENCES ms.staff_users(id),
  contact_id UUID REFERENCES ms.contacts(id),
  occurred_at TIMESTAMPTZ NOT NULL,
  contact_method TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE ms.interaction_subjects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  interaction_id UUID NOT NULL REFERENCES ms.interactions(id),
  student_id UUID REFERENCES ms.students(id),
  opportunity_id UUID REFERENCES ms.opportunities(id),
  lead_id UUID REFERENCES ms.leads(id),
  CHECK (num_nonnulls(student_id,opportunity_id,lead_id) >= 1)
);
CREATE TABLE ms.sales_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignee_user_id UUID NOT NULL REFERENCES ms.staff_users(id),
  student_id UUID REFERENCES ms.students(id),
  opportunity_id UUID REFERENCES ms.opportunities(id),
  due_at TIMESTAMPTZ,
  task_state TEXT NOT NULL DEFAULT 'open',
  automation_dedupe_key TEXT UNIQUE,
  title TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE ms.campaign_participations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES ms.marketing_campaigns(id),
  student_id UUID REFERENCES ms.students(id),
  lead_id UUID REFERENCES ms.leads(id),
  participated_at TIMESTAMPTZ NOT NULL,
  result_text TEXT,
  CHECK (num_nonnulls(student_id,lead_id) = 1)
);

-- 05. CRM-authoritative course projection, trial, immutable quote revisions
CREATE TABLE ms.crm_course_projections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_system TEXT NOT NULL,
  external_tenant TEXT NOT NULL DEFAULT 'default',
  external_course_id TEXT NOT NULL,
  source_version TEXT,
  display_name TEXT NOT NULL,
  class_type TEXT,
  standard_price_cents BIGINT CHECK (standard_price_cents >= 0),
  billing_unit TEXT,
  duration_minutes INTEGER CHECK (duration_minutes > 0),
  sellable BOOLEAN NOT NULL DEFAULT false,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (external_system,external_tenant,external_course_id)
);
CREATE TABLE ms.trial_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES ms.students(id),
  opportunity_id UUID REFERENCES ms.opportunities(id),
  crm_course_projection_id UUID REFERENCES ms.crm_course_projections(id),
  external_trial_id TEXT,
  external_schedule_id TEXT,
  requested_slot_at TIMESTAMPTZ,
  confirmed_slot_at TIMESTAMPTZ,
  booking_state TEXT NOT NULL DEFAULT 'draft'
    CHECK (booking_state IN ('draft','requested','confirming','confirmed','completed','cancelled','confirmation_unknown','manual_review')),
  attendance_state TEXT NOT NULL DEFAULT 'not_started',
  request_key TEXT NOT NULL UNIQUE,
  source_version TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE ms.trial_feedbacks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trial_booking_id UUID NOT NULL REFERENCES ms.trial_bookings(id),
  student_id UUID NOT NULL REFERENCES ms.students(id),
  teacher_external_ref TEXT,
  completion_result TEXT NOT NULL,
  feedback_summary TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE ms.quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_series_id UUID NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  student_id UUID NOT NULL REFERENCES ms.students(id),
  opportunity_id UUID NOT NULL REFERENCES ms.opportunities(id),
  valid_until TIMESTAMPTZ,
  approval_state TEXT NOT NULL DEFAULT 'draft',
  delivery_state TEXT NOT NULL DEFAULT 'not_sent',
  total_cents BIGINT NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (quote_series_id,version),
  UNIQUE (id,version)
);
CREATE TABLE ms.quote_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID NOT NULL REFERENCES ms.quotes(id),
  crm_course_projection_id UUID NOT NULL REFERENCES ms.crm_course_projections(id),
  price_source_version TEXT,
  billing_unit TEXT NOT NULL,
  billing_quantity NUMERIC(16,4) NOT NULL CHECK (billing_quantity > 0),
  duration_minutes INTEGER CHECK (duration_minutes > 0),
  standard_price_cents BIGINT NOT NULL CHECK (standard_price_cents >= 0),
  discount_cents BIGINT NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  final_cents BIGINT NOT NULL CHECK (final_cents >= 0),
  CHECK (discount_cents <= standard_price_cents * billing_quantity)
);
CREATE TABLE ms.discount_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID NOT NULL,
  quote_version INTEGER NOT NULL,
  requested_by UUID NOT NULL REFERENCES ms.staff_users(id),
  decided_by UUID REFERENCES ms.staff_users(id),
  approval_state TEXT NOT NULL DEFAULT 'pending',
  discount_cents BIGINT CHECK (discount_cents >= 0),
  decision_reason TEXT,
  FOREIGN KEY (quote_id,quote_version) REFERENCES ms.quotes(id,version),
  CHECK (decided_by IS NULL OR decided_by <> requested_by)
);

-- 06. Per-student orders and externally verified finance facts
CREATE TABLE ms.sales_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES ms.students(id),
  opportunity_id UUID NOT NULL REFERENCES ms.opportunities(id),
  quote_id UUID REFERENCES ms.quotes(id),
  quote_version INTEGER,
  amount_due_cents BIGINT NOT NULL CHECK (amount_due_cents >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'CNY' CHECK (currency = 'CNY'),
  order_state TEXT NOT NULL DEFAULT 'draft'
    CHECK (order_state IN ('draft','submitted','accepted','cancelled','closed')),
  payment_state TEXT NOT NULL DEFAULT 'unpaid'
    CHECK (payment_state IN ('unpaid','partially_paid','fully_paid','disputed','adjusted')),
  crm_fulfillment_state TEXT NOT NULL DEFAULT 'not_requested',
  version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (quote_id,quote_version) REFERENCES ms.quotes(id,version),
  CHECK ((quote_id IS NULL AND quote_version IS NULL) OR
         (quote_id IS NOT NULL AND quote_version IS NOT NULL))
);
CREATE INDEX ix_orders_student ON ms.sales_orders(student_id,created_at DESC);
CREATE TABLE ms.sales_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES ms.sales_orders(id),
  crm_course_projection_id UUID NOT NULL REFERENCES ms.crm_course_projections(id),
  billing_quantity NUMERIC(16,4) NOT NULL CHECK (billing_quantity > 0),
  billing_unit TEXT NOT NULL,
  duration_minutes INTEGER CHECK (duration_minutes > 0),
  paid_units NUMERIC(16,4) CHECK (paid_units >= 0),
  gift_units NUMERIC(16,4) CHECK (gift_units >= 0),
  line_total_cents BIGINT NOT NULL CHECK (line_total_cents >= 0),
  price_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE ms.payment_receipt_projections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_system TEXT NOT NULL,
  external_tenant TEXT NOT NULL DEFAULT 'default',
  external_payment_id TEXT NOT NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  currency CHAR(3) NOT NULL DEFAULT 'CNY' CHECK (currency = 'CNY'),
  verification_state TEXT NOT NULL DEFAULT 'unverified'
    CHECK (verification_state IN ('unverified','confirmed','revoked','disputed')),
  verified_at TIMESTAMPTZ,
  actual_received_at TIMESTAMPTZ,
  authority_evidence_ref TEXT,
  source_version TEXT,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (authority_system,external_tenant,external_payment_id),
  CHECK (verification_state <> 'confirmed' OR verified_at IS NOT NULL)
);
CREATE TABLE ms.payment_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id UUID NOT NULL REFERENCES ms.payment_receipt_projections(id),
  order_id UUID NOT NULL REFERENCES ms.sales_orders(id),
  allocated_cents BIGINT NOT NULL CHECK (allocated_cents > 0),
  allocation_state TEXT NOT NULL DEFAULT 'proposed'
    CHECK (allocation_state IN ('proposed','confirmed','reversed')),
  confirmed_by UUID REFERENCES ms.staff_users(id),
  confirmed_at TIMESTAMPTZ,
  allocation_basis_ref TEXT,
  reversed_at TIMESTAMPTZ,
  CHECK (allocation_state <> 'confirmed' OR (confirmed_at IS NOT NULL AND allocation_basis_ref IS NOT NULL))
);
CREATE UNIQUE INDEX uq_active_payment_receipt_order
  ON ms.payment_allocations(receipt_id,order_id) WHERE allocation_state <> 'reversed';
CREATE INDEX ix_payment_allocations_order ON ms.payment_allocations(order_id,allocation_state);
-- Service transaction MUST lock the parent receipt and target order, and check:
-- (1) only verified authority receipts may become confirmed allocations;
-- (2) SUM(confirmed allocations per receipt) <= effective receipt amount;
-- (3) SUM(net confirmed allocations per order) <= amount due or explicit permitted surplus;
-- (4) order student matches approved payment-purpose allocation.
CREATE TABLE ms.refund_projections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_system TEXT NOT NULL,
  external_tenant TEXT NOT NULL DEFAULT 'default',
  external_refund_id TEXT NOT NULL,
  original_receipt_id UUID REFERENCES ms.payment_receipt_projections(id),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  currency CHAR(3) NOT NULL DEFAULT 'CNY' CHECK (currency = 'CNY'),
  verification_state TEXT NOT NULL DEFAULT 'unverified'
    CHECK (verification_state IN ('unverified','confirmed','revoked','disputed')),
  actual_refunded_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  evidence_ref TEXT,
  UNIQUE (authority_system,external_tenant,external_refund_id),
  CHECK (verification_state <> 'confirmed' OR verified_at IS NOT NULL)
);
CREATE TABLE ms.refund_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  refund_id UUID NOT NULL REFERENCES ms.refund_projections(id),
  order_id UUID NOT NULL REFERENCES ms.sales_orders(id),
  order_item_id UUID REFERENCES ms.sales_order_items(id),
  allocated_cents BIGINT NOT NULL CHECK (allocated_cents > 0),
  allocation_state TEXT NOT NULL DEFAULT 'proposed'
    CHECK (allocation_state IN ('proposed','confirmed','reversed')),
  reason TEXT NOT NULL
);
-- Aggregate guard: SUM(confirmed refunds) <= verified refund amount, and refunds
-- must not exceed the net eligible amounts assigned to the relevant order/items.
CREATE TABLE ms.sale_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL UNIQUE REFERENCES ms.sales_orders(id),
  recognized_amount_cents BIGINT NOT NULL CHECK (recognized_amount_cents > 0),
  recognized_at TIMESTAMPTZ NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  owner_snapshot_id UUID NOT NULL REFERENCES ms.staff_users(id),
  attribution_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  authority_evidence JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE ms.sales_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_event_id UUID NOT NULL REFERENCES ms.sale_events(id),
  allocation_version INTEGER NOT NULL CHECK (allocation_version > 0),
  salesperson_id UUID NOT NULL REFERENCES ms.staff_users(id),
  share_basis_points INTEGER NOT NULL CHECK (share_basis_points > 0 AND share_basis_points <= 10000),
  allocated_cents BIGINT NOT NULL CHECK (allocated_cents >= 0),
  approval_ref TEXT,
  state TEXT NOT NULL DEFAULT 'proposed' CHECK (state IN ('proposed','approved','superseded')),
  UNIQUE (sale_event_id,allocation_version,salesperson_id)
);
-- Aggregate guard: approved allocation_version shares sum to exactly 10000 bps,
-- and allocated integer cents sum exactly to recognized_amount_cents.
CREATE TABLE ms.sales_credit_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_event_id UUID NOT NULL REFERENCES ms.sale_events(id),
  refund_id UUID REFERENCES ms.refund_projections(id),
  salesperson_id UUID NOT NULL REFERENCES ms.staff_users(id),
  amount_delta_cents BIGINT NOT NULL CHECK (amount_delta_cents <> 0),
  allocation_version INTEGER NOT NULL CHECK (allocation_version > 0),
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE ms.sale_campaign_attributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_event_id UUID NOT NULL REFERENCES ms.sale_events(id),
  campaign_id UUID NOT NULL REFERENCES ms.marketing_campaigns(id),
  role TEXT NOT NULL CHECK (role IN ('primary','assist')),
  evidence_ref TEXT,
  UNIQUE (sale_event_id,campaign_id)
);
CREATE UNIQUE INDEX uq_one_primary_campaign_per_sale
  ON ms.sale_campaign_attributions(sale_event_id) WHERE role = 'primary';
CREATE TABLE ms.crm_entitlement_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_item_id UUID NOT NULL UNIQUE REFERENCES ms.sales_order_items(id),
  external_system TEXT NOT NULL,
  external_tenant TEXT NOT NULL DEFAULT 'default',
  external_package_id TEXT,
  external_student_id TEXT NOT NULL,
  provisioning_request_key TEXT NOT NULL UNIQUE,
  fulfillment_state TEXT NOT NULL DEFAULT 'not_requested'
    CHECK (fulfillment_state IN ('not_requested','pending','unknown','completed','manual_review','cancelled')),
  verified_at TIMESTAMPTZ,
  source_version TEXT
);
CREATE UNIQUE INDEX uq_external_crm_package ON ms.crm_entitlement_links(external_system,external_tenant,external_package_id)
  WHERE external_package_id IS NOT NULL;

-- 07. Approvals, append-only audit, integration reliability and automation
CREATE TABLE ms.approval_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES ms.organizations(id),
  object_type TEXT NOT NULL,
  object_id UUID NOT NULL,
  object_version BIGINT NOT NULL CHECK (object_version > 0),
  requested_by UUID NOT NULL REFERENCES ms.staff_users(id),
  decided_by UUID REFERENCES ms.staff_users(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','withdrawn','expired')),
  before_business_json JSONB,
  after_business_json JSONB,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ,
  CHECK (decided_by IS NULL OR decided_by <> requested_by)
);
CREATE TABLE ms.audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES ms.organizations(id),
  actor_user_id UUID REFERENCES ms.staff_users(id),
  service_actor TEXT,
  target_type TEXT NOT NULL,
  target_id UUID NOT NULL,
  event_name TEXT NOT NULL,
  before_business_json JSONB,
  after_business_json JSONB,
  reason_zh TEXT,
  request_trace_id TEXT,
  happened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (actor_user_id IS NOT NULL OR service_actor IS NOT NULL)
);
-- Application should only INSERT audit rows, never UPDATE/DELETE. DB roles must
-- DENY UPDATE and DELETE of this table; business-readable rendering is mandatory.
CREATE INDEX ix_audit_target_time ON ms.audit_events(target_type,target_id,happened_at DESC);
CREATE TABLE ms.integration_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id UUID NOT NULL,
  payload_version INTEGER NOT NULL DEFAULT 1,
  payload_json JSONB NOT NULL,
  dispatch_state TEXT NOT NULL DEFAULT 'pending'
    CHECK (dispatch_state IN ('pending','sending','delivered','unknown','dead_letter')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_retry_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ
);
CREATE INDEX ix_outbox_pending ON ms.integration_outbox(next_retry_at,created_at)
  WHERE dispatch_state IN ('pending','unknown');
CREATE TABLE ms.integration_inbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_system TEXT NOT NULL,
  external_event_id TEXT NOT NULL,
  source_version TEXT,
  payload_digest TEXT NOT NULL,
  processing_state TEXT NOT NULL DEFAULT 'received',
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  UNIQUE (source_system,external_event_id)
);
CREATE TABLE ms.integration_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_name TEXT NOT NULL,
  request_key TEXT NOT NULL UNIQUE,
  request_digest TEXT NOT NULL,
  business_type TEXT NOT NULL,
  business_id UUID NOT NULL,
  result_state TEXT NOT NULL DEFAULT 'pending'
    CHECK (result_state IN ('pending','sending','unknown','confirmed','rejected','manual_review')),
  external_object_id TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error_code TEXT,
  next_retry_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE ms.reconciliation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_system TEXT NOT NULL,
  scope_description TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running',
  summary JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE ms.automation_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES ms.organizations(id),
  name TEXT NOT NULL,
  event_type TEXT NOT NULL,
  action_code TEXT NOT NULL,
  rule_version INTEGER NOT NULL DEFAULT 1 CHECK (rule_version > 0),
  rule_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT false,
  approved_by UUID REFERENCES ms.staff_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE ms.automation_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL REFERENCES ms.automation_rules(id),
  rule_version INTEGER NOT NULL,
  source_event_id TEXT NOT NULL,
  action_dedupe_key TEXT NOT NULL UNIQUE,
  business_object_type TEXT NOT NULL,
  business_object_id UUID NOT NULL,
  result_state TEXT NOT NULL DEFAULT 'pending',
  executed_at TIMESTAMPTZ,
  result_summary_zh TEXT
);

COMMIT;
