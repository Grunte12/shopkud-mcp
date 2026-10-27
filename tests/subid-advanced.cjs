"use strict";
const assert=require("node:assert/strict");
const path=require("node:path");
const {chromium}=require("playwright");
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.SHOPKUD_TEST_CHROMIUM || chromium.executablePath()});
 try{
  const page=await browser.newPage();
  await page.setContent('<div role="dialog"><h4>ลิงก์ข้อเสนอสินค้า</h4><label><input type="radio" name="mode" checked>มาตรฐาน</label><label><input id="advanced" type="radio" name="mode">ขั้นกว่า</label><div id="fields"></div><button id="create">คัดลอกลิงก์</button></div>');
  await page.evaluate(()=>{window.createClicks=0;document.querySelector('#create').onclick=()=>window.createClicks++;document.querySelector('#advanced').onchange=()=>{document.querySelector('#fields').innerHTML=Array.from({length:5},(_,i)=>`<label for="getLinkModal_sub_id${i+1}">Sub_id ${i+1}</label><input id="getLinkModal_sub_id${i+1}">`).join('');};});
  await page.addScriptTag({path:path.resolve(__dirname,'../extension/subid.js')});
  const result=await page.evaluate(()=>window.ShopKudSubId.createLinkWithSubIds(document,['ig','philips',null,null,'202610'],{dry_run:true,expected_product_id:'123'}));
  assert.equal(result.ok,true);assert.equal(result.clicked,false);
  assert.deepEqual(await page.locator('#fields input').evaluateAll(nodes=>nodes.map(n=>n.value)),['ig','philips','','','202610']);
  assert.equal(await page.evaluate(()=>window.createClicks),0);
  await page.evaluate(()=>{
   const dialog=document.querySelector('[role=dialog]');
   const generate=document.createElement('button');generate.textContent='เพิ่มการเชื่อมโยง';generate.id='generate';
   generate.onclick=()=>{window.generateClicks=(window.generateClicks||0)+1;const output=document.createElement('textarea');output.value='https://s.shopee.co.th/FixtureOnly';dialog.append(output);};
   dialog.append(generate);
   dialog.append(generate.cloneNode(true));
  });
  const duplicate=await page.evaluate(()=>ShopKudSubId.createLinkWithSubIds(document,['ig'],{expected_product_id:'123'}));
  assert.equal(duplicate.error,'multiple_create_buttons');assert.equal(duplicate.clicked,false);
  await page.locator('#generate').last().evaluate(el=>el.remove());
  const created=await page.evaluate(()=>ShopKudSubId.createLinkWithSubIds(document,['ig'],{expected_product_id:'123'}));
  assert.equal(created.ok,true);
  assert.equal(await page.evaluate(()=>window.generateClicks),1);
  assert.equal(await page.evaluate(()=>window.createClicks),0,'copy is not generation');
  await page.evaluate(()=>{
   document.querySelector('#generate').onclick=()=>{window.generateClicks++;setTimeout(()=>document.querySelector('textarea').value='https://s.shopee.co.th/FreshFixture',150);};
   const field=document.querySelector('#getLinkModal_sub_id1');
   const native=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');
   window.controlledValue=field.value;
   Object.defineProperty(field,'value',{get(){return native.get.call(this);},set(value){window.controlledValue=value;native.set.call(this,value);},configurable:true});
   field.addEventListener('input',()=>{if(field.value!==window.controlledValue)window.controlledValue=field.value;});
  });
  const fresh=await page.evaluate(()=>ShopKudSubId.createLinkWithSubIds(document,['fb'],{expected_product_id:'123',intent_key:'delayed'}));
  assert.equal(fresh.affiliate_url,'https://s.shopee.co.th/FreshFixture');
  assert.equal(await page.evaluate(()=>window.controlledValue),'fb');
  assert.deepEqual(await page.locator('#fields input').evaluateAll(nodes=>nodes.map(n=>n.value)),['fb','','','','']);
  await page.evaluate(()=>document.querySelector('#generate').onclick=()=>window.generateClicks++);
  const stale=await page.evaluate(()=>ShopKudSubId.createLinkWithSubIds(document,['tt'],{expected_product_id:'123',intent_key:'stale',output_timeout:100}));
  assert.equal(stale.ok,false);assert.equal(stale.status,'unconfirmed');assert.equal(stale.clicked,true);
  const clicks=await page.evaluate(()=>window.generateClicks);
  const retry=await page.evaluate(()=>ShopKudSubId.createLinkWithSubIds(document,['tt'],{expected_product_id:'123',intent_key:'stale',output_timeout:100}));
  assert.equal(retry.clicked,false);assert.equal(await page.evaluate(()=>window.generateClicks),clicks);
  console.log('PASS advanced mode dry-run expands unique radio, fills numbered slots, no link click');
  console.log('PASS synthetic creation uses exact unique Thai generate button, not copy; duplicates block');
  console.log('PASS delayed output rejects baseline; stale output stays unconfirmed and cannot replay; omitted slots clear');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
