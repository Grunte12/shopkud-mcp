"use strict";
// Real HTTP MCP -> Unix broker -> actual native host -> actual MV3 extension.
// Only fixture page HTML; no user profile, Shopee network, model or credits.
const {chromium}=require("playwright");
const fs=require("node:fs/promises");
const path=require("node:path");
const assert=require("node:assert/strict");
const crypto=require("node:crypto");
const {spawn}=require("node:child_process");
const net=require("node:net");
const detailFixture=require("./detail-fixture.cjs");
const ROOT=path.resolve(__dirname,"..");
const OUT=path.resolve(ROOT,"../outputs/shopkud-qa");
const PAGE="https://affiliate.shopee.co.th/offer/product_offer";
const PYTHON=process.env.SHOPKUD_TEST_PYTHON;
if(!PYTHON)throw new Error("Set SHOPKUD_TEST_PYTHON to Python with MCP SDK1.30/uvicorn installed");
function fixture() {
  return `<!doctype html><html><body><h1>ShopKud offline fixture</h1><p id="count">1</p>${["101","102","103"].map((id,i)=>`<article id="p${id}" class="AffiliateItemCard"><div class="ItemCard__container"><a target="_blank" href="/offer/product_offer/${id}">Product</a><div class="ItemCard__name">Fixture ${id}</div><div class="ItemCard__price"><div class="ItemCardPrice__wrap"><span class="price">${100+i*100}</span></div></div><div class="ItemCard__custom"><span class="commRate">10%</span></div><div class="ItemCardSold__wrap"><span>ขายได้ 100 ชิ้น</span></div></div><div class="AffiliateItemCard__gelinkSection"><label class="ant-checkbox-wrapper${i===0?" ant-checkbox-wrapper-checked":""}"><span class="ant-checkbox${i===0?" ant-checkbox-checked":""}"><input type="checkbox" class="ant-checkbox-input" ${i===0?"checked":""}></span></label></div></article>`).join("")}<script>for(const input of document.querySelectorAll('input'))input.onclick=event=>{event.preventDefault();const label=input.closest('label');const yes=!label.classList.contains('ant-checkbox-wrapper-checked');label.classList.toggle('ant-checkbox-wrapper-checked',yes);label.querySelector('span').classList.toggle('ant-checkbox-checked',yes);document.getElementById('count').textContent=document.querySelectorAll('.ant-checkbox-wrapper-checked').length;};</script></body></html>`;
}
function paginationFixture({stall=false,challenge=false,noTotal=false}={}) {
  let html=`<!doctype html><html><body><h1>Scoped pagination fixture</h1><p id="count">0</p><p id="nav-clicks">0</p>${challenge?'<div id="captcha">Synthetic challenge</div>':''}<div id="cards"></div><ul class="ant-pagination"><li class="ant-pagination-prev"><button>Prev</button></li>${[1,2,3].map(n=>`<li class="ant-pagination-item" title="${n}"><a>${n}</a></li>`).join("")}<li class="ant-pagination-next"><button>Next</button></li></ul><script>
  const sets=[['201','202'],['202','203'],['204','205']];let current=1,clicks=0;
  function cards(){document.getElementById('cards').innerHTML=sets[current-1].map(id=>'<article class="AffiliateItemCard"><div class="ItemCard__container"><a target="_blank" href="/offer/product_offer/'+id+'">Product</a><div class="ItemCard__name">Pagination '+id+'</div><div class="ItemCard__price"><div class="ItemCardPrice__wrap"><span class="price">'+(+id*10)+'</span></div></div><div class="ItemCard__custom"><span class="commRate">10%</span></div></div><div class="AffiliateItemCard__gelinkSection"><label class="ant-checkbox-wrapper"><span class="ant-checkbox"><input type="checkbox" class="ant-checkbox-input"></span></label></div></article>').join('');for(const input of document.querySelectorAll('input'))input.onclick=e=>{e.preventDefault();const label=input.closest('label'),yes=!label.classList.contains('ant-checkbox-wrapper-checked');label.classList.toggle('ant-checkbox-wrapper-checked',yes);label.querySelector('span').classList.toggle('ant-checkbox-checked',yes);document.getElementById('count').textContent=document.querySelectorAll('.ant-checkbox-wrapper-checked').length;};}
  function render(){for(const li of document.querySelectorAll('.ant-pagination-item'))li.classList.toggle('ant-pagination-item-active',+li.title===current);document.querySelector('.ant-pagination-prev').classList.toggle('ant-pagination-disabled',current===1);document.querySelector('.ant-pagination-next').classList.toggle('ant-pagination-disabled',current===3);}
  function go(n){if(n<1||n>3||n===current)return;clicks++;document.getElementById('nav-clicks').textContent=clicks;current=n;history.pushState({},'','/offer/product_offer?page='+n+'&fixture='+new URLSearchParams(location.search).get('fixture'));render();if(!${stall})cards();}
  for(const li of document.querySelectorAll('.ant-pagination-item'))li.onclick=()=>go(+li.title);
  document.querySelector('.ant-pagination-prev').onclick=()=>go(current-1);document.querySelector('.ant-pagination-next').onclick=()=>go(current+1);render();cards();
  </script></body></html>`;
  if(noTotal) {
    // Replay the observed Shopee span/class contract, not a guessed Ant wrapper.
    for(const [before,after] of [["ant-pagination-item-active","active"],["ant-pagination-disabled","disabled"],["ant-pagination-item","page-page"],["ant-pagination-prev","page-prev"],["ant-pagination-next","page-next"],["ant-pagination","PaginationNoTotal__wrap"]])html=html.replaceAll(before,after);
    html=html.replaceAll('<ul class="PaginationNoTotal__wrap">','<div class="PaginationNoTotal__wrap">').replaceAll('</ul>','</div>').replaceAll('<li class="','<span class="page-item ').replaceAll('</li>','</span>').replace(/ title="\d+"/g,'').replace(/<a>(\d+)<\/a>/g,'$1').replace('<button>Prev</button>','&nbsp;&nbsp;').replace('<button>Next</button>','&nbsp;&nbsp;').replaceAll('+li.title','+li.textContent.trim()');
  }
  return html;
}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function freePort(){return new Promise((resolve,reject)=>{const server=net.createServer();server.on('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});}
async function run(){
  const root=await fs.realpath(await fs.mkdtemp("/private/tmp/shopkud-qa-"));
  let context,server;
  let stderr="";
  let phase="setup";
  const results=[];
  const fixtureRouteHits=[];
  const efficiency=[];
  const errors=[];
  const latencies=[];
  try{
    await fs.chmod(root,0o700);
    const profile=path.join(root,"profile");await fs.mkdir(profile,{mode:0o700});
    const nativeDir=path.join(profile,"NativeMessagingHosts");await fs.mkdir(nativeDir,{mode:0o700});
    const token=crypto.randomBytes(32).toString("hex");const port=await freePort();
    context=await chromium.launchPersistentContext(profile,{channel:"chromium",headless:true,viewport:{width:1200,height:900},
      ...(process.env.SHOPEE_TEST_CHROMIUM?{executablePath:process.env.SHOPEE_TEST_CHROMIUM}:{}),
      args:[`--disable-extensions-except=${path.join(ROOT,"extension")}`,`--load-extension=${path.join(ROOT,"extension")}`,"--disable-background-networking","--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1"]});
    context.on("page",p=>p.on("pageerror",e=>errors.push(e.message)));
    const worker=context.serviceWorkers()[0]||await context.waitForEvent("serviceworker");
    const origin=`chrome-extension://${new URL(worker.url()).hostname}/`;
    const config=path.join(root,"config.json");await fs.writeFile(config,JSON.stringify({token,port,socket_path:path.join(root,"native.sock"),allowed_origins:[origin],workspace_enabled:true}),{mode:0o600});
    const launcher=path.join(root,"native-launcher");
    assert.ok(![PYTHON,ROOT,config].some(x=>/["\n]/.test(x)),"fixture paths must be safe for fixed launcher");
    await fs.writeFile(launcher,`#!/bin/sh\nexec "${PYTHON}" "${ROOT}/shopkud_mcp/native_host.py" --config "${config}" "$@"\n`,{mode:0o700});
    await fs.writeFile(path.join(nativeDir,"org.shopkud.mcp.json"),JSON.stringify({name:"org.shopkud.mcp",description:"Isolated ShopKud fixture",path:launcher,type:"stdio",allowed_origins:[origin]}),{mode:0o600});
    server=spawn(PYTHON,["-m","shopkud_mcp.server","serve","--config",config],{env:{...process.env,PYTHONPATH:ROOT},stdio:["ignore","ignore","pipe"]});
    server.stderr.on("data",data=>{stderr+=data.toString();});
    for(let i=0;i<100;i++){if(server.exitCode!==null)throw new Error("test server exited");try{await fs.stat(path.join(root,"native.sock"));break;}catch{}await pause(50);}
    const endpoint=`http://127.0.0.1:${port}/mcp`;
    for(let i=0;i<100;i++){try{const res=await fetch(endpoint);if(res.status===401)break;}catch{}await pause(50);}
    let sequence=0;
    async function rpc(method,params={}){
      const response=await fetch(endpoint,{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json",Accept:"application/json, text/event-stream","MCP-Protocol-Version":"2025-11-25"},body:JSON.stringify({jsonrpc:"2.0",id:++sequence,method,params})});
      assert.equal(response.status,200,`MCP ${method} must succeed`);const body=await response.json();assert.ok(!body.error,JSON.stringify(body.error));return body.result;
    }
    async function tool(name,args={}){const start=performance.now();const r=await rpc("tools/call",{name,arguments:args});latencies.push({tool:name,milliseconds:Math.round((performance.now()-start)*100)/100});assert.equal(r.isError,false,JSON.stringify(r));return r.structuredContent||JSON.parse(r.content[0].text);}
    phase="MCP initialize/auth/schema";
    await rpc("initialize",{protocolVersion:"2025-11-25",capabilities:{},clientInfo:{name:"offline-shopkud-test",version:"1"}});
    assert.equal((await fetch(endpoint)).status,401);
    assert.equal((await fetch(endpoint,{headers:{Authorization:`Bearer ${token}`,Origin:"https://evil.example"}})).status,401);
    const expectedTools=[
      "apply_selection","batch_create_links","check_commission_health","check_post_compliance","check_posting_budget",
      "clear_picker_selections","convert_links_in_text","create_link","create_video_draft","enroll_mission",
      "explain_cancellations","export","export_data","export_products","find_campaign_links","find_link",
      "get_conversions","get_earnings_summary","get_offer","get_pagination","get_price_history","get_product_detail",
      "get_product_history","get_product_media","get_products","get_review_plan","get_scan_products","get_selections",
      "get_video_level","get_workflow_guide","get_workspace","go_to_page","import_report_csv","list_missions",
      "list_pages","list_video_clips","posting_budget","prepare_cart_swap","prepare_selection","present_research_report","record_earnings_observation",
      "rank_affiliate_products","record_offer_observation","record_video_level_observation","reload_extension","sales_by","save_workspace","scan_products","search_offers",
      "search_products_for_content","selector_health","set_campaign_link","set_posting_cap","suggest_replacement","track_video_clip",
      "update_commission_health","update_mission_progress","verify_link",
    ];
    const catalog=await rpc("tools/list");assert.deepEqual(catalog.tools.map(t=>t.name).sort(),expectedTools.sort());
    results.push({name:phase,status:"pass"});
    await context.route("**/*",route=>{const u=new URL(route.request().url());if(u.origin==="https://affiliate.shopee.co.th")fixtureRouteHits.push({url:u.href,path:u.pathname});return u.origin==="https://affiliate.shopee.co.th" && (u.pathname==="/" || /^\/offer\/product_offer(?:\/(?:123)?)?$/.test(u.pathname))?route.fulfill({contentType:"text/html; charset=utf-8",body:u.pathname.endsWith('/123')?detailFixture():fixture()}):route.abort();});
    const page=await context.newPage();await page.goto(PAGE);
    await page.waitForFunction(()=>document.querySelector('#shopkud-panel')?.shadowRoot?.getElementById('status')?.textContent.includes('เชื่อมต่อแล้ว'));
    const list=await tool("list_pages");assert.equal(list.pages.length,1);const page_id=list.pages[0].page_id;
    phase="list_pages recovers a lost roster without replaying product actions";
    await worker.evaluate(()=>{pages.clear();roster();});
    await pause(100); // Let the deliberate empty roster reach the broker before the single recovery call.
    const recovered=await tool("list_pages");
    assert.deepEqual(recovered.pages.map(p=>p.page_id),[page_id]);
    assert.equal(recovered.state,"ready");
    assert.equal(await page.locator('#count').textContent(),"1");results.push({name:phase,status:"pass"});
    phase="on-demand real MCP snapshot/export/selections";
    const snap=await tool("get_products",{page_id,limit:3,offset:0});assert.equal(snap.ok,true);assert.deepEqual(snap.records.map(r=>r.product_id),["101","102","103"]);
    assert.deepEqual((await tool("export_products",{page_id,snapshot_id:snap.snapshot_id})).records,snap.records);
    assert.equal((await tool("get_selections",{page_id})).selections.filter(x=>x.selected).length,1);results.push({name:phase,status:"pass"});
    phase="image-only Thai extra commission badge; unrelated asset and text fallback";
    await page.evaluate(()=>{
      for(const [id,src] of [['101','https://deo.shopeemobile.com/shopee/shopee-affiliate-live-th/static/img/label_xtra_inner_th.75b00d08.svg'],['102','https://example.test/shopee/shopee-affiliate-live-th/static/img/label_xtra_inner_th.75b00d08.svg']]){
        const image=document.createElement('img');image.className='ItemCard__label';image.src=src;document.querySelector('#p'+id+' .ItemCard__container').append(image);
      }
      const text=document.createElement('span');text.id='extra-text';text.textContent='EXTRA COMM';document.querySelector('#p103 .ItemCard__container').append(text);
    });
    const badged=await tool('get_products',{page_id,limit:3,offset:0});assert.deepEqual(badged.records.map(r=>r.extra_comm),[true,false,true]);assert.equal(await page.locator('#count').textContent(),'1');
    await page.evaluate(()=>{for(const image of document.querySelectorAll('img.ItemCard__label'))image.remove();document.querySelector('#extra-text').remove();});
    results.push({name:phase,status:'pass'});
    const pick=id=>({product_id:id,reason:"เหมาะกับแนวทางตัวอย่างเท่านั้น ยังไม่ได้ค้นคว้าสินค้าจริง",content_angle:"ฉากตัวอย่างสำหรับการทดสอบ ไม่ใช่คำแนะนำผลิตภัณฑ์",risks:["เป็นข้อมูลทดสอบเท่านั้น"],confidence:"low",evidence:[{url:"https://example.test/fixture",title:"แหล่งข้อมูลตัวอย่างสำหรับทดสอบ"}]});
    phase="analysis plan validation / no immediate selection";
    for(const bad of [{...pick('102'),evidence:[]},{...pick('102'),confidence:0.9},{...pick('102'),extra:'unsupported'}]){
      const invalid=await rpc('tools/call',{name:'prepare_selection',arguments:{page_id,snapshot_id:snap.snapshot_id,picks:[bad]}});assert.equal(invalid.isError,true);assert.equal(await page.locator('#count').textContent(),'1');
    }
    const plan=await tool("prepare_selection",{page_id,snapshot_id:snap.snapshot_id,picks:[pick("102")]});assert.equal(plan.ok,true);assert.equal(await page.locator('#count').textContent(),"1");results.push({name:phase,status:"pass"});
    phase="explicit once-only apply / preserve owner pick";
    const applied=await tool("apply_selection",{page_id,plan_id:plan.plan_id});assert.equal(applied.ok,true);assert.deepEqual(applied.applied,["102"]);assert.equal(await page.locator('#count').textContent(),"2");
    const replay=await tool("apply_selection",{page_id,plan_id:plan.plan_id});assert.equal(replay.error,"plan_already_consumed");assert.equal(await page.locator('#count').textContent(),"2");results.push({name:phase,status:"pass"});
    phase="stale and unknown product rejected before selection";
    const unknown=await tool("prepare_selection",{page_id,snapshot_id:snap.snapshot_id,picks:[pick("999")]});assert.equal(unknown.error,"product_not_in_snapshot");
    const stalePlan=await tool("prepare_selection",{page_id,snapshot_id:snap.snapshot_id,picks:[pick("103")]});assert.equal(stalePlan.ok,true);
    await page.evaluate(()=>document.querySelector('#p103 .price').textContent='999');
    const stale=await tool("apply_selection",{page_id,plan_id:stalePlan.plan_id});assert.equal(stale.error,"snapshot_stale");assert.equal(await page.locator('#count').textContent(),"2");results.push({name:phase,status:"pass"});
    phase="clear only ShopKud-owned selections";
    const cleared=await tool("clear_picker_selections",{page_id});assert.deepEqual(cleared.cleared,["102"]);assert.equal(await page.locator('#count').textContent(),"1");results.push({name:phase,status:"pass"});
    phase="review UI distinguishes observed facts and agent evidence without clicking products";
    const reviewPlan=await tool("prepare_selection",{page_id,snapshot_id:snap.snapshot_id,picks:[{...pick("102"),reason:'<img src=x onerror="alert(1)"> เหตุผลตัวอย่างสำหรับทดสอบ',risks:[]}]});
    assert.equal(reviewPlan.ok,true);
    const panel=page.locator('#shopkud-panel');
    assert.equal(await panel.locator('#review').isVisible(),false);
    await panel.getByRole('button',{name:'ดูแผนคัดสินค้า (1)',exact:true}).click();
    await panel.locator('summary').click();
    assert.equal(await panel.getByText('เหตุผลที่เอเจนต์เสนอ',{exact:true}).isVisible(),true);
    assert.equal(await panel.getByText('ฉากคอนเทนต์ที่ทำได้',{exact:true}).isVisible(),true);
    assert.equal(await panel.getByText('เอเจนต์ไม่ได้ระบุความเสี่ยง ไม่ได้หมายความว่าไม่มีความเสี่ยง',{exact:true}).isVisible(),true);
    assert.equal(await panel.locator('img').count(),0);assert.equal(await panel.getByText('<img src=x onerror="alert(1)"> เหตุผลตัวอย่างสำหรับทดสอบ',{exact:true}).isVisible(),true);
    assert.equal(await panel.getByRole('link',{name:'แหล่งข้อมูลตัวอย่างสำหรับทดสอบ'}).getAttribute('rel'),'noopener noreferrer');
    assert.equal(await page.locator('#count').textContent(),"1");results.push({name:phase,status:"pass"});
    phase="human Apply uses the same once-only plan and preserves owner picks";
    await panel.getByRole('button',{name:'เลือกสินค้าตามแผน',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#shopkud-panel').shadowRoot.getElementById('outcome').textContent.startsWith('เสร็จแล้ว:'));
    assert.equal(await page.locator('#count').textContent(),"2");
    assert.equal(await panel.getByRole('button',{name:'เลือกสินค้าตามแผน',exact:true}).isEnabled(),false);
    assert.equal((await tool("apply_selection",{page_id,plan_id:reviewPlan.plan_id})).error,"plan_already_consumed");
    assert.deepEqual((await tool("clear_picker_selections",{page_id})).cleared,["102"]);assert.equal(await page.locator('#count').textContent(),"1");
    await panel.getByRole('button',{name:'ดูแผนคัดสินค้า (1)',exact:true}).click();results.push({name:phase,status:"pass"});
    phase='human subset changes are read through MCP without product clicks';
    const subsetSnap=await tool('get_products',{page_id,limit:3,offset:0});
    const subsetPlan=await tool('prepare_selection',{page_id,snapshot_id:subsetSnap.snapshot_id,picks:[pick('102'),pick('103')]});
    await panel.getByRole('button',{name:'ดูแผนคัดสินค้า (2)',exact:true}).click();
    await panel.getByRole('checkbox',{name:'เก็บไว้ในแผน: Fixture 103',exact:true}).uncheck();
    let review=await tool('get_review_plan',{page_id,plan_id:subsetPlan.plan_id});
    assert.equal(review.view,'brief');assert.deepEqual(review.decision.kept_product_ids,['102']);assert.deepEqual(review.decision.excluded_product_ids,['103']);assert.equal(review.decision.source,'human');assert.equal(review.execution,null);assert.equal(await page.locator('#count').textContent(),'1');results.push({name:phase,status:'pass'});
    phase='empty subset rejects Apply without consuming the plan or clicking';
    await panel.getByRole('checkbox',{name:'เก็บไว้ในแผน: Fixture 102',exact:true}).uncheck();
    assert.equal(await panel.getByRole('button',{name:'เลือกสินค้าตามแผน',exact:true}).isEnabled(),false);
    assert.equal((await tool('apply_selection',{page_id,plan_id:subsetPlan.plan_id})).error,'empty_selection');
    assert.equal((await tool('get_review_plan',{page_id,plan_id:subsetPlan.plan_id})).plan_state,'ready');assert.equal(await page.locator('#count').textContent(),'1');results.push({name:phase,status:'pass'});
    phase='only kept IDs apply once; excluded changed data does not become a click target';
    await panel.getByRole('checkbox',{name:'เก็บไว้ในแผน: Fixture 102',exact:true}).check();
    await page.evaluate(()=>document.querySelector('#p103 .price').textContent='1000');
    assert.equal((await tool('apply_selection',{page_id,plan_id:subsetPlan.plan_id})).error,'review_confirmation_required');
    assert.equal((await tool('apply_selection',{page_id,plan_id:subsetPlan.plan_id,expected_decision_version:1})).error,'review_decision_changed');assert.equal(await page.locator('#count').textContent(),'1');
    review=await tool('get_review_plan',{page_id,plan_id:subsetPlan.plan_id});
    const subsetApplied=await tool('apply_selection',{page_id,plan_id:subsetPlan.plan_id,expected_decision_version:review.decision.version});assert.deepEqual(subsetApplied.applied,['102']);assert.equal(await page.locator('#count').textContent(),'2');
    review=await tool('get_review_plan',{page_id,plan_id:subsetPlan.plan_id,view:'full',limit:20,offset:0});assert.equal(review.plan_state,'consumed');assert.deepEqual(review.execution.applied,['102']);assert.equal(review.records[1].observation.price_min_thb,999);assert.equal(review.execution_is_historical,true);assert.equal(review.authorization_is_not_transferred,true);
    assert.equal((await tool('apply_selection',{page_id,plan_id:subsetPlan.plan_id})).error,'plan_already_consumed');results.push({name:phase,status:'pass'});
    phase='human handoff downloads are explicit and preserve draft versus historical result';
    const jsonDownload=page.waitForEvent('download');await panel.getByRole('button',{name:'บันทึกชุดข้อมูล',exact:true}).click();
    const jsonFile=await (await jsonDownload).path(),packet=JSON.parse(await fs.readFile(jsonFile,'utf8'));assert.deepEqual(packet.decision.kept_product_ids,['102']);assert.deepEqual(packet.execution.applied,['102']);assert.equal(packet.total,2);assert.equal(packet.records.length,2);
    const mdDownload=page.waitForEvent('download');await panel.getByRole('button',{name:'บันทึกสรุปไทย',exact:true}).click();const mdFile=await (await mdDownload).path(),md=await fs.readFile(mdFile,'utf8');assert.ok(md.includes('ไม่ให้สิทธิ์เจนสื่อ'));assert.ok(md.includes('ไม่ใช่สถานะการติ๊กบนหน้าเว็บในปัจจุบัน'));assert.equal(await page.locator('#count').textContent(),'2');
    await tool('clear_picker_selections',{page_id});assert.equal(await page.locator('#count').textContent(),'1');await page.evaluate(()=>document.querySelector('#p103 .price').textContent='999');await panel.getByRole('button',{name:'ดูแผนคัดสินค้า (2)',exact:true}).click();results.push({name:phase,status:'pass'});
    phase='saved research persists original observations and human decisions, never Apply authority';
    const saved=await tool('save_workspace',{name:'ชุดวิจัยตัวอย่าง',brief:{audience:'ไทย',characters:['ตัวอย่าง'],workflow_status:'research'},page_id,source_type:'review',source_id:subsetPlan.plan_id});assert.equal(saved.ok,true);const workspace_id=saved.workspace_id;
    let persisted=await tool('get_workspace',{workspace_id,view:'products',product_ids:['102','103'],limit:20});assert.equal(persisted.ok,true);assert.equal(persisted.selection_snapshot,false);assert.equal(persisted.reusable_apply_authority,false);assert.equal(persisted.records.length,2);assert.equal(await page.locator('#count').textContent(),'1');results.push({name:phase,status:'pass'});
    phase='on-demand rate history retains initial and changed observations, not paid commission';
    const history=await tool('get_workspace',{view:'history',product_ids:['102'],limit:20});assert.equal(history.ok,true);assert.ok(history.history.length>=1);assert.equal(history.selection_snapshot,false);results.push({name:phase,status:'pass'});
    phase='channel-specific provided links reject collisions without visiting a link';
    const linkArgs={workspace_id,marketplace:'shopee',product_id:'102',channel:'TikTok',content_id:'clip01',affiliate_url:'https://s.shopee.co.th/fixtureTikTok',sub_id:'tt_clip01'};
    assert.equal((await tool('set_campaign_link',linkArgs)).ok,true);
    assert.equal((await tool('set_campaign_link',{...linkArgs,channel:'Facebook',content_id:'clip02',sub_id:'fb_clip02'})).error,'duplicate_url');
    assert.equal((await tool('set_campaign_link',{...linkArgs,channel:'Facebook',content_id:'clip02',affiliate_url:'https://s.shopee.co.th/fixtureFacebook',sub_id:'fb_clip02'})).ok,true);results.push({name:phase,status:'pass'});
    phase='report preview then digest-bound import groups channels without replay or unknown attribution';
    const reportArgs={workspace_id,csv_text:'รหัส,ค่าคอม,คำสั่งซื้อ\ntt_clip01,10.50,1\nfb_clip02,5,1\nmissing,2,1\n',mapping:{sub_id:'รหัส',commission:'ค่าคอม',orders:'คำสั่งซื้อ'},marketplace:'shopee',period_start:'2026-10-01',period_end:'2026-10-07',amount_state:'estimated'};
    const preview=await tool('import_report_csv',reportArgs);assert.equal(preview.ok,true);assert.equal(preview.committed,false);assert.equal((await tool('get_workspace',{workspace_id,view:'report'})).report,null);
    const imported=await tool('import_report_csv',{...reportArgs,commit:true,expected_digest:preview.digest});assert.equal(imported.ok,true);assert.equal((await tool('import_report_csv',{...reportArgs,commit:true,expected_digest:preview.digest})).duplicate,true);
    const report=await tool('get_workspace',{workspace_id,view:'report'});assert.equal(report.ok,true);assert.equal(report.report.amount_state,'estimated');assert.equal(report.report.unmapped_rows_count,1);assert.equal(report.groups.length,3);assert.equal(await page.locator('#count').textContent(),'1');results.push({name:phase,status:'pass'});
    phase="multiple open tabs / query-filtered offer URL routed explicitly";
    const second=await context.newPage();await second.goto(PAGE+"?page=2&sort=commission");
    await second.waitForFunction(()=>document.querySelector('#shopkud-panel')?.shadowRoot?.getElementById('status')?.textContent.includes('เชื่อมต่อแล้ว'),null,{timeout:10000});
    const both=await tool("list_pages");assert.equal(both.pages.length,2);
    const secondId=both.pages.find(p=>p.page_id!==page_id).page_id;
    const secondSnapshot=await tool("get_products",{page_id:secondId,limit:3,offset:0});
    assert.equal(secondSnapshot.records[2].price_min_thb,300); // First tab was mutated to999.
    assert.equal((await tool("get_products",{page_id,limit:3,offset:0})).records[2].price_min_thb,999);
    await second.close();
    for(let i=0;i<50;i++){if((await tool("list_pages")).pages.length===1)break;await pause(20);}
    assert.equal((await tool("list_pages")).pages.length,1);results.push({name:phase,status:"pass"});
    phase="detail page reads visible product/link and channel-specific commission without clicking";
    const neighbor=await context.newPage();await neighbor.goto(PAGE+"/123");
    await neighbor.waitForFunction(()=>document.querySelector('#shopkud-panel')?.shadowRoot?.getElementById('status')?.textContent.includes('เชื่อมต่อแล้ว'));
    const detailPages=await tool('list_pages'),detailId=detailPages.pages.find(p=>p.url===PAGE+'/123').page_id;
    assert.equal(detailPages.pages.length,2);
    assert.equal(await neighbor.locator('#shopkud-panel').getByRole('button',{name:'ดูแผนคัดสินค้า',exact:true}).count(),0);
    const detail=await tool('get_product_detail',{offer_url:PAGE+'/123'});
    assert.equal(detail.ok,true);assert.equal(detail.product_id,'123');assert.equal(detail.affiliate_url,'https://s.shopee.co.th/Fixture123',JSON.stringify(detail));
    assert.equal(detail.offer_url,PAGE+'/123');
    assert.equal(detail.channels[0].extra_commission.pct,10);assert.equal(detail.channels[0].shopee_commission.pct,2);assert.equal(detail.channels[0].estimated_commission_thb,59.76);
    assert.equal(detail.channels[1].estimated_commission_thb,49.8);
    assert.equal((await tool('get_product_history')).total,0);
    assert.equal((await tool('get_product_detail',{page_id:detailId,save:true})).history_saved,true);
    assert.equal((await tool('get_product_detail',{page_id:detailId,save:true})).history_receipt.new_entry,false);
    assert.equal((await tool('get_product_history',{query:'FixtureSupplement'})).total,1);
    assert.equal((await tool('get_products',{page_id:detailId})).error,'product_list_page_required');
    assert.equal((await tool('go_to_page',{page_id:detailId,page_number:2})).error,'product_list_page_required');
    assert.equal((await tool('clear_picker_selections',{page_id:detailId})).error,'product_list_page_required');
    assert.equal(await neighbor.locator('#click-count').textContent(),'0');results.push({name:phase,status:'pass'});
    phase="detail SPA route changes invalidate the old lease and reject mismatched product DOM";
    await neighbor.evaluate(()=>{history.pushState({},'','/offer/product_offer/124');document.body.append(document.createElement('span'));});
    for(let i=0;i<50;i++){if((await tool('list_pages')).pages.some(p=>p.url===PAGE+'/124'))break;await pause(20);}
    const changedId=(await tool('list_pages')).pages.find(p=>p.url===PAGE+'/124').page_id;
    assert.notEqual(changedId,detailId);assert.equal((await tool('get_product_detail',{page_id:detailId})).ok,false);
    assert.equal((await tool('get_product_detail',{page_id:changedId})).error,'product_detail_unavailable');
    await neighbor.close();results.push({name:phase,status:"pass"});
    phase="explicit detail opening uses one inactive owned tab and preserves the owner tab";
    const ownerUrl=page.url(),ownerCount=await page.locator('#count').textContent();
    const ownerTab=await worker.evaluate(()=>new Promise(resolve=>chrome.tabs.query({active:true,currentWindow:true},tabs=>resolve(tabs[0]?.id))));
    const pagesBeforeOpen=new Set(context.pages()),beforeOpen=pagesBeforeOpen.size,beforeRouteHits=fixtureRouteHits.length;
    let openedTarget=null,ownedEntryEvidence=null;
    let resolveFixtureNavigation,rejectFixtureNavigation;
    const fixtureNavigation=new Promise((resolve,reject)=>{resolveFixtureNavigation=resolve;rejectFixtureNavigation=reject;});
    const fixtureNavigationTimer=setTimeout(()=>rejectFixtureNavigation(new Error('extension-created page target was not attached')),8000);
    const onCreatedPage=target=>{
      if(pagesBeforeOpen.has(target))return;
      openedTarget=target;
      (async()=>{
        // Confirm this target is the extension-owned tab, while allowing its DNS-blocked first request
        // to be either pending at the requested URL or already committed to Chromium's error document.
        ownedEntryEvidence=await worker.evaluate(url=>new Promise(resolve=>{
          const deadline=Date.now()+500;
          const poll=()=>{
            const tabId=ownedEntries.get(url);
            if(Number.isInteger(tabId)){
              chrome.tabs.get(tabId,tab=>resolve({tabId,tab:tab||null}));
            }else if(Date.now()>=deadline)resolve(null);
            else setTimeout(poll,20);
          };
          poll();
        }),PAGE+'/123');
        assert.ok(ownedEntryEvidence?.tabId!==undefined,'extension did not record its owned entry tab');
        assert.ok(ownedEntryEvidence.tab,'owned entry tab is not queryable');
        // tabs.get hides URL/pendingUrl without tabs/host permission. Do not
        // widen permissions for a test; the owned URL key and unique newly
        // attached Page identify this isolated target instead.
        assert.equal(ownedEntryEvidence.tab.active,false);
        // Test-only recovery after Playwright attaches; this verifies the opened owned tab workflow,
        // not that Chrome's initial extension-created navigation passed through the fixture route.
        await target.goto(PAGE+'/123');
        clearTimeout(fixtureNavigationTimer);resolveFixtureNavigation(target);
      })().catch(rejectFixtureNavigation);
    };
    context.once('page',onCreatedPage);
    try{
      const openingDetail=tool('get_product_detail',{offer_url:PAGE+'/123',open_if_missing:true});
      await fixtureNavigation;
      const openedDetail=await openingDetail;
      assert.equal(openedDetail.ok,true,JSON.stringify({result:openedDetail,routeHits:fixtureRouteHits.slice(beforeRouteHits)}));assert.equal(openedDetail.product_id,'123');
      assert.ok(fixtureRouteHits.slice(beforeRouteHits).some(hit=>hit.path==='/offer/product_offer/123'));
      assert.equal(context.pages().length,beforeOpen+1);
      assert.equal(await page.evaluate(()=>location.href),ownerUrl);
      assert.equal(await page.locator('#count').textContent(),ownerCount);
      assert.equal(await worker.evaluate(()=>new Promise(resolve=>chrome.tabs.query({active:true,currentWindow:true},tabs=>resolve(tabs[0]?.id)))),ownerTab);
      const openedPages=await tool('list_pages'),openedEntry=openedPages.pages.filter(p=>p.url===PAGE+'/123');
      assert.equal(openedEntry.length,1);const openedPageId=openedEntry[0].page_id;
      assert.equal(Number(openedPageId.split(':')[0]),ownedEntryEvidence.tabId);
      const entryTab=await worker.evaluate(tabId=>new Promise(resolve=>chrome.tabs.get(tabId,tab=>resolve(tab))),Number(openedPageId.split(':')[0]));
      assert.equal(entryTab.active,false);assert.equal(openedTarget.url(),PAGE+'/123');
      assert.equal(await openedTarget.locator('#click-count').textContent(),'0');
      const reusedDetail=await tool('get_product_detail',{offer_url:PAGE+'/123',open_if_missing:true});
      assert.equal(reusedDetail.ok,true);assert.equal(context.pages().length,beforeOpen+1);
      assert.equal((await tool('list_pages')).pages.filter(p=>p.url===PAGE+'/123')[0].page_id,openedPageId);
    } finally {
      clearTimeout(fixtureNavigationTimer);
      context.off('page',onCreatedPage);
      if(openedTarget && !openedTarget.isClosed())await openedTarget.close();
    }
    for(let i=0;i<50;i++){if((await tool('list_pages')).pages.length===1)break;await pause(20);}
    assert.equal(context.pages().length,beforeOpen);
    assert.equal((await tool('list_pages')).pages.length,1);
    results.push({name:phase,status:"pass"});
    phase="new tab dynamic routing / old page lease invalidated";
    await page.reload();await page.waitForFunction(()=>document.querySelector('#shopkud-panel')?.shadowRoot?.getElementById('status')?.textContent.includes('เชื่อมต่อแล้ว'));
    const newList=await tool("list_pages");assert.equal(newList.pages.length,1);assert.notEqual(newList.pages[0].page_id,page_id);
    assert.equal((await tool("get_products",{page_id,limit:3,offset:0})).ok,false);results.push({name:phase,status:"pass"});
    phase="card replaced during click stays unconfirmed / no replay";
    const freshId=newList.pages[0].page_id;
    const fresh=await tool("get_products",{page_id:freshId,limit:3,offset:0});
    const uncertainPlan=await tool("prepare_selection",{page_id:freshId,snapshot_id:fresh.snapshot_id,picks:[pick("102")]});
    await page.evaluate(()=>{const input=document.querySelector('#p102 input');input.addEventListener('click',()=>document.querySelector('#p102').remove());});
    const uncertain=await tool("apply_selection",{page_id:freshId,plan_id:uncertainPlan.plan_id});
    assert.equal(uncertain.ok,false);assert.deepEqual(uncertain.uncertain,["102"]);assert.equal(uncertain.outcome,"unconfirmed");
    assert.equal((await tool("apply_selection",{page_id:freshId,plan_id:uncertainPlan.plan_id})).error,"plan_already_consumed");
    assert.ok(!(await tool("get_selections",{page_id:freshId})).selections.some(s=>s.picker_owned));
    results.push({name:phase,status:"pass"});
    phase="SPA home to offer page activates without document reload";
    const spa=await context.newPage();await spa.goto("https://affiliate.shopee.co.th/");
    assert.equal(await spa.locator('#shopkud-panel').count(),0);
    await spa.evaluate(()=>{history.pushState({},"","/offer/product_offer?page=2");document.querySelector('h1').textContent="SPA offer route";});
    await spa.waitForFunction(()=>document.querySelector('#shopkud-panel')?.shadowRoot?.getElementById('status')?.textContent.includes('เชื่อมต่อแล้ว'),null,{timeout:5000});
    const spaPages=await tool("list_pages");assert.equal(spaPages.pages.length,2);
    const spaId=spaPages.pages.find(p=>p.page_id!==freshId).page_id;
    const spaSnapshot=await tool("get_products",{page_id:spaId,limit:3,offset:0});
    assert.equal(spaSnapshot.records.length,3);results.push({name:phase,status:"pass"});
    phase="site render removing the panel restores one panel without new registration";
    await spa.evaluate(()=>document.querySelector('#shopkud-panel').remove());
    await spa.waitForFunction(()=>document.querySelectorAll('#shopkud-panel').length===1,null,{timeout:5000});
    assert.equal((await tool("list_pages")).pages.find(p=>p.page_id===spaId)?.page_id,spaId);
    results.push({name:phase,status:"pass"});
    phase="SPA leaving/reentering invalidates old page and prepared plans";
    const oldSpaPlan=await tool("prepare_selection",{page_id:spaId,snapshot_id:spaSnapshot.snapshot_id,picks:[pick("102")]});
    await spa.evaluate(()=>{history.pushState({},"","/");document.querySelector('h1').textContent="SPA home route";});
    await spa.waitForFunction(()=>!document.querySelector('#shopkud-panel'),null,{timeout:5000});
    assert.equal((await tool("list_pages")).pages.length,1);
    assert.equal((await tool("get_products",{page_id:spaId,limit:3,offset:0})).ok,false);
    await spa.evaluate(()=>{history.pushState({},"","/offer/product_offer");document.querySelector('h1').textContent="SPA returned";});
    await spa.waitForFunction(()=>document.querySelector('#shopkud-panel')?.shadowRoot?.getElementById('status')?.textContent.includes('เชื่อมต่อแล้ว'),null,{timeout:5000});
    const returnedPages=await tool("list_pages");assert.equal(returnedPages.pages.length,2);
    const returnedId=returnedPages.pages.find(p=>p.page_id!==freshId).page_id;assert.notEqual(returnedId,spaId);
    assert.equal((await tool("apply_selection",{page_id:returnedId,plan_id:oldSpaPlan.plan_id})).error,"plan_expired_or_unknown");
    assert.equal(await spa.locator('#count').textContent(),"1");
    await spa.close();results.push({name:phase,status:"pass"});
    phase="pagination metadata / confirmed scoped navigation";
    const paged=await context.newPage();await paged.route("**/*",route=>route.fulfill({contentType:"text/html",body:paginationFixture()}));await paged.goto(PAGE+"?fixture=pagination");
    await paged.waitForFunction(()=>document.querySelector('#shopkud-panel')?.shadowRoot?.getElementById('status')?.textContent.includes('เชื่อมต่อแล้ว'));
    const pagedId=(await tool("list_pages")).pages.find(p=>p.page_id!==freshId).page_id;
    const meta=await tool("get_pagination",{page_id:pagedId});assert.equal(meta.current_page,1);assert.equal(meta.has_next,true);assert.equal(meta.total_pages,null);
    const navigated=await tool("go_to_page",{page_id:pagedId,page_number:2});assert.equal(navigated.ok,true);assert.equal(navigated.outcome,"completed");
    assert.equal((await tool("go_to_page",{page_id:pagedId,page_number:2})).outcome,"unchanged");
    assert.deepEqual((await tool("get_products",{page_id:pagedId,limit:3,offset:0})).records.map(r=>r.product_id),["202","203"]);results.push({name:phase,status:"pass"});
    phase="one-command all-page scan / dedup / bounded cached read";
    const scan=await tool("scan_products",{page_id:pagedId,start_page:1,max_pages:10,max_products:100});
    assert.equal(scan.ok,true);assert.equal(scan.pages_scanned,3);assert.equal(scan.unique_products,5);assert.equal(scan.duplicates_removed,1);assert.equal(scan.reached_end,true);assert.equal(scan.stop_reason,"end_of_results");assert.ok(!scan.records);
    const chunk=await tool("get_scan_products",{page_id:pagedId,scan_id:scan.scan_id,limit:2,offset:0});assert.equal(chunk.records.length,2);assert.equal(chunk.total,5);assert.equal(chunk.next_offset,2);assert.equal(chunk.records[0].page_ref.page_number,1);assert.equal(chunk.selection_snapshot,false);
    assert.equal((await tool("prepare_selection",{page_id:pagedId,snapshot_id:scan.scan_id,picks:[pick("201")]})).error,"snapshot_expired_or_unknown");
    assert.equal((await tool("get_pagination",{page_id:pagedId})).total_pages,3);results.push({name:phase,status:"pass"});
    phase="cached MCP query returns only matching candidates without navigation";
    const queryClicks=await paged.locator('#nav-clicks').textContent();
    const candidate=await tool("get_scan_products",{page_id:pagedId,scan_id:scan.scan_id,limit:20,offset:0,query:"Pagination 203",view:"brief"});
    assert.equal(candidate.ok,true);assert.equal(candidate.total,1);assert.equal(candidate.unfiltered_total,5);assert.equal(candidate.view,"brief");assert.equal(candidate.records[0].product_id,"203");assert.equal(candidate.records[0].page_ref.page_number,2);assert.equal(candidate.selection_snapshot,false);assert.equal(await paged.locator('#nav-clicks').textContent(),queryClicks);results.push({name:phase,status:"pass"});
    phase="brief cache response is smaller and full detail remains available";
    const brief=await tool("get_scan_products",{page_id:pagedId,scan_id:scan.scan_id,limit:20,offset:0,view:"brief"});
    const full=await tool("get_scan_products",{page_id:pagedId,scan_id:scan.scan_id,limit:20,offset:0});
    assert.ok(JSON.stringify(brief).length<JSON.stringify(full).length);assert.deepEqual(brief.records.map(x=>x.product_id),full.records.map(x=>x.product_id));assert.ok(!('product_url' in brief.records[0]));assert.ok(full.records[0].product_url);assert.equal(await paged.locator('#nav-clicks').textContent(),queryClicks);results.push({name:phase,status:"pass"});
    efficiency.push({lane:"synthetic cached catalog",full_records:full.records.length,query_records:candidate.records.length,full_bytes:Buffer.byteLength(JSON.stringify(full)),brief_bytes:Buffer.byteLength(JSON.stringify(brief)),query_brief_bytes:Buffer.byteLength(JSON.stringify(candidate)),extra_navigation_clicks:0,extra_model_calls:0});
    phase="revisit scanned product / fresh snapshot / apply-clear";
    await tool("go_to_page",{page_id:pagedId,page_number:chunk.records[0].page_ref.page_number});
    const revisit=await tool("get_products",{page_id:pagedId,limit:3,offset:0});const revisitPlan=await tool("prepare_selection",{page_id:pagedId,snapshot_id:revisit.snapshot_id,picks:[pick("201")]});
    assert.equal((await tool("apply_selection",{page_id:pagedId,plan_id:revisitPlan.plan_id})).ok,true);
    const blockedNav=await tool("go_to_page",{page_id:pagedId,page_number:2});assert.equal(blockedNav.error,"navigation_blocked_by_selections");assert.equal(await paged.locator('#count').textContent(),"1");
    assert.equal((await tool("clear_picker_selections",{page_id:pagedId})).ok,true);results.push({name:phase,status:"pass"});
    phase="scan bounds / no false complete claim";
    const bounded=await tool("scan_products",{page_id:pagedId,start_page:1,max_pages:1,max_products:100});assert.equal(bounded.pages_scanned,1);assert.equal(bounded.reached_end,false);assert.equal(bounded.stop_reason,"page_limit");assert.equal(bounded.next_page,2);
    const limited=await tool("scan_products",{page_id:pagedId,start_page:1,max_pages:10,max_products:1});assert.equal(limited.unique_products,1);assert.equal(limited.reached_end,false);assert.equal(limited.stop_reason,"product_limit");
    results.push({name:phase,status:"pass"});
    phase="changed owner filter invalidates cached analysis without another navigation";
    const clicksBefore=await paged.locator('#nav-clicks').textContent();
    await paged.evaluate(()=>history.replaceState({},"",location.pathname+"?fixture=pagination&keyword=changed"));
    assert.equal((await tool("get_scan_products",{page_id:pagedId,scan_id:limited.scan_id,limit:2,offset:0})).error,"scan_context_changed");
    assert.equal(await paged.locator('#nav-clicks').textContent(),clicksBefore);
    await paged.close();results.push({name:phase,status:"pass"});
    phase="observed Shopee PaginationNoTotal spans / full scan and disabled end";
    const nativePaged=await context.newPage();await nativePaged.route("**/*",route=>route.fulfill({contentType:"text/html",body:paginationFixture({noTotal:true})}));await nativePaged.goto(PAGE+"?fixture=no-total");
    await nativePaged.waitForFunction(()=>document.querySelector('#shopkud-panel')?.shadowRoot?.getElementById('status')?.textContent.includes('เชื่อมต่อแล้ว'));
    const nativeId=(await tool("list_pages")).pages.find(p=>p.page_id!==freshId).page_id;
    const nativeMeta=await tool("get_pagination",{page_id:nativeId});assert.equal(nativeMeta.adapter,"shopee-pagination-no-total");assert.equal(nativeMeta.current_page,1);assert.equal(nativeMeta.has_previous,false);assert.equal(nativeMeta.total_pages,null);
    const nativeScan=await tool("scan_products",{page_id:nativeId,start_page:1,max_pages:10,max_products:100});assert.equal(nativeScan.pages_scanned,3);assert.equal(nativeScan.unique_products,5);assert.equal(nativeScan.reached_end,true);assert.equal(nativeScan.stop_reason,"end_of_results");
    const lastMeta=await tool("get_pagination",{page_id:nativeId});assert.equal(lastMeta.has_next,false);assert.equal(lastMeta.total_pages,3);results.push({name:phase,status:"pass"});
    phase="Shopee numeric span navigation back / fresh product snapshot";
    const nativeReturn=await tool("go_to_page",{page_id:nativeId,page_number:1});assert.equal(nativeReturn.ok,true);assert.equal(nativeReturn.outcome,"completed");
    assert.deepEqual((await tool("get_products",{page_id:nativeId,limit:3,offset:0})).records.map(r=>r.product_id),["201","202"]);await nativePaged.close();results.push({name:phase,status:"pass"});
    phase="changed active page without changed products is unknown / one click only";
    const stalled=await context.newPage();await stalled.route("**/*",route=>route.fulfill({contentType:"text/html",body:paginationFixture({stall:true,noTotal:true})}));await stalled.goto(PAGE+"?fixture=stall");
    await stalled.waitForFunction(()=>document.querySelector('#shopkud-panel')?.shadowRoot?.getElementById('status')?.textContent.includes('เชื่อมต่อแล้ว'));
    const stalledId=(await tool("list_pages")).pages.find(p=>p.page_id!==freshId).page_id;
    const unknownNav=await tool("go_to_page",{page_id:stalledId,page_number:2});assert.equal(unknownNav.error,"page_change_unconfirmed");assert.equal(unknownNav.outcome,"unconfirmed");assert.equal(await stalled.locator('#nav-clicks').textContent(),"1");await stalled.close();results.push({name:phase,status:"pass"});
    phase="MV3 content cancellation validates request identity / no overlap";
    const cancellable=await context.newPage();await cancellable.route("**/*",route=>route.fulfill({contentType:"text/html",body:paginationFixture({stall:true,noTotal:true})}));await cancellable.goto(PAGE+"?fixture=cancel");
    await cancellable.waitForFunction(()=>document.querySelector('#shopkud-panel')?.shadowRoot?.getElementById('status')?.textContent.includes('เชื่อมต่อแล้ว'));
    const cancelPage=(await tool("list_pages")).pages.find(p=>p.page_id!==freshId).page_id;
    const [cancelTab,cancelNonce]=cancelPage.split(":");const cancelId=crypto.randomBytes(16).toString("hex");
    const sendContent=message=>worker.evaluate(({tab,message})=>new Promise(resolve=>chrome.tabs.sendMessage(tab,message,result=>resolve(result))),{tab:+cancelTab,message});
    await worker.evaluate(({tab,nonce,id})=>{globalThis.shopkudCancelTest=new Promise(resolve=>chrome.tabs.sendMessage(tab,{type:"shopkud-command",nonce,request_id:id,operation:"scan",arguments:{start_page:1,max_pages:10,max_products:100}},resolve));},{tab:+cancelTab,nonce:cancelNonce,id:cancelId});
    await cancellable.waitForFunction(()=>document.getElementById("nav-clicks").textContent==="1");
    assert.equal((await sendContent({type:"shopkud-cancel",nonce:cancelNonce,request_id:"0".repeat(32)})).ok,false);
    assert.equal((await sendContent({type:"shopkud-command",nonce:cancelNonce,request_id:crypto.randomBytes(16).toString("hex"),operation:"pagination",arguments:{}})).error,"page_busy");
    results.push({name:phase,status:"pass"});
    phase="MV3 cancellation stops pending scan quickly / bridge remains readable";
    const cancelStart=performance.now();assert.equal((await sendContent({type:"shopkud-cancel",nonce:cancelNonce,request_id:cancelId})).ok,true);
    const cancelled=await worker.evaluate(()=>globalThis.shopkudCancelTest);assert.equal(cancelled.stop_reason,"cancelled");assert.equal(cancelled.outcome,"unconfirmed");
    assert.ok(performance.now()-cancelStart<1500);assert.equal(await cancellable.locator('#nav-clicks').textContent(),"1");
    assert.equal((await tool("get_pagination",{page_id:cancelPage})).ok,true);
    await cancellable.close();results.push({name:phase,status:"pass"});
    phase="challenge blocks navigation without a click";
    const challenged=await context.newPage();await challenged.route("**/*",route=>route.fulfill({contentType:"text/html",body:paginationFixture({challenge:true})}));await challenged.goto(PAGE+"?fixture=challenge");
    await challenged.waitForFunction(()=>document.querySelector('#shopkud-panel')?.shadowRoot?.getElementById('status')?.textContent.includes('เชื่อมต่อแล้ว'));
    const challengedId=(await tool("list_pages")).pages.find(p=>p.page_id!==freshId).page_id;
    assert.equal((await tool("go_to_page",{page_id:challengedId,page_number:2})).error,"challenge_detected");assert.equal(await challenged.locator('#nav-clicks').textContent(),"0");await challenged.close();results.push({name:phase,status:"pass"});
    async function faultFixture(){
      const target=await context.newPage();await target.goto(PAGE+'?fixture=apply-fault');
      await target.waitForFunction(()=>document.querySelector('#shopkud-panel')?.shadowRoot?.getElementById('status')?.textContent.includes('เชื่อมต่อแล้ว'));
      const id=(await tool('list_pages')).pages.find(p=>p.page_id!==freshId).page_id;
      const snapshot=await tool('get_products',{page_id:id,limit:3,offset:0});
      return {target,id,snapshot};
    }
    async function injectPostClickFault(target){
      // Test-only injection in the extension's isolated world, never a real user profile.
      const session=await context.newCDPSession(target),worlds=[];
      session.on('Runtime.executionContextCreated',event=>worlds.push(event.context));await session.send('Runtime.enable');
      let world;
      for(const item of worlds){const probe=await session.send('Runtime.evaluate',{expression:'typeof window.ShopeePickerCore',contextId:item.id,returnByValue:true});if(probe.result.value==='object'){world=item;break;}}
      assert.ok(world,'isolated extension context found');
      const injected=await session.send('Runtime.evaluate',{expression:'window.ShopeePickerCore.resolveCheckboxState = ((original) => (value) => { if (value.wrapperChecked) throw new Error("synthetic post-click fault"); return original(value); })(window.ShopeePickerCore.resolveCheckboxState)',contextId:world.id});
      assert.ok(!injected.exceptionDetails);return session;
    }
    phase='agent Apply exception after a click finalizes unknown review state without replay';
    const agentFault=await faultFixture(),agentFaultPlan=await tool('prepare_selection',{page_id:agentFault.id,snapshot_id:agentFault.snapshot.snapshot_id,picks:[pick('102')]});
    const agentFaultSession=await injectPostClickFault(agentFault.target);
    const agentUnknown=await tool('apply_selection',{page_id:agentFault.id,plan_id:agentFaultPlan.plan_id});assert.equal(agentUnknown.outcome,'unconfirmed');
    await agentFault.target.locator('#shopkud-panel').getByRole('button',{name:'ดูแผนคัดสินค้า (1)',exact:true}).click();
    const agentOutcome=await agentFault.target.locator('#shopkud-panel').locator('#outcome').innerText();assert.ok(agentOutcome.includes('บางสินค้าอาจถูกเลือกแล้ว'));assert.ok(!agentOutcome.includes('ยังไม่ได้เลือกสินค้าจากคำสั่งนี้'));
    assert.ok((await agentFault.target.locator('#shopkud-panel').locator('#status').textContent()).includes('ผลการเลือกยังไม่แน่ชัด'));
    assert.equal(await agentFault.target.locator('#count').textContent(),'2');assert.equal(await agentFault.target.locator('#shopkud-panel').getByRole('button',{name:'เลือกสินค้าตามแผน',exact:true}).isEnabled(),false);
    await agentFault.target.screenshot({path:path.join(OUT,'review-agent-unknown.png')});
    assert.equal((await tool('apply_selection',{page_id:agentFault.id,plan_id:agentFaultPlan.plan_id})).error,'plan_already_consumed');
    await agentFaultSession.detach();await agentFault.target.close();results.push({name:phase,status:'pass'});
    phase='manual Apply exception after a click reports unknown instead of not-applied';
    const manualFault=await faultFixture();await tool('prepare_selection',{page_id:manualFault.id,snapshot_id:manualFault.snapshot.snapshot_id,picks:[pick('102')]});
    const manualFaultSession=await injectPostClickFault(manualFault.target),manualPanel=manualFault.target.locator('#shopkud-panel');
    await manualPanel.getByRole('button',{name:'ดูแผนคัดสินค้า (1)',exact:true}).click();await manualPanel.getByRole('button',{name:'เลือกสินค้าตามแผน',exact:true}).click();
    await manualFault.target.waitForFunction(()=>document.querySelector('#shopkud-panel').shadowRoot.getElementById('outcome').textContent.includes('บางสินค้าอาจถูกเลือกแล้ว'));
    assert.ok((await manualPanel.locator('#status').textContent()).includes('ผลการเลือกยังไม่แน่ชัด'));
    assert.equal(await manualFault.target.locator('#count').textContent(),'2');assert.equal(await manualPanel.getByRole('button',{name:'เลือกสินค้าตามแผน',exact:true}).isEnabled(),false);
    await manualFault.target.screenshot({path:path.join(OUT,'review-manual-unknown.png')});
    await manualFaultSession.detach();await manualFault.target.close();results.push({name:phase,status:'pass'});
    phase='disconnect during Apply remains visible after cancellation with not-attempted picks';
    const interrupted=await faultFixture(),interruptedPlan=await tool('prepare_selection',{page_id:interrupted.id,snapshot_id:interrupted.snapshot.snapshot_id,picks:[pick('102'),pick('103')]});
    await interrupted.target.evaluate(()=>{document.querySelector('#p102 input').onclick=event=>event.preventDefault();});
    const interruptedResult=tool('apply_selection',{page_id:interrupted.id,plan_id:interruptedPlan.plan_id});
    await interrupted.target.waitForFunction(()=>document.querySelector('#shopkud-panel').shadowRoot.querySelector('button.primary').textContent==='กำลังเลือกสินค้า…');
    const [interruptedTab,interruptedNonce]=interrupted.id.split(':');
    await worker.evaluate(({tab,nonce})=>new Promise(resolve=>chrome.tabs.sendMessage(tab,{type:'shopkud-state',nonce,connected:false},()=>resolve())),{tab:+interruptedTab,nonce:interruptedNonce});
    const stoppedApply=await interruptedResult;assert.equal(stoppedApply.cancelled,true);assert.deepEqual(stoppedApply.not_attempted,['103']);
    const interruptedPanel=interrupted.target.locator('#shopkud-panel');assert.ok((await interruptedPanel.locator('#status').textContent()).includes('การเชื่อมต่อหลุด'));
    await interruptedPanel.getByRole('button',{name:'ดูแผนคัดสินค้า (2)',exact:true}).click();assert.ok((await interruptedPanel.locator('#outcome').textContent()).includes('ยังไม่ได้ลองเลือก 1'));assert.ok((await interruptedPanel.locator('#outcome').textContent()).includes('ยกเลิกแล้ว'));
    assert.equal(await interruptedPanel.getByRole('button',{name:'เลือกสินค้าตามแผน',exact:true}).isEnabled(),false);await interrupted.target.screenshot({path:path.join(OUT,'review-disconnected.png')});await interrupted.target.close();results.push({name:phase,status:'pass'});
    phase="extension reload makes old-page reconnect report refresh without an uncaught error";
    const stopped=new Promise(resolve=>worker.once('close',()=>resolve(true)));
    await worker.evaluate(()=>chrome.runtime.reload()).catch(error=>{if(!/closed|destroyed/i.test(error.message))throw error;});
    assert.equal(await Promise.race([stopped,pause(3000).then(()=>false)]),true);
    const beforeReloadCount=await page.locator('#count').textContent();
    await page.locator('#shopkud-panel').getByRole('button',{name:'เชื่อมต่อ'}).click();
    await page.waitForFunction(()=>document.querySelector('#shopkud-panel')?.shadowRoot?.getElementById('status')?.textContent.includes('รีเฟรชหน้าเว็บ'),null,{timeout:3000});
    assert.equal(await page.locator('#count').textContent(),beforeReloadCount);
    assert.deepEqual(errors,[]);results.push({name:phase,status:"pass"});
    await page.screenshot({path:path.join(OUT,"mcp-extension.png")});
    await fs.writeFile(path.join(OUT,"results.json"),JSON.stringify({lane:"real HTTP MCP/native messaging/MV3, synthetic blocked-network page",results,efficiency,toolLatencies:latencies,pageErrors:errors,productionProfileTouched:false,realModelCalls:0,realTincanCalls:0,browserVersion:context.browser().version()},null,2));
    for(const r of results)console.log(`PASS ${r.name}`);
  } catch(error){
    const fixturePageStates=context?await Promise.all(context.pages().map(p=>p.evaluate(()=>({url:location.href,panel:!!document.querySelector('#shopkud-panel'),status:document.querySelector('#shopkud-panel')?.shadowRoot?.getElementById('status')?.textContent})).catch(()=>({closed:true})))):[];
    await fs.writeFile(path.join(OUT,"results.json"),JSON.stringify({status:"fail",phase,results,error:error.message,serverError:stderr.slice(-3000),pageErrors:errors,fixturePageStates},null,2));throw error;
  } finally{
    if(context)await context.close();
    if(server && server.exitCode===null){server.kill('SIGTERM');await Promise.race([new Promise(resolve=>server.once('exit',resolve)),pause(3000)]);if(server.exitCode===null)server.kill('SIGKILL');}
    await fs.rm(root,{recursive:true,force:true});
  }
}
fs.mkdir(OUT,{recursive:true}).then(run).catch(error=>{console.error(error.message);process.exitCode=1;});
