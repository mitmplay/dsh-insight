import { chromium } from '@playwright/test';

const BASE = 'http://localhost:5175';
const PROMPT = [
  'run 1 bash scripts in parallel to:',
  '- print "hello" 5 times',
  '',
  'then wait 5second, then',
  '',
  'run 3 bash scripts in parallel to:',
  '- print "hello" 5 times',
  '- print "hello" 15 times',
  '- print "hello" 25 times',
  '',
  'then wait 1minutes, I want to check on the job'
].join('\n');

const browser = await chromium.launch({ headless: false, slowMo: 150 });
const page = await browser.newPage();
const log = (...a) => console.log('[JT]', ...a);

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="new-chat-button"]', { timeout: 30000 });
log('page loaded');

await page.click('[data-testid="new-chat-button"]');
await page.waitForTimeout(3000);
log('new session created');

await page.fill('[data-testid="prompt-input"] textarea', PROMPT);
await page.click('[data-testid="send-button"]');
log('prompt sent - waiting for the agent to spawn jobs');

await page.waitForSelector('[data-testid="jobs-button-trigger"]', { timeout: 240000 });
log('JobsButton visible');

await page.click('[data-testid="jobs-button-trigger"]');
await page.waitForSelector('[data-testid^="job-open-"]', { timeout: 15000 });
const opens = await page.$$('[data-testid^="job-open-"]');
log('roster rows clickable:', opens.length);
await opens[opens.length - 1].click();
log('clicked last roster item');

await page.waitForSelector('[data-testid="terminal-desk"]', { timeout: 15000 });
await page.waitForSelector('[data-testid^="terminal-tab-button-"]', { timeout: 15000 });
const tabs1 = await page.$$eval('[data-testid^="terminal-tab-button-"]', els => els.map(e => e.textContent.trim()));
log('tabs after click:', JSON.stringify(tabs1));
await page.waitForSelector('[data-testid="job-tail"]', { timeout: 15000 });

await page.waitForFunction(
  () => {
    const el = document.querySelector('[data-testid="job-tail"]');
    return el && !el.textContent.includes('waiting for output');
  },
  { timeout: 60000 }
);
log('live frames confirmed BEFORE reload');
await page.screenshot({ path: '/tmp/jt-before-reload.png' });

await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="terminal-desk"]', { timeout: 30000 });
await page.waitForTimeout(4000);
const tabs2 = await page.$$eval('[data-testid^="terminal-tab-button-"]', els => els.map(e => e.textContent.trim()));
log('tabs after reload:', JSON.stringify(tabs2));
await page.screenshot({ path: '/tmp/jt-after-reload.png' });

const tailText = await page.$eval('[data-testid="job-tail"]', el => el.textContent.slice(0, 200)).catch(() => 'NO TAIL');
log('tail after reload:', JSON.stringify(tailText));
const state = await page.waitForFunction(
  () => {
    const el = document.querySelector('[data-testid="job-tail"]');
    return el && !el.textContent.includes('waiting for output');
  },
  { timeout: 30000 }
).then(() => 'RECOVERED').catch(() => 'NOT_RECOVERED');
log('after reload follow state:', state);
await page.screenshot({ path: '/tmp/jt-final.png' });

await browser.close();
log('DONE');