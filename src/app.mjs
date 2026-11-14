import { createServer } from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import { demoLogin } from './dev-login.mjs';
import { serveUi } from './ui-assets.mjs';
import { identityOperation } from './identity-governance.mjs';
import { createExternalTokenVerifier, resolveExternalStaff } from './external-identity.mjs';
import { resolveStrictDirectoryContext } from './strict-auth-directory.mjs';
import { migratedLegacyReads, readLegacyViaStaffPool } from './scoped-legacy-read-adapter.mjs';
import { migratedLegacyWrites, writeLegacyViaStaffPool } from './scoped-legacy-write-adapter.mjs';
import { AppError, fail, verifyToken, staffContext, ownsStudent, ownsLead, ownsOpportunity, sameOrgStaff } from './auth.mjs';
import {buildIsolatedChannelCatalog} from './marketing-channel-catalog.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY=/^[a-zA-Z0-9_-]{16,128}$/;
function needId(x,name) { if(typeof x!=='string'||!UUID.test(x))fail(422,'VALIDATION_ERROR',name+'格式不正确');return x; }
function needText(x,name,max=300) {
  if(typeof x!=='string'||!x.trim()||x.trim().length>max)fail(422,'VALIDATION_ERROR',name+'不能为空或长度超限');
  return x.trim();
}
function object(x,fields) {
  if(!x||typeof x!=='object'||Array.isArray(x))fail(422,'VALIDATION_ERROR','请求内容格式不正确');
  for(const key of Object.keys(x))if(!fields.includes(key))fail(422,'VALIDATION_ERROR','包含不支持的业务字段');
  return x;
}
function asIdOrNull(x,name){return x==null?null:needId(x,name);}
function sourceName(x){return typeof x==='string'&&x.length<=100?x:'';}
function normalized(x){
  if(Array.isArray(x))return x.map(normalized);
  if(x&&typeof x==='object')return Object.fromEntries(Object.keys(x).sort().map(k=>[k,normalized(x[k])]));
  return x;
}
function digest(method,path,body){return createHash('sha256').update(JSON.stringify(normalized({method,path,body}))).digest('hex');}
function audit(c,ctx,targetType,targetId,event,reason,before={},after={}){
  return c.query(
    'INSERT INTO ms.audit_events(organization_id,actor_user_id,target_type,target_id,event_name,before_business_json,after_business_json,reason_zh)'+
    ' VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    [ctx.user.organization_id,ctx.user.id,targetType,targetId,event,JSON.stringify(before),JSON.stringify(after),reason]);
}
async function orgEntity(c,table,id,org,name) {
  const allowed={contacts:'contacts',contact_events:'contact_events',marketing_channels:'marketing_channels'};
  if(!allowed[table])throw Error('Disallowed table lookup');
  const r=await c.query('SELECT id'+(table==='contact_events'?',contact_id,recorded_by':'')+' FROM ms.'+allowed[table]+
    ' WHERE id=$1 AND organization_id=$2'+(table==='contacts'?' AND archived_at IS NULL':''),
    [needId(id,name),org]);
  if(!r.rowCount)fail(422,'VALIDATION_ERROR',name+'不存在于当前机构');
  return r.rows[0];
}
async function getContact(c,ctx,id) {
  const x=await orgEntity(c,'contacts',id,ctx.user.organization_id,'联系人');
  if(ctx.manager)return x;
  const scope=await c.query(
    "SELECT 1 FROM ms.contacts c WHERE c.id=$1 AND c.organization_id=$2 AND c.created_by=$3"+
    " UNION SELECT 1 FROM ms.leads l WHERE l.contact_id=$1 AND l.organization_id=$2 AND l.owner_user_id=$3"+
    " UNION SELECT 1 FROM ms.student_contacts sc JOIN ms.students s ON s.id=sc.student_id"+
    " WHERE sc.contact_id=$1 AND sc.valid_to IS NULL AND s.organization_id=$2 AND s.owner_user_id=$3 LIMIT 1",
    [id,ctx.user.organization_id,ctx.user.id]);
  if(!scope.rowCount)fail(403,'FORBIDDEN','当前账号无权查看该联系人');
  return x;
}
const routeDefs=[
  ['POST',/^\/api\/v1\/students$/,'createStudent'],
  ['GET',/^\/api\/v1\/students$/,'listStudents'],
  ['GET',/^\/api\/v1\/contacts$/,'listContacts'],
  ['GET',/^\/api\/v1\/contact-events$/,'listEvents'],
  ['GET',/^\/api\/v1\/marketing-channels$/,'listMarketingChannels'],
  ['GET',/^\/api\/v1\/marketing-campaigns\/drafts$/,'listCampaignDrafts'],
  ['POST',/^\/api\/v1\/marketing-campaigns\/drafts$/,'createCampaignDraft'],
  ['POST',/^\/api\/v1\/marketing-campaigns\/drafts\/([0-9a-f-]+)\/revisions$/,'reviseCampaignDraft'],
  ['GET',/^\/api\/v1\/marketing-campaigns\/sales-reviews$/,'listCampaignSalesReviews'],
  ['POST',/^\/api\/v1\/marketing-campaigns\/drafts\/([0-9a-f-]+)\/sales-review-requests$/,'requestCampaignSalesReview'],
  ['POST',/^\/api\/v1\/marketing-campaigns\/sales-reviews\/([0-9a-f-]+)\/decision$/,'decideCampaignSalesReview'],
  ['GET',/^\/api\/v1\/marketing-channels\/change-requests$/,'listChannelChangeRequests'],
  ['GET',/^\/api\/v1\/marketing-channels\/change-requests\/audit-history$/,'listChannelAuditHistory'],
  ['POST',/^\/api\/v1\/marketing-channels\/change-requests$/,'requestChannelChange'],
  ['POST',/^\/api\/v1\/marketing-channels\/change-requests\/([0-9a-f-]+)\/decision$/,'reviewChannelChange'],
  ['GET',/^\/api\/v1\/leads$/,'listLeads'],
  ['GET',/^\/api\/v1\/opportunities$/,'listOpportunities'],
  ['GET',/^\/api\/v1\/family-groups$/,'listFamilyGroups'],
  ['POST',/^\/api\/v1\/family-groups\/([0-9a-f-]+)\/decision$/,'decideFamily'],
  ['GET',/^\/api\/v1\/me$/,'getMe'],
  ['GET',/^\/api\/v1\/identity\/staff$/,'identityListStaff'],
  ['GET',/^\/api\/v1\/identity\/bindings$/,'identityListBindings'],
  ['GET',/^\/api\/v1\/identity\/change-requests$/,'identityListRequests'],
  ['POST',/^\/api\/v1\/identity\/change-requests$/,'identityCreateRequest'],
  ['POST',/^\/api\/v1\/identity\/change-requests\/([0-9a-f-]+)\/decision$/,'identityDecideRequest'],
  ['GET',/^\/api\/v1\/students\/([0-9a-f-]+)$/,'getStudent'],
  ['POST',/^\/api\/v1\/contacts$/,'createContact'],
  ['GET',/^\/api\/v1\/contact-custody\/requests$/,'listContactCustodyRequests'],
  ['GET',/^\/api\/v1\/contact-custody\/staff$/,'listContactCustodyStaff'],
  ['GET',/^\/api\/v1\/contact-custody\/active$/,'listContactCustodyActive'],
  ['GET',/^\/api\/v1\/contact-custody\/reviews$/,'listContactCustodyReviews'],
  ['GET',/^\/api\/v1\/contact-custody\/related-students$/,'listRelatedStudents'],
  ['POST',/^\/api\/v1\/contact-custody\/reviews$/,'requestCustodyReview'],
  ['POST',/^\/api\/v1\/contact-custody\/reviews\/([0-9a-f-]+)\/decision$/,'decideCustodyReview'],
  ['POST',/^\/api\/v1\/contact-custody\/requests$/,'requestContactCustody'],
  ['POST',/^\/api\/v1\/contact-custody\/requests\/([0-9a-f-]+)\/decision$/,'decideContactCustody'],
  ['POST',/^\/api\/v1\/contact-events$/,'createEvent'],
  ['POST',/^\/api\/v1\/students\/([0-9a-f-]+)\/contacts$/,'linkContact'],
  ['GET',/^\/api\/v1\/lead-candidates\/consultations$/,'listCandidateConsultations'],
  ['GET',/^\/api\/v1\/lead-candidates$/,'listLeadCandidates'],
  ['POST',/^\/api\/v1\/lead-candidates$/,'requestLeadCandidate'],
  ['POST',/^\/api\/v1\/lead-candidates\/([0-9a-f-]+)\/decision$/,'decideLeadCandidate'],
  ['GET',/^\/api\/v1\/conversion-readiness$/,'listConversionReadiness'],
  ['GET',/^\/api\/v1\/attribution-disputes$/,'listAttributionDisputes'],
  ['GET',/^\/api\/v1\/attribution-disputes\/eligible$/,'listAttributionDisputable'],
  ['POST',/^\/api\/v1\/conversion-readiness$/,'requestConversionReadiness'],
  ['POST',/^\/api\/v1\/conversion-readiness\/([0-9a-f-]+)\/decision$/,'decideConversionReadiness'],
  ['POST',/^\/api\/v1\/conversion-readiness\/([0-9a-f-]+)\/revoke$/,'revokeConversionReadiness'],
  ['POST',/^\/api\/v1\/attribution-disputes$/,'requestAttributionDispute'],
  ['POST',/^\/api\/v1\/attribution-disputes\/([0-9a-f-]+)\/decision$/,'decideAttributionDispute'],
  ['GET',/^\/api\/v1\/lead-conversions$/,'listFinalLeadConversions'],
  ['POST',/^\/api\/v1\/lead-conversions$/,'requestFinalLeadConversion'],
  ['POST',/^\/api\/v1\/lead-conversions\/([0-9a-f-]+)\/decision$/,'decideFinalLeadConversion'],
  ['POST',/^\/api\/v1\/lead-conversions\/([0-9a-f-]+)\/execute$/,'executeFinalLeadConversion'],
  ['GET',/^\/api\/v1\/lead-student-associations$/,'listLeadStudentAssociations'],
  ['POST',/^\/api\/v1\/lead-student-associations$/,'requestLeadStudentAssociation'],
  ['POST',/^\/api\/v1\/lead-student-associations\/([0-9a-f-]+)\/decision$/,'decideLeadStudentAssociation'],
  ['GET',/^\/api\/v1\/lead-student-link-reviews$/,'listLeadStudentLinkReviews'],
  ['GET',/^\/api\/v1\/lead-student-links\/current$/,'listCurrentLeadStudentLinks'],
  ['POST',/^\/api\/v1\/lead-student-link-reviews$/,'requestLeadStudentLinkReview'],
  ['POST',/^\/api\/v1\/lead-student-link-reviews\/([0-9a-f-]+)\/decision$/,'decideLeadStudentLinkReview'],
  ['GET',/^\/api\/v1\/downstream-reconciliations$/,'listDownstreamReconciliations'],
  ['POST',/^\/api\/v1\/downstream-reconciliations\/([0-9a-f-]+)\/finding$/,'attestDownstreamReconciliation'],
  ['POST',/^\/api\/v1\/downstream-reconciliations\/([0-9a-f-]+)\/resolution$/,'resolveDownstreamReconciliation'],
  ['GET',/^\/api\/v1\/downstream-student-corrections$/,'listDownstreamStudentCorrections'],
  ['GET',/^\/api\/v1\/downstream-student-corrections\/eligible$/,'listDownstreamCorrectionEligible'],
  ['POST',/^\/api\/v1\/downstream-student-corrections$/,'requestDownstreamStudentCorrection'],
  ['POST',/^\/api\/v1\/downstream-student-corrections\/([0-9a-f-]+)\/decision$/,'decideDownstreamStudentCorrection'],
  ['GET',/^\/api\/v1\/lead-adjustments$/,'listLeadAdjustments'],
  ['GET',/^\/api\/v1\/lead-correction-notes$/,'listLeadCorrectionNotes'],
  ['POST',/^\/api\/v1\/lead-adjustments$/,'requestLeadAdjustment'],
  ['POST',/^\/api\/v1\/lead-adjustments\/([0-9a-f-]+)\/decision$/,'decideLeadAdjustment'],
  ['POST',/^\/api\/v1\/leads$/,'createLead'],
  ['GET',/^\/api\/v1\/leads\/([0-9a-f-]+)$/,'getLead'],
  ['POST',/^\/api\/v1\/leads\/([0-9a-f-]+)\/students$/,'linkLead'],
  ['POST',/^\/api\/v1\/opportunities$/,'createOpportunity'],
  ['GET',/^\/api\/v1\/opportunities\/([0-9a-f-]+)$/,'getOpportunity'],
  ['POST',/^\/api\/v1\/interactions$/,'createInteraction'],
  ['POST',/^\/api\/v1\/family-groups$/,'createFamilyReview'],
  ['GET',/^\/api\/v1\/audit$/,'getAudit']
];
async function handle(c,ctx,op,p,body,requestUrl) {
  const org=ctx.user.organization_id,actor=ctx.user.id;
  if(op.startsWith('identity'))return identityOperation(c,ctx,op,p,body);
  switch(op){
    case 'getMe': {
      return {
        staff_id:actor,display_name:ctx.user.display_name,
        organization_id:org,role_codes:ctx.roles,
        capabilities:{
          view_own_students:true,
          manage_own_leads:true,
          propose_family_review:ctx.manager,
          decide_other_person_family_review:ctx.manager,
          review_family_audit:ctx.manager,
          manage_identity_requests:ctx.manager
        },
        environment:'isolated-test'
      };
    }
    case 'listStudents': {
      const r=await c.query(
        "SELECT s.id AS student_id,s.display_name,"+
        "CASE WHEN ($2::boolean OR s.owner_user_id=$3) "+
        "THEN s.grade_label ELSE '已隐藏' END AS grade_label,s.owner_user_id,"+
        "u.display_name AS owner_display_name FROM ms.students s "+
        "LEFT JOIN ms.staff_users u ON u.id=s.owner_user_id "+
        "WHERE s.organization_id=$1 AND s.archived_at IS NULL AND "+
        "($2::boolean OR s.owner_user_id=$3 OR EXISTS ("+
        "SELECT 1 FROM ms.data_scope_grants g WHERE g.user_id=$3 "+
        "AND g.resource_type='student' AND g.scope_type='specific' "+
        "AND g.scope_ref=s.id AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>now()))) "+
        "ORDER BY s.created_at DESC,s.id LIMIT 100",
        [org,ctx.manager,actor]);
      return {items:r.rows};
    }
    case 'listContacts': {
      const r=await c.query(
        "SELECT c.id AS contact_id,c.display_name,c.do_not_contact "+
        "FROM ms.contacts c WHERE c.organization_id=$1 AND c.archived_at IS NULL "+
        "AND ($2::boolean OR c.created_by=$3 OR EXISTS ("+
        "SELECT 1 FROM ms.leads l WHERE l.contact_id=c.id "+
        "AND l.organization_id=$1 AND l.owner_user_id=$3) OR EXISTS ("+
        "SELECT 1 FROM ms.student_contacts sc JOIN ms.students s ON s.id=sc.student_id "+
        "WHERE sc.contact_id=c.id AND sc.valid_to IS NULL "+
        "AND s.organization_id=$1 AND s.archived_at IS NULL "+
        "AND (s.owner_user_id=$3 OR EXISTS ("+
        "SELECT 1 FROM ms.data_scope_grants g WHERE g.user_id=$3 "+
        "AND g.resource_type='student' AND g.scope_type='specific' "+
        "AND g.scope_ref=s.id AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>now()))))) "+
        "ORDER BY c.created_at DESC,c.id LIMIT 100",
        [org,ctx.manager,actor]);
      return {items:r.rows};
    }
    case 'listEvents': {
      const r=await c.query(
        "SELECT e.id AS event_id,e.event_type,e.occurred_at,c.display_name AS contact_display_name "+
        "FROM ms.contact_events e LEFT JOIN ms.contacts c ON c.id=e.contact_id "+
        "WHERE e.organization_id=$1 AND ($2::boolean OR e.recorded_by=$3) "+
        "ORDER BY e.occurred_at DESC,e.id LIMIT 100",
        [org,ctx.manager,actor]);
      return {items:r.rows};
    }
    case 'listMarketingChannels': {
      // Demo-only read path. Strict staff reads use the separate restricted
      // scoped_marketing_channel_catalog view, never this broad connection.
      const result=await c.query(
        'SELECT id,organization_id,parent_id,name,channel_type,status '+
        'FROM ms.marketing_channels WHERE organization_id=$1 '+
        'ORDER BY id LIMIT 201',[org]);
      return buildIsolatedChannelCatalog(result.rows,org);
    }
    case 'listLeads': {
      const r=await c.query(
        "SELECT l.id AS lead_id,l.lead_state,l.created_at,c.display_name AS contact_display_name "+
        "FROM ms.leads l LEFT JOIN ms.contacts c ON c.id=l.contact_id "+
        "WHERE l.organization_id=$1 AND ($2::boolean OR l.owner_user_id=$3) "+
        "ORDER BY l.created_at DESC,l.id LIMIT 100",
        [org,ctx.manager,actor]);
      return {items:r.rows};
    }
    case 'listOpportunities': {
      const r=await c.query(
        "SELECT o.id AS opportunity_id,o.student_id,o.owner_user_id,"+
        "o.predicted_amount_cents,o.lifecycle_state,s.display_name AS student_display_name,"+
        "u.display_name AS owner_display_name "+
        "FROM ms.opportunities o JOIN ms.students s ON s.id=o.student_id "+
        "LEFT JOIN ms.staff_users u ON u.id=o.owner_user_id "+
        "WHERE s.organization_id=$1 AND s.archived_at IS NULL "+
        "AND ($2::boolean OR o.owner_user_id=$3) "+
        "ORDER BY o.created_at DESC,o.id LIMIT 100",
        [org,ctx.manager,actor]);
      return {items:r.rows};
    }
    case 'listFamilyGroups': {
      if(!ctx.manager)fail(403,'FORBIDDEN','仅主管可以查看待核实家庭关联');
      const r=await c.query(
        "SELECT f.id AS family_group_id,f.display_name,f.verification_state,"+
        "f.requested_by,f.verified_by,req.display_name AS requested_by_name,"+
        "reviewer.display_name AS verified_by_name,"+
        "COUNT(m.student_id)::integer AS student_count "+
        "FROM ms.family_groups f LEFT JOIN ms.family_memberships m "+
        "ON m.family_group_id=f.id AND m.revoked_at IS NULL "+
        "LEFT JOIN ms.staff_users req ON req.id=f.requested_by "+
        "LEFT JOIN ms.staff_users reviewer ON reviewer.id=f.verified_by "+
        "WHERE f.organization_id=$1 GROUP BY f.id,req.display_name,reviewer.display_name "+
        "ORDER BY f.created_at DESC,f.id LIMIT 100",[org]);
      return {items:r.rows};
    }
    case 'createStudent': {
      object(body,['display_name','grade_label','school_name','owner_user_id']);
      const display_name=needText(body.display_name,'学生姓名',100);
      const owner=body.owner_user_id?needId(body.owner_user_id,'负责人'):actor;
      if(owner!==actor&&!ctx.manager)fail(403,'FORBIDDEN','只有主管可以为其他销售分配学生');
      await sameOrgStaff(c,ctx,owner);
      const r=await c.query('INSERT INTO ms.students(organization_id,display_name,grade_label,school_name,owner_user_id,created_by)'+
        ' VALUES($1,$2,$3,$4,$5,$6) RETURNING id,display_name,owner_user_id,version',
        [org,display_name,sourceName(body.grade_label)||null,sourceName(body.school_name)||null,owner,actor]);
      const x=r.rows[0];
      const ownerLabel=owner===actor?ctx.user.display_name:
        (await c.query('SELECT display_name FROM ms.staff_users WHERE id=$1',[owner])).rows[0]?.display_name;
      await audit(c,ctx,'student',x.id,'STUDENT_CREATED','新建学生客户：'+x.display_name,{}, {'学生':x.display_name,'负责人':ownerLabel||'已分配负责人'});
      return {student_id:x.id,display_name:x.display_name,owner_user_id:owner,version:x.version};
    }
    case 'getStudent': {
      const s=await ownsStudent(c,ctx,needId(p[0],'学生编号'));
      return {student_id:s.id,display_name:s.display_name,owner_user_id:s.owner_user_id};
    }
    case 'createContact': {
      object(body,['display_name','do_not_contact']);
      const name=needText(body.display_name,'联系人姓名',100);
      if(body.do_not_contact!==undefined&&typeof body.do_not_contact!=='boolean')
        fail(422,'VALIDATION_ERROR','拒绝联系设置不正确');
      const r=await c.query('INSERT INTO ms.contacts(organization_id,display_name,do_not_contact,created_by)'+
        ' VALUES($1,$2,$3,$4) RETURNING id,display_name,do_not_contact',
        [org,name,body.do_not_contact===true,actor]);
      // Important: no phone or WeChat PII is accepted in this isolated MVP.
      const x=r.rows[0];
      await audit(c,ctx,'contact',x.id,'CONTACT_CREATED','新建联系人：'+name,{}, {'联系人':name});
      return {contact_id:x.id,display_name:name,do_not_contact:x.do_not_contact};
    }
    case 'createEvent': {
      object(body,['contact_id','channel_id','event_type','occurred_at','source_evidence_ref']);
      const contact=body.contact_id?await getContact(c,ctx,body.contact_id):null;
      if(body.channel_id)await orgEntity(c,'marketing_channels',body.channel_id,org,'渠道');
      const when=Date.parse(body.occurred_at);
      if(!Number.isFinite(when))fail(422,'VALIDATION_ERROR','咨询发生时间格式不正确');
      const type=needText(body.event_type,'咨询类型',50);
      const r=await c.query('INSERT INTO ms.contact_events(organization_id,contact_id,channel_id,event_type,occurred_at,source_evidence_ref,recorded_by)'+
        ' VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',
        [org,contact?.id||null,body.channel_id||null,type,new Date(when),sourceName(body.source_evidence_ref)||null,actor]);
      await audit(c,ctx,'contact_event',r.rows[0].id,'CONTACT_EVENT_CREATED','登记了一次真实客户咨询');
      return {event_id:r.rows[0].id};
    }
    case 'linkContact': {
      object(body,['contact_id','relation_type','verification_state','is_primary','permission_basis_ref']);
      const student=await ownsStudent(c,ctx,needId(p[0],'学生编号'));
      const contact=await getContact(c,ctx,body.contact_id);
      const relation=needText(body.relation_type,'联系人与学生的关系',50);
      const state=body.verification_state||'unverified';
      if(!['unverified','verified','disputed'].includes(state))
        fail(422,'VALIDATION_ERROR','核实状态不正确');
      if(state==='verified'&&!ctx.manager)fail(403,'FORBIDDEN','只有授权主管能确认监护关系');
      const primary=body.is_primary===true;
      const r=await c.query(
        'INSERT INTO ms.student_contacts(student_id,contact_id,relation_type,is_primary,verification_state,permission_basis_ref,verified_at)'+
        ' VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',
        [student.id,contact.id,relation,primary,state,sourceName(body.permission_basis_ref)||null,state==='verified'?new Date():null]);
      await audit(c,ctx,'student',student.id,'STUDENT_CONTACT_LINKED',
        '为学生'+student.display_name+'关联了'+relation+'联系人',{}, {'联系人关系':relation,'核实情况':state==='verified'?'已核实':'待核实'});
      return {relationship_id:r.rows[0].id,student_id:student.id,contact_id:contact.id,verification_state:state};
    }
    case 'createLead': {
      object(body,['source_event_ref','contact_id','source_channel_id','notes']);
      const event=await orgEntity(c,'contact_events',body.source_event_ref,org,'咨询事件');
      if(!ctx.manager&&event.recorded_by!==actor)
        fail(403,'FORBIDDEN','当前账号无权将其他员工的咨询转为线索');
      if(body.contact_id){
        await getContact(c,ctx,body.contact_id);
        if(event.contact_id&&event.contact_id!==body.contact_id)
          fail(422,'VALIDATION_ERROR','线索联系人与原咨询不一致');
      }
      if(body.source_channel_id)await orgEntity(c,'marketing_channels',body.source_channel_id,org,'渠道');
      const r=await c.query('INSERT INTO ms.leads(organization_id,contact_id,source_event_id,owner_user_id,lead_state)'+
        " VALUES($1,$2,$3,$4,'unidentified') RETURNING id,lead_state",
        [org,body.contact_id||event.contact_id||null,event.id,actor]);
      await audit(c,ctx,'lead',r.rows[0].id,'LEAD_CREATED','登记了尚未确认具体学生的咨询线索');
      return {lead_id:r.rows[0].id,lead_state:r.rows[0].lead_state,student_ids:[]};
    }
    case 'getLead': {
      const l=await ownsLead(c,ctx,needId(p[0],'线索编号'));
      const r=await c.query('SELECT student_id FROM ms.lead_students WHERE lead_id=$1 ORDER BY student_id',[l.id]);
      return {lead_id:l.id,contact_id:l.contact_id,student_ids:r.rows.map(x=>x.student_id)};
    }
    case 'linkLead': {
      object(body,['student_ids','evidence_ref','confirmation_state']);
      const lead=await ownsLead(c,ctx,needId(p[0],'线索编号'));
      if(!Array.isArray(body.student_ids)||body.student_ids.length===0||body.student_ids.length>20)
        fail(422,'VALIDATION_ERROR','学生关联数量不正确');
      const ids=[...new Set(body.student_ids.map(x=>needId(x,'学生编号')))];
      if(ids.length!==body.student_ids.length)fail(422,'VALIDATION_ERROR','关联中存在重复学生');
      const evidence=needText(body.evidence_ref,'核实依据',100);
      const state=body.confirmation_state||'pending_review';
      if(!['pending_review','verified'].includes(state))
        fail(422,'VALIDATION_ERROR','核实状态不正确');
      if(state==='verified'&&!ctx.manager)fail(403,'FORBIDDEN','仅主管可确认学生识别');
      for(const id of ids){
        await ownsStudent(c,ctx,id);
        await c.query('INSERT INTO ms.lead_students(lead_id,student_id,confirmation_state,confirmed_by)'+
          ' VALUES($1,$2,$3,$4)',[lead.id,id,state,state==='verified'?actor:null]);
      }
      await audit(c,ctx,'lead',lead.id,'LEAD_STUDENTS_LINKED',
        '线索已关联'+ids.length+'名具体学生，原始咨询次数不增加',{}, {'关联学生人数':ids.length,'关联情况':state==='verified'?'已核实':'待核实','依据编号':evidence});
      return {lead_id:lead.id,student_ids:ids,confirmation_state:state};
    }
    case 'createOpportunity': {
      object(body,['student_id','source_channel_id','owner_user_id','predicted_amount_cents']);
      const student=await ownsStudent(c,ctx,needId(body.student_id,'学生编号'));
      if(body.source_channel_id)await orgEntity(c,'marketing_channels',body.source_channel_id,org,'渠道');
      const owner=body.owner_user_id||student.owner_user_id||actor;
      if(owner!==student.owner_user_id&&!ctx.manager)
        fail(403,'FORBIDDEN','只有主管能更改商机负责人');
      await sameOrgStaff(c,ctx,owner);
      const predicted=body.predicted_amount_cents;
      if(predicted!==undefined&&(!Number.isSafeInteger(predicted)||predicted<0))
        fail(422,'VALIDATION_ERROR','预计金额必须是非负整数分');
      const r=await c.query('INSERT INTO ms.opportunities(student_id,owner_user_id,source_channel_id,predicted_amount_cents)'+
        ' VALUES($1,$2,$3,$4) RETURNING id,stage,version',
        [student.id,owner,body.source_channel_id||null,predicted??null]);
      await audit(c,ctx,'opportunity',r.rows[0].id,'OPPORTUNITY_CREATED',
        '为学生'+student.display_name+'建立销售商机',{}, {'学生':student.display_name,'商机阶段':'新建'});
      return {opportunity_id:r.rows[0].id,student_id:student.id,owner_user_id:owner,stage:r.rows[0].stage};
    }
    case 'getOpportunity': {
      const o=await ownsOpportunity(c,ctx,needId(p[0],'商机编号'));
      return {opportunity_id:o.id,student_id:o.student_id,owner_user_id:o.owner_user_id,stage:o.stage,lifecycle_state:o.lifecycle_state};
    }
    case 'createInteraction': {
      object(body,['occurred_at','contact_method','summary','subjects']);
      const when=Date.parse(body.occurred_at);
      if(!Number.isFinite(when))fail(422,'VALIDATION_ERROR','跟进时间不正确');
      const summary=needText(body.summary,'沟通内容',2000);
      const method=needText(body.contact_method,'沟通方式',50);
      if(!Array.isArray(body.subjects)||body.subjects.length===0||body.subjects.length>20)
        fail(422,'VALIDATION_ERROR','关联对象数量不正确');
      const subjects=[];
      for(const subject of body.subjects){
        object(subject,['student_id','lead_id','opportunity_id']);
        if(!subject.student_id&&!subject.lead_id&&!subject.opportunity_id)
          fail(422,'VALIDATION_ERROR','跟进记录必须关联业务对象');
        if(subject.student_id)await ownsStudent(c,ctx,needId(subject.student_id,'学生编号'));
        if(subject.lead_id)await ownsLead(c,ctx,needId(subject.lead_id,'线索编号'));
        if(subject.opportunity_id)await ownsOpportunity(c,ctx,needId(subject.opportunity_id,'商机编号'));
        subjects.push(subject);
      }
      const r=await c.query('INSERT INTO ms.interactions(organization_id,recorded_by,occurred_at,contact_method,summary)'+
        ' VALUES($1,$2,$3,$4,$5) RETURNING id',[org,actor,new Date(when),method,summary]);
      for(const x of subjects)await c.query(
        'INSERT INTO ms.interaction_subjects(interaction_id,student_id,lead_id,opportunity_id) VALUES($1,$2,$3,$4)',
        [r.rows[0].id,x.student_id||null,x.lead_id||null,x.opportunity_id||null]);
      await audit(c,ctx,'interaction',r.rows[0].id,'INTERACTION_CREATED',
        '记录了一次真实跟进，涉及'+subjects.length+'个业务对象');
      return {interaction_id:r.rows[0].id,linked_subjects:subjects.length,actual_interactions:1};
    }
    case 'createFamilyReview': {
      object(body,['display_name','student_ids','verification_evidence_ref']);
      if(!ctx.manager)fail(403,'FORBIDDEN','家庭关系核实必须由主管处理');
      const name=needText(body.display_name,'家庭关联名称',120);
      const evidence=needText(body.verification_evidence_ref,'家庭关系核实依据',200);
      if(!Array.isArray(body.student_ids)||body.student_ids.length<2||body.student_ids.length>20)
        fail(422,'VALIDATION_ERROR','家庭关联至少需要两名学生');
      const ids=[...new Set(body.student_ids.map(id=>needId(id,'学生编号')))];
      if(ids.length!==body.student_ids.length)fail(422,'VALIDATION_ERROR','家庭关联不能包含重复学生');
      for(const id of ids)await ownsStudent(c,ctx,id);
      // A reference supplied by a manager is NOT independently verified evidence.
      // Remain pending until approved verification workflow exists.
      const r=await c.query(
        "INSERT INTO ms.family_groups(organization_id,display_name,verification_state,requested_by,submission_evidence_ref) "+
        "VALUES($1,$2,'pending',$3,$4) RETURNING id,verification_state",
        [org,name,actor,evidence]);
      for(const id of ids)await c.query(
        'INSERT INTO ms.family_memberships(family_group_id,student_id,relationship_basis) VALUES($1,$2,$3)',
        [r.rows[0].id,id,evidence]);
      await audit(c,ctx,'family',r.rows[0].id,'FAMILY_REVIEW_REQUESTED',
        '已提交'+ids.length+'名学生的家庭关系核实，审核前不视为已确认家庭',{}, {'待核实学生人数':ids.length,'家庭关系状态':'待核实'});
      return {family_group_id:r.rows[0].id,verification_state:'pending',student_ids:ids};
    }
    case 'decideFamily': {
      object(body,['decision','review_evidence_ref','reason_zh']);
      if(!ctx.manager)fail(403,'FORBIDDEN','只有本机构主管有权审核家庭关系');
      const groupId=needId(p[0],'家庭申请编号');
      const decision=body.decision;
      if(!['approved','rejected'].includes(decision))
        fail(422,'VALIDATION_ERROR','请选择批准或驳回');
      const evidence=needText(body.review_evidence_ref,'独立核实凭据编号',200);
      const reason=needText(body.reason_zh,'审核原因',400);
      const before=await c.query(
        "SELECT id,verification_state,requested_by,display_name "+
        "FROM ms.family_groups WHERE id=$1 AND organization_id=$2 FOR UPDATE",
        [groupId,org]);
      if(!before.rowCount)fail(404,'NOT_FOUND','该家庭关联申请不存在');
      const family=before.rows[0];
      if(family.verification_state!=='pending')
        fail(409,'ALREADY_REVIEWED','该家庭关联申请已经审核，不能重复审批');
      if(!family.requested_by)
        fail(409,'OLD_REQUEST_REQUIRES_REVIEW','旧申请缺少申请人信息，不能直接批准');
      if(family.requested_by===actor)
        fail(403,'SELF_APPROVAL_FORBIDDEN','申请人不能审批自己的家庭关联申请');
      const members=await c.query(
        "SELECT COUNT(DISTINCT m.student_id)::integer AS n,"+
        "COUNT(*) FILTER (WHERE s.organization_id IS DISTINCT FROM $2)::integer AS invalid "+
        "FROM ms.family_memberships m JOIN ms.students s ON s.id=m.student_id "+
        "WHERE m.family_group_id=$1 AND m.revoked_at IS NULL",
        [groupId,org]);
      if(members.rows[0].n<2||members.rows[0].invalid!==0)
        fail(422,'VALIDATION_ERROR','家庭核实至少需要两名本机构不同学生');
      await c.query(
        "INSERT INTO ms.family_review_decisions(family_group_id,reviewer_user_id,decision,review_evidence_ref,reason_zh)"+
        " VALUES($1,$2,$3,$4,$5)",[groupId,actor,decision,evidence,reason]);
      const status=decision==='approved'?'verified':'rejected';
      if(decision==='approved'){
        await c.query(
          "UPDATE ms.family_groups SET verification_state='verified',verified_by=$2,verified_at=now()"+
          " WHERE id=$1",[groupId,actor]);
        await c.query(
          "UPDATE ms.family_memberships SET verified_by=$2,verified_at=now() "+
          "WHERE family_group_id=$1 AND revoked_at IS NULL",[groupId,actor]);
      }else{
        await c.query("UPDATE ms.family_groups SET verification_state='rejected' WHERE id=$1",[groupId]);
      }
      await audit(c,ctx,'family',groupId,
        decision==='approved'?'FAMILY_APPROVED':'FAMILY_REJECTED',
        '家庭关联“'+family.display_name+'”'+
          (decision==='approved'?'经独立主管核实批准':'经独立主管核实驳回')+'；审核理由：'+reason,
        {'关系状态':'待核实'},
        {'关系状态':decision==='approved'?'已核实':'已驳回','审核人':ctx.user.display_name,'审核依据编号':evidence});
      return {family_group_id:groupId,verification_state:status,reviewer_name:ctx.user.display_name};
    }
    case 'getAudit': {
      const ty=requestUrl.searchParams.get('object_type'),id=requestUrl.searchParams.get('object_id');
      if(!ty||!id)fail(422,'VALIDATION_ERROR','请指定要查看的业务对象');
      needId(id,'业务对象');
      if(ty==='student')await ownsStudent(c,ctx,id);
      else if(ty==='lead')await ownsLead(c,ctx,id);
      else if(ty==='opportunity')await ownsOpportunity(c,ctx,id);
      else if(ty==='identity_change'){
        if(!ctx.manager)fail(403,'FORBIDDEN','只有主管可查看员工身份审批记录');
        const q=await c.query(
          'SELECT 1 FROM ms.identity_change_requests WHERE id=$1 AND organization_id=$2',[id,org]);
        if(!q.rowCount)fail(404,'NOT_FOUND','该身份审批申请不存在');
      }
      else if(ty==='family'){
        if(!ctx.manager)fail(403,'FORBIDDEN','只有本机构主管可查看家庭关系审批历史');
        const family=await c.query('SELECT 1 FROM ms.family_groups WHERE id=$1 AND organization_id=$2',[id,org]);
        if(!family.rowCount)fail(404,'NOT_FOUND','没有找到有权查看的家庭关系');
      }
      else fail(403,'FORBIDDEN','该业务记录暂无开放的审计查询权限');
      const r=await c.query(
        'SELECT id,reason_zh,happened_at,before_business_json,after_business_json FROM ms.audit_events'+
        ' WHERE organization_id=$1 AND target_type=$2 AND target_id=$3 ORDER BY happened_at DESC LIMIT 100',
        [org,ty,id]);
      const fmt=x=>Object.entries(x||{}).map(([k,v])=>k+'：'+String(v)).join('；');
      return {items:r.rows.map(x=>({
        event_id:x.id,summary_zh:x.reason_zh,
        before_business_summary_zh:fmt(x.before_business_json),
        after_business_summary_zh:fmt(x.after_business_json),
        happened_at:x.happened_at
      }))};
    }
    default: fail(404,'NOT_FOUND','没有找到该业务接口');
  }
}
async function readJson(req){
  const chunks=[];let size=0;
  for await(const chunk of req) {
    size+=chunk.length;if(size>32768)fail(413,'PAYLOAD_TOO_LARGE','请求内容超过允许大小');
    chunks.push(chunk);
  }
  if(!size)fail(400,'VALIDATION_ERROR','请填写业务内容');
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  catch{fail(400,'VALIDATION_ERROR','请求内容不是有效格式');}
}
const send=(res,status,json,requestId)=>{
  const data=JSON.stringify({...json,request_id:requestId});
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(data);
};
export function createApp(pool,{secret,issuer='market-sales-test-issuer',devLoginSecret,externalIdentity,scopedReadPools,scopedWritePools,identityDirectoryPool,strictStaffMode=false}={}) {
  if(process.env.MS_STAGE!=='isolated-test'||typeof secret!=='string'||secret.length<32)
    throw new Error('Isolated-test mode and strong test-only signing secret required; production auth is not implemented');
  // Explicit opt-in migration: legacy demo behavior is unchanged unless
  // dedicated employee pools have been configured by the trusted server.
  // Providing an empty Map deliberately denies ALL migrated reads.
  if(scopedReadPools!==undefined && !(scopedReadPools instanceof Map))
    throw new Error('Scoped legacy read mode requires a trusted staff-to-DB-pool Map');
  if(scopedWritePools!==undefined && !(scopedWritePools instanceof Map))
    throw new Error('Scoped legacy write mode requires a trusted staff-to-DB-pool Map');
  if((scopedWritePools!==undefined||scopedReadPools!==undefined)&&!externalIdentity)
    throw new Error('Employee scoped mode requires the trusted RS256 issuer/audience/JWKS configuration');
  if(strictStaffMode&&(!externalIdentity||!(scopedReadPools instanceof Map)||
      !(scopedWritePools instanceof Map)||!identityDirectoryPool?.connect))
    throw new Error('Strict employee mode requires trusted RS256, read/write pools and function-only identity directory');
  const externalVerifier=externalIdentity?createExternalTokenVerifier(externalIdentity):null;
  return createServer(async(req,res)=>{
    const requestId=randomUUID();
    let c;
    try {
      const url=new URL(req.url,'http://localhost');
      if(req.method==='GET'&&await serveUi(url.pathname,res))return;
      if(url.pathname==='/api/v1/dev/login'&&req.method==='POST'){
        if(strictStaffMode)fail(404,'NOT_FOUND','严格员工模式不允许演示口令登录');
        if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress))
          fail(403,'FORBIDDEN','演示登录仅允许本机访问');
        const body=await readJson(req);
        c=await pool.connect();
        const result=await demoLogin(c,body,{secret,issuer,devLoginSecret});
        send(res,200,{code:'OK',message:'已进入虚构数据演示工作台',data:result},requestId);
        return;
      }
      if(url.pathname==='/api/v1/health'&&req.method==='GET'){
        send(res,200,{code:'OK',message:'隔离测试服务已启动',data:{stage:'isolated-test',strict_employee_mode:strictStaffMode}},requestId);return;
      }
      const route=routeDefs.map(([method,re,op])=>({method,match:re.exec(url.pathname),op}))
        .find(x=>x.method===req.method&&x.match);
      if(!route)fail(404,'NOT_FOUND','没有找到该业务接口');
      // Channel maintenance is CI-only and requires approved strict staff logins.
      // Never run this through the broad tenant-level demo connection.
      if(!strictStaffMode&&['listCampaignSalesReviews','requestCampaignSalesReview','decideCampaignSalesReview','reviseCampaignDraft'].includes(route.op))
        fail(403,'STAFF_ROUTE_UNMIGRATED','仅已核实员工可修改隔离活动草稿');
      if(!strictStaffMode&&['listCampaignDrafts','createCampaignDraft','listChannelChangeRequests','listChannelAuditHistory','requestChannelChange','reviewChannelChange'].includes(route.op))
        fail(403,'STAFF_ROUTE_UNMIGRATED','渠道维护只能通过隔离员工独立审批流程');
      // Strict mode deliberately blocks every old non-migrated broad write.
      // Also blocks old manager-level family, identity, audit and other reads
      // until they receive their own scoped SQL/HTTP security migration.
      if(strictStaffMode && !(
        req.method==='GET' && (route.op==='getMe'||
          migratedLegacyReads.has(route.op)) ||
        req.method==='POST' && migratedLegacyWrites.has(route.op)
      ))fail(403,'STAFF_ROUTE_UNMIGRATED','此业务尚未完成员工专属权限迁移，严格模式下已关闭');
      const token=(req.headers.authorization||'').match(/^Bearer (\S+)$/i)?.[1];
      let identity,externalClaims;
      if(externalVerifier && typeof token==='string'){
        // Dispatch only by header algorithm; all trust derives from signature verification.
        let alg;
        try{alg=JSON.parse(Buffer.from(token.split('.')[0],'base64url').toString('utf8')).alg;}
        catch{fail(401,'AUTH_REQUIRED','身份凭据无效');}
        if(alg==='RS256')externalClaims=externalVerifier(token);
      }
      if(strictStaffMode&&!externalClaims)
        fail(403,'STAFF_AUTH_REQUIRED','严格员工模式只接受经审核的外部 RSA 身份');
      if(!externalClaims)identity=verifyToken(token,secret,issuer);
      const body=req.method==='POST'?await readJson(req):null;
      const key=req.headers['idempotency-key'];
      if(req.method==='POST'&&(!KEY.test(key||'')))
        fail(422,'VALIDATION_ERROR','写入请求必须提供16至128位有效防重复编号');
      // Strict requests NEVER open the legacy tenant/business DB pool.
      // A separately validated function-only directory resolves current staff,
      // organization and roles only from the verified, approved RSA identity.
      let ctx;
      if(strictStaffMode){
        ctx=await resolveStrictDirectoryContext(identityDirectoryPool,externalClaims);
      }else{
        c=await pool.connect();
        await c.query('BEGIN');
        if(externalClaims)identity=await resolveExternalStaff(c,externalClaims);
        ctx=await staffContext(c,identity);
      }
      // RLS tenant is bound to PostgreSQL SESSION_USER by a migration-owner
      // protected mapping; no request/session GUC can select another tenant.
      // A service must use the correct dedicated tenant database login.
      let result;
      if(req.method==='POST'&&scopedWritePools!==undefined&&
         migratedLegacyWrites.has(route.op)){
        // This branch precedes the old organization-level idempotency receipt
        // and handler. It NEVER falls through to their broad SQL credentials.
        result=await writeLegacyViaStaffPool({
          pools:scopedWritePools,context:ctx,claims:externalClaims,
          operation:route.op,body,idempotencyKey:key,
          routeParams:route.match.slice(1)
        });
      }else if(req.method==='POST'){
        const hash=digest(req.method,url.pathname,body);
        const reserved=await c.query(
          "INSERT INTO ms.api_write_receipts(organization_id,actor_user_id,request_key,operation_name,request_digest,response_json)"+
          " VALUES($1,$2,$3,$4,$5,'{}'::jsonb) ON CONFLICT DO NOTHING RETURNING id",
          [ctx.user.organization_id,ctx.user.id,key,route.op,hash]);
        if(reserved.rowCount){
          result=await handle(c,ctx,route.op,route.match.slice(1),body,url);
          await c.query('UPDATE ms.api_write_receipts SET response_json=$2 WHERE id=$1',
            [reserved.rows[0].id,JSON.stringify(result)]);
        } else {
          const existing=await c.query('SELECT operation_name,request_digest,response_json FROM ms.api_write_receipts'+
            ' WHERE organization_id=$1 AND actor_user_id=$2 AND request_key=$3',
            [ctx.user.organization_id,ctx.user.id,key]);
          if(!existing.rowCount||existing.rows[0].request_digest!==hash||
            existing.rows[0].operation_name!==route.op)
            fail(409,'IDEMPOTENCY_CONFLICT','同一防重复编号已用于另一项操作，请核实原请求');
          result=existing.rows[0].response_json;
        }
      } else if(scopedReadPools!==undefined && migratedLegacyReads.has(route.op)) {
        result=await readLegacyViaStaffPool({
          pools:scopedReadPools,context:ctx,claims:externalClaims,
          operation:route.op,params:route.match.slice(1)
        });
      } else result=await handle(c,ctx,route.op,route.match.slice(1),null,url);
      if(strictStaffMode&&route.op==='getMe'){
        result={
          ...result,
          capabilities:{
            view_own_students:true,create_students:true,create_contacts:true,
            link_own_student_contact:true,record_own_contact_consultation:true,
            request_contact_custody:true,review_contact_custody:ctx.manager,review_custody_disputes:ctx.manager,
             request_lead_candidate:true,review_lead_candidate:ctx.manager,
             request_conversion_readiness:true,review_conversion_readiness:ctx.manager,
             request_attribution_dispute:true,review_attribution_dispute:ctx.manager,
              request_final_lead_conversion:true,approve_final_lead_conversion:ctx.manager,
              execute_own_approved_lead_conversion:true,
              request_single_student_lead_link:true,review_student_lead_link:ctx.manager,
              request_student_link_verification:true,review_student_link_verification:ctx.manager,
              request_wrong_student_withdrawal:true,review_wrong_student_withdrawal:ctx.manager,
              request_downstream_student_correction:true,review_downstream_student_correction:ctx.manager,
              attest_downstream_reconciliation:ctx.manager,resolve_downstream_reconciliation:ctx.manager,
              request_lead_adjustment:true,review_lead_adjustment:ctx.manager,
              propose_channel_change:true,review_channel_change:ctx.manager,
              create_campaign_draft:true,revise_own_campaign_draft:true,
              request_campaign_sales_review:true,review_campaign_sales:ctx.manager,
            manage_own_leads:false,propose_family_review:false,
            decide_other_person_family_review:false,review_family_audit:false,
            manage_identity_requests:false,
            strict_employee_mode:true
          },
          environment:'isolated-trusted-employee-test'
        };
      }
      if(c)await c.query('COMMIT');
      send(res,200,{code:'OK',message:'操作成功',data:result},requestId);
    } catch(e){
      if(c)try{await c.query('ROLLBACK');}catch{}
      const pgCode=String(e?.code||'');
      const status=e instanceof AppError?e.status:
        pgCode==='23505'?409:pgCode==='23503'||pgCode==='23514'?422:500;
      const code=e instanceof AppError?e.code:pgCode==='23505'?'DUPLICATE_RELATION':
        pgCode==='23503'||pgCode==='23514'?'BUSINESS_CONSTRAINT':'INTERNAL_ERROR';
      const message=e instanceof AppError?e.message:pgCode==='23505'?'该关系已经存在':
        pgCode==='23503'||pgCode==='23514'?'业务数据不满足保存条件':'操作失败，请核实原请求结果';
      send(res,status,{code,message},requestId);
    } finally{if(c)c.release();}
  });
}
