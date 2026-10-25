# ShopKud P0 / P1 / P2 checklist

Version 0.11.0. Extension-only: no Affiliate Open API, no link redirects, aggregate conversion data only.

The standalone runtime, cache/freshness behavior, trust boundaries, and
agent-installed macOS topology are documented in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

Release verification: 227 Python tests plus 23 directly executed
Node/DOM/Playwright suites pass. They cover the Dashboard, Side Panel,
tab lifecycle and the existing synthetic Shopee readers/actions. Native
Messaging/live-account acceptance remains operator-specific. Live Shopee markup
is still operator-verified where marked `flagged` below.

Status words: **done** means the behavior exists in code, **tested** means an offline fixture covers it, **flagged** means a live Shopee page or an owner choice still has to confirm an assumption.

## P0

| ID | Requirement | Status | Where | Tests |
|---|---|---|---|---|
| P0-1 | Create one affiliate link with up to 5 SubIDs and store the receipt | done, tested, flagged | `extension/subid.js`, `create_link` | `tests/test_subid.cjs`, `tests/test_campaigns_subid.py` |
| P0-2 | Batch create, validate first, stop on challenge, do not replay an uncertain create | done, tested, flagged | `createBatchLinks`, `batch_create_links` | `tests/test_subid.cjs` |
| P0-3 | Verify target and ownership without opening the short link | done, tested, flagged | `extension/verify.js`, `verify_link` | `tests/test_subid.cjs` |
| P0-4 | Find a saved link by item, SubID product code, channel, or clip | done, tested | `find_links`, `find_link` | `tests/test_campaigns_subid.py`, `tests/test_fullspec.py` |
| P0-5 | Read a short link when the link box is hidden inside an open Get Link dialog | done, tested, flagged | `extension/linkcapture.js`, `detail.js` | `tests/test_linkcapture.cjs`, `tests/hidden-link-evals.cjs` |
| P0-6 | Attribute imported conversion aggregates by SubID | done, tested, flagged | `sales_by`, `get_conversions` | `tests/test_sales_by.py`, `tests/test_fullspec.py` |
| P0-7 | Offer lookup with social vs video commission and Extra Com | done, tested, flagged | `get_offer`, `project_offer` | `tests/test_fullspec.py`, `tests/detail-evals.cjs` |
| P0-8 | Deterministic ranked discovery with one sequential browser lane, shared concurrent results, and per-call timing/outcome/context traces | done, tested, flagged | `rank_affiliate_products` | `tests/test_rank_playbook.py`, `evals/rank-playbook.py` |
| P0-9 | Full-page Dashboard shows cited Agent research, deterministic Shopee results, comparison and evidence; the Side Panel tracks bounded stages and a safe line-by-line developer log | done, tested | `extension/dashboard.*`, `extension/sidepanel.*`, `present_research_report`, `playbook_event`, `developer_event` | `tests/dashboard-evals.cjs`, `tests/live-telemetry.cjs`, `tests/sidepanel-evals.cjs`, `tests/test_guides.py` |

## P1

| ID | Requirement | Status | Where | Tests |
|---|---|---|---|---|
| P1-1 | Commission health diff: ok, dropped, removed, out of stock | done, tested | `commission_health_from_snapshots`, `update_commission_health` | `tests/test_fullspec.py`, `tests/test_commission_health.py` |
| P1-2 | Suggest a replacement from stored similar offers | done, tested, flagged | `suggest_replacement` | `tests/test_fullspec.py` |
| P1-3 | List video clips and prepare a cart swap confirm card | done, tested, flagged | `list_video_clips`, `prepare_cart_swap` | `tests/test_fullspec.py`, `tests/test_surfaces.cjs` |
| P1-4 | Classify cancelled and zero-commission aggregates | done, tested, flagged | `explain_cancellations` | `tests/test_fullspec.py` |
| P1-5 | Missions: list, confirm before enroll, check a caption | done, tested, flagged | `list_missions`, `enroll_mission`, `check_post_compliance` | `tests/test_missions.py`, `tests/test_fullspec.py` |
| P1-6 | Search snapshots, price history, product images | done, tested, flagged | `search_offers`, `get_price_history`, `get_product_media` | `tests/test_fullspec.py` |
| P1-7 | Earnings snapshot and expiry warning | done, tested, flagged | `get_earnings_summary` | `tests/test_fullspec.py`, `tests/test_surfaces.cjs` |

## P2

