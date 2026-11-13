-- Isolated two-connection race fixture: two students, two 4,000-yuan orders,
-- only one authority-confirmed 6,000-yuan payment. Both writers try to
-- allocate 4,000 yuan concurrently. Exactly one must be accepted.
BEGIN;
INSERT INTO ms.organizations(id,name) VALUES
('10000000-0000-4000-8000-000000000001','虚构并发测试机构');
INSERT INTO ms.staff_users(id,organization_id,display_name) VALUES
('10000000-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000001','虚构测试财务');
INSERT INTO ms.students(id,organization_id,display_name) VALUES
('10000000-0000-4000-8000-000000000101','10000000-0000-4000-8000-000000000001','虚构学生甲'),
('10000000-0000-4000-8000-000000000102','10000000-0000-4000-8000-000000000001','虚构学生乙');
INSERT INTO ms.opportunities(id,student_id,owner_user_id) VALUES
('10000000-0000-4000-8000-000000000301','10000000-0000-4000-8000-000000000101','10000000-0000-4000-8000-000000000011'),
('10000000-0000-4000-8000-000000000302','10000000-0000-4000-8000-000000000102','10000000-0000-4000-8000-000000000011');
INSERT INTO ms.sales_orders(id,student_id,opportunity_id,amount_due_cents,order_state) VALUES
('10000000-0000-4000-8000-000000000401','10000000-0000-4000-8000-000000000101','10000000-0000-4000-8000-000000000301',400000,'accepted'),
('10000000-0000-4000-8000-000000000402','10000000-0000-4000-8000-000000000102','10000000-0000-4000-8000-000000000302',400000,'accepted');
INSERT INTO ms.payment_receipt_projections
(id,authority_system,external_payment_id,amount_cents,verification_state,verified_at,source_revision)
VALUES
('10000000-0000-4000-8000-000000000501','fictional-finance','race-receipt',600000,'confirmed',now(),1);
COMMIT;
