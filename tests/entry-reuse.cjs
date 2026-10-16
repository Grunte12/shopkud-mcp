"use strict";

// Isolated entry-tab reuse policy test. No browser, native host, profile, or network is used.
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");

const source=fs.readFileSync(path.join(__dirname,"../extension/background.js"),"utf8");
const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,"../extension/manifest.json"),"utf8"));
const BASE="https://affiliate.shopee.co.th/offer/product_offer";
const detail=id=>`${BASE}/${id}`;
const list=`${BASE}`;
const jsonEqual=(actual,expected,message)=>assert.equal(JSON.stringify(actual),JSON.stringify(expected),message);

function event(){
  const listeners=[];
  return {addListener(fn){listeners.push(fn);},removeListener(fn){const i=listeners.indexOf(fn);if(i>=0)listeners.splice(i,1);},fire(...args){for(const fn of [...listeners])fn(...args);}};
}

function harness({updateFails=false,updateBlocked=false}={}){
  const ports=[],tabs=new Map(),sent=[],updates=[],updateSnapshots=[],creates=[];
  const runtimeMessage=event(),tabsRemoved=event(),tabsUpdated=event();
  let nonce=100,nextCommand=0;
  let context;
  let updateStartedResolve,releaseUpdate;
  const updateStarted=new Promise(resolve=>{updateStartedResolve=resolve;});
  const chrome={runtime:{id:"fixture-extension",lastError:null,getManifest:()=>({version:manifest.version,optional_permissions:manifest.optional_permissions||[],optional_host_permissions:manifest.optional_host_permissions||[]}),onMessage:runtimeMessage,
    connectNative(host){const p={host,messages:[],onDisconnect:event(),onMessage:event(),postMessage(value){this.messages.push(value);}};ports.push(p);return p;}},
    permissions:{contains(permission,callback){const granted=true;callback?.(granted);return Promise.resolve(granted);},request(){throw new Error("entry_info must not request permissions");},getAll(){throw new Error("entry_info must not enumerate permissions");}},
    tabs:{onRemoved:tabsRemoved,onUpdated:tabsUpdated,
      async query(){return [...tabs.values()].map(t=>({id:t.id,url:t.url,active:t.active,status:t.status}));},
      sendMessage(tabId,message,callback){
        sent.push({tabId,message});const tab=tabs.get(tabId);
        if(message.type==="shopkud-entry-status"){
          const response=tab?.entryStatus||{state:"idle",page_url:tab?.url};callback?.(response);return;
        }
        if(message.type==="shopkud-discover" && tab){
          const pageNonce=(++nonce).toString(16).padStart(32,"0");
          runtimeMessage.fire({type:"shopkud-register",nonce:pageNonce,page_url:tab.url},{id:"fixture-extension",frameId:0,tab:{id:tabId},url:tab.url},()=>{});
          callback?.({state:"registered"});return;
        }
        callback?.({});
      },
      async create(info){const id=500+creates.length;creates.push({id,...info});tabs.set(id,{id,url:info.url,active:info.active,status:"complete"});return {id};},
      get(id,callback){callback(tabs.get(id));},
      update(id,info){updates.push({id,info});updateStartedResolve({id,info});
        if(context)updateSnapshots.push(vm.runInContext(`({target:ownedEntries.get(${JSON.stringify(info.url)}),otherOwnedUrls:[...ownedEntries].filter(([url,tab])=>tab===${id}&&url!==${JSON.stringify(info.url)}).map(([url])=>url),oldLeaseCount:[...pages.values()].filter(page=>page.tab===${id}).length,uncertain:uncertainEntries.has(${id})})`,context));
        if(updateFails)return Promise.reject(new Error("synthetic update failure"));
        const dispatch=()=>{const tab=tabs.get(id);if(!tab)throw new Error("missing tab");Object.assign(tab,{url:info.url,active:info.active,status:"complete"});tabsUpdated.fire(id,{status:"complete"},tab);return tab;};
        if(updateBlocked)return new Promise(resolve=>{releaseUpdate=()=>resolve(dispatch());});
        return Promise.resolve(dispatch());},
    }};
  const timers=new Map();let timerId=0;
  context=vm.createContext({chrome,URL,Map,Set,Promise,Object,Array,Number,String,RegExp,
    setTimeout(fn,delay){const id=++timerId;timers.set(id,{fn,delay});return id;},clearTimeout(id){timers.delete(id);}});
  vm.runInContext(source,context,{filename:"background.js"});
  ports[0].onMessage.fire({type:"hello-ack"});
  function seed(entries,extraTabs=[]){
    for(const item of [...entries,...extraTabs])tabs.set(item.id,{id:item.id,url:item.url,active:item.active??false,status:item.status??"complete",...(item.entryStatus?{entryStatus:item.entryStatus}:{})});
    context.__seed=entries;
    vm.runInContext("for(const item of __seed){ownedEntries.set(item.url,item.id);if(item.registered!==false){const p={page_id:item.page_id||`${item.id}:${item.nonce}`,tab:item.id,nonce:item.nonce,url:item.pageUrl||item.url};pages.set(p.page_id,p);}}",context);
    delete context.__seed;
  }
  async function command(operation,args={}){
    const id=(++nextCommand).toString(16).padStart(32,"0");
    ports[0].onMessage.fire({type:"command",id,page_id:"extension",operation,arguments:args});
    for(let i=0;i<100;i++){
      const result=ports[0].messages.find(message=>message.type==="result"&&message.id===id);
      if(result)return result.result;
      await new Promise(resolve=>setImmediate(resolve));
    }
    throw new Error(`${operation} did not complete`);
  }
  function inspect(expression){return vm.runInContext(expression,context);}
  return {ports,tabs,sent,updates,updateSnapshots,creates,seed,command,inspect,updateStarted,releaseUpdate:()=>{assert.equal(typeof releaseUpdate,"function","update is waiting at mock barrier");releaseUpdate();}};
}

