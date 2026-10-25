"use strict";
// Bounded UI evidence only: synthetic plans, no extension/network/personal profile.
const {chromium}=require("playwright");
const fs=require("node:fs/promises"),path=require("node:path"),assert=require("node:assert/strict");
const ROOT=path.resolve(__dirname,".."),OUT=path.resolve(process.env.SHOPKUD_TEST_OUTPUT_DIR||path.join(ROOT,"artifacts/tests"));
async function run(){
  await fs.mkdir(OUT,{recursive:true});
  const browser=await chromium.launch({headless:true,...(process.env.SHOPEE_TEST_CHROMIUM?{executablePath:process.env.SHOPEE_TEST_CHROMIUM}:{})});
  const results=[],errors=[];
  try {
    const page=await browser.newPage({viewport:{width:1280,height:900}});
    page.on("pageerror",e=>errors.push(e.message));await page.route('**/*',route=>route.abort());
    await page.clock.install();
    await page.setContent('<!doctype html><html lang="th"><body style="margin:24px;font:16px system-ui;background:#f1f3f5"><h1>ชุดทดสอบหน้าตา ShopKud</h1><p>สินค้าเป็นข้อมูลตัวอย่าง ไม่ใช้บัญชีจริงและไม่ดำเนินการกับสินค้า</p><div id="shopkud-panel"></div></body></html>');
    await page.addScriptTag({path:path.join(ROOT,'extension/review.js')});
    await page.evaluate(()=>{window.applies=0;window.exports=[];window.kept=[];window.ui=ShopKudReview.create({root:document.querySelector('#shopkud-panel').attachShadow({mode:'open'}),onApply:()=>window.applies++,onKeep:ids=>{window.kept=ids;return true;},onExport:format=>window.exports.push(format)});});
    const panel=page.locator('#shopkud-panel');
    await panel.getByRole('button',{name:'ดูแผนคัดสินค้า',exact:true}).click();
    assert.equal(await panel.getByText('ให้เอเจนต์ค้นคว้าสินค้าและเตรียมแผนพร้อมเหตุผลก่อน ไม่มีการเลือกสินค้าให้อัตโนมัติ',{exact:true}).isVisible(),true);
    assert.equal(await panel.getByRole('button',{name:'เลือกสินค้าตามแผน',exact:true}).isEnabled(),false);results.push('empty review teaches next action; no empty Apply');
    await page.evaluate(()=>{window.plan={created:Date.now(),records:Array.from({length:20},(_,i)=>({name:i===0?'ฮับ USB-C — สินค้าตัวอย่าง':'สินค้าตัวอย่าง '+i,product_id:String(i),price_min_thb:100,commission_pct:7})),picks:Array.from({length:20},(_,i)=>({reason:i===0?'สาธิตการจัดโต๊ะทำงานได้ แต่ยังต้องตรวจแบรนด์และรุ่นสินค้าจริง':'เหตุผลตัวอย่างสำหรับทดสอบ',content_angle:'เริ่มจากปัญหาพอร์ตไม่พอ แล้วให้ดูโต๊ะที่เชื่อมต่ออุปกรณ์แล้ว เป็นฉากตัวอย่าง ไม่ใช่การรับรองสินค้า',risks:['ยังไม่รู้ว่าใช้งานกับอุปกรณ์รุ่นใดได้บ้าง','ค่าคอมมิชชันที่แสดงไม่ใช่รายได้คาดการณ์'],confidence:'medium',evidence:[{url:'https://example.test/fixture',title:'แหล่งข้อมูลตัวอย่าง ยังไม่ได้ตรวจสินค้าจริง'}]}))};ui.setConnected(true);ui.status.textContent='เชื่อมต่อกับชุดทดสอบ ข้อมูลทั้งหมดเป็นตัวอย่าง';ui.showPlan(window.plan);});
    await panel.locator('summary').first().click();
    assert.equal(await panel.getByRole('button',{name:'เลือกสินค้าตามแผน',exact:true}).isEnabled(),true);
    assert.equal(await panel.locator('section').getAttribute('lang'),'th');
    assert.equal(await panel.getByText('ปานกลาง',{exact:true}).count(),20);
    assert.equal(await page.evaluate(()=>{const r=document.querySelector('#shopkud-panel').shadowRoot;return /[a-z]/i.test([...r.querySelectorAll('#status,.toolbar,.intro,#outcome')].map(x=>x.textContent).join(' '));}),false);results.push('Thai-only controls/copy and confidence labels; semantic language declared');
    assert.equal(await panel.locator('details').count(),20);results.push('twenty candidates render progressively; facts and reasoning separated');
    await page.evaluate(()=>document.querySelector('#shopkud-panel').shadowRoot.querySelector('.primary').click());assert.equal(await page.evaluate(()=>window.applies),0);
    await page.evaluate(()=>document.querySelector('#shopkud-panel').shadowRoot.querySelector('.keep input').click());assert.equal(await panel.getByRole('checkbox').first().isChecked(),true);results.push('untrusted page-script clicks cannot apply or change human decisions');
    await panel.getByRole('checkbox').first().uncheck();assert.equal((await page.evaluate(()=>window.kept)).length,19);assert.equal(await page.evaluate(()=>window.applies),0);results.push('draft checkbox updates decision without triggering Apply');
    await panel.getByRole('checkbox').first().check();
    for(const input of await panel.getByRole('checkbox').all())await input.uncheck();assert.equal(await panel.getByRole('button',{name:'เลือกสินค้าตามแผน',exact:true}).isEnabled(),false);results.push('empty subset disables Apply');
    for(const input of await panel.getByRole('checkbox').all())await input.check();
    await panel.getByRole('button',{name:'บันทึกชุดข้อมูล',exact:true}).click();await panel.getByRole('button',{name:'บันทึกสรุปไทย',exact:true}).click();assert.deepEqual(await page.evaluate(()=>window.exports),['json','markdown']);assert.equal(await page.evaluate(()=>window.applies),0);results.push('export controls call only the explicit chosen format, never Apply');
    const geometries=[];
    await page.evaluate(()=>{document.querySelector('#shopkud-panel').shadowRoot.querySelector('.entries').scrollTop=0;});
    for(const viewport of [{width:1280,height:900},{width:390,height:844}]){
      await page.setViewportSize(viewport);
      const geometry=await page.evaluate(()=>{const r=document.querySelector('#shopkud-panel').shadowRoot,box=r.querySelector('section').getBoundingClientRect(),entries=r.querySelector('.entries');return {width:innerWidth,height:innerHeight,left:box.left,right:box.right,top:box.top,bottom:box.bottom,entry_scroll:entries.scrollHeight>entries.clientHeight};});
      assert.ok(geometry.left>=0 && geometry.right<=viewport.width && geometry.top>=0 && geometry.bottom<=viewport.height,JSON.stringify(geometry));
      assert.equal(geometry.entry_scroll,true);geometries.push(geometry);
      await page.screenshot({path:path.join(OUT,viewport.width===1280?'review-desktop.png':'review-mobile.png')});
    }
    results.push('desktop/mobile geometry bounded; long candidate list scrolls');
    await panel.getByRole('button',{name:'ดูแผนคัดสินค้า (20)',exact:true}).focus();
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(()=>document.querySelector('#shopkud-panel').shadowRoot.activeElement.textContent),'เชื่อมต่อ');results.push('keyboard reaches shadow-root controls');
    await page.evaluate(()=>ui.setConnected(false));assert.equal(await panel.getByRole('button',{name:'เลือกสินค้าตามแผน',exact:true}).isEnabled(),false);
    await page.screenshot({path:path.join(OUT,'review-disconnected.png')});
    await page.evaluate(()=>ui.setConnected(true));await panel.getByRole('button',{name:'เลือกสินค้าตามแผน',exact:true}).click();assert.equal(await page.evaluate(()=>window.applies),1);
    await page.evaluate(()=>ui.setBusy(true));assert.equal(await panel.getByRole('button',{name:'กำลังเลือกสินค้า…',exact:true}).isEnabled(),false);assert.equal(await panel.getByRole('button',{name:'เชื่อมต่อ'}).isEnabled(),false);results.push('disconnected/busy states prevent local apply or reconnect');
    assert.equal(await panel.getByRole('checkbox').first().isEnabled(),false);assert.equal(await panel.getByRole('button',{name:'บันทึกชุดข้อมูล'}).isEnabled(),false);results.push('running plan locks draft editing and export');
    await page.evaluate(()=>{ui.setBusy(false);ui.finished({outcome:'partial',applied:['0'],already_selected:['1'],uncertain:['2'],changed:['3'],not_attempted:['4']});});
    for(const [id,label] of [['0','เลือกสำเร็จ'],['1','เลือกอยู่ก่อน'],['2','ไม่แน่ชัด ห้ามทำซ้ำ'],['3','ข้อมูลเปลี่ยน'],['4','ยังไม่ได้ลองเลือก']]){
      const text=await panel.locator(`article[data-product-id="${id}"] .execution`).innerText();assert.ok(text.includes(label));assert.ok(text.includes('ไม่ใช่สถานะการติ๊กปัจจุบัน'));
    }
    results.push('per-item historical outcomes distinguish success, prior picks, uncertainty and unattempted items');
    await page.setViewportSize({width:1280,height:900});
    await page.evaluate(()=>{const r=document.querySelector('#shopkud-panel').shadowRoot;for(const d of r.querySelectorAll('details'))d.open=false;r.querySelector('.entries').scrollTop=0;});
    await page.screenshot({path:path.join(OUT,'review-partial.png')});
    await panel.locator('article[data-product-id="4"]').scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(OUT,'review-partial-remaining.png')});
    await page.evaluate(()=>document.querySelector('#shopkud-panel').shadowRoot.querySelector('.entries').scrollTop=0);
    await page.evaluate(()=>{ui.setBusy(false);ui.finished({outcome:'unconfirmed',applied:[],uncertain:['0']});});
    assert.equal(await panel.getByRole('button',{name:'เลือกสินค้าตามแผน',exact:true}).isEnabled(),false);assert.ok((await panel.locator('#outcome').innerText()).includes('ไม่แน่ชัด 1'));results.push('unknown outcome disables replay and exposes uncertainty');
    await page.screenshot({path:path.join(OUT,'review-manual-unknown.png')});
    await page.evaluate(()=>{ui.showPlan(window.plan);ui.finished({error:'page_operation_unconfirmed',outcome:'unconfirmed'});});
    assert.equal(await panel.getByRole('button',{name:'เลือกสินค้าตามแผน',exact:true}).isEnabled(),false);
    assert.ok((await panel.locator('#outcome').innerText()).includes('บางสินค้าอาจถูกเลือกแล้ว'));assert.ok(!(await panel.locator('#outcome').innerText()).includes('ยังไม่ได้เลือกสินค้าจากคำสั่งนี้'));results.push('exception outcome never falsely claims zero selection changes');
    assert.ok(!(await panel.locator('#outcome').innerText()).includes('page_operation_unconfirmed'));results.push('internal error codes never leak into Thai user explanations');
    assert.ok((await panel.locator('article .execution').first().innerText()).includes('ไม่ทราบผล ห้ามทำซ้ำ'));
    await page.screenshot({path:path.join(OUT,'review-agent-unknown.png')});
    await page.evaluate(()=>{ui.showPlan(window.plan);ui.finished({error:'snapshot_stale',outcome:'not_applied'});});
    assert.ok((await panel.locator('#outcome').innerText()).includes('ยังไม่ได้เลือกสินค้าจากคำสั่งนี้'));results.push('confirmed pre-action rejection is distinct from uncertain execution');
    await page.evaluate(()=>ui.showPlan(window.plan));await page.clock.fastForward(600001);
    assert.equal(await panel.getByRole('button',{name:'เลือกสินค้าตามแผน',exact:true}).isEnabled(),false);assert.ok((await panel.locator('#outcome').innerText()).includes('หมดอายุ'));results.push('expiry disables Apply without polling or action replay');
    await page.evaluate(()=>{ui.showPlan(window.plan);ui.invalidate('ข้อมูลสินค้าเปลี่ยนไป ให้เตรียมแผนใหม่');});assert.equal(await panel.getByRole('button',{name:'เลือกสินค้าตามแผน',exact:true}).isEnabled(),false);results.push('invalidation disables stale review plan');
    await page.evaluate(()=>ui.reset());assert.equal(await panel.locator('details').count(),0);assert.equal(await panel.getByRole('button',{name:'เลือกสินค้าตามแผน',exact:true}).isEnabled(),false);results.push('route/reset clears review entries and timer state');
    await page.evaluate(()=>ui.setPageMode('detail'));
    assert.equal(await panel.getByRole('button',{name:'ดูแผนคัดสินค้า',exact:true}).count(),0);
    assert.equal(await panel.locator('#detail-help').isVisible(),true);
    assert.equal(await panel.getByRole('button',{name:'เลือกสินค้าตามแผน',exact:true}).count(),0);
    for(const width of [1280,390]){await page.setViewportSize({width,height:844});const box=await panel.locator('section').boundingBox();assert.ok(box.x>=0 && box.x+box.width<=width+1);}
    await page.evaluate(()=>ui.setPageMode('list'));
    assert.equal(await panel.locator('#detail-help').isVisible(),false);
    assert.equal(await panel.getByRole('button',{name:'ดูแผนคัดสินค้า',exact:true}).count(),1);results.push('detail mode explains explicit history saves, hides list-only actions and stays bounded on desktop/mobile');
    assert.deepEqual(errors,[]);await fs.writeFile(path.join(OUT,'review-evals.json'),JSON.stringify({results,geometries,page_errors:errors,real_network:0,real_model_calls:0},null,2));
    for(const item of results)console.log('PASS '+item);
  } finally {await browser.close();}
}
run().catch(error=>{console.error(error.stack || error.message);process.exitCode=1;});
