"use strict";

// Offline preflight tests for extension-owned Shopee detail link dialogs.
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");
const source=fs.readFileSync(path.join(__dirname,"../extension/background.js"),"utf8");
const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,"../extension/manifest.json"),"utf8"));
const URL_A="https://affiliate.shopee.co.th/offer/product_offer/456";
const PAGE_ID="77:0123456789abcdef0123456789abcdef";
const NONCE="0123456789abcdef0123456789abcdef";
const args={open_link_dialog:true};
const jsonEqual=(actual,expected,message)=>assert.equal(JSON.stringify(actual),JSON.stringify(expected),message);

function event(){
  const listeners=[];
  return {addListener(fn){listeners.push(fn);},removeListener(fn){const i=listeners.indexOf(fn);if(i>=0)listeners.splice(i,1);},fire(...args){for(const fn of [...listeners])fn(...args);}};
}

function harness(options={}){
  const ports=[],sent=[],getSnapshots=[];
  const runtimeMessage=event();
  let context;
  const currentTab=options.currentTab||{id:77,url:URL_A,active:false,status:"complete"};
  const chrome={runtime:{id:"fixture-extension",lastError:null,getManifest:()=>({version:manifest.version}),onMessage:runtimeMessage,
    connectNative(host){const p={host,messages:[],onDisconnect:event(),onMessage:event(),postMessage(value){this.messages.push(value);}};ports.push(p);return p;}},
    tabs:{onRemoved:event(),onUpdated:event(),query(){return Promise.resolve([]);},
      get(id,callback){
        getSnapshots.push(vm.runInContext(`({requestLease:inFlight.has(${JSON.stringify(options.requestId||"00000000000000000000000000000001")}),owned:ownedEntries.get(${JSON.stringify(URL_A)}),registered:pages.has(${JSON.stringify(PAGE_ID)})})`,context));
        if(options.onGet)options.onGet(context);
        if(options.deferGet)options.pendingGet=()=>callback(currentTab);
        else callback(currentTab);
      },
      sendMessage(tabId,message,callback){
        sent.push({tabId,message});
        if(message.type==="shopkud-entry-status"){
          options.onStatus?.(context,currentTab);
          if(options.deferStatus)options.pendingStatus=callback;
          else if(Object.hasOwn(options,"statusReply"))callback?.(options.statusReply);
          else callback?.({state:"idle",page_url:message.entry_url});
          return;
        }
        if(options.sendCallback)options.sendCallback(callback);else callback?.(message.type==="shopkud-command"?options.contentResult??{ok:true,source_url:URL_A}:{});
      }
    }};
  context=vm.createContext({chrome,URL,Map,Set,Promise,Object,Array,Number,String,RegExp,
    setTimeout,clearTimeout});
  vm.runInContext(source,context,{filename:"background.js"});
  ports[0].onMessage.fire({type:"hello-ack"});
  function seed({owned=true,registered=true,uncertain=false,opening=false,busy=false}={}){
    context.__fixture={url:URL_A,tab:77,page_id:PAGE_ID,nonce:NONCE};
    vm.runInContext(`
      const f=__fixture;
      if(${owned})ownedEntries.set(f.url,f.tab);
      if(${registered})pages.set(f.page_id,{page_id:f.page_id,tab:f.tab,nonce:f.nonce,url:f.url});
      if(${uncertain})uncertainEntries.add(f.tab);
      if(${opening})opening.set(f.tab,{url:f.url});
      if(${busy})inFlight.set('other-request',{page:{page_id:f.page_id,tab:f.tab,nonce:f.nonce,url:f.url},channel:null});
    `,context);
    delete context.__fixture;
  }
  function send(argsValue=args,pageId=PAGE_ID){
    const id="00000000000000000000000000000001";
    options.requestId=id;
    ports[0].onMessage.fire({type:"command",id,page_id:pageId,operation:"detail",arguments:argsValue});
    return id;
  }
  async function result(id){
    for(let i=0;i<100;i++){
      const response=ports[0].messages.find(message=>message.type==="result"&&message.id===id);
      if(response)return response.result;
      await new Promise(resolve=>setImmediate(resolve));
    }
    throw new Error("detail command did not complete");
  }
  return {ports,sent,getSnapshots,context,seed,send,result,options,currentTab};
}

