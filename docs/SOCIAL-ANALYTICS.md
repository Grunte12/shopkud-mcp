# Social Media and Analytics

These are pages in the existing desktop Chrome Extension Dashboard, not a new
backend, posting service, or guarantee of commission.

## Social Media

- Eight destinations: Facebook, X, TikTok, YouTube, Instagram, Threads, LINE,
  and Shopee Video. Icons are bundled locally; see PLATFORM-ICONS.md.
- Successful new link receipts are retained in the local link library (up to
  500 entries, without silently evicting existing library entries). The recent
  receipt buffer still has its existing 100-entry bound.
- Search by product, URL or SubID; filter by platform and owner-recorded usage;
  copy a URL, add a note, or save a pre-existing link manually.
- Existing receipts without explicit channel metadata can suggest a platform
  from SubID 1. The UI labels this inference. The owner may correct the label.
- Changing the label or marking a link used does **not** change the underlying
  Shopee link, publish content, or verify backend tracking.
- New receipts preserve all five SubID positions, including empty positions.
  Older receipts may already have lost empty positions; they cannot be recovered
  from the compact stored array alone.
- Chrome storage is local to the profile. Removing the extension/profile can
  remove this library. It does not sync to another computer.

## Analytics

1. Open Analytics → Open Shopee report. Use your existing signed-in account.
2. Choose the report dates/filters in Shopee and wait for its table to load.
3. Return to Analytics and read open reports. If multiple tabs match, select one.

The extension reads only the rendered click-report table, aggregates counts by
SubID and referrer, and displays date range, observation time and partial-page
coverage. It does not click links, paginate, export reports, change filters,
read cookies, or return click IDs, geographic regions or buyer fields. Snapshots
are in Dashboard memory, not automatically saved. Missing/changed layouts fail
closed. A newly installed/reloaded content script needs the report tab refreshed.
At most 100 open tabs are checked per user-triggered read.

No observed click is a sale or approved commission. Sales/earnings are not
implemented by this view. Existing MCP report-import tools are separate from
this direct read-only view. Counts from different tabs/pages are not added
together because overlap could double-count events.

## Verification boundaries

Synthetic tests cover UI persistence, filters, errors, keyboard navigation,
light/dark desktop sizes and report parsing/privacy.

On 2026-10-28, the installed Dashboard read the owner's signed-in Shopee click
report through the actual extension message path. The displayed period
(2026-10-21 through 2026-10-27), two visible rows and aggregate count matched
the report DOM. This proves that observed page layout, not every account/layout.
Social Media displayed ten existing receipts. Marking a link used survived a
Dashboard reload; its usage flag was then restored. No new affiliate link was
created, followed, posted or purchased during this check.

Regression: 276 Python tests (one Windows-only skip on macOS), four Python
checks and 32 JavaScript suites passed locally. Backend attribution and sales
remain unverified; these checks do not prove commission crediting.
