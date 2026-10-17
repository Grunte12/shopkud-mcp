/**
 * Browser automation flows for Shopee Affiliate operations
 * 
 * All flows go through the logged-in Chrome (patchright over CDP).
 * No Open API calls - everything via browser automation.
 */

import { Page } from 'patchright';
import { SHOPEE_SELECTORS, SHOPEE_ENDPOINTS, TIMEOUTS, DELAYS, isShortLink } from '../config/selectors.js';
import type { SubIds } from './database.js';

export interface BrowserFlowResult<T = any> {
  ok: boolean;
  data?: T;
  error?: string;
  status?: 'success' | 'captcha_detected' | 'login_required' | 'network_error' | 'timeout' | 'uncertain';
  receipt?: any;
}

export interface CreateLinkParams {
  product_url: string;
  channel: string;
  sub_ids: SubIds;
}

export interface CreateLinkResult {
  short_link: string;
  product_url: string;
  channel: string;
  sub_ids: SubIds;
  item_id: string;
  shop_id: string;
  created_at: string;
  method: 'custom_link_form' | 'network_capture';
  receipt: {
    page_url: string;
    submitted_at: string;
    captured_at: string;
    network_response?: any;
  };
}

export class BrowserFlows {
  constructor(private page: Page) {}

  /**
   * Check for CAPTCHA or login requirements
   */
  async checkForBlockers(): Promise<{ captcha: boolean; login: boolean }> {
    const captchaSelectors = SHOPEE_SELECTORS.captcha.join(', ');
    const loginSelectors = SHOPEE_SELECTORS.loginRequired.join(', ');

    const [captcha, login] = await Promise.all([
      this.page.locator(captchaSelectors).first().isVisible().catch(() => false),
      this.page.locator(loginSelectors).first().isVisible().catch(() => false),
    ]);

    return { captcha, login };
  }

  /**
   * Create custom link via the custom link page form
   * 
   * This is the primary method: navigate to the custom link page,
   * fill in product URL + Sub IDs, submit, and capture the result.
   */
  async createCustomLink(params: CreateLinkParams, options: { dryRun?: boolean } = {}): Promise<BrowserFlowResult<CreateLinkResult>> {
    try {
      const submittedAt = new Date().toISOString();

      // Navigate to custom link page
      await this.page.goto(SHOPEE_SELECTORS.customLink.page, {
        waitUntil: 'networkidle',
        timeout: TIMEOUTS.navigation,
      });

      // Check for blockers
      const blockers = await this.checkForBlockers();
      if (blockers.captcha) {
        return { ok: false, error: 'CAPTCHA detected', status: 'captcha_detected' };
      }
      if (blockers.login) {
        return { ok: false, error: 'Login required', status: 'login_required' };
      }

      // Fill product URL
      const productUrlInput = this.page.locator(SHOPEE_SELECTORS.customLink.productUrlInput).first();
      await productUrlInput.waitFor({ state: 'visible', timeout: TIMEOUTS.elementVisible });
      await productUrlInput.fill(params.product_url);
      await this.page.waitForTimeout(DELAYS.betweenFields());

      // Fill Sub IDs
      const subIdInputs = [
        { selector: SHOPEE_SELECTORS.customLink.subId1Input, value: params.sub_ids.sub_id1 },
        { selector: SHOPEE_SELECTORS.customLink.subId2Input, value: params.sub_ids.sub_id2 },
        { selector: SHOPEE_SELECTORS.customLink.subId3Input, value: params.sub_ids.sub_id3 },
        { selector: SHOPEE_SELECTORS.customLink.subId4Input, value: params.sub_ids.sub_id4 },
        { selector: SHOPEE_SELECTORS.customLink.subId5Input, value: params.sub_ids.sub_id5 },
      ];

      for (const { selector, value } of subIdInputs) {
        if (value) {
          const input = this.page.locator(selector).first();
          const exists = await input.count() > 0;
          if (exists) {
            await input.fill(value);
            await this.page.waitForTimeout(DELAYS.betweenFields());
          }
        }
      }

      if (options.dryRun) {
        return {
          ok: true,
          status: 'success',
          data: {
            message: 'Dry run: stopped before submit',
            product_url: params.product_url,
            sub_ids: params.sub_ids,
          } as any,
        };
      }

      // Wait before submit
      await this.page.waitForTimeout(DELAYS.beforeSubmit());

      // Set up network response capture
      let networkResponse: any = null;
      const responsePromise = this.page.waitForResponse(
        (response) => {
          const url = response.url();
          return url.includes('/custom_link/create') || url.includes('/create_link');
        },
        { timeout: TIMEOUTS.formSubmit }
      ).then(async (response) => {
        try {
          networkResponse = await response.json();
        } catch {
          networkResponse = await response.text();
        }
      }).catch(() => {});

      // Submit form
      const submitButton = this.page.locator(SHOPEE_SELECTORS.customLink.submitButton).first();
      await submitButton.click();

      // Wait for response
      await Promise.race([
        responsePromise,
        this.page.waitForTimeout(TIMEOUTS.formSubmit),
      ]);

      await this.page.waitForTimeout(DELAYS.afterSubmit());

      // Check for error message
      const errorMsg = await this.page.locator(SHOPEE_SELECTORS.customLink.errorMessage).first().textContent().catch(() => null);
      if (errorMsg && errorMsg.trim().length > 0) {
        return {
          ok: false,
          error: `Form error: ${errorMsg}`,
          status: 'uncertain',
        };
      }

      // Look for result dialog
      const resultDialog = this.page.locator(SHOPEE_SELECTORS.customLink.resultDialog).first();
      const dialogVisible = await resultDialog.isVisible({ timeout: TIMEOUTS.dialogOpen }).catch(() => false);

      let shortLink: string | null = null;

      if (dialogVisible) {
        // Try to capture short link from dialog
        const linkTextarea = resultDialog.locator(SHOPEE_SELECTORS.customLink.resultLinkTextarea).first();
        const linkValue = await linkTextarea.inputValue().catch(() => null);
        if (linkValue && isShortLink(linkValue)) {
          shortLink = linkValue;
        }
      }

      // Try to extract from network response if not found in DOM
      if (!shortLink && networkResponse) {
        const extracted = this.extractShortLinkFromResponse(networkResponse);
        if (extracted) {
          shortLink = extracted;
        }
      }

      if (!shortLink) {
        return {
          ok: false,
          error: 'Could not capture short link from result',
          status: 'uncertain',
          receipt: {
            page_url: this.page.url(),
            submitted_at: submittedAt,
            captured_at: new Date().toISOString(),
            network_response: networkResponse,
          },
        };
      }

      // Extract item_id and shop_id from product URL
      const productMatch = params.product_url.match(/i\.(\d+)\.(\d+)/);
      const [shop_id, item_id] = productMatch ? [productMatch[1], productMatch[2]] : ['', ''];

      return {
        ok: true,
        status: 'success',
        data: {
          short_link: shortLink,
          product_url: params.product_url,
          channel: params.channel,
          sub_ids: params.sub_ids,
          item_id,
          shop_id,
          created_at: new Date().toISOString(),
          method: networkResponse ? 'network_capture' : 'custom_link_form',
          receipt: {
            page_url: this.page.url(),
            submitted_at: submittedAt,
            captured_at: new Date().toISOString(),
            network_response: networkResponse,
          },
        },
      };
    } catch (error: any) {
      return {
        ok: false,
        error: error.message || String(error),
        status: 'network_error',
      };
    }
  }

