# ShopKud — Launch & Demo Video Brief

เอกสารนี้คือ source of truth สำหรับ Claude หรือทีมที่ทำ launch video ของ
ShopKud ให้ยึด implementation และ UI จริงใน repository นี้เป็นหลัก หากภาพใน
เอกสารขัดกับ runtime ให้ใช้ runtime ล่าสุดและบันทึกข้อจำกัดตามจริง

Brief นี้ตรวจเทียบกับ ShopKud 0.11.8 และ workflow guide 1.5.6

## 1. Product direction ที่ล็อกแล้ว

ShopKud คือ **AI-native product research and selection workspace สำหรับ Shopee
Affiliate ไทย** ไม่ใช่แค่ MCP ที่คืน tool output และไม่ใช่ระบบโพสต์คอนเทนต์
อัตโนมัติ

แก่นของผลิตภัณฑ์มีสามส่วน:

1. **Agent คิดและตัดสินใจ** — เข้าใจโจทย์ผู้ใช้ เลือกกลยุทธ์ ประเมินความเหมาะสม
   และอธิบายเหตุผล
2. **Deterministic tools ทำ mechanics** — เปิดหน้า Shopee ค้น สแกน กรอง อ่าน
   ค่าคอม ตรวจสินค้า และเก็บหลักฐานด้วยโค้ดที่ทำซ้ำได้
3. **Dashboard เป็น human interface** — ผู้ใช้ดู workflow, comparison, เหตุผล,
   รูปสินค้า และลิงก์หลักฐานบนหน้า visual workspace แทนการอ่าน raw tool output
   ในแชท

ตำแหน่งทางการตลาด:

> ให้ AI ช่วยคัดสินค้า Shopee Affiliate อย่างมีหลักฐาน โดยผู้ใช้เห็นทุกเหตุผล
> เทียบตัวเลือกได้ และย้อนกลับไปตรวจต้นทางได้

ShopKud v1 เน้น **ค้น คัด เปรียบเทียบ และยืนยันสินค้า** งานสร้างภาพ/วิดีโอ
การตัดต่อ การจัดคิว และการโพสต์ข้ามแพลตฟอร์มอยู่ในผลิตภัณฑ์ Shopee Affiliate
Kit แยกต่างหาก ห้ามรวมคำเคลมสองผลิตภัณฑ์ในวิดีโอนี้

## 2. คนที่ผลิตภัณฑ์ช่วย

- คนทำ Shopee Affiliate ที่เสียเวลาหาของและจำไม่ได้ว่าเคยเลือกร้านไหน
- Content creator ที่ต้องเทียบสินค้า ราคา ยอดขาย ค่าคอม และความน่าเชื่อถือ
- ผู้ใช้ non-tech ที่มี AI agent แต่ไม่อยากอ่าน JSON หรือกด Shopee ทีละหน้า
- ทีม/หลาย Agent ที่ต้องทำงานผ่าน Chrome เดียวกันโดยไม่แย่งแท็บ

## 3. ปัญหาที่เล่าในวิดีโอ

ก่อนใช้ ShopKud ผู้ใช้ต้อง:

- เปิดสินค้าหลายหน้าและสลับแท็บจำนวนมาก
- เปรียบเทียบค่าคอมผิดช่องทางได้ง่าย
- เจอเคส ฟิล์ม หรืออุปกรณ์เสริมปนกับสินค้าหลัก
- เลือกสินค้าที่ค่าคอมสูงแต่ร้านหรือยอดขายไม่น่าเชื่อถือ
- ลืมว่าครั้งก่อนเลือกสินค้า ร้าน หรือลิงก์ใดไว้
- ได้คำตอบจาก AI แต่ตรวจย้อนกลับไม่ได้ว่าอ้างจากอะไร

ShopKud เปลี่ยนงานนี้เป็น workflow เดียวที่เห็นได้บน Dashboard

## 4. Workflow จริง

### A. User brief

ผู้ใช้บอก Agent เป็นภาษาธรรมชาติ เช่น:

> หาทีวี 55 นิ้ว 4K ที่ร้านน่าเชื่อถือ ยอดขายดี และค่าคอม Shopee Video คุ้ม

Agent แปลงโจทย์เป็น category, product/accessory intent, ranking goal, channel,
ยอดขายขั้นต่ำ ราคา ความสด และเงื่อนไขร้าน โดยไม่ผ่อนเงื่อนไขเอง

