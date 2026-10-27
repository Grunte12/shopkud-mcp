"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");
const source=fs.readFileSync(path.join(__dirname,"../extension/listing-access.js"),"utf8");
async function run(initial){
  const nodes=new Map();let saved=initial,fail=false;
  const document={getElementById(id){if(!nodes.has(id))nodes.set(id,{checked:true,disabled:true,textContent:"",handlers:{},addEventListener(type,fn){this.handlers[type]=fn;}});return nodes.get(id);}};
  const chrome={permissions:{contains:async()=>true},runtime:{getManifest:()=>({version:"test"})},storage:{local:{get:async()=>({shopkudListingForeground:saved}),set:async value=>{if(fail)throw Error("write failed");saved=value.shopkudListingForeground;}}}};
  vm.runInNewContext(source,{document,chrome});await new Promise(resolve=>setImmediate(resolve));
  const field=nodes.get("foreground");assert.equal(field.checked,initial!==false);assert.equal(field.disabled,false);
  field.checked=false;await field.handlers.change({isTrusted:true});assert.equal(saved,false);
  field.checked=true;await field.handlers.change({isTrusted:false});assert.equal(saved,false,"untrusted events cannot change preferences");
  fail=true;await field.handlers.change({isTrusted:true});assert.equal(field.checked,false);assert.equal(field.disabled,false);
  assert.match(nodes.get("foreground-status").textContent,/บันทึกไม่สำเร็จ/);
}
Promise.all([run(undefined),run(false),run(true)]).then(()=>console.log("PASS foreground settings: default, persisted preference, trusted interaction and save failure")).catch(error=>{console.error(error);process.exitCode=1;});
