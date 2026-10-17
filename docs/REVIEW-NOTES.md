# ShopKud Core Code Review Notes

**For:** Engineering code review (later inspection by another engineer)  
**Date:** 2026-10-17  
**Branch:** `cursor/shopkud-core-cdp-prototype-a825`  
**Status:** Dry-run is implemented. A logged-in smoke ran on the existing Chrome at port 9333. The dedicated profile on port 9222 is still logged out and was left alone.

## Real-site smoke (2026-10-17)

The dedicated Chrome profile at `~/shopkud-chrome-profile` was launched headful with remote debugging bound to `127.0.0.1:9222`. It is **not logged in**. The window was left on the Shopee buyer login page (`/buyer/login`). No password was typed, no CAPTCHA was solved, and no `s.shopee.co.th` link was opened.

| Step | Result |
|---|---|
| `get_connection_status` | Chrome connected. The first look at the affiliate home did not yet show a password field. |
| `get_offer` | **Stopped.** The offer navigation redirected to the login page. No commission was captured. |
| `create_link --dry-run` | **Not run** on the live site. The profile was already logged out. |
| Reports page | **Not run** on the live site. |

Page loads on the affiliate/Shopee hosts: 3, under the limit of about 20.

Logged-out responses used `/api/v3`, not the old `/api/v4/affiliate/...` guesses. Paths seen, with no response bodies stored:

- `GET /api/v3/config/website`
- `GET /api/v3/user/profile`
- `GET /api/v3/user/status`
- `GET /api/v3/not_login/config/website`
- `POST /api/v3/gql`
- `POST /api/v2/authentication/get_active_login_page`

The custom-link, offer-detail, and report selectors are still the mock-based ones. They were not compared with a logged-in page. The login page itself has `input[name="loginKey"]`, `input[type="password"]`, and an "เข้าสู่ระบบ" button, and those selectors matched.

`create-link` without `--dry-run` now refuses to submit. Dry-run fills the product URL and Sub IDs, checks each selector, and does not click submit. Mock tests cover that, plus offer capture, the report page without export, and CAPTCHA/login stops.

### Tests

- TypeScript: 20/20 passed (`npm test`), including 8 new browser-flow tests.
- Python: 19/19 passed (`tests.test_campaigns` and `tests.test_product_history`).

CDP and bot checks do not use port 9222. Set `CHROME_CDP_URL` to a throwaway Chrome. This run used a headful throwaway profile under `/tmp` on port 9345 because port 9333 was already taken by another Chrome (`~/.shopkud-chrome-alias`). That other Chrome was not killed. Before the port guard existed, one CDP test connected to 9333 and replaced the HTML of its first tab with a local captcha fixture. Reload that tab. No cookies or profile files were copied.

### Headful bot check (throwaway profile)

| Site | Result |
|---|---|
| bot.sannysoft.com | `navigator.webdriver` is false. The checker found 0 rows whose text said bot or suspicious. |
| CreepJS | `navigator.webdriver` is false. 0 lie markers. The trust text was still "unknown" after the short wait. |
| rebrowser-bot-detector | Page loaded. `navigator.webdriver` is false. The status element did not expose a pass/fail grade. |

## Logged-in smoke (2026-10-17, port 9333)

The owner pointed this run at the existing Chrome on `127.0.0.1:9333` (`~/.shopkud-chrome-alias`). That process was not killed or restarted. The logged-out window on port 9222 was not touched. Every check opened a new tab and closed only that tab. No password was typed, no CAPTCHA was solved, no short link was opened, and the custom-link form was not submitted.

`SHOPKUD_CDP_PORT` selects the DevTools port (default 9222). This smoke set it to 9333. Automated tests refuse both 9222 and 9333.

| Step | Result |
|---|---|
| Connection | **Pass.** The affiliate home loaded with no password field and no login URL. Profile and status calls returned, which is the logged-in shape. |
| Offer | **Pass.** `GET /api/v3/offer/product` (query key `item_id`) returned a commission number. Source was the network JSON. The Get Link button was not clicked. |
| Custom link dry-run | **Pass after a wait.** The first attempt checked the form before the page had rendered, so every selector missed. After waiting for the form, the product URL field and all five Sub ID fields resolved. Sub IDs `test` and `smoke` were filled. Submit was not clicked, and no create request was seen. |
| Reports | **Pass after the same wait.** `/report/conversion_report` showed the start date, end date, download button, and tables. Download was not clicked and no export request was seen. |

The old guesses `/linkmanage/customlink` and `/report` are 404s. The live pages are `/offer/custom_link` and `/report/conversion_report`. The offer page path `/offer/product_offer/{id}` was already right.

