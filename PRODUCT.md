# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Thai Shopee Affiliate creators who use an MCP-capable AI agent and Chrome on
their own Mac. They want the agent to do the repetitive research and browser
work while they review recommendations, evidence and campaign progress in a
visual interface instead of reading raw tool output in chat.

## Product Purpose

ShopKud v1 turns visible Shopee Affiliate data and the user's research intent
into a repeatable product-selection workflow. Success means the agent can do
the repetitive research mechanics, the user can compare the recommendation and
its evidence in seconds, and both sides operate on the same local result.

## Positioning

ShopKud is a local-first, agent-and-human Affiliate workspace: deterministic
browser workflows produce structured evidence for an AI agent, and the Chrome
Extension renders the same recommendations and live execution for the owner.
It is not a remote product-catalog database and does not require exporting the
owner's cookies or Shopee session.

## Operating Context

- One local worker is shared by MCP-capable agents on the owner's machine.
- The Chrome Extension uses the owner's existing signed-in Chrome profile.
- An agent chooses the research goal and constraints; code performs bounded
  searching, verification and ranking.
- The full-page Extension Dashboard is the primary human interface for the
  research journey, recommendation, comparison, sources and saved candidates.
- The Side Panel is a compact live tracker and developer console, not the main
  reading surface.
- External trend, niche, purchase-intent and store research comes from the
  calling agent's configured sources. The packaged skill and playbook govern
  how that judgment is summarized, cited and kept separate from Shopee facts.
- Extension-owned work tabs share one `ShopKud` Chrome Tab Group and close when
  an operation finishes. A tab the user activates is treated as claimed and is
  never auto-closed.

## Capabilities and Constraints

- The public guided MCP surface contains 19 tools; a larger diagnostic profile
  is available for custom clients.
- Current public support is macOS, Google Chrome and Python 3.11 or newer.
- Live Shopee facts are time-stamped observations, not permanent truth.
- Human and agent decisions never grant hidden authority to buy or post.
- The Extension may display structured recommendations and user-saved UI state,
  but secrets, cookies, buyer identities and raw page HTML are excluded.
- ShopKud v1 does not generate media, upload, post or schedule content. Those
  end-to-end stages belong to the separate Shopee Affiliate Kit.
- Attribution tables and owner-supplied aggregate report imports already exist,
  but live Shopee analytics scraping is not claimed until its desktop surface
  is independently verified.
- Future versions may connect trend → product → content → link → post →
  commission as a self-improving loop; that is direction, not a current claim.

## Brand Commitments

- Product name: ShopKud.
- Thai-first product language with direct, plain labels.
- ShopKud orange is the action color; indigo identifies decision evidence and
  green identifies verified/trusted states.
- Apple-inspired Liquid Glass is reserved for floating Chrome and navigation;
  data surfaces use bright cream/peach pearl layers and remain legible.
- The orange shopping-bag mascot, small sparkles and tactile product cards make
  the product friendly and memorable without obscuring evidence.
- Existing promotional visual: `docs/assets/shopkud-social-promo.png`.

## Evidence on Hand

- Public repository documentation and architecture diagram.
- Real-time MCP trace, performance and developer-log Side Panel.
- Deterministic product-ranking workflow with tests and live acceptance history.
- Promotional visual showing the intended orange, indigo, green and pearl world.
- No public customer testimonial or verified conversion benchmark may be
  invented in the UI.

## Product Principles

1. Automate mechanics; keep strategy and final choices understandable.
2. Show evidence and freshness beside every recommendation.
3. Human and agent share one source of truth rather than separate chat and UI
   interpretations.
4. Prefer complete workflows over many low-level clicks, while preserving the
   primitives needed for flexible agents.
5. Keep the system local-first and explicit about what it observed and what it
   could not verify.

## Accessibility & Inclusion

The Extension follows the system light/dark theme, respects reduced motion and
reduced transparency, supports keyboard focus, and remains readable in Thai on
desktop Dashboard and Chrome Side Panel surfaces.