function readinessHarness(){
  const ports=[],sent=[],tabs=new Map(),created=[],pendingTimers=new Map();
  const runtimeMessage=event(),tabsUpdated=event(),tabsRemoved=event();
  let context,timerId=0,nextId=1;
  const chrome={runtime:{id:"fixture-extension",lastError:null,getManifest:()=>({version:manifest.version}),onMessage:runtimeMessage,
    connectNative(host){const p={host,messages:[],onDisconnect:event(),onMessage:event(),postMessage(value){this.messages.push(value);}};ports.push(p);return p;}},
    tabs:{onUpdated:tabsUpdated,onRemoved:tabsRemoved,
      query(){return Promise.resolve([]);},
      create(info){const tab={id:900+created.length,url:info.url,active:info.active,status:"loading"};created.push(tab);tabs.set(tab.id,tab);return Promise.resolve({...tab});},
      get(id,callback){callback(tabs.get(id));},
      sendMessage(tabId,message,callback){sent.push({tabId,message});if(message.type==="shopkud-entry-status"){const tab=tabs.get(tabId);callback?.({state:tab?.status==="complete"?"idle":"unavailable",page_url:tab?.url||null});}else if(message.type==="shopkud-discover"){register(tabId,tabs.get(tabId)?.url||URL_A,NONCE);callback?.({state:"registered"});}else callback?.({ok:true,source_url:message.arguments?.offer_url||URL_A});}
    }};
  context=vm.createContext({chrome,URL,Map,Set,Promise,Object,Array,Number,String,RegExp,
    setTimeout(fn,delay){const id=++timerId;pendingTimers.set(id,{fn,delay});return id;},
    clearTimeout(id){pendingTimers.delete(id);}});
  vm.runInContext(source,context,{filename:"background.js"});
  ports[0].onMessage.fire({type:"hello-ack"});
  function command(operation,args,pageId="extension"){
    const id=(nextId++).toString(16).padStart(32,"0");
    ports[0].onMessage.fire({type:"command",id,page_id:pageId,operation,arguments:args});
    return id;
  }
  async function result(id){
    for(let i=0;i<100;i++){
      const response=ports[0].messages.find(message=>message.type==="result"&&message.id===id);
      if(response)return response.result;
      await new Promise(resolve=>setImmediate(resolve));
    }
    return null;
  }
  function register(tab,url=URL_A,nonce=NONCE){
    runtimeMessage.fire({type:"shopkud-register",nonce,page_url:url},
      {id:chrome.runtime.id,frameId:0,tab:{id:tab},url},()=>{});
  }
  function complete(tabId,{url,active}={}){
    const tab=tabs.get(tabId);if(!tab)return;
    if(url!==undefined)tab.url=url;
    if(active!==undefined)tab.active=active;
    tab.status="complete";
    tabsUpdated.fire(tabId,{status:"complete"},{...tab});
  }
  function close(tabId){tabs.delete(tabId);tabsRemoved.fire(tabId);}
  function expire(){
    const item=[...pendingTimers].find(([,timer])=>timer.delay>=15000);
    assert.ok(item,"open-entry readiness timeout is pending");
    pendingTimers.delete(item[0]);item[1].fn();
  }
  return {ports,sent,tabs,created,pendingTimers,context,command,result,register,complete,close,expire};
}

async function settle(){for(let i=0;i<6;i++)await new Promise(resolve=>setImmediate(resolve));}

