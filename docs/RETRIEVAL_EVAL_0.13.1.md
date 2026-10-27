# ShopKud retrieval consistency eval — 0.13.1

Date: 2026-10-27  
Runtime: ShopKud 0.13.1 (reported after idle restart/extension reload); guide 1.5.7; retrieval contract `retrieval-v2`  
Dashboard reports: pre-fix `8cc275a1bec39d99`; post-fix `11cc8ed5b4bd829a` (completed, session-only)

## Scope

Read-only Shopee Video ranking. Every scan used `freshness=live`, `max_pages=1`, `top_k=2`, `mall_only=false`, and `min_sold=0`. A one-page scan is partial evidence, not a complete market search. No links were created and no product was recommended.

## TV repeat

The exact TV input was `query="ทีวี"`, `target_kind=product`, `ranking_goal=commission_value`, `channel=shopee_video`, with the shared filters above. Its input fingerprint was `fbb2fa1302618917195a87adcfa613f6eda70fde93aa733bf3cd3d7a0aaccbdd` in all four calls.

| Run | Trace / scan ID | Rows; eligible; detail errors | Result IDs | Source / result fingerprint | Total |
|---|---|---:|---|---|---:|
| Pre-fix #1 | `5c0bfec078ee200b` / `132b6b59db187464abe06bfacc18be5a` | 20; 0; 0 | none; 20 `query_mismatch` | `5611b23113d2d42e2dfafd2c1642fff9ef885e9756d21e265947084e9ad93725` / `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` | 4.863s |
| Pre-fix #2 | `c1047ba37962b27f` / `32d955b8d4b5d60cdb75c094bf8342ed` | 19; 13; 0 | [25051883880](https://affiliate.shopee.co.th/offer/product_offer/25051883880), [49952973462](https://affiliate.shopee.co.th/offer/product_offer/49952973462) | `e00470d086ad43cf8e2c8f3f717e058ceef30055c333444abd44d233ecb42160` / `87b8d640fef8ce9b9c7ecd85120335734991b334c0511590acae39154d8ac067` | 31.366s |
| Post-fix #1 | `bd83d6e76605503a` / `8f8a60ea335c0b4548403befff4c0932` | 19; 13; 0 | [25051883880](https://affiliate.shopee.co.th/offer/product_offer/25051883880), [49952973462](https://affiliate.shopee.co.th/offer/product_offer/49952973462) | same source / result hashes as pre-fix #2 | 34.008s |
| Post-fix #2 | `d2e302d3f22d77ce` / `ecb146eb5b6bef2329cfcf5d0500f791` | 19; 13; 0 | [25051883880](https://affiliate.shopee.co.th/offer/product_offer/25051883880), [49952973462](https://affiliate.shopee.co.th/offer/product_offer/49952973462) | same source / result hashes as pre-fix #2 | 30.318s |

After the patch, the repeated TV calls had matching input, source, and result fingerprints and identical result IDs. Their scan IDs and detail fingerprints differed; the reason for the detail-fingerprint difference is unverified. The earlier 20-row all-mismatch result did not recur. The project lead reproduced an offline search issue where stable intermediate rows were accepted while the search spinner was still visible; the patch waits for the spinner to clear. The live comparison is consistent with that repair, but does not prove causality.

## Constrained Anker run

Input: `query="Anker Power Bank"`, `query_match=all`, `target_kind=product`, `required_terms=["Anker"]`, `min_price_thb=1000`, `min_commission_thb=0.01`, `max_products=20`, plus the shared filters. All three query terms matched. Trace `6cc7ce844116a0ce`, scan `4363fde40b7e3ff08f0bf688474c2b43`, input fingerprint `938412c55459dd6cad989e70e00b1ad05e2f8c9789519061bcdd812292a841b1`, source fingerprint `84ba7208b28eddc3648383b0689ee35b60313c62df566b98b0bab97d494ebcd4`.

The scan read 18 rows, verified 7 finalists with 0 detail errors, and qualified 5 after constraints. Exclusions included 2 below-minimum-price, 2 below-minimum-commission, 1 accessory mismatch, and 8 incomplete rows. The five examples included an Anker power-bank case rejected as an accessory; no query or required-brand mismatches were counted. Two returned, detail-verified candidates had displayed prices/commissions of ฿3,813 / 9% / ฿343.17 and ฿4,999 / 4% / ฿199.96. Their titles and direct offer evidence: [29635258187](https://affiliate.shopee.co.th/offer/product_offer/29635258187) and [29860347121](https://affiliate.shopee.co.th/offer/product_offer/29860347121). Both lacked variant-model/color evidence. They remain candidates for this eval only, not recommendations. Total time: 20.381s.

The earlier, less constrained Anker baseline used `query="Anker power bank"`, `target_kind=product`, `required_terms=["Anker"]`, and the shared filters. Trace `e471ac2b32376baa`, scan `f8cedfb0f7e502badc45344146a48d59`: 18 rows, 9 verified, 0 detail errors, the same two result IDs, 23.685s. It did not exercise `query_match=all`, `min_price_thb`, `min_commission_thb`, or explicit `max_products`.

## Earlier accessory control

The pre-fix `query="เคสกันกระแทก"`, `target_kind=accessory` control read 18 rows, rejected 14 as query mismatches, verified 2 finalists, and had 0 detail errors (trace `b0b6d2648a06fd37`, scan `7fa12e467cbecfa6cfee774cd5efa2ec`, 8.883s). Both returned listings ([28681198028](https://affiliate.shopee.co.th/offer/product_offer/28681198028), [18180442972](https://affiliate.shopee.co.th/offer/product_offer/18180442972)) displayed Shopee Video commission of 0% / ฿0; neither was recommended. All evaluation scans stopped at `page_limit`.

## Test scope

- Focused `tests/test_rank_playbook.py`: 30 tests passed. Added coverage for repeated live fingerprints, shuffled tied finalists, `query_match` any/all, price bounds and `max_products` forwarding/bounds, changed detail title/preorder/price, and negative/non-finite commission amounts.
- Post-fix full suite, as reported by the project lead: 275 Python tests (1 skipped), 4 checks, 27 JavaScript suites, including 14 search cases.
- Bifrost's ShopKud rank schema refreshed to include `query_match`, `min_price_thb`, and `max_products`; the post-fix Anker call exercised them live.
