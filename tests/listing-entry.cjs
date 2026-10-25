"use strict";

// Public Shopee listing entry policy test. Runs in a VM with mocked Chrome APIs;
// it never opens a browser, installs the extension, or accesses the network.
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");

const source=fs.readFileSync(path.join(__dirname,"../extension/background.js"),"utf8");
const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,"../extension/manifest.json"),"utf8"));
const PRODUCT="https://shopee.co.th/product/123/456";
const OTHER="https://shopee.co.th/product/123/789";
const PRODUCT_RESULT={ok:true,kind:"public_product_detail",source_url:PRODUCT,shop_id:"123",product_id:"456"};
const jsonEqual=(actual,expected,message)=>assert.equal(JSON.stringify(actual),JSON.stringify(expected),message);

function event(){
  const listeners=[];
  return {addListener(fn){listeners.push(fn);},removeListener(fn){const i=listeners.indexOf(fn);if(i>=0)listeners.splice(i,1);},fire(...args){for(const fn of [...listeners])fn(...args);}};
}

function harness(options={}){
  const ports=[],tabs=new Map(),creates=[],updates=[],removals=[],executions=[],permissionChecks=[],permissionMutations=[];
  const runtimeMessage=event(),tabsRemoved=event(),tabsUpdated=event();
  let nextCommand=0;
  const chrome={runtime:{id:"fixture-extension",lastError:null,getManifest:()=>({version:manifest.version,optional_permissions:manifest.optional_permissions||[],optional_host_permissions:manifest.optional_host_permissions||[]}),getURL:file=>`chrome-extension://fixture/${file}`,onMessage:runtimeMessage,
    connectNative(host){const p={host,messages:[],onDisconnect:event(),onMessage:event(),postMessage(value){this.messages.push(value);}};ports.push(p);return p;}},
    permissions:{contains(permission,callback){permissionChecks.push(permission);
      const hasScripting=options.scriptingGranted??options.permissionsGranted!==false;
      const hasHost=options.hostGranted??options.permissionsGranted!==false;
      const granted=permission.permissions?.length&&permission.origins?.length?hasScripting&&hasHost:
        permission.permissions?.includes("scripting")?hasScripting:
        permission.origins?.includes("https://shopee.co.th/*")?hasHost:false;
      callback?.(granted);return Promise.resolve(granted);
    },request(){permissionMutations.push("request");return Promise.resolve(true);},getAll(){permissionMutations.push("getAll");return Promise.resolve({});}},
    scripting:{executeScript(details,callback){executions.push(details);if(options.scriptStarted)options.scriptStarted();if(options.scriptFails)return Promise.reject(new Error("synthetic injection failure"));
      const tab=tabs.get(details.target.tabId);
      const requested=tab?.url||PRODUCT,parts=requested.split("/");
      const result=options.scriptResult || {frameId:0,result:{ok:true,kind:"public_product_detail",source_url:requested,shop_id:parts[4],product_id:parts[5]}};
      if(options.scriptCallback)options.scriptCallback({details,tab});
      callback?.([result]);return options.scriptGate?options.scriptGate.then(()=>[result]):Promise.resolve([result]);
    }},
    tabs:{onRemoved:tabsRemoved,onUpdated:tabsUpdated,
      query(_query,callback){const result=[...tabs.values()].map(t=>({...t}));if(callback)callback(result);return Promise.resolve(result);},
      get(id,callback){const tab=tabs.get(id);if(options.deferGet)return options.deferGet.then(()=>{callback?.(tab);return tab;});if(callback)callback(tab);return Promise.resolve(tab);},
      create(info,callback){const id=500+creates.length;creates.push({id,...info});if(options.createFails)return Promise.reject(new Error("synthetic create failure"));const tab={id,url:info.url,active:info.active,status:"complete"};tabs.set(id,tab);if(callback)callback(tab);return Promise.resolve(tab);},
      update(id,info,callback){updates.push({id,info});if(options.updateFails){chrome.runtime.lastError={message:"synthetic update failure"};callback?.();chrome.runtime.lastError=null;return Promise.reject(new Error("synthetic update failure"));}
        const tab=tabs.get(id);if(!tab){callback?.();return Promise.reject(new Error("missing tab"));}
        Object.assign(tab,info,{status:"complete"});tabsUpdated.fire(id,{status:"complete"},tab);if(callback)callback(tab);return Promise.resolve(tab);
      },remove(id){removals.push(id);tabs.delete(id);tabsRemoved.fire(id);return Promise.resolve();}}
  };
  const timers=new Map();let timerId=0;
  const context=vm.createContext({chrome,URL,Map,Set,Promise,Object,Array,Number,String,RegExp,
    setTimeout(fn,delay){const id=++timerId;timers.set(id,{fn,delay});return id;},clearTimeout(id){timers.delete(id);}});
  vm.runInContext(source,context,{filename:"background.js"});
  ports[0].onMessage.fire({type:"hello-ack"});
  for(const tab of options.tabs||[])tabs.set(tab.id,{active:false,status:"complete",...tab});
  function send(operation,args={}){
    const id=(++nextCommand).toString(16).padStart(32,"0");
    ports[0].onMessage.fire({type:"command",id,page_id:"extension",operation,arguments:args});
    return id;
  }
  async function resultFor(id,operation="command"){
    for(let i=0;i<100;i++){
      const result=ports[0].messages.find(message=>message.type==="result"&&message.id===id);
      if(result)return result.result;
      await new Promise(resolve=>setImmediate(resolve));
    }
    throw new Error(`${operation} did not complete`);
  }
  async function runTimers(delay){const pending=[];for(const [id,timer] of [...timers])if(timer.delay===delay){timers.delete(id);pending.push(Promise.resolve(timer.fn()));}await new Promise(resolve=>setImmediate(resolve));await Promise.all(pending);}
  async function command(operation,args={}){return resultFor(send(operation,args),operation);}
  function completeTab(id){const tab=tabs.get(id);if(!tab)return;tab.status="complete";tabsUpdated.fire(id,{status:"complete"},tab);}
  const hasTimer=delay=>[...timers.values()].some(timer=>timer.delay===delay);
  return {ports,tabs,creates,updates,removals,executions,permissionChecks,permissionMutations,command,send,resultFor,runTimers,completeTab,hasTimer,options};
}

