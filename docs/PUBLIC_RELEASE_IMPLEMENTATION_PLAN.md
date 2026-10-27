# ShopKud MCP — Public MVP Release Implementation Plan

Date: 2026-10-26
Status: IN IMPLEMENTATION — Phases 0–4 complete; Phase 5 supported settings are
applied and reviewed while main protection remains pending owner mobile
confirmation; Phase 6 candidate evidence is prepared for independent review
and exact-SHA CI.
Baseline: `238160e`, package/extension `0.11.8`, guide `1.5.6`.
Repository: https://github.com/Grunte12/shopkud-mcp
Canonical workspace: the repository root; no installation or workflow may depend on a maintainer-specific absolute path.

Phase 0 snapshot: the repository is public on `main`; no GitHub Release exists;
the newest remote tag is `v0.10.5`; `main` is unprotected; Dependabot security
updates, secret scanning and push protection were reported disabled by the
GitHub API. These are baseline facts for later phases, not completed safeguards.

## Objective

Make the existing product a credible, reproducible open-source MVP release.
Do not add product features, redesign the UI, or reopen broad research work.
One worker can execute the phases below in order after owner approval.

The product remains a local-first Shopee Affiliate product-research and selection
workspace: Agent judgment + deterministic Chrome mechanics + evidence Dashboard.
Media generation and cross-platform posting belong to the separate Affiliate Kit.

## Baseline and evidence discipline

Previous checks reported 244 Python tests, 27 JavaScript/browser suites and a
44-stage MCP/extension fixture. Treat these as historical evidence, not a pass for
new changes. Recheck the actual source, branch and runtime before implementation.

The repository is public and MIT licensed. The last audit found no CI workflow,
no current-version release/tag, no main protection, and disabled GitHub security
features. Old `v0.10.x` tags exist; preserve them as historical versions.

Correct these overstatements in release materials:

- A pattern scan finding no secrets is not proof that no secrets exist.
- A clean clone and wheel build are not a fresh-machine Chrome installation.
- Concurrent Agent launches with near-zero queue wait do not prove browser-lane
  contention. Synthetic tests and measured overlapping dispatch are separate.
- `listing_unconfirmed` is unresolved; it is not proven impossible to fix or
  necessarily caused by Shopee. Do not call the optional reader fully validated.
- `detail_verified` describes an Affiliate detail observation, not seller
  authenticity, exact-SKU certainty or a recommendation.

## Execution boundaries

- Preserve unrelated edits and the existing account, token and local saved data.
- Do not create another workspace/worktree or change the canonical folder.
- Never print secrets, upload personal browser state or run CI on a personal
  self-hosted runner. Use synthetic fixtures and disposable profiles.
- No purchases, posts, mission enrollment or affiliate-link creation during QA.
- No new backend, Docker, hosted database, gateway, Windows/Linux installer,
  Chrome Web Store submission or PyPI publication in this release task.
- Do not auto-merge dependency PRs or rewrite/delete historical tags.
- Plan approval is separate from execution: do not publish a release or change
  GitHub protection/security settings merely because this document exists.
- During execution, use least-privilege GitHub access. Record unsupported or
  permission-blocked settings rather than pretending they are enabled.

## Phase 0 — Freeze scope and reconcile release claims

Files: `PLAN.md`, `IMPLEMENTATION_STATUS.md`, `FINAL_REPORT.md`,
`docs/LIVE_ACCEPTANCE_0.11.8_2026-10-26.md`, this plan.

1. Read root `AGENTS.md`; inspect status, HEAD, remote, package and extension
   versions, current GitHub settings and existing releases/tags.
2. Mark old findings as historical instead of leaving contradictory completed
   and incomplete statements under one current-status heading.
3. Classify capabilities as verified local fixture, observed live, not validated,
   or deferred. State that live seller/variant inspection remains incomplete.
4. Define the supported launch audience: macOS + Google Chrome + Python 3.11+
   and an MCP client supporting Streamable HTTP with private headers.

Acceptance: a reader can identify the current build, proven paths and remaining
limits without reconciling conflicting documents. No claim of universal support.

## Phase 1 — Reproducible tests and packaging

Files: a small test runner under `scripts/` if needed, test dependency declaration
(`package.json`/lockfile or an equivalent existing mechanism), `pyproject.toml`,
focused release-check tests. Reuse existing runners where possible.

