# Phase 3 review — public onboarding and lifecycle

Date: 2026-10-26
State: implementation verified locally; independent review pending
Base branch: `main`
Phase branch: `phase/3-public-onboarding`
Base SHA: `bae382fb895600f385208ec3f596eecbfd98a810`
Implementation tip before this evidence document: `54e0c9514ac745aea7f5595785eb439742ce93a2`

## Goal

Give a new coding Agent an accurate, safe path to install, update, verify and
remove ShopKud on the supported macOS/Chrome environment without inventing a
gateway, Docker service or external database, and without losing the owner's
configuration or saved data by default.

## Scope

- Put requirements, quick start, Agent handoff and current limitations near the
  top of the README.
- Move historical release notes out of the primary onboarding flow.
- Document the owner-only Chrome approval, optional permission and Shopee
  login/challenge steps.
- Separate Chrome storage, worker memory, private configuration and opt-in
  embedded SQLite persistence.
- Add conservative update and uninstall procedures that preserve local state.
- Explain aggregate-CSV analytics and mission tools according to current code.
- Add bounded troubleshooting and completion evidence for the installing Agent.

## Non-goals

- No installer, updater, uninstaller or migration code.
- No server, extension, package, selector, tool or database behavior change.
- No Docker, hosted service, external database, Linux/Windows native-host path,
  Chrome Web Store flow or PyPI publication.
- No setup, update, uninstall or data deletion was executed on the owner's Mac.
- No claim that Chrome approval, Shopee login or challenges are unattended.

## Definition of Done

- README surfaces the supported environment and shortest usable handoff before
  the feature catalog.
- Every repository URL names `https://github.com/Grunte12/shopkud-mcp`.
- The Agent installation guide uses only current CLI commands and arguments.
- Storage ownership, persistence and removal effects are explicit.
- Updating preserves config, bearer token and saved data, and restarts only an
  idle ShopKud worker.
- Ordinary uninstall retains local data; data deletion is a separate confirmed
  destructive step.
- Extension removal warns that Chrome-stored projects can be erased.
- Analytics and missions are not presented as automatic live Shopee reads.
- All local Markdown links resolve and documentation changes pass whitespace
  validation.

## Commits

| Commit | Purpose |
|---|---|
| `54e0c9514ac745aea7f5595785eb439742ce93a2` | Streamline public setup and document safe lifecycle/storage behavior. |

The evidence-document commit SHA is intentionally pending; a commit cannot
truthfully contain its own SHA.

## Changed paths

- `README.md` — requirements, quick start, copyable Agent handoff, current
  limitations and concise links to evidence near the top.
- `docs/INSTALL_FOR_AGENTS.md` — supported installation, four storage lifetimes,
  update, uninstall, troubleshooting and completion evidence.
- `CHANGELOG.md` — historical release notes moved unchanged out of the primary
  onboarding path.
- `docs/phase-reviews/phase-3-public-onboarding.md` — this phase evidence.

## Storage and lifecycle decisions

The documentation treats four stores independently:

1. Chrome Personal Workspace is enabled in the extension/profile and can be
   lost when the extension or its Chrome data is removed.
2. Worker cache/trace state is memory-only and clears on restart.
3. Private config holds the bearer token, allowed extension origin, port and
   socket path outside the checkout.
4. Embedded SQLite is opt-in through `enable-workspace`; it needs no database
   daemon and persists in the state directory until explicitly deleted.

These are not described as backups of one another. The guide makes no
unverified export/restore promise for Chrome-stored projects.

The update path keeps the canonical checkout and virtual-environment paths,
refuses to discard a dirty worktree, installs the owner-selected existing tag,
reloads the extension with human approval, restarts only the exact idle launchd
service and verifies matching package/extension versions plus the 19-tool
guided catalog. It does not rerun setup or rotate the token.

The uninstall path removes only the client entry, exact launchd service/plist,
exact Native Messaging manifest and owner-approved Chrome extension. The state
directory remains by default. Removing the checkout is a separate confirmed
action after inspecting local edits.

Data deletion is separately gated by explicit owner approval. The Agent must
resolve the exact ShopKud state directory, prove it is neither the home
directory nor a symlink, and move only that directory to Trash. It must not be
combined with ordinary uninstall.

## Product-data accuracy

