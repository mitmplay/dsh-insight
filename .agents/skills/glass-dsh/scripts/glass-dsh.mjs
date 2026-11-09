#!/usr/bin/env node
/**
 * glass-dsh.mjs — origin-aware driver verbs for the glass-dsh skill (D13).
 * Run from the DSI repo root (playwright-core resolves there). One JSON verdict
 * on stdout; loud die() on refusal (D7/D11).
 *
 * Verbs:
 *   pages                      list CDP pages with origin classification vs the resolved DSH origin
 *   eval --b64 <b64> [substr]  evaluate base64 JS in the DSH tab (or the tab whose URL contains substr);
 *                              D10 grammar law: with --b64, a leftover argument IS the substring — never positional
 *   shot <path>                screenshot of the DSH tab
 *
 * Flags: --dsh-url <url> | --dsh-port <n> | --owner-session <id>  (see _connect.mjs)
 */
import { connect, pickByOrigin, originOf, die } from './_connect.mjs';

const argv = process.argv.slice(2);
const verb = argv[0];

function pick(ctx, dshOrigin, substr) {
  if (substr) {
    const page = ctx.pages().find((p) => p.url().includes(substr));
    if (!page) die('no tab whose URL contains ' + JSON.stringify(substr) + ' — refusing positional guesses (D2/D10)');
    return page;
  }
  return pickByOrigin(ctx, dshOrigin);
}

const { ctx, dshOrigin } = await connect(argv);

if (verb === 'pages') {
  const pages = ctx.pages().map((p) => ({
    url: p.url(),
    origin: originOf(p.url()),
    isDsh: originOf(p.url()) === dshOrigin,
  }));
  console.log(JSON.stringify({ dshOrigin, pages }));
} else if (verb === 'eval') {
  const rest = argv.slice(1);
  const b64 = rest.indexOf('--b64');
  let expr, substr = undefined;
  if (b64 !== -1) {
    expr = Buffer.from(rest[b64 + 1] ?? '', 'base64').toString('utf8');
    const leftover = rest[b64 + 2];
    if (leftover) substr = leftover; // D10: leftover argument IS the substring
  } else {
    expr = rest[0];
    if (!expr) die('eval needs inline JS or --b64 <b64> [substr]');
    substr = rest[1];
  }
  const page = pick(ctx, dshOrigin, substr);
  const result = await page.evaluate(expr);
  console.log(JSON.stringify({ url: page.url(), result }));
} else if (verb === 'shot') {
  const path = argv[1];
  if (!path) die('shot needs a file path');
  const page = pickByOrigin(ctx, dshOrigin);
  await page.screenshot({ path, fullPage: false });
  console.log(JSON.stringify({ ok: true, path, url: page.url() }));
} else {
  die('unknown verb ' + JSON.stringify(verb) + ' — pages | eval --b64 <b64> [substr] | shot <path>');
}
process.exit(0);
