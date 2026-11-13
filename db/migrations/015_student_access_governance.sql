-- V3.2-11 isolated student-centered access governance.
-- Disposable fictional PostgreSQL only, AFTER 001..014. Never production CRM.
BEGIN;
ALTER TABLE ms.data_scope_grants
  ADD COLUMN expires_at TIMESTAMPTZ,
  ADD COLUMN access_request_id UUID;
CREATE INDEX idx_scope_grants_live_student ON ms.data_scope_grants
  (user_id,scope_ref,expires_at)
  WHERE resource_type='student' AND scope_type='specific' AND revoked_at IS NULL;

CREATE TABLE ms.student_access_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES ms.organizations(id),
  student_id UUID NOT NULL REFERENCES ms.students(id),
  requested_by UUID NOT NULL REFERENCES ms.staff_users(id),
  target_staff_id UUID NOT NULL REFERENCES ms.staff_users(id),
  action TEXT NOT NULL CHECK(action IN ('share','transfer')),
  expires_at TIMESTAMPTZ,
  evidence_ref TEXT NOT NULL CHECK(length(trim(evidence_ref)) BETWEEN 1 AND 200),
  reason_zh TEXT NOT NULL CHECK(length(trim(reason_zh)) BETWEEN 2 AND 400),
  request_key TEXT NOT NULL CHECK(length(request_key) BETWEEN 16 AND 128),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','approved','rejected')),
  reviewed_by UUID REFERENCES ms.staff_users(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(requested_by,request_key),
  CHECK((action='share' AND expires_at IS NOT NULL) OR
        (action='transfer' AND expires_at IS NULL)),
  CHECK((status='pending' AND reviewed_by IS NULL AND reviewed_at IS NULL) OR
        (status<>'pending' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
);
CREATE UNIQUE INDEX uq_student_pending_transfer
  ON ms.student_access_requests(student_id) WHERE action='transfer' AND status='pending';
CREATE UNIQUE INDEX uq_student_pending_share
  ON ms.student_access_requests(student_id,target_staff_id)
  WHERE action='share' AND status='pending';
ALTER TABLE ms.data_scope_grants
  ADD CONSTRAINT fk_access_grant_approved_request
  FOREIGN KEY (access_request_id) REFERENCES ms.student_access_requests(id);

CREATE TABLE ms.student_access_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL UNIQUE REFERENCES ms.student_access_requests(id),
  reviewer_id UUID NOT NULL REFERENCES ms.staff_users(id),
  decision TEXT NOT NULL CHECK(decision IN ('approved','rejected')),
  evidence_ref TEXT NOT NULL CHECK(length(trim(evidence_ref)) BETWEEN 1 AND 200),
  reason_zh TEXT NOT NULL CHECK(length(trim(reason_zh)) BETWEEN 2 AND 400),
  request_key TEXT NOT NULL,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(reviewer_id,request_key)
);
CREATE TABLE ms.student_owner_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL UNIQUE REFERENCES ms.student_access_requests(id),
  student_id UUID NOT NULL REFERENCES ms.students(id),
  previous_owner_id UUID NOT NULL REFERENCES ms.staff_users(id),
  new_owner_id UUID NOT NULL REFERENCES ms.staff_users(id),
  approved_by UUID NOT NULL REFERENCES ms.staff_users(id),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE ms.student_access_revocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_id UUID NOT NULL UNIQUE REFERENCES ms.data_scope_grants(id),
  organization_id UUID NOT NULL REFERENCES ms.organizations(id),
  student_id UUID NOT NULL REFERENCES ms.students(id),
  revoked_by UUID NOT NULL REFERENCES ms.staff_users(id),
  reason_zh TEXT NOT NULL CHECK(length(trim(reason_zh)) BETWEEN 2 AND 400),
  request_key TEXT NOT NULL,
  revoked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(revoked_by,request_key)
);

