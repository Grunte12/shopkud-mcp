# Phase 2 review — GitHub CI

Date: 2026-10-26
State: repaired workflow green; current Action-pin update awaiting hosted rerun
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
| `0e50a945f25677641aed15fdcf07bf7f8660e101` | Add the initial Phase 2 evidence document; later superseded by the portability repair. |
| `ade2030da509fea5a9f3ad8e626f6df7fe3827bb` | Replace macOS-only temporary paths, add a portability guard and update repair evidence. |

The first pushed candidate, `0e50a945f25677641aed15fdcf07bf7f8660e101`,
is superseded. Its hosted run exposed the portable-temp defect described below;
it must not be used as the merge candidate.

## Changed paths

- `.github/workflows/ci.yml` — three-job hosted workflow.
- `README.md` — concise CI coverage and no-live-account statement.
- `tests/*.py`, `evals/rank-playbook.py` — use the standard-library temporary
  directory instead of a macOS-only path.
- `scripts/check-release-consistency.py` — reject macOS-only `/private/tmp`
  paths anywhere in executable Python tests/evals.
- `docs/phase-reviews/phase-2-github-ci.md` — retain the failed hosted-run and
  repair evidence.

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

The following current stable tag-to-SHA mappings were resolved from the
official Action Git remotes:

- `actions/checkout` v7.0.1 —
  `3d3c42e5aac5ba805825da76410c181273ba90b1`
- `actions/setup-python` v7.1.0 —
  `6d4fd22b20465ccc0f7354476588e8df7c9ca0e0`
- `actions/setup-node` v7.1.0 —
  `949feb2413d6458794dcd2491c4babbbce0c15c1`

Comments retain the human-readable versions; workflow execution uses only the
immutable SHAs. Hosted run 40236760624 passed with the earlier pins, but GitHub
annotated those Action releases because their internal runtime used deprecated
Node 20. The current stable immutable pins address that avoidable deprecation;
their hosted rerun is still required. The project deliberately continues to
test its own Node-facing fixtures on Node 20.

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
| [Hosted run 40236078734](https://github.com/Grunte12/shopkud-mcp/actions/runs/40236078734) on superseded SHA `0e50a94` | Failed only the Python 3.11/3.13 jobs with 77 errors because executable tests/evals hardcoded macOS-only `/private/tmp`; browser/native and package/audit jobs passed. |
| Portable-temp focused check on Python 3.12.10 | Passed release consistency plus 130 affected tests; 22 executable Python files scanned. |
| Initial sandbox-restricted full-suite attempt | Could not create Unix sockets in the macOS system temp directory; this was a local sandbox permission failure, not a test assertion. The permitted reruns below passed. |
| Full Python verification on Python 3.12.10 | Passed 244 unit tests, rank-playbook eval and broker-cancellation eval. |
| Full Python verification on Python 3.11.16 | Passed 244 unit tests, rank-playbook eval and broker-cancellation eval. |
| Python 3.13 local verification | Not available on this Mac; remains covered by the hosted matrix rerun. |
| [Hosted repaired run 40236760624](https://github.com/Grunte12/shopkud-mcp/actions/runs/40236760624) on `ade2030` | Passed all four checks: `Python 3.11`, `Python 3.13`, `Browser and native fixtures`, and `Package and dependency audit`. The run verified the portable-temp repair and exact check names. |
| Hosted annotations on run 40236760624 | Reported deprecated Node 20 runtimes inside the previously pinned Action releases; prompted the current stable immutable-pin update. |
| `actionlint` v1.7.7 after the stable-pin update | Passed with no workflow findings. |
| Ruby YAML/structure check after the stable-pin update | Passed; retained exactly three jobs, read-only contents permission and concurrency cancellation. |

The initial hosted run proved the browser/native and package/audit paths, then
found that Python fixtures assumed a macOS-only temporary directory. The repair
uses `tempfile` exclusively, preserves the existing private-directory and
cleanup semantics, and adds a release-consistency guard against recurrence. A
hosted run 40236760624 verified the repair, including Python 3.13. Because the
Action pins changed after that run, the new candidate still needs one hosted
rerun before merge.

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

- The portable-temp repair passed hosted CI. The current candidate changes only
  Action pins, so it still needs a hosted rerun before merge.
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
- Hosted CI: [run 40236078734](https://github.com/Grunte12/shopkud-mcp/actions/runs/40236078734)
  failed on superseded SHA `0e50a94`; [run 40236760624](https://github.com/Grunte12/shopkud-mcp/actions/runs/40236760624)
  passed all four checks on repair SHA `ade2030`; a rerun for the current stable
  Action pins remains pending.
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
- [x] Portable-temp repair passed hosted CI; exact four check names recorded.
- [ ] Current stable Action-pin candidate pushed and hosted CI green.
- [ ] GPT Bridge review reconciled for the pushed SHA.
- [ ] Phase merged into `main`.
