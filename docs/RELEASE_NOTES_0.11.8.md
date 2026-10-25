# ShopKud MCP 0.11.8 — MVP release notes

ShopKud is a local-first MCP and Chrome extension for Shopee Affiliate product
research. An Agent supplies judgment and constraints; ShopKud performs bounded,
deterministic browser mechanics and shows the evidence in its Dashboard.

## Highlights

- **19 guided tools:** complete research, product, link, performance and local
  mission workflows without exposing every browser primitive by default.
- **Evidence-first ranking:** bounded search, trust filters, channel-specific
  commission observations and explicit unknown/partial outcomes.
- **Reusable human workspace:** Dashboard reports, product comparisons, cited
  Agent research, saved candidates and confirmed link/SubID records.
- **One browser lane:** concurrent callers queue behind deterministic Chrome
  work instead of racing the same tab; freshness is explicit.
- **Local-first operation:** loopback-only authenticated MCP, scoped extension,
  no cookie export, no cloud backend and optional embedded SQLite persistence.
- **Agent governance:** bundled skill, workflow guide and deterministic guards
  keep cheap or capable Agents on the same safe operating path.

## Supported installation

- macOS
- Google Chrome using the owner's existing signed-in profile
- Python 3.11 or newer
- an MCP client supporting Streamable HTTP and a private authorization header

Clone `https://github.com/Grunte12/shopkud-mcp`, then give the installing Agent
the repository's `AGENTS.md` and `docs/INSTALL_FOR_AGENTS.md`. The owner still
approves the unpacked extension, optional Chrome permissions and Shopee login or
challenge steps.

No Docker daemon, MCP gateway, external database or separate SQLite install is
required.

## Verification

The release candidate passed:

- hosted Python 3.11 and 3.13 checks
- hosted macOS browser/native fixtures
- wheel build, empty-environment installation and package-data checks
- 244 Python tests and 26 executable JavaScript/browser/native suites
- resolved Python and locked npm dependency audits
- redacted current-tree and reachable-history secret scans with every finding
  manually classified without publishing candidate values

See [the full candidate evidence](RELEASE_CANDIDATE_0.11.8.md).

## Important limitations

- Fresh-machine Chrome setup, Linux and Windows native-host registration are not
  validated.
- Shopee may change layouts. Seller identity, exact variant certainty and
  optional public-listing reads can remain unknown or `listing_unconfirmed`.
- Prices, sales and commission values are observations, not promised earnings.
- Analytics use only an owner-supplied aggregate CSV; there is no automatic
  live account analytics download.
- ShopKud v1 does not generate media, upload or post content.
- Removing the Chrome extension can erase its Chrome-stored Personal Workspace.

## Updating from an earlier checkout

Use the safe update procedure in
[Install for Agents](INSTALL_FOR_AGENTS.md#safe-update). Preserve the private
config, bearer token and saved state; reload the unpacked extension, restart
only an idle ShopKud worker, reconnect the MCP client and verify that package
and extension versions both report `0.11.8`.

This is an open-source MVP. Report security issues through the repository's
private vulnerability form and ordinary bugs with sanitized fixture evidence.
