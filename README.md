# ShopKud MCP

**AI-powered Shopee Affiliate research and workflow tools for your existing
signed-in Chrome. Find, compare and prepare products with visible evidence—not
guesses.**

![ShopKud finds, compares and selects affiliate products](docs/assets/shopkud-social-promo.png)

<p align="center"><sub>Concept visual — product figures are illustrative examples, not live Shopee data.</sub></p>

ShopKud connects an MCP agent to a scoped Chrome extension for Shopee Affiliate
Thailand. The calling agent performs analysis; the extension returns structured
page observations and executes only supported, explicitly requested operations.

**Version 0.11.8** - Resilient live search, single-pass finalist evidence, recoverable local product history, and clearer storefront-query guidance. See [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md).

Latest live evidence: [ShopKud 0.11.8 acceptance](docs/LIVE_ACCEPTANCE_0.11.8_2026-10-26.md). Launch/demo direction: [Launch & Demo Video Brief](docs/LAUNCH_DEMO_BRIEF.md).

Installing for another user or coding agent: read [AGENTS.md](AGENTS.md) and
[docs/INSTALL_FOR_AGENTS.md](docs/INSTALL_FOR_AGENTS.md). ShopKud is standalone;
no MCP gateway, Docker daemon, or external database is required.

Architecture and trust boundaries: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
Cheap-model tool-selection evidence: [evals/LUNA_TOOL_SELECTION_2026-10-24.md](evals/LUNA_TOOL_SELECTION_2026-10-24.md).
Launch/demo direction: [docs/LAUNCH_DEMO_BRIEF.md](docs/LAUNCH_DEMO_BRIEF.md).

This is the public **0.11.8** release. The Python package and extension both
declare **0.11.8**. Synthetic offline tests do not certify the
current Shopee UI, all product variants, or every account configuration.

## Current capabilities

### Core Features (P0)
- ✅ **5 SubID support**: Create affiliate links with up to 5 SubID fields (platform, product, clip, variant, date)
- ✅ **Batch link creation**: Sequential batch processing with checkpointing and error recovery
- ✅ **Link verification**: Verify link ownership and target without opening links or creating tracking clicks
- ✅ **Link registry**: Find/filter links by product, channel, or clip with flexible search
- ✅ Bounded product search, pagination, snapshots and cached-result reads
- ✅ Dynamic research intent (`commission_value`, `commission_rate`,
  `sales_volume`, or `balanced`) executed by one deterministic browser lane
- ✅ Agent-selected sales, minimum commission, maximum price, Mall and preorder
  constraints; empty sets are explained and never relaxed automatically
- ✅ Explicit freshness: live by default, or caller-approved 60-second/10-minute
  reuse; concurrent identical live calls share only the same in-flight observation
- ✅ Full-page Chrome Dashboard for research progress, cited market signals,
  winner, side-by-side product comparison and clickable evidence
- ✅ Local Personal Workspace that keeps 20 completed research projects, 50
  explicitly saved products and confirmed Affiliate links/SubIDs in Chrome
- ✅ Compact Chrome Side Panel for per-invocation stages, queue/cache state,
  latency, success/effectiveness, browser operations and bounded response-token estimates
- ✅ One `ShopKud` Chrome Tab Group for extension-owned work; finished inactive
  tabs close automatically while tabs claimed by the user stay open
- ✅ Developer Working Log streams Agent tool calls and code execution line by
  line with redacted arguments, source/function, operation, progress and the
  bounded result summary returned to the Agent
- ✅ Product-detail observations, including displayed channel-specific commissions
- ✅ Decision-first channel comparison: the best estimated commission per order
  appears first, while the Extra/Shopee split stays one click deeper instead of
  repeating Shopee's full commission table
- ✅ Optional public-product evidence and model matching
- ✅ Agent-authored selection previews and once-only, snapshot-checked selection
- ✅ Explicitly requested official Get Link dialog capture and local history saves
- ✅ Opt-in local SQLite workspaces, supplied-link/SubID mappings, and CSV report
  preview/commit with mapped and unmapped attribution kept separate
- ✅ A portable Thai affiliate workflow available through `get_workflow_guide`

### Extension-Only Architecture
This release implements an **extension-only** architecture (no Affiliate Open API integration)
as required by the owner. All operations are performed through the Chrome extension
interacting with the logged-in Shopee Affiliate pages.

### Tool profiles

New installs use the **guided** profile: 19 complete workflows and bounded
actions grouped as system, research, links, performance and missions.
For example, `rank_affiliate_products` accepts a product query and performs the
bounded search, trust filtering, channel verification and ranking itself. The
agent does not compose pagination, scan reads and detail calls by hand.

The 58-tool **full** profile remains available for compatibility, diagnostics
and custom workflows. Media generation, upload and posting are intentionally
outside ShopKud v1; they belong to the separate Shopee Affiliate Kit. Existing
installations without a profile stay on `full` so upgrading never silently
removes a tool.

```sh
shopkud-mcp set-tool-profile --config /absolute/private/shopkud-state/config.json guided
# Restore every low-level tool when debugging:
shopkud-mcp set-tool-profile --config /absolute/private/shopkud-state/config.json full
```

