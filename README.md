# ShopKud MCP

**AI-powered Shopee Affiliate research and workflow tools for your existing
signed-in Chrome. Find, compare and prepare products with visible evidence—not
guesses.**

![ShopKud finds, compares and selects affiliate products](docs/assets/shopkud-social-promo.png)

<p align="center"><sub>Concept visual — product figures are illustrative examples, not live Shopee data.</sub></p>

ShopKud connects an MCP agent to a scoped Chrome extension for Shopee Affiliate
Thailand. The calling agent performs analysis; the extension returns structured
page observations and executes only supported, explicitly requested operations.

**Version 0.11.9** — the Python package and Chrome extension declare the same
version. ShopKud is standalone; no MCP gateway, Docker daemon or external
database is required.

## Requirements

- macOS, Google Chrome and Python 3.11 or newer
- a local MCP client that supports Streamable HTTP and a private authorization
  header
- the owner available once to approve the unpacked extension and log in to
  Shopee Affiliate in the intended Chrome profile

Linux and Windows native-host installation are not yet validated. Installing
the code does not bypass Chrome approval, Shopee login or a challenge page.

## Quick start

```sh
git clone https://github.com/Grunte12/shopkud-mcp.git
cd shopkud-mcp
python3 -m venv .venv
.venv/bin/python -m pip install -e .
```

Then give the coding agent this handoff:

> Install ShopKud MCP from https://github.com/Grunte12/shopkud-mcp. Read
> AGENTS.md, then follow docs/INSTALL_FOR_AGENTS.md exactly. Preserve existing
> config, token and saved data. Stop only when I must approve the Chrome
> extension or log in. Finish with a read-only 19-tool guided smoke test.

The complete procedure is [written for the installing Agent](docs/INSTALL_FOR_AGENTS.md).
It covers Chrome Native Messaging, the private loopback bearer header,
auto-start, verification, safe updates and removal.

## Important limits

- ShopKud v1 researches and selects products. It does not generate media,
  upload or post content.
- Live selectors, seller/variant evidence and some Shopee layouts remain
  operator-verified. Unknown data stays unknown.
- Analytics come only from an aggregate CSV the owner supplies; ShopKud does
  not automatically download live Shopee analytics or retain buyer/order rows.
- Mission tools list and update local workspace records. `enroll_mission` never
  clicks Shopee enrollment; the owner must enroll on Shopee first.
- Removing the Chrome extension can erase its Chrome-stored Personal Workspace.
  The optional SQLite workspace is separate and opt-in.

Evidence and reference:

- [Implementation status](IMPLEMENTATION_STATUS.md)
- [0.11.8 live acceptance](docs/LIVE_ACCEPTANCE_0.11.8_2026-10-26.md)
- [Architecture and trust boundaries](docs/ARCHITECTURE.md)
- [Security policy](SECURITY.md)
- [Contributing](CONTRIBUTING.md)
- [Cheap-model tool-selection evidence](evals/LUNA_TOOL_SELECTION_2026-10-24.md)
- [Launch and demo brief](docs/LAUNCH_DEMO_BRIEF.md)

Synthetic offline tests do not certify the current Shopee UI, every product
variant, seller identity or account configuration.

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

### Chrome extension architecture

Live browser observations use the scoped Chrome extension and the owner's
logged-in Shopee Affiliate pages; ShopKud does not use the Affiliate Open API.
Optional SQLite tools operate only on local records and owner-supplied aggregate
CSV data—they do not fetch Shopee account analytics in the background.

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

### Release history

See [CHANGELOG.md](CHANGELOG.md) for version-by-version changes.

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

GitHub CI runs Python 3.11 and 3.13 checks, the same complete fixture command on
a hosted macOS runner, clean wheel installation and explicit Python/npm
dependency audits. It uses synthetic pages only; CI never receives a Shopee
login, browser profile or ShopKud bearer token.

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
