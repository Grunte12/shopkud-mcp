# ShopKud 0.11.6 live acceptance — 2026-10-25

Runtime: local ShopKud worker, unpacked Chrome extension 0.11.6, workflow guide
1.5.4, signed-in owner Chrome. No link was created, no product was selected, and
nothing was posted or purchased.

## Regression gate

- Python: 244 tests passed.
- JavaScript/DOM/Playwright: all 27 suites passed.
- MCP → Unix broker → native host → MV3 extension: 44 stages passed.
- Generated Dashboard light/dark views passed interaction, accessibility,
  unsafe-link, no-overflow, storage and exact report/run binding checks.

## Cheap-agent black-box runs

Three Luna agents used ShopKud through the configured MCP gateway without code
changes or direct browser control.

### TV novice

- Report `dc4ed8d76bddb247`, rank trace `60caa886f1865656`.
- 3 pages / 60 products; 5 finalists; live cache miss; 23,807.52 ms total.
- All finalists were marked `needs_evidence`; none was recommended because live
  public-detail reads were unconfirmed before the tab-race fix.

### Power-bank sales focus

- Report `9e4d03e240de089d`, final trace `75891c66f6e624cc`.
- 5 pages / 95 products; 6 detail-verified eligible; 5 finalists; 27,585 ms.
- Product/accessory guards excluded case/film noise. UGREEN `24530268998` exposed
  20,000mAh and 25,000mAh options; it remained a candidate because seller evidence
  was absent. No product was recommended.
- Two earlier literal category-term attempts returned zero results. This exposed
  a guide problem, not a ranking defect. Guide 1.5.4 now reserves
  `required_terms` for literal title identity and moves category/range specs to
  query, target kind and finalist review.

### Edge cases

- Known Affiliate ID correctly bypassed market search but initially collided
  with concurrent browser work and returned an unconfirmed entry.
- Intentional accessory search preserved `target_kind=accessory`; it did not
  substitute the primary product.
- A synthetic impossible-term search returned `search_result_unconfirmed`; it
  was not replayed. Live strict no-match behavior remains unverified.

## Defects found and closed during the live gate

1. Bifrost initially exposed a stale ShopKud schema after the worker update.
   Runtime rediscovery restored `report_id`, `trace_id` and `product_decisions`.
2. A delayed cleanup timer could close the public-product tab after the next
   read had claimed it. Cleanup now rechecks the active task immediately before
   removal.
3. If a tool-owned tab becomes active, ShopKud now preserves it as user-claimed
   and creates a separate inactive automation tab instead of failing the whole
   workflow.
4. Standalone product detail and ranked discovery now hold the same browser lane
   for their full workflow, preventing open/read steps from interleaving.

## Post-fix live proof

- Sequential public reads both passed:
  - UGREEN product `24530268998`.
  - Anker product `50403990152`, with two visible variant groups.
- Known Affiliate ID `29688405992` passed and returned exact clickable offer and
  public-product URLs.
- Concurrency gate:
  - rank ran 15:49:13.007–15:49:27.707 UTC, trace `04863075e9fe32ae`,
    11,052.98 ms tool total, 1 scan / 1 scan read / 3 detail checks;
  - exact detail arrived at 15:49:24.759 UTC while rank was running and completed
    at 15:49:29.541 UTC with fully attested inactive owned entry;
  - both succeeded, identities stayed correct, and no `busy`/cross-product error
    occurred. The wall-time overlap proves two callers reached the runtime; the
    detail result completed after the serialized rank lane released.

## Honest remaining limits

- Seller names were absent in the sampled public layouts. ShopKud keeps them
  unknown and provides a shop link when identity is available; it does not infer
  a store from the product brand.
- Public variant evidence is layout-dependent and never proves a selected SKU
  without explicit selection evidence.
- Search/UI changes, challenges, account differences and the synthetic strict
  no-match case still require safe failure rather than automatic replay.
- MCP does not receive the calling model's real input/reasoning token usage.
