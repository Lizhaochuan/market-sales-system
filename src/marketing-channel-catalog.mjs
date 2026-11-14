// M01: isolated/demo only; validates a single-institution channel hierarchy.
// Strict employee mode stays disabled until a separately reviewed, function-only
// DB projection exists. Never grants finance, CRM, attribution or write access.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CHANNELS=200;
function broken(){throw new TypeError('Channel hierarchy is not a trusted single-institution catalog');}
export function buildIsolatedChannelCatalog(rows,orgId){
 if(!UUID.test(orgId||'')||!Array.isArray(rows)||rows.length>MAX_CHANNELS)broken();
 const nodes=new Map();
 for(const row of rows){
  if(!row||!UUID.test(row.id||'')||row.organization_id!==orgId||
     row.parent_id!==null&&!UUID.test(row.parent_id||'')||
     typeof row.name!=='string'||!row.name.trim()||row.name.length>200||
     row.channel_type!==null&&(
      typeof row.channel_type!=='string'||row.channel_type.length>100)||
     !['active','inactive'].includes(row.status)||nodes.has(row.id))broken();
  nodes.set(row.id,row);
 }
 const states=new Map(),depths=new Map(),effective=new Map();
 function walk(id){
  if(states.get(id)==='visiting')broken();
  if(states.get(id)==='done')return depths.get(id);
  const current=nodes.get(id);
  if(!current)broken();
  states.set(id,'visiting');
  let depth=0,parentEnabled=true;
  if(current.parent_id!==null){
   if(current.parent_id===id||!nodes.has(current.parent_id))broken();
   depth=walk(current.parent_id)+1;
   parentEnabled=effective.get(current.parent_id)==='active';
  }
  if(depth>16)broken();
  depths.set(id,depth);
  effective.set(id,current.status==='inactive'?'inactive':
   parentEnabled?'active':'inactive_inherited');
  states.set(id,'done');
  return depth;
 }
 for(const id of nodes.keys())walk(id);
 const channels=[...nodes.values()].map(row=>Object.freeze({
  channel_id:row.id,
  parent_channel_id:row.parent_id,
  name:row.name.trim(),
  channel_type:row.channel_type,
  status:row.status,
  effective_status:effective.get(row.id),
  depth:depths.get(row.id)
 })).sort((a,b)=>a.depth-b.depth||
    a.name.localeCompare(b.name,'zh-CN')||a.channel_id.localeCompare(b.channel_id));
 return Object.freeze({
  schema_version:'m01-isolated-channel-catalog-v1',
  count:channels.length,root_count:channels.filter(x=>x.parent_channel_id===null).length,
  effective_active_count:channels.filter(x=>x.effective_status==='active').length,
  channels:Object.freeze(channels),
  source_attribution_verified:false,
  sales_event_amount_aggregated:false,
  cross_student_family_inference_allowed:false,
  production_integration_allowed:false,
  status:'isolated_readonly_not_production'
 });
}
