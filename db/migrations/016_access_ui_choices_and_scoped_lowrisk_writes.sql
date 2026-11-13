-- V3.2-12: function-only student/contact low-risk writes + safe access form choices.
-- Run only in disposable fictional PG16 after 001..015.
BEGIN;

-- The read-only UI needs human-readable dropdown labels but not employee
-- identity subjects, family proofs, contacts or confidential student grades.
CREATE FUNCTION ms.list_student_access_choices()
RETURNS TABLE(student_id uuid,student_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,ms
AS $choices$
  SELECT s.id,s.display_name
  FROM ms.students s
  JOIN ms.access_actor() a ON a.org_id=s.organization_id
  WHERE s.owner_user_id=a.staff_id AND s.archived_at IS NULL
  ORDER BY s.display_name,s.id LIMIT 100
$choices$;
REVOKE ALL ON FUNCTION ms.list_student_access_choices() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ms.list_student_access_choices()
 TO ms_student_access_operator;

CREATE FUNCTION ms.list_student_access_staff()
RETURNS TABLE(staff_id uuid,staff_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,ms
AS $staff$
  SELECT s.id,s.display_name
  FROM ms.staff_users s
  JOIN ms.access_actor() a ON a.org_id=s.organization_id
  WHERE s.status='active' AND s.id<>a.staff_id
  ORDER BY s.display_name,s.id LIMIT 100
$staff$;
REVOKE ALL ON FUNCTION ms.list_student_access_staff() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ms.list_student_access_staff()
 TO ms_student_access_operator;

-- A separate minimal role can create only own student/contact records via
-- vetted database functions. No direct SELECT/INSERT on any raw table.
CREATE ROLE ms_scoped_lowrisk_writer NOLOGIN;
GRANT USAGE ON SCHEMA ms TO ms_scoped_lowrisk_writer;
GRANT EXECUTE ON FUNCTION ms.scoped_employee_identity_valid(text,text)
 TO ms_scoped_lowrisk_writer;

CREATE TABLE ms.scoped_lowrisk_write_receipts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 staff_id uuid NOT NULL REFERENCES ms.staff_users(id),
 organization_id uuid NOT NULL REFERENCES ms.organizations(id),
 request_key text NOT NULL CHECK(length(request_key) BETWEEN 16 AND 128),
 operation_name text NOT NULL CHECK(operation_name IN ('create_student','create_contact')),
 payload_sha256 text NOT NULL CHECK(length(payload_sha256)=64),
 response_json jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(staff_id,request_key)
);
REVOKE ALL ON ms.scoped_lowrisk_write_receipts FROM PUBLIC;
REVOKE ALL ON ms.scoped_lowrisk_write_receipts FROM ms_lowrisk_runtime;

CREATE FUNCTION ms.create_scoped_student(
 p_name text,p_grade text,p_school text,p_key text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ms
AS $create_student$
DECLARE actor uuid; org uuid; fingerprint text; old ms.scoped_lowrisk_write_receipts%ROWTYPE;
 new_student uuid; result_json jsonb; author text;
BEGIN
 SELECT staff_id,org_id INTO actor,org FROM ms.access_actor();
 IF actor IS NULL THEN RAISE EXCEPTION '没有有效的员工数据库身份' USING ERRCODE='42501'; END IF;
 IF p_key IS NULL OR p_key !~ '^[a-zA-Z0-9_-]{16,128}$'
    OR p_name IS NULL OR length(trim(p_name)) NOT BETWEEN 1 AND 100
    OR p_grade IS NOT NULL AND length(trim(p_grade))>100
    OR p_school IS NOT NULL AND length(trim(p_school))>100
 THEN RAISE EXCEPTION '学生档案内容或操作编号不符合要求' USING ERRCODE='23514'; END IF;
 fingerprint:=encode(sha256(convert_to(
   jsonb_build_object('name',trim(p_name),'grade',nullif(trim(p_grade),''),
      'school',nullif(trim(p_school),''))::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_key,0));
 SELECT * INTO old FROM ms.scoped_lowrisk_write_receipts
 WHERE staff_id=actor AND request_key=p_key;
 IF FOUND THEN
   IF old.operation_name='create_student' AND old.payload_sha256=fingerprint
     THEN RETURN old.response_json; END IF;
   RAISE EXCEPTION '操作编号已用于不同业务内容' USING ERRCODE='23505';
 END IF;
 SELECT s.display_name INTO author FROM ms.staff_users s WHERE s.id=actor;
 INSERT INTO ms.students(
   organization_id,display_name,grade_label,school_name,owner_user_id,created_by)
 VALUES(org,trim(p_name),nullif(trim(p_grade),''),nullif(trim(p_school),''),
   actor,actor) RETURNING id INTO new_student;
 result_json:=jsonb_build_object('student_id',new_student,
   'display_name',trim(p_name),'owner_display_name',author);
 INSERT INTO ms.scoped_lowrisk_write_receipts(
   staff_id,organization_id,request_key,operation_name,payload_sha256,response_json)
 VALUES(actor,org,p_key,'create_student',fingerprint,result_json);
 INSERT INTO ms.audit_events(
   organization_id,actor_user_id,target_type,target_id,event_name,reason_zh,
   after_business_json)
 VALUES(org,actor,'student',new_student,'STUDENT_CREATED_SCOPED',
   '已建立独立学生客户档案，不自动创建家庭关系',
   jsonb_build_object('学生',trim(p_name),'负责人',author));
 RETURN result_json;
END $create_student$;
REVOKE ALL ON FUNCTION ms.create_scoped_student(text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ms.create_scoped_student(text,text,text,text)
 TO ms_scoped_lowrisk_writer;

CREATE FUNCTION ms.create_scoped_contact(
 p_name text,p_optout boolean,p_key text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ms
AS $create_contact$
DECLARE actor uuid; org uuid; fingerprint text; old ms.scoped_lowrisk_write_receipts%ROWTYPE;
 new_contact uuid; result_json jsonb;
BEGIN
 SELECT staff_id,org_id INTO actor,org FROM ms.access_actor();
 IF actor IS NULL THEN RAISE EXCEPTION '没有有效的员工数据库身份' USING ERRCODE='42501'; END IF;
 IF p_key IS NULL OR p_key !~ '^[a-zA-Z0-9_-]{16,128}$'
    OR p_name IS NULL OR length(trim(p_name)) NOT BETWEEN 1 AND 100
    OR p_optout IS NULL
 THEN RAISE EXCEPTION '联系人内容或操作编号不符合要求' USING ERRCODE='23514'; END IF;
 fingerprint:=encode(sha256(convert_to(
   jsonb_build_object('name',trim(p_name),'optout',p_optout)::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_key,0));
 SELECT * INTO old FROM ms.scoped_lowrisk_write_receipts
 WHERE staff_id=actor AND request_key=p_key;
 IF FOUND THEN
   IF old.operation_name='create_contact' AND old.payload_sha256=fingerprint
     THEN RETURN old.response_json; END IF;
   RAISE EXCEPTION '操作编号已用于不同业务内容' USING ERRCODE='23505';
 END IF;
 INSERT INTO ms.contacts(organization_id,display_name,do_not_contact,created_by)
 VALUES(org,trim(p_name),p_optout,actor) RETURNING id INTO new_contact;
 result_json:=jsonb_build_object('contact_id',new_contact,
    'display_name',trim(p_name),'do_not_contact',p_optout);
 INSERT INTO ms.scoped_lowrisk_write_receipts(
   staff_id,organization_id,request_key,operation_name,payload_sha256,response_json)
 VALUES(actor,org,p_key,'create_contact',fingerprint,result_json);
 INSERT INTO ms.audit_events(
   organization_id,actor_user_id,target_type,target_id,event_name,reason_zh,
   after_business_json)
 VALUES(org,actor,'contact',new_contact,'CONTACT_CREATED_SCOPED',
   '已登记联系人称呼；没有采集电话或微信',
   jsonb_build_object('联系人',trim(p_name),
     '联系偏好',CASE WHEN p_optout THEN '拒绝主动联系' ELSE '尚未确认' END));
 RETURN result_json;
END $create_contact$;
REVOKE ALL ON FUNCTION ms.create_scoped_contact(text,boolean,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ms.create_scoped_contact(text,boolean,text)
 TO ms_scoped_lowrisk_writer;

COMMIT;
