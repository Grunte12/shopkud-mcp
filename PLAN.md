# ShopKud: close the product-selection E2E gaps

Date: 2026-10-26. Status: 0.11.8 reliability repair and concurrent live swarm
acceptance passed. Runtime and source are both on 0.11.8; release packaging is complete.

## Implementation result

- Exact `report_id` / `trace_id` binding replaced query-text joins. Agent product
  decisions are validated against the bound run before Dashboard publication.
- Metric leaders remain pending; only one Agent-reviewed product can receive
  recommendation styling. Rejected and evidence-pending products keep reasons.
- Rank and standalone detail reads share one workflow lane. Browser commands use
  one timeout budget; queued cancellation does not dispatch.
- A cleanup-timer race that closed the next public-product tab was reproduced and
  fixed. If a tool tab becomes active, it is preserved as user-claimed and a new
  inactive automation tab is used.
- Guide 1.5.6 teaches cheap agents not to use generic category words or flexible
  minimum/range specs as literal title gates.
- Final evidence: 244 Python tests, all 27 JavaScript/browser suites and the
  44-stage MCP-to-extension suite passed. Two public-product reads in sequence
  and a known-ID Affiliate read passed live. A rank and exact-detail request
  overlapped in wall time; both completed with correct identity and no busy error.
- Live seller names were still absent on the sampled public pages and remain
  explicitly unknown. A synthetic impossible-term search returned an unconfirmed
  Shopee search state, so exhaustive live no-match behavior is not certified.

## Purpose and limits

One reliable loop: brief → research/search → inspect product/store/variant →
Agent judgment → one coherent Dashboard report → saved project and links.
Keep the current local worker, extension and 19-tool interface. No new backend,
database service, media generation or publishing features. Preserve existing
uncommitted reader fixes; they are not a completed release.

## Evidence collected

- Fresh isolated MCP → Unix broker → native host → real MV3 extension suite:
  **44 stages passed**, using fixture HTML, not the owner's Shopee account.
- Dashboard browser suite passed: cross-category rendering, citations, unsafe
  text/URLs, unknown values, save failures, tracker, live logs, keyboard and
  reduced motion, 1024/1280/1440 light/dark, empty/disconnected states.
- Workspace browser suite passed: save/reload, 20-entry history, trace dedup,
  project switching, receipt links/SubIDs, malformed storage.
- Inspected the generated light-theme screenshot. These product/store fixtures
  are synthetic and do not prove live seller extraction.
- Independent Luna live run: report `9cece87cf223c23c`, Thai travel-power-bank
  brief, search `Anker powerbank`, 18 products / one page, one metric-leading
  Anker Zolo candidate. Working and completed reports published. Public detail
  returned `product_page_not_open`: Luna omitted `open_if_missing`, so the default
  was false. This is a caller/usability failure, not proof of a broken reader.
  Rank trace `a83ffa8a7ff6d62d`: total 8,091.32 ms, queue 0.01 ms, scan 5,569.38 ms,
  scan read 28.07 ms, detail 2,478.81 ms. One report attempt used `null` in Starlark
  and failed before dispatch; omitting that optional score allowed completion.
- Previous live evidence: Samsung 50/55-inch choices and Anker A1695 black/silver
  choices are readable; both seller panels exposed placeholders, not names.
- A new isolated browser probe reproduced two missing acceptance cases:
  (a) brief != search query hides the result card; (b) same query, new trace,
  old report shows the old report beside the new product result.
- Previous Luna parallel gateway invocations reached ShopKud ~9.3 s apart;
  waits 0.03/0.02 ms do **not** establish contention. See
  [live follow-up](docs/SELLER_VARIANT_LIVE_FOLLOWUP.md).

## Findings and fix order

### 1. P0 — bind the whole workflow by identity, not wording

Confirmed browser defects: `selection()` and `projectForRun()` in
`extension/dashboard.js` join reports to results by normalized query. Natural
language briefs and search terms legitimately differ. Repeated searches can
reuse stale reasoning; history also uses this same query join (history corruption
is a code-path risk, not separately reproduced in this audit).

Smallest fix:

- Reuse the existing `report_id` as the workflow identifier, passed optionally
  to ranking and carried in the returned trace/dashboard snapshot.
- Link final report updates explicitly to the producing trace; validate IDs.
- Render and persist by these IDs. Keep human brief and search query separate.
- Unbound legacy records remain visible separately; never guess their pairing.

Acceptance: different brief/search strings still show one coherent project;
two agents using the same search cannot cross reports; final report arriving
after scan completion updates only its project; reload preserves correct pairs.

### 2. P0 — Agent review must change the visible recommendation

Code-path finding: the hero is selected from `winner_product_id`; the report
contract has prose/signals but no per-product decision binding. An Agent can
reject a variant in prose without withdrawing the metric-leading product card.
Current pending-review wording is honest but not a completed decision workflow.

