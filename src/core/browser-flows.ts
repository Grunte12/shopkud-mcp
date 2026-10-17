/**
 * Browser automation flows for Shopee Affiliate operations
 *
 * All flows go through the logged-in Chrome (patchright over CDP).
 * No Open API calls - everything via browser automation.
 *
 * createCustomLink({ dryRun: true }) fills the custom-link form and stops
 * before submit. It never clicks the submit control.
 */

import { Page, type Response } from 'patchright';
import { SHOPEE_SELECTORS, TIMEOUTS, DELAYS, isShortLink, parseProductUrl } from '../config/selectors.js';
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

export interface SelectorCheck {
  name: string;
  selector: string;
  count: number;
  resolved: boolean;
}

export interface CreateLinkDryRunData {
  dry_run: true;
  submitted: false;
  message: string;
  product_url: string;
  sub_ids: SubIds;
  filled: Record<string, boolean>;
  selectors: SelectorCheck[];
  all_required_resolved: boolean;
  create_request_seen: boolean;
  endpoints: string[];
}

export interface BrowserFlowOptions {
  /** Rewrite affiliate.shopee.co.th page URLs onto a mock origin. */
  affiliateBase?: string;
  /** Skip human-paced delays. Tests only. */
  fast?: boolean;
  customLinkPage?: string;
  reportsPage?: string;
  offerPage?: string;
}

const REQUIRED_CUSTOM_LINK_SELECTORS = [
  'productUrlInput',
  'subId1Input',
  'subId2Input',
  'subId3Input',
  'subId4Input',
  'subId5Input',
  'submitButton',
] as const;

export class BrowserFlows {
  constructor(private page: Page, private options: BrowserFlowOptions = {}) {}

  private async pause(kind: keyof typeof DELAYS): Promise<void> {
    if (this.options.fast) return;
    await this.page.waitForTimeout(DELAYS[kind]());
  }

  private resolveUrl(absolute: string): string {
    if (!this.options.affiliateBase) return absolute;
    const target = new URL(absolute);
    const base = new URL(this.options.affiliateBase);
    return new URL(`${target.pathname}${target.search}`, base).toString();
  }

  private async checkSelector(name: string, selector: string): Promise<SelectorCheck> {
    const count = await this.page.locator(selector).count().catch(() => 0);
    return { name, selector, count, resolved: count > 0 };
  }

  private startEndpointLog(): { paths: string[]; stop: () => void } {
    const paths: string[] = [];
    const handler = (response: Response) => {
      try {
        const url = new URL(response.url());
        const path = url.pathname;
        const method = response.request().method();
        const interesting = path.includes('/api/') || path.includes('custom_link') || path.includes('create_link') || path.includes('/offer/') || path.includes('/report');
        if (!interesting) return;
        const line = `${method} ${path}`;
        if (!paths.includes(line)) paths.push(line);
      } catch {
        // Ignore non-URL responses.
      }
    };
    this.page.on('response', handler);
    return {
      paths,
      stop: () => this.page.off('response', handler),
    };
  }

  /**
   * Check for CAPTCHA or login requirements.
   * Login is a password field or a login/verify URL, not a stray button label.
   */
  async checkForBlockers(): Promise<{ captcha: boolean; login: boolean }> {
    const captchaSelectors = SHOPEE_SELECTORS.captcha.join(', ');
    const url = this.page.url();
    const loginUrl = /\/login(?:\/|$|\?)|\/signin(?:\/|$|\?)|\/verify\/traffic/i.test(url);

    const [captcha, passwordVisible] = await Promise.all([
      this.page.locator(captchaSelectors).first().isVisible().catch(() => false),
      this.page.locator('input[type="password"]').first().isVisible().catch(() => false),
    ]);

    return { captcha, login: captcha ? false : (loginUrl || passwordVisible) };
  }