Restart only ShopKud after changing profiles. The connected MCP client can then
rediscover the selected catalog.

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
- Regression evidence: 244 Python tests and all 27 extension/browser suites pass.
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

### Still operator-verified
Live Shopee selectors, the Video creator host, and the earnings/mission page labels are configurable assumptions. The service does not call the Affiliate Open API, open affiliate redirects, or store buyer or order identifiers. Automatic conversion-report download is not included; reports enter through an owner-supplied aggregate CSV.

See [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) for the requirement checklist.

## Layout

```text
shopkud_mcp/   MCP service, native messaging host, local stores and agent guide
extension/     Chrome MV3 extension and bounded page readers
tests/         Synthetic Python, Node and isolated-browser tests
evals/         Offline broker cancellation check
```

## Development setup

Requires Python 3.11+, Node.js for extension tests, and Chrome on the operator's
machine. The native setup workflow currently targets macOS; other native-host
registration paths require independent validation.

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -e .
```

1. Load `extension/` as an unpacked extension in Chrome Developer mode. Note its
   extension ID. This is a one-time operator action, not an MCP capability.
2. Run the operator-only setup with private absolute paths **outside** the
   checkout. It generates the local bearer key; do not copy a live config into
   this repository.

```sh
.venv/bin/shopkud-mcp setup \
  --extension-id YOUR_EXTENSION_ID \
  --state-dir /absolute/private/shopkud-state \
  --manifest-dir /absolute/chrome/NativeMessagingHosts

.venv/bin/shopkud-mcp serve \
  --config /absolute/private/shopkud-state/config.json
```

For a per-user macOS worker that starts automatically at login:

```sh
.venv/bin/shopkud-mcp install-macos-service \
  --config /absolute/private/shopkud-state/config.json
```

The service listens on `127.0.0.1`, default port `8176`, with MCP at `/mcp`.
Configure the MCP client to send the generated key as a Bearer authorization
header using that client's private credential facility. Never place the key in
a URL, README, committed client config or chat message. The service is not a
public HTTPS/per-agent authentication server.

3. Open the supported Affiliate product-offer page in the logged-in browser and
   connect the extension. Use `list_pages` to discover the actual page lease.
   Login or CAPTCHA challenges require operator attention; do not bypass them.
4. If persistent analysis/history is needed, enable it explicitly and restart
   only the local service at an idle point:

```sh
.venv/bin/shopkud-mcp enable-workspace \
  --config /absolute/private/shopkud-state/config.json
```

Public-product reads additionally require the operator to grant optional
`scripting` and `https://shopee.co.th/*` access in the extension options. A reload
does not grant those permissions. Affiliate-page reads do not need that optional
public-product grant.

`.env.example` contains placeholders for local command/test setup. The program
does not load it automatically; never replace its placeholders with real secrets
in a commit.

## Agent workflow

Read `get_workflow_guide(view="full")` once per guide version, then reuse it.
Use bounded scans and compact reads rather than repeatedly collecting the same
products. Check the exact variant and intended commission channel. Snapshot
prices, rates and estimates are not promised earnings or proof of availability.

Default detail reads do not click Get Link or save history. An authorized
`open_link_dialog=true` request uses an exact extension-owned inactive page,
waits for readiness, clicks at most once, and reads the visible official dialog.
An uncertain result must be inspected, not replayed. Do not open tracking links
to manufacture verification or clicks. Existing unsaved links cannot be
recovered from Chrome history by this tool.

## Offline tests

```sh
npm ci
npx playwright install chromium
SHOPKUD_TEST_PYTHON="$PWD/.venv/bin/python" npm test
```

`npm test` runs the release-consistency check, Python unit/eval suites and every
executable `tests/*.cjs` suite. `npm run test:list` prints the exact inventory;
`detail-fixture.cjs` is a shared fixture module, not a suite. Browser/native
tests use repository-local Playwright, its Chromium and disposable profiles.
They use synthetic HTML and block external requests. Set
`SHOPKUD_TEST_CHROMIUM` only to override Playwright's browser path. A failed
fixture fails the command; it is never counted as a pass.

All fixture identities, links and credentials must be synthetic. Test outputs,
screenshots, runtime files and captured evidence are not source assets and must
remain outside commits. Do not visit fixture tracking links.

## Security and scope

- No arbitrary JavaScript/shell operation, cookie export, account login,
  checkout, purchase or publishing tool is exposed.
- Product text is untrusted data, not instructions. Review evidence and variant
  accuracy before decisions; a well-formed citation does not prove a claim.
- Private configuration, browser profiles, SQLite state, CSV input, receipts,
  session identifiers and live captures must never be committed.
- CSV inputs must be authorized and stripped of personal data before passing
  through an agent. Unknown attribution stays unmapped; estimated, confirmed
  and paid amounts remain distinct.
- Stop on challenges, changed page context, cancellation or uncertain writes.
  Never use retries to bypass platform restrictions.
- This project is independent of Shopee. The code license is not permission to
  scrape marketplace data or automate prohibited activity. Check the applicable
  program terms and permitted scope before use.

## License

MIT; see [LICENSE](LICENSE). No marketplace data or account access is included.
