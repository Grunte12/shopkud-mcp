"use strict";

// Offline lifecycle test for the full-page Dashboard and extension-owned work tabs.
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const source=fs.readFileSync(path.join(__dirname,"../extension/background.js"),"utf8");
function event(){const listeners=[];return{addListener(fn){listeners.push(fn);},removeListener(fn){const i=listeners.indexOf(fn);if(i>=0)listeners.splice(i,1);},fire(...args){for(const fn of [...listeners])fn(...args);}};}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

async function main(){
  const actionClicked=event(),tabsActivated=event(),tabsRemoved=event(),tabsUpdated=event();
  const tabs=new Map(),creates=[],updates=[],removes=[],groups=[],groupUpdates=[],saved={};
  let nextId=1,nextGroup=40;
  const chrome={
    runtime:{id:"shopkud-fixture",lastError:null,getURL:path=>`chrome-extension://shopkud-fixture/${path}`,
      getManifest:()=>({version:"0.11.0",optional_permissions:[],optional_host_permissions:[]}),onMessage:event(),
      connectNative(){return{onDisconnect:event(),onMessage:event(),postMessage(){}};},sendMessage(_message,callback){callback?.();}},
    storage:{session:{async get(key){return{[key]:saved[key]};},async set(value){Object.assign(saved,value);},async remove(key){delete saved[key];}}},
    sidePanel:{async setPanelBehavior(){},async open(){}},action:{onClicked:actionClicked},windows:{async update(){}},
    tabGroups:{async update(id,info){groupUpdates.push({id,info});return{id,...info};}},
    tabs:{onActivated:tabsActivated,onRemoved:tabsRemoved,onUpdated:tabsUpdated,
      async query(){return[...tabs.values()];},
      get(id,callback){callback(tabs.get(id)||null);},
      async create(info){const tab={id:nextId++,windowId:info.windowId??8,url:info.url,active:Boolean(info.active),status:"complete",groupId:-1};tabs.set(tab.id,tab);creates.push({...tab});return{...tab};},
      async update(id,info){const tab=tabs.get(id);Object.assign(tab,info);updates.push({id,info});return{...tab};},
      async remove(id){if(!tabs.has(id))throw new Error("missing tab");tabs.delete(id);removes.push(id);tabsRemoved.fire(id);},
      async group(info){const ids=Array.isArray(info.tabIds)?info.tabIds:[info.tabIds];const groupId=Number.isInteger(info.groupId)?info.groupId:nextGroup++;
        for(const id of ids){const tab=tabs.get(id);if(tab)tab.groupId=groupId;}groups.push({groupId,ids});return groupId;},
      sendMessage(_id,_message,callback){callback?.({state:"idle"});},
    },
  };
  const context=vm.createContext({chrome,URL,Map,Set,Promise,Object,Array,Number,String,RegExp,Date,setTimeout,clearTimeout});
  vm.runInContext(source,context,{filename:"background.js"});

  actionClicked.fire({windowId:8});await tick();await tick();
  assert.equal(creates.length,1,"action opens exactly one Dashboard");
  assert.equal(creates[0].url,"chrome-extension://shopkud-fixture/dashboard.html");
  assert.equal(creates[0].active,true);
  assert.equal(groupUpdates.at(-1).info.title,"ShopKud");
  assert.equal(groupUpdates.at(-1).info.color,"orange");

  actionClicked.fire({windowId:8});await tick();await tick();
  assert.equal(creates.length,1,"second action focuses the existing Dashboard");
  assert.equal(saved.shopkudDashboardTabId,1,"Dashboard identity persists for worker restarts");

  tabs.set(2,{id:2,windowId:8,url:"https://affiliate.shopee.co.th/offer/product_offer/22",active:false,status:"complete",groupId:-1});
  context.__owned=["https://affiliate.shopee.co.th/offer/product_offer/22",2];
  vm.runInContext("ownedEntries.set(__owned[0],__owned[1])",context);
  await vm.runInContext("groupShopKudTab(2)",context);
  assert.equal(tabs.get(2).groupId,tabs.get(1).groupId,"work tab joins the Dashboard group");
  tabsActivated.fire({tabId:2});await tick();
  assert.ok(tabs.has(2),"a user-activated work tab is never auto-closed");
  assert.equal(vm.runInContext("[...ownedEntries.values()].includes(2)",context),false,"claimed tab leaves automatic ownership");

  tabs.set(3,{id:3,windowId:8,url:"https://affiliate.shopee.co.th/offer/product_offer/33",active:false,status:"complete",groupId:tabs.get(1).groupId});
  context.__owned=["https://affiliate.shopee.co.th/offer/product_offer/33",3];
  vm.runInContext("ownedEntries.set(__owned[0],__owned[1])",context);
  await vm.runInContext("cleanupAutomationTabs()",context);
  assert.deepEqual(removes,[3],"idle unclaimed automation tab closes after work");
  assert.ok(tabs.has(1),"Dashboard remains open");
  assert.ok(tabs.has(2),"claimed evidence remains open for human review");
  tabs.delete(2);tabsRemoved.fire(2);
  assert.equal(vm.runInContext("claimedEntries.has(2)",context),false,"a manually closed claimed tab leaves no stale lifecycle state");

  console.log(JSON.stringify({ok:true,checks:["one Dashboard is reused","ShopKud tabs share one Chrome group","idle automation tabs close","human-claimed and Dashboard tabs remain"]}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