Smallest fix: extend the existing report payload with bounded product decisions
(candidate / recommended / rejected / needs evidence), reason and citations,
scoped to the bound run's product IDs. Keep metric ranking separate from Agent
judgment. Only reviewed recommendations get recommendation styling. Rejected or
unverified items remain inspectable, not silently deleted.

Acceptance: reject an accessory, ambiguous variant, and zero commission for an
income objective; no rejected product remains presented as the final choice.
Unknown commission is distinct from zero. No extra model, tool or UI per task.

### 3. P1 — finish store and variant evidence delivery

Confirmed live gap: seller panel placeholders on both sampled products. Confirmed
structural gap: rank reads `detail.shop_name` but `extension/detail.js` does not
produce it; the Affiliate brief allowlist also omits it. Fixing the public reader
alone therefore does not populate ranking cards.

Smallest fix:

- Inspect authorized visible seller evidence on a small set of real layouts;
  distinguish data absent from a failed selector. Do not infer a store from brand.
- Enrich only bounded finalists from exact product/shop identity evidence and
  carry verified name, source URL and observation time to report/cards/history.
- Preserve a clickable shop URL and explicit unavailable reason when absent.
- Keep available variants, selected variant, model evidence and price scope
  separate. Never assign listing-minimum price/commission to an unverified SKU.
- Retain screen-size/capacity label and truncation fixes; add regression cases
  for repeated labels, unavailable choices and multi-model/bundle listings.

Acceptance: real examples with populated seller evidence reach the Dashboard;
absent/placeholder panels stay unknown; 50/55-inch and multi-capacity products
cannot acquire false exact-SKU price/commission claims.

### 4. P1 — one bounded dispatch policy for concurrent browser work

Code-path findings: ranking has a lock, but public details/reports call the shared
extension target directly; only `open_offer` waits at broker level. Other calls
can fail `busy`. Public-detail error handling labels broker failures unconfirmed
even where no command was sent. Current open wait plus response timeout can also
consume two timeout windows. These need targeted reproduction before changing.

Smallest fix: reuse existing locking/dispatch machinery, extend bounded waiting
to relevant operations without nested-lock deadlocks, and track whether dispatch
actually occurred. Use a single deadline across waiting/execution. Preserve
cancellation and no-replay behavior after unknown outcomes. Telemetry must not
make productive work fail or silently drop final reports.

Acceptance matrix: rank+rank; rank+detail; detail+detail; report during scan;
cancel while queued; disconnect after dispatch. Assert no interleaved navigation,
no wrong product identity, correct not-dispatched vs unconfirmed outcomes, no
duplicate action, and no deadlock. First fixtures; then independent live MCP
clients with measurable overlap. Upstream serialization is not a passing test.
Direct-client live testing needs a routing exception if the current gateway
cannot deliver overlapping calls; do not bypass routing instructions silently.

### 5. P1 — make the final inspection path easy for a cheap agent

Live Luna reached a detail error and stopped honestly, but did not complete the
desired recommendation: it omitted `open_if_missing` on the public-detail call.
The public reader defaults `open_if_missing=false`, while owned pages auto-close.

Smallest fix: clarify the exact finalist-inspection call in the bundled guide
and schema, and return an actionable next step for a definitely not-open page.
Do not teach retries for unconfirmed operations. If a new read-only field or
one small workflow step eliminates this repeated error, prefer it over a new
tool or a longer prompt. Test public reads across normal auto-close and a user
activating a tool-owned tab; never close or navigate a user-claimed tab.

Acceptance: Luna completes inspection with no developer coaching; deliberate
missing-page cases have a clear recovery, while changed/unknown contexts stop.

## Final gate (after fixes, not more feature development)

1. Regression tests plus the reproduced missing cases pass.
2. Luna roles: novice TV, sales-focused power bank, exact model/known ID,
   intentional accessory, strict no-match, two same-query concurrent users.
3. Record wall time, tool count, errors, actual queue wait, correct/rejected
   product decisions, Dashboard linkage and save/reload. Model token usage stays
   unknown unless measured; tool response bytes are not actual model tokens.
4. Check fresh vs cached timestamps and disclosure; preserve current freshness
   controls instead of adding another cache layer.
5. Validate install/guide/catalog coherence in a clean test environment, then
   idle-only runtime update, live acceptance, clean scoped commit. Push only
   after the gate passes and the owner's authorization applies.

## Explicitly not proved / not in scope

No exhaustive all-Shopee-layout coverage, seller authenticity guarantee, paid
commission guarantee, write-action live test, fresh-machine install or true live
queue contention was established in this audit. Existing fixture tests cover
several destructive-action boundaries without performing real purchases/posts.
Do not add analytics, video, posting, Docker, another gateway or a new backend.
