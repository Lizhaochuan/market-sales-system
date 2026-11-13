-- MS-DB-002 / V3.1-04: FINANCIAL INTEGRITY PATCH (REVIEW DRAFT)
-- Applies AFTER 001_initial_schema.sql in a NEW, isolated PostgreSQL 16+ database.
-- Review and test before production. This DOES NOT make finance integration production ready.
-- BP-01, BP-02, BP-04, BP-05 and TP-03/04/05 remain blocking.
BEGIN;
SET LOCAL lock_timeout = '5s';

-- DDL invariants: atomic counters are required to prevent concurrent over-allocation.
ALTER TABLE ms.payment_receipt_projections
  ADD COLUMN allocated_cents BIGINT NOT NULL DEFAULT 0,
  ADD CONSTRAINT receipt_allocation_within_amount CHECK (allocated_cents >= 0 AND allocated_cents <= amount_cents),
  ADD COLUMN source_revision BIGINT,
  ADD CONSTRAINT receipt_source_revision_positive CHECK (source_revision IS NULL OR source_revision >= 0);

ALTER TABLE ms.refund_projections
  ADD COLUMN allocated_cents BIGINT NOT NULL DEFAULT 0,
  ADD CONSTRAINT refund_allocation_within_amount CHECK (allocated_cents >= 0 AND allocated_cents <= amount_cents),
  ADD COLUMN source_revision BIGINT,
  ADD CONSTRAINT refund_source_revision_positive CHECK (source_revision IS NULL OR source_revision >= 0);

ALTER TABLE ms.sales_orders
  ADD COLUMN net_allocated_cents BIGINT NOT NULL DEFAULT 0,
  ADD CONSTRAINT order_net_payment_within_due CHECK (
    net_allocated_cents >= 0 AND net_allocated_cents <= amount_due_cents
  );

-- A single canonical economic key prevents a refund being treated as two different
-- financial adjustment events. Chargebacks/reversals require a separate event path.
CREATE TABLE ms.finance_economic_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_system TEXT NOT NULL,
  external_tenant TEXT NOT NULL DEFAULT 'default',
  economic_event_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('refund','chargeback','reversal')),
  original_receipt_id UUID NOT NULL REFERENCES ms.payment_receipt_projections(id),
  refund_id UUID UNIQUE REFERENCES ms.refund_projections(id),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  verification_state TEXT NOT NULL CHECK (verification_state IN ('confirmed','disputed','revoked')),
  verified_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(authority_system, external_tenant, economic_event_key),
  CHECK ((kind = 'refund' AND refund_id IS NOT NULL) OR
         (kind <> 'refund' AND refund_id IS NULL))
);
-- IMPORTANT: chargeback/reversal settlement effects remain blocked until the
-- finance authority specifies whether they overlap with a refund economic event.

-- Allocation audit ledger: no business update/delete of historical rows.
CREATE TABLE ms.payment_allocation_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  allocation_id UUID NOT NULL REFERENCES ms.payment_allocations(id),
  receipt_id UUID NOT NULL REFERENCES ms.payment_receipt_projections(id),
  order_id UUID NOT NULL REFERENCES ms.sales_orders(id),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  before_state TEXT,
  after_state TEXT NOT NULL,
  confirmed_by UUID REFERENCES ms.staff_users(id),
  evidence_ref TEXT,
  happened_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_payment_allocation_history ON ms.payment_allocation_history(allocation_id,happened_at);

CREATE TABLE ms.refund_allocation_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  allocation_id UUID NOT NULL REFERENCES ms.refund_allocations(id),
  refund_id UUID NOT NULL REFERENCES ms.refund_projections(id),
  order_id UUID NOT NULL REFERENCES ms.sales_orders(id),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  before_state TEXT,
  after_state TEXT NOT NULL,
  reason TEXT NOT NULL,
  happened_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ms.sales_credit_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_event_id UUID NOT NULL REFERENCES ms.sale_events(id),
  allocation_version INTEGER NOT NULL CHECK (allocation_version > 0),
  approval_state TEXT NOT NULL DEFAULT 'proposed'
    CHECK (approval_state IN ('proposed','approved','superseded','rejected')),
  approved_by UUID REFERENCES ms.staff_users(id),
  approved_at TIMESTAMPTZ,
  UNIQUE(sale_event_id,allocation_version),
  CHECK (approval_state <> 'approved' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL))
);
CREATE UNIQUE INDEX uq_one_approved_sales_credit_version
  ON ms.sales_credit_versions(sale_event_id) WHERE approval_state = 'approved';
