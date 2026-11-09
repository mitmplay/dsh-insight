#!/usr/bin/env node
/**
 * gesture.mjs — real-gesture verbs for the glass-dsh skill (Gates 3–5, D15).
 * Real mouse/keyboard only: synthetic dispatchEvent is not verification.
 * One verb per process; each prints {before, after, moved|delta} JSON.
 * Run from the DSI repo root (playwright-core resolves there).
 *
 * Verbs:
 *   click <selector>            real click (raises interception as an error, never force-clicks)
 *   type <selector> <text>      real click into the element + page.keyboard.type
 *   drag <selector> <dx> <dy>   real mouse down → 10 stepped moves with waits → up, on the element's box
 *   control <js-expr>           control gate: evaluate an assertion expression → {pass, result}
 *   persist <localStorageKey>   read a store key from the DSH tab → {raw}
 *
 * Flags: --dsh-url|--dsh-port|--owner-session (see _connect.mjs); --substr <s> selects a tab by URL
 * substring for reads (never positional, D10); input verbs always target the DSH-origin tab.
 */
import { connect, pickByOrigin, originOf, die } from './_connect.mjs';

const argv = process.argv.slice(2);
const verb = argv[0];
function opt(name) {
  const i = argv.indexOf(name);
  return i !== -1 ? argv[i + 1] : undefined;
}
const substr = opt('--substr');

const { ctx, dshOrigin } = await connect(argv);
function page() {
  if (substr) {
    const p = ctx.pages().find((p) => p.url().includes(substr));
    if (!p) die('no tab whose URL contains ' + JSON.stringify(substr));
    return p;
  }
  return pickByOrigin(ctx, dshOrigin);
}

if (verb === 'click') {
  const sel = argv[1];
  if (!sel) die('click needs a selector');
  const p = page();
  const before = await p.evaluate((s) => !!document.querySelector(s), sel);
  await p.locator(sel).first().click(); // locator.click raises interception loudly (no force)
  console.log(JSON.stringify({ verb: 'click', selector: sel, before, after: true, moved: before !== true }));
} else if (verb === 'type') {
  const sel = argv[1], text = argv[2];
  if (!sel || text === undefined) die('type needs <selector> <text>');
  const p = page();
  const loc = p.locator(sel).first();
  await loc.click();
  await p.keyboard.type(text);
  const after = await loc.inputValue().catch(() => undefined);
  console.log(JSON.stringify({ verb: 'type', selector: sel, before: '', after, moved: after === text }));
} else if (verb === 'drag') {
  const sel = argv[1], dx = Number(argv[2]), dy = Number(argv[3]);
  if (!sel || !Number.isFinite(dx) || !Number.isFinite(dy)) die('drag needs <selector> <dx> <dy>');
  const p = page();
  const posBefore = await p.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const host = el.closest('[style*="left"]') ?? el;
    return { x: host.style.left, y: host.style.top };
  }, sel);
  if (!posBefore) die('no element for ' + sel);
  const box = await p.locator(sel).first().boundingBox();
  if (!box) die('boundingBox failed for ' + sel);
  const sx = box.x + box.width / 2, sy = box.y + Math.min(box.height / 2, 8);
  await p.mouse.move(sx, sy);
  await p.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await p.mouse.move(sx + (dx * i) / 10, sy + (dy * i) / 10);
    await new Promise((r) => setTimeout(r, 20));
  }
  await p.mouse.up();
  await new Promise((r) => setTimeout(r, 300));
  const posAfter = await p.evaluate((s) => {
    const el = document.querySelector(s);
    const host = el?.closest('[style*="left"]') ?? el;
    return { x: host.style.left, y: host.style.top };
  }, sel);
  const moved = JSON.stringify(posBefore) !== JSON.stringify(posAfter);
  console.log(JSON.stringify({ verb: 'drag', selector: sel, before: posBefore, after: posAfter, moved }));
} else if (verb === 'control') {
  const expr = argv[1];
  if (!expr) die('control needs a JS assertion expression');
  const p = page();
  const result = await p.evaluate('!!(' + expr + ')');
  console.log(JSON.stringify({ verb: 'control', expr, pass: result === true, result }));
} else if (verb === 'persist') {
  const key = argv[1];
  if (!key) die('persist needs a localStorage key');
  const p = page();
  const raw = await p.evaluate((k) => window.localStorage.getItem(k), key);
  console.log(JSON.stringify({ verb: 'persist', key, raw }));
} else {
  die('unknown verb ' + JSON.stringify(verb) + ' — click | type | drag | control | persist');
}
process.exit(0);
