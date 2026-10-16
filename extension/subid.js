(() => {
  "use strict";
  
  /**
   * SubID and link creation module for Shopee Affiliate Get Link dialog.
   * Supports 5 SubID fields with configurable selectors.
   * Convention: sub_id_1=platform, sub_id_2=product, sub_id_3=clip, sub_id_4=variant, sub_id_5=date
   */
  
  const DEFAULT_SUBID_CONFIG = {
    // These are configurable selectors that need to be verified against live Shopee UI
    dialog_selector: '[role="dialog"]',
    dialog_title_text: 'ลิงก์ข้อเสนอสินค้า',
    subid_container_selector: '.subid-inputs, .sub-id-section, [class*="SubId"]',
    subid_input_selectors: [
      'input[name="subId1"], input[placeholder*="Sub ID 1"]',
      'input[name="subId2"], input[placeholder*="Sub ID 2"]', 
      'input[name="subId3"], input[placeholder*="Sub ID 3"]',
      'input[name="subId4"], input[placeholder*="Sub ID 4"]',
      'input[name="subId5"], input[placeholder*="Sub ID 5"]'
    ],
    // Fallback: detect all text inputs in SubID section
    generic_input_selector: 'input[type="text"]',
    create_button_text: ['สร้างลิงก์', 'Create Link', 'รับลิงก์', 'Get Link'],
    link_output_selector: 'textarea[readonly], input[readonly][type="text"]',
    max_subid_length: 128
  };
  
  let config = {...DEFAULT_SUBID_CONFIG};
  
  /**
   * Update SubID configuration (for testing or adapting to UI changes)
   */
  function configure(newConfig) {
    config = {...DEFAULT_SUBID_CONFIG, ...newConfig};
  }
  
  /**
   * Detect if Get Link dialog is open and ready
   */
  function detectDialog(doc) {
    const dialogs = [...doc.querySelectorAll(config.dialog_selector)]
      .filter(d => {
        const title = d.querySelector('h4, h3, h2, [class*="title"], [class*="Title"]');
        return title && title.textContent.trim() === config.dialog_title_text && 
               d.getClientRects().length > 0;
      });
    
    if (dialogs.length === 0) {
      return {ok: false, error: 'dialog_not_found'};
    }
    if (dialogs.length > 1) {
      return {ok: false, error: 'multiple_dialogs_detected'};
    }
    
    return {ok: true, dialog: dialogs[0]};
  }
  
  /**
   * Detect SubID input fields in the dialog
   */
  function detectSubIdInputs(dialog) {
    const inputs = [];
    
    // Try specific selectors first
    for (let i = 0; i < config.subid_input_selectors.length; i++) {
      const input = dialog.querySelector(config.subid_input_selectors[i]);
      if (input && input.type === 'text' && !input.disabled && !input.readOnly) {
        inputs[i] = input;
      }
    }
    
    // If no specific selectors worked, try to find SubID container and generic inputs
    if (inputs.filter(Boolean).length === 0) {
      const container = dialog.querySelector(config.subid_container_selector);
      if (container) {
        const genericInputs = [...container.querySelectorAll(config.generic_input_selector)]
          .filter(input => !input.disabled && !input.readOnly && input.getClientRects().length > 0)
          .slice(0, 5);
        genericInputs.forEach((input, idx) => inputs[idx] = input);
      }
    }
    
    const available = inputs.filter(Boolean).length;
    
    return {
      ok: true,
      inputs: inputs, // Array with 5 slots, may have nulls
      available_count: available,
      detection_method: available > 0 ? 
        (inputs[0] && inputs[0].matches(config.subid_input_selectors[0]) ? 'specific_selector' : 'generic_container') : 
        'none',
      ui_structure_verified: false, // Must be set by operator after manual verification
      requires_manual_verification: available === 0
    };
  }
  
  /**
   * Validate SubID values before filling
   */
  function validateSubIds(subIds) {
    if (!Array.isArray(subIds) || subIds.length > 5) {
      return {ok: false, error: 'invalid_subid_array', message: 'SubIDs must be array of max 5 strings'};
    }
    
    const errors = [];
    subIds.forEach((value, idx) => {
      if (value !== null && value !== undefined && value !== '') {
        if (typeof value !== 'string') {
          errors.push(`SubID ${idx + 1}: must be string, got ${typeof value}`);
        } else if (value.length > config.max_subid_length) {
          errors.push(`SubID ${idx + 1}: exceeds max length ${config.max_subid_length}`);
        } else if (/[\r\n\t]/.test(value)) {
          errors.push(`SubID ${idx + 1}: contains invalid whitespace characters`);
        }
      }
    });
    
    if (errors.length > 0) {
      return {ok: false, error: 'invalid_subid_values', validation_errors: errors};
    }
    
    return {ok: true};
  }
  
  /**
   * Fill SubID inputs with provided values
   */
  function fillSubIds(dialog, subIds) {
    const validation = validateSubIds(subIds);
    if (!validation.ok) {
      return validation;
    }
    
    const detection = detectSubIdInputs(dialog);
    if (!detection.ok) {
      return detection;
    }
    
    if (detection.requires_manual_verification) {
      return {
        ok: false, 
        error: 'subid_inputs_not_detected',
        message: 'Could not detect SubID input fields. Manual UI verification required.',
        detection_evidence: detection
      };
    }
    
    const filled = [];
    const skipped = [];
    const unavailable = [];
    
    subIds.forEach((value, idx) => {
      if (value === null || value === undefined || value === '') {
        skipped.push(idx + 1);
        return;
      }
      
      const input = detection.inputs[idx];
      if (!input) {
        unavailable.push(idx + 1);
        return;
      }
      
      try {
        // Clear existing value
        input.value = '';
        input.dispatchEvent(new Event('input', {bubbles: true}));
        input.dispatchEvent(new Event('change', {bubbles: true}));
        
        // Set new value
        input.value = value;
        input.dispatchEvent(new Event('input', {bubbles: true}));
        input.dispatchEvent(new Event('change', {bubbles: true}));
        
        filled.push({slot: idx + 1, value: value});
      } catch (error) {
        return {ok: false, error: 'fill_failed', slot: idx + 1, message: error.message};
      }
    });
    
    return {
      ok: true,
      filled: filled,
      skipped: skipped,
      unavailable: unavailable,
      detection_method: detection.detection_method,
      requires_manual_ui_verification: detection.detection_method !== 'specific_selector'
    };
  }
  
  /**
   * Find the create/get link button in dialog
   */
  function findCreateButton(dialog) {
    const buttons = [...dialog.querySelectorAll('button')]
      .filter(btn => {
        if (btn.disabled || !btn.getClientRects().length) return false;
        const text = btn.innerText.trim();
        return config.create_button_text.some(pattern => 
          new RegExp(`^${pattern}$`, 'iu').test(text)
        );
      });
    
    if (buttons.length === 0) {
      return {ok: false, error: 'create_button_not_found'};
    }
    if (buttons.length > 1) {
      return {ok: false, error: 'multiple_create_buttons', count: buttons.length};
    }
    
    return {ok: true, button: buttons[0], button_text: buttons[0].innerText.trim()};
  }
  
  /**
   * Wait for link output to appear after clicking create
   */
  async function waitForLinkOutput(dialog, timeout = 10000) {
    const start = Date.now();
    
    while (Date.now() - start < timeout) {
      const outputs = [...dialog.querySelectorAll(config.link_output_selector)]
        .filter(el => el.value && el.value.startsWith('https://') && el.getClientRects().length > 0);
      
      if (outputs.length === 1) {
        const url = outputs[0].value.trim();
        if (/^https:\/\/s\.shopee\.co\.th\/[A-Za-z0-9]+$/.test(url)) {
          return {ok: true, affiliate_url: url, output_element: outputs[0]};
        }
      }
      
      // Check for errors
      const errorElements = [...dialog.querySelectorAll('[class*="error"], [class*="Error"], .ant-message-error')]
        .filter(el => el.getClientRects().length > 0);
      if (errorElements.length > 0) {
        return {
          ok: false, 
          error: 'link_creation_failed',
          error_message: errorElements.map(el => el.textContent.trim()).join('; ')
        };
      }
      
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    return {ok: false, error: 'link_output_timeout'};
  }
  
  /**
   * Main function: create affiliate link with SubIDs
   * Returns: {ok, affiliate_url, sub_ids_used, link_receipt}
   */
  async function createLinkWithSubIds(doc, subIds, options = {}) {
    const {
      dry_run = false,
      validate_only = false
    } = options;
    
    // Step 1: Detect dialog
    const dialogDetection = detectDialog(doc);
    if (!dialogDetection.ok) {
      return dialogDetection;
    }
    const dialog = dialogDetection.dialog;
    
    // Step 2: Detect SubID inputs
    const inputDetection = detectSubIdInputs(dialog);
    if (validate_only) {
      return {
        ok: true,
        validate_only: true,
        dialog_detected: true,
        subid_detection: inputDetection
      };
    }
    
    // Step 3: Fill SubIDs
    const fillResult = fillSubIds(dialog, subIds || []);
    if (!fillResult.ok) {
      return fillResult;
    }
    
    if (dry_run) {
      return {
        ok: true,
        dry_run: true,
        would_fill: fillResult
      };
    }
    
    // Step 4: Find and click create button
    const buttonDetection = findCreateButton(dialog);
    if (!buttonDetection.ok) {
      return buttonDetection;
    }
    
    const clickTime = new Date().toISOString();
    try {
      buttonDetection.button.click();
    } catch (error) {
      return {ok: false, error: 'click_failed', message: error.message};
    }
    
    // Step 5: Wait for link output
    const linkResult = await waitForLinkOutput(dialog);
    if (!linkResult.ok) {
      return linkResult;
    }
    
    const completedTime = new Date().toISOString();
    
    // Step 6: Capture receipt
    const receipt = {
      affiliate_url: linkResult.affiliate_url,
      sub_ids_filled: fillResult.filled,
      created_at: clickTime,
      captured_at: completedTime,
      dialog_detection_method: inputDetection.detection_method,
      button_text: buttonDetection.button_text,
      requires_manual_ui_verification: fillResult.requires_manual_ui_verification
    };
    
    return {
      ok: true,
      affiliate_url: linkResult.affiliate_url,
      sub_ids_used: fillResult.filled.reduce((obj, item) => {
        obj[`sub_id_${item.slot}`] = item.value;
        return obj;
      }, {}),
      link_receipt: receipt,
      link_source: 'extension_subid_creation',
      requires_manual_ui_verification: fillResult.requires_manual_ui_verification
    };
  }
  
  /**
   * Batch link creation - sequential with checkpointing
   */
  async function createBatchLinks(doc, items, options = {}) {
    const {
      on_progress = null,
      stop_on_error = true
    } = options;
    
    const results = [];
    let stopped = false;
    
    for (let i = 0; i < items.length; i++) {
      if (stopped) {
        results.push({
          ok: false,
          item_index: i,
          product_id: items[i].product_id,
          error: 'batch_stopped',
          status: 'not_attempted'
        });
        continue;
      }
      
      const item = items[i];
      
      // Check for interruptions (login, CAPTCHA, etc.)
      const captcha = [...doc.querySelectorAll('iframe[src*="captcha"], .captcha, #captcha, [data-testid="captcha"]')]
        .some(el => el.getClientRects().length > 0);
      if (captcha) {
        stopped = true;
        results.push({
          ok: false,
          item_index: i,
          product_id: item.product_id,
          error: 'captcha_detected',
          status: 'stopped'
        });
        continue;
      }
      
      try {
        const result = await createLinkWithSubIds(doc, item.sub_ids, {dry_run: false});
        results.push({
          ...result,
          item_index: i,
          product_id: item.product_id,
          status: result.ok ? 'completed' : 'failed'
        });
        
        if (!result.ok && stop_on_error) {
          stopped = true;
        }
        
        if (on_progress) {
          on_progress({
            completed: i + 1,
            total: items.length,
            current_result: result
          });
        }
        
        // Small delay between items to avoid rate limiting
        if (i < items.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 1000));
        }
      } catch (error) {
        results.push({
          ok: false,
          item_index: i,
          product_id: item.product_id,
          error: 'unexpected_error',
          message: error.message,
          status: 'failed'
        });
        if (stop_on_error) {
          stopped = true;
        }
      }
    }
    
    const completed = results.filter(r => r.status === 'completed').length;
    const failed = results.filter(r => r.status === 'failed').length;
    const not_attempted = results.filter(r => r.status === 'not_attempted').length;
    
    return {
      ok: completed > 0 && failed === 0 && not_attempted === 0,
      batch_completed: !stopped,
      total_items: items.length,
      completed_items: completed,
      failed_items: failed,
      not_attempted_items: not_attempted,
      results: results
    };
  }
  
  window.ShopKudSubId = {
    configure,
    detectDialog,
    detectSubIdInputs,
    validateSubIds,
    fillSubIds,
    createLinkWithSubIds,
    createBatchLinks,
    DEFAULT_CONFIG: DEFAULT_SUBID_CONFIG
  };
})();
