#!/usr/bin/env node
/**
 * glass-url.mjs — the glass-url URL path (2026-10-29, hardened 2026-10-30,
 * RCA "The Hardening That Missed the Token Burn").
 *
 * Drives NON-DSI surfaces (YouTube, docs, anything) on the operator's
 * glass. Never touches the DSI tab. One command per intent:
 *
 *   node …/glass-url.mjs yt <search terms…> --play "<title-substring>" [--shot f.png]
 *       search YouTube → normalized title match → open watch tab →
 *       unmute+play → gate twice (paused:false, rising t) → optional shot.
 *       Prints ONE JSON with every intermediate stage, then EXITS.
 *   node …/glass-url.mjs open <url>
 *   node …/glass-url.mjs pages
 *   node …/glass-url.mjs eval [url-substring] <js>   # inline JS: LAST arg is the source
 *   node …/glass-url.mjs eval --b64 <base64-js> [url-substring]
 *       # base64 mode: quote-proof transport; anything left after the
 *       # payload IS the url-substring (parsed by shape — D10, _args.mjs).
 *       # yt --play consumes EVERY term (artist AND title) — D9.
 *       # A NO_MATCH / die is an ANSWER: report and stop (D11, SKILL.md).
 *   node …/glass-url.mjs shot [file.png] [url-substring]
 *
 * EXIT DISCIPLINE: this script always process.exit()s — a driver that
 * played media once hung its caller for a full timeout (RCA trap 5).
 */
import { connect, die, pick, isFloorTab } from './_connect.mjs';
import { norm, parseEvalArgs, matchAllTerms } from './_args.mjs';

const argv = process.argv.slice(2);
const { session, browser, ctx, base } = await connect();
const out = (v) => { console.log(JSON.stringify(v, null, 1)); return process.exit(0); };

// target tab: url-substring when given; else last http(s) page that is
// neither the glass placeholder nor the FLOOR's own page — origin compare
// against the resolved base (The Floor Seam ADR D2; never a port literal).
const target = (substr) => {
  if (substr) {
    const p = pick(ctx, substr);
    if (!p) die('no tab matching "' + substr + '" — run: pages');
    return p;
  }
  const pages = ctx.pages().filter((p) => p.url().startsWith('http') && !isFloorTab(p.url(), base));
  if (!pages.length) die('no non-DSI tab to drive — run: glass-url.mjs open <url>');
  return pages[pages.length - 1];
};

// gate: read playback state; double-read proves time rises
const gate = async (page) => page.evaluate(() => { const v = document.querySelector('video'); if (!v) return { err: 'novideo' }; v.muted = false; try { v.play(); } catch {} return { t: Math.round(v.currentTime * 10) / 10, paused: v.paused }; });

const cmd = argv[0];

if (cmd === 'open') {
  const url = argv[1];
  if (!url) die('open needs a url');
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' }).catch((e) => die('goto failed: ' + e.message));
  await page.waitForTimeout(1500); // let the SPA settle
  await page.bringToFront(); // make the opened tab the active/visible one
  out({ ok: true, sessionId: session.id, url: page.url(), title: await page.title() });
} else if (cmd === 'pages') {
  out(await Promise.all(ctx.pages().map(async (p) => ({ url: p.url(), title: await p.title() }))));
} else if (cmd === 'eval') {
  let rest = argv.slice(1);
  let substr;
  let src;
  let b64 = false;
  if (rest[0] === '--b64') { b64 = true; rest = rest.slice(1); } // payload stays in rest; parseEvalArgs takes it from here (D10)
  const parsed = parseEvalArgs(rest, { b64 });
  src = parsed.src; substr = parsed.substr;
  if (b64 && src) src = Buffer.from(src, 'base64').toString('utf8');
  if (!src) die('eval needs js (inline or --b64 <base64>)');
  out(await target(substr).evaluate(async (s) => await eval(s), src));
} else if (cmd === 'shot') {
  const file = argv[1] ?? 'tmp/glass-url-shot.png';
  const substr = argv[2];
  await target(substr).screenshot({ path: file });
  out({ ok: true, file });
} else if (cmd === 'yt') {
  const dash = argv.indexOf('--play');
  const shotFlag = argv.indexOf('--shot');
  const terms = argv.slice(1, dash === -1 ? (shotFlag === -1 ? argv.length : shotFlag) : dash).join(' ');
  const matchSub = dash !== -1 ? argv[dash + 1] : null;
  const shotFile = shotFlag !== -1 ? argv[shotFlag + 1] ?? 'tmp/glass-url-yt.png' : null;
  if (!terms) die('yt needs search terms');
  const stages = {};
  const sp = await ctx.newPage();
  await sp.goto('https://www.youtube.com/results?search_query=' + encodeURIComponent(terms), { waitUntil: 'domcontentloaded' });
  await sp.waitForTimeout(3500);
  const raw = await sp.evaluate(() => [...document.querySelectorAll('a#video-title')].slice(0, 25).map((a) => ({ t: a.title || a.textContent.trim(), h: a.href })));
  stages.candidates = raw.length;
  const hit = raw.find((r) => matchAllTerms(r.t, matchSub));
  if (!hit) out({ ok: false, stage: 'match', play: matchSub, titles: raw.slice(0, 10).map((r) => r.t) }); // D9: a refusal is an answer
  stages.matched = hit.t;
  const wp = await ctx.newPage();
  const watchUrl = 'https://www.youtube.com/watch?v=' + new URL(hit.h).searchParams.get('v');
  await wp.goto(watchUrl, { waitUntil: 'domcontentloaded' });
  await wp.waitForTimeout(6000);
  await wp.bringToFront();
  // gate loop: paused:false with RISING t on the last two reads. YouTube
  // may restart the video once as settings settle (observed 2026-10-30:
  // t 5.9 then 3.8) — re-read up to 3x instead of failing an honest play.
  const reads = [await gate(wp)];
  for (let i = 0; i < 2; i++) { await wp.waitForTimeout(4000); reads.push(await gate(wp)); }
  stages.gates = reads;
  const last = reads.slice(-2);
  stages.passed = last.every((r) => r.paused === false && !r.err) && last[1].t > last[0].t;
  if (shotFile) { await wp.screenshot({ path: shotFile }); stages.shot = shotFile; }
  stages.watchUrl = wp.url();
  await sp.close().catch(() => {});
  out({ ok: stages.passed, sessionId: session.id, ...stages });
} else {
  die('unknown command: ' + cmd + ' (see header usage)');
}
await browser.close().catch(() => {});
process.exit(0);
