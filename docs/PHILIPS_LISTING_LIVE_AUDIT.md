# Philips listing hydration audit — 2026-10-27

Target: https://shopee.co.th/product/406521299/28929416704

## Confirmed cause and repair

The background page contained product data but seller placeholders and no rating.
Foregrounding the same page hydrated those fields without navigation or reload.
Chrome `status=complete` is not proof that seller data has hydrated.

The reader now waits for visible seller identity, reads the observed seller and
rating DOM, and retains explicit readiness evidence. The worker read deadline is
45 seconds to accommodate the 30-second navigation bound plus hydration.
Navigation now rechecks exact URL, inactive state and completed loading after a
negative readiness wait, avoiding a stale failure. It does not replay navigation.

An explicitly approved diagnostic read can consume the one-shot extension session
setting `shopkudListingForegroundOnce=true`. It activates only the owned listing
tab, restores the previously active tab even after injection failure, and does
not override an intervening user tab switch. Ordinary reads remain background-only.
This is a diagnostic consent mechanism, not a finished user-facing setting or a
promise that unattended background reads now provide full seller data.

## Direct MCP evidence

Two fresh ShopKud reads succeeded at 2026-10-27T13:51:12.762Z and
2026-10-27T13:53:05.107Z (20:51 and 20:53 Bangkok). Both returned `ok=true`,
`focus_restored=true`, and the same values below, independently compared against
the rendered product page using official Chrome DevTools:

| Field | Observed value |
|---|---|
| Seller name | Philips |
| Mall badge | Present |
| Seller ratings count | 76.9k (not a star average) |
| Seller followers | 524.8k |
| Response rate / time | 100% / within a few minutes |
| Shop age | 6 years |
| Product rating | 4.9 |
| Product reviews / metadata rating count | 338 / 338 |
| Sold | 919 items; no time window stated |
| Full model in title | BHD837/00 |
| Parsed model identity | BHD837 |
| Warranty specification | 2 months, exactly as displayed; not independently verified |
| Ships from | Samut Prakan |
| Selected SKU / color | Unknown; no selected option evidence |

No buying, option selection, link creation or posting was performed. No release
or push was performed. Missing SKU must not be inferred from the model title.

## Regression evidence

- 16 Python listing tool tests passed.
- 11 isolated browser extraction scenarios passed, including delayed seller DOM.
- Listing entry policy tests passed, including one-shot consent consumption,
  restoration on success/error and preserving an intervening user switch.

Remaining: expose consent through a normal user-facing interface before claiming
this is an unattended general solution; broader seller layouts remain unverified.
