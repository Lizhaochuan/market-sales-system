-- Fictional identity ONLY; no existing salesperson or manager gains finance access.
INSERT INTO ms.staff_users(id,organization_id,display_name,external_identity_ref)
VALUES('34000000-0000-4000-8000-000000000015','20000000-0000-4000-8000-000000000001','模拟收款核实员','demo:finance') ON CONFLICT DO NOTHING;
INSERT INTO ms.role_templates(id,organization_id,role_code,label_zh)
VALUES('34000000-0000-4000-8000-000000000035','20000000-0000-4000-8000-000000000001','finance_verifier','隔离收款核实员') ON CONFLICT DO NOTHING;
INSERT INTO ms.user_role_grants(user_id,role_id,granted_by)
SELECT '34000000-0000-4000-8000-000000000015','34000000-0000-4000-8000-000000000035','20000000-0000-4000-8000-000000000013'
WHERE NOT EXISTS(SELECT 1 FROM ms.user_role_grants WHERE user_id='34000000-0000-4000-8000-000000000015' AND role_id='34000000-0000-4000-8000-000000000035');

INSERT INTO ms_workspace.records(id,organization_id,owner_user_id,kind,state,body) VALUES
('34000000-0000-4000-8000-000000000081','20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000013','course-catalog','active','{"course_label":"数学","standard_unit_cents":15000,"price_source":"LOCAL_APPROVED_PRICE","v34":true}'),
('34000000-0000-4000-8000-000000000082','20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000013','course-catalog','active','{"course_label":"英语","standard_unit_cents":20000,"price_source":"LOCAL_APPROVED_PRICE","v34":true}') ON CONFLICT DO NOTHING;
INSERT INTO ms_workspace.history(record_id,version,actor_user_id,state,body)
SELECT id,version,owner_user_id,state,body FROM ms_workspace.records WHERE id IN('34000000-0000-4000-8000-000000000081','34000000-0000-4000-8000-000000000082') ON CONFLICT DO NOTHING;