### B. Research report

Agent สรุป niche, trend, purchase intent หรือข้อมูลตลาดจากแหล่งภายนอกของ Agent
แล้วส่งหัวข้อ สรุป ปัจจัยตัดสินใจ และ citation เข้า Dashboard template เดิม
ข้อมูลภายนอกต้องติดป้ายว่าเป็น Agent research ไม่ใช่ข้อมูลที่ ShopKud อ่านจาก
Shopee

### C. Deterministic Shopee discovery

`rank_affiliate_products` เปิด/ใช้ automation tab ใน Chrome profile เดิม สแกน
แบบมีขอบเขต กรองสินค้าที่ไม่ตรงโจทย์ ตรวจค่าคอมจากหน้ารายละเอียด และจัดอันดับ
ตามสูตรที่ Agent เลือก:

- บาทต่อออเดอร์
- เปอร์เซ็นต์ค่าคอม
- ยอดขายที่มองเห็น
- balanced ระหว่างค่าคอมกับ demand

ระบบแยกสินค้าหลักกับ accessory, รักษา hard brand/model terms, ไม่เดาค่าที่หน้า
ไม่แสดง และไม่บอกว่าสแกนครบทั้งตลาดเมื่อหยุดตาม page limit

### D. Agent review

อันดับหนึ่งจากสูตรเป็นเพียง **metric leader** Agent ต้อง review หลักฐานของ
finalist และกำหนดสถานะต่อสินค้า:

- Recommended
- Candidate
- Needs evidence
- Rejected

Agent ตรวจ product type, รุ่น/ตัวเลือก, ราคา, ร้าน, ยอดขาย, ช่องทางค่าคอม และ
ความพอเพียงของหลักฐาน แล้วเขียนเหตุผลที่ผู้ใช้ตรวจได้ ไม่เปิดเผย private
chain-of-thought

### E. Visual decision workspace

Dashboard แสดง:

- workflow stages และสถานะกำลังทำงาน
- research summary, purchase intent และ citations
- product cards พร้อมรูป ชื่อ ราคา ร้าน ยอดขาย และค่าคอมตามช่องทาง
- comparison เรียงตัวเลือกแนวนอน
- เหตุผลของ Agent และ evidence gap
- ลิงก์ไปหน้า Shopee Affiliate, product และ shop ที่ตรวจสอบได้
- Saved workspace/history สำหรับกลับมาดูภายหลังเมื่อเปิด local workspace

### F. Optional follow-up

เมื่อเจ้าของสั่งเท่านั้น ระบบจึงสร้าง/ตรวจ affiliate link หรือใช้ข้อมูลรายงานที่
นำเข้า การรับลิงก์ การ enroll mission และ action ที่มีผลภายนอกไม่เกิดจาก workflow
คัดสินค้าอัตโนมัติ

## 5. Feature inventory

### Human UI

- Full-page Dashboard สำหรับ desktop ไม่ใช่ sidebar หลัก
- Workspace เก็บหลายโครงการและสลับกลับมาดูได้
- Comparison cards พร้อมสถานะ Agent review
- Research/citation panel
- Agent Live แสดง stage, command, latency, browser operations และผลลัพธ์
- Dev Console แสดง log แบบบรรทัดต่อบรรทัด พร้อม input/result preview
- Light/Dark ตามธีมเครื่อง
- Apple-inspired Liquid Glass, สีส้ม/ม่วงสดใส โคซี่ และ mascot ถุงช้อปปิ้ง
- Side Panel เป็น live tracker เสริม ไม่ใช่พื้นที่อ่านผลหลัก

### Agent interface — 19 guided tools

**System**

- `get_workflow_guide`
- `list_pages`
- `reload_extension`
- `selector_health`

**Research**

- `present_research_report`
- `rank_affiliate_products`
- `get_product_detail`
- `search_products_for_content`
- `get_product_media`

**Links/history**

- `create_link`
- `verify_link`
- `batch_create_links`
- `get_product_history`

**Performance**

- `import_report_csv`
- `sales_by`
- `get_conversions`
- `get_earnings_summary`

**Missions**

- `list_missions`
- `enroll_mission`

วิดีโอหลักควรโฟกัส Research + Dashboard ส่วน Links, Performance และ Missions
ให้แสดงเป็น supporting capability สั้น ๆ เพื่อไม่ทำให้ ShopKud ดูเป็นระบบโพสต์
คอนเทนต์