  /**
   * Get offer/commission data from product offer page
   * 
   * Navigate to the offer detail page and capture commission data
   * from the network response or DOM.
   */
  async getOfferData(itemId: string, options: { dryRun?: boolean } = {}): Promise<BrowserFlowResult<any>> {
    try {
      const offerUrl = `https://affiliate.shopee.co.th/offer/product_offer/${itemId}`;

      // Set up network capture before navigation
      let networkData: any = null;
      const responsePromise = this.page.waitForResponse(
        (response) => {
          const url = response.url();
          return url.includes('/offer/detail') || url.includes(`/product_offer/${itemId}`);
        },
        { timeout: TIMEOUTS.navigation }
      ).then(async (response) => {
        try {
          networkData = await response.json();
        } catch {
          networkData = await response.text();
        }
      }).catch(() => {});

      // Navigate to offer page
      await this.page.goto(offerUrl, {
        waitUntil: 'networkidle',
        timeout: TIMEOUTS.navigation,
      });

      await responsePromise;

      // Check for blockers
      const blockers = await this.checkForBlockers();
      if (blockers.captcha) {
        return { ok: false, error: 'CAPTCHA detected', status: 'captcha_detected' };
      }
      if (blockers.login) {
        return { ok: false, error: 'Login required', status: 'login_required' };
      }

      if (options.dryRun) {
        return {
          ok: true,
          status: 'success',
          data: {
            message: 'Dry run: navigated to offer page',
            item_id: itemId,
            network_captured: !!networkData,
          },
        };
      }

      // Extract from network response if available
      if (networkData) {
        const offerData = this.extractOfferFromResponse(networkData);
        if (offerData) {
          return {
            ok: true,
            status: 'success',
            data: {
              ...offerData,
              item_id: itemId,
              source: 'network_capture',
            },
          };
        }
      }

      // Fallback: parse from DOM
      const domData = await this.extractOfferFromDOM();
      if (domData) {
        return {
          ok: true,
          status: 'success',
          data: {
            ...domData,
            item_id: itemId,
            source: 'dom_parse',
          },
        };
      }

      return {
        ok: false,
        error: 'Could not extract offer data',
        status: 'uncertain',
      };
    } catch (error: any) {
      return {
        ok: false,
        error: error.message || String(error),
        status: 'network_error',
      };
    }
  }

  /**
   * Extract short link from API response
   */
  private extractShortLinkFromResponse(response: any): string | null {
    if (!response) return null;

    // Try common response structures
    const candidates = [
      response.data?.short_link,
      response.data?.link,
      response.short_link,
      response.link,
      response.data?.affiliate_url,
      response.affiliate_url,
    ];

    for (const candidate of candidates) {
      if (typeof candidate === 'string' && isShortLink(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  /**
   * Extract offer data from API response
   */
  private extractOfferFromResponse(response: any): any | null {
    if (!response || !response.data) return null;

    const data = response.data;
    return {
      commission_rate: data.commission_rate || data.commission_pct || null,
      price: data.price || null,
      product_name: data.product_name || data.name || null,
      shop_id: data.shop_id || null,
      stock: data.stock || null,
    };
  }

  /**
   * Extract offer data from DOM (fallback)
   */
  private async extractOfferFromDOM(): Promise<any | null> {
    try {
      const name = await this.page.locator(SHOPEE_SELECTORS.offerDetail.productName).first().textContent();
      const price = await this.page.locator(SHOPEE_SELECTORS.offerDetail.price).first().textContent();

      if (!name || !price) return null;

      return {
        product_name: name.trim(),
        price: price.trim(),
        source: 'dom',
      };
    } catch {
      return null;
    }
  }
}