async function main(){
  const valid=harness();valid.seed();
  const validId=valid.send();
  // The preflight lease must be visible before tabs.get begins.
  assert.equal(valid.getSnapshots[0].requestLease,true,"inFlight lease is established before the asynchronous tab lookup");
  const success=await valid.result(validId);
  assert.equal(success.ok,true);
  const validStatus=valid.sent.filter(item=>item.message.type==="shopkud-entry-status");
  assert.equal(validStatus.length,1);
  jsonEqual(validStatus[0],{tabId:77,message:{type:"shopkud-entry-status",nonce:NONCE,entry_url:URL_A}},"the isolated read-only status check is nonce-bound to the exact entry URL");
  const validActions=valid.sent.filter(item=>item.message.type==="shopkud-command");
  assert.equal(validActions.length,1);
  jsonEqual(validActions[0],{tabId:77,message:{type:"shopkud-command",nonce:NONCE,request_id:validId,operation:"detail",arguments:args}},"the exact page nonce and original request are forwarded once after attestation");

  const ordinary=harness();ordinary.seed();
  const ordinaryId=ordinary.send({});
  assert.equal(ordinary.sent.length,1,"ordinary detail still dispatches through the prior path");
  jsonEqual(ordinary.sent[0],{tabId:77,message:{type:"shopkud-command",nonce:NONCE,request_id:ordinaryId,operation:"detail",arguments:{}}});

  const rejectedCases=[
    ["unowned",{seed:{owned:false}}],
    ["active",{currentTab:{id:77,url:URL_A,active:true,status:"complete"}}],
    ["loading",{currentTab:{id:77,url:URL_A,active:false,status:"loading"}}],
    ["wrong current URL",{currentTab:{id:77,url:"https://affiliate.shopee.co.th/offer/product_offer/999",active:false,status:"complete"}}],
    ["uncertain",{seed:{uncertain:true}}],
    ["opening",{seed:{opening:true}}],
    ["busy",{seed:{busy:true}}],
    ["stale registration",{seed:{},onGet(context){vm.runInContext(`pages.delete(${JSON.stringify(PAGE_ID)})`,context);}}],
  ];
  for(const [label,spec] of rejectedCases){
    const blocked=harness(spec);blocked.seed(spec.seed);
    const id=blocked.send();
    const response=await blocked.result(id);
    assert.equal(response.error,"link_requires_owned_idle_detail",`${label} state is rejected`);
    assert.equal(blocked.sent.length,0,`${label} state sends no content command`);
  }

  const cancelled=harness({deferGet:true});cancelled.seed();
  const cancelledId=cancelled.send();
  assert.equal(typeof cancelled.options.pendingGet,"function","test pauses the asynchronous tabs.get before it returns");
  cancelled.ports[0].onMessage.fire({type:"cancel",id:cancelledId,page_id:PAGE_ID});
  cancelled.options.pendingGet();
  const cancelledResult=await cancelled.result(cancelledId);
  assert.equal(cancelledResult.error,"cancelled","native cancellation is observed after the delayed tab lookup");
  assert.equal(cancelled.sent.filter(item=>item.message.type==="shopkud-command").length,0,"cancellation during preflight prevents the content operation from dispatching");

  const unknown=harness({sendCallback:callback=>callback(undefined)});unknown.seed();
  const unknownId=unknown.send();
  const unknownResult=await unknown.result(unknownId);
  assert.equal(unknownResult.error,"invalid_page_result");
  assert.equal(unknown.sent.filter(item=>item.message.type==="shopkud-command").length,1,"an unknown content result is not replayed");

  const noUrl=harness({currentTab:{id:77,active:false,status:"complete"}});noUrl.seed();
  assert.equal(noUrl.currentTab.url,undefined,"fixture models Chrome omitting tabs.get.url under the narrow manifest permissions");
  assert.equal(noUrl.currentTab.url!==URL_A,true,"the pre-fix direct URL comparison would reject this valid exact-route attestation case");
  const noUrlId=noUrl.send();
  assert.equal((await noUrl.result(noUrlId)).ok,true,"Chrome omitting tab.url is allowed only after exact content attestation");
  assert.equal(noUrl.sent.filter(item=>item.message.type==="shopkud-command"&&item.message.operation==="detail").length,1);

  for(const [label,statusReply] of [
    ["missing",undefined],
    ["wrong URL",{state:"idle",page_url:"https://affiliate.shopee.co.th/offer/product_offer/999"}],
    ["busy",{state:"busy",page_url:URL_A}],
    ["unavailable",{state:"unavailable",page_url:null}],
  ]){
    const untrusted=harness({currentTab:{id:77,active:false,status:"complete"},statusReply});untrusted.seed();
    const id=untrusted.send();
    const response=await untrusted.result(id);
    assert.notEqual(response?.ok,true,`${label} attestation cannot authorize the link dialog`);
    assert.equal(untrusted.sent.filter(item=>item.message.type==="shopkud-command"&&item.message.operation==="detail").length,0,`${label} attestation sends no link command`);
  }

  for(const [label,onStatus] of [
    ["final tab changed",(_context,tab)=>{tab.url="https://affiliate.shopee.co.th/offer/product_offer/999";}],
    ["final tab active",(_context,tab)=>{tab.active=true;}],
    ["nonce registry changed",context=>vm.runInContext(`pages.set(${JSON.stringify(PAGE_ID)},{page_id:${JSON.stringify(PAGE_ID)},tab:77,nonce:"fedcba9876543210fedcba9876543210",url:${JSON.stringify(URL_A)}})`,context)],
  ]){
    const changed=harness({onStatus});changed.seed();
    const id=changed.send();
    assert.notEqual((await changed.result(id))?.ok,true,`${label} during attestation blocks dispatch`);
    assert.equal(changed.sent.filter(item=>item.message.type==="shopkud-command"&&item.message.operation==="detail").length,0,`${label} sends no link command`);
  }

  const cancelDuringAttestation=harness({currentTab:{id:77,active:false,status:"complete"},deferStatus:true});cancelDuringAttestation.seed();
  const cancelStatusId=cancelDuringAttestation.send();
  await settle();
  assert.equal(typeof cancelDuringAttestation.options.pendingStatus,"function","attestation callback is held while cancellation arrives");
  cancelDuringAttestation.ports[0].onMessage.fire({type:"cancel",id:cancelStatusId,page_id:PAGE_ID});
  cancelDuringAttestation.options.pendingStatus({state:"idle",page_url:URL_A});
  assert.equal((await cancelDuringAttestation.result(cancelStatusId)).error,"cancelled");
  assert.equal(cancelDuringAttestation.sent.filter(item=>item.message.type==="shopkud-command"&&item.message.operation==="detail").length,0,"cancelled isolated attestation cannot be followed by an action");

  const readiness=readinessHarness();
  const offerId=readiness.command("open_offer",{offer_url:URL_A});
  await settle();
  assert.equal(readiness.created.length,1,"fixture creates exactly one inactive entry tab");
  const entry=readiness.created[0];
  readiness.register(entry.id);
  readiness.context.__registeredPage=vm.runInContext(`pages.get(${JSON.stringify(`${entry.id}:${NONCE}`)})`,readiness.context);
  await settle();
  const earlyResult=readiness.ports[0].messages.find(message=>message.type==="result"&&message.id===offerId);
  assert.equal(earlyResult,undefined,"early exact-URL registration must not mark a still-loading tab ready");
  const linkWhileLoading=readiness.command("detail",args,`${entry.id}:${NONCE}`);
  const loadingLinkResult=await readiness.result(linkWhileLoading);
  assert.equal(loadingLinkResult.error,"link_requires_owned_idle_detail");
  assert.equal(readiness.sent.some(item=>item.message.type==="shopkud-command"&&item.message.operation==="detail"),false,"no link dialog is dispatched while the owned tab is loading");
  readiness.complete(entry.id);
  const readyResult=await readiness.result(offerId);
  assert.equal(readyResult?.ok,true,"matching completion resolves entry readiness");
  assert.equal(readyResult.page_id,`${entry.id}:${NONCE}`,"early registration identity survives the matching completion probe");
  assert.equal(vm.runInContext(`pages.get(${JSON.stringify(readyResult.page_id)})===__registeredPage`,readiness.context),true,"same-nonce registration on completion preserves the original page lease object");
  const readyLink=readiness.command("detail",args,readyResult.page_id);
  assert.equal((await readiness.result(readyLink))?.ok,true,"link dialog succeeds after the new entry reaches exact-URL idle completion");
  assert.equal(readiness.sent.filter(item=>item.message.type==="shopkud-command"&&item.message.operation==="detail").length,1);

  for(const [label,scenario] of [
    ["wrong URL",h=>h.complete(h.created[0].id,{url:"https://affiliate.shopee.co.th/offer/product_offer/999"})],
    ["active tab",h=>h.complete(h.created[0].id,{active:true})],
    ["timeout",()=>{}],
    ["closed tab",h=>h.close(h.created[0].id)],
  ]){
    const blocked=readinessHarness();
    const blockedOffer=blocked.command("open_offer",{offer_url:URL_A});
    await settle();
    const tabId=blocked.created[0].id;
    blocked.register(tabId);
    await settle();
    scenario(blocked);
    if(label==="timeout")blocked.expire();
    const openResult=await blocked.result(blockedOffer);
    assert.notEqual(openResult?.ok,true,`${label} must not return a ready entry`);
    const linkId=blocked.command("detail",args,`${tabId}:${NONCE}`);
    const linkResult=await blocked.result(linkId);
    assert.notEqual(linkResult?.ok,true,`${label} must not authorize link dialog dispatch`);
    assert.equal(blocked.sent.filter(item=>item.message.type==="shopkud-command"&&item.message.operation==="detail").length,0,`${label} produces no link content command`);
  }

  console.log(JSON.stringify({ok:true,checks:[
    "owned inactive complete detail preflight holds a lease before tab lookup and forwards exact nonce/request once",
    "unowned, active, loading, changed-URL, stale, uncertain, opening, and busy states are rejected without content sends",
    "ordinary detail remains unchanged; pre-dispatch cancellation and unknown outcomes do not dispatch or replay",
    "URL-less tab metadata requires nonce-bound idle exact-URL attestation; missing, wrong, busy, canceled, or changed final evidence cannot dispatch",
    "new-tab readiness waits past early registration for exact inactive completion; wrong URL, active, closed, and timeout cases cannot dispatch links",
  ]}));
}

main().catch(error=>{console.error(error);process.exitCode=1;});
