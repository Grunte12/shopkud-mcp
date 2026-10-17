# Live check on your Mac

This pass stays on your own Chrome profile. The coding agent does not log in, does not open `s.shopee.co.th` links, and does not receive cookies or page HTML.

Load the unpacked extension from the `extension/` folder in this repo (version 0.10.0). Start the local ShopKud server only if you want the agent to call `selector_health`. The diagnostic also runs from the page console with no server.

## 1. Confirm the build

1. Open `chrome://extensions`, turn on Developer mode, and load `extension/` unpacked.
2. Open one offer you already use: `https://affiliate.shopee.co.th/offer/product_offer/<id>`.
3. Leave the Get Link dialog closed for the first diagnostic.

## 2. Run the read-only diagnostic

On that tab, open DevTools. In the console's context dropdown, switch from the page (`top`) to the **ShopKud MCP** content script. The diagnostic lives in the extension's isolated world, so the page context cannot see it. Paste:

```js
copy(JSON.stringify(window.ShopKudDiagnose.diagnose(document)))
```

That call does not click, does not type, and does not follow links. If you use the agent instead, call the MCP tool `selector_health` with the registered `page_id` and no other arguments. The tool is read-only and drops anything except check ids, pattern ids, and counts.

Send back only the copied JSON. Before you send it, check that it contains no field values, no buyer or order text, and no `s.shopee.co.th` code. The result is supposed to list check ids (`matched` or `missed`), pattern ids, and a short-link count. If a short code or an email appears, delete that JSON and tell me the check id that leaked it. Do not send the page source, a screenshot of the dialog fields, cookies, or the network log.

## 3. Create one SubID link

Use a product page you are willing to attach one new affiliate link to. Either:

- ask the agent for one `create_link` on that `page_id`, with your usual SubIDs, or
- open Get Link yourself, fill the SubIDs, and press the page's own button once.

Do not press it twice if the result is unclear. Do not open the short link afterward. Opening it creates a tracking click and is not how ownership is checked.

## 4. What to send back

Send these three things and nothing else:

1. The diagnostic JSON from step 2, from both the closed page and the open Get Link dialog if you can run it twice.
2. The receipt fields `product_id`, `status`, `product_attested`, and `sub_id_slots`. Redact `affiliate_url` to the host plus the first and last two characters of the code.
3. One sentence: whether the filled SubID slots were the ones you intended, and whether any requested slot had no box.

Do not send SubID values if they contain an order id, email, phone, or buyer name. Do not send a download of My Links or a conversion report.

## 5. How the result will be used

Matched pattern ids update the evidence notes in `SELECTOR_EVIDENCE.md`. A miss stays unverified until a later fixture is added. The diagnostic output is not stored as a campaign row.
