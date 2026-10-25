# Phase 1 review — reproducible tests and packaging

Date: 2026-10-26
State: phase verified; evidence committed
Base branch: `main`
Phase branch: `phase/1-reproducible-tests`
Base SHA: `83ef7551af54fd52822d8c958e8a53b8bdd90dde`
Implementation tip before this evidence document: `5c4bdbaefdcb4aa26eca7a5930789367d76c819c`

## Goal

Make the complete local fixture suite and release package checks reproducible
without relying on the author's Codex runtime, global Playwright package,
personal Chrome profile or manually maintained test-command list.

## Scope

- Pin the development-only Playwright dependency and npm lockfile.
- Provide one fail-fast command for release consistency, Python checks and all
  executable JavaScript/browser/native fixtures.
- Resolve Python and Chromium through explicit environment/configured local
  paths rather than author-specific paths.
- Check Python, extension and development-manifest versions; guide version;
  guided 19-tool catalog; bundled skill/workflow and extension file inventory.
- Route generated fixture screenshots/results to one disposable output root.
- Build sdist/wheel and verify a clean wheel install on the minimum Python.

## Non-goals

- No product behavior, public API, UI or Shopee selector change.
- No GitHub Actions workflow or repository setting; those belong to Phase 2.
- No live Shopee account, personal Chrome profile or external marketplace call.
- No PyPI/Chrome Web Store publication and no cross-platform support claim.

## Definition of Done

- `npm ci` installs a locked repository-local Playwright dependency.
- `npm test` names each check, stops on failure and accounts for every `.cjs`
  file as either an executable suite or a helper.
- Release consistency detects version, guide, tool-catalog and package-content
  drift.
- The full fixture suite passes with temporary profiles and blocked external
  test traffic.
- Python 3.11 tests pass; sdist/wheel build; a clean 3.11 venv installs the wheel
  and finds the CLI, workflow, skill, guide and all extension files.

## Commits

| Commit | Purpose |
|---|---|
| `5c4bdbaefdcb4aa26eca7a5930789367d76c819c` | Add locked local test tooling, consistency/package checks and disposable fixture outputs. |

## Changed paths

- `package.json`, `package-lock.json` — private development manifest with Node
  20+ and exact Playwright 1.64.1 lock.
- `scripts/run-tests.cjs` — environment resolution, suite inventory, fail-fast
  orchestration and disposable artifact directory.
- `scripts/check-release-consistency.py` — versions, guide header/manifest,
  runtime/manifest guided catalog and packaged-content checks.
- `pyproject.toml` — development-only `build` extra.
- `README.md`, `IMPLEMENTATION_STATUS.md` — canonical test commands and honest
  inventory: 26 executable `.cjs` suites plus one helper.
- `tests/dashboard-evals.cjs`, `tests/mcp-extension.cjs`,
  `tests/pagination-evals.cjs`, `tests/review-evals.cjs`,
  `tests/sidepanel-evals.cjs`, `tests/workspace-evals.cjs` — generated evidence
  honors `SHOPKUD_TEST_OUTPUT_DIR` instead of author-local directories.

## Architecture and contract decisions

- Keep one small Node runner instead of adding a test framework. Existing suites
  remain directly executable and keep their current assertions.
- Treat `detail-fixture.cjs` as a shared helper, not a passing suite. The honest
  executable inventory is 26 suites, not the historical count of 27 files.
- Set `SHOPKUD_TEST_PYTHON`, both existing Chromium override names and the
  artifact root once for every child process. This preserves existing test
  contracts while removing machine-specific discovery.
- Pin Playwright exactly in the lockfile; browser binaries remain development
  downloads and are not runtime dependencies for ShopKud users.
- Delete disposable artifacts only after a green run; retain their printed temp
  path on failure for diagnosis.

## Compatibility and rollback

Runtime dependencies and product interfaces are unchanged. Node/Playwright and
the Python `dev` extra are development-only. Rollback is the revert of the Phase
1 commit; local `node_modules` and temporary browser caches are ignored/non-product
state and require no data migration.

## Verification

Local environment used for the complete run: macOS arm64, Node 24.18.0,
Python 3.12.10, Playwright 1.64.1 with its isolated Chromium 156 fixture binary.

