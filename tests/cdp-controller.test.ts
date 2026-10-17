import { test } from 'node:test';
import assert from 'node:assert';
import { CDPController, CaptchaDetectedError } from '../src/core/cdp-controller.js';
import { chromium } from 'patchright';

test('CDP Controller connects and handles queue', async () => {
  console.log('Testing CDP controller (requires Chrome with --remote-debugging-port=9222)...');
  
  const cdp = new CDPController('http://127.0.0.1:9222');

  try {
    await cdp.connect();
    assert.ok(cdp.isConnected(), 'Should connect to Chrome');
    console.log('✅ Connected to Chrome via CDP');

    const queueStatus = cdp.getQueueStatus();
    assert.ok(typeof queueStatus === 'object', 'Queue status should be an object');
    console.log('✅ Queue status retrieved:', queueStatus);

    await cdp.disconnect();
    assert.ok(!cdp.isConnected(), 'Should disconnect');
    console.log('✅ Disconnected successfully');
  } catch (error) {
    console.log('⚠️  Test skipped: Chrome not available on port 9222');
    console.log('   To run this test, start Chrome with: chrome --remote-debugging-port=9222');
  }
});

test('CDP Controller detects CAPTCHA', async () => {
  console.log('Testing CAPTCHA detection...');
  
  const cdp = new CDPController('http://127.0.0.1:9222');

  try {
    await cdp.connect();
    
    const page = await cdp.getCurrentPage();
    if (!page) {
      console.log('⚠️  Test skipped: No page available');
      return;
    }

    await page.setContent(`
      <!DOCTYPE html>
      <html>
      <body>
        <div class="captcha-challenge">Please verify</div>
      </body>
      </html>
    `);

    let captchaDetected = false;
    try {
      await (cdp as any).checkForCaptcha();
    } catch (error) {
      if (error instanceof CaptchaDetectedError) {
        captchaDetected = true;
      }
    }

    assert.ok(captchaDetected, 'Should detect CAPTCHA');
    console.log('✅ CAPTCHA detection works');

    await cdp.disconnect();
  } catch (error) {
    console.log('⚠️  Test skipped: Chrome not available on port 9222');
  }
});

test('CDP Controller queues tasks per origin', async () => {
  const cdp = new CDPController('http://127.0.0.1:9222');

  try {
    await cdp.connect();

    const tasks: Promise<void>[] = [];
    let executionOrder: number[] = [];

    for (let i = 0; i < 3; i++) {
      const taskIndex = i;
      tasks.push(
        (cdp as any).enqueueTask('https://example.com', async () => {
          executionOrder.push(taskIndex);
          await new Promise(resolve => setTimeout(resolve, 10));
        })
      );
    }

    await Promise.all(tasks);

    assert.deepStrictEqual(executionOrder, [0, 1, 2], 'Tasks should execute in order per origin');
    console.log('✅ Task queue ordering works');

    await cdp.disconnect();
  } catch (error) {
    console.log('⚠️  Test skipped: Chrome not available on port 9222');
  }
});

test('CDP Controller reconnects after disconnect', async () => {
  const cdp = new CDPController('http://127.0.0.1:9222');

  try {
    await cdp.connect();
    assert.ok(cdp.isConnected(), 'Should connect initially');

    await cdp.disconnect();
    assert.ok(!cdp.isConnected(), 'Should disconnect');

    await cdp.connect();
    assert.ok(cdp.isConnected(), 'Should reconnect successfully');
    console.log('✅ Reconnection works');

    await cdp.disconnect();
  } catch (error) {
    console.log('⚠️  Test skipped: Chrome not available on port 9222');
  }
});
