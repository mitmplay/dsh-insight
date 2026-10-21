// ADR-0034 D-gate — viewport-cap: fetched batch ids must be ON SCREEN
// (row anchor rect within viewport ±200px margin) ∪ panels/current.
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:5175/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(12000); // settle: initial observers + debounce
const fetched = [];
page.on('request', (req) => {
  const u = req.url();
  if (u.includes('sessionIds=')) fetched.push(...new URL(u).searchParams.get('sessionIds').split(',').filter(Boolean));
});
const before = Date.now();
await page.waitForTimeout(9000); // settled observation window
const verdict = await page.evaluate((fetched) => {
  const vh = window.innerHeight, margin = 200;
  const onScreen = new Set();
  document.querySelectorAll('#sidebar-spine-group-rows a[data-session-id]').forEach(a => {
    const r = a.getBoundingClientRect();
    if (r.bottom >= -margin && r.top <= vh + margin) onScreen.add(a.getAttribute('data-session-id'));
  });
  const off = [...new Set(fetched)].filter(id => !onScreen.has(id));
  return { rows: document.querySelectorAll('#sidebar-spine-group-rows a[data-session-id]').length,
           onScreenCount: onScreen.size, fetchedDistinct: new Set(fetched).size,
           offscreenFetched: off.slice(0, 5), offscreenCount: off.length };
}, fetched.slice(Math.floor(fetched.length / 3))); // ids from the settled window
console.log(JSON.stringify(verdict, null, 1));
await browser.close();
