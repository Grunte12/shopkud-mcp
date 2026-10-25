# Seller / variant follow-up — 2026-10-25

Closed for the bounded 0.11.6 release. Missing live seller names remain an
explicitly documented data-availability limit, not a guessed field.

## Changes verified

- Public reader accepts screen-size and capacity/type option labels, including
  the observed `ขนาดจอ`. The Samsung listing `141005876/22480228964` now returns
  both 50- and 55-inch options. Neither is claimed selected without evidence.
- Anker listing `1063747073/29688405992` returns A1695 and black/silver choices.
- Seller placeholders (`-`, `N/A`, and contaminated adjacent `N/A` text) no longer
  become shop age/response-time observations. Explicit semantic shop-name fields
  are supported, but this fallback is fixture-tested only.
- Brief options now disclose truncation. Final Python regression: 244 tests passed;
  purchase DOM suite: 7 passed; listing DOM suite: 11 passed during this turn.

## Open live gaps

Both real product pages return an empty seller panel with placeholder values.
Reading after additional load time did not produce the name. An experimental
scroll-and-wait added no evidence, so it was removed. Shop names are still null;
this must not be presented as complete seller support.

Luna submitted two live rank calls through simultaneous gateway requests:

| Query | Trace | Queue ms | Total ms |
| --- | --- | ---: | ---: |
| ทีวี 55 นิ้ว 4K | 815a4f54a7c90d86 | 0.03 | 7056.78 |
| Anker powerbank | 3b282c73f889d0c6 | 0.02 | 25880.12 |

Both returned without errors/cache hits or crossed identities, but the provider
start timestamps were about 9.3 seconds apart, so this earlier run did not prove
contention. A later 0.11.6 live gate delivered exact detail while rank was still
running; both succeeded with correct identity and no busy error. See
[`LIVE_ACCEPTANCE_0.11.6_2026-10-25.md`](LIVE_ACCEPTANCE_0.11.6_2026-10-25.md).