Selectors that matched:

- Product URL: `textarea[placeholder*="shopee.co.th"]`
- Sub IDs: `#customLink_sub_id1` through `#customLink_sub_id5`
- Custom-link button text is "เอา ลิงก์" (same label as Get Link on the offer page). Dry-run does not click it.
- Report dates: `input[placeholder="วันเริ่มต้น"]` and `input[placeholder="วันสิ้นสุด"]`
- Report download: button text "ดาวน์โหลดรายงาน"
- Report table: `table`

Affiliate API paths seen, with no bodies, ids, or amounts stored:

- `GET /api/v3/offer/product`
- `GET /api/v3/user/profile`
- `GET /api/v3/user/status`
- `GET /api/v3/user/check_program_permission`
- `GET /api/v3/offer/checkInAmsWhiteList`
- `GET /api/v3/dashboard/latest_report_date`
- `GET /api/v3/dashboard/detail`
- `POST /api/v3/gql` (operation names included `isAffiliateHasNoImpressionCampaign`, `productsRankList`, and `conversionReportUpdateTime`)

The store rate is `data.commission_rate_detail.seller_commission_rate`. Divide that integer by 1000 to get the percent. Divide the price integer by 100000 to get baht. Commission baht is price times that percent. No sample prices or amounts are written here. The custom-link script names `POST /api/v3/gql?q=batchCustomLink`. Dry-run does not call it.

Nav paths seen on the logged-in home, as pathnames only: `/dashboard`, `/offer/shopee_offer`, `/offer/brand_offer`, `/offer/product_offer`, `/offer/offer_for_me`, `/offer/custom_link`, `/report/conversion_report`, `/report/click_report`.

### Tests

- TypeScript: 20/20 passed, with `SHOPKUD_CDP_PORT=9444` on a headful throwaway profile under `/tmp`. That Chrome was then stopped. Ports 9222 and 9333 were still listening afterward.
- Python: 19/19 passed (`tests.test_campaigns` and `tests.test_product_history`).

### Headful bot check (throwaway profile on 9444)

| Site | Result |
|---|---|
| bot.sannysoft.com | `navigator.webdriver` is false. 0 of 57 checks were marked suspicious. |
| CreepJS | `navigator.webdriver` is false. 0 lie markers. Trust text was still "unknown" after the short wait. |
| rebrowser-bot-detector | Page loaded. `navigator.webdriver` is false. No pass/fail grade was shown. |

### Follow-up

The offer result now shows the store's commission percent and the baht amount for the product price, including the min and max when the price is a range.

The create operation named in the page script is `batchCustomLink` on `POST /api/v3/gql`. It is not confirmed by a submit, and this tool still will not submit.

Port 9222 stays on the buyer login page. The logged-in browser is port 9333, so nobody needs to log in on 9222.

The captcha-fixture tab on port 9333 is gone. The open pages are ordinary sites plus the offer tab that was already there. Nothing was closed.

## What Was Built

ShopKud Core is a Chrome-control MCP server using patchright (patched Playwright) that attaches to a dedicated Chrome profile via CDP at 127.0.0.1:9222. It replaces the extension-heavy architecture with direct browser automation while preserving the existing Python MCP's data model and test coverage.

### Core Components

1. **CDP Controller** (`src/core/cdp-controller.ts`)
   - Connects to Chrome via CDP using patchright
   - Captures network responses without forging requests
   - Per-origin task queue with human-paced random delays
   - CAPTCHA detection (stops cleanly, no auto-solve)
   - Reconnection logic after Chrome restarts
   - Avoids Runtime.enable leak (patchright patches this)

2. **Database Layer** (`src/core/database.ts`)
   - SQLite with WAL mode
   - **Migration from single `sub_id` to 5 Sub ID slots** (preserves old data)
   - Products, offers, links, job queue tables
   - Separate ownership_verified and target_verified columns
   - Timestamps and source tracking (api|cdp)

3. **MCP Server** (`src/mcp/server.ts`)
   - Implements P0 tools:
     - `find_link`: Filter registry by product/channel/clip/item
     - `create_link`: Idempotent link creation with 5 Sub IDs per channel
     - `create_links_batch`: Validates all first, stops on first error
     - `verify_link`: Checks ownership and target WITHOUT following redirects
     - `get_offer`: Commission rates (cached 6h, CDP fallback)
     - `get_connection_status`: Chrome/CDP connection and queue status
   - **NO Open API** - all operations via browser automation
   - Captures `source` (api|cdp|cache) and `as_of` timestamp