1. Declare development-only Playwright/Node dependencies with a lockfile. Do not
   depend on the author's Codex runtime path, cached browser or global packages.
2. Provide one command that enumerates and runs all intended `.cjs` suites,
   names each suite and exits nonzero on any failure. Check child exit codes;
   do not let shell continuation turn a failed step into apparent success.
3. Set `SHOPKUD_TEST_PYTHON` explicitly and use disposable fixture profiles.
   Supply any browser-path override through existing test configuration.
4. Add a small consistency check: Python/extension version match, guide manifest
   matches its header, guided tool names/count match the documented catalog.
5. Build wheel and source distribution. Check the bundled extension files,
   workflow and skill; install the wheel into an empty venv and verify CLI help.
6. Exercise minimum Python 3.11 as well as the chosen current CI Python version.

Acceptance: documented commands work without machine-specific dependency paths;
all suites are accounted for, packaging is complete, and a broken suite fails
the runner. No requirement to install Node/Playwright for end users.

## Phase 2 — Minimal GitHub CI

Files: `.github/workflows/ci.yml`, development instructions, release checks.

1. Add `push` to main, `pull_request` and manual dispatch triggers.
2. Use hosted runners, `contents: read`, bounded job timeouts and cancellation
   of superseded runs. Never use `pull_request_target` to execute PR source.
3. Run Python tests/version checks on the minimum and selected current Python.
4. Run all browser/native fixtures on hosted macOS initially, matching the
   supported environment; do not add a complex cross-platform matrix.
5. Install Chromium explicitly. Run tests with no Shopee login or live account.
   Keep external page requests blocked by fixtures.
6. Build/install the package and run a dependency vulnerability check. Review
   findings by affected version; never suppress them without a recorded reason.
7. Pin third-party Actions to reviewed immutable commits. Keep logs/artifacts
   bounded and synthetic. Upload failure evidence only when useful.

Acceptance: a GitHub run on the exact candidate commit is green and includes the
entire intended suite list; no skipped platform-specific fixture is called a pass.
Resolve CI environment failures before imposing required status checks.

## Phase 3 — Public onboarding and lifecycle documentation

Files: `README.md`, `docs/INSTALL_FOR_AGENTS.md`, optionally `CHANGELOG.md`.

1. Put requirements, quick start, Agent handoff and known limitations near the
   top. Move long historical changelog entries out of the primary onboarding path.
2. Use the new `Grunte12/shopkud-mcp` URL. Explain that Chrome extension approval
   and Shopee login remain human steps; do not claim literal unattended one-click.
3. Clarify Chrome local workspace versus optional worker SQLite history, their
   limits, persistence and what removal will erase.
4. Document a safe update procedure: inspect local edits, install the selected
   release, preserve config/token, reload the extension, idle-only worker restart,
   reconnect the MCP client and verify matching versions.
5. Document uninstall without running it on the owner's machine: remove the
   client entry, stop the exact launchd service, remove its exact plist/native
   manifest and extension; retain local data by default. Deleting saved data
   requires a separate explicit choice and exact resolved paths.
6. State that removing the extension can erase Chrome-stored projects. Do not
   promise an export/restore function unless verified in implementation.
7. Add compact troubleshooting for missing Python, port conflict, extension ID
   mismatch, permissions, login/challenge, workspace disabled, stale versions and
   uncertain reads. Never advise disabling authentication or exposing loopback.
8. Label analytics as owner-supplied aggregate CSV analysis, not automatic live
   Shopee analytics; describe mission tools' actual local-record behavior.

Acceptance: a new coding agent has explicit install/update/stop/remove/verify
instructions and knows what still needs the owner. All local links resolve.
No new uninstall framework or installer wizard is needed for MVP.

## Phase 4 — Security reporting and contribution basics

Files: `SECURITY.md`, short `CONTRIBUTING.md`, `.github/dependabot.yml`.

1. State supported versions and trust boundaries; explain data sent to the
   user's selected Agent provider versus data retained locally.
2. Use GitHub private vulnerability reporting after verifying it is enabled.
   Do not invent a support email or promise response SLAs.
3. Tell reporters not to attach tokens, configs, cookies, browser profiles or
   personal sales data to public issues. Request sanitized reproductions.
4. Document setup/test commands and expectations for small PRs, regression tests
   and synthetic evidence. Keep process proportional to a single-maintainer MVP.
5. Configure low-noise scheduled dependency updates for Python, development npm
   dependencies if introduced, and Actions; no automatic merging.