  /**
   * Create custom link via the custom link page form.
   *
   * dryRun walks the page, checks every configured selector, fills the
   * product URL and Sub IDs, and returns before the submit click.
   */
  async createCustomLink(params: CreateLinkParams, options: { dryRun?: boolean } = {}): Promise<BrowserFlowResult<CreateLinkResult | CreateLinkDryRunData>> {
    const endpointLog = this.startEndpointLog();
    let createRequestSeen = false;
    const onCreate = (response: Response) => {
      try {
        const path = new URL(response.url()).pathname;
        const method = response.request().method();
        if (method !== 'POST') return;
        if (path.includes('custom_link') || path.includes('create_link')) {
          createRequestSeen = true;
        }
      } catch {
        // Ignore non-URL responses.
      }
    };
    this.page.on('response', onCreate);

    try {
      const submittedAt = new Date().toISOString();
      const pageUrl = this.options.customLinkPage || this.resolveUrl(SHOPEE_SELECTORS.customLink.page);

      await this.page.goto(pageUrl, {
        waitUntil: 'domcontentloaded',
        timeout: TIMEOUTS.navigation,
      });

      const blockers = await this.checkForBlockers();
      if (blockers.captcha) {
        return { ok: false, error: 'CAPTCHA detected', status: 'captcha_detected' };
      }
      if (blockers.login) {
        return { ok: false, error: 'Login required', status: 'login_required' };
      }

      await this.page.locator(SHOPEE_SELECTORS.customLink.productUrlInput).first()
        .waitFor({ state: 'attached', timeout: this.options.fast ? 500 : 8000 })
        .catch(() => {});

      const selectorMap: Record<string, string> = {
        productUrlInput: SHOPEE_SELECTORS.customLink.productUrlInput,
        subId1Input: SHOPEE_SELECTORS.customLink.subId1Input,
        subId2Input: SHOPEE_SELECTORS.customLink.subId2Input,
        subId3Input: SHOPEE_SELECTORS.customLink.subId3Input,
        subId4Input: SHOPEE_SELECTORS.customLink.subId4Input,
        subId5Input: SHOPEE_SELECTORS.customLink.subId5Input,
        submitButton: SHOPEE_SELECTORS.customLink.submitButton,
        resultDialog: SHOPEE_SELECTORS.customLink.resultDialog,
        resultLinkTextarea: SHOPEE_SELECTORS.customLink.resultLinkTextarea,
        errorMessage: SHOPEE_SELECTORS.customLink.errorMessage,
      };

      const selectors: SelectorCheck[] = [];
      for (const [name, selector] of Object.entries(selectorMap)) {
        selectors.push(await this.checkSelector(name, selector));
      }

      const resolved = new Map(selectors.map((item) => [item.name, item.resolved]));
      const allRequiredResolved = REQUIRED_CUSTOM_LINK_SELECTORS.every((name) => resolved.get(name));

      const productUrlInput = this.page.locator(SHOPEE_SELECTORS.customLink.productUrlInput).first();
      if (!options.dryRun) {
        await productUrlInput.waitFor({ state: 'visible', timeout: TIMEOUTS.elementVisible });
      } else if (!resolved.get('productUrlInput')) {
        return {
          ok: false,
          status: 'uncertain',
          error: 'Dry run: one or more required selectors did not resolve',
          data: {
            dry_run: true,
            submitted: false,
            message: 'Dry run: stopped before submit',
            product_url: params.product_url,
            sub_ids: params.sub_ids,
            filled: {},
            selectors,
            all_required_resolved: false,
            create_request_seen: createRequestSeen,
            endpoints: endpointLog.paths,
          },
        };
      }

      const filled: Record<string, boolean> = {};
      if (resolved.get('productUrlInput') || !options.dryRun) {
        await productUrlInput.fill(params.product_url);
        filled.product_url = true;
        await this.pause('betweenFields');
      }

      const subIdInputs = [
        { name: 'sub_id1', selector: SHOPEE_SELECTORS.customLink.subId1Input, value: params.sub_ids.sub_id1 },
        { name: 'sub_id2', selector: SHOPEE_SELECTORS.customLink.subId2Input, value: params.sub_ids.sub_id2 },
        { name: 'sub_id3', selector: SHOPEE_SELECTORS.customLink.subId3Input, value: params.sub_ids.sub_id3 },
        { name: 'sub_id4', selector: SHOPEE_SELECTORS.customLink.subId4Input, value: params.sub_ids.sub_id4 },
        { name: 'sub_id5', selector: SHOPEE_SELECTORS.customLink.subId5Input, value: params.sub_ids.sub_id5 },
      ];

      for (const { name, selector, value } of subIdInputs) {
        if (!value) continue;
        const input = this.page.locator(selector).first();
        const exists = await input.count() > 0;
        if (!exists) continue;
        await input.fill(value);
        filled[name] = true;
        await this.pause('betweenFields');
      }

      if (options.dryRun) {
        if (createRequestSeen) {
          return {
            ok: false,
            status: 'uncertain',
            error: 'Dry run observed a create request before submit',
            data: {
              dry_run: true,
              submitted: false,
              message: 'Dry run: stopped before submit',
              product_url: params.product_url,
              sub_ids: params.sub_ids,
              filled,
              selectors,
              all_required_resolved: allRequiredResolved,
              create_request_seen: true,
              endpoints: endpointLog.paths,
            },
          };
        }

        return {
          ok: allRequiredResolved,
          status: allRequiredResolved ? 'success' : 'uncertain',
          error: allRequiredResolved ? undefined : 'Dry run: one or more required selectors did not resolve',
          data: {
            dry_run: true,
            submitted: false,
            message: 'Dry run: stopped before submit',
            product_url: params.product_url,
            sub_ids: params.sub_ids,
            filled,
            selectors,
            all_required_resolved: allRequiredResolved,
            create_request_seen: false,
            endpoints: endpointLog.paths,
          },
        };
      }

      await this.pause('beforeSubmit');

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

      const submitButton = this.page.locator(SHOPEE_SELECTORS.customLink.submitButton).first();
      await submitButton.click();

      await Promise.race([
        responsePromise,
        this.page.waitForTimeout(TIMEOUTS.formSubmit),
      ]);

      await this.pause('afterSubmit');

      const errorMsg = await this.page.locator(SHOPEE_SELECTORS.customLink.errorMessage).first().textContent().catch(() => null);
      if (errorMsg && errorMsg.trim().length > 0) {
        return {
          ok: false,
          error: `Form error: ${errorMsg}`,
          status: 'uncertain',
        };
      }

      const resultDialog = this.page.locator(SHOPEE_SELECTORS.customLink.resultDialog).first();
      const dialogVisible = await resultDialog.isVisible({ timeout: TIMEOUTS.dialogOpen }).catch(() => false);

      let shortLink: string | null = null;

      if (dialogVisible) {
        const linkTextarea = resultDialog.locator(SHOPEE_SELECTORS.customLink.resultLinkTextarea).first();
        const linkValue = await linkTextarea.inputValue().catch(() => null);
        if (linkValue && isShortLink(linkValue)) {
          shortLink = linkValue;
        }
      }

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

      const parsed = parseProductUrl(params.product_url);
      const shop_id = parsed?.shopId || '';
      const item_id = parsed?.itemId || '';

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
    } finally {
      this.page.off('response', onCreate);
      endpointLog.stop();
    }
  }

