// V3.2-28: isolated read-only source-authentication PREPARATION.
// Verifies a signed *fixture transport envelope*, not a real institution.
// No HTTP, no production keys, no payment/CRM API, no DB writes, no authorization.
import {createHash,createPublicKey,verify as verifySignature} from 'node:crypto';
import {normalizeUntrustedAuthorityCandidate} from './cross-module-authority-contract.mjs';

const ID=/^[a-z][a-z0-9_-]{2,63}$/;
const TENANT=/^[A-Za-z0-9_-]{2,80}$/;
const SAFE=/^[A-Za-z0-9_:.-]{6,160}$/;
const CURSOR=/^[A-Za-z0-9_:.-]{6,160}$/;
const UTC=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const SHA=/^[a-f0-9]{64}$/;
const B64URL=/^[A-Za-z0-9_-]{86}$/;
const ALLOWED_DEPTS=new Set(['finance','academic']);
const FIELDS=['schema_version','department','source_system','source_tenant',
 'issuer','audience','key_id','batch_id','page_index',
 'previous_cursor','next_cursor','is_final_page','source_sequence',
 'source_watermark','issued_at','payload_sha256','payload','signature'];
const SIGNED_FIELDS=FIELDS.filter(k=>k!=='payload'&&k!=='signature');
const DOMAIN='CRM_MARKET_SALES_TEST_SOURCE_ENVELOPE_V1\n';

function exact(value,keys){
 return value!==null&&typeof value==='object'&&!Array.isArray(value)
  &&(Object.getPrototypeOf(value)===Object.prototype||
     Object.getPrototypeOf(value)===null)
  &&Object.keys(value).length===keys.length
  &&keys.every(k=>Object.hasOwn(value,k));
}
function bounded(value){return Number.isSafeInteger(value)&&value>=0;}
function validUtc(value){
 if(typeof value!=='string'||!UTC.test(value))return false;
 const t=Date.parse(value);
 return Number.isFinite(t)&&new Date(t).toISOString()===
   new Date(Date.parse(value)).toISOString()&&value.startsWith(new Date(t).toISOString().slice(0,19));
}
function nonempty(v,re){return typeof v==='string'&&re.test(v);}
function signatureMaterial(envelope){
 const input={};
 for(const key of SIGNED_FIELDS)input[key]=envelope[key];
 return Buffer.from(DOMAIN+JSON.stringify(input),'utf8');
}
function reject(reason){
 const e=new Error('隔离来源校验拒绝：'+reason);
 e.code='SOURCE_FIXTURE_REJECTED';
 throw e;
}

/**
 * Test-fixture-only trust resolver. Sources are supplied OUT OF BAND by a
 * local harness, never learned from the signed envelope. A valid signature
 * proves possession of a fixture key, NOT an authorized bank/CRM source.
 *
 * ledger: a new ephemeral Map per test run. Production replay safety would
 * require transactional, durable storage and authoritative source watermarks.
 */
