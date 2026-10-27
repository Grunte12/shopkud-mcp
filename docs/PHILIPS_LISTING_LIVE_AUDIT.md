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

## Normal Extension mode (follow-up)

The diagnostic one-shot setting has been replaced by the persistent
`shopkudListingForeground` preference in Chrome local storage. The existing
public-product access/options page exposes a labeled checkbox. Foreground reading
is enabled by default; users can select background-only mode there. No DevTools,
remote debugging, or manual session-storage edits are required by this workflow.

With the DevTools helper stopped, two consecutive normal MCP reads succeeded at
2026-10-27T14:13:09.309Z and 2026-10-27T14:14:00.960Z. Both restored focus and
returned the same seller/product metrics above. An earlier attempt returned
`listing_tab_not_idle`; it had no phase diagnostics, so its cause is not proven.
Failures now include before/after-read phase and tab state for further diagnosis.
This is evidence for the two successful reads, not a claim of zero intermittent
failures. Broader seller layouts remain unverified.

## Tab lifecycle follow-up

Work-tab ownership is recorded in Chrome session storage for worker recovery;
an MCP-triggered extension reload cleans up owned idle tabs before reloading.
Both successful and failed public reads schedule cleanup using the captured tab
ID. Cleanup rechecks ownership, exact URL, inactivity and busy state. Claimed or
navigated user tabs are preserved. New work reuses an existing ShopKud group in
the same window instead of creating another group.

Live verification on 2026-10-27: the successful Philips read at
14:23:25.374Z created tab 1652893123, later independently confirmed absent from
Chrome. A subsequent `/product/1/1` test failed with `listing_tab_not_idle` /
`before_read` / `loading`; no test-route tab remained afterward. The session
ownership ledger was empty. All 24 baseline non-dashboard tabs remained.
Six legacy ShopKud groups were consolidated into one, preserving all eight
grouped tabs; no legacy tab was deleted based on a guessed owner.

Legacy tabs without ownership records are intentionally not auto-deleted.
Manual extension reload/browser shutdown may discard session-storage ownership;
unknown tabs must remain protected, not inferred from their URL or group title.

## Pre-public-use review

The complete local `npm test` command passed: 276 Python tests (one Windows-only
acceptance test skipped on macOS), four Python checks and 29 JavaScript suites,
including native and WebSocket extension fixtures. The final recovered-tab claim
race fix was also checked with the focused lifecycle regression.

Remaining gates before describing this as broadly ready:

1. Intermittent `listing_tab_not_idle` remains observable before reading when the
   tab returns to `loading` after the readiness check. It fails safely but can
   interrupt a valid product read; diagnostics are present, not a proven cure.
2. This local commit has not run Windows/Linux CI or a fresh-user installation.
   Synthetic cross-platform workflow definitions are not proof of that result.
3. Older untracked tabs and manual-reload ownership loss remain documented
   cleanup limits. No claim of zero orphan tabs across arbitrary reloads.

Limited pilot use is reasonable with these limits disclosed. Do not claim every
seller layout, selected SKU or warranty has been verified; missing evidence must
remain unknown. No push, tag or release is part of this review.
