import { chromium, type Browser, type Page, type CDPSession } from 'patchright';
import { BrowserFlows } from './browser-flows.js';

export interface CaptureOptions {
  urlPattern: string | RegExp;
  action?: () => Promise<void>;
  timeout?: number;
}

export interface QueuedTask {
  id: string;
  execute: () => Promise<any>;
  origin: string;
}

export class CaptchaDetectedError extends Error {
  constructor(message = 'CAPTCHA or verify page detected') {
    super(message);
    this.name = 'CaptchaDetectedError';
  }
}

export class CDPController {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private browserFlows: BrowserFlows | null = null;
  private taskQueue: Map<string, QueuedTask[]> = new Map();
  private processing: Set<string> = new Set();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;

  constructor(private cdpUrl: string = 'http://127.0.0.1:9222') {}

  async connect(): Promise<void> {
    try {
      this.browser = await Promise.race([
        chromium.connectOverCDP(this.cdpUrl, { noDefaults: true }),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('CDP connect timed out')), 10000);
        }),
      ]);
      const contexts = this.browser.contexts();
      
      if (contexts.length === 0) {
        throw new Error('No browser contexts found. Is Chrome running with remote debugging?');
      }

      const pages = contexts[0].pages();
      if (pages.length > 0) {
        this.page = pages[0];
      } else {
        this.page = await contexts[0].newPage();
      }

      this.browserFlows = new BrowserFlows(this.page);
      this.reconnectAttempts = 0;
      console.log('Connected to Chrome via CDP');
    } catch (error) {
      console.error('Failed to connect to Chrome:', error);
      throw new Error(`CDP connection failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  getBrowserFlows(): BrowserFlows {
    if (!this.browserFlows) {
      throw new Error('BrowserFlows not initialized. Call connect() first.');
    }
    return this.browserFlows;
  }

  async ensureConnected(): Promise<void> {
    if (!this.browser || !this.page) {
      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        throw new Error('Max reconnection attempts reached');
      }
      this.reconnectAttempts++;
      await this.connect();
    }
  }

  async disconnect(): Promise<void> {
    // connectOverCDP browser.close() drops this client's socket. It does not
    // quit Chrome, so the dedicated affiliate window stays open.
    const browser = this.browser;
    this.browser = null;
    this.page = null;
    this.browserFlows = null;
    if (browser) {
      await browser.close().catch(() => {});
    }
  }

  async captureNetworkResponse(options: CaptureOptions): Promise<any> {
    await this.ensureConnected();
    if (!this.page) throw new Error('No page available');

    const pattern = typeof options.urlPattern === 'string' 
      ? new RegExp(options.urlPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      : options.urlPattern;

    return new Promise(async (resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Timeout waiting for network response matching ${options.urlPattern}`));
      }, options.timeout || 30000);

      const responseHandler = async (response: any) => {
        try {
          if (pattern.test(response.url())) {
            clearTimeout(timeout);
            this.page!.off('response', responseHandler);
            
            const contentType = response.headers()['content-type'] || '';
            if (contentType.includes('application/json')) {
              const json = await response.json();
              resolve(json);
            } else {
              const text = await response.text();
              resolve(text);
            }
          }
        } catch (error) {
          console.error('Error handling response:', error);
        }
      };

      this.page!.on('response', responseHandler);

      if (options.action) {
        try {
          await this.checkForCaptcha();
          await options.action();
        } catch (error) {
          clearTimeout(timeout);
          this.page!.off('response', responseHandler);
          reject(error);
        }
      }
    });
  }

  private async checkForCaptcha(): Promise<void> {
    if (!this.page) return;

    const captchaSelectors = [
      '[class*="captcha"]',
      '[id*="captcha"]',
      'iframe[src*="captcha"]',
      '[class*="verify"]',
      'text=/please verify/i',
      'text=/security check/i',
    ];

    for (const selector of captchaSelectors) {
      try {
        const element = await this.page.$(selector);
        if (element) {
          throw new CaptchaDetectedError('CAPTCHA or verification page detected');
        }
      } catch (error) {
        if (error instanceof CaptchaDetectedError) {
          throw error;
        }
      }
    }
  }

  async navigateAndCapture(url: string, responsePattern: string | RegExp, timeout = 30000): Promise<any> {
    const origin = new URL(url).origin;
    return this.enqueueTask(origin, async () => {
      await this.ensureConnected();
      if (!this.page) throw new Error('No page available');

      await this.checkForCaptcha();
      await this.randomDelay();

      return this.captureNetworkResponse({
        urlPattern: responsePattern,
        action: async () => {
          await this.page!.goto(url, { waitUntil: 'networkidle' });
          await this.checkForCaptcha();
        },
        timeout,
      });
    });
  }

  async clickAndCapture(selector: string, responsePattern: string | RegExp, timeout = 30000): Promise<any> {
    return this.enqueueTask('default', async () => {
      await this.ensureConnected();
      if (!this.page) throw new Error('No page available');

      await this.checkForCaptcha();
      await this.randomDelay();

      return this.captureNetworkResponse({
        urlPattern: responsePattern,
        action: async () => {
          await this.page!.click(selector);
          await this.checkForCaptcha();
        },
        timeout,
      });
    });
  }

  private async enqueueTask(origin: string, task: () => Promise<any>): Promise<any> {
    const taskId = Math.random().toString(36).substring(7);
    
    return new Promise((resolve, reject) => {
      const queuedTask: QueuedTask = {
        id: taskId,
        execute: async () => {
          try {
            const result = await task();
            resolve(result);
          } catch (error) {
            reject(error);
          }
        },
        origin,
      };

      if (!this.taskQueue.has(origin)) {
        this.taskQueue.set(origin, []);
      }
      
      this.taskQueue.get(origin)!.push(queuedTask);
      this.processQueue(origin);
    });
  }

  private async processQueue(origin: string): Promise<void> {
    if (this.processing.has(origin)) {
      return;
    }

    this.processing.add(origin);

    try {
      const queue = this.taskQueue.get(origin);
      if (!queue || queue.length === 0) {
        return;
      }

      while (queue.length > 0) {
        const task = queue.shift();
        if (task) {
          await task.execute();
        }
      }
    } finally {
      this.processing.delete(origin);
    }
  }

  private async randomDelay(): Promise<void> {
    const min = 1000;
    const max = 3000;
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  async getCurrentPage(): Promise<Page | null> {
    await this.ensureConnected();
    return this.page;
  }

  async openNewTab(url: string): Promise<Page> {
    await this.ensureConnected();
    if (!this.browser) throw new Error('Browser not connected');

    const context = this.browser.contexts()[0];
    const newPage = await context.newPage();
    await newPage.goto(url, { waitUntil: 'networkidle' });
    return newPage;
  }

  getQueueStatus(): Record<string, number> {
    const status: Record<string, number> = {};
    for (const [origin, tasks] of this.taskQueue) {
      status[origin] = tasks.length;
    }
    return status;
  }

  isConnected(): boolean {
    return this.browser !== null && this.page !== null;
  }
}