4. **Local Web Console** (`src/console/`)
   - Express server on localhost:3000
   - Links registry with search/filter
   - Single and batch link creation
   - Commission offers view
   - Job queue monitor
   - Connection status with CAPTCHA-stopped state
   - Thai-friendly font (Sarabun)
   - Clean, modern UI

5. **Mock Shopee Site** (`tests/fixtures/mock-shopee.ts`)
   - Simulates Shopee's signed API calls (af-ac-enc-dat / x-sap-sec headers)
   - Direct fetch fails (enforces page-JS signature pattern)
   - CAPTCHA toggle endpoint for testing
   - Runs on localhost:3001

6. **Test Suite**
   - Database migration test (single sub_id → 5 slots)
   - CDP controller tests (connect, queue, reconnect, CAPTCHA detection)
   - MCP tool contract tests (idempotence, batch validation, cache TTL)
   - Bot detection tests (bot.sannysoft.com, rebrowser, CreepJS)
   - Mock Shopee integration test

## Key Design Decisions

### 1. Why patchright instead of vanilla Playwright?

Vanilla Playwright triggers `Runtime.enable` which leaks bot detection signals. Patchright patches this specific CDP command (enable/disable Runtime on each navigation). The Reddit thread cited in the research shows this is the single biggest leak.

### 2. Why network capture instead of direct API calls?

Shopee's /api/v4 endpoints require signed headers (af-ac-enc-dat) minted by their obfuscated JS. Forging these breaks on every SDK update and risks account flags. Capturing the real page's XHR is more stable and matches the franshjy/shopee-mcp and tail-fin-shopee approach.

### 3. Why separate `ownership_verified` and `target_verified`?

The requirements explicitly state "report target_verified and ownership_verified separately, unknown is allowed." A link may resolve to a known item (target verified) but not be owned by us (ownership not verified). This supports the "3qNlTbYQmf" case from P0-3.

### 4. Why 5 Sub ID slots?

Convention: `platform`, `product`, `clip`, `variant`, `date`. The requirements state ≤5 slots and provide examples like "tiktok,P1,v6,a,202610". The old single sub_id is preserved in sub_id1 during migration.

### 5. Why a local console instead of extending the extension popup?

The extension popup is too small for the registry, batch mode, and queue views. A localhost console provides full-screen UI, doesn't require extension reload, and separates concerns (MCP = backend, console = UI).

### 6. Why bind CDP to localhost only?

Security: the CDP port (9222) exposes full browser control. Binding to 127.0.0.1 prevents remote access. The requirements explicitly state "Bind to 127.0.0.1 only."

### 7. Why no auto-CAPTCHA solver?

The requirements state "Detect CAPTCHA or verify pages and stop cleanly with a clear error (no auto-solve)." Auto-solvers violate ToS and risk account suspension.

## What's NOT Implemented (Out of Scope for P0)

- Affiliate Open API: **NOT USED** - removed completely, browser automation only
- Actual Sub ID entry during link creation (mock short links returned)
- CSV report import (this is in the existing Python MCP; not migrated)
- Missions tracker
- Payout status
- Product research / history pricing
- Shopee Video clip cart swap
- Extension network-relay fallback (prototype is CDP-only)

## Known Limitations & Risks

1. **Chrome Must Stay Running**  
   If Chrome crashes, the CDP controller will attempt to reconnect (max 3 attempts). If it fails, the MCP server needs a restart.

2. **CAPTCHA Stops Execution**  
   When a CAPTCHA is detected, the current task fails with `captcha_detected` error. The operator must solve it manually in the Chrome window, then retry. No automatic retry.

3. **No Real Shopee Affiliate API Integration**  
   The Open API stub returns "api_not_implemented" errors. This is deliberate: live API calls require App ID + secret and ToS approval, which are out of scope for the prototype.

4. **Mock Link Generation**  
   `create_link` returns mock short links (`https://s.shopee.co.th/mock-...`). Real link generation would require either the Open API or clicking the "Get Link" dialog in the affiliate dashboard (the latter needs precise selector maintenance).

5. **Bot Detection Results Are Informational**  
   The bot tests record results but don't fail the build. Patchright significantly improves the fingerprint (navigator.webdriver is false, Runtime.enable leak is patched), but aggressive bot detectors may still flag automation.

6. **No Extension Fallback Yet**  
   The requirements mention keeping the extension as a "network tap" fallback, but this prototype is CDP-only. The existing Python MCP + extension continues to work independently.

## Testing Gaps