-- The new tables are deliberately NOT granted to runtime roles and are
-- RLS-denied by default, even if future accidental grants occur.
ALTER TABLE ms.student_access_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE ms.student_access_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ms.student_owner_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE ms.student_access_revocations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON
  ms.student_access_requests,ms.student_access_decisions,
  ms.student_owner_changes,ms.student_access_revocations FROM PUBLIC;
REVOKE ALL ON
  ms.student_access_requests,ms.student_access_decisions,
  ms.student_owner_changes,ms.student_access_revocations FROM ms_lowrisk_runtime;

-- Audit facts never mutable by an application role or privileged migration
-- operator after insertion: only a new correction event may be appended.
CREATE FUNCTION ms.reject_access_history_mutation() RETURNS trigger
LANGUAGE plpgsql AS $immutable$
BEGIN
 RAISE EXCEPTION '已审核的授权历史不得修改或删除'
   USING ERRCODE='23514';
END $immutable$;
CREATE TRIGGER immutable_access_decision
  BEFORE UPDATE OR DELETE ON ms.student_access_decisions
  FOR EACH ROW EXECUTE FUNCTION ms.reject_access_history_mutation();
CREATE TRIGGER immutable_owner_change
  BEFORE UPDATE OR DELETE ON ms.student_owner_changes
  FOR EACH ROW EXECUTE FUNCTION ms.reject_access_history_mutation();
CREATE TRIGGER immutable_access_revocation
  BEFORE UPDATE OR DELETE ON ms.student_access_revocations
  FOR EACH ROW EXECUTE FUNCTION ms.reject_access_history_mutation();

CREATE ROLE ms_student_access_operator NOLOGIN;
GRANT USAGE ON SCHEMA ms TO ms_student_access_operator;
GRANT EXECUTE ON FUNCTION ms.scoped_employee_identity_valid(text,text)
  TO ms_student_access_operator;

