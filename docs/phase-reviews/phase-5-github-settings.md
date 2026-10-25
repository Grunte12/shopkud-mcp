# Phase 5 review — GitHub repository settings

Date: 2026-10-26
State: supported settings applied and verified; main protection pending account confirmation
Base branch: `main`
Phase branch: `phase/5-github-settings`
Base SHA: `dd398983b5b719a5f9cab7e58d7e58d7a46a003b`
Implementation tip before this evidence document: `d9b4c57d5585b1486b9dcb39d2041c6004e0faf0`

## Goal

Apply the smallest safe public-repository settings for a single-maintainer MVP,
publish the now-verified private security-reporting route, and preserve a
sanitized rollback record.

## Scope

- Enable GitHub's supported dependency, vulnerability and secret protections.
- Verify Private Vulnerability Reporting without creating a fake advisory.
- Reduce unused repository surfaces and automate merged-branch cleanup.
- Add discoverability topics.
- Prepare main-branch protection with the exact established CI checks, without
  review requirements or owner lockout.
- Record the pre-change state, applied state, rollback and any blocked setting.

## Non-goals

- No release, tag, package publication, merge or deployment.
- No repository visibility, collaborator, Actions-permission, merge-strategy,
  CodeQL, AI Scan, Copilot, secret or environment change.
- No review requirement for the single maintainer.
- No runtime, extension, package, test or stored-data behavior change.
- No fake security advisory and no credential value in evidence.

## Definition of Done

- Each supported setting is reread in GitHub after mutation.
- Private reporting is documented only after its real form renders.
- Wiki and Projects are hidden only after proving both are empty.
- The main rule targets the default branch, blocks deletion and force-push, and
  uses the four stable CI check names without review requirements.
- An administrator bypass avoids owner lockout.
- Unsupported or unconfirmed settings remain explicitly pending.
- Rollback instructions contain no token, cookie or private account data.

## Commits

| Commit | Purpose |
|---|---|
| `d9b4c57d5585b1486b9dcb39d2041c6004e0faf0` | Update the verified private-reporting policy and add the sanitized pre-change/applied-settings rollback record. |

The evidence-document commit SHA is intentionally pending; a commit cannot
truthfully contain its own SHA.

## Changed paths

- `SECURITY.md` — points sensitive reports to the verified GitHub private form.
- `docs/phase-reviews/phase-5-github-settings-rollback.md` — sanitized baseline,
  applied state and rollback procedure.
- `docs/phase-reviews/phase-5-github-settings.md` — this evidence.

No source, runtime, extension, packaging or CI workflow file changed.

## Applied GitHub settings

| Setting | Verified outcome |
|---|---|
| Private Vulnerability Reporting | Enabled. `/security/advisories/new` rendered the private draft-advisory form; nothing was submitted. |
| Dependency graph | Enabled. |
| Dependabot alerts | Enabled. |
| Dependabot security updates | Enabled. |
| Grouped security updates | Left disabled; repository `dependabot.yml` already defines reviewed grouping. |
| Secret Protection | Enabled. GitHub stated no additional license would be consumed. |
| Push protection | Enabled. |
| Delete merged head branches | Enabled. Deleted branches remain restorable through GitHub. |
| Auto-merge | Left disabled. |
| Topics | `mcp`, `chrome-extension`, `shopee`, `ai-agents`, `affiliate-marketing`. |
| Wiki | Disabled after its page showed **Create the first page**. |
| Projects | Disabled after its page showed Open 0 / Closed 0. |

Malware alerts, automatic dependency submission, CodeQL, AI Scan, Copilot
Autofix, Agentic Autofix and unrelated repository controls were not changed.

## Main protection result

The ruleset form was prepared with:

- name `Protect main`, active enforcement and the default branch target;
- Repository admin bypass set to **Always allow**;
- ref deletion restricted and force pushes blocked;
- no pull-request or independent-review requirement;
- required GitHub Actions checks `Python 3.11`, `Python 3.13`,
  `Browser and native fixtures`, and `Package and dependency audit`;
- no up-to-date-branch, deployment, signature, code-scanning, code-quality or
  coverage requirement.

GitHub required a mobile sudo confirmation before creating the ruleset. Two
verification requests timed out before approval, so GitHub did not accept the
form and `main` remains unprotected. No partial ruleset is claimed. Completing
this one account-confirmation step is the only unapplied Phase 5 setting.

## Verification

| Check | Outcome |
|---|---|
| Advanced Security reread | Private reporting, dependency graph, alerts, security updates, Secret Protection and push protection all showed enabled. |
| Private report entry | Draft-advisory form rendered; no fields filled and no advisory created. |
| General settings reread | Wiki and Projects off; automatic merged-branch deletion on; auto-merge off. |
| Repository About reread | All five topics displayed. |
| Empty-surface proof | Wiki offered first-page creation; Projects showed zero open and zero closed. |
| Main ruleset submission | Not applied: GitHub Mobile confirmation timed out twice. |
| `git diff --check` | Passed for the implementation commit. |

The product test suite was not rerun because this phase changes repository
settings and documentation only. The phase pull request must still run the
normal hosted CI checks on its exact pushed SHA.

## CI/CD impact

No workflow changed. Dependabot may now open security-update pull requests, and
push protection can reject a future push containing a supported secret. The
normal four CI jobs remain unchanged. They are not yet enforced on `main`
because the ruleset confirmation did not complete.

## User-visible changes

Contributors now have a verified private vulnerability-reporting path, clearer
repository topics and fewer empty navigation surfaces. Merged pull-request
branches are cleaned up automatically and remain recoverable.

## Compatibility and rollback

Runtime and saved-data formats are unchanged. Restore only the settings listed
in `docs/phase-reviews/phase-5-github-settings-rollback.md`, with separate
authorization, then reread every setting. Reverting the documentation commit
does not revert GitHub settings; repository settings and git history must be
rolled back independently. No branch-rule rollback is needed because no
ruleset was created.

## Known risks and non-coverage

- `main` remains unprotected until the owner completes GitHub's sudo check and
  submits the already specified ruleset.
- Secret scanning covers GitHub-supported patterns; it is not a guarantee that
  every private value will be detected.
- Dependabot alerts depend on GitHub's dependency recognition and advisory data.
- No security audit, penetration test or live Shopee validation occurred here.
- Settings were verified through the authenticated GitHub UI because the local
  GitHub CLI credential was unavailable; no credential was copied or exposed.

## Review record

- Independent review: pending for the final evidence-commit SHA.
- Push authorization: granted in the approved public-release implementation
  plan; exact pushed SHA is pending.
- Hosted CI: pending for the pushed final SHA.
- Pull request / immutable review URL: pending.
- Merge, tag and release: intentionally not performed.

## Completion checklist

- [x] Sanitized pre-change rollback record saved.
- [x] Private Vulnerability Reporting enabled and real form verified.
- [x] Dependency graph, Dependabot alerts and security updates enabled.
- [x] Secret Protection and push protection enabled without an entitlement error.
- [x] Auto-delete merged branches enabled; auto-merge unchanged.
- [x] Five repository topics saved and verified.
- [x] Wiki and Projects disabled only after empty-state proof.
- [x] Security policy updated without an invented email or SLA.
- [x] Branch-rule policy fully specified with exact stable CI check names.
- [ ] GitHub account confirmation completed and `Protect main` ruleset created.
- [ ] Exact final SHA independently reviewed and authorized for push.
- [ ] Approved SHA pushed and remote SHA confirmed.
- [ ] Hosted CI green on the exact pushed SHA.
- [ ] Pull request created; phase not merged.
