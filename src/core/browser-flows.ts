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
import { commissionFromOfferPayload } from './offer-commission.js';
import { customLinksFromResponse } from './custom-link.js';
import { conversionsFromMappedCsv, conversionsFromReportList, csvMappingFromHeader, parseMappedCsv, reportAffiliateId, type ConversionRow } from './conversions.js';

export interface BrowserFlowResult<T = any> {
  ok: boolean;
  data?: T;
  error?: string;
  status?: 'success' | 'captcha_detected' | 'login_required' | 'network_error' | 'timeout' | 'uncertain';
  receipt?: any;
  submitted?: boolean;
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
  fail_code: number | null;
  history_seen: boolean;
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
    let clicked = false;
    const onCreate = (response: Response) => {
      try {
        const path = new URL(response.url()).pathname;
        const method = response.request().method();
        if (method !== 'POST') return;
        const query = new URL(response.url()).searchParams.get('q');
        if (query === 'batchCustomLink' || path.includes('custom_link') || path.includes('create_link')) {
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

      const beforeClick = await this.checkForBlockers();
      if (beforeClick.captcha) {
        return { ok: false, error: 'CAPTCHA detected', status: 'captcha_detected' };
      }
      if (beforeClick.login) {
        return { ok: false, error: 'Login required', status: 'login_required' };
      }
      if (this.page.url().includes('s.shopee.co.th')) {
        return { ok: false, error: 'Stopped before submit: short link host', status: 'uncertain' };
      }

      await this.pause('beforeSubmit');

      let networkResponse: any = null;
      const responsePromise = this.page.waitForResponse(
        (response) => this.isCreateResponse(response),
        { timeout: TIMEOUTS.formSubmit }
      ).then(async (response) => {
        try {
          networkResponse = await response.json();
        } catch {
          networkResponse = null;
        }
      }).catch(() => {});

      const submitButton = this.page.locator(SHOPEE_SELECTORS.customLink.submitButton).first();
      await submitButton.click({ timeout: TIMEOUTS.elementVisible });
      clicked = true;

      await Promise.race([
        responsePromise,
        this.page.waitForTimeout(TIMEOUTS.formSubmit),
      ]);

      const afterClick = await this.checkForBlockers();
      if (afterClick.captcha) {
        return { ok: false, error: 'CAPTCHA detected', status: 'captcha_detected', submitted: true };
      }

      const created = customLinksFromResponse(networkResponse)[0] || null;
      const failCode = created?.failCode ?? null;
      if (failCode != null && failCode !== 0) {
        return {
          ok: false,
          error: `batchCustomLink failCode ${failCode}`,
          status: 'uncertain',
          submitted: true,
          receipt: {
            page_url: this.page.url(),
            submitted_at: submittedAt,
            captured_at: new Date().toISOString(),
            network_response: networkResponse,
          },
        };
      }

      let shortLink = created?.shortLink && isShortLink(created.shortLink) ? created.shortLink : null;
      const historySeen = shortLink ? await this.shortLinkShown(shortLink) : false;
      if (!shortLink) {
        const shown = await this.readShownShortLink();
        if (shown) shortLink = shown;
      }

      if (!shortLink) {
        const errorMsg = await this.page.locator('.ant-message-error, .error-message').first().textContent().catch(() => null);
        return {
          ok: false,
          error: errorMsg && errorMsg.trim() ? `Form error: ${errorMsg.trim()}` : 'Could not capture short link from result',
          status: 'uncertain',
          submitted: true,
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
        submitted: true,
        data: {
          short_link: shortLink,
          product_url: params.product_url,
          channel: params.channel,
          sub_ids: params.sub_ids,
          item_id,
          shop_id,
          created_at: new Date().toISOString(),
          method: networkResponse ? 'network_capture' : 'custom_link_form',
          fail_code: failCode,
          history_seen: historySeen || await this.shortLinkShown(shortLink),
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
        submitted: clicked,
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
   * Read the conversion report for a date range.
   * Uses the JSON list the page loads. Clicks download only if that list never arrives.
   * Does not open short links.
   */
  async getConversions(from: string, to: string): Promise<BrowserFlowResult<{
    rows: ConversionRow[];
    endpoint_path: string | null;
    source: 'report_list' | 'csv';
    affiliate_id: string | null;
    download_clicked: boolean;
  }>> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return { ok: false, error: 'Dates must be YYYY-MM-DD', status: 'uncertain' };
    }
    const endpointLog = this.startEndpointLog();
    let listPayload: any = null;
    let listUrl: string | null = null;
    const onResponse = async (response: Response) => {
      try {
        const url = new URL(response.url());
        if (url.pathname !== '/api/v3/report/list') return;
        const type = response.request().resourceType();
        if (type !== 'xhr' && type !== 'fetch') return;
        listUrl = response.url();
        listPayload = await response.json();
      } catch {
        // Keep the first readable list.
      }
    };
    this.page.on('response', onResponse);
    try {
      const pageUrl = this.options.reportsPage || this.resolveUrl(SHOPEE_SELECTORS.reports.page);
      await this.page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.navigation });
      const blockers = await this.checkForBlockers();
      if (blockers.captcha) return { ok: false, error: 'CAPTCHA detected', status: 'captcha_detected' };
      if (blockers.login) return { ok: false, error: 'Login required', status: 'login_required' };
      if (this.page.url().includes('s.shopee.co.th')) {
        return { ok: false, error: 'Stopped: short link host', status: 'uncertain' };
      }
      const deadline = Date.now() + (this.options.fast ? 2000 : 8000);
      while (!listPayload && Date.now() < deadline) {
        await this.page.waitForTimeout(100);
      }
      await this.pause('betweenFields');

      let payload = listPayload;
      let source: 'report_list' | 'csv' = 'report_list';
      let downloadClicked = false;
      if (listUrl) {
        payload = await this.fetchReportList(listUrl, from, to) ?? payload;
      }
      if (!payload) {
        downloadClicked = true;
        const csv = await this.downloadReportCsv(from, to);
        if (!csv) {
          return {
            ok: false,
            error: 'Conversion list and CSV download were both missing',
            status: 'uncertain',
            submitted: false,
          };
        }
        const mapped = parseMappedCsv(csv.text, csvMappingFromHeader(csv.text.split(/\r?\n/, 1)[0] || ''));
        return {
          ok: true,
          status: 'success',
          data: {
            rows: conversionsFromMappedCsv(mapped, from),
            endpoint_path: csv.path,
            source: 'csv',
            affiliate_id: null,
            download_clicked: true,
          },
        };
      }
      return {
        ok: true,
        status: 'success',
        data: {
          rows: conversionsFromReportList(payload),
          endpoint_path: '/api/v3/report/list',
          source,
          affiliate_id: reportAffiliateId(payload),
          download_clicked: downloadClicked,
        },
      };
    } catch (error: any) {
      return { ok: false, error: error.message || String(error), status: 'network_error' };
    } finally {
      this.page.off('response', onResponse);
      endpointLog.stop();
    }
  }

  private async fetchReportList(sampleUrl: string, from: string, to: string): Promise<any | null> {
    const start = Date.parse(`${from}T00:00:00+07:00`);
    const end = Date.parse(`${to}T23:59:59+07:00`);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    return this.page.evaluate(async ({ sampleUrl: raw, startMs, endMs }): Promise<any> => {
      const sample = new URL(raw);
      const stamp = Number(sample.searchParams.get('purchase_time_s') || '0');
      const useMs = stamp > 1e12;
      sample.searchParams.set('purchase_time_s', String(useMs ? startMs : Math.floor(startMs / 1000)));
      sample.searchParams.set('purchase_time_e', String(useMs ? endMs : Math.floor(endMs / 1000)));
      sample.searchParams.set('page_num', '1');
      const first = await fetch(sample.toString(), { credentials: 'include' });
      const body = await first.json() as any;
      const pageSize = Number(body?.data?.page_size || sample.searchParams.get('page_size') || 20);
      const total = Number(body?.data?.total_count || 0);
      const list = Array.isArray(body?.data?.list) ? body.data.list : [];
      const pages = Math.min(20, Math.ceil(total / Math.max(pageSize, 1)));
      for (let page = 2; page <= pages; page += 1) {
        sample.searchParams.set('page_num', String(page));
        const next = await fetch(sample.toString(), { credentials: 'include' });
        const more = await next.json() as any;
        if (Array.isArray(more?.data?.list)) list.push(...more.data.list);
      }
      if (body?.data) body.data.list = list;
      return body;
    }, { sampleUrl, startMs: start, endMs: end }).catch(() => null);
  }

  private async downloadReportCsv(from: string, to: string): Promise<{ text: string; path: string } | null> {
    const start = this.page.locator(SHOPEE_SELECTORS.reports.dateRangeStart).first();
    const end = this.page.locator(SHOPEE_SELECTORS.reports.dateRangeEnd).first();
    if (await start.count()) await start.fill(from).catch(() => {});
    if (await end.count()) await end.fill(to).catch(() => {});
    await this.pause('beforeSubmit');
    const download = this.page.waitForResponse((response) => {
      const type = response.headers()['content-type'] || '';
      return response.request().method() === 'GET' && (type.includes('csv') || response.url().includes('/report/export'));
    }, { timeout: TIMEOUTS.formSubmit }).catch(() => null);
    const button = this.page.locator(SHOPEE_SELECTORS.reports.downloadButton).first();
    if (await button.count() === 0) return null;
    await button.click({ timeout: TIMEOUTS.elementVisible });
    const response = await download;
    if (!response) return null;
    const text = await response.text().catch(() => null);
    if (!text) return null;
    let path = response.url();
    try {
      path = new URL(response.url()).pathname;
    } catch {
      path = response.url();
    }
    return { text, path };
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

  private isCreateResponse(response: Response): boolean {
    try {
      if (response.request().method() !== 'POST') return false;
      const url = new URL(response.url());
      if (url.searchParams.get('q') === 'batchCustomLink') return true;
      return url.pathname.includes('/custom_link/create') || url.pathname.includes('/create_link');
    } catch {
      return false;
    }
  }

  private async shownLinkText(): Promise<string> {
    const dialogs = this.page.locator('.success-modal, [role="dialog"]');
    const count = await dialogs.count().catch(() => 0);
    const chunks: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const dialog = dialogs.nth(index);
      const fields = dialog.locator('textarea, input');
      const fieldCount = await fields.count().catch(() => 0);
      for (let field = 0; field < fieldCount; field += 1) {
        const value = await fields.nth(field).inputValue({ timeout: 250 }).catch(() => '');
        if (value) chunks.push(value);
      }
      const text = await dialog.innerText({ timeout: 250 }).catch(() => '');
      if (text) chunks.push(text);
    }
    return chunks.join('\n');
  }

  private async readShownShortLink(): Promise<string | null> {
    const deadline = Date.now() + (this.options.fast ? 2000 : TIMEOUTS.dialogOpen);
    while (Date.now() < deadline) {
      const line = (await this.shownLinkText()).split('\n').map((item) => item.trim()).find((item) => isShortLink(item));
      if (line) return line;
      await this.page.waitForTimeout(200);
    }
    return null;
  }

  private async shortLinkShown(shortLink: string): Promise<boolean> {
    const deadline = Date.now() + (this.options.fast ? 2000 : TIMEOUTS.dialogOpen);
    while (Date.now() < deadline) {
      if ((await this.shownLinkText()).includes(shortLink)) return true;
      await this.page.waitForTimeout(200);
    }
    return false;
  }

  private extractOfferFromResponse(response: any): any | null {
    const parsed = commissionFromOfferPayload(response);
    if (!parsed) return null;
    const data = response?.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    const card = data.batch_item_for_item_card_full || {};
    return {
      ...parsed,
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