- Analytics use only an aggregate CSV supplied and authorized by the owner
  after personal/order data is removed. Import is previewed before a matching
  digest is committed; ShopKud does not download live analytics automatically.
- `list_missions` reads existing SQLite workspace records.
- `enroll_mission(dry_run=true)` previews a local record; `dry_run=false`
  records an enrollment the owner already completed on Shopee. It does not
  click Shopee enrollment, discover every mission or prove progress.
- Unknown, partial and `listing_unconfirmed` reads remain visible and are not
  converted to zero or retried as writes.

## Verification

| Command or check | Outcome |
|---|---|
| `.venv/bin/shopkud-mcp --help` | Passed; current five subcommands listed. |
| `shopkud-mcp setup --help` | Passed; `--extension-id`, `--state-dir`, `--manifest-dir` and optional `--port` confirmed. |
| `shopkud-mcp install-macos-service --help` | Passed; required `--config` confirmed. |
| `shopkud-mcp enable-workspace --help` | Passed; required `--config` confirmed. |
| `shopkud-mcp set-tool-profile --help` | Passed; `guided` and `full` choices confirmed. |
| `shopkud-mcp serve --help` | Passed; required `--config` confirmed. |
| Local Markdown-link scan over `README.md`, `docs/INSTALL_FOR_AGENTS.md`, `CHANGELOG.md` | Passed; every relative target exists. |
| `git remote get-url origin` | Returned `https://github.com/Grunte12/shopkud-mcp.git`. |
| Wrong-repository URL scan | Passed; no stale `Grunte12/shopkud` URL in changed public docs. |
| `git diff --check` | Passed. |

Commands that would start/stop services, mutate Git state, remove files or
delete data were reviewed against the current CLI and documented but not run.

## CI/CD impact

None. No workflow, dependency, runner, secret, environment, deployment or
release setting changed. The existing Phase 2 CI remains the required hosted
gate after this evidence commit is reviewed and pushed.

## User-visible change

A public reader now sees the supported setup and limitations before the long
feature catalog. An owner can hand one repository URL to a coding Agent, knows
which steps still require human approval, and can distinguish ordinary removal
from destructive data deletion. Release history remains available in a
dedicated changelog.

## Compatibility and rollback

Runtime and stored-data formats are unchanged. Reverting the Phase 3 commit
restores the previous README/install layout and removes the new changelog; no
service restart, token rotation, database migration or Chrome change is needed.

## Known risks and non-coverage

- The installation procedure is validated against the current CLI and existing
  macOS code, not on a separate fresh user machine.
- Chrome extension approval, optional site permissions and live Shopee login
  remain owner-only and were not repeated for this documentation phase.
- Linux and Windows native-host installation remain unvalidated.
- The selected-release placeholder in the update procedure must be replaced by
  a real tag listed by Git; documentation does not choose a release for the owner.
- Chrome Personal Workspace has no verified export/restore workflow before
  extension removal.
- Live Shopee selectors, seller/variant evidence, mission-page labels and
  `listing_unconfirmed` behavior retain the limitations documented elsewhere.

## Review record

- Independent local review: pending for the final evidence-commit SHA.
- Push authorization: pending for the final evidence-commit SHA.
- Hosted CI: pending for the pushed final SHA.
- GPT Bridge review: pending after hosted CI is green.
- Pull request / immutable review URL: pending.

## Completion checklist

- [x] Requirements, quick start, Agent handoff and limits moved near README top.
- [x] Historical release notes moved to `CHANGELOG.md`.
- [x] Correct repository URL used.
- [x] Human Chrome approval/login boundaries documented.
- [x] Chrome, memory, config and SQLite persistence distinguished.
- [x] Safe update preserves config/token/data and restarts only ShopKud.
- [x] Uninstall retains data by default; deletion is separately confirmed.
- [x] Extension-removal data-loss warning included.
- [x] Aggregate-CSV analytics and local mission semantics documented.
- [x] Troubleshooting covers required public-install failure modes.
- [x] Local links and current CLI commands validated.
- [x] No source/runtime behavior changed.
- [ ] Exact final SHA independently reviewed and authorized for push.
- [ ] Approved SHA pushed and remote SHA confirmed.
- [ ] Hosted CI green on the exact pushed SHA.
- [ ] GPT Bridge review reconciled for the pushed SHA.
- [ ] Phase merged into `main`.
