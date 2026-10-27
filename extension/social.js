(() => {
  "use strict";
  const $=selector=>document.querySelector(selector), api=globalThis.chrome;
  const platforms=[['facebook','Facebook','facebook'],['x','X','x'],['tiktok','TikTok','tiktok'],['youtube','YouTube','youtube'],['instagram','Instagram','instagram'],['threads','Threads','threads'],['line','LINE','line'],['shopee_video','Shopee Video','shopee']];
  const aliases={fb:'facebook',yt:'youtube',ig:'instagram',tt:'tiktok',twitter:'x',video:'shopee_video'};
  const key='shopkudSocialLinks', receiptKey='shopkudLinkReceipts';
  let stored={}, receipts=[], products=[], platform='', busy=false, reports=new Map();
  const el=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls||'';if(text!==undefined)n.textContent=text;return n;};
  const str=value=>typeof value==='string'?value:'';
  const normalize=value=>{const v=str(value).toLowerCase();return platforms.some(p=>p[0]===v)?v:aliases[v]||'';};
  const safeLink=value=>{try{const u=new URL(value);return u.protocol==='https:'&&u.hostname==='s.shopee.co.th'&&!u.port&&!u.username&&!u.password&&!u.search&&!u.hash&&/^\/[A-Za-z0-9]+$/.test(u.pathname)?u.href:null;}catch{return null;}};
  const slots=value=>Array.from({length:5},(_,i)=>str(Array.isArray(value)?value[i]:value?.[`sub_id_${i+1}`]).slice(0,128));
  const stamp=value=>Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('th-TH'):'ไม่ทราบเวลา';
  function message(value){$('#social-message').textContent=value;$('#social-message').hidden=!value;}
  function icon(id){const p=platforms.find(p=>p[0]===id);if(!p)return null;const image=el('img','platform-icon');image.src=`platform-${p[2]}.svg`;image.alt='';return image;}
  function records(){
    const map=new Map();
    for(const row of [...Object.values(stored),...receipts]){
      const url=safeLink(row?.affiliate_url);if(!url||!/^\d{1,20}$/.test(str(row.product_id))||(row.source!=='manual'&&row.status!=='confirmed'))continue;
      if(map.has(url))continue;
      const meta=stored[url]||{}, product=products.find(p=>p?.product_id===row.product_id), ids=slots(row.sub_ids);
      const explicit=normalize(meta.platform||row.channel), inferred=normalize(ids[0]);
      map.set(url,{...row,...meta,affiliate_url:url,sub_ids:ids,platform:explicit||inferred,name:str(meta.name)||str(product?.name)||`สินค้า ${row.product_id}`,inferred:!explicit&&Boolean(inferred),used:meta.used===true});
    }
    return [...map.values()].sort((a,b)=>(Date.parse(b.created_at)||0)-(Date.parse(a.created_at)||0));
  }
  async function save(row,changes){
    if(busy)return;busy=true;
    try{
      const latest=await api.storage.local.get(key), prior=latest[key]&&typeof latest[key]==='object'&&!Array.isArray(latest[key])?latest[key]:{};
      if(!prior[row.affiliate_url]&&Object.keys(prior).length>=500)throw new Error('limit');
      const persisted={...row};delete persisted.inferred;
      if(row.inferred)delete persisted.platform;
      const next={...prior,[row.affiliate_url]:{...persisted,...prior[row.affiliate_url],...changes,affiliate_url:row.affiliate_url}};
      await api.storage.local.set({[key]:next});stored=next;render();message('บันทึกใน Chrome เครื่องนี้แล้ว');
    }catch{message('บันทึกไม่สำเร็จ พื้นที่เก็บข้อมูลอาจเต็มหรือไม่พร้อม รายการเดิมยังอยู่');}
    finally{busy=false;}
  }
  function render(){
    const rows=records(), query=$('#social-search').value.trim().toLowerCase(), status=$('#social-status').value;
    $('#social-platforms').replaceChildren();
    for(const [id,label] of [['','ทั้งหมด'],...platforms,['unknown','ยังไม่ระบุ']]){
      const button=el('button','platform-filter');button.type='button';button.setAttribute('aria-pressed',String(platform===id));const image=icon(id);if(image)button.append(image);
      button.append(el('span','',label),el('span','count',String(rows.filter(r=>!id||(id==='unknown'?!r.platform:r.platform===id)).length)));
      button.onclick=()=>{platform=id;render();};$('#social-platforms').append(button);
    }
    const filtered=rows.filter(r=>(!platform||(platform==='unknown'?!r.platform:r.platform===platform))&&(!query||[r.name,r.product_id,r.affiliate_url,...r.sub_ids].join(' ').toLowerCase().includes(query))&&(status==='all'||(status==='used')===r.used));
    $('#social-count').textContent=`${filtered.length} ลิงก์`;
    const list=$('#social-links');list.replaceChildren();
    if(!filtered.length){list.append(el('p','empty-state panel',rows.length?'ไม่พบลิงก์ตามตัวกรองนี้ ลองเปลี่ยนแพลตฟอร์มหรือคำค้น':'ยังไม่มีลิงก์ที่บันทึกไว้ เมื่อ Agent สร้างลิงก์สำเร็จจะแสดงที่นี่ หรือเพิ่มลิงก์เดิมด้านล่าง'));return;}
    for(const row of filtered){
      const card=el('article','social-link panel'), heading=el('div','social-link-heading'), image=icon(row.platform);if(image)heading.append(image);
      const title=el('div');title.append(el('h2','',row.name),el('p','subtle',`${platforms.find(p=>p[0]===row.platform)?.[1]||'ยังไม่ระบุแพลตฟอร์ม'}${row.inferred?' · แนะนำจาก SubID โปรดตรวจ':''} · ${stamp(row.created_at)}`));heading.append(title);
      const badge=el('span','source-badge',row.used?'คุณบันทึกว่าใช้แล้ว':'ยังไม่บันทึกการใช้');heading.append(badge);card.append(heading);
      const link=el('a','social-url',row.affiliate_url);link.href=row.affiliate_url;link.target='_blank';link.rel='noopener noreferrer';card.append(link);
      const actions=el('div','link-actions'), copy=el('button','button small','คัดลอกลิงก์'), use=el('button','button small quiet',row.used?'เปลี่ยนเป็นยังไม่ใช้':'บันทึกว่าใช้แล้ว');
      copy.onclick=async()=>{try{await navigator.clipboard.writeText(row.affiliate_url);message('คัดลอกลิงก์แล้ว');}catch{message('คัดลอกไม่ได้ เลือกข้อความลิงก์แล้วคัดลอกเองได้');}};
      use.onclick=()=>save(row,{used:!row.used});actions.append(copy,use);card.append(actions);
      card.append(el('p','subtle','ยังไม่ยืนยัน SubID หรือค่าคอมจากรายงาน Shopee'));
      const details=el('details','link-details');details.append(el('summary','', 'แพลตฟอร์ม · SubID · บันทึกการใช้งาน'));
      const form=el('form','link-edit'), select=el('select');select.name='platform';const unknown=el('option','','ยังไม่ระบุ');unknown.value='';select.append(unknown);
      for(const [id,label] of platforms){const option=el('option','',label);option.value=id;select.append(option);}select.value=row.platform;
      const platformLabel=el('label','','ใช้กับแพลตฟอร์ม');platformLabel.append(select);form.append(platformLabel);
      const note=el('input');note.name='note';note.maxLength=300;note.value=str(row.note);const noteLabel=el('label','','โน้ต / ชื่อโพสต์');noteLabel.append(note);form.append(noteLabel);
      const submit=el('button','button small','บันทึก');submit.type='submit';form.append(submit);
      form.onsubmit=event=>{event.preventDefault();save(row,{platform:select.value,note:note.value});};details.append(form);
      const ids=el('dl','subid-slots');row.sub_ids.forEach((value,i)=>{if(row.sub_id_positions_preserved||value)ids.append(el('dt','',row.sub_id_positions_preserved?`SubID ${i+1}`:'ค่าที่เก็บไว้'),el('dd','',value||'ไม่ได้ระบุ'));});
      if(!row.sub_id_positions_preserved&&row.sub_ids.some(Boolean))details.append(el('p','subtle','บันทึกรุ่นเก่า: ยังยืนยันตำแหน่งช่อง SubID เดิมไม่ได้'));
      details.append(ids,el('p','subtle',`สินค้า ${row.product_id} · การเลือกแพลตฟอร์มที่นี่ไม่แก้ SubID ของลิงก์เดิม`));card.append(details);list.append(card);
    }
  }
  async function load(){
    try{const data=await api.storage.local.get([key,receiptKey,'shopkudSavedProducts','shopkudResearchHistory']);stored=data[key]&&typeof data[key]==='object'&&!Array.isArray(data[key])?data[key]:{};receipts=Array.isArray(data[receiptKey])?data[receiptKey]:[];products=[...(Array.isArray(data.shopkudSavedProducts)?data.shopkudSavedProducts:[]),...(Array.isArray(data.shopkudResearchHistory)?data.shopkudResearchHistory:[]).flatMap(h=>Array.isArray(h?.dashboard?.results)?h.dashboard.results:[])];render();}
    catch{message('อ่านข้อมูลที่เก็บไว้ไม่ได้ เปิดหน้านี้จาก ShopKud Extension แล้วลองใหม่');}
  }
  const platformSelect=$('#social-add-platform');for(const [id,label] of platforms){const option=el('option','',label);option.value=id;platformSelect.append(option);}
  $('#social-search').oninput=render;$('#social-status').onchange=render;
  $('#social-add').onsubmit=async event=>{event.preventDefault();const data=new FormData(event.target),url=safeLink(data.get('url'));if(!url){message('ใช้ลิงก์สั้น https://s.shopee.co.th/ ที่ไม่มีพารามิเตอร์เพิ่มเติม');return;}await save({affiliate_url:url,product_id:String(data.get('product_id')),name:String(data.get('name')),created_at:new Date().toISOString(),sub_ids:[],source:'manual'},{platform:data.get('platform')});};
  api?.storage?.onChanged?.addListener((changes,area)=>{if(area==='local'&&[key,receiptKey,'shopkudSavedProducts','shopkudResearchHistory'].some(k=>changes[k]))load();});
  function showReport(value){
    $('#analytics-result').hidden=true;
    if(!value?.ok){$('#analytics-message').textContent='ยังอ่านรายงานไม่ได้ เปิดรายงานคลิกใน Shopee และรอให้ตารางโหลดครบ แล้วอ่านใหม่';return;}
    $('#analytics-message').textContent='อ่านข้อมูลจากหน้า Shopee แล้ว · เป็นภาพข้อมูล ณ เวลาที่ตรวจ';
    $('#analytics-provenance').textContent=`${value.period_start||'ไม่ทราบวันเริ่ม'} ถึง ${value.period_end||'ไม่ทราบวันสิ้นสุด'} · อ่าน ${value.visible_rows} แถว${Number.isSafeInteger(value.total_rows)?` จาก ${value.total_rows} แถวในรายงาน`:''} · ตรวจ ${stamp(value.observed_at)} · เฉพาะหน้าที่เปิดอยู่`;
    const table=el('table'),head=el('tr');for(const name of ['SubID','แหล่งอ้างอิง','คลิกที่เห็น'])head.append(el('th','',name));const thead=el('thead');thead.append(head);table.append(thead);const body=el('tbody');
    for(const group of value.groups||[]){const row=el('tr');row.append(el('td','',group.sub_id||'ไม่ระบุ'),el('td','',group.referrer||'ไม่ระบุ'),el('td','',String(group.clicks)));body.append(row);}table.append(body);$('#analytics-groups').replaceChildren(table);if(!value.groups?.length)$('#analytics-groups').append(el('p','empty-state','Shopee แสดงว่าไม่มีข้อมูลในช่วงวันที่และตัวกรองนี้'));$('#analytics-result').hidden=false;
  }
  $('#analytics-tabs').onchange=()=>showReport(reports.get($('#analytics-tabs').value));
  $('#analytics-open').onclick=async()=>{try{await api.tabs.create({url:'https://affiliate.shopee.co.th/report/click_report',active:true});}catch{$('#analytics-message').textContent='เปิดรายงานไม่ได้ ให้เปิด Shopee Affiliate → รายงานคลิก';}};
  $('#analytics-refresh').onclick=async()=>{
    const button=$('#analytics-refresh');button.disabled=true;$('#analytics-result').hidden=true;$('#analytics-message').textContent='กำลังค้นหารายงานที่เปิดอยู่…';
    try{
      const tabs=(await api.tabs.query({})).filter(t=>Number.isInteger(t.id)).slice(0,100);reports=new Map();
      await Promise.all(tabs.map(async t=>{try{const result=await Promise.race([api.tabs.sendMessage(t.id,{type:'shopkud-read-click-report'},{frameId:0}),new Promise(resolve=>setTimeout(()=>resolve(null),2500))]);if(result?.ok===true&&result.schema_version===1&&result.source_url==='https://affiliate.shopee.co.th/report/click_report'&&result.coverage==='visible_page_only'&&Array.isArray(result.groups))reports.set(String(t.id),result);}catch{}}));
      const select=$('#analytics-tabs');select.replaceChildren();const prompt=el('option','',reports.size?'เลือกรายงานที่ต้องการดู':'ไม่พบรายงานที่อ่านได้');prompt.value='';select.append(prompt);
      for(const [id,r] of reports){const option=el('option','',`${r.period_start||'?'} – ${r.period_end||'?'} · ${r.visible_rows} แถว · แท็บ ${id}`);option.value=id;select.append(option);}
      if(reports.size===1){select.value=reports.keys().next().value;showReport(reports.get(select.value));}else $('#analytics-message').textContent=reports.size?'พบหลายแท็บ เลือกรายงานก่อนแสดงข้อมูล':'เปิดรายงานคลิก Shopee แล้วรอให้โหลดครบ หากเพิ่งอัปเดต Extension ให้รีเฟรชแท็บรายงานก่อน';
    }catch{$('#analytics-message').textContent='เชื่อมต่อ Chrome ไม่ได้ เปิดหน้านี้ผ่าน ShopKud Extension';}finally{button.disabled=false;}
  };
  load();
})();
