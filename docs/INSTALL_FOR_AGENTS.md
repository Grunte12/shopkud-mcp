# Install ShopKud MCP — instructions for an AI coding agent

This document is written for the user's coding agent. The human should only need to approve the Chrome extension and log in to Shopee when required.

## Handoff prompt for the owner

The owner can send only the repository URL plus this instruction to any coding
agent:

> Install ShopKud MCP from this repository. Read its root AGENTS.md first,
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
| Linux | Not validated | Stop; do not guess the Native Messaging manifest path or service manager |
| Windows | Not validated | Stop; do not guess registry or service configuration |
| Docker-only host | Unsupported user path | Use a native desktop environment instead |

## 1. Preflight

Resolve the repository root and verify:

```sh
uname -s
python3 --version
test -d extension
test -f extension/manifest.json
```

Require `Darwin` and Python 3.11 or newer. Preserve any existing ShopKud config; setup is intentionally idempotent and refuses mismatched existing identities.

## 2. Install the Python package locally

From the repository root:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -e .
```

Do not install SQLite, Redis, Postgres, Node, Docker, or a cloud database. Python's standard library provides the optional embedded SQLite store. Node/Playwright are development-test dependencies only, not runtime requirements.

## 3. Load the Chrome extension

This is a browser-extension installation and requires the owner's confirmation.

1. Open `chrome://extensions` in the owner's intended Chrome profile.
2. Enable Developer mode.
3. Choose **Load unpacked** and select this repository's `extension/` directory.
4. Record the extension ID shown by Chrome. Do not infer or hardcode it.
5. Open the ShopKud Side Panel and grant only the optional site permissions needed for the requested feature.

Never create a separate Chrome profile unless the owner asks. Never export login state.

## 4. Create private local configuration and Native Messaging registration

Use absolute paths. The default macOS locations are:

```sh
STATE_DIR="$HOME/Library/Application Support/ShopKud MCP"
NATIVE_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
.venv/bin/shopkud-mcp setup \
  --extension-id EXTENSION_ID_FROM_CHROME \
  --state-dir "$STATE_DIR" \
  --manifest-dir "$NATIVE_DIR"
```

The command creates a private bearer key but never prints it. Do not echo or paste the config contents.

## 5. Install the auto-start worker

```sh
.venv/bin/shopkud-mcp install-macos-service \
  --config "$HOME/Library/Application Support/ShopKud MCP/config.json"
```

This writes one private `~/Library/LaunchAgents/org.shopkud.mcp.plist` and starts the loopback worker. It refuses to replace a different existing plist.

The service endpoint is `http://127.0.0.1:8176/mcp` unless the private config uses another port.

## 6. Connect the user's MCP client directly

Discover the client's current MCP configuration format from its installed version. Add one HTTP/Streamable HTTP server named `shopkud` pointing to the loopback endpoint. Supply `Authorization: Bearer <private token>` through that client's private credential or header mechanism.

Rules:

- Read the token directly from the private config only while writing the client's private settings.
- Never print it, pass it in a URL, include it in a prompt, commit it, or leave it in shell history.
- Do not require a gateway. ShopKud is a standalone MCP server.
- Restart or reconnect only the target MCP client after configuration.

## 7. Verify without external side effects

1. Confirm the service is running:

   ```sh
   launchctl print "gui/$(id -u)/org.shopkud.mcp"
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

Restart only the ShopKud service afterward. This creates a private `workspace.sqlite3` file. SQLite remains embedded; there is no database daemon.

## Runtime model

- One local worker is shared by all agents.
- Browser actions are serialized so agents do not race one Chrome tab.
- Result freshness is caller-selected: the default `live` does not reuse an earlier completed result, `recent` = 60 seconds, and `fast` = 10 minutes. Concurrent identical `live` calls that began before the first finished may share that one in-flight observation.
- Cache responses disclose age and observation timestamps.
- Closing the Side Panel does not stop the worker; opening it shows live traces for the current extension session.
