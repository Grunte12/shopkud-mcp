# Public listing follow-up — 2026-10-27

Fixed a reproducible readiness defect: an inactive newly created tab may expose
an empty URL plus the exact pendingUrl while loading. Wait for that same tab,
without navigating again; recheck after subscribing to avoid a missed completion
event. Reject redirects, active tabs and unrelated pending URLs. Verification
redirects now report challenge_detected with bounded readiness booleans, not the
challenge URL or its tracking parameters.

Live 0.13.4 with this patch read Sony offer 42505975084 successfully twice.
Six gallery URLs were observed. Stock 7 and ships-from จังหวัดสมุทรปราการ were
visible in semantic specs but missing from shipping_info; fixed and verified live.
Offline listing parser passed 11 cases and entry-policy regression passed.

The separately inspected owner-visible public page also showed seller placeholders
(N/A, dash, no shop name), no visible color/variant selector, and no populated
description. Do not call these globally absent or the listing complete. The title
contains model K-65S20M2 and processor X1; model evidence currently also includes
X1TM, leaving the single model field ambiguous. Product sold 24 is visible but
the current summary selector did not extract it. These remain follow-up gaps.
The prior live offer-terms read passed all three modal sections. No release.

## Sold/model follow-up

Observed live summary containers `div.xvTkTc` / `section.SQguX_` and the sold
element `.Ocv3B8` containing a nested span for the number. The reader now supports
these bounded product-only nodes instead of requiring a leaf text node. Tests
exclude unrelated recommendation counts. Remove trademark symbols before Unicode
normalization so X1™ cannot become X1TM; explicitly labeled processor/chip tokens
remain mentions rather than product identity candidates. Existing bundle and
conflicting-model tests remain passing.

After extension reload, two sequential live MCP reads returned sold `24 ชิ้น`,
model `K-65S20M2`, six gallery images, stock 7 and ships-from สมุทรปราการ.
The 11 listing parser scenarios passed with new nested-sold and chip regressions.
The fully hydrated owner tab now visibly shows Sony Official Store, rating 4.9,
nine reviews and seller metrics; fresh MCP reads still return null for these.
Thus the earlier placeholder finding was temporal, not permanent absence.
Hydration/readiness and those selectors remain a separate follow-up; no release.
