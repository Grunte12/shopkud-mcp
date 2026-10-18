# Original ShopKud vs the new console

Compared on 18 Oct 2026.

- Original: `main` at `1075594`. The package in that commit is **0.8.11**. The extension manifest is **0.8.9**.
- New: PR #2 backend `b9e8165` plus PR #3 console `2269382` (`cursor/shopkud-console-frontend-2fa3`, stacked on the PR #2 tip). Package version **0.9.0**.

No feature code was changed for this check. The first `npm test` on PR #3 cancelled the console browser tests because Playwright's Chromium was not installed. Re-running with the system Chrome binary passed. That is an environment fix, not a source edit.

## Verdict

The new console's tests pass, and a read-only pass on the logged-in Chrome works: one offer page, the conversion report, and a HEAD check of a short link. The console then shows those three orders on Overview and Analytics. The link registry is empty because this pass did not create links.

It does not replace the original product-detail flow. The original can save a product from the Get Link dialog and read that history later with no browser. Five products are already saved that way. The new app does not read that database. Its own price history stays empty until an offer is stored, and the CLI `get-offer` command reads the live offer but does not store it.

The original at this commit does not call LinkHub. It talks to its own Chrome extension through native messaging. A process on `127.0.0.1:8176` answered `401` without a key. Product detail was not called, because that needs the extension and an open offer page.

## Tests

| Suite | Result |
|---|---|
| PR #3 `npx tsc --noEmit` | Pass |
| PR #3 `npm test` (`tests/*.test.ts`) | **86 pass, 0 fail** on the rerun. First run: 48 pass, 38 cancelled (Playwright browser missing). `tests/console-ui.test.ts` is not in this branch. |
| PR #3 `npm run test:console` | **46 pass, 0 fail** |
| PR #3 Python `unittest discover -s tests -p 'test_*.py'` | **152 pass**. Same `shopkud_mcp` tree as `main`. |
| `main` Python, same command | **152 pass** |
| `main` node checks (`background-reconnect`, `entry-reuse`, `listing-entry`, `offer-link-entry`) and `evals/broker-cancellation.py` | Pass |
| `main` DOM evals (`detail`, `listing`, `pagination`, `offer-link`, `review`, `review-data`, `search`, `purchase`) | Pass after Playwright Chromium was installed. `pagination-evals.cjs` and `review-evals.cjs` do not honor `SHOPKUD_TEST_CHROMIUM` and failed until that browser existed. |

CDP tests in the new suite skip unless `SHOPKUD_CDP_PORT` is a throwaway port. They did not use 9222 or 9333.

## Demo API (mock Chrome, no Shopee)

`npm run console:demo` on `127.0.0.1:3000`. Fixture product P1 is item `111`.

| Call | Result |
|---|---|
| `setup_status` | `ok`, `ready`, `page_loads: 0`. 7 links, 105 conversions, 6 snapshots. |
| `get_offer` `{item_id:"111"}` | `source: "cache"`. Store percent present. Not an excluded category. |
| `sales_by` product, 1 Sep–18 Oct 2026 | `source: "sqlite"`. 4 buckets. One bucket key is `P1`. |
| `convert_links_in_text` | `opens_links: false`. 1 URL replaced. The product URL was not left in the text. |
| `GET /api/v1/export/links?format=json` | 7 rows, `formula_neutralized: false`. |
| same with `format=csv` | UTF-8 BOM, CRLF. |
| POST without `X-ShopKud-Console` | `403`. |

## Live read-only pass (port 9333)

New tab only. No login, no link creation, no short link opened in the browser. Page loads: **2 of 8**.

| Step | Loads | Result |
|---|---|---|
| `setup_status` | 0 | Chrome probe `done` (port 9333 reachable). Session, links, offers, and conversions were `pending` before the report read. |
| `get_connection_status` | 0 | `chrome_connected: false`. The tool only reports the CDP client after `connect()`, which opens a tab. It does not see a CAPTCHA by itself. |
| `get-offer` for the newest product in the original saved history | 1 | `ok`, `source: "network_capture"`, endpoint `/api/v3/offer/product`. No CAPTCHA. The CLI printed the capture and did **not** write `offers` or `offer_snapshots`. |
| `get-conversions` 18 Sep–18 Oct 2026 | 1 (`page_loads: 1`) | `source: "report_list"`. Download was not clicked. `row_count: 3`. List query keys: `page_size`, `page_num`, `purchase_time_s`, `purchase_time_e`, `version`. No status key, so `status_filter: "none"`. |
| `verify-link` HEAD on the supplied short link | 0 | HTTP 301, redirects not followed. `ownership_verified: true`, `target_verified: true`, reason `utm_source`. |

Page targets stayed at **15** before and after. Other tabs were not closed. The campaign page from the earlier CAPTCHA stop was not opened.

There is no saved product labeled P1. P1 in the new app is a Sub ID slot, and the demo fixture uses it for item `111`. The live offer used the newest of the five products in the original `product_history` table.

The three stored orders are status `COMPLETED`, dates 5, 9, and 11 Oct 2026. `utm_content` is `----` on every row, so every Sub ID slot is empty. Analytics correctly marks **3 of 3 orders untracked**.

