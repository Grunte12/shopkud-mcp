# Phase 4 review — security, contributions and dependency maintenance

Date: 2026-10-26
State: implementation verified locally; independent review pending
Base branch: `main`
Phase branch: `phase/4-security-contributing`
Base SHA: `3b776bec9d2d0c3456699c41307a29860f87e466`
Implementation tip before this evidence document: `92bd8735aa91e86ad534d697e30e732742ea6d47`

## Goal

Publish an honest security policy, a small-project contribution path and
low-noise dependency maintenance without inventing a private contact channel,
response promise or automation the repository does not have.

## Scope

- Define the supported release line and security trust/data boundaries.
- Prohibit secrets, browser state and personal/live sales data in public issues.
- Explain how to provide a sanitized reproduction.
- Document concise development, test and small-pull-request expectations that
  match the existing CI contract.
- Schedule grouped monthly Dependabot updates for Python, npm and GitHub Actions.
- Link the new policies from the README.
- Check GitHub Private Vulnerability Reporting availability read-only before
  describing any private reporting route.

## Non-goals

- No GitHub security, vulnerability-reporting or repository setting change.
- No email address, support contract, response time or remediation SLA.
- No auto-merge, dependency update approval or branch-protection change.
- No runtime, extension, package, test, database or public API behavior change.
- No security audit or penetration-test claim.

## Definition of Done

- Supported versions and unsupported historical lines are explicit.
- Agent-provider, loopback worker, bearer token, Chrome storage and optional
  SQLite/CSV boundaries are described accurately.
- Public reports forbid tokens, configs, cookies, profiles, private databases,
  raw CSVs and personal sales data; sanitized evidence is requested instead.
- Private vulnerability reporting is advertised only if verified enabled.
- Contribution commands match current package metadata and the CI suite.
- Dependency updates are monthly, grouped and bounded with no auto-merge.
- YAML and local links validate; no source/runtime files change.

## Commits

| Commit | Purpose |
|---|---|
| `92bd8735aa91e86ad534d697e30e732742ea6d47` | Add public security/contribution policies, README links and low-noise Dependabot configuration. |
| `8be977e42577b80e15185ce4eb7a655a720cfd74` | Clarify that the complete local browser/native suite is supported on macOS and other systems rely on focused checks plus hosted macOS CI. |

The evidence-document commit SHA is intentionally pending; a commit cannot
truthfully contain its own SHA.

## Changed paths

- `SECURITY.md` — supported versions, reporting limitation, sanitized evidence,
  trust boundaries and operational safeguards.
- `CONTRIBUTING.md` — environment setup, complete synthetic test command,
  small-PR scope, privacy rules and review checklist.
- `.github/dependabot.yml` — grouped monthly Python/npm/Actions updates.
- `README.md` — links to the security and contribution policies.
- `docs/phase-reviews/phase-4-security-contributing.md` — this evidence.

## Private vulnerability reporting evidence

A read-only request to GitHub's repository endpoint
`GET /repos/Grunte12/shopkud-mcp/private-vulnerability-reporting` returned HTTP
`200` with `{"enabled": false}` on 2026-10-26. No update request was sent.

Accordingly, `SECURITY.md` does not advertise an unavailable private form. It
tells reporters not to expose sensitive details publicly and to wait until the
repository Security page shows GitHub's verified **Report a vulnerability**
action for reports that cannot be safely sanitized. Non-sensitive defects can
use a public issue with synthetic evidence.

No maintainer email, alternate contact, response time or remediation SLA was
invented. Enabling and verifying the GitHub route remains a later settings task.

## Trust and data decisions

- The MCP worker remains loopback-only and bearer-authenticated. The bearer
  token, browser profile and cookies remain on the owner's machine.
- Tool input/output can be sent to the Agent provider selected by the owner;
  this includes bounded product observations, citations and requested local
  workspace results.
- Chrome Personal Workspace stays in the Chrome profile and may be erased when
  its extension data is removed.
- Optional SQLite state and sanitized aggregate CSV input stay in the private
  local state directory; they are not a cloud backup.
- Product-page text remains untrusted data rather than Agent instructions.
- Public reports must use synthetic IDs, URLs and fixtures. They must not attach
  real tokens, configs, cookies, Chrome profiles, extension storage, SQLite
  databases, Affiliate receipts, raw CSVs or live account captures.

