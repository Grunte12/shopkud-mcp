# ShopKud JSON API

The future console should call these endpoints. They use the same functions as the MCP tools (`ShopkudMCPServer.invoke`). There is no second copy of the business logic.

The process is the existing local console:

```bash
npm run console
```

It listens on `127.0.0.1` only (port `CONSOLE_PORT`, default 3000). Responses send `Cache-Control: no-store`. Cookie, token, password, and signature fields are removed from JSON responses.

## Calling a tool

`GET /api/v1/tools`

Returns the tool names, the `sales_by` dimensions, and which writes need a confirm token.

`POST /api/v1/tools/:name`

Headers:

- `Content-Type: application/json`
- `X-ShopKud-Console: 1`
- `Host` must be `localhost`, `127.0.0.1`, or `[::1]`
- `Origin`, when sent, must be one of those hosts

Body: the tool arguments. A missing console header or a non-local host returns `403`.

`GET /api/v1/export/:kind?format=csv|json&from=YYYY-MM-DD&to=YYYY-MM-DD`

`kind` is `links`, `conversions`, `offers`, `alerts`, `missions`, `clips`, `posts`, `earnings`, or `videos`. CSV cells that start with `=`, `+`, `-`, `@`, tab, or carriage return are prefixed with `'` so a spreadsheet does not run them. The CSV response starts with a UTF-8 BOM.

## Tools

| Tool | Reads | Writes | Live Chrome |
| --- | --- | --- | --- |
| `find_link` | link registry | no | no |
| `create_link` | registry | placeholder link, product, clip | no |
| `create_links_batch` | registry | same as create_link | no |
| `get_conversions` | report list | conversion rows | yes, one report page |
| `sales_by` | conversions | no | no |
| `verify_link` | HEAD only, redirects off | verification flags | no page |
| `get_offer` | offer page or 6h cache | offer + snapshot | yes when the cache is cold |
| `get_connection_status` | CDP + queue | no | no |
| `import_report_csv` | CSV text | no sqlite report row | no |
| `setup_status` | sqlite + `/json/version` | no | no page |
| `check_commission_health` | offer snapshots | alert rows | no |
| `suggest_replacement` | snapshots | no | no |
| `explain_cancellations` | conversions | no | no |
| `search_offers` | snapshots | no | no |
| `price_history` | snapshots | no | no |
| `product_media` | snapshots | no | no |
| `get_earnings_summary` | earnings snapshots | no | no |
| `list_missions` | missions | no | no |
| `enroll_mission` | missions | local `prepared` row only after confirm | never submits |
| `list_video_clips` | video_clips | no | no |
| `prepare_cart_swap` | video_clips | local cart only after confirm | never submits |
| `convert_links_in_text` | links | no | does not open URLs |
| `posting_budget` | links + caps | no | no |
| `set_posting_cap` | caps | one cap row | no |
| `export_data` | sqlite | no | no |

`create_link` does not submit the Shopee form. A real submit stays on the CLI `create-link` command and needs a separate approval. The registry row it writes is marked `origin: "placeholder"`.

## Response shapes

Shared fields: `ok`, and `as_of` when the call succeeds. Errors use `{ "ok": false, "error": "..." }`.

`setup_status`

```json
{ "ok": true, "ready": false, "page_loads": 0, "steps": [{ "key": "database", "state": "done", "detail": "sqlite ready" }], "counts": {} }
```

`step.state` is `done`, `pending`, or `skipped`. `page_loads` is always 0. The Chrome check reads `/json/version` and does not return the websocket URL.

`get_conversions`

```json
{ "ok": true, "source": "report_list", "row_count": 0, "empty": true, "status_filter": "none", "status_query_key": null, "list_query_keys": [], "download_clicked": false }
```

`status_filter` is `server` when the report list URL already has `checkout_status`, `order_status`, or `status` and that query was sent. It is `local` when a status was requested but the list URL has no status key. It is `none` when no status was requested. The earlier live capture had no status key. The mock page includes `checkout_status` so the server path is tested.

`sales_by`

`dim` is `sub_id`, `platform` (s1), `product` (s2), `clip` (s3), `variant` (s4), or `month` (s5).

```json
{ "ok": true, "source": "sqlite", "dim": "variant", "buckets": [{ "key": "a", "orders": 1, "gmv": 0, "commission": 0, "cancelled": 0 }] }
```

`get_offer`

```json
{ "ok": true, "source": "cache", "offer": { "item_id": "1", "store_commission_percent": 0, "excluded_category": false, "excluded_match": null, "commission_eligible": true, "warnings": [] } }
```

