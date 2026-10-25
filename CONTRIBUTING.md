# Contributing to ShopKud MCP

Keep changes small, evidence-based and safe for a local Chrome/account boundary.
One focused pull request is easier to review than a broad refactor.

## Development setup

Requirements: Python 3.11+, Node.js 20+ and the locked development dependencies.
Live Shopee credentials are not needed for the test suite.

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -e '.[dev]'
npm ci --ignore-scripts
npx playwright install chromium
```

## Tests

Run the complete synthetic suite before opening a pull request:

```sh
SHOPKUD_TEST_PYTHON="$PWD/.venv/bin/python" npm test
```

`npm run test:list` prints the exact Python/browser suite inventory. GitHub CI
also checks Python 3.11 and 3.13, builds and installs the wheel, and audits the
resolved Python and locked npm dependencies.

For a small change, run its focused test while working, then run `npm test`
before requesting review. New behavior or a bug fix should include the smallest
regression test that proves it. Browser fixtures must use synthetic pages and
block external requests.

## Pull-request scope

- Explain one problem, the smallest complete fix and how it was verified.
- Preserve the 19-tool guided contract unless the change explicitly updates the
  workflow, skill, catalog checks and public documentation together.
- Keep product text untrusted and preserve unknown/partial evidence instead of
  inventing values.
- Do not bundle generated captures, local state, broad formatting or unrelated
  cleanup with a functional change.
- Update public docs when behavior, support or limitations change.
- Do not add a gateway, cloud backend, Docker requirement or new dependency
  without a concrete need and maintainer agreement.

## Test and privacy rules

Never commit or attach real bearer tokens, configs, cookies, Chrome profiles,
extension storage, SQLite databases, affiliate receipts, personal sales data,
raw conversion CSVs or live-account screenshots. Use synthetic IDs, URLs and
sanitized fixtures.

Do not use a real account to create links, enroll missions, post, purchase or
change selections for a pull-request test. Live read-only evidence is requested
only when a maintainer explicitly decides it is necessary.

Security reports follow [SECURITY.md](SECURITY.md). Do not put sensitive
vulnerability details in a public issue while the private route is unavailable.

## Review checklist

- [ ] The pull request has one clear purpose.
- [ ] Focused tests and the complete `npm test` suite pass.
- [ ] No secret or personal/live-account artifact is included.
- [ ] User-visible behavior and limitations are documented accurately.
- [ ] The change does not weaken loopback binding, bearer authentication,
      permission checks or uncertainty handling.