| Command or check | Outcome |
|---|---|
| `npm ci --ignore-scripts` | Passed; two development packages installed; npm reported 0 vulnerabilities. This covers the npm lock only, not Python dependencies. |
| `npm run test:list` | Listed 26 executable JavaScript suites and `detail-fixture.cjs` as the one helper; no `.cjs` file unaccounted for. |
| `SHOPKUD_TEST_PYTHON=... PLAYWRIGHT_BROWSERS_PATH=... npm test` inside the filesystem sandbox | Failed at the first Chromium launch with `SIGABRT`/`EPERM`; this was a browser-process sandbox restriction, not a test assertion. |
| The exact same `npm test` command with browser-process permission | Passed: release consistency, 244 Python unit tests, rank-playbook eval, broker-cancellation eval and 26/26 executable JavaScript/browser/native suites. |
| `tests/mcp-extension.cjs` within the green run | 44/44 MCP → native host → real MV3 extension fixture stages passed using synthetic blocked-network pages. |
| Python 3.11.16 temporary venv: consistency + unittest discovery | Passed; consistency green and 244/244 Python tests passed. |
| Python 3.11.16 `python -m build --outdir /private/tmp/shopkud-dist` | Built `shopkud_mcp-0.11.8.tar.gz` and `shopkud_mcp-0.11.8-py3-none-any.whl`. |
| Fresh Python 3.11 venv wheel install + `shopkud-mcp --help` | Passed; CLI available and metadata version is 0.11.8. |
| Installed-wheel/package inspection | Bundled workflow, skill and guide found; wheel contains all 24 extension files. |
| `git diff --check` | Passed. |
| Changed-path scan for `/Users/grunte`, `.codex` and old author output paths | No author-specific runtime path in the Phase 1 files. |

The runner blocked or fulfilled fixture traffic as defined by the existing test
suites and used temporary browser profiles. It did not use the owner's profile,
Shopee login, affiliate links, model quota or live marketplace data.

## CI/CD impact

No CI workflow, check name, secret, environment or deployment behavior changed.
Phase 2 can call the same locked commands on a hosted macOS runner and install
Chromium explicitly. No CI result exists for this Phase 1 SHA yet.

## User-visible change

Contributors now have one documented command and an exact test inventory.
Application UI and runtime behavior are unchanged; visual QA is not required for
this phase because only fixture output locations changed, and the browser suites
cover the same rendered states.

## Known risks and non-coverage

- The full browser/native suite ran locally on Python 3.12.10; Python 3.11.16
  exercised the consistency check and all 244 Python unit tests, not every
  browser/native process combination.
- Hosted GitHub Actions behavior, runner provisioning and CI check names remain
  untested until Phase 2.
- npm's 0-vulnerability result does not audit Python dependencies or prove no
  supply-chain/security issue exists.
- Browser fixtures do not validate current Shopee markup, account differences,
  fresh-machine Chrome extension approval or a real native-host installation.
- Only the supported macOS/arm64 development path was exercised locally; Linux
  and Windows remain unvalidated.
- Failed-run artifacts are intentionally retained in a printed temporary path;
  CI must bound or clean those artifacts according to its own retention policy.

## Review record

- Independent local review: pending for the final evidence-commit SHA.
- Push authorization: pending for the final evidence-commit SHA.
- CI: pending implementation in Phase 2; none exists for this branch.
- GPT Bridge review: pending after the approved SHA is pushed.
- Pull request / immutable review URL: pending.

## Completion checklist

- [x] Development dependencies declared and locked.
- [x] Complete executable suite inventory generated dynamically.
- [x] Failed child processes fail the runner.
- [x] Version/catalog/guide/package consistency check added.
- [x] Generated test output routed to disposable storage.
- [x] Full local Python/JavaScript/native fixture command passed.
- [x] Minimum Python 3.11 tests and package build passed.
- [x] Fresh wheel install and packaged-content checks passed.
- [x] Documentation uses the canonical command and honest suite count.
- [x] Evidence document committed.
- [ ] Exact final SHA independently reviewed and authorized for push.
- [ ] Approved SHA pushed and remote SHA confirmed.
- [ ] GPT Bridge review reconciled for the pushed SHA.
- [ ] Phase merged into `main`.
