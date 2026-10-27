# Portable ShopKud connection — agent installation contract

The owner asks their agent to install ShopKud. The agent handles commands and
client configuration. The owner only approves Chrome installation/pairing and
logs in to Shopee. No credentials are copied between Chrome profiles.

## Scope and evidence

This route uses one local HTTP/WebSocket worker and the existing extension.
It does not install Native Messaging manifests, Windows registry entries,
launchd jobs, Docker, a gateway or a database server. Existing native installs
remain supported; do not migrate an active worker without checking it is idle.

Requirements: Python 3.11+, Chrome 116+ and a local stdio-capable MCP client.
The shared worker is started on demand by `connect`; closing one client does
not stop it or interrupt other agents. It is not installed as an OS login
service. After reboot the next MCP client connection starts it again.
This does not claim zero dependencies or support for remote/web-only clients.

## Agent procedure

1. Install this repository/package in a stable environment using the owner's
   approved Python installer. Do not assume a PyPI release or Chrome Web Store
   listing exists. Use the checked-out repository or verified release asset.
2. Help the owner load the bundled `extension/` directory in their existing
   Chrome profile. For a wheel, it is under the environment's
   `share/shopkud-mcp/extension`. The owner must approve it. Resolve its actual
   extension ID; never guess. Keep the directory stable for updates.
3. With the installed executable run:

   ```text
   shopkud-mcp install --extension-id <actual-id>
   shopkud-mcp pair
   shopkud-mcp client-config
   ```

   The optional `--state-dir` on install and `--config` on the other commands
   support isolated environments. The default private directory is
   `~/.shopkud/portable` on macOS/Linux and `%LOCALAPPDATA%/ShopKud MCP/portable`
   on Windows. If port 8176 already belongs to another installation, preserve
   it and choose an unused port with `install --port`; never kill its process.
4. `pair` authenticates locally and asks the OS to open the installed extension's
   approval page. The owner clicks **อนุญาตการเชื่อมต่อ**. Pairing expires after
   120 seconds and is single-use. No bearer key is in the URL, console, or chat.
   The URL fragment contains only a temporary bootstrap proof and is removed
   immediately by the page. Do not capture or publish that transient URL.
   If the default browser cannot open Chrome-extension URLs, select Chrome as
   the Python browser controller (`BROWSER`) and retry. Do not claim success
   based only on the OS open request.
5. Merge the **non-secret** `client-config` output into the chosen MCP client's
   configuration, preserving all other servers/settings. The output uses an
   absolute Python executable and stdio `connect` command; no bearer header is
   needed in client configuration. Clients with a different config format must
   receive the equivalent command/arguments through their supported setup UI/CLI.
   Do not overwrite configuration wholesale or install into unrelated clients.
6. Reconnect that client's MCP if required. Confirm initialization, **19 tools**,
   `get_workflow_guide`, then `list_pages`. Confirm the extension version and
   an actual connected state. Ask the owner to sign in for a bounded read-only
   Shopee check. No link creation, purchase or posting is part of installation.

## Recovery and boundaries

- Existing config mismatch: stop and inspect; install never replaces keys or
  another profile automatically.
- Worker responds with wrong identity/401: do not start a replacement on that
  port, reset secrets, or kill the existing process.
- Chrome closes/restarts: authenticated WebSocket reconnects with bounded
  backoff. Lost actions are **not** automatically replayed.
- Developer-only unpacked-extension reload invalidates old pages. Headless
  Chromium may unload command-line extensions on runtime.reload. The portable
  fixture separately restarts the same browser profile and checks persisted
  pairing; it does not claim unattended hot reload in every Chrome distribution.
- Worker restarts while a tool is running: return the failure; reconnect the
  MCP client before continuing. Do not promise transparent replay of writes.
- Keep one worker for all agents using the same Chrome profile. Existing queue
  and per-tab leases still govern browser work.
- Local files and extension storage hold credentials; no cloud relay is used.
  Local malware running with the owner's privileges is outside this boundary.

## Validation before promotion

Run the Python suite, `tests/test_portable_client.py`, and the same 44-stage
browser fixture suite through `tests/websocket-extension.cjs`. CI must execute
the portable browser path on Windows and Linux as well as macOS before claiming
verified cross-platform installation. A fixture pass is not a live Shopee or
fresh non-technical-user installation test. Keep native rollback until these
checks and owner-profile pairing have passed.