ALTER TABLE ms.sales_credits
  ADD CONSTRAINT fk_sales_credit_version
  FOREIGN KEY(sale_event_id,allocation_version)
  REFERENCES ms.sales_credit_versions(sale_event_id,allocation_version);

-- Same-student guarantee before an order can be created or changed.
CREATE FUNCTION ms.guard_sales_order_identity() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  op_student UUID;
  quote_student UUID;
  quote_opportunity UUID;
BEGIN
  SELECT student_id INTO op_student FROM ms.opportunities WHERE id = NEW.opportunity_id;
  IF op_student IS NULL OR op_student <> NEW.student_id THEN
    RAISE EXCEPTION '订单与商机不属于同一学生' USING ERRCODE='23514';
  END IF;
  IF NEW.quote_id IS NOT NULL THEN
    SELECT student_id, opportunity_id INTO quote_student, quote_opportunity
      FROM ms.quotes WHERE id = NEW.quote_id AND version = NEW.quote_version;
    IF quote_student IS NULL OR quote_student <> NEW.student_id
      OR quote_opportunity <> NEW.opportunity_id THEN
      RAISE EXCEPTION '订单与报价学生或商机不一致' USING ERRCODE='23514';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.order_state = 'accepted' AND NEW.amount_due_cents <> OLD.amount_due_cents THEN
      RAISE EXCEPTION '已接受订单金额不可直接覆盖；必须进行业务调整' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_guard_sales_order_identity
  BEFORE INSERT OR UPDATE ON ms.sales_orders
  FOR EACH ROW EXECUTE FUNCTION ms.guard_sales_order_identity();

CREATE FUNCTION ms.guard_quote_identity() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE student UUID;
BEGIN
  SELECT student_id INTO student FROM ms.opportunities WHERE id=NEW.opportunity_id;
  IF student IS NULL OR student <> NEW.student_id THEN
    RAISE EXCEPTION '报价与商机学生身份不一致' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_guard_quote_identity
  BEFORE INSERT OR UPDATE ON ms.quotes
  FOR EACH ROW EXECUTE FUNCTION ms.guard_quote_identity();

CREATE FUNCTION ms.guard_student_contact_organization() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM ms.students s JOIN ms.contacts c
      ON s.organization_id = c.organization_id
    WHERE s.id = NEW.student_id AND c.id = NEW.contact_id
  ) THEN RAISE EXCEPTION '学生与联系人分属不同机构' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_guard_student_contact_org
  BEFORE INSERT OR UPDATE ON ms.student_contacts
  FOR EACH ROW EXECUTE FUNCTION ms.guard_student_contact_organization();

CREATE FUNCTION ms.guard_family_membership_organization() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM ms.students s JOIN ms.family_groups g
      ON s.organization_id = g.organization_id
    WHERE s.id = NEW.student_id AND g.id = NEW.family_group_id
  ) THEN RAISE EXCEPTION '家庭组与学生分属不同机构' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_guard_family_member_org
  BEFORE INSERT OR UPDATE ON ms.family_memberships
  FOR EACH ROW EXECUTE FUNCTION ms.guard_family_membership_organization();

-- Historical financial allocation rows cannot be deleted.
CREATE FUNCTION ms.guard_allocation_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '财务分配历史不可直接删除；应追加有依据的撤销记录'
    USING ERRCODE='23514';
END $$;
CREATE TRIGGER trg_payment_allocation_no_delete
  BEFORE DELETE ON ms.payment_allocations FOR EACH ROW
  EXECUTE FUNCTION ms.guard_allocation_delete();
CREATE TRIGGER trg_refund_allocation_no_delete
  BEFORE DELETE ON ms.refund_allocations FOR EACH ROW
  EXECUTE FUNCTION ms.guard_allocation_delete();

