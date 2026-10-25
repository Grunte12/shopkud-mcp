"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname,"../extension/background.js"),"utf8");
function event(){const listeners=[];return{addListener(fn){listeners.push(fn);},removeListener(fn){const i=listeners.indexOf(fn);if(i>=0)listeners.splice(i,1);},fire(...args){for(const fn of [...listeners])fn(...args);}};}
async function run(){
  const runtimeMessage=event(),ports=[],saved={};
  const chrome={
    runtime:{id:"extension-id",lastError:null,getManifest:()=>({version:"0.11.0"}),onMessage:runtimeMessage,
      connectNative(){const port={messages:[],onDisconnect:event(),onMessage:event(),postMessage(value){this.messages.push(value);}};ports.push(port);return port;},
      sendMessage(_message,callback){callback?.();}},
    storage:{session:{async get(key){return{[key]:saved[key]};},async set(value){Object.assign(saved,value);}}},
    tabs:{onRemoved:event(),onUpdated:event(),query:async()=>[],sendMessage(_tab,_message,callback){callback?.({});},get(_tab,callback){callback(null);}},
  };
  vm.runInContext(source,vm.createContext({chrome,URL,Map,Set,Promise,Object,Array,Number,String,RegExp,Date,setTimeout,clearTimeout}),{filename:"background.js"});
  ports[0].onMessage.fire({type:"hello-ack"});
  const base={schema_version:1,trace_id:"a".repeat(16),swarm_id:"b".repeat(16),sequence:1,playbook:"rank_affiliate_products",query:"ทีวี",stage:"queued",status:"running",occurred_at_unix_ms:Date.now(),elapsed_ms:1};
  ports[0].onMessage.fire({type:"command",id:"c".repeat(32),page_id:"extension",operation:"playbook_event",arguments:base});
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(ports[0].messages.at(-1).result.ok,true);
  let snapshot;
  runtimeMessage.fire({type:"shopkud-live-snapshot"},{id:"extension-id"},value=>{snapshot=value;});
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(snapshot.connected,true);
  assert.equal(snapshot.extension_version,"0.11.0");
  assert.equal(snapshot.runs.length,1);
  assert.equal(snapshot.runs[0].invocation_number,1);
  assert.equal(snapshot.runs[0].stage,"queued");
  ports[0].onMessage.fire({type:"command",id:"e".repeat(32),page_id:"extension",operation:"developer_event",arguments:{schema_version:1,event_id:"f".repeat(16),trace_id:"a".repeat(16),actor:"agent",source:"mcp.client",operation:"rank_affiliate_products",phase:"started",status:"ok",message:"Agent called an MCP tool",detail:'{"query":"ทีวี"}',media:["https://down-th.img.susercontent.com/file/result.jpg","https://evil.example/private.jpg"],progress_pct:0,occurred_at_unix_ms:Date.now(),elapsed_ms:0}});
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(ports[0].messages.at(-1).result.ok,true);
  runtimeMessage.fire({type:"shopkud-live-snapshot"},{id:"extension-id"},value=>{snapshot=value;});
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(snapshot.developer_logs.length,1);
  assert.equal(snapshot.developer_logs[0].actor,"agent");
  assert.equal(snapshot.developer_logs[0].operation,"rank_affiliate_products");
  assert.deepEqual(snapshot.developer_logs[0].media,["https://down-th.img.susercontent.com/file/result.jpg"]);
  const report={schema_version:1,report_id:"9".repeat(16),query:"ทีวี",status:"completed",stage:"recommendation",
    headline:"คนกำลังหา Smart TV ราคาเข้าถึงง่าย",summary:"สัญญาณภายนอกชี้ว่าความคุ้มและความน่าเชื่อถือสำคัญกว่าขนาดจอเพียงอย่างเดียว",
    purchase_intent:"ผู้ซื้อเปรียบเทียบราคา ประกัน และรีวิวก่อนตัดสินใจ",confidence:"medium",updated_at_unix_ms:Date.now(),
    signals:[{kind:"purchase_intent",label:"Purchase intent",value:"สูง",score:78,rationale:"มีคำถามเรื่องราคาและประกันซ้ำ",source_indexes:[0]}],
    citations:[{title:"โพสต์สาธารณะบน X",url:"https://x.com/example/status/1"},{title:"บทวิเคราะห์ตลาด",url:"https://example.com/tv-market"}]};
  ports[0].onMessage.fire({type:"command",id:"8".repeat(32),page_id:"extension",operation:"research_report",arguments:report});
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(ports[0].messages.at(-1).result.ok,true);
  runtimeMessage.fire({type:"shopkud-live-snapshot"},{id:"extension-id"},value=>{snapshot=value;});
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(snapshot.research_reports.length,1);
  assert.equal(snapshot.research_reports[0].signals[0].score,78);
  assert.equal(snapshot.research_reports[0].citations[1].url,"https://example.com/tv-market");
  const dashboard={schema_version:1,query:"ทีวี",channel:"shopee_video",freshness:"live",cache_hit:false,cache_age_ms:0,partial_market_coverage:false,
    criteria:{ranking_goal:"balanced",mall_only:true,min_sold:500},winner_product_id:"26570814201",observed_at:"2026-10-25T12:00:00Z",
    scan:{pages_scanned:3,unique_products:42,reached_end:true},exclusions:{not_mall:5},relaxation_suggestions:[],results:[
      {product_id:"26570814201",name:"Philips NA331 Air Fryer",offer_url:"https://affiliate.shopee.co.th/offer/product_offer/26570814201",image_url:"https://down-th.img.susercontent.com/file/result.jpg",mall:true,channel:"shopee_video",price_min_thb:3899,sold:1200,commission_pct:6.5,commission_thb_per_order:236.02,trust_basis:["mall"]},
      {product_id:"2",name:"Unsafe image is dropped",offer_url:"https://affiliate.shopee.co.th/offer/product_offer/2",image_url:"https://evil.example/private.jpg",mall:false,channel:"shopee_video",price_min_thb:100,sold:2,commission_pct:10,commission_thb_per_order:10,trust_basis:[]},
    ]};
  ports[0].onMessage.fire({type:"command",id:"d".repeat(32),page_id:"extension",operation:"playbook_event",arguments:{...base,sequence:2,stage:"completed",status:"completed",elapsed_ms:12,success:true,effective:true,response_tokens_estimate:42,latency_ms:{total:12},browser_operations:{scan:1},dashboard}});
  await new Promise(resolve=>setTimeout(resolve,0));
  runtimeMessage.fire({type:"shopkud-live-snapshot"},{id:"extension-id"},value=>{snapshot=value;});
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(snapshot.runs[0].status,"completed");
  assert.equal(snapshot.runs[0].response_tokens_estimate,42);
  assert.equal(snapshot.runs[0].dashboard.results.length,2);
  assert.equal(snapshot.runs[0].dashboard.results[0].image_url,"https://down-th.img.susercontent.com/file/result.jpg");
  assert.equal(snapshot.runs[0].dashboard.results[1].image_url,null);
  assert.equal(snapshot.runs[0].dashboard.criteria.ranking_goal,"balanced");
  console.log(JSON.stringify({ok:true,checks:["native telemetry is validated and stored","safe developer events stream line-by-line","agent research reports require bounded cited evidence","extension snapshot exposes connection, research, and run state"]}));
}
run().catch(error=>{console.error(error);process.exitCode=1;});
