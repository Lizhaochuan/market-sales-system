-- V3.2-03, isolated PostgreSQL only. Independent market-sales DB.
-- This migration adds external issuer+subject staff bindings; it DOES NOT
-- enable production identity or automatically provision staff memberships.
BEGIN;
CREATE TABLE ms.staff_identity_bindings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_user_id UUID NOT NULL REFERENCES ms.staff_users(id),
  issuer TEXT NOT NULL CHECK (length(issuer) BETWEEN 9 AND 255 AND issuer LIKE 'https://%'),
  subject TEXT NOT NULL CHECK (length(subject) BETWEEN 1 AND 255),
  bound_by UUID REFERENCES ms.staff_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX uq_active_external_subject
  ON ms.staff_identity_bindings(issuer,subject) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX uq_active_staff_identity_by_issuer
  ON ms.staff_identity_bindings(staff_user_id,issuer) WHERE revoked_at IS NULL;
CREATE INDEX ix_staff_identity_bound_user
  ON ms.staff_identity_bindings(staff_user_id) WHERE revoked_at IS NULL;

ALTER TABLE ms.family_groups
  ADD COLUMN requested_by UUID REFERENCES ms.staff_users(id),
  ADD COLUMN submission_evidence_ref TEXT,
  ADD CONSTRAINT family_request_evidence_nonempty CHECK
    (submission_evidence_ref IS NULL OR length(trim(submission_evidence_ref)) BETWEEN 1 AND 200);
-- Older isolated review rows may have no requester and cannot be approved
-- without manual remediation. Future requests must always populate it.

ALTER TABLE ms.family_groups DROP CONSTRAINT IF EXISTS family_groups_verification_state_check;
ALTER TABLE ms.family_groups ADD CONSTRAINT family_groups_verification_state_check
  CHECK (verification_state IN ('pending','verified','disputed','revoked','rejected'));
ALTER TABLE ms.family_groups ADD CONSTRAINT family_verified_requires_review
  CHECK (
    verification_state <> 'verified' OR
    (verified_by IS NOT NULL AND verified_at IS NOT NULL AND requested_by IS NOT NULL
     AND verified_by <> requested_by)
  );

CREATE TABLE ms.family_review_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_group_id UUID NOT NULL REFERENCES ms.family_groups(id),
  reviewer_user_id UUID NOT NULL REFERENCES ms.staff_users(id),
  decision TEXT NOT NULL CHECK (decision IN ('approved','rejected')),
  review_evidence_ref TEXT NOT NULL CHECK (length(trim(review_evidence_ref)) BETWEEN 1 AND 200),
  reason_zh TEXT NOT NULL CHECK (length(trim(reason_zh)) BETWEEN 1 AND 400),
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (family_group_id)
);
CREATE INDEX ix_family_review_reviewer
  ON ms.family_review_decisions(reviewer_user_id,decided_at DESC);

-- Guard against accidental/direct self-approval even if a service mistakenly
-- bypasses the family review command. Database owners can still override triggers.
CREATE FUNCTION ms.guard_family_review_approval() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  org UUID;
  requester UUID;
  state TEXT;
  member_count INTEGER;
  bad_members INTEGER;
BEGIN
  SELECT organization_id,requested_by,verification_state
    INTO org,requester,state
    FROM ms.family_groups WHERE id=NEW.family_group_id FOR UPDATE;
  IF org IS NULL THEN
    RAISE EXCEPTION '家庭关联申请不存在' USING ERRCODE='23514';
  END IF;
  IF requester IS NULL OR NEW.reviewer_user_id=requester THEN
    RAISE EXCEPTION '申请人不得审批自己的家庭关系申请' USING ERRCODE='23514';
  END IF;
  IF state<>'pending' THEN
    RAISE EXCEPTION '此家庭关系申请已处理' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM ms.staff_users su
    JOIN ms.user_role_grants rg ON rg.user_id=su.id
    JOIN ms.role_templates rt ON rt.id=rg.role_id
    WHERE su.id=NEW.reviewer_user_id AND su.organization_id=org
      AND su.status='active' AND rg.revoked_at IS NULL
      AND rg.valid_from<=now() AND rt.organization_id=org
      AND rt.role_code IN ('sales_manager','super_admin')
  ) THEN
    RAISE EXCEPTION '只有本机构有效主管可以审核' USING ERRCODE='23514';
  END IF;
  SELECT count(DISTINCT m.student_id)::integer,
    count(*) FILTER (WHERE s.organization_id IS DISTINCT FROM org)::integer
    INTO member_count,bad_members
  FROM ms.family_memberships m
  LEFT JOIN ms.students s ON s.id=m.student_id
  WHERE m.family_group_id=NEW.family_group_id AND m.revoked_at IS NULL;
  IF member_count<2 OR bad_members<>0 THEN
    RAISE EXCEPTION '至少两名同机构学生才可审核家庭关联' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_guard_family_review_approval
  BEFORE INSERT ON ms.family_review_decisions
  FOR EACH ROW EXECUTE FUNCTION ms.guard_family_review_approval();

-- Reviews are append-only, with a one-review-per-application uniqueness key.
CREATE FUNCTION ms.guard_family_review_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '家庭关系审核历史不能修改或删除'
    USING ERRCODE='23514';
END $$;
CREATE TRIGGER trg_family_review_no_update_delete
  BEFORE UPDATE OR DELETE ON ms.family_review_decisions
  FOR EACH ROW EXECUTE FUNCTION ms.guard_family_review_immutable();
COMMIT;
