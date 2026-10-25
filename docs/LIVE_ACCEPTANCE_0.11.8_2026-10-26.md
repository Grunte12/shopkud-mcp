# ShopKud 0.11.8 — Live Acceptance

Date: 2026-10-26  
Runtime: Extension 0.11.8, workflow guide 1.5.6, guided 19-tool profile

## Acceptance snapshot

This document records one read-only owner-runtime observation plus synthetic
fixtures at commit `238160e`. It is historical evidence for release preparation,
not a fresh-machine installation result or a substitute for candidate CI.

- Python: 244/244 tests passed.
- Browser/Extension: 27/27 suites passed.
- MCP ↔ Extension fixture: 44/44 stages passed.
- Clean-wheel install: command entry point, bundled workflow and bundled skill verified.
- Live runtime: installed Extension reported 0.11.8; guide reported 1.5.6.

## Concurrent Luna black-box run

Three low-cost Agent personas were launched concurrently. They could not edit
code and were limited to read-only research/detail/history actions. Their
requests did not measurably overlap in the browser queue, so this run does not
prove browser-lane contention handling.

### Value-focused power bank

- Used concise storefront query `power bank 25000mAh` with filters passed as
  structured arguments.
- Scanned 2 pages / 35 unique products in 9.95 s.
- Returned one product-type-correct Mall finalist.
- Agent marked it `needs_evidence` because exact capacity variant and seller
  identity were not confirmed; no false recommendation.

### Trust-focused 55-inch TV

- Used `ทีวี 55 นิ้ว 4K`; excluded mounts and remotes through explicit filters.
- Scanned 3 pages / 60 unique products in 29.56 s.
- All five finalists were televisions by title; no accessories entered the
  shortlist.
- Agent marked all finalists `needs_evidence` because seller names, exact
  variants and several commission terms were not visible. The Dashboard report
  was completed with the five source offer URLs.

### Exact known product

- Product ID `29688405992` bypassed market search.
- Returned clickable Affiliate offer and Shopee product URLs.
- The Affiliate title evidenced an Anker power bank but not model `A1695` or a
  seller identity. The optional public-product read returned
  `listing_unconfirmed`; the Agent did not replay it and abstained from the
  unsupported model/store claim.

### Returning-user history

- `get_product_history` was discoverable in the guided profile.
- Returned the explicitly saved record without `workspace_disabled`, search or
  link creation.
- Correctly labeled it historical, locally saved evidence with unverified link
  attribution—not a live price or browser-history claim.

## Regression result

The concurrent acceptance did not reproduce:

- `search_context_changed`
- `listing_tab_not_idle`
- `workspace_disabled`
- accessory-as-main-product recommendation
- unsafe automatic retry, link creation, posting or purchase

## Honest remaining boundary

The optional public Shopee product-page reader can still return
`listing_unconfirmed`. The cause is unresolved; this snapshot does not establish
whether it is a selector, navigation, account/layout or Shopee-page condition.
It does not invalidate separately observed Affiliate-page evidence, but it
leaves seller or variant fields unknown and the Agent must abstain from claims
that need those fields.

The bounded Affiliate discovery, deterministic ranking, Agent finalist review,
visual Dashboard and local-history paths were observed in this acceptance run.
Seller/variant completion and the optional public listing read remain incomplete.
