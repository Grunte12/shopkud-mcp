"use strict";
const HOST = "org.shopkud.mcp";
const pages = new Map();
const inFlight = new Map();
const ownedEntries = new Map();
const opening = new Map();
const uncertainEntries = new Set();
let entryBusy = false;
let listingEntry = null;
let listingTask = null;
const listingAccess = {permissions:["scripting"],origins:["https://shopee.co.th/*"]};
let port = null;
let connected = false;
let recovering = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
const reconnectDelays = [1000, 3000, 8000];
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
const tabBusy = tab => opening.has(tab) || [...inFlight.values()].some(task=>task.page.tab===tab);
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
const listingURL = value => typeof value==="string" && /^https:\/\/shopee\.co\.th\/product\/[1-9][0-9]{0,19}\/[1-9][0-9]{0,19}$/u.test(value) && !/[\r\n]/u.test(value);
const listingFailure = error => ({ok:false,error,outcome:"not_completed",retry_automatically:false});
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
  if(current && (current.active!==false || current.status!=="complete"))return listingFailure("listing_tab_not_idle");
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
      listingEntry.tab=opened.id;created=true;
    } else {
      listingEntry={tab:listingEntry.tab,url,uncertain:true};reused=true;
      await chrome.tabs.update(listingEntry.tab,{url,active:false});
    }
    if(task.cancelled)return listingFailure("cancelled");
    const loaded=await new Promise(resolve=>{
      let done=false;
      const finish=value=>{if(done)return;done=true;clearTimeout(timer);chrome.tabs.onUpdated.removeListener(update);task.finishWait=null;resolve(value);};
      const update=(id,change)=>{if(id===listingEntry?.tab && change.status==="complete")finish(true);};
      const timer=setTimeout(()=>finish(false),15000);
      task.finishWait=()=>finish(false);chrome.tabs.onUpdated.addListener(update);
      tabInfo(listingEntry.tab).then(tab=>{if(tab?.status==="complete")finish(true);});
      if(task.cancelled)finish(false);
    });
    if(task.cancelled)return listingFailure("cancelled");
    if(!loaded)return {...listingFailure("listing_unconfirmed"),outcome:"unconfirmed"};
  }
  current=await tabInfo(listingEntry.tab);
  if(task.cancelled)return listingFailure("cancelled");
  if(!current || current.url!==url)return listingFailure("listing_context_changed");
  if(current.active!==false || current.status!=="complete")return listingFailure("listing_tab_not_idle");
  if(!await chrome.permissions.contains(listingAccess))return await listingPermissionFailure();
  if(task.cancelled)return listingFailure("cancelled");
  const injected=await chrome.scripting.executeScript({target:{tabId:listingEntry.tab,frameIds:[0]},files:["listing.js"],world:"ISOLATED"});
  if(task.cancelled)return listingFailure("cancelled");
  const finalTab=await tabInfo(listingEntry.tab);
  if(task.cancelled)return listingFailure("cancelled");
  if(!finalTab || finalTab.url!==url)return listingFailure("listing_context_changed");
  if(finalTab.active!==false || finalTab.status!=="complete")return listingFailure("listing_tab_not_idle");
  const result=injected?.length===1 && injected[0].frameId===0?injected[0].result:null;
  const parts=url.split("/");
  if(!result || typeof result!=="object" || result.source_url!==url || result.shop_id!==parts[4] || result.product_id!==parts[5])throw new Error("invalid listing evidence");
  if(result.ok===true && result.kind!=="public_product_detail")throw new Error("invalid listing kind");
  listingEntry.uncertain=false;
  return {...result,entry:{tab_id:listingEntry.tab,entry_url:url,created_tab:created,reused_tab:reused,owner_tab_changed:false,extension_version:chrome.runtime.getManifest().version},retry_automatically:false};
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
    } else {
      const newTab=await chrome.tabs.create({url,active:false});
      tab=newTab.id;ownedEntries.set(url,tab);created=true;
    }
  }
  const evidence={tab_id:tab,entry_url:url,created_tab:created,reused_tab:reused,owner_tab_changed:false,extension_version:chrome.runtime.getManifest().version};
  return await new Promise(resolve=>{
    let settled=false;
    const finish=result=>{
      if(settled)return;settled=true;clearTimeout(timer);opening.delete(tab);chrome.tabs.onUpdated.removeListener(loaded);
      if(!result.ok)uncertainEntries.add(tab);
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
  if(port || reconnectTimer || reconnectAttempts>=reconnectDelays.length)return;
  const delay=reconnectDelays[reconnectAttempts++];
  reconnectTimer=setTimeout(()=>{reconnectTimer=null;connect(true);},delay);
}
function connect(automatic=false) {
  if(port) return;
  if(reconnectTimer){clearTimeout(reconnectTimer);reconnectTimer=null;}
  if(!automatic)reconnectAttempts=0;
  try {
    const channel=chrome.runtime.connectNative(HOST);
    port=channel;
    channel.onDisconnect.addListener(()=>{
      void chrome.runtime.lastError;
      if(port===channel) {port=null;connected=false;state();scheduleReconnect();}
      if(listingTask?.channel===channel){listingTask.cancelled=true;listingTask.finishWait?.();}
      for(const [id,task] of inFlight)if(task.channel===channel){chrome.tabs.sendMessage(task.page.tab,{type:"shopkud-cancel",nonce:task.page.nonce,request_id:id},()=>{void chrome.runtime.lastError;});inFlight.delete(id);}
    });
    channel.onMessage.addListener(message=>{
      if(port!==channel)return;
      if(message?.type==="hello-ack") {connected=true;reconnectAttempts=0;roster();state();return;}
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
        }).then(result=>{if(port===channel)channel.postMessage({type:"result",id:message.id,result});}).finally(()=>{if(listingTask===task)listingTask=null;});
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
          });
        })().catch(()=>reject("link_preflight_failed"));
        return;
      }
      chrome.tabs.sendMessage(page.tab,{type:"shopkud-command",nonce:page.nonce,request_id:message.id,operation:message.operation,arguments:message.arguments},result=>{
        const error=chrome.runtime.lastError;
        inFlight.delete(message.id);
        if(port!==channel) return; // Unknown operation outcome: no replay.
        if(error) {
          pages.delete(page.page_id);roster();
          channel.postMessage({type:"result",id:message.id,result:{ok:false,error:"page_context_unavailable",outcome:"unconfirmed"}});
        } else channel.postMessage({type:"result",id:message.id,result:result || {ok:false,error:"invalid_page_result",outcome:"unconfirmed"}});
      });
    });
  } catch {port=null;connected=false;state();scheduleReconnect();}
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
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
  if(listingEntry?.tab===tab){listingTask && (listingTask.cancelled=true);listingTask?.finishWait?.();listingEntry=null;}
  uncertainEntries.delete(tab);
  for(const [url,id] of ownedEntries)if(id===tab)ownedEntries.delete(url);
  opening.get(tab)?.finish({ok:false,error:"entry_tab_closed",outcome:"not_completed"});
  for(const [id,page] of pages) if(page.tab===tab) pages.delete(id);
  roster();
});
// Worker activation recovers existing pages once, including after extension reload.
connect();
recoverPages().catch(()=>{});
