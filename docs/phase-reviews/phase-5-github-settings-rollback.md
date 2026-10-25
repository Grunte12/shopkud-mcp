# Phase 5 GitHub settings — pre-change rollback record

Captured: 2026-10-26
Repository: `Grunte12/shopkud-mcp`
Baseline branch/SHA: `main` at `dd398983b5b719a5f9cab7e58d7e58d7a46a003b`

This record contains no token, credential, browser state or private account
identifier. Settings were read through the authenticated GitHub repository UI;
no mutation had been submitted when this baseline was captured.

## Repository baseline

| Setting | Before Phase 5 | Evidence |
|---|---|---|
| Visibility | Public | General settings danger-zone summary |
| Default branch | `main` | General settings |
| Main protection/rules | None | Repository banner: main is not protected |
| Wiki | Enabled, empty | Wiki page offered **Create the first page** |
| Projects | Enabled, empty | Projects page showed Open 0 / Closed 0 |
| Auto-delete merged branches | Disabled | General settings checkbox |
| Auto-merge | Disabled | General settings checkbox; not changed by this phase |
| Topics | None visible | Repository About panel had no selected topic chips |

## Security baseline

| Setting | Before Phase 5 | Evidence |
|---|---|---|
| Private Vulnerability Reporting | Disabled | Advanced Security showed **Enable private vulnerability reporting** |
| Dependency graph | Disabled | Advanced Security checkbox |
| Dependabot alerts | Disabled | Advanced Security checkbox |
| Dependabot security updates | Disabled | Advanced Security checkbox |
| Grouped security updates | Disabled | Advanced Security checkbox |
| Secret Protection | Disabled; enablement offered | Advanced Security showed **Enable** |
| Secret scanning / push protection detail | Not yet enabled; exact supported subfeatures to be recorded after the enablement dialog | Entitlement-dependent |

CodeQL, AI Scan, Copilot Autofix and unrelated repository settings are outside
Phase 5 and must remain unchanged.

## Intended Phase 5 target

- Enable Private Vulnerability Reporting and verify the public report entry.
- Enable dependency graph, Dependabot alerts and security updates.
- Enable supported secret scanning/push protection; record entitlement limits.
- Enable deletion of merged head branches; keep auto-merge disabled.
- Set topics: `mcp`, `chrome-extension`, `shopee`, `ai-agents`,
  `affiliate-marketing`.
- Disable Wiki and Projects only because both were proven empty.
- Protect `main` with the four established checks: `Python 3.11`,
  `Python 3.13`, `Browser and native fixtures`, and
  `Package and dependency audit`.
- Block force-push and deletion. Do not require reviews or create an owner
  lockout.

## Applied settings

Verified through the GitHub repository UI on 2026-10-26:

- Private Vulnerability Reporting is enabled; the private draft-advisory form
  rendered successfully and no advisory was submitted.
- Dependency graph, Dependabot alerts and Dependabot security updates are
  enabled. Grouped security updates and malware alerts remain unchanged.
- Secret Protection and push protection are enabled. GitHub reported that no
  additional license would be consumed.
- Automatic deletion of merged head branches is enabled; auto-merge remains
  disabled.
- Topics are `mcp`, `chrome-extension`, `shopee`, `ai-agents` and
  `affiliate-marketing`.
- Wiki and Projects are disabled after their empty state was verified.

The main ruleset was fully prepared but not created. GitHub required a mobile
sudo confirmation; both verification requests timed out before approval. The
pending form contained an active `Protect main` ruleset targeting the default
branch, an always-allow Repository admin bypass, deletion/force-push blocks,
and the four exact GitHub Actions checks listed above. Because GitHub never
accepted the form, branch protection remains **not applied** and is not included
in the rollback procedure below.

## Rollback procedure

Rollback requires a separately authorized GitHub settings change. Restore only
the fields changed by this phase:

1. Remove the Phase 5 `main` protection/ruleset.
2. Re-enable Wiki and Projects.
3. Disable automatic deletion of merged branches.
4. Remove the five Phase 5 topics.
5. Disable Private Vulnerability Reporting.
6. Disable Dependabot security updates, Dependabot alerts and dependency graph.
7. Disable only the secret-protection features enabled by Phase 5.

Do not alter repository visibility, default branch, merge strategies,
auto-merge, Actions permissions, CodeQL, AI features, collaborators, secrets,
deploy keys or historical tags during rollback.

After rollback, read each setting again and record the result. A UI click or API
request alone is not proof that the setting changed.