| ID | Requirement | Status | Where | Tests |
|---|---|---|---|---|
| P2-1 | Video level, active days, qualifying clips, Tuesday refresh | done, tested, flagged | `get_video_level` | `tests/test_fullspec.py` |
| P2-2 | Legacy full-profile video draft plan only; never upload or publish; excluded from the public 19-tool guided v1 | done, tested, flagged | `create_video_draft`, `extension/surfaces.js` | `tests/test_fullspec.py`, `tests/test_surfaces.cjs` |
| P2-3 | Replace Shopee URLs in text with registry links | done, tested | `convert_links_in_text` | `tests/test_fullspec.py` |
| P2-4 | Local daily posting cap per platform | done, tested | `posting_budget`, `set_posting_cap` | `tests/test_fullspec.py` |
| P2-5 | JSON/CSV export with formula-neutralized cells | done, tested | `export` / `export_data` | `tests/test_fullspec.py` |
| P2-6 | Excluded-category warning on the offer | done, tested, flagged | `excluded_category` inside `get_offer` | `tests/test_fullspec.py` |
| P2-7 | `account` on stored affiliate data | done, tested, flagged | `account` argument on the new store tools | `tests/test_fullspec.py` |

## How to run the tests

Python 3.11+ with the package installed (`pip install -e .`):

```sh
python3 -m unittest discover -s tests -p 'test_*.py'
node tests/test_subid.cjs
node tests/test_linkcapture.cjs
node tests/test_selector_health.cjs
node tests/test_surfaces.cjs
node tests/background-reconnect.cjs
node tests/entry-reuse.cjs
node tests/listing-entry.cjs
node tests/offer-link-entry.cjs
```

DOM suites need Playwright and its Chromium. They use synthetic HTML and abort network requests:

```sh
node tests/hidden-link-evals.cjs
node tests/offer-link-evals.cjs
node tests/detail-evals.cjs
node tests/listing-evals.cjs
```

No test calls Shopee or opens an affiliate short link.

## Live UI assumptions the owner must verify

1. Get Link dialog title is `ลิงก์ข้อเสนอสินค้า`, and the five SubID boxes match the selectors in `extension/subid.js`. The real TH field names, order, and max length are not certified here.
2. A hidden short-link field is read only when that dialog is still on screen. A dialog that is gone after refresh is not recovered, because clicking Get Link again could create a second link.
3. Ownership is true only when the short code is visible on a My Links-style page or matches a creation receipt. The page URL and row markup must be confirmed.
4. Commission tables are the ones `extension/detail.js` already parses (`โซเชียลมีเดีย`, `ช้อปปี้ไลฟ์`, `ช้อปปี้วีดีโอ`). A layout change needs a fixture before the parser changes.
5. Earnings, mission, and video-level labels in `extension/surfaces.js` are Thai/English guesses. The content script is injected only on `https://affiliate.shopee.co.th/*`. The Shopee Video creator host is not added until the owner confirms it.
6. Creator levels are 0, 1, and 2, and the refresh day is Tuesday, from TH help article 203761. The numeric day, order, and clip thresholds did not extract and stay unverified (`quantitative_thresholds`, `min_clip_seconds`). Singapore article 199073 is cited and not applied.
7. The excluded-category warning uses the prohibited list in TH help article 132895 (jewelry, weapons, tobacco, live animals, services, infant formula, including the printed spelling `Utilites`). Voucher and gift-card strings are not in that article and are not applied. A `voucher` reason hint still classifies a cancellation.
8. The 180-day earnings warning is still a local assumption. TH payout article 142437 confirms the 100 baht minimum, `ยืนยัน (Valid)`, and the twice-a-week / twice-a-month schedule. It does not state a 180-day expiry.
9. Daily posting caps default to tiktok 50, ig 30, fb 40, x 100, yt 20, spv 20. Those numbers are unverified. `set_posting_cap` stores an owner-set cap.
10. `account` separates rows in the local database. It does not switch Chrome profiles. The extension still uses whichever affiliate session is open.
11. Replacement search, price history, and product media use stored extension snapshots only. There is no live catalog crawl and no Open API `productOfferV2`.
12. Cancellation classes use aggregate status plus a closed hint vocabulary (`self`, `household`, `another_link`, `voucher`, `excluded_category`, `indirect`, `shop_cancel`, `seller_cancel`, `payment_failed`, `buyer_cancel`). Free-text reason cells are stored as `unrecognized`, not as the original text. Order ids and buyer names are not stored.
13. `enroll_mission` defaults to `dry_run=true` and returns a confirm card. `prepare_cart_swap` updates the local cart record only after `confirm=true` and never submits to Shopee. `create_video_draft` does not read or upload the file.

Section 4 of the requirements note (`setup_status`, `product_brief`) is not a P0/P1/P2 row and is not implemented.
