# ShopKud Console (frontend)

Human-facing console for the owner. It is plain ES modules served statically by the existing express console (`src/console/public`), with no build step. It uses only the JSON API in [API.md](API.md) (`POST /api/v1/tools/<name>` with header `X-ShopKud-Console: 1`, `GET /api/v1/tools`, `GET /api/v1/export/:kind`).

## Run

```bash
# real data (needs your own Chrome/CDP)
SHOPKUD_DB_PATH=./shopkud.db npm run console      # http://127.0.0.1:3000

# demo: seeded temp database + fake Chrome on 127.0.0.1:9444. Never touches real Chrome or Shopee.
npm run console:demo                              # DEMO_CAPTCHA=0 clears the CAPTCHA stop
```

## Pages

| Route | What it shows |
|---|---|
| `#/overview` | Chrome/CDP, login, CAPTCHA stop + what to do, queue, page loads vs cap, report sync |
| `#/workflow` | Pipeline diagram (product, offer, link, verify, post, conversions) and queue jobs |
| `#/subid` | Animated "How Sub ID works" explainer, chip anatomy, group-by-chip dashboard |
| `#/links` | Registry with chips + owned_by_us badge; Sub ID builder with live preview |
| `#/offers` | Commission split (store / Shopee / Xtra) stacked bar, excluded-category warning |
| `#/analytics` | KPIs, time series, sales_by, Sankey, untracked share, alerts, cancellations, earnings |
| `#/tools` | convert_links_in_text, posting caps, export CSV/JSON, missions, logs, safety |

Sub ID slot colors are the same everywhere: s1 platform (blue), s2 product (orange), s3 clip (green), s4 variant (purple), s5 month (pink); an empty slot is "untracked" (amber).

## Safety rules enforced by the UI

- Localhost only; only documented API paths are called; cookie/token/secret-shaped fields are scrubbed before render.
- Short links are plain text with a copy button, never anchors, so a `s.shopee.co.th` link is never opened.
- Every real write is behind a confirm dialog: `create_link` (dry-run is the default and writes nothing), `set_posting_cap`, `check_commission_health`, `enroll_mission` (prepare-only), and a cold-cache `get_offer` (costs a page load).
- `verify_link` and `get_conversions` (real Shopee page loads) are intentionally not exposed.

## Tests

```bash
npm run test:console    # logic tests + Playwright e2e against the real console, seeded temp sqlite, mock Chrome
```

The e2e suite needs a headless Chrome (`/usr/local/bin/google-chrome`, or set `SHOPKUD_TEST_CHROME`). It uses ports 9451 (mock Chrome) and never 9222/9333. It rewrites the screenshots in `docs/console-screenshots/`.

## API gaps

- No queue control tools: Pause/Resume/Stop buttons feature-detect `queue_pause`, `queue_resume`, `queue_stop` via `GET /api/v1/tools` and stay disabled when absent.
- No endpoint for the last report sync time; the newest `purchased_on` in the conversions export is used as a proxy.
- No endpoint for the page-load cap or today's count; derived from `posting_budget` where possible, otherwise shown as unknown.
- `check_commission_health` alert detail (old/new rate) is not in the export; shown only after running it.
- No dedicated "dry-run" in `create_link`; the UI dry-run is client-side (`find_link` + `posting_budget`). The real Shopee submit stays CLI-only.
