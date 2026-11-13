-- V3.2-15: independent supervisor approval for contact CUSTODY only.
-- Historical creator, students, student-contact links, consultations, leads,
-- opportunities, family and payment data are NEVER transferred.
-- Follows 018, isolated fictional PostgreSQL16 ONLY.
BEGIN;

CREATE TABLE ms.contact_custody_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES ms.organizations(id),
 contact_id uuid NOT NULL REFERENCES ms.contacts(id),
 requested_by uuid NOT NULL REFERENCES ms.staff_users(id),
 target_staff_id uuid NOT NULL REFERENCES ms.staff_users(id),
 evidence_ref text NOT NULL CHECK(length(trim(evidence_ref)) BETWEEN 1 AND 200),
 reason_zh text NOT NULL CHECK(length(trim(reason_zh)) BETWEEN 2 AND 400),
 request_key text NOT NULL CHECK(length(request_key) BETWEEN 16 AND 128),
 status text NOT NULL DEFAULT 'pending'
   CHECK(status IN ('pending','approved','rejected')),
 reviewed_by uuid REFERENCES ms.staff_users(id),
 reviewed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(requested_by,request_key),
 CHECK((status='pending' AND reviewed_by IS NULL AND reviewed_at IS NULL) OR
       (status<>'pending' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
);
CREATE UNIQUE INDEX uq_contact_pending_custody
 ON ms.contact_custody_requests(contact_id) WHERE status='pending';

CREATE TABLE ms.contact_custody_decisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 request_id uuid NOT NULL UNIQUE REFERENCES ms.contact_custody_requests(id),
 reviewer_id uuid NOT NULL REFERENCES ms.staff_users(id),
 decision text NOT NULL CHECK(decision IN ('approved','rejected')),
 evidence_ref text NOT NULL CHECK(length(trim(evidence_ref)) BETWEEN 1 AND 200),
 reason_zh text NOT NULL CHECK(length(trim(reason_zh)) BETWEEN 2 AND 400),
 request_key text NOT NULL CHECK(length(request_key) BETWEEN 16 AND 128),
 decided_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(reviewer_id,request_key)
);
CREATE TABLE ms.contact_custody_assignments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES ms.organizations(id),
 contact_id uuid NOT NULL REFERENCES ms.contacts(id),
 assignee_id uuid NOT NULL REFERENCES ms.staff_users(id),
 approval_request_id uuid NOT NULL UNIQUE REFERENCES ms.contact_custody_requests(id),
 granted_at timestamptz NOT NULL DEFAULT now(),
 revoked_at timestamptz
);
CREATE UNIQUE INDEX uq_contact_live_custodian
 ON ms.contact_custody_assignments(contact_id) WHERE revoked_at IS NULL;

ALTER TABLE ms.contact_custody_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE ms.contact_custody_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ms.contact_custody_assignments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ms.contact_custody_requests,ms.contact_custody_decisions,
 ms.contact_custody_assignments FROM PUBLIC,ms_lowrisk_runtime;

CREATE TRIGGER immutable_contact_custody_decision
 BEFORE UPDATE OR DELETE ON ms.contact_custody_decisions
 FOR EACH ROW EXECUTE FUNCTION ms.reject_access_history_mutation();