-- Atomic count updates on the two parent rows. Works even when two different
-- writers try to allocate the same real receipt at the same time.
CREATE FUNCTION ms.guard_payment_allocation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  receipt ms.payment_receipt_projections%ROWTYPE;
  ord ms.sales_orders%ROWTYPE;
  delta BIGINT := 0;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id <> OLD.id OR NEW.receipt_id <> OLD.receipt_id
       OR NEW.order_id <> OLD.order_id OR NEW.allocated_cents <> OLD.allocated_cents THEN
      RAISE EXCEPTION '分配对象或金额不可覆盖；请撤销并新建分配' USING ERRCODE='23514';
    END IF;
    IF (OLD.allocation_state = 'reversed')
       OR (OLD.allocation_state = 'confirmed' AND NEW.allocation_state NOT IN ('confirmed','reversed'))
       OR (OLD.allocation_state = 'proposed' AND NEW.allocation_state NOT IN ('proposed','confirmed','reversed')) THEN
      RAISE EXCEPTION '不允许的付款分配状态转换' USING ERRCODE='23514';
    END IF;
    IF OLD.allocation_state = 'confirmed' AND NEW.allocation_state = 'reversed' THEN
      delta := -OLD.allocated_cents;
    ELSIF OLD.allocation_state <> 'confirmed' AND NEW.allocation_state = 'confirmed' THEN
      delta := NEW.allocated_cents;
    END IF;
  ELSIF NEW.allocation_state = 'confirmed' THEN
    delta := NEW.allocated_cents;
  END IF;

  IF delta <> 0 THEN
    SELECT * INTO receipt FROM ms.payment_receipt_projections
      WHERE id=NEW.receipt_id FOR UPDATE;
    SELECT * INTO ord FROM ms.sales_orders WHERE id=NEW.order_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION '订单不存在' USING ERRCODE='23503'; END IF;
    IF delta > 0 AND (receipt.verification_state <> 'confirmed'
         OR receipt.verified_at IS NULL OR ord.order_state <> 'accepted'
         OR NEW.confirmed_at IS NULL OR NEW.confirmed_by IS NULL
         OR NEW.allocation_basis_ref IS NULL OR trim(NEW.allocation_basis_ref) = '') THEN
      RAISE EXCEPTION '付款尚未核实、订单未被接受或分配审批证据不完整'
        USING ERRCODE='23514';
    END IF;
    IF receipt.currency <> ord.currency THEN
      RAISE EXCEPTION '付款与订单币种不一致' USING ERRCODE='23514';
    END IF;

    UPDATE ms.payment_receipt_projections
      SET allocated_cents = allocated_cents + delta
      WHERE id=NEW.receipt_id
        AND allocated_cents + delta >= 0
        AND allocated_cents + delta <= amount_cents;
    IF NOT FOUND THEN
      RAISE EXCEPTION '付款金额超过可分配余额' USING ERRCODE='23514';
    END IF;
    UPDATE ms.sales_orders SET net_allocated_cents = net_allocated_cents + delta
      WHERE id=NEW.order_id
        AND net_allocated_cents + delta >= 0
        AND net_allocated_cents + delta <= amount_due_cents;
    IF NOT FOUND THEN
      RAISE EXCEPTION '学生订单金额不足或冲正顺序不合法' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_guard_payment_allocation
  BEFORE INSERT OR UPDATE ON ms.payment_allocations
  FOR EACH ROW EXECUTE FUNCTION ms.guard_payment_allocation();

CREATE FUNCTION ms.record_payment_allocation_history() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.allocation_state IS DISTINCT FROM OLD.allocation_state THEN
    INSERT INTO ms.payment_allocation_history (
      allocation_id,receipt_id,order_id,amount_cents,before_state,after_state,confirmed_by,evidence_ref
    ) VALUES (
      NEW.id,NEW.receipt_id,NEW.order_id,NEW.allocated_cents,
      CASE WHEN TG_OP='INSERT' THEN NULL ELSE OLD.allocation_state END,
      NEW.allocation_state,NEW.confirmed_by,NEW.allocation_basis_ref
    );
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_record_payment_allocation_history
  AFTER INSERT OR UPDATE ON ms.payment_allocations
  FOR EACH ROW EXECUTE FUNCTION ms.record_payment_allocation_history();

