-- V3.2-02 fictional demonstration identities only. NEVER seed production.
-- Values are deterministic so a local operator can select named demo accounts.
BEGIN;
INSERT INTO ms.organizations(id,name)
VALUES ('20000000-0000-4000-8000-000000000001','虚构教学服务机构');
INSERT INTO ms.staff_users(id,organization_id,display_name,external_identity_ref) VALUES
('20000000-0000-4000-8000-000000000011',
 '20000000-0000-4000-8000-000000000001','模拟销售顾问 A','demo:sales-a'),
('20000000-0000-4000-8000-000000000012',
 '20000000-0000-4000-8000-000000000001','模拟销售顾问 B','demo:sales-b'),
('20000000-0000-4000-8000-000000000013',
 '20000000-0000-4000-8000-000000000001','模拟销售主管','demo:supervisor'),
('20000000-0000-4000-8000-000000000014',
 '20000000-0000-4000-8000-000000000001','模拟第二主管','demo:supervisor-2');
INSERT INTO ms.role_templates(id,organization_id,role_code,label_zh)
VALUES ('20000000-0000-4000-8000-000000000031',
 '20000000-0000-4000-8000-000000000001','sales_manager','演示销售主管');
INSERT INTO ms.user_role_grants(user_id,role_id,granted_by)
VALUES ('20000000-0000-4000-8000-000000000013',
 '20000000-0000-4000-8000-000000000031',
 '20000000-0000-4000-8000-000000000013'),
('20000000-0000-4000-8000-000000000014',
 '20000000-0000-4000-8000-000000000031',
 '20000000-0000-4000-8000-000000000013');
COMMIT;