-- Every application operation rechecks the current custodian under the
-- locked contact row. Original created_by is retained as immutable history.
CREATE FUNCTION ms.request_scoped_contact_custody(
 p_contact uuid,p_target uuid,p_evidence text,p_reason text,p_key text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ms
AS $propose$
DECLARE actor uuid;org uuid;existing ms.contact_custody_requests%ROWTYPE;
 contact_name text;custodian uuid;id_new uuid;
BEGIN
 SELECT staff_id,org_id INTO actor,org FROM ms.access_actor();
 IF actor IS NULL THEN RAISE EXCEPTION '员工身份未授权'
    USING ERRCODE='42501'; END IF;
 IF p_key IS NULL OR p_key !~ '^[a-zA-Z0-9_-]{16,128}$'
  OR p_contact IS NULL OR p_target IS NULL OR
  p_evidence IS NULL OR length(trim(p_evidence)) NOT BETWEEN 1 AND 200 OR
  p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 2 AND 400
 THEN RAISE EXCEPTION '联系人交接申请内容不正确' USING ERRCODE='23514'; END IF;
 SELECT * INTO existing FROM ms.contact_custody_requests
 WHERE requested_by=actor AND request_key=p_key;
 IF FOUND THEN
   IF existing.contact_id=p_contact AND existing.target_staff_id=p_target
    AND existing.evidence_ref=p_evidence AND existing.reason_zh=p_reason
   THEN RETURN existing.id; END IF;
   RAISE EXCEPTION '交接防重复编号已用于其他业务' USING ERRCODE='23505';
 END IF;
 SELECT c.display_name,COALESCE(a.assignee_id,c.created_by)
 INTO contact_name,custodian FROM ms.contacts c
 LEFT JOIN ms.contact_custody_assignments a
  ON a.contact_id=c.id AND a.revoked_at IS NULL
 WHERE c.id=p_contact AND c.organization_id=org AND c.archived_at IS NULL
 FOR UPDATE OF c;
 IF NOT FOUND OR custodian IS DISTINCT FROM actor THEN
   RAISE EXCEPTION '只能由联系人当前管理人提出交接'
   USING ERRCODE='42501';
 END IF;
 IF p_target=actor OR NOT EXISTS(
   SELECT 1 FROM ms.staff_users s WHERE s.id=p_target
     AND s.organization_id=org AND s.status='active')
 THEN RAISE EXCEPTION '只能交接至本机构其他有效员工'
   USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM ms.contact_custody_requests
    WHERE contact_id=p_contact AND status='pending')
 THEN RAISE EXCEPTION '已有待审核交接申请' USING ERRCODE='23505'; END IF;
 INSERT INTO ms.contact_custody_requests(
  organization_id,contact_id,requested_by,target_staff_id,
  evidence_ref,reason_zh,request_key
 ) VALUES(org,p_contact,actor,p_target,p_evidence,p_reason,p_key)
 RETURNING id INTO id_new;
 INSERT INTO ms.audit_events(
  organization_id,actor_user_id,target_type,target_id,event_name,
  reason_zh,after_business_json
 ) VALUES(org,actor,'contact',p_contact,'CONTACT_CUSTODY_REQUESTED',
  '已提出联系人管理权交接申请，尚未生效',
  jsonb_build_object('联系人',contact_name,'状态','待独立主管审核'));
 RETURN id_new;
END $propose$;

CREATE FUNCTION ms.decide_scoped_contact_custody(
 p_request uuid,p_decision text,p_evidence text,p_reason text,p_key text
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,ms
AS $decide$
DECLARE reviewer uuid;org uuid;r ms.contact_custody_requests%ROWTYPE;
 prev_owner uuid;contact_name text;old ms.contact_custody_decisions%ROWTYPE;
 current_contact uuid;
BEGIN
 SELECT staff_id,org_id INTO reviewer,org FROM ms.access_actor();
 IF reviewer IS NULL THEN RAISE EXCEPTION '审批员工未获授权'
   USING ERRCODE='42501'; END IF;
 IF p_decision NOT IN ('approved','rejected')
   OR p_key IS NULL OR p_key !~ '^[a-zA-Z0-9_-]{16,128}$'
   OR p_evidence IS NULL OR length(trim(p_evidence)) NOT BETWEEN 1 AND 200
   OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 2 AND 400
 THEN RAISE EXCEPTION '联系人交接审批材料不正确'
   USING ERRCODE='23514'; END IF;
 SELECT * INTO old FROM ms.contact_custody_decisions
 WHERE reviewer_id=reviewer AND request_key=p_key;
 IF FOUND THEN
   IF old.request_id=p_request AND old.decision=p_decision
     AND old.evidence_ref=p_evidence AND old.reason_zh=p_reason
   THEN RETURN CASE WHEN p_decision='approved' THEN '已批准' ELSE '已驳回' END;
   END IF;
   RAISE EXCEPTION '同一审批编号用于不同业务' USING ERRCODE='23505';
 END IF;
 SELECT * INTO r FROM ms.contact_custody_requests
 WHERE id=p_request AND organization_id=org FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '没有这项机构内交接申请'
   USING ERRCODE='42501'; END IF;
 IF r.status<>'pending' THEN RAISE EXCEPTION '申请已经审核，不可二次决定'
   USING ERRCODE='23505'; END IF;
 IF reviewer IN (r.requested_by,r.target_staff_id) THEN
   RAISE EXCEPTION '申请人与接收员工不得自批交接'
   USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(
   SELECT 1 FROM ms.user_role_grants g
   JOIN ms.role_templates rt ON rt.id=g.role_id
   WHERE g.user_id=reviewer AND g.revoked_at IS NULL
    AND g.valid_from<=now() AND rt.organization_id=org
    AND rt.role_code IN ('sales_manager','super_admin')
 ) THEN RAISE EXCEPTION '必须由本机构有效独立主管审核'
   USING ERRCODE='42501'; END IF;

 -- Lock contact to serialize against other custody requests and transitions.
 SELECT c.id,c.display_name,COALESCE(a.assignee_id,c.created_by)
 INTO current_contact,contact_name,prev_owner
 FROM ms.contacts c
 LEFT JOIN ms.contact_custody_assignments a
   ON a.contact_id=c.id AND a.revoked_at IS NULL
 WHERE c.id=r.contact_id AND c.organization_id=org AND c.archived_at IS NULL
 FOR UPDATE OF c;
 IF current_contact IS NULL OR prev_owner IS DISTINCT FROM r.requested_by
 THEN RAISE EXCEPTION '联系人管理权已变化，此申请必须重新提交'
   USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM ms.staff_users s WHERE s.id=r.target_staff_id
   AND s.organization_id=org AND s.status='active')
 THEN RAISE EXCEPTION '接收员工已经失效或不属于本机构'
   USING ERRCODE='23514'; END IF;
 IF p_decision='approved' THEN
   UPDATE ms.contact_custody_assignments
     SET revoked_at=now()
     WHERE contact_id=r.contact_id AND revoked_at IS NULL;
   INSERT INTO ms.contact_custody_assignments(
     organization_id,contact_id,assignee_id,approval_request_id
   ) VALUES(org,r.contact_id,r.target_staff_id,r.id);
 END IF;
 INSERT INTO ms.contact_custody_decisions(
   request_id,reviewer_id,decision,evidence_ref,reason_zh,request_key
 ) VALUES(r.id,reviewer,p_decision,p_evidence,p_reason,p_key);
 UPDATE ms.contact_custody_requests SET
  status=p_decision,reviewed_by=reviewer,reviewed_at=now()
 WHERE id=r.id;
 INSERT INTO ms.audit_events(
  organization_id,actor_user_id,target_type,target_id,event_name,
  reason_zh,after_business_json
 ) VALUES(org,reviewer,'contact',r.contact_id,'CONTACT_CUSTODY_DECIDED',
  CASE WHEN p_decision='approved'
   THEN '独立主管已批准转交联系人当前管理权；原咨询和学生未转交'
   ELSE '独立主管已驳回联系人管理权交接申请' END,
  jsonb_build_object('联系人',contact_name,
    '结果',CASE WHEN p_decision='approved' THEN '已批准' ELSE '已驳回' END));
 RETURN CASE WHEN p_decision='approved' THEN '已批准' ELSE '已驳回' END;