-- Refunds must be grounded in a verified refund fact AND a unique source
-- economic event. The effect of a disputed/revoked receipt is intentionally NOT
-- handled by this simple counter; that requires TP-03/04 policy and reconciliation.
CREATE FUNCTION ms.guard_refund_allocation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  refund ms.refund_projections%ROWTYPE;
  delta BIGINT := 0;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.id <> OLD.id OR NEW.refund_id <> OLD.refund_id
      OR NEW.order_id <> OLD.order_id OR NEW.allocated_cents <> OLD.allocated_cents
      OR NEW.order_item_id IS DISTINCT FROM OLD.order_item_id THEN
      RAISE EXCEPTION '退款对象或金额不可覆盖' USING ERRCODE='23514';
    END IF;
    IF OLD.allocation_state='reversed'
       OR (OLD.allocation_state='confirmed' AND NEW.allocation_state NOT IN ('confirmed','reversed'))
       OR (OLD.allocation_state='proposed' AND NEW.allocation_state NOT IN ('proposed','confirmed','reversed')) THEN
      RAISE EXCEPTION '不允许的退款分配状态转换' USING ERRCODE='23514';
    END IF;
    IF OLD.allocation_state='confirmed' AND NEW.allocation_state='reversed' THEN
      delta := -OLD.allocated_cents;
    ELSIF OLD.allocation_state <> 'confirmed' AND NEW.allocation_state='confirmed' THEN
      delta := NEW.allocated_cents;
    END IF;
  ELSIF NEW.allocation_state='confirmed' THEN
    delta := NEW.allocated_cents;
  END IF;

  IF delta <> 0 THEN
    SELECT * INTO refund FROM ms.refund_projections WHERE id=NEW.refund_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION '退款记录不存在' USING ERRCODE='23503'; END IF;
    -- Root receipt association is mandatory for a real refund allocation.
    IF delta > 0 AND (refund.verification_state <> 'confirmed'
      OR refund.verified_at IS NULL OR refund.original_receipt_id IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM ms.finance_economic_events e
        WHERE e.refund_id=refund.id
          AND e.original_receipt_id=refund.original_receipt_id
          AND e.kind='refund' AND e.verification_state='confirmed'
          AND e.amount_cents=refund.amount_cents
      )) THEN
      RAISE EXCEPTION '退款缺少可信源凭据或经济事件唯一关联'
        USING ERRCODE='23514';
    END IF;
    IF delta > 0 AND NOT EXISTS (
      SELECT 1 FROM ms.payment_allocations pa
      WHERE pa.receipt_id=refund.original_receipt_id AND pa.order_id=NEW.order_id
        AND pa.allocation_state='confirmed'
    ) THEN
      RAISE EXCEPTION '退款必须对应原付款实际分配到的订单'
        USING ERRCODE='23514';
    END IF;
    IF NEW.order_item_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM ms.sales_order_items i
      WHERE i.id=NEW.order_item_id AND i.order_id=NEW.order_id
    ) THEN
      RAISE EXCEPTION '退款课程明细不属于当前订单' USING ERRCODE='23514';
    END IF;
    UPDATE ms.refund_projections SET allocated_cents = allocated_cents + delta
      WHERE id=NEW.refund_id AND allocated_cents + delta >= 0
        AND allocated_cents + delta <= amount_cents;
    IF NOT FOUND THEN
      RAISE EXCEPTION '退款分配金额超过权威退款金额' USING ERRCODE='23514';
    END IF;
    UPDATE ms.sales_orders SET net_allocated_cents = net_allocated_cents - delta
      WHERE id=NEW.order_id AND net_allocated_cents - delta >= 0
        AND net_allocated_cents - delta <= amount_due_cents;
    IF NOT FOUND THEN
      RAISE EXCEPTION '退款超出学生订单有效已付净额' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_guard_refund_allocation
  BEFORE INSERT OR UPDATE ON ms.refund_allocations
  FOR EACH ROW EXECUTE FUNCTION ms.guard_refund_allocation();

CREATE FUNCTION ms.record_refund_allocation_history() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' OR NEW.allocation_state IS DISTINCT FROM OLD.allocation_state THEN
    INSERT INTO ms.refund_allocation_history (
      allocation_id,refund_id,order_id,amount_cents,before_state,after_state,reason
    ) VALUES (
      NEW.id,NEW.refund_id,NEW.order_id,NEW.allocated_cents,
      CASE WHEN TG_OP='INSERT' THEN NULL ELSE OLD.allocation_state END,
      NEW.allocation_state,NEW.reason
    );
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_record_refund_allocation_history
  AFTER INSERT OR UPDATE ON ms.refund_allocations
  FOR EACH ROW EXECUTE FUNCTION ms.record_refund_allocation_history();