`SHOPKUD_DB_PATH=./shopkud.db npm run console` then showed:

- Overview: Chrome reachable, account marker stored, 0 links, 0 snapshots, 3 conversion rows, no CAPTCHA job.
- Links: empty registry ("ไม่พบลิงก์").
- Analytics: the three orders, with money figures masked in the saved screenshots.

Screenshots (affiliate ids and money values masked): `docs/console-screenshots/live-overview.png`, `live-links.png`, `live-analytics.png`.

## Feature comparison

| Feature | Original 0.8.11 | New 0.9.0 | Live this run | How data is read | Safety |
|---|---|---|---|---|---|
| Product detail on an open offer tab | Yes. `get_product_detail` | No DOM reader. `get_offer` reads offer JSON | Offer JSON worked. CLI did not store it | Extension content script vs one new CDP tab | Original stays on a registered tab. New opens a tab in the debug Chrome |
| Save detail / Get Link dialog | Yes, only when `save` or `open_link_dialog` is set | No | Not run | Extension reads the official dialog once | Original does not click unless asked. New `create_link` does not submit; CLI submit still exists and was not used |
| Product history | Yes. `get_product_history` from local sqlite. **5 rows returned with no browser** | `price_history` from offer snapshots | Original history works. New history empty | Old `campaigns.sqlite3` vs new `offer_snapshots` | Neither opens a page. The databases are not shared |
| Public product page and model match | Yes, optional extension permission | No | Not run | Extension `read_listing` | Original refuses until the owner grants `shopee.co.th` |
| Catalog scan, pagination, search | Yes, on the already-open offer list | No | Not run | Extension | Original refuses while the owner has selections |
| Selection preview and apply | Yes | No | Not run | Extension, once per snapshot | Explicit confirm |
| Workflow guide | Yes | Console explainer pages | Not a live Shopee call | Local text | No network |
| Link registry and Sub IDs | Supplied links in a workspace. Sub ID is recorded, not written onto the Shopee link | Placeholder `create_link` fills five slots locally | Registry empty | Local sqlite | New tool does not submit the form |
| Conversion report | CSV the owner imports | `get_conversions` reads `GET /api/v3/report/list` | 3 rows, no download click | CDP tab, then sqlite | One new tab. No short links opened |
| Sales by Sub ID | CSV groups the owner maps | `sales_by` platform, product, clip, variant, month | Ran on demo data. Live rows have no Sub IDs, so the chart is "untracked" | sqlite | No Chrome |
| Short-link ownership | No. It will not open tracking links | `verify_link` HEAD, redirects off | Worked | HTTP HEAD | Does not open `s.shopee.co.th` in Chrome |
| Commission health, replacements, cancellation classes, posting budget, missions, video cart | No | Yes, local | Demo and unit tests. Missions and video were not opened live | sqlite | Enroll and cart swap never submit |
| Earnings | CSV amount states stay distinct | `get_earnings_summary` from stored snapshots | Not fetched live | sqlite | Does not call the billing API |
| Console | No | PR #3 UI on the same `/api/v1/tools` dispatch | Overview, Links, Analytics rendered the live sqlite | localhost only | Header required. Missing header returned 403 |
| Offer excluded-category warning | No | Yes, help article 132895 | Fixture item 111 was not excluded | Category text on the offer | No extra page when served from cache |

## Reliability

- New offer and report reads each finished in a few seconds. No CAPTCHA and no login wall on those two pages.
- `get_connection_status` does not mean "Chrome is up". `setup_status` does, and it does not open a tab.
- The report list still has no status query parameter, so a status filter would be local. This run did not pass a status.
- In-page report fetches can request more list pages after the one navigation. This range stored 3 rows.
- CLI `get-offer` and MCP `get_offer` disagree: only the MCP path writes the snapshot. The console therefore showed conversions and not the offer.
- Original Python tests and the new TypeScript tests both pass offline. The original DOM evals need Playwright's Chromium even if system Chrome is present.
- CDP `browser.close()` on a connected Chrome drops the DevTools socket. Page count stayed 15. Target count moved (36, then 44, then 39) while the page count did not. Those extra targets are workers and iframes, not closed user pages.

## What the original still does that the new one does not

- Read the offer DOM, including channel rows, from a tab the extension already owns.
- Open the official Get Link dialog once, only when asked, and save that result.
- List those saves later with `get_product_history` (this machine has 5). The new price history cannot see them.
- Read a public `shopee.co.th/product/...` page for variant evidence when the owner has granted that permission.
- Scan, paginate, and search the offer list, then preview and apply selections.
- Ship the Thai workflow guide as an MCP tool.

## Recommended next steps

1. Make CLI `get-offer` write the same snapshot as MCP `get_offer`, so a live read shows up under Offers.
2. Add a read-only import from the original `campaigns.sqlite3` product history, or the five saved products stay invisible to the new console.
3. Leave the campaign page alone until the earlier CAPTCHA is cleared by hand. This run did not need that page.
4. Recent orders have no Sub IDs (`----`). Sales charts will stay "untracked" until new links carry the five slots and later orders use them.