-- Functions derive actor solely from protected SESSION_USER principal mapping.
-- They are intentionally not callable by PUBLIC or organization-wide runtime.
CREATE FUNCTION ms.access_actor() RETURNS TABLE(staff_id uuid, org_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,ms
AS $actor$
 SELECT s.id,s.organization_id FROM ms.database_principal_staff p
 JOIN ms.staff_users s ON s.id=p.staff_user_id
 JOIN ms.organizations o ON o.id=s.organization_id
 WHERE p.principal_name=session_user::name
   AND p.organization_id=s.organization_id
   AND s.status='active' AND o.status='active' LIMIT 1
$actor$;
REVOKE ALL ON FUNCTION ms.access_actor() FROM PUBLIC;

CREATE FUNCTION ms.request_student_access(
 p_action text,p_student uuid,p_target uuid,p_expiry timestamptz,
 p_evidence text,p_reason text,p_key text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ms
AS $request$
DECLARE actor_id uuid; org uuid; old_request ms.student_access_requests%ROWTYPE;
  current_owner uuid; existing_id uuid;
BEGIN
 SELECT staff_id,org_id INTO actor_id,org FROM ms.access_actor();
 IF actor_id IS NULL THEN RAISE EXCEPTION '员工授权无效' USING ERRCODE='42501'; END IF;
 IF p_key IS NULL OR length(p_key)<16 OR length(p_key)>128
   OR p_key !~ '^[a-zA-Z0-9_-]+$'
   OR p_action NOT IN ('share','transfer')
   OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 2 AND 400
   OR p_evidence IS NULL OR length(trim(p_evidence)) NOT BETWEEN 1 AND 200
 THEN RAISE EXCEPTION '授权申请内容不完整' USING ERRCODE='23514'; END IF;
 IF (p_action='share' AND (p_expiry IS NULL OR p_expiry<=now()
     OR p_expiry>now()+INTERVAL '30 days'))
   OR (p_action='transfer' AND p_expiry IS NOT NULL)
 THEN RAISE EXCEPTION '临时共享有效期不正确' USING ERRCODE='23514'; END IF;
 SELECT * INTO old_request FROM ms.student_access_requests
 WHERE requested_by=actor_id AND request_key=p_key;
 IF FOUND THEN
   IF old_request.action=p_action AND old_request.student_id=p_student
     AND old_request.target_staff_id=p_target
     AND old_request.expires_at IS NOT DISTINCT FROM p_expiry
     AND old_request.reason_zh=p_reason AND old_request.evidence_ref=p_evidence
   THEN RETURN old_request.id; END IF;
   RAISE EXCEPTION '防重复编号已经用于其他授权申请' USING ERRCODE='23505';
 END IF;
 SELECT owner_user_id INTO current_owner FROM ms.students
 WHERE id=p_student AND organization_id=org AND archived_at IS NULL FOR UPDATE;
 IF NOT FOUND OR current_owner IS DISTINCT FROM actor_id THEN
   RAISE EXCEPTION '仅学生当前负责人可申请共享或转交' USING ERRCODE='42501';
 END IF;
 IF p_target=actor_id OR NOT EXISTS(
   SELECT 1 FROM ms.staff_users WHERE id=p_target AND organization_id=org AND status='active')
 THEN RAISE EXCEPTION '接收员工必须是本机构其他有效员工'
   USING ERRCODE='23514'; END IF;
 IF p_action='share' AND EXISTS (
   SELECT 1 FROM ms.data_scope_grants g
   WHERE g.user_id=p_target AND g.resource_type='student'
     AND g.scope_type='specific' AND g.scope_ref=p_student
     AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>now())
 ) THEN RAISE EXCEPTION '已有有效共享授权，不得重复申请' USING ERRCODE='23505'; END IF;
 INSERT INTO ms.student_access_requests(
  organization_id,student_id,requested_by,target_staff_id,action,
  expires_at,evidence_ref,reason_zh,request_key
 ) VALUES (org,p_student,actor_id,p_target,p_action,p_expiry,p_evidence,p_reason,p_key)
 RETURNING id INTO existing_id;
 INSERT INTO ms.audit_events(
  organization_id,actor_user_id,target_type,target_id,event_name,reason_zh,after_business_json)
 VALUES (org,actor_id,'student',p_student,'STUDENT_ACCESS_REQUESTED',
   '提出学生查看共享或负责人转交申请',
   jsonb_build_object('申请状态','待独立审批','变更内容',
     CASE WHEN p_action='share' THEN '临时共享查看' ELSE '负责人转交' END));
 RETURN existing_id;
END $request$;
REVOKE ALL ON FUNCTION ms.request_student_access(text,uuid,uuid,timestamptz,text,text,text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ms.request_student_access(text,uuid,uuid,timestamptz,text,text,text)
  TO ms_student_access_operator;

CREATE FUNCTION ms.decide_student_access(
 p_request uuid,p_decision text,p_evidence text,p_reason text,p_key text)
 RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ms
AS $decision$
DECLARE reviewer uuid; org uuid; r ms.student_access_requests%ROWTYPE;
  current_owner uuid; grant_id uuid; old_d ms.student_access_decisions%ROWTYPE;
BEGIN
 SELECT staff_id,org_id INTO reviewer,org FROM ms.access_actor();
 IF reviewer IS NULL THEN RAISE EXCEPTION '审核员工授权无效' USING ERRCODE='42501'; END IF;
 IF p_decision NOT IN ('approved','rejected') OR p_reason IS NULL
   OR length(trim(p_reason)) NOT BETWEEN 2 AND 400
   OR p_evidence IS NULL OR length(trim(p_evidence)) NOT BETWEEN 1 AND 200
   OR p_key IS NULL OR length(p_key) NOT BETWEEN 16 AND 128
   OR p_key !~ '^[a-zA-Z0-9_-]+$'
 THEN RAISE EXCEPTION '独立审批信息不完整' USING ERRCODE='23514'; END IF;
 SELECT * INTO old_d FROM ms.student_access_decisions
 WHERE reviewer_id=reviewer AND request_key=p_key;
 IF FOUND THEN
   IF old_d.request_id=p_request AND old_d.decision=p_decision
      AND old_d.evidence_ref=p_evidence AND old_d.reason_zh=p_reason
   THEN RETURN CASE WHEN p_decision='approved' THEN '已批准' ELSE '已驳回' END; END IF;
   RAISE EXCEPTION '防重复编号已经用于其他审批' USING ERRCODE='23505';
 END IF;
 SELECT * INTO r FROM ms.student_access_requests
 WHERE id=p_request AND organization_id=org FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '没有找到本机构待审核的学生申请' USING ERRCODE='42501'; END IF;
 IF r.status<>'pending' THEN
   RAISE EXCEPTION '申请已作出决定，不得重复审核' USING ERRCODE='23505';
 END IF;
 IF reviewer IN (r.requested_by,r.target_staff_id) THEN
   RAISE EXCEPTION '申请人或接收人不得审核本人申请' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(
   SELECT 1 FROM ms.user_role_grants g
   JOIN ms.role_templates t ON t.id=g.role_id
   WHERE g.user_id=reviewer AND g.revoked_at IS NULL
     AND g.valid_from<=now() AND t.organization_id=org
     AND t.role_code IN ('sales_manager','super_admin')
 ) THEN RAISE EXCEPTION '仅本机构有效独立主管可审核' USING ERRCODE='42501'; END IF;
 SELECT owner_user_id INTO current_owner FROM ms.students
 WHERE id=r.student_id AND organization_id=org AND archived_at IS NULL FOR UPDATE;
 IF NOT FOUND OR current_owner IS DISTINCT FROM r.requested_by THEN
   RAISE EXCEPTION '学生负责人已改变，原申请不得批准' USING ERRCODE='23514';
 END IF;
 IF current_owner=reviewer THEN
   RAISE EXCEPTION '当前学生负责人不得自批' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM ms.staff_users
   WHERE id=r.target_staff_id AND organization_id=org AND status='active')
 THEN RAISE EXCEPTION '接收员工已停用或不属于本机构' USING ERRCODE='23514'; END IF;
 IF p_decision='approved' THEN
   IF r.action='share' THEN
     IF r.expires_at<=now() THEN
       RAISE EXCEPTION '共享申请有效期已过，必须重新申请' USING ERRCODE='23514';
     END IF;
     UPDATE ms.data_scope_grants SET revoked_at=now()
       WHERE user_id=r.target_staff_id AND scope_ref=r.student_id
         AND resource_type='student' AND scope_type='specific'
         AND revoked_at IS NULL AND expires_at<=now();
     IF EXISTS (SELECT 1 FROM ms.data_scope_grants
         WHERE user_id=r.target_staff_id AND scope_ref=r.student_id
         AND resource_type='student' AND scope_type='specific'
         AND revoked_at IS NULL)
     THEN RAISE EXCEPTION '存在其他有效授权，请重新核对' USING ERRCODE='23505'; END IF;
     INSERT INTO ms.data_scope_grants(
       user_id,resource_type,scope_type,scope_ref,granted_by,expires_at,access_request_id)
     VALUES(r.target_staff_id,'student','specific',r.student_id,
       reviewer,r.expires_at,r.id) RETURNING id INTO grant_id;
   ELSE
     UPDATE ms.students SET owner_user_id=r.target_staff_id,
       updated_at=now(),version=version+1 WHERE id=r.student_id;
     INSERT INTO ms.student_owner_changes(
       request_id,student_id,previous_owner_id,new_owner_id,approved_by)
     VALUES(r.id,r.student_id,current_owner,r.target_staff_id,reviewer);
     -- Leads, opportunities, money, tuition rights and sibling memberships
     -- are NOT altered by the student-owner transfer.
   END IF;
 END IF;
 INSERT INTO ms.student_access_decisions(
  request_id,reviewer_id,decision,evidence_ref,reason_zh,request_key)
 VALUES(r.id,reviewer,p_decision,p_evidence,p_reason,p_key);
 UPDATE ms.student_access_requests
 SET status=p_decision,reviewed_by=reviewer,reviewed_at=now()
 WHERE id=r.id;
 INSERT INTO ms.audit_events(
   organization_id,actor_user_id,target_type,target_id,event_name,reason_zh,
   after_business_json)
 VALUES (org,reviewer,'student',r.student_id,
   CASE WHEN p_decision='approved' THEN 'STUDENT_ACCESS_APPROVED' ELSE 'STUDENT_ACCESS_REJECTED' END,
   '已完成学生授权或转交的独立审批',
   jsonb_build_object('审核结果',CASE WHEN p_decision='approved' THEN '已批准' ELSE '已驳回' END,
     '操作类型',CASE WHEN r.action='share' THEN '临时查看共享' ELSE '负责人转交' END));
 RETURN CASE WHEN p_decision='approved' THEN '已批准' ELSE '已驳回' END;
END $decision$;
REVOKE ALL ON FUNCTION ms.decide_student_access(uuid,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ms.decide_student_access(uuid,text,text,text,text)
  TO ms_student_access_operator;

CREATE FUNCTION ms.revoke_student_share(p_grant uuid,p_reason text,p_key text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ms
AS $revoke$
DECLARE actor uuid; org uuid; g ms.data_scope_grants%ROWTYPE;
 old ms.student_access_revocations%ROWTYPE; sid uuid; owner uuid;
BEGIN
 SELECT staff_id,org_id INTO actor,org FROM ms.access_actor();
 IF actor IS NULL THEN RAISE EXCEPTION '撤销账号不合法' USING ERRCODE='42501'; END IF;
 IF p_key IS NULL OR length(p_key) NOT BETWEEN 16 AND 128
    OR p_key !~ '^[a-zA-Z0-9_-]+$'
    OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 2 AND 400
 THEN RAISE EXCEPTION '撤销原因及防重复编号必填' USING ERRCODE='23514'; END IF;
 SELECT * INTO old FROM ms.student_access_revocations
 WHERE revoked_by=actor AND request_key=p_key;
 IF FOUND THEN
   IF old.grant_id=p_grant AND old.reason_zh=p_reason THEN RETURN '已撤销'; END IF;
   RAISE EXCEPTION '防重复编号已经用于其他撤销' USING ERRCODE='23505';
 END IF;
 SELECT * INTO g FROM ms.data_scope_grants
 WHERE id=p_grant AND resource_type='student' AND scope_type='specific' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '没有找到对应学生共享权限' USING ERRCODE='42501'; END IF;
 sid:=g.scope_ref;
 SELECT owner_user_id INTO owner FROM ms.students
   WHERE id=sid AND organization_id=org AND archived_at IS NULL;
 IF NOT FOUND OR (actor<>owner AND actor<>g.user_id) THEN
   RAISE EXCEPTION '仅学生负责人或被授权员工可撤销该项共享'
     USING ERRCODE='42501';
 END IF;
 IF g.revoked_at IS NOT NULL THEN
   RAISE EXCEPTION '该项查看授权已经撤销' USING ERRCODE='23505';
 END IF;
 UPDATE ms.data_scope_grants SET revoked_at=now() WHERE id=g.id;
 INSERT INTO ms.student_access_revocations(
   grant_id,organization_id,student_id,revoked_by,reason_zh,request_key)
 VALUES(g.id,org,sid,actor,p_reason,p_key);
 INSERT INTO ms.audit_events(
   organization_id,actor_user_id,target_type,target_id,event_name,reason_zh,
   after_business_json)
 VALUES (org,actor,'student',sid,'STUDENT_SHARE_REVOKED',
   '已撤销某名员工对指定学生的查看授权',
   jsonb_build_object('查看共享状态','已撤销'));
 RETURN '已撤销';
END $revoke$;
REVOKE ALL ON FUNCTION ms.revoke_student_share(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ms.revoke_student_share(uuid,text,text)
  TO ms_student_access_operator;

-- Readable business summaries without exposing internal evidence IDs,
-- raw family proof, contact secrets or administrative SQL.
CREATE FUNCTION ms.list_student_access_requests()
RETURNS TABLE(
 request_id uuid,student_name text,target_name text,
 action_zh text,status_zh text,expires_at timestamptz,created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,ms
AS $list$
 SELECT r.id,s.display_name,target.display_name,
   CASE WHEN r.action='share' THEN '临时共享查看' ELSE '学生负责人转交' END,
   CASE r.status WHEN 'pending' THEN '待独立审批'
     WHEN 'approved' THEN '已批准' ELSE '已驳回' END,
   r.expires_at,r.created_at
 FROM ms.student_access_requests r
 JOIN ms.students s ON s.id=r.student_id
 JOIN ms.staff_users target ON target.id=r.target_staff_id
 JOIN ms.access_actor() a ON a.org_id=r.organization_id
 WHERE r.requested_by=a.staff_id OR (
   EXISTS(SELECT 1 FROM ms.user_role_grants g
     JOIN ms.role_templates t ON t.id=g.role_id
     WHERE g.user_id=a.staff_id AND g.revoked_at IS NULL
     AND g.valid_from<=now() AND t.organization_id=a.org_id
     AND t.role_code IN ('sales_manager','super_admin'))
 )
 ORDER BY r.created_at DESC LIMIT 100
$list$;
REVOKE ALL ON FUNCTION ms.list_student_access_requests() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ms.list_student_access_requests()
  TO ms_student_access_operator;

-- Grant identifiers are disclosed only to the student owner or grantee so
-- those staff can revoke one specific share. No sibling/family proof exposed.
CREATE FUNCTION ms.list_student_share_grants()
RETURNS TABLE(
 grant_id uuid,student_name text,grantee_name text,status_zh text,
 expires_at timestamptz,granted_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,ms
AS $grants$
 SELECT g.id,s.display_name,u.display_name,
   CASE WHEN g.revoked_at IS NOT NULL THEN '已撤销'
     WHEN g.expires_at IS NOT NULL AND g.expires_at<=now() THEN '已到期'
     ELSE '有效' END, g.expires_at,r.created_at
 FROM ms.data_scope_grants g
 JOIN ms.students s ON s.id=g.scope_ref AND s.archived_at IS NULL
 JOIN ms.staff_users u ON u.id=g.user_id
 JOIN ms.student_access_requests r ON r.id=g.access_request_id
 JOIN ms.access_actor() a ON a.org_id=s.organization_id
 WHERE g.resource_type='student' AND g.scope_type='specific'
   AND (s.owner_user_id=a.staff_id OR g.user_id=a.staff_id)
 ORDER BY r.created_at DESC,g.id LIMIT 100
$grants$;
REVOKE ALL ON FUNCTION ms.list_student_share_grants() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ms.list_student_share_grants() TO ms_student_access_operator;

-- Alter existing view in-place without dropping dependent views. Expiry is
-- independently checked in the DB for every student read.
CREATE OR REPLACE VIEW ms.student_directory_assigned
WITH (security_barrier=true) AS
SELECT s.id AS student_id,s.display_name,s.organization_id
FROM ms.students s
JOIN ms.database_principal_staff principal
 ON principal.principal_name=session_user::name
 AND principal.organization_id=s.organization_id
JOIN ms.staff_users staff
 ON staff.id=principal.staff_user_id
 AND staff.organization_id=principal.organization_id
WHERE staff.status='active' AND s.archived_at IS NULL
 AND (
  s.owner_user_id=staff.id
  OR EXISTS (SELECT 1 FROM ms.data_scope_grants g
     WHERE g.user_id=staff.id AND g.resource_type='student'
       AND g.scope_type='specific' AND g.scope_ref=s.id
       AND g.revoked_at IS NULL
       AND (g.expires_at IS NULL OR g.expires_at>now()))
 );

COMMIT;
