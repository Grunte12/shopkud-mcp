"use strict";
const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require('playwright');
const fixture=require('./detail-fixture.cjs');
const url='https://affiliate.shopee.co.th/offer/product_offer/123';
const modal=`<div role="dialog"><div class="ant-modal-title">รายละเอียดข้อเสนอ</div><button aria-label="Close">Close</button>
${['ค่าคอมจากร้านค้า (ค่าคอมพิเศษ)','ค่าคอมช้อปปี้ - ลูกค้าปัจจุบัน','ค่าคอมช้อปปี้ - ลูกค้าใหม่'].map((title,i)=>`<div class="comm-table-title">${title}</div><table><thead><tr><th>ประเภทช่องทาง</th><th>รูปแบบการให้เครดิตคำสั่งซื้อ</th><th>อัตราค่าคอมมิชชัน</th></tr></thead><tbody>${i?'<tr><td>โซเชียลมีเดีย</td><td rowspan="3">คำสั่งซื้อในร้านค้าเดียวกัน</td><td>2%</td></tr><tr><td>ช้อปปี้วีดีโอ</td><td>0%</td></tr><tr><td>ช้อปปี้ไลฟ์</td><td>0%</td></tr>':'<tr><td>ช่องทางทั้งหมด</td><td>คำสั่งซื้อในร้านค้าเดียวกัน</td><td>5%</td></tr>'}</tbody></table><ul class="comm-tip"><li>${i?'0.6% คอมมิชชันสำหรับการแชร์ลงโซเชียลมีเดีย และคำสั่งซื้อในร้านค้าต่างๆ':'ไม่มีค่าคอมมิชชั่นจากคำสั่งซื้อในร้านค้าอื่น'}</li></ul>`).join('')}</div>`;
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();await page.route('https://**/*',r=>r.abort());
  await page.setContent(fixture());
  for(const f of ['core.js','detail.js'])await page.addScriptTag({path:path.join(__dirname,'../extension',f)});
  const result=await page.evaluate(async({url,modal})=>{
   document.querySelector('[role="dialog"]').remove();
   const D=window.ShopKudDetail,C=window.ShopeePickerCore;
   const run=()=>D.withTerms(document,url,C,()=>true,D.read(document,url,C));
   const absent=await run();
   let clicks=0,closed=0;
   const button=document.createElement('button');button.textContent='ดูรายละเอียด';document.querySelector('main').append(button);
   button.onclick=()=>{clicks++;setTimeout(()=>{document.body.insertAdjacentHTML('beforeend',modal);document.querySelector('[aria-label="Close"]').onclick=()=>{closed++;document.querySelector('[role="dialog"]').remove();};},10);};
   const read=await run();
   document.body.insertAdjacentHTML('beforeend',modal);
   const existing=await run();
   const preserved=!!document.querySelector('[role="dialog"]');
   document.querySelector('[role="dialog"] tbody tr td:last-child').textContent='5%-10%';
   const range=D.readTerms(document,url,C);
   document.body.insertAdjacentHTML('beforeend',modal);
   const duplicate=D.readTerms(document,url,C);
   document.querySelectorAll('[role="dialog"]').forEach(n=>n.remove());
   document.body.insertAdjacentHTML('beforeend','<div role="dialog">Other</div>');
   const blocked=await run();
   const cancelled=await D.withTerms(document,url,C,()=>false,D.read(document,url,C));
   return {absent,read,existing,preserved,range,duplicate,blocked,cancelled,clicks,closed};
  },{url,modal});
  assert.equal(result.absent.offer_terms.status,'opener_unavailable');
  assert.equal(result.read.offer_terms.status,'observed');
  assert.equal(result.read.offer_terms.sections.length,3);
  assert.deepEqual(result.read.offer_terms.sections[1].rows.map(r=>r.commission_pct),[2,0,0]);
  assert.ok(result.read.offer_terms.sections[1].rows.every(r=>r.credit_rule==='คำสั่งซื้อในร้านค้าเดียวกัน'));
  assert.match(result.read.offer_terms.sections[1].notes[0],/0.6%/);
  assert.equal(result.read.channels[0].total_pct,12,'modal must not overwrite offer table');
  assert.equal(result.read.attribution_duration_days,null,'scope is not duration');
  assert.equal(result.clicks,1);assert.equal(result.closed,1);assert.equal(result.preserved,true);
  assert.equal(result.range.sections[0].rows[0].commission_pct,null);
  assert.equal(result.duplicate.status,'ambiguous');
  assert.equal(result.blocked.offer_terms.status,'other_dialog_open');
  assert.equal(result.cancelled.offer_terms.status,'page_changed');
  console.log('PASS offer terms: 3 sections, rowspan, notes, zero/range rates, one read-only open, owned close, existing/other dialogs, cancellation, no rate/duration inference');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
