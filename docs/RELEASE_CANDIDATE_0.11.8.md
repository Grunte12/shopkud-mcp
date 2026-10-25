# ShopKud MCP 0.11.8 release candidate

Date: 2026-10-26

Decision: **GO with documented limitations for independent review**

Candidate product commit: `db9942da3e234106f92884cd7cb2effe84038276`

Publication is not yet authorized. The Phase 6 evidence commit still needs an
independent exact-SHA review and green hosted CI before tagging or releasing.

## Scope reviewed

The public-release diff from `238160e` through `db9942d` contains 39 files:
release and lifecycle documentation, reproducible test/package declarations,
portable test fixtures, GitHub CI, Dependabot configuration and repository
settings evidence. It does not change `shopkud_mcp/` runtime behavior or the
Chrome extension source.

`git diff --check 238160e..db9942d` passed. The complete changed-file list and
source/config diff were reviewed; public claims remain separated into fixture
evidence, observed live evidence, unvalidated behavior and deferred scope.

## Verification evidence

### Hosted CI on the candidate product commit

[GitHub Actions run 40240932686](https://github.com/Grunte12/shopkud-mcp/actions/runs/40240932686)
is green on exact commit `db9942da3e234106f92884cd7cb2effe84038276`:

- `Python 3.11`
- `Python 3.13`
- `Browser and native fixtures`
- `Package and dependency audit`

The final Phase 6 documentation commit must receive the same four green checks
after review and push; the run above does not pre-approve a later SHA.

### Disposable clone, package and tests

An exact-SHA local clone in a disposable directory followed the documented
Quick Start. Editable installation and `shopkud-mcp --help` succeeded. The same
clone built both `shopkud_mcp-0.11.8.tar.gz` and
`shopkud_mcp-0.11.8-py3-none-any.whl`.

The wheel installed into a second empty virtual environment. Verification found:

- installed package version `0.11.8`
- bundled workflow and Agent skill/reference files
- 24 bundled Chrome extension files in both wheel and source distribution
- working installed CLI help

The complete synthetic command passed after one sandbox-only browser-launch
failure was rerun with permission to launch Chromium:

- release consistency: version `0.11.8`, guide `1.5.6`, 19 guided tools
- 244 Python unit tests
- rank-playbook and broker-cancellation evals
- 26 executable JavaScript/browser/native suites; one helper is not a suite

The first attempt failed when the execution sandbox denied Chromium process
control (`EPERM`). The identical command passed outside that restriction; this
was an environment failure, not a product retry or ignored test.

### Dependency audit

- `pip-audit 2.10.1` audited the resolved disposable Python environment. The
  venv bootstrap initially supplied vulnerable installer `pip 25.0.1`; aligning
  it with CI's reviewed `pip 26.2.2` removed those installer findings. The final
  strict audit reported no known vulnerabilities.
- `npm audit --audit-level=high` against `package-lock.json` reported zero
  vulnerabilities.

These results cover the resolved environment on 2026-10-26. Advisory databases
and future dependency resolution can change.

### Secret scanning

`Gitleaks 8.30.1` ran with redaction over the current directory and all 59
reachable commits. It reported two unique `generic-api-key` candidates,
duplicated in ignored build/worktree copies. Manual inspection without printing
candidate values confirmed both are telemetry field names/values
(`token_estimate_method` and `response_tokens_estimate`), not credentials.

`detect-secrets 1.5.0` separately scanned all tracked files and reported three
unverified candidates in synthetic test fixtures. Manual inspection classified
them as fixture HTML/URL/nonce data. No finding was suppressed and no raw
candidate value is stored in this report.

Pattern scanners reduce risk; they do not prove that a repository contains no
secret. GitHub Secret Protection and push protection are also enabled.

### Live evidence and public media

Runtime and extension product code did not change after the documented
[0.11.8 live acceptance](LIVE_ACCEPTANCE_0.11.8_2026-10-26.md), so that recent
read-only evidence was reused. Phase 6 made no purchase, post, mission
enrollment, affiliate-link creation or live write.

Tracked public media comprises the architecture PNG/SVG and the social-promo
PNG. They were visually inspected and contained no account identity, browser
profile, token, cookie, private URL or personal sales data. The social-promo
figures remain labeled in the README as a concept visual with illustrative,
non-live values. No demo video clip is tracked in this repository; the launch
brief is direction only and does not block the software candidate.

## Documented limitations

- Supported install path: macOS, Google Chrome, Python 3.11+, and an MCP client
  supporting Streamable HTTP with a private authorization header.
- A clean local clone is not a fresh-machine Chrome/native-host installation.
  Linux and Windows native-host registration remain unvalidated.
- Live Shopee layouts, seller identity, exact SKU/variant certainty and
  `listing_unconfirmed` recovery remain incomplete. Unknown values stay unknown.
- Analytics require an owner-supplied aggregate CSV. ShopKud does not download
  live Shopee analytics automatically.
- Mission tools maintain local records; they do not enroll on Shopee.
- Media generation, uploading and cross-platform posting are deferred to the
  separate Affiliate Kit.
- Main branch protection was not applied because GitHub Mobile confirmation
  timed out twice. Other Phase 5 security/settings changes are verified and the
  pending protection state is recorded.

## Release gate

The candidate may proceed to Phase 7 only after all of these are true:

1. independent review passes on the exact Phase 6 evidence commit;
2. the four hosted CI checks pass on that exact SHA;
3. `v0.11.8` is still unused and the worktree is clean; and
4. the owner explicitly authorizes tag and GitHub Release publication.

Until then: no tag, release, package publication or release asset is approved.
