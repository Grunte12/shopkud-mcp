# Phase 2 review — GitHub CI

Date: 2026-10-26
State: locally verified; hosted CI pending
Base branch: `main`
Phase branch: `phase/2-github-ci`
Base SHA: `c691ffd8de0602d9b61993531526a141bf4a8560`
Implementation tip before this evidence document: `ae3bb608fad37a891dcbef392b5ca580587aa6f3`

## Goal

Run the reproducible ShopKud release checks on least-privilege GitHub-hosted
runners for every pull request and main-branch update, without exposing an owner
browser profile, Shopee account, bearer token or personal machine.

## Scope

- Add one minimal GitHub Actions workflow for Python compatibility,
  browser/native fixtures, package installation and dependency audits.
- Reuse the Phase 1 `npm test` command rather than duplicate suite lists.
- Pin every third-party Action to an immutable reviewed commit SHA.
- Document that CI is synthetic/offline and receives no live account state.
- Validate the workflow structure and commands locally as far as possible before
  the first hosted run.

## Non-goals

- No product, package, selector, UI or test behavior change.
- No GitHub repository security setting or branch-protection change.
- No deployment, PyPI/Chrome Web Store publication or release asset upload.
- No self-hosted runner, Shopee login, live browser profile or production secret.
- No claim that hosted checks are green before the branch is pushed.

## Definition of Done

- CI triggers on pull requests, pushes to `main` and manual dispatch.
- Top-level permissions are `contents: read`; superseded runs cancel.
- Python 3.11 and 3.13 checks run with bounded timeouts.
- The complete synthetic browser/native suite runs on hosted macOS with an
  explicitly installed Chromium.
- Source/wheel builds, a fresh wheel install and package contents are checked.
- Python and npm dependency audits fail on applicable findings; no finding is
  silently suppressed.
- Local workflow lint/config validation passes; hosted CI remains an explicit
  gate before branch protection or merge.

## Commits

| Commit | Purpose |
|---|---|
| `ae3bb608fad37a891dcbef392b5ca580587aa6f3` | Add least-privilege GitHub CI and document its synthetic scope. |

## Changed paths

- `.github/workflows/ci.yml` — three-job hosted workflow.
- `README.md` — concise CI coverage and no-live-account statement.

## Workflow contract

Triggers:

- `push` to `main`
- `pull_request`
- `workflow_dispatch`

Global controls:

- `permissions: contents: read`
- concurrency group `ci-${{ github.workflow }}-${{ github.ref }}`
- `cancel-in-progress: true`
- no `pull_request_target`, repository write permission or secrets

Jobs and expected check names:

| Job | Runner | Timeout | Expected checks |
|---|---|---:|---|
| `python` | `ubuntu-latest` | 15 min | `Python 3.11`, `Python 3.13` |
| `browser-native` | `macos-14` | 30 min | `Browser and native fixtures` |
| `package-audit` | `ubuntu-latest` | 20 min | `Package and dependency audit` |

The browser job installs Python 3.13, Node 20, the locked npm dependencies and
Playwright Chromium, then runs the same `npm test` command verified in Phase 1.
The package job builds sdist/wheel, installs the wheel in a new venv, checks the
CLI, workflow, skill, guide and 24 bundled extension files, then audits Python
runtime and locked npm dependencies.

## Immutable Action references

The following tag-to-SHA mappings were resolved from the official Action Git
remotes before implementation:

- `actions/checkout` v4.2.2 —
  `11bd71901bbe5b1630ceea73d27597364c9af683`
- `actions/setup-python` v5.6.0 —
  `a26af69be951a213d495a4c3e4e4022e16d87065`
- `actions/setup-node` v4.4.0 —
  `49933ea5288caeca8642d1e84afbd3f7d6820020`

Comments retain the human-readable versions; workflow execution uses only the
immutable SHAs.

## Security and data boundaries

- CI uses synthetic fixture pages and temporary profiles only.
- No Shopee credentials, cookies, affiliate links, browser state, ShopKud config
  or bearer token are configured or requested.
- The workflow does not call a live Shopee page as part of its test contract.
- No public artifact upload is configured; evidence remains bounded to logs.
- Hosted runners are used exclusively; the owner's Mac is not attached to CI.

