# ShopKud installation contract for coding agents

Purpose: install and verify the standalone ShopKud MCP on the owner's machine. Do not introduce an MCP gateway, cloud service, Docker daemon, or database server.

## Supported target

- Verified: macOS user session + Google Chrome + Python 3.11 or newer.
- Not yet verified: Linux and Windows native-host registration. Stop with `unsupported_platform`; do not improvise system paths or claim support.
- ShopKud must use the owner's existing logged-in Chrome profile. Never copy cookies, tokens, or profile data.

## Installation route

Read and follow [`docs/INSTALL_FOR_AGENTS.md`](docs/INSTALL_FOR_AGENTS.md). Use the repository commands rather than reimplementing setup. The only unavoidable human-visible step is loading/approving the unpacked Chrome extension; request confirmation at that step.

The target topology is one local ShopKud worker per OS user. The worker owns the browser queue, bounded result cache, trace stream, and optional embedded SQLite file. Do not start one worker per agent.

## Safety boundaries

- Never print, paste into chat, commit, or place the bearer key in a URL or shell history.
- Bind the MCP service to loopback only.
- Default to the 19-tool `guided` profile.
- Persistent workspace/history is opt-in; SQLite is embedded and requires no separate installation.
- Verify with read-only tools before enabling link creation or mission actions.
- A no-result research run is valid. Report exclusions and suggestions; never relax filters silently.
- The safe default is `freshness=live`. Use `recent` for repeated work within 60 seconds and `fast` only when the owner accepts results up to 10 minutes old.

## Completion evidence

Installation is complete only when all are true:

1. `org.shopkud.mcp` is running in the user's launchd domain.
2. The MCP client initializes the direct loopback endpoint and lists 19 guided tools.
3. Chrome shows the same extension version as the Python package.
4. `list_pages` reports the extension connected; an open supported Shopee page is required only for page-specific reads.
5. One read-only `selector_health` or bounded research smoke test returns a trace without creating a link, enrolling a mission, posting, or buying.
