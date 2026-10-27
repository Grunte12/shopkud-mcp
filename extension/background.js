"use strict";
if(typeof importScripts==="function")importScripts("transport.js");
let socketConfig = null;
let connectionReady = typeof importScripts!=="function";
const HOST = "org.shopkud.mcp";
const EXTENSION_ROOT = typeof chrome.runtime.getURL==="function" ? chrome.runtime.getURL("") : `chrome-extension://${chrome.runtime.id}/`;
const pages = new Map();
const inFlight = new Map();
const ownedEntries = new Map();
const workTabs = new Map();
let tabLedgerWrite=Promise.resolve();
const tabRecovery=(async()=>{
  const saved=await chrome.storage?.session?.get?.("shopkudWorkTabs");
  for(const entry of saved?.shopkudWorkTabs || []){
    if(!Number.isInteger(entry.id) || typeof entry.url!=="string")continue;
    const tab=await tabInfo(entry.id);
    // Recovery never adopts tabs by URL or by their group name.
    if(tab?.url===entry.url && tab.active===false){workTabs.set(entry.id,entry.url);}
  }
})().catch(()=>{});
function saveWorkTabs(){
  const entries=[...workTabs].map(([id,url])=>({id,url}));
  tabLedgerWrite=tabLedgerWrite.catch(()=>{}).then(()=>chrome.storage?.session?.set?.({shopkudWorkTabs:entries}));
  return tabLedgerWrite;
}
async function rememberWorkTab(id,url){await tabRecovery;workTabs.set(id,url);await saveWorkTabs();}
const claimedEntries = new Set();
const opening = new Map();
const uncertainEntries = new Set();
let entryBusy = false;
let listingEntry = null;
let listingTask = null;
let listingForegroundTab = null;
const listingAccess = {permissions:["scripting"],origins:["https://shopee.co.th/*"]};
let port = null;
let connected = false;
let recovering = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
const reconnectDelays = [1000, 3000, 8000, 15000];
const telemetryRuns = new Map();
const telemetryLimit = 60;
let developerLogs = [];
const developerLogLimit = 500;
const researchReports = new Map();
const researchReportLimit = 20;
const linkReceiptKey = "shopkudLinkReceipts";
const linkReceiptLimit = 100;
let dashboardTabId = null;
const telemetryStages = new Set(["queued","lane_started","cache_hit","scan_started","scan_completed","candidates_loaded","detail_checks_started","detail_check","ranking","completed","failed"]);
let telemetryHydrated = false;
let telemetryHydrating = null;
const finite = value => typeof value === "number" && Number.isFinite(value);
const productId = value => typeof value==="string" && /^[1-9][0-9]{0,19}$/u.test(value);
function sanitizeCitation(value) {
  if(!value || typeof value!=="object" || typeof value.title!=="string" || !value.title.trim() || value.title.length>240 || typeof value.url!=="string" || value.url.length>2048)return null;
  try {const url=new URL(value.url);if(url.protocol!=="https:" || !url.hostname || url.username || url.password)return null;return {title:value.title.trim(),url:url.href};}
  catch{return null;}
}
function sanitizeResearchReport(value) {
  if(!value || typeof value!=="object" || value.schema_version!==1 || !/^[0-9a-f]{16}$/u.test(value.report_id||"") ||
      value.trace_id!==null && value.trace_id!==undefined && !/^[0-9a-f]{16}$/u.test(value.trace_id) ||
      typeof value.query!=="string" || !value.query.trim() || value.query.length>120 || !["working","completed"].includes(value.status) ||
      !["niche","trend","purchase_intent","store_research","recommendation"].includes(value.stage) ||
      typeof value.headline!=="string" || !value.headline.trim() || value.headline.length>180 ||
      typeof value.summary!=="string" || !value.summary.trim() || value.summary.length>1600 ||
      typeof value.purchase_intent!=="string" || value.purchase_intent.length>1000 || !["low","medium","high"].includes(value.confidence) ||
      !Number.isSafeInteger(value.updated_at_unix_ms) || !Array.isArray(value.signals) || value.signals.length>12 ||
      !Array.isArray(value.citations) || value.citations.length>12 || value.product_decisions!==undefined && (!Array.isArray(value.product_decisions) || value.product_decisions.length>10))return null;
  const citations=value.citations.map(sanitizeCitation).filter(Boolean);
  const signals=[];
  for(const raw of value.signals){
    if(!raw || typeof raw!=="object" || !["trend","purchase_intent","competition","trust","marketing_support","price"].includes(raw.kind) ||
        typeof raw.label!=="string" || !raw.label.trim() || raw.label.length>120 || typeof raw.value!=="string" || !raw.value.trim() || raw.value.length>120 ||
        raw.score!==null && (!Number.isInteger(raw.score) || raw.score<0 || raw.score>100) ||
        typeof raw.rationale!=="string" || !raw.rationale.trim() || raw.rationale.length>600 ||
        !Array.isArray(raw.source_indexes) || raw.source_indexes.length>3 ||
        raw.source_indexes.some(index=>!Number.isInteger(index) || index<0 || index>=citations.length))continue;
    signals.push({kind:raw.kind,label:raw.label.trim(),value:raw.value.trim(),score:raw.score,
      rationale:raw.rationale.trim(),source_indexes:[...raw.source_indexes]});
  }
  const product_decisions=[],decisionIds=new Set();let recommended=0;
  for(const raw of (value.product_decisions || [])){
    if(!raw || typeof raw!=="object" || !productId(raw.product_id) || decisionIds.has(raw.product_id) ||
        !["candidate","recommended","rejected","needs_evidence"].includes(raw.status) ||
        typeof raw.reason!=="string" || !raw.reason.trim() || raw.reason.length>600 ||
        !Array.isArray(raw.source_indexes) || raw.source_indexes.length>3 ||
        raw.source_indexes.some(index=>!Number.isInteger(index) || index<0 || index>=citations.length))return null;
    decisionIds.add(raw.product_id);if(raw.status==="recommended")recommended++;
    product_decisions.push({product_id:raw.product_id,status:raw.status,reason:raw.reason.trim(),source_indexes:[...raw.source_indexes]});
  }
  if(recommended>1)return null;
  if(value.status==="completed" && !citations.length)return null;
  return {schema_version:1,report_id:value.report_id,trace_id:value.trace_id || null,query:value.query.trim(),status:value.status,stage:value.stage,
    headline:value.headline.trim(),summary:value.summary.trim(),purchase_intent:value.purchase_intent.trim(),
    confidence:value.confidence,updated_at_unix_ms:value.updated_at_unix_ms,signals,product_decisions,citations};
}
function decisionsMatchRun(report) {
  if(!report.product_decisions.length)return true;
  const run=report.trace_id ? telemetryRuns.get(report.trace_id) : null;
  if(!run || run.dashboard?.report_id!==report.report_id)return false;
  const products=new Set((run.dashboard.results || []).map(item=>item?.product_id).filter(productId));
  return report.product_decisions.every(decision=>products.has(decision.product_id));
}
function sanitizeDashboard(value) {
  if(!value || typeof value!=="object" || value.schema_version!==1 || typeof value.query!=="string" || value.query.length>120 ||
      value.report_id!==null && value.report_id!==undefined && !/^[0-9a-f]{16}$/u.test(value.report_id) ||
      !["social","shopee_live","shopee_video"].includes(value.channel) || !["live","recent","fast"].includes(value.freshness) ||
      typeof value.partial_market_coverage!=="boolean" || typeof value.cache_hit!=="boolean" || !finite(value.cache_age_ms) || value.cache_age_ms<0 ||
      !Array.isArray(value.results) || value.results.length>10)return undefined;
  const safeOffer=value=>{
    try {const url=new URL(value);return url.origin==="https://affiliate.shopee.co.th" && !url.username && !url.password && !url.search && !url.hash && /^\/offer\/product_offer\/[1-9][0-9]{0,19}$/u.test(url.pathname)?url.href:null;}
    catch{return null;}
  };
  const safeShopee=(value,kind,expectedProduct=null)=>{
    try {
      const url=new URL(value);if(url.origin!=="https://shopee.co.th" || url.username || url.password || url.search || url.hash)return null;
      const match=(kind==="product"?/^\/product\/([1-9][0-9]{0,19})\/([1-9][0-9]{0,19})$/u:/^\/shop\/([1-9][0-9]{0,19})$/u).exec(url.pathname);
      if(!match || kind==="product" && expectedProduct!==null && match[2]!==expectedProduct)return null;
      return {url:url.href,shop_id:match[1]};
    } catch{return null;}
  };
  const safeImage=value=>{
    try {const url=new URL(value);return url.protocol==="https:" && !url.username && !url.password && /(?:^|\.)(?:susercontent|shopeemobile)\.com$/u.test(url.hostname)?url.href:null;}
    catch{return null;}
  };
  const rows=[];
  for(const raw of value.results){
    if(!raw || typeof raw!=="object" || !productId(raw.product_id) || typeof raw.name!=="string" || !raw.name || raw.name.length>240)continue;
    const offer_url=safeOffer(raw.offer_url);if(!offer_url)continue;
    const numeric={};
    for(const key of ["price_min_thb","price_max_thb","sold","commission_pct","commission_thb_per_order","extra_commission_pct","shopee_commission_pct","ranking_score"]){
      if(raw[key]===null || raw[key]===undefined)continue;
      if(!finite(raw[key]) || raw[key]<0)continue;
      numeric[key]=raw[key];
    }
    const commission_channels=[],seen_channels=new Set();
    for(const observed of (Array.isArray(raw.commission_channels)?raw.commission_channels:[]).slice(0,8)){
      if(!observed || typeof observed!=="object" || !["social","shopee_live","shopee_video"].includes(observed.channel) || seen_channels.has(observed.channel))continue;
      seen_channels.add(observed.channel);
      const channel={channel:observed.channel};
      if(typeof observed.label==="string" && observed.label.trim())channel.label=observed.label.trim().slice(0,80);
      for(const key of ["commission_pct","commission_thb_per_order","extra_commission_pct","shopee_commission_pct","extra_commission_cap_thb","shopee_commission_cap_thb"]){
        if(observed[key]===null || observed[key]===undefined)continue;
        if(finite(observed[key]) && observed[key]>=0)channel[key]=observed[key];
      }
      commission_channels.push(channel);
      if(commission_channels.length===3)break;
    }
    const productEvidence=safeShopee(raw.product_url,"product",raw.product_id),shopEvidence=safeShopee(raw.shop_url,"shop");
    const shop_id=productEvidence?.shop_id && (!shopEvidence || shopEvidence.shop_id===productEvidence.shop_id)?productEvidence.shop_id:null;
    rows.push({product_id:raw.product_id,name:raw.name,shop_id,shop_name:typeof raw.shop_name==="string"&&raw.shop_name.trim()?raw.shop_name.trim().slice(0,240):null,
      shop_name_source:["affiliate_detail","affiliate_search_card","public_seller_panel"].includes(raw.shop_name_source)?raw.shop_name_source:null,
      shop_name_status:raw.shop_name_status==="observed"?"observed":"unavailable",
      offer_url,product_url:productEvidence?.url || null,shop_url:shop_id && shopEvidence?.shop_id===shop_id?shopEvidence.url:null,image_url:safeImage(raw.image_url),mall:raw.mall===true,
      channel:["social","shopee_live","shopee_video"].includes(raw.channel)?raw.channel:value.channel,
      offer_end_date:typeof raw.offer_end_date==="string"?raw.offer_end_date.slice(0,64):null,
      observed_at:typeof raw.observed_at==="string"?raw.observed_at.slice(0,64):null,
      trust_basis:Array.isArray(raw.trust_basis)?raw.trust_basis.filter(item=>item==="mall").slice(0,4):[],commission_channels,...numeric});
  }
  const criteria={};
  const rawCriteria=value.criteria && typeof value.criteria==="object"?value.criteria:{};
  for(const key of ["mall_only","exclude_mall","min_sold","min_commission_thb","min_commission_pct","max_price_thb","exclude_preorder","target_kind","target_kind_input","minimum_query_term_matches","ranking_goal","rank_by","freshness"]){
    const item=rawCriteria[key];
    if(item===null || ["string","number","boolean"].includes(typeof item))criteria[key]=typeof item==="string"?item.slice(0,120):item;
  }
  for(const key of ["required_terms","excluded_terms","query_terms"]){
    if(Array.isArray(rawCriteria[key]))criteria[key]=rawCriteria[key].filter(item=>typeof item==="string"&&item.trim()).slice(0,12).map(item=>item.trim().slice(0,48));
  }
  const scan={};
  const rawScan=value.scan && typeof value.scan==="object"?value.scan:{};
  for(const key of ["pages_scanned","unique_products","reached_end","stop_reason","next_page","outcome"]){
    const item=rawScan[key];if(item===null || ["string","number","boolean"].includes(typeof item))scan[key]=typeof item==="string"?item.slice(0,120):item;
  }
  const exclusions={};
  if(value.exclusions && typeof value.exclusions==="object")for(const [key,item] of Object.entries(value.exclusions).slice(0,16))if(/^[a-z_]{1,48}$/u.test(key) && Number.isInteger(item) && item>=0)exclusions[key]=item;
  const relaxation_suggestions=(Array.isArray(value.relaxation_suggestions)?value.relaxation_suggestions:[]).slice(0,8).flatMap(item=>{
    if(!item || typeof item!=="object" || typeof item.parameter!=="string" || typeof item.reason!=="string")return [];
    const suggested=item.suggested;return [{parameter:item.parameter.slice(0,48),reason:item.reason.slice(0,120),suggested:suggested===null || ["string","number","boolean"].includes(typeof suggested)?suggested:null}];
  });
  const winner_product_id=productId(value.winner_product_id) && rows.some(row=>row.product_id===value.winner_product_id)?value.winner_product_id:null;
  return {schema_version:1,report_id:value.report_id || null,query:value.query,channel:value.channel,criteria,results:rows,winner_product_id,scan,exclusions,
    relaxation_suggestions,partial_market_coverage:value.partial_market_coverage,freshness:value.freshness,cache_hit:value.cache_hit,
    cache_age_ms:value.cache_age_ms,review_required:value.review_required===true,
    winner_status:value.winner_status==="metric_leader_pending_agent_review"?value.winner_status:null,
    candidate_verification_partial:value.candidate_verification_partial===true,
    observed_at:typeof value.observed_at==="string"?value.observed_at.slice(0,64):null};
}
function sanitizeTelemetry(value) {
  if(!value || typeof value!=="object" || value.schema_version!==1 || !/^[0-9a-f]{16}$/u.test(value.trace_id || "") ||
      !/^[0-9a-f]{16}$/u.test(value.swarm_id || "") || value.playbook!=="rank_affiliate_products" ||
      typeof value.query!=="string" || value.query.length>120 || !telemetryStages.has(value.stage) ||
      !["running","completed","failed"].includes(value.status) || !Number.isInteger(value.sequence) || value.sequence<1 || value.sequence>10000 ||
      !Number.isSafeInteger(value.occurred_at_unix_ms) || !finite(value.elapsed_ms) || value.elapsed_ms<0)return null;
  const scalar = key => ["string","number","boolean"].includes(typeof value[key]) || value[key]===null ? value[key] : undefined;
  const latency = value.latency_ms && typeof value.latency_ms==="object" ? Object.fromEntries(Object.entries(value.latency_ms).filter(([,v])=>finite(v) && v>=0).slice(0,8)) : undefined;
  const browser = value.browser_operations && typeof value.browser_operations==="object" ? Object.fromEntries(Object.entries(value.browser_operations).filter(([,v])=>Number.isInteger(v) && v>=0).slice(0,8)) : undefined;
  const retrieval={};
  const raw=value.retrieval;
  if(raw && typeof raw==="object") {
    if(raw.contract_version==="retrieval-v2")retrieval.contract_version=raw.contract_version;
    if(raw.detail_fingerprint_version==="product-evidence-v1")retrieval.detail_fingerprint_version=raw.detail_fingerprint_version;
    for(const key of ["input_fingerprint","source_fingerprint","detail_fingerprint","result_fingerprint"])
      if(/^[0-9a-f]{64}$/u.test(raw[key] || ""))retrieval[key]=raw[key];
    for(const key of ["finalist_ids","result_ids"])
      if(Array.isArray(raw[key]))retrieval[key]=raw[key].filter(id=>typeof id==="string" && /^[1-9][0-9]{0,19}$/u.test(id)).slice(0,16);
    if(Number.isInteger(raw.records_received) && raw.records_received>=0 && raw.records_received<=1000)retrieval.records_received=raw.records_received;
    if(["live","recent","fast"].includes(raw.freshness))retrieval.freshness=raw.freshness;
    if(Array.isArray(raw.excluded_examples))retrieval.excluded_examples=raw.excluded_examples.slice(0,5).filter(item=>item && typeof item.name==="string" && typeof item.reason==="string").map(item=>({product_id:typeof item.product_id==="string"?item.product_id.slice(0,20):null,name:item.name.slice(0,240),reason:item.reason.slice(0,48)}));
  }
  return {
    schema_version:1,trace_id:value.trace_id,report_id:/^[0-9a-f]{16}$/u.test(value.report_id||"")?value.report_id:null,swarm_id:value.swarm_id,sequence:value.sequence,playbook:value.playbook,
    query:value.query,stage:value.stage,status:value.status,occurred_at_unix_ms:value.occurred_at_unix_ms,
    elapsed_ms:value.elapsed_ms,queue_depth:scalar("queue_depth"),queue_wait_ms:scalar("queue_wait_ms"),cache_hit:scalar("cache_hit"),
    cache_age_ms:scalar("cache_age_ms"),max_pages:scalar("max_pages"),scan_ms:scalar("scan_ms"),pages_scanned:scalar("pages_scanned"),
    unique_products:scalar("unique_products"),scan_read_ms:scalar("scan_read_ms"),records_loaded:scalar("records_loaded"),
    candidate_count:scalar("candidate_count"),candidate_index:scalar("candidate_index"),product_id:scalar("product_id"),
    product_name:typeof value.product_name==="string"?value.product_name.slice(0,240):undefined,detail_ms:scalar("detail_ms"),
    verified_count:scalar("verified_count"),error_count:scalar("error_count"),success:scalar("success"),effective:scalar("effective"),
    response_bytes:scalar("response_bytes"),response_tokens_estimate:scalar("response_tokens_estimate"),
    winner_product_id:scalar("winner_product_id"),dashboard:sanitizeDashboard(value.dashboard),error:typeof value.error==="string"?value.error.slice(0,120):undefined,
    latency_ms:latency,browser_operations:browser,retrieval,
  };
}
function sanitizeDeveloperEvent(value) {
  if(!value || typeof value!=="object" || value.schema_version!==1 ||
      !/^[0-9a-f]{16}$/u.test(value.event_id || "") || !/^[0-9a-f]{16}$/u.test(value.trace_id || "") ||
      !["agent","code"].includes(value.actor) || !["started","running","completed","failed"].includes(value.phase) ||
      !["ok","error"].includes(value.status) || !Number.isSafeInteger(value.occurred_at_unix_ms) ||
      !finite(value.elapsed_ms) || value.elapsed_ms<0 || !finite(value.progress_pct) || value.progress_pct<0 || value.progress_pct>100)return null;
  const text=(input,limit)=>typeof input==="string"?input.replace(/[\r\n\t]+/gu," ").slice(0,limit):"";
  const source=text(value.source,180),operation=text(value.operation,120),message=text(value.message,240),detail=text(value.detail,1000);
  if(!source || !operation || !message)return null;
  const media=(Array.isArray(value.media)?value.media:[]).filter(item=>{
    try {const url=new URL(item);return url.protocol==="https:" && !url.username && !url.password && /(?:^|\.)(?:susercontent|shopeemobile)\.com$/u.test(url.hostname);}
    catch {return false;}
  }).slice(0,4);
  return {schema_version:1,event_id:value.event_id,trace_id:value.trace_id,actor:value.actor,source,operation,
    phase:value.phase,status:value.status,message,detail,progress_pct:value.progress_pct,
    occurred_at_unix_ms:value.occurred_at_unix_ms,elapsed_ms:value.elapsed_ms,media};
}
function safeAffiliateUrl(value) {
  try {
    const url=new URL(value);
    return url.origin==="https://s.shopee.co.th" && !url.username && !url.password && !url.port && !url.search && !url.hash && /^\/[A-Za-z0-9]+$/u.test(url.pathname) ? url.href : null;
  } catch {return null;}
}
function confirmedLinkReceipts(operation,args,result) {
  const rows=operation==="batch_create_links" ? (Array.isArray(result?.results)?result.results:[]) : operation==="create_link_with_subids" ? [result] : [];
  return rows.flatMap((row,index)=>{
    const product=typeof row?.product_id==="string"?row.product_id:typeof args?.product_id==="string"?args.product_id:typeof args?.items?.[index]?.product_id==="string"?args.items[index].product_id:null;
    const affiliate_url=safeAffiliateUrl(row?.affiliate_url);
    if(row?.ok!==true || row?.status!=="confirmed" || !productId(product) || !affiliate_url)return [];
    const requested=Array.isArray(args?.sub_ids)?args.sub_ids:Array.isArray(args?.items?.[index]?.sub_ids)?args.items[index].sub_ids:[];
    const used=row.sub_ids_used && typeof row.sub_ids_used==="object"?Array.from({length:5},(_,i)=>row.sub_ids_used[`sub_id_${i+1}`] || null):requested;
    const sub_ids=used.slice(0,5).map(value=>typeof value==="string" && value.length<=128?value:null);
    const channel=typeof args?.channel==="string"?args.channel.slice(0,80):null;
    return [{product_id:product,affiliate_url,sub_ids,sub_id_positions_preserved:true,channel,status:"confirmed",created_at:typeof row?.link_receipt?.created_at==="string"?row.link_receipt.created_at:new Date().toISOString()}];
  });
}
async function rememberConfirmedLinks(operation,args,result) {
  const receipts=confirmedLinkReceipts(operation,args,result);
  if(!receipts.length || !chrome.storage?.local?.get || !chrome.storage?.local?.set)return;
  try {
    const saved=await chrome.storage.local.get(linkReceiptKey);
    const prior=Array.isArray(saved?.[linkReceiptKey])?saved[linkReceiptKey]:[];
    const next=[...receipts,...prior].filter((item,index,all)=>item && index===all.findIndex(candidate=>candidate?.product_id===item.product_id && candidate?.affiliate_url===item.affiliate_url)).slice(0,linkReceiptLimit);
    await chrome.storage.local.set({[linkReceiptKey]:next});
    const library=await chrome.storage.local.get("shopkudSocialLinks");
    const links=library.shopkudSocialLinks && typeof library.shopkudSocialLinks==="object" && !Array.isArray(library.shopkudSocialLinks)?library.shopkudSocialLinks:{};
    for(const receipt of receipts){
      if(links[receipt.affiliate_url] || Object.keys(links).length>=500)continue;
      links[receipt.affiliate_url]=receipt;
    }
    await chrome.storage.local.set({shopkudSocialLinks:links});
  } catch {}
}
async function hydrateTelemetry() {
  if(telemetryHydrated)return;
  if(telemetryHydrating)return telemetryHydrating;
  telemetryHydrating=(async()=>{
    try {
      const saved=await chrome.storage?.session?.get?.("shopkudTelemetryRuns");
      const runs=Array.isArray(saved?.shopkudTelemetryRuns)?saved.shopkudTelemetryRuns:[];
      for(const run of runs.slice(0,telemetryLimit))if(run && /^[0-9a-f]{16}$/u.test(run.trace_id || ""))telemetryRuns.set(run.trace_id,run);
      const savedLogs=await chrome.storage?.session?.get?.("shopkudDeveloperLogs");
      developerLogs=(Array.isArray(savedLogs?.shopkudDeveloperLogs)?savedLogs.shopkudDeveloperLogs:[])
        .map(sanitizeDeveloperEvent).filter(Boolean).slice(-developerLogLimit);
      const savedReports=await chrome.storage?.session?.get?.("shopkudResearchReports");
      for(const report of (Array.isArray(savedReports?.shopkudResearchReports)?savedReports.shopkudResearchReports:[]).slice(-researchReportLimit)){
        const safe=sanitizeResearchReport(report);if(safe && decisionsMatchRun(safe))researchReports.set(safe.report_id,safe);
      }
      const savedDashboard=await chrome.storage?.session?.get?.("shopkudDashboardTabId");
      if(Number.isInteger(savedDashboard?.shopkudDashboardTabId))dashboardTabId=savedDashboard.shopkudDashboardTabId;
    } catch {}
    telemetryHydrated=true;
    telemetryHydrating=null;
  })();
  return telemetryHydrating;
}
function telemetrySnapshot() {
  return {ok:true,connected,extension_version:chrome.runtime.getManifest().version,
    runs:[...telemetryRuns.values()].sort((a,b)=>b.updated_at_unix_ms-a.updated_at_unix_ms),
    developer_logs:developerLogs.slice(),
    research_reports:[...researchReports.values()].sort((a,b)=>b.updated_at_unix_ms-a.updated_at_unix_ms)};
}
function broadcastLive(kind="update") {
  try {chrome.runtime.sendMessage?.({type:"shopkud-live-update",kind,snapshot:telemetrySnapshot()},()=>{void chrome.runtime.lastError;});} catch {}
}
async function recordTelemetry(raw) {
  const event=sanitizeTelemetry(raw);
  if(!event)return {ok:false,error:"invalid_event"};
  await hydrateTelemetry();
  const previous=telemetryRuns.get(event.trace_id);
  if(previous && event.sequence<=previous.sequence)return {ok:true,duplicate:true};
  const swarmRuns=[...telemetryRuns.values()].filter(run=>run.swarm_id===event.swarm_id && run.trace_id!==event.trace_id);
  const invocation_number=previous?.invocation_number || swarmRuns.length+1;
  const run={...(previous||{}),...event,invocation_number,updated_at_unix_ms:event.occurred_at_unix_ms,
    started_at_unix_ms:previous?.started_at_unix_ms || event.occurred_at_unix_ms};
  telemetryRuns.delete(event.trace_id);telemetryRuns.set(event.trace_id,run);
  while(telemetryRuns.size>telemetryLimit)telemetryRuns.delete(telemetryRuns.keys().next().value);
  try {await chrome.storage?.session?.set?.({shopkudTelemetryRuns:[...telemetryRuns.values()]});} catch {}
  if(raw?.developer_event)await recordDeveloperEvent(raw.developer_event);
  if(event.stage==="queued")ensureDashboard({active:false}).catch(()=>{});
  if(["completed","failed"].includes(event.stage))setTimeout(()=>cleanupAutomationTabs(),800);
  broadcastLive("event");
  return {ok:true};
}
async function recordResearchReport(raw) {
  const report=sanitizeResearchReport(raw);if(!report)return {ok:false,error:"invalid_report"};
  await hydrateTelemetry();if(!decisionsMatchRun(report))return {ok:false,error:"decision_run_mismatch"};
  researchReports.delete(report.report_id);researchReports.set(report.report_id,report);
  while(researchReports.size>researchReportLimit)researchReports.delete(researchReports.keys().next().value);
  try {await chrome.storage?.session?.set?.({shopkudResearchReports:[...researchReports.values()]});} catch {}
  ensureDashboard({active:false}).catch(()=>{});broadcastLive("research-report");
  return {ok:true,report_id:report.report_id};
}
async function recordDeveloperEvent(raw) {
  const event=sanitizeDeveloperEvent(raw);
  if(!event)return {ok:false,error:"invalid_event"};
  await hydrateTelemetry();
  if(developerLogs.some(item=>item.event_id===event.event_id))return {ok:true,duplicate:true};
  developerLogs.push(event);
  if(developerLogs.length>developerLogLimit)developerLogs=developerLogs.slice(-developerLogLimit);
  try {await chrome.storage?.session?.set?.({shopkudDeveloperLogs:developerLogs});} catch {}
  broadcastLive("developer-event");
  return {ok:true};
}
const offer = value => {
  try { const u=new URL(value);return u.origin==="https://affiliate.shopee.co.th" && !u.username && !u.password && !u.port && !u.search && !u.hash && /^\/offer\/product_offer(?:\/[1-9][0-9]{0,19})?$/u.test(u.pathname); }
  catch {return false;}
};
function roster() {
  if (connected && port) port.postMessage({type:"pages",pages:[...pages.values()].map(p=>({page_id:p.page_id,url:p.url,title:"Shopee Affiliate offer page"}))});
}
function state() {
  for(const page of pages.values()) chrome.tabs.sendMessage(page.tab,{type:"shopkud-state",nonce:page.nonce,connected},()=>{void chrome.runtime.lastError;});
}
const detailOffer = url => offer(url) && /\/[1-9][0-9]{0,19}$/u.test(url);
const tabBusy = tab => Boolean(listingTask && listingEntry?.tab===tab) || opening.has(tab) || [...inFlight.values()].some(task=>task.page.tab===tab);
function attestOfferIdle(page) {
  return new Promise(resolve=>{
    const timer=setTimeout(()=>resolve(false),1500);
    chrome.tabs.sendMessage(page.tab,{type:"shopkud-entry-status",nonce:page.nonce,entry_url:page.url},reply=>{
      const error=chrome.runtime.lastError;clearTimeout(timer);
      resolve(!error && reply?.state==="idle" && reply.page_url===page.url);
    });
  });
}
function tabInfo(tab) {
  return new Promise(resolve=>chrome.tabs.get(tab,current=>{
    const error=chrome.runtime.lastError;
    resolve(error?null:current);
  }));
}
const dashboardUrl=()=>`${EXTENSION_ROOT}dashboard.html`;
async function groupShopKudTab(tabId) {
  if(!Number.isInteger(tabId) || typeof chrome.tabs?.group!=="function" || typeof chrome.tabGroups?.update!=="function")return null;
  const tab=await tabInfo(tabId);if(!tab)return null;
  const ids=new Set([tabId,...ownedEntries.values()]);
  if(Number.isInteger(listingEntry?.tab))ids.add(listingEntry.tab);
  if(Number.isInteger(dashboardTabId))ids.add(dashboardTabId);
  const managed=(await Promise.all([...ids].map(tabInfo))).filter(item=>item?.windowId===tab.windowId);
  if(!managed.length)return null;
  const dashboard=managed.find(item=>item.id===dashboardTabId);
  const grouped=dashboard && Number.isInteger(dashboard.groupId) && dashboard.groupId>=0
    ? dashboard : managed.find(item=>Number.isInteger(item.groupId) && item.groupId>=0);
  let groupId=grouped?.groupId ?? null;
  try {
    if(groupId===null && typeof chrome.tabGroups.query==="function"){
      const existing=await chrome.tabGroups.query({windowId:tab.windowId,title:"ShopKud"});
      groupId=existing.sort((a,b)=>a.id-b.id)[0]?.id ?? null;
    }
    const tabIds=managed.map(item=>item.id);
    groupId=await chrome.tabs.group(groupId===null?{tabIds}:{groupId,tabIds});
    await chrome.tabGroups.update(groupId,{title:"ShopKud",color:"orange",collapsed:false});
    return groupId;
  } catch {return null;}
}
async function ensureDashboard({active=false,windowId=null}={}) {
  await hydrateTelemetry();
  let tab=Number.isInteger(dashboardTabId)?await tabInfo(dashboardTabId):null;
  if(tab && typeof tab.url==="string" && !tab.url.startsWith(dashboardUrl()))tab=null;
  if(!tab){
    const create={url:dashboardUrl(),active:Boolean(active)};
    if(Number.isInteger(windowId))create.windowId=windowId;
    tab=await chrome.tabs.create(create);dashboardTabId=tab.id;
    try {await chrome.storage?.session?.set?.({shopkudDashboardTabId:dashboardTabId});} catch {}
  } else if(active && tab.active!==true)tab=await chrome.tabs.update(tab.id,{active:true});
  await groupShopKudTab(tab.id);
  if(active && Number.isInteger(tab.windowId) && typeof chrome.windows?.update==="function"){
    try {await chrome.windows.update(tab.windowId,{focused:true});} catch {}
  }
  return tab;
}
async function closeOwnedTabIfIdle(tabId) {
  await tabRecovery;
  if(!Number.isInteger(tabId) || tabBusy(tabId))return false;
  if(claimedEntries.has(tabId)){
    for(const [url,id] of ownedEntries)if(id===tabId)ownedEntries.delete(url);
    if(listingEntry?.tab===tabId)listingEntry=null;
    workTabs.delete(tabId);await saveWorkTabs();
    roster();return false;
  }
  if(typeof chrome.tabs?.remove!=="function")return false;
  const current=await tabInfo(tabId);if(!current || current.active!==false)return false;
  const expected=workTabs.get(tabId) || (listingEntry?.tab===tabId?listingEntry.url:[...ownedEntries].find(([,id])=>id===tabId)?.[0]);
  if(!expected || current.url!==expected){workTabs.delete(tabId);await saveWorkTabs();return false;}
  // A cleanup timer may pass the first check just before the next read starts.
  if(tabBusy(tabId) || claimedEntries.has(tabId))return false;
  try {await chrome.tabs.remove(tabId);} catch {return false;}
  workTabs.delete(tabId);await saveWorkTabs();
  for(const [url,id] of ownedEntries)if(id===tabId)ownedEntries.delete(url);
  uncertainEntries.delete(tabId);for(const [id,page] of pages)if(page.tab===tabId)pages.delete(id);
  if(listingEntry?.tab===tabId)listingEntry=null;
  roster();return true;
}
async function cleanupAutomationTabs() {
  await tabRecovery;
  const tabs=new Set([...workTabs.keys(),...ownedEntries.values()]);if(Number.isInteger(listingEntry?.tab))tabs.add(listingEntry.tab);
  await Promise.all([...tabs].map(closeOwnedTabIfIdle));
}
const listingURL = value => typeof value==="string" && /^https:\/\/shopee\.co\.th\/product\/[1-9][0-9]{0,19}\/[1-9][0-9]{0,19}$/u.test(value) && !/[\r\n]/u.test(value);
const listingFailure = error => ({ok:false,error,outcome:"not_completed",retry_automatically:false});
async function waitForListingTab(tabId,url,task,timeoutMs=30000) {
  const ready=tab=>Boolean(tab && tab.url===url && tab.active===false && tab.status==="complete");
  const waiting=tab=>Boolean(tab && tab.active===false && (tab.url===url || tab.status==="loading" && tab.pendingUrl===url && (!tab.url || tab.url==="about:blank")));
  const initial=await tabInfo(tabId);
  if(!waiting(initial) || task.cancelled)return false;
  return await new Promise(resolve=>{
    let done=false,stable=null,poll=null;
    const finish=value=>{if(done)return;done=true;clearTimeout(timer);clearTimeout(stable);clearTimeout(poll);chrome.tabs.onUpdated.removeListener(update);if(task.finishWait===cancel)task.finishWait=null;resolve(value);};
    const check=async()=>{
      if(done)return;if(task.cancelled)return finish(false);
      const tab=await tabInfo(tabId);if(done)return;
      if(!waiting(tab))return finish(false);
      if(!ready(tab)){clearTimeout(stable);stable=null;return;}
      if(stable===null)stable=setTimeout(async()=>{
        stable=null;const latest=await tabInfo(tabId);
        if(task.cancelled)return finish(false);
        if(ready(latest))finish(true);else void check();
      },200);
    };
    const update=(id,change)=>{if(id===tabId){if(change?.status==="loading"){clearTimeout(stable);stable=null;}void check();}};
    const cancel=()=>finish(false),timer=setTimeout(cancel,timeoutMs);
    task.finishWait=cancel;chrome.tabs.onUpdated.addListener(update);
    // Chrome can finish without delivering the update to this worker listener.
    const pollState=async()=>{await check();if(!done)poll=setTimeout(pollState,250);};
    poll=setTimeout(pollState,250);
    void check();
  });
}
async function listingPermissionState() {
  const manifest=chrome.runtime.getManifest();
  const [scripting,host,combined]=await Promise.all([
    chrome.permissions.contains({permissions:listingAccess.permissions}),
    chrome.permissions.contains({origins:listingAccess.origins}),
    chrome.permissions.contains(listingAccess),
  ]);
  return {extension_version:manifest.version,extension_id:chrome.runtime.id,required_origin:listingAccess.origins[0],
    scripting_granted:scripting,host_granted:host,combined_granted:combined,
    declared:{scripting:manifest.optional_permissions?.includes("scripting")===true,host:manifest.optional_host_permissions?.includes(listingAccess.origins[0])===true},
    local_enable_flag_required:false};
}
async function listingPermissionFailure() {
  return {...listingFailure("listing_permission_required"),permission_state:await listingPermissionState(),
    owner_action:"open_extension_options_and_enable_public_products",access_page:chrome.runtime.getURL("listing-access.html")};
}
async function readListing(args,task) {
  if(!args || Object.keys(args).sort().join(",")!=="open_if_missing,product_url" || !listingURL(args.product_url) || typeof args.open_if_missing!=="boolean")return listingFailure("invalid_input");
  if(!await chrome.permissions.contains(listingAccess))return await listingPermissionFailure();
  if(task.cancelled)return listingFailure("cancelled");
  const url=args.product_url;
  if(listingEntry?.uncertain)return {...listingFailure("listing_unconfirmed"),outcome:"unconfirmed"};
  let current=listingEntry?await tabInfo(listingEntry.tab):null;
  if(task.cancelled)return listingFailure("cancelled");
  if(listingEntry && (!current || current.url!==listingEntry.url))return listingFailure("listing_context_changed");
  if(current?.active===true){claimedEntries.add(current.id);listingEntry=null;current=null;}
  if(current && (current.active!==false || !await waitForListingTab(current.id,listingEntry.url,task)))return listingFailure("listing_tab_not_idle");
  const navigating=!listingEntry || listingEntry.url!==url;
  if(navigating && !args.open_if_missing)return listingFailure("product_page_not_open");
  if(!await chrome.permissions.contains(listingAccess))return await listingPermissionFailure();
  if(task.cancelled)return listingFailure("cancelled");
  let created=false,reused=false;
  if(navigating) {
    if(!listingEntry) {
      // Retain uncertainty even if create's outcome is unknown; never replay it.
      listingEntry={tab:null,url,uncertain:true};
      const opened=await chrome.tabs.create({url,active:false});
      listingEntry.tab=opened.id;created=true;await rememberWorkTab(opened.id,url);await groupShopKudTab(opened.id);
    } else {
      listingEntry={tab:listingEntry.tab,url,uncertain:true};reused=true;
      await chrome.tabs.update(listingEntry.tab,{url,active:false});
      await rememberWorkTab(listingEntry.tab,url);
    }
    if(task.cancelled)return listingFailure("cancelled");
    const loaded=await waitForListingTab(listingEntry.tab,url,task);
    if(task.cancelled)return listingFailure("cancelled");
    if(!loaded){
      const tab=await tabInfo(listingEntry.tab);
      const challenge=typeof tab?.url==="string" && /^https:\/\/shopee\.co\.th\/verify\//u.test(tab.url);
      return {...listingFailure(challenge?"challenge_detected":"listing_unconfirmed"),outcome:"unconfirmed",readiness:{tab_present:Boolean(tab),inactive:tab?.active===false,status:tab?.status || null,exact_url:tab?.url===url,pending_exact_url:tab?.pendingUrl===url,challenge_redirect:challenge}};
    }
  }
  current=await tabInfo(listingEntry.tab);
  if(current?.url===url && current.active===false && current.status==="loading"){
    // Same navigation may briefly resume loading after its first complete event.
    await waitForListingTab(current.id,url,task,3000);
    current=await tabInfo(current.id);
  }
  if(task.cancelled)return listingFailure("cancelled");
  if(!current || current.url!==url)return listingFailure("listing_context_changed");
  if(current.active!==false || current.status!=="complete")return {...listingFailure("listing_tab_not_idle"),readiness:{phase:"before_read",active:current.active,status:current.status}};
  if(!await chrome.permissions.contains(listingAccess))return await listingPermissionFailure();
  if(task.cancelled)return listingFailure("cancelled");
  // Public product pages defer seller/rating hydration until their tab is active.
  const preferences=await chrome.storage?.local?.get?.("shopkudListingForeground");
  let previousTab=null,foregroundUsed=false,focusRestored=false,injected;
  if(preferences && preferences.shopkudListingForeground!==false){
    const active=await chrome.tabs.query({active:true,windowId:current.windowId});
    previousTab=active.find(tab=>tab.id!==current.id) || null;
  }
  try {
    if(previousTab){
      listingForegroundTab=current.id;
      await chrome.tabs.update(current.id,{active:true});foregroundUsed=true;
    }
    injected=await chrome.scripting.executeScript({target:{tabId:listingEntry.tab,frameIds:[0]},files:["listing.js"],world:"ISOLATED"});
  } finally {
    // Do not override a tab switch the user made while the reader was running.
    try {
      if(foregroundUsed && (await tabInfo(current.id))?.active===true && await tabInfo(previousTab.id)){
        await chrome.tabs.update(previousTab.id,{active:true});focusRestored=true;
      }
    } finally {listingForegroundTab=null;}
  }
  if(task.cancelled)return listingFailure("cancelled");
  const finalTab=await tabInfo(listingEntry.tab);
  if(task.cancelled)return listingFailure("cancelled");
  if(!finalTab || finalTab.url!==url)return listingFailure("listing_context_changed");
  if(finalTab.active!==false || finalTab.status!=="complete")return {...listingFailure("listing_tab_not_idle"),readiness:{phase:"after_read",active:finalTab.active,status:finalTab.status,foreground_used:foregroundUsed,focus_restored:focusRestored}};
  const result=injected?.length===1 && injected[0].frameId===0?injected[0].result:null;
  const parts=url.split("/");
  if(!result || typeof result!=="object" || result.source_url!==url || result.shop_id!==parts[4] || result.product_id!==parts[5])throw new Error("invalid listing evidence");
  if(result.ok===true && result.kind!=="public_product_detail")throw new Error("invalid listing kind");
  listingEntry.uncertain=false;
  return {...result,entry:{tab_id:listingEntry.tab,entry_url:url,created_tab:created,reused_tab:reused,owner_tab_changed:foregroundUsed,...(foregroundUsed?{focus_restored:focusRestored}:{}),extension_version:chrome.runtime.getManifest().version},retry_automatically:false};
}
async function entryInfo(args) {
  if(!args || Object.keys(args).length)return {ok:false,error:"invalid_input"};
  const entries=[];
  for(const [url,tab] of ownedEntries) {
    const current=await tabInfo(tab);
    const page=[...pages.values()].find(p=>p.tab===tab && p.url===url);
    entries.push({tab_id:tab,entry_url:url,page_id:page?.page_id || null,
      active:current?.active ?? null,busy:tabBusy(tab),tab_status:current?.status ?? null,tab_url_available:typeof current?.url==="string",tab_url_matches:typeof current?.url==="string"?current.url===url:null,
      state:!current?"unavailable":uncertainEntries.has(tab)?"unconfirmed":page?"registered":"not_registered",
      reusable_detail:Boolean(current?.active===false && current.status==="complete" && page && detailOffer(url) && !tabBusy(tab) && !uncertainEntries.has(tab))});
  }
  return {ok:true,entries,capacity:4,ownership_scope:"current_extension_worker",owner_tabs_included:false,listing_access:await listingPermissionState()};
}
async function reusableDetail() {
  for(const [url,tab] of ownedEntries) {
    if(!detailOffer(url) || tabBusy(tab) || uncertainEntries.has(tab))continue;
    const page=[...pages.values()].find(p=>p.tab===tab && p.url===url);
    if(!page)continue;
    const idle=await attestOfferIdle(page);
    if(!idle)continue;
    const current=await tabInfo(tab);
    if(current?.active===false && current.status==="complete" && ownedEntries.get(url)===tab && pages.get(page.page_id)===page && !tabBusy(tab) && !uncertainEntries.has(tab))return {url,tab};
  }
  return null;
}
async function openOffer(args) {
  if(entryBusy)return {ok:false,error:"entry_busy",retry_automatically:false};
  entryBusy=true;
  try {return await openOfferOnce(args);} finally {entryBusy=false;}
}
async function openOfferOnce(args) {
  if(!args || Object.keys(args).length!==1 || !offer(args.offer_url))return {ok:false,error:"invalid_input"};
  const url=args.offer_url;
  let tab=ownedEntries.get(url),created=false,reused=false;
  if(tab!==undefined && uncertainEntries.has(tab))return {ok:false,error:"entry_unconfirmed",outcome:"unconfirmed",retry_automatically:false};
  if(tab===undefined) {
    if(ownedEntries.size>=4) {
      const candidate=detailOffer(url)?await reusableDetail():null;
      if(!candidate)return {ok:false,error:"entry_tab_limit",retry_automatically:false};
      tab=candidate.tab;reused=true;
      ownedEntries.delete(candidate.url);ownedEntries.set(url,tab);uncertainEntries.add(tab);
      for(const [id,page] of pages)if(page.tab===tab)pages.delete(id);
      roster();
      // Mark before dispatch; an unknown update must never be automatically replayed.
      await chrome.tabs.update(tab,{url,active:false});
      await rememberWorkTab(tab,url);
    } else {
      const newTab=await chrome.tabs.create({url,active:false});
      tab=newTab.id;ownedEntries.set(url,tab);created=true;await rememberWorkTab(tab,url);await groupShopKudTab(tab);
    }
  }
  const evidence={tab_id:tab,entry_url:url,created_tab:created,reused_tab:reused,owner_tab_changed:false,extension_version:chrome.runtime.getManifest().version};
  return await new Promise(resolve=>{
    let settled=false;
    const finish=result=>{
      if(settled)return;settled=true;clearTimeout(timer);opening.delete(tab);chrome.tabs.onUpdated.removeListener(loaded);
      if(!result.ok)uncertainEntries.add(tab);
      if(!result.ok)setTimeout(()=>closeOwnedTabIfIdle(tab),800);
      resolve({...result,...evidence,retry_automatically:false});
    };
    const probe=()=>chrome.tabs.sendMessage(tab,{type:"shopkud-discover"},reply=>{
      void chrome.runtime.lastError;
      if(reply?.state==="challenge_detected")finish({ok:false,error:"challenge_detected",owner_action:"resolve_challenge_in_entry_tab"});
      if(reply?.state==="unsupported_affiliate_route")finish({ok:false,error:"entry_requires_login_or_supported_route",owner_action:"check_entry_tab_login"});
    });
    // Registration can precede Chrome load completion; both must attest readiness.
    const check=async()=>{
      const current=await tabInfo(tab);
      if(settled)return;
      if(!current){finish({ok:false,error:"entry_tab_closed",outcome:"not_completed"});return;}
      if(typeof current.url==="string" && current.url!==url || ownedEntries.get(url)!==tab || current.active!==false){finish({ok:false,error:"entry_context_changed",outcome:"not_completed"});return;}
      const page=[...pages.values()].find(p=>p.tab===tab && p.url===url);
      if(current.status==="complete" && page && !uncertainEntries.has(tab) && ![...inFlight.values()].some(task=>task.page.tab===tab)) {
        const attested=await attestOfferIdle(page),final=await tabInfo(tab);
        if(settled)return;
        if(attested && pages.get(page.page_id)===page && final?.active===false && final.status==="complete" && (typeof final.url!=="string" || final.url===url) && ownedEntries.get(url)===tab)finish({ok:true,page_id:page.page_id,readiness:{tab_complete:true,registered:true,owned:true,inactive:true,isolated_exact_url_attested:true}});
      }
    };
    const loaded=(id,change)=>{if(id===tab && change.status==="complete"){check();probe();}};
    const timer=setTimeout(()=>finish({ok:false,error:"entry_not_ready",outcome:"opened_unconfirmed"}),15000);
    opening.set(tab,{url,finish,check});chrome.tabs.onUpdated.addListener(loaded);
    check();
    chrome.tabs.get(tab,current=>{void chrome.runtime.lastError;if(current?.status==="complete")probe();});
  });
}
function recoverPages() {
  if(recovering)return recovering;
  recovering=(async()=>{
    // Only tab IDs are read; replies come from our exact-host isolated script.
    const tabs=await chrome.tabs.query({});
    const blocked_pages=[];
    await Promise.all(tabs.slice(0,200).map(tab=>new Promise(resolve=>{
      let settled=false;
      const finish=reply=>{
        if(settled)return;settled=true;clearTimeout(timer);
        if(["challenge_detected","unsupported_affiliate_route","busy"].includes(reply?.state))blocked_pages.push({tab_id:tab.id,state:reply.state});
        resolve();
      };
      const timer=setTimeout(()=>finish(),4000);
      chrome.tabs.sendMessage(tab.id,{type:"shopkud-discover"},reply=>{void chrome.runtime.lastError;finish(reply);});
    })));
    roster();
    return {type:"discovered",extension_version:chrome.runtime.getManifest().version,blocked_pages,tab_limit_reached:tabs.length>200};
  })().finally(()=>{recovering=null;});
  return recovering;
}
function scheduleReconnect() {
  if(port || reconnectTimer)return;
  const delay=reconnectDelays[Math.min(reconnectAttempts,reconnectDelays.length-1)];
  reconnectAttempts=Math.min(reconnectAttempts+1,reconnectDelays.length-1);
  reconnectTimer=setTimeout(()=>{reconnectTimer=null;connect(true);},delay);
}
function connect(automatic=false) {
  if(!connectionReady)return;
  if(port) return;
  if(reconnectTimer){clearTimeout(reconnectTimer);reconnectTimer=null;}
  if(!automatic)reconnectAttempts=0;
  try {
    const channel=socketConfig ? shopkudSocketChannel(socketConfig) : chrome.runtime.connectNative(HOST);
    port=channel;
    channel.onDisconnect.addListener(()=>{
      void chrome.runtime.lastError;
      if(port===channel) {port=null;connected=false;state();broadcastLive("connection");scheduleReconnect();}
      if(listingTask?.channel===channel){listingTask.cancelled=true;listingTask.finishWait?.();}
      for(const [id,task] of inFlight)if(task.channel===channel){chrome.tabs.sendMessage(task.page.tab,{type:"shopkud-cancel",nonce:task.page.nonce,request_id:id},()=>{void chrome.runtime.lastError;});inFlight.delete(id);}
    });
    channel.onMessage.addListener(message=>{
      if(port!==channel)return;
      if(message?.type==="hello-ack") {connected=true;reconnectAttempts=0;roster();state();broadcastLive("connection");return;}
      if(message?.type==="discover") {
        recoverPages().then(result=>{if(port===channel)channel.postMessage(result);}).catch(()=>{});
        return;
      }
      if(message?.type==="cancel" && /^[0-9a-f]{32}$/u.test(message.id || "")) {
        if(message.page_id==="extension" && listingTask?.id===message.id && listingTask.channel===channel){listingTask.cancelled=true;listingTask.finishWait?.();}
        const task=inFlight.get(message.id);
        if(task?.channel===channel && task.page.page_id===message.page_id){task.cancelled=true;chrome.tabs.sendMessage(task.page.tab,{type:"shopkud-cancel",nonce:task.page.nonce,request_id:message.id},()=>{void chrome.runtime.lastError;});}
        return; // Original result releases broker busy only after the page settles.
      }
      if(message?.type!=="command" || !/^[0-9a-f]{32}$/u.test(message.id || "")) return;
      if(message.page_id==="extension" && message.operation==="read_listing") {
        if(listingTask){channel.postMessage({type:"result",id:message.id,result:listingFailure("listing_busy")});return;}
        const task={id:message.id,channel,cancelled:false,finishWait:null};listingTask=task;
        readListing(message.arguments,task).catch(()=>{
          if(listingEntry)listingEntry.uncertain=true;
          return {...listingFailure("listing_unconfirmed"),outcome:"unconfirmed"};
        }).then(result=>{
          const tabId=listingEntry?.tab;
          setTimeout(()=>closeOwnedTabIfIdle(tabId),800);
          if(port===channel)channel.postMessage({type:"result",id:message.id,result});
        }).finally(()=>{if(listingTask===task)listingTask=null;});
        return;
      }
      if(message.page_id==="extension" && message.operation==="playbook_event") {
        recordTelemetry(message.arguments).then(result=>{if(port===channel)channel.postMessage({type:"result",id:message.id,result});});
        return;
      }
      if(message.page_id==="extension" && message.operation==="developer_event") {
        recordDeveloperEvent(message.arguments).then(result=>{if(port===channel)channel.postMessage({type:"result",id:message.id,result});});
        return;
      }
      if(message.page_id==="extension" && message.operation==="research_report") {
        recordResearchReport(message.arguments).then(result=>{if(port===channel)channel.postMessage({type:"result",id:message.id,result});});
        return;
      }
      if(message.page_id==="extension" && message.operation==="reload_extension") {
        if(message.arguments && Object.keys(message.arguments).length || inFlight.size || entryBusy || listingTask || opening.size) {
          channel.postMessage({type:"result",id:message.id,result:{ok:false,error:"extension_busy",status:"not_reloaded",retry_automatically:false}});return;
        }
        channel.postMessage({type:"result",id:message.id,result:{ok:true,status:"reloading",extension_version:chrome.runtime.getManifest().version}});
        setTimeout(()=>{cleanupAutomationTabs().finally(()=>chrome.runtime.reload());},100);
        return;
      }
      if(message.page_id==="extension" && ["open_offer","entry_info"].includes(message.operation)) {
        const operation=message.operation==="entry_info"?entryInfo:openOffer;
        operation(message.arguments).then(result=>{if(port===channel)channel.postMessage({type:"result",id:message.id,result});}).catch(()=>{
          if(port===channel)channel.postMessage({type:"result",id:message.id,result:{ok:false,error:"entry_unconfirmed",outcome:"unconfirmed",retry_automatically:false}});
        });return;
      }
      const page=pages.get(message.page_id);
      if(!page || !["snapshot","detail","selections","prepare","apply","export","clear","pagination","navigate","scan","scan_read","review","search_scan","selector_health","create_link_with_subids","batch_create_links","verify_link"].includes(message.operation)) {
        channel.postMessage({type:"result",id:message.id,result:{ok:false,error:"page_or_operation_unavailable"}});return;
      }
      inFlight.set(message.id,{page,channel});
      if(message.operation==="detail" && message.arguments?.open_link_dialog===true) {
        const reject=(error,evidence)=>{inFlight.delete(message.id);if(port===channel)channel.postMessage({type:"result",id:message.id,result:{ok:false,error,outcome:"not_completed",retry_automatically:false,...(evidence?{link_guard_evidence:evidence}:{})}});};
        (async()=>{
          const current=await tabInfo(page.tab);
          if(port!==channel){inFlight.delete(message.id);return;}
          if(inFlight.get(message.id)?.cancelled){reject("cancelled");return;}
          const evidence={owned:ownedEntries.get(page.url)===page.tab,registered:pages.get(page.page_id)===page,uncertain:uncertainEntries.has(page.tab),opening:opening.has(page.tab),other_in_flight:[...inFlight].some(([id,task])=>id!==message.id && task.page.tab===page.tab),tab_url_available:typeof current?.url==="string",url_matches:typeof current?.url==="string"?current.url===page.url:null,active:current?.active ?? null,tab_status:current?.status ?? null};
          if(!evidence.owned || !evidence.registered || evidence.uncertain || evidence.opening || evidence.other_in_flight || evidence.url_matches===false || evidence.active!==false || evidence.tab_status!=="complete"){reject("link_requires_owned_idle_detail",evidence);return;}
          evidence.isolated_exact_url_attested=await attestOfferIdle(page);
          const final=await tabInfo(page.tab);
          if(port!==channel){inFlight.delete(message.id);return;}
          if(inFlight.get(message.id)?.cancelled){reject("cancelled");return;}
          if(!evidence.isolated_exact_url_attested || pages.get(page.page_id)!==page || ownedEntries.get(page.url)!==page.tab || final?.active!==false || final.status!=="complete" || typeof final.url==="string" && final.url!==page.url){reject("link_requires_owned_idle_detail",evidence);return;}
          chrome.tabs.sendMessage(page.tab,{type:"shopkud-command",nonce:page.nonce,request_id:message.id,operation:message.operation,arguments:message.arguments},result=>{
            const error=chrome.runtime.lastError;inFlight.delete(message.id);
            if(port===channel)channel.postMessage({type:"result",id:message.id,result:error?{ok:false,error:"page_context_unavailable",outcome:"unconfirmed",retry_automatically:false}:result || {ok:false,error:"invalid_page_result",outcome:"unconfirmed",retry_automatically:false}});
            // Keep the requested link dialog alive for the subsequent create_link call.
            if(error || result?.ok!==true)setTimeout(()=>closeOwnedTabIfIdle(page.tab),800);
          });
        })().catch(()=>reject("link_preflight_failed"));
        return;
      }
      chrome.tabs.sendMessage(page.tab,{type:"shopkud-command",nonce:page.nonce,request_id:message.id,operation:message.operation,arguments:message.arguments},result=>{
        const error=chrome.runtime.lastError;
        inFlight.delete(message.id);
        if(message.operation==="detail")setTimeout(()=>closeOwnedTabIfIdle(page.tab),800);
        if(port!==channel) return; // Unknown operation outcome: no replay.
        if(error) {
          pages.delete(page.page_id);roster();
          channel.postMessage({type:"result",id:message.id,result:{ok:false,error:"page_context_unavailable",outcome:"unconfirmed"}});
        } else {
          void rememberConfirmedLinks(message.operation,message.arguments,result);
          channel.postMessage({type:"result",id:message.id,result:result || {ok:false,error:"invalid_page_result",outcome:"unconfirmed"}});
        }
      });
    });
  } catch {port=null;connected=false;state();broadcastLive("connection");scheduleReconnect();}
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  const extensionPage=sender.id===chrome.runtime.id && (!sender.tab || typeof sender.url==="string" && sender.url.startsWith(EXTENSION_ROOT));
  if(extensionPage && message?.type==="shopkud-pairing-updated") {
    shopkudPairing().then(saved=>{
      socketConfig=saved || null;
      if(port)port.disconnect();else connect();
      respond({ok:true});
    }).catch(()=>respond({ok:false}));
    return true;
  }
  if(extensionPage && message?.type==="shopkud-live-snapshot") {
    hydrateTelemetry().then(()=>respond(telemetrySnapshot()));return true;
  }
  if(extensionPage && message?.type==="shopkud-live-clear") {
    hydrateTelemetry().then(async()=>{
      for(const [id,run] of telemetryRuns)if(["completed","failed"].includes(run.status))telemetryRuns.delete(id);
      try {await chrome.storage?.session?.set?.({shopkudTelemetryRuns:[...telemetryRuns.values()]});} catch {}
      broadcastLive("clear");respond(telemetrySnapshot());
    });return true;
  }
  if(extensionPage && message?.type==="shopkud-live-clear-logs") {
    hydrateTelemetry().then(async()=>{
      developerLogs=[];
      try {await chrome.storage?.session?.set?.({shopkudDeveloperLogs:developerLogs});} catch {}
      broadcastLive("clear-logs");respond(telemetrySnapshot());
    });return true;
  }
  if(extensionPage && message?.type==="shopkud-open-tracker" && Number.isInteger(sender.tab?.windowId) && typeof chrome.sidePanel?.open==="function") {
    chrome.sidePanel.open({windowId:sender.tab.windowId}).then(()=>respond({ok:true})).catch(()=>respond({ok:false,error:"side_panel_unavailable"}));return true;
  }
  if(extensionPage && message?.type==="shopkud-open-dashboard") {
    ensureDashboard({active:true,windowId:sender.tab?.windowId}).then(tab=>respond({ok:true,tab_id:tab.id})).catch(()=>respond({ok:false,error:"dashboard_unavailable"}));return true;
  }
  if(sender.id!==chrome.runtime.id || sender.frameId!==0 || !Number.isInteger(sender.tab?.id))return false;
  let sameHost=false;
  try{sameHost=new URL(sender.url).origin==="https://affiliate.shopee.co.th";}catch{}
  if(!sameHost)return false;
  if(message?.type==="shopkud-unregister" && sender.frameId===0 && Number.isInteger(sender.tab?.id)) {
    const id=`${sender.tab.id}:${message.nonce}`;
    if(pages.has(id)){pages.delete(id);roster();respond({ok:true});}
    return false;
  }
  // sender.url can retain the document's initial URL across History API routes.
  // Only our isolated same-origin top-frame script may attest its current route;
  // it revalidates that exact route again before every product operation.
  if(!offer(message?.page_url || "")) return false;
  if(message?.type==="shopkud-register" && /^[0-9a-f]{32}$/u.test(message.nonce || "")) {
    const page_id=`${sender.tab.id}:${message.nonce}`,previous=pages.get(page_id);
    for(const [id,page] of pages) if(page.tab===sender.tab.id) pages.delete(id);
    if(pages.size>=20) {respond({ok:false,error:"page_limit"});return false;}
    pages.set(page_id,previous?.url===message.page_url?previous:{page_id,tab:sender.tab.id,nonce:message.nonce,url:message.page_url});
    if(ownedEntries.get(message.page_url)===sender.tab.id)uncertainEntries.delete(sender.tab.id);
    const waiting=opening.get(sender.tab.id);
    if(waiting?.url===message.page_url)waiting.check();
    connect();roster();respond({ok:true,page_id,connected});return false;
  }
  if(message?.type==="shopkud-connect") {connect();respond({ok:true,connected});return false;}
  return false;
});
chrome.tabs.onRemoved.addListener(tab=>{
  workTabs.delete(tab);void saveWorkTabs();
  if(dashboardTabId===tab){dashboardTabId=null;try {chrome.storage?.session?.remove?.("shopkudDashboardTabId");} catch {}}
  if(listingEntry?.tab===tab){listingTask && (listingTask.cancelled=true);listingTask?.finishWait?.();listingEntry=null;}
  uncertainEntries.delete(tab);claimedEntries.delete(tab);
  for(const [url,id] of ownedEntries)if(id===tab)ownedEntries.delete(url);
  opening.get(tab)?.finish({ok:false,error:"entry_tab_closed",outcome:"not_completed"});
  for(const [id,page] of pages) if(page.tab===tab) pages.delete(id);
  roster();
});
chrome.tabs.onActivated?.addListener?.(({tabId})=>{
  if(tabId===listingForegroundTab)return;
  const owned=workTabs.has(tabId) || [...ownedEntries.values()].includes(tabId) || listingEntry?.tab===tabId;
  if(workTabs.has(tabId)){workTabs.delete(tabId);void saveWorkTabs();}
  if(!owned)return;claimedEntries.add(tabId);
  if(!tabBusy(tabId))closeOwnedTabIfIdle(tabId).catch(()=>{});
});
// Worker activation recovers existing pages once, including after extension reload.
chrome.sidePanel?.setPanelBehavior?.({openPanelOnActionClick:false}).catch(()=>{});
chrome.action?.onClicked?.addListener?.(tab=>{ensureDashboard({active:true,windowId:tab?.windowId}).catch(()=>{});});
hydrateTelemetry().catch(()=>{});
tabRecovery.then(()=>cleanupAutomationTabs()).catch(()=>{});
if(typeof importScripts==="function") {
  // MV3 reload can leave the worker dormant until an event wakes it. A Chrome
  // alarm survives worker suspension; short timers only run while awake.
  chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==="shopkud-reconnect")connect(true);});
  chrome.alarms.get("shopkud-reconnect").then(alarm=>{
    if(!alarm)chrome.alarms.create("shopkud-reconnect",{periodInMinutes:1});
  });
  chrome.runtime.onStartup.addListener(()=>connect(true));
  chrome.runtime.onInstalled.addListener(()=>connect(true));
  shopkudPairing().then(saved=>{socketConfig=saved || null;connectionReady=true;connect();})
    .catch(()=>{connectionReady=true;connect();});
} else connect(); // Node fixture harness has no extension service worker.
recoverPages().catch(()=>{});
