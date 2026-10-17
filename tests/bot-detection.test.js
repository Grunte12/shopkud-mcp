import { chromium } from 'patchright';

async function testBotDetection() {
  console.log('🤖 Running bot detection tests...\n');

  const results = {
    'bot.sannysoft.com': null,
    'rebrowser-bot-detector': null,
    'creepjs': null,
  };

  let browser;
  let page;
  try {
    const port = (process.env.SHOPKUD_CDP_PORT || '').trim();
    const cdpUrl = port ? `http://127.0.0.1:${port}` : (process.env.CHROME_CDP_URL || '');
    let parsedPort = '';
    try { parsedPort = new URL(cdpUrl).port; } catch { parsedPort = ''; }
    if (!cdpUrl || parsedPort === '9222' || parsedPort === '9333') {
      throw new Error('Set SHOPKUD_CDP_PORT to a throwaway Chrome. Refusing ports 9222 and 9333.');
    }
    browser = await Promise.race([
      chromium.connectOverCDP(cdpUrl, { noDefaults: true }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('CDP connect timed out')), 10000)),
    ]);
    const context = browser.contexts()[0];
    page = await context.newPage();

    console.log('Testing bot.sannysoft.com...');
    try {
      await page.goto('https://bot.sannysoft.com/', { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(2000);

      const botScore = await page.evaluate(() => {
        const failures = document.querySelectorAll('tr td:nth-child(2)').length;
        const suspiciousItems = Array.from(document.querySelectorAll('tr')).filter(row => {
          const status = row.querySelector('td:nth-child(2)');
          return status && (status.textContent.includes('bot') || status.textContent.includes('suspicious'));
        });
        return {
          total_checks: failures,
          suspicious: suspiciousItems.length,
          webdriver: !!navigator.webdriver,
        };
      });

      results['bot.sannysoft.com'] = botScore;
      console.log('✅ bot.sannysoft.com:', JSON.stringify(botScore, null, 2));
    } catch (error) {
      results['bot.sannysoft.com'] = { error: error.message };
      console.log('❌ bot.sannysoft.com failed:', error.message);
    }

    console.log('\nTesting rebrowser bot detector...');
    try {
      await page.goto('https://bot-detector.rebrowser.net/', { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(3000);

      const rebrowserScore = await page.evaluate(() => {
        const statusElement = document.querySelector('[class*="status"]') || document.querySelector('h1');
        const detailsElement = document.querySelector('pre') || document.querySelector('[class*="details"]');
        return {
          status: statusElement?.textContent || 'unknown',
          details: detailsElement?.textContent.substring(0, 200) || 'No details',
          webdriver: !!navigator.webdriver,
        };
      });

      results['rebrowser-bot-detector'] = rebrowserScore;
      console.log('✅ rebrowser-bot-detector:', JSON.stringify(rebrowserScore, null, 2));
    } catch (error) {
      results['rebrowser-bot-detector'] = { error: error.message };
      console.log('❌ rebrowser-bot-detector failed:', error.message);
    }

    console.log('\nTesting CreepJS...');
    try {
      await page.goto('https://abrahamjuliot.github.io/creepjs/', { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(5000);

      const creepjsScore = await page.evaluate(() => {
        const trustScore = document.querySelector('[class*="trust"]')?.textContent || 'unknown';
        const lies = document.querySelectorAll('[class*="lie"]').length;
        return {
          trust_score: trustScore,
          detected_lies: lies,
          webdriver: !!navigator.webdriver,
        };
      });

      results['creepjs'] = creepjsScore;
      console.log('✅ CreepJS:', JSON.stringify(creepjsScore, null, 2));
    } catch (error) {
      results['creepjs'] = { error: error.message };
      console.log('❌ CreepJS failed or timeout:', error.message);
    }

    await page.close();
    await browser.close();

    console.log('\n📊 Bot Detection Summary:');
    console.log('========================');
    console.log(JSON.stringify(results, null, 2));

    console.log('\n✅ Bot detection tests completed');
    return results;
  } catch (error) {
    console.error('❌ Bot detection tests failed:', error.message);
    console.error('Start a throwaway Chrome on a free port, for example 9444, with a /tmp user-data-dir.');
    if (page) {
      try { await page.close(); } catch (e) {}
    }
    if (browser) {
      try {
        await browser.close();
      } catch (e) {}
    }
    process.exit(1);
  }
}

testBotDetection();