## Audit remediation

The first local Python audit correctly reported vulnerabilities in `pip 24.0`
and `setuptools 79.0.1` inherited by a temporary wheel-install venv. These were
not hidden, ignored or removed from the audit input. The workflow now upgrades
that isolated venv to fixed, pinned `pip 26.2.2` and `setuptools 84.2.1` before
installing and auditing the full environment. The repeated audit returned no
known vulnerabilities. A future applicable finding will fail the job.

## Verification

| Command or observation | Outcome |
|---|---|
| Official `git ls-remote` for each Action tag | Resolved the three immutable SHAs recorded above. |
| Ruby YAML/structure check | Parsed the workflow and found exactly `python`, `browser-native`, `package-audit`; top-level `contents: read`. |
| `actionlint` v1.7.7 | Passed with no workflow findings. |
| Forbidden-pattern scan | No `pull_request_target`, self-hosted runner, secret reference, `continue-on-error`, vulnerability ignore or skipped check. |
| `npm ci --ignore-scripts` | Passed from the lockfile. |
| `npm audit --audit-level=high` | Passed; 0 vulnerabilities reported. |
| Initial `pip-audit==2.10.1 --strict` of the temporary wheel environment | Failed on old venv packaging tools; finding retained and remediated as described above. |
| Repeated strict Python audit after pinned packaging-tool upgrade | Passed; no known vulnerabilities reported. |
| `git diff --check` | Passed. |

The complete product fixture suite was already green on the Phase 1 base and no
product/test source changed here. It will be rerun by the new macOS CI job.

## CI/CD impact

This phase adds CI only. It does not deploy, publish, tag, upload artifacts or
mutate repository settings. Once pushed, GitHub will create the four expected
check names listed above. Do not configure required status checks until a hosted
run proves their exact names and stable behavior.

## User-visible change

The README now tells contributors that hosted CI covers Python 3.11/3.13, the
complete macOS fixture path, clean package installation and dependency audits
without live Shopee state. Application behavior and UI are unchanged.

## Compatibility and rollback

Runtime compatibility is unchanged. Reverting the Phase 2 commit removes the
workflow and its README note. No data migration, service restart or local-user
cleanup is required. Repository protection must not depend on these checks until
the first stable hosted run, which keeps rollback possible without lockout.

## Known risks and non-coverage

- No hosted GitHub run exists for this candidate yet. Runner images, exact
  check-name rendering and macOS browser provisioning remain pending evidence.
- `ubuntu-latest` is intentionally floating; the Actions are immutable, but the
  hosted operating-system image can change. Test failures must be investigated,
  not suppressed.
- Python audit uses the resolved wheel environment at CI time; indirect versions
  can change within project constraints and may expose new findings later.
- npm's result covers the locked development dependency graph, not arbitrary
  global Node installations.
- CI does not validate current Shopee markup, extension approval, a real native
  host install or live account behavior.
- Branch protection and required checks are deliberately deferred until the
  hosted workflow succeeds.

## Review record

- Independent local review: pending for the final evidence-commit SHA.
- Push authorization: pending for the final evidence-commit SHA.
- Hosted CI: pending branch push; no run/check URL yet.
- GPT Bridge review: pending after the approved SHA is pushed.
- Pull request / immutable review URL: pending.

## Completion checklist

- [x] Main/PR/manual triggers configured.
- [x] Read-only permission, cancellation and bounded timeouts configured.
- [x] Minimum/current Python checks configured.
- [x] Complete synthetic macOS browser/native command configured.
- [x] Package build/install/content verification configured.
- [x] Python and npm audits configured without silent suppression.
- [x] Third-party Actions pinned to verified immutable SHAs.
- [x] Local YAML, actionlint and audit commands pass after remediation.
- [x] No live state, secret or self-hosted runner required.
- [x] Evidence document committed.
- [ ] Exact final SHA independently reviewed and authorized for push.
- [ ] Approved SHA pushed and remote SHA confirmed.
- [ ] Hosted GitHub Actions run green; exact check names recorded.
- [ ] GPT Bridge review reconciled for the pushed SHA.
- [ ] Phase merged into `main`.