### Local architecture

- Chrome Extension ใช้ profile Shopee ที่ผู้ใช้ล็อกอินอยู่แล้ว
- Local MCP worker ฟังเฉพาะ loopback และเริ่มพร้อม login บน macOS
- หนึ่ง browser queue รองรับหลาย Agent โดยทำ action ต่อคิว
- automation tabs อยู่ใน Chrome Tab Group ชื่อ ShopKud และปิดเมื่อทำงานเสร็จ
- cache เปิดเผยอายุข้อมูล: live, recent 60 วินาที, fast 10 นาที
- persistent workspace ใช้ embedded SQLite แบบ opt-in ไม่มี database server
- ไม่มี Docker, cloud backend หรือ Shopee private API เป็น requirement

## 6. Main launch video — recommended structure

ความยาวหลัก 60–90 วินาที; ทำ cutdown 30–45 วินาทีสำหรับ X/TikTok ได้

### Beat 1 — Hook (0–5s)

ภาพ: แท็บ Shopee จำนวนมากเด้งซ้อนกัน ตัวเลขราคา/คอมกระจัดกระจาย แล้วถูกดูดรวม
เข้า ShopKud Dashboard

ข้อความ:

> ทำ Shopee Affiliate แต่เสียเวลาคัดของมากกว่าทำคอนเทนต์?

### Beat 2 — Ask once (5–13s)

ใช้ footage จริง: พิมพ์ brief ใน Agent หนึ่งประโยค จากนั้นสลับไป Dashboard
ทันที ไม่โชว์ raw JSON

ข้อความ:

> บอก Agent ว่าอยากขายอะไร และเกณฑ์ไหนสำคัญ

### Beat 3 — See the workflow (13–25s)

ใช้ UI จริง: stage tracker ค่อย ๆ เดินจากอ่านโจทย์ → research → ค้น Shopee →
ตรวจรายละเอียด → เปรียบเทียบ Agent Live/Dev Console เคลื่อนไหวต่อเนื่องแบบ smooth
ไม่เด้งข้อมูลเป็นก้อนทุกสามวินาที

Motion graphic overlay อธิบายสั้น ๆ:

> AI ตัดสินใจ · Code ทำงานซ้ำได้ · ทุกอย่างมีหลักฐาน

### Beat 4 — Compare evidence (25–43s)

ใช้ UI จริง: product cards 3–5 ใบเลื่อนเข้ามา เทียบรูป ราคา ยอดขาย Mall และ
ค่าคอมช่องทางเดียวกัน กด card หนึ่งใบเพื่อเปิด detail/evidence ใช้ cursor จริง
และให้ citation/link ไฮไลต์

ต้องแสดงอย่างน้อยหนึ่งกรณีที่ระบบตัด accessory หรือสินค้าที่หลักฐานไม่พอออก
เพื่อสื่อ guardrail

### Beat 5 — Agent judgment (43–57s)

ใช้ UI จริง: metric leader เปลี่ยนเป็น Recommended/Candidate/Needs evidence หลัง
Agent review พร้อมเหตุผลสั้น ๆ เน้นว่า AI ไม่ได้เลือกเพราะค่าคอมสูงอย่างเดียว

ข้อความ:

> ตัวเลือกที่คุ้ม ต้องขายได้ น่าเชื่อถือ และตรงโจทย์จริง

### Beat 6 — Keep the work (57–68s)

ใช้ UI จริง: กดเก็บสินค้า เปิด Workspace แล้วสลับระหว่างโครงการ เช่น ทีวี →
Power Bank → ของใช้ในบ้าน เพื่อยืนยันว่า Dashboard เป็น template แบบ dynamic
ไม่ใช่หน้าเฉพาะทีวี

### Beat 7 — Local + open source close (68–80s)

Motion graphic: Agent ↔ ShopKud MCP ↔ local Chrome พร้อม shield/lock เล็ก ๆ
จากนั้นจบด้วย mascot/logo และ Dashboard hero

ข้อความปิด:

> ShopKud — ค้นหา · เปรียบเทียบ · เลือกให้พร้อมทำคอนเทนต์

CTA:

> Open source on GitHub

## 7. Required real demo shots

Claude ควรวาง capture checklist ตามลำดับนี้:

