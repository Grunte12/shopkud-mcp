# Install ShopKud MCP — instructions for an AI coding agent

This document is written for the user's coding agent. The owner must approve the
Chrome extension, optional host permissions and Shopee login/challenge steps.
Do not automate those decisions.

## Handoff prompt for the owner

The owner can send only the repository URL plus this instruction to any coding
agent:

> Install ShopKud MCP from https://github.com/Grunte12/shopkud-mcp. Read its root AGENTS.md first,
> follow docs/INSTALL_FOR_AGENTS.md exactly, preserve existing configuration,
> and stop only for the Chrome approval/login steps that require me. Prove the
> direct 19-tool guided MCP connection with a read-only check. Do not add a
> gateway, Docker, cloud service, or external database.

The rest of this document is the executable contract for that agent, not a
manual for the owner.

## Decision: native install, not Docker

Do not use Docker as the default. ShopKud must connect to the user's real Chrome profile through Chrome Native Messaging and show a Side Panel in that browser. A container would still need host Chrome integration, mounted profile paths and platform-specific manifests, adding Docker without removing the hard part.

Install one native per-user worker instead. It uses approximately tens of MiB of RAM, listens only on loopback, starts at login, and is shared by every local MCP client.

## Environment matrix

| Environment | Status | Agent action |
|---|---|---|
| macOS + Google Chrome + Python 3.11+ | Supported | Follow the procedure below |
| macOS without Python 3.11+ | Missing dependency | Install a current Python using the user's approved package manager, then continue |
| macOS without Chrome | Missing dependency | Ask the owner to install Chrome or stop |
| Windows 10/11 + Google Chrome + Python 3.11+ | Supported | Use the PowerShell commands below |
| Windows without Python 3.11+ | Missing dependency | Install current per-user Python, then continue |
| Windows without Chrome | Missing dependency | Ask the owner to install Chrome or stop |
| Linux | Not validated | Stop; do not guess the Native Messaging manifest path or service manager |
| Docker-only host | Unsupported user path | Use a native desktop environment instead |

## 1. Preflight

Resolve the repository root and verify:

Identify either macOS (`uname -s` returns `Darwin`) or Windows 10/11
(`$PSVersionTable.Platform` / `[Environment]::OSVersion`). Confirm Python 3.11+
and the repository files `extension/manifest.json` and `pyproject.toml`.
Preserve any existing ShopKud config; setup is intentionally idempotent and
refuses mismatched extension identities, ports, manifests and startup entries.

## 2. Install the Python package locally

From the repository root:

macOS:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -e .
```

Windows PowerShell:

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e .
```

Do not install SQLite, Redis, Postgres, Node, Docker, or a cloud database. Python's standard library provides the optional embedded SQLite store. Node/Playwright are development-test dependencies only, not runtime requirements.

## 3. Load the Chrome extension

This is a browser-extension installation and requires the owner's confirmation.

1. Open `chrome://extensions` in the owner's intended Chrome profile.
2. Enable Developer mode.
3. Choose **Load unpacked** and select this repository's `extension/` directory.
4. Record the extension ID shown by Chrome. Do not infer or hardcode it.
5. Click the ShopKud toolbar icon once to open the full Dashboard. Use its
   **Live tracker** control when the owner wants the compact Side Panel.
6. Grant only the optional site permissions needed for the requested feature.

Never create a separate Chrome profile unless the owner asks. Never export login state.

## 4. Create private local configuration and Native Messaging registration

On macOS, use absolute private paths:

```sh
STATE_DIR="$HOME/Library/Application Support/ShopKud MCP"
NATIVE_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
.venv/bin/shopkud-mcp setup \
  --extension-id EXTENSION_ID_FROM_CHROME \
  --state-dir "$STATE_DIR" \
  --manifest-dir "$NATIVE_DIR"
```

On Windows, do not invent manifest or registry paths. The setup command uses
`%LOCALAPPDATA%\ShopKud MCP`, creates a second secret-authenticated loopback
port for the Chrome bridge, and registers the exact manifest under
`HKCU\Software\Google\Chrome\NativeMessagingHosts\org.shopkud.mcp`:

