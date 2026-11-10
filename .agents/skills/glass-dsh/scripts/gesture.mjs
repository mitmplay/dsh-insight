#!/usr/bin/env node
/**
 * gesture.mjs — real-gesture verbs for the glass-dsh skill (Gates 3–5, D15).
 * Real mouse/keyboard only: synthetic dispatchEvent is not verification.
 * One verb per process; each prints {before, after, moved|delta} JSON.
 * Run from any cwd (D16: the driver resolves its own playwright-core).
 *
 * Verbs:
 *   click <selector>            real click (raises interception as an error, never force-clicks)
 *   type <selector> <text>      real click into the element + page.keyboard.type
 *   drag <selector> <dx> <dy>   real mouse down → 10 stepped moves with waits → up, on the element's box
 *   control <js-expr>           control gate: evaluate an assertion expression → {pass, result}
 *   persist <localStorageKey>   read a store key from the DSH tab → {raw}
 *   run <steps.json>            D17 composite: ONE process + ONE CDP session executes a JSON
 *                               array of steps ({verb, …args, label?}) in order, printing one
 *                               verdict per step (same shapes as the single verbs) and stopping
 *                               at the first failed gate — control pass:false, a moved:false on
 *                               a gesture, or any die() — reporting the completed prefix.
 *                               Exit 1 when a step failed, 0 otherwise (D11 stop-loss, batched).
 *
 * Flags: --dsh-url|--dsh-port|--owner-session (see _connect.mjs); --substr <s> selects a tab by URL
 * substring for reads (never positional, D10); input verbs always target the DSH-origin tab.
 */
import { readFileSync } from 'node:fs';
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

async function readHostPos(p, sel) {
  return p.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const host = el.closest('[style*="left"]') ?? el;
    return { x: host.style.left, y: host.style.top };
  }, sel);
}

/**
 * Execute one step; returns { ok, verdict }. Verdict shapes are byte-identical
 * to the single-verb shapes (D17 — additive composition only).
 */
async function execStep(p, step) {
  const v = step.verb;
  try {
    if (v === 'click') {
      const sel = step.selector;
      if (!sel) return { ok: false, verdict: { error: 'click needs a selector' } };
      const before = await p.evaluate((s) => !!document.querySelector(s), sel);
      await p.locator(sel).first().click(); // locator.click raises interception loudly (no force)
      return { ok: true, verdict: { verb: 'click', selector: sel, before, after: true, moved: before !== true } };
    }
    if (v === 'type') {
      const sel = step.selector, text = step.text;
      if (!sel || text === undefined) return { ok: false, verdict: { error: 'type needs selector + text' } };
      const loc = p.locator(sel).first();
      await loc.click();
      await p.keyboard.type(text);
      const after = await loc.inputValue().catch(() => undefined);
      return { ok: after === text, verdict: { verb: 'type', selector: sel, before: '', after, moved: after === text } };
    }
    if (v === 'drag') {
      const sel = step.selector, dx = Number(step.dx), dy = Number(step.dy);
      if (!sel || !Number.isFinite(dx) || !Number.isFinite(dy)) {
        return { ok: false, verdict: { error: 'drag needs selector + finite dx/dy' } };
      }
      const posBefore = await readHostPos(p, sel);
      if (!posBefore) return { ok: false, verdict: { error: 'no element for ' + sel } };
      const box = await p.locator(sel).first().boundingBox();
      if (!box) return { ok: false, verdict: { error: 'boundingBox failed for ' + sel } };
      const sx = box.x + box.width / 2, sy = box.y + Math.min(box.height / 2, 8);
      await p.mouse.move(sx, sy);
      await p.mouse.down();
      for (let i = 1; i <= 10; i++) {
        await p.mouse.move(sx + (dx * i) / 10, sy + (dy * i) / 10);
        await new Promise((r) => setTimeout(r, 20));
      }
      await p.mouse.up();
      await new Promise((r) => setTimeout(r, 300));
      const posAfter = await readHostPos(p, sel);
      const moved = JSON.stringify(posBefore) !== JSON.stringify(posAfter);
      return { ok: moved, verdict: { verb: 'drag', selector: sel, before: posBefore, after: posAfter, moved } };
    }
    if (v === 'control') {
      const expr = step.expr;
      if (!expr) return { ok: false, verdict: { error: 'control needs a JS assertion expression' } };
      const result = await p.evaluate('!!(' + expr + ')');
      return { ok: result === true, verdict: { verb: 'control', expr, pass: result === true, result } };
    }
    if (v === 'persist') {
      const key = step.key;
      if (!key) return { ok: false, verdict: { error: 'persist needs a localStorage key' } };
      const raw = await p.evaluate((k) => window.localStorage.getItem(k), key);
      return { ok: true, verdict: { verb: 'persist', key, raw } };
    }
    return { ok: false, verdict: { error: 'unknown step verb ' + JSON.stringify(v) + ' — click | type | drag | control | persist' } };
  } catch (e) {
    return { ok: false, verdict: { error: String(e?.message ?? e) } };
  }
}

if (verb === 'run') {
  const file = argv[1];
  if (!file) die('run needs a steps.json path');
  let steps;
  try {
    steps = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    die('run cannot read steps: ' + String(e?.message ?? e));
  }
  if (!Array.isArray(steps)) die('run steps must be a JSON array of {verb, …}');
  const p = page();
  const results = [];
  let failedAt = null;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const { ok, verdict } = await execStep(p, step);
    results.push({ label: step.label ?? (step.verb + '#' + i), ok, ...verdict });
    if (!ok) { failedAt = i; break; }
  }
  console.log(JSON.stringify({
    verb: 'run', steps: steps.length, executed: results.length,
    failedAt, ok: failedAt === null, results,
  }));
  process.exit(failedAt === null ? 0 : 1);
} else if (verb === 'click') {
  const sel = argv[1];
  if (!sel) die('click needs a selector');
  const { verdict } = await execStep(page(), { verb: 'click', selector: sel });
  if (verdict.error) die(verdict.error);
  console.log(JSON.stringify(verdict));
} else if (verb === 'type') {
  const sel = argv[1], text = argv[2];
  if (!sel || text === undefined) die('type needs <selector> <text>');
  const { verdict } = await execStep(page(), { verb: 'type', selector: sel, text });
  console.log(JSON.stringify(verdict));
} else if (verb === 'drag') {
  const sel = argv[1], dx = Number(argv[2]), dy = Number(argv[3]);
  if (!sel || !Number.isFinite(dx) || !Number.isFinite(dy)) die('drag needs <selector> <dx> <dy>');
  const { verdict } = await execStep(page(), { verb: 'drag', selector: sel, dx, dy });
  console.log(JSON.stringify(verdict));
} else if (verb === 'control') {
  const expr = argv[1];
  if (!expr) die('control needs a JS assertion expression');
  const { verdict } = await execStep(page(), { verb: 'control', expr });
  console.log(JSON.stringify(verdict));
} else if (verb === 'persist') {
  const key = argv[1];
  if (!key) die('persist needs a localStorage key');
  const { verdict } = await execStep(page(), { verb: 'persist', key });
  console.log(JSON.stringify(verdict));
} else {
  die('unknown verb ' + JSON.stringify(verb) + ' — click | type | drag | control | persist | run');
}
process.exit(0);
