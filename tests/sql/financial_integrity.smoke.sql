-- V3.1-04 isolated PostgreSQL smoke tests (fictional data only).
-- Run AFTER 001_initial_schema.sql and 002_financial_integrity_draft.sql.
-- psql -v ON_ERROR_STOP=1 -f tests/sql/financial_integrity.smoke.sql
BEGIN;
INSERT INTO ms.organizations(id,name)
VALUES ('00000000-0000-4000-8000-000000000001','虚拟培训机构');
INSERT INTO ms.staff_users(id,organization_id,display_name)
VALUES
('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000001','模拟销售A'),
('00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000001','模拟销售B');
INSERT INTO ms.students(id,organization_id,display_name,owner_user_id)
VALUES
('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000001','模拟学生哥哥','00000000-0000-4000-8000-000000000011'),
('00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000001','模拟学生妹妹','00000000-0000-4000-8000-000000000012');
INSERT INTO ms.contacts(id,organization_id,display_name)
VALUES ('00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000001','模拟家长');
INSERT INTO ms.student_contacts(student_id,contact_id,relation_type)
VALUES
('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000201','father'),
('00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000201','father');
DO $$
BEGIN
  IF (SELECT count(*) FROM ms.family_groups) <> 0 THEN
    RAISE EXCEPTION 'Shared parent must NOT create an automatic family group';
  END IF;
END $$;

INSERT INTO ms.opportunities(id,student_id,owner_user_id)
VALUES
('00000000-0000-4000-8000-000000000301','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000011'),
('00000000-0000-4000-8000-000000000302','00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000012');
INSERT INTO ms.sales_orders(id,student_id,opportunity_id,amount_due_cents,order_state)
VALUES
('00000000-0000-4000-8000-000000000401','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000301',600000,'accepted'),
('00000000-0000-4000-8000-000000000402','00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000302',400000,'accepted');

-- Must NOT allow an order tied to another student's opportunity.
DO $$
BEGIN
  BEGIN
    INSERT INTO ms.sales_orders(student_id,opportunity_id,amount_due_cents)
    VALUES ('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000302',300000);
    RAISE EXCEPTION 'FAIL: mismatched student/opportunity was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

INSERT INTO ms.payment_receipt_projections
(id,authority_system,external_payment_id,amount_cents,verification_state,verified_at,source_revision)
VALUES
('00000000-0000-4000-8000-000000000501','fictional-finance','mock-receipt-1',600000,'confirmed',now(),1);

-- First verified allocation goes entirely to the brother's order.
INSERT INTO ms.payment_allocations
(id,receipt_id,order_id,allocated_cents,allocation_state,confirmed_by,confirmed_at,allocation_basis_ref)
VALUES
('00000000-0000-4000-8000-000000000701',
 '00000000-0000-4000-8000-000000000501',
 '00000000-0000-4000-8000-000000000401',600000,'confirmed',
 '00000000-0000-4000-8000-000000000011',now(),'mock-parent-designation');

DO $$
BEGIN
  IF (SELECT allocated_cents FROM ms.payment_receipt_projections
       WHERE id='00000000-0000-4000-8000-000000000501') <> 600000 THEN
    RAISE EXCEPTION 'FAIL: allocated receipt counter';
  END IF;
  IF (SELECT net_allocated_cents FROM ms.sales_orders
       WHERE id='00000000-0000-4000-8000-000000000401') <> 600000 THEN
    RAISE EXCEPTION 'FAIL: brother fully paid counter';
  END IF;
  IF (SELECT net_allocated_cents FROM ms.sales_orders
       WHERE id='00000000-0000-4000-8000-000000000402') <> 0 THEN
    RAISE EXCEPTION 'FAIL: sister must remain unpaid';
  END IF;
END $$;

-- Same payment cannot also fund the sister's order.
DO $$
BEGIN
  BEGIN
    INSERT INTO ms.payment_allocations
      (receipt_id,order_id,allocated_cents,allocation_state,confirmed_by,confirmed_at,allocation_basis_ref)
    VALUES
      ('00000000-0000-4000-8000-000000000501',
       '00000000-0000-4000-8000-000000000402',100,'confirmed',
       '00000000-0000-4000-8000-000000000011',now(),'mock-invalid-double-allocation');
    RAISE EXCEPTION 'FAIL: over-allocated a real receipt';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

