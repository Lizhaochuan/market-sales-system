// V3.2-10 adapter for EXISTING GET sales routes.
// When enabled, never fallback to broad tenant-level SQL for these routes.
// DB SESSION_USER is admin-bound to a single employee, independent of JWT role.
// Does NOT migrate any POST, family approvals, audit or identity-management API.
import {fail} from './auth.mjs';
import {buildIsolatedChannelCatalog} from './marketing-channel-catalog.mjs';

export const migratedLegacyReads=new Set([
  'listMarketingChannels',
  'listCampaignDrafts',
  'listCampaignSalesReviews',
  'listCampaignFinanceHandoffs',
  'listChannelChangeRequests',
  'listChannelAuditHistory',
  'listStudents','listContacts','listEvents','listLeads','listOpportunities',
  'getStudent','getLead','getOpportunity',
  'listContactCustodyRequests','listContactCustodyStaff',
  'listContactCustodyActive','listContactCustodyReviews','listRelatedStudents',
  'listCandidateConsultations','listLeadCandidates',
  'listConversionReadiness','listAttributionDisputes','listAttributionDisputable',
  'listFinalLeadConversions','listLeadStudentAssociations','listLeadStudentLinkReviews','listCurrentLeadStudentLinks','listDownstreamStudentCorrections','listDownstreamCorrectionEligible','listDownstreamReconciliations','listLeadAdjustments','listLeadCorrectionNotes'
]);

