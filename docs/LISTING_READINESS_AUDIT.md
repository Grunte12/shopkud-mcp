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