## Dependency update policy

Dependabot is configured for three ecosystems at repository root:

| Ecosystem | Cadence | Grouping | Open PR limit |
|---|---|---|---:|
| `pip` | Monthly, `Asia/Bangkok` | All Python dependencies in one group | 2 |
| `npm` | Monthly, `Asia/Bangkok` | Locked development dependencies in one group | 2 |
| `github-actions` | Monthly, `Asia/Bangkok` | All Actions in one group | 2 |

The configuration does not enable auto-merge, reviewers, deployment or secret
access. A generated dependency pull request follows the normal CI/review path.

## Verification

| Command or check | Outcome |
|---|---|
| Read-only GitHub Private Vulnerability Reporting endpoint | HTTP 200; `enabled: false`; no setting changed. |
| Ruby YAML parse and structural assertions | Passed: version 2, exactly `pip`, `npm`, `github-actions`, monthly schedule, group per ecosystem and limit 2. |
| Local Markdown-link scan over `README.md`, `SECURITY.md`, `CONTRIBUTING.md` | Passed; every relative target exists. |
| `npm run test:list` | Passed and returned the current four Python checks plus 26 executable JavaScript suites. |
| Contact/SLA/auto-merge content scan | No invented email, response-time promise or auto-merge instruction found. |
| `git diff --check` | Passed. |

The full product suite was not rerun because this phase changes only policy,
onboarding links and dependency-scheduling configuration; the pushed candidate
must still pass the normal hosted CI gate.

## CI/CD impact

The CI workflow itself is unchanged. Once merged, Dependabot may open grouped
monthly pull requests; those pull requests run the repository's normal CI and
require ordinary review. No secret, environment, artifact, deployment or
automatic merge behavior is added.

## User-visible change

Public users can see which release line receives security fixes, what data may
reach their chosen Agent provider, what must never be posted publicly, and how
to prepare a sanitized report or small pull request. The policy also discloses
that the private GitHub reporting route is not yet available.

## Compatibility and rollback

Runtime and stored-data formats are unchanged. Reverting the implementation
commit removes the policies, README links and Dependabot schedule. No worker
restart, Chrome action, token rotation or data migration is required. Any
Dependabot pull requests already opened before rollback would need normal manual
closure; none are auto-merged by this configuration.

## Known risks and non-coverage

- Sensitive vulnerabilities currently have no verified private submission
  route; enabling and re-verifying GitHub Private Vulnerability Reporting is
  pending a later authorized settings phase.
- The policy does not promise response or remediation timing.
- Grouped dependency updates reduce noise but can require extra diagnosis when
  several versions change together; CI and human review remain required.
- No secret scanner or full security audit was performed in this phase.
- Dependabot execution is not observable until the configuration is pushed and
  GitHub processes it.

## Review record

- Independent review of `395189287c9860f93aba228a04b123e9ecb45d9b`
  failed because the contribution guide did not state the complete suite's
  macOS boundary. Commit `8be977e42577b80e15185ce4eb7a655a720cfd74`
  adds that boundary and requires a fresh exact-SHA review.
- Independent local review: pending for the final evidence-commit SHA.
- Push authorization: pending for the final evidence-commit SHA.
- Hosted CI: pending for the pushed final SHA.
- GPT Bridge review: pending after hosted CI is green.
- GitHub settings: unchanged; Private Vulnerability Reporting remains disabled.
- Pull request / immutable review URL: pending.

## Completion checklist

- [x] Supported versions documented.
- [x] Trust/data boundaries documented.
- [x] Public secret/private-data prohibition and sanitized repro guidance added.
- [x] No invented email, contact route or SLA.
- [x] Private reporting status verified read-only and limitation disclosed.
- [x] Setup/test/small-PR guidance matches current CI.
- [x] Monthly grouped pip/npm/Actions updates configured with bounded PRs.
- [x] No auto-merge configured.
- [x] YAML, links, test inventory and whitespace checks pass.
- [x] No source/runtime behavior changed.
- [ ] Exact final SHA independently reviewed and authorized for push.
- [ ] Approved SHA pushed and remote SHA confirmed.
- [ ] Hosted CI green on the exact pushed SHA.
- [ ] GPT Bridge review reconciled for the pushed SHA.
- [ ] Later settings phase enables and verifies private reporting.
- [ ] Phase merged into `main`.