export function verifyReadOnlyFixtureEnvelope(envelope,options){
 const {trustedFixtures,expectedDepartment,expectedTenant,expectedAudience,
   nowMs=Date.now(),ledger}=options||{};
 if(!Array.isArray(trustedFixtures)||!ALLOWED_DEPTS.has(expectedDepartment)||
   !nonempty(expectedTenant,TENANT)||!nonempty(expectedAudience,SAFE)||
   !(ledger instanceof Map)||!Number.isFinite(nowMs))
  reject('缺少调用侧可信租户和测试信任配置');
 if(!exact(envelope,FIELDS))reject('信封字段缺失或存在未列明字段');
 if(envelope.schema_version!=='v3.2-28-fixture-transport-v1'||
   envelope.department!==expectedDepartment||
   envelope.source_tenant!==expectedTenant||
   !nonempty(envelope.source_system,ID)||
   !nonempty(envelope.issuer,SAFE)||
   !nonempty(envelope.audience,SAFE)||
   envelope.audience!==expectedAudience||
   !nonempty(envelope.key_id,SAFE)||
   !nonempty(envelope.batch_id,SAFE)||
   !bounded(envelope.page_index)||envelope.page_index===0||
   !bounded(envelope.source_sequence)||envelope.source_sequence===0||
   !bounded(envelope.source_watermark)||
   typeof envelope.is_final_page!=='boolean'||
   (envelope.previous_cursor!==null&&!nonempty(envelope.previous_cursor,CURSOR))||
   (envelope.next_cursor!==null&&!nonempty(envelope.next_cursor,CURSOR))||
   (envelope.is_final_page?envelope.next_cursor!==null:envelope.next_cursor===null)||
   !nonempty(envelope.payload_sha256,SHA)||
   !validUtc(envelope.issued_at)||
   !nonempty(envelope.signature,B64URL))
  reject('机构、分页、时间或数字字段不符合只读合同');
 const issued=Date.parse(envelope.issued_at);
 if(issued>nowMs+60_000||issued<nowMs-10*60_000)
  reject('来源时间超过允许窗口');
 // No keys or source mappings are accepted from the envelope.
 const matching=trustedFixtures.filter(f=>f&&f.environment==='isolated-fictional'&&
  f.department===expectedDepartment&&f.tenant===expectedTenant&&
  f.sourceSystem===envelope.source_system&&f.issuer===envelope.issuer&&
  f.audience===expectedAudience&&f.keyId===envelope.key_id);
 if(matching.length!==1)reject('没有唯一匹配的离线虚构来源密钥');
 const trust=matching[0];
 if(!nonempty(trust.activeFrom,UTC)||!nonempty(trust.expiresAt,UTC)||
   !validUtc(trust.activeFrom)||!validUtc(trust.expiresAt)||
   Date.parse(trust.activeFrom)>issued||Date.parse(trust.expiresAt)<=issued||
   Date.parse(trust.expiresAt)<=nowMs)
  reject('测试密钥未生效或已过期');
 let pub;
 try{pub=createPublicKey(trust.publicKeyPem);}
 catch{reject('来源公钥无法解析');}
 if(pub.asymmetricKeyType!=='ed25519')reject('仅支持 Ed25519 测试签名');
 let normalized;
 try{
  normalized=normalizeUntrustedAuthorityCandidate(envelope.payload,{
   expectedDepartment,expectedTenant,allowedSourceSystems:[envelope.source_system],nowMs
  });
 }catch{reject('载荷不满足 V3.2-27 不可信候选合同');}
 if(envelope.payload.source_system!==envelope.source_system||
    envelope.payload.source_tenant!==expectedTenant||
    normalized.candidate_sha256!==envelope.payload_sha256)
  reject('载荷与签名信封绑定的来源或哈希不一致');
 const sig=Buffer.from(envelope.signature,'base64url');
 if(sig.length!==64||sig.toString('base64url')!==envelope.signature||
  !verifySignature(null,signatureMaterial(envelope),pub,sig))
  reject('签名校验失败或消息遭到改动');
 const stream=[expectedDepartment,expectedTenant,envelope.source_system,
   envelope.payload.source_kind,envelope.payload.source_object_ref].join('|');
 const digest=createHash('sha256').update(signatureMaterial(envelope)).digest('hex');
 const prior=ledger.get(stream);
 if(prior){
  if(envelope.source_sequence===prior.sequence&&digest===prior.digest){
   return Object.freeze({
    fixture_signature_verified:true,fixture_replay:'identical',
    fixture_complete_page_chain:prior.final,
    observed_source_watermark:prior.watermark,
    source_authenticated:false,finance_authority_verified:false,
    crm_authority_verified:false,execution_allowed:false,release_allowed:false,
    reason_zh:'虚构来源重复回执已识别；并非真实金融或 CRM 权威验证'
   });
  }
  if(envelope.source_sequence!==prior.sequence+1||
      envelope.source_watermark<prior.watermark)
   reject('来源顺序回退、跳号或水位下降');
  if(envelope.batch_id===prior.batch){
   if(prior.final||envelope.page_index!==prior.page+1||
      envelope.previous_cursor!==prior.nextCursor)
    reject('同批分页不连续或已结束');
  }else if(!prior.final||envelope.page_index!==1||
     envelope.previous_cursor!==null){
   reject('上批未结束或新批首张不完整');
  }
 }else if(envelope.source_sequence!==1||envelope.page_index!==1||
    envelope.previous_cursor!==null){
  reject('未建立流起点，拒绝跳页或断点冒充');
 }
 ledger.set(stream,{
   sequence:envelope.source_sequence,digest,watermark:envelope.source_watermark,
   batch:envelope.batch_id,page:envelope.page_index,
   final:envelope.is_final_page,nextCursor:envelope.next_cursor
 });
 return Object.freeze({
  fixture_signature_verified:true,fixture_replay:'new',
  fixture_complete_page_chain:envelope.is_final_page,
  observed_source_watermark:envelope.source_watermark,
  source_authenticated:false,finance_authority_verified:false,
  crm_authority_verified:false,execution_allowed:false,release_allowed:false,
  reason_zh:'只验证虚构来源签名及分页顺序；无真实机构权威、执行或隔离解除资格'
 });
}
