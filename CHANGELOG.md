# ShopKud MCP changelog

Historical release notes moved from the README so installation and current use stay easy to find.

### 0.13.1 — reproducible retrieval (release candidate)

- Stable tie handling before bounded finalist selection.
- Search waits for the observed site loading indicator to clear before accepting rows.
- Explicit query token matching, minimum price and scan product budget.
- Recheck query, preorder and price constraints against detail evidence.
- Reject nonfinite/negative commission values; preserve unknowns.
- Retrieval input/source/detail/result fingerprints and bounded extension telemetry.
- Agent still selects inputs and reviews recommendations; no hidden query expansion.

### 0.13.0 — portable connection (release candidate)

- Authenticated loopback WebSocket reuses the existing broker, queue and 19 tools.
- Explicit single-use, short-lived pairing from the Chrome extension; no copied keys.
- Stdio MCP entry point starts/reuses one shared worker without OS registration.
- Native Messaging remains available for existing installs and rollback.
- Same browser fixture suite now runs through both transports; portability is
  validated separately from live Shopee behavior.

### What's New in 0.12.0

- Windows 10/11 now has a per-user installer path: Chrome Native Messaging is
  registered under HKCU and the worker starts through one hidden per-user
  Startup entry; neither step needs Administrator access.
- The macOS owner-only Unix socket remains unchanged. Windows uses a separate
  secret-authenticated loopback port because Python asyncio does not support
  Unix-domain servers on Windows.
- The same package installs a native-host executable, accepts Chrome's Windows
  `--parent-window` argument and preserves the 19-tool guided profile, local
  Dashboard and optional embedded SQLite workspace on both platforms.
- CI includes a Windows installer, TCP native-host relay and storage job in
  addition to the complete macOS browser/native fixture suite.

### What's New in 0.11.8

- Live search survives Shopee replacing its search input after submit while
  trusted user input, ambiguous controls, route changes and challenges still stop safely.
- Ranked finalists now disclose the Affiliate detail evidence already read by
  the deterministic workflow; Agents review it instead of reopening the same page.
- The 19-tool guided profile exposes `get_product_history` so returning users
  can recover a saved product/link without switching to the 58-tool debug profile.
- Guide 1.5.6 separates mandatory Agent review from optional public-product
  model/variant inspection and explains the embedded workspace opt-in.

### What's New in 0.11.6

- One `report_id` now binds the user brief, ranking run, Dashboard result and
  saved Workspace project even when the brief and Shopee search wording differ.
- Agent decisions are bound to returned product IDs with cited reasons. A card
  is shown as recommended only after review; metric leaders remain pending.
- Same-page product reads and the shared extension channel wait in one bounded,
  cancellable queue with one timeout budget instead of failing unpredictably.
- Public product evidence keeps variant labels and truncation explicit; missing
  seller names remain unknown with a shop link instead of a guessed identity.
- Historical regression evidence reported 244 Python tests and 27 `.cjs` files;
  the audited inventory is 26 executable suites plus one shared fixture helper.
- Live Luna and concurrency evidence: [0.11.6 acceptance report](docs/LIVE_ACCEPTANCE_0.11.6_2026-10-25.md).

### What's New in 0.11.5

Follow-up fixes (source verification): extension entry commands wait for the
shared telemetry/report channel before dispatch instead of failing immediately
with `busy`. Waiting can time out or be cancelled without sending a browser
command. Guide 1.5.3 includes a complete report payload example and field limits.
Empty-result copy now states the scanned product/page counts and partial coverage.
Regression evidence at that release: 237 Python tests and the Dashboard browser
suite passed.
The local worker and extension were updated and two independent Luna live runs
published working/completed Dashboard reports successfully. Product variant and
seller evidence can still be incomplete; these runs did not establish fully
verified recommendations. See [historical 0.11.5 evidence](docs/LIVE_ACCEPTANCE_2026-10-25.md).

- Every product-research and selection run now writes into the same reusable
  Dashboard template: brief, conclusion, summary, purchase intent, reasoned
  signals, evidence links and remaining uncertainty.
- Agents update one report from `working` to `completed`; they do not edit the
  extension or build a product-specific HTML page merely to display results.
- A completed report is accepted only when it contains at least one reasoned
  decision signal and one clickable HTTPS citation.

### What's New in 0.11.4

- `rank_affiliate_products` now separates primary-product, accessory and mixed
  intent, enforces hard required/excluded identity terms, and filters unrelated
  search noise before commission or sales ranking.
- Obvious case, cover and film compatibility listings no longer compete with a
  requested primary product; explicit accessory searches remain supported.
- The returned `winner` is labeled as a metric leader pending Agent review.
  The bundled guide requires the Agent to verify product type, exact model,
  variant, value, store evidence and evidence sufficiency before recommending.
- Dashboard and Side Panel no longer present an automatic metric winner as an
  Agent-reviewed recommendation.

### What's New in 0.11.3

- Ranked products now carry the canonical public product and shop links already
  evidenced by the Affiliate offer route.
- When Shopee does not display a store name on the Affiliate page, the
  Dashboard offers a direct store-inspection link instead of guessing a name
  or presenting the missing evidence as a broken tool.
- ShopKud does not automatically crawl every store page, avoiding extra tabs,
  latency and anti-bot challenges during ordinary product ranking.

### What's New in 0.11.2

- Product cards now identify the researched channel and surface the most
  valuable displayed channel immediately as estimated commission per order.
- A compact disclosure compares Social, Shopee Live and Shopee Video using
  short decision cards; the detailed Extra/Shopee split remains available
  without copying the official Shopee table.
