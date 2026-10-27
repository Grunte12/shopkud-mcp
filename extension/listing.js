"use strict";
// Fixed isolated reader: public product DOM/JSON-LD only, never app state or APIs.
(async () => {
  const match=/^https:\/\/shopee\.co\.th\/product\/([1-9][0-9]{0,19})\/([1-9][0-9]{0,19})$/u.exec(location.href);
  if(!match || /[\r\n]/u.test(location.href))return {ok:false,error:"unsupported_product_route"};
  const source={source_url:location.href,shop_id:match[1],product_id:match[2]};
  const text=(value,max=240)=>typeof value==="string"?value.replace(/\s+/gu," ").trim().slice(0,max):"";
  const visible=node=>{
    const style=getComputedStyle(node),box=node.getBoundingClientRect();
    return style.display!=="none" && style.visibility!=="hidden" && box.width>0 && box.height>0;
  };
  const failure=error=>({ok:false,error,...source,retry_automatically:false});
  // Chrome's load event precedes Shopee's seller hydration. Observe DOM only.
  let hydration="not_required";
  if(document.querySelector('.page-product__shop')){
    hydration=await new Promise(resolve=>{
      let stable=null,done=false;
      const finish=status=>{if(done)return;done=true;observer.disconnect();clearTimeout(limit);clearTimeout(stable);resolve(status);};
      const check=()=>{
        if(location.href!==source.source_url)return finish("page_changed");
        const panel=document.querySelector('.page-product__shop');
        const identity=panel?.querySelector('.KBEZs0,[itemprop="name"],[aria-label="ชื่อร้านค้า"]');
        if(identity && visible(identity) && text(identity.innerText) && !/^(?:N\/A|-)$/iu.test(text(identity.innerText))){
          if(stable===null)stable=setTimeout(()=>finish("seller_observed"),400);
        }else{clearTimeout(stable);stable=null;}
      };
      const observer=new MutationObserver(check),limit=setTimeout(()=>finish("seller_not_ready"),8000);
      observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true});check();
    });
    if(hydration==="page_changed")return failure("listing_context_changed");
  }
  const headings=[...document.querySelectorAll("h1,h2,h3,[role=dialog]")].slice(0,60).filter(visible);
  if(headings.some(node=>/captcha|verify.*human|ยืนยัน.*(?:ตัวตน|มนุษย์)|security verification/iu.test(text(node.textContent,300))))return failure("challenge_detected");
  if(headings.some(node=>/^(?:เข้าสู่ระบบ|ลงชื่อเข้าใช้|log ?in|sign ?in)$/iu.test(text(node.textContent))))return failure("listing_requires_login");
  if(document.querySelector('iframe[src*="captcha"],input[type="password"]'))return failure("listing_requires_login_or_challenge");
  const main=document.querySelector("main,[role=main]");
  const matchesProduct=value=>{
    if(typeof value!=="string")return false;
    try{const u=new URL(value,location.href);return u.origin==="https://shopee.co.th" && !u.username && !u.password && !u.search && !u.hash && (u.pathname===`/product/${match[1]}/${match[2]}` || u.pathname.endsWith(`-i.${match[1]}.${match[2]}`));}catch{return false;}
  };
  const products=[];
  function nodes(value,depth=0){
    if(depth>5 || products.length>=20)return;
    if(Array.isArray(value)){for(const item of value.slice(0,40))nodes(item,depth+1);return;}
    if(!value || typeof value!=="object")return;
    const types=Array.isArray(value["@type"])?value["@type"]:[value["@type"]];
    if(types.some(type=>type==="Product" || type==="https://schema.org/Product") && matchesProduct(value.url || value["@id"]))products.push(value);
    if(value["@graph"])nodes(value["@graph"],depth+1);
  }
  for(const script of [...document.querySelectorAll('script[type="application/ld+json"]')].slice(0,10)){
    if((script.textContent||"").length>100000)continue;
    try{nodes(JSON.parse(script.textContent));}catch{}
  }
  const product=products.length===1?products[0]:null;
  const heading=main?[...main.querySelectorAll("h1")].find(visible):null;
  const name=product?text(product.name):heading?text(heading.innerText):null;
  const variant={model:null,sku:null,color:null,selected_options:[],available_options:[]};
  const optionLabel=/^(?:สี|color|รุ่น|model|ขนาด|size|ขนาดจอ|ความจุ|capacity|ตัวเลือก|แบบ|type)$/iu;
  const specEvidence=[];
  const record=(label,value,origin)=>{
    label=text(label,80);value=text(value);
    if(!label || !value || specEvidence.length>=30)return;
    specEvidence.push({label,value,source:origin});
    // A product spec color does not prove the selected purchase option.
  };
  if(product){
    if(typeof product.model==="string")record("model",product.model,"product_json_ld");
    if(typeof product.sku==="string")record("sku",product.sku,"product_json_ld");
    for(const property of (Array.isArray(product.additionalProperty)?product.additionalProperty:[]).slice(0,20))if(property && typeof property.value==="string")record(property.name,property.value,"product_json_ld");
  }
  if(main){
    for(const section of [...main.querySelectorAll("section")].slice(0,30)){
      const label=section.querySelector("h2,h3");
      if(!label || !visible(label) || !/^(?:รายละเอียดสินค้า|คุณสมบัติ|ข้อมูลสินค้า|ข้อมูลจำเพาะ(?:ของสินค้า)?|product specifications|specifications)$/iu.test(text(label.innerText)))continue;
      for(const row of [...section.querySelectorAll("tr")].slice(0,30)){
        const cells=[...row.querySelectorAll("th,td")];
        if(cells.length===2 && cells.every(visible))record(cells[0].innerText,cells[1].innerText,"visible_product_spec");
      }
      for(const term of [...section.querySelectorAll("dt")].slice(0,30))if(visible(term) && term.nextElementSibling?.tagName==="DD" && visible(term.nextElementSibling))record(term.innerText,term.nextElementSibling.innerText,"visible_product_spec");
      // Observed public Shopee spec rows are H3 + DIV, not table/dl elements.
      for(const term of [...section.querySelectorAll("h3")].slice(0,30)){
        const row=term.parentElement,value=term.nextElementSibling;
        if(row?.children.length===2 && ["DIV","A"].includes(value?.tagName) && visible(term) && visible(value) && !value.querySelector("h2,h3,button,input"))record(term.innerText,value.innerText,"visible_product_spec");
      }
    }
    // Read explicit accessible selection state only; never choose/click an option.
    for(const group of [...main.querySelectorAll('[role="radiogroup"]')].slice(0,8)){
      if(!visible(group))continue;
      const label=text(group.getAttribute("aria-label"),80);
      if(!optionLabel.test(label))continue;
      const options=[...group.querySelectorAll('[role="radio"]')].slice(0,30).filter(visible).map(option=>({value:text(option.getAttribute("aria-label") || option.innerText,120),selected:option.hasAttribute("aria-checked")?option.getAttribute("aria-checked")==="true":null,disabled:option.disabled===true || option.getAttribute("aria-disabled")==="true",source:"visible_aria_checked"})).filter(option=>option.value);
      variant.available_options.push({label,options:options.map(option=>option.value),option_evidence:options});
      const chosen=options.filter(option=>option.selected);
      if(chosen.length===1){variant.selected_options.push({label,value:chosen[0].value,source:"visible_aria_checked"});if(/^(?:สี|color)$/iu.test(label))variant.color=chosen[0].value;}
    }
    // Observed labeled Shopee buttons expose available choices without ARIA radio groups.
    for(const section of [...main.querySelectorAll("section")].slice(0,50)){
      const labelNode=[...section.children].find(child=>/^H[23]$/u.test(child.tagName));
      const label=labelNode && visible(labelNode)?text(labelNode.innerText,80):"";
      if(!optionLabel.test(label) || variant.available_options.some(group=>group.label===label))continue;
      const buttons=[...section.querySelectorAll("button")].slice(0,30).filter(visible);
      const options=buttons.map(button=>text(button.innerText,120)).filter(Boolean);
      if(!options.length)continue;
      variant.available_options.push({label,options,source:"visible_labeled_buttons",option_evidence:buttons.map(button=>({value:text(button.innerText,120),selected:button.hasAttribute("aria-checked")?button.getAttribute("aria-checked")==="true":button.hasAttribute("aria-pressed")?button.getAttribute("aria-pressed")==="true":null,disabled:button.disabled || button.getAttribute("aria-disabled")==="true",source:"visible_labeled_buttons"})).filter(option=>option.value)});
      const selected=buttons.filter(button=>button.getAttribute("aria-checked")==="true" || button.getAttribute("aria-pressed")==="true");
      if(selected.length===1){const value=text(selected[0].innerText,120);variant.selected_options.push({label,value,source:"visible_aria_selection"});if(/^(?:สี|color)$/iu.test(label))variant.color=value;}
    }
  }
  for(const [key,labelPattern] of [["model",/^(?:รุ่น|ชื่อรุ่น|model|model number)$/iu],["sku",/^(?:sku|รหัสสินค้า)$/iu]]){
    const values=[...new Set(specEvidence.filter(item=>labelPattern.test(item.label)).map(item=>item.value))];
    variant[key]=values.length===1?values[0]:null;
  }
  const gallery=[];
  for(const image of (product?(Array.isArray(product.image)?product.image:[product.image]):[]).slice(0,20)){
    const value=typeof image==="string"?image:image?.url;
    try{const u=new URL(value);if(u.protocol!=="https:" || u.username || u.password || u.port || u.href.length>2048)continue;
      if(!gallery.some(item=>item.url===u.href))gallery.push({url:u.href,source:"product_json_ld"});
    }catch{}
  }
  if(main && heading)for(const image of [...main.querySelectorAll("img")]){
    const url=image.currentSrc||image.src;
    if(gallery.length>=20)break;
    if(!visible(image) || /^icon(?:\s|$)/iu.test(image.alt||"") || !/^https:\/\/down-th\.img\.susercontent\.com\/file\//u.test(url) || url.length>2048 || !(image.compareDocumentPosition(heading)&Node.DOCUMENT_POSITION_FOLLOWING))continue;
    // Observed hero and thumbnail containers precede the product title, not reviews.
    const tile=image.closest(".mdCA_C"),hero=image.closest(".R32005");
    if(!tile && !hero || gallery.some(item=>item.url===url))continue;
    gallery.push({url,source:"visible_product_gallery",role:hero?"main_image":tile.querySelector('img[alt="icon video play"]')?"video_cover":"product_thumbnail"});
  }
  if(!main && !product)return {...failure("unsupported_product_layout"),layout_evidence:{main_found:false,matched_product_metadata:products.length}};
  const blocks=[];
  if(main && (!specEvidence.length || !variant.available_options.length))for(const label of [...main.querySelectorAll("h2,h3")].filter(visible)){
    const labelText=text(label.innerText,80);
    const section=label.closest("section"),primary=section && [...section.children].find(child=>/^H[23]$/u.test(child.tagName));
    if(!primary || !/^(?:สี|color|รุ่น|model|ข้อมูลจำเพาะของสินค้า|ข้อมูลจำเพาะ|product specifications|specifications)$/iu.test(text(primary.innerText)))continue;
    if(!/^(?:สี|color|รุ่น|model|สินค้า|แบรนด์|brand|ข้อมูลจำเพาะของสินค้า|ข้อมูลจำเพาะ)$/iu.test(labelText) || blocks.length>=4)continue;
    const levels=[];
    let container=label.parentElement;
    for(let depth=0;depth<1 && container && container!==main;depth++,container=container.parentElement){
      // Diagnose only small public product fields, never an enclosing page/review area.
      if(container.querySelectorAll("*").length>100 || /รีวิว|ความคิดเห็น|review/iu.test(text(container.innerText,3000)))break;
      const children=[...container.children].slice(0,16).filter(visible).map(child=>({tag:child.tagName,class:text(child.className,160),role:child.getAttribute("role"),text:text(child.innerText,160),
        buttons:[...child.querySelectorAll('button,[role=radio]')].slice(0,12).filter(visible).map(button=>({text:text(button.innerText,120),class:text(button.className,160),role:button.getAttribute("role"),checked:button.getAttribute("aria-checked"),pressed:button.getAttribute("aria-pressed")}))}));
      levels.push({tag:container.tagName,class:text(container.className,160),children});
    }
    blocks.push({heading:labelText,tag:label.tagName,class:text(label.className,160),levels});
  }
  const identitySignals=[...document.querySelectorAll('link[rel="canonical"],meta[property="og:url"]')].slice(0,4).map(node=>node.getAttribute("href")||node.getAttribute("content")).filter(Boolean);
  if(identitySignals.length && !identitySignals.some(matchesProduct))return {...failure("product_dom_identity_mismatch"),layout_evidence:{reader_revision:"0.8.7-observed-layout",identity_signals:identitySignals.map(value=>text(value,2048))}};
  const imageCandidates=!gallery.length && main && heading?[...main.querySelectorAll("img")].filter(image=>visible(image) && !/^icon(?:\s|$)/iu.test(image.alt||"") && /^https:\/\/down-th\.img\.susercontent\.com\/file\//u.test(image.currentSrc||image.src) && Boolean(image.compareDocumentPosition(heading)&Node.DOCUMENT_POSITION_FOLLOWING)).slice(0,12).map(image=>({src:text(image.currentSrc||image.src,2048),alt:text(image.getAttribute("alt"),160),class:text(image.className,160),parents:[image.parentElement,image.parentElement?.parentElement,image.parentElement?.parentElement?.parentElement].filter(Boolean).map(node=>({tag:node.tagName,class:text(node.className,160),role:node.getAttribute("role")}))})):[];
  const modelContexts=[];
  const modelEvidence=[];
  const accessoryTitle=/\b(?:case|cover|pouch|accessor(?:y|ies)|replacement)\b|เคส|ปลอก|ฟิล์ม|อะไหล่/iu.test(name||"");
  const brands=specEvidence.filter(item=>/^(?:สินค้า|แบรนด์|brand)$/iu.test(item.label)).map(item=>/[a-z][a-z ]{1,40}/iu.exec(item.value)?.[0].trim().toLowerCase()).filter(Boolean);
  const models=(value,origin,explicit=false)=>{
    if(typeof value!=="string")return;
    value=value.replace(/[™®]/gu,"").normalize("NFKC").slice(0,12000);
    for(const token of value.matchAll(/(?<![a-z0-9_])([a-z]{1,8}-?[0-9][a-z0-9-]{1,23})(?![a-z0-9_-])/giu)) {
      if(modelEvidence.length>=12)break;
      const start=token.index,code=token[1].toUpperCase();
      const before=value.slice(Math.max(value.lastIndexOf("\n",start-1)+1,start-90),start);
      const compatible=accessoryTitle || /\b(?:compatible(?:\s+with)?|fits?|for)\b|สำหรับ|รองรับ|ใช้(?:ได้)?กับ/iu.test(before);
      const labeled=/(?:รุ่น|model(?:\s+number)?)\s*[:：]?\s*$/iu.test(before);
      const parenthesized=value[start-1]==="(" && value[start+token[1].length]===")" && /[a-zก-๙]/iu.test(before);
      const branded=brands.some(brand=>before.toLowerCase().includes(brand));
      const component=/(?:processor|chipset|chip|cpu|gpu|ชิป|ชิปเซ็ต|หน่วยประมวลผล)\s*[:：]?\s*$/iu.test(before);
      const role=compatible?"compatible":component?"mention":explicit || labeled || parenthesized || branded?"identity":"mention";
      const snippet=text(value.slice(Math.max(0,start-80),start+token[1].length+80),180);
      if(!modelEvidence.some(item=>item.model===code && item.source===origin && item.role===role))modelEvidence.push({model:code,source:origin,snippet,role});
    }
  };
  for(const item of specEvidence)if(/^(?:รุ่น|ชื่อรุ่น|model|model number)$/iu.test(item.label))models(item.value,item.source,true);
  models(name,product?"product_json_ld_title":"visible_product_title",true);
  if(main)for(const section of [...main.querySelectorAll("section")].slice(0,50)){
    const title=[...section.children].find(child=>/^H[23]$/u.test(child.tagName));
    if(!title || !visible(title) || !/^(?:รายละเอียดสินค้า|product description)$/iu.test(text(title.innerText)))continue;
    const description=text(section.innerText,12000);
    models(section.innerText,"visible_product_description");
    for(const match of description.matchAll(/(?:รุ่น|model|sku)\s*[:：]\s*[^\n]{1,120}/giu)){if(modelContexts.length>=4)break;modelContexts.push(text(match[0],160));}
  }
  const identityModels=[...new Set(modelEvidence.filter(item=>item.role==="identity").map(item=>item.model))];
  if(variant.model===null && !specEvidence.some(item=>/^(?:รุ่น|ชื่อรุ่น|model|model number)$/iu.test(item.label)) && identityModels.length===1)variant.model=identityModels[0];
  // Only named public panels, never an enclosing page, review body or account area.
  const uniquePanel=selector=>{
    const panels=main?[...main.querySelectorAll(selector)].filter(visible):[];
    return panels.length===1?panels[0]:null;
  };
  const sellerPanel=uniquePanel('.page-product__shop,section[aria-label="ข้อมูลร้านค้า"],[role="region"][aria-label="ข้อมูลร้านค้า"],section[aria-label="Shop information"],[role="region"][aria-label="Shop information"]');
  const summaryPanel=heading?.closest('.product-briefing,div.xvTkTc,section.SQguX_,section[aria-label="ข้อมูลสินค้า"],[role="region"][aria-label="ข้อมูลสินค้า"],section[aria-label="Product details"],[role="region"][aria-label="Product details"]') || null;
  const observation=(display,origin)=>({display:text(display,120),source:origin});
  const count=/^[0-9][0-9.,\s]*(?:พัน|หมื่น|แสน|ล้าน|[km])?\s*\+?\s*(?:ชิ้น|คะแนน|รีวิว|ratings?|reviews?|sold)?$/iu;
  const field=(panel,labels,origin,valid=()=>true)=>{
    if(!panel || !visible(panel))return null;
    const values=[];
    for(const term of [...panel.querySelectorAll("label,span,div,dt,h2,h3")].slice(0,250)){
      if(!visible(term) || !labels.test(text(term.innerText,160)))continue;
      let label=term;
      for(let depth=0;depth<2 && label!==panel;depth++,label=label.parentElement){
        const value=label.nextElementSibling;
        if(!value || !panel.contains(value) || !visible(value) || value.querySelectorAll("*").length>12)continue;
        const display=text(value.innerText,121);
        if(display && display.length<=120 && !/^(?:-|–|N\/A)$/iu.test(display) && !/(?:^|\s)N\/A(?:$|\s)/iu.test(display) && valid(display))values.push(display);
        break;
      }
    }
    const distinct=[...new Set(values)];
    return distinct.length===1?observation(distinct[0],origin):null;
  };
  const seller_info={
    name:field(sellerPanel,/^(?:ชื่อร้านค้า|shop name)$/iu,"visible_seller_panel"),
    mall_badge:null,
    ratings_count:field(sellerPanel,/^(?:คะแนน|การให้คะแนน|ratings)$/iu,"visible_seller_panel",value=>count.test(value)),
    followers:field(sellerPanel,/^(?:ผู้ติดตาม|followers)$/iu,"visible_seller_panel",value=>count.test(value)),
    shop_age:field(sellerPanel,/^(?:เข้าร่วมเมื่อ|joined)$/iu,"visible_seller_panel"),
    response_rate:field(sellerPanel,/^(?:อัตราการตอบกลับ|อัตราการตอบแชท|response rate)$/iu,"visible_seller_panel",value=>/^(?:100|[0-9]{1,2})(?:\.[0-9]+)?\s*%$/u.test(value)),
    response_time:field(sellerPanel,/^(?:เวลาในการตอบกลับ|response time)$/iu,"visible_seller_panel")
  };
  if(sellerPanel){
    if(!seller_info.name){
      // Only explicit seller identity labels inside the unique shop panel.
      const names=[...sellerPanel.querySelectorAll('.KBEZs0,[itemprop="name"],[aria-label="ชื่อร้านค้า"],[aria-label="Shop name"]')].filter(visible).map(node=>text(node.innerText,120)).filter(value=>value && !/^(?:N\/A|-)$/iu.test(value));
      if(new Set(names).size===1)seller_info.name=observation(names[0],"visible_seller_panel");
    }
    const badges=[...sellerPanel.querySelectorAll('img[alt],[aria-label],[class*="badge"]')].slice(0,30).filter(visible)
      .map(node=>text(node.getAttribute("alt") || node.getAttribute("aria-label") || node.innerText,120)).filter(value=>/^(?:shopee mall|mall|mall shop badge)$/iu.test(value));
    if(new Set(badges).size===1)seller_info.mall_badge=observation(badges[0],"visible_seller_panel");
  }
  const product_metrics={
    rating:field(summaryPanel,/^(?:คะแนนสินค้า|rating)$/iu,"visible_product_summary",value=>/^[0-5](?:\.[0-9]+)?(?:\s*\/\s*5)?$/u.test(value)),
    review_count:field(summaryPanel,/^(?:รีวิว|reviews)$/iu,"visible_product_summary",value=>count.test(value)),
    rating_count:field(summaryPanel,/^(?:การให้คะแนน|ratings)$/iu,"visible_product_summary",value=>count.test(value)),
    sold:field(summaryPanel,/^(?:ขายแล้ว|ขายได้|sold)$/iu,"visible_product_summary",value=>count.test(value))
  };
  if(summaryPanel){
    const ratings=[...summaryPanel.querySelectorAll('.uLEz5u button')].filter(visible);
    for(const [key,pattern] of [["rating",/^([0-5](?:\.[0-9]+)?)$/u],["review_count",/^([0-9][0-9.,]*\s*[km]?\+?)\s*(?:รีวิว|reviews?)$/iu]]){
      if(product_metrics[key])continue;
      const values=[...new Set(ratings.map(node=>pattern.exec(text(node.innerText))?.[1]).filter(Boolean))];
      if(values.length===1)product_metrics[key]=observation(values[0],"visible_product_summary");
    }
  }
  if(summaryPanel && !product_metrics.sold){
    const sold=[...summaryPanel.querySelectorAll("span,div")].slice(0,150).filter(node=>visible(node) && (node.children.length===0 || node.matches('.Ocv3B8') && [...node.children].every(child=>child.tagName==='SPAN' && child.children.length===0)))
      .map(node=>/^(?:ขายแล้ว|ขายได้|sold)\s*[:：]?\s*(.+)$/iu.exec(text(node.innerText,140))?.[1]).filter(value=>value && count.test(value));
    if(new Set(sold).size===1)product_metrics.sold=observation(sold[0],"visible_product_summary");
  }
  const aggregate=product?.aggregateRating;
  if(aggregate && typeof aggregate==="object")for(const [key,property] of [["rating","ratingValue"],["review_count","reviewCount"],["rating_count","ratingCount"]]){
    const value=aggregate[property];
    if(!product_metrics[key] && ["number","string"].includes(typeof value) && /^[0-9]+(?:\.[0-9]+)?$/u.test(String(value)))product_metrics[key]=observation(String(value),"exact_product_json_ld");
  }
  const shipping_info={
    ships_from:field(summaryPanel,/^(?:ส่งจาก|ships from)$/iu,"visible_product_summary"),
    // Deliberately exclude destination/address widgets and unstructured delivery text.
    delivery:field(summaryPanel,/^(?:ระยะเวลาจัดส่ง|จัดส่งภายใน|delivery time)$/iu,"visible_product_summary",value=>/^(?:ภายใน\s*)?[0-9]{1,2}(?:\s*[-–]\s*[0-9]{1,2})?\s*(?:วัน(?:ทำการ)?|days?)$/iu.test(value)),
    shipping_fee:field(summaryPanel,/^(?:ค่าจัดส่ง|shipping fee)$/iu,"visible_product_summary",value=>/^(?:ฟรี|free|(?:฿|THB)?\s*[0-9][0-9,.]*(?:\s*[-–]\s*(?:฿|THB)?\s*[0-9][0-9,.]*)?\s*(?:บาท|THB)?)$/iu.test(value)),
    stock:field(summaryPanel,/^(?:มีสินค้าทั้งหมด|จำนวนสินค้าทั้งหมด|stock)$/iu,"visible_product_summary",value=>count.test(value))
  };
  for(const [key,label] of [["stock",/^(?:คลัง|stock)$/iu],["ships_from",/^(?:ส่งจาก|ships from)$/iu]]){
    if(shipping_info[key])continue;
    const values=[...new Set(specEvidence.filter(item=>label.test(item.label)).map(item=>item.value))];
    if(values.length===1 && (key!=="stock" || count.test(values[0])))shipping_info[key]=observation(values[0],"visible_product_spec");
  }
  return {ok:true,kind:"public_product_detail",...source,observed_at:new Date().toISOString(),name,
    variant_info:variant,spec_evidence:specEvidence,model_evidence:modelEvidence,seller_info,product_metrics,shipping_info,gallery,gallery_complete:false,
    metadata_source:product?"exact_product_json_ld":null,
    layout_evidence:{hydration,main_found:Boolean(main),matched_product_metadata:products.length,
      reader_revision:"0.11.8-seller-variants",seller_panel_found:Boolean(sellerPanel),product_summary_found:Boolean(summaryPanel),
      seller_fields:sellerPanel?[...sellerPanel.querySelectorAll('a,h2,h3,span,div')].filter(node=>visible(node) && (node.children.length===0 || [...node.childNodes].some(child=>child.nodeType===3 && text(child.textContent)))).slice(0,35).map(node=>({tag:node.tagName,class:text(node.className,100),text:text([...node.childNodes].filter(child=>child.nodeType===3).map(child=>child.textContent).join(' '),120),href:node.tagName==='A'?text(node.getAttribute('href'),200):null})):[],
      blocks,identity_signals:identitySignals.map(value=>text(value,2048)),image_candidates:imageCandidates,model_label_contexts:modelContexts,
      headings:main?[...main.querySelectorAll("h1,h2,h3")].slice(0,12).filter(visible).map(node=>text(node.textContent,80)):[],
      field_labels:[...new Set([...specEvidence.map(item=>item.label),...variant.available_options.map(item=>item.label)])].slice(0,20)},retry_automatically:false};
})();