END $decide$;

REVOKE ALL ON FUNCTION ms.request_scoped_contact_custody(
  uuid,uuid,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION ms.decide_scoped_contact_custody(
  uuid,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ms.request_scoped_contact_custody(
  uuid,uuid,text,text,text) TO ms_scoped_lowrisk_writer;
GRANT EXECUTE ON FUNCTION ms.decide_scoped_contact_custody(
  uuid,text,text,text,text) TO ms_scoped_lowrisk_writer;

-- Existing "created_by" is an immutable audit source, not the current
-- custodian. Once transferred, old creator no longer gets unconditional
-- creator-only contact visibility; still may see a limited contact label
-- if separately authorized through their own student/lead relation.
CREATE OR REPLACE VIEW ms.scoped_contacts_directory
WITH (security_barrier=true) AS
SELECT c.id AS contact_id,c.display_name,c.do_not_contact
FROM ms.contacts c
WHERE c.organization_id=ms.current_scoped_organization_id()
 AND c.archived_at IS NULL AND ms.current_scoped_staff_id() IS NOT NULL
 AND (
    (c.created_by=ms.current_scoped_staff_id()
     AND NOT EXISTS(SELECT 1 FROM ms.contact_custody_assignments a
       WHERE a.contact_id=c.id AND a.revoked_at IS NULL))
    OR EXISTS(SELECT 1 FROM ms.contact_custody_assignments a
       WHERE a.contact_id=c.id AND a.revoked_at IS NULL
         AND a.assignee_id=ms.current_scoped_staff_id())
    OR EXISTS(SELECT 1 FROM ms.leads l
       WHERE l.contact_id=c.id AND l.organization_id=c.organization_id
         AND l.owner_user_id=ms.current_scoped_staff_id())
    OR EXISTS(SELECT 1 FROM ms.student_contacts sc
       JOIN ms.student_directory_assigned sd ON sd.student_id=sc.student_id
       WHERE sc.contact_id=c.id AND sc.valid_to IS NULL
         AND sd.organization_id=c.organization_id)
 );

-- Preserve original function names/protocols but change authorization to
-- current contact custodian. Do NOT modify actor's student ownership check.
CREATE OR REPLACE FUNCTION ms.link_scoped_student_contact(
  p_student uuid,p_contact uuid,p_relation text,p_key text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ms
AS $link$
DECLARE actor uuid;org uuid;s_name text;c_name text;
 fingerprint text;old ms.scoped_lowrisk_write_receipts%ROWTYPE;
 link_id uuid;answer jsonb;
BEGIN
 SELECT staff_id,org_id INTO actor,org FROM ms.access_actor();
 IF actor IS NULL THEN RAISE EXCEPTION '员工身份未授权' USING ERRCODE='42501'; END IF;
 IF p_key IS NULL OR p_key !~ '^[a-zA-Z0-9_-]{16,128}$'
  OR p_student IS NULL OR p_contact IS NULL OR p_relation IS NULL
  OR p_relation NOT IN ('父亲','母亲','其他监护人','其他联系人')
 THEN RAISE EXCEPTION '关系或业务编号错误' USING ERRCODE='23514'; END IF;
 fingerprint:=encode(sha256(convert_to(jsonb_build_object(
   'student',p_student,'contact',p_contact,'relation',p_relation
 )::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_key,0));
 SELECT * INTO old FROM ms.scoped_lowrisk_write_receipts
 WHERE staff_id=actor AND request_key=p_key;
 IF FOUND THEN
   IF old.operation_name='link_student_contact' AND old.payload_sha256=fingerprint
   THEN RETURN old.response_json; END IF;
   RAISE EXCEPTION '此防重复编号已被使用' USING ERRCODE='23505';
 END IF;
 SELECT display_name INTO s_name FROM ms.students
 WHERE id=p_student AND organization_id=org AND owner_user_id=actor
  AND archived_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '只能关联本人负责的学生'
    USING ERRCODE='42501'; END IF;
 SELECT c.display_name INTO c_name FROM ms.contacts c
 WHERE c.id=p_contact AND c.organization_id=org AND c.archived_at IS NULL
   AND (
    (c.created_by=actor AND NOT EXISTS(SELECT 1 FROM ms.contact_custody_assignments a
       WHERE a.contact_id=c.id AND a.revoked_at IS NULL))
    OR EXISTS(SELECT 1 FROM ms.contact_custody_assignments a
       WHERE a.contact_id=c.id AND a.assignee_id=actor AND a.revoked_at IS NULL)
   ) FOR UPDATE OF c;
 IF NOT FOUND THEN RAISE EXCEPTION '仅联系人当前管理人可建立待核实关系'
    USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM ms.student_contacts
   WHERE student_id=p_student AND contact_id=p_contact AND valid_to IS NULL)
 THEN RAISE EXCEPTION '已有有效的这位学生和联系人关系'
    USING ERRCODE='23505'; END IF;
 INSERT INTO ms.student_contacts(student_id,contact_id,relation_type,
   is_primary,verification_state,permission_basis_ref,verified_at)
 VALUES(p_student,p_contact,p_relation,false,'unverified',NULL,NULL)
 RETURNING id INTO link_id;
 answer:=jsonb_build_object('relationship_id',link_id,
   'student_id',p_student,'contact_id',p_contact,
   'verification_state','unverified');
 INSERT INTO ms.scoped_lowrisk_write_receipts(
  staff_id,organization_id,request_key,operation_name,payload_sha256,response_json
 ) VALUES(actor,org,p_key,'link_student_contact',fingerprint,answer);
 INSERT INTO ms.audit_events(
   organization_id,actor_user_id,target_type,target_id,event_name,
   reason_zh,after_business_json
 ) VALUES(org,actor,'student',p_student,'STUDENT_CONTACT_LINKED_SCOPED',
   '已登记待核实联系人关系，不自动确认家庭和兄弟姐妹',
   jsonb_build_object('学生',s_name,'联系人',c_name,'核实状态','待核实'));
 RETURN answer;
END $link$;

CREATE OR REPLACE FUNCTION ms.create_scoped_contact_consultation(
  p_contact uuid,p_type text,p_occurred timestamptz,p_key text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ms
AS $consultation$
DECLARE actor uuid;org uuid;c_name text;fingerprint text;
 old ms.scoped_lowrisk_write_receipts%ROWTYPE;
 event_id uuid;answer jsonb;
BEGIN
 SELECT staff_id,org_id INTO actor,org FROM ms.access_actor();
 IF actor IS NULL THEN RAISE EXCEPTION '员工身份未授权' USING ERRCODE='42501'; END IF;
 IF p_key IS NULL OR p_key !~ '^[a-zA-Z0-9_-]{16,128}$'
  OR p_contact IS NULL OR p_type IS NULL
  OR p_type NOT IN ('电话咨询','到店咨询','微信咨询','线上咨询')
  OR p_occurred IS NULL OR p_occurred<now()-INTERVAL '365 days'
  OR p_occurred>now()+INTERVAL '5 minutes'
 THEN RAISE EXCEPTION '咨询事实或防重复编号不正确' USING ERRCODE='23514'; END IF;
 fingerprint:=encode(sha256(convert_to(jsonb_build_object(
   'contact',p_contact,'type',p_type,'occurred',p_occurred
 )::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_key,0));
 SELECT * INTO old FROM ms.scoped_lowrisk_write_receipts
 WHERE staff_id=actor AND request_key=p_key;
 IF FOUND THEN
   IF old.operation_name='create_contact_event' AND old.payload_sha256=fingerprint
   THEN RETURN old.response_json; END IF;
   RAISE EXCEPTION '业务编号与已有操作冲突' USING ERRCODE='23505';
 END IF;
 SELECT c.display_name INTO c_name FROM ms.contacts c
 WHERE c.id=p_contact AND c.organization_id=org AND c.archived_at IS NULL
 AND (
    (c.created_by=actor AND NOT EXISTS(SELECT 1 FROM ms.contact_custody_assignments a
      WHERE a.contact_id=c.id AND a.revoked_at IS NULL))
    OR EXISTS(SELECT 1 FROM ms.contact_custody_assignments a
      WHERE a.contact_id=c.id AND a.assignee_id=actor AND a.revoked_at IS NULL)
 ) FOR UPDATE OF c;
 IF NOT FOUND THEN RAISE EXCEPTION '非当前联系人管理人不可登记咨询'
   USING ERRCODE='42501'; END IF;
 INSERT INTO ms.contact_events(organization_id,contact_id,event_type,
  occurred_at,recorded_by,channel_id,campaign_id,
  source_evidence_ref,original_source_text)
 VALUES(org,p_contact,p_type,p_occurred,actor,NULL,NULL,NULL,NULL)
 RETURNING id INTO event_id;
 answer:=jsonb_build_object('event_id',event_id);
 INSERT INTO ms.scoped_lowrisk_write_receipts(
  staff_id,organization_id,request_key,operation_name,payload_sha256,response_json
 ) VALUES(actor,org,p_key,'create_contact_event',fingerprint,answer);
 INSERT INTO ms.audit_events(
  organization_id,actor_user_id,target_type,target_id,event_name,
  reason_zh,after_business_json
 ) VALUES(org,actor,'contact_event',event_id,'CONTACT_EVENT_CREATED_SCOPED',
  '已登记本次真实咨询，不按关联学生数重复计数',
  jsonb_build_object('联系人',c_name,'咨询方式',p_type));
 RETURN answer;
END $consultation$;

CREATE VIEW ms.scoped_contact_custody_requests
WITH (security_barrier=true) AS
SELECT r.id AS request_id,c.display_name AS contact_name,
  requester.display_name AS requester_name,
  target.display_name AS target_name,r.requested_by,
  r.target_staff_id,r.status,r.created_at
FROM ms.contact_custody_requests r
JOIN ms.contacts c ON c.id=r.contact_id
JOIN ms.staff_users requester ON requester.id=r.requested_by
JOIN ms.staff_users target ON target.id=r.target_staff_id
WHERE r.organization_id=ms.current_scoped_organization_id()
 AND ms.current_scoped_staff_id() IS NOT NULL
 AND (r.requested_by=ms.current_scoped_staff_id()
    OR r.target_staff_id=ms.current_scoped_staff_id()
    OR EXISTS(SELECT 1 FROM ms.user_role_grants rg
       JOIN ms.role_templates rt ON rt.id=rg.role_id
       WHERE rg.user_id=ms.current_scoped_staff_id()
        AND rg.revoked_at IS NULL AND rg.valid_from<=now()
        AND rt.organization_id=r.organization_id
        AND rt.role_code IN ('sales_manager','super_admin'))
 );

CREATE VIEW ms.scoped_contact_custody_staff
WITH (security_barrier=true) AS
SELECT s.id AS staff_id,s.display_name AS staff_name
FROM ms.staff_users s
WHERE s.organization_id=ms.current_scoped_organization_id()
 AND s.status='active' AND s.id<>ms.current_scoped_staff_id()
 AND ms.current_scoped_staff_id() IS NOT NULL;

REVOKE ALL ON ms.scoped_contact_custody_requests,
 ms.scoped_contact_custody_staff FROM PUBLIC;
GRANT SELECT ON ms.scoped_contact_custody_requests,
 ms.scoped_contact_custody_staff TO ms_student_assignee_reader;

COMMIT;