-- A manually overwritten payment_state must not manufacture a SaleEvent.
UPDATE ms.sales_orders SET payment_state='fully_paid'
WHERE id='00000000-0000-4000-8000-000000000402';
DO $$
BEGIN
  BEGIN
    INSERT INTO ms.sale_events(order_id,recognized_amount_cents,recognized_at,owner_snapshot_id,authority_evidence)
    VALUES
     ('00000000-0000-4000-8000-000000000402',400000,now(),
      '00000000-0000-4000-8000-000000000012','{"mock":"invalid"}');
    RAISE EXCEPTION 'FAIL: recognized unpaid sister';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

INSERT INTO ms.sale_events
(id,order_id,recognized_amount_cents,recognized_at,owner_snapshot_id,authority_evidence)
VALUES
('00000000-0000-4000-8000-000000000801',
 '00000000-0000-4000-8000-000000000401',600000,now(),
 '00000000-0000-4000-8000-000000000011','{"source":"fictional-finance","payment":"mock-receipt-1"}');

-- A single order cannot produce a second first-sale event.
DO $$
BEGIN
  BEGIN
    INSERT INTO ms.sale_events(order_id,recognized_amount_cents,recognized_at,owner_snapshot_id,authority_evidence)
    VALUES
     ('00000000-0000-4000-8000-000000000401',600000,now(),
      '00000000-0000-4000-8000-000000000011','{"mock":"duplicate"}');
    RAISE EXCEPTION 'FAIL: duplicate first sale';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $$;

INSERT INTO ms.refund_projections
(id,authority_system,external_refund_id,original_receipt_id,amount_cents,verification_state,verified_at,source_revision)
VALUES
('00000000-0000-4000-8000-000000000601','fictional-finance','mock-refund-1',
 '00000000-0000-4000-8000-000000000501',100000,'confirmed',now(),1);

INSERT INTO ms.finance_economic_events
(authority_system,economic_event_key,kind,original_receipt_id,refund_id,amount_cents,verification_state,verified_at)
VALUES
('fictional-finance','economic-event-1','refund',
 '00000000-0000-4000-8000-000000000501',
 '00000000-0000-4000-8000-000000000601',100000,'confirmed',now());

INSERT INTO ms.refund_allocations
(id,refund_id,order_id,allocated_cents,allocation_state,reason)
VALUES
('00000000-0000-4000-8000-000000000901',
 '00000000-0000-4000-8000-000000000601',
 '00000000-0000-4000-8000-000000000401',
 100000,'confirmed','虚构模拟退款');

DO $$
BEGIN
  IF (SELECT net_allocated_cents FROM ms.sales_orders
       WHERE id='00000000-0000-4000-8000-000000000401') <> 500000 THEN
    RAISE EXCEPTION 'FAIL: confirmed refund did not reduce order net payment';
  END IF;
  IF (SELECT count(*) FROM ms.sale_events
       WHERE order_id='00000000-0000-4000-8000-000000000401') <> 1 THEN
    RAISE EXCEPTION 'FAIL: refund deleted or duplicated the original sale';
  END IF;
END $$;

-- A second refund allocation of the same refund amount must fail.
DO $$
BEGIN
  BEGIN
    INSERT INTO ms.refund_allocations(refund_id,order_id,allocated_cents,allocation_state,reason)
    VALUES ('00000000-0000-4000-8000-000000000601',
      '00000000-0000-4000-8000-000000000401',1,'confirmed','重复冲减尝试');
    RAISE EXCEPTION 'FAIL: same refund was allocated twice';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

-- The original sale event is immutable and the approved credit version is unique.
INSERT INTO ms.sales_credit_versions(sale_event_id,allocation_version,approval_state,approved_by,approved_at)
VALUES
('00000000-0000-4000-8000-000000000801',1,'approved',
 '00000000-0000-4000-8000-000000000012',now());
DO $$
BEGIN
  BEGIN
    INSERT INTO ms.sales_credit_versions(sale_event_id,allocation_version,approval_state,approved_by,approved_at)
    VALUES
     ('00000000-0000-4000-8000-000000000801',2,'approved',
      '00000000-0000-4000-8000-000000000012',now());
    RAISE EXCEPTION 'FAIL: multiple active approved credit versions';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $$;

DO $$
BEGIN
  IF (SELECT count(*) FROM ms.payment_allocation_history
       WHERE allocation_id='00000000-0000-4000-8000-000000000701') <> 1 THEN
    RAISE EXCEPTION 'FAIL: payment allocation history missing';
  END IF;
  IF (SELECT count(*) FROM ms.refund_allocation_history
       WHERE allocation_id='00000000-0000-4000-8000-000000000901') <> 1 THEN
    RAISE EXCEPTION 'FAIL: refund allocation history missing';
  END IF;
END $$;
ROLLBACK;