Acceptance: security-reporting link works, contribution commands match CI, and
all documentation describes existing behavior rather than intended safeguards.

## Phase 5 — GitHub repository settings

External changes: perform only after execution approval, save a sanitized record
of prior settings for rollback, and verify each applied setting through GitHub.

1. Enable dependency graph/alerts, supported Dependabot security updates, secret
   scanning and push protection. Record entitlement/API limitations accurately.
2. Enable private vulnerability reporting and test the reporting entry point
   without submitting a fake advisory.
3. Enable automatic deletion of merged feature branches. Add relevant topics
   (`mcp`, `chrome-extension`, `shopee`, `ai-agents`, `affiliate-marketing`).
4. Hide unused Wiki/Projects only if still empty; never remove existing content.
5. After CI passes, protect main against force-push/deletion and require the
   actual stable CI check names. Do not require an independent approval from a
   nonexistent second maintainer or lock the owner out; document the policy.

Acceptance: settings verified, CI can still pass/merge normally, no unsupported
security claim, and rollback settings are recorded without credential values.

## Phase 6 — Candidate acceptance and release preparation

Files: one concise release evidence report and release notes under `docs/`.

1. Review the complete diff; scan changed files and reachable history using an
   established secret scanner when available. Record scanner/version/scope and
   limitations. Inspect potential findings without printing their values.
2. Run dependency audit against the resolved release environment; assess any
   applicable findings before deciding to publish.
3. Clone the candidate into a disposable location, follow documented packaging
   instructions and verify the wheel. Keep fresh-machine Chrome installation
   explicitly unvalidated unless it is actually performed on a clean user setup.
4. Reuse recent live evidence for unchanged product code. Run targeted live
   read-only checks only for changed behavior; do not repeat the whole swarm
   merely because documentation changed.
5. Verify real demo clips and UI images have no private data. The illustration
   must remain labeled conceptual. No need to block a software release on a
   promotional video; its link can be added later.
6. Record what passed, what was not tested and the known limitations. Set
   `GO`, `GO with documented limitations`, or `NO-GO` with reasons.

Acceptance: green CI on exact candidate SHA, clean repository, install artifacts
checked, no unresolved release-blocking issue, honest public documentation.

## Phase 7 — Tag and GitHub Release

1. Confirm `v0.11.8` is still unused. If only release/docs/test changes were made
   and 0.11.8 remains unreleased, use it. If product behavior changes materially
   or the version was published elsewhere, choose the next patch and update all
   version checks rather than moving an existing tag.
2. Commit/push the scoped work through the agreed policy. Wait for CI on the
   final SHA before creating an annotated tag. Never tag a dirty checkout.
3. Prepare a draft Release: purpose, key features, supported environment,
   install handoff, migration notes, evidence and limitations.
4. Attach only verified distributable artifacts if useful: wheel and extension
   ZIP from the exact tag, plus checksums. Source archives are provided by
   GitHub. No development venv, local state or browser captures in assets.
5. Validate asset paths/manifest and download links, then publish when release
   publication is explicitly authorized. Mark it clearly as an MVP; do not imply
   stable support for every Shopee account/layout or all operating systems.
6. Verify latest release/version links, clean local status and tag-to-SHA binding.

Acceptance: public release points at the tested immutable revision; install
instructions and assets agree. If an artifact is defective, stop distribution
and issue a corrective release—do not silently retag a published version.

## Completion handoff

Return a short Thai summary with:

- Candidate/final commit, CI URL, release URL and version.
- What changed, supported installation path and actual verification scope.
- GitHub security/protection settings applied or blocked.
- Remaining `listing_unconfirmed`, seller/variant and platform limitations.
- Any owner-only step still needed; do not say “perfect” or “100% secure”.

## Worker prompt

> Execute `docs/PUBLIC_RELEASE_IMPLEMENTATION_PLAN.md` after the owner approves
> implementation. Read root AGENTS.md first. Work only in the canonical ShopKud
> repo, preserve unrelated edits, and keep changes minimal. You are not alone in
> the codebase: do not revert others' changes. Complete phases in order, record
> evidence, and do not expand MVP product scope. Resolve CI/install/docs gaps
> before release. External settings and release publication require explicit
> execution authority; if absent, finish local work and prepare the exact pending
> actions. Never hide unknown data, claim contention from Agent start times alone,
> or use a public-product failure as proof that the problem cannot be fixed.
