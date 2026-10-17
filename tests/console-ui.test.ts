import { test } from 'node:test';
import { chromium, Browser, Page } from 'playwright';
import { spawn, ChildProcess } from 'child_process';
import { mkdirSync } from 'fs';

let consoleServer: ChildProcess | null = null;
let browser: Browser | null = null;
let page: Page | null = null;

async function setup() {
  mkdirSync('docs/screenshots', { recursive: true });

  process.env.SHOPKUD_DB_PATH = './test-console.db';
  process.env.CONSOLE_PORT = '3033';

  console.log('Starting console server...');
  consoleServer = spawn('npx', ['tsx', 'src/console/server.ts'], {
    stdio: 'pipe',
    env: { ...process.env },
  });

  await new Promise(resolve => setTimeout(resolve, 3000));

  console.log('Launching browser...');
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  
  console.log('Console ready at http://localhost:3033');
}

async function teardown() {
  if (page) await page.close();
  if (browser) await browser.close();
  if (consoleServer) {
    consoleServer.kill();
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

test('Console UI smoke tests with screenshots', async () => {
  await setup();

  try {
    console.log('\n1. Testing Links Registry view...');
    await page!.goto('http://localhost:3033', { waitUntil: 'networkidle' });
    await page!.waitForSelector('.tabs', { timeout: 5000 });
    await page!.screenshot({ path: 'docs/screenshots/console-links-registry.png', fullPage: true });
    console.log('✅ Links Registry screenshot saved');

    console.log('\n2. Testing Create Link view...');
    await page!.click('button:has-text("Create Link")');
    await page!.waitForSelector('#product-url', { timeout: 2000 });
    await page!.fill('#product-url', 'https://shopee.co.th/product-i.456.123');
    await page!.selectOption('#channel', 'tiktok');
    await page!.fill('#sub-id-1', 'tiktok');
    await page!.fill('#sub-id-2', 'P1');
    await page!.fill('#sub-id-3', 'v6');
    await page!.screenshot({ path: 'docs/screenshots/console-create-link.png', fullPage: true });
    console.log('✅ Create Link screenshot saved');

    console.log('\n3. Testing Batch Create view...');
    await page!.click('button:has-text("Batch Create")');
    await page!.waitForSelector('.batch-actions', { timeout: 2000 });
    await page!.click('button:has-text("+ Add Item")');
    await page!.waitForSelector('.batch-item', { timeout: 1000 });
    await page!.screenshot({ path: 'docs/screenshots/console-batch-create.png', fullPage: true });
    console.log('✅ Batch Create screenshot saved');

    console.log('\n4. Testing Offers view...');
    await page!.click('button:has-text("Offers")');
    await page!.waitForSelector('#offer-item-id', { timeout: 2000 });
    await page!.fill('#offer-item-id', '123456789');
    await page!.screenshot({ path: 'docs/screenshots/console-offers.png', fullPage: true });
    console.log('✅ Offers screenshot saved');

    console.log('\n5. Testing Job Queue view...');
    await page!.click('button:has-text("Job Queue")');
    await page!.waitForSelector('#queue-container', { timeout: 2000 });
    await page!.screenshot({ path: 'docs/screenshots/console-queue.png', fullPage: true });
    console.log('✅ Job Queue screenshot saved');

    console.log('\n6. Testing System Status view...');
    await page!.click('button:has-text("System Status")');
    await page!.waitForSelector('#status-detail', { timeout: 2000 });
    await page!.screenshot({ path: 'docs/screenshots/console-status.png', fullPage: true });
    console.log('✅ System Status screenshot saved');

    console.log('\n7. Creating a CAPTCHA-stopped job simulation...');
    await page!.evaluate(() => {
      const queueContainer = document.getElementById('queue-container');
      if (queueContainer) {
        queueContainer.innerHTML = `
          <div class="queue-item">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
              <strong>verify_link</strong>
              <span class="queue-status captcha_stopped">CAPTCHA_STOPPED</span>
            </div>
            <div style="font-size: 0.9em; color: #6b7280;">
              <strong>Job ID:</strong> job_mock_captcha_12345<br>
              <strong>Created:</strong> ${new Date().toLocaleString('th-TH')}<br>
              <strong>Error:</strong> CAPTCHA detected - manual intervention required
            </div>
          </div>
          <div class="queue-item">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
              <strong>create_link</strong>
              <span class="queue-status pending">PENDING</span>
            </div>
            <div style="font-size: 0.9em; color: #6b7280;">
              <strong>Job ID:</strong> job_mock_pending_67890<br>
              <strong>Created:</strong> ${new Date().toLocaleString('th-TH')}
            </div>
          </div>
        `;
      }
    });
    await page!.screenshot({ path: 'docs/screenshots/console-queue-captcha-stopped.png', fullPage: true });
    console.log('✅ CAPTCHA-stopped job screenshot saved');

    console.log('\n8. Back to Links Registry with mock data...');
    await page!.click('button:has-text("Links Registry")');
    await page!.waitForTimeout(500);
    
    await page!.evaluate(() => {
      const container = document.getElementById('links-container');
      if (container) {
        container.innerHTML = `
          <div class="link-card">
            <h3>
              <span class="badge badge-channel">TIKTOK</span>
              P1-123
            </h3>
            <div class="link-meta">
              <div><strong>Item ID:</strong> 123</div>
              <div><strong>Clip:</strong> v6</div>
              <div><strong>Created:</strong> ${new Date().toLocaleDateString('th-TH')}</div>
              <div>
                <strong>Ownership:</strong>
                <span class="badge badge-verified">true</span>
              </div>
              <div>
                <strong>Target:</strong>
                <span class="badge badge-verified">true</span>
              </div>
            </div>
            <div style="margin-top: 15px; padding: 10px; background: white; border-radius: 6px; font-family: monospace; font-size: 0.9em; word-break: break-all;">
              https://s.shopee.co.th/mock-test-link
            </div>
            <div style="margin-top: 8px; font-size: 0.85em; color: #6b7280;">
              <strong>Sub IDs:</strong> tiktok, P1, v6
            </div>
          </div>
        `;
      }
    });
    await page!.screenshot({ path: 'docs/screenshots/console-links-with-data.png', fullPage: true });
    console.log('✅ Links Registry with mock data screenshot saved');

    console.log('\n✅ All console UI smoke tests passed!');
    console.log('   Screenshots saved to docs/screenshots/');
  } catch (error) {
    console.error('❌ Console UI tests failed:', error);
    throw error;
  } finally {
    await teardown();
  }
});