function entries(ids,options={}){
  return ids.map((id,index)=>{
    const url=options.urls?.[index]||detail(1001+index),nonce=(index+1).toString(16).padStart(32,"0");
    return {id,url,nonce,page_id:`${id}:${nonce}`,...(options.rows?.[index]||{})};
  });
}

async function main(){
  assert.deepEqual(manifest.permissions,["nativeMessaging"],"entry management does not broaden extension permissions");
  assert.equal(Object.hasOwn(manifest,"host_permissions"),false,"entry management adds no broad host permission");
  const h=harness();
  const initial=entries([11,12,13,14]);h.seed(initial);
  const beforeInfo={updates:h.updates.length,creates:h.creates.length,owned:h.inspect("[...ownedEntries]").map(([url,id])=>[url,id]),pageCount:h.inspect("pages.size")};
  const info=await h.command("entry_info",{});
  assert.equal(info.ok,true);assert.equal(info.capacity,4);assert.equal(info.owner_tabs_included,false);
  jsonEqual(Object.keys(info).sort(),["ok","entries","capacity","ownership_scope","owner_tabs_included","listing_access"].sort());
  jsonEqual(info.entries.map(e=>e.tab_id),[11,12,13,14]);
  for(const item of info.entries)jsonEqual(Object.keys(item).sort(),["tab_id","entry_url","page_id","active","busy","state","reusable_detail","tab_status","tab_url_available","tab_url_matches"].sort());
  assert.ok(info.entries.every(e=>!Object.hasOwn(e,"title")&&!Object.hasOwn(e,"name")));
  assert.ok(info.entries.every(e=>e.tab_status==="complete"&&e.tab_url_available===true&&e.tab_url_matches===true),"entry_info exposes only bounded tab URL availability/match and status evidence");
  jsonEqual({updates:h.updates.length,creates:h.creates.length,owned:h.inspect("[...ownedEntries]").map(([url,id])=>[url,id]),pageCount:h.inspect("pages.size")},beforeInfo,"entry_info is read-only and reports only extension-owned entry tabs");
  assert.ok(info.entries.every(entry=>entry.state==="registered"&&entry.reusable_detail===true&&entry.busy===false));

  const busyInfoHarness=harness();busyInfoHarness.seed(entries([15,16,17,18]));
  busyInfoHarness.inspect("inFlight.set('busy-info',{page:pages.get('15:00000000000000000000000000000001'),channel:null})");
  const busyInfo=await busyInfoHarness.command("entry_info",{});
  const busyEntry=busyInfo.entries.find(entry=>entry.tab_id===15);
  assert.equal(busyEntry.busy,true);assert.equal(busyEntry.reusable_detail,false);

  const first=await h.command("open_offer",{offer_url:detail(1005)});
  assert.equal(first.ok,true);assert.equal(first.reused_tab,true);assert.equal(first.created_tab,false);
  assert.equal(first.tab_id,11);jsonEqual(h.updates[0],{id:11,info:{url:detail(1005),active:false}});
  jsonEqual(h.updateSnapshots[0],{target:11,otherOwnedUrls:[],oldLeaseCount:0,uncertain:true},"mapping, lease invalidation, and uncertainty precede update dispatch");
  assert.equal(h.inspect("uncertainEntries.has(11)"),false,"exact target registration clears uncertainty");
  assert.equal(h.inspect("pages.has('11:00000000000000000000000000000001')"),false,"the old lease is invalidated before reuse");

  const same=await h.command("open_offer",{offer_url:detail(1005)});
  assert.equal(same.ok,true);assert.equal(same.reused_tab,false);assert.equal(same.created_tab,false);
  assert.equal(h.updates.length,1,"exact registered URL reuse does not update again");
  const sixth=await h.command("open_offer",{offer_url:detail(1006)});
  assert.equal(sixth.ok,true);assert.equal(sixth.reused_tab,true);assert.equal(sixth.tab_id,12);
  assert.equal(h.updates.length,2,"more than four sequential exact detail URLs reuse without creating or closing tabs");
  assert.equal(h.creates.length,0);assert.equal(h.tabs.size,4);

  const creation=harness();
  for(let id=2001;id<=2004;id++){
    const result=await creation.command("open_offer",{offer_url:detail(id)});
    assert.equal(result.ok,true);assert.equal(result.created_tab,true);assert.equal(result.reused_tab,false);
  }
  assert.equal(creation.creates.length,4);assert.equal(creation.inspect("ownedEntries.size"),4);
  const createdFifth=await creation.command("open_offer",{offer_url:detail(2005)});
  assert.equal(createdFifth.ok,true);assert.equal(createdFifth.reused_tab,true);assert.equal(createdFifth.created_tab,false);
  const createdSixth=await creation.command("open_offer",{offer_url:detail(2006)});
  assert.equal(createdSixth.ok,true);assert.equal(createdSixth.reused_tab,true);assert.equal(createdSixth.created_tab,false);
  assert.equal(creation.creates.length,4,"capacity is filled by actual mocked tab creation before reuse");
  assert.equal(creation.updates.length,2);assert.equal(creation.tabs.size,4);

  const contended=harness({updateBlocked:true});contended.seed(entries([19,20,21,22]));
  const firstOpen=contended.command("open_offer",{offer_url:detail(1600)});
  await contended.updateStarted;
  const competingOpen=await contended.command("open_offer",{offer_url:detail(1601)});
  assert.equal(competingOpen.error,"entry_busy");assert.equal(contended.updates.length,1,"concurrent entry cannot dispatch a second navigation");
  contended.releaseUpdate();
  const completedOpen=await firstOpen;
  assert.equal(completedOpen.ok,true);assert.equal(completedOpen.reused_tab,true);

  const nonIdleReplies=[
    {state:"busy",page_url:detail(1701)},
    {state:"unavailable",page_url:null},
    {state:"challenge_detected",page_url:null},
  ];
  for(const reply of nonIdleReplies){
    const guarded=harness();const seed=entries([25,26,27,28],{rows:[{},{registered:false},{registered:false},{registered:false}]});
    guarded.seed(seed);guarded.tabs.get(25).entryStatus=reply;
    const result=await guarded.command("open_offer",{offer_url:detail(1700)});
    assert.equal(result.error,"entry_tab_limit",`${reply.state} entry status is not reusable`);
    assert.equal(guarded.updates.length,0);assert.equal(guarded.creates.length,0);assert.equal(guarded.tabs.get(25).url,detail(1001));
  }

  const rejectionCases=[
    ["search tab",entries([21,22,23,24],{urls:[list,detail(1102),detail(1103),detail(1104)],rows:[{},{registered:false},{registered:false},{registered:false}]})],
    ["active tab",entries([31,32,33,34],{rows:[{active:true},{registered:false},{registered:false},{registered:false}]})],
    ["busy tab",entries([41,42,43,44],{rows:[{},{registered:false},{registered:false},{registered:false}]})],
    ["stale lease",entries([51,52,53,54],{rows:[{registered:false},{registered:false},{registered:false},{registered:false}]})],
    ["mismatched page URL",entries([61,62,63,64],{rows:[{pageUrl:detail(1199)},{registered:false},{registered:false},{registered:false}]})],
    ["loading tab",entries([71,72,73,74],{rows:[{status:"loading"},{registered:false},{registered:false},{registered:false}]})],
    ["unowned detail",entries([81,82,83,84],{rows:[{registered:false},{registered:false},{registered:false},{registered:false}]})],
  ];
  for(const [label,seed] of rejectionCases){
    const blocked=harness();
    const extras=label==="unowned detail"?[{id:899,url:detail(1299),active:false,status:"complete"}]:[];
    blocked.seed(seed,extras);
    if(label==="busy tab")blocked.inspect("inFlight.set('busy-fixture',{page:pages.get('41:00000000000000000000000000000001'),channel:null})");
    if(label==="mismatched page URL")blocked.tabs.get(61).entryStatus={state:"idle",page_url:detail(1999)};
    const before=blocked.inspect("[...ownedEntries].map(([url,id])=>[url,id])");
    const result=await blocked.command("open_offer",{offer_url:detail(1300)});
    assert.equal(result.error,"entry_tab_limit",`${label} must not be recycled`);
    assert.equal(blocked.updates.length,0,`${label} must not be updated`);
    assert.equal(blocked.creates.length,0,`${label} must not create a tab at capacity`);
    assert.equal(blocked.tabs.size,4+extras.length,`${label} must not close tabs`);
    jsonEqual(blocked.inspect("[...ownedEntries].map(([url,id])=>[url,id])"),before);
    if(label==="busy tab")assert.equal(blocked.sent.some(x=>x.tabId===41&&x.message.type==="shopkud-entry-status"),false,"busy tabs are rejected before status probes");
  }

  const mismatch=harness(),mismatchEntries=entries([91,92,93,94]);
  mismatchEntries.slice(1).forEach(item=>{item.registered=false;});
  mismatch.seed(mismatchEntries);mismatch.tabs.get(91).entryStatus={state:"idle",page_url:detail(9999)};
  assert.equal((await mismatch.command("open_offer",{offer_url:detail(1400)})).error,"entry_tab_limit");
  assert.equal(mismatch.updates.length,0,"status reply must attest the exact current entry URL");

  const uncertain=harness({updateFails:true});uncertain.seed(entries([101,102,103,104]));
  const failed=await uncertain.command("open_offer",{offer_url:detail(1500)});
  assert.equal(failed.error,"entry_unconfirmed");assert.equal(failed.outcome,"unconfirmed");
  assert.equal(uncertain.updates.length,1);assert.equal(uncertain.inspect("uncertainEntries.has(101)"),true);
  assert.equal(uncertain.inspect("ownedEntries.has('https://affiliate.shopee.co.th/offer/product_offer/1001')"),false);
  const retry=await uncertain.command("open_offer",{offer_url:detail(1500)});
  assert.equal(retry.error,"entry_unconfirmed");assert.equal(uncertain.updates.length,1,"unknown update is never replayed automatically");
  const uncertainInfo=await uncertain.command("entry_info",{});
  assert.equal(uncertainInfo.entries.find(e=>e.tab_id===101).state,"unconfirmed");

  const removed=harness(),removedEntries=entries([111,112,113,114]);removed.seed(removedEntries);
  removed.tabs.delete(111);removed.inspect("chrome.tabs.onRemoved.fire(111)");
  assert.equal(removed.inspect("ownedEntries.has('https://affiliate.shopee.co.th/offer/product_offer/1001')"),false,"removed tabs drop ownership");
  assert.equal(removed.inspect("pages.has('111:00000000000000000000000000000001')"),false);

  console.log(JSON.stringify({ok:true,checks:[
    "entry_info is minimal/read-only and excludes unowned tabs",
    "capacity reuse is exact, registered, inactive, idle, serial, and non-destructive",
    "search, unowned, active, busy, stale, loading, and mismatched tabs remain untouched",
    "unknown update is guarded against replay; exact registration clears uncertainty",
    "removed-tab ownership and leases are discarded",
  ]}));
}

main().catch(error=>{console.error(error);process.exitCode=1;});
