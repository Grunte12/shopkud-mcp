# Phase 0 review — release claims

Date: 2026-10-26  
State: phase verified; evidence commit pending  
Base branch: `main`  
Phase branch: `phase/0-release-claims`  
Base SHA: `238160eb5316ea753bc2279e5bd7badabd8fe29d`  
Implementation tip before this evidence document: `b4728a005db0074bb2a3e1c3d83731878b07c392`

## Goal

Give public readers one accurate account of the current ShopKud 0.11.8 build,
its supported launch environment, the evidence behind its claims and its known
limits before release engineering begins.

## Scope

- Separate current release status from historical implementation findings.
- Classify claims as verified local fixture, observed live, not validated or
  deferred.
- State the supported public MVP target: macOS, Google Chrome, Python 3.11+ and
  an MCP client supporting Streamable HTTP with private headers.
- Correct overstatements about fresh-machine installation, browser-lane
  contention, `listing_unconfirmed`, seller evidence and exact variants.
- Add the approved public-release implementation plan and record the observed
  GitHub baseline for later phases.

## Non-goals

- No product behavior, schema, tool catalog, UI or package changes.
- No test/CI implementation, GitHub settings changes, tag or release.
- No new platform support or claim of exhaustive Shopee-layout coverage.
- No attempt to resolve the optional public listing reader in this phase.

## Definition of Done

- A reader can identify build 0.11.8, guide 1.5.6 and the supported environment
  without reconciling contradictory status text.
- Historical test/live observations are not presented as current candidate CI
  or universal support.
- Seller/variant and `listing_unconfirmed` limits remain explicit.
- Deferred Affiliate Kit capabilities are not described as ShopKud v1.
- Documentation diff is whitespace-clean and contains no source changes.

## Commits

| Commit | Purpose |
|---|---|
| `b4728a005db0074bb2a3e1c3d83731878b07c392` | Reconcile public release evidence and add the approved implementation plan. |

## Changed paths

- `PLAN.md` — current release scope and historical findings separated.
- `IMPLEMENTATION_STATUS.md` — supported target and evidence vocabulary added.
- `FINAL_REPORT.md` — implementation report distinguished from a release or
  fresh-machine certificate.
- `docs/LIVE_ACCEPTANCE_0.11.8_2026-10-26.md` — live run framed as a bounded
  historical snapshot; concurrency and listing causes no longer overstated.
- `docs/PUBLIC_RELEASE_IMPLEMENTATION_PLAN.md` — public-release phases,
  boundaries and verified GitHub baseline.

## Decisions and rationale

- Keep old findings in place as implementation history instead of deleting
  useful provenance; label them so they cannot be mistaken for open work.
- Use four literal evidence classes rather than one overloaded `passed` label.
- Treat `listing_unconfirmed` as unresolved because the available observation
  does not isolate selector, navigation, account/layout or site behavior.
- Treat simultaneous Agent launch and actual queue contention as separate facts;
  the recorded queue timings did not establish overlap.

## Compatibility and rollback

There is no runtime, data, API or package compatibility effect. Rollback is the
revert of the Phase 0 documentation commit. No migration or local-data action is
required.

## Verification

| Command or observation | Outcome |
|---|---|
| `git diff --check 238160e..b4728a0` | Passed; no whitespace errors. |
| `git diff --name-only 238160e..b4728a0` | Exactly five documentation paths; no source/config files. |
| `rg` against package, extension and workflow manifests | Package and extension `0.11.8`; guide `1.5.6`. |
| `git tag --sort=-version:refname` | Newest existing tag is `v0.10.5`; `v0.11.8` unused at inspection time. |
| `gh release list --repo Grunte12/shopkud-mcp` | No GitHub Release listed. |
| `gh repo view` | Repository public; default branch `main`. |
| GitHub branch-protection API | `main` reported unprotected. |
| GitHub security-analysis API | Dependabot security updates, secret scanning and push protection reported disabled. |

No code suite was rerun because this phase changes documentation only. The next
phase must rerun the actual suite while making test execution reproducible.

## CI/CD impact

None. No workflow, check name, secret, environment, deployment or release
behavior changed. Phase 2 will introduce CI after its commands are reproducible.

## User-visible change

Public documentation now distinguishes what was tested synthetically, what was
observed on the owner's live account, what is unknown and what belongs to a
future product. There is no application UI change; visual QA is not applicable.

## Known risks and non-coverage

- Fresh-machine Chrome installation remains unvalidated.
- Linux and Windows native-host registration remain unsupported claims.
- Seller authenticity, exact SKU/variant certainty and commission outcomes are
  not guaranteed.
- The optional public listing read can return `listing_unconfirmed`; its cause
  remains unresolved.
- Historical local test counts still require release-candidate CI reruns.
- No full secret or dependency audit was performed in this documentation phase.
- GitHub settings were observed but not changed or independently rechecked after
  the recorded inspection.

## Review record

- Independent local review: pending for the final evidence-commit SHA.
- Push authorization: pending for the final evidence-commit SHA.
- CI: not applicable to Phase 0; no workflow exists yet.
- GPT Bridge review: pending after the approved SHA is pushed.
- Pull request / immutable review URL: pending.

## Completion checklist

- [x] Scope and non-goals documented.
- [x] Current and historical claims separated.
- [x] Supported target and evidence vocabulary documented.
- [x] Remaining seller/variant/listing limits explicit.
- [x] Changed paths limited to documentation.
- [x] Phase verification recorded.
- [ ] Evidence document committed.
- [ ] Exact final SHA independently reviewed and authorized for push.
- [ ] Approved SHA pushed and remote SHA confirmed.
- [ ] GPT Bridge review reconciled for the pushed SHA.
- [ ] Phase merged into `main`.