When the category matches the cited prohibited list, `warnings` contains `excluded_category` and `citation` is `https://help.shopee.co.th/portal/10/article/132895`. Voucher and gift-card guesses are not flagged.

`check_commission_health`

```json
{ "ok": true, "source": "snapshots", "checked_count": 1, "alert_count": 1, "results": [{ "item_id": "1", "status": "dropped", "old_rate": 10, "new_rate": 4 }] }
```

`status` is `ok`, `dropped`, `removed` (rate 0 or missing), or `oos` (stock 0). Non-ok rows are also stored in `alerts`.

`suggest_replacement`

```json
{ "ok": true, "source": "cache", "live_search": "/api/v3/offer/product/list", "candidates": [{ "item_id": "2", "score": 1, "reason": "same_category,official_shop" }] }
```

Excluded categories are skipped. `live_search` names the product-list path seen on `/offer/product_offer`. That URL had no `keyword` key, and its response fields were not captured, so candidates still come from local snapshots. Shop and campaign list URLs did include `keyword`.

`explain_cancellations`

```json
{ "ok": true, "order_level_data": "omitted", "classifications": [{ "likely_reason": "order_cancelled_or_returned", "count": 1, "confidence": "0.70", "evidence_fields": ["status"] }], "summary": { "rows": 1, "zero_commission_rows": 0 } }
```

Likely reasons: `self_or_household_purchase`, `buyer_clicked_another_link`, `excluded_category`, `indirect_order`, `shop_cancel`, `voucher_fully_paid`, `payment_failed`, `order_cancelled_or_returned`, `zero_commission_unclassified`, `unknown`. Order ids are not included.

`search_offers`, `price_history`, `product_media`

Search returns `{ items, count, source: "cache", live_search: "/api/v3/offer/product/list" }`. History returns `{ points: [{ as_of, price, source }] }`. Media returns `{ images }` limited to https hosts on `shopee.co.th`, `susercontent.com`, or `shopeemobile.com`.

`get_earnings_summary`

```json
{ "ok": true, "pending": null, "validated": null, "paid": null, "live": "page_seen", "expiring": [], "payout_citation": "https://help.shopee.co.th/portal/10/article/142437" }
```

The six-month expiry warning is a local assumption (`evidence: "unverified"`). `/payment/billing` and `/payment/payout_record` loaded in a read-only check. `GET /api/v3/payment/billing_list` includes `pending_payout_amount` and `income_breakdown`. This tool still reads stored snapshots and does not call that endpoint.

`list_missions` / `enroll_mission`

List returns `{ missions, live: "nav_seen_captcha_stop" }`. The nav link `/campaign/campaign_list` was seen. The read-only check stopped on a CAPTCHA check on that page, so campaign APIs were not captured. Enroll without `confirm: "ENROLL_MISSION"` returns `dry_run: true`, `confirm_required: true`, `submitted_to_shopee: false`. With that confirm token it stores `status: "prepared"` and still returns `submitted_to_shopee: false`. It never enrolls on Shopee.

`list_video_clips` / `prepare_cart_swap`

Both return `live_verified: false`. Dashboard, billing, and payout nav had no video or creator path. A `shopee_video` key inside billing `income_breakdown` is a payment channel, not a creator page. Cart swap without `confirm: "PREPARE_CART_SWAP"` does not change the local cart. With the token it updates only the local `video_clips` row. `submitted_to_shopee` is always false.

`convert_links_in_text`

```json
{ "ok": true, "opens_links": false, "replaced": 0, "text": "", "conversions": [] }
```

`posting_budget`

```json
{ "ok": true, "today": 0, "cap": 50, "ok_to_post": true, "remaining": 50, "cap_evidence": "unverified_local" }
```

Default caps are local only: tiktok 50, ig 30, fb 40, x 100, yt 20, spv 20. `set_posting_cap` stores an owner cap (`cap_evidence: "owner_set"`). These numbers are not a Shopee rule.

`export_data`

JSON: `{ rows, count, formula_neutralized: false }`. CSV: `{ body, count, formula_neutralized: true }`.

## SQLite

`user_version` 4 adds `offer_snapshots`, `clips`, `posts`, `alerts`, `earnings_snapshots`, `missions`, `video_clips`, and `posting_caps`. `links.origin` records `placeholder` or a later real capture. `conversions` stores optional `category`, `reason_hint`, and `buyer_class` when the report payload has them.
