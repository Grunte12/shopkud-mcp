(function(root,factory){
  const api=factory();
  if(typeof module==="object" && module.exports)module.exports=api;
  else root.ShopKudReviewData=api;
})(typeof globalThis!=="undefined"?globalThis:this,()=>{
  "use strict";
  const TTL=600000;
  const copy=value=>value===undefined?null:JSON.parse(JSON.stringify(value));
  function keep(plan,ids,now=Date.now()){
    if(plan.used || plan.invalidated || now-plan.created>TTL)return false;
    if(!Array.isArray(ids) || ids.length>20 || ids.some(id=>typeof id!=="string") || new Set(ids).size!==ids.length)return false;
    const original=new Set(plan.records.map(r=>r.product_id));
    if(ids.some(id=>!original.has(id)))return false;
    plan.kept_ids=plan.records.filter(r=>ids.includes(r.product_id)).map(r=>r.product_id);
    plan.decision_source="human";plan.decision_version=(plan.decision_version || 0)+1;plan.decision_at=now;
    return true;
  }
  function bundle(plan,id,{limit=10,offset=0,view="brief",now=Date.now()}={}){
    if(!Number.isInteger(limit) || limit<1 || limit>20 || !Number.isInteger(offset) || offset<0 || offset>19 || !["brief","full"].includes(view))return {ok:false,error:"invalid_input"};
    const state=plan.used?(plan.result?"consumed":"applying"):plan.invalidated?"invalidated":now-plan.created>TTL?"expired":"ready";
    const part=plan.records.slice(offset,offset+limit);
    const records=part.map(r=>view==="full"?{observation:copy(r),analysis:copy(plan.picks.find(p=>p.product_id===r.product_id))}:{product_id:r.product_id,name:r.name,price_min_thb:r.price_min_thb ?? null,commission_pct:r.commission_pct ?? null,kept:plan.kept_ids.includes(r.product_id)});
    return {ok:true,schema_version:1,kind:"shopkud_review_bundle",plan_id:id,view,
      source_page:"https://affiliate.shopee.co.th/offer/product_offer",observed_at:new Date(plan.observed_at || plan.created).toISOString(),prepared_at:new Date(plan.created).toISOString(),
      plan_state:state,can_apply:state==="ready" && plan.kept_ids.length>0,
      expires_in_seconds:Math.max(0,Math.floor((plan.created+TTL-now)/1000)),
      decision:{source:plan.decision_source || "initial_plan",version:plan.decision_version || 0,changed_at:plan.decision_at?new Date(plan.decision_at).toISOString():null,kept_product_ids:[...plan.kept_ids],excluded_product_ids:plan.records.filter(r=>!plan.kept_ids.includes(r.product_id)).map(r=>r.product_id)},
      execution:plan.result?copy(plan.result):null,execution_at:plan.executed_at?new Date(plan.executed_at).toISOString():null,execution_is_historical:true,invalidated_reason:plan.invalidated || null,
      total:plan.records.length,offset,next_offset:offset+part.length<plan.records.length?offset+part.length:null,records,
      observations_only:true,evidence_is_not_truth_certification:true,requires_explicit_apply:true,authorization_is_not_transferred:true,requires_fresh_page_snapshot_before_new_selection:true};
  }
  const escaped=value=>String(value ?? "ไม่ทราบ").replace(/[\\`*_{}\[\]()#+.!<>|]/g,"\\$&");
  const line=value=>escaped(value).replace(/[\r\n]+/g," ");
  function markdown(packet){
    const state={ready:"พร้อมตรวจ",consumed:"ใช้แผนแล้ว",applying:"กำลังดำเนินการ",invalidated:"ข้อมูลเปลี่ยน",expired:"หมดอายุ"};
    const out=["# ชุดคัดสินค้า ShopKud",`ข้อมูลเมื่อ: ${line(packet.observed_at)}`,`สถานะแผน: ${state[packet.plan_state] || "ไม่ทราบ"}`,"",`เก็บไว้ในแผน ${packet.decision.kept_product_ids.length} จาก ${packet.total} ชิ้น`,"ตัวเลือกในแผนไม่ใช่หลักฐานว่าสินค้าถูกเลือกบนหน้าเว็บแล้ว","บันทึกนี้ไม่ให้สิทธิ์เจนสื่อ ใช้เครดิต หรือโพสต์งาน","ข้อมูลและแหล่งอ้างอิงยังต้องตรวจสอบ ไม่ใช่รายได้คาดการณ์",""];
    for(const entry of packet.records){
      const r=entry.observation,p=entry.analysis || {};
      if(!r)continue;
      out.push(`## ${line(r.name)}`,`รหัสสินค้า: ${line(r.product_id)}`,`ตัวเลือก: ${packet.decision.kept_product_ids.includes(r.product_id)?"เก็บไว้":"ไม่เก็บ"}`,`ราคาที่สังเกต: ${line(r.price_min_thb)} บาท; ค่าคอมมิชชันที่แสดง: ${line(r.commission_pct)}%`,"",`เหตุผล: ${escaped(p.reason)}`,`ฉากคอนเทนต์: ${escaped(p.content_angle)}`,`ความมั่นใจของเอเจนต์: ${{low:"ต่ำ",medium:"ปานกลาง",high:"สูง"}[p.confidence] || "ไม่ทราบ"}`,"ความเสี่ยง:",...(p.risks?.length?p.risks.map(x=>`- ${line(x)}`):["- เอเจนต์ไม่ได้ระบุ ไม่ได้หมายความว่าไม่มีความเสี่ยง"]),"แหล่งข้อมูล:",...(p.evidence || []).map(e=>`- ${line(e.title)}: ${line(e.url)}`),"");
    }
    if(packet.execution){const x=packet.execution;out.push("## ผลการดำเนินการ",{completed:"ดำเนินการครบตามที่ระบบตรวจได้ ไม่ใช่หลักฐานยอดขาย",partial:"ดำเนินการได้บางส่วน ยังไม่ใช่การทำงานสำเร็จครบแผน",unconfirmed:"ผลไม่แน่ชัด บางสินค้าอาจถูกเลือกแล้ว ห้ามทำคำสั่งซ้ำ",not_applied:"ยังไม่ได้ดำเนินการ"}[x.outcome] || "ยังระบุผลที่แน่ชัดไม่ได้","ผลนี้เป็นบันทึก ณ เวลาที่ทำงาน ไม่ใช่สถานะการติ๊กบนหน้าเว็บในปัจจุบัน",`เลือกแล้ว: ${line((x.applied || []).join(", "))}`,`เลือกอยู่ก่อน: ${line((x.already_selected || []).join(", "))}`,`ไม่แน่ชัด: ${line((x.uncertain || []).join(", "))}`,`ข้อมูลเปลี่ยน: ${line((x.changed || []).join(", "))}`,`ยังไม่ได้ลองเลือก: ${line((x.not_attempted || []).join(", "))}`);}
    else out.push("## ผลการดำเนินการ","ยังไม่มีผลการเลือกที่บันทึกไว้ ห้ามตีความตัวเลือกในแผนเป็นผลสำเร็จ");
    return out.join("\n");
  }
  return {keep,bundle,markdown};
});