```powershell
.\.venv\Scripts\shopkud-mcp.exe setup-windows `
  --extension-id EXTENSION_ID_FROM_CHROME
```

Neither route prints the bearer token. Windows setup does not require
Administrator access and must not write HKLM.

The command creates a private bearer key but never prints it. Do not echo or paste the config contents.

## 5. Install the auto-start worker

```sh
.venv/bin/shopkud-mcp install-macos-service \
  --config "$HOME/Library/Application Support/ShopKud MCP/config.json"
```

This writes one private `~/Library/LaunchAgents/org.shopkud.mcp.plist` and starts the loopback worker. It refuses to replace a different existing plist.

Windows PowerShell:

```powershell
.\.venv\Scripts\shopkud-mcp.exe install-windows-startup
```

This writes the exact `ShopKudMCP` value under the current user's Windows Run
key and starts a hidden worker immediately. It refuses to replace a different
existing value. No Windows service or administrator access is required.

The service endpoint is `http://127.0.0.1:8176/mcp` unless the private config uses another port.

## 6. Connect the user's MCP client directly

Discover the client's current MCP configuration format from its installed version. Add one HTTP/Streamable HTTP server named `shopkud` pointing to the loopback endpoint. Supply `Authorization: Bearer <private token>` through that client's private credential or header mechanism.

Rules:

- Read the token directly from the private config only while writing the client's private settings.
- Never print it, pass it in a URL, include it in a prompt, commit it, or leave it in shell history.
- Do not require a gateway. ShopKud is a standalone MCP server.
- Restart or reconnect only the target MCP client after configuration.

## 7. Verify without external side effects

1. Confirm the per-user worker is registered/running.

   macOS:

   ```sh
   launchctl print "gui/$(id -u)/org.shopkud.mcp"
   ```

   Windows PowerShell (never print the value because it contains the private
   config path):

   ```powershell
   $run = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
   if (-not $run.ShopKudMCP) { throw 'ShopKudMCP startup entry missing' }
   Test-NetConnection 127.0.0.1 -Port 8176 -InformationLevel Quiet
   ```

2. Initialize the MCP endpoint using the client's normal connection path.
3. Confirm the default `guided` profile exposes exactly 19 tools.
4. Confirm the package and Chrome extension versions match.
5. Call `list_pages(include_entry_tabs=true)`.
6. Run `selector_health` on a supported open page, or one bounded research call with `freshness=live`.

Do not create links, enroll missions, post, purchase, or change Shopee selections during installation verification.

## 8. Optional persistent workspace

Only when the owner explicitly wants saved briefs, aggregate reports, history, or mission records:

```sh
.venv/bin/shopkud-mcp enable-workspace \
  --config "$HOME/Library/Application Support/ShopKud MCP/config.json"
```

Windows PowerShell:

```powershell
.\.venv\Scripts\shopkud-mcp.exe enable-workspace `
  --config "$env:LOCALAPPDATA\ShopKud MCP\config.json"
```

Restart only the ShopKud service afterward. This creates a private `workspace.sqlite3` file. SQLite remains embedded; there is no database daemon.

## Storage and data boundaries

ShopKud has four different storage lifetimes. Do not describe them as one
database:

| Storage | Default | What it contains | What removes it |
|---|---|---|---|
| Chrome Personal Workspace | On | Up to 20 completed research projects, 50 explicitly saved products and confirmed link/SubID cards for this extension/profile | Removing the extension or clearing its site/extension data can erase it |
| Worker memory | On while running | Bounded research cache and current trace state | Restarting the worker |
| Private config | On after setup | Bearer token, extension origin, MCP port and private native-bridge settings | Explicit deletion of the configured state directory |
| Embedded SQLite workspace | Off until `enable-workspace` | Saved briefs, offer/link history, aggregate CSV analysis and local mission records | Explicit deletion of the configured state directory |

The Chrome workspace and SQLite workspace are not automatic backups of one
another. No verified export/restore path exists for Chrome-stored projects, so
warn the owner before removing the extension.

Analytics are never downloaded automatically. `import_report_csv` accepts only
an aggregate CSV supplied and authorized by the owner, after personal/order data
has been removed. Preview first; commit only with the matching digest and owner
confirmation. Unmapped attribution remains unmapped.

Mission tools are also local records. `list_missions` reads missions already
stored in the SQLite workspace. `enroll_mission(dry_run=true)` previews a local
record; `dry_run=false` records that the owner already enrolled on Shopee. It
does not click an enrollment button, discover all current missions or prove
Shopee progress.

## Safe update

Update only while the ShopKud browser lane is idle. Keep the canonical checkout
path and `.venv` path so the macOS launchd or Windows Startup command stays valid.

1. Inspect before changing anything:

   ```sh
   git status --short
   git remote get-url origin
   git fetch --tags origin
   git tag --list 'v*' --sort=-version:refname
   ```

   The remote must be `https://github.com/Grunte12/shopkud-mcp.git`. If the
   worktree has local edits, stop and ask the owner; do not stash, reset or
   overwrite them.

