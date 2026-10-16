# ShopKud P0–P2 report

Version 0.10.0. Branch `cursor/shopkud-p0-p1-p2-full-spec-6962`.

The service stays extension-only. It does not sign Affiliate Open API requests, follow `s.shopee.co.th` redirects, or store buyer or order identifiers. Remote MCP remains loopback plus a bearer token.

The requirement-by-requirement checklist, test commands, and live-UI assumptions are in [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md). Every P0, P1, and P2 row there is implemented and covered by an offline test. Rows that still depend on the live Shopee UI are marked flagged.

## What changed after the P0 foundation

- Hidden short-link fields inside a visible Get Link dialog are captured and can be saved. A fully hidden dialog is still not treated as a link, so Get Link is not clicked twice.
- `sales_by` and `get_conversions` read imported aggregate CSV rows. Optional reason, category, and buyer-class columns are reduced to a closed vocabulary before storage.
- `get_offer` returns price, social vs video rates, Extra Com, and an excluded-category warning from an extension read or the latest local snapshot.
- Commission health compares successive snapshots and reports dropped, removed, and out-of-stock items.
- Replacement suggestions, offer search, price history, and image URLs come only from those snapshots.
- Video clip lists and cart swaps return a confirm card. The local cart record changes only when `confirm=true`. Nothing is submitted to Shopee.
- Mission enroll defaults to a dry run. Caption compliance checks keywords and a registry link without posting.
- Earnings, video level, draft plans, posting caps, text conversion, formula-safe export, and an `account` filter are local tools. Draft creation does not upload the file or click publish.

## Tests

`python3 -m unittest discover -s tests -p 'test_*.py'` — 190 tests, passing.

Node checks: `tests/test_subid.cjs`, `tests/test_linkcapture.cjs`, `tests/test_surfaces.cjs`, `tests/background-reconnect.cjs`, `tests/entry-reuse.cjs`, `tests/listing-entry.cjs`, `tests/offer-link-entry.cjs`.

With Playwright Chromium: `tests/hidden-link-evals.cjs`, `tests/offer-link-evals.cjs`, `tests/detail-evals.cjs`, `tests/listing-evals.cjs`.

## Owner verification

Confirm the Get Link SubID selectors, My Links markup, commission table labels, earnings/mission/video labels, and whether a Shopee Video creator page exists on a host other than `affiliate.shopee.co.th`. The level ladder above 15 active days / 15 clips, the excluded-category list, the 180-day payout warning, and the default posting caps are local assumptions in `shopkud_mcp/spec_ops.py` and `extension/surfaces.js`.