const listQueries={
  listCampaignFinanceHandoffs:
    'SELECT review_id,campaign_id,campaign_version,requested_by,sales_approved_by,submitted_at,sales_approved_at,campaign_name,planned_budget_cents,channel_count,handoff_status,finance_authorized,execution_allowed,campaign_status,readiness_status FROM ms.scoped_isolated_campaign_finance_handoffs ORDER BY sales_approved_at DESC,review_id LIMIT 101',
  listCampaignSalesReviews:
    'SELECT review_id,campaign_id,campaign_version,requested_by,status,created_at,reviewed_at,reviewed_by,can_sales_review FROM ms.scoped_isolated_campaign_sales_reviews ORDER BY created_at DESC,review_id LIMIT 101',
  listCampaignDrafts:
    'SELECT campaign_id,name,starts_at,ends_at,owner_user_id,budget_cents,status,channel_ids,version FROM ms.scoped_isolated_campaign_drafts ORDER BY name,campaign_id LIMIT 101',
  listChannelAuditHistory:
    'SELECT audit_id,request_id,event_name,actor_user_id,happened_at,action,status,requested_by FROM ms.scoped_isolated_channel_audit_history ORDER BY happened_at DESC,audit_id LIMIT 101',
  listChannelChangeRequests:
    'SELECT request_id,action,channel_id,proposed_name,proposed_parent_id,proposed_type,status,created_at,requested_by,can_review FROM ms.scoped_isolated_channel_change_requests ORDER BY created_at DESC,request_id LIMIT 101',
  listMarketingChannels:
    'SELECT id,organization_id,parent_id,name,channel_type,status FROM ms.scoped_marketing_channel_catalog ORDER BY id LIMIT 201',
  listDownstreamReconciliations:
    'SELECT case_id,association_request_id,student_id,lead_id,student_name,case_status,finding_id,finding,finding_created_at,resolution,resolved_at,first_reviewer_id,requested_by FROM ms.scoped_downstream_student_reconciliations ORDER BY student_name,case_id LIMIT 100',
  listDownstreamStudentCorrections:
    'SELECT case_id,association_request_id,lead_id,student_id,student_name,status,created_at,requested_by,opportunity_count,quote_count,order_count,allocation_count,refund_allocation_count,trial_count,sale_event_count,entitlement_count FROM ms.scoped_downstream_student_correction_cases ORDER BY created_at DESC,case_id LIMIT 100',
  listDownstreamCorrectionEligible:
    'SELECT association_request_id,lead_id,student_id,student_name,current_state,opportunity_count FROM ms.scoped_downstream_student_correction_eligible ORDER BY student_name,association_request_id LIMIT 100',
  listLeadStudentLinkReviews:
    'SELECT review_id,association_request_id,lead_id,student_id,student_name,action,status,created_at,requested_by,current_state FROM ms.scoped_lead_student_link_review_requests ORDER BY created_at DESC,review_id LIMIT 100',
  listCurrentLeadStudentLinks:
    'SELECT association_request_id,lead_id,student_id,student_name,current_state FROM ms.scoped_lead_student_link_current ORDER BY student_name,association_request_id LIMIT 100',
  listLeadStudentAssociations:
    'SELECT request_id,lead_id,student_id,student_name,status,created_at,requested_by FROM ms.scoped_lead_student_associations ORDER BY created_at DESC,request_id LIMIT 100',
  listLeadAdjustments:
    'SELECT request_id,lead_id,action,action_name,status,created_at,requested_by FROM ms.scoped_lead_adjustment_requests ORDER BY created_at DESC,request_id LIMIT 100',
  listLeadCorrectionNotes:
    'SELECT lead_id,corrected_note,applied_at FROM ms.scoped_lead_correction_notes ORDER BY applied_at DESC,lead_id LIMIT 100',
  listFinalLeadConversions:
    'SELECT authorization_id,readiness_id,candidate_id,status,created_at,contact_name,lead_id,executed_at,requested_by FROM ms.scoped_final_lead_conversion_requests ORDER BY created_at DESC,authorization_id LIMIT 100',
  listConversionReadiness:
    'SELECT review_id,candidate_id,status,created_at,contact_name,effective_status FROM ms.scoped_conversion_readiness ORDER BY created_at DESC,review_id LIMIT 100',
  listAttributionDisputes:
    'SELECT dispute_id,candidate_id,claimed_event_id,status,created_at,contact_name,claimant_id FROM ms.scoped_lead_attribution_disputes ORDER BY created_at DESC,dispute_id LIMIT 100',
  listAttributionDisputable:
    'SELECT candidate_id,contact_name,own_event_id,own_event_type FROM ms.scoped_attribution_disputable_candidates ORDER BY contact_name,candidate_id LIMIT 100',
  listCandidateConsultations:
    'SELECT event_id,event_type,occurred_at,contact_name FROM ms.scoped_consultations_for_candidates ORDER BY occurred_at DESC,event_id LIMIT 100',
  listLeadCandidates:
    'SELECT candidate_id,source_event_id,status,created_at,contact_name,event_type,occurred_at,requested_by FROM ms.scoped_consultation_lead_candidates ORDER BY created_at DESC,candidate_id LIMIT 100',
  listContactCustodyActive:
    'SELECT assignment_id,contact_id,contact_name,assignee_id,granted_at FROM ms.scoped_contact_custody_active ORDER BY granted_at DESC LIMIT 100',
  listContactCustodyReviews:
    'SELECT review_id,assignment_id,kind,status,contact_name,created_at FROM ms.scoped_contact_custody_reviews ORDER BY created_at DESC LIMIT 100',
  listRelatedStudents:
    'SELECT student_id,student_name,contact_relation FROM ms.scoped_related_student_basic ORDER BY student_id LIMIT 100',
  listContactCustodyRequests:
    'SELECT request_id,contact_name,requester_name,target_name,requested_by,target_staff_id,status,created_at '+
    'FROM ms.scoped_contact_custody_requests ORDER BY created_at DESC,request_id LIMIT 100',
  listContactCustodyStaff:
    'SELECT staff_id,staff_name FROM ms.scoped_contact_custody_staff ORDER BY staff_name,staff_id LIMIT 100',
  listStudents:
    'SELECT student_id,display_name,owner_user_id FROM ms.scoped_legacy_student_details ORDER BY student_id LIMIT 100',
  listContacts:
    'SELECT contact_id,display_name,do_not_contact FROM ms.scoped_contacts_directory ORDER BY contact_id LIMIT 100',
  listEvents:
    'SELECT event_id,event_type,occurred_at FROM ms.scoped_contact_events_directory ORDER BY event_id LIMIT 100',
  listLeads:
    'SELECT lead_id,lead_state,created_at FROM ms.scoped_leads_directory ORDER BY lead_id LIMIT 100',
  listOpportunities:
    'SELECT o.opportunity_id,o.student_id,o.owner_user_id,o.lifecycle_state,'+
    's.display_name AS student_display_name FROM ms.scoped_legacy_opportunity_details o '+
    'JOIN ms.scoped_legacy_student_details s ON s.student_id=o.student_id ORDER BY o.opportunity_id LIMIT 100'
};