1. เปิด ShopKud Dashboard แบบเต็มหน้า
2. ส่ง user brief ให้ Agent
3. เห็น working report และ stage tracker เริ่มทำงาน
4. เห็น Agent Live/Dev Console ขยับต่อเนื่อง
5. เห็น product comparison หลัง live run สำเร็จ
6. กดเปิด evidence หรือ Shopee source จาก card
7. เห็น Agent decision พร้อมเหตุผล ไม่ใช่ metric winner อย่างเดียว
8. เก็บ/เปิด Workspace และกลับมาดูโครงการเดิม
9. สลับโครงการคนละหมวดเพื่อยืนยัน UI แบบ dynamic
10. ปิดด้วยภาพ architecture แบบเข้าใจง่าย ไม่ใช้ diagram เชิงวิชาการ

ก่อนถ่าย ต้องใช้ live run ที่ผ่านจริงและไม่มี `search_context_changed`,
`listing_tab_not_idle` หรือ unconfirmed result ห้ามแต่งผลสำเร็จใน post-production

## 8. Visual direction

- สดใส น่ารัก โคซี่ และพรีเมียมแบบ Apple ไม่ใช่ dashboard SaaS สีเทาทั่วไป
- ใช้ glass/liquid material อย่างมี restraint: blur, edge highlight, depth และ
  spring response บน interaction สำคัญ
- สีหลัก warm orange/coral; สีรอง indigo/lilac; success green
- background มี warm room glow หรือ soft gradient เพื่อเชื่อมกับ key visual
- mascot เป็นตัวช่วยนำสายตา ไม่บังข้อมูลสินค้า
- product imagery ต้องมาจากหลักฐานจริงใน run ที่ใช้เดโม
- motion ต้องลื่น ต่อเนื่อง และ interruptible; หลีกเลี่ยงข้อมูลเด้งมาทีละก้อนแบบ
  polling
- ใช้ตัวอักษรไทยอ่านง่าย ตัวเลขราคา/ค่าคอมเด่น และลดข้อความต่อเฟรม

## 9. Claims ที่พูดได้

- ทำงานกับ AI agent ผ่าน MCP
- ใช้ Chrome profile ที่ผู้ใช้ล็อกอินอยู่แล้ว
- ค้น/กรอง/เปรียบเทียบสินค้าแบบมีขอบเขต
- อ่านราคา ยอดขายที่แสดง ค่าคอมตามช่องทาง และหลักฐานที่หน้ารองรับ
- Agent review ผลก่อนแนะนำ
- แสดงผลและ citation บน visual Dashboard
- เก็บประวัติในเครื่องเมื่อผู้ใช้เปิด local workspace
- เปิดเผย cache age, partial coverage และข้อมูลที่ยังไม่ทราบ
- Open source และ local-first

## 10. Claims ที่ห้ามพูด

- ห้ามบอกว่า ShopKud เจนวิดีโอ โพสต์ข้ามแพลตฟอร์ม หรือทำ end-to-end content
  production; นั่นคือ Shopee Affiliate Kit ในอนาคต
- ห้ามบอกว่าสแกนครบทั้ง Shopee หรือรู้ trend/ยอดโฆษณาของร้านจาก Shopee เอง
- ห้ามรับรองรายได้ ของแท้ สต็อก ราคา หรือค่าคอมในอนาคต
- ห้ามบอกว่าไม่มีวันโดน bot detection หรือรองรับทุก layout/account
- ห้ามเรียก metric winner ว่า AI recommendation ก่อน Agent review
- ห้ามซ่อน null, partial coverage หรือ evidence gap ในเดโม

## 11. Future direction — end card หรือ caption เท่านั้น

วิสัยทัศน์ระยะต่อไปคือ AI-native Shopee Affiliate loop ที่เชื่อม Trend → Product
→ Content → Publish → Performance → Learning แต่ไม่ควรเล่าเป็นฟีเจอร์ปัจจุบัน
ของ ShopKud v1

หากต้องกล่าว ให้ใช้ประโยค:

> ShopKud คือ product-selection layer แรกของ Affiliate workflow ที่ใหญ่กว่า

## 12. Acceptance gate ก่อนทำ final video

