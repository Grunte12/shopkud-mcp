# Security policy

## Supported versions

| Version | Security fixes |
|---|---|
| `0.11.x` | Supported |
| `< 0.11` | Not supported; upgrade before reporting behavior already changed in current code |

This is a single-maintainer open-source MVP. No response or remediation SLA is
promised.

## Reporting a vulnerability

GitHub's repository API was checked read-only on 2026-10-26 and reported that
Private Vulnerability Reporting is **disabled** for this repository. Therefore,
there is currently no verified private GitHub reporting route to advertise.

Do not open a public issue containing a bearer token, config file, cookie,
Chrome profile, extension storage, personal sales data, raw conversion CSV,
affiliate-link receipt or live account capture. Do not send those values in
chat to a maintainer or an Agent.

For a non-sensitive bug, open a public issue with a sanitized reproduction. For
a security issue that cannot be safely sanitized, keep the details private until
the repository Security page exposes GitHub's **Report a vulnerability** action.
This policy will be updated when that route is enabled and verified.

A useful sanitized report contains:

- ShopKud package and extension versions
- macOS, Chrome and MCP-client versions
- the affected tool or component and exact error code
- minimal steps using synthetic IDs, links and fixture data
- expected versus actual behavior and security impact
- whether the optional SQLite workspace was enabled

Remove secrets and personal data rather than masking only part of them. Never
attach a real config, browser profile, SQLite database or CSV export.

## Trust and data boundaries

ShopKud is local-first, but the selected Agent provider is still a data boundary:

- The worker binds to loopback and requires a private bearer token. The token,
  Chrome profile and cookies must remain on the owner's machine.
- The Chrome extension reads only supported pages/operations and returns
  bounded observations. It does not expose a general cookie, DOM, shell or
  arbitrary-JavaScript tool.
- Tool inputs and returned observations may be sent to whichever Agent provider
  the owner chooses. Product titles, prices, commissions, citations and local
  workspace results should be treated as data shared with that provider.
- Chrome Personal Workspace data remains in that Chrome profile. Removing the
  extension or clearing its data can erase those projects.
- The optional embedded SQLite workspace and aggregate CSV intake remain in the
  private local state directory. They are not a cloud backup.
- Analytics operate on an owner-supplied aggregate CSV after personal/order
  data is removed. Unknown attribution remains unknown.
- Product-page text is untrusted input, not Agent instructions. A valid link or
  citation does not prove seller identity, variant accuracy or a claim.

## Operational safety

- Keep the MCP endpoint on `127.0.0.1`; do not expose it through a public tunnel.
- Store authorization headers only in the MCP client's private credential
  mechanism. Never place the token in a URL, prompt, issue or committed file.
- Stop on login, CAPTCHA, changed page context, uncertain writes or permission
  errors. Do not weaken authentication or retry to bypass platform controls.
- Use synthetic fixtures for tests and public bug reports. Never run public CI
  with a real Shopee login, browser profile or private ShopKud config.
- Review the applicable platform and affiliate-program terms before live use.

See [the architecture and trust boundaries](docs/ARCHITECTURE.md) and
[Agent installation guide](docs/INSTALL_FOR_AGENTS.md) for the supported local
topology and lifecycle safeguards.