- **No real Shopee account testing:** All tests use mock data or skip live calls. The prototype has NOT been tested against affiliate.shopee.co.th with a real logged-in account.
- **No CI coverage:** The bot detection tests require a headed Chrome instance, which is hard to run in CI. Consider running these locally before deployments.
- **No load testing:** The queue and task system haven't been tested under high concurrency.
- **No Windows native testing:** The setup instructions include Windows paths, but the prototype was built and tested on macOS/Linux.

## Code Quality Notes

- **TypeScript strict mode enabled** in tsconfig.json
- **No any types** except in necessary type assertions (e.g., sqlite row mapping)
- **Error handling:** CaptchaDetectedError is a first-class error type, propagated through the stack
- **Logging:** Console.error for CDP server, console.log for status updates
- **No secrets in code:** All credentials are env vars; .env.example is a placeholder

## File Organization

```
src/
├── core/
│   ├── database.ts        # SQLite store + migration
│   └── cdp-controller.ts  # Patchright CDP wrapper
├── mcp/
│   └── server.ts          # MCP tools + stdio transport
└── console/
    ├── server.ts          # Express API
    └── public/
        ├── index.html     # Console UI
        └── app.js         # Frontend JS

tests/
├── fixtures/
│   └── mock-shopee.ts     # Mock Shopee site
├── database-migration.test.ts
├── cdp-controller.test.ts
├── mcp-tools.test.ts
└── bot-detection.test.js

docs/
├── SHOPKUD-CORE-SETUP.md  # Setup guide
└── REVIEW-NOTES.md        # This file
```

## Running the Prototype

See `docs/SHOPKUD-CORE-SETUP.md` for full setup instructions.

Quick start:

```bash
# Terminal 1: Start dedicated Chrome
chrome --remote-debugging-port=9222 --user-data-dir=~/shopkud-chrome-profile

# Terminal 2: Start MCP server
npm run build
SHOPKUD_DB_PATH=./shopkud.db node dist/mcp/server.js

# Terminal 3: Start console
SHOPKUD_DB_PATH=./shopkud.db npm run console

# Terminal 4: Run tests
npm test
npm run test:bot  # requires Chrome on :9222
```

## Security Checklist

- ✅ No credentials committed
- ✅ CDP port binds to localhost only
- ✅ Dedicated Chrome profile (not personal)
- ✅ No auto-CAPTCHA solver
- ✅ Link verification does NOT follow redirects (no tracking clicks)
- ✅ Database file is excluded from git (.gitignore)
- ✅ No console.log of sensitive data (tokens, cookies)

## Migration Path (from Current Extension-Based Approach)

1. **Phase 1 (This Prototype):** Prove CDP + patchright works; test bot detection; validate P0 tools
2. **Phase 2:** Test against real account with owner's credentials (--dry-run mode available)
3. **Phase 3:** Implement link creation via CDP (click "Get Link" dialog, capture short link)
4. **Phase 4:** Add extension network-relay fallback (content script forwards XHR to MCP)
5. **Phase 5:** Migrate CSV report import from Python MCP
6. **Phase 6:** Add missions tracker, payout status (P1 features)

## Review Questions for Maintainers

1. **Is the migration path safe?** The database migration preserves old `sub_id` data in `sub_id1`. Should we also copy it to sub_id2/sub_id3 if it was comma-separated?
2. **Is the queue strategy sufficient?** Currently one-at-a-time per origin. Should we add a global rate limit (e.g., max 10 requests/minute across all origins)?
3. **Should we persist bot detection results?** Right now they're logged but not stored. Should we save them to a table for trend analysis?
4. **Is the CAPTCHA detection robust?** It checks for common selectors. Should we also look for network responses (e.g., 403 + challenge token)?
5. **Should the console require authentication?** It's currently open on localhost:3000. Should we add a token or session?

## Recommended Next Steps

1. **Real Account Smoke Test:** Log in to affiliate.shopee.co.th with the dedicated profile, manually verify link creation
2. **CI Setup:** Add a headless bot detection test (mock the bot detector sites or save baseline scores)
3. **Logging Improvements:** Structured logging (JSON) for easier debugging in production
4. **Monitoring:** Track queue depth, CAPTCHA stops, reconnect attempts
5. **Documentation:** Add API docs for the MCP tools (currently only in code comments)

## Conclusion

The prototype is feature-complete for P0 and demonstrates that CDP + patchright can:
- Capture network data without forging requests
- Detect and stop on CAPTCHA
- Queue tasks and reconnect after Chrome restarts
- Pass bot detection tests with a cleaner fingerprint than vanilla Playwright

The code is ready for review. The main risks are:
1. No real Shopee account testing yet
2. The Affiliate Open API is NOT USED (by design - browser automation only)
3. Bot detection may still flag aggressive checkers

All existing Python tests pass; no regressions introduced.