  /**
   * Get offer/commission data from product offer page.
   *
   * Navigate to the offer detail page and capture commission data
   * from the network response or DOM. Does not click Get Link.
   */
  async getOfferData(itemId: string, options: { dryRun?: boolean } = {}): Promise<BrowserFlowResult<any>> {
    if (!/^[0-9]{1,20}$/.test(itemId)) {
      return { ok: false, error: 'Invalid item id', status: 'uncertain' };
    }

    const endpointLog = this.startEndpointLog();
    try {
      const offerUrl = this.options.offerPage || this.resolveUrl(`https://affiliate.shopee.co.th/offer/product_offer/${itemId}`);

      let networkData: any = null;
      let matchedPath: string | null = null;
      const capture = new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          this.page.off('response', handler);
          resolve();
        }, this.options.fast ? 2000 : 8000);

        const handler = async (response: Response) => {
          try {
            const type = response.request().resourceType();
            if (type !== 'xhr' && type !== 'fetch') return;
            const contentType = response.headers()['content-type'] || '';
            if (!contentType.includes('json')) return;
            const url = response.url();
            if (!url.includes('offer') && !url.includes(itemId)) return;
            const json = await response.json();
            const extracted = this.extractOfferFromResponse(json);
            if (!extracted || extracted.commission_rate == null) return;
            networkData = json;
            matchedPath = new URL(url).pathname;
            clearTimeout(timer);
            this.page.off('response', handler);
            resolve();
          } catch {
            // Keep waiting for a commission payload.
          }
        };
        this.page.on('response', handler);
      });

      await this.page.goto(offerUrl, {
        waitUntil: 'domcontentloaded',
        timeout: TIMEOUTS.navigation,
      });

      await capture;

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
            dry_run: true,
            message: 'Dry run: navigated to offer page',
            item_id: itemId,
            network_captured: !!networkData,
            endpoint_path: matchedPath,
            endpoints: endpointLog.paths,
          },
        };
      }

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
              endpoint_path: matchedPath,
              endpoints: endpointLog.paths,
            },
          };
        }
      }

      const domData = await this.extractOfferFromDOM();
      if (domData) {
        return {
          ok: true,
          status: 'success',
          data: {
            ...domData,
            item_id: itemId,
            source: 'dom_parse',
            endpoint_path: matchedPath,
            endpoints: endpointLog.paths,
          },
        };
      }

      return {
        ok: false,
        error: 'Could not extract offer data',
        status: 'uncertain',
        data: {
          item_id: itemId,
          endpoint_path: matchedPath,
          endpoints: endpointLog.paths,
        },
      };
    } catch (error: any) {
      return {
        ok: false,
        error: error.message || String(error),
        status: 'network_error',
      };
    } finally {
      endpointLog.stop();
    }
  }

  /**
   * Open the reports page and check selectors plus endpoints.
   * Does not set a date range, click download, or export.
   */
  async inspectReports(): Promise<BrowserFlowResult<{
    selectors: SelectorCheck[];
    endpoints: string[];
    download_clicked: false;
    export_request_seen: boolean;
  }>> {
    const endpointLog = this.startEndpointLog();
    try {
      const pageUrl = this.options.reportsPage || this.resolveUrl(SHOPEE_SELECTORS.reports.page);
      await this.page.goto(pageUrl, {
        waitUntil: 'domcontentloaded',
        timeout: TIMEOUTS.navigation,
      });
      await this.pause('betweenFields');

      const blockers = await this.checkForBlockers();
      if (blockers.captcha) {
        return { ok: false, error: 'CAPTCHA detected', status: 'captcha_detected' };
      }
      if (blockers.login) {
        return { ok: false, error: 'Login required', status: 'login_required' };
      }

      await this.page.locator(SHOPEE_SELECTORS.reports.dateRangeStart).first()
        .waitFor({ state: 'attached', timeout: this.options.fast ? 500 : 8000 })
        .catch(() => {});

      const selectors = await Promise.all([
        this.checkSelector('dateRangeStart', SHOPEE_SELECTORS.reports.dateRangeStart),
        this.checkSelector('dateRangeEnd', SHOPEE_SELECTORS.reports.dateRangeEnd),
        this.checkSelector('downloadButton', SHOPEE_SELECTORS.reports.downloadButton),
        this.checkSelector('reportTable', SHOPEE_SELECTORS.reports.reportTable),
      ]);

      const exportRequestSeen = endpointLog.paths.some((line) => /export|download/i.test(line));
      const allResolved = selectors.every((item) => item.resolved);

      return {
        ok: allResolved,
        status: allResolved ? 'success' : 'uncertain',
        error: allResolved ? undefined : 'One or more report selectors did not resolve',
        data: {
          selectors,
          endpoints: endpointLog.paths,
          download_clicked: false,
          export_request_seen: exportRequestSeen,
        },
      };
    } catch (error: any) {
      return {
        ok: false,
        error: error.message || String(error),
        status: 'network_error',
      };
    } finally {
      endpointLog.stop();
    }
  }

  private extractShortLinkFromResponse(response: any): string | null {
    if (!response) return null;

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

  private readRate(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const trimmed = value.trim().replace(/,/g, '').replace(/%$/, '');
      if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
    }
    return null;
  }

  /** "12%" or "12.5 %" → 12 or 12.5. */
  private readPercentText(value: unknown): number | null {
    if (typeof value !== 'string' || !value.includes('%')) return null;
    const match = value.replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*%/);
    return match ? Number(match[1]) : null;
  }

  /**
   * Live offer integers are percent × 1000 (12000 → 12%).
   * A value that is already a percent, such as 10 or "10%", stays as-is.
   */
  private asPercent(raw: unknown, text?: unknown): number | null {
    const rate = this.readRate(raw);
    if (rate != null) {
      const percent = Math.abs(rate) >= 1000 ? rate / 1000 : rate;
      return Math.round(percent * 100) / 100;
    }
    return this.readPercentText(text);
  }

  /** Live prices are baht × 100000. A normal baht value stays as-is. */
  private asBaht(value: unknown): number | null {
    if (typeof value === 'string' && value.includes('-') && !value.trim().startsWith('-')) {
      return this.asBaht(value.split('-')[0]);
    }
    const amount = this.readRate(value);
    if (amount == null) return null;
    const baht = Math.abs(amount) >= 100000 ? amount / 100000 : amount;
    return Math.round(baht * 100) / 100;
  }

  private bahtFromPercent(price: number | null, percent: number | null): number | null {
    if (price == null || percent == null) return null;
    return Math.round(price * percent) / 100;
  }

  private extractOfferFromResponse(response: any): any | null {
    const data = response?.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;

    const detail = data.commission_rate_detail || {};
    const rates = (data.commission_rate && typeof data.commission_rate === 'object') ? data.commission_rate : {};
    const flatRate = typeof data.commission_rate === 'number' || typeof data.commission_rate === 'string'
      ? data.commission_rate
      : null;
    const storePercent = [
      this.asPercent(detail.seller_commission_rate, rates.seller_commission_rate),
      this.asPercent(detail.default_commission_rate, rates.default_commission_rate),
      this.asPercent(rates.max_commission_rate),
      this.asPercent(flatRate),
      this.asPercent(data.commission_pct),
    ].find((item) => item != null && item > 0);
    if (storePercent == null) return null;
    return this.finishOffer(data, storePercent);
  }

  private finishOffer(data: any, storePercent: number): any {
    const card = data.batch_item_for_item_card_full || {};
    const priceBaht = this.asBaht(card.price) ?? this.asBaht(data.price);
    const priceMin = this.asBaht(card.price_min) ?? priceBaht;
    const priceMax = this.asBaht(card.price_max) ?? priceBaht;
    return {
      commission_rate: storePercent,
      store_commission_percent: storePercent,
      price: priceBaht,
      price_baht: priceBaht,
      price_min_baht: priceMin,
      price_max_baht: priceMax,
      commission_baht: this.bahtFromPercent(priceBaht, storePercent),
      commission_min_baht: this.bahtFromPercent(priceMin, storePercent),
      commission_max_baht: this.bahtFromPercent(priceMax, storePercent),
      product_name: card.name || data.product_name || data.name || null,
      shop_id: card.shopid || data.shop_id || null,
      stock: card.stock ?? data.stock ?? null,
    };
  }

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
