(() => {
  "use strict";
  const ORIGIN="https://affiliate.shopee.co.th";
  function route(value) {
    try {
      const u=new URL(value);
      if(u.origin!==ORIGIN || u.username || u.password || u.port)return null;
      if(/^\/offer\/product_offer\/?$/u.test(u.pathname))return {kind:"list",url:ORIGIN+"/offer/product_offer"};
      const match=/^\/offer\/product_offer\/([1-9][0-9]{0,19})\/?$/u.exec(u.pathname);
      return match?{kind:"detail",product_id:match[1],url:ORIGIN+"/offer/product_offer/"+match[1]}:null;
    } catch {return null;}
  }
  function shortLink(value) {
    if(typeof value!=="string" || value.length>2048 || /[\s\\]/u.test(value))return null;
    try {const u=new URL(value);return u.protocol==="https:" && u.hostname==="s.shopee.co.th" && !u.username && !u.password && !u.port && !u.hash && /^\/[A-Za-z0-9]+$/u.test(u.pathname)?value:null;}
    catch {return null;}
  }
  function read(doc,value,Core) {
    const context=route(value);
    if(context?.kind!=="detail")return {ok:false,error:"product_detail_page_required"};
    if([...doc.querySelectorAll('iframe[src*="captcha"],.captcha,#captcha,[data-testid="captcha"]')].some(e=>e.getClientRects().length))return {ok:false,error:"challenge_detected",retry_automatically:false};
    const main=doc.querySelector("main"),info=main?.querySelector(".detail-info");
    const name=info?.querySelector(".name-wrap .name")?.textContent?.trim();
    const price=Core.parsePriceValue(info?.querySelector(".price")?.textContent || "");
    const links=[...info?.querySelectorAll('a[href]') || []].map(a=>a.getAttribute("href")).filter(href=>{
      try {const u=new URL(href);return u.origin==="https://shopee.co.th" && !u.username && !u.password && new RegExp("^/product/[1-9][0-9]{0,19}/"+context.product_id+"$").test(u.pathname) && !u.search && !u.hash;}catch{return false;}
    });
    if(!name || name.length>500 || !price || links.length!==1)return {ok:false,error:"product_detail_unavailable"};
    const shop_id=new URL(links[0]).pathname.split("/")[2];
    const images=[],seen=new Set();
    const imageNodes=main.querySelectorAll('.detail > img.offer-img,.detail-image img,.detail-image-wrap img,.detail-info .gallery img,.detail-info .product-gallery img,.detail-info .variant-images img');
    for(const node of [...imageNodes].slice(0,100)) {
      if(!node.getClientRects().length || node.closest('.reviews,.review,.customer-review,[data-testid="review"]'))continue;
      const raw=node.getAttribute("data-src") || node.currentSrc || node.getAttribute("src");
      let asset;try {asset=new URL(raw);}catch{continue;}
      if(asset.protocol!=="https:" || asset.username || asset.password || asset.port || asset.hash || !/^(?:[a-z0-9-]+\.)*(?:susercontent|shopeemobile)\.com$/u.test(asset.hostname) || seen.has(asset.href))continue;
      seen.add(asset.href);
      images.push({url:asset.href,role:node.hasAttribute('data-variant') || node.closest('.variant-images')?"variant":node.matches('.detail > img.offer-img') || node.closest('.detail-image,.detail-image-wrap')?"main":"gallery",order:images.length,
        width:node.naturalWidth || null,height:node.naturalHeight || null,source:"visible_offer_dom",source_url:context.url});
      if(images.length>=30)break;
    }
    const money=text=>{const m=/^(?:[0-9]+(?:\.[0-9]+)?%\s*\(\s*)?฿\s*([0-9,]+(?:\.[0-9]{1,2})?)\s*\)?$/u.exec(Core.normalizeDigits(text).trim());return m?Core.parsePriceValue(m[1])?.min ?? null:null;};
    const commission=text=>({pct:Core.parseCommissionPct(text,true),amount_thb:money(text)});
    const clip=node=>(node?.textContent || "").replace(/\s+/gu," ").trim().slice(0,240);
    const eligible=node=>node.getClientRects().length && !node.closest('nav,aside,.reviews,.review,.customer-review,[data-testid="review"]');
    const channels=[];
    for(const table of [...main.querySelectorAll("table")].slice(0,10)) {
      if(!eligible(table))continue;
      const headers=[...table.querySelectorAll("thead th")].length?[...table.querySelectorAll("thead th")]:[...table.querySelectorAll("[role=columnheader]")];
      const extraLayout=headers.length===4 && headers[0].textContent.includes("ประเภทช่องทาง") && headers[2].textContent.includes("ค่าคอมช้อปปี้") && headers[3].textContent.includes("โดยประมาณ") && Boolean(headers[1].querySelector(".seller-comm-title"));
      const shopeeOnly=headers.length===3 && clip(headers[0])==="ประเภทช่องทาง" && clip(headers[1])==="ค่าคอมช้อปปี้" && clip(headers[2])==="ค่าคอมมิชชั่นโดยประมาณ" && !table.querySelector("thead .seller-comm-title");
      if(!extraLayout && !shopeeOnly)continue;
      for(const row of [...table.querySelectorAll("tbody tr")].slice(0,10)) {
        if(!eligible(row))continue;
        const cells=[...row.querySelectorAll("td")];if(cells.length!==headers.length)continue;
        const label=cells[0].textContent.trim(),key=[['social','โซเชียลมีเดีย'],['shopee_live','ช้อปปี้ไลฟ์'],['shopee_video','ช้อปปี้วีดีโอ']].find(([,text])=>label.startsWith(text));
        if(!key)continue;
        const extra=extraLayout?commission(cells[1].textContent):{pct:null,amount_thb:null},shopee=commission(cells[extraLayout?2:1].textContent);
        channels.push({channel:key[0],label:key[1],extra_commission:extra,shopee_commission:shopee,
          extra_commission_displayed:extraLayout,commission_layout:extraLayout?"extra_and_shopee":"shopee_only",total_pct_source:extraLayout?"component_sum":"visible_shopee_column",
          total_pct:shopeeOnly?shopee.pct:extra.pct===null || shopee.pct===null?null:extra.pct+shopee.pct,estimated_commission_thb:money(cells[extraLayout?3:2].textContent),cap_thb:null,cap_source:null});
      }
    }
    if(new Set(channels.map(c=>c.channel)).size!==channels.length)return {ok:false,error:"ambiguous_commission_table"};
    // A bounded diagnostic of public commission markup, never document-wide text.
    const commission_layout_evidence=channels.length?null:{
      status:"unsupported_or_not_observed",source:"visible_offer_dom",source_url:context.url,
      tables:[...main.querySelectorAll("table")].slice(0,10).filter(table=>eligible(table) && /ค่าคอม|ประเภทช่องทาง/u.test([...table.querySelectorAll("thead th,tr th")].map(clip).join(" "))).slice(0,3).map(table=>({
        headers:[...table.querySelectorAll("thead th")].slice(0,10).map(clip),
        header_classes:[...table.querySelectorAll("thead th")].slice(0,10).map(node=>(node.className || "").slice(0,100)),
        seller_title_present:Boolean(table.querySelector("thead .seller-comm-title")),
        rows:[...table.querySelectorAll("tbody tr")].filter(eligible).slice(0,8).map(row=>[...row.querySelectorAll("td")].slice(0,10).map(clip))
      })),
      labels:[...main.querySelectorAll('h2,h3,h4,h5,h6,[class*="comm"],[class*="Commission"]')].filter(node=>eligible(node) && node.children.length<5 && /ค่าคอม/u.test(clip(node)) && (node.textContent || "").length<=240).slice(0,8).map(clip)
    };
    const dialogs=[...doc.querySelectorAll('[role="dialog"]')].filter(d=>d.querySelector('h4')?.textContent.trim()==="ลิงก์ข้อเสนอสินค้า" && d.getClientRects().length);
    const captured=window.ShopKudLinkCapture?window.ShopKudLinkCapture.choose(dialogs,shortLink):{
      values:dialogs.flatMap(d=>[...d.querySelectorAll("textarea,input[type=text]")].filter(e=>e.disabled && e.getClientRects().length).map(e=>shortLink(e.value)).filter(Boolean)),
      source:null
    };
    const candidates=captured.values;
    const linkSource=candidates.length===1?(captured.source || "visible_link_dialog"):null;
    return {ok:true,kind:"product_detail",product_id:context.product_id,item_id:context.product_id,shop_id,name,offer_url:context.url,product_url:links[0],price_min_thb:price.min,price_max_thb:price.max,
      images,variant_info:{model_id:null,model_name:null,color:null,source:null},gallery_complete:false,
      channels,commission_layout_evidence,affiliate_url:candidates.length===1?candidates[0]:null,link_source:linkSource,
      observed_at:new Date().toISOString(),observations_only:true,link_attribution_verified:false,
      missing_fields:[...(!channels.length?["channels"]:[]),...(!images.length?["images"]:[]),...(!images.some(i=>i.role==="gallery")?["gallery"]:[]),"variant_model","variant_color","commission_caps"]};
  }
  const attempted=new Set();
  async function openLink(doc,value,Core,stillCurrent) {
    const initial=read(doc,value,Core),context=route(value);
    if(!initial.ok)return initial;
    const fail=(error,clicked=false)=>({ok:false,error,outcome:clicked?"unconfirmed":"not_completed",retry_automatically:false});
    if(!stillCurrent())return fail("page_changed");
    if(initial.affiliate_url)return {...initial,link_action:{clicked:false,source:"existing_visible_link_dialog"}};
    if(attempted.has(context.url))return fail("link_dialog_attempt_unconfirmed",true);
    const visible=node=>{const style=doc.defaultView.getComputedStyle(node);return node.getClientRects().length && style.display!=="none" && style.visibility!=="hidden";};
    if([...doc.querySelectorAll('[role="dialog"]')].some(visible))return fail("other_dialog_open");
    const buttons=[...doc.querySelectorAll("main .detail-info button, main .detail-info [role=button]")].filter(node=>visible(node) && !node.disabled && node.getAttribute("aria-disabled")!=="true" && /^(?:รับลิงก์|เอา\s*ลิงก์|get\s*link)$/iu.test(((node.getAttribute("aria-label") || node.innerText || "")).replace(/\s+/gu," ").trim()));
    if(buttons.length!==1)return {...fail("link_button_unavailable"),link_button_evidence:[...doc.querySelectorAll("main .detail-info button")].filter(visible).slice(0,8).map(node=>({label:node.innerText.trim().slice(0,80),disabled:node.disabled}))};
    const check=read(doc,value,Core);
    if(!stillCurrent() || !check.ok || check.product_id!==initial.product_id || check.shop_id!==initial.shop_id)return fail("page_changed");
    attempted.add(context.url);
    const label=buttons[0].innerText.trim();
    try {buttons[0].click();} catch {return fail("link_dialog_attempt_unconfirmed",true);}
    return await new Promise(resolve=>{
      let done=false;
      const finish=result=>{if(done)return;done=true;observer.disconnect();clearTimeout(timer);resolve(result);};
      const inspect=()=>{
        if(!stillCurrent())return finish(fail("page_changed_after_link_click",true));
        const result=read(doc,value,Core);
        if(!result.ok)return finish({...result,outcome:"unconfirmed",retry_automatically:false});
        if(result.product_id!==initial.product_id || result.shop_id!==initial.shop_id)return finish(fail("page_changed_after_link_click",true));
        if(result.affiliate_url)finish({...result,link_action:{clicked:true,button_label:label,source:"native_offer_link_dialog"},retry_automatically:false});
      };
      const observer=new doc.defaultView.MutationObserver(inspect);
      const timer=setTimeout(()=>finish(fail("link_dialog_attempt_unconfirmed",true)),10000);
      observer.observe(doc.documentElement,{childList:true,subtree:true,characterData:true,attributes:true});
      inspect();
    });
  }
  window.ShopKudDetail={route,shortLink,read,openLink};
})();