function projectList(op,rows,employee){
  if(op==='listStudents')return rows.map(r=>({
    ...r,grade_label:'已隐藏',
    owner_display_name:r.owner_user_id===employee.id?employee.display_name:'已隐藏'
  }));
  if(op==='listEvents')return rows.map(r=>({...r,contact_display_name:null}));
  if(op==='listLeads')return rows.map(r=>({...r,contact_display_name:null}));
  if(op==='listOpportunities')return rows.map(r=>({
    ...r,predicted_amount_cents:null,owner_display_name:employee.display_name
  }));
  return rows;
}
const detailQueries={
  getStudent:{
    query:'SELECT student_id,display_name,owner_user_id FROM ms.scoped_legacy_student_details WHERE student_id=$1 LIMIT 1',
    message:'没有找到有权查看的学生'
  },
  getLead:{
    query:'SELECT lead_id,contact_id FROM ms.scoped_legacy_lead_details WHERE lead_id=$1 LIMIT 1',
    message:'没有找到有权查看的线索'
  },
  getOpportunity:{
    query:'SELECT opportunity_id,student_id,owner_user_id,stage,lifecycle_state '+
      'FROM ms.scoped_legacy_opportunity_details WHERE opportunity_id=$1 LIMIT 1',
    message:'没有找到有权查看的商机'
  }
};
export async function readLegacyViaStaffPool({pools,context,claims,operation,params}){
  if(process.env.MS_STAGE!=='isolated-test')
    throw new Error('Restricted legacy read mode is isolated only');
  if(!migratedLegacyReads.has(operation))throw new Error('Unsupported legacy read operation');
  // Fail closed rather than fall back to a manager's previous organization-wide
  // access or to the unscoped tenant DB pool.
  if(!claims?.issuer||!claims?.subject)
    fail(403,'STAFF_READ_RESTRICTED','此查询需要经过审核的外部员工身份');
  if(!(pools instanceof Map))
    throw new Error('Trusted staff DB pool map is required');
  const pool=pools.get(context.user.id);
  if(!pool||typeof pool.connect!=='function')
    fail(403,'STAFF_READ_RESTRICTED','该员工没有经审核的专用只读数据库账号');
  let client;
  try{
    client=await pool.connect();
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const check=await client.query(
      'SELECT ms.current_scoped_staff_id() AS staff_id, '+
      'ms.current_scoped_organization_id() AS org_id, '+
      'ms.scoped_employee_identity_valid($1,$2) AS identity_ok',
      [claims.issuer,claims.subject]
    );
    const x=check.rows[0];
    if(!x||!x.identity_ok||x.staff_id!==context.user.id||
      x.org_id!==context.user.organization_id)
      fail(403,'STAFF_READ_RESTRICTED','员工账号与数据授权不一致，已拒绝读取');

    let data;
    if(listQueries[operation]){
      const r=await client.query(listQueries[operation]);
      if(['listChannelChangeRequests','listChannelAuditHistory','listCampaignDrafts','listCampaignSalesReviews','listCampaignFinanceHandoffs'].includes(operation)&&r.rows.length>100)
        throw new TypeError('Channel request list exceeds safe bounded projection');
      data=operation==='listMarketingChannels'
        ?buildIsolatedChannelCatalog(r.rows,context.user.organization_id)
        :{items:projectList(operation,r.rows,context.user)};
    }else{
      const detail=detailQueries[operation];
      const id=params?.[0];
      if(typeof id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
        fail(422,'VALIDATION_ERROR','业务编号格式不正确');
      const r=await client.query(detail.query,[id]);
      if(!r.rowCount)fail(404,'NOT_FOUND',detail.message);
      data=r.rows[0];
      if(operation==='getLead'){
        const links=await client.query(
          'SELECT student_id FROM ms.scoped_legacy_lead_student_links '+
          'WHERE lead_id=$1 ORDER BY student_id LIMIT 100',[id]);
        data={...data,student_ids:links.rows.map(x=>x.student_id)};
      }
    }
    await client.query('COMMIT');
    return data;
  }catch(error){
    if(client)try{await client.query('ROLLBACK');}catch{}
    throw error;
  }finally{if(client)client.release();}
}
