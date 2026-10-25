# ShopKud P0–P2 report

Version 0.11.4. Public branch `main`.

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

`python3 -m unittest discover -s tests -p 'test_*.py'` — 235 tests, passing.

This release also passed 27 directly executed Node/DOM/Playwright suites,
including the new Dashboard interaction/safety matrix and tab-lifecycle tests.

Product discovery now has two explicit decision layers. Deterministic code
rejects obvious query, hard-identity and product/accessory mismatches before
ranking. The returned winner remains a metric leader pending Agent review; the
bundled 1.5.0 skill/playbook requires the Agent to inspect product type, exact
model/variant, value, store evidence and evidence sufficiency before making a
recommendation. The Dashboard and Side Panel preserve that distinction.

## Codex review at a38b33f

| Finding | Fix | Test |
| --- | --- | --- |
| P1-1 Dispatch names and the 300s batch timeout | Broker, server, and content script use `create_link_with_subids`, `batch_create_links`, and `verify_link` with flat arguments. Batch timeout is 120. | `tests/test_link_contract.py` |
| P1-2 Receipt-only verify crashed | Python `verify_receipt_only` owns the no-page path. It does not import the extension. | `tests/test_link_contract.py` |
| P1-3 Batch could bind the wrong product | Creates run only on the open offer detail page. The receipt stores that product id. A different id is not saved. | `tests/test_create_guard.cjs`, `tests/test_link_contract.py` |
| P1-4 A lost create could be replayed | The extension stores the attempt before the click. The server stores `unconfirmed` when the broker drops the call, and the next call does not dispatch. | `tests/test_create_guard.cjs`, `tests/test_link_contract.py` |
| P1-5 Missing SubID fields still created | Numbered fields are required. A missing field or a readback mismatch returns `not_attempted` and does not click. | `tests/test_create_guard.cjs`, `tests/test_link_contract.py` |
| P1-6 Ownership used a substring | Ownership is one exact canonical short URL in one row. Unsupported and paginated pages stay `unknown`. | `tests/test_create_guard.cjs`, `tests/test_subid.cjs` |
| P1-7 Receipts and SubIDs could store buyer or order ids | Receipt keys are allowlisted. Other keys, PII-shaped SubIDs, and identifier column headers return `pii_rejected` and are not echoed. | `tests/test_review_fixes.py`, `tests/test_link_contract.py` |
| P1-8 Writes and exports skipped the account | Links, imports, health, missions, videos, and exports filter by account. Snapshot diffs are grouped by account and item. | `tests/test_review_fixes.py` |
| P2-9 `commission_health` was keyed only by product | Primary keys for links, commission health, missions, and video clips include workspace and account. An old product-only table is rebuilt. | `tests/test_review_fixes.py` |
| Earnings age reset on an unchanged balance | `unpaid_since` is copied forward when pending and validated are unchanged. | `tests/test_review_fixes.py`, `tests/test_fullspec.py` |
| Trailing whitespace | `git diff --check` against `1075594` is clean. | diff check |

With Playwright Chromium: `tests/hidden-link-evals.cjs`, `tests/offer-link-evals.cjs`, `tests/detail-evals.cjs`, `tests/listing-evals.cjs`.

## Selector health and public sources

`extension/diagnose.js` reports which catalog patterns matched. It does not click, open short links, or return field values. The Mac steps are in [LIVE_TEST.md](LIVE_TEST.md). Citations and the remaining guesses are in [SELECTOR_EVIDENCE.md](SELECTOR_EVIDENCE.md).

Evidence-backed and now applied: TH prohibited categories (article 132895), the SG Get Link / Convert / Copy Link / five-Sub-ID words (article 191696), the TH payout facts and `ยืนยัน (Valid)` (article 142437), and creator levels 0–2 with a Tuesday refresh (article 203761). Quantitative TH level cells, the 15-second clip rule, the 180-day expiry, posting caps, My Links markup, and the TH SubID input names remain unverified. Singapore creator numbers are cited and not used as the TH ladder.

## Owner verification

Run [LIVE_TEST.md](LIVE_TEST.md) and return the redacted diagnostic JSON. That is what can promote a `repo_fixture` or `unverified` pattern. Do not send page HTML, cookies, or an unredacted short link.