-- A sale event cannot be inserted for an unpaid/disputed order, even if an
-- application attempts to manipulate payment_state manually.
CREATE FUNCTION ms.guard_sale_recognition() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  ord ms.sales_orders%ROWTYPE;
  effective_gross BIGINT;
  effective_refunds BIGINT;
BEGIN
  SELECT * INTO ord FROM ms.sales_orders WHERE id=NEW.order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '成交订单不存在' USING ERRCODE='23503'; END IF;
  IF ord.order_state <> 'accepted' OR ord.amount_due_cents <= 0
     OR NEW.recognized_amount_cents <> ord.amount_due_cents THEN
    RAISE EXCEPTION '成交必须基于有效且金额一致的已接受订单'
      USING ERRCODE='23514';
  END IF;
  -- Any still-confirmed allocation of a revoked/disputed receipt is a blocking
  -- financial inconsistency, even if a stale local counter says fully paid.
  IF EXISTS (
    SELECT 1 FROM ms.payment_allocations pa JOIN ms.payment_receipt_projections r
      ON r.id=pa.receipt_id
    WHERE pa.order_id=ord.id AND pa.allocation_state='confirmed'
      AND (r.verification_state <> 'confirmed' OR r.verified_at IS NULL)
  ) THEN RAISE EXCEPTION '订单包含待核实或已撤销收款' USING ERRCODE='23514'; END IF;
  SELECT COALESCE(SUM(pa.allocated_cents),0) INTO effective_gross
    FROM ms.payment_allocations pa JOIN ms.payment_receipt_projections r
    ON r.id=pa.receipt_id
    WHERE pa.order_id=ord.id AND pa.allocation_state='confirmed'
      AND r.verification_state='confirmed' AND r.verified_at IS NOT NULL;
  SELECT COALESCE(SUM(ra.allocated_cents),0) INTO effective_refunds
    FROM ms.refund_allocations ra JOIN ms.refund_projections rf
    ON rf.id=ra.refund_id
    WHERE ra.order_id=ord.id AND ra.allocation_state='confirmed'
      AND rf.verification_state='confirmed' AND rf.verified_at IS NOT NULL;
  IF effective_gross - effective_refunds < ord.amount_due_cents
     OR effective_gross - effective_refunds <> ord.net_allocated_cents THEN
    RAISE EXCEPTION '订单尚未达到经财务核实的全额净付款条件'
      USING ERRCODE='23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM ms.sales_orders o JOIN ms.opportunities p ON p.id=o.opportunity_id
    WHERE o.id=ord.id AND p.owner_user_id <> NEW.owner_snapshot_id
  ) THEN
    RAISE EXCEPTION '成交负责人快照与商机当前负责人不一致'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_guard_sale_recognition
  BEFORE INSERT ON ms.sale_events
  FOR EACH ROW EXECUTE FUNCTION ms.guard_sale_recognition();

-- A finance revision may only progress if both versions are comparable; a
-- source without verifiable monotonic revisions must be kept in manual review.
CREATE FUNCTION ms.guard_finance_source_revision() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.source_revision IS NOT NULL
     AND (NEW.source_revision IS NULL OR NEW.source_revision < OLD.source_revision) THEN
    RAISE EXCEPTION '财务来源旧版本不得覆盖较新状态' USING ERRCODE='23514';
  END IF;
  IF NEW.source_revision IS NOT DISTINCT FROM OLD.source_revision
     AND NEW.verification_state IS DISTINCT FROM OLD.verification_state THEN
    RAISE EXCEPTION '财务状态变化必须有更新的权威版本'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_guard_receipt_source_revision
  BEFORE UPDATE OF verification_state, source_revision ON ms.payment_receipt_projections
  FOR EACH ROW EXECUTE FUNCTION ms.guard_finance_source_revision();
CREATE TRIGGER trg_guard_refund_source_revision
  BEFORE UPDATE OF verification_state, source_revision ON ms.refund_projections
  FOR EACH ROW EXECUTE FUNCTION ms.guard_finance_source_revision();

-- DB permissions and later transaction services must prevent arbitrary DML on
-- the sale_events, finance projection, audit and ledger tables. The triggers
-- above are safety nets, not a substitute for approved business commands.
COMMIT;
