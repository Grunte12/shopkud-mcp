# ShopKud MCP

ShopKud connects an MCP agent to a scoped Chrome extension for Shopee Affiliate
Thailand. The calling agent performs analysis; the extension returns structured
page observations and executes only supported, explicitly requested operations.

**Version 0.10.0** - Extension-only P0, P1, and P2 affiliate tools. See [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md).

This is a development candidate, not a published or stable release. The Python
package declares **0.10.0** and the extension manifest declares **0.10.0**. Package
and extension versions are separate. Synthetic offline tests do not certify the
current Shopee UI, all product variants, or every account configuration.

## Current capabilities

### Core Features (P0)
- ✅ **5 SubID support**: Create affiliate links with up to 5 SubID fields (platform, product, clip, variant, date)
- ✅ **Batch link creation**: Sequential batch processing with checkpointing and error recovery
- ✅ **Link verification**: Verify link ownership and target without opening links or creating tracking clicks
- ✅ **Link registry**: Find/filter links by product, channel, or clip with flexible search
- ✅ Bounded product search, pagination, snapshots and cached-result reads
- ✅ Product-detail observations, including displayed channel-specific commissions
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

### What's New in 0.10.0

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
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m unittest discover -s tests -p 'test_*.py'
node tests/background-reconnect.cjs
node tests/entry-reuse.cjs
node tests/listing-entry.cjs
node tests/offer-link-entry.cjs
node tests/test_subid.cjs
node tests/test_create_guard.cjs
node tests/test_surfaces.cjs
node tests/test_linkcapture.cjs
node tests/test_selector_health.cjs
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python evals/broker-cancellation.py
```

DOM parser suites (`tests/detail-evals.cjs`, `tests/listing-evals.cjs`,
`tests/hidden-link-evals.cjs`, `tests/offer-link-evals.cjs`,
`tests/pagination-evals.cjs`, `tests/purchase-evals.cjs`,
`tests/review-evals.cjs`, `tests/review-data-evals.cjs`, `tests/search-evals.cjs`,
and `tests/selector-health-evals.cjs`)
require Playwright with its Chromium installed in the development environment.
They use synthetic HTML and block external requests. The native-messaging
integration fixtures also require `SHOPKUD_TEST_PYTHON` pointing to a Python
environment with the package dependencies. Run browser/native tests only with
temporary profiles, never a personal Chrome profile or account. Some native
host fixture paths remain platform-dependent; a failed fixture is not a pass.

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
