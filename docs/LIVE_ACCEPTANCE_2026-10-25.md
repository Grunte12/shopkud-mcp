# Live acceptance — 2026-10-25

Runtime: ShopKud 0.11.5, guide 1.5.2. Worker restarted and extension reloaded
before the runs. Installed dashboard.js matches the repository file (SHA-1
`c905a162283630ff4d0ca9772fcd9fa38be4c5cc`).

Two independent GPT-6 Luna agents tested through the provider MCP without
reading source code. Their reports are local Dashboard records, not public data.

| Case | Live result | Dashboard report |
| --- | --- | --- |
| Genuine Anker power bank, positive Video commission | 38 products / 2 pages, 4 details checked, 1 qualifying candidate; 16,795 ms | `149efbf78e3b7d92` |
| 55-inch 4K TV under THB 20,000, trusted store, positive Video commission | 40 products / 2 pages, 2 details checked, 1 qualifying listing; about 12.5 seconds plus about 5 seconds detail verification | `19e7192a07c803e2` |

Both agents read guide 1.5.2 and published `working` then `completed` into the
same report. Both used real product/offer URLs and disclosed partial coverage.
Neither created affiliate links, purchased, enrolled, generated media or posted.

## Verified behavior

- Power bank result was an actual power bank, not a case or film. Displayed
  Video commission was 8% / THB 66.32 at THB 829, with Mall evidence in ranking.
- TV result displayed 3% / THB 352.98 at THB 11,766. The title combined 50- and
  55-inch variants; the agent did not claim the desired variant was verified.
- Neither agent promoted a zero-commission item as an affiliate winner.
- Both reported remaining seller/variant uncertainty instead of treating a
  filtered search result as a fully verified recommendation.
- No provider schema errors or unconfirmed browser outcomes occurred. The TV
  agent made one gateway-language error (`true` instead of `True`), corrected
  before any tool dispatch.
- Fresh Python regression: 237 tests passed. Dashboard browser suite passed in
  the preceding local verification; `git diff --check` passed.

## Limits, not a blanket release claim

Neither run produced a fully verified final recommendation: selected variants
and seller name/rating/review evidence remained incomplete. Prices and commissions
above are observed snapshots, not current promises. The power bank queue wait
was 0.07 ms, so concurrent agents did not prove live contention behavior; queue
serialization, timeout and cancellation are covered by automated broker tests.
Token usage was not measured. Two bounded user scenarios are not exhaustive QA.
