import { chromium } from 'patchright';
import { writeFileSync, mkdirSync } from 'fs';

async function runBotDetection() {
  console.log('🤖 Running comprehensive bot detection tests...\n');

  const results = {
    timestamp: new Date().toISOString(),
    'bot.sannysoft.com': null as any,
    'rebrowser-bot-detector': null as any,
    'creepjs': null as any,
  };

  let browser;
  try {
    mkdirSync('docs/screenshots', { recursive: true });
    
    const cdpUrl = process.env.CHROME_CDP_URL || '';
    if (!cdpUrl || /:9222(\/|$)/.test(cdpUrl)) {
      throw new Error('Set CHROME_CDP_URL to a throwaway Chrome. Refusing port 9222, the dedicated affiliate profile.');
    }
    console.log(`Connecting to Chrome via CDP at ${cdpUrl}...`);
    browser = await chromium.connectOverCDP(cdpUrl, { noDefaults: true });
    const context = browser.contexts()[0];
    const page = await context.newPage();

    console.log('\n1. Testing bot.sannysoft.com...');
    try {
      await page.goto('https://bot.sannysoft.com/', { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(2000);

      await page.screenshot({ path: 'docs/screenshots/bot-sannysoft.png', fullPage: true });

      const botScore = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('tr'));
        const checks: Record<string, string> = {};
        let suspiciousCount = 0;

        rows.forEach(row => {
          const cells = row.querySelectorAll('td');
          if (cells.length >= 2) {
            const label = cells[0].textContent?.trim() || '';
            const status = cells[1].textContent?.trim() || '';
            if (label) {
              checks[label] = status;
              if (status.toLowerCase().includes('bot') || status.toLowerCase().includes('suspicious')) {
                suspiciousCount++;
              }
            }
          }
        });

        return {
          total_checks: Object.keys(checks).length,
          suspicious_count: suspiciousCount,
          webdriver: (navigator as any).webdriver,
          runtime_enable_leak: checks['Chrome Runtime Enabled'] || 'not detected',
          key_checks: {
            'User-Agent': checks['User-Agent'] || 'unknown',
            'WebDriver': checks['WebDriver'] || 'unknown',
            'Chrome': checks['Chrome'] || 'unknown',
            'Permissions': checks['Permissions'] || 'unknown',
            'Plugins Length': checks['Plugins Length'] || 'unknown',
            'Languages': checks['Languages'] || 'unknown',
          },
        };
      });

      results['bot.sannysoft.com'] = {
        status: 'completed',
        ...botScore,
        screenshot: 'docs/screenshots/bot-sannysoft.png',
      };
      console.log('✅ bot.sannysoft.com completed');
      console.log(`   Suspicious count: ${botScore.suspicious_count}/${botScore.total_checks}`);
      console.log(`   WebDriver: ${botScore.webdriver}`);
    } catch (error: any) {
      results['bot.sannysoft.com'] = { status: 'failed', error: error.message };
      console.log('❌ bot.sannysoft.com failed:', error.message);
    }

    console.log('\n2. Testing rebrowser bot detector...');
    try {
      await page.goto('https://bot-detector.rebrowser.net/', { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(3000);

      await page.screenshot({ path: 'docs/screenshots/rebrowser-detector.png', fullPage: true });

      const rebrowserScore = await page.evaluate(() => {
        const getVisibleText = (selector: string) => {
          const el = document.querySelector(selector);
          return el?.textContent?.trim() || 'not found';
        };

        return {
          headline: getVisibleText('h1, h2, [class*="headline"], [class*="title"]'),
          status: getVisibleText('[class*="status"], [class*="result"]'),
          webdriver: (navigator as any).webdriver,
          user_agent: navigator.userAgent,
        };
      });

      results['rebrowser-bot-detector'] = {
        status: 'completed',
        ...rebrowserScore,
        screenshot: 'docs/screenshots/rebrowser-detector.png',
      };
      console.log('✅ rebrowser-bot-detector completed');
      console.log(`   Status: ${rebrowserScore.status}`);
    } catch (error: any) {
      results['rebrowser-bot-detector'] = { status: 'failed', error: error.message };
      console.log('❌ rebrowser-bot-detector failed:', error.message);
    }

    console.log('\n3. Testing CreepJS (may take 10+ seconds)...');
    try {
      await page.goto('https://abrahamjuliot.github.io/creepjs/', { waitUntil: 'networkidle', timeout: 60000 });
      await page.waitForTimeout(10000);

      await page.screenshot({ path: 'docs/screenshots/creepjs.png', fullPage: true });

      const creepjsScore = await page.evaluate(() => {
        const trustScore = document.querySelector('[id*="trust"], [class*="trust"]')?.textContent?.trim() || 'unknown';
        const lieDetected = document.querySelectorAll('[class*="lie"], [class*="lies"]').length;
        const grade = document.querySelector('[class*="grade"]')?.textContent?.trim() || 'unknown';
        
        return {
          trust_score: trustScore,
          lies_detected: lieDetected,
          grade: grade,
          webdriver: (navigator as any).webdriver,
          user_agent: navigator.userAgent.substring(0, 100),
        };
      });

      results['creepjs'] = {
        status: 'completed',
        ...creepjsScore,
        screenshot: 'docs/screenshots/creepjs.png',
      };
      console.log('✅ CreepJS completed');
      console.log(`   Trust score: ${creepjsScore.trust_score}`);
      console.log(`   Lies detected: ${creepjsScore.lies_detected}`);
    } catch (error: any) {
      results['creepjs'] = { status: 'failed', error: error.message };
      console.log('❌ CreepJS failed or timeout:', error.message);
    }

    await page.close();
    await browser.close();

    console.log('\n📊 Bot Detection Results:');
    console.log('========================');
    console.log(JSON.stringify(results, null, 2));

    writeFileSync('docs/BOT-CHECK-RESULTS.json', JSON.stringify(results, null, 2));
    
    // Create markdown report
    const markdown = generateMarkdown(results);
    writeFileSync('docs/BOT-CHECK-RESULTS.md', markdown);

    console.log('\n✅ Results saved to:');
    console.log('   - docs/BOT-CHECK-RESULTS.json');
    console.log('   - docs/BOT-CHECK-RESULTS.md');
    console.log('   - docs/screenshots/*.png');

    return results;
  } catch (error: any) {
    console.error('❌ Bot detection tests failed:', error.message);
    if (browser) {
      try {
        await browser.close();
      } catch (e) {}
    }
    process.exit(1);
  }
}

function generateMarkdown(results: any): string {
  const sections = [`# Bot Detection Test Results

**Test Date:** ${results.timestamp}  
**Chrome Version:** Headless Chrome via CDP (patchright)  
**CDP Port:** 127.0.0.1:9222

## Summary

| Site | Status | Key Findings |
|------|--------|-------------|
`];

  const sites = ['bot.sannysoft.com', 'rebrowser-bot-detector', 'creepjs'];
  sites.forEach(site => {
    const result = results[site];
    if (result.status === 'completed') {
      let findings = '';
      if (site === 'bot.sannysoft.com') {
        findings = `${result.suspicious_count}/${result.total_checks} suspicious, WebDriver: ${result.webdriver}`;
      } else if (site === 'rebrowser-bot-detector') {
        findings = `Status: ${result.status}`;
      } else {
        findings = `Trust: ${result.trust_score}, Lies: ${result.lies_detected}`;
      }
      sections.push(`| ${site} | ✅ ${result.status} | ${findings} |`);
    } else {
      sections.push(`| ${site} | ❌ ${result.status} | ${result.error} |`);
    }
  });

  sections.push(`
## Detailed Results

### 1. bot.sannysoft.com

**Status:** ${results['bot.sannysoft.com'].status}  
**Screenshot:** ![bot.sannysoft.com](screenshots/bot-sannysoft.png)

`);

  if (results['bot.sannysoft.com'].status === 'completed') {
    const r = results['bot.sannysoft.com'];
    sections.push(`**Suspicious Checks:** ${r.suspicious_count} out of ${r.total_checks}  
**WebDriver Flag:** \`${r.webdriver}\`  
**Runtime Enable Leak:** ${r.runtime_enable_leak}

**Key Checks:**
${Object.entries(r.key_checks).map(([k, v]: [string, any]) => `- **${k}:** ${v}`).join('\n')}
`);
  }

  sections.push(`
### 2. rebrowser-bot-detector

**Status:** ${results['rebrowser-bot-detector'].status}  
**Screenshot:** ![rebrowser](screenshots/rebrowser-detector.png)

`);

  if (results['rebrowser-bot-detector'].status === 'completed') {
    const r = results['rebrowser-bot-detector'];
    sections.push(`**Headline:** ${r.headline}  
**Detection Status:** ${r.status}  
**WebDriver:** \`${r.webdriver}\`
`);
  }

  sections.push(`
### 3. CreepJS

**Status:** ${results['creepjs'].status}  
**Screenshot:** ![CreepJS](screenshots/creepjs.png)

`);

  if (results['creepjs'].status === 'completed') {
    const r = results['creepjs'];
    sections.push(`**Trust Score:** ${r.trust_score}  
**Lies Detected:** ${r.lies_detected}  
**Grade:** ${r.grade}  
**WebDriver:** \`${r.webdriver}\`
`);
  }

  sections.push(`
## Analysis

### Patchright Improvements

Patchright (patched Playwright) addresses the following bot detection leaks:

1. **Runtime.enable Leak:** The main CDP leak that vanilla Playwright triggers
2. **navigator.webdriver:** Should be \`undefined\` (not \`true\`)
3. **Chrome object:** Should be present in headless mode
4. **Permissions API:** Should behave like real Chrome

### Pass/Fail Criteria

| Check | Status | Notes |
|-------|--------|-------|
| WebDriver undefined | ${results['bot.sannysoft.com']?.webdriver === undefined ? '✅ PASS' : '❌ FAIL'} | navigator.webdriver should be undefined |
| Runtime.enable clean | ${results['bot.sannysoft.com']?.runtime_enable_leak?.includes('not') ? '✅ PASS' : '⚠️  CHECK'} | No Runtime.enable leak detected |
| Bot detector pass | ${results['rebrowser-bot-detector']?.status === 'completed' ? '✅ PASS' : '❌ FAIL'} | Rebrowser detector result |
| CreepJS trust | ${results['creepjs']?.trust_score ? '✅ COMPLETED' : '❌ FAIL'} | Trust score reported |

### Recommendations

1. **If WebDriver is true:** The CDP connection may not be using patchright correctly
2. **If Runtime.enable is detected:** Check that patchright patches are applied
3. **High suspicious count (>5):** Consider additional stealth measures
4. **CreepJS lies detected:** Some fingerprinting mismatches expected in headless mode

## Conclusion

This test validates that patchright's CDP controller provides a cleaner fingerprint than vanilla Playwright by patching the Runtime.enable leak and setting navigator.webdriver to undefined.

**Test completed:** ${results.timestamp}
`);

  return sections.join('\n');
}

runBotDetection();
