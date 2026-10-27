# Reproducible retrieval (0.13.1)

The agent chooses inputs and reviews evidence. ShopKud does not invent synonyms,
relax filters, invoke a model, or expand a query internally. Additional searches
are explicit agent calls, not hidden retries. This is lexical retrieval, not an
embedding search engine.

Use a short storefront `query`; use `required_terms`/`excluded_terms` for literal
brand/model constraints, `target_kind` for product/accessory intent, and channel,
trust, sales and commission parameters for the user's criteria.

- `query_match="legacy"` preserves the previous fixed matching threshold.
- `query_match="any"` requires at least one normalized query token.
- `query_match="all"` requires all normalized query tokens; this is stricter,
  not automatically more accurate (unit spelling and synonyms may differ).
- `min_price_thb` and `max_price_thb` bound the entire observed price range.
- `max_products` (1–1000) and `max_pages` (1–20) bound the search, not market coverage.

The same input and same observations produce the same shortlist, including ties
at the 16-candidate detail budget. Titles and price constraints are checked again
against detail evidence. Empty results do not authorize relaxing constraints.
The metric leader still requires agent review before recommendation.

## Evaluation evidence

`trace.retrieval` / `retrieval` contains contract version, normalized requested
inputs, source-card, detail and result SHA-256 fingerprints, finalist/result IDs
and exclusion counts. Fingerprints exclude observation timestamps and ephemeral
page/scan/snapshot handles. They do not contain credentials. The existing trace
adds per-stage timing, queue wait, browser call counts, cache use and failures.
The extension's bounded telemetry retains fingerprint summaries for export.

Compare repeated fixture runs by fingerprints and results, not trace IDs or
elapsed time. Live site search order, listings, prices and commissions can change;
different observation fingerprints are not proof of a retrieval bug. A stable
source-card fingerprint alone does not mean detail observations stayed stable.
Cache is explicit (`live`, `recent`, `fast`); never use it to hide live variation.

MCP does not know model token usage. The existing byte-based token estimate is
only an estimate, not billing or measured agent reasoning-token usage.
