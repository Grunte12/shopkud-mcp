# ShopKud multi-page retrieval eval — 0.13.2

Date: 2026-10-27  
Runtime: ShopKud extension 0.13.2 after idle reload/restart; workflow guide 1.5.7; retrieval contract `retrieval-v2`; detail fingerprint `product-evidence-v1`  
Dashboard reports: TV `2296ffd2da27db23`; Anker `d81cad82f1e81509`; hair dryer `9d13fe492c131b3f`; phone case `fa98ddcdd21eb101` (all completed, session-only)

## Scope and outcome

### Cause verified before the fix

Luna read product `25051883880` twice through live `get_product_detail` on
0.13.1. After excluding timestamps and page/scan/snapshot IDs, the exact remaining
differences were the first response's `entry` receipt (new-tab allocation and
readiness, absent on the second read) and `images[0].width`/`height` changing from
null to 800 after image loading. All other compared fields matched. Version
0.13.2 excludes only that transport receipt and image dimensions from the detail
hash, preserving them in the raw response. Regression tests verify tab/dimension
changes do not change the hash, while commission changes and image URL changes do.

Five sequential live ranking calls: two identical TV calls, then one each for Anker power banks, hair dryers, and phone cases. Every call used `freshness=live`, `max_pages=2`, `max_products=60`, `top_k=2`, `mall_only=false`, `min_sold=0`, `min_commission_thb=0.01`, and Shopee Video channel. The TV runs reused one report ID and identical rank arguments. Each other case had its own Dashboard report. Citations were only actual Shopee product pages returned by the calls; no outside research or invented sources were added.

| Case / run | Pages scanned / unique products | Returned rows | Trace | Total |
|---|---:|---:|---|---:|
| TV #1 | page count not retained / 39 records received | 2 | `1d2a003240e9a88c` | 40.570 s |
| TV #2 | 2 / 39 | 2 | `1b1f0be9339bb47f` | 40.001 s |
| Anker | 2 / 38 | 2 | `dcc71d9779068211` | 37.462 s |
| Hair dryer | 2 / 40 | 2 | `2513e4d80f7accd7` | 44.062 s |
| Phone case | 2 / 19 | 1 | `d5095ceaaa63241f` | 9.634 s |

All calls returned `ok=true`, were partial at the two-page limit where the scan field was captured, and had zero `detail_errors`. TV #1's emitted summary omitted the top-level `scan` object: its trace shows one scan and one scan-read operation with 39 records received, but does not preserve `pages_scanned` or a scan ID. Its input explicitly bounded the scan to two pages. No exact page count is inferred for that run.

## Fingerprints

The four requested TV fingerprints matched exactly across both live calls, along with result IDs `[42505975084, 28700107209]`:

- Input: `383feead8ca7ab0bebaef3a09550648e4d723007116aa86a101dd7d66b9cfb4c`
- Source: `1e33623033ff98f8753af118bb50297dc316c165cbb90b63e5d5e228fefaea18`
- Detail: `746bef328789e449de7b1287b10a88a80a1140842fef3f7fcca1c3d69e816efc`
- Result: `eab00b36513c0a3ceef46990d826a8efd86294fed195c777f1ccf71ccd2b6af8`

| Case | Input | Source | Detail | Result |
|---|---|---|---|---|
| Anker | `2f6e31e80a4f703f414f9954aa916227b260198bff7141291745cca21c1687eb` | `d2d13c5daf5c594949e5bd17b310b0ae10852679b9b889c20b99d66642b157e2` | `5e0f6a27703c0aba882da25f7358612e36c1e3af45b21c54122da1207675d982` | `1e7ee2b22201c41880de208e694ce9f0f716968dfa4f582f497addf531721155` |
| Hair dryer | `80289a99286fb49219f55713768507b5f65c0bd9e73bde440f9c9519ae22dbef` | `a72dc912df3cfd800339ea28c49be4b7c8ef224213361db1750771e5cbbe50b7` | `8c4a622a3d9109e79f25bcfef5be1ce9a7c8ad0a67d459b7205ee98f3728574b` | `12dcd684d12da5e2eb7f8c763f89b5c93a0e4de23e913a33b2df1f9816f04cb8` |
| Phone case | `f10031ef2db15fe7bfe1bdda560b9540bc677d0bab3c804dfb44189f9bb4330d` | `7346692756b662a9b9dc836c7d3bb6ef2e30fecbe9da7e1621edcdbcf2451ad0` | `2fe299311463c4115e73eceac9bed5243b9a03bc8e25ac2332aeb6c6bf3b40e0` | `751ed0821d9ea4dcddbe199bb99423bd419ada929ed9233bb3612c2d14409cc6` |

