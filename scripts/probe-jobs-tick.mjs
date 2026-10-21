// ADR-0033 D4 gate — count singular vs batch jobs calls on the dev floor
// after a settle window. Pass = 0 singular post-settle; batch = few.
import { chromium } from 'playwright-core';
const seen = [];
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on('request', (req) => {
  const u = req.url();
  if (u.includes('/api/dsh/jobs')) seen.push({ t: Date.now(), batch: u.includes('sessionIds=') });
});
await page.goto('http://127.0.0.1:5175/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(12000); // settle first loads, then observe
const cutoff = Date.now() - 9000; // the settled observation window
const win = seen.filter((r) => r.t >= cutoff);
const singles = win.filter((r) => !r.batch).length;
const batches = win.filter((r) => r.batch).length;
console.log('settled 9s window — singular:', singles, '| batch:', batches, '| total seen:', seen.length);
await browser.close();
