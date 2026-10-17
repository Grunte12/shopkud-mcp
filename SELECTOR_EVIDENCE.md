# Selector and assumption evidence

Checked against public Shopee help pages on 17 October 2026. Nothing here is a live capture from a logged-in Affiliate TH session. DOM attribute names that the help pages do not show stay unverified.

## Evidence-backed

| Item | What is used | Source |
|---|---|---|
| Prohibited categories that earn no commission | `เครื่องประดับ`, `โลหะมีค่าเพื่อการลงทุน`, `แหวน`, `ต่างหู`, `กำไลข้อมือ`, `กำไลข้อเท้า`, `ชาร์ม`, `จี้`, `อาวุธ`, `บุหรี่`, `ยาสูบ`, `สิ่งมีชีวิตและซากสัตว์`, `การบริการ`, `Utilites`, `Donation`, `Local Service`, `Investment`, `นมผง` | [TH article 132895](https://help.shopee.co.th/portal/10/article/132895) |
| Get Link, Convert, Copy the Link, Custom Link, sub_id, up to 5 Sub IDs, Batch Get Link, Offer Link column | Button and dialog name patterns in `extension/selectors.js` | [SG article 191696](https://help.shopee.sg/10/article/191696-Affiliate-Link-Generation) |
| KYC label `ยืนยัน (Valid)`, minimum accumulated commission 100 baht, non-VAT individuals paid twice a week on new bills, VAT-registered and juristic persons paid twice a month including historical bills, phrase `รอบการจ่ายถัดไป` | `PAYOUT_FACTS` and the KYC / next-cycle text checks | [TH article 142437](https://help.shopee.co.th/portal/10/article/142437) |
| Creator levels are 0, 1, and 2. The level refreshes every Tuesday from the prior 28 days. The control lives in Creator Center inside the Shopee app | `VIDEO_REFRESH_DAY = tuesday`, levels `[0, 1, 2]`. Day, order, and influence numbers were not extracted cleanly and are not applied | [TH article 203761](https://help.shopee.co.th/portal/10/article/203761) |
| Creator Center, Video Mission, Core Data, Audience Distribution, Weekly Report, Creator Leaderboard, Weekly Inspiration are in-app Shopee Video labels | Diagnostic check `creator_center_labels`, evidence `mixed` because this extension is not injected into the app | [TH article 147479](https://help.shopee.co.th/4/article/147479) |
| Singapore creator thresholds (Lv.0 under 5 days and 5 orders, Lv.1 at least 5 days and 65 orders, Lv.2 at least 10 days, 110 orders, influence 20) | Recorded as not applied. The snippet is Singapore, not Thailand | [SG article 199073](https://help.shopee.sg/10/article/199073-Guidelines-on-Creator-Levelling-as-a-Shopee-Video-Live-Creator) |

The SG link article describes the desktop and app flows. It does not publish the TH portal's input `name`, placeholder, or CSS. Numbered Sub ID patterns are therefore `mixed`: the words and the five-slot limit are cited, the DOM binding is not.

## Repo fixtures, not a new live capture

These strings already existed in `extension/detail.js`, `extension/subid.js`, and `tests/detail-fixture.cjs`. The diagnostic recognizes them and marks them `repo_fixture`.

- Dialog title `ลิงก์ข้อเสนอสินค้า`
- Buttons `รับลิงก์` and `เอาลิงก์`
- Commission headers `ประเภทช่องทาง`, `ค่าคอมช้อปปี้`, and a header containing `โดยประมาณ`
- Channel labels `โซเชียลมีเดีย`, `ช้อปปี้ไลฟ์`, `ช้อปปี้วีดีโอ`

The offer parser still requires that Thai table shape. English header names are reported by the diagnostic only.

## Still unverified

- There is no official page named My Links in the SG link article. `ลิงก์ของฉัน`, `My Links`, and `รายงานการแปลง` remain guesses in `extension/verify.js`. A recognized page is required before ownership can be false. An unsupported or paginated page stays unknown.
- English and Thai earnings words `Pending`, `Validated`, `Paid`, `รอดำเนินการ`, `ตรวจสอบแล้ว`, `จ่ายแล้ว` are not in article 142437.
- `รหัสย่อย` as a SubID label.
- A 15-second qualifying clip rule, and any numeric TH level ladder. `min_clip_seconds` is null.
- A 180-day earnings expiry. Article 142437 was checked. The local warning still uses 180 days and is marked `unverified`.
- Default posting caps (tiktok 50, ig 30, fb 40, x 100, yt 20, spv 20).
- Voucher, e-voucher, gift card, digital code, `คูปอง`, `บัตรกำนัล`, and `ตั๋ว` as prohibited categories. They are not in article 132895 and are no longer applied. `voucher` remains a cancellation hint when the imported reason cell says so.
- The corrected spelling `utilities`. The article prints `Utilites`, and only that spelling matches.
- A separate web host for Shopee Video creator analytics. Article 147479 describes Creator Center on the video profile inside the app. No host permission was added.
- The exact TH Get Link field order, max length, and whether the create control is a `<button>` or `role="button"`.

## How matching works

`extension/diagnose.js` walks the open page. It matches accessible names, `aria-label`, `aria-labelledby`, `label[for]`, placeholders, names, ids, and short visible labels against the catalog. It returns check ids, pattern ids, and counts.

It does not click, assign `location`, read input values, or return addresses. `selector_health` on the MCP server drops any extra field before the result leaves the process. Short links are counted and not opened.