async function main(){
  assert.ok(manifest.optional_permissions?.includes("scripting"),"listing injection requires optional scripting permission");
  assert.ok(manifest.optional_host_permissions?.includes("https://shopee.co.th/*"),"listing host access remains optional and narrowly scoped");
  assert.equal(manifest.host_permissions,undefined,"listing support must not add required host permissions");

  const diagnostics=harness();
  const diagInfo=await diagnostics.command("entry_info",{});
  jsonEqual(diagInfo.listing_access,{
    extension_version:manifest.version,extension_id:"fixture-extension",required_origin:"https://shopee.co.th/*",
    scripting_granted:true,host_granted:true,combined_granted:true,
    declared:{scripting:true,host:true},local_enable_flag_required:false,
  },"entry_info reports current listing permission diagnostics without requesting access");
  assert.deepEqual(diagnostics.permissionMutations,[]);
  assert.equal(diagnostics.permissionChecks.length,3,"diagnostics check each grant and the combined grant");

  for(const [label,scriptingGranted,hostGranted] of [
    ["host-only",false,true],["scripting-only",true,false],["both-denied",false,false],
  ]){
    const partial=harness({scriptingGranted,hostGranted});
    const result=await partial.command("read_listing",{product_url:PRODUCT,open_if_missing:true});
    assert.equal(result.error,"listing_permission_required",`${label} permission state is insufficient`);
    jsonEqual(result.permission_state,{
      extension_version:manifest.version,extension_id:"fixture-extension",required_origin:"https://shopee.co.th/*",
      scripting_granted:scriptingGranted,host_granted:hostGranted,combined_granted:false,
      declared:{scripting:true,host:true},local_enable_flag_required:false,
    },`${label} denial explains which optional grant is missing`);
    assert.equal(partial.creates.length,0);assert.equal(partial.updates.length,0);assert.equal(partial.executions.length,0);
    assert.deepEqual(partial.permissionMutations,[],"permission diagnosis does not request or enumerate permissions");
  }

  const denied=harness({permissionsGranted:false});
  const permissionResult=await denied.command("read_listing",{product_url:PRODUCT,open_if_missing:false});
  assert.equal(permissionResult.error,"listing_permission_required");
  assert.equal(denied.tabs.size,0);assert.equal(denied.creates.length,0);assert.equal(denied.updates.length,0);assert.equal(denied.executions.length,0,"permissions are checked before tab activity or injection");

  const malformed=harness();
  for(const args of [
    {product_url:"https://shopee.co.th/product/123/456?x=1",open_if_missing:false},
    {product_url:PRODUCT,open_if_missing:1},
    {product_url:PRODUCT},
  ]){
    const result=await malformed.command("read_listing",args);
    assert.equal(result.ok,false,"invalid listing input is rejected");
    assert.equal(malformed.tabs.size,0);assert.equal(malformed.creates.length,0);assert.equal(malformed.executions.length,0);
  }

  const absent=harness();
  const absentResult=await absent.command("read_listing",{product_url:PRODUCT,open_if_missing:false});
  assert.equal(absentResult.error,"product_page_not_open");
  assert.equal(absent.creates.length,0);assert.equal(absent.updates.length,0);assert.equal(absent.executions.length,0);

  const create=harness();
  const created=await create.command("read_listing",{product_url:PRODUCT,open_if_missing:true});
  jsonEqual(created,{...PRODUCT_RESULT,entry:{tab_id:500,entry_url:PRODUCT,created_tab:true,reused_tab:false,owner_tab_changed:false,extension_version:manifest.version},retry_automatically:false});
  jsonEqual(create.creates,[{id:500,url:PRODUCT,active:false}]);
  assert.equal(create.updates.length,0);
  assert.equal(create.executions.length,1);
  jsonEqual(create.executions[0],{target:{tabId:500,frameIds:[0]},files:["listing.js"],world:"ISOLATED"},"only the fixed listing script runs in isolated top frame");

  const repeat=harness({tabs:[{id:30,url:PRODUCT,active:false,status:"complete"}]});
  // First call adopts no pre-existing page; it must create its own tracked page.
  const first=await repeat.command("read_listing",{product_url:PRODUCT,open_if_missing:true});
  assert.equal(first.kind,"public_product_detail");
  const second=await repeat.command("read_listing",{product_url:PRODUCT,open_if_missing:true});
  assert.equal(second.kind,"public_product_detail");
  assert.equal(repeat.creates.length,1,"the extension-owned listing is reused by exact URL");
  assert.equal(repeat.updates.length,0,"same-URL requests never navigate");
  assert.equal(repeat.executions.length,2);

  const cleanupRace=harness();
  assert.equal((await cleanupRace.command("read_listing",{product_url:PRODUCT,open_if_missing:true})).ok,true);
  let releaseGet;cleanupRace.options.deferGet=new Promise(resolve=>{releaseGet=resolve;});
  const cleanup=cleanupRace.runTimers(800);
  await new Promise(resolve=>setImmediate(resolve));
  const nextId=cleanupRace.send("read_listing",{product_url:OTHER,open_if_missing:true});
  releaseGet();await cleanup;
  const raceResult=await cleanupRace.resultFor(nextId);
  assert.equal(raceResult.ok,true,`an old cleanup timer cannot close a tab claimed by the next read: ${JSON.stringify(raceResult)}`);
  assert.equal(cleanupRace.removals.length,0);

  const owner=harness({tabs:[{id:31,url:PRODUCT,active:false,status:"complete"}]});
  assert.equal((await owner.command("read_listing",{product_url:PRODUCT,open_if_missing:false})).error,"product_page_not_open");
  assert.equal(owner.creates.length,0);assert.equal(owner.executions.length,0,"an owner-created matching tab is never adopted");

  const cross=harness();
  await cross.command("read_listing",{product_url:PRODUCT,open_if_missing:true});
  const noNavigate=await cross.command("read_listing",{product_url:OTHER,open_if_missing:false});
  assert.equal(noNavigate.error,"product_page_not_open");assert.equal(cross.updates.length,0);
  const switched=await cross.command("read_listing",{product_url:OTHER,open_if_missing:true});
  jsonEqual(switched,{...PRODUCT_RESULT,source_url:OTHER,product_id:"789",entry:{tab_id:500,entry_url:OTHER,created_tab:false,reused_tab:true,owner_tab_changed:false,extension_version:manifest.version},retry_automatically:false});
  assert.equal(cross.creates.length,1);assert.equal(cross.updates.length,1);

  const claimed=harness();
  await claimed.command("read_listing",{product_url:PRODUCT,open_if_missing:true});
  claimed.tabs.set(500,{id:500,url:PRODUCT,active:true,status:"complete"});
  const claimedResult=await claimed.command("read_listing",{product_url:OTHER,open_if_missing:true});
  assert.equal(claimedResult.ok,true,"an active tool tab is preserved as user-claimed while automation continues in a new tab");
  assert.equal(claimed.creates.length,2);assert.equal(claimed.updates.length,0);assert.equal(claimed.tabs.get(500).url,PRODUCT);

  const settles=harness();
  await settles.command("read_listing",{product_url:PRODUCT,open_if_missing:true});
  await new Promise(resolve=>setImmediate(resolve));
  settles.tabs.get(500).status="loading";
  const settlingId=settles.send("read_listing",{product_url:PRODUCT,open_if_missing:true});
  for(let i=0;i<20 && !settles.hasTimer(30000);i++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(settles.hasTimer(30000),true,"the second listing read waits for the tracked tab");
  settles.completeTab(500);
  const settledResult=await settles.resultFor(settlingId);
  assert.equal(settledResult.ok,true,`a tracked inactive listing may finish loading before the next read: ${JSON.stringify(settledResult)}`);

  for(const tab of [
    {id:41,url:PRODUCT,active:false,status:"loading"},
    {id:42,url:OTHER,active:false,status:"complete"},
  ]){
    const blocked=harness();
    await blocked.command("read_listing",{product_url:PRODUCT,open_if_missing:true});
    await new Promise(resolve=>setImmediate(resolve));
    blocked.tabs.set(500,{...tab,id:500});
    const pending=blocked.send("read_listing",{product_url:OTHER,open_if_missing:true});
    if(tab.status==="loading"){
      for(let i=0;i<20 && !blocked.hasTimer(30000);i++)await new Promise(resolve=>setImmediate(resolve));
      await blocked.runTimers(30000);
    }
    const result=await blocked.resultFor(pending);
    assert.ok(["product_page_not_open","listing_tab_not_idle","listing_context_changed"].includes(result.error),`${tab.status==="loading"?"loading":"user-changed"} tab is not reusable`);
    assert.equal(blocked.updates.length,0);assert.equal(blocked.creates.length,1);
  }

  const unknown=harness({scriptFails:true});
  const failed=await unknown.command("read_listing",{product_url:PRODUCT,open_if_missing:true});
  assert.equal(failed.error,"listing_unconfirmed");assert.equal(failed.retry_automatically,false);
  const failedRetry=await unknown.command("read_listing",{product_url:PRODUCT,open_if_missing:true});
  assert.equal(failedRetry.error,"listing_unconfirmed");assert.equal(unknown.creates.length,1,"unknown create/injection is never automatically replayed");
  assert.equal(unknown.executions.length,1);

  const createUnknown=harness({createFails:true});
  assert.equal((await createUnknown.command("read_listing",{product_url:PRODUCT,open_if_missing:true})).error,"listing_unconfirmed");
  assert.equal((await createUnknown.command("read_listing",{product_url:PRODUCT,open_if_missing:true})).error,"listing_unconfirmed");
  assert.equal(createUnknown.creates.length,1,"an unknown create is not replayed");assert.equal(createUnknown.executions.length,0);

  const updateUnknown=harness();
  await updateUnknown.command("read_listing",{product_url:PRODUCT,open_if_missing:true});
  updateUnknown.options.updateFails=true;
  assert.equal((await updateUnknown.command("read_listing",{product_url:OTHER,open_if_missing:true})).error,"listing_unconfirmed");
  assert.equal((await updateUnknown.command("read_listing",{product_url:OTHER,open_if_missing:true})).error,"listing_unconfirmed");
  assert.equal(updateUnknown.updates.length,1,"an unknown update is not replayed");assert.equal(updateUnknown.executions.length,1);

  for(const mode of ["cancel","disconnect"]){
    const prevented=harness();
    const id=prevented.send("read_listing",{product_url:PRODUCT,open_if_missing:true});
    if(mode==="cancel")prevented.ports[0].onMessage.fire({type:"cancel",id,page_id:"extension"});
    else prevented.ports[0].onDisconnect.fire();
    if(mode==="cancel")assert.equal((await prevented.resultFor(id,"cancelled listing")).error,"cancelled");
    else await new Promise(resolve=>setImmediate(resolve));
    assert.equal(prevented.creates.length,0,`${mode} before action prevents tab creation`);
    assert.equal(prevented.updates.length,0);assert.equal(prevented.executions.length,0);
  }

  let markScriptStarted,releaseScript;
  const scriptStarted=new Promise(resolve=>{markScriptStarted=resolve;});
  const scriptGate=new Promise(resolve=>{releaseScript=resolve;});
  const concurrent=harness({scriptStarted:markScriptStarted,scriptGate});
  const pendingId=concurrent.send("read_listing",{product_url:PRODUCT,open_if_missing:true});
  await scriptStarted;
  const busy=await concurrent.command("read_listing",{product_url:OTHER,open_if_missing:true});
  assert.equal(busy.error,"listing_busy");assert.equal(concurrent.creates.length,1);assert.equal(concurrent.updates.length,0);
  releaseScript();
  assert.equal((await concurrent.resultFor(pendingId)).kind,"public_product_detail");

  console.log(JSON.stringify({ok:true,checks:[
    "optional permissions are required before tab activity",
    "canonical URL and strict open_if_missing validation",
    "absent page handling, inactive creation, exact reuse, and owner-tab isolation",
    "cross-URL navigation guard and active/loading/user-changed tab rejection",
    "fixed isolated listing.js top-frame injection and unconfirmed outcome without replay",
  ]}));
}

main().catch(error=>{console.error(error);process.exitCode=1;});
