-- V3.2-14: isolated, function-only two low-risk writes on existing routes.
-- 017 follows 016 and is ONLY intended for disposable fictional PostgreSQL 16.
-- Student is primary management unit. A single family contact never grants
-- access to siblings or merges their consultation, lead and commercial data.
BEGIN;

-- Continue the same per-employee per-request idempotency namespace as
-- V3.2-12/13 student/contact creates; do not create a second receipt namespace.
ALTER TABLE ms.scoped_lowrisk_write_receipts
  DROP CONSTRAINT scoped_lowrisk_write_receipts_operation_name_check;
ALTER TABLE ms.scoped_lowrisk_write_receipts
  ADD CONSTRAINT scoped_lowrisk_write_receipts_operation_name_check
  CHECK(operation_name IN (
    'create_student','create_contact',
    'link_student_contact','create_contact_event'
  ));

CREATE FUNCTION ms.link_scoped_student_contact(
  p_student uuid,p_contact uuid,p_relation text,p_key text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ms
AS $link$
DECLARE actor uuid;org uuid; s_name text;c_name text;
  fingerprint text; old ms.scoped_lowrisk_write_receipts%ROWTYPE;
  link_id uuid; answer jsonb;
BEGIN
 SELECT staff_id,org_id INTO actor,org FROM ms.access_actor();
 IF actor IS NULL THEN
   RAISE EXCEPTION '当前员工数据库账号无效' USING ERRCODE='42501';
 END IF;
 IF p_key IS NULL OR p_key !~ '^[a-zA-Z0-9_-]{16,128}$'
   OR p_student IS NULL OR p_contact IS NULL
   OR p_relation IS NULL OR p_relation NOT IN
       ('父亲','母亲','其他监护人','其他联系人')
 THEN RAISE EXCEPTION '联系人关系或防重复编号不正确'
   USING ERRCODE='23514';
 END IF;
 fingerprint:=encode(sha256(convert_to(jsonb_build_object(
    'student',p_student,'contact',p_contact,'relation',p_relation
 )::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_key,0));
 SELECT * INTO old FROM ms.scoped_lowrisk_write_receipts
 WHERE staff_id=actor AND request_key=p_key;
 IF FOUND THEN
   IF old.operation_name='link_student_contact' AND
      old.payload_sha256=fingerprint THEN RETURN old.response_json; END IF;
   RAISE EXCEPTION '操作编号已用于其他业务或不同内容' USING ERRCODE='23505';
 END IF;

 -- Only own students; a temporary read-share is never authority to link.
 SELECT display_name INTO s_name FROM ms.students
 WHERE id=p_student AND organization_id=org AND owner_user_id=actor
   AND archived_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN
   RAISE EXCEPTION '只能为本人负责的学生登记联系人'
     USING ERRCODE='42501';
 END IF;

 -- Only personally registered contacts. A contact visible through a student
 -- share or a lead does NOT become owned by this sales employee.
 SELECT display_name INTO c_name FROM ms.contacts
 WHERE id=p_contact AND organization_id=org AND created_by=actor
   AND archived_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN
   RAISE EXCEPTION '不能将其他员工的联系人擅自关联至本学生'
     USING ERRCODE='42501';
 END IF;

 IF EXISTS(SELECT 1 FROM ms.student_contacts sc
   WHERE sc.student_id=p_student AND sc.contact_id=p_contact
     AND sc.valid_to IS NULL) THEN
   RAISE EXCEPTION '指定学生与联系人已有有效关系' USING ERRCODE='23505';
 END IF;

 -- Never change verification state to verified; this is an *unverified*
 -- hypothesis only. Do not mark as primary, infer siblings or create family.
 INSERT INTO ms.student_contacts(
   student_id,contact_id,relation_type,is_primary,
   verification_state,permission_basis_ref,verified_at
 ) VALUES(p_student,p_contact,p_relation,false,'unverified',NULL,NULL)
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
   '已为学生登记待核实的联系人关系；未确认家庭或兄弟姐妹',
   jsonb_build_object('学生',s_name,'联系人',c_name,
     '关系类型',p_relation,'核实状态','待核实'));
 RETURN answer;
END $link$;

REVOKE ALL ON FUNCTION ms.link_scoped_student_contact(uuid,uuid,text,text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ms.link_scoped_student_contact(uuid,uuid,text,text)
  TO ms_scoped_lowrisk_writer;

CREATE FUNCTION ms.create_scoped_contact_consultation(
  p_contact uuid,p_type text,p_occurred timestamptz,p_key text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,ms
AS $consultation$
DECLARE actor uuid;org uuid;c_name text;fingerprint text;
  old ms.scoped_lowrisk_write_receipts%ROWTYPE;
  event_id uuid;answer jsonb;
BEGIN
 SELECT staff_id,org_id INTO actor,org FROM ms.access_actor();
 IF actor IS NULL THEN
   RAISE EXCEPTION '员工账号未生效' USING ERRCODE='42501';
 END IF;
 IF p_key IS NULL OR p_key !~ '^[a-zA-Z0-9_-]{16,128}$'
  OR p_contact IS NULL OR p_type IS NULL OR p_type NOT IN
    ('电话咨询','到店咨询','微信咨询','线上咨询')
  OR p_occurred IS NULL OR p_occurred<now()-INTERVAL '365 days'
  OR p_occurred>now()+INTERVAL '5 minutes'
 THEN RAISE EXCEPTION '咨询方式、实际发生时间或防重复编号不正确'
   USING ERRCODE='23514';
 END IF;
 fingerprint:=encode(sha256(convert_to(jsonb_build_object(
  'contact',p_contact,'type',p_type,'occurred',p_occurred
 )::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_key,0));
 SELECT * INTO old FROM ms.scoped_lowrisk_write_receipts
 WHERE staff_id=actor AND request_key=p_key;
 IF FOUND THEN
   IF old.operation_name='create_contact_event' AND
     old.payload_sha256=fingerprint THEN RETURN old.response_json; END IF;
   RAISE EXCEPTION '防重复编号已经用于其他咨询或客户操作' USING ERRCODE='23505';
 END IF;
 -- A shared parent contact does not open all other sales' consultations.
 -- Only the employee who registered the contact can submit consultation.
 SELECT display_name INTO c_name FROM ms.contacts
 WHERE id=p_contact AND organization_id=org AND created_by=actor
   AND archived_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN
   RAISE EXCEPTION '没有为该联系人登记咨询的员工权限'
     USING ERRCODE='42501';
 END IF;
 INSERT INTO ms.contact_events(
  organization_id,contact_id,event_type,occurred_at,recorded_by,
  channel_id,campaign_id,source_evidence_ref,original_source_text
 ) VALUES(org,p_contact,p_type,p_occurred,actor,NULL,NULL,NULL,NULL)
 RETURNING id INTO event_id;
 answer:=jsonb_build_object('event_id',event_id);
 INSERT INTO ms.scoped_lowrisk_write_receipts(
   staff_id,organization_id,request_key,operation_name,payload_sha256,response_json
 ) VALUES(actor,org,p_key,'create_contact_event',fingerprint,answer);
 INSERT INTO ms.audit_events(
   organization_id,actor_user_id,target_type,target_id,event_name,
   reason_zh,after_business_json
 ) VALUES(org,actor,'contact_event',event_id,'CONTACT_EVENT_CREATED_SCOPED',
   '已记录一次实际咨询；不按关联学生人数重复计数',
   jsonb_build_object('联系人',c_name,'咨询方式',p_type,
     '实际发生时间',to_char(p_occurred AT TIME ZONE 'UTC',
       'YYYY-MM-DD HH24:MI')||' UTC'));
 RETURN answer;
END $consultation$;

REVOKE ALL ON FUNCTION ms.create_scoped_contact_consultation(
  uuid,text,timestamptz,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ms.create_scoped_contact_consultation(
  uuid,text,timestamptz,text) TO ms_scoped_lowrisk_writer;

COMMIT;
