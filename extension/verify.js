(() => {
  "use strict";
  
  /**
   * Link verification module - verify affiliate links without opening them.
   * Checks: target resolution, ownership, commission status
   * Never opens links or creates tracking clicks.
   */
  
  /**
   * Parse Shopee short link structure (without following redirect)
   */
  function parseShortLink(url) {
    if (typeof url !== 'string') {
      return {ok: false, error: 'invalid_url'};
    }
    
    const match = /^https:\/\/s\.shopee\.co\.th\/([A-Za-z0-9]+)(?:\?.*)?$/.exec(url);
    if (!match) {
      return {ok: false, error: 'not_shopee_short_link'};
    }
    
    return {
      ok: true,
      short_code: match[1],
      base_url: `https://s.shopee.co.th/${match[1]}`,
      has_params: url.includes('?')
    };
  }
  
  /**
   * Verify link ownership by checking if it appears in "My Links" list
   * This requires the extension to be on the My Links page
   */
  function verifyOwnershipFromMyLinks(doc, affiliateUrl) {
    const shortLinkParse = parseShortLink(affiliateUrl);
    if (!shortLinkParse.ok) {
      return {ok: false, error: shortLinkParse.error};
    }
    
    // Check if we're on My Links page
    const isMyLinksPage = /^\/my-links?(?:\/|$)/.test(doc.location.pathname) ||
                          doc.querySelector('[class*="MyLinks"], [class*="my-links"]');
    
    if (!isMyLinksPage) {
      return {
        ok: false,
        error: 'not_on_my_links_page',
        requires_navigation: true
      };
    }
    
    // Search for the link in the page
    const linkElements = [...doc.querySelectorAll('a[href], input[value], textarea')]
      .filter(el => {
        const value = el.href || el.value || el.textContent;
        return value && value.includes(shortLinkParse.short_code);
      });
    
    if (linkElements.length === 0) {
      return {
        ok: true,
        ownership_verified: false,
        method: 'my_links_search',
        evidence: 'link_not_found_in_my_links'
      };
    }
    
    // Try to extract product info from the same row/card
    const productInfo = {};
    linkElements.forEach(el => {
      const container = el.closest('tr, .card, .item, [class*="Link"]');
      if (container) {
        const nameEl = container.querySelector('[class*="name"], [class*="product"], [class*="title"]');
        if (nameEl) {
          productInfo.product_name = nameEl.textContent.trim().slice(0, 200);
        }
      }
    });
    
    return {
      ok: true,
      ownership_verified: true,
      method: 'my_links_search',
      evidence: 'link_found_in_my_links',
      product_info: productInfo
    };
  }
  
  /**
   * Verify target resolution from Get Link dialog receipt
   * The dialog shows the product info when link is created
   */
  function verifyTargetFromReceipt(receipt, expectedProductId) {
    if (!receipt || typeof receipt !== 'object') {
      return {ok: false, error: 'invalid_receipt'};
    }
    
    // Receipt should contain product context from when link was created
    if (!receipt.product_id) {
      return {
        ok: true,
        target_verified: false,
        method: 'receipt',
        evidence: 'product_id_not_in_receipt'
      };
    }
    
    const matches = !expectedProductId || receipt.product_id === expectedProductId;
    
    return {
      ok: true,
      target_verified: matches,
      method: 'receipt',
      resolved_item_id: receipt.product_id,
      resolved_title: receipt.product_name || null,
      evidence: matches ? 'product_id_matches_receipt' : 'product_id_mismatch'
    };
  }
  
  /**
   * Verify from dashboard data (if extension can read it)
   */
  function verifyFromDashboard(doc, affiliateUrl) {
    const shortLinkParse = parseShortLink(affiliateUrl);
    if (!shortLinkParse.ok) {
      return {ok: false, error: shortLinkParse.error};
    }
    
    // Check if we're on dashboard/analytics page
    const isDashboard = /^\/(?:dashboard|analytics|performance)(?:\/|$)/.test(doc.location.pathname);
    
    if (!isDashboard) {
      return {
        ok: false,
        error: 'not_on_dashboard',
        requires_navigation: true
      };
    }
    
    // Try to find the link in dashboard data
    // This is speculative - actual implementation depends on dashboard structure
    const dataElements = [...doc.querySelectorAll('[class*="data"], [class*="stat"], [class*="metric"]')]
      .filter(el => {
        const text = el.textContent;
        return text && text.includes(shortLinkParse.short_code);
      });
    
    if (dataElements.length === 0) {
      return {
        ok: true,
        ownership_verified: 'unknown',
        method: 'dashboard_search',
        evidence: 'link_not_found_in_dashboard'
      };
    }
    
    return {
      ok: true,
      ownership_verified: true,
      method: 'dashboard_search',
      evidence: 'link_found_in_dashboard'
    };
  }
  
  /**
   * Main verification function
   * Tries multiple methods to verify without opening the link
   */
  async function verifyLink(doc, affiliateUrl, options = {}) {
    const {
      expected_product_id = null,
      link_receipt = null,
      check_ownership = true,
      check_target = true,
      try_my_links = true,
      try_dashboard = false
    } = options;
    
    const result = {
      ok: true,
      affiliate_url: affiliateUrl,
      verified_at: new Date().toISOString(),
      target_verified: null,
      ownership_verified: null,
      commission_rate: null,
      warnings: []
    };
    
    // Parse the link structure
    const linkParse = parseShortLink(affiliateUrl);
    if (!linkParse.ok) {
      return {...linkParse, affiliate_url: affiliateUrl};
    }
    
    result.short_code = linkParse.short_code;
    
    // Check target resolution
    if (check_target) {
      if (link_receipt) {
        const receiptVerify = verifyTargetFromReceipt(link_receipt, expected_product_id);
        if (receiptVerify.ok) {
          result.target_verified = receiptVerify.target_verified;
          result.resolved_item_id = receiptVerify.resolved_item_id;
          result.resolved_title = receiptVerify.resolved_title;
          result.target_verification_method = receiptVerify.method;
          result.target_verification_evidence = receiptVerify.evidence;
        }
      } else {
        result.target_verified = 'unknown';
        result.target_verification_evidence = 'no_receipt_provided';
        result.warnings.push('Cannot verify target without receipt or navigation');
      }
    }
    
    // Check ownership
    if (check_ownership) {
      let ownershipResult = null;
      
      if (try_my_links) {
        ownershipResult = verifyOwnershipFromMyLinks(doc, affiliateUrl);
      } else if (try_dashboard) {
        ownershipResult = verifyFromDashboard(doc, affiliateUrl);
      }
      
      if (ownershipResult && ownershipResult.ok) {
        result.ownership_verified = ownershipResult.ownership_verified;
        result.ownership_verification_method = ownershipResult.method;
        result.ownership_verification_evidence = ownershipResult.evidence;
        
        if (ownershipResult.product_info) {
          result.product_info = ownershipResult.product_info;
        }
      } else {
        result.ownership_verified = 'unknown';
        result.ownership_verification_evidence = 'verification_method_unavailable';
        result.warnings.push('Cannot verify ownership without My Links or dashboard access');
      }
    }
    
    // Add warnings about verification limitations
    if (result.target_verified === 'unknown' || result.ownership_verified === 'unknown') {
      result.warnings.push('Partial verification only - some checks returned unknown');
    }
    
    result.verification_complete = 
      (result.target_verified === true || result.target_verified === false) &&
      (result.ownership_verified === true || result.ownership_verified === false);
    
    return result;
  }
  
  /**
   * Batch verify multiple links
   */
  async function verifyLinks(doc, links, options = {}) {
    const results = [];
    
    for (const link of links) {
      const result = await verifyLink(doc, link.affiliate_url, {
        ...options,
        expected_product_id: link.product_id,
        link_receipt: link.link_receipt
      });
      
      results.push({
        ...result,
        product_id: link.product_id,
        channel: link.channel,
        clip_id: link.clip_id
      });
      
      // Small delay between verifications
      if (results.length < links.length) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }
    
    const verified = results.filter(r => 
      r.ownership_verified === true && r.target_verified === true
    ).length;
    
    const partially_verified = results.filter(r =>
      (r.ownership_verified === true || r.target_verified === true) &&
      !(r.ownership_verified === true && r.target_verified === true)
    ).length;
    
    const unverified = results.filter(r =>
      r.ownership_verified !== true && r.target_verified !== true
    ).length;
    
    return {
      ok: true,
      total: links.length,
      fully_verified: verified,
      partially_verified: partially_verified,
      unverified: unverified,
      results: results,
      warnings: results.flatMap(r => r.warnings).filter((v, i, a) => a.indexOf(v) === i)
    };
  }
  
  window.ShopKudVerify = {
    parseShortLink,
    verifyLink,
    verifyLinks,
    verifyOwnershipFromMyLinks,
    verifyTargetFromReceipt,
    verifyFromDashboard
  };
})();