## Inputs, result evidence, and constraints

- **TV:** `query="ทีวี 4K"`, `target_kind=product`, default `query_match=legacy`. Both calls returned Sony BRAVIA 2 65-inch TV [42505975084](https://shopee.co.th/product/106754729/42505975084), ฿31,990, 24 sold, 5% / ฿1,599.50; and BRAVIA 3 55-inch TV [28700107209](https://shopee.co.th/product/106754729/28700107209), ฿21,440, 902 sold, 5% / ฿1,072.00. Both were `detail_verified`; both repeats had the same IDs and all four hashes.
- **Anker:** `query="Anker power bank"`, `query_match=all`, `required_terms=["Anker"]`, `min_price_thb=1000`, `target_kind=product`. Returned Anker 165W 25000mAh [29635258187](https://shopee.co.th/product/1224051523/29635258187), ฿3,813, 1 sold, 9% / ฿343.17; and Anker Prime 27650mAh [29860347121](https://shopee.co.th/product/742503023/29860347121), ฿4,999, 52 sold, 4% / ฿199.96. Both returned rows contain Anker and Power Bank; both prices exceed the floor. Exclusions included 4 query mismatches, 3 accessory mismatches, 2 below-minimum-price rows, 15 incomplete rows, and 6 below-minimum-commission rows. No `required_terms_missing` rows.
- **Hair dryer:** `query="ไดร์เป่าผม"`, `target_kind=product`, default `query_match=legacy`. Returned CKL-3800 [19690427564](https://shopee.co.th/product/367671579/19690427564), ฿529, 15 sold, 7% / ฿37.03; and KENTO LITE [20091080963](https://shopee.co.th/product/750836204/20091080963), ฿319, 60 sold, 8% / ฿25.52. Both titles identify hair dryers and both rows were `detail_verified`.
- **Phone case / accessory:** `query="เคสมือถือ"`, `query_match=any`, `target_kind=accessory`. Returned one generic multi-model iPhone case [27455869705](https://shopee.co.th/product/1227329372/27455869705), ฿17, 3 sold, 8% / ฿1.36. Eighteen scanned products were excluded for missing fields; the surviving row was identified as an accessory. The generic title does not establish a specific compatible model.

Every returned row was `detail_verified`, but still listed `gallery`, `offer_end_date`, `variant_model`, `variant_color`, `commission_caps`, `extra_commission_period`, and `attribution_duration` as missing. Each Dashboard report therefore used `needs_evidence`, not `recommended`; no product was recommended. All scans are bounded samples, not full-market coverage, and stopped at `page_limit` where the scan status was captured.

## Verdict

**PASS for the live retrieval/fingerprint gate; push may proceed.** All five calls succeeded without detail errors, the constrained Anker filters and accessory target behaved as requested, and both TV repeats matched on input, source, detail, and result fingerprints. The TV #1 page-count omission is an evidence-capture limitation, not an observed retrieval failure; do not state that its actual page count was confirmed. The sampled products still have the missing evidence listed above, so this pass does not support recommending any of them or claiming full market coverage.

Local test status was reported by the project lead: Python suite passed (276 tests, 1 skipped), focused rank suite passed (31 tests), and the full JavaScript suite completed.
