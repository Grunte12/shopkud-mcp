import { startConsole, startMockChrome } from './console-harness.js';

/**
 * Starts the console with demo data and a fake Chrome on 127.0.0.1:9444.
 * It never talks to a real Chrome or to Shopee.
 *   npm run console:demo
 */
const port = Number(process.env.CONSOLE_PORT || 3000);
const chromePort = Number(process.env.DEMO_CHROME_PORT || 9444);
const captcha = process.env.DEMO_CAPTCHA !== '0';

await startMockChrome(chromePort);
const harness = await startConsole({ port, chromePort, captcha });
console.log(`ShopKud console (demo data, mock Chrome) at ${harness.url}`);
console.log(captcha ? 'Demo state: a job is stopped on a CAPTCHA (DEMO_CAPTCHA=0 to clear).' : 'Demo state: no CAPTCHA stop.');
process.on('SIGINT', async () => {
  await harness.stop();
  process.exit(0);
});
