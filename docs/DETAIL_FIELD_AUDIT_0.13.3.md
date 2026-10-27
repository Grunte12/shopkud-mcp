# Detail field audit — 0.13.3 (2026-10-27)

Scope: compare actual owner-visible Chrome DOM with `get_product_detail` output,
not infer completeness from a passing parser test. No release is authorized.

## Confirmed parser defect

Source: https://affiliate.shopee.co.th/offer/product_offer/42505975084

The Sony offer displayed social extra commission `5% (฿1,599.50)`,
Shopee commission `2% (฿225.00,สูงสุด)`, and combined estimate `฿1,824.50`.
The old parser returned a null Shopee amount and cap because its money pattern
rejected the maximum suffix. 0.13.3 preserves amount 225 and component cap 225.
This is **not** a 225-baht cap on combined commission. Combined cap stays unknown.
Ranked results retain both component-cap fields; full/brief detail retain their
source. `commission_caps_status` reports partial component evidence, not complete
cap coverage. Missing fields are explicitly scoped to the Affiliate offer read.

## Other missing fields: what was actually checked

| Field | Observed evidence | Conclusion |
| --- | --- | --- |
| Gallery | Affiliate page exposed one main image | No complete gallery observed on this surface; not proof the public listing lacks images |
| Selected model / color | Title includes K-65S20M2, but no selected variant control observed | A title model is not selected-SKU evidence; do not invent a color or variant ID |
| Offer end | No end-date label observed on this offer | Unknown for this offer; existing parser supports the exact labeled date when present |
| Extra commission period | Not present in inspected offer table or details modal | Unknown; do not reuse offer end as an extra-commission end date |
| Attribution duration | Details modal showed same-shop/cross-shop credit rules, not a duration | Duration remains unknown; scope and duration are different facts |

The read-only “ดูรายละเอียด” modal showed store extra commission 5%,
existing/new-customer Shopee channel rates, and a 0.6% cross-shop social note.
The tool currently does **not** extract that modal's detailed attribution terms.
This is an unsupported reader surface, not absent Shopee data. No automatic
commission calculation should silently substitute the cross-shop note for the
main offer table's rate.

The linked public product page initially exposed partial product content, then
redirected to a CAPTCHA. No bypass was attempted. Consequently this audit does
not certify live public-gallery/variant completeness. ShopKud's separate public
listing reader exists, but requires its optional host permission and an
unchallenged page. Another live verification is needed after the owner clears
the challenge; absence must not be claimed from this blocked read.

## Regression coverage

Offline DOM cases include maximum suffix, zero maximum, uncapped amount,
malformed/range cap, and total-vs-component separation. Rank tests verify cap
propagation and reject negative caps. No links were created, no purchases made.

Verification: 276 Python tests (one skipped), four Python checks and 27 JS suites
passed with the required local process permissions. The final rank fixture
change was rerun separately: 31/31 passed. Extension 0.13.3 reloaded via MCP;
the idle worker was restarted once. Live full and brief reads returned social
Shopee amount/cap 225, extra amount 1599.50, combined amount 1824.50, and partial
cap status. The audit-only public product tab was closed. No release or push.