2. Check out the existing release tag selected by the owner, then refresh the
   same environment. Replace `SELECTED_RELEASE_TAG` only with a tag shown by the
   previous command.

   macOS:

   ```sh
   git switch --detach SELECTED_RELEASE_TAG
   .venv/bin/python -m pip install -e .
   ```

   Windows PowerShell:

   ```powershell
   git switch --detach SELECTED_RELEASE_TAG
   .\.venv\Scripts\python.exe -m pip install -e .
   ```

   Do not rerun `setup`: the config, bearer token, extension ID and SQLite file
   are outside the checkout and must remain unchanged.

3. Ask the owner to reload the unpacked extension from `chrome://extensions`.
   A reload does not grant optional permissions; the owner must approve those.

4. Restart only the exact per-user worker. On macOS:

   ```sh
   PLIST="$HOME/Library/LaunchAgents/org.shopkud.mcp.plist"
   launchctl bootout "gui/$(id -u)" "$PLIST"
   launchctl bootstrap "gui/$(id -u)" "$PLIST"
   ```

   On Windows, identify only the process whose command line contains both
   `shopkud_mcp.server serve` and the exact
   `%LOCALAPPDATA%\ShopKud MCP\config.json`. If there is not exactly one, stop
   instead of killing anything. Stop that PID once, then run:

   ```powershell
   .\.venv\Scripts\shopkud-mcp.exe install-windows-startup
   ```

5. Reconnect only the ShopKud MCP client and verify the installed version and
   platform worker. macOS:

   ```sh
   .venv/bin/python -c 'from importlib.metadata import version; print(version("shopkud-mcp"))'
   launchctl print "gui/$(id -u)/org.shopkud.mcp"
   ```

   Windows PowerShell:

   ```powershell
   .\.venv\Scripts\python.exe -c 'from importlib.metadata import version; print(version("shopkud-mcp"))'
   Test-NetConnection 127.0.0.1 -Port 8176 -InformationLevel Quiet
   ```

   Confirm Chrome reports the same extension version, the guided catalog has 19
   tools, and one read-only `list_pages`/`selector_health` check succeeds. If
   `bootout` says the service was not loaded, do not loop; inspect the exact
   label/plist and bootstrap it once.

## Uninstall while retaining data

Uninstall is intentionally explicit; there is no uninstall command.

1. Remove only the `shopkud` entry from each MCP client and reconnect that
   client.
2. Resolve and show the owner the exact platform paths before removal. macOS:

   ```sh
   PLIST="$HOME/Library/LaunchAgents/org.shopkud.mcp.plist"
   MANIFEST="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/org.shopkud.mcp.json"
   STATE_DIR="$HOME/Library/Application Support/ShopKud MCP"
   ```

   Windows:

   ```powershell
   $STATE_DIR = "$env:LOCALAPPDATA\ShopKud MCP"
   $MANIFEST = "$STATE_DIR\org.shopkud.mcp.json"
   ```

