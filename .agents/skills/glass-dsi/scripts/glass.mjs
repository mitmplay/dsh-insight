#!/usr/bin/env node
/**
 * glass.mjs — the dsi-glass fast path (2026-10-29).
 *
 * ONE command replaces the discovery dance: port resolve (:5175 health →
 * GET /api/browser → session port → /json/list → playwright-core
 * connectOverCDP → reuse-or-create the DSI tab). The browser-session
 * registry stays the ONLY source of truth — this script caches nothing
 * (skill rule 3: a hardcoded port verifies a ghost).
 *
 * Usage (run from the DSI repo root so playwright-core resolves):
 *   node .agents/skills/dsi-glass/scripts/glass.mjs open [url]
 *   node …/glass.mjs eval '<js>'          # async page.evaluate, JSON out
 *   node …/glass.mjs type '<text>'        # real keystrokes into the composer
 *   node …/glass.mjs shot <file.png>      # viewport screenshot
 *   node …/glass.mjs strip                # suggest-strip verdict (rows,
 *                                         #   activeIdx, ariaSel, tipCount)
 *   node …/glass.mjs pages                # list glass pages (url + title)
 *
 * On any failure it prints the manual fallback hint (SKILL.md Step 1 —
 * the operator clicks the Browser chip; agents never open sessions).
 */
import { connect, die } from './_connect.mjs';

const DSI = 'http://127.0.0.1:5175';
const [cmd, ...args] = process.argv.slice(2);

const { session, browser, ctx } = await connect();

let page = ctx.pages().find((p) => p.url().includes('5175'));
if (cmd === 'open') {
  if (!page) {
    page = await ctx.newPage();
    await page.goto(args[0] ?? DSI, { waitUntil: 'domcontentloaded' }).catch(() => {});
  } else if (args[0] && args[0] !== page.url()) {
    await page.goto(args[0], { waitUntil: 'domcontentloaded' }).catch(() => {});
  }
  await page.waitForSelector('body', { timeout: 15000 });
} else if (!page) {
  die('no DSI tab in the glass — run: glass.mjs open');
}

if (cmd === 'open') {
  await page.waitForTimeout(1500); // let the SPA settle
  console.log(JSON.stringify({ ok: true, sessionId: session.id, port: session.port, url: page.url(), title: await page.title() }));
} else if (cmd === 'pages') {
  console.log(JSON.stringify(await Promise.all(ctx.pages().map(async (p) => ({ url: p.url(), title: await p.title() }))), null, 1));
} else if (cmd === 'eval') {
  if (!args[0]) die('eval needs a js expression');
  console.log(JSON.stringify(await page.evaluate(async (src) => await eval(src), args[0]), null, 1));
} else if (cmd === 'type') {
  if (!args[0]) die('type needs text');
  const ta = page.locator('textarea').first();
  await ta.click();
  await page.keyboard.press('Meta+a');
  await page.keyboard.press('Backspace');
  await page.keyboard.type(args[0], { delay: 60 });
  await page.waitForTimeout(1000); // debounce (120 ms) + fetch
  console.log(JSON.stringify({ ok: true, typed: args[0] }));
} else if (cmd === 'shot') {
  const file = args[0] ?? 'tmp/glass-shot.png';
  await page.screenshot({ path: file });
  console.log(JSON.stringify({ ok: true, file }));
} else if (cmd === 'strip') {
  console.log(JSON.stringify(await page.evaluate(() => {
    const strip = document.querySelector('[data-testid=suggest-strip]');
    if (!strip) return { strip: false };
    const chips = [...strip.querySelectorAll(':scope > .strip-chip')];
    const tips = [...document.body.querySelectorAll(':scope > .strip-tip')];
    return {
      strip: true,
      rows: chips.length,
      labels: chips.map((c) => c.querySelector('.strip-label')?.textContent?.trim()),
      activeIdx: chips.findIndex((c) => c.classList.contains('active')),
      ariaSel: chips.map((c) => c.querySelector('.strip-pick')?.getAttribute('aria-selected')),
      tipCount: tips.length,
      tipText: tips[0]?.querySelector('pre')?.textContent?.slice(0, 80) ?? null,
      taValue: document.querySelector('textarea')?.value
    };
  }), null, 1));
} else {
  die('unknown command: ' + cmd);
}
await browser.close();