- source/runtime/extension version ตรงกัน
- 19 guided tools ตรงกับรายการในเอกสารนี้
- live discovery run จบครบและ Dashboard ผูก report/trace ถูกต้อง
- ไม่มี accessory หรือสินค้าผิดประเภทในตัวเลือกที่แนะนำ
- ทุก recommendation มีเหตุผลและ source link
- tab group สะอาดหลังจบงาน
- Workspace เปิดโครงการเดิมได้
- footage ไม่มี token, cookie, account secret หรือข้อมูลส่วนตัว
- UI text ไม่เคลมเกิน evidence ที่เห็น

## 13. Source map สำหรับ Claude

ให้อ่านไฟล์เหล่านี้ก่อนเริ่ม โดยไม่ต้องสำรวจทั้ง repo:

- `docs/LAUNCH_DEMO_BRIEF.md` — direction, story และข้อห้ามของวิดีโอ
- `README.md` — คำอธิบาย public และวิธีติดตั้งจริง
- `docs/ARCHITECTURE.md` — architecture ที่ยืนยันแล้ว
- `shopkud_mcp/skills/shopkud-affiliate/SKILL.md` — วิธีที่ Agent ถูก govern
- `shopkud_mcp/skills/shopkud-affiliate/references/workflow.md` — workflow จริง
- `extension/dashboard.html`, `extension/dashboard.css`,
  `extension/dashboard.js` — UI ที่ต้อง capture จริง
- `docs/assets/shopkud-social-promo.png` — mood/mascot/color reference
- `docs/assets/architecture.png` — architecture reference; ลดความเป็น technical เมื่อใช้ในวิดีโอ

อย่าแก้ product UI หรือสร้างหน้า mock เพิ่มเพื่อให้วิดีโอดูสำเร็จ ใช้ Dashboard template
เดิมและข้อมูลจาก live run ที่ผ่าน acceptance เท่านั้น Motion graphic ใช้ช่วยอธิบายสิ่งที่
ระบบทำจริง ไม่ใช้แทนหลักฐานการทำงาน

## 14. Copy-paste handoff prompt for Claude

```text
คุณกำลังทำ launch + demo video ให้ ShopKud ใน repo นี้

อ่าน docs/LAUNCH_DEMO_BRIEF.md ก่อน แล้วอ่านเฉพาะ source map ใน section 13
ShopKud v1 คือ AI-native product research and selection workspace สำหรับ Shopee
Affiliate ไทย ไม่ใช่ตัวเจนวิดีโอหรือโพสต์ข้ามแพลตฟอร์ม

เป้าหมายคือวิดีโอหลัก 60–90 วินาที และ cutdown 30–45 วินาทีที่ผสม:
1) motion graphic อธิบาย pain point และ architecture แบบ non-tech
2) screen demo จริง: brief → live stages → comparison → Agent review → evidence → Saved Workspace

Visual direction: สดใส น่ารัก โคซี่ พรีเมียมแบบ Apple; warm orange/coral +
indigo/lilac, liquid glass อย่างพอดี, mascot ช่วยนำสายตา, motion ลื่นและต่อเนื่อง
ไม่ทำ SaaS dashboard สีเทาทั่วไป

ก่อนเขียน/เรนเดอร์ final:
- ทำ storyboard พร้อม timecode, shot, on-screen copy, narration, transition และ source asset
- ทำ capture checklist ที่ผูกทุก demo shot กับ UI/runtime จริง
- ใช้ผล live run ที่ผ่านเท่านั้น ห้ามซ่อน null/evidence gap หรือเรียก metric leader ว่า recommendation ก่อน Agent review
- ห้ามแก้ ShopKud codebase เพื่อสร้างผลเดโม และห้ามเผย token/cookie/account detail
- ใช้คำว่า ShopKud เป็นผู้ทำ deterministic mechanics และใช้คำว่า Agent เป็นผู้ research/review/decide

ประโยคหลัก:
“ให้ AI ช่วยคัดสินค้า Shopee Affiliate อย่างมีหลักฐาน โดยผู้ใช้เห็นทุกเหตุผล
เทียบตัวเลือกได้ และย้อนกลับไปตรวจต้นทางได้”

CTA: “ShopKud — ค้นหา · เปรียบเทียบ · เลือกให้พร้อมทำคอนเทนต์”
ปิดด้วย “Open source on GitHub”

เริ่มจากเสนอ storyboard และรายการ footage ที่ต้อง capture ก่อน อย่าเริ่ม render
จนกว่าจะตรวจว่าทุก claim ตรงกับ implementation ปัจจุบัน
```