3. Stop the exact worker, then remove only its startup/native registration
   after owner confirmation. macOS:

   ```sh
   launchctl bootout "gui/$(id -u)" "$PLIST"
   rm -- "$PLIST" "$MANIFEST"
   ```

   Windows: first stop only the one exact worker process using the match rule in
   Safe update. Then remove the `ShopKudMCP` value from
   `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, remove the exact
   `org.shopkud.mcp` key from
   `HKCU\Software\Google\Chrome\NativeMessagingHosts`, and remove only
   `$MANIFEST`. Preserve `$STATE_DIR\config.json` and SQLite files.

4. In Chrome, ask the owner to remove the unpacked ShopKud extension. Warn first:
   removal can erase Chrome-stored Personal Workspace projects and saved cards.
5. The checkout, `.venv` and `STATE_DIR` remain inert. The retained state
   directory keeps the private config/token and optional SQLite history; do not
   publish, inspect in chat or reuse them for another owner. If the owner also
   wants the code removed, inspect `git status --short` first and move only the
   exact checkout to Trash as a separate confirmation; never include
   `STATE_DIR` in that action.

Deleting saved data is a separate destructive choice. Only after explicit owner
approval, resolve `STATE_DIR`, verify it is the exact ShopKud directory above
and is neither the home directory nor a symlink/reparse point, then move that
one directory to Trash/Recycle Bin. Do not combine data deletion with ordinary
uninstall.

## Troubleshooting

| Symptom | Cause and next fix |
|---|---|
| `python3` is older than 3.11 or missing | Install a current Python with the owner's approved package manager; recreate `.venv` and rerun package installation. |
| Port 8176 is already used | macOS: inspect with `lsof -nP -iTCP:8176 -sTCP:LISTEN`. Windows: use `Get-NetTCPConnection -LocalPort 8176`. Never kill an unknown process. For a new install, choose an owner-approved free MCP port; on Windows also choose a distinct `--native-port`. Do not overwrite an existing config. |
| `existing_setup_mismatch` or extension does not connect | Confirm the extension ID in the intended Chrome profile. Do not edit the private token or manifest by hand; use the explicit uninstall/reinstall path if the owner intentionally changed profiles. |
| Config/native target is refused as unsafe | Inspect ownership, symlinks, hardlinks and private permissions. Do not weaken the checks or use a world-readable state directory. |
| Shopee login, CAPTCHA or challenge | Stop and ask the owner to complete it in Chrome. Do not retry or bypass it. |
| `workspace_disabled` | Ask whether persistence is wanted. Run `enable-workspace` only with approval, then restart only ShopKud. |
| Package and extension versions differ | Reload the unpacked extension, restart the idle worker, reconnect the MCP client and compare versions again. |
| A read returns unknown, partial or `listing_unconfirmed` | Keep the uncertainty visible. Run `selector_health`, inspect the cited page and do not convert unknown fields to zero or retry a write. |
| Analytics are empty | Ask the owner for a sanitized aggregate CSV. ShopKud does not fetch live account analytics automatically. |
| Mission list is empty | Mission tools read local records only. The owner must first enroll on Shopee and authorize recording that fact locally. |

## Completion evidence

Return a short report without secrets: repository revision, package/extension
versions, worker status, endpoint host/port without the token, tool count,
read-only smoke result, whether SQLite was enabled, and every owner-only or
unvalidated step. Never claim a fresh-machine or live-layout pass that was not
actually performed.

## Runtime model

- One local worker is shared by all agents.
- Browser actions are serialized so agents do not race one Chrome tab.
- Result freshness is caller-selected: the default `live` does not reuse an earlier completed result, `recent` = 60 seconds, and `fast` = 10 minutes. Concurrent identical `live` calls that began before the first finished may share that one in-flight observation.
- Cache responses disclose age and observation timestamps.
- Research results are kept in memory for at most 64 distinct requests; entries older than 10 minutes are pruned on the next research call. Restarting the worker clears them. This does not change the default live-read policy.
- Closing the Dashboard or Side Panel does not stop the worker. Extension-owned
  work tabs are grouped under `ShopKud` and close after successful work unless
  the owner activates one for manual review.
