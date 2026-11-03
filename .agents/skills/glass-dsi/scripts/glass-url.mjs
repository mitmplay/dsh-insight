#!/usr/bin/env node
/**
 * glass-url.mjs — the dsi-glass URL path (2026-10-29).
 *
 * For driving NON-DSI surfaces (YouTube, docs, anything) on the operator's
 * glass. Never touches the DSI tab: open <url> adds a NEW tab last and
 * focuses it (tab-grammar: glass <url>); the other verbs run against the
 * NEWEST tab, whatever it is. The DSI server is still needed — it owns the
 * session registry (see _connect.mjs).
 *
 * Usage (run from the DSI repo root so playwright-core resolves):
 *   node .agents/skills/dsi-glass/scripts/glass-url.mjs open <url>
 *   node …/glass-url.mjs pages
 *   node …/glass-url.mjs eval '<js>'     # async page.evaluate on newest tab
 *   node …/glass-url.mjs shot <file.png> # screenshot of newest tab
 */
import { connect, die } from './_connect.mjs';

const [cmd, ...args] = process.argv.slice(2);
const { session, browser, ctx } = await connect();

// newest real tab = last http(s) page; CDP page order is not insertion order
// and the glass placeholder (data:text/html,<title>Glass Browser…) can sit last
const newest = () => {
  const pages = ctx.pages().filter((p) => p.url().startsWith('http'));
  return pages[pages.length - 1];
};

if (cmd === 'open') {
  const url = args[0];
  if (!url) die('open needs a url');
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' }).catch((e) => die('goto failed: ' + e.message));
  await page.waitForTimeout(1500); // let the SPA settle
  console.log(JSON.stringify({ ok: true, sessionId: session.id, url: page.url(), title: await page.title() }));
} else if (cmd === 'pages') {
  console.log(JSON.stringify(await Promise.all(ctx.pages().map(async (p) => ({ url: p.url(), title: await p.title() }))), null, 1));
} else if (cmd === 'eval') {
  if (!args[0]) die('eval needs a js expression');
  console.log(JSON.stringify(await newest().evaluate(async (src) => await eval(src), args[0]), null, 1));
} else if (cmd === 'shot') {
  const file = args[0] ?? 'tmp/glass-url-shot.png';
  await newest().screenshot({ path: file });
  console.log(JSON.stringify({ ok: true, file }));
} else {
  die('unknown command: ' + cmd);
}
await browser.close();
