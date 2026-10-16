(() => {
  "use strict";
  // Visible short-link fields win. If the Get Link dialog is on screen but the
  // link box itself has no layout box (hidden after refresh), read that disabled
  // value without opening the URL. A fully hidden dialog is ignored by the caller.
  function choose(dialogs, shortLink) {
    const fields = [];
    for (const dialog of dialogs || []) {
      const nodes = dialog.querySelectorAll ? dialog.querySelectorAll("textarea,input[type=text]") : [];
      for (const node of nodes) {
        if (!node.disabled) continue;
        const value = shortLink(node.value);
        if (!value) continue;
        const visible = typeof node.getClientRects === "function" && node.getClientRects().length > 0;
        fields.push({value, visible});
      }
    }
    const visibleValues = fields.filter(field => field.visible).map(field => field.value);
    if (visibleValues.length) {
      return {values: visibleValues, source: visibleValues.length === 1 ? "visible_link_dialog" : null};
    }
    const hiddenValues = fields.filter(field => !field.visible).map(field => field.value);
    return {values: hiddenValues, source: hiddenValues.length === 1 ? "hidden_link_field" : null};
  }
  const api = {choose};
  if (typeof window !== "undefined") window.ShopKudLinkCapture = api;
  if (typeof module !== "undefined") module.exports = api;
})();