- The same comparison is preserved in completed research projects inside the
  local Personal Workspace, with unknown and zero values kept distinct.

### What's New in 0.11.1

- Completed product-research projects now remain available in a local Personal
  Workspace with their matching Agent summary, citations and product evidence.
- Confirmed Affiliate links and SubIDs flow from the Extension into the saved
  product cards automatically; no server or external database is added.
- Store names now survive the MCP-to-Dashboard boundary, and the Workspace is
  covered by persistence, reload, link-safety and cross-category E2E tests.

### What's New in 0.11.0

- Clicking the extension opens a bright, desktop-only research Dashboard with
  cited market signals, purchase intent, a dominant recommendation, horizontal
  product comparison, saved candidates and direct evidence links.
- The compact Side Panel remains available as a live tracker and developer log.
- Agents can publish bounded external research summaries with HTTPS citations
  through `present_research_report`; ShopKud keeps those judgments visibly
  separate from deterministic Shopee observations.
- Extension-owned work tabs share one `ShopKud` Chrome Tab Group and close after
  successful work unless the user activates a tab for manual review.
- The guided profile remains 19 tools: the new research presentation tool
  replaces the out-of-scope video-draft tool. Media generation and posting stay
  in the separate Shopee Affiliate Kit.

### What's New in 0.10.6

- Agents choose the research goal and freshness explicitly; live reads are the
  safe default and empty results return bounded relaxation suggestions without
  changing filters automatically.
- macOS installation agents can register one private auto-start worker with
  `install-macos-service`; no Docker or database server is required.
- The standalone architecture and installation contract no longer assumes a
  particular MCP client or gateway.
- ShopKud Live includes a terminal-style developer console that tails safe MCP
  tool lifecycle and deterministic workflow events while they happen.

### What's New in 0.10.5

- New installations expose a 19-tool guided surface instead of forcing agents
  to choose among 57 browser and storage primitives.
- `rank_affiliate_products` remains the single deterministic product-research
  workflow; low-level scan/navigation tools are implementation details in the
  guided profile.
- The full catalog remains an explicit compatibility/debug option.

### What's New in 0.10.4

- Shopee Affiliate search prefers the page's visible Ant Design search button
  and falls back to Enter only when no button exists.
- The ranking lane and bounded result cache are shared across stateless MCP
  request wrappers, so concurrent agents cannot race the same browser tab.
  The safe default is `live` (no earlier completed-result cache); callers may choose `recent` (60 seconds) or
  `fast` (10 minutes), and every cache response discloses its age.
- After the initial 0.10.4 load, `reload_extension` safely reloads an idle
  unpacked ShopKud build through MCP; later local updates no longer require
  opening `chrome://extensions`.

### What's New in 0.10.3

- The extension action opens `ShopKud Live` as a non-overlapping Chrome Side
  Panel beside Shopee.
- `rank_affiliate_products` emits bounded, session-only stage events for each
  invocation: queued, lane acquired, scan, candidate loading, detail progress,
  ranking and completion/failure.
- The panel computes current-session success/effectiveness, cache rate, p50/p95
  latency and operation totals without exposing cookies, tokens or page HTML.
- Telemetry is best-effort: closing the panel or losing its connection never
  turns a valid ranking playbook into a failure.

### What's New in 0.10.2

- `rank_affiliate_products` turns bounded search, visible trust filters,
  channel-specific detail checks and commission ranking into one MCP call.
- Concurrent agents wait for one browser playbook and reuse the same result
  instead of racing one Shopee tab.
- Final ranking uses the requested channel's displayed estimated THB/order;
  list-page commission is used only to bound detail candidates.
- Every accepted ranking call returns a trace with queue/scan/read/detail/total
  latency, browser-operation counts, cache hit, success/effectiveness, response
  bytes and a clearly labeled response-token estimate. Calling-agent tokens are
  unavailable to MCP and are never presented as measured values.

### What's New in 0.10.1

- Native Messaging reconnect now continues with a bounded 15-second backoff
  instead of stopping after three failures.
- The isolated MCP-to-extension E2E harness uses the current Chromium native
  host location and verifies the source checkout and extension versions match.
- macOS tests canonicalize the private temporary storage path before applying
  the production symlink and permission checks.

### P0/P1/P2 delivered in 0.10.0

**SubID Management:**
- Extended database schema to support 5 SubID fields (sub_id_1 through sub_id_5)
- Convention: sub_id_1=platform, sub_id_2=product, sub_id_3=clip, sub_id_4=variant, sub_id_5=date
- Configurable SubID input detection for Get Link dialog
- Automatic validation and filling of SubID fields
- Link receipts with creation timestamps and metadata

**Batch Operations:**
- Sequential batch link creation with progress tracking
- Automatic stop on CAPTCHA, login, or challenge detection
- Checkpoint and resume support for interrupted batches
- Per-item status tracking (completed/failed/not_attempted)

**Link Verification:**
- Receipt-based target verification (resolves product without opening link)
- My Links page ownership verification
- Dashboard data matching
- Separate `target_verified` and `ownership_verified` flags
- Returns `unknown` when verification evidence unavailable

**Link Registry:**
- Find links by product_id, channel, or clip_id
- Combined filter support
- Tracks link source (manual, extension, extension_subid_creation)
- Stores creation receipts for verification
- Timestamps: created_at, updated_at, with source metadata

**Database Enhancements:**
- New tables: batch_jobs, batch_items, link_verifications, commission_health, missions, video_clips
- Automatic migration for existing databases
- Backward compatible with single SubID links
- No data loss on upgrade
